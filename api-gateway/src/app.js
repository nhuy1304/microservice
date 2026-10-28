import express from "express";
import dotenv from "dotenv";
import morgan from "morgan";
import jwt from "jsonwebtoken";
import { createClient } from "redis";
import {
  createProxyMiddleware,
  fixRequestBody,
} from "http-proxy-middleware";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Logging tại API Gateway
app.use(morgan("dev"));

// Redis Client
const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on("error", (error) => {
  console.error("Redis Client Error:", error);
});

// Redis Rate Limiting
const rateLimiter = async (req, res, next) => {
  try {
    const key = `rate-limit:${req.ip}`;

    const requestCount = await redisClient.incr(key);

    if (requestCount === 1) {
      await redisClient.expire(key, 60);
    }

    if (requestCount > 100) {
      return res.status(429).json({
        message: "Quá nhiều request, vui lòng thử lại sau",
      });
    }

    next();
  } catch (error) {
    console.error("Rate limiter failed:", error);

    // Redis lỗi không làm Gateway ngừng phục vụ
    next();
  }
};

// Authentication + JWT Validation
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (
    !authHeader ||
    !authHeader.startsWith("Bearer ")
  ) {
    return res.status(401).json({
      message: "Không có token xác thực",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    req.user = decoded;

    next();
  } catch (error) {
    return res.status(403).json({
      message: "Token không hợp lệ hoặc đã hết hạn",
    });
  }
};

// Authorization
// Form không quy định role nào có quyền trên API nào.
// Vì vậy Gateway kiểm tra tài khoản đã xác thực
// phải có roleid hợp lệ trước khi truy cập API nghiệp vụ.
const authorizeRole = (req, res, next) => {
  const roleid = Number(req.user?.roleid);

  if (!Number.isInteger(roleid) || roleid <= 0) {
    return res.status(403).json({
      message: "Không có quyền truy cập tài nguyên này",
    });
  }

  next();
};

// Redis Cache cho Product
const productCache = async (req, res, next) => {
  try {
    if (req.method !== "GET") {
      return next();
    }

    const cacheKey =
      `cache:product:${req.originalUrl}`;

    const cachedData =
      await redisClient.get(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        source: "redis-cache",
        data: JSON.parse(cachedData),
      });
    }

    req.productCacheKey = cacheKey;

    next();
  } catch (error) {
    console.error(
      "Product cache read failed:",
      error
    );

    next();
  }
};

// Health Check
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    service: "api-gateway",
  });
});

// Auth Service Proxy
const authProxy = createProxyMiddleware({
  target: process.env.AUTH_SERVICE_URL,
  changeOrigin: true,

  on: {
    proxyReq: fixRequestBody,
  },
});

// Customer Service Proxy
const customerProxy = createProxyMiddleware({
  target: process.env.CUSTOMER_SERVICE_URL,
  changeOrigin: true,

  pathRewrite: (path) => {
    return `/customers${path}`;
  },

  on: {
    proxyReq: fixRequestBody,
  },
});

// Product Service Proxy
const productProxy = createProxyMiddleware({
  target: process.env.PRODUCT_SERVICE_URL,
  changeOrigin: true,
  selfHandleResponse: true,

  pathRewrite: (path) => {
    return `/products${path}`;
  },

  on: {
    proxyReq: fixRequestBody,

    proxyRes: async (proxyRes, req, res) => {
      const bodyChunks = [];

      proxyRes.on("data", (chunk) => {
        bodyChunks.push(chunk);
      });

      proxyRes.on("end", async () => {
        const body = Buffer.concat(
          bodyChunks
        ).toString("utf8");

        res.status(
          proxyRes.statusCode || 200
        );

        const contentType =
          proxyRes.headers["content-type"];

        if (contentType) {
          res.setHeader(
            "content-type",
            contentType
          );
        }

        try {
          const parsedBody =
            JSON.parse(body);

          if (
            req.method === "GET" &&
            req.productCacheKey &&
            proxyRes.statusCode >= 200 &&
            proxyRes.statusCode < 300
          ) {
            await redisClient.setEx(
              req.productCacheKey,
              60,
              JSON.stringify(parsedBody)
            );
          }

          res.send(parsedBody);
        } catch (error) {
          res.send(body);
        }
      });
    },
  },
});

// Order Service Proxy
const orderProxy = createProxyMiddleware({
  target: process.env.ORDER_SERVICE_URL,
  changeOrigin: true,

  pathRewrite: (path) => {
    return `/orders${path}`;
  },

  on: {
    proxyReq: (
      proxyReq,
      req,
      res
    ) => {
      if (req.user?.uid) {
        proxyReq.setHeader(
          "x-user-id",
          String(req.user.uid)
        );
      }

      fixRequestBody(
        proxyReq,
        req,
        res
      );
    },
  },
});

// Shipment Service Proxy
const shipmentProxy =
  createProxyMiddleware({
    target:
      process.env.SHIPMENT_SERVICE_URL,
    changeOrigin: true,

    pathRewrite: (path) => {
      return `/shipments${path}`;
    },

    on: {
      proxyReq: fixRequestBody,
    },
  });

// Register/Login không yêu cầu JWT
app.use(
  "/api/auth",
  rateLimiter,
  authProxy
);

// Route kiểm tra Authentication
app.get(
  "/api/protected",
  rateLimiter,
  verifyToken,
  (req, res) => {
    res.status(200).json({
      message: "JWT hợp lệ",
      user: req.user,
    });
  }
);

// Customer:
// Authentication + Authorization
app.use(
  "/api/customers",
  rateLimiter,
  verifyToken,
  authorizeRole,
  customerProxy
);

// Product:
// Authentication + Authorization + Cache
app.use(
  "/api/products",
  rateLimiter,
  verifyToken,
  authorizeRole,
  productCache,
  productProxy
);

// Order:
// Authentication + Authorization
app.use(
  "/api/orders",
  rateLimiter,
  verifyToken,
  authorizeRole,
  orderProxy
);

// Shipment:
// Authentication + Authorization
app.use(
  "/api/shipments",
  rateLimiter,
  verifyToken,
  authorizeRole,
  shipmentProxy
);

// Kết nối Redis trước khi mở Gateway
const startServer = async () => {
  try {
    await redisClient.connect();

    console.log(
      "API Gateway connected to Redis successfully"
    );

    app.listen(PORT, () => {
      console.log(
        `API Gateway is running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "API Gateway could not connect to Redis:",
      error
    );

    process.exit(1);
  }
};

startServer();
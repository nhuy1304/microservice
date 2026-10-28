import express from "express";
import dotenv from "dotenv";
import grpc from "@grpc/grpc-js";
import pool from "./db.js";
import producer, { connectKafkaProducer } from "./kafka.js";
import {
  getCustomer,
  getProduct,
  decreaseStock,
} from "./grpcClients.js";
import { startOutboxPublisher } from "./outboxPublisher.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3003;

app.use(express.json());

// Đề yêu cầu discount dựa trên score,
// nhưng không cung cấp công thức chuyển đổi cụ thể.
// Hiện giữ cách triển khai MVP đã dùng trong bài.
const calculateDiscount = (score) => {
  const numericScore = Number(score);

  if (!Number.isFinite(numericScore) || numericScore < 0) {
    return 0;
  }

  return numericScore;
};

// Health check
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      status: "healthy",
      service: "order-service",
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(500).json({
      status: "unhealthy",
      service: "order-service",
      database: "disconnected",
    });
  }
});

// Tạo đơn hàng
app.post("/orders", async (req, res) => {
  const client = await pool.connect();

  try {
    const uid = Number(req.headers["x-user-id"]);
    const { items } = req.body;

    if (!Number.isInteger(uid) || uid <= 0) {
      return res.status(401).json({
        message: "Không xác định được người dùng",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "Danh sách sản phẩm không được để trống",
      });
    }

    // Lấy Customer + score bằng gRPC
    let customer;

    try {
      customer = await getCustomer(uid);
    } catch (error) {
      if (error.code === grpc.status.NOT_FOUND) {
        return res.status(404).json({
          message: "Không tìm thấy khách hàng",
        });
      }

      throw error;
    }

    const score = Number(customer.score ?? 0);
    const discount = calculateDiscount(score);

    const orderItems = [];

    // Kiểm tra Product và tồn kho bằng gRPC
    for (const item of items) {
      const pid = Number(item.pid);
      const qty = Number(item.qty);

      if (
        !Number.isInteger(pid) ||
        pid <= 0 ||
        !Number.isInteger(qty) ||
        qty <= 0
      ) {
        return res.status(400).json({
          message: "pid và qty phải là số nguyên lớn hơn 0",
        });
      }

      let product;

      try {
        product = await getProduct(pid);
      } catch (error) {
        if (error.code === grpc.status.NOT_FOUND) {
          return res.status(404).json({
            message: `Không tìm thấy sản phẩm pid=${pid}`,
          });
        }

        throw error;
      }

      if (Number(product.quantity) < qty) {
        return res.status(409).json({
          message: `Sản phẩm pid=${pid} không đủ số lượng tồn kho`,
        });
      }

      orderItems.push({
        pid,
        qty,
        unit_price: Number(product.price),
      });
    }

    await client.query("BEGIN");

    // Tạo Order
    const orderResult = await client.query(
      `INSERT INTO "Order" (uid, discount)
       VALUES ($1, $2)
       RETURNING oid, uid, discount`,
      [uid, discount]
    );

    const order = orderResult.rows[0];

    // Tạo OrderDetail
    for (const item of orderItems) {
      await client.query(
        `INSERT INTO "OrderDetail"
          (oid, pid, qty, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [
          order.oid,
          item.pid,
          item.qty,
          item.unit_price,
        ]
      );
    }

    // Trừ tồn kho Product bằng gRPC
    for (const item of orderItems) {
      try {
        await decreaseStock(item.pid, item.qty);
      } catch (error) {
        await client.query("ROLLBACK");

        if (
          error.code === grpc.status.FAILED_PRECONDITION
        ) {
          return res.status(409).json({
            message:
              `Sản phẩm pid=${item.pid} không tồn tại hoặc không đủ số lượng tồn kho`,
          });
        }

        if (error.code === grpc.status.NOT_FOUND) {
          return res.status(404).json({
            message:
              `Không tìm thấy sản phẩm pid=${item.pid}`,
          });
        }

        throw error;
      }
    }

    const orderCreatedEvent = {
      event: "OrderCreated",
      oid: Number(order.oid),
      uid: Number(order.uid),
      discount: Number(order.discount),
      items: orderItems,
    };

    // Order + OrderDetail + Outbox nằm trong cùng transaction
    const outboxResult = await client.query(
      `INSERT INTO "Outbox"
        (event_type, aggregate_id, payload, status)
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING id`,
      [
        "OrderCreated",
        order.oid,
        JSON.stringify(orderCreatedEvent),
        "PENDING",
      ]
    );

    const outboxId = outboxResult.rows[0].id;

    await client.query("COMMIT");

    // Thử publish ngay.
    // Nếu thất bại, Outbox Publisher sẽ retry PENDING.
    try {
      await producer.send({
        topic: "order-created",
        messages: [
          {
            key: String(order.oid),
            value: JSON.stringify(orderCreatedEvent),
          },
        ],
      });

      await pool.query(
        `UPDATE "Outbox"
         SET status = 'PUBLISHED'
         WHERE id = $1`,
        [outboxId]
      );

      console.log(
        `Published OrderCreated event for oid=${order.oid}`
      );
    } catch (kafkaError) {
      console.error(
        `Kafka publish failed for oid=${order.oid}:`,
        kafkaError.message
      );

      console.log(
        `Outbox id=${outboxId} remains PENDING for retry`
      );
    }

    res.status(201).json({
      message: "Tạo đơn hàng thành công",
      order: {
        ...order,
        items: orderItems,
      },
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error(
        "Rollback failed:",
        rollbackError.message
      );
    }

    console.error(
      "Create order failed:",
      error.message
    );

    res.status(500).json({
      message: "Không thể tạo đơn hàng",
    });
  } finally {
    client.release();
  }
});

// Lấy Order + OrderDetail
app.get("/orders/:oid", async (req, res) => {
  try {
    const { oid } = req.params;

    const orderResult = await pool.query(
      `SELECT oid, uid, discount
       FROM "Order"
       WHERE oid = $1`,
      [oid]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        message: "Không tìm thấy đơn hàng",
      });
    }

    const detailResult = await pool.query(
      `SELECT oid, pid, qty, unit_price
       FROM "OrderDetail"
       WHERE oid = $1
       ORDER BY pid`,
      [oid]
    );

    res.status(200).json({
      ...orderResult.rows[0],
      items: detailResult.rows,
    });
  } catch (error) {
    console.error("Get order failed:", error);

    res.status(500).json({
      message: "Không thể lấy thông tin đơn hàng",
    });
  }
});

// Test Product gRPC
app.get("/test-product/:pid", async (req, res) => {
  try {
    const pid = Number(req.params.pid);
    const product = await getProduct(pid);

    res.status(200).json({
      message:
        "Order Service kết nối Product Service bằng gRPC thành công",
      product,
    });
  } catch (error) {
    if (error.code === grpc.status.NOT_FOUND) {
      return res.status(404).json({
        message: "Không tìm thấy sản phẩm",
      });
    }

    console.error(
      "Test Product gRPC failed:",
      error.message
    );

    res.status(500).json({
      message:
        "Không thể kết nối Product Service bằng gRPC",
    });
  }
});

// Test Customer gRPC
app.get("/test-customer/:uid", async (req, res) => {
  try {
    const uid = Number(req.params.uid);
    const customer = await getCustomer(uid);

    res.status(200).json({
      message:
        "Order Service kết nối Customer Service bằng gRPC thành công",
      customer,
    });
  } catch (error) {
    if (error.code === grpc.status.NOT_FOUND) {
      return res.status(404).json({
        message: "Không tìm thấy khách hàng",
      });
    }

    console.error(
      "Test Customer gRPC failed:",
      error.message
    );

    res.status(500).json({
      message:
        "Không thể kết nối Customer Service bằng gRPC",
    });
  }
});

// Test discount
app.get("/test-discount/:score", (req, res) => {
  const score = Number(req.params.score);
  const discount = calculateDiscount(score);

  res.status(200).json({
    score,
    discount,
  });
});

const startServer = async () => {
  try {
    await connectKafkaProducer();

    // Bắt đầu tiến trình retry Outbox
    startOutboxPublisher();

    app.listen(PORT, () => {
      console.log(
        `Order Service is running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "Order Service could not start:",
      error
    );

    process.exit(1);
  }
};

startServer();
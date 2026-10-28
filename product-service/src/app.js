import { startGrpcServer } from "./grpcServer.js";
import express from "express";
import dotenv from "dotenv";
import pool from "./db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3004;

app.use(express.json());

// Health check Product Service + PostgreSQL
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      status: "healthy",
      service: "product-service",
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(500).json({
      status: "unhealthy",
      service: "product-service",
      database: "disconnected",
    });
  }
});

// Lấy danh sách sản phẩm
app.get("/products", async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT pid, pname, price, quantity FROM "Product" ORDER BY pid'
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Get products failed:", error);

    res.status(500).json({
      message: "Không thể lấy danh sách sản phẩm",
    });
  }
});

// Lấy thông tin một sản phẩm theo pid
app.get("/products/:pid", async (req, res) => {
  try {
    const { pid } = req.params;

    const result = await pool.query(
      'SELECT pid, pname, price, quantity FROM "Product" WHERE pid = $1',
      [pid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Không tìm thấy sản phẩm",
      });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Get product failed:", error);

    res.status(500).json({
      message: "Không thể lấy thông tin sản phẩm",
    });
  }
});

// Trừ số lượng tồn kho khi đặt hàng
app.patch("/products/:pid/stock", async (req, res) => {
  try {
    const { pid } = req.params;
    const { quantity } = req.body;

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({
        message: "Số lượng phải là số nguyên lớn hơn 0",
      });
    }

    const result = await pool.query(
      `UPDATE "Product"
       SET quantity = quantity - $1
       WHERE pid = $2
         AND quantity >= $1
       RETURNING pid, pname, price, quantity`,
      [quantity, pid]
    );

    if (result.rows.length === 0) {
      const product = await pool.query(
        'SELECT pid FROM "Product" WHERE pid = $1',
        [pid]
      );

      if (product.rows.length === 0) {
        return res.status(404).json({
          message: "Không tìm thấy sản phẩm",
        });
      }

      return res.status(409).json({
        message: "Số lượng tồn kho không đủ",
      });
    }

    res.status(200).json({
      message: "Cập nhật tồn kho thành công",
      product: result.rows[0],
    });
  } catch (error) {
    console.error("Update stock failed:", error);

    res.status(500).json({
      message: "Không thể cập nhật tồn kho",
    });
  }
});

startGrpcServer();

app.listen(PORT, () => {
  console.log(`Product Service is running on port ${PORT}`);
});
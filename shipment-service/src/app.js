import express from "express";
import dotenv from "dotenv";
import pool from "./db.js";
import { connectKafkaConsumer } from "./kafka.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3005;

app.use(express.json());

// Health check Shipment Service + PostgreSQL
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      status: "healthy",
      service: "shipment-service",
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(500).json({
      status: "unhealthy",
      service: "shipment-service",
      database: "disconnected",
    });
  }
});

// Tạo Shipment mới
app.post("/shipments", async (req, res) => {
  try {
    const { oid } = req.body;

    if (!Number.isInteger(oid) || oid <= 0) {
      return res.status(400).json({
        message: "oid phải là số nguyên lớn hơn 0",
      });
    }

    const result = await pool.query(
      `INSERT INTO "Shipment" (oid, status)
       VALUES ($1, $2)
       RETURNING shipid, oid, status`,
      [oid, "PENDING"]
    );

    res.status(201).json({
      message: "Tạo Shipment thành công",
      shipment: result.rows[0],
    });
  } catch (error) {
    console.error("Create shipment failed:", error);

    res.status(500).json({
      message: "Không thể tạo Shipment",
    });
  }
});

// Lấy Shipment theo oid
app.get("/shipments/order/:oid", async (req, res) => {
  try {
    const { oid } = req.params;

    const result = await pool.query(
      `SELECT shipid, oid, status
       FROM "Shipment"
       WHERE oid = $1
       ORDER BY shipid DESC
       LIMIT 1`,
      [oid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Không tìm thấy Shipment",
      });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Get shipment failed:", error);

    res.status(500).json({
      message: "Không thể lấy thông tin Shipment",
    });
  }
});

// Cập nhật trạng thái Shipment
app.patch("/shipments/:shipid/status", async (req, res) => {
  try {
    const shipid = Number(req.params.shipid);
    const { status } = req.body;

    if (!Number.isInteger(shipid) || shipid <= 0) {
      return res.status(400).json({
        message: "shipid không hợp lệ",
      });
    }

    if (
      typeof status !== "string" ||
      status.trim().length === 0
    ) {
      return res.status(400).json({
        message: "status không được để trống",
      });
    }

    const result = await pool.query(
      `UPDATE "Shipment"
       SET status = $1
       WHERE shipid = $2
       RETURNING shipid, oid, status`,
      [status.trim(), shipid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Không tìm thấy Shipment",
      });
    }

    res.status(200).json({
      message: "Cập nhật trạng thái Shipment thành công",
      shipment: result.rows[0],
    });
  } catch (error) {
    console.error("Update shipment status failed:", error);

    res.status(500).json({
      message: "Không thể cập nhật trạng thái Shipment",
    });
  }
});

// Xử lý OrderCreated từ Kafka
const handleOrderCreated = async (event) => {
  const oid = Number(event.oid);

  if (!Number.isInteger(oid) || oid <= 0) {
    console.error("OrderCreated có oid không hợp lệ");
    return;
  }

  // Tránh tạo Shipment trùng khi Kafka gửi lại event
  const existingShipment = await pool.query(
    `SELECT shipid
     FROM "Shipment"
     WHERE oid = $1
     LIMIT 1`,
    [oid]
  );

  if (existingShipment.rows.length > 0) {
    console.log(
      `Shipment for oid=${oid} already exists`
    );

    return;
  }

  const result = await pool.query(
    `INSERT INTO "Shipment" (oid, status)
     VALUES ($1, $2)
     RETURNING shipid, oid, status`,
    [oid, "PENDING"]
  );

  console.log(
    `Created Shipment for oid=${oid} with status=${result.rows[0].status}`
  );
};

// Khởi động Shipment Service
const startServer = async () => {
  try {
    await connectKafkaConsumer(handleOrderCreated);

    app.listen(PORT, () => {
      console.log(
        `Shipment Service is running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "Shipment Service could not start:",
      error
    );

    process.exit(1);
  }
};

startServer();
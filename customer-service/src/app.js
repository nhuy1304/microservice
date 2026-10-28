import express from "express";
import dotenv from "dotenv";
import pool from "./db.js";
import { startGrpcServer } from "./grpcServer.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

// Health check Customer Service + PostgreSQL
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      status: "healthy",
      service: "customer-service",
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(500).json({
      status: "unhealthy",
      service: "customer-service",
      database: "disconnected",
    });
  }
});

// Lấy danh sách khách hàng + Membership + score
app.get("/customers", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.uid,
        c.fullname,
        c.mid,
        m.mname,
        m.score
      FROM "Customer" c
      JOIN "MemberShip" m
        ON c.mid = m.mid
      ORDER BY c.uid
    `);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Get customers failed:", error);

    res.status(500).json({
      message: "Không thể lấy danh sách khách hàng",
    });
  }
});

// Lấy một khách hàng + Membership + score
app.get("/customers/:uid", async (req, res) => {
  try {
    const uid = Number(req.params.uid);

    if (!Number.isInteger(uid) || uid <= 0) {
      return res.status(400).json({
        message: "uid không hợp lệ",
      });
    }

    const result = await pool.query(
      `
      SELECT
        c.uid,
        c.fullname,
        c.mid,
        m.mname,
        m.score
      FROM "Customer" c
      JOIN "MemberShip" m
        ON c.mid = m.mid
      WHERE c.uid = $1
      `,
      [uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Không tìm thấy khách hàng",
      });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Get customer failed:", error);

    res.status(500).json({
      message: "Không thể lấy thông tin khách hàng",
    });
  }
});

// Lấy danh sách hạng thành viên + score
app.get("/memberships", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT mid, mname, score
      FROM "MemberShip"
      ORDER BY mid
    `);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Get memberships failed:", error);

    res.status(500).json({
      message: "Không thể lấy danh sách hạng thành viên",
    });
  }
});

// Khởi động gRPC server
startGrpcServer();

// Khởi động REST server
app.listen(PORT, () => {
  console.log(`Customer Service is running on port ${PORT}`);
});
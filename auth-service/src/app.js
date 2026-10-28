import express from "express";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "./db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Health check Auth Service + PostgreSQL
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      status: "healthy",
      service: "auth-service",
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(500).json({
      status: "unhealthy",
      service: "auth-service",
      database: "disconnected",
    });
  }
});

// Đăng ký tài khoản
app.post("/register", async (req, res) => {
  try {
    const { username, password, roleid } = req.body;

    if (!username || !password || !Number.isInteger(roleid)) {
      return res.status(400).json({
        message: "username, password và roleid là bắt buộc",
      });
    }

    const existingUser = await pool.query(
      'SELECT uid FROM "User" WHERE username = $1',
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        message: "Username đã tồn tại",
      });
    }

    const role = await pool.query(
      'SELECT roleid FROM "Role" WHERE roleid = $1',
      [roleid]
    );

    if (role.rows.length === 0) {
      return res.status(400).json({
        message: "Role không tồn tại",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO "User" (username, password, roleid)
       VALUES ($1, $2, $3)
       RETURNING uid, username, roleid`,
      [username, hashedPassword, roleid]
    );

    res.status(201).json({
      message: "Đăng ký thành công",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Register error:", error);

    res.status(500).json({
      message: "Không thể đăng ký tài khoản",
    });
  }
});

// Đăng nhập và cấp JWT
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        message: "username và password là bắt buộc",
      });
    }

    const result = await pool.query(
      'SELECT uid, username, password, roleid FROM "User" WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "Sai username hoặc password",
      });
    }

    const user = result.rows[0];

    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Sai username hoặc password",
      });
    }

    const token = jwt.sign(
      {
        uid: user.uid,
        username: user.username,
        roleid: user.roleid,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "1d",
      }
    );

    res.status(200).json({
      message: "Đăng nhập thành công",
      token,
      user: {
        uid: user.uid,
        username: user.username,
        roleid: user.roleid,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      message: "Không thể đăng nhập",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Auth Service is running on port ${PORT}`);
});
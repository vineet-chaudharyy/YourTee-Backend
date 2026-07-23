import { jwtVerify } from "jose";

import { getConnection, sql } from "../db/index.js";

const AUTH_COOKIE = "yt_token";

function getSecretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured in the environment.");
  }
  return new TextEncoder().encode(secret);
}

export async function authMiddleware(req, res, next) {
  const token = req.cookies?.[AUTH_COOKIE] || req.headers.authorization?.replace(/^Bearer\s+/, "");
  
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    
    // Verify user exists in SQL Server Users table to prevent FK constraint conflicts on stale tokens
    const pool = await getConnection();
    const result = await pool.request()
      .input("id", sql.VarChar(36), payload.sub)
      .query("SELECT id, name, email, role FROM Users WHERE id = @id");

    if (result.recordset.length === 0) {
      req.user = null;
    } else {
      const u = result.recordset[0];
      req.user = {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role || "user",
      };
    }
  } catch (err) {
    req.user = null;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

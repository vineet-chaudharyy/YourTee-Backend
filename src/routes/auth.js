import { Router } from "express";
import { getConnection, sql } from "../db/index.js";
import { SignJWT } from "jose";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { sendVerificationEmail } from "../utils/email.js";

const router = Router();
const AUTH_COOKIE = "yt_token";
const TOKEN_TTL = "7d";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days in milliseconds

function getSecretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured in the environment.");
  }
  return new TextEncoder().encode(secret);
}

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z
    .string()
    .min(8)
    .max(100)
    .regex(/[A-Za-z]/)
    .regex(/[0-9]/),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

async function signAuthToken(payload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .setSubject(payload.sub)
    .sign(getSecretKey());
}

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: MAX_AGE_MS,
};

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const { name, email, password } = parsed.data;

  try {
    const pool = await getConnection();
    
    const checkResult = await pool.request()
      .input("email", sql.NVarChar(255), email)
      .query("SELECT id FROM Users WHERE email = @email");
      
    if (checkResult.recordset.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = crypto.randomUUID();
    const verificationToken = crypto.randomBytes(32).toString("hex");

    await pool.request()
      .input("id", sql.VarChar(36), userId)
      .input("name", sql.NVarChar(80), name)
      .input("email", sql.NVarChar(255), email)
      .input("passwordHash", sql.VarChar(255), passwordHash)
      .input("role", sql.VarChar(20), "user")
      .input("verificationToken", sql.VarChar(100), verificationToken)
      .query(`
        INSERT INTO Users (id, name, email, passwordHash, role, isVerified, verificationToken, createdAt, updatedAt)
        VALUES (@id, @name, @email, @passwordHash, @role, 0, @verificationToken, GETDATE(), GETDATE())
      `);

    // Dispatch verification email (or log to terminal in local development mode)
    await sendVerificationEmail(email, name, verificationToken);

    return res.status(201).json({
      success: true,
      message: "Registration successful! Please verify your email address via the link sent to your inbox."
    });
  } catch (err) {
    console.error("Register Error:", err.message);
    return res.status(500).json({ error: "Server error during registration." });
  }
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const { email, password } = parsed.data;

  try {
    const pool = await getConnection();
    
    const userResult = await pool.request()
      .input("email", sql.NVarChar(255), email)
      .query("SELECT id, name, email, passwordHash, role, isVerified FROM Users WHERE email = @email");

    const user = userResult.recordset[0];
    const dummyHash = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO000000000000000000000000000000";
    let ok = false;

    if (user) {
      ok = await bcrypt.compare(password, user.passwordHash);
    } else {
      await bcrypt.compare(password, dummyHash);
    }

    if (!user || !ok) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (!user.isVerified) {
      return res.status(403).json({ error: "Please verify your email address before logging in. A verification link was sent to your inbox." });
    }

    const token = await signAuthToken({
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });

    res.cookie(AUTH_COOKIE, token, cookieOptions);
    return res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("Login Error:", err.message);
    return res.status(500).json({ error: "Server error during login." });
  }
});

const googleSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
});

// POST /api/auth/google - Mock Google Login / Register
router.post("/google", async (req, res) => {
  const parsed = googleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const { name, email } = parsed.data;

  try {
    const pool = await getConnection();
    
    // Check if user already exists
    let userResult = await pool.request()
      .input("email", sql.NVarChar(255), email)
      .query("SELECT id, name, email, role FROM Users WHERE email = @email");
      
    let user = userResult.recordset[0];
    let userId;

    if (!user) {
      // Create user
      userId = crypto.randomUUID();
      const dummyPasswordHash = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 12);
      await pool.request()
        .input("id", sql.VarChar(36), userId)
        .input("name", sql.NVarChar(80), name)
        .input("email", sql.NVarChar(255), email)
        .input("passwordHash", sql.VarChar(255), dummyPasswordHash)
        .input("role", sql.VarChar(20), "user")
        .query(`
          INSERT INTO Users (id, name, email, passwordHash, role, isVerified, verificationToken, createdAt, updatedAt)
          VALUES (@id, @name, @email, @passwordHash, @role, 1, NULL, GETDATE(), GETDATE())
        `);
      
      user = { id: userId, name, email, role: "user" };
    } else {
      userId = user.id;
    }

    const token = await signAuthToken({
      sub: userId,
      name: user.name,
      email: user.email,
      role: user.role,
    });

    res.cookie(AUTH_COOKIE, token, cookieOptions);
    return res.status(200).json({
      user: { id: userId, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("Google Auth Error:", err.message);
    return res.status(500).json({ error: "Server error during Google auth." });
  }
});

router.post("/logout", (req, res) => {
  res.cookie(AUTH_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res.json({ ok: true });
});

router.get("/me", (req, res) => {
  if (!req.user) {
    return res.json({ user: null });
  }
  return res.json({ user: req.user });
});

// GET /api/auth/verify-email
router.get("/verify-email", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send("<h1>Verification token is missing.</h1>");
  }

  try {
    const pool = await getConnection();
    const userResult = await pool.request()
      .input("token", sql.VarChar(100), token)
      .query("SELECT id FROM Users WHERE verificationToken = @token");

    const user = userResult.recordset[0];
    if (!user) {
      return res.status(400).send("<h1>Invalid or expired verification link.</h1>");
    }

    await pool.request()
      .input("id", sql.VarChar(36), user.id)
      .query("UPDATE Users SET isVerified = 1, verificationToken = NULL WHERE id = @id");

    // Redirect to frontend login page with a verified=true flag
    return res.redirect("http://localhost:3007/login?verified=true");
  } catch (err) {
    console.error("Verify Email Error:", err.message);
    return res.status(500).send("<h1>Server error during email verification.</h1>");
  }
});

export default router;

import { Router } from "express";
import { getConnection, sql } from "../db/index.js";
import { SignJWT } from "jose";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { sendVerificationEmail, sendPasswordResetEmail } from "../utils/email.js";

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

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

const RESET_TTL_MINUTES = 60; // reset links are valid for 1 hour

const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");

const forgotSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

const resetSchema = z.object({
  token: z.string().trim().min(32),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100)
    .regex(/[A-Za-z]/, "Include a letter")
    .regex(/[0-9]/, "Include a number"),
});

// POST /api/auth/forgot-password
// Always answers 200 with the same message — revealing whether an address is
// registered would turn this into an account-enumeration oracle.
router.post("/forgot-password", async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  const { email } = parsed.data;
  const genericResponse = {
    success: true,
    message: "If an account exists for that address, we've sent a reset link.",
  };

  try {
    const pool = await getConnection();
    const result = await pool.request()
      .input("email", sql.NVarChar(255), email)
      .query("SELECT id, name FROM Users WHERE email = @email");

    const user = result.recordset[0];
    if (!user) return res.json(genericResponse);

    const token = crypto.randomBytes(32).toString("hex");

    // Expiry is computed AND compared entirely in SQL against GETUTCDATE().
    // Round-tripping a JS Date through DATETIME is not safe here: the driver
    // returns the stored local time tagged as UTC, which on an IST server made
    // already-expired tokens read as valid for another 5.5 hours.
    await pool.request()
      .input("id", sql.VarChar(36), user.id)
      .input("hash", sql.VarChar(64), hashToken(token))
      .input("ttlMinutes", sql.Int, RESET_TTL_MINUTES)
      .query(`
        UPDATE Users
        SET resetTokenHash = @hash,
            resetTokenExpires = DATEADD(minute, @ttlMinutes, GETUTCDATE())
        WHERE id = @id
      `);

    await sendPasswordResetEmail(email, user.name, token);
    return res.json(genericResponse);
  } catch (err) {
    console.error("Forgot Password Error:", err.message);
    return res.status(500).json({ error: "Server error requesting a password reset." });
  }
});

// POST /api/auth/reset-password
router.post("/reset-password", async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const { token, password } = parsed.data;

  try {
    const pool = await getConnection();
    // Expiry is checked in SQL (see the note in /forgot-password) so the match
    // never depends on how the driver interprets DATETIME timezones.
    const result = await pool.request()
      .input("hash", sql.VarChar(64), hashToken(token))
      .query(`
        SELECT id FROM Users
        WHERE resetTokenHash = @hash
          AND resetTokenExpires IS NOT NULL
          AND resetTokenExpires > GETUTCDATE()
      `);

    const user = result.recordset[0];
    if (!user) {
      return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Clearing the token makes the link single-use. A successful reset also
    // proves control of the inbox, so verify the account at the same time —
    // otherwise an unverified user could reset and still be unable to log in.
    await pool.request()
      .input("id", sql.VarChar(36), user.id)
      .input("passwordHash", sql.VarChar(255), passwordHash)
      .query(`
        UPDATE Users
        SET passwordHash = @passwordHash,
            resetTokenHash = NULL,
            resetTokenExpires = NULL,
            isVerified = 1,
            verificationToken = NULL,
            updatedAt = GETDATE()
        WHERE id = @id
      `);

    return res.json({ success: true, message: "Your password has been updated. You can now sign in." });
  } catch (err) {
    console.error("Reset Password Error:", err.message);
    return res.status(500).json({ error: "Server error resetting your password." });
  }
});

export default router;

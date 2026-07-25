import { Router } from "express";
import { getConnection, sql } from "../db/index.js";
import { requireAdmin } from "../middleware/auth.js";
import crypto from "crypto";
import { z } from "zod";

const router = Router();
// Admin-facing message routes are mounted under /api/admin (see server.js)
const adminRouter = Router();

const contactSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: z.string().trim().toLowerCase().email("Please enter a valid email address"),
  subject: z.string().trim().min(2, "Subject must be at least 2 characters"),
  message: z.string().trim().min(10, "Message must be at least 10 characters"),
});

// POST /api/contact - Submit a contact message (Public)
router.post("/", async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { name, email, subject, message } = parsed.data;
  const id = crypto.randomUUID();

  try {
    const pool = await getConnection();
    await pool.request()
      .input("id", sql.VarChar(36), id)
      .input("name", sql.NVarChar(120), name)
      .input("email", sql.NVarChar(255), email)
      .input("subject", sql.NVarChar(255), subject)
      .input("message", sql.NVarChar(sql.MAX), message)
      .query(`
        INSERT INTO ContactMessages (id, name, email, subject, message, createdAt)
        VALUES (@id, @name, @email, @subject, @message, GETDATE())
      `);

    return res.status(201).json({ success: true, message: "Your message has been received." });
  } catch (err) {
    console.error("Submit Contact Message Error:", err.message);
    return res.status(500).json({ error: "Server error saving message." });
  }
});

// GET /api/admin/contact-messages - Retrieve all messages (Admin only)
adminRouter.get("/contact-messages", requireAdmin, async (req, res) => {
  try {
    const pool = await getConnection();
    const result = await pool.request().query("SELECT * FROM ContactMessages ORDER BY createdAt DESC");
    return res.json({ messages: result.recordset });
  } catch (err) {
    console.error("Retrieve Contact Messages Error:", err.message);
    return res.status(500).json({ error: "Server error retrieving messages." });
  }
});

// DELETE /api/admin/contact-messages/:id - Delete a message (Admin only)
adminRouter.delete("/contact-messages/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await getConnection();
    const result = await pool.request()
      .input("id", sql.VarChar(36), id)
      .query("DELETE FROM ContactMessages WHERE id = @id");

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Message not found." });
    }

    return res.json({ success: true, message: "Message deleted successfully." });
  } catch (err) {
    console.error("Delete Contact Message Error:", err.message);
    return res.status(500).json({ error: "Server error deleting message." });
  }
});

export { adminRouter as contactAdminRouter };
export default router;

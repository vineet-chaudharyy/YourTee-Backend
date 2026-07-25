import { Router } from "express";
import { getConnection, sql } from "../db/index.js";
import { requireAdmin } from "../middleware/auth.js";
import crypto from "crypto";
import { z } from "zod";

const router = Router();

const reviewSchema = z.object({
  productId: z.string().trim().min(1),
  name: z.string().trim().min(2, "Please enter your name").max(120),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().min(5, "Please write at least a few words").max(2000),
});

// GET /api/reviews?productId=p8 — public
router.get("/", async (req, res) => {
  const { productId } = req.query;
  if (!productId) {
    return res.status(400).json({ error: "productId is required." });
  }

  try {
    const pool = await getConnection();
    const result = await pool.request()
      .input("productId", sql.VarChar(36), String(productId))
      .query(`
        SELECT r.id, r.name, r.rating, r.comment, r.createdAt,
               CASE WHEN EXISTS (
                 SELECT 1 FROM Orders o
                 JOIN OrderItems oi ON oi.orderId = o.id
                 WHERE o.userId = r.userId AND oi.productId = r.productId
               ) THEN 1 ELSE 0 END AS verifiedBuyer
        FROM Reviews r
        WHERE r.productId = @productId
        ORDER BY r.createdAt DESC
      `);

    const reviews = result.recordset.map((r) => ({
      id: r.id,
      name: r.name,
      rating: Number(r.rating),
      comment: r.comment,
      createdAt: r.createdAt,
      // Only true when the reviewer's account actually ordered this product.
      verifiedBuyer: Boolean(r.verifiedBuyer),
    }));

    const average = reviews.length
      ? Number((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(2))
      : 0;

    return res.json({ reviews, count: reviews.length, average });
  } catch (err) {
    console.error("Fetch Reviews Error:", err.message);
    return res.status(500).json({ error: "Server error loading reviews." });
  }
});

// POST /api/reviews — open to guests, but a signed-in user is recorded.
router.post("/", async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const { productId, name, rating, comment } = parsed.data;

  try {
    const pool = await getConnection();

    // Don't accept reviews for products that don't exist.
    const prod = await pool.request()
      .input("productId", sql.VarChar(36), productId)
      .query("SELECT id FROM Products WHERE id = @productId");
    if (prod.recordset.length === 0) {
      return res.status(404).json({ error: "Product not found." });
    }

    const id = crypto.randomUUID();
    await pool.request()
      .input("id", sql.VarChar(36), id)
      .input("productId", sql.VarChar(36), productId)
      .input("userId", sql.VarChar(36), req.user?.id ?? null)
      .input("name", sql.NVarChar(120), name)
      .input("rating", sql.Int, rating)
      .input("comment", sql.NVarChar(2000), comment)
      .query(`
        INSERT INTO Reviews (id, productId, userId, name, rating, comment, createdAt)
        VALUES (@id, @productId, @userId, @name, @rating, @comment, GETDATE())
      `);

    return res.status(201).json({
      success: true,
      review: { id, name, rating, comment, createdAt: new Date().toISOString() },
    });
  } catch (err) {
    console.error("Create Review Error:", err.message);
    return res.status(500).json({ error: "Server error saving your review." });
  }
});

// DELETE /api/reviews/:id — moderation
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const pool = await getConnection();
    const result = await pool.request()
      .input("id", sql.VarChar(36), req.params.id)
      .query("DELETE FROM Reviews WHERE id = @id");

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Review not found." });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("Delete Review Error:", err.message);
    return res.status(500).json({ error: "Server error deleting the review." });
  }
});

export default router;

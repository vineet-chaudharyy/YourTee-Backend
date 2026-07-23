import { Router } from "express";
import { getConnection, sql } from "../db/index.js";
import { requireAdmin } from "../middleware/auth.js";
import crypto from "crypto";

const router = Router();

// GET /api/hero - Get all slides ordered by sortOrder
router.get("/", async (req, res) => {
  try {
    const pool = await getConnection();
    const result = await pool.request().query("SELECT * FROM HeroSlides ORDER BY sortOrder ASC");
    return res.json({ slides: result.recordset });
  } catch (err) {
    console.error("Get Hero Slides Error:", err.message);
    return res.status(500).json({ error: "Server error fetching hero slides." });
  }
});

// POST /api/hero - Add a slide (Admin only)
router.post("/", requireAdmin, async (req, res) => {
  const { eyebrow, title, description, image, link, glow, watermark, coord, sortOrder } = req.body;
  if (!eyebrow || !title || !description || !image || !watermark || !coord) {
    return res.status(400).json({ error: "Missing required hero fields." });
  }
  const id = crypto.randomUUID();

  try {
    const pool = await getConnection();
    await pool.request()
      .input("id", sql.VarChar(36), id)
      .input("eyebrow", sql.NVarChar(255), eyebrow)
      .input("title", sql.NVarChar(255), title)
      .input("description", sql.NVarChar(1000), description)
      .input("image", sql.VarChar(1000), image)
      .input("link", sql.VarChar(255), link || "/shop")
      .input("glow", sql.VarChar(100), glow || "rgba(212,175,55,0.15)")
      .input("watermark", sql.VarChar(100), watermark)
      .input("coord", sql.VarChar(100), coord)
      .input("sortOrder", sql.Int, sortOrder || 0)
      .query(`
        INSERT INTO HeroSlides (id, eyebrow, title, description, image, link, glow, watermark, coord, sortOrder)
        VALUES (@id, @eyebrow, @title, @description, @image, @link, @glow, @watermark, @coord, @sortOrder)
      `);
    return res.status(201).json({ success: true, id });
  } catch (err) {
    console.error("Create Hero Slide Error:", err.message);
    return res.status(500).json({ error: "Server error creating hero slide." });
  }
});

// PUT /api/hero/:id - Edit a slide (Admin only)
router.put("/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { eyebrow, title, description, image, link, glow, watermark, coord, sortOrder } = req.body;

  try {
    const pool = await getConnection();
    await pool.request()
      .input("id", sql.VarChar(36), id)
      .input("eyebrow", sql.NVarChar(255), eyebrow)
      .input("title", sql.NVarChar(255), title)
      .input("description", sql.NVarChar(1000), description)
      .input("image", sql.VarChar(1000), image)
      .input("link", sql.VarChar(255), link || "/shop")
      .input("glow", sql.VarChar(100), glow || "rgba(212,175,55,0.15)")
      .input("watermark", sql.VarChar(100), watermark)
      .input("coord", sql.VarChar(100), coord)
      .input("sortOrder", sql.Int, sortOrder || 0)
      .query(`
        UPDATE HeroSlides
        SET eyebrow = @eyebrow, title = @title, description = @description, image = @image,
            link = @link, glow = @glow, watermark = @watermark, coord = @coord, sortOrder = @sortOrder,
            updatedAt = GETDATE()
        WHERE id = @id
      `);
    return res.json({ success: true });
  } catch (err) {
    console.error("Update Hero Slide Error:", err.message);
    return res.status(500).json({ error: "Server error updating hero slide." });
  }
});

// DELETE /api/hero/:id - Delete a slide (Admin only)
router.delete("/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await getConnection();
    await pool.request()
      .input("id", sql.VarChar(36), id)
      .query("DELETE FROM HeroSlides WHERE id = @id");
    return res.json({ success: true });
  } catch (err) {
    console.error("Delete Hero Slide Error:", err.message);
    return res.status(500).json({ error: "Server error deleting hero slide." });
  }
});

export default router;

import { Router } from "express";
import { getConnection, sql } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { z } from "zod";
import crypto from "crypto";

const router = Router();

const saveSchema = z.object({
  name: z.string().trim().min(1).max(120),
  garment: z.string().max(60).optional().default("Custom Tee"),
  color: z.string().max(60).optional().default("Onyx"),
  fabric: z.string().max(60).optional().default("Heavyweight 280 GSM"),
  price: z.number().nonnegative().optional().default(1499),
  layers: z.array(z.any()).max(100).optional().default([]),
  preview: z.string().max(2500000).optional().default(""),
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const pool = await getConnection();
    const result = await pool.request()
      .input("userId", sql.VarChar(36), req.user.id)
      .query("SELECT id, name, garment, color, fabric, price, preview, layers, updatedAt FROM Designs WHERE userId = @userId ORDER BY updatedAt DESC");

    const designs = result.recordset.map((d) => {
      let layersParsed = [];
      if (d.layers) {
        try {
          layersParsed = JSON.parse(d.layers);
        } catch {
          layersParsed = [];
        }
      }
      return {
        id: d.id,
        name: d.name,
        garment: d.garment,
        color: d.color,
        fabric: d.fabric,
        price: Number(d.price),
        preview: d.preview || null,
        layers: layersParsed,
        updatedAt: d.updatedAt,
      };
    });

    return res.json({ designs });
  } catch (err) {
    console.error("Fetch Designs Error:", err.message);
    return res.status(500).json({ error: "Server error fetching designs." });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { name, garment, color, fabric, price, layers, preview } = parsed.data;
  const designId = crypto.randomUUID();
  const layersStr = JSON.stringify(layers);

  try {
    const pool = await getConnection();
    await pool.request()
      .input("id", sql.VarChar(36), designId)
      .input("userId", sql.VarChar(36), req.user.id)
      .input("name", sql.NVarChar(120), name)
      .input("garment", sql.NVarChar(60), garment)
      .input("color", sql.NVarChar(60), color)
      .input("fabric", sql.NVarChar(60), fabric)
      .input("price", sql.Decimal(10, 2), price)
      .input("layers", sql.NVarChar(sql.MAX), layersStr)
      .input("preview", sql.NVarChar(sql.MAX), preview)
      .query(`
        INSERT INTO Designs (id, userId, name, garment, color, fabric, price, layers, preview, createdAt, updatedAt)
        VALUES (@id, @userId, @name, @garment, @color, @fabric, @price, @layers, @preview, GETDATE(), GETDATE())
      `);

    return res.status(201).json({ id: designId });
  } catch (err) {
    console.error("Save Design Error:", err.message);
    return res.status(500).json({ error: "Server error saving design." });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await getConnection();
    const result = await pool.request()
      .input("id", sql.VarChar(36), id)
      .input("userId", sql.VarChar(36), req.user.id)
      .query("DELETE FROM Designs WHERE id = @id AND userId = @userId");

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Delete Design Error:", err.message);
    return res.status(500).json({ error: "Server error deleting design." });
  }
});

export default router;

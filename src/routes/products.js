import { Router } from "express";
import { getConnection, sql } from "../db/index.js";
import { requireAdmin } from "../middleware/auth.js";
import { z } from "zod";
import crypto from "crypto";

const router = Router();

const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  collection: z.string().trim().min(1).max(60),
  price: z.number().nonnegative(),
  originalPrice: z.number().nonnegative().nullable().optional(),
  description: z.string().trim().min(1),
  fabric: z.string().trim().min(1).max(120),
  gsm: z.number().int().positive(),
  colors: z.array(z.object({ name: z.string(), hex: z.string() })).min(1),
  sizes: z.array(z.string()).min(1),
  image: z.string().url(),
  gallery: z.array(z.string().url()).min(1),
  tag: z.string().max(60).nullable().optional().default(null),
  stock: z.number().int().nonnegative().optional().default(50),
  variantStock: z.record(z.string(), z.number().int().nonnegative()).optional().default({}),
});

// GET /api/products - Get all products
router.get("/", async (req, res) => {
  try {
    const pool = await getConnection();
    const result = await pool.request().query("SELECT * FROM Products ORDER BY createdAt DESC");
    
    const products = result.recordset.map((p) => {
      let colorsParsed = [];
      let sizesParsed = [];
      let galleryParsed = [];
      try {
        colorsParsed = JSON.parse(p.colors);
      } catch {
        colorsParsed = [];
      }
      try {
        sizesParsed = JSON.parse(p.sizes);
      } catch {
        sizesParsed = [];
      }
      try {
        galleryParsed = JSON.parse(p.gallery);
      } catch {
        galleryParsed = [];
      }
      
      let variantStockParsed = {};
      if (p.variantStock) {
        try {
          variantStockParsed = JSON.parse(p.variantStock);
        } catch {
          variantStockParsed = {};
        }
      }
      
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        collection: p.collection,
        price: Number(p.price),
        originalPrice: p.originalPrice ? Number(p.originalPrice) : null,
        description: p.description,
        fabric: p.fabric,
        gsm: p.gsm,
        colors: colorsParsed,
        sizes: sizesParsed,
        image: p.image,
        gallery: galleryParsed,
        tag: p.tag || null,
        stock: p.stock !== undefined && p.stock !== null ? Number(p.stock) : 50,
        variantStock: variantStockParsed,
        createdAt: p.createdAt,
      };
    });

    return res.json({ products });
  } catch (err) {
    console.error("Get Products Error:", err.message);
    return res.status(500).json({ error: "Server error fetching products." });
  }
});

// POST /api/products - Create a new product (Admin only)
router.post("/", requireAdmin, async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { name, collection, price, originalPrice, description, fabric, gsm, colors, sizes, image, gallery, tag, stock, variantStock } = parsed.data;
  
  const id = crypto.randomUUID();
  // Generate slug
  let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  // Append random string to slug to prevent duplicate slug errors
  slug = `${slug}-${Math.random().toString(36).substring(2, 6)}`;
  
  const colorsStr = JSON.stringify(colors);
  const sizesStr = JSON.stringify(sizes);
  const galleryStr = JSON.stringify(gallery);
  const variantStockStr = JSON.stringify(variantStock);

  try {
    const pool = await getConnection();
    await pool.request()
      .input("id", sql.VarChar(36), id)
      .input("slug", sql.NVarChar(120), slug)
      .input("name", sql.NVarChar(120), name)
      .input("collection", sql.NVarChar(60), collection)
      .input("price", sql.Decimal(10, 2), price)
      .input("originalPrice", sql.Decimal(10, 2), originalPrice ?? null)
      .input("description", sql.NVarChar(sql.MAX), description)
      .input("fabric", sql.NVarChar(120), fabric)
      .input("gsm", sql.Int, gsm)
      .input("colors", sql.NVarChar(sql.MAX), colorsStr)
      .input("sizes", sql.NVarChar(sql.MAX), sizesStr)
      .input("image", sql.VarChar(500), image)
      .input("gallery", sql.NVarChar(sql.MAX), galleryStr)
      .input("tag", sql.NVarChar(60), tag || null)
      .input("stock", sql.Int, stock)
      .input("variantStock", sql.NVarChar(sql.MAX), variantStockStr)
      .query(`
        INSERT INTO Products (id, slug, name, collection, price, originalPrice, description, fabric, gsm, colors, sizes, image, gallery, tag, stock, variantStock, createdAt, updatedAt)
        VALUES (@id, @slug, @name, @collection, @price, @originalPrice, @description, @fabric, @gsm, @colors, @sizes, @image, @gallery, @tag, @stock, @variantStock, GETDATE(), GETDATE())
      `);

    return res.status(201).json({ id, slug });
  } catch (err) {
    console.error("Create Product Error:", err.message);
    return res.status(500).json({ error: "Server error creating product." });
  }
});

// PUT /api/products/:id - Update an existing product (Admin only)
router.put("/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { name, collection, price, originalPrice, description, fabric, gsm, colors, sizes, image, gallery, tag, stock, variantStock } = parsed.data;

  const colorsStr = JSON.stringify(colors);
  const sizesStr = JSON.stringify(sizes);
  const galleryStr = JSON.stringify(gallery);
  const variantStockStr = JSON.stringify(variantStock);

  // Generate slug
  let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  slug = `${slug}-${Math.random().toString(36).substring(2, 6)}`;

  try {
    const pool = await getConnection();
    await pool.request()
      .input("id", sql.VarChar(36), id)
      .input("slug", sql.NVarChar(120), slug)
      .input("name", sql.NVarChar(120), name)
      .input("collection", sql.NVarChar(60), collection)
      .input("price", sql.Decimal(10, 2), price)
      .input("originalPrice", sql.Decimal(10, 2), originalPrice ?? null)
      .input("description", sql.NVarChar(sql.MAX), description)
      .input("fabric", sql.NVarChar(120), fabric)
      .input("gsm", sql.Int, gsm)
      .input("colors", sql.NVarChar(sql.MAX), colorsStr)
      .input("sizes", sql.NVarChar(sql.MAX), sizesStr)
      .input("image", sql.VarChar(500), image)
      .input("gallery", sql.NVarChar(sql.MAX), galleryStr)
      .input("tag", sql.NVarChar(60), tag || null)
      .input("stock", sql.Int, stock)
      .input("variantStock", sql.NVarChar(sql.MAX), variantStockStr)
      .query(`
        UPDATE Products 
        SET slug = @slug, name = @name, collection = @collection, price = @price, originalPrice = @originalPrice, 
            description = @description, fabric = @fabric, gsm = @gsm, colors = @colors, sizes = @sizes, 
            image = @image, gallery = @gallery, tag = @tag, stock = @stock, variantStock = @variantStock, updatedAt = GETDATE()
        WHERE id = @id
      `);

    return res.json({ message: "Product updated successfully." });
  } catch (err) {
    console.error("Update Product Error:", err.message);
    return res.status(500).json({ error: "Server error updating product." });
  }
});

// DELETE /api/products/:id - Delete a product (Admin only)
router.delete("/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await getConnection();
    await pool.request()
      .input("id", sql.VarChar(36), id)
      .query("DELETE FROM Products WHERE id = @id");
    return res.json({ message: "Product deleted successfully." });
  } catch (err) {
    console.error("Delete Product Error:", err.message);
    return res.status(500).json({ error: "Server error deleting product." });
  }
});

export default router;

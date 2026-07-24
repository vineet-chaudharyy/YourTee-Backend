import { Router } from "express";
import { getConnection, sql } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { z } from "zod";

const router = Router();

const orderSchema = z.object({
  id: z.string().trim().min(5),
  items: z.array(z.object({
    productId: z.string(),
    name: z.string(),
    price: z.number(),
    image: z.string(),
    backImage: z.string().nullable().optional().default(null),
    color: z.string(),
    size: z.string(),
    quantity: z.number().int().positive(),
    description: z.string().nullable().optional().default(null),
    layers: z.array(z.any()).nullable().optional().default(null)
  })).min(1),
  subtotal: z.number().nonnegative(),
  shipping: z.number().nonnegative(),
  total: z.number().nonnegative(),
  paymentMethod: z.string(),
  paymentId: z.string().nullable().optional().default(null),
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().nullable().optional().default(null),
  carrier: z.string().optional().default("BlueDart"),
  tracking: z.string().optional().default(""),
});

// POST /api/orders - Create a new order (Supports guest checkouts)
router.post("/", async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { id, items, subtotal, shipping, total, paymentMethod, paymentId, name, email, phone, carrier, tracking } = parsed.data;
  
  // Set userId if user is logged in
  const userId = req.user?.id || null;

  try {
    const pool = await getConnection();
    
    // Check stock for all catalog products (non-custom items)
    for (const item of items) {
      if (item.productId && item.productId !== "custom") {
        const prodRes = await pool.request()
          .input("prodId", sql.VarChar(36), item.productId)
          .query("SELECT name, stock, variantStock FROM Products WHERE id = @prodId");
        
        if (prodRes.recordset.length > 0) {
          const prod = prodRes.recordset[0];
          let variantStock = {};
          if (prod.variantStock) {
            try {
              variantStock = JSON.parse(prod.variantStock);
            } catch {
              variantStock = {};
            }
          }
          
          const variantKey = `${item.color}-${item.size}`;
          const currentVariantStock = variantStock[variantKey] !== undefined ? Number(variantStock[variantKey]) : 50;
          
          if (currentVariantStock < item.quantity) {
            return res.status(400).json({ 
              error: `Sorry, "${prod.name}" in Color: ${item.color}, Size: ${item.size} has only ${currentVariantStock} items left in stock. Please adjust your quantity.` 
            });
          }
        }
      }
    }

    // Check if order ID already exists
    const checkIdRes = await pool.request()
      .input("id", sql.VarChar(36), id)
      .query("SELECT id FROM Orders WHERE id = @id");
    
    if (checkIdRes.recordset.length > 0) {
      return res.status(409).json({ error: "Order ID already exists." });
    }

    // Insert order header
    await pool.request()
      .input("id", sql.VarChar(36), id)
      .input("userId", sql.VarChar(36), userId)
      .input("subtotal", sql.Decimal(10, 2), subtotal)
      .input("shipping", sql.Decimal(10, 2), shipping)
      .input("total", sql.Decimal(10, 2), total)
      .input("status", sql.VarChar(50), paymentMethod === "cod" ? "Placed" : "Confirmed")
      .input("paymentMethod", sql.VarChar(50), paymentMethod)
      .input("paymentId", sql.VarChar(100), paymentId)
      .input("name", sql.NVarChar(120), name)
      .input("email", sql.NVarChar(255), email)
      .input("phone", sql.VarChar(20), phone)
      .input("carrier", sql.VarChar(50), carrier)
      .input("tracking", sql.VarChar(100), tracking)
      .query(`
        INSERT INTO Orders (id, userId, date, subtotal, shipping, total, status, paymentMethod, paymentId, name, email, phone, carrier, tracking, createdAt, updatedAt)
        VALUES (@id, @userId, GETDATE(), @subtotal, @shipping, @total, @status, @paymentMethod, @paymentId, @name, @email, @phone, @carrier, @tracking, GETDATE(), GETDATE())
      `);

    // Insert order items
    for (const item of items) {
      await pool.request()
        .input("orderId", sql.VarChar(36), id)
        .input("productId", sql.VarChar(36), item.productId)
        .input("name", sql.NVarChar(120), item.name)
        .input("price", sql.Decimal(10, 2), item.price)
        .input("image", sql.VarChar(sql.MAX), item.image)
        .input("color", sql.NVarChar(60), item.color)
        .input("size", sql.NVarChar(10), item.size)
        .input("quantity", sql.Int, item.quantity)
        .input("description", sql.NVarChar(1000), item.description || null)
        .input("layers", sql.NVarChar(sql.MAX), item.layers ? JSON.stringify(item.layers) : null)
        .input("backImage", sql.VarChar(sql.MAX), item.backImage || null)
        .query(`
          INSERT INTO OrderItems (orderId, productId, name, price, image, color, size, quantity, description, layers, backImage)
          VALUES (@orderId, @productId, @name, @price, @image, @color, @size, @quantity, @description, @layers, @backImage)
        `);

      // Decrease stock if it is a catalog product (not a custom design)
      if (item.productId && item.productId !== "custom") {
        const prodDataRes = await pool.request()
          .input("prodId", sql.VarChar(36), item.productId)
          .query("SELECT stock, variantStock FROM Products WHERE id = @prodId");
        
        if (prodDataRes.recordset.length > 0) {
          const prod = prodDataRes.recordset[0];
          let variantStock = {};
          if (prod.variantStock) {
            try {
              variantStock = JSON.parse(prod.variantStock);
            } catch {
              variantStock = {};
            }
          }
          
          const variantKey = `${item.color}-${item.size}`;
          const currentVariantQty = variantStock[variantKey] !== undefined ? Number(variantStock[variantKey]) : 50;
          const newVariantQty = Math.max(0, currentVariantQty - item.quantity);
          variantStock[variantKey] = newVariantQty;
          
          // Re-compute aggregate stock
          let totalStock = 0;
          for (const key in variantStock) {
            totalStock += Number(variantStock[key] || 0);
          }
          
          const variantStockStr = JSON.stringify(variantStock);
          
          await pool.request()
            .input("prodId", sql.VarChar(36), item.productId)
            .input("totalStock", sql.Int, totalStock)
            .input("variantStock", sql.NVarChar(sql.MAX), variantStockStr)
            .query(`
              UPDATE Products 
              SET stock = @totalStock, variantStock = @variantStock, updatedAt = GETDATE()
              WHERE id = @prodId
            `);
        }
      }
    }

    return res.status(201).json({ success: true, orderId: id });
  } catch (err) {
    console.error("Create Order Error:", err.message);
    return res.status(500).json({ error: "Server error creating order." });
  }
});

// GET /api/orders - Get user's order history
router.get("/", requireAuth, async (req, res) => {
  try {
    const pool = await getConnection();
    
    // Get all orders for the user
    const ordersRes = await pool.request()
      .input("userId", sql.VarChar(36), req.user.id)
      .query("SELECT * FROM Orders WHERE userId = @userId ORDER BY date DESC");
      
    const orders = [];
    
    for (const o of ordersRes.recordset) {
      // Get items for this order
      const itemsRes = await pool.request()
        .input("orderId", sql.VarChar(36), o.id)
        .query("SELECT * FROM OrderItems WHERE orderId = @orderId");
        
      orders.push({
        id: o.id,
        date: o.date,
        subtotal: Number(o.subtotal),
        shipping: Number(o.shipping),
        total: Number(o.total),
        status: o.status,
        paymentMethod: o.paymentMethod,
        paymentId: o.paymentId,
        name: o.name,
        email: o.email,
        phone: o.phone,
        carrier: o.carrier,
        tracking: o.tracking,
        returnReason: o.returnReason || null,
        returnImage: o.returnImage || null,
        returnAddress: o.returnAddress || null,
        bankDetails: o.bankDetails || null,
        items: itemsRes.recordset.map(i => ({
          productId: i.productId,
          name: i.name,
          price: Number(i.price),
          image: i.image,
          color: i.color,
          size: i.size,
          quantity: i.quantity,
          description: i.description || null
        }))
      });
    }

    return res.json({ orders });
  } catch (err) {
    console.error("Fetch Orders Error:", err.message);
    return res.status(500).json({ error: "Server error fetching orders." });
  }
});

// GET /api/orders/:id - Get specific order details
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await getConnection();
    const orderRes = await pool.request()
      .input("id", sql.VarChar(36), id)
      .query("SELECT * FROM Orders WHERE id = @id");
      
    if (orderRes.recordset.length === 0) {
      return res.status(404).json({ error: "Order not found." });
    }
    
    const o = orderRes.recordset[0];
    
    const itemsRes = await pool.request()
      .input("orderId", sql.VarChar(36), id)
      .query("SELECT * FROM OrderItems WHERE orderId = @orderId");
      
    const order = {
      id: o.id,
      date: o.date,
      subtotal: Number(o.subtotal),
      shipping: Number(o.shipping),
      total: Number(o.total),
      status: o.status,
      paymentMethod: o.paymentMethod,
      paymentId: o.paymentId,
      name: o.name,
      email: o.email,
      phone: o.phone,
      carrier: o.carrier,
      tracking: o.tracking,
      returnReason: o.returnReason || null,
      returnImage: o.returnImage || null,
      returnAddress: o.returnAddress || null,
      bankDetails: o.bankDetails || null,
      items: itemsRes.recordset.map(i => ({
        productId: i.productId,
        name: i.name,
        price: Number(i.price),
        image: i.image,
        color: i.color,
        size: i.size,
        quantity: i.quantity,
        description: i.description || null
      }))
    };

    return res.json({ order });
  } catch (err) {
    console.error("Fetch Order Details Error:", err.message);
    return res.status(500).json({ error: "Server error fetching order details." });
  }
});

// POST /api/orders/:id/return - Request a return for a delivered order
router.post("/:id/return", async (req, res) => {
  const { id } = req.params;
  const { reason, image, pickupAddress, bankDetails } = req.body;

  if (!reason || reason.trim() === "") {
    return res.status(400).json({ error: "Reason for return is required." });
  }

  try {
    const pool = await getConnection();
    
    // Fetch order first to check status
    const orderRes = await pool.request()
      .input("id", sql.VarChar(36), id)
      .query("SELECT status FROM Orders WHERE id = @id");
      
    if (orderRes.recordset.length === 0) {
      return res.status(404).json({ error: "Order not found." });
    }

    const order = orderRes.recordset[0];
    if (order.status !== "Delivered") {
      return res.status(400).json({ error: "Only delivered products can be returned." });
    }

    // Update status to 'Requested' and store return reasons, address, image, bank details
    await pool.request()
      .input("id", sql.VarChar(36), id)
      .input("reason", sql.NVarChar(500), reason.trim())
      .input("image", sql.NVarChar(1000), image || null)
      .input("pickupAddress", sql.NVarChar(1000), pickupAddress || null)
      .input("bankDetails", sql.NVarChar(1000), bankDetails || null)
      .query(`
        UPDATE Orders 
        SET status = 'Requested', 
            returnReason = @reason, 
            returnImage = @image, 
            returnAddress = @pickupAddress, 
            bankDetails = @bankDetails, 
            updatedAt = GETDATE() 
        WHERE id = @id
      `);

    return res.json({ 
      success: true, 
      status: "Requested", 
      returnReason: reason.trim(),
      returnImage: image || null,
      returnAddress: pickupAddress || null,
      bankDetails: bankDetails || null
    });
  } catch (err) {
    console.error("Return Request Error:", err.message);
    return res.status(500).json({ error: "Server error submitting return request." });
  }
});

export default router;

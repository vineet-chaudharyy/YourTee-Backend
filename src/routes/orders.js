import { Router } from "express";
import { getConnection, sql } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { z } from "zod";
import { sendOrderConfirmationEmail } from "../utils/email.js";

const router = Router();

// Order IDs are short and guessable (YT-#####), so knowing an ID alone must not
// grant access to the customer's personal data or to the return/refund flow.
// A caller is treated as the order's owner if they are signed in as the user who
// placed it, are an admin, or can supply the email address the order was placed
// with (this keeps guest tracking and guest returns working).
function isOrderOwner(req, order, suppliedEmail) {
  if (req.user?.role === "admin") return true;
  if (req.user && order.userId && req.user.id === order.userId) return true;
  if (typeof suppliedEmail === "string" && order.email) {
    return suppliedEmail.trim().toLowerCase() === String(order.email).trim().toLowerCase();
  }
  return false;
}

// "Vineet Chaudhary" -> "V*** C***" — enough for a guest to recognise their own
// order on the tracking page without exposing the customer's name to a stranger.
function maskName(name) {
  if (!name) return null;
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]}***`)
    .join(" ");
}

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

  // The whole write runs in one transaction. Previously the stock check and
  // the decrement were separate round-trips, so two people buying the last
  // item could both pass the check and oversell it; a failure midway could
  // also leave an order header with no items.
  let pool;
  let tx;
  try {
    pool = await getConnection();
    tx = new sql.Transaction(pool);
    await tx.begin();

    // Check if order ID already exists
    const checkIdRes = await new sql.Request(tx)
      .input("id", sql.VarChar(36), id)
      .query("SELECT id FROM Orders WHERE id = @id");

    if (checkIdRes.recordset.length > 0) {
      await tx.rollback();
      return res.status(409).json({ error: "Order ID already exists." });
    }

    // Collapse the cart into total demand per product+variant. Two lines for
    // the same variant have to be checked against their combined quantity,
    // otherwise a single order can oversell itself.
    const demand = new Map();
    for (const item of items) {
      if (!item.productId || item.productId === "custom") continue;
      if (!demand.has(item.productId)) demand.set(item.productId, new Map());
      const variants = demand.get(item.productId);
      const key = `${item.color}-${item.size}`;
      const existing = variants.get(key);
      if (existing) existing.qty += item.quantity;
      else variants.set(key, { color: item.color, size: item.size, qty: item.quantity });
    }

    // Verify and reserve. UPDLOCK/HOLDLOCK holds the row until commit, so a
    // concurrent order for the same product waits here instead of racing.
    const stockUpdates = [];
    for (const [productId, variants] of demand) {
      const prodRes = await new sql.Request(tx)
        .input("prodId", sql.VarChar(36), productId)
        .query("SELECT name, variantStock FROM Products WITH (UPDLOCK, HOLDLOCK) WHERE id = @prodId");

      if (prodRes.recordset.length === 0) continue; // custom/unknown: not stock-tracked

      const prod = prodRes.recordset[0];
      let variantStock = {};
      if (prod.variantStock) {
        try {
          variantStock = JSON.parse(prod.variantStock);
        } catch {
          variantStock = {};
        }
      }

      for (const [variantKey, want] of variants) {
        const available = variantStock[variantKey] !== undefined ? Number(variantStock[variantKey]) : 50;
        if (available < want.qty) {
          await tx.rollback();
          return res.status(400).json({
            error: `Sorry, "${prod.name}" in Color: ${want.color}, Size: ${want.size} has only ${available} items left in stock. Please adjust your quantity.`,
          });
        }
        variantStock[variantKey] = Math.max(0, available - want.qty);
      }

      const totalStock = Object.values(variantStock).reduce((sum, v) => sum + Number(v || 0), 0);
      stockUpdates.push({ productId, variantStock: JSON.stringify(variantStock), totalStock });
    }

    // Insert order header
    await new sql.Request(tx)
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
      await new sql.Request(tx)
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
    }

    // Apply the stock levels computed against the locked rows above.
    for (const upd of stockUpdates) {
      await new sql.Request(tx)
        .input("prodId", sql.VarChar(36), upd.productId)
        .input("totalStock", sql.Int, upd.totalStock)
        .input("variantStock", sql.NVarChar(sql.MAX), upd.variantStock)
        .query(`
          UPDATE Products
          SET stock = @totalStock, variantStock = @variantStock, updatedAt = GETDATE()
          WHERE id = @prodId
        `);
    }

    await tx.commit();
    tx = null;

    // Sent only after the order is durably committed, and deliberately not
    // awaited into the transaction — a mail failure must not roll back a
    // paid order.
    sendOrderConfirmationEmail(email, {
      id,
      name,
      subtotal,
      shipping,
      total,
      paymentMethod,
      items,
    }).catch((e) => console.error("Order confirmation email failed:", e.message));

    return res.status(201).json({ success: true, orderId: id });
  } catch (err) {
    if (tx) {
      try {
        await tx.rollback();
      } catch (rollbackErr) {
        console.error("Rollback failed:", rollbackErr.message);
      }
    }
    console.error("Create Order Error:", err.message);

    // Losing the race for a row lock is contention, not a bug — tell the
    // customer to retry rather than showing a generic failure.
    const msg = String(err.message || "");
    if (/timeout|deadlock/i.test(msg)) {
      return res.status(503).json({
        error: "That item is in high demand right now. Please try placing your order again.",
      });
    }
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

    // Anyone with the ID may see delivery progress, but personal data is only
    // returned to the owner (signed in, or proving the order email via ?email=).
    const isOwner = isOrderOwner(req, o, req.query.email);

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
      name: isOwner ? o.name : maskName(o.name),
      email: isOwner ? o.email : null,
      phone: isOwner ? o.phone : null,
      carrier: o.carrier,
      tracking: o.tracking,
      returnReason: o.returnReason || null,
      returnImage: isOwner ? (o.returnImage || null) : null,
      returnAddress: isOwner ? (o.returnAddress || null) : null,
      bankDetails: isOwner ? (o.bankDetails || null) : null,
      // Tells the client whether it must ask for the order email to unlock
      // the return flow / full details.
      verified: isOwner,
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
  const { reason, image, pickupAddress, bankDetails, email } = req.body;

  if (!reason || reason.trim() === "") {
    return res.status(400).json({ error: "Reason for return is required." });
  }

  try {
    const pool = await getConnection();

    // Fetch order first to check status
    const orderRes = await pool.request()
      .input("id", sql.VarChar(36), id)
      .query("SELECT status, userId, email FROM Orders WHERE id = @id");

    if (orderRes.recordset.length === 0) {
      return res.status(404).json({ error: "Order not found." });
    }

    const order = orderRes.recordset[0];

    // Without this check anyone could file a return against a stranger's order
    // and redirect the refund to their own bank account.
    if (!isOrderOwner(req, order, email)) {
      return res.status(403).json({
        error: "Please confirm the email address this order was placed with to request a return.",
      });
    }

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

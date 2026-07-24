import { Router } from "express";
import { getConnection, sql } from "../db/index.js";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();

// GET /api/admin/stats - Admin Dashboard Stats
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const pool = await getConnection();
    
    const usersCountRes = await pool.request().query("SELECT COUNT(*) AS count FROM Users");
    const adminsCountRes = await pool.request().query("SELECT COUNT(*) AS count FROM Users WHERE role = 'admin'");
    const designsCountRes = await pool.request().query("SELECT COUNT(*) AS count FROM Designs");
    const productsCountRes = await pool.request().query("SELECT COUNT(*) AS count FROM Products");
    const ordersCountRes = await pool.request().query("SELECT COUNT(*) AS count FROM Orders");
    
    // Sum total of orders that are Delivered (exclude Placed, Confirmed, Shipped, Cancelled, and Returned for revenue)
    const revenueRes = await pool.request().query(`
      SELECT SUM(total) AS revenue FROM Orders 
      WHERE status = 'Delivered'
    `);
    
    // Count returns (Returned only, exclude Return Requested)
    const returnsCountRes = await pool.request().query(`
      SELECT COUNT(*) AS count FROM Orders WHERE status = 'Returned'
    `);

    const since = new Date(Date.now() - 7 * 86400000);
    const newUsersRes = await pool.request()
      .input("since", sql.DateTime2, since)
      .query("SELECT COUNT(*) AS count FROM Users WHERE createdAt >= @since");

    // 1. Calculate live monthly sales revenue trend (past 6 months)
    const monthlyRevenue = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const name = d.toLocaleDateString("en-US", { month: "short" });
      const year = d.getFullYear();
      const monthNum = d.getMonth() + 1;
      monthlyRevenue.push({ label: name, monthNum, year, revenue: 0 });
    }

    const monthlyQueryRes = await pool.request().query(`
      SELECT 
        MONTH(createdAt) AS monthNum,
        YEAR(createdAt) AS yearNum,
        SUM(total) AS revenue
      FROM Orders
      WHERE status = 'Delivered'
      GROUP BY MONTH(createdAt), YEAR(createdAt)
    `);

    for (const record of monthlyQueryRes.recordset) {
      const match = monthlyRevenue.find(
        (m) => m.monthNum === record.monthNum && m.year === record.yearNum
      );
      if (match) {
        match.revenue = Number(record.revenue);
      }
    }

    // 2. Calculate live print shares from placed items
    const itemsRes = await pool.request().query("SELECT name, quantity FROM OrderItems");
    let classicCount = 0;
    let embroideryCount = 0;
    let puffCount = 0;

    for (const item of itemsRes.recordset) {
      const nameLower = item.name.toLowerCase();
      const qty = Number(item.quantity) || 1;
      if (nameLower.includes("embroidery")) {
        embroideryCount += qty;
      } else if (nameLower.includes("puff")) {
        puffCount += qty;
      } else {
        classicCount += qty;
      }
    }

    const totalTechniqueOrders = classicCount + embroideryCount + puffCount;
    const printShares = {
      classic: {
        count: classicCount,
        percent: totalTechniqueOrders > 0 ? Math.round((classicCount / totalTechniqueOrders) * 100) : 60
      },
      embroidery: {
        count: embroideryCount,
        percent: totalTechniqueOrders > 0 ? Math.round((embroideryCount / totalTechniqueOrders) * 100) : 25
      },
      puff: {
        count: puffCount,
        percent: totalTechniqueOrders > 0 ? Math.round((puffCount / totalTechniqueOrders) * 100) : 15
      }
    };

    return res.json({
      totalUsers: usersCountRes.recordset[0].count,
      totalAdmins: adminsCountRes.recordset[0].count,
      totalDesigns: designsCountRes.recordset[0].count,
      totalProducts: productsCountRes.recordset[0].count,
      totalOrders: ordersCountRes.recordset[0].count,
      salesRevenue: revenueRes.recordset[0].revenue ? Number(revenueRes.recordset[0].revenue) : 0,
      totalReturns: returnsCountRes.recordset[0].count,
      newUsers7d: newUsersRes.recordset[0].count,
      monthlyRevenue,
      printShares
    });
  } catch (err) {
    console.error("Admin Stats Error:", err.message);
    return res.status(500).json({ error: "Server error fetching stats." });
  }
});

// GET /api/admin/designs - Admin Designs List (limit 300)
router.get("/designs", requireAdmin, async (req, res) => {
  try {
    const pool = await getConnection();
    const result = await pool.request().query(`
      SELECT TOP 300 D.id, D.name, D.garment, D.color, D.fabric, D.price, D.preview, D.previewBack, D.createdAt,
             U.name AS userName, U.email AS userEmail
      FROM Designs D
      LEFT JOIN Users U ON D.userId = U.id
      ORDER BY D.createdAt DESC
    `);

    const designs = result.recordset.map((d) => ({
      id: d.id,
      name: d.name,
      garment: d.garment,
      color: d.color,
      fabric: d.fabric,
      price: Number(d.price),
      preview: d.preview || null,
      previewBack: d.previewBack || null,
      user: {
        name: d.userName || "Unknown",
        email: d.userEmail || "",
      },
      createdAt: d.createdAt,
    }));

    return res.json({ designs });
  } catch (err) {
    console.error("Admin Designs List Error:", err.message);
    return res.status(500).json({ error: "Server error fetching designs." });
  }
});

// GET /api/admin/users - Admin Users List (limit 200)
router.get("/users", requireAdmin, async (req, res) => {
  try {
    const pool = await getConnection();
    const result = await pool.request().query(`
      SELECT TOP 200 U.id, U.name, U.email, U.role, U.createdAt, COUNT(D.id) AS designsCount
      FROM Users U
      LEFT JOIN Designs D ON U.id = D.userId
      GROUP BY U.id, U.name, U.email, U.role, U.createdAt
      ORDER BY U.createdAt DESC
    `);

    const users = result.recordset.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      designs: u.designsCount || 0,
      createdAt: u.createdAt,
    }));

    return res.json({ users });
  } catch (err) {
    console.error("Admin Users List Error:", err.message);
    return res.status(500).json({ error: "Server error fetching users." });
  }
});

// GET /api/admin/orders - Admin Orders List (limit 300)
router.get("/orders", requireAdmin, async (req, res) => {
  try {
    const pool = await getConnection();
    const result = await pool.request().query("SELECT TOP 300 * FROM Orders ORDER BY date DESC");
    
    const orders = [];
    for (const o of result.recordset) {
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
          backImage: i.backImage || null,
          color: i.color,
          size: i.size,
          quantity: i.quantity,
          description: i.description || null,
          layers: i.layers ? JSON.parse(i.layers) : null
        })),
        createdAt: o.createdAt,
      });
    }

    return res.json({ orders });
  } catch (err) {
    console.error("Admin Orders List Error:", err.message);
    return res.status(500).json({ error: "Server error fetching orders." });
  }
});

// PATCH /api/admin/orders/:id/status - Update Order Status (Admin only)
router.patch("/orders/:id/status", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Status is required." });
  }

  const validStatuses = [
    "Placed", "Confirmed", "Shipped", "Delivered", "Cancelled",
    "Return Requested", "Returned", // backward compatibility
    "Requested", "Approved", "Pickup Scheduled", "Picked Up", "Refund Processed", "Rejected"
  ];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status value." });
  }

  try {
    const pool = await getConnection();
    const result = await pool.request()
      .input("id", sql.VarChar(36), id)
      .input("status", sql.VarChar(50), status)
      .query("UPDATE Orders SET status = @status, updatedAt = GETDATE() WHERE id = @id");

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Order not found." });
    }

    return res.json({ ok: true, status });
  } catch (err) {
    console.error("Update Order Status Error:", err.message);
    return res.status(500).json({ error: "Server error updating order status." });
  }
});

// DELETE /api/admin/designs/:id - Delete a customer design (Admin only)
router.delete("/designs/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await getConnection();
    const result = await pool.request()
      .input("id", sql.VarChar(36), id)
      .query("DELETE FROM Designs WHERE id = @id");
    
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Design not found." });
    }
    return res.json({ message: "Design deleted successfully." });
  } catch (err) {
    console.error("Admin Delete Design Error:", err.message);
    return res.status(500).json({ error: "Server error deleting design." });
  }
});

// PUT /api/admin/designs/:id - Update a customer design (Admin only)
router.put("/designs/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, garment, color, fabric, price } = req.body;

  if (!name || !price) {
    return res.status(400).json({ error: "Name and Price are required." });
  }

  try {
    const pool = await getConnection();
    const result = await pool.request()
      .input("id", sql.VarChar(36), id)
      .input("name", sql.NVarChar(120), name)
      .input("garment", sql.NVarChar(60), garment || "Custom Tee")
      .input("color", sql.NVarChar(60), color || "Onyx")
      .input("fabric", sql.NVarChar(60), fabric || "Heavyweight 280 GSM")
      .input("price", sql.Decimal(10, 2), price)
      .query(`
        UPDATE Designs 
        SET name = @name, garment = @garment, color = @color, fabric = @fabric, price = @price, updatedAt = GETDATE()
        WHERE id = @id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Design not found." });
    }

    return res.json({ message: "Design updated successfully." });
  } catch (err) {
    console.error("Admin Update Design Error:", err.message);
    return res.status(500).json({ error: "Server error updating design." });
  }
});

// DELETE /api/admin/collections/:name - Reset collection of all products to 'Minimal'
router.delete("/collections/:name", requireAdmin, async (req, res) => {
  const { name } = req.params;
  try {
    const pool = await getConnection();
    await pool.request()
      .input("name", sql.NVarChar(255), name)
      .query("UPDATE Products SET collection = 'Minimal' WHERE collection = @name");
    return res.json({ success: true, message: `Collection "${name}" deleted, products reset to Minimal.` });
  } catch (err) {
    console.error("Delete Collection Error:", err.message);
    return res.status(500).json({ error: "Server error deleting collection." });
  }
});

// GET /api/admin/customizer-settings - Get customizer pricing settings
router.get("/customizer-settings", async (req, res) => {
  try {
    const pool = await getConnection();
    const result = await pool.request()
      .query("SELECT TOP 1 * FROM CustomizerSettings ORDER BY createdAt DESC");
    
    if (result.recordset.length === 0) {
      return res.json({
        settings: {
          basePrice: 1499,
          textPrice: 200,
          imagePrice: 500,
          graphicPrice: 150,
          designPrice: 200,
          embroiderySurcharge: 350,
          puffSurcharge: 250,
          heavyCottonPrice: 0,
          oversizedBoxyPrice: 400,
          supimaLuxuryPrice: 800,
        }
      });
    }

    const s = result.recordset[0];
    return res.json({
      settings: {
        basePrice: Number(s.basePrice),
        textPrice: Number(s.textPrice),
        imagePrice: Number(s.imagePrice),
        graphicPrice: Number(s.graphicPrice),
        designPrice: Number(s.designPrice),
        embroiderySurcharge: Number(s.embroiderySurcharge),
        puffSurcharge: Number(s.puffSurcharge),
        heavyCottonPrice: s.heavyCottonPrice !== undefined && s.heavyCottonPrice !== null ? Number(s.heavyCottonPrice) : 0,
        oversizedBoxyPrice: s.oversizedBoxyPrice !== undefined && s.oversizedBoxyPrice !== null ? Number(s.oversizedBoxyPrice) : 400,
        supimaLuxuryPrice: s.supimaLuxuryPrice !== undefined && s.supimaLuxuryPrice !== null ? Number(s.supimaLuxuryPrice) : 800,
      }
    });
  } catch (err) {
    console.error("Get Customizer Settings Error:", err.message);
    return res.status(500).json({ error: "Server error fetching customizer settings." });
  }
});

// PUT /api/admin/customizer-settings - Update customizer pricing settings (Admin only)
router.put("/customizer-settings", requireAdmin, async (req, res) => {
  const {
    basePrice,
    textPrice,
    imagePrice,
    graphicPrice,
    designPrice,
    embroiderySurcharge,
    puffSurcharge,
    heavyCottonPrice,
    oversizedBoxyPrice,
    supimaLuxuryPrice,
  } = req.body;

  if (
    basePrice === undefined ||
    textPrice === undefined ||
    imagePrice === undefined ||
    graphicPrice === undefined ||
    designPrice === undefined ||
    embroiderySurcharge === undefined ||
    puffSurcharge === undefined ||
    heavyCottonPrice === undefined ||
    oversizedBoxyPrice === undefined ||
    supimaLuxuryPrice === undefined
  ) {
    return res.status(400).json({ error: "All pricing fields are required." });
  }

  try {
    const pool = await getConnection();
    const check = await pool.request().query("SELECT TOP 1 id FROM CustomizerSettings");
    if (check.recordset.length === 0) {
      await pool.request()
        .input("id", sql.VarChar(36), "settings-1")
        .input("basePrice", sql.Decimal(10, 2), Number(basePrice))
        .input("textPrice", sql.Decimal(10, 2), Number(textPrice))
        .input("imagePrice", sql.Decimal(10, 2), Number(imagePrice))
        .input("graphicPrice", sql.Decimal(10, 2), Number(graphicPrice))
        .input("designPrice", sql.Decimal(10, 2), Number(designPrice))
        .input("embroiderySurcharge", sql.Decimal(10, 2), Number(embroiderySurcharge))
        .input("puffSurcharge", sql.Decimal(10, 2), Number(puffSurcharge))
        .input("heavyCottonPrice", sql.Decimal(10, 2), Number(heavyCottonPrice))
        .input("oversizedBoxyPrice", sql.Decimal(10, 2), Number(oversizedBoxyPrice))
        .input("supimaLuxuryPrice", sql.Decimal(10, 2), Number(supimaLuxuryPrice))
        .query(`
          INSERT INTO CustomizerSettings (id, basePrice, textPrice, imagePrice, graphicPrice, designPrice, embroiderySurcharge, puffSurcharge, heavyCottonPrice, oversizedBoxyPrice, supimaLuxuryPrice)
          VALUES (@id, @basePrice, @textPrice, @imagePrice, @graphicPrice, @designPrice, @embroiderySurcharge, @puffSurcharge, @heavyCottonPrice, @oversizedBoxyPrice, @supimaLuxuryPrice)
        `);
    } else {
      const settingsId = check.recordset[0].id;
      await pool.request()
        .input("id", sql.VarChar(36), settingsId)
        .input("basePrice", sql.Decimal(10, 2), Number(basePrice))
        .input("textPrice", sql.Decimal(10, 2), Number(textPrice))
        .input("imagePrice", sql.Decimal(10, 2), Number(imagePrice))
        .input("graphicPrice", sql.Decimal(10, 2), Number(graphicPrice))
        .input("designPrice", sql.Decimal(10, 2), Number(designPrice))
        .input("embroiderySurcharge", sql.Decimal(10, 2), Number(embroiderySurcharge))
        .input("puffSurcharge", sql.Decimal(10, 2), Number(puffSurcharge))
        .input("heavyCottonPrice", sql.Decimal(10, 2), Number(heavyCottonPrice))
        .input("oversizedBoxyPrice", sql.Decimal(10, 2), Number(oversizedBoxyPrice))
        .input("supimaLuxuryPrice", sql.Decimal(10, 2), Number(supimaLuxuryPrice))
        .query(`
          UPDATE CustomizerSettings
          SET basePrice = @basePrice, textPrice = @textPrice, imagePrice = @imagePrice,
              graphicPrice = @graphicPrice, designPrice = @designPrice,
              embroiderySurcharge = @embroiderySurcharge, puffSurcharge = @puffSurcharge,
              heavyCottonPrice = @heavyCottonPrice, oversizedBoxyPrice = @oversizedBoxyPrice,
              supimaLuxuryPrice = @supimaLuxuryPrice, updatedAt = GETDATE()
          WHERE id = @id
        `);
    }

    return res.json({ message: "Customizer pricing settings updated successfully." });
  } catch (err) {
    console.error("Update Customizer Settings Error:", err.message);
    return res.status(500).json({ error: "Server error updating customizer settings." });
  }
});

export default router;

import { Router } from "express";
import crypto from "crypto";

const router = Router();

router.post("/order", async (req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  const { amount, receipt } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  if (!keyId || !keySecret) {
    return res.json({ demo: true });
  }

  try {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: Math.round(amount * 100), // paise
        currency: "INR",
        receipt: receipt || `rcpt_${Date.now()}`,
        payment_capture: 1,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return res.status(502).json({ error: "Gateway error", detail });
    }

    const order = await response.json();

    return res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
    });
  } catch (err) {
    console.error("Razorpay Create Order Error:", err.message);
    return res.status(500).json({ error: "Server error creating payment order." });
  }
});

router.post("/verify", async (req, res) => {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!keySecret) {
    return res.json({ valid: false, demo: true });
  }

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ valid: false, error: "Missing verification parameters" });
  }

  try {
    const expected = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    const valid =
      expected.length === razorpay_signature.length &&
      crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(razorpay_signature)
      );

    return res.json({ valid });
  } catch (err) {
    console.error("Razorpay Verification Error:", err.message);
    return res.status(500).json({ error: "Server error verifying payment." });
  }
});

export default router;

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import dotenv from "dotenv";
import { authMiddleware } from "./middleware/auth.js";
import authRouter from "./routes/auth.js";
import designsRouter from "./routes/designs.js";
import adminRouter from "./routes/admin.js";
import paymentRouter from "./routes/payment.js";
import productsRouter from "./routes/products.js";
import ordersRouter from "./routes/orders.js";
import heroRouter from "./routes/hero.js";

dotenv.config();

const app = express();
app.use(compression());
const port = process.env.PORT || 5001;

app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:3007", "http://localhost:3009"],
    credentials: true,
  })
);

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ limit: "5mb", extended: true }));
app.use(cookieParser());

app.use(authMiddleware);

app.use("/api/auth", authRouter);
app.use("/api/designs", designsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/payment", paymentRouter);
app.use("/api/products", productsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/hero", heroRouter);

app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack);
  res.status(500).json({ error: "An unexpected error occurred." });
});

app.listen(port, () => {
  console.log(`YourTee Express backend running on http://localhost:${port}`);
});

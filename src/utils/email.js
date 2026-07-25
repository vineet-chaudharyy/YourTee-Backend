import nodemailer from "nodemailer";

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(port, 10),
    secure: parseInt(port, 10) === 465,
    auth: { user, pass },
  });
}

const fromAddress = process.env.SMTP_FROM || "YourTee <no-reply@yourtee.in>";

// Public origin of the storefront, used to build links inside emails.
const appUrl = (process.env.APP_URL || "http://localhost:3007").replace(/\/+$/, "");

/**
 * Sends a password reset link. The token is single-use and expires in 1 hour.
 */
export async function sendPasswordResetEmail(toEmail, name, token) {
  const resetLink = `${appUrl}/reset-password?token=${token}`;
  const transporter = getTransporter();

  const subject = "Reset Your YourTee Password";
  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background-color: #ffffff; color: #101010; border: 1px solid #eaeaea;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h2 style="font-family: Georgia, serif; font-size: 26px; font-weight: normal; letter-spacing: 2px; color: #D4AF37; margin: 0;">YOURTEE</h2>
        <p style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.15em; color: #888888; margin-top: 5px;">Account Security</p>
      </div>

      <p style="font-size: 15px; line-height: 1.6; color: #333333;">Hello ${name || "there"},</p>

      <p style="font-size: 15px; line-height: 1.6; color: #333333;">We received a request to reset the password for your YourTee account. Click the button below to choose a new one. This link expires in <strong>1 hour</strong> and can only be used once.</p>

      <div style="text-align: center; margin: 35px 0;">
        <a href="${resetLink}" style="background-color: #D4AF37; color: #0c0a06; text-decoration: none; padding: 14px 30px; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.15em; display: inline-block;">
          Reset Password
        </a>
      </div>

      <p style="font-size: 13px; line-height: 1.6; color: #666666;">Or copy and paste this link in your web browser:</p>
      <p style="font-size: 12px; line-height: 1.6; word-break: break-all; color: #D4AF37; font-family: monospace; background-color: #f9f9f9; padding: 10px; border: 1px solid #eee;">
        ${resetLink}
      </p>

      <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 30px 0;" />

      <p style="font-size: 12px; line-height: 1.6; color: #999999; text-align: center;">
        If you did not request a password reset, you can safely ignore this email — your password will not change.
      </p>
    </div>
  `;

  if (!transporter) {
    console.log("\n=======================================================");
    console.log(`🔑  [LOCAL DEV] Password Reset Email to ${toEmail}:`);
    console.log(`Reset Link: ${resetLink}`);
    console.log("=======================================================\n");
    return;
  }

  try {
    await transporter.sendMail({ from: fromAddress, to: toEmail, subject, html });
  } catch (err) {
    console.error("Nodemailer password reset email error:", err.message);
  }
}

/**
 * Sends verification email to new users
 */
export async function sendVerificationEmail(toEmail, name, token) {
  const verificationLink = `http://localhost:5001/api/auth/verify-email?token=${token}`;
  const transporter = getTransporter();

  const subject = "Verify Your YourTee Account";
  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background-color: #ffffff; color: #101010; border: 1px solid #eaeaea;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h2 style="font-family: Georgia, serif; font-size: 26px; font-weight: normal; letter-spacing: 2px; color: #D4AF37; margin: 0;">YOURTEE</h2>
        <p style="font-size: 10px; text-transform: uppercase; tracking: 0.15em; color: #888888; margin-top: 5px;">Atelier of Premium Apparel</p>
      </div>
      
      <p style="font-size: 15px; line-height: 1.6; color: #333333;">Hello ${name || "there"},</p>
      
      <p style="font-size: 15px; line-height: 1.6; color: #333333;">Thank you for registering an account with YourTee. To ensure the security of our platform and confirm your email, please click the button below to verify your account:</p>
      
      <div style="text-align: center; margin: 35px 0;">
        <a href="${verificationLink}" style="background-color: #D4AF37; color: #0c0a06; text-decoration: none; padding: 14px 30px; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.15em; display: inline-block; transition: background-color 0.2s;">
          Verify Email Address
        </a>
      </div>
      
      <p style="font-size: 13px; line-height: 1.6; color: #666666;">Or copy and paste this link in your web browser:</p>
      <p style="font-size: 12px; line-height: 1.6; word-break: break-all; color: #D4AF37; font-family: monospace; background-color: #f9f9f9; padding: 10px; border: 1px solid #eee;">
        ${verificationLink}
      </p>
      
      <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 30px 0;" />
      
      <p style="font-size: 12px; line-height: 1.6; color: #999999; text-align: center;">
        If you did not request this email, you can safely ignore it.
      </p>
    </div>
  `;

  if (!transporter) {
    console.log("\n=======================================================");
    console.log(`✉️  [LOCAL DEV] Verification Email to ${toEmail}:`);
    console.log(`Verification Link: ${verificationLink}`);
    console.log("=======================================================\n");
    return;
  }

  try {
    await transporter.sendMail({
      from: fromAddress,
      to: toEmail,
      subject,
      html,
    });
  } catch (err) {
    console.error("Nodemailer verification email error:", err.message);
  }
}

/**
 * Sends order confirmation emails to customers
 */
export async function sendOrderConfirmationEmail(toEmail, order) {
  const transporter = getTransporter();
  const trackingLink = `http://localhost:3007/track?id=${order.id}`;

  const itemsHtml = order.items
    .map(
      (item) => `
    <tr style="border-bottom: 1px solid #eaeaea;">
      <td style="padding: 12px 0; font-size: 14px; color: #333333;">
        <strong>${item.name}</strong><br/>
        <span style="font-size: 11px; color: #777777;">Color: ${item.color} | Size: ${item.size} | Qty: ${item.quantity}</span>
      </td>
      <td style="padding: 12px 0; text-align: right; font-size: 14px; font-family: monospace; color: #101010;">
        ₹${(item.price * item.quantity).toFixed(2)}
      </td>
    </tr>
  `
    )
    .join("");

  const subject = `Order Confirmation #${order.id} - YourTee`;
  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background-color: #ffffff; color: #101010; border: 1px solid #eaeaea;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h2 style="font-family: Georgia, serif; font-size: 26px; font-weight: normal; letter-spacing: 2px; color: #D4AF37; margin: 0;">YOURTEE</h2>
        <p style="font-size: 10px; text-transform: uppercase; tracking: 0.15em; color: #888888; margin-top: 5px;">Order Receipt</p>
      </div>
      
      <p style="font-size: 15px; line-height: 1.6; color: #333333;">Thank you for your order, ${order.name || "Guest"}.</p>
      <p style="font-size: 14px; line-height: 1.6; color: #666666;">We are tailoring your custom pieces inside our atelier. Below is your order summary:</p>
      
      <div style="background-color: #f9f9f9; padding: 15px; border: 1px solid #eaeaea; margin-bottom: 25px;">
        <p style="margin: 0; font-size: 13px; color: #333333;"><strong>Order Number:</strong> <span style="font-family: monospace; color: #D4AF37;">${order.id}</span></p>
        <p style="margin: 5px 0 0 0; font-size: 13px; color: #333333;"><strong>Date:</strong> ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
        <p style="margin: 5px 0 0 0; font-size: 13px; color: #333333;"><strong>Payment Method:</strong> ${order.paymentMethod === "cod" ? "Cash on Delivery" : "Paid Online"}</p>
      </div>
      
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
        <thead>
          <tr style="border-bottom: 2px solid #101010;">
            <th style="text-align: left; padding-bottom: 8px; font-size: 12px; text-transform: uppercase; color: #888888;">Garment Description</th>
            <th style="text-align: right; padding-bottom: 8px; font-size: 12px; text-transform: uppercase; color: #888888;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
          <tr>
            <td style="padding: 15px 0 5px 0; font-size: 13px; color: #666666;">Subtotal</td>
            <td style="padding: 15px 0 5px 0; text-align: right; font-size: 13px; font-family: monospace; color: #333333;">₹${Number(order.subtotal).toFixed(2)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0 15px 0; font-size: 13px; color: #666666;">Shipping</td>
            <td style="padding: 5px 0 15px 0; text-align: right; font-size: 13px; font-family: monospace; color: #333333;">₹${Number(order.shipping).toFixed(2)}</td>
          </tr>
          <tr style="border-top: 2px solid #101010; font-weight: bold;">
            <td style="padding: 15px 0; font-size: 16px; color: #101010;">Grand Total</td>
            <td style="padding: 15px 0; text-align: right; font-size: 18px; font-family: monospace; color: #D4AF37;">₹${Number(order.total).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${trackingLink}" style="background-color: #D4AF37; color: #0c0a06; text-decoration: none; padding: 12px 25px; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.15em; display: inline-block;">
          Track Delivery Status
        </a>
      </div>
      
      <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 30px 0;" />
      
      <p style="font-size: 11px; line-height: 1.6; color: #999999; text-align: center;">
        YourTee Premium Atelier &copy; 2026. All rights reserved. For queries, contact care@yourtee.in.
      </p>
    </div>
  `;

  if (!transporter) {
    console.log("\n=======================================================");
    console.log(`✉️  [LOCAL DEV] Order Confirmation Email to ${toEmail}:`);
    console.log(`Order ID: ${order.id}`);
    console.log(`Grand Total: ₹${order.total}`);
    console.log(`Tracking Link: ${trackingLink}`);
    console.log("=======================================================\n");
    return;
  }

  try {
    await transporter.sendMail({
      from: fromAddress,
      to: toEmail,
      subject,
      html,
    });
  } catch (err) {
    console.error("Nodemailer order confirmation email error:", err.message);
  }
}

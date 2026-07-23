import { getConnection, sql } from "./index.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const email = (process.argv[2] || process.env.ADMIN_EMAIL || "admin@yourtee.in").toLowerCase();
const password = process.argv[3] || process.env.ADMIN_PASSWORD || "Admin@1234";
const name = "YourTee Admin";

async function seedAdmin() {
  console.log(`Seeding admin user '${email}'...`);
  try {
    const pool = await getConnection();
    
    // Check if user exists
    const checkResult = await pool.request()
      .input("email", sql.NVarChar(255), email)
      .query("SELECT id, role FROM Users WHERE email = @email");
      
    if (checkResult.recordset.length > 0) {
      console.log(`User '${email}' already exists. Promoting to admin...`);
      
      await pool.request()
        .input("email", sql.NVarChar(255), email)
        .query("UPDATE Users SET role = 'admin', updatedAt = GETDATE() WHERE email = @email");
      
      console.log(`✓ Admin updated: ${email} (role=admin)`);
    } else {
      console.log(`User '${email}' does not exist. Creating and seeding as admin...`);
      const passwordHash = await bcrypt.hash(password, 12);
      const newId = crypto.randomUUID();
      
      await pool.request()
        .input("id", sql.VarChar(36), newId)
        .input("name", sql.NVarChar(80), name)
        .input("email", sql.NVarChar(255), email)
        .input("passwordHash", sql.VarChar(255), passwordHash)
        .input("role", sql.VarChar(20), "admin")
        .query(`
          INSERT INTO Users (id, name, email, passwordHash, role, createdAt, updatedAt)
          VALUES (@id, @name, @email, @passwordHash, @role, GETDATE(), GETDATE())
        `);
        
      console.log(`✓ Admin created: ${email} (role=admin)`);
      console.log(`  Login → ${email} / ${password}`);
    }
  } catch (err) {
    console.error("Error seeding admin user:", err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

seedAdmin();

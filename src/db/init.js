import sql from "mssql/msnodesqlv8.js";
import dotenv from "dotenv";

dotenv.config();

const server = process.env.SQL_SERVER || "(local)\\SQLEXPRESS";
const database = process.env.SQL_DATABASE || "YourTeeDB";

const defaultProducts = [
  {
    id: "p1",
    slug: "legacy-heavyweight-tee",
    name: "Signature Taupe Logo Tee",
    collection: "Minimal",
    price: 1999,
    originalPrice: null,
    description: "Our signature 280 GSM heavyweight tee. Bio-washed Egyptian cotton with a boxy, structured drape and double-needle stitching engineered to last a lifetime.",
    fabric: "Egyptian Combed Cotton",
    gsm: 280,
    colors: JSON.stringify([
      { name: "Taupe", hex: "#8c8275" },
    ]),
    sizes: JSON.stringify(["XS", "S", "M", "L", "XL", "XXL"]),
    image: "/product_taupe_logo.png",
    gallery: JSON.stringify(["/product_taupe_logo.png"]),
    tag: "Bestseller"
  },
  {
    id: "p2",
    slug: "chaos-oversized-tee",
    name: "Designed to Stand Out Tee",
    collection: "Artistic",
    price: 2499,
    originalPrice: 3299,
    description: "A wearable canvas. Hand-illustrated classical motif printed with water-based pigment for a soft, vintage hand-feel that ages beautifully.",
    fabric: "Organic Ringspun Cotton",
    gsm: 240,
    colors: JSON.stringify([
      { name: "Ivory", hex: "#f3efe7" },
    ]),
    sizes: JSON.stringify(["S", "M", "L", "XL"]),
    image: "/product_white_atelier.png",
    gallery: JSON.stringify(["/product_white_atelier.png"]),
    tag: "New"
  },
  {
    id: "p3",
    slug: "metropolis-boxy-tee",
    name: "Bespoke YG Beige Tee",
    collection: "Streetwear",
    price: 2299,
    originalPrice: 2899,
    description: "Dropped shoulders, extended length, and a heavyweight body. The cornerstone of a considered streetwear wardrobe.",
    fabric: "Heavyweight French Cotton",
    gsm: 300,
    colors: JSON.stringify([
      { name: "Sand", hex: "#cbb79a" },
    ]),
    sizes: JSON.stringify(["S", "M", "L", "XL", "XXL"]),
    image: "/product_beige_yg.png",
    gallery: JSON.stringify(["/product_beige_yg.png"]),
    tag: "Bestseller"
  },
  {
    id: "p4",
    slug: "manifesto-type-tee",
    name: "Charcoal Embossed Tee",
    collection: "Typography",
    price: 2199,
    originalPrice: null,
    description: "An editorial statement piece. Archival serif typography set with magazine precision and printed in matte black ink.",
    fabric: "Combed Cotton Jersey",
    gsm: 220,
    colors: JSON.stringify([
      { name: "Ink", hex: "#101010" },
    ]),
    sizes: JSON.stringify(["XS", "S", "M", "L", "XL"]),
    image: "/product_charcoal_embossed.png",
    gallery: JSON.stringify(["/product_charcoal_embossed.png"]),
    tag: null
  },
  {
    id: "p5",
    slug: "flora-study-tee",
    name: "Line Art Face Tee",
    collection: "Nature",
    price: 2399,
    originalPrice: null,
    description: "A botanical study rendered in soft tonal pigment. Made to order with carbon-neutral shipping and recyclable packaging.",
    fabric: "Organic Slub Cotton",
    gsm: 230,
    colors: JSON.stringify([
      { name: "Bone", hex: "#ece7dd" },
    ]),
    sizes: JSON.stringify(["S", "M", "L", "XL"]),
    image: "/product_white_face.png",
    gallery: JSON.stringify(["/product_white_face.png"]),
    tag: "New"
  },
  {
    id: "p6",
    slug: "archive-no-05-drop",
    name: "Atelier Premium YG Olive Tee",
    collection: "Limited Drops",
    price: 3999,
    originalPrice: 4999,
    description: "A numbered limited edition of 200. Premium 320 GSM body, embroidered crest, and a custom woven neck label. Once it's gone, it's gone.",
    fabric: "Premium Loopback Cotton",
    gsm: 320,
    colors: JSON.stringify([
      { name: "Olive", hex: "#4b5320" },
    ]),
    sizes: JSON.stringify(["S", "M", "L", "XL"]),
    image: "/product_olive_front_y.png",
    gallery: JSON.stringify(["/product_olive_front_y.png"]),
    tag: "Limited"
  },
  {
    id: "p7",
    slug: "atelier-pocket-tee",
    name: "Classic Embossed Black Tee",
    collection: "Minimal",
    price: 1899,
    originalPrice: null,
    description: "An everyday essential refined. Reinforced chest pocket, tonal stitching, and a tailored regular fit.",
    fabric: "Pima Cotton",
    gsm: 210,
    colors: JSON.stringify([
      { name: "Onyx", hex: "#0d0d0d" },
    ]),
    sizes: JSON.stringify(["XS", "S", "M", "L", "XL", "XXL"]),
    image: "/product_black_logo.png",
    gallery: JSON.stringify(["/product_black_logo.png"]),
    tag: null
  },
  {
    id: "p8",
    slug: "kinetic-graphic-tee",
    name: "White Embossed Classic Tee",
    collection: "Artistic",
    price: 2499,
    originalPrice: null,
    description: "Abstract motion captured in pigment. A bold artistic statement on a relaxed heavyweight body.",
    fabric: "Organic Ringspun Cotton",
    gsm: 250,
    colors: JSON.stringify([
      { name: "Off White", hex: "#f0ece2" },
    ]),
    sizes: JSON.stringify(["S", "M", "L", "XL"]),
    image: "/product_white_embossed.jpg",
    gallery: JSON.stringify(["/product_white_embossed.jpg"]),
    tag: null
  }
];

async function initializeDatabase() {
  console.log(`Connecting to SQL Server 'master' database on ${server}...`);
  
  const masterConfig = {
    connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${server};Database=master;Trusted_Connection=Yes;`,
    options: { trustedConnection: true },
  };

  let pool;
  try {
    pool = await sql.connect(masterConfig);
    console.log("Checking if database exists...");
    
    const dbCheckResult = await pool.request()
      .input("dbname", sql.NVarChar(128), database)
      .query("SELECT database_id FROM sys.databases WHERE name = @dbname");

    if (dbCheckResult.recordset.length === 0) {
      console.log(`Database '${database}' does not exist. Creating it...`);
      await pool.request().query(`CREATE DATABASE [${database}]`);
      console.log(`Database '${database}' created successfully.`);
    } else {
      console.log(`Database '${database}' already exists.`);
    }
  } catch (err) {
    console.error("Error creating database:", err.message);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
    }
  }

  console.log(`Connecting to '${database}' to create tables...`);
  const dbConfig = {
    connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${server};Database=${database};Trusted_Connection=Yes;`,
    options: { trustedConnection: true },
  };

  try {
    pool = await sql.connect(dbConfig);
    
    console.log("Creating Users table if it does not exist...");
    await pool.request().query(`
      IF OBJECT_ID('Users', 'U') IS NULL
      BEGIN
        CREATE TABLE Users (
          id VARCHAR(36) PRIMARY KEY,
          name NVARCHAR(80) NOT NULL,
          email NVARCHAR(255) NOT NULL UNIQUE,
          passwordHash VARCHAR(255) NOT NULL,
          role VARCHAR(20) NOT NULL DEFAULT 'user',
          createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
          updatedAt DATETIME2 NOT NULL DEFAULT GETDATE()
        );
        CREATE UNIQUE INDEX IX_Users_Email ON Users(email);
        PRINT 'Users table created.';
      END
      ELSE
      BEGIN
        PRINT 'Users table already exists.';
      END
    `);

    console.log("Creating Designs table if it does not exist...");
    await pool.request().query(`
      IF OBJECT_ID('Designs', 'U') IS NULL
      BEGIN
        CREATE TABLE Designs (
          id VARCHAR(36) PRIMARY KEY,
          userId VARCHAR(36) NOT NULL FOREIGN KEY REFERENCES Users(id) ON DELETE CASCADE,
          name NVARCHAR(120) NOT NULL,
          garment NVARCHAR(60) NOT NULL DEFAULT 'Custom Tee',
          color NVARCHAR(60) NOT NULL DEFAULT 'Onyx',
          fabric NVARCHAR(60) NOT NULL DEFAULT 'Heavyweight 280 GSM',
          price DECIMAL(10, 2) NOT NULL DEFAULT 1499.00,
          layers NVARCHAR(MAX) NULL,
          preview VARCHAR(MAX) NULL,
          createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
          updatedAt DATETIME2 NOT NULL DEFAULT GETDATE()
        );
        CREATE INDEX IX_Designs_UserId ON Designs(userId);
        PRINT 'Designs table created.';
      END
      ELSE
      BEGIN
        PRINT 'Designs table already exists.';
      END
    `);

    console.log("Creating Products table if it does not exist...");
    await pool.request().query(`
      IF OBJECT_ID('Products', 'U') IS NULL
      BEGIN
        CREATE TABLE Products (
          id VARCHAR(36) PRIMARY KEY,
          slug NVARCHAR(120) NOT NULL UNIQUE,
          name NVARCHAR(120) NOT NULL,
          collection NVARCHAR(60) NOT NULL,
          price DECIMAL(10, 2) NOT NULL,
          originalPrice DECIMAL(10, 2) NULL,
          description NVARCHAR(MAX) NOT NULL,
          fabric NVARCHAR(120) NOT NULL,
          gsm INT NOT NULL,
          colors NVARCHAR(MAX) NOT NULL,
          sizes NVARCHAR(MAX) NOT NULL,
          image VARCHAR(MAX) NOT NULL,
          gallery NVARCHAR(MAX) NOT NULL,
          tag NVARCHAR(60) NULL,
          createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
          updatedAt DATETIME2 NOT NULL DEFAULT GETDATE()
        );
        CREATE UNIQUE INDEX IX_Products_Slug ON Products(slug);
        PRINT 'Products table created.';
      END
      ELSE
      BEGIN
        PRINT 'Products table already exists.';
      END
    `);

    console.log("Checking if Products table image column needs altering...");
    await pool.request().query(`
      IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Products') AND name = 'image' AND max_length = 500)
      BEGIN
        ALTER TABLE Products ALTER COLUMN image VARCHAR(MAX) NOT NULL;
        PRINT 'Products table image column altered to VARCHAR(MAX).';
      END
    `);

    console.log("Creating Orders table if it does not exist...");
    await pool.request().query(`
      IF OBJECT_ID('Orders', 'U') IS NULL
      BEGIN
        CREATE TABLE Orders (
          id VARCHAR(36) PRIMARY KEY,
          userId VARCHAR(36) NULL FOREIGN KEY REFERENCES Users(id) ON DELETE SET NULL,
          date DATETIME2 NOT NULL DEFAULT GETDATE(),
          subtotal DECIMAL(10, 2) NOT NULL,
          shipping DECIMAL(10, 2) NOT NULL,
          total DECIMAL(10, 2) NOT NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'Placed',
          paymentMethod VARCHAR(50) NOT NULL DEFAULT 'cod',
          paymentId VARCHAR(100) NULL,
          name NVARCHAR(120) NOT NULL,
          email NVARCHAR(255) NOT NULL,
          phone VARCHAR(20) NULL,
          carrier VARCHAR(50) NULL,
          tracking VARCHAR(100) NULL,
          createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
          updatedAt DATETIME2 NOT NULL DEFAULT GETDATE()
        );
        CREATE INDEX IX_Orders_UserId ON Orders(userId);
        PRINT 'Orders table created.';
      END
      ELSE
      BEGIN
        PRINT 'Orders table already exists.';
      END
    `);

    console.log("Creating OrderItems table if it does not exist...");
    await pool.request().query(`
      IF OBJECT_ID('OrderItems', 'U') IS NULL
      BEGIN
        CREATE TABLE OrderItems (
          id INT IDENTITY(1,1) PRIMARY KEY,
          orderId VARCHAR(36) NOT NULL FOREIGN KEY REFERENCES Orders(id) ON DELETE CASCADE,
          productId VARCHAR(36) NULL,
          name NVARCHAR(120) NOT NULL,
          price DECIMAL(10, 2) NOT NULL,
          image VARCHAR(MAX) NOT NULL,
          color NVARCHAR(60) NOT NULL,
          size NVARCHAR(10) NOT NULL,
          quantity INT NOT NULL
        );
        CREATE INDEX IX_OrderItems_OrderId ON OrderItems(orderId);
        PRINT 'OrderItems table created.';
      END
      ELSE
      BEGIN
        PRINT 'OrderItems table already exists.';
      END
    `);

    console.log("Checking if OrderItems table image column needs altering...");
    await pool.request().query(`
      IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('OrderItems') AND name = 'image' AND max_length = 500)
      BEGIN
        ALTER TABLE OrderItems ALTER COLUMN image VARCHAR(MAX) NOT NULL;
        PRINT 'OrderItems table image column altered to VARCHAR(MAX).';
      END
    `);

    // Automatic Default Product Seeding
    console.log("Seeding default products catalog...");
    await pool.request().query("DELETE FROM Products WHERE id IN ('p1','p2','p3','p4','p5','p6','p7','p8')");
    for (const p of defaultProducts) {
      await pool.request()
        .input("id", sql.VarChar(36), p.id)
        .input("slug", sql.NVarChar(120), p.slug)
        .input("name", sql.NVarChar(120), p.name)
        .input("collection", sql.NVarChar(60), p.collection)
        .input("price", sql.Decimal(10, 2), p.price)
        .input("originalPrice", sql.Decimal(10, 2), p.originalPrice)
        .input("description", sql.NVarChar(sql.MAX), p.description)
        .input("fabric", sql.NVarChar(120), p.fabric)
        .input("gsm", sql.Int, p.gsm)
        .input("colors", sql.NVarChar(sql.MAX), p.colors)
        .input("sizes", sql.NVarChar(sql.MAX), p.sizes)
        .input("image", sql.VarChar(500), p.image)
        .input("gallery", sql.NVarChar(sql.MAX), p.gallery)
        .input("tag", sql.NVarChar(60), p.tag)
        .query(`
          INSERT INTO Products (id, slug, name, collection, price, originalPrice, description, fabric, gsm, colors, sizes, image, gallery, tag, createdAt, updatedAt)
          VALUES (@id, @slug, @name, @collection, @price, @originalPrice, @description, @fabric, @gsm, @colors, @sizes, @image, @gallery, @tag, GETDATE(), GETDATE())
        `);
    }
    console.log(`✓ Seeded ${defaultProducts.length} default products.`);

    console.log("Database tables initialized successfully!");
  } catch (err) {
    console.error("Error creating tables:", err.message);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

initializeDatabase();

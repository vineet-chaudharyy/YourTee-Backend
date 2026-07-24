import sql from "mssql/msnodesqlv8.js";
import dotenv from "dotenv";

dotenv.config();

const server = process.env.SQL_SERVER || "(local)\\SQLEXPRESS";
const database = process.env.SQL_DATABASE || "YourTeeDB";

const config = {
  connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${server};Database=${database};Trusted_Connection=Yes;`,
  options: {
    trustedConnection: true,
    enableArithAbort: true,
  },
};

let pool = null;

export async function getConnection() {
  if (pool && pool.connected) return pool;
  try {
    pool = await sql.connect(config);
    
    // Auto-migration check: ensure return columns exist on Orders table
    try {
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Orders' AND COLUMN_NAME = 'returnReason')
        BEGIN
          ALTER TABLE Orders ADD returnReason NVARCHAR(500) NULL;
        END

        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Orders' AND COLUMN_NAME = 'returnImage')
        BEGIN
          ALTER TABLE Orders ADD returnImage NVARCHAR(1000) NULL;
        END

        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Orders' AND COLUMN_NAME = 'returnAddress')
        BEGIN
          ALTER TABLE Orders ADD returnAddress NVARCHAR(1000) NULL;
        END

        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Orders' AND COLUMN_NAME = 'bankDetails')
        BEGIN
          ALTER TABLE Orders ADD bankDetails NVARCHAR(1000) NULL;
        END

        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'OrderItems' AND COLUMN_NAME = 'description')
        BEGIN
          ALTER TABLE OrderItems ADD description NVARCHAR(1000) NULL;
        END

        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Products' AND COLUMN_NAME = 'stock')
        BEGIN
          ALTER TABLE Products ADD stock INT NOT NULL DEFAULT 50;
        END

        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Products' AND COLUMN_NAME = 'variantStock')
        BEGIN
          ALTER TABLE Products ADD variantStock NVARCHAR(MAX) NULL;
        END

        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'HeroSlides')
        BEGIN
          CREATE TABLE HeroSlides (
            id VARCHAR(36) PRIMARY KEY,
            eyebrow NVARCHAR(255) NOT NULL,
            title NVARCHAR(255) NOT NULL,
            description NVARCHAR(1000) NOT NULL,
            image VARCHAR(1000) NOT NULL,
            link VARCHAR(255) NOT NULL DEFAULT '/shop',
            glow VARCHAR(100) NOT NULL DEFAULT 'rgba(212,175,55,0.15)',
            watermark VARCHAR(100) NOT NULL,
            coord VARCHAR(100) NOT NULL,
            sortOrder INT NOT NULL DEFAULT 0,
            createdAt DATETIME NOT NULL DEFAULT GETDATE(),
            updatedAt DATETIME NOT NULL DEFAULT GETDATE()
          );

          INSERT INTO HeroSlides (id, eyebrow, title, description, image, link, glow, watermark, coord, sortOrder)
          VALUES 
            ('s1', 'Premium Collection', 'THE SIGNATURE CANVAS', 'Heavyweight 280 GSM washed black cotton silhouette, printed with a high-definition matte black embossed finish.', '/hero_black_embossed.png', '/shop', 'rgba(30, 30, 30, 0.45)', 'ARCHIVE 01', '[45.38° N, 12.06° E]', 0),
            ('s2', 'Atelier Series', 'THE ATELIER SILHOUETTE', 'Vintage taupe heavyweight cotton tailored with tonal contrast stitching and centered yourTee brand typography.', '/hero_taupe_studio.png', '/shop', 'rgba(212, 175, 55, 0.15)', 'ATELIER 05', '[51.50° N, 0.12° W]', 1),
            ('s3', 'Exclusive Drop', 'THE ARCHITECT SERIES', 'Geometric line art printed in fine gold ink on heavyweight cotton, designed to structural proportions.', '/hero_architect_back.jpg', '/shop', 'rgba(212, 175, 55, 0.12)', 'SERIES 03', '[35.67° N, 139.65° E]', 2);
        END
      `);

      // 1. Create table CustomizerSettings if not exists
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CustomizerSettings')
        BEGIN
          CREATE TABLE CustomizerSettings (
            id VARCHAR(36) PRIMARY KEY,
            basePrice DECIMAL(10, 2) NOT NULL DEFAULT 1499.00,
            textPrice DECIMAL(10, 2) NOT NULL DEFAULT 200.00,
            imagePrice DECIMAL(10, 2) NOT NULL DEFAULT 500.00,
            graphicPrice DECIMAL(10, 2) NOT NULL DEFAULT 150.00,
            designPrice DECIMAL(10, 2) NOT NULL DEFAULT 200.00,
            embroiderySurcharge DECIMAL(10, 2) NOT NULL DEFAULT 350.00,
            puffSurcharge DECIMAL(10, 2) NOT NULL DEFAULT 250.00,
            createdAt DATETIME NOT NULL DEFAULT GETDATE(),
            updatedAt DATETIME NOT NULL DEFAULT GETDATE()
          );

          INSERT INTO CustomizerSettings (id, basePrice, textPrice, imagePrice, graphicPrice, designPrice, embroiderySurcharge, puffSurcharge)
          VALUES ('settings-1', 1499.00, 200.00, 500.00, 150.00, 200.00, 350.00, 250.00);
        END
      `);

      // 2. Add fabric specification columns sequentially to bypass batch compilation checks
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CustomizerSettings' AND COLUMN_NAME = 'heavyCottonPrice')
        BEGIN
          ALTER TABLE CustomizerSettings ADD heavyCottonPrice DECIMAL(10, 2) NOT NULL DEFAULT 0.00;
        END
      `);

      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CustomizerSettings' AND COLUMN_NAME = 'oversizedBoxyPrice')
        BEGIN
          ALTER TABLE CustomizerSettings ADD oversizedBoxyPrice DECIMAL(10, 2) NOT NULL DEFAULT 400.00;
        END
      `);

      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CustomizerSettings' AND COLUMN_NAME = 'supimaLuxuryPrice')
        BEGIN
          ALTER TABLE CustomizerSettings ADD supimaLuxuryPrice DECIMAL(10, 2) NOT NULL DEFAULT 800.00;
        END
      `);

      // 3. Add layers and backImage columns to OrderItems for customized design details
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'OrderItems' AND COLUMN_NAME = 'layers')
        BEGIN
          ALTER TABLE OrderItems ADD layers NVARCHAR(MAX) NULL;
        END
      `);

      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'OrderItems' AND COLUMN_NAME = 'backImage')
        BEGIN
          ALTER TABLE OrderItems ADD backImage VARCHAR(MAX) NULL;
        END
      `);

    } catch (migErr) {
      console.warn("Auto-migration warning:", migErr.message);
    }

    return pool;
  } catch (err) {
    console.error("SQL Server Connection Error:", err.message);
    pool = null;
    throw err;
  }
}

export { sql };

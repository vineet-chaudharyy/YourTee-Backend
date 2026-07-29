import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

/**
 * Database layer — SQLite via the built-in node:sqlite module (requires Node 22.5+).
 *
 * The ~90 queries across the route files are written in a driver style that
 * chains `pool.request().input(name, type, value).query(text)`. This module
 * implements that interface directly rather than making every call site change,
 * and normalises the few dialect quirks those queries contain (see `translate`).
 * The type argument to .input() is accepted and ignored — SQLite is dynamically
 * typed — so existing calls keep working verbatim.
 */

const dbPath = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.resolve(process.cwd(), "data", "yourtee.db");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

let db = null;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
// All timestamps are stored as UTC ISO-8601 strings. The previous engine stored local
// time in DATETIME columns and the driver handed them back tagged as UTC,
// which previously made expired password-reset tokens read as still valid.
// Storing UTC everywhere removes that whole class of bug, and ISO strings
// compare correctly with plain `<` / `>`.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS Users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  isVerified INTEGER NOT NULL DEFAULT 0,
  verificationToken TEXT,
  resetTokenHash TEXT,
  resetTokenExpires TEXT
);

CREATE TABLE IF NOT EXISTS Designs (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  garment TEXT NOT NULL DEFAULT 'Custom Tee',
  color TEXT NOT NULL DEFAULT 'Onyx',
  fabric TEXT NOT NULL DEFAULT 'Heavyweight 280 GSM',
  price REAL NOT NULL DEFAULT 1499.00,
  layers TEXT,
  preview TEXT,
  previewBack TEXT,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS Products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  collection TEXT NOT NULL,
  price REAL NOT NULL,
  originalPrice REAL,
  description TEXT NOT NULL,
  fabric TEXT NOT NULL,
  gsm INTEGER NOT NULL,
  colors TEXT NOT NULL,
  sizes TEXT NOT NULL,
  image TEXT NOT NULL,
  gallery TEXT NOT NULL,
  tag TEXT,
  stock INTEGER NOT NULL DEFAULT 50,
  variantStock TEXT,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS Orders (
  id TEXT PRIMARY KEY,
  userId TEXT REFERENCES Users(id),
  date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  subtotal REAL NOT NULL,
  shipping REAL NOT NULL,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'Placed',
  paymentMethod TEXT NOT NULL DEFAULT 'cod',
  paymentId TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  carrier TEXT,
  tracking TEXT,
  returnReason TEXT,
  returnImage TEXT,
  returnAddress TEXT,
  bankDetails TEXT,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS OrderItems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId TEXT NOT NULL REFERENCES Orders(id) ON DELETE CASCADE,
  productId TEXT,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  image TEXT NOT NULL,
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  description TEXT,
  layers TEXT,
  backImage TEXT
);

CREATE TABLE IF NOT EXISTS HeroSlides (
  id TEXT PRIMARY KEY,
  eyebrow TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  image TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '/shop',
  glow TEXT NOT NULL DEFAULT 'rgba(212,175,55,0.15)',
  watermark TEXT NOT NULL,
  coord TEXT NOT NULL,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS CustomizerSettings (
  id TEXT PRIMARY KEY,
  basePrice REAL NOT NULL DEFAULT 1499.00,
  textPrice REAL NOT NULL DEFAULT 200.00,
  imagePrice REAL NOT NULL DEFAULT 500.00,
  graphicPrice REAL NOT NULL DEFAULT 150.00,
  designPrice REAL NOT NULL DEFAULT 200.00,
  embroiderySurcharge REAL NOT NULL DEFAULT 350.00,
  puffSurcharge REAL NOT NULL DEFAULT 250.00,
  heavyCottonPrice REAL NOT NULL DEFAULT 0.00,
  oversizedBoxyPrice REAL NOT NULL DEFAULT 400.00,
  supimaLuxuryPrice REAL NOT NULL DEFAULT 800.00,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS ContactMessages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS Reviews (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL,
  userId TEXT,
  name TEXT NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS IX_Reviews_productId ON Reviews (productId);
CREATE INDEX IF NOT EXISTS IX_Orders_userId     ON Orders (userId);
CREATE INDEX IF NOT EXISTS IX_OrderItems_order  ON OrderItems (orderId);
CREATE INDEX IF NOT EXISTS IX_Designs_userId    ON Designs (userId);
`;

const DEFAULT_HERO_SLIDES = [
  ["s1", "Premium Collection", "THE SIGNATURE CANVAS", "Heavyweight 280 GSM washed black cotton silhouette, printed with a high-definition matte black embossed finish.", "/hero_black_embossed.png", "/shop", "rgba(30, 30, 30, 0.45)", "ARCHIVE 01", "[45.38° N, 12.06° E]", 0],
  ["s2", "Atelier Series", "THE ATELIER SILHOUETTE", "Vintage taupe heavyweight cotton tailored with tonal contrast stitching and centered yourTee brand typography.", "/hero_taupe_studio.png", "/shop", "rgba(212, 175, 55, 0.15)", "ATELIER 05", "[51.50° N, 0.12° W]", 1],
  ["s3", "Exclusive Drop", "THE ARCHITECT SERIES", "Geometric line art printed in fine gold ink on heavyweight cotton, designed to structural proportions.", "/hero_architect_back.jpg", "/shop", "rgba(212, 175, 55, 0.12)", "SERIES 03", "[35.67° N, 139.65° E]", 2],
];

function bootstrap(database) {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 10000");
  database.exec(SCHEMA);

  // Seed rows that the app assumes exist.
  const heroCount = database.prepare("SELECT COUNT(*) AS n FROM HeroSlides").get().n;
  if (heroCount === 0) {
    const ins = database.prepare(`
      INSERT INTO HeroSlides (id, eyebrow, title, description, image, link, glow, watermark, coord, sortOrder)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of DEFAULT_HERO_SLIDES) ins.run(...row);
  }

  const settingsCount = database.prepare("SELECT COUNT(*) AS n FROM CustomizerSettings").get().n;
  if (settingsCount === 0) {
    database.prepare("INSERT INTO CustomizerSettings (id) VALUES ('settings-1')").run();
  }
}

// ---------------------------------------------------------------------------
// T-SQL → SQLite translation
// ---------------------------------------------------------------------------
const NOW_UTC = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export function translate(text) {
  let out = text;

  // Row-lock hints: SQLite serialises writers, so a write transaction already
  // provides what UPDLOCK/HOLDLOCK was there for.
  out = out.replace(/\bWITH\s*\(\s*(UPDLOCK|HOLDLOCK|ROWLOCK)[^)]*\)/gi, "");

  // DATEADD(minute, @p, GETUTCDATE()) → ISO string offset by @p minutes.
  out = out.replace(
    /DATEADD\s*\(\s*(\w+)\s*,\s*(@\w+|-?\d+)\s*,\s*GET(?:UTC)?DATE\(\)\s*\)/gi,
    (_m, unit, amount) =>
      `strftime('%Y-%m-%dT%H:%M:%fZ','now', '+' || ${amount} || ' ${unit.toLowerCase()}s')`
  );

  // Everything is stored UTC now, so both map to the same expression.
  out = out.replace(/GETUTCDATE\(\)/gi, NOW_UTC).replace(/GETDATE\(\)/gi, NOW_UTC);

  out = out.replace(/\bISNULL\s*\(/gi, "IFNULL(");
  out = out.replace(/\bMONTH\s*\(\s*([\w.[\]]+)\s*\)/gi, "CAST(strftime('%m', $1) AS INTEGER)");
  out = out.replace(/\bYEAR\s*\(\s*([\w.[\]]+)\s*\)/gi, "CAST(strftime('%Y', $1) AS INTEGER)");
  out = out.replace(/\bAS\s+N?VARCHAR\s*(\(\s*\w+\s*\))?/gi, "AS TEXT");

  // SELECT TOP n ... → ... LIMIT n (appended after any ORDER BY).
  const top = out.match(/\bSELECT\s+TOP\s+(\d+)\s+/i);
  if (top) {
    out = out.replace(/\bSELECT\s+TOP\s+\d+\s+/i, "SELECT ");
    out = `${out.trimEnd().replace(/;\s*$/, "")} LIMIT ${top[1]}`;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Driver interface used by the route files
// ---------------------------------------------------------------------------
class Request {
  /** Accepts a raw handle, a pool, or a Transaction — call sites pass all three. */
  constructor(source) {
    this.db = source?.db ?? source;
    this.params = {};
  }

  /** Accepts (name, type, value) or (name, value); the type is ignored. */
  input(name, typeOrValue, maybeValue) {
    const value = maybeValue === undefined ? typeOrValue : maybeValue;
    this.params[name] = normalise(value);
    return this;
  }

  query(text) {
    const sqlText = translate(text);
    // node:sqlite rejects params that aren't referenced by the statement, so
    // only pass the ones this particular query mentions.
    const used = {};
    for (const [k, v] of Object.entries(this.params)) {
      if (new RegExp(`@${k}\\b`).test(sqlText)) used[k] = v;
    }

    const statements = splitStatements(sqlText);
    let recordset = [];
    let changes = 0;

    for (const stmt of statements) {
      if (!stmt.trim()) continue;
      const prepared = this.db.prepare(stmt);
      if (isSelect(stmt)) {
        recordset = prepared.all(used);
      } else {
        const info = prepared.run(used);
        changes += Number(info.changes || 0);
      }
    }

    return Promise.resolve({ recordset, rowsAffected: [changes], recordsets: [recordset] });
  }
}

/** SQLite only accepts null/number/bigint/string/Uint8Array. */
function normalise(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && !(value instanceof Uint8Array)) return JSON.stringify(value);
  return value;
}

function isSelect(stmt) {
  return /^\s*(SELECT|WITH|PRAGMA)\b/i.test(stmt);
}

/** Splits on semicolons that aren't inside a quoted string. */
function splitStatements(text) {
  const parts = [];
  let current = "";
  let quote = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === ";") {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

class Transaction {
  constructor(pool) {
    this.db = pool.db;
    this.active = false;
  }
  async begin() {
    // IMMEDIATE takes the write lock up front, so two concurrent order
    // transactions serialise here rather than one failing at commit.
    this.db.exec("BEGIN IMMEDIATE");
    this.active = true;
  }
  async commit() {
    this.db.exec("COMMIT");
    this.active = false;
  }
  async rollback() {
    if (!this.active) return;
    this.db.exec("ROLLBACK");
    this.active = false;
  }
  request() {
    return new Request(this.db);
  }
}

// Type stubs. SQLite is dynamically typed; these exist so the existing
// `.input(name, sql.VarChar(36), value)` calls keep working untouched.
const passthroughType = () => passthroughType;
const TYPES = [
  "VarChar", "NVarChar", "Char", "NChar", "Text", "NText",
  "Int", "BigInt", "SmallInt", "TinyInt", "Bit",
  "Decimal", "Numeric", "Float", "Real", "Money",
  "DateTime", "DateTime2", "Date", "Time", "UniqueIdentifier",
];

export const sql = {
  MAX: -1,
  Request,
  Transaction,
  ...Object.fromEntries(TYPES.map((t) => [t, passthroughType])),
};

export async function getConnection() {
  if (db) return { db, request: () => new Request(db), connected: true };

  try {
    db = new DatabaseSync(dbPath);
    bootstrap(db);
    console.log(`SQLite database ready at ${dbPath}`);
    return { db, request: () => new Request(db), connected: true };
  } catch (err) {
    console.error("SQLite Connection Error:", err.message);
    db = null;
    throw err;
  }
}

export function closeConnection() {
  if (db) {
    db.close();
    db = null;
  }
}

export { dbPath };

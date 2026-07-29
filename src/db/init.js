/**
 * Seeds the default product catalogue. The schema itself is created
 * automatically on first connection (see db/index.js), so this only fills in
 * starter data for a fresh database — existing products are left untouched.
 *
 *   npm run db:init
 */
import { getConnection, sql } from "./index.js";

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

async function seedProducts() {
  const pool = await getConnection();

  const existing = await pool.request().query("SELECT id FROM Products");
  const present = new Set(existing.recordset.map((r) => r.id));

  let added = 0;
  for (const p of defaultProducts) {
    if (present.has(p.id)) continue;
    await pool
      .request()
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
    added++;
  }

  console.log(`Products: ${added} seeded, ${present.size} already present.`);
}

seedProducts()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seeding failed:", err.message);
    process.exit(1);
  });

// Temporary connectivity probe — verifies we can reach SQL Server Express.
import sql from "mssql/msnodesqlv8.js";

const config = {
  connectionString:
    "Driver={ODBC Driver 17 for SQL Server};Server=(local)\\SQLEXPRESS;Database=master;Trusted_Connection=Yes;",
  options: { trustedConnection: true },
};

try {
  const pool = await sql.connect(config);
  const r = await pool.request().query("SELECT @@VERSION AS v, DB_NAME() AS db");
  console.log("OK:", r.recordset[0].db);
  console.log(String(r.recordset[0].v).split("\n")[0]);
  await pool.close();
} catch (e) {
  console.error("FAIL:", e.message);
  process.exit(1);
}

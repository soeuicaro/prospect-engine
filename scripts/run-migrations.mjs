#!/usr/bin/env node
/**
 * Applies every file in supabase/migrations/ (in filename order) against
 * the Postgres instance at SUPABASE_DB_URL (.env.local). Intended for
 * first-time setup of a fresh Supabase project — see DEPLOYMENT.md.
 *
 * Each file runs as a single transaction; the script stops on the first
 * failure so migrations are never left half-applied.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(projectRoot, ".env.local") });

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error("SUPABASE_DB_URL not set in .env.local — see DEPLOYMENT.md.");
  process.exit(1);
}

const migrationsDir = path.join(projectRoot, "supabase", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (!files.length) {
  console.error(`No .sql files found in ${migrationsDir}`);
  process.exit(1);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  console.log(`Connected. Applying ${files.length} migration(s)...\n`);

  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    process.stdout.write(`  ${file} ... `);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("COMMIT");
      console.log("OK");
    } catch (err) {
      await client.query("ROLLBACK");
      console.log("FAILED");
      console.error(`\n${file} failed:\n${err.message}\n`);
      process.exit(1);
    }
  }

  console.log("\nAll migrations applied successfully.");
  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});

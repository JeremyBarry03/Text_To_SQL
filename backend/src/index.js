import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import pg from "pg/lib/index.js";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load envs from repo root (.env) so backend works when root file is shared.
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const PORT = process.env.PORT || 4000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const SCHEMA_CACHE_MS = 5 * 60 * 1000; // refresh schema cache every 5 minutes

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in environment.");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL in environment.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const SYSTEM_PROMPT = `You convert user requests into safe, single-statement Postgres SQL.
- Only generate SELECT queries. Never modify data or schema.
- Use ONLY the following tables and columns:
{schema}
- Prefer explicit JOINs and qualified columns where helpful.
- Add a reasonable LIMIT (<= 200) if user does not specify one.
- Return strict JSON: {"sql": "select ...", "notes": "brief rationale"} with no markdown or extra text.`;

let cachedSchema = null;
let cachedSchemaLoadedAt = 0;

async function loadSchema() {
  const now = Date.now();
  if (cachedSchema && now - cachedSchemaLoadedAt < SCHEMA_CACHE_MS) {
    return cachedSchema;
  }

  const client = await pool.connect();
  try {
    const [columns, counts] = await Promise.all([
      client.query(
        `
        SELECT table_schema, table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name, ordinal_position;
        `
      ),
      client.query(
        `
        SELECT n.nspname AS table_schema, c.relname AS table_name, c.reltuples::bigint AS est_rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema');
        `
      ),
    ]);

    const countMap = new Map();
    counts.rows.forEach((row) => {
      const key = `${row.table_schema}.${row.table_name}`;
      countMap.set(key, row.est_rows);
    });

    const tableMap = new Map();
    columns.rows.forEach((row) => {
      const key = `${row.table_schema}.${row.table_name}`;
      if (!tableMap.has(key)) {
        const est = countMap.get(key);
        const meta = est != null ? ` (est_rows ~${est})` : "";
        tableMap.set(key, { columns: [], meta });
      }
      tableMap.get(key).columns.push(`${row.column_name} (${row.data_type})`);
    });

    const schemaLines = [];
    tableMap.forEach((value, key) => {
      schemaLines.push(`${key}${value.meta}: ${value.columns.join(", ")}`);
    });

    cachedSchema = schemaLines.join("\n");
    cachedSchemaLoadedAt = now;
    return cachedSchema;
  } finally {
    client.release();
  }
}

function sanitizeSql(sql) {
  if (!sql || typeof sql !== "string") {
    throw new Error("SQL missing.");
  }
  const trimmed = sql.trim();
  const lowered = trimmed.toLowerCase();

  if (!lowered.startsWith("select")) {
    throw new Error("Only SELECT queries are allowed.");
  }

  if (trimmed.split(";").filter((s) => s.trim()).length > 1) {
    throw new Error("Multiple statements are not allowed.");
  }

  const banned = /\b(insert|update|delete|alter|drop|truncate|create|grant|revoke|comment|copy|call)\b/;
  if (banned.test(lowered)) {
    throw new Error("Query contains a forbidden operation.");
  }

  if (lowered.includes("--") || lowered.includes("/*")) {
    throw new Error("Comments are not allowed in generated SQL.");
  }

  return trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
}

async function buildSql(question) {
  const schema = await loadSchema();
  const messages = [
    { role: "system", content: SYSTEM_PROMPT.replace("{schema}", schema) },
    { role: "user", content: question },
  ];

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages,
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from model.");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error("Model returned invalid JSON.");
  }

  if (!parsed.sql) {
    throw new Error("Model did not return SQL.");
  }

  const sql = sanitizeSql(parsed.sql);
  return { sql, notes: parsed.notes || "" };
}

app.get("/health", async (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/schema", async (_req, res) => {
  try {
    const schema = await loadSchema();
    res.json({ schema });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load schema" });
  }
});

app.post("/api/query", async (req, res) => {
  const { question } = req.body || {};
  if (!question || typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "Question is required" });
  }

  try {
    const { sql, notes } = await buildSql(question.trim());
    const result = await pool.query(sql);
    res.json({ sql, notes, rows: result.rows, rowCount: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

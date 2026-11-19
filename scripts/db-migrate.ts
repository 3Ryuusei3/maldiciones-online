// Crea (o actualiza) las tablas en Neon. Lee DATABASE_URL_UNPOOLED (o DATABASE_URL) de .env.local.
//   npx tsx scripts/db-migrate.ts
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
  }),
);
const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
if (!url) throw new Error('Falta DATABASE_URL en .env.local');
const sql = neon(url);
const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
// Sentencias separadas por «;» al final de línea (el esquema no tiene funciones con «;» dentro).
const stmts = schema.split(/;\s*\n/).map((x) => x.replace(/--.*$/gm, '').trim()).filter(Boolean);
for (const q of stmts) await sql.query(q);
const tables = await sql.query(`select table_name from information_schema.tables where table_schema = 'public' order by 1`);
console.log(`${stmts.length} sentencias aplicadas. Tablas:`, tables.map((t) => t.table_name).join(', '));

/************************************************************************
 *  lib/db.js — Kết nối Neon PostgreSQL (serverless driver)
 *  Tự tạo bảng khi chạy lần đầu (CREATE TABLE IF NOT EXISTS)
 ************************************************************************/

import { neon } from '@neondatabase/serverless';

let _sql = null;
let _schemaReady = null;

export function sql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('Thiếu DATABASE_URL — khai báo connection string Neon trong biến môi trường.');
    }
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

/** Đảm bảo schema tồn tại — chỉ chạy 1 lần mỗi cold start */
export function ensureSchema() {
  if (!_schemaReady) {
    const q = sql();
    _schemaReady = (async () => {
      await q`
        CREATE TABLE IF NOT EXISTS matches (
          id          TEXT PRIMARY KEY,
          date_utc    TIMESTAMPTZ NOT NULL,
          stage       TEXT NOT NULL DEFAULT 'Vòng bảng',
          group_name  TEXT NOT NULL DEFAULT '',
          home        TEXT NOT NULL,
          away        TEXT NOT NULL,
          home_goals  INTEGER,
          away_goals  INTEGER,
          status      TEXT NOT NULL DEFAULT 'Sắp diễn ra',
          venue       TEXT NOT NULL DEFAULT '',
          city        TEXT NOT NULL DEFAULT '',
          attendance  INTEGER,
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await q`
        CREATE TABLE IF NOT EXISTS predictions (
          match_id    TEXT PRIMARY KEY,
          pred_home   INTEGER NOT NULL,
          pred_away   INTEGER NOT NULL,
          prob_home   INTEGER NOT NULL,
          prob_draw   INTEGER NOT NULL,
          prob_away   INTEGER NOT NULL,
          comment     TEXT NOT NULL DEFAULT '',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await q`
        CREATE TABLE IF NOT EXISTS match_details (
          match_id    TEXT PRIMARY KEY,
          summary     TEXT NOT NULL DEFAULT '',
          events      JSONB NOT NULL DEFAULT '[]'::jsonb,
          status      TEXT NOT NULL DEFAULT '',
          generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await q`
        CREATE TABLE IF NOT EXISTS meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`;
      await q`CREATE INDEX IF NOT EXISTS idx_matches_date ON matches (date_utc)`;
    })();
  }
  return _schemaReady;
}

export async function getMeta(key) {
  const rows = await sql()`SELECT value FROM meta WHERE key = ${key}`;
  return rows.length ? rows[0].value : null;
}

export async function setMeta(key, value) {
  await sql()`
    INSERT INTO meta (key, value) VALUES (${key}, ${String(value)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}
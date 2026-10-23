-- Cloudflare D1 Database Schema for HiGroces
-- Run this in Cloudflare Dashboard -> Workers & Pages -> D1 -> Console
-- Or via CLI: npx wrangler d1 execute higroces-db --file=./schema.sql

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  special_notes TEXT,
  items TEXT NOT NULL,
  subtotal REAL NOT NULL,
  delivery_fee REAL NOT NULL,
  total_price REAL NOT NULL,
  status TEXT DEFAULT 'pending',
  delivery_zone TEXT,
  rider_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_zone_status ON orders(delivery_zone, status);
CREATE INDEX IF NOT EXISTS idx_orders_rider_status ON orders(rider_name, status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

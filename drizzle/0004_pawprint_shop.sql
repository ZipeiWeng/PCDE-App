CREATE TABLE shop_accounts (
  account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  lock_token TEXT,
  lock_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,mode)
);
--> statement-breakpoint
CREATE TABLE shop_orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  product_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  shipping_rate_id TEXT NOT NULL,
  shipping_countries TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity=1),
  unit_amount INTEGER NOT NULL,
  shipping_amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  checkout_session_id TEXT UNIQUE,
  payment_intent_id TEXT UNIQUE,
  checkout_origin TEXT NOT NULL,
  checkout_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  verified_at INTEGER,
  paid_at INTEGER,
  refunded_amount INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX shop_orders_owner ON shop_orders(account_id,mode,created_at DESC);
--> statement-breakpoint
CREATE TABLE shop_events (
  event_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  order_id TEXT NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  received_at INTEGER NOT NULL,
  PRIMARY KEY(event_id,mode)
);

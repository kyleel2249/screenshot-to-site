-- Dera Darko Trade — core relational schema (SQLite / Cloudflare D1 dialect).
-- All money columns are INTEGER minor units with an explicit currency. Orders store immutable snapshots.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('customer','staff')), status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  email_verified_at TEXT, mfa_secret_enc TEXT, last_login_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE permissions (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE);
CREATE TABLE role_permissions (role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE, permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE, PRIMARY KEY (role_id, permission_id));
CREATE TABLE user_roles (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role_id TEXT NOT NULL REFERENCES roles(id), PRIMARY KEY (user_id, role_id));
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE password_resets (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, used_at TEXT);
CREATE TABLE email_verifications (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, used_at TEXT);
-- Single-row table: once closed, initial administrator enrolment can never run again.
CREATE TABLE admin_setup (id INTEGER PRIMARY KEY CHECK (id = 1), closed_at TEXT);
INSERT INTO admin_setup (id, closed_at) VALUES (1, NULL);

CREATE TABLE customer_profiles (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, first_name TEXT, last_name TEXT, phone TEXT, preferred_currency TEXT CHECK (preferred_currency IN ('GHS','USD')), preferred_contact TEXT, marketing_consent_at TEXT);
CREATE TABLE addresses (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, label TEXT, recipient TEXT NOT NULL, phone TEXT, country TEXT NOT NULL, region TEXT NOT NULL, city TEXT NOT NULL, street TEXT NOT NULL, postal_code TEXT, instructions TEXT, is_default INTEGER NOT NULL DEFAULT 0);
CREATE TABLE consent_records (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, kind TEXT NOT NULL, granted INTEGER NOT NULL, policy_version TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE categories (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, parent_id TEXT REFERENCES categories(id), description TEXT, position INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 1, filter_profile TEXT NOT NULL DEFAULT 'general');
CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE TABLE brands (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
CREATE TABLE products (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, short_description TEXT, description TEXT, brand_id TEXT REFERENCES brands(id),
  primary_category_id TEXT NOT NULL REFERENCES categories(id), supplier_ref TEXT,
  availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available','pre_order','out_of_stock','coming_soon','temporarily_unavailable','discontinued')),
  published INTEGER NOT NULL DEFAULT 0, publish_at TEXT, preorder_enabled INTEGER NOT NULL DEFAULT 0, preorder_window TEXT, preorder_limit INTEGER,
  show_limited_below INTEGER, attributes_json TEXT NOT NULL DEFAULT '{}', seo_title TEXT, meta_description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_products_category ON products(primary_category_id);
CREATE TABLE product_categories (product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE, PRIMARY KEY (product_id, category_id));
CREATE TABLE product_promos (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, label TEXT NOT NULL CHECK (label IN ('featured','just_landed','new_arrival','best_seller','limited_stock','on_sale')), starts_at TEXT, ends_at TEXT);
CREATE TABLE product_images (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, url TEXT NOT NULL, alt TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, is_primary INTEGER NOT NULL DEFAULT 0);
CREATE TABLE product_variants (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  price_ghs INTEGER CHECK (price_ghs IS NULL OR price_ghs >= 0), price_usd INTEGER CHECK (price_usd IS NULL OR price_usd >= 0),
  sale_price_ghs INTEGER, sale_price_usd INTEGER, sale_starts_at TEXT, sale_ends_at TEXT, cost_price_ghs INTEGER,
  track_inventory INTEGER NOT NULL DEFAULT 1, on_hand INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0), reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  allow_backorder INTEGER NOT NULL DEFAULT 0, low_stock_threshold INTEGER, weight_grams INTEGER NOT NULL DEFAULT 0, options_json TEXT NOT NULL DEFAULT '{}',
  CHECK (reserved <= on_hand OR allow_backorder = 1)
);
CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, variant_id TEXT NOT NULL REFERENCES product_variants(id), delta INTEGER NOT NULL, reason TEXT NOT NULL, actor_id TEXT REFERENCES users(id), order_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_by TEXT REFERENCES users(id), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE exchange_rates (id INTEGER PRIMARY KEY AUTOINCREMENT, ghs_per_usd_micro INTEGER NOT NULL CHECK (ghs_per_usd_micro > 0), source TEXT NOT NULL, effective_date TEXT NOT NULL, created_by TEXT REFERENCES users(id));
CREATE TABLE shipping_zones (id TEXT PRIMARY KEY, name TEXT NOT NULL, regions_json TEXT NOT NULL, currency TEXT NOT NULL CHECK (currency IN ('GHS','USD')), base_fee INTEGER NOT NULL, per_kg_fee INTEGER NOT NULL DEFAULT 0, free_over INTEGER, estimate TEXT NOT NULL, quotation_only INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE discounts (
  code TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('percent','fixed','free_shipping')), value INTEGER NOT NULL DEFAULT 0, currency TEXT CHECK (currency IN ('GHS','USD')),
  starts_at TEXT, ends_at TEXT, min_subtotal INTEGER, max_redemptions INTEGER, redeemed INTEGER NOT NULL DEFAULT 0, per_customer_limit INTEGER,
  first_purchase_only INTEGER NOT NULL DEFAULT 0, eligible_currencies_json TEXT, eligible_category_ids_json TEXT, active INTEGER NOT NULL DEFAULT 1,
  CHECK (kind <> 'fixed' OR currency IS NOT NULL)
);

CREATE TABLE carts (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, anon_token_hash TEXT UNIQUE, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE cart_items (cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE, variant_id TEXT NOT NULL REFERENCES product_variants(id), qty INTEGER NOT NULL CHECK (qty > 0), PRIMARY KEY (cart_id, variant_id));
CREATE TABLE wishlist_items (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, PRIMARY KEY (user_id, product_id));

CREATE TABLE orders (
  id TEXT PRIMARY KEY, ref TEXT NOT NULL UNIQUE, user_id TEXT REFERENCES users(id), guest_email TEXT, idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending_payment', currency TEXT NOT NULL CHECK (currency IN ('GHS','USD')),
  subtotal INTEGER NOT NULL, discount_total INTEGER NOT NULL DEFAULT 0, shipping_total INTEGER NOT NULL DEFAULT 0, tax_total INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
  discount_code TEXT, shipping_address_json TEXT NOT NULL, policy_version TEXT, has_preorder INTEGER NOT NULL DEFAULT 0,
  tracking_secret_hash TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, variant_id TEXT NOT NULL, name_snapshot TEXT NOT NULL, sku_snapshot TEXT NOT NULL, unit_price INTEGER NOT NULL, qty INTEGER NOT NULL CHECK (qty > 0), line_total INTEGER NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('stock','preorder','backorder')));
CREATE TABLE order_status_history (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, from_status TEXT, to_status TEXT NOT NULL, actor_id TEXT REFERENCES users(id), note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE payment_attempts (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), provider TEXT NOT NULL, provider_ref TEXT, amount INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')));
-- Provider event ids are unique: duplicate webhooks cannot be processed twice.
CREATE TABLE payment_events (provider TEXT NOT NULL, event_id TEXT NOT NULL, order_ref TEXT, amount INTEGER, currency TEXT, outcome TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (provider, event_id));
CREATE TABLE refunds (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), amount INTEGER NOT NULL CHECK (amount > 0), currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', actor_id TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE deliveries (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), courier TEXT, tracking_ref TEXT, dispatched_at TEXT, delivered_at TEXT);
CREATE TABLE delivery_events (id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE, status TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE return_requests (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), user_id TEXT REFERENCES users(id), reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'requested', created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE reviews (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5), body TEXT, verified_purchase INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')));
CREATE TABLE support_tickets (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), email TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE support_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE, author_id TEXT, internal INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE newsletter_subscriptions (email TEXT PRIMARY KEY COLLATE NOCASE, confirmed_at TEXT, unsubscribed_at TEXT);
CREATE TABLE notification_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, template TEXT NOT NULL, recipient_ref TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE content_pages (slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE policy_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, version TEXT NOT NULL, effective_at TEXT NOT NULL, body TEXT NOT NULL, UNIQUE (slug, version));
CREATE TABLE policy_acceptances (user_id TEXT, order_id TEXT, slug TEXT NOT NULL, version TEXT NOT NULL, accepted_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE analytics_events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_pseudonym TEXT NOT NULL, kind TEXT NOT NULL, path TEXT, utm_source TEXT, utm_campaign TEXT, props_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
-- Audit log: append-only; never stores passwords, tokens or payment secrets.
CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, event TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}', ip_hash TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

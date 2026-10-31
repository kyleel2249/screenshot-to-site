-- AI product image generation metadata (no Canva).
-- Extends product_images; adds generation job tracking.
PRAGMA foreign_keys = ON;

-- Source + angle on existing product images (nullable for legacy rows).
ALTER TABLE product_images ADD COLUMN source TEXT DEFAULT 'owner_upload'
  CHECK (source IS NULL OR source IN ('verified_supplier','manufacturer','ai_generated','owner_upload','awaiting_approval'));
ALTER TABLE product_images ADD COLUMN angle TEXT DEFAULT 'primary'
  CHECK (angle IS NULL OR angle IN ('primary','front','side','rear','detail','lifestyle','packaging','promotional'));
ALTER TABLE product_images ADD COLUMN generation_json TEXT; -- provider, model, prompt, timestamps
ALTER TABLE product_images ADD COLUMN approved_at TEXT;
ALTER TABLE product_images ADD COLUMN approved_by TEXT;
ALTER TABLE product_images ADD COLUMN replaced_by TEXT;

CREATE TABLE IF NOT EXISTS image_generation_jobs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  angle TEXT NOT NULL DEFAULT 'primary',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','queued','processing','generated','awaiting_approval','approved','rejected','exported','uploaded','linked','failed')),
  provider TEXT,
  prompt TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  image_id TEXT REFERENCES product_images(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_image_jobs_product ON image_generation_jobs(product_id);
CREATE INDEX IF NOT EXISTS idx_image_jobs_status ON image_generation_jobs(status);

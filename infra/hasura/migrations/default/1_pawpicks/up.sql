CREATE TABLE pawpicks_products (
  asin        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  brand       TEXT,
  slug        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pawpicks_stock_checks (
  id          BIGSERIAL PRIMARY KEY,
  asin        TEXT NOT NULL REFERENCES pawpicks_products(asin),
  status      TEXT NOT NULL CHECK (status IN ('in_stock', 'out_of_stock', 'dead', 'unknown', 'error')),  -- enforced enum
  price       NUMERIC(10,2),
  error       TEXT,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_checks_asin_checked ON pawpicks_stock_checks(asin, checked_at DESC);

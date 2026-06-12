-- ================================================================
--  IMS Pro — Supabase Complete Setup SQL
--  Run this ENTIRE file once in Supabase SQL Editor
--  Project: Inventory Management System
--  Tables mapped:
--    Closing_Stock      → closing_stock
--    Latest_Stock       → latest_stock
--    In/Out (Manual)    → in_out_manual
--    Safety_factor      → safety_factor  (VIEW — auto-calculated)
-- ================================================================

-- ── STEP 0: Extensions ───────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================================
--  TABLE 1: closing_stock
--  Mirrors "Closing_Stock" sheet
--  Columns: Date | SKU | Item Name | UNIT | Department | Status | Quantity | STOCK VALUE
-- ================================================================
DROP TABLE IF EXISTS closing_stock CASCADE;

CREATE TABLE closing_stock (
    id            BIGSERIAL       PRIMARY KEY,
    date          DATE,
    sku           TEXT            NOT NULL,
    item_name     TEXT,
    unit          TEXT,
    department    TEXT,
    status        TEXT            DEFAULT 'Active',
    quantity      NUMERIC(15,4)   DEFAULT 0,
    stock_value   NUMERIC(15,2)   DEFAULT 0,
    -- Computed column: price = stock_value / quantity
    price         NUMERIC(15,4)   GENERATED ALWAYS AS (
                      CASE WHEN quantity > 0 THEN stock_value / quantity ELSE 0 END
                  ) STORED,
    created_at    TIMESTAMPTZ     DEFAULT NOW(),
    updated_at    TIMESTAMPTZ     DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_cs_sku        ON closing_stock(sku);
CREATE INDEX idx_cs_dept       ON closing_stock(department);
CREATE INDEX idx_cs_date       ON closing_stock(date);
CREATE INDEX idx_cs_sku_lower  ON closing_stock(LOWER(sku));

COMMENT ON TABLE closing_stock IS 'Mirrors Google Sheets "Closing_Stock" tab. Stores initial/opening stock entries.';

-- ================================================================
--  TABLE 2: latest_stock
--  Mirrors "Latest_Stock" sheet
-- ================================================================
DROP TABLE IF EXISTS latest_stock CASCADE;

CREATE TABLE latest_stock (
    id                      BIGSERIAL       PRIMARY KEY,
    sku                     TEXT            UNIQUE NOT NULL,
    item_name               TEXT,
    unit                    TEXT,
    department              TEXT,
    quantity                NUMERIC(15,4)   DEFAULT 0,
    stock_value             NUMERIC(15,2)   DEFAULT 0,
    price                   NUMERIC(15,4)   DEFAULT 0,
    avg_daily_consumption   NUMERIC(15,6)   DEFAULT 0,   -- Column H
    lead_time               NUMERIC(10,2)   DEFAULT 7,   -- Column I (fixed 7 days)
    safety_factor           NUMERIC(15,4)   DEFAULT 0,   -- Column J
    moq                     NUMERIC(15,2)   DEFAULT 0,   -- Column K (Reorder Point)
    max_level               NUMERIC(15,2)   DEFAULT 0,   -- Column L
    created_at              TIMESTAMPTZ     DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     DEFAULT NOW(),
    last_updated            TIMESTAMPTZ     DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_ls_sku        ON latest_stock(sku);
CREATE INDEX idx_ls_dept       ON latest_stock(department);
CREATE INDEX idx_ls_qty        ON latest_stock(quantity);
CREATE INDEX idx_ls_val        ON latest_stock(stock_value);
CREATE INDEX idx_ls_sf         ON latest_stock(safety_factor);
CREATE INDEX idx_ls_sku_lower  ON latest_stock(LOWER(sku));

COMMENT ON TABLE latest_stock IS 'Master inventory table.';

-- ================================================================
--  TABLE 3: in_out_manual
--  Mirrors "In/Out (Manual)" sheet
-- ================================================================
DROP TABLE IF EXISTS in_out_manual CASCADE;

CREATE TABLE in_out_manual (
    id            BIGSERIAL       PRIMARY KEY,
    timestamp     TIMESTAMPTZ     DEFAULT NOW(),
    sku           TEXT            NOT NULL,
    in_out        TEXT            NOT NULL CHECK (in_out IN ('In', 'Out')),
    date          DATE,
    quantity      NUMERIC(15,4)   DEFAULT 0,
    item_name     TEXT,
    stock_value   NUMERIC(15,2)   DEFAULT 0,
    department    TEXT,
    created_at    TIMESTAMPTZ     DEFAULT NOW(),
    updated_at    TIMESTAMPTZ     DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_io_sku       ON in_out_manual(sku);
CREATE INDEX idx_io_date      ON in_out_manual(date);
CREATE INDEX idx_io_type      ON in_out_manual(in_out);
CREATE INDEX idx_io_dept      ON in_out_manual(department);
CREATE INDEX idx_io_ts        ON in_out_manual(timestamp DESC);
CREATE INDEX idx_io_sku_lower ON in_out_manual(LOWER(sku));

COMMENT ON TABLE in_out_manual IS 'All stock movement transactions.';

-- ================================================================
--  VIEW: safety_factor
-- ================================================================
DROP VIEW IF EXISTS safety_factor;

CREATE OR REPLACE VIEW safety_factor AS
SELECT
    sku,
    item_name,
    unit,
    department,
    quantity,
    stock_value,
    price,
    avg_daily_consumption,
    lead_time,
    safety_factor,
    moq,
    max_level
FROM latest_stock
WHERE safety_factor > 0
  AND safety_factor >= quantity;

-- ================================================================
--  TRIGGER FUNCTION: auto-update updated_at on any UPDATE
-- ================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach to all tables
CREATE TRIGGER trg_cs_updated_at
    BEFORE UPDATE ON closing_stock
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_ls_updated_at
    BEFORE UPDATE ON latest_stock
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_io_updated_at
    BEFORE UPDATE ON in_out_manual
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ==========================================================
-- LIVE INVENTORY CALCULATION VIEW
-- ==========================================================
CREATE OR REPLACE VIEW v_live_inventory_report AS
WITH 
-- A: Get distinct SKUs from all tables to create a complete master directory
all_skus AS (
    SELECT DISTINCT sku FROM item_master
    UNION
    SELECT DISTINCT sku FROM closing_stock
    UNION
    SELECT DISTINCT sku FROM in_out_manual
    UNION
    SELECT DISTINCT sku FROM latest_stock
),

-- B: For each unique SKU, let's resolve its details by coalescing from item_master, closing_stock, then in_out_manual, then latest_stock
sku_details AS (
    SELECT 
        s.sku,
        COALESCE(im.item_name, lc.item_name, lm.item_name, ls.item_name, '') as item_name,
        COALESCE(im.unit, lc.unit, ls.unit, 'Nos') as unit,
        COALESCE(im.department, lc.department, lm.department, ls.department, 'General Store') as department,
        -- Average unit price logic
        COALESCE(
            CASE WHEN (im.price IS NOT NULL AND im.price > 0) THEN im.price ELSE NULL END,
            CASE WHEN lc.quantity > 0 THEN lc.stock_value / lc.quantity ELSE NULL END,
            CASE WHEN lm.quantity > 0 THEN lm.stock_value / lm.quantity ELSE NULL END,
            ls.price,
            0
        ) as master_price
    FROM all_skus s
    LEFT OUTER JOIN item_master im ON s.sku = im.sku
    LEFT JOIN (
        SELECT DISTINCT ON (sku) sku, item_name, unit, department, quantity, stock_value
        FROM closing_stock
        ORDER BY sku, date DESC, id DESC
    ) lc ON s.sku = lc.sku
    LEFT JOIN (
        SELECT DISTINCT ON (sku) sku, item_name, department, quantity, stock_value
        FROM in_out_manual
        ORDER BY sku, timestamp DESC, id DESC
    ) lm ON s.sku = lm.sku
    LEFT JOIN latest_stock ls ON s.sku = ls.sku
),

-- C. Get the most recent closing stock for every SKU
latest_closing AS (
    SELECT DISTINCT ON (sku) 
        sku, quantity, stock_value
    FROM closing_stock
    ORDER BY sku, date DESC, id DESC
),

-- D. Get all manual In/Out totals
manual_totals AS (
    SELECT 
        sku,
        SUM(CASE WHEN in_out = 'In' THEN quantity ELSE 0 END) as total_in,
        SUM(CASE WHEN in_out = 'Out' THEN quantity ELSE 0 END) as total_out
    FROM in_out_manual
    GROUP BY sku
),

-- E. Calculate Average Daily Consumption (ADC)
consumption_calc AS (
    SELECT 
        sku,
        SUM(quantity) as total_consumed,
        GREATEST((MAX(timestamp)::DATE - MIN(timestamp)::DATE) + 1, 1) as days_count
    FROM in_out_manual
    WHERE in_out = 'Out'
    GROUP BY sku
),

-- F. The Master Calculation Stage
calculation_stage AS (
    SELECT 
        sd.sku,
        sd.item_name,
        sd.unit,
        sd.department,
        sd.master_price,
        -- Qty: Closing + In - Out
        (COALESCE(lc.quantity, 0) + COALESCE(mt.total_in, 0) - COALESCE(mt.total_out, 0)) AS calc_qty,
        -- ADC
        COALESCE(cc.total_consumed / cc.days_count, 0) AS calc_adc
    FROM sku_details sd
    LEFT JOIN latest_closing lc ON sd.sku = lc.sku
    LEFT JOIN manual_totals mt ON sd.sku = mt.sku
    LEFT JOIN consumption_calc cc ON sd.sku = cc.sku
),

-- G. Final Math Application
final_math AS (
    SELECT 
        cs.*,
        -- Stock Value = Qty * Price
        (cs.calc_qty * cs.master_price) AS calc_stock_value,
        -- Safety Factor: 2.0 if value > 100,000, else 1.5
        CASE 
            WHEN (cs.calc_qty * cs.master_price) > 100000 THEN 2.0 
            ELSE 1.5 
        END AS calc_sf
    FROM calculation_stage cs
)

-- H. Final Output with MOQ and Max Level
SELECT 
    sku,
    item_name,
    unit,
    department,
    calc_qty AS quantity,
    calc_stock_value AS stock_value,
    master_price AS price,
    calc_adc AS avg_daily_consumption,
    7 AS lead_time,
    calc_sf AS safety_factor,
    -- MOQ = (ADC * Lead Time) + Safety Stock + 5
    -- Safety Stock = (ADC * Lead Time * (SF - 1))
    ((calc_adc * 7) + (calc_adc * 7 * (calc_sf - 1)) + 5) AS moq,
    -- Max Level = MOQ + 5
    (((calc_adc * 7) + (calc_adc * 7 * (calc_sf - 1)) + 5) + 5) AS max_level
FROM final_math;


-- ==========================================================
-- THE CALCULATION ENGINE (FUNCTION)
-- ==========================================================
CREATE OR REPLACE FUNCTION sync_inventory_logic()
RETURNS void AS $$
BEGIN
    -- Use an UPSERT to refresh the data in latest_stock
    INSERT INTO latest_stock (
        sku, item_name, unit, department, quantity, stock_value, 
        price, avg_daily_consumption, lead_time, safety_factor, moq, max_level, last_updated
    )
    WITH 
    -- STEP A: Find all distinct SKUs in any table
    all_skus AS (
        SELECT DISTINCT sku FROM item_master
        UNION
        SELECT DISTINCT sku FROM closing_stock
        UNION
        SELECT DISTINCT sku FROM in_out_manual
        UNION
        SELECT DISTINCT sku FROM latest_stock
    ),

    -- STEP B: For each SKU, resolve the standard item details
    sku_details AS (
        SELECT 
            s.sku,
            COALESCE(im.item_name, lc.item_name, lm.item_name, ls.item_name, '') as item_name,
            COALESCE(im.unit, lc.unit, ls.unit, 'Nos') as unit,
            COALESCE(im.department, lc.department, lm.department, ls.department, 'General Store') as department,
            -- Price calculation: closing stock average price if available, else latest manual transaction price, else latest stock price
            COALESCE(
                CASE WHEN (im.price IS NOT NULL AND im.price > 0) THEN im.price ELSE NULL END,
                CASE WHEN lc.quantity > 0 THEN lc.stock_value / lc.quantity ELSE NULL END,
                CASE WHEN lm.quantity > 0 THEN lm.stock_value / lm.quantity ELSE NULL END,
                ls.price,
                0
            ) as master_price
        FROM all_skus s
        LEFT OUTER JOIN item_master im ON s.sku = im.sku
        LEFT JOIN (
            SELECT DISTINCT ON (sku) sku, item_name, unit, department, quantity, stock_value
            FROM closing_stock
            ORDER BY sku, date DESC, id DESC
        ) lc ON s.sku = lc.sku
        LEFT JOIN (
            SELECT DISTINCT ON (sku) sku, item_name, department, quantity, stock_value
            FROM in_out_manual
            ORDER BY sku, timestamp DESC, id DESC
        ) lm ON s.sku = lm.sku
        LEFT JOIN latest_stock ls ON s.sku = ls.sku
    ),

    -- STEP C: Get the most recent closing stock for every SKU
    latest_closing AS (
        SELECT DISTINCT ON (sku) 
            sku, quantity, stock_value
        FROM closing_stock
        ORDER BY sku, date DESC, id DESC
    ),

    -- STEP D: Calculate total "In" and total "Out" from manual table
    manual_totals AS (
        SELECT 
            sku,
            SUM(CASE WHEN in_out = 'In' THEN quantity ELSE 0 END) as total_in,
            SUM(CASE WHEN in_out = 'Out' THEN quantity ELSE 0 END) as total_out
        FROM in_out_manual
        GROUP BY sku
    ),

    -- STEP E: Calculate Average Daily Consumption
    consumption_calc AS (
        SELECT 
            sku,
            SUM(quantity) as total_consumed,
            GREATEST((MAX(timestamp)::DATE - MIN(timestamp)::DATE) + 1, 1) as days_count
        FROM in_out_manual
        WHERE in_out = 'Out'
        GROUP BY sku
    ),

    -- STEP F: The Main Math Engine
    calculation_stage AS (
        SELECT 
            sd.sku,
            sd.item_name,
            sd.unit,
            sd.department,
            sd.master_price,
            (COALESCE(lc.quantity, 0) + COALESCE(mt.total_in, 0) - COALESCE(mt.total_out, 0)) as calc_qty,
            COALESCE(cc.total_consumed / cc.days_count, 0) as calc_avg_cons
        FROM sku_details sd
        LEFT JOIN latest_closing lc ON sd.sku = lc.sku
        LEFT JOIN manual_totals mt ON sd.sku = mt.sku
        LEFT JOIN consumption_calc cc ON sd.sku = cc.sku
    )

    SELECT 
        cs.sku,
        cs.item_name,
        cs.unit,
        cs.department,
        cs.calc_qty as quantity,
        (cs.calc_qty * cs.master_price) as stock_value,
        cs.master_price as price,
        cs.calc_avg_cons as avg_daily_consumption,
        7 as lead_time,
        CASE WHEN (cs.calc_qty * cs.master_price) > 100000 THEN 2.0 ELSE 1.5 END as safety_factor,
        (COALESCE(cs.calc_avg_cons, 0) * 7 * CASE WHEN (cs.calc_qty * cs.master_price) > 100000 THEN 2.0 ELSE 1.5 END) + 5 as moq,
        ((COALESCE(cs.calc_avg_cons, 0) * 7 * CASE WHEN (cs.calc_qty * cs.master_price) > 100000 THEN 2.0 ELSE 1.5 END) + 5) + 5 as max_level,
        NOW() as last_updated
    FROM calculation_stage cs

    ON CONFLICT (sku) DO UPDATE SET
        item_name = EXCLUDED.item_name,
        unit = EXCLUDED.unit,
        department = EXCLUDED.department,
        quantity = EXCLUDED.quantity,
        stock_value = EXCLUDED.stock_value,
        price = EXCLUDED.price,
        avg_daily_consumption = EXCLUDED.avg_daily_consumption,
        lead_time = EXCLUDED.lead_time,
        safety_factor = EXCLUDED.safety_factor,
        moq = EXCLUDED.moq,
        max_level = EXCLUDED.max_level,
        last_updated = NOW();
    
END;
$$ LANGUAGE plpgsql;


-- ==========================================================
-- MASTER CALCULATION TRIGGER
-- ==========================================================
CREATE OR REPLACE FUNCTION run_all_calculations()
RETURNS TEXT AS $$
DECLARE
    v_start TIMESTAMPTZ := NOW();
BEGIN
    PERFORM sync_inventory_logic();
    RETURN format('All stock calculations updated. Duration: %s ms. Timestamp: %s',
        (EXTRACT(epoch FROM (NOW() - v_start)) * 1000)::INT,
        to_char(NOW(), 'DD/MM/YYYY HH24:MI:SS')
    );
END;
$$ LANGUAGE plpgsql;


-- ==========================================================
-- AUTO-TRIGGER FUNCTION (Runs on Every Transaction)
-- ==========================================================
CREATE OR REPLACE FUNCTION auto_sync_inventory()
RETURNS trigger AS $$
BEGIN
    PERFORM sync_inventory_logic();
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger that fires AFTER any INSERT, UPDATE, or DELETE
DROP TRIGGER IF EXISTS trigger_auto_sync_inventory ON in_out_manual;
CREATE TRIGGER trigger_auto_sync_inventory
    AFTER INSERT OR UPDATE OR DELETE ON in_out_manual
    FOR EACH STATEMENT
    EXECUTE FUNCTION auto_sync_inventory();

-- Row level security
ALTER TABLE closing_stock  DISABLE ROW LEVEL SECURITY;
ALTER TABLE latest_stock   DISABLE ROW LEVEL SECURITY;
ALTER TABLE in_out_manual  DISABLE ROW LEVEL SECURITY;

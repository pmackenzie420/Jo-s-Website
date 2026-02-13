
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: true,
        ca: isProduction
            ? fs.readFileSync('/etc/secrets/supabase-ca.crt').toString()
            : fs.readFileSync(path.join(__dirname, 'certs/supabase-ca.crt')).toString()
    }
});

async function migrate() {
    try {
        console.log("Starting Pickups Migration...");

        // Create pickup_dates table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pickup_dates (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                date_value DATE NOT NULL,
                location TEXT,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("Created table: pickup_dates");

        await pool.query(`
            ALTER TABLE pickup_dates
            ADD COLUMN IF NOT EXISTS location TEXT
        `);
        await pool.query(`
            UPDATE pickup_dates
            SET location = 'hemmingford'
            WHERE location IS NULL
        `);
        await pool.query(`
            ALTER TABLE pickup_dates
            ALTER COLUMN location SET NOT NULL
        `);

        await pool.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                      AND table_name = 'pickup_stock'
                ) THEN
                    WITH canonical_dates AS (
                        SELECT DISTINCT ON (date_value, location)
                            id AS canonical_id,
                            date_value,
                            location
                        FROM pickup_dates
                        ORDER BY date_value, location, created_at ASC, id ASC
                    ),
                    duplicate_dates AS (
                        SELECT
                            pickup_dates.id AS duplicate_id,
                            canonical_dates.canonical_id
                        FROM pickup_dates
                        INNER JOIN canonical_dates
                            ON canonical_dates.date_value = pickup_dates.date_value
                            AND canonical_dates.location = pickup_dates.location
                    ),
                    consolidated_stock AS (
                        SELECT
                            duplicate_dates.canonical_id AS pickup_date_id,
                            pickup_stock.hen_id,
                            MIN(pickup_stock.stock) AS stock
                        FROM duplicate_dates
                        INNER JOIN pickup_stock
                            ON pickup_stock.pickup_date_id = duplicate_dates.duplicate_id
                        GROUP BY duplicate_dates.canonical_id, pickup_stock.hen_id
                    )
                    INSERT INTO pickup_stock (pickup_date_id, hen_id, stock)
                    SELECT pickup_date_id, hen_id, stock
                    FROM consolidated_stock
                    ON CONFLICT (pickup_date_id, hen_id)
                    DO UPDATE SET stock = LEAST(pickup_stock.stock, EXCLUDED.stock);
                END IF;
            END $$;
        `);

        await pool.query(`
            WITH ranked_dates AS (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY date_value, location
                        ORDER BY created_at ASC, id ASC
                    ) AS row_number
                FROM pickup_dates
            )
            DELETE FROM pickup_dates
            WHERE id IN (
                SELECT id
                FROM ranked_dates
                WHERE row_number > 1
            )
        `);

        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS pickup_dates_date_location_unique_idx
            ON pickup_dates (date_value, location)
        `);

        // Insert dummy dates if empty
        const count = await pool.query('SELECT count(*) FROM pickup_dates');
        if (parseInt(count.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO pickup_dates (date_value, location) VALUES 
                ('2025-05-20', 'hemmingford'),
                ('2025-06-01', 'hemmingford'),
                ('2025-06-15', 'hemmingford')
                ON CONFLICT (date_value, location) DO NOTHING
            `);
            console.log("Inserted dummy dates");
        }

        console.log("Migration Complete!");
        pool.end();
    } catch (err) {
        console.error("Migration Failed:", err);
        process.exit(1);
    }
}

migrate();

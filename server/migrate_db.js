
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
        console.log("Starting Migration...");

        // 1. Create Customers Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS customers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                phone TEXT UNIQUE NOT NULL,
                email TEXT,
                address TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("Created table: customers");

        // 2. Clear existing orders (Optional but safer for dev to avoid constraint issues, 
        //    or use ALTER with NULLABLE columns. We'll use NULLABLE for safety)

        // 3. Alter Orders Table
        // Add customer_id
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='customer_id') THEN
                    ALTER TABLE orders ADD COLUMN customer_id UUID REFERENCES customers(id);
                END IF;
            END $$;
        `);

        // Add pickup_date
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='pickup_date') THEN
                    ALTER TABLE orders ADD COLUMN pickup_date DATE;
                END IF;
            END $$;
        `);

        // Add pickup_location
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='pickup_location') THEN
                    ALTER TABLE orders ADD COLUMN pickup_location TEXT;
                END IF;
            END $$;
        `);

        // Add status
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='status') THEN
                    ALTER TABLE orders ADD COLUMN status TEXT DEFAULT 'pending';
                END IF;
            END $$;
        `);

        // Add confirmation_email_sent_at
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='confirmation_email_sent_at') THEN
                    ALTER TABLE orders ADD COLUMN confirmation_email_sent_at TIMESTAMP WITH TIME ZONE;
                END IF;
            END $$;
        `);

        // Add payment_type
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='payment_type') THEN
                    ALTER TABLE orders ADD COLUMN payment_type TEXT DEFAULT 'full';
                END IF;
            END $$;
        `);

        // Add amount_paid_cents
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='amount_paid_cents') THEN
                    ALTER TABLE orders ADD COLUMN amount_paid_cents INTEGER;
                END IF;
            END $$;
        `);

        // Add amount_due_cents
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='amount_due_cents') THEN
                    ALTER TABLE orders ADD COLUMN amount_due_cents INTEGER;
                END IF;
            END $$;
        `);

        // Add language
        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='language') THEN
                    ALTER TABLE orders ADD COLUMN language TEXT DEFAULT 'en';
                END IF;
            END $$;
        `);

        // Add payment_method
        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='payment_method') THEN
                    ALTER TABLE orders ADD COLUMN payment_method TEXT;
                END IF;
            END $$;
        `);

        // Ensure public-facing sequential order numbers exist.
        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_class
                    WHERE relkind = 'S'
                      AND relname = 'orders_order_number_seq'
                ) THEN
                    CREATE SEQUENCE orders_order_number_seq;
                END IF;
            END $$;
        `);

        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='order_number') THEN
                    ALTER TABLE orders ADD COLUMN order_number BIGINT;
                END IF;
            END $$;
        `);

        await pool.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='order_number') THEN
                    ALTER TABLE orders
                    ALTER COLUMN order_number SET DEFAULT nextval('orders_order_number_seq');
                END IF;
            END $$;
        `);

        await pool.query(`
            WITH missing AS (
                SELECT
                    id,
                    ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
                FROM orders
                WHERE order_number IS NULL
            ),
            current_max AS (
                SELECT COALESCE(MAX(order_number), 0) AS base
                FROM orders
            )
            UPDATE orders
            SET order_number = current_max.base + missing.rn
            FROM missing, current_max
            WHERE orders.id = missing.id;
        `);

        await pool.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='order_number') THEN
                    ALTER TABLE orders ALTER COLUMN order_number SET NOT NULL;
                END IF;
            END $$;
        `);

        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS orders_order_number_unique_idx
            ON orders (order_number);
        `);

        await pool.query(`
            SELECT setval(
                'orders_order_number_seq',
                GREATEST(COALESCE((SELECT MAX(order_number) FROM orders), 0), 1),
                EXISTS (SELECT 1 FROM orders)
            );
        `);

        // Ensure customer_email remains optional for admin-created orders.
        await pool.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name='orders'
                      AND column_name='customer_email'
                      AND is_nullable='NO'
                ) THEN
                    ALTER TABLE orders ALTER COLUMN customer_email DROP NOT NULL;
                END IF;
            END $$;
        `);

        await pool.query(`
            UPDATE orders
            SET
                payment_type = COALESCE(payment_type, 'full'),
                amount_paid_cents = COALESCE(amount_paid_cents, total_cents),
                amount_due_cents = COALESCE(amount_due_cents, 0),
                language = COALESCE(language, 'en')
        `);

        console.log("Migration Complete!");
        pool.end();
    } catch (err) {
        console.error("Migration Failed:", err);
        process.exit(1);
    }
}

migrate();


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

        console.log("Migration Complete!");
        pool.end();
    } catch (err) {
        console.error("Migration Failed:", err);
        process.exit(1);
    }
}

migrate();

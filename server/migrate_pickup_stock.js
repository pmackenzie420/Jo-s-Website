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
        console.log('Starting Pickup Stock Migration...');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS pickup_stock (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                pickup_date_id UUID NOT NULL REFERENCES pickup_dates(id) ON DELETE CASCADE,
                hen_id INTEGER NOT NULL REFERENCES hens(id) ON DELETE CASCADE,
                stock INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (pickup_date_id, hen_id)
            );
        `);
        console.log('Created table: pickup_stock');

        await pool.query(`
            INSERT INTO pickup_stock (pickup_date_id, hen_id, stock)
            SELECT
                pickup_dates.id,
                hens.id,
                COALESCE(hens.stock, 0)
            FROM pickup_dates
            CROSS JOIN hens
            LEFT JOIN pickup_stock
                ON pickup_stock.pickup_date_id = pickup_dates.id
                AND pickup_stock.hen_id = hens.id
            WHERE pickup_stock.id IS NULL
        `);
        console.log('Backfilled pickup_stock for existing dates + hens');

        console.log('Migration Complete!');
        pool.end();
    } catch (err) {
        console.error('Migration Failed:', err);
        process.exit(1);
    }
}

migrate();

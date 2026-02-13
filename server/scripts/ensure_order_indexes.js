const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const isProduction = process.env.NODE_ENV === 'production';
const certificatePath = isProduction
    ? '/etc/secrets/supabase-ca.crt'
    : path.join(__dirname, '..', 'certs', 'supabase-ca.crt');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: true,
        ca: fs.readFileSync(certificatePath, 'utf8')
    }
});

const statements = [
    `
    CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_status_created_at_idx
    ON orders (status, created_at)
    `,
    `
    CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_stripe_payment_id_idx
    ON orders (stripe_payment_id)
    WHERE stripe_payment_id IS NOT NULL
    `,
    `
    CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_pickup_date_location_status_norm_idx
    ON orders (pickup_date, pickup_location, LOWER(COALESCE(status, 'pending')))
    `,
    `
    CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_created_at_idx
    ON orders (created_at)
    `
];

const ensureOrderIndexes = async () => {
    try {
        console.log('Ensuring order indexes...');
        for (const statement of statements) {
            await pool.query(statement);
        }
        console.log('Order indexes ensured.');
    } catch (err) {
        console.error('Failed to ensure order indexes:', err);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
};

ensureOrderIndexes();

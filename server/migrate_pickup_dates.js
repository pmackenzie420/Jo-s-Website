
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

        // Insert dummy dates if empty
        const count = await pool.query('SELECT count(*) FROM pickup_dates');
        if (parseInt(count.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO pickup_dates (date_value, location) VALUES 
                ('2025-05-20', 'hemmingford'),
                ('2025-06-01', 'hemmingford'),
                ('2025-06-15', 'hemmingford')
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


const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        console.log("Starting Pickups Migration...");

        // Create pickup_dates table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pickup_dates (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                date_value DATE NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("Created table: pickup_dates");

        // Insert dummy dates if empty
        const count = await pool.query('SELECT count(*) FROM pickup_dates');
        if (parseInt(count.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO pickup_dates (date_value) VALUES 
                ('2025-05-20'),
                ('2025-06-01'),
                ('2025-06-15')
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

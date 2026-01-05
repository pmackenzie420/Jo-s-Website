
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkTables() {
    try {
        const res = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log("Tables:", res.rows.map(r => r.table_name));

        // If orders exists, check columns
        const ord = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'orders'
        `);
        console.log("Orders Columns:", ord.rows);

        pool.end();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkTables();

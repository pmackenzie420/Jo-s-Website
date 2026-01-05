
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkData() {
    try {
        const hens = await pool.query('SELECT * FROM hens');
        console.log("Hens:", hens.rows);

        const dates = await pool.query('SELECT * FROM pickup_dates');
        console.log("Dates:", dates.rows);

        pool.end();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkData();

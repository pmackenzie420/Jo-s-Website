
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: true,
        ca: isProduction
            ? fs.readFileSync('/etc/secrets/supabase-ca.crt').toString()
            : fs.readFileSync(path.join(__dirname, '..', 'certs/supabase-ca.crt')).toString()
    }
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

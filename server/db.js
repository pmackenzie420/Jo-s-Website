const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

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

module.exports = pool;

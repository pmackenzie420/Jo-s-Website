const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const supabaseCaPath = path.join(__dirname, 'certs', 'supabase-ca.crt');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: true,
        ca: fs.readFileSync(supabaseCaPath, 'utf8')
    }
});

module.exports = pool;

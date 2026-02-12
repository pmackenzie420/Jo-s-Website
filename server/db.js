const { Pool, types } = require('pg');
const fs = require('fs');
const path = require('path');

const supabaseCaPath = path.join(__dirname, 'certs', 'supabase-ca.crt');
const PG_DATE_OID = 1082;

// Return DATE columns as raw YYYY-MM-DD strings to avoid timezone drift.
types.setTypeParser(PG_DATE_OID, (value) => value);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: true,
        ca: fs.readFileSync(supabaseCaPath, 'utf8')
    }
});

module.exports = pool;

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const READONLY_URL_PATH = '/tmp/jowebsite-readonly-db-url';
const ALLOWED_SQL_PATTERN = /^\s*(select|with|show|explain)\b/i;
const BLOCKED_SQL_PATTERN = /\b(alter|analyze|call|comment|copy|create|delete|drop|grant|insert|listen|lock|merge|notify|reindex|refresh|reset|revoke|set\s+(?!local\b)|truncate|unlisten|update|vacuum)\b/i;

const readStdin = async () => new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
});

const stripSqlLiteralsAndComments = (sql) => String(sql || '')
    .replace(/'([^']|'')*'/g, "''")
    .replace(/"([^"]|"")*"/g, '""')
    .replace(/\$\$[\s\S]*?\$\$/g, '$$')
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

const getSql = async () => {
    const argSql = process.argv.slice(2).join(' ').trim();
    if (argSql) return argSql;
    if (process.stdin.isTTY) return '';
    return (await readStdin()).trim();
};

const loadConnectionString = () => {
    if (!fs.existsSync(READONLY_URL_PATH)) {
        throw new Error(`${READONLY_URL_PATH} is missing. Create it with the codex_readonly Supabase URL first.`);
    }
    const connectionString = fs.readFileSync(READONLY_URL_PATH, 'utf8').trim();
    if (!connectionString) {
        throw new Error(`${READONLY_URL_PATH} is empty.`);
    }
    const parsed = new URL(connectionString.replace(/^postgres:\/\//, 'postgresql://'));
    const username = decodeURIComponent(parsed.username || '');
    if (!username.startsWith('codex_readonly.')) {
        throw new Error(`Refusing DB URL for user "${username || '<missing>'}". Expected codex_readonly.<project-ref>.`);
    }
    return connectionString;
};

const assertSafeSql = (sql) => {
    if (!sql) {
        throw new Error('Provide one read-only SQL query as an argument or stdin.');
    }
    if (!ALLOWED_SQL_PATTERN.test(sql)) {
        throw new Error('Only SELECT, WITH, SHOW, and EXPLAIN queries are allowed.');
    }
    if (BLOCKED_SQL_PATTERN.test(stripSqlLiteralsAndComments(sql))) {
        throw new Error('Refusing SQL containing write/admin keywords.');
    }
};

const formatResult = (result) => {
    if (!result || !Array.isArray(result.rows)) return;
    console.log(JSON.stringify(result.rows, null, 2));
};

const main = async () => {
    const sql = await getSql();
    assertSafeSql(sql);

    const connectionString = loadConnectionString();
    const caPath = path.join(__dirname, '..', 'certs', 'supabase-ca.crt');
    const pool = new Pool({
        connectionString,
        ssl: fs.existsSync(caPath)
            ? { rejectUnauthorized: true, ca: fs.readFileSync(caPath, 'utf8') }
            : { rejectUnauthorized: true }
    });

    const client = await pool.connect();
    try {
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL statement_timeout = '30s'");
        const result = await client.query(sql);
        await client.query('ROLLBACK');
        formatResult(result);
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (_rollbackErr) {
            // Ignore rollback errors; the original query failure is more useful.
        }
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
};

main().catch((err) => {
    console.error(err?.message || err);
    process.exitCode = 1;
});

# Agent Safety Instructions

## Production Database Access

Never use `server/.env DATABASE_URL` for production database inspection. That URL may use the application database role and can have write privileges.

For production database audits, use only the temporary read-only connection string stored at:

```text
/tmp/jowebsite-readonly-db-url
```

Required rules:

- Read the production audit URL only from `/tmp/jowebsite-readonly-db-url`.
- The URL username must start with `codex_readonly.`.
- Force read-only mode before querying, for example `BEGIN READ ONLY`.
- Run inspection queries only: `SELECT`, `WITH`, `SHOW`, or `EXPLAIN`.
- Do not run migrations, seeders, app servers, or scripts against this URL.
- Do not copy the read-only URL into tracked files, logs, or chat output.
- If `/tmp/jowebsite-readonly-db-url` is missing or the username is not `codex_readonly`, stop and ask the user.

Preferred helper:

```bash
npm --prefix server run db:readonly -- "SELECT current_user, current_setting('default_transaction_read_only');"
```


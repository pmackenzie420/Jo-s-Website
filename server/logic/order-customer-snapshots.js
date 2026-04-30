const createOrderCustomerRecord = async (client, {
    customerName,
    customerPhone,
    customerEmail,
    customerAddress
}) => {
    if (!client || typeof client.query !== 'function') {
        throw new Error('Database client is required to create an order customer record.');
    }

    const result = await client.query(
        'INSERT INTO customers (name, phone, email, address) VALUES ($1, $2, $3, $4) RETURNING id',
        [customerName, customerPhone, customerEmail || null, customerAddress || null]
    );
    return result.rows[0]?.id || null;
};

const ensureOrderCustomerSnapshotsSchema = async (pool) => {
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('Database executor is required to ensure order customer snapshot schema.');
    }

    await pool.query(`
        DO $$
        DECLARE
            phone_constraint_name TEXT;
        BEGIN
            SELECT tc.constraint_name
            INTO phone_constraint_name
            FROM information_schema.table_constraints tc
            INNER JOIN information_schema.key_column_usage kcu
                ON kcu.constraint_name = tc.constraint_name
               AND kcu.table_schema = tc.table_schema
               AND kcu.table_name = tc.table_name
            WHERE tc.table_schema = current_schema()
              AND tc.table_name = 'customers'
              AND tc.constraint_type = 'UNIQUE'
              AND kcu.column_name = 'phone'
            ORDER BY tc.constraint_name
            LIMIT 1;

            IF phone_constraint_name IS NOT NULL THEN
                EXECUTE format('ALTER TABLE customers DROP CONSTRAINT %I', phone_constraint_name);
            END IF;
        END $$;
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS customers_phone_idx
        ON customers (phone);
    `);

    await pool.query(`
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS customer_name TEXT,
        ADD COLUMN IF NOT EXISTS customer_phone TEXT,
        ADD COLUMN IF NOT EXISTS customer_address TEXT;
    `);

    await pool.query(`
        WITH safe_customer_ids AS (
            SELECT orders.customer_id
            FROM orders
            WHERE orders.customer_id IS NOT NULL
            GROUP BY orders.customer_id
            HAVING COUNT(
                DISTINCT COALESCE(LOWER(NULLIF(BTRIM(orders.customer_email), '')), '<blank>')
            ) <= 1
        )
        UPDATE orders
        SET
            customer_name = CASE
                WHEN orders.customer_name IS NULL OR BTRIM(orders.customer_name) = ''
                    THEN customers.name
                ELSE orders.customer_name
            END,
            customer_phone = CASE
                WHEN orders.customer_phone IS NULL OR BTRIM(orders.customer_phone) = ''
                    THEN customers.phone
                ELSE orders.customer_phone
            END,
            customer_address = CASE
                WHEN orders.customer_address IS NULL OR BTRIM(orders.customer_address) = ''
                    THEN customers.address
                ELSE orders.customer_address
            END
        FROM customers
        WHERE orders.customer_id = customers.id
          AND orders.customer_id IN (SELECT customer_id FROM safe_customer_ids)
          AND (
              orders.customer_name IS NULL OR BTRIM(orders.customer_name) = ''
              OR orders.customer_phone IS NULL OR BTRIM(orders.customer_phone) = ''
              OR orders.customer_address IS NULL OR BTRIM(orders.customer_address) = ''
          );
    `);
};

module.exports = {
    createOrderCustomerRecord,
    ensureOrderCustomerSnapshotsSchema
};

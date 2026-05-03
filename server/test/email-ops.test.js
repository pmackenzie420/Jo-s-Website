const test = require('node:test');
const assert = require('node:assert/strict');

const { listEmailActivity, sendTrackedEmailMessage } = require('../logic/email-ops');

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

test('sendTrackedEmailMessage serializes jsonb update fields on successful send', async () => {
    const queries = [];
    const pool = {
        async query(sql, params = []) {
            const normalizedSql = normalizeSql(sql);
            queries.push({ sql: normalizedSql, params });

            if (normalizedSql.includes('INSERT INTO email_messages')) {
                return { rows: [{ id: 'email-message-1' }] };
            }
            if (normalizedSql.includes('INSERT INTO email_message_orders')) {
                return { rows: [] };
            }
            if (normalizedSql.includes('FROM email_suppressions')) {
                return { rows: [] };
            }
            if (normalizedSql.startsWith('UPDATE email_messages SET')) {
                return { rows: [{ id: 'email-message-1' }] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const result = await sendTrackedEmailMessage({
        pool,
        sendEmailMessage: async () => ({ id: 'provider-email-1' }),
        message: {
            to: {
                email: 'customer@example.com',
                name: 'Customer'
            },
            subject: 'Pickup reminder',
            text: 'Reminder',
            emailType: 'pickup_reminder',
            orderIds: ['order-1'],
            batchKey: '2026-04-28::Bristol',
            batchRunId: 'batch-1',
            pickupDate: '2026-04-28',
            pickupLocation: 'Bristol',
            requestId: 'req-email-1'
        }
    });

    assert.equal(result.success, true);
    assert.equal(result.providerEmailId, 'provider-email-1');

    const updateQuery = queries.find(({ sql }) => sql.startsWith('UPDATE email_messages SET'));
    assert.ok(updateQuery);

    const tagsParam = updateQuery.params.find((value) => (
        typeof value === 'string'
        && value.includes('"name":"category"')
        && value.includes('"value":"pickup_reminder"')
    ));
    assert.ok(tagsParam);
    assert.equal(tagsParam.startsWith('['), true);

    const metadataParam = updateQuery.params.find((value) => (
        typeof value === 'string' && value.includes('"batch_key":"2026-04-28::Bristol"')
    ));
    assert.ok(metadataParam);
    assert.equal(metadataParam.startsWith('{'), true);

    const insertQuery = queries.find(({ sql }) => sql.includes('INSERT INTO email_messages'));
    assert.ok(insertQuery);
    assert.equal(insertQuery.params.includes('batch-1'), true);
    assert.equal(insertQuery.params.includes('req-email-1'), true);
});

test('sendTrackedEmailMessage marks tracking row failed when verification throws', async () => {
    const queries = [];
    let sendAttempted = false;
    const pool = {
        async query(sql, params = []) {
            const normalizedSql = normalizeSql(sql);
            queries.push({ sql: normalizedSql, params });

            if (normalizedSql.includes('INSERT INTO email_messages')) {
                return { rows: [{ id: 'email-message-verify-failed' }] };
            }
            if (normalizedSql.includes('INSERT INTO email_message_orders')) {
                return { rows: [] };
            }
            if (normalizedSql.includes('FROM email_suppressions')) {
                return { rows: [] };
            }
            if (normalizedSql.startsWith('UPDATE email_messages SET')) {
                return { rows: [{ id: 'email-message-verify-failed' }] };
            }
            throw new Error(`Unexpected SQL: ${normalizedSql}`);
        }
    };

    const result = await sendTrackedEmailMessage({
        pool,
        verifyEmail: async () => {
            throw new Error('Verifier unavailable.');
        },
        sendEmailMessage: async () => {
            sendAttempted = true;
            return { id: 'provider-email-should-not-send' };
        },
        message: {
            to: {
                email: 'customer@example.com',
                name: 'Customer'
            },
            subject: 'Pickup reminder',
            text: 'Reminder',
            emailType: 'pickup_reminder',
            orderIds: ['order-1']
        }
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'failed');
    assert.equal(result.verificationStatus, 'error');
    assert.match(result.reason, /Email verification failed before sending/);
    assert.equal(sendAttempted, false);

    const updateQuery = queries.find(({ sql }) => sql.startsWith('UPDATE email_messages SET'));
    assert.ok(updateQuery);
    assert.equal(updateQuery.params.includes('failed'), true);
    assert.equal(updateQuery.params.includes('error'), true);
    assert.equal(updateQuery.params.includes('email.verification_failed'), true);
});

test('listEmailActivity marks old pending rows as stale and preserves correlation ids', async () => {
    const queries = [];
    const pool = {
        async query(sql, params = []) {
            queries.push({ sql: normalizeSql(sql), params });
            return {
                rows: [{
                    id: 'email-message-1',
                    email_type: 'pickup_reminder',
                    send_status: 'pending',
                    verification_status: 'valid',
                    to_email: 'customer@example.com',
                    to_name: 'Customer',
                    subject: 'Pickup reminder',
                    created_at: new Date('2026-04-23T23:47:39.173Z'),
                    sent_at: null,
                    delivered_at: null,
                    failed_at: null,
                    bounced_at: null,
                    complained_at: null,
                    suppressed_at: null,
                    last_event_at: new Date('2026-04-23T23:47:39.173Z'),
                    last_event_type: 'pending',
                    last_error: null,
                    pickup_date: '2026-04-28',
                    pickup_location: 'Bristol',
                    batch_key: '2026-04-28::Bristol',
                    batch_run_id: 'batch-1',
                    request_id: 'req-email-1',
                    initiated_by: 'admin',
                    order_ids: ['order-1'],
                    order_numbers: [102]
                }]
            };
        }
    };

    const activity = await listEmailActivity({
        pool,
        status: 'stale_pending',
        now: new Date('2026-04-24T00:30:00.000Z')
    });

    assert.equal(activity.length, 1);
    assert.equal(activity[0]?.sendStatus, 'pending');
    assert.equal(activity[0]?.displayStatus, 'stale_pending');
    assert.equal(activity[0]?.isStalePending, true);
    assert.equal(activity[0]?.batchRunId, 'batch-1');
    assert.equal(activity[0]?.requestId, 'req-email-1');
    assert.deepEqual(activity[0]?.orderNumbers, [102]);

    const query = queries[0];
    assert.ok(query.sql.includes("LOWER(COALESCE(em.send_status, '')) = 'pending'"));
    assert.equal(query.params.some((value) => value instanceof Date), true);
});

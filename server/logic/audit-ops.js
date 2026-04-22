const { randomUUID } = require('crypto');
const { logError } = require('../utils/logger');

const toExecutor = (executor) => (
    executor && typeof executor.query === 'function' ? executor : null
);

const truncate = (value, maxLength = 500) => {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return normalized.slice(0, maxLength);
};

const toJsonObject = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value;
};

const toInteger = (value, fallback = 0) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.trunc(numeric);
};

const buildInsertId = () => randomUUID();

const withAuditFailureProtection = async (operationName, work, fallback) => {
    try {
        return await work();
    } catch (err) {
        logError(`Audit operation failed: ${operationName}`, err);
        return fallback;
    }
};

const ensureAuditOpsSchema = async (pool) => {
    const executor = toExecutor(pool);
    if (!executor) {
        throw new Error('Database executor is required to ensure audit schema.');
    }

    await executor.query(`
        CREATE TABLE IF NOT EXISTS order_events (
            id UUID PRIMARY KEY,
            order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            event_type TEXT NOT NULL,
            from_status TEXT,
            to_status TEXT,
            actor_type TEXT,
            actor_id TEXT,
            request_id TEXT,
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
    `);
    await executor.query(`
        CREATE TABLE IF NOT EXISTS admin_actions (
            id UUID PRIMARY KEY,
            action_type TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT,
            admin_identifier TEXT NOT NULL,
            request_id TEXT,
            before_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            after_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            ip TEXT,
            user_agent TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
    `);
    await executor.query(`
        CREATE TABLE IF NOT EXISTS payment_events (
            id UUID PRIMARY KEY,
            order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
            provider TEXT NOT NULL,
            provider_event_id TEXT,
            event_type TEXT NOT NULL,
            status TEXT,
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
    `);
    await executor.query(`
        CREATE TABLE IF NOT EXISTS batch_runs (
            id UUID PRIMARY KEY,
            batch_type TEXT NOT NULL,
            scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            expected_count INTEGER NOT NULL DEFAULT 0,
            attempted_count INTEGER NOT NULL DEFAULT 0,
            succeeded_count INTEGER NOT NULL DEFAULT 0,
            failed_count INTEGER NOT NULL DEFAULT 0,
            initiated_by TEXT,
            request_id TEXT,
            started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMP WITH TIME ZONE
        )
    `);
    await executor.query(`
        CREATE TABLE IF NOT EXISTS inventory_events (
            id UUID PRIMARY KEY,
            pickup_date DATE,
            location TEXT,
            item_id INTEGER,
            delta INTEGER NOT NULL,
            reason TEXT NOT NULL,
            actor TEXT,
            request_id TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
    `);

    await executor.query(`
        CREATE INDEX IF NOT EXISTS order_events_order_id_created_at_idx
        ON order_events (order_id, created_at DESC)
    `);
    await executor.query(`
        CREATE INDEX IF NOT EXISTS order_events_event_type_created_at_idx
        ON order_events (event_type, created_at DESC)
    `);
    await executor.query(`
        CREATE INDEX IF NOT EXISTS admin_actions_target_created_at_idx
        ON admin_actions (target_type, target_id, created_at DESC)
    `);
    await executor.query(`
        CREATE INDEX IF NOT EXISTS admin_actions_request_id_idx
        ON admin_actions (request_id)
    `);
    await executor.query(`
        CREATE INDEX IF NOT EXISTS payment_events_order_id_created_at_idx
        ON payment_events (order_id, created_at DESC)
    `);
    await executor.query(`
        CREATE INDEX IF NOT EXISTS payment_events_provider_event_id_idx
        ON payment_events (provider, provider_event_id, created_at DESC)
    `);
    await executor.query(`
        CREATE INDEX IF NOT EXISTS batch_runs_type_started_at_idx
        ON batch_runs (batch_type, started_at DESC)
    `);
    await executor.query(`
        CREATE INDEX IF NOT EXISTS inventory_events_pickup_item_created_at_idx
        ON inventory_events (pickup_date, location, item_id, created_at DESC)
    `);
};

const recordOrderEvent = async (executor, payload = {}) => {
    const db = toExecutor(executor);
    if (!db || !payload.orderId || !payload.eventType) return null;

    return withAuditFailureProtection('recordOrderEvent', async () => {
        const result = await db.query(
            `
            INSERT INTO order_events (
                id,
                order_id,
                event_type,
                from_status,
                to_status,
                actor_type,
                actor_id,
                request_id,
                payload_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
            RETURNING id
            `,
            [
                buildInsertId(),
                payload.orderId,
                truncate(payload.eventType, 120),
                truncate(payload.fromStatus, 80) || null,
                truncate(payload.toStatus, 80) || null,
                truncate(payload.actorType, 80) || null,
                truncate(payload.actorId, 200) || null,
                truncate(payload.requestId, 200) || null,
                JSON.stringify(toJsonObject(payload.payload))
            ]
        );
        return result.rows[0]?.id || null;
    }, null);
};

const recordAdminAction = async (executor, payload = {}) => {
    const db = toExecutor(executor);
    if (!db || !payload.actionType || !payload.targetType || !payload.adminIdentifier) return null;

    return withAuditFailureProtection('recordAdminAction', async () => {
        const result = await db.query(
            `
            INSERT INTO admin_actions (
                id,
                action_type,
                target_type,
                target_id,
                admin_identifier,
                request_id,
                before_json,
                after_json,
                ip,
                user_agent
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
            RETURNING id
            `,
            [
                buildInsertId(),
                truncate(payload.actionType, 120),
                truncate(payload.targetType, 120),
                truncate(payload.targetId, 200) || null,
                truncate(payload.adminIdentifier, 200),
                truncate(payload.requestId, 200) || null,
                JSON.stringify(toJsonObject(payload.before)),
                JSON.stringify(toJsonObject(payload.after)),
                truncate(payload.ip, 200) || null,
                truncate(payload.userAgent, 500) || null
            ]
        );
        return result.rows[0]?.id || null;
    }, null);
};

const recordPaymentEvent = async (executor, payload = {}) => {
    const db = toExecutor(executor);
    if (!db || !payload.provider || !payload.eventType) return null;

    return withAuditFailureProtection('recordPaymentEvent', async () => {
        const result = await db.query(
            `
            INSERT INTO payment_events (
                id,
                order_id,
                provider,
                provider_event_id,
                event_type,
                status,
                payload_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
            RETURNING id
            `,
            [
                buildInsertId(),
                payload.orderId || null,
                truncate(payload.provider, 80),
                truncate(payload.providerEventId, 200) || null,
                truncate(payload.eventType, 120),
                truncate(payload.status, 120) || null,
                JSON.stringify(toJsonObject(payload.payload))
            ]
        );
        return result.rows[0]?.id || null;
    }, null);
};

const startBatchRun = async (executor, payload = {}) => {
    const db = toExecutor(executor);
    if (!db || !payload.batchType) return null;

    const id = buildInsertId();
    return withAuditFailureProtection('startBatchRun', async () => {
        await db.query(
            `
            INSERT INTO batch_runs (
                id,
                batch_type,
                scope_json,
                expected_count,
                attempted_count,
                succeeded_count,
                failed_count,
                initiated_by,
                request_id,
                started_at,
                completed_at
            )
            VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, COALESCE($10, NOW()), $11)
            `,
            [
                id,
                truncate(payload.batchType, 120),
                JSON.stringify(toJsonObject(payload.scope)),
                Math.max(toInteger(payload.expectedCount, 0), 0),
                Math.max(toInteger(payload.attemptedCount, 0), 0),
                Math.max(toInteger(payload.succeededCount, 0), 0),
                Math.max(toInteger(payload.failedCount, 0), 0),
                truncate(payload.initiatedBy, 200) || null,
                truncate(payload.requestId, 200) || null,
                payload.startedAt || null,
                payload.completedAt || null
            ]
        );
        return id;
    }, null);
};

const finalizeBatchRun = async (executor, batchRunId, payload = {}) => {
    const db = toExecutor(executor);
    if (!db || !batchRunId) return null;

    return withAuditFailureProtection('finalizeBatchRun', async () => {
        const result = await db.query(
            `
            UPDATE batch_runs
            SET
                scope_json = COALESCE($2::jsonb, scope_json),
                expected_count = COALESCE($3, expected_count),
                attempted_count = COALESCE($4, attempted_count),
                succeeded_count = COALESCE($5, succeeded_count),
                failed_count = COALESCE($6, failed_count),
                initiated_by = COALESCE($7, initiated_by),
                request_id = COALESCE($8, request_id),
                completed_at = COALESCE($9, completed_at, NOW())
            WHERE id = $1
            RETURNING id
            `,
            [
                batchRunId,
                payload.scope === undefined ? null : JSON.stringify(toJsonObject(payload.scope)),
                payload.expectedCount === undefined ? null : Math.max(toInteger(payload.expectedCount, 0), 0),
                payload.attemptedCount === undefined ? null : Math.max(toInteger(payload.attemptedCount, 0), 0),
                payload.succeededCount === undefined ? null : Math.max(toInteger(payload.succeededCount, 0), 0),
                payload.failedCount === undefined ? null : Math.max(toInteger(payload.failedCount, 0), 0),
                truncate(payload.initiatedBy, 200) || null,
                truncate(payload.requestId, 200) || null,
                payload.completedAt || null
            ]
        );
        return result.rows[0]?.id || null;
    }, null);
};

const recordInventoryEvent = async (executor, payload = {}) => {
    const db = toExecutor(executor);
    if (!db || !payload.reason) return null;

    return withAuditFailureProtection('recordInventoryEvent', async () => {
        const result = await db.query(
            `
            INSERT INTO inventory_events (
                id,
                pickup_date,
                location,
                item_id,
                delta,
                reason,
                actor,
                request_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
            `,
            [
                buildInsertId(),
                payload.pickupDate || null,
                truncate(payload.location, 80) || null,
                Number.isInteger(Number(payload.itemId)) ? Number(payload.itemId) : null,
                toInteger(payload.delta, 0),
                truncate(payload.reason, 160),
                truncate(payload.actor, 200) || null,
                truncate(payload.requestId, 200) || null
            ]
        );
        return result.rows[0]?.id || null;
    }, null);
};

const recordInventoryEvents = async (executor, events = []) => {
    const db = toExecutor(executor);
    if (!db || !Array.isArray(events) || events.length === 0) return [];

    const ids = [];
    for (const event of events) {
        const insertedId = await recordInventoryEvent(db, event);
        if (insertedId) {
            ids.push(insertedId);
        }
    }
    return ids;
};

module.exports = {
    ensureAuditOpsSchema,
    recordOrderEvent,
    recordAdminAction,
    recordPaymentEvent,
    startBatchRun,
    finalizeBatchRun,
    recordInventoryEvent,
    recordInventoryEvents
};

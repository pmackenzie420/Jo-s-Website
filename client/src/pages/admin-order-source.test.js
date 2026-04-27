import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOrderSource,
  getOrderSourceType,
  isOrderSourceInferred,
  getOrderSourceTranslationKey
} from './admin-order-source.js';

test('buildOrderSource maps checkout, admin, system, and missing audit events', () => {
  const customerOrder = buildOrderSource({
    order_created_actor_type: 'checkout',
    order_created_actor_id: 'alice@example.com',
    order_created_request_id: 'req-customer',
    order_created_at: '2026-04-01T12:00:05.000Z'
  });
  const teamOrder = buildOrderSource({
    order_created_actor_type: 'admin',
    order_created_actor_id: 'operator-1'
  });
  const systemOrder = buildOrderSource({
    order_created_actor_type: 'system',
    order_created_request_id: 'req-system'
  });
  const unknownOrder = buildOrderSource({});

  assert.equal(customerOrder.source, 'customer');
  assert.equal(customerOrder.actorType, 'checkout');
  assert.equal(customerOrder.tracked, true);

  assert.equal(teamOrder.source, 'team');
  assert.equal(teamOrder.actorType, 'admin');

  assert.equal(systemOrder.source, 'system');
  assert.equal(systemOrder.actorType, 'system');

  assert.equal(unknownOrder.source, 'unknown');
  assert.equal(unknownOrder.tracked, false);
});

test('getOrderSourceType prefers normalized orderSource data when present', () => {
  assert.equal(getOrderSourceType({ orderSource: { source: 'customer' } }), 'customer');
  assert.equal(getOrderSourceType({ orderSource: { source: 'TEAM' } }), 'team');
  assert.equal(getOrderSourceType({ order_created_actor_type: 'admin' }), 'team');
  assert.equal(getOrderSourceType({}), 'unknown');
});

test('buildOrderSource marks backfilled creation events as inferred', () => {
  const orderSource = buildOrderSource({
    order_created_actor_type: 'checkout',
    order_created_backfilled: true,
    order_created_inferred_from: 'stripe_payment_id_present'
  });

  assert.equal(orderSource.source, 'customer');
  assert.equal(orderSource.inferred, true);
  assert.equal(orderSource.inferredFrom, 'stripe_payment_id_present');
});

test('getOrderSourceTranslationKey distinguishes tracked and inferred sources', () => {
  assert.equal(
    getOrderSourceTranslationKey({
      orderSource: { source: 'customer', inferred: false }
    }),
    'orderSource.customer'
  );
  assert.equal(
    getOrderSourceTranslationKey({
      orderSource: { source: 'customer', inferred: true }
    }),
    'orderSource.customerInferred'
  );
  assert.equal(isOrderSourceInferred({ orderSource: { source: 'team', inferred: true } }), true);
  assert.equal(getOrderSourceTranslationKey({}), 'orderSource.unknown');
});

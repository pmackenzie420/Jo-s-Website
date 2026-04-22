import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGroupEmailRecipients,
  buildEmailRecipientTargeting
} from './admin-email-targeting.js';

test('buildGroupEmailRecipients merges duplicate emails and keeps linked orders', () => {
  const recipients = buildGroupEmailRecipients([
    {
      customerName: 'Alice',
      customerEmail: 'Alice@example.com',
      activeOrderIds: ['ord-1'],
      orders: [{ id: 'ord-1', order_number: 101, language: 'fr' }]
    },
    {
      customerName: 'Alice Backup',
      customerEmail: 'alice@example.com',
      activeOrderIds: ['ord-2'],
      orders: [{ id: 'ord-2', order_number: 102, language: 'en' }]
    },
    {
      customerName: 'Bob',
      customerEmail: '',
      activeOrderIds: ['ord-3'],
      orders: [{ id: 'ord-3', order_number: 103, language: 'en' }]
    }
  ]);

  assert.deepEqual(recipients, [
    {
      email: 'alice@example.com',
      name: 'Alice',
      language: 'fr',
      orderIds: ['ord-1', 'ord-2'],
      orderNumbers: ['101', '102']
    }
  ]);
});

test('buildEmailRecipientTargeting returns all recipients when no target values are provided', () => {
  const recipients = [
    { email: 'first@example.com', orderIds: ['ord-1'], orderNumbers: ['101'] },
    { email: 'second@example.com', orderIds: ['ord-2'], orderNumbers: ['102'] }
  ];

  const result = buildEmailRecipientTargeting(recipients, '');

  assert.equal(result.hasTargets, false);
  assert.equal(result.selectedRecipientCount, 2);
  assert.equal(result.selectedOrderCount, 2);
  assert.deepEqual(result.selectedRecipients, recipients);
  assert.deepEqual(result.unmatchedTokens, []);
});

test('buildEmailRecipientTargeting matches by email, order number, and order id', () => {
  const recipients = [
    {
      email: 'first@example.com',
      orderIds: ['ord-1', 'ord-1b'],
      orderNumbers: ['101', '111']
    },
    {
      email: 'second@example.com',
      orderIds: ['ord-2'],
      orderNumbers: ['202']
    }
  ];

  const result = buildEmailRecipientTargeting(
    recipients,
    'first@example.com, #202, ord-1b'
  );

  assert.equal(result.hasTargets, true);
  assert.equal(result.selectedRecipientCount, 2);
  assert.equal(result.selectedOrderCount, 3);
  assert.equal(result.matchedValueCount, 3);
  assert.deepEqual(result.unmatchedTokens, []);
});

test('buildEmailRecipientTargeting ignores headers and reports unmatched data-like tokens', () => {
  const recipients = [
    {
      email: 'first@example.com',
      orderIds: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
      orderNumbers: ['101']
    }
  ];

  const result = buildEmailRecipientTargeting(
    recipients,
    'email,order_id\nmissing@example.com,12345678-abcd'
  );

  assert.equal(result.hasTargets, true);
  assert.equal(result.selectedRecipientCount, 0);
  assert.equal(result.matchedValueCount, 0);
  assert.deepEqual(result.unmatchedTokens, ['missing@example.com', '12345678-abcd']);
});

test('buildEmailRecipientTargeting reads only relevant columns from the audit CSV export', () => {
  const recipients = [
    {
      email: 'lacroix528@hotmail.com',
      orderIds: ['92855744-f619-46e3-935b-504ba523e52c'],
      orderNumbers: ['36']
    }
  ];

  const csv = [
    'status,reason,suggestion,email,customer_names,customer_phones,pickup_dates,pickup_locations,order_numbers,order_ids,customer_ids',
    'warning,No delivered email found in the Resend export.,,lacroix528@hotmail.com,,,2026-04-28,bristol,36,92855744-f619-46e3-935b-504ba523e52c,5141d5fc-58df-46bd-8deb-c594005f5e64'
  ].join('\n');
  const result = buildEmailRecipientTargeting(recipients, csv);

  assert.equal(result.hasTargets, true);
  assert.equal(result.selectedRecipientCount, 1);
  assert.equal(result.matchedValueCount, 3);
  assert.deepEqual(result.unmatchedTokens, []);
});

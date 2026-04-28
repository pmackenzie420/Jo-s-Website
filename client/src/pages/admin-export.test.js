import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInvoiceDisplayDate } from './admin-invoice-utils.js';

test('resolveInvoiceDisplayDate prefers pickup date over order date', () => {
  assert.equal(
    resolveInvoiceDisplayDate({
      pickupDate: '2026-05-12',
      orderDate: '2026-04-01',
      created_at: '2026-04-01T16:00:00.000Z'
    }),
    '2026-05-12'
  );
});

test('resolveInvoiceDisplayDate falls back to order date when pickup date is missing', () => {
  assert.equal(
    resolveInvoiceDisplayDate({
      orderDate: '2026-04-01',
      created_at: '2026-04-01T16:00:00.000Z'
    }),
    '2026-04-01'
  );
});

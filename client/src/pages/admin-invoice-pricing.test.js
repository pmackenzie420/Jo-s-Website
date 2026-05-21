import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEditableInvoiceRows,
  buildInvoiceOrderWithPriceOverrides
} from './admin-invoice-pricing.js';

test('buildEditableInvoiceRows prepares invoice line prices from order items', () => {
  const rows = buildEditableInvoiceRows({
    orderItems: [
      {
        displayName: 'Ready-to-lay hen',
        quantity: 2,
        unitCents: 2500,
        lineCents: 5000
      }
    ]
  });

  assert.deepEqual(rows.map(({ description, quantity, unitCents, lineCents }) => ({
    description,
    quantity,
    unitCents,
    lineCents
  })), [
    {
      description: 'Ready-to-lay hen',
      quantity: 2,
      unitCents: 2500,
      lineCents: 5000
    }
  ]);
});

test('buildInvoiceOrderWithPriceOverrides changes invoice totals without mutating the source order', () => {
  const sourceOrder = {
    id: 'order-1',
    totalAmount: 100,
    amountPaid: 25,
    amountDue: 75,
    orderItems: [
      {
        displayName: 'Ready-to-lay hen',
        quantity: 4,
        unitCents: 2500,
        lineCents: 10000
      }
    ]
  };

  const invoiceOrder = buildInvoiceOrderWithPriceOverrides(sourceOrder, [
    {
      description: 'Ready-to-lay hen',
      quantity: 4,
      unitCents: 2000,
      lineCents: 8000
    }
  ]);

  assert.equal(sourceOrder.totalAmount, 100);
  assert.equal(sourceOrder.orderItems[0].lineCents, 10000);
  assert.equal(invoiceOrder.totalAmount, 80);
  assert.equal(invoiceOrder.amountPaid, 25);
  assert.equal(invoiceOrder.amountDue, 55);
  assert.equal(invoiceOrder.orderItems[0].unitCents, 2000);
  assert.equal(invoiceOrder.orderItems[0].lineCents, 8000);
});

test('buildInvoiceOrderWithPriceOverrides caps paid amount when a deal lowers a fully paid invoice', () => {
  const invoiceOrder = buildInvoiceOrderWithPriceOverrides({
    totalAmount: 100,
    amountPaid: 100,
    amountDue: 0,
    orderItems: [
      {
        displayName: 'Meat chicken',
        quantity: 2,
        unitCents: 5000,
        lineCents: 10000
      }
    ]
  }, [
    {
      description: 'Meat chicken',
      quantity: 2,
      unitCents: 4000,
      lineCents: 8000
    }
  ]);

  assert.equal(invoiceOrder.totalAmount, 80);
  assert.equal(invoiceOrder.amountPaid, 80);
  assert.equal(invoiceOrder.amountDue, 0);
  assert.equal(invoiceOrder.paymentType, 'full');
});

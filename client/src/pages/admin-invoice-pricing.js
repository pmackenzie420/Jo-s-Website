const parseAmount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const parseAmountFromCents = (value) => {
  const cents = Number(value);
  if (!Number.isFinite(cents)) return 0;
  return cents / 100;
};

const parseAmountOrNull = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
};

const parseAmountFromCentsOrNull = (value) => {
  const cents = Number(value);
  return Number.isFinite(cents) ? cents / 100 : null;
};

const parseOrderItems = (items) => {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (typeof items !== 'string') return [];
  try {
    const parsed = JSON.parse(items);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getInvoiceSourceItems = (order) => {
  const orderItems = parseOrderItems(order?.orderItems);
  if (orderItems.length) return orderItems;
  return parseOrderItems(order?.items);
};

const parseLineAmount = (item, quantity, unitAmount) => {
  const rawLineCents = item?.lineCents ?? item?.line_cents;
  const lineCents = Number(rawLineCents);
  if (Number.isFinite(lineCents) && (lineCents > 0 || item?.invoiceOnly)) {
    return lineCents / 100;
  }
  return Math.max(quantity, 0) * unitAmount;
};

const parseUnitAmount = (item, quantity) => {
  const rawUnitCents = item?.unitCents ?? item?.unit_cents;
  const unitCents = Number(rawUnitCents);
  if (Number.isFinite(unitCents) && (unitCents > 0 || item?.invoiceOnly)) {
    return unitCents / 100;
  }
  const rawLineCents = item?.lineCents ?? item?.line_cents;
  const lineCents = Number(rawLineCents);
  if (Number.isFinite(lineCents) && (lineCents > 0 || item?.invoiceOnly) && quantity > 0) {
    return (lineCents / 100) / quantity;
  }
  return 0;
};

const normalizeInvoiceItems = (orderItems = []) => {
  const grouped = new Map();
  (Array.isArray(orderItems) ? orderItems : []).forEach((item) => {
    const quantityRaw = Number(item?.quantity ?? item?.qty ?? 0);
    const quantity = Number.isFinite(quantityRaw) ? Math.floor(quantityRaw) : 0;
    if (quantity <= 0) return;

    const unitAmount = parseUnitAmount(item, quantity);
    const lineAmount = parseLineAmount(item, quantity, unitAmount);
    const description = String(item?.displayName || item?.name || 'Item').trim() || 'Item';
    const key = `${description}::${unitAmount.toFixed(2)}`;
    const current = grouped.get(key) || {
      quantity: 0,
      description,
      unitAmount,
      lineAmount: 0
    };
    grouped.set(key, {
      quantity: current.quantity + quantity,
      description,
      unitAmount,
      lineAmount: current.lineAmount + lineAmount
    });
  });
  return Array.from(grouped.values()).sort((a, b) => a.description.localeCompare(b.description));
};

const resolveInvoicePaymentAmounts = (order, totalAmount) => {
  const paidDirect = parseAmountOrNull(order?.amountPaid);
  const paidFromCents = parseAmountFromCentsOrNull(order?.amount_paid_cents);
  const dueDirect = parseAmountOrNull(order?.amountDue);
  const dueFromCents = parseAmountFromCentsOrNull(order?.amount_due_cents);

  let paidAmount = paidDirect ?? paidFromCents;
  let dueAmount = dueDirect ?? dueFromCents;

  if (paidAmount === null && dueAmount !== null) {
    paidAmount = Math.max(totalAmount - dueAmount, 0);
  }
  if (dueAmount === null && paidAmount !== null) {
    dueAmount = Math.max(totalAmount - paidAmount, 0);
  }
  if (paidAmount === null) {
    paidAmount = totalAmount;
  }
  if (dueAmount === null) {
    dueAmount = Math.max(totalAmount - paidAmount, 0);
  }

  return {
    paidAmount: Math.max(paidAmount, 0),
    dueAmount: Math.max(dueAmount, 0)
  };
};

const resolveInvoiceTotalAmount = (order) => (
  parseAmount(order?.totalAmount) || parseAmountFromCents(order?.total_cents)
);

const centsFromAmount = (amount) => Math.max(Math.round(parseAmount(amount) * 100), 0);

const buildEditableInvoiceRows = (order) => (
  normalizeInvoiceItems(getInvoiceSourceItems(order)).map((item, index) => {
    const unitCents = centsFromAmount(item.unitAmount);
    const lineCents = centsFromAmount(item.lineAmount);
    return {
      key: `${index}-${item.description}-${unitCents}`,
      description: item.description,
      quantity: Math.max(Math.floor(Number(item.quantity) || 0), 0),
      unitCents,
      lineCents,
      originalUnitCents: unitCents,
      originalLineCents: lineCents
    };
  })
);

const normalizeInvoiceOverrideRows = (rows = []) => (
  (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const quantityRaw = Number(row?.quantity);
      const quantity = Number.isFinite(quantityRaw) ? Math.floor(quantityRaw) : 0;
      const lineCentsRaw = Number(row?.lineCents);
      const unitCentsRaw = Number(row?.unitCents);
      const lineCents = Number.isFinite(lineCentsRaw) ? Math.max(Math.round(lineCentsRaw), 0) : 0;
      const unitCents = Number.isFinite(unitCentsRaw)
        ? Math.max(Math.round(unitCentsRaw), 0)
        : (quantity > 0 ? Math.round(lineCents / quantity) : 0);
      return {
        id: row?.id ?? `invoice-${index}`,
        description: String(row?.description || 'Item').trim() || 'Item',
        quantity: Math.max(quantity, 0),
        unitCents,
        lineCents
      };
    })
    .filter((row) => row.quantity > 0)
);

const buildInvoiceOrderWithPriceOverrides = (order, rows) => {
  const invoiceRows = normalizeInvoiceOverrideRows(rows);
  const totalCents = invoiceRows.reduce((sum, row) => sum + row.lineCents, 0);
  const originalTotalAmount = resolveInvoiceTotalAmount(order);
  const { paidAmount } = resolveInvoicePaymentAmounts(order, originalTotalAmount);
  const originalPaidCents = centsFromAmount(paidAmount);
  const paidCents = Math.min(originalPaidCents, totalCents);
  const dueCents = Math.max(totalCents - paidCents, 0);
  const paymentType = dueCents > 0 ? 'deposit' : 'full';

  return {
    ...order,
    orderItems: invoiceRows.map((row) => ({
      id: row.id,
      name: row.description,
      displayName: row.description,
      quantity: row.quantity,
      unitCents: row.unitCents,
      unit_cents: row.unitCents,
      lineCents: row.lineCents,
      line_cents: row.lineCents,
      invoiceOnly: true
    })),
    totalAmount: totalCents / 100,
    total_cents: totalCents,
    amountPaid: paidCents / 100,
    amount_paid_cents: paidCents,
    amountDue: dueCents / 100,
    amount_due_cents: dueCents,
    paymentType,
    payment_type: paymentType
  };
};

export {
  parseAmount,
  buildEditableInvoiceRows,
  buildInvoiceOrderWithPriceOverrides,
  normalizeInvoiceItems,
  resolveInvoicePaymentAmounts,
  resolveInvoiceTotalAmount
};

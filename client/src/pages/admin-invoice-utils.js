const pad2 = (value) => String(value).padStart(2, '0');

const normalizeInvoiceDate = (value) => {
  if (!value) return 'Unknown';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
    }
    return trimmed.includes('T') ? trimmed.split('T')[0] : trimmed;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const resolveInvoiceDisplayDate = (order) => normalizeInvoiceDate(
  order?.pickupDate
  || order?.pickup_date
  || order?.orderDate
  || order?.created_at
  || new Date()
);

export { resolveInvoiceDisplayDate };

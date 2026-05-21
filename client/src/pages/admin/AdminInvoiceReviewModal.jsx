import { useEffect, useMemo, useState } from 'react';
import {
  formatCurrency,
  formatDateLong,
  getOrderNumberText,
  normalizeDate
} from '../admin-utils';
import { t } from '../admin-i18n';
import {
  buildEditableInvoiceRows,
  buildInvoiceOrderWithPriceOverrides
} from '../admin-invoice-pricing';

const centsToInputValue = (cents) => (Number(cents || 0) / 100).toFixed(2);

const parseCurrencyInput = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return { valid: false, cents: 0 };
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0) return { valid: false, cents: 0 };
  return { valid: true, cents: Math.round(amount * 100) };
};

const buildFormRows = (order) => (
  buildEditableInvoiceRows(order).map((row) => ({
    ...row,
    unitValue: centsToInputValue(row.unitCents),
    lineValue: centsToInputValue(row.lineCents)
  }))
);

export default function AdminInvoiceReviewModal({
  order,
  adminLanguage,
  exporting,
  onClose,
  onExport
}) {
  const [rows, setRows] = useState([]);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!order) return;
    setRows(buildFormRows(order));
    setFormError('');
  }, [order]);

  const parsedRows = useMemo(
    () => rows.map((row) => {
      const unit = parseCurrencyInput(row.unitValue);
      const line = parseCurrencyInput(row.lineValue);
      return {
        ...row,
        unitCents: unit.cents,
        lineCents: line.cents,
        valid: unit.valid && line.valid
      };
    }),
    [rows]
  );

  const invoiceOrder = useMemo(
    () => (order ? buildInvoiceOrderWithPriceOverrides(order, parsedRows) : null),
    [order, parsedRows]
  );
  const totalCents = Math.round(Number(invoiceOrder?.totalAmount || 0) * 100);
  const paidCents = Math.round(Number(invoiceOrder?.amountPaid || 0) * 100);
  const dueCents = Math.round(Number(invoiceOrder?.amountDue || 0) * 100);
  const pricesChanged = parsedRows.some((row) => (
    row.unitCents !== row.originalUnitCents || row.lineCents !== row.originalLineCents
  ));
  const hasInvalidPrice = parsedRows.some((row) => !row.valid);
  const canExport = Boolean(order && parsedRows.length > 0 && !hasInvalidPrice && !exporting);

  const updateRow = (rowKey, updater) => {
    setRows((currentRows) => currentRows.map((row) => (
      row.key === rowKey ? updater(row) : row
    )));
  };

  const handleUnitChange = (rowKey, value) => {
    updateRow(rowKey, (row) => {
      const parsed = parseCurrencyInput(value);
      return {
        ...row,
        unitValue: value,
        lineValue: parsed.valid
          ? centsToInputValue(parsed.cents * row.quantity)
          : row.lineValue
      };
    });
  };

  const handleLineChange = (rowKey, value) => {
    updateRow(rowKey, (row) => {
      const parsed = parseCurrencyInput(value);
      return {
        ...row,
        lineValue: value,
        unitValue: parsed.valid && row.quantity > 0
          ? centsToInputValue(parsed.cents / row.quantity)
          : row.unitValue
      };
    });
  };

  const handleReset = () => {
    setRows(buildFormRows(order));
    setFormError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError('');
    if (!canExport || !invoiceOrder) {
      setFormError(t('invoice.invalidPrices', adminLanguage));
      return;
    }
    const exported = await onExport(invoiceOrder);
    if (!exported) {
      setFormError(t('toast.invoiceExportFailed', adminLanguage));
    }
  };

  if (!order) return null;

  const orderNumberText = getOrderNumberText(order);
  const pickupDate = normalizeDate(order?.pickupDate || order?.pickup_date || order?.created_at);
  const customerName = String(order?.customerName || order?.customer_name || '').trim();

  return (
    <div className="customer-modal-backdrop" role="dialog" aria-modal="true">
      <div className="customer-modal admin-invoice-review-modal">
        <form onSubmit={handleSubmit}>
          <div className="customer-modal-header">
            <div>
              <div className="detail-name">{t('invoice.title', adminLanguage)}</div>
              <div className="detail-meta">
                {orderNumberText ? `#${orderNumberText} · ` : ''}
                {customerName}
                {pickupDate ? ` · ${formatDateLong(pickupDate, adminLanguage)}` : ''}
              </div>
            </div>
            <button
              type="button"
              className="admin-button ghost modal-close"
              onClick={onClose}
            >
              {t('btn.close', adminLanguage)}
            </button>
          </div>

          <div className="admin-invoice-review-note">
            {t('invoice.invoiceOnly', adminLanguage)}
          </div>

          {rows.length > 0 ? (
            <div className="admin-table admin-invoice-review-table">
              <div className="admin-table-row admin-table-header">
                <div>{t('invoice.item', adminLanguage)}</div>
                <div>{t('invoice.qty', adminLanguage)}</div>
                <div>{t('invoice.unit', adminLanguage)}</div>
                <div>{t('invoice.line', adminLanguage)}</div>
              </div>
              {rows.map((row) => (
                <div key={row.key} className="admin-table-row">
                  <div className="admin-invoice-item-name">{row.description}</div>
                  <div>{row.quantity}</div>
                  <div>
                    <input
                      className="admin-input admin-invoice-price-input"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      aria-label={`${row.description} ${t('invoice.unit', adminLanguage)}`}
                      value={row.unitValue}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => handleUnitChange(row.key, event.target.value)}
                    />
                  </div>
                  <div>
                    <input
                      className="admin-input admin-invoice-price-input"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      aria-label={`${row.description} ${t('invoice.line', adminLanguage)}`}
                      value={row.lineValue}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => handleLineChange(row.key, event.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="date-change-warning">{t('invoice.noItems', adminLanguage)}</div>
          )}

          <div className="admin-invoice-summary">
            <div>
              <span>{t('invoice.total', adminLanguage)}</span>
              <strong>{formatCurrency(totalCents / 100)}</strong>
            </div>
            <div>
              <span>{t('invoice.paid', adminLanguage)}</span>
              <strong>{formatCurrency(paidCents / 100)}</strong>
            </div>
            <div>
              <span>{t('invoice.due', adminLanguage)}</span>
              <strong>{formatCurrency(dueCents / 100)}</strong>
            </div>
          </div>

          {pricesChanged && (
            <div className="detail-meta admin-invoice-price-change">
              {t('invoice.changed', adminLanguage)}
            </div>
          )}

          {(formError || hasInvalidPrice) && (
            <div className="date-change-warning admin-invoice-error">
              {formError || t('invoice.invalidPrices', adminLanguage)}
            </div>
          )}

          <div className="admin-edit-order-actions">
            <button
              type="button"
              className="admin-button ghost"
              onClick={onClose}
              disabled={exporting}
            >
              {t('btn.cancel', adminLanguage)}
            </button>
            <button
              type="button"
              className="admin-button ghost"
              onClick={handleReset}
              disabled={exporting || !pricesChanged}
            >
              {t('invoice.reset', adminLanguage)}
            </button>
            <button
              type="submit"
              className="admin-button"
              disabled={!canExport}
            >
              {exporting ? t('invoice.exporting', adminLanguage) : t('invoice.export', adminLanguage)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

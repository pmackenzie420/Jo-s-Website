import { useEffect, useMemo, useState } from 'react';
import {
  LOCATION_LABELS,
  buildPickupKey,
  parsePickupKey,
  normalizeDate,
  formatDateLong,
  formatCurrency,
  getLocalizedProductName
} from '../admin-utils';
import { t, tf } from '../admin-i18n';
import { formatPhone, normalizePhone } from '../../hooks/useForm';
import {
  getTierPrice,
  getMinOrderQuantity,
  isPickupRestricted
} from '../../utils/catalog';

const pad2 = (value) => String(value).padStart(2, '0');
const EMPTY_PICKUP_INVENTORY = Object.freeze({});
const toIsoLocalDate = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const parseAmountToCents = (value, { allowZero = false } = {}) => {
  const text = String(value ?? '').trim();
  if (!text) {
    return allowZero ? { valid: true, cents: 0 } : { valid: false, cents: 0 };
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { valid: false, cents: 0 };
  const cents = Math.round(parsed * 100);
  if (cents < 0) return { valid: false, cents: 0 };
  if (!allowZero && cents <= 0) return { valid: false, cents: 0 };
  return { valid: true, cents };
};

export default function AdminCreateOrderPage({
  dataLoading,
  hens,
  dates,
  allPickupStocks,
  allPickupReserved,
  adminLanguage,
  onCreateOrder
}) {
  const [pickupKey, setPickupKey] = useState('');
  const [customer, setCustomer] = useState({
    name: '',
    phone: '',
    email: '',
    address: ''
  });
  const [language, setLanguage] = useState('en');
  const [paymentMethod, setPaymentMethod] = useState('etransfer');
  const [paidAmount, setPaidAmount] = useState('');
  const [paidAmountTouched, setPaidAmountTouched] = useState(false);
  const [qtyByHenId, setQtyByHenId] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const isCreditCard = paymentMethod === 'credit_card';

  const todayIso = useMemo(() => toIsoLocalDate(new Date()), []);

  const pickupOptions = useMemo(() => {
    const list = Array.isArray(dates) ? dates : [];
    const normalized = list
      .map((row) => ({
        date: normalizeDate(row?.date_value),
        location: String(row?.location || '').trim()
      }))
      .filter((row) => row.date && row.location)
      .filter((row) => !todayIso || row.date >= todayIso)
      .sort((a, b) => {
        const dateCmp = String(a.date).localeCompare(String(b.date));
        if (dateCmp) return dateCmp;
        const labelA = LOCATION_LABELS[a.location] || a.location;
        const labelB = LOCATION_LABELS[b.location] || b.location;
        return String(labelA).localeCompare(String(labelB));
      });

    return normalized.map((row) => {
      const key = buildPickupKey(row.date, row.location);
      const locationLabel = LOCATION_LABELS[row.location] || row.location;
      return {
        key,
        label: `${formatDateLong(row.date, adminLanguage)} · ${locationLabel}`,
        date: row.date,
        location: row.location
      };
    });
  }, [dates, todayIso, adminLanguage]);

  useEffect(() => {
    if (pickupKey) return;
    if (pickupOptions.length === 0) return;
    setPickupKey(pickupOptions[0].key);
  }, [pickupKey, pickupOptions]);

  useEffect(() => {
    if (!Array.isArray(hens)) return;
    setQtyByHenId((prev) => {
      const next = { ...prev };
      hens.forEach((hen) => {
        const key = String(hen.id);
        if (!(key in next)) {
          next[key] = 0;
        }
      });
      return next;
    });
  }, [hens]);

  const { date: pickupDate, location: pickupLocation } = parsePickupKey(pickupKey);
  const pickupStocks = allPickupStocks?.[pickupKey] ?? EMPTY_PICKUP_INVENTORY;
  const pickupReserved = allPickupReserved?.[pickupKey] ?? EMPTY_PICKUP_INVENTORY;

  const lineItems = useMemo(() => {
    if (!Array.isArray(hens)) return [];
    return hens.map((hen) => {
      const henId = Number(hen.id);
      const qty = Number(qtyByHenId[String(hen.id)] || 0);
      const available = Number(pickupStocks?.[henId] || 0);
      const reserved = Number(pickupReserved?.[henId] || 0);
      const total = available + reserved;

      const unitPrice = qty > 0 ? getTierPrice(hen.name, qty) : 0;
      const unitCents = Math.round(unitPrice * 100);
      const lineCents = unitCents * qty;
      const minQty = getMinOrderQuantity(hen.name);
      const pickupRestricted = qty > 0 && isPickupRestricted(hen.name, pickupLocation);

      return {
        id: henId,
        name: hen.name,
        displayName: getLocalizedProductName(hen.name, adminLanguage),
        qty,
        unitCents,
        lineCents,
        minQty,
        pickupRestricted,
        available,
        reserved,
        total
      };
    });
  }, [hens, qtyByHenId, pickupStocks, pickupReserved, pickupLocation, adminLanguage]);

  const orderItems = useMemo(
    () => lineItems.filter((row) => Number.isFinite(row.qty) && row.qty > 0),
    [lineItems]
  );

  const totalCents = useMemo(
    () => orderItems.reduce((sum, row) => sum + (Number(row.lineCents) || 0), 0),
    [orderItems]
  );

  useEffect(() => {
    if (totalCents <= 0) {
      setPaidAmount('');
      setPaidAmountTouched(false);
      return;
    }
    if (!paidAmountTouched) {
      setPaidAmount((totalCents / 100).toFixed(2));
    }
  }, [totalCents, paidAmountTouched]);

  const paidParse = useMemo(
    () => parseAmountToCents(paidAmount, { allowZero: true }),
    [paidAmount]
  );

  const validationErrors = useMemo(() => {
    const errors = [];
    if (!customer.name.trim()) errors.push(t('val.nameRequired', adminLanguage));
    const normalizedPhone = normalizePhone(customer.phone || '');
    if (!normalizedPhone) {
      errors.push(t('val.phoneRequired', adminLanguage));
    } else if (normalizedPhone.length !== 10) {
      errors.push(t('val.phoneDigits', adminLanguage));
    }
    if (isCreditCard && !customer.email.trim()) {
      errors.push(t('val.emailRequiredCC', adminLanguage));
    }
    if (!pickupDate || !pickupLocation) errors.push(t('val.pickupRequired', adminLanguage));
    if (orderItems.length === 0) errors.push(t('val.addItem', adminLanguage));
    orderItems.forEach((row) => {
      if (row.pickupRestricted) {
        const locationLabel = LOCATION_LABELS[pickupLocation] || pickupLocation;
        errors.push(tf('val.notAvailable', adminLanguage, { item: row.displayName, location: locationLabel }));
      }
      if (row.minQty > 0 && row.qty > 0 && row.qty < row.minQty) {
        errors.push(tf('val.minOrder', adminLanguage, { min: row.minQty, item: row.displayName }));
      }
      if (row.qty > row.available) {
        errors.push(tf('val.insufficientStock', adminLanguage, { item: row.displayName }));
      }
    });
    if (orderItems.length > 0 && !paidParse.valid) {
      errors.push(t('val.paidInvalid', adminLanguage));
    }
    if (isCreditCard && paidParse.valid && paidParse.cents <= 0) {
      errors.push(t('val.paidInvalid', adminLanguage));
    }
    if (paidParse.valid && paidParse.cents > totalCents) {
      errors.push(t('val.amountExceedsTotal', adminLanguage));
    }

    return errors;
  }, [
    customer.name,
    customer.phone,
    customer.email,
    pickupDate,
    pickupLocation,
    orderItems,
    paidParse.valid,
    paidParse.cents,
    totalCents,
    isCreditCard,
    adminLanguage
  ]);

  const hasStartedOrder = useMemo(() => (
    Boolean(customer.name.trim())
    || Boolean(customer.phone.trim())
    || Boolean(customer.email.trim())
    || Boolean(customer.address.trim())
    || orderItems.length > 0
  ), [
    customer.name,
    customer.phone,
    customer.email,
    customer.address,
    orderItems.length
  ]);

  const paidCents = paidParse.valid ? paidParse.cents : 0;
  const dueCents = Math.max(totalCents - paidCents, 0);
  const autoPaymentType = (dueCents > 0)
    ? 'deposit'
    : 'full';
  
  const handleSetPaidToTotal = () => {
    if (totalCents <= 0) return;
    setPaidAmountTouched(true);
    setPaidAmount((totalCents / 100).toFixed(2));
  };

  const handleQtyChange = (henId, value) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    setQtyByHenId((prev) => ({ ...prev, [String(henId)]: safe }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError('');
    if (validationErrors.length > 0 || submitting) {
      setFormError(validationErrors[0] || t('val.fixErrors', adminLanguage));
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        customer: {
          name: customer.name.trim(),
          phone: customer.phone.trim(),
          email: customer.email.trim(),
          address: customer.address.trim()
        },
        pickup: {
          date: pickupDate,
          location: pickupLocation
        },
        items: orderItems.map((row) => ({
          id: row.id,
          quantity: row.qty
        })),
        payment: {
          method: paymentMethod,
          payment_type: autoPaymentType,
          amount_paid_cents: paidCents
        },
        language
      };

      const result = await onCreateOrder(payload);
      if (result?.stripeUrl) {
        window.location.href = result.stripeUrl;
        return;
      }
      if (result?.success) {
        setQtyByHenId((prev) =>
          Object.fromEntries(Object.keys(prev).map((key) => [key, 0]))
        );
        setCustomer((prev) => ({ ...prev, phone: '', name: '', email: '', address: '' }));
        setPaymentMethod('etransfer');
        setPaidAmount('');
        setPaidAmountTouched(false);
      }
    } catch {
      // Error toast handled by controller
    } finally {
      setSubmitting(false);
    }
  };

  if (dataLoading) {
    return <div className="admin-panel">{t('create.loading', adminLanguage)}</div>;
  }

  return (
    <div className="admin-stack admin-create-order">
      <section className="pickup-day stagger-item">
        <div className="pickup-location">
          <div className="pickup-location-header">
            <div className="pickup-location-title">{t('create.title', adminLanguage)}</div>
          </div>

          <form className="pickup-day-body" onSubmit={handleSubmit}>
            <div className="date-change-panel" style={{ maxWidth: 780 }}>
              <label className="admin-label" htmlFor="create-order-pickup">
                {t('create.pickupDate', adminLanguage)}
              </label>
              <select
                id="create-order-pickup"
                className="admin-input"
                value={pickupKey}
                onChange={(event) => setPickupKey(event.target.value)}
              >
                {pickupOptions.length === 0 && (
                  <option value="">{t('create.noPickupDates', adminLanguage)}</option>
                )}
                {pickupOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>

              <div className="admin-grid-2" style={{ marginTop: 14 }}>
                <div>
                  <label className="admin-label" htmlFor="create-order-name">
                    {t('create.customerName', adminLanguage)}
                  </label>
                  <input
                    id="create-order-name"
                    className="admin-input"
                    value={customer.name}
                    onChange={(event) =>
                      setCustomer((prev) => ({ ...prev, name: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label" htmlFor="create-order-phone">
                    {t('create.phone', adminLanguage)}
                  </label>
                  <input
                    id="create-order-phone"
                    className="admin-input"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="(555) 123-4567"
                    value={customer.phone}
                    onChange={(event) =>
                      setCustomer((prev) => ({
                        ...prev,
                        phone: formatPhone(event.target.value)
                      }))
                    }
                    onBlur={() =>
                      setCustomer((prev) => ({
                        ...prev,
                        phone: formatPhone(prev.phone)
                      }))
                    }
                  />
                </div>
              </div>

              <div className="admin-grid-2" style={{ marginTop: 14 }}>
                <div>
                  <label className="admin-label" htmlFor="create-order-email">
                    {isCreditCard ? t('create.email', adminLanguage) : t('create.emailOptional', adminLanguage)}
                  </label>
                  <input
                    id="create-order-email"
                    className="admin-input"
                    value={customer.email}
                    onChange={(event) =>
                      setCustomer((prev) => ({ ...prev, email: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="admin-label" htmlFor="create-order-address">
                    {t('create.address', adminLanguage)}
                  </label>
                  <input
                    id="create-order-address"
                    className="admin-input"
                    value={customer.address}
                    onChange={(event) =>
                      setCustomer((prev) => ({ ...prev, address: event.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="admin-grid-2" style={{ marginTop: 14 }}>
                <div>
                  <label className="admin-label" htmlFor="create-order-language">
                    {t('create.orderLanguage', adminLanguage)}
                  </label>
                  <select
                    id="create-order-language"
                    className="admin-input"
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                  >
                    <option value="en">{t('create.langEn', adminLanguage)}</option>
                    <option value="fr">{t('create.langFr', adminLanguage)}</option>
                  </select>
                </div>
                <div>
                  <label className="admin-label" htmlFor="create-order-payment-method">
                    {t('create.paymentMethod', adminLanguage)}
                  </label>
                  <select
                    id="create-order-payment-method"
                    className="admin-input"
                    value={paymentMethod}
                    onChange={(event) => setPaymentMethod(event.target.value)}
                  >
                    <option value="etransfer">{t('create.etransfer', adminLanguage)}</option>
                    <option value="cash">{t('create.cash', adminLanguage)}</option>
                    <option value="cheque">{t('create.cheque', adminLanguage)}</option>
                    <option value="credit_card">{t('create.creditCard', adminLanguage)}</option>
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <div className="pickup-location-title" style={{ fontSize: 16 }}>
                  {t('create.items', adminLanguage)}
                </div>
                <div className="admin-table" style={{ marginTop: 10 }}>
                  <div className="admin-table-row admin-table-header">
                    <div>{t('create.product', adminLanguage)}</div>
                    <div>{t('create.reserved', adminLanguage)}</div>
                    <div>{t('create.available', adminLanguage)}</div>
                    <div>{t('create.total', adminLanguage)}</div>
                    <div>{t('create.qty', adminLanguage)}</div>
                    <div>{t('create.unit', adminLanguage)}</div>
                    <div>{t('create.line', adminLanguage)}</div>
                  </div>
                  {lineItems.map((row) => (
                    <div key={row.id} className="admin-table-row">
                      <div style={{ fontWeight: 600 }}>{row.displayName}</div>
                      <div>{row.reserved}</div>
                      <div>{row.available}</div>
                      <div>{row.total}</div>
                      <div>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          className="admin-input"
                          style={{ width: 90 }}
                          value={row.qty === 0 ? '' : row.qty}
                          placeholder="0"
                          onFocus={(event) => event.target.select()}
                          onChange={(event) => handleQtyChange(row.id, event.target.value)}
                        />
                      </div>
                      <div>{row.qty > 0 ? formatCurrency(row.unitCents / 100) : ''}</div>
                      <div>{row.qty > 0 ? formatCurrency(row.lineCents / 100) : ''}</div>
                    </div>
                  ))}
                </div>
              </div>

              {orderItems.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <label className="admin-label" htmlFor="create-order-paid">
                    {t('create.amountReceived', adminLanguage)}
                  </label>
                  <div className="admin-create-order-paid-row">
                    <input
                      id="create-order-paid"
                      className="admin-input"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      style={{ width: 180 }}
                      value={paidAmount}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => {
                        setPaidAmountTouched(true);
                        setPaidAmount(event.target.value);
                      }}
                    />
                    <button
                      type="button"
                      className="admin-button ghost small"
                      onClick={handleSetPaidToTotal}
                      disabled={totalCents <= 0}
                    >
                      {t('create.setToTotal', adminLanguage)}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ marginTop: 18 }}>
                <div className="date-selected">
                  {t('create.totalLabel', adminLanguage)} <strong>{formatCurrency(totalCents / 100)}</strong>
                  {isCreditCard && (
                    <>
                      {' '}· {t('create.stripeCharge', adminLanguage)}{' '}
                      <strong>{formatCurrency(paidCents / 100)}</strong>
                    </>
                  )}
                  {dueCents > 0 && (
                    <>
                      {' '}· {tf('create.dueAtPickup', adminLanguage, { amount: formatCurrency(dueCents / 100) })}
                    </>
                  )}
                </div>
              </div>

              {(formError || (hasStartedOrder && validationErrors.length > 0)) && (
                <div className="date-change-warning" style={{ marginTop: 14 }}>
                  {formError || validationErrors[0]}
                </div>
              )}

              <div className="admin-create-order-actions" style={{ marginTop: 16 }}>
                <div className="admin-create-order-submit">
                  <button
                    className="admin-button"
                    type="submit"
                    disabled={submitting || validationErrors.length > 0}
                  >
                    {submitting
                      ? t('create.creating', adminLanguage)
                      : isCreditCard
                        ? t('create.createStripe', adminLanguage)
                        : t('create.createOrder', adminLanguage)}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

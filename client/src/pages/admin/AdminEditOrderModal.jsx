import { useEffect, useMemo, useState } from 'react';
import {
  LOCATION_LABELS,
  buildPickupKey,
  parsePickupKey,
  normalizeDate,
  formatDateLong,
  formatCurrency,
  parseItems,
  getLocalizedProductName
} from '../admin-utils';
import { t, tf } from '../admin-i18n';
import {
  getTierPrice,
  getMinOrderQuantity,
  isPickupRestricted,
  isLohmannHenName,
  isLambName,
  getDepositEligibleMinQty,
  getDepositRequiredAboveQty
} from '../../utils/catalog';

const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PAYMENT_METHOD_LABELS = {
  etransfer: 'E-transfer',
  cash: 'Cash',
  cheque: 'Cheque',
  credit_card: 'Credit card'
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

const getOrderPaidCents = (order) => {
  const direct = Number(order?.amount_paid_cents);
  if (Number.isFinite(direct) && direct >= 0) return Math.floor(direct);
  const fallback = Number(order?.amountPaid || 0);
  if (Number.isFinite(fallback) && fallback >= 0) return Math.round(fallback * 100);
  return 0;
};

const getOrderCustomerEmail = (order) => {
  const fromOrder = String(order?.customer_email || '').trim();
  if (fromOrder) return fromOrder;
  return String(order?.customerEmail || '').trim();
};

const getSourceOrderItems = (order) => {
  // Always parse from raw items JSON to preserve stored unit_cents/line_cents
  const rawItems = parseItems(order?.items);
  const source = rawItems.length > 0
    ? rawItems
    : (Array.isArray(order?.orderItems) && order.orderItems.length > 0
      ? order.orderItems
      : []);
  const totals = new Map();

  for (const item of source) {
    const id = Number(item?.id);
    const quantityRaw = Number(item?.quantity ?? item?.qty);
    const quantity = Number.isFinite(quantityRaw) ? Math.floor(quantityRaw) : 0;
    if (!Number.isInteger(id) || id <= 0 || quantity <= 0) continue;

    const storedUnitCents = Number(item?.unit_cents ?? item?.unitCents);
    const storedLineCents = Number(item?.line_cents ?? item?.lineCents);

    const existing = totals.get(id) || {
      id,
      name: String(item?.name || '').trim(),
      quantity: 0,
      storedUnitCents: NaN,
      storedLineCents: 0
    };
    totals.set(id, {
      id,
      name: existing.name || String(item?.name || '').trim(),
      quantity: existing.quantity + quantity,
      storedUnitCents: Number.isFinite(storedUnitCents) ? storedUnitCents : existing.storedUnitCents,
      storedLineCents: existing.storedLineCents
        + (Number.isFinite(storedLineCents) ? storedLineCents : 0)
    });
  }

  return Array.from(totals.values()).sort((first, second) => first.id - second.id);
};

const buildQuantityMap = (items) => {
  const map = new Map();
  for (const item of items) {
    const id = Number(item?.id);
    const quantityRaw = Number(item?.quantity ?? item?.qty);
    const quantity = Number.isFinite(quantityRaw) ? Math.floor(quantityRaw) : 0;
    if (!Number.isInteger(id) || id <= 0 || quantity <= 0) continue;
    map.set(id, quantity);
  }
  return map;
};

const areQuantityMapsEqual = (first, second) => {
  const ids = new Set([...first.keys(), ...second.keys()]);
  for (const id of ids) {
    if ((first.get(id) || 0) !== (second.get(id) || 0)) {
      return false;
    }
  }
  return true;
};

export default function AdminEditOrderModal({
  order,
  dates,
  hens,
  allPickupStocks,
  adminLanguage,
  onClose,
  onSave
}) {
  const [pickupKey, setPickupKey] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [paymentType, setPaymentType] = useState('full');
  const [customerEmail, setCustomerEmail] = useState('');
  const [qtyByHenId, setQtyByHenId] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const orderPickupDate = normalizeDate(order?.pickupDate || order?.pickup_date);
  const orderPickupLocation = String(order?.pickupLocation || order?.pickup_location || '').trim();
  const orderPickupKey = buildPickupKey(orderPickupDate, orderPickupLocation);

  const pickupOptions = useMemo(() => {
    const rows = (Array.isArray(dates) ? dates : [])
      .map((row) => ({
        date: normalizeDate(row?.date_value),
        location: String(row?.location || '').trim()
      }))
      .filter((row) => row.date && row.location);

    const hasCurrent = rows.some((row) => (
      row.date === orderPickupDate && row.location === orderPickupLocation
    ));
    if (!hasCurrent && orderPickupDate && orderPickupLocation) {
      rows.push({
        date: orderPickupDate,
        location: orderPickupLocation
      });
    }

    rows.sort((first, second) => {
      const dateCompare = String(first.date).localeCompare(String(second.date));
      if (dateCompare) return dateCompare;
      const firstLabel = LOCATION_LABELS[first.location] || first.location;
      const secondLabel = LOCATION_LABELS[second.location] || second.location;
      return String(firstLabel).localeCompare(String(secondLabel));
    });

    return rows.map((row) => {
      const key = buildPickupKey(row.date, row.location);
      const locationLabel = LOCATION_LABELS[row.location] || row.location;
      return {
        key,
        date: row.date,
        location: row.location,
        label: `${formatDateLong(row.date, adminLanguage)} · ${locationLabel}`
      };
    });
  }, [dates, orderPickupDate, orderPickupLocation, adminLanguage]);

  const existingPaidCents = useMemo(() => getOrderPaidCents(order), [order]);

  const originalOrderInfo = useMemo(() => {
    const totalCentsOrig = Math.round(Number(order?.totalAmount || 0) * 100);
    const paidCentsOrig = Math.round(Number(order?.amountPaid || 0) * 100);
    const dueCentsOrig = Math.round(Number(order?.amountDue || 0) * 100);
    const paymentTypeLabel = order?.paymentType === 'deposit'
      ? t('edit.deposit', adminLanguage)
      : t('edit.fullPayment', adminLanguage);
    const methodRaw = String(order?.payment_method || '').trim().toLowerCase();
    const methodLabel = methodRaw ? (PAYMENT_METHOD_LABELS[methodRaw] || methodRaw) : '';
    return { totalCentsOrig, paidCentsOrig, dueCentsOrig, paymentTypeLabel, methodLabel };
  }, [order, adminLanguage]);

  const sourceOrderItems = useMemo(() => getSourceOrderItems(order), [order]);
  const sourceQtyById = useMemo(() => buildQuantityMap(sourceOrderItems), [sourceOrderItems]);
  const storedPriceById = useMemo(() => {
    const map = new Map();
    for (const item of sourceOrderItems) {
      if (Number.isFinite(item.storedUnitCents) && item.storedUnitCents >= 0) {
        map.set(item.id, {
          unitCents: Math.floor(item.storedUnitCents),
          lineCents: Number.isFinite(item.storedLineCents) && item.storedLineCents >= 0
            ? Math.floor(item.storedLineCents)
            : Math.floor(item.storedUnitCents) * item.quantity
        });
      }
    }
    return map;
  }, [sourceOrderItems]);

  const editableProducts = useMemo(() => {
    const productMap = new Map();
    (Array.isArray(hens) ? hens : []).forEach((hen) => {
      const id = Number(hen?.id);
      if (!Number.isInteger(id) || id <= 0) return;
      productMap.set(id, {
        id,
        name: String(hen?.name || '').trim() || `Item #${id}`,
        isLegacy: false
      });
    });
    sourceOrderItems.forEach((item) => {
      const id = Number(item?.id);
      if (!Number.isInteger(id) || id <= 0 || productMap.has(id)) return;
      productMap.set(id, {
        id,
        name: String(item?.name || '').trim() || `Item #${id}`,
        isLegacy: true
      });
    });
    return Array.from(productMap.values()).sort((first, second) =>
      String(first.name).localeCompare(String(second.name))
    );
  }, [hens, sourceOrderItems]);

  useEffect(() => {
    if (!order) return;
    setPickupKey(orderPickupKey);
    setPaidAmount((getOrderPaidCents(order) / 100).toFixed(2));
    setCustomerEmail(getOrderCustomerEmail(order));
    const nextQty = {};
    editableProducts.forEach((product) => {
      nextQty[String(product.id)] = 0;
    });
    sourceOrderItems.forEach((item) => {
      nextQty[String(item.id)] = Number(item.quantity || 0);
    });
    setQtyByHenId(nextQty);
    setSubmitting(false);
    setFormError('');
  }, [order, orderPickupKey, editableProducts, sourceOrderItems]);

  const { date: pickupDate, location: pickupLocation } = parsePickupKey(pickupKey);
  const selectedPickupKey = pickupDate && pickupLocation
    ? buildPickupKey(pickupDate, pickupLocation)
    : '';
  const pickupStocks = useMemo(
    () => (selectedPickupKey ? (allPickupStocks?.[selectedPickupKey] || {}) : {}),
    [allPickupStocks, selectedPickupKey]
  );
  const pickupMatchesSource = (
    pickupDate === orderPickupDate
    && pickupLocation === orderPickupLocation
  );

  const lineItems = useMemo(() => {
    return editableProducts.map((product) => {
      const id = Number(product.id);
      const qtyRaw = Number(qtyByHenId[String(id)] || 0);
      const qty = Number.isFinite(qtyRaw) ? Math.max(0, Math.floor(qtyRaw)) : 0;
      const available = Number(pickupStocks?.[id] || 0);
      const reservedByOrder = pickupMatchesSource ? (sourceQtyById.get(id) || 0) : 0;
      const availableForEdit = Math.max(available + reservedByOrder, 0);
      const displayName = getLocalizedProductName(product.name, adminLanguage);
      // Use stored prices when quantity matches the original order, recalculate otherwise
      const sourceQty = sourceQtyById.get(id) || 0;
      const stored = storedPriceById.get(id);
      let unitCents;
      let lineCents;
      if (qty > 0 && qty === sourceQty && stored) {
        unitCents = stored.unitCents;
        lineCents = stored.lineCents;
      } else {
        const unitPrice = qty > 0 ? getTierPrice(product.name, qty) : 0;
        unitCents = Math.round(unitPrice * 100);
        lineCents = unitCents * qty;
      }
      const minQty = getMinOrderQuantity(product.name);
      const pickupRestricted = qty > 0 && isPickupRestricted(product.name, pickupLocation);
      const insufficientStock = qty > availableForEdit;
      return {
        id,
        name: product.name,
        displayName,
        isLegacy: product.isLegacy,
        qty,
        availableForEdit,
        minQty,
        pickupRestricted,
        insufficientStock,
        unitCents,
        lineCents
      };
    });
  }, [
    editableProducts,
    adminLanguage,
    pickupLocation,
    pickupMatchesSource,
    pickupStocks,
    qtyByHenId,
    sourceQtyById,
    storedPriceById
  ]);
  const maxQtyByHenId = useMemo(() => {
    const map = new Map();
    lineItems.forEach((row) => {
      map.set(row.id, Math.max(Math.floor(Number(row.availableForEdit) || 0), 0));
    });
    return map;
  }, [lineItems]);

  const orderItems = useMemo(
    () => lineItems.filter((row) => row.qty > 0),
    [lineItems]
  );
  const requestedQtyById = useMemo(() => buildQuantityMap(orderItems), [orderItems]);
  const itemsChanged = useMemo(
    () => !areQuantityMapsEqual(sourceQtyById, requestedQtyById),
    [sourceQtyById, requestedQtyById]
  );
  const totalCents = useMemo(
    () => orderItems.reduce((sum, row) => sum + (Number(row.lineCents) || 0), 0),
    [orderItems]
  );

  // Deposit eligibility — same logic as regular checkout
  const depositInfo = useMemo(() => {
    let lohmannQty = 0;
    let lohmannSubtotalCents = 0;
    let nonLohmannSubtotalCents = 0;
    let lambQty = 0;
    let lambSubtotalCents = 0;

    orderItems.forEach((row) => {
      if (isLohmannHenName(row.name)) {
        lohmannQty += row.qty;
        lohmannSubtotalCents += row.lineCents;
      } else {
        nonLohmannSubtotalCents += row.lineCents;
        if (isLambName(row.name)) {
          lambQty += row.qty;
          lambSubtotalCents += row.lineCents;
        }
      }
    });

    const depositEligibleMinQty = Math.max(getDepositEligibleMinQty() || 13, 1);
    const depositRequiredAboveQty = Math.max(getDepositRequiredAboveQty() || 0, 0);
    const lohmannDepositEligible = lohmannQty >= depositEligibleMinQty;
    const depositRequired = depositRequiredAboveQty > 0 && lohmannQty > depositRequiredAboveQty;
    const hasLambs = lambQty > 0;

    // Deposit eligible if hens qualify OR has lambs (lambs are always deposit)
    const depositEligible = lohmannDepositEligible || hasLambs;

    // Lohmann deposit = 25% of lohmann subtotal
    const lohmannDepositCents = lohmannDepositEligible
      ? Math.floor(lohmannSubtotalCents / 4)
      : 0;

    // Deposit now = non-lohmann items + lohmann deposit (lambs are always full price as deposit)
    const depositNowCents = nonLohmannSubtotalCents + lohmannDepositCents;
    // Due at pickup = lohmann balance
    const depositDueCents = lohmannDepositEligible
      ? lohmannSubtotalCents - lohmannDepositCents
      : 0;

    return {
      lohmannQty,
      lohmannSubtotalCents,
      lohmannDepositCents,
      nonLohmannSubtotalCents,
      lambSubtotalCents,
      hasLambs,
      depositEligible,
      depositRequired,
      depositRequiredAboveQty,
      depositNowCents,
      depositDueCents
    };
  }, [orderItems]);

  // Deposit is only switchable if existing paid doesn't exceed the deposit amount
  const canSwitchToDeposit = depositInfo.depositEligible && existingPaidCents <= depositInfo.depositNowCents;

  // Initialize paymentType from order data
  useEffect(() => {
    if (!order) return;
    const orderPaid = getOrderPaidCents(order);
    if (orderPaid < totalCents && depositInfo.depositEligible && orderPaid <= depositInfo.depositNowCents) {
      setPaymentType('deposit');
    } else {
      setPaymentType('full');
    }
  }, [order]);

  // Auto-force deposit when required; reset to full when deposit is no longer valid
  useEffect(() => {
    if (depositInfo.depositRequired && paymentType !== 'deposit') {
      setPaymentType('deposit');
      return;
    }
    if (!canSwitchToDeposit && !depositInfo.depositRequired && paymentType === 'deposit') {
      setPaymentType('full');
    }
  }, [canSwitchToDeposit, depositInfo.depositRequired, paymentType]);

  const paidParse = useMemo(() => parseAmountToCents(paidAmount, { allowZero: true }), [paidAmount]);

  const paidCents = paidParse.valid ? paidParse.cents : 0;
  const dueCents = Math.max(totalCents - paidCents, 0);
  const payingNowCents = Math.max(paidCents - existingPaidCents, 0);
  const normalizedEmail = String(customerEmail || '').trim().toLowerCase();

  const validationErrors = useMemo(() => {
    const errors = [];
    if (!pickupDate || !pickupLocation) {
      errors.push(t('val.pickupRequired', adminLanguage));
    }
    if (orderItems.length === 0) {
      errors.push(t('val.addItem', adminLanguage));
    }
    orderItems.forEach((row) => {
      if (row.pickupRestricted) {
        const locationLabel = LOCATION_LABELS[pickupLocation] || pickupLocation;
        errors.push(tf('val.notAvailable', adminLanguage, { item: row.displayName, location: locationLabel }));
      }
      if (row.minQty > 0 && row.qty < row.minQty) {
        errors.push(tf('val.minOrder', adminLanguage, { min: row.minQty, item: row.displayName }));
      }
      if (row.insufficientStock) {
        errors.push(tf('val.insufficientStock', adminLanguage, { item: row.displayName }));
      }
    });
    if (!paidParse.valid) {
      errors.push(t('val.paidInvalid', adminLanguage));
    }
    if (normalizedEmail && !SIMPLE_EMAIL_PATTERN.test(normalizedEmail)) {
      errors.push(t('val.emailInvalid', adminLanguage));
    }
    if (paidParse.valid && paidCents < existingPaidCents) {
      errors.push(
        tf('val.paidBelowFloor', adminLanguage, { amount: formatCurrency(existingPaidCents / 100) })
      );
    }
    if (paidParse.valid && paidCents > totalCents) {
      errors.push(
        tf('val.paidExceedsTotal', adminLanguage, { paid: formatCurrency(paidCents / 100), total: formatCurrency(totalCents / 100) })
      );
    }
    return errors;
  }, [
    pickupDate,
    pickupLocation,
    orderItems,
    paidParse.valid,
    normalizedEmail,
    paidCents,
    totalCents,
    existingPaidCents,
    adminLanguage
  ]);

  const handleQtyChange = (henId, value) => {
    const parsed = Number(value);
    const requested = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    const maxAllowed = maxQtyByHenId.get(Number(henId));
    const safe = Number.isFinite(maxAllowed)
      ? Math.min(requested, Math.max(Math.floor(maxAllowed), 0))
      : requested;
    setQtyByHenId((prev) => ({ ...prev, [String(henId)]: safe }));
  };

  const handleSetPaidToTotal = () => {
    const value = Math.max(totalCents, existingPaidCents);
    setPaidAmount((value / 100).toFixed(2));
  };

  const handleSetPaidToDeposit = () => {
    const value = Math.max(depositInfo.depositNowCents, existingPaidCents);
    setPaidAmount((value / 100).toFixed(2));
  };

  const handlePaymentTypeChange = (newType) => {
    setPaymentType(newType);
    if (newType === 'full') {
      const value = Math.max(totalCents, existingPaidCents);
      setPaidAmount((value / 100).toFixed(2));
    } else {
      const value = Math.max(depositInfo.depositNowCents, existingPaidCents);
      setPaidAmount((value / 100).toFixed(2));
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError('');
    if (submitting || validationErrors.length > 0) {
      setFormError(validationErrors[0] || t('val.fixBeforeSave', adminLanguage));
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        pickup: {
          date: pickupDate,
          location: pickupLocation
        },
        order: {
          total_cents: totalCents
        },
        payment: {
          amount_paid_cents: paidCents
        },
        customer: {
          email: normalizedEmail
        }
      };
      if (itemsChanged) {
        payload.items = orderItems.map((row) => ({
          id: row.id,
          quantity: row.qty
        }));
      }
      await onSave(order.id, payload);
    } catch {
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  };

  if (!order) return null;

  return (
    <div className="customer-modal-backdrop" role="dialog" aria-modal="true">
      <div className="customer-modal admin-edit-order-modal">
        <form onSubmit={handleSubmit}>
          <div className="customer-modal-header">
            <div>
              <div className="detail-name">{t('edit.title', adminLanguage)}</div>
              <div className="detail-meta">
                {t('edit.currentPickup', adminLanguage)} {formatDateLong(orderPickupDate, adminLanguage)} ·{' '}
                {LOCATION_LABELS[orderPickupLocation] || orderPickupLocation}
              </div>
              <div className="detail-meta">
                {order.itemSummary || `${order.itemCount || 0} items`}
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

          <div className="admin-edit-order-original">
            {t('edit.original', adminLanguage)} {formatCurrency(originalOrderInfo.totalCentsOrig / 100)}
            {' · '}{originalOrderInfo.paymentTypeLabel}
            {originalOrderInfo.methodLabel ? ` · ${originalOrderInfo.methodLabel}` : ''}
            {' · '}{t('edit.paid', adminLanguage)} {formatCurrency(originalOrderInfo.paidCentsOrig / 100)}
            {originalOrderInfo.dueCentsOrig > 0
              ? ` · ${t('edit.due', adminLanguage)} ${formatCurrency(originalOrderInfo.dueCentsOrig / 100)}`
              : ''}
          </div>

          <label className="admin-label" htmlFor="edit-order-pickup">
            {t('edit.pickupDate', adminLanguage)}
          </label>
          <select
            id="edit-order-pickup"
            className="admin-input"
            value={pickupKey}
            onChange={(event) => setPickupKey(event.target.value)}
          >
            {pickupOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>

          <div style={{ marginTop: 14 }}>
            <div className="pickup-location-title" style={{ fontSize: 16 }}>
              {t('edit.items', adminLanguage)}
            </div>
            <div className="admin-table admin-edit-order-table" style={{ marginTop: 10 }}>
              <div className="admin-table-row admin-table-header">
                <div>{t('edit.product', adminLanguage)}</div>
                <div>{t('edit.qty', adminLanguage)}</div>
                <div className="admin-edit-order-unit">{t('edit.unit', adminLanguage)}</div>
                <div>{t('edit.line', adminLanguage)}</div>
              </div>
              {lineItems.map((row) => (
                <div key={row.id} className="admin-table-row">
                  <div style={{ fontWeight: 600 }}>
                    {row.displayName}
                    {row.isLegacy && (
                      <span className="detail-meta" style={{ display: 'block' }}>
                        {t('edit.legacyProduct', adminLanguage)}
                      </span>
                    )}
                  </div>
                  <div>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max={row.availableForEdit}
                      className="admin-input admin-edit-order-qty"
                      value={row.qty === 0 ? '' : row.qty}
                      placeholder="0"
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => handleQtyChange(row.id, event.target.value)}
                    />
                  </div>
                  <div className="admin-edit-order-unit">{row.qty > 0 ? formatCurrency(row.unitCents / 100) : ''}</div>
                  <div>{row.qty > 0 ? formatCurrency(row.lineCents / 100) : ''}</div>
                </div>
              ))}
            </div>
            <div className={
              `detail-meta admin-edit-order-note${totalCents > 0 && totalCents < existingPaidCents ? ' admin-edit-order-floor-warn' : ''}`
            }>
              {t('edit.totalFromItems', adminLanguage)} {formatCurrency(totalCents / 100)}
              {existingPaidCents > 0 && totalCents > 0
                ? ` · ${tf('edit.floor', adminLanguage, { amount: formatCurrency(existingPaidCents / 100) })}`
                : ''}
              {itemsChanged ? ` · ${t('edit.itemMixChanged', adminLanguage)}` : ''}
            </div>
          </div>

          {(canSwitchToDeposit || depositInfo.depositRequired) && orderItems.length > 0 && (
            <div style={{ marginTop: 14, maxWidth: 390 }}>
              <label className="admin-label" htmlFor="edit-order-payment-type">
                {t('edit.paymentType', adminLanguage)}
              </label>
              <select
                id="edit-order-payment-type"
                className="admin-input"
                value={paymentType}
                onChange={(event) => handlePaymentTypeChange(event.target.value)}
                disabled={depositInfo.depositRequired}
              >
                {!depositInfo.depositRequired && (
                  <option value="full">
                    {tf('edit.payFull', adminLanguage, { amount: formatCurrency(totalCents / 100) })}
                  </option>
                )}
                <option value="deposit">
                  {tf('edit.payDeposit', adminLanguage, { amount: formatCurrency(depositInfo.depositNowCents / 100) })}
                  {depositInfo.depositDueCents > 0
                    ? ` · ${tf('edit.depositDue', adminLanguage, { amount: formatCurrency(depositInfo.depositDueCents / 100) })}`
                    : ''}
                </option>
              </select>
              {depositInfo.depositRequired && (
                <div className="date-meta" style={{ marginTop: 4 }}>
                  {tf('edit.depositRequired', adminLanguage, { qty: depositInfo.depositRequiredAboveQty })}
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <label className="admin-label" htmlFor="edit-order-paid">
              {t('edit.amountPaid', adminLanguage)}
            </label>
            <div className="admin-create-order-paid-row">
              <input
                id="edit-order-paid"
                className="admin-input"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                style={{ width: 160 }}
                value={paidAmount}
                onFocus={(event) => event.target.select()}
                onChange={(event) => setPaidAmount(event.target.value)}
              />
              <button
                type="button"
                className="admin-button ghost small"
                onClick={handleSetPaidToTotal}
                disabled={totalCents <= 0}
              >
                {t('edit.setToTotal', adminLanguage)}
              </button>
              {depositInfo.depositEligible && paymentType === 'deposit' && (
                <button
                  type="button"
                  className="admin-button ghost small"
                  onClick={handleSetPaidToDeposit}
                  disabled={depositInfo.depositNowCents <= 0}
                >
                  {t('edit.setToDeposit', adminLanguage)}
                </button>
              )}
            </div>
          </div>

          <label className="admin-label" htmlFor="edit-order-email">
            {t('edit.customerEmail', adminLanguage)}
          </label>
          <input
            id="edit-order-email"
            className="admin-input"
            type="email"
            inputMode="email"
            value={customerEmail}
            onChange={(event) => setCustomerEmail(event.target.value)}
          />

          <div className="date-selected" style={{ marginTop: 12 }}>
            {t('edit.totalLabel', adminLanguage)} <strong>{formatCurrency(totalCents / 100)}</strong>
            {' '}· {t('edit.alreadyPaid', adminLanguage)} <strong>{formatCurrency(existingPaidCents / 100)}</strong>
            {' '}· {t('edit.payingNow', adminLanguage)} <strong>{formatCurrency(payingNowCents / 100)}</strong>
            {' '}· {t('edit.dueAtPickup', adminLanguage)} <strong>{formatCurrency(dueCents / 100)}</strong>
          </div>

          <div className="detail-meta admin-edit-order-note">
            {tf('edit.recordedPaid', adminLanguage, { amount: formatCurrency(existingPaidCents / 100) })}
          </div>

          {(formError || validationErrors.length > 0) && (
            <div className="date-change-warning" style={{ marginTop: 12 }}>
              {formError || validationErrors[0]}
            </div>
          )}

          <div className="admin-edit-order-actions">
            <button
              type="button"
              className="admin-button ghost"
              onClick={onClose}
            >
              {t('btn.cancel', adminLanguage)}
            </button>
            <button
              type="submit"
              className="admin-button"
              disabled={submitting || validationErrors.length > 0}
            >
              {submitting ? t('edit.saving', adminLanguage) : t('edit.saveChanges', adminLanguage)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

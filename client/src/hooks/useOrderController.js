import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../constants/api';
import { CHECKOUT_STORAGE_KEYS } from '../constants/checkout';
import {
  getTierPrice,
  getMinOrderQuantity,
  isPickupRestricted,
} from '../utils/catalog';

const getBilingualText = (text, lang) => {
  if (!text) return '';
  const parts = text.split(' / ');
  if (parts.length !== 2) return text;
  return lang === 'en' ? parts[0] : parts[1];
};

const { form: FORM_STORAGE_KEY } = CHECKOUT_STORAGE_KEYS;

const formatPickupDate = (value, lang) => {
  if (!value) return '';
  const dateString = typeof value === 'string' ? value : String(value);
  const date = dateString.length === 10 ? new Date(`${dateString}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
};

const getDisplayOrder = (name) => {
  const lower = (name || '').toLowerCase();
  if (lower.includes('brown') || lower.includes('brune') || (lower.includes('ready') && !lower.includes('white'))) return 0;
  if (lower.includes('white')) return 1;
  if (lower.includes('meat') || lower.includes('chair')) return 2;
  if (lower.includes('lamb') || lower.includes('agneau')) return 3;
  return 4;
};

const getRawStockForHen = (hen) => {
  const stockValue = Number(hen?.stock);
  return Number.isFinite(stockValue) ? stockValue : 0;
};

const buildCartItems = (hens, cart, getStockForHen) => {
  return Object.keys(cart)
    .filter((id) => cart[id] > 0)
    .map((id) => {
      const hen = hens.find((henItem) => henItem.id === parseInt(id, 10));
      if (!hen) return null;
      const qty = cart[id];
      const maxStock = getStockForHen(hen);
      const safeQty = Math.min(qty, maxStock);
      if (safeQty <= 0) return null;
      const unitPrice = getTierPrice(hen.name, safeQty);
      return { ...hen, qty: safeQty, unitPrice, lineTotal: safeQty * unitPrice };
    })
    .filter(Boolean);
};

const CART_STORAGE_KEY = 'hen_cart_data';

export default function useOrderController(lang) {
  const [hens, setHens] = useState([]);
  const [cart, setCart] = useState(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = sessionStorage.getItem(CART_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [loading, setLoading] = useState(false);
  const [pickupLocation, setPickupLocation] = useState('');
  const [pickupDate, setPickupDate] = useState('');
  const [availableDates, setAvailableDates] = useState([]);
  const [pickupDatesLoading, setPickupDatesLoading] = useState(false);
  const [pickupError, setPickupError] = useState(null);
  const networkErrorMessage =
    lang === 'en'
      ? 'Unable to load live inventory right now. Please try again.'
      : "Impossible de charger l'inventaire en ce moment. Veuillez réessayer.";
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
      } catch {
        // Ignore storage write issues.
      }
    }
  }, [cart]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const stored = window.sessionStorage.getItem(FORM_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object') return;
      if (parsed.pickupLocation) setPickupLocation(parsed.pickupLocation);
      if (parsed.pickupDate) setPickupDate(parsed.pickupDate);
    } catch {
      // Ignore storage read issues.
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const stored = window.sessionStorage.getItem(FORM_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : {};
      const next = { ...(parsed || {}), pickupLocation, pickupDate };
      window.sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage write issues.
    }
  }, [pickupLocation, pickupDate]);

  useEffect(() => {
    let isActive = true;
    const params =
      pickupLocation && pickupDate
        ? { pickup_location: pickupLocation, pickup_date: pickupDate }
        : {};
    setLoading(true);
    axios
      .get(`${API_URL}/hens`, { params })
      .then((res) => {
        if (!isActive) return;
        const rows = Array.isArray(res.data) ? res.data : [];
        rows.sort((a, b) => getDisplayOrder(a.name) - getDisplayOrder(b.name));
        setHens(rows);
        setPickupError(null);
      })
      .catch(() => {
        if (!isActive) return;
        setHens([]);
        setPickupError(networkErrorMessage);
      })
      .finally(() => {
        if (!isActive) return;
        setLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [pickupLocation, pickupDate, networkErrorMessage]);

  useEffect(() => {
    let isActive = true;
    if (!pickupLocation) {
      setAvailableDates([]);
      setPickupDatesLoading(false);
      return () => {
        isActive = false;
      };
    }
    setPickupDatesLoading(true);
    axios
      .get(`${API_URL}/pickup-dates`, { params: { location: pickupLocation } })
      .then((res) => {
        if (!isActive) return;
        const nextDates = Array.isArray(res.data) ? res.data : [];
        setAvailableDates(nextDates);
        setPickupError(null);
        const nextValues = nextDates
          .map((dateItem) =>
            typeof dateItem.date_value === 'string'
              ? dateItem.date_value.split('T')[0]
              : dateItem.date_value
          )
          .filter(Boolean);
        if (pickupDate && !nextValues.includes(pickupDate)) {
          setPickupDate('');
        }
      })
      .catch(() => {
        if (!isActive) return;
        setAvailableDates([]);
        setPickupError(networkErrorMessage);
      })
      .finally(() => {
        if (!isActive) return;
        setPickupDatesLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [pickupLocation, pickupDate, networkErrorMessage]);

  const availableDateValues = useMemo(() => {
    const values = availableDates
      .map((dateItem) =>
        typeof dateItem.date_value === 'string'
          ? dateItem.date_value.split('T')[0]
          : dateItem.date_value
      )
      .filter(Boolean);
    return values.sort();
  }, [availableDates]);

  const pickupReady = Boolean(pickupLocation && pickupDate);
  const pickupSelectionMessage =
    lang === 'en'
      ? 'Select a pickup date and location first.'
      : 'Veuillez d’abord choisir une date et un lieu de ramassage.';

  const isHenBlocked = useCallback((hen) => {
    return isPickupRestricted(hen?.name, pickupLocation);
  }, [pickupLocation]);

  const getStockForHen = useCallback((hen) => {
    if (!pickupReady) return 0;
    if (isHenBlocked(hen)) return 0;
    return getRawStockForHen(hen);
  }, [pickupReady, isHenBlocked]);

  const updateQty = (id, val) => {
    const hen = hens.find((henItem) => henItem.id === id);
    if (!pickupReady) {
      setPickupError(pickupSelectionMessage);
      return;
    }
    if (pickupError) {
      setPickupError(null);
    }
    const maxStock = getStockForHen(hen);
    if (maxStock <= 0) {
      return;
    }
    if (val === '') {
      setCart((prev) => ({ ...prev, [id]: '' }));
      return;
    }
    if (/^\d+$/.test(val)) {
      const nextValue = Math.min(parseInt(val, 10), maxStock);
      setCart((prev) => ({ ...prev, [id]: nextValue }));
    }
  };

  const increment = (id) => {
    const hen = hens.find((henItem) => henItem.id === id);
    if (!pickupReady) {
      setPickupError(pickupSelectionMessage);
      return;
    }
    if (pickupError) {
      setPickupError(null);
    }
    const maxStock = getStockForHen(hen);
    const current = cart[id] === '' || cart[id] === undefined ? 0 : cart[id];
    if (current < maxStock) {
      setCart((prev) => ({ ...prev, [id]: current + 1 }));
    }
  };

  const decrement = (id) => {
    const current = cart[id] === '' || cart[id] === undefined ? 0 : cart[id];
    if (current > 0) {
      setCart((prev) => ({ ...prev, [id]: current - 1 }));
    }
  };

  const cartItems = useMemo(
    () => buildCartItems(hens, cart, getStockForHen),
    [hens, cart, getStockForHen]
  );

  const grandTotal = useMemo(
    () => cartItems.reduce((acc, item) => acc + item.lineTotal, 0),
    [cartItems]
  );

  const hasMeatChickenMinimumError = useMemo(() => {
    return hens.some((hen) => {
      const minQty = getMinOrderQuantity(hen.name);
      const qtyRaw = cart[hen.id];
      const qty = qtyRaw === '' || qtyRaw === undefined ? 0 : qtyRaw;
      const maxStock = getStockForHen(hen);
      const safeQty = Math.min(qty, maxStock);
      return minQty > 0 && safeQty > 0 && safeQty < minQty;
    });
  }, [hens, cart, getStockForHen]);

  useEffect(() => {
    if (!pickupReady) {
      return;
    }
    setCart((prev) => {
      let changed = false;
      const next = { ...prev };
      hens.forEach((hen) => {
        const maxStock = getStockForHen(hen);
        const current = next[hen.id];
        if (current === '' || current === undefined) return;
        const currentValue = Number(current);
        if (!Number.isFinite(currentValue)) return;
        if (currentValue > maxStock) {
          next[hen.id] = Math.max(maxStock, 0);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [hens, pickupReady, getStockForHen]);

  const handleCheckout = () => {
    if (!pickupReady) {
      setPickupError(pickupSelectionMessage);
      return;
    }
    if (pickupError) {
      setPickupError(null);
    }
    const items = buildCartItems(hens, cart, getStockForHen).map((item) => ({
      ...item,
      id: Number(item.id),
    }));
    if (items.length === 0) {
      return;
    }
    const total = items.reduce((acc, item) => acc + item.lineTotal, 0);
    navigate('/checkout', { state: { cartItems: items, grandTotal: total } });
  };

  return {
    hens,
    cart,
    loading,
    setLoading,
    pickupLocation,
    setPickupLocation,
    pickupDate,
    setPickupDate,
    availableDateValues,
    pickupDatesLoading,
    pickupError,
    pickupReady,
    isHenBlocked,
    formatPickupDate: (value) => formatPickupDate(value, lang),
    updateQty,
    increment,
    decrement,
    cartItems,
    grandTotal,
    handleCheckout,
    hasMeatChickenMinimumError,
    getBilingualText: (text) => getBilingualText(text, lang),
    getTierPrice,
    getStockForHen,
  };
}

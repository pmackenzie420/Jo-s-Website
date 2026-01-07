import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../constants/api';

const getBilingualText = (text, lang) => {
  if (!text) return '';
  const parts = text.split(' / ');
  if (parts.length !== 2) return text;
  return lang === 'en' ? parts[0] : parts[1];
};

const getTierPrice = (henName, qty) => {
  const quantity = qty || 0;
  if (henName.includes('Lohmann') || henName.includes('Ready-to-Lay')) {
    if (quantity >= 50) return 14.0;
    if (quantity >= 13) return 15.25;
    if (quantity >= 6) return 17.0;
    return 17.5;
  }
  if (henName.includes('Meat') || henName.includes('Chair')) {
    if (quantity >= 300) return 2.15;
    if (quantity >= 100) return 2.3;
    if (quantity >= 49) return 2.5;
    return 2.6;
  }
  return 0;
};

const getStockForHen = (hen) => {
  const stockValue = Number(hen?.stock);
  return Number.isFinite(stockValue) ? stockValue : 0;
};

const buildCartItems = (hens, cart) => {
  return Object.keys(cart)
    .filter((id) => cart[id] > 0)
    .map((id) => {
      const hen = hens.find((henItem) => henItem.id === parseInt(id, 10));
      if (!hen) return null;
      const qty = cart[id];
      const maxStock = getStockForHen(hen);
      const safeQty = Math.min(qty, maxStock);
      const unitPrice = getTierPrice(hen.name, safeQty);
      return { ...hen, qty: safeQty, unitPrice, lineTotal: safeQty * unitPrice };
    })
    .filter(Boolean);
};

export default function useOrderController(lang) {
  const [hens, setHens] = useState([]);
  const [cart, setCart] = useState({});
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    axios
      .get(`${API_URL}/hens`)
      .then((res) => setHens(Array.isArray(res.data) ? res.data : []))
      .catch((err) => {
        console.error('Error fetching hens:', err);
        setHens([]);
      });
  }, []);

  const updateQty = (id, val) => {
    const hen = hens.find((henItem) => henItem.id === id);
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

  const cartItems = useMemo(() => buildCartItems(hens, cart), [hens, cart]);

  const grandTotal = useMemo(
    () => cartItems.reduce((acc, item) => acc + item.lineTotal, 0),
    [cartItems]
  );

  const hasMeatChickenMinimumError = useMemo(() => {
    return hens.some((hen) => {
      const isMeatChicken = hen.name.includes('Meat') || hen.name.includes('Chair');
      const qtyRaw = cart[hen.id];
      const qty = qtyRaw === '' || qtyRaw === undefined ? 0 : qtyRaw;
      const maxStock = getStockForHen(hen);
      const safeQty = Math.min(qty, maxStock);
      return isMeatChicken && safeQty > 0 && safeQty < 25;
    });
  }, [hens, cart]);

  const handleCheckout = () => {
    const items = buildCartItems(hens, cart).map((item) => ({
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

import { useState, useEffect } from 'react';
import axios from 'axios';

// IMPORTANT: Ensure this matches your Vite env logic
const API_URL = 'http://localhost:3000/api';

export default function Order({ lang }) {
  const [hens, setHens] = useState([]);
  const [cart, setCart] = useState({}); 
  const [loading, setLoading] = useState(false);

  // Content Dictionary (Local to this page)
  const t = {
    title: lang === 'en' ? "Order Online" : "Commander en ligne",
    summary: lang === 'en' ? "Order Summary" : "Résumé de la commande",
    checkout: lang === 'en' ? "PROCEED TO CHECKOUT" : "PAYER",
    empty: lang === 'en' ? "Cart is empty" : "Panier vide",
    unit: lang === 'en' ? "ea." : "ch."
  };

  useEffect(() => {
    axios.get(`${API_URL}/hens`)
      .then(res => setHens(Array.isArray(res.data) ? res.data : []))
      .catch(err => setHens([]));
  }, []);

  const getBilingualText = (text) => {
    if (!text) return "";
    const parts = text.split(' / ');
    return parts.length === 2 ? (lang === 'en' ? parts[0] : parts[1]) : text;
  };

  const getTierPrice = (henName, qty) => {
    const q = qty || 0; 
    if (henName.includes('Lohmann') || henName.includes('Ready-to-Lay')) {
        if (q >= 50) return 14.00;
        if (q >= 13) return 15.25;
        if (q >= 6)  return 17.00;
        return 17.50;
    }
    if (henName.includes('Meat') || henName.includes('Chair')) {
        if (q >= 300) return 2.15;
        if (q >= 100) return 2.30;
        if (q >= 49)  return 2.50;
        return 2.60;
    }
    return 0;
  };

  // --- FIX: INPUT VALIDATION ---
  const updateQty = (id, val) => {
    // 1. Allow empty string (deleting)
    if (val === "") {
        setCart(prev => ({ ...prev, [id]: "" }));
        return;
    }
    // 2. REGEX: Only allow Digits (0-9)
    if (/^\d+$/.test(val)) {
        setCart(prev => ({ ...prev, [id]: parseInt(val) }));
    }
  };

  const increment = (id) => {
    const current = (cart[id] === "" || cart[id] === undefined) ? 0 : cart[id];
    setCart(prev => ({ ...prev, [id]: current + 1 }));
  };

  const decrement = (id) => {
    const current = (cart[id] === "" || cart[id] === undefined) ? 0 : cart[id];
    if (current > 0) setCart(prev => ({ ...prev, [id]: current - 1 }));
  };

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const items = Object.keys(cart)
        .filter(id => cart[id] > 0)
        .map(id => ({ id: parseInt(id), quantity: cart[id] }));
        
      const res = await axios.post(`${API_URL}/create-checkout-session`, { items });
      window.location.href = res.data.url; 
    } catch (err) {
      alert("Backend error.");
      setLoading(false);
    }
  };

  const cartItems = Object.keys(cart).filter(id => cart[id] > 0).map(id => {
      const hen = hens.find(h => h.id === parseInt(id));
      if (!hen) return null;
      const qty = cart[id];
      const unitPrice = getTierPrice(hen.name, qty);
      return { ...hen, qty, unitPrice, lineTotal: qty * unitPrice };
  }).filter(Boolean);

  const grandTotal = cartItems.reduce((acc, item) => acc + item.lineTotal, 0);

  return (
    <div className="order-layout">
        {/* Left Column */}
        <div className="product-list">
            <h2 style={{borderBottom: '1px solid black', paddingBottom: '10px'}}>{t.title}</h2>
            {hens.map(hen => {
                const qtyRaw = cart[hen.id];
                const qty = (qtyRaw === "" || qtyRaw === undefined) ? 0 : qtyRaw;
                const unitPrice = getTierPrice(hen.name, qty);

                return (
                    <div key={hen.id} className="product-card">
                        <img src={hen.image_url} alt={hen.name} className="product-img"/>
                        <div className="product-info">
                            <h3 style={{marginTop: 0}}>{getBilingualText(hen.name)}</h3>
                            <div style={{marginBottom: '10px', fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--color-brand)'}}>
                                ${unitPrice.toFixed(2)} / {t.unit}
                            </div>
                            <div style={{marginTop: 'auto'}}>
                                <div className="stepper">
                                    <button onClick={() => decrement(hen.id)}>-</button>
                                    <input 
                                        type="text" 
                                        value={cart[hen.id] === undefined ? "" : cart[hen.id]}
                                        onChange={(e) => updateQty(hen.id, e.target.value)}
                                        placeholder="0"
                                    />
                                    <button onClick={() => increment(hen.id)}>+</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>

        {/* Right Column */}
        <div className="order-summary">
            <h3 style={{marginTop: 0, borderBottom: '1px solid #ddd', paddingBottom: '10px'}}>{t.summary}</h3>
            {cartItems.map(item => (
                <div key={item.id} className="summary-row">
                    <span><strong>{item.qty}</strong> x {getBilingualText(item.name).split(' / ')[0]}</span>
                    <span>${item.lineTotal.toFixed(2)}</span>
                </div>
            ))}
            <div className="summary-total">
                <span>Total</span>
                <span>${grandTotal.toFixed(2)}</span>
            </div>
            <button className="btn-checkout" onClick={handleCheckout} disabled={cartItems.length === 0 || loading}>
                {loading ? "..." : t.checkout}
            </button>
        </div>
    </div>
  );
}

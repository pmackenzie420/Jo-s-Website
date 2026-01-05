import useOrderController from '../hooks/useOrderController';

export default function Order({ lang }) {
  const {
    hens,
    cart,
    loading,
    updateQty,
    increment,
    decrement,
    cartItems,
    grandTotal,
    handleCheckout,
    hasMeatChickenMinimumError,
    getBilingualText,
    getTierPrice,
    getStockForHen,
  } = useOrderController(lang);

  // Content Dictionary (Local to this page)
  const t = {
    title: lang === 'en' ? "Order Online" : "Commander en ligne",
    summary: lang === 'en' ? "Order Summary" : "Résumé de la commande",
    checkout: lang === 'en' ? "PROCEED TO CHECKOUT" : "PAYER",
    empty: lang === 'en' ? "Cart is empty" : "Panier vide",
    unit: lang === 'en' ? "ea." : "ch."
  };

  return (
    <div className="order-layout">
      {/* Left Column */}
      <div className="product-list">
        <h2 style={{ borderBottom: '1px solid black', paddingBottom: '10px' }}>{t.title}</h2>
        {hens.map((hen) => {
          const qtyRaw = cart[hen.id];
          const qty = (qtyRaw === "" || qtyRaw === undefined) ? 0 : qtyRaw;
          const maxStock = getStockForHen(hen);
          const isOutOfStock = maxStock <= 0;
          const safeQty = Math.min(qty, maxStock);
          const unitPrice = getTierPrice(hen.name, safeQty);
          const isMeatChicken = hen.name.includes('Meat') || hen.name.includes('Chair');
          const stockLabel = isOutOfStock
            ? (lang === 'en' ? 'Out of stock' : 'Rupture de stock')
            : (lang === 'en' ? `Stock: ${maxStock}` : `Stock: ${maxStock}`);

          return (
            <div key={hen.id}>
              <div className={`product-card${isOutOfStock ? ' product-card--disabled' : ''}`}>
                <img src={hen.image_url} alt={hen.name} className="product-img" />
                <div className="product-info">
                  <h3 style={{ marginTop: 0 }}>{getBilingualText(hen.name)}</h3>
                  <div className="product-price">
                    ${unitPrice.toFixed(2)} / {t.unit}
                  </div>
                  <div className={`product-stock${isOutOfStock ? ' out-of-stock' : ''}`}>
                    {stockLabel}
                  </div>
                  {/* Minimum order note for meat chickens - show when qty is 1-24 */}
                  {isMeatChicken && safeQty > 0 && safeQty < 25 && (
                    <div style={{
                      padding: '8px 0',
                      marginBottom: '8px',
                      fontSize: '0.85rem',
                      color: '#666'
                    }}>
                      {lang === 'en'
                        ? "Minimum order: 25 meat birds"
                        : "Commande minimum de 25 poulets à chair"}
                    </div>
                  )}
                  <div style={{ marginTop: 'auto' }}>
                    <div className="stepper">
                      <button onClick={() => decrement(hen.id)} disabled={isOutOfStock}>-</button>
                      <input
                        type="text"
                        disabled={isOutOfStock}
                        value={cart[hen.id] === undefined ? "" : cart[hen.id]}
                        onChange={(e) => updateQty(hen.id, e.target.value)}
                        placeholder="0"
                      />
                      <button onClick={() => increment(hen.id)} disabled={isOutOfStock || safeQty >= maxStock}>+</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Right Column */}
      <div className="order-summary">
        <h3 style={{ marginTop: 0, borderBottom: '1px solid #ddd', paddingBottom: '10px' }}>{t.summary}</h3>
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
        <button className="btn-checkout" onClick={handleCheckout} disabled={cartItems.length === 0 || loading || hasMeatChickenMinimumError}>
          {loading ? "..." : t.checkout}
        </button>
      </div>
    </div>
  );
}

import useOrderController from '../../hooks/useOrderController';

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

  const t = {
    title: lang === 'en' ? 'Order Online' : 'Commander en ligne',
    summary: lang === 'en' ? 'Order Summary' : 'Résumé de la commande',
    checkout: lang === 'en' ? 'Proceed to Checkout' : 'Payer',
    unit: lang === 'en' ? 'ea.' : 'ch.',
  };

  return (
    <div className="mobile-order mobile-page">
      <div className="mobile-section">
        <h2 className="mobile-section-title">{t.title}</h2>
        {hens.map((hen) => {
          const qtyRaw = cart[hen.id];
          const qty = qtyRaw === '' || qtyRaw === undefined ? 0 : qtyRaw;
          const maxStock = getStockForHen(hen);
          const isOutOfStock = maxStock <= 0;
          const safeQty = Math.min(qty, maxStock);
          const unitPrice = getTierPrice(hen.name, safeQty);
          const isMeatChicken = hen.name.includes('Meat') || hen.name.includes('Chair');
          const stockLabel = isOutOfStock
            ? lang === 'en'
              ? 'Out of stock'
              : 'Rupture de stock'
            : lang === 'en'
              ? `Stock: ${maxStock}`
              : `Stock: ${maxStock}`;

          return (
            <div
              key={hen.id}
              className={`mobile-product-card${isOutOfStock ? ' is-disabled' : ''}`}
            >
              <img src={hen.image_url} alt={hen.name} className="mobile-product-image" />
              <div className="mobile-product-body">
                <h3>{getBilingualText(hen.name)}</h3>
                <div className="mobile-product-meta">
                  <p className="mobile-product-price">
                    ${unitPrice.toFixed(2)} / {t.unit}
                  </p>
                  <p className={`mobile-product-stock${isOutOfStock ? ' out' : ''}`}>{stockLabel}</p>
                </div>
                {isMeatChicken && safeQty > 0 && safeQty < 25 && (
                  <p className="mobile-hint">
                    {lang === 'en'
                      ? 'Minimum order: 25 meat birds'
                      : 'Commande minimum de 25 poulets à chair'}
                  </p>
                )}
                <div className="mobile-stepper">
                  <button onClick={() => decrement(hen.id)} disabled={isOutOfStock}>
                    -
                  </button>
                  <input
                    type="text"
                    disabled={isOutOfStock}
                    value={cart[hen.id] === undefined ? '' : cart[hen.id]}
                    onChange={(e) => updateQty(hen.id, e.target.value)}
                    placeholder="0"
                  />
                  <button
                    onClick={() => increment(hen.id)}
                    disabled={isOutOfStock || safeQty >= maxStock}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mobile-section">
        <div className="mobile-summary-card">
          <h3>{t.summary}</h3>
          {cartItems.length === 0 && (
            <p className="mobile-subtle">
              {lang === 'en' ? 'Cart is empty' : 'Panier vide'}
            </p>
          )}
          {cartItems.map((item) => (
            <div key={item.id} className="mobile-summary-row">
              <span>
                {item.qty} x {getBilingualText(item.name).split(' / ')[0]}
              </span>
              <span>${item.lineTotal.toFixed(2)}</span>
            </div>
          ))}
          <div className="mobile-summary-total">
            <span>Total</span>
            <span>${grandTotal.toFixed(2)}</span>
          </div>
          <button
            className="mobile-button primary"
            onClick={handleCheckout}
            disabled={cartItems.length === 0 || loading || hasMeatChickenMinimumError}
          >
            {loading ? '...' : t.checkout}
          </button>
        </div>
      </div>
    </div>
  );
}

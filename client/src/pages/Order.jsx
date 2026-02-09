import useOrderController from '../hooks/useOrderController';
import { getMinOrderQuantity } from '../utils/catalog';
import './../styles/pages/Order.css';

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
    pickupLocation,
    setPickupLocation,
    pickupDate,
    setPickupDate,
    availableDateValues,
    pickupDatesLoading,
    pickupError,
    pickupReady,
    isHenBlocked,
    formatPickupDate,
  } = useOrderController(lang);

  // Content Dictionary (Local to this page)
  const t = {
    title: lang === 'en' ? "Order Online" : "Commander en ligne",
    summary: lang === 'en' ? "Order Summary" : "Résumé de la commande",
    checkout: lang === 'en' ? "PROCEED TO CHECKOUT" : "PAYER",
    empty: lang === 'en' ? "Cart is empty" : "Panier vide",
    unit: lang === 'en' ? "ea." : "ch.",
    pickupTitle: lang === 'en' ? 'Pickup Details' : 'Détails du ramassage',
    pickupLocation: lang === 'en' ? 'Location' : 'Lieu',
    pickupDate: lang === 'en' ? 'Pickup Date' : 'Date de ramassage',
    pickupSelectLocation: lang === 'en' ? 'Select a location' : 'Choisissez un lieu',
    pickupSelectDate: lang === 'en' ? 'Select a date' : 'Choisissez une date',
    pickupLoadingDates: lang === 'en' ? 'Loading dates...' : 'Chargement des dates...',
    pickupNoDates: lang === 'en' ? 'No dates available' : 'Aucune date disponible',
    pickupRequiredNote: lang === 'en'
      ? 'Pickup date and location are required to proceed.'
      : 'La date et le lieu de ramassage sont requis.',
    pickupNotSelected: lang === 'en'
      ? 'Select pickup date to see availability'
      : 'Choisissez une date pour voir la disponibilité',
    pickupBlockedLamb: lang === 'en'
      ? 'Not available at this location.'
      : 'Non disponible à cet emplacement.'
  };

  const pickupOptions = [
    { value: 'hemmingford', label: 'Hemmingford (Montérégie)' },
    { value: 'bristol', label: 'Bristol (Outaouais)' }
  ];

  const canCheckout =
    cartItems.length > 0 && !loading && !hasMeatChickenMinimumError && pickupReady;

  return (
    <div className="order-layout">
      {/* Left Column */}
      <div className="product-list">
        <h2>{t.title}</h2>
        <div className="pickup-card-main">
          <h2>{t.pickupTitle}</h2>
          <div className="pickup-controls">
            <label className="pickup-label">
              {t.pickupLocation}
              <select
                className="pickup-select"
                value={pickupLocation}
                onChange={(event) => {
                  setPickupLocation(event.target.value);
                  setPickupDate('');
                }}
              >
                <option value="">{t.pickupSelectLocation}</option>
                {pickupOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="pickup-label">
              {t.pickupDate}
              <select
                className="pickup-select"
                value={pickupDate}
                onChange={(event) => setPickupDate(event.target.value)}
                disabled={!pickupLocation || pickupDatesLoading || availableDateValues.length === 0}
              >
                <option value="">
                  {!pickupLocation
                    ? t.pickupSelectLocation
                    : pickupDatesLoading
                      ? t.pickupLoadingDates
                      : availableDateValues.length === 0
                        ? t.pickupNoDates
                        : t.pickupSelectDate}
                </option>
                {availableDateValues.map((dateValue) => (
                  <option key={dateValue} value={dateValue}>
                    {formatPickupDate(dateValue)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!pickupReady && (
            <div className="pickup-note">{t.pickupRequiredNote}</div>
          )}
          {pickupError && <div className="pickup-error">{pickupError}</div>}
        </div>
        {hens.map((hen) => {
          const qtyRaw = cart[hen.id];
          const qty = (qtyRaw === "" || qtyRaw === undefined) ? 0 : qtyRaw;
          const maxStock = getStockForHen(hen);
          const isBlocked = isHenBlocked(hen);
          const isOutOfStock = pickupReady && !isBlocked && maxStock <= 0;
          const safeQty = Math.min(qty, maxStock);
          const unitPrice = getTierPrice(hen.name, safeQty);
          const minOrderQty = getMinOrderQuantity(hen.name);
          const stockLabel = !pickupReady
            ? t.pickupNotSelected
            : isBlocked
              ? t.pickupBlockedLamb
              : isOutOfStock
                ? (lang === 'en' ? 'Out of stock' : 'Rupture de stock')
                : (lang === 'en' ? `Stock: ${maxStock}` : `Stock: ${maxStock}`);

          let imageUrl = '';
          let imageSrcSet = '';
          let imageSizes = '(max-width: 800px) 40vw, 200px';
          const lowerName = (hen.name || '').toLowerCase();
          const lowerUrl = (hen.image_url || '').toLowerCase();

          if (lowerName.includes('lamb') || lowerName.includes('agneau') || lowerUrl.includes('lamb')) {
            imageUrl = '/photos/lamb_cropped.jpg';
          } else if (lowerName.includes('meat') || lowerName.includes('chair') || lowerUrl.includes('broiler')) {
            imageUrl = '/photos/chicks_cropped.jpg';
          } else if (lowerName.includes('lohmann') || lowerUrl.includes('layer')) {
            imageUrl = '/photos/hens_cropped.jpg';
          } else {
             imageUrl = hen.image_url 
               ? (hen.image_url.startsWith('http') || hen.image_url.startsWith('/') ? hen.image_url : `/${hen.image_url}`)
               : '';
          }

          return (
            <div key={hen.id} className="product-card-container">
              <div className={`product-card${(!pickupReady || isBlocked || isOutOfStock) ? ' product-card--disabled' : ''}`}>
                <img
                  src={imageUrl}
                  srcSet={imageSrcSet || undefined}
                  sizes={imageSrcSet ? imageSizes : undefined}
                  alt={hen.name}
                  className="product-img"
                  loading="lazy"
                  fetchPriority="low"
                  decoding="async"
                  width="200"
                  height="200"
                />
                <div className="product-info">
                  <h3>{getBilingualText(hen.name)}</h3>
                  <div className="product-price">
                    ${unitPrice.toFixed(2)} / {t.unit}
                  </div>
                  <div className={`product-stock${isOutOfStock ? ' out-of-stock' : ''}`}>
                    {stockLabel}
                  </div>
                  {/* Minimum order note for meat chickens - show when qty is 1-24 */}
                  {minOrderQty > 0 && safeQty > 0 && safeQty < minOrderQty && (
                    <div className="minimum-order-note">
                      {lang === 'en'
                        ? `Minimum order: ${minOrderQty} meat birds`
                        : `Commande minimum de ${minOrderQty} poulets à chair`}
                    </div>
                  )}
                  <div className="stepper-container">
                    <div className="stepper">
                      <button onClick={() => decrement(hen.id)} disabled={!pickupReady || isBlocked || isOutOfStock}>-</button>
                      <input
                        type="text"
                        disabled={!pickupReady || isBlocked || isOutOfStock}
                        value={cart[hen.id] === undefined ? "" : cart[hen.id]}
                        onChange={(e) => updateQty(hen.id, e.target.value)}
                        placeholder="0"
                      />
                      <button
                        onClick={() => increment(hen.id)}
                        disabled={!pickupReady || isBlocked || isOutOfStock || safeQty >= maxStock}
                      >
                        +
                      </button>
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
        <h3>{t.summary}</h3>
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
        <button className="btn-checkout" onClick={handleCheckout} disabled={!canCheckout}>
          {loading ? "..." : t.checkout}
        </button>
      </div>
    </div>
  );
}

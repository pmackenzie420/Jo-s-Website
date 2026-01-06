import useCheckoutController from '../hooks/useCheckoutController';
import '../styles/pages/Checkout.css';

export default function Checkout({ lang }) {
  const {
    cartItems,
    grandTotal,
    hasCart,
    goToOrder,
    formData,
    setFormData,
    availableDateValues,
    loading,
    errors,
    setErrors,
    pickupOptions,
    formatPickupDate,
    handlePhoneBlur,
    handleEmailBlur,
    handleSubmit,
    formatPhone,
    normalizePhone,
    isValidEmail,
  } = useCheckoutController(lang);

  if (!hasCart) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h2>Cart is empty</h2>
        <button onClick={goToOrder}>Back to Order</button>
      </div>
    );
  }

  return (
    <div className="checkout-container">
      <h1 className="checkout-title">
        {lang === 'en' ? 'Checkout Details' : 'Détails de la commande'}
      </h1>

      <form onSubmit={handleSubmit} className="checkout-grid" autoComplete="off">
        <div className="checkout-main">
          <section className="checkout-section">
            <h2 className="checkout-section-title">
              {lang === 'en' ? 'Customer Info' : 'Informations Client'}
            </h2>
            <div className="checkout-fields">
              <div className="checkout-field">
                <label className="checkout-label">
                  {lang === 'en' ? 'Phone Number' : 'Numéro de téléphone'}
                </label>
                <input
                  type="tel"
                  required
                  placeholder="(555) 123-4567"
                  className={`checkout-input ${errors.phone ? 'error' : ''}`}
                  value={formData.phone}
                  autoComplete="off"
                  inputMode="tel"
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setFormData({ ...formData, phone: formatPhone(nextValue) });
                    if (errors.phone && normalizePhone(nextValue).length === 10) {
                      setErrors((prev) => ({ ...prev, phone: null }));
                    }
                  }}
                  onBlur={handlePhoneBlur}
                />
                {errors.phone && <p className="error-text">{errors.phone}</p>}
              </div>

              <div className="checkout-field">
                <label className="checkout-label">
                  {lang === 'en' ? 'Full Name' : 'Nom complet'}
                </label>
                <input
                  type="text"
                  required
                  className="checkout-input"
                  value={formData.name}
                  autoComplete="off"
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="checkout-field">
                <label className="checkout-label">Email</label>
                <input
                  type="email"
                  required
                  className={`checkout-input ${errors.email ? 'error' : ''}`}
                  value={formData.email}
                  autoComplete="off"
                  onChange={(e) => {
                    const nextEmail = e.target.value;
                    setFormData({ ...formData, email: nextEmail });
                    if (errors.email && isValidEmail(nextEmail)) {
                      setErrors((prev) => ({ ...prev, email: null }));
                    }
                  }}
                  onBlur={handleEmailBlur}
                />
                {errors.email && <p className="error-text">{errors.email}</p>}
              </div>

              <div className="checkout-field">
                <label className="checkout-label">{lang === 'en' ? 'Address' : 'Adresse'}</label>
                <input
                  type="text"
                  required
                  className={`checkout-input ${errors.address ? 'error' : ''}`}
                  value={formData.address}
                  autoComplete="off"
                  onChange={(e) => {
                    setFormData({ ...formData, address: e.target.value });
                  }}
                  placeholder="Enter your address"
                />
                {errors.address && <p className="error-text">{errors.address}</p>}
              </div>
            </div>
          </section>

          <section className="checkout-section">
            <h2 className="checkout-section-title">
              {lang === 'en' ? 'Pickup Details' : 'Détails du ramassage'}
            </h2>
            <div className="checkout-field">
              <label className="checkout-label">{lang === 'en' ? 'Location' : 'Succursale'}</label>
              <div className="pickup-buttons">
                {pickupOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`pickup-button ${
                      formData.pickupLocation === option.value ? 'active' : ''
                    }`}
                    onClick={() => {
                      setFormData({
                        ...formData,
                        pickupLocation: option.value,
                        pickupDate: ''
                      });
                      if (errors.pickupLocation) {
                        setErrors((prev) => ({ ...prev, pickupLocation: null }));
                      }
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {errors.pickupLocation && <p className="error-text">{errors.pickupLocation}</p>}
            </div>

            <div className="checkout-field pickup-date-field">
              <label className="checkout-label">
                {lang === 'en' ? 'Preferred Date' : 'Date préférée'}
              </label>
              <select
                className={`checkout-input pickup-select ${errors.pickupDate ? 'error' : ''}`}
                value={formData.pickupDate}
                onChange={(e) => {
                  setFormData({ ...formData, pickupDate: e.target.value });
                  if (errors.pickupDate) {
                    setErrors((prev) => ({ ...prev, pickupDate: null }));
                  }
                }}
                required
                disabled={!formData.pickupLocation || availableDateValues.length === 0}
              >
                <option value="" disabled>
                  {!formData.pickupLocation
                    ? lang === 'en'
                      ? 'Select a location first'
                      : 'Choisissez un lieu'
                    : availableDateValues.length === 0
                      ? lang === 'en'
                        ? 'No dates available'
                        : 'Aucune date disponible'
                      : lang === 'en'
                        ? 'Select a pickup date'
                        : 'Choisir une date'}
                </option>
                {availableDateValues.map((dateValue) => (
                  <option key={dateValue} value={dateValue}>
                    {formatPickupDate(dateValue)}
                  </option>
                ))}
              </select>
              {errors.pickupDate && <p className="error-text">{errors.pickupDate}</p>}
            </div>
          </section>
        </div>

        <aside className="checkout-sidebar">
          <div className="summary-box">
            <h3 className="summary-title">{lang === 'en' ? 'Order Summary' : 'Résumé'}</h3>
            {cartItems.map((item, idx) => (
              <div key={idx} className="summary-item">
                <span>
                  {item.qty} x {item.name.split(' / ')[0]}
                </span>
                <span>${item.lineTotal.toFixed(2)}</span>
              </div>
            ))}
            <div className="summary-divider" />
            <div className="summary-total">
              <span>Total</span>
              <span>${grandTotal.toFixed(2)}</span>
            </div>
          </div>
          <button type="submit" disabled={loading} className="pay-button checkout-submit">
            {loading ? 'Processing...' : lang === 'en' ? 'Pay Now' : 'Payer maintenant'}
          </button>
        </aside>
      </form>
    </div>
  );
}

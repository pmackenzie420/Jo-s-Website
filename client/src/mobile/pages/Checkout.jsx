import useCheckoutController from '../../hooks/useCheckoutController';

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
    lookupLoading,
    errors,
    setErrors,
    addressInputRef,
    placesReady,
    pickupOptions,
    formatPickupDate,
    handlePhoneBlur,
    handleEmailBlur,
    handleSubmit,
    formatPhone,
    normalizePhone,
    isValidEmail,
    setAddressSelected,
  } = useCheckoutController(lang);

  if (!hasCart) {
    return (
      <div className="mobile-section">
        <h2>Cart is empty</h2>
        <button className="mobile-button primary" onClick={goToOrder}>
          {lang === 'en' ? 'Back to Order' : 'Retour à la commande'}
        </button>
      </div>
    );
  }

  return (
    <div className="mobile-checkout mobile-page">
      <h2 className="mobile-section-title">
        {lang === 'en' ? 'Checkout Details' : 'Détails de la commande'}
      </h2>

      <form onSubmit={handleSubmit} className="mobile-checkout-form">
        <section className="mobile-form-section">
          <h3>{lang === 'en' ? 'Customer Info' : 'Informations Client'}</h3>
          <label>
            {lang === 'en' ? 'Phone Number' : 'Numéro de téléphone'}
            <input
              type="tel"
              required
              placeholder="(555) 123-4567"
              value={formData.phone}
              onChange={(e) => {
                const nextValue = e.target.value;
                setFormData({ ...formData, phone: formatPhone(nextValue) });
                if (errors.phone && normalizePhone(nextValue).length === 10) {
                  setErrors((prev) => ({ ...prev, phone: null }));
                }
              }}
              onBlur={handlePhoneBlur}
            />
          </label>
          {errors.phone && <p className="mobile-error">{errors.phone}</p>}
          {lookupLoading && (
            <p className="mobile-subtle">
              {lang === 'en' ? 'Looking up customer...' : 'Recherche du client...'}
            </p>
          )}

          <label>
            {lang === 'en' ? 'Full Name' : 'Nom complet'}
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </label>

          <label>
            Email
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => {
                const nextEmail = e.target.value;
                setFormData({ ...formData, email: nextEmail });
                if (errors.email && isValidEmail(nextEmail)) {
                  setErrors((prev) => ({ ...prev, email: null }));
                }
              }}
              onBlur={handleEmailBlur}
            />
          </label>
          {errors.email && <p className="mobile-error">{errors.email}</p>}

          <label>
            {lang === 'en' ? 'Address' : 'Adresse'}
            <input
              type="text"
              required
              value={formData.address}
              onChange={(e) => {
                setFormData({ ...formData, address: e.target.value });
                setAddressSelected(false);
              }}
              ref={addressInputRef}
              placeholder={placesReady ? 'Start typing your address' : 'Enter your address'}
              autoComplete="off"
            />
          </label>
          {errors.address && <p className="mobile-error">{errors.address}</p>}
          {placesReady && !errors.address && (
            <p className="mobile-subtle">
              {lang === 'en'
                ? 'Choose an address from the suggestions.'
                : 'Choisissez une adresse dans la liste.'}
            </p>
          )}
        </section>

        <section className="mobile-form-section">
          <h3>{lang === 'en' ? 'Pickup Details' : 'Détails du ramassage'}</h3>
          <label>
            {lang === 'en' ? 'Location' : 'Succursale'}
            <div className="mobile-pill-group">
              {pickupOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`mobile-pill ${
                    formData.pickupLocation === option.value ? 'active' : ''
                  }`}
                  onClick={() => setFormData({ ...formData, pickupLocation: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </label>

          <label>
            {lang === 'en' ? 'Preferred Date' : 'Date préférée'}
            <select
              value={formData.pickupDate}
              onChange={(e) => {
                setFormData({ ...formData, pickupDate: e.target.value });
                if (errors.pickupDate) {
                  setErrors((prev) => ({ ...prev, pickupDate: null }));
                }
              }}
              required
              disabled={availableDateValues.length === 0}
            >
              <option value="" disabled>
                {availableDateValues.length === 0
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
          </label>
          {errors.pickupDate && <p className="mobile-error">{errors.pickupDate}</p>}
        </section>

        <section className="mobile-form-section">
          <h3>{lang === 'en' ? 'Order Summary' : 'Résumé'}</h3>
          <div className="mobile-summary-list">
            {cartItems.map((item) => (
              <div key={item.id} className="mobile-summary-row">
                <span>
                  {item.qty} x {item.name.split(' / ')[0]}
                </span>
                <span>${item.lineTotal.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="mobile-summary-total">
            <span>Total</span>
            <span>${grandTotal.toFixed(2)}</span>
          </div>
        </section>

        <button type="submit" className="mobile-button primary" disabled={loading}>
          {loading ? 'Processing...' : lang === 'en' ? 'Pay Now' : 'Payer maintenant'}
        </button>
      </form>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import useMediaQuery from '../hooks/useMediaQuery';
import useCheckoutController from '../hooks/useCheckoutController';
import '../styles/pages/Checkout.css';

export default function Checkout({ lang }) {
  const isMobile = useMediaQuery('(max-width: 800px)');
  const isFirstRender = useRef(true);

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
    paymentOption,
    setPaymentOption,
    paymentSummary,
    currentStep,
    nextStep,
    prevStep
  } = useCheckoutController(lang);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (isMobile) {
      const element = document.querySelector('.page-wrapper');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [currentStep, isMobile]);

  if (!hasCart) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h2>{lang === 'en' ? 'Cart is empty' : 'Panier vide'}</h2>
        <button onClick={goToOrder}>
          {lang === 'en' ? 'Back to Order' : 'Retour à la commande'}
        </button>
      </div>
    );
  }

  const formatCurrency = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;

  const payButtonLabel = loading
    ? (lang === 'en' ? 'Processing...' : 'Traitement...')
    : (lang === 'en' ? 'PAY' : 'PAYER');
    
  // Step Labels
  const steps = [
    { num: 1, label: lang === 'en' ? 'Information' : 'Informations' },
    { num: 2, label: lang === 'en' ? 'Pickup' : 'Ramassage' },
    { num: 3, label: lang === 'en' ? 'Payment' : 'Paiement' }
  ];
  const hasDepositOption = paymentSummary.depositEligible;
  const isSummaryOnly = currentStep === 3 && !hasDepositOption;

  return (
    <div className="checkout-container">
      {/* Sticky Progress Bar */}
      <div className="checkout-progress-bar">
        <div
          className="progress-track"
          style={{
            '--progress': `${Math.min((currentStep / steps.length) * 100, 100)}%`,
            '--progress-bump': `${currentStep === 1 ? 8 : 0}px`
          }}
        >
          <div
            className={`progress-fill ${currentStep === steps.length ? 'is-complete' : ''}`}
          />
          <div className="progress-labels">
            {steps.map((step) => (
              <span key={step.num} className="progress-label">
                {step.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <h1 className="checkout-title">
        {lang === 'en' ? 'Checkout' : 'Commande'}
      </h1>

      <form
        onSubmit={handleSubmit}
        className={`checkout-grid ${(currentStep < 3 || isSummaryOnly) ? 'single-column' : ''}`}
        autoComplete="off"
      >
        <div className={`checkout-main${isSummaryOnly ? ' checkout-main--hidden' : ''}`}>
          
          {/* STEP 1: CUSTOMER INFO */}
          {currentStep === 1 && (
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
                      setFormData((prev) => ({ ...prev, phone: formatPhone(nextValue) }));
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
                    className={`checkout-input ${errors.name ? 'error' : ''}`}
                    value={formData.name}
                    autoComplete="off"
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setFormData((prev) => ({ ...prev, name: nextValue }));
                      if (errors.name && nextValue.trim().length > 0) {
                        setErrors((prev) => ({ ...prev, name: null }));
                      }
                    }}
                  />
                  {errors.name && <p className="error-text">{errors.name}</p>}
                </div>

                <div className="checkout-field">
                  <label className="checkout-label">{lang === 'en' ? 'Email' : 'Courriel'}</label>
                  <input
                    type="email"
                    required
                    className={`checkout-input ${errors.email ? 'error' : ''}`}
                    value={formData.email}
                    autoComplete="off"
                    onChange={(e) => {
                      const nextEmail = e.target.value;
                      setFormData((prev) => ({ ...prev, email: nextEmail }));
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
                      const nextValue = e.target.value;
                      setFormData((prev) => ({ ...prev, address: nextValue }));
                      if (errors.address && nextValue.trim().length >= 8) {
                        setErrors((prev) => ({ ...prev, address: null }));
                      }
                    }}
                    placeholder={lang === 'en' ? 'Enter your address' : 'Entrez votre adresse'}
                  />
                  {errors.address && <p className="error-text">{errors.address}</p>}
                </div>
              </div>
              
              <div className="step-actions">
                <button type="button" className="btn-continue" onClick={nextStep}>
                  {lang === 'en' ? 'Continue' : 'Continuer'}
                </button>
              </div>
            </section>
          )}

          {/* STEP 2: PICKUP */}
          {currentStep === 2 && (
            <section className="checkout-section">
              <h2 className="checkout-section-title">
                {lang === 'en' ? 'Pickup Details' : 'Détails du ramassage'}
              </h2>
              <div className="checkout-field">
                <label className="checkout-label">{lang === 'en' ? 'Location' : 'Succursale'}</label>
                <div className="pickup-options">
                  {pickupOptions.map((option) => (
                    <label
                      key={option.value}
                      className={`pickup-option ${
                        formData.pickupLocation === option.value ? 'active' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="pickupLocation"
                        value={option.value}
                        checked={formData.pickupLocation === option.value}
                        onChange={() => {
                          setFormData((prev) => ({
                            ...prev,
                            pickupLocation: option.value,
                            pickupDate: ''
                          }));
                          if (errors.pickupLocation) {
                            setErrors((prev) => ({ ...prev, pickupLocation: null }));
                          }
                        }}
                      />
                      <div className="pickup-option-title">{option.label}</div>
                    </label>
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
                    setFormData((prev) => ({ ...prev, pickupDate: e.target.value }));
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
              
              <div className="step-actions">
                <button type="button" className="btn-continue" onClick={nextStep}>
                  {lang === 'en' ? 'Continue' : 'Continuer'}
                </button>
                <button type="button" className="btn-back btn-back--compact" onClick={prevStep}>
                  {lang === 'en' ? 'Back' : 'Retour'}
                </button>
              </div>
            </section>
          )}

          {/* STEP 3: PAYMENT */}
          {currentStep === 3 && hasDepositOption && (
            <section className="checkout-section">
              <h2 className="checkout-section-title">
                {lang === 'en' ? 'Payment' : 'Paiement'}
              </h2>
              <div className="payment-left-column">
                {paymentSummary.lohmannQty > 0 && (
                  <div className="summary-box payment-box">
                    <h3 className="summary-title">
                      {lang === 'en' ? 'Payment (Hens)' : 'Paiement (Poules)'}
                    </h3>
                    <div className="payment-options">
                      <label className={`payment-option ${paymentOption === 'full' ? 'active' : ''}`}>
                        <input
                          type="radio"
                          name="paymentOption"
                          value="full"
                          checked={paymentOption === 'full'}
                          onChange={() => setPaymentOption('full')}
                        />
                        <div>
                          <div className="payment-option-title">
                            {lang === 'en' ? 'Pay full amount' : 'Tout payer'}
                          </div>
                          <div className="payment-option-line payment-option-line--primary">
                            <span className="payment-option-label">
                              {lang === 'en'
                                ? 'Amount due now:'
                                : 'Montant à payer maintenant :'}
                            </span>
                            <span className="payment-option-amount payment-option-amount--primary">
                              {formatCurrency(paymentSummary.fullPayCents)}
                            </span>
                          </div>
                        </div>
                      </label>

                      {paymentSummary.depositEligible && (
                        <label className={`payment-option ${paymentOption === 'deposit' ? 'active' : ''}`}>
                          <input
                            type="radio"
                            name="paymentOption"
                            value="deposit"
                            checked={paymentOption === 'deposit'}
                            onChange={() => setPaymentOption('deposit')}
                          />
                          <div>
                            <div className="payment-option-title">
                              {lang === 'en' ? 'Pay 25% deposit' : 'Payer un dépôt de 25%'}
                            </div>
                            <div className="payment-option-line payment-option-line--primary">
                              <span className="payment-option-label">
                                {lang === 'en'
                                  ? 'Amount due now:'
                                  : 'Montant à payer maintenant :'}
                              </span>
                              <span className="payment-option-amount payment-option-amount--primary">
                                {formatCurrency(paymentSummary.depositNowCents)}
                              </span>
                            </div>
                            <div className="payment-option-line">
                              <span className="payment-option-label">
                                {lang === 'en'
                                  ? 'Balance at pickup:'
                                  : 'Reste à payer au ramassage :'}
                              </span>
                              <span className="payment-option-amount payment-option-amount--primary">
                                 {formatCurrency(paymentSummary.lohmannDueCents)}
                              </span>
                            </div>
                          </div>
                        </label>
                      )}
                    </div>
                  </div>
                )}

                {paymentSummary.hasLambs && (
                  <div className="summary-box payment-box lamb-deposit-box">
                    <h3 className="summary-title lamb-deposit-title">
                      {lang === 'en' ? 'Lamb Deposit' : 'Dépôt Agneau'}
                    </h3>
                    <div className="lamb-deposit-details">
                      <div className="lamb-deposit-row">
                        <span>{paymentSummary.lambQty} x Lamb / Agneau</span>
                        <span>{formatCurrency(paymentSummary.lambQty * 5000)} (dépôt)</span>
                      </div>
                      <p className="lamb-deposit-note">
                        {lang === 'en'
                          ? 'Final price determined by weight at pickup'
                          : 'Le prix final sera calculé selon le poids à la cueillette'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {currentStep === 3 && (
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
            
            {/* Total Pay Now */}
            <div className="summary-total">
              <span>Total</span>
              <span>{formatCurrency(paymentSummary.amountPaidCents)}</span>
            </div>

            {/* Balance Due Breakdown */}
            {(paymentOption === 'deposit' || paymentSummary.hasLambs) && (
              <div className="summary-subtotal" style={{ display: 'block', textAlign: 'left', marginTop: '10px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                  {lang === 'en' ? 'Balance due at pickup:' : 'Solde à la cueillette :'}
                </div>
                
                {paymentOption === 'deposit' && paymentSummary.lohmannDueCents > 0 && (
                   <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9em', marginBottom: '4px' }}>
                     <span>• {lang === 'en' ? 'Hens' : 'Poules'}:</span>
                     <span>{formatCurrency(paymentSummary.lohmannDueCents)}</span>
                   </div>
                )}
                
                {paymentSummary.hasLambs && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9em' }}>
                     <span>• {lang === 'en' ? 'Lamb' : 'Agneau'}:</span>
                     <span>{lang === 'en' ? 'To be determined (weight)' : 'À déterminer (poids)'}</span>
                   </div>
                )}
              </div>
            )}
          </div>
          
            <div className="step-actions">
              <button type="button" className="btn-back btn-back--compact-mobile" onClick={prevStep}>
                  {lang === 'en' ? 'Back' : 'Retour'}
              </button>
              <button type="submit" disabled={loading} className="pay-button checkout-submit">
                {payButtonLabel}
              </button>
            </div>
          </aside>
        )}
      </form>
      {currentStep === 3 && (
        <div className="checkout-back-desktop">
          <button type="button" className="btn-back" onClick={prevStep}>
            {lang === 'en' ? 'Back' : 'Retour'}
          </button>
        </div>
      )}
    </div>
  );
}

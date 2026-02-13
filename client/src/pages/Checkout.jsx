import { useEffect, useRef, useState } from 'react';
import useMediaQuery from '../hooks/useMediaQuery';
import useCheckoutController from '../hooks/useCheckoutController';
import '../styles/pages/Checkout.css';

export default function Checkout({ lang }) {
  const isMobile = useMediaQuery('(max-width: 800px)');
  const isFirstRender = useRef(true);

  const {
    cartItems,
    hasCart,
    goToOrder,
    formData,
    setFormData,
    loading,
    submitError,
    errors,
    setErrors,
    formatPickupDate,
    handlePhoneBlur,
    handleEmailBlur,
    emailVerification,
    resetEmailVerification,
    handleSubmit,
    formatPhone,
    normalizePhone,
    isValidEmail,
    termsAccepted,
    setTermsAccepted,
    termsError,
    paymentOption,
    setPaymentOption,
    paymentSummary,
    currentStep,
    nextStep,
    prevStep
  } = useCheckoutController(lang);

  const [showTerms, setShowTerms] = useState(false);

  const handleTopBack = () => {
    if (currentStep === 2) {
      prevStep();
    } else {
      goToOrder();
    }
  };

  const topBackLabel = currentStep === 2
    ? (lang === 'en' ? 'Back to Information' : 'Retour aux informations')
    : (lang === 'en' ? 'Back to Order' : 'Retour à la commande');

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
      <div className="checkout-empty">
        <h2>{lang === 'en' ? 'Cart is empty' : 'Panier vide'}</h2>
        <button onClick={goToOrder}>
          {lang === 'en' ? 'Back to Order' : 'Retour à la commande'}
        </button>
      </div>
    );
  }

  const formatCurrency = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;
  const pickupLocationLabels = {
    hemmingford: 'Hemmingford',
    bristol: 'Bristol'
  };
  const pickupLocationLabel =
    formData.pickupLocation && pickupLocationLabels[formData.pickupLocation]
      ? pickupLocationLabels[formData.pickupLocation]
      : formData.pickupLocation || '';
  const pickupDateLabel = formData.pickupDate ? formatPickupDate(formData.pickupDate) : '';

  const payButtonLabel = loading
    ? (lang === 'en' ? 'Processing...' : 'Traitement...')
    : (lang === 'en' ? 'PAY' : 'PAYER');
    
  // Step Labels
  const steps = [
    { num: 1, label: lang === 'en' ? 'Information' : 'Informations' },
    { num: 2, label: lang === 'en' ? 'Payment' : 'Paiement' }
  ];
  const hasDepositOption = paymentSummary.depositEligible;
  const isSummaryOnly = currentStep === 2 && !hasDepositOption;
  const progressStep = Math.min(Math.max(currentStep, 1), steps.length);
  const progressTrackClass = `progress-track progress-track--step-${progressStep}`;

  return (
    <div className="checkout-container">
      <div className="checkout-top-back">
        <button
          onClick={handleTopBack}
          className="checkout-top-back-button"
        >
          ← {topBackLabel}
        </button>
      </div>

      {/* Sticky Progress Bar */}
      <div className="checkout-progress-bar">
        <div className={progressTrackClass}>
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
        className={`checkout-grid ${(currentStep < 2 || isSummaryOnly) ? 'single-column' : ''}`}
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
                      if (emailVerification.checkedEmail && nextEmail.trim().toLowerCase() !== emailVerification.checkedEmail) {
                        resetEmailVerification();
                      }
                      if (errors.email && isValidEmail(nextEmail)) {
                        setErrors((prev) => ({ ...prev, email: null }));
                      }
                    }}
                    onBlur={handleEmailBlur}
                  />
                  {errors.email && <p className="error-text">{errors.email}</p>}
                  {!errors.email && emailVerification.status !== 'idle' && (
                    <p
                      className={`checkout-note checkout-note--${emailVerification.status}`}
                      aria-live="polite"
                    >
                      {emailVerification.message}
                    </p>
                  )}
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

          {/* STEP 2: PAYMENT */}
          {currentStep === 2 && hasDepositOption && (
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
                      {!paymentSummary.depositOnlyForLargeLohmannOrder && (
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
                      )}

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

                {paymentOption === 'deposit' && (
                  <div className="summary-box payment-box deposit-policy-box">
                    <h3 className="summary-title deposit-policy-title">
                      {lang === 'en' ? 'Deposit Policy' : 'Politique de dépôt'}
                    </h3>
                    <p className="deposit-policy-note">
                      {lang === 'en'
                        ? 'For deposits, the remaining balance must be paid by e-transfer before pickup, or in cash at pickup.'
                        : 'Pour les dépôts, le solde restant doit être payé par virement Interac avant le ramassage, ou en argent comptant au ramassage.'}
                    </p>
                    {paymentSummary.depositOnlyForLargeLohmannOrder && (
                      <p className="deposit-policy-extra">
                        {lang === 'en'
                          ? `Orders above ${paymentSummary.depositRequiredAboveQty} hens are deposit-only.`
                          : `Les commandes de plus de ${paymentSummary.depositRequiredAboveQty} poules sont dépôt seulement.`}
                      </p>
                    )}
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
                        <span>{formatCurrency(paymentSummary.lambDepositCents)} (dépôt)</span>
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

        {currentStep === 2 && (
          <aside className="checkout-sidebar">
          <div className="summary-box">
            <h3 className="summary-title">{lang === 'en' ? 'Order Summary' : 'Résumé'}</h3>
            {pickupDateLabel && pickupLocationLabel && (
              <div className="summary-pickup">
                <div className="summary-pickup-label">
                  {lang === 'en' ? 'Pickup' : 'Ramassage'}
                </div>
                <div className="summary-pickup-value">
                  {pickupDateLabel} · {pickupLocationLabel}
                </div>
              </div>
            )}
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
              <div className="summary-subtotal">
                <div className="summary-subtotal-title">
                  {lang === 'en' ? 'Balance due at pickup:' : 'Solde à la cueillette :'}
                </div>
                
                {paymentOption === 'deposit' && paymentSummary.lohmannDueCents > 0 && (
                   <div className="summary-subtotal-row">
                     <span>• {lang === 'en' ? 'Hens' : 'Poules'}:</span>
                     <span>{formatCurrency(paymentSummary.lohmannDueCents)}</span>
                   </div>
                )}
                
                {paymentSummary.hasLambs && (
                  <div className="summary-subtotal-row">
                     <span>• {lang === 'en' ? 'Lamb' : 'Agneau'}:</span>
                     <span>{lang === 'en' ? 'To be determined (weight)' : 'À déterminer (poids)'}</span>
                   </div>
                )}
              </div>
            )}
          </div>
          
            <div className="checkout-terms">
              <label className="terms-row">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                />
                <span>
                  {lang === 'en' ? 'I accept the ' : "J'accepte les "}
                  <button
                    type="button"
                    className="terms-link"
                    onClick={() => setShowTerms(true)}
                  >
                    {lang === 'en'
                      ? 'conditions of sale and pickup.'
                      : 'conditions de vente et de ramassage.'}
                  </button>
                </span>
              </label>
              {termsError && <p className="error-text">{termsError}</p>}
              {submitError && <p className="error-text">{submitError}</p>}
            </div>

            <div className="step-actions">
              <button type="submit" disabled={loading} className="pay-button checkout-submit">
                {payButtonLabel}
              </button>
            </div>
          </aside>
        )}
      </form>
      {showTerms && (
        <div className="terms-modal-backdrop" onClick={() => setShowTerms(false)}>
          <div className="terms-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{lang === 'en' ? 'Terms & Conditions' : 'Conditions de vente'}</h3>
            <div className="terms-content">
              <p>
                {lang === 'en'
                  ? 'Please note that at pickup, we cannot split a single order among multiple people. Each order must be picked up in full by the purchaser.'
                  : "Veuillez noter que lors du ramassage, nous ne pouvons pas diviser une même commande entre plusieurs personnes. Chaque commande doit être ramassée en entièreté par l'acheteur."}
              </p>
            </div>
            <button className="btn-continue" onClick={() => setShowTerms(false)}>
              {lang === 'en' ? 'I Understand' : 'Je comprends'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

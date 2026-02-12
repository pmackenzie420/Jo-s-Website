import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import useForm, {
  formatPhone,
  isValidEmail,
  normalizePhone,
} from './useForm';
import useCheckout from './useCheckout';
import { CHECKOUT_STORAGE_KEYS } from '../constants/checkout';
import {
  getDepositEligibleMinQty,
  getDepositRequiredAboveQty,
  isLambName,
  isLohmannHenName
} from '../utils/catalog';

const { form: FORM_STORAGE_KEY, step: STEP_STORAGE_KEY } = CHECKOUT_STORAGE_KEYS;
const DEFAULT_FORM_DATA = {
  name: '',
  phone: '',
  email: '',
  address: '',
  pickupLocation: '',
  pickupDate: '',
  paymentOption: 'full',
};

const toCents = (value) => Math.round(Number(value) * 100);

export default function useCheckoutController(lang) {
  const location = useLocation();
  const { cartItems } = location.state || {};
  const initialFormData = useMemo(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_FORM_DATA;
    }
    try {
      const stored = window.sessionStorage.getItem(FORM_STORAGE_KEY);
      if (!stored) return DEFAULT_FORM_DATA;
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object') return DEFAULT_FORM_DATA;
      return { ...DEFAULT_FORM_DATA, ...parsed };
    } catch {
      return DEFAULT_FORM_DATA;
    }
  }, []);
  const [currentStep, setCurrentStep] = useState(() => {
    if (typeof window === 'undefined') {
      return 1;
    }
    const stored = window.sessionStorage.getItem(STEP_STORAGE_KEY);
    const parsed = Number(stored);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 2) {
      return parsed;
    }
    return 1;
  });
  const hasMountedRef = useRef(false);
  
  const {
    formData,
    setFormData,
    errors,
    setErrors,
    validateForm,
    handleBlur,
  } = useForm(initialFormData, {
      name: (value) =>
        !value.trim() && (lang === 'en' ? 'Name is required' : 'Nom requis'),
      phone: (value) =>
        normalizePhone(value).length !== 10 &&
        (lang === 'en'
          ? 'Enter a valid 10-digit phone number'
          : 'Entrez un numéro de téléphone à 10 chiffres'),
      email: (value) =>
        !isValidEmail(value) &&
        (lang === 'en' ? 'Invalid email address' : 'Adresse courriel invalide'),
      address: (value) =>
        value.length < 8
          ? lang === 'en'
            ? 'Address is too short'
            : 'Adresse trop courte'
          : null,
  });

  const {
    loading,
    handleSubmit,
    hasCart,
    goToOrder,
    formatPickupDate,
    submitError,
    setSubmitError,
  } = useCheckout(lang, formData, cartItems);

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError] = useState(null);

  const validateStep = (step) => {
    if (step !== 1) return true;
    return validateForm();
  };

  const scrollToCheckoutTop = () => {
    if (typeof window === 'undefined') {
      return;
    }
    const target = document.querySelector('.page-wrapper') || document.querySelector('.checkout-container');
    if (target) {
      const top = target.offsetTop;
      window.scrollTo({ top, left: 0, behavior: 'auto' });
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  };

  const nextStep = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, 2));
    }
  };

  const prevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };


  const cartTotals = useMemo(() => {
    if (!Array.isArray(cartItems)) {
      return { totalCents: 0, lohmannSubtotalCents: 0, lohmannQty: 0, lambSubtotalCents: 0, lambQty: 0 };
    }
    return cartItems.reduce(
      (acc, item) => {
        const lineCents = toCents(item.lineTotal);
        acc.totalCents += lineCents;
        if (isLohmannHenName(item.name)) {
          acc.lohmannSubtotalCents += lineCents;
          acc.lohmannQty += Number(item.qty || 0);
        } else if (isLambName(item.name)) {
          acc.lambSubtotalCents += lineCents;
          acc.lambQty += Number(item.qty || 0);
        }
        return acc;
      },
      { totalCents: 0, lohmannSubtotalCents: 0, lohmannQty: 0, lambSubtotalCents: 0, lambQty: 0 }
    );
  }, [cartItems]);

  const lohmannDepositEligible = cartTotals.lohmannQty >= getDepositEligibleMinQty();
  const depositRequiredAboveQty = Math.max(getDepositRequiredAboveQty(), 0);
  const depositOnlyForLargeLohmannOrder =
    depositRequiredAboveQty > 0 && cartTotals.lohmannQty > depositRequiredAboveQty;
  const hasLambs = cartTotals.lambQty > 0;
  
  // Lambs are ALWAYS deposit-only (full price of the item is the deposit)
  const lambDepositCents = cartTotals.lambSubtotalCents;

  const lohmannDepositCents = lohmannDepositEligible
    ? Math.floor(cartTotals.lohmannSubtotalCents * 0.25)
    : 0;
    
  // Items that are neither Lohmann nor Lamb need to be paid in full
  const otherItemsCents = cartTotals.totalCents - cartTotals.lohmannSubtotalCents - cartTotals.lambSubtotalCents;

  const lohmannDueCents = lohmannDepositEligible 
    ? cartTotals.lohmannSubtotalCents - lohmannDepositCents
    : 0;
  
  // Revised Logic:
  // "Deposit Eligible" for the purpose of the UI toggle now strictly refers to LOHMANN hens.
  // If you have Lambs but <13 Hens, you don't get a choice for the hens (Pay Full).
  // The Lambs are always handled automatically (Deposit Only).
  
  const depositEligible = lohmannDepositEligible;
  const paymentOption = depositOnlyForLargeLohmannOrder ? 'deposit' : formData.paymentOption;

  // Calculate Pay Now based on selection
  let payNowCents = 0;
  let payLaterCents = 0;

  if (paymentOption === 'deposit' && depositEligible) {
      // User wants to pay minimum on Hens
      payNowCents = otherItemsCents + lohmannDepositCents + lambDepositCents;
      payLaterCents = lohmannDueCents;
  } else {
      // User wants to pay full on Hens (or has no choice)
      payNowCents = otherItemsCents + cartTotals.lohmannSubtotalCents + lambDepositCents;
      payLaterCents = 0;
  }

  const amountPaidCents = payNowCents;
  const amountDueCents = payLaterCents;

  const paymentSummary = {
    totalCents: cartTotals.totalCents,
    amountPaidCents,
    amountDueCents,
    
    // Breakdown for UI
    lohmannFullCents: cartTotals.lohmannSubtotalCents,
    lohmannDepositCents,
    lohmannDueCents,
    lambDepositCents,
    
    // Legacy totals for UI that might still need them (cleaned up below)
    fullPayCents: otherItemsCents + cartTotals.lohmannSubtotalCents + lambDepositCents, 
    depositNowCents: otherItemsCents + lohmannDepositCents + lambDepositCents,
    
    depositEligible, // Strictly for Hens toggle
    depositOnlyForLargeLohmannOrder,
    depositRequiredAboveQty,
    lohmannQty: cartTotals.lohmannQty,
    hasLambs,
    lambQty: cartTotals.lambQty
  };

  useEffect(() => {
    if (depositOnlyForLargeLohmannOrder && formData.paymentOption !== 'deposit') {
      setFormData((prev) => ({ ...prev, paymentOption: 'deposit' }));
      return;
    }
    // Only reset if they selected deposit but are no longer eligible for ANY deposit
    if (!depositEligible && formData.paymentOption === 'deposit') {
      setFormData((prev) => ({ ...prev, paymentOption: 'full' }));
    }
  }, [depositEligible, depositOnlyForLargeLohmannOrder, formData.paymentOption, setFormData]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (!window.matchMedia('(max-width: 800px)').matches) {
      return;
    }
    window.requestAnimationFrame(scrollToCheckoutTop);
  }, [currentStep]);

  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') {
        return;
      }
      try {
        window.sessionStorage.removeItem(FORM_STORAGE_KEY);
        window.sessionStorage.removeItem(STEP_STORAGE_KEY);
      } catch {
        // Ignore storage clear issues (private mode, quota, etc).
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(formData));
    } catch {
      // Ignore storage write issues (private mode, quota, etc).
    }
  }, [formData]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.sessionStorage.setItem(STEP_STORAGE_KEY, String(currentStep));
    } catch {
      // Ignore storage write issues (private mode, quota, etc).
    }
  }, [currentStep]);

  const handlePhoneBlur = () => {
    handleBlur('phone');
    const cleanPhone = normalizePhone(formData.phone);
    if (!cleanPhone || cleanPhone.length < 7) return;

    const formattedPhone = formatPhone(cleanPhone);
    setFormData((prev) => ({ ...prev, phone: formattedPhone }));
  };

  const handleEmailBlur = () => {
    handleBlur('email');
  };

  return {
    cartItems,
    hasCart,
    goToOrder,
    formData,
    setFormData,
    loading,
    submitError,
    setSubmitError,
    errors,
    setErrors,
    formatPickupDate,
    handlePhoneBlur,
    handleEmailBlur,
    paymentOption,
    setPaymentOption: (value) =>
      setFormData((prev) => ({
        ...prev,
        paymentOption: depositOnlyForLargeLohmannOrder ? 'deposit' : value
      })),
    paymentSummary,
    termsAccepted,
    setTermsAccepted: (accepted) => {
      setTermsAccepted(accepted);
      if (accepted && termsError) {
        setTermsError(null);
      }
    },
    termsError,
    handleSubmit: (e) => {
      if (e?.preventDefault) {
        e.preventDefault();
      }
      if (!termsAccepted) {
        setTermsError(
          lang === 'en'
            ? 'Please accept the conditions to continue.'
            : 'Veuillez accepter les conditions pour continuer.'
        );
        return;
      }
      setTermsError(null);
      if (validateForm()) {
        setSubmitError('');
        handleSubmit(e, { paymentOption });
      }
    },
    formatPhone,
    normalizePhone,
    isValidEmail,
    currentStep,
    nextStep,
    prevStep
  };
}

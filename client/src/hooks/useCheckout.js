import { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../constants/api';

const resolveLanguage = (value) => {
  if (value === 'fr' || value === 'en') return value;
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem('site-lang');
    if (stored === 'fr' || stored === 'en') return stored;
    const browser = (navigator.language || '').toLowerCase();
    if (browser.startsWith('fr')) return 'fr';
    if (browser.startsWith('en')) return 'en';
  }
  return 'en';
};

export default function useCheckout(lang, formData, cartItems) {
  const effectiveLang = resolveLanguage(lang);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError('');

    if (!cartItems || cartItems.length === 0) {
      setSubmitError(
        effectiveLang === 'fr'
          ? 'Votre panier est vide.'
          : 'Your cart is empty.'
      );
      return;
    }
    if (!formData.pickupDate || !formData.pickupLocation) {
      const message = effectiveLang === 'fr'
        ? 'Veuillez sélectionner une date et un lieu de ramassage.'
        : 'Please select a pickup date and location.';
      setSubmitError(message);
      return;
    }

    setLoading(true);

    const payload = {
      language: effectiveLang,
      customer: {
        name: formData.name,
        phone: formData.phone,
        email: formData.email,
        address: formData.address,
      },
      pickup: {
        date: formData.pickupDate,
        location: formData.pickupLocation,
      },
      paymentOption: formData.paymentOption,
      items: cartItems.map((item) => ({ id: item.id, quantity: item.qty })),
    };

    try {
      const res = await axios.post(`${API_URL}/checkout`, payload);
      window.location.href = res.data.url;
    } catch (err) {
      const fallbackMessage = effectiveLang === 'fr'
        ? 'Erreur lors de la création de la session de paiement. Veuillez réessayer.'
        : 'Error creating checkout session. Please try again.';
      const message =
        err?.response?.data?.error || fallbackMessage;
      setSubmitError(message);
      setLoading(false);
    }
  };

  const hasCart = Boolean(cartItems && cartItems.length > 0);

  const goToOrder = () => {
    navigate('/order');
  };

  const formatPickupDate = (dateValue) => {
    if (!dateValue) return '';
    const dateString = typeof dateValue === 'string' ? dateValue : String(dateValue);
    const date = dateString.length === 10 ? new Date(`${dateString}T00:00:00`) : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return dateValue;
    return new Intl.DateTimeFormat(effectiveLang === 'fr' ? 'fr-CA' : 'en-CA', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };
  
  return {
    loading,
    handleSubmit,
    hasCart,
    goToOrder,
    formatPickupDate,
    submitError,
    setSubmitError,
  };
}

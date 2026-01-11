import { useEffect, useState, useMemo } from 'react';
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

export default function useCheckout(lang, formData, setFormData, cartItems, grandTotal) {
  const effectiveLang = resolveLanguage(lang);
  const navigate = useNavigate();
  const [availableDates, setAvailableDates] = useState([]);
  const [loading, setLoading] = useState(false);

  const availableDateValues = useMemo(() => {
    const values = availableDates
      .map((dateItem) =>
        typeof dateItem.date_value === 'string'
          ? dateItem.date_value.split('T')[0]
          : dateItem.date_value
      )
      .filter(Boolean);
    return values.sort();
  }, [availableDates]);

  useEffect(() => {
    if (!formData.pickupLocation) {
      setAvailableDates([]);
      setFormData((prev) => ({ ...prev, pickupDate: '' }));
      return;
    }
    setAvailableDates([]);
    setFormData((prev) => ({ ...prev, pickupDate: '' }));
    axios
      .get(`${API_URL}/pickup-dates`, {
        params: { location: formData.pickupLocation }
      })
      .then((res) => {
        setAvailableDates(res.data);
      })
      .catch((err) => console.error('Error fetching dates:', err));
  }, [formData.pickupLocation, setFormData]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!cartItems || cartItems.length === 0) {
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
      console.error(err);
      const fallbackMessage = effectiveLang === 'fr'
        ? 'Erreur lors de la création de la session de paiement. Veuillez réessayer.'
        : 'Error creating checkout session. Please try again.';
      const message =
        err?.response?.data?.error || fallbackMessage;
      alert(message);
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
    availableDateValues,
    loading,
    handleSubmit,
    hasCart,
    goToOrder,
    formatPickupDate,
  };
}

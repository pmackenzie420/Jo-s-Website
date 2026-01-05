import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = '/api';
const GOOGLE_PLACES_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

const loadGooglePlaces = (apiKey) => {
  if (!apiKey) {
    return Promise.resolve(false);
  }
  if (window.google && window.google.maps && window.google.maps.places) {
    return Promise.resolve(true);
  }
  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-google-places="true"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(true));
      existingScript.addEventListener('error', () => reject(false));
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.dataset.googlePlaces = 'true';
    script.onload = () => resolve(true);
    script.onerror = () => reject(false);
    document.body.appendChild(script);
  });
};

const normalizePhone = (phone) => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
};

const formatPhone = (phone) => {
  const digits = normalizePhone(phone);
  const trimmed = digits.slice(0, 10);
  if (!trimmed) return '';
  if (trimmed.length <= 3) return trimmed;
  if (trimmed.length <= 6) {
    return `(${trimmed.slice(0, 3)}) ${trimmed.slice(3)}`;
  }
  return `(${trimmed.slice(0, 3)}) ${trimmed.slice(3, 6)}-${trimmed.slice(6, 10)}`;
};

const normalizeEmail = (email) => email.trim();

const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(normalizeEmail(email));
};

export default function useCheckoutController(lang) {
  const location = useLocation();
  const navigate = useNavigate();
  const { cartItems, grandTotal } = location.state || {};

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    pickupLocation: 'hemmingford',
    pickupDate: '',
  });

  const [availableDates, setAvailableDates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [addressSelected, setAddressSelected] = useState(false);
  const [placesReady, setPlacesReady] = useState(false);
  const addressInputRef = useRef(null);

  const pickupOptions = useMemo(
    () => [
      { value: 'hemmingford', label: 'Hemmingford (Montérégie)' },
      { value: 'bristol', label: 'Bristol (Outaouais)' },
    ],
    []
  );

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

  const formatPickupDate = (dateValue) => {
    if (!dateValue) return '';
    const dateString = typeof dateValue === 'string' ? dateValue : String(dateValue);
    const date = dateString.length === 10 ? new Date(`${dateString}T00:00:00`) : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return dateValue;
    return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  useEffect(() => {
    axios
      .get(`${API_URL}/pickup-dates`)
      .then((res) => {
        setAvailableDates(res.data);
        if (res.data.length > 0) {
          const firstDate =
            typeof res.data[0].date_value === 'string'
              ? res.data[0].date_value.split('T')[0]
              : res.data[0].date_value;
          setFormData((prev) => ({ ...prev, pickupDate: firstDate }));
        }
      })
      .catch((err) => console.error('Error fetching dates:', err));
  }, []);

  useEffect(() => {
    let autocomplete;
    let isMounted = true;

    loadGooglePlaces(GOOGLE_PLACES_KEY)
      .then((loaded) => {
        if (!loaded || !addressInputRef.current || !isMounted) {
          return;
        }
        autocomplete = new window.google.maps.places.Autocomplete(addressInputRef.current, {
          types: ['address'],
          fields: ['formatted_address', 'place_id'],
        });
        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          if (!place || !place.formatted_address) {
            return;
          }
          setFormData((prev) => ({ ...prev, address: place.formatted_address }));
          setAddressSelected(true);
          setErrors((prev) => ({ ...prev, address: null }));
        });
        setPlacesReady(true);
      })
      .catch(() => {
        setPlacesReady(false);
      });

    return () => {
      isMounted = false;
      if (autocomplete) {
        window.google.maps.event.clearInstanceListeners(autocomplete);
      }
    };
  }, []);

  const validateForm = () => {
    const nextErrors = {};
    let valid = true;

    const cleanPhone = normalizePhone(formData.phone);
    if (cleanPhone.length !== 10) {
      nextErrors.phone =
        lang === 'en'
          ? 'Enter a valid 10-digit phone number'
          : 'Entrez un numéro de téléphone à 10 chiffres';
      valid = false;
    }

    if (!isValidEmail(formData.email)) {
      nextErrors.email = lang === 'en' ? 'Invalid email address' : 'Adresse courriel invalide';
      valid = false;
    }

    const addressNeedsSelection = Boolean(GOOGLE_PLACES_KEY);
    if (addressNeedsSelection && !addressSelected) {
      nextErrors.address =
        lang === 'en'
          ? 'Select an address from the suggestions'
          : 'Sélectionnez une adresse dans la liste';
      valid = false;
    } else if (!addressNeedsSelection && formData.address.length < 8) {
      nextErrors.address = lang === 'en' ? 'Address is too short' : 'Adresse trop courte';
      valid = false;
    }

    if (!formData.pickupDate) {
      nextErrors.pickupDate = lang === 'en' ? 'Please select a date' : 'Veuillez choisir une date';
      valid = false;
    } else if (
      availableDateValues.length > 0 &&
      !availableDateValues.includes(formData.pickupDate)
    ) {
      nextErrors.pickupDate =
        lang === 'en'
          ? 'Please choose an available pickup date'
          : 'Veuillez choisir une date de ramassage disponible';
      valid = false;
    }

    setErrors(nextErrors);
    return valid;
  };

  const handlePhoneBlur = async () => {
    const cleanPhone = normalizePhone(formData.phone);
    if (!cleanPhone || cleanPhone.length < 7) return;

    const formattedPhone = formatPhone(cleanPhone);
    setFormData((prev) => ({ ...prev, phone: formattedPhone }));
    setLookupLoading(true);
    try {
      const res = await axios.get(`${API_URL}/customers/lookup?phone=${cleanPhone}`);
      if (res.data) {
        const cust = res.data;
        const nextEmail = cust.email || '';
        const trimmedEmail = normalizeEmail(nextEmail);
        const emailValid = !trimmedEmail || isValidEmail(trimmedEmail);
        const addressValue = GOOGLE_PLACES_KEY ? '' : cust.address || '';
        setFormData((prev) => ({
          ...prev,
          name: cust.name,
          email: emailValid ? trimmedEmail : '',
          address: addressValue,
        }));
        setAddressSelected(Boolean(addressValue) && !GOOGLE_PLACES_KEY);
        setErrors((prev) => ({
          ...prev,
          email: null,
        }));
      }
    } catch (err) {
      console.log('Customer not found or error', err);
    } finally {
      setLookupLoading(false);
    }
  };

  const handleEmailBlur = () => {
    const trimmedEmail = normalizeEmail(formData.email);
    setFormData((prev) => ({ ...prev, email: trimmedEmail }));
    if (!trimmedEmail) {
      return;
    }
    if (isValidEmail(trimmedEmail)) {
      setErrors((prev) => ({ ...prev, email: null }));
    } else {
      setErrors((prev) => ({
        ...prev,
        email: lang === 'en' ? 'Invalid email address' : 'Adresse courriel invalide',
      }));
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!cartItems || cartItems.length === 0) {
      return;
    }

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    const payload = {
      customer: {
        name: formData.name,
        phone: normalizePhone(formData.phone),
        email: formData.email,
        address: formData.address,
      },
      pickup: {
        date: formData.pickupDate,
        location: formData.pickupLocation,
      },
      items: cartItems.map((item) => ({ id: item.id, quantity: item.qty })),
    };

    try {
      const res = await axios.post(`${API_URL}/checkout`, payload);
      window.location.href = res.data.url;
    } catch (err) {
      console.error(err);
      const message =
        err?.response?.data?.error || 'Error creating checkout session. Please try again.';
      alert(message);
      setLoading(false);
    }
  };

  const hasCart = Boolean(cartItems && cartItems.length > 0);

  const goToOrder = () => {
    navigate('/order');
  };

  return {
    cartItems: cartItems || [],
    grandTotal: grandTotal || 0,
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
  };
}

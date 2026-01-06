import { useLocation } from 'react-router-dom';
import useForm, {
  formatPhone,
  isValidEmail,
  normalizePhone,
} from './useForm';
import useCheckout from './useCheckout';

export default function useCheckoutController(lang) {
  const location = useLocation();
  const { cartItems, grandTotal } = location.state || {};

  const {
    formData,
    setFormData,
    errors,
    setErrors,
    validateForm,
    handleBlur,
  } = useForm(
    {
      name: '',
      phone: '',
      email: '',
      address: '',
      pickupLocation: '',
      pickupDate: '',
    },
    {
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
      pickupDate: (value) =>
        !value && (lang === 'en' ? 'Please select a date' : 'Veuillez choisir une date'),
      pickupLocation: (value) =>
        !value && (lang === 'en' ? 'Please select a location' : 'Veuillez choisir un lieu'),
    }
  );

  const {
    availableDateValues,
    loading,
    handleSubmit,
    hasCart,
    goToOrder,
    formatPickupDate,
  } = useCheckout(lang, formData, setFormData, cartItems, grandTotal);

  const pickupOptions = [
    { value: 'hemmingford', label: 'Hemmingford (Montérégie)' },
    { value: 'bristol', label: 'Bristol (Outaouais)' },
  ];

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
    handleSubmit: (e) => {
      if (e?.preventDefault) {
        e.preventDefault();
      }
      if (validateForm()) {
        handleSubmit(e);
      }
    },
    formatPhone,
    normalizePhone,
    isValidEmail,
  };
}

import { useState } from 'react';

export const normalizePhone = (phone) => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
};

export const formatPhone = (phone) => {
  const digits = normalizePhone(phone);
  const trimmed = digits.slice(0, 10);
  if (!trimmed) return '';
  if (trimmed.length <= 3) return trimmed;
  if (trimmed.length <= 6) {
    return `(${trimmed.slice(0, 3)}) ${trimmed.slice(3)}`;
  }
  return `(${trimmed.slice(0, 3)}) ${trimmed.slice(3, 6)}-${trimmed.slice(6, 10)}`;
};

export const normalizeEmail = (email) => email.trim();

export const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(normalizeEmail(email));
};

export default function useForm(initialData, validationRules) {
  const [formData, setFormData] = useState(initialData);
  const [errors, setErrors] = useState({});

  const validateForm = () => {
    const nextErrors = {};
    let valid = true;

    for (const field in validationRules) {
      const rule = validationRules[field];
      const value = formData[field];
      const error = rule(value, formData);
      if (error) {
        nextErrors[field] = error;
        valid = false;
      }
    }

    setErrors(nextErrors);
    return valid;
  };

  const handleBlur = (field) => {
    const rule = validationRules[field];
    if (rule) {
      const error = rule(formData[field], formData);
      setErrors((prev) => ({ ...prev, [field]: error }));
    }
  };

  return {
    formData,
    setFormData,
    errors,
    setErrors,
    validateForm,
    handleBlur,
  };
}

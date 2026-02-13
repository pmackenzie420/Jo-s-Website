const { CheckoutHttpError } = require('./checkout-errors');

const VALIDATION_ERRORS = {
    en: {
        nameRequired: 'Customer name is required.',
        phoneRequired: 'Valid customer phone is required.',
        emailRequired: 'Valid customer email is required.',
        addressRequired: 'Valid customer address is required.',
        itemsRequired: 'At least one valid order item is required.',
        tooManyItems: 'Too many items in checkout.',
        pickupRequired: 'Pickup date and location are required.',
        pickupUnavailable: 'Selected pickup date is not available for that location.'
    },
    fr: {
        nameRequired: 'Le nom du client est requis.',
        phoneRequired: 'Un numéro de téléphone valide est requis.',
        emailRequired: 'Une adresse courriel valide est requise.',
        addressRequired: 'Une adresse valide est requise.',
        itemsRequired: 'Au moins un article valide est requis.',
        tooManyItems: 'Trop d\'articles dans le panier.',
        pickupRequired: 'La date et le lieu de ramassage sont requis.',
        pickupUnavailable: 'La date de ramassage sélectionnée n\'est pas disponible pour ce lieu.'
    }
};

const normalizePhoneForStorage = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
        return digits.slice(1);
    }
    if (digits.length === 10) {
        return digits;
    }
    return String(value || '').trim();
};

const parseCheckoutContext = (req, deps) => {
    const {
        normalizeCheckoutItems,
        normalizeLanguage,
        sanitizeText,
        isValidEmail,
        CHECKOUT_MAX_ITEM_ROWS
    } = deps;

    const { customer, pickup, paymentOption, language, lang } = req.body || {};
    const checkoutItems = normalizeCheckoutItems(req.body?.items);
    const headerLanguage = req.get('accept-language') || '';
    const orderLanguage = normalizeLanguage(language || lang || headerLanguage);
    const copy = VALIDATION_ERRORS[orderLanguage] || VALIDATION_ERRORS.en;

    const customerName = sanitizeText(customer?.name, 200);
    const customerPhone = sanitizeText(customer?.phone, 50);
    const customerEmail = sanitizeText(customer?.email, 320);
    const customerAddress = sanitizeText(customer?.address, 300);
    const pickupDate = sanitizeText(pickup?.date, 40);
    const pickupLocation = sanitizeText(pickup?.location, 40);
    const requestedPayment = paymentOption === 'deposit' ? 'deposit' : 'full';

    if (!customerName) {
        throw new CheckoutHttpError(400, copy.nameRequired);
    }
    if (customerPhone.length < 7) {
        throw new CheckoutHttpError(400, copy.phoneRequired);
    }
    if (!isValidEmail(customerEmail)) {
        throw new CheckoutHttpError(400, copy.emailRequired);
    }
    if (customerAddress.length < 5) {
        throw new CheckoutHttpError(400, copy.addressRequired);
    }
    if (checkoutItems.length === 0) {
        throw new CheckoutHttpError(400, copy.itemsRequired);
    }
    if (checkoutItems.length > CHECKOUT_MAX_ITEM_ROWS) {
        throw new CheckoutHttpError(400, copy.tooManyItems);
    }
    if (!pickupDate || !pickupLocation) {
        throw new CheckoutHttpError(400, copy.pickupRequired);
    }

    return {
        checkoutItems,
        customerName,
        customerPhone,
        customerEmail,
        customerAddress,
        pickupDate,
        pickupLocation,
        requestedPayment,
        orderLanguage
    };
};

const resolvePickupDateId = async (pool, pickupDate, pickupLocation, language) => {
    const pickupCheck = await pool.query(
        `
        SELECT id
        FROM pickup_dates
        WHERE is_active = true
          AND date_value = $1
          AND location = $2
          AND date_value >= CURRENT_DATE
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        `,
        [pickupDate, pickupLocation]
    );
    if (pickupCheck.rows.length === 0) {
        const copy = VALIDATION_ERRORS[language] || VALIDATION_ERRORS.en;
        throw new CheckoutHttpError(400, copy.pickupUnavailable);
    }
    return pickupCheck.rows[0].id;
};

module.exports = {
    normalizePhoneForStorage,
    parseCheckoutContext,
    resolvePickupDateId
};

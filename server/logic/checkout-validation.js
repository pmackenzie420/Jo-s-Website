const { CheckoutHttpError } = require('./checkout-errors');

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

    const customerName = sanitizeText(customer?.name, 200);
    const customerPhone = sanitizeText(customer?.phone, 50);
    const customerEmail = sanitizeText(customer?.email, 320);
    const customerAddress = sanitizeText(customer?.address, 300);
    const pickupDate = sanitizeText(pickup?.date, 40);
    const pickupLocation = sanitizeText(pickup?.location, 40);
    const requestedPayment = paymentOption === 'deposit' ? 'deposit' : 'full';

    if (!customerName) {
        throw new CheckoutHttpError(400, 'Customer name is required.');
    }
    if (customerPhone.length < 7) {
        throw new CheckoutHttpError(400, 'Valid customer phone is required.');
    }
    if (!isValidEmail(customerEmail)) {
        throw new CheckoutHttpError(400, 'Valid customer email is required.');
    }
    if (customerAddress.length < 5) {
        throw new CheckoutHttpError(400, 'Valid customer address is required.');
    }
    if (checkoutItems.length === 0) {
        throw new CheckoutHttpError(400, 'At least one valid order item is required.');
    }
    if (checkoutItems.length > CHECKOUT_MAX_ITEM_ROWS) {
        throw new CheckoutHttpError(400, 'Too many items in checkout.');
    }
    if (!pickupDate || !pickupLocation) {
        throw new CheckoutHttpError(400, 'Pickup date and location are required.');
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

const resolvePickupDateId = async (pool, pickupDate, pickupLocation) => {
    const pickupCheck = await pool.query(
        `
        SELECT id
        FROM pickup_dates
        WHERE is_active = true
          AND date_value = $1
          AND location = $2
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        `,
        [pickupDate, pickupLocation]
    );
    if (pickupCheck.rows.length === 0) {
        throw new CheckoutHttpError(400, 'Selected pickup date is not available for that location.');
    }
    return pickupCheck.rows[0].id;
};

module.exports = {
    normalizePhoneForStorage,
    parseCheckoutContext,
    resolvePickupDateId
};

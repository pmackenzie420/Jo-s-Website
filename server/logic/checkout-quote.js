const { CheckoutHttpError } = require('./checkout-errors');
const TEMP_BROWN_LAYER_TEST_HEN_ID = 1;
const TEMP_BROWN_LAYER_TEST_PRICE_CENTS = 1;

const buildCheckoutQuote = async ({
    pool,
    checkoutItems,
    pickupDateId,
    pickupLocation,
    requestedPayment,
    calculateItemPrice,
    isLohmannHenName,
    getMinimumOrderQuantity,
    getDepositEligibleMinQty,
    isPickupLocationRestricted
}) => {
    const itemIds = checkoutItems.map((item) => item.id);
    const hensResult = itemIds.length
        ? await pool.query(
            'SELECT id, name, image_url FROM hens WHERE is_active = true AND id = ANY($1::int[])',
            [itemIds]
        )
        : { rows: [] };
    const henMap = new Map(hensResult.rows.map((row) => [Number(row.id), row]));
    if (henMap.size !== itemIds.length) {
        throw new CheckoutHttpError(400, 'Some requested items are unavailable.');
    }

    const stockResult = itemIds.length
        ? await pool.query(
            'SELECT hen_id, stock FROM pickup_stock WHERE pickup_date_id = $1 AND hen_id = ANY($2::int[])',
            [pickupDateId, itemIds]
        )
        : { rows: [] };
    const stockMap = new Map(
        stockResult.rows.map((row) => [Number(row.hen_id), Number(row.stock || 0)])
    );

    const lineItemsFull = [];
    const lineItemsLohmann = [];
    let totalCents = 0;
    let lohmannSubtotalCents = 0;
    let nonLohmannSubtotalCents = 0;
    let lohmannQty = 0;

    for (const item of checkoutItems) {
        const hen = henMap.get(Number(item.id));
        if (!hen) continue;

        const quantity = item.quantity;
        if (!Number.isFinite(quantity) || quantity <= 0) continue;

        if (isPickupLocationRestricted(hen.name, pickupLocation)) {
            throw new CheckoutHttpError(400, 'Lamb is not available for Hemmingford pickups.');
        }
        const minimumOrderQty = getMinimumOrderQuantity(hen.name);
        if (minimumOrderQty > 0 && quantity < minimumOrderQty) {
            throw new CheckoutHttpError(400, `Minimum order is ${minimumOrderQty} for ${hen.name}.`);
        }

        const availableStock = stockMap.get(Number(hen.id)) ?? 0;
        if (availableStock < quantity) {
            throw new CheckoutHttpError(400, `Insufficient stock for ${hen.name}`);
        }

        const unitPrice = Number(hen.id) === TEMP_BROWN_LAYER_TEST_HEN_ID
            ? TEMP_BROWN_LAYER_TEST_PRICE_CENTS
            : calculateItemPrice(hen.name, quantity);
        const itemTotal = unitPrice * quantity;
        totalCents += itemTotal;
        const isLohmann = isLohmannHenName(hen.name);
        if (isLohmann) {
            lohmannSubtotalCents += itemTotal;
            lohmannQty += quantity;
        } else {
            nonLohmannSubtotalCents += itemTotal;
        }

        const productData = {
            name: hen.name,
            description: `Bulk Price: $${(unitPrice / 100).toFixed(2)}/unit`
        };
        if (hen.image_url && hen.image_url.startsWith('http')) {
            productData.images = [hen.image_url];
        } else if (hen.image_url && hen.image_url.startsWith('/') && process.env.CLIENT_URL) {
            productData.images = [`${process.env.CLIENT_URL}${hen.image_url}`];
        }

        const lineItem = {
            price_data: {
                currency: 'cad',
                product_data: productData,
                unit_amount: unitPrice
            },
            quantity
        };
        if (isLohmann) {
            lineItemsLohmann.push(lineItem);
        } else {
            lineItemsFull.push(lineItem);
        }
    }

    const depositEligibleMinQty = Math.max(Number(getDepositEligibleMinQty?.() || 13), 1);
    const depositEligible = lohmannQty >= depositEligibleMinQty;
    if (requestedPayment === 'deposit' && !depositEligible) {
        throw new CheckoutHttpError(
            400,
            `Deposit is available only for ${depositEligibleMinQty} or more Lohmann hens.`
        );
    }

    const depositCents = depositEligible
        ? Math.floor(lohmannSubtotalCents * 0.25)
        : 0;
    const amountPaidCents = requestedPayment === 'deposit'
        ? nonLohmannSubtotalCents + depositCents
        : totalCents;
    const amountDueCents = Math.max(totalCents - amountPaidCents, 0);
    const paymentType = amountDueCents > 0 ? 'deposit' : 'full';

    let lineItems = [...lineItemsFull, ...lineItemsLohmann];
    if (paymentType === 'deposit') {
        lineItems = [...lineItemsFull];
        if (depositCents > 0) {
            lineItems.push({
                price_data: {
                    currency: 'cad',
                    product_data: {
                        name: 'Lohmann hen deposit (25%)',
                        description: `${lohmannQty} hens`
                    },
                    unit_amount: depositCents
                },
                quantity: 1
            });
        }
    }
    if (lineItems.length === 0 || totalCents <= 0) {
        throw new CheckoutHttpError(400, 'No purchasable items in checkout.');
    }

    const reservationItems = checkoutItems
        .map((item) => ({
            id: Number(item.id),
            quantity: Number(item.quantity)
        }))
        .filter((item) => Number.isInteger(item.id) && item.id > 0)
        .filter((item) => Number.isInteger(item.quantity) && item.quantity > 0)
        .sort((a, b) => a.id - b.id);

    return {
        totalCents,
        paymentType,
        amountPaidCents,
        amountDueCents,
        lineItems,
        reservationItems
    };
};

module.exports = {
    buildCheckoutQuote
};

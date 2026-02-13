const { CheckoutHttpError } = require('./checkout-errors');

const normalizeBaseUrl = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\/+$/, '');
};

const isLambItemName = (value) => {
    const normalized = String(value || '').toLowerCase();
    return normalized.includes('lamb') || normalized.includes('agneau');
};

const getCheckoutImagePath = (hen) => {
    const lowerName = String(hen?.name || '').toLowerCase();
    const rawImageUrl = String(hen?.image_url || '');
    const lowerImageUrl = rawImageUrl.toLowerCase();

    if (lowerName.includes('lamb') || lowerName.includes('agneau') || lowerImageUrl.includes('lamb')) {
        return '/photos/lamb_cropped.jpg';
    }
    if (lowerName.includes('meat') || lowerName.includes('chair') || lowerImageUrl.includes('broiler')) {
        return '/photos/chicks_cropped.jpg';
    }
    if (lowerName.includes('white') && (lowerName.includes('ready') || lowerName.includes('lay'))) {
        return '/photos/white_hen.jpg';
    }
    if (
        lowerName.includes('brown')
        || lowerName.includes('brune')
        || lowerName.includes('lohmann')
        || lowerImageUrl.includes('layer')
    ) {
        return '/photos/hens_cropped.jpg';
    }

    if (rawImageUrl.startsWith('http')) {
        return rawImageUrl;
    }
    if (rawImageUrl.startsWith('/')) {
        return rawImageUrl;
    }
    return '';
};

const resolveCheckoutImageUrl = (hen, clientBaseUrl = process.env.CLIENT_URL) => {
    const selectedPath = getCheckoutImagePath(hen);
    if (!selectedPath) return null;
    if (selectedPath.startsWith('http')) return selectedPath;
    const normalizedBaseUrl = normalizeBaseUrl(clientBaseUrl);
    if (!normalizedBaseUrl) return null;
    return `${normalizedBaseUrl}${selectedPath.startsWith('/') ? selectedPath : `/${selectedPath}`}`;
};

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
    getDepositRequiredAboveQty,
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
    const orderItemsForStorage = [];
    let totalCents = 0;
    let lohmannSubtotalCents = 0;
    let nonLohmannSubtotalCents = 0;
    let lohmannQty = 0;
    let lambQty = 0;

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

        const unitPrice = calculateItemPrice(hen.name, quantity);
        const itemTotal = unitPrice * quantity;
        totalCents += itemTotal;
        const isLohmann = isLohmannHenName(hen.name);
        const isLamb = isLambItemName(hen.name);
        if (isLohmann) {
            lohmannSubtotalCents += itemTotal;
            lohmannQty += quantity;
        } else {
            nonLohmannSubtotalCents += itemTotal;
            if (isLamb) {
                lambQty += quantity;
            }
        }

        const productData = {
            name: hen.name,
            description: `Bulk Price: $${(unitPrice / 100).toFixed(2)}/unit`
        };
        const checkoutImageUrl = resolveCheckoutImageUrl(hen);
        if (checkoutImageUrl) {
            productData.images = [checkoutImageUrl];
        }

        const lineItem = {
            price_data: {
                currency: 'cad',
                product_data: productData,
                unit_amount: unitPrice
            },
            quantity
        };
        orderItemsForStorage.push({
            id: Number(hen.id),
            quantity,
            name: hen.name,
            unit_cents: unitPrice,
            line_cents: itemTotal
        });
        if (isLohmann) {
            lineItemsLohmann.push(lineItem);
        } else {
            lineItemsFull.push(lineItem);
        }
    }

    const depositEligibleMinQty = Math.max(Number(getDepositEligibleMinQty?.() || 13), 1);
    const depositRequiredAboveQty = Math.max(Number(getDepositRequiredAboveQty?.() || 0), 0);
    const depositEligible = lohmannQty >= depositEligibleMinQty;
    const depositRequired = depositRequiredAboveQty > 0 && lohmannQty > depositRequiredAboveQty;
    const hasLambItems = lambQty > 0;
    if (depositRequired && requestedPayment !== 'deposit') {
        throw new CheckoutHttpError(
            400,
            `Orders above ${depositRequiredAboveQty} Lohmann hens require a 25% deposit.`
        );
    }
    if (requestedPayment === 'deposit' && !depositEligible && !hasLambItems) {
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
    const paymentType = (amountDueCents > 0 || hasLambItems) ? 'deposit' : 'full';

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
        orderItemsForStorage,
        reservationItems
    };
};

module.exports = {
    buildCheckoutQuote,
    resolveCheckoutImageUrl
};

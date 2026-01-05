require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const EMAIL_API_KEY = process.env.EMAIL_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;

const app = express();
const port = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "my-secret-password";

app.use(cors());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const parseOrderItems = (items) => {
    if (!items) return [];
    if (Array.isArray(items)) return items;
    if (typeof items === 'string') {
        try {
            return JSON.parse(items);
        } catch (error) {
            return [];
        }
    }
    return [];
};

const finalizeOrderFromSession = async (session) => {
    const orderIdFromMetadata = session?.metadata?.order_id;
    let orderId = orderIdFromMetadata;

    if (!orderId) {
        const lookup = await pool.query('SELECT id FROM orders WHERE stripe_payment_id = $1', [
            session.id
        ]);
        orderId = lookup.rows[0]?.id;
    }

    if (!orderId) {
        return { status: 'missing_order' };
    }

    let transactionStarted = false;
    try {
        await pool.query('BEGIN');
        transactionStarted = true;

        const orderResult = await pool.query(
            'SELECT status, items FROM orders WHERE id = $1 FOR UPDATE',
            [orderId]
        );

        if (orderResult.rows.length === 0) {
            await pool.query('ROLLBACK');
            return { status: 'missing_order' };
        }

        const order = orderResult.rows[0];
        const currentStatus = order.status || 'pending';
        const alreadyPaid = ['paid', 'fulfilled', 'picked_up'].includes(currentStatus);

        if (!alreadyPaid) {
            const items = parseOrderItems(order.items);
            for (const item of items) {
                const quantity = Number(item.quantity ?? item.qty ?? 0);
                const itemId = Number(item.id);
                if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(itemId)) {
                    continue;
                }
                await pool.query(
                    'UPDATE hens SET stock = GREATEST(stock - $1, 0) WHERE id = $2',
                    [quantity, itemId]
                );
            }
        }

        const nextStatus = alreadyPaid ? currentStatus : 'paid';
        await pool.query('UPDATE orders SET status = $1, stripe_payment_id = $2 WHERE id = $3', [
            nextStatus,
            session.id,
            orderId
        ]);

        await pool.query('COMMIT');
        return { status: nextStatus, orderId };
    } catch (err) {
        if (transactionStarted) {
            try {
                await pool.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('Rollback failed:', rollbackError);
            }
        }
        throw err;
    }
};

// Stripe Webhook - MUST BE BEFORE express.json()
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error("Webhook Error:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        try {
            const result = await finalizeOrderFromSession(session);
            if (result.status === 'missing_order') {
                console.error('Order not found for session', session.id);
            } else {
                console.log(`Order ${result.orderId} marked as ${result.status.toUpperCase()}`);
            }
        } catch (err) {
            console.error('Error updating order:', err);
        }
    }

    res.json({ received: true });
});

app.use(express.json());

// --- PRICING LOGIC (The "Flyer" Math) ---
const calculateItemPrice = (henName, qty) => {
    // 1. Lohmann Brown (Layers)
    if (henName.includes('Lohmann') || henName.includes('Ready-to-Lay')) {
        if (qty >= 50) return 1400; // $14.00
        if (qty >= 13) return 1525; // $15.25
        if (qty >= 6) return 1700; // $17.00
        return 1750;                // $17.50 (Base)
    }

    // 2. Ross (Meat Birds)
    if (henName.includes('Meat') || henName.includes('Chair')) {
        if (qty >= 300) return 215; // $2.15
        if (qty >= 100) return 230; // $2.30
        if (qty >= 49) return 250; // $2.50
        return 260;                 // $2.60 (Base for 25-49, and small orders)
    }

    // Fallback (shouldn't happen)
    return 0;
};

// --- ROUTES ---

app.get('/', (req, res) => res.send('Hen Store API Running 🐔'));

app.get('/api/hens', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hens WHERE is_active = true ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { items } = req.body;
        let lineItems = [];

        for (const item of items) {
            const result = await pool.query('SELECT * FROM hens WHERE id = $1', [item.id]);
            const hen = result.rows[0];

            if (!hen) continue;

            const quantity = Number(item.quantity);
            if (!Number.isFinite(quantity) || quantity <= 0) continue;

            const availableStock = Number(hen.stock);
            if (Number.isFinite(availableStock) && availableStock < quantity) {
                return res.status(400).json({
                    error: `Insufficient stock for ${hen.name}`
                });
            }

            // Calculate Dynamic Price based on Quantity
            const unitPrice = calculateItemPrice(hen.name, quantity);

            // Build product_data
            const productData = {
                name: hen.name,
                description: `Bulk Tier Applied: $${(unitPrice / 100).toFixed(2)}/unit`,
            };

            // Only add images if we have a valid absolute URL
            if (hen.image_url) {
                // If it's a relative URL (starts with /), make it absolute
                if (hen.image_url.startsWith('/')) {
                    productData.images = [`${process.env.CLIENT_URL}${hen.image_url}`];
                }
                // If it's already absolute (starts with http), use as-is
                else if (hen.image_url.startsWith('http')) {
                    productData.images = [hen.image_url];
                }
                // Otherwise, skip the image (invalid format)
            }

            lineItems.push({
                price_data: {
                    currency: 'cad', // Changed to CAD since you are in Quebec
                    product_data: productData,
                    unit_amount: unitPrice,
                },
                quantity,
            });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            // FORCE PICKUP SELECTION
            custom_fields: [
                {
                    key: 'pickup_location',
                    label: {
                        type: 'custom',
                        custom: 'Pick-up Location / Lieu de ramassage',
                    },
                    type: 'dropdown',
                    dropdown: {
                        options: [
                            { label: 'Hemmingford (Montérégie)', value: 'hemmingford' },
                            { label: 'Bristol (Outaouais)', value: 'bristol' },
                        ],
                    },
                },
            ],
            success_url: `${process.env.CLIENT_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.CLIENT_URL}?canceled=true`,
        });

        res.json({ url: session.url });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- CUSTOMER & CHECKOUT ROUTES ---

// 1. Lookup Customer by Phone
app.get('/api/customers/lookup', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).send("Phone required");

    try {
        const result = await pool.query('SELECT * FROM customers WHERE phone = $1', [phone]);
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.json(null); // Not found
        }
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 2. Checkout (Upsert Customer -> Create Order -> Stripe Session)
app.post('/api/checkout', async (req, res) => {
    const { customer, items, pickup } = req.body;
    // customer: { name, phone, email, address }
    // pickup: { date, location }
    // items: [{ id, quantity }]

    try {
        // A. Upsert Customer
        let customerId;
        const existingCust = await pool.query('SELECT id FROM customers WHERE phone = $1', [customer.phone]);

        if (existingCust.rows.length > 0) {
            customerId = existingCust.rows[0].id;
            // Optional: Update details if they changed
            await pool.query(
                'UPDATE customers SET name=$1, email=$2, address=$3 WHERE id=$4',
                [customer.name, customer.email, customer.address, customerId]
            );
        } else {
            const newCust = await pool.query(
                'INSERT INTO customers (name, phone, email, address) VALUES ($1, $2, $3, $4) RETURNING id',
                [customer.name, customer.phone, customer.email, customer.address]
            );
            customerId = newCust.rows[0].id;
        }

        // B. Calculate Total & Create Stripe Items
        let lineItems = [];
        let totalCents = 0;

        for (const item of items) {
            const result = await pool.query('SELECT * FROM hens WHERE id = $1', [item.id]);
            const hen = result.rows[0];
            if (!hen) continue;

            const quantity = Number(item.quantity);
            if (!Number.isFinite(quantity) || quantity <= 0) continue;

            const availableStock = Number(hen.stock);
            if (Number.isFinite(availableStock) && availableStock < quantity) {
                return res.status(400).json({
                    error: `Insufficient stock for ${hen.name}`
                });
            }

            const unitPrice = calculateItemPrice(hen.name, quantity);
            const itemTotal = unitPrice * quantity;
            totalCents += itemTotal;

            // Build product_data for Stripe
            const productData = {
                name: hen.name,
                description: `Bulk Price: $${(unitPrice / 100).toFixed(2)}/unit`,
            };
            if (hen.image_url && hen.image_url.startsWith('http')) {
                productData.images = [hen.image_url];
            } else if (hen.image_url && hen.image_url.startsWith('/')) {
                productData.images = [`${process.env.CLIENT_URL}${hen.image_url}`];
            }

            lineItems.push({
                price_data: {
                    currency: 'cad',
                    product_data: productData,
                    unit_amount: unitPrice,
                },
                quantity,
            });
        }

        // C. Insert Pending Order
        const newOrder = await pool.query(
            `INSERT INTO orders (customer_id, customer_email, total_cents, items, status, pickup_date, pickup_location) 
             VALUES ($1, $2, $3, $4, 'pending', $5, $6) RETURNING id`,
            [customerId, customer.email, totalCents, JSON.stringify(items), pickup.date, pickup.location]
        );
        const orderId = newOrder.rows[0].id;

        // D. Create Stripe Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            metadata: { order_id: orderId }, // Link Stripe to our DB Order
            success_url: `${process.env.CLIENT_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.CLIENT_URL}?canceled=true`,
        });

        // Update Order with Stripe ID
        await pool.query('UPDATE orders SET stripe_payment_id = $1 WHERE id = $2', [session.id, orderId]);

        res.json({ url: session.url });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/orders/confirm', async (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) {
        return res.status(400).json({ error: 'session_id required' });
    }

    let session;
    try {
        session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (err) {
        console.error('Invalid Stripe session:', err);
        return res.status(400).json({ error: 'Invalid session' });
    }

    if (session.payment_status !== 'paid') {
        return res.status(400).json({ error: 'Payment not completed' });
    }

    try {
        const result = await finalizeOrderFromSession(session);
        if (result.status === 'missing_order') {
            return res.status(404).json({ error: 'Order not found' });
        }
        return res.json({ success: true, status: result.status, orderId: result.orderId });
    } catch (err) {
        console.error('Error confirming order:', err);
        return res.status(500).json({ error: 'Failed to confirm order' });
    }
});


// --- ADMIN ROUTES ---

// Middleware for Admin Auth
const checkAuth = (req, res, next) => {
    const password = req.headers.authorization;
    const correctPassword = process.env.ADMIN_PASSWORD || "chickens";

    console.log(`Auth Check: Header='${password}', Expected='${correctPassword}'`); // DEBUG

    if (password === correctPassword) {
        next();
    } else {
        res.status(401).send("Unauthorized");
    }
};

// 1. Login
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const correctPassword = process.env.ADMIN_PASSWORD || "chickens";

    console.log('Login attempt:', password, 'Expected:', correctPassword); // DEBUG

    if (password === correctPassword) {
        res.json({ success: true });
    } else {
        res.status(401).send("Wrong password");
    }
});

// 2. Get Orders (Admin)
// Now joins with customers table
app.get('/api/admin/orders', checkAuth, async (req, res) => {
    try {
        const query = `
            SELECT 
                orders.*, 
                customers.name as customer_name,
                customers.phone as customer_phone,
                customers.address as customer_address
            FROM orders
            LEFT JOIN customers ON orders.customer_id = customers.id
            ORDER BY orders.created_at DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
});

// 3. Update Hen Stock
app.put('/api/admin/hens/:id', checkAuth, async (req, res) => {
    const { id } = req.params;
    const { stock } = req.body;
    try {
        await pool.query('UPDATE hens SET stock = $1 WHERE id = $2', [stock, id]);
        res.json({ success: true, message: "Stock updated" });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// 4. Pickup Dates (Admin)
// GET Dates (Public)
app.get('/api/pickup-dates', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pickup_dates WHERE is_active = true ORDER BY date_value ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// POST Add Date
app.post('/api/admin/pickup-dates', checkAuth, async (req, res) => {
    const { date_value } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO pickup_dates (date_value) VALUES ($1) RETURNING *',
            [date_value]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// DELETE Date
app.delete('/api/admin/pickup-dates/:id', checkAuth, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM pickup_dates WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 5. Update Order Status
app.put('/api/admin/orders/:id/status', checkAuth, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
        res.json({ success: true, message: "Status updated" });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 6. Send Email (Admin)
app.post('/api/admin/email', checkAuth, async (req, res) => {
    if (!EMAIL_API_KEY || !EMAIL_FROM) {
        return res.status(500).json({ error: 'Email is not configured.' });
    }

    const { messages, recipients, subject, message } = req.body;
    let sendMessages = [];

    if (Array.isArray(messages) && messages.length > 0) {
        sendMessages = messages;
    } else if (Array.isArray(recipients) && subject && message) {
        sendMessages = recipients.map((recipient) => ({
            to: recipient,
            subject,
            text: message
        }));
    }

    if (sendMessages.length === 0) {
        return res.status(400).json({ error: 'No email recipients provided.' });
    }

    const validMessages = sendMessages.filter((item) =>
        item?.to?.email && item?.subject && item?.text
    );

    if (validMessages.length === 0) {
        return res.status(400).json({ error: 'No valid email recipients provided.' });
    }

    try {
        for (const item of validMessages) {
            const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${EMAIL_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    personalizations: [
                        {
                            to: [{
                                email: item.to.email,
                                name: item.to.name || undefined
                            }]
                        }
                    ],
                    from: { email: EMAIL_FROM },
                    subject: item.subject,
                    content: [
                        {
                            type: 'text/plain',
                            value: item.text
                        }
                    ]
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                return res.status(500).json({ error: `Email send failed: ${errorBody}` });
            }
        }

        res.json({ success: true, sent: validMessages.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Email send failed.' });
    }
});

app.listen(port, () => console.log(`Server on port ${port}`));

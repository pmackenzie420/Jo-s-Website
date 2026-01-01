require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "my-secret-password";

app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

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

            // Calculate Dynamic Price based on Quantity
            const unitPrice = calculateItemPrice(hen.name, item.quantity);

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
                quantity: item.quantity,
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
            success_url: `${process.env.CLIENT_URL}/success`,
            cancel_url: `${process.env.CLIENT_URL}?canceled=true`,
        });

        res.json({ url: session.url });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => console.log(`Server on port ${port}`));

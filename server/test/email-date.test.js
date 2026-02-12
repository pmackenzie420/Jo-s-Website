const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const runPayloadSubjectInTz = (tz, language = 'en') => execFileSync(
    process.execPath,
    [
        '-e',
        [
            "const { buildOrderConfirmationEmailPayload } = require('./logic/email');",
            'const payload = buildOrderConfirmationEmailPayload({',
            '  order: {',
            "    id: 'TEST-ORDER-1',",
            "    pickup_date: '2026-03-01',",
            "    pickup_location: 'hemmingford',",
            "    customer_name: 'Test Customer',",
            "    customer_email: 'test@example.com',",
            "    total_cents: 21000,",
            "    amount_paid_cents: 5250,",
            "    amount_due_cents: 15750,",
            "    payment_type: 'deposit',",
            `    language: '${language}'`,
            '  },',
            '  items: [',
            '    {',
            "      id: '1',",
            "      name: 'Brown Ready-to-Lay Hens / Poules brunes prêtes à pondre',",
            '      quantity: 12,',
            '      line_cents: 21000',
            '    }',
            '  ]',
            '});',
            'console.log(payload.subject);'
        ].join(' ')
    ],
    {
        cwd: process.cwd(),
        env: {
            ...process.env,
            TZ: tz
        }
    }
)
    .toString()
    .trim();

test('confirmation email subject keeps pickup date stable across time zones', () => {
    const utcSubject = runPayloadSubjectInTz('UTC', 'en');
    const nySubject = runPayloadSubjectInTz('America/New_York', 'en');
    const aucklandSubject = runPayloadSubjectInTz('Pacific/Auckland', 'en');

    assert.equal(utcSubject, 'Order Confirmed - Pickup March 1, 2026');
    assert.equal(nySubject, utcSubject);
    assert.equal(aucklandSubject, utcSubject);
});

test('confirmation email french subject keeps pickup date stable across time zones', () => {
    const utcSubject = runPayloadSubjectInTz('UTC', 'fr');
    const nySubject = runPayloadSubjectInTz('America/New_York', 'fr');

    assert.match(utcSubject, /^Commande confirmée - Ramassage .*2026$/);
    assert.equal(nySubject, utcSubject);
});

const LOCATION_DETAILS = require('../../shared/locations.json');

const PAID_STATUSES = new Set(['paid', 'fulfilled', 'picked_up']);

const COMPANY_CONTACT = {
    name: 'Les Fermes Soulard',
    address: '84 Rte 148, Bristol, QC',
    phone: '(819) 770-0070',
    email: 'lesfermessoulard@gmail.com'
};

const ORDER_CONFIRMATION_COPY = {
    en: {
        subject: (date) => `Order Confirmed${date ? ` - Pickup ${date}` : ''}`,
        greeting: (name) => `Hi ${name},`,
        thankYou: 'Thank you for your order!',
        pickupTitleText: 'PICKUP DETAILS:',
        pickupTitleHtml: 'Pickup Details',
        dateLabel: 'Date',
        locationLabel: 'Location',
        addressLabel: 'Address',
        orderTitleText: 'YOUR ORDER:',
        orderTitleHtml: 'Your Order',
        paymentTitleText: 'PAYMENT:',
        paymentTitleHtml: 'Payment',
        statusLabel: 'Status',
        paidTodayLabel: 'Paid today',
        dueLabel: 'Amount due at pickup',
        orderIdLabel: 'Order ID',
        itemsUnavailable: 'Item details unavailable',
        questions: (phone) => `Questions? Reply to this email or call us at ${phone}.`,
        depositPaid: 'Deposit paid',
        paidInFull: 'Paid in full'
    },
    fr: {
        subject: (date) => `Commande confirmée${date ? ` - Ramassage ${date}` : ''}`,
        greeting: (name) => `Bonjour ${name},`,
        thankYou: 'Merci pour votre commande !',
        pickupTitleText: 'DÉTAILS DU RAMASSAGE:',
        pickupTitleHtml: 'Détails du ramassage',
        dateLabel: 'Date',
        locationLabel: 'Succursale',
        addressLabel: 'Adresse',
        orderTitleText: 'VOTRE COMMANDE:',
        orderTitleHtml: 'Votre commande',
        paymentTitleText: 'PAIEMENT:',
        paymentTitleHtml: 'Paiement',
        statusLabel: 'Statut',
        paidTodayLabel: "Payé aujourd'hui",
        dueLabel: 'Montant dû au ramassage',
        orderIdLabel: 'ID de commande',
        itemsUnavailable: "Détails d'article indisponibles",
        questions: (phone) => `Des questions ? Répondez à ce courriel ou appelez-nous au ${phone}.`,
        depositPaid: 'Dépôt payé',
        paidInFull: 'Payé en totalité'
    }
};

module.exports = {
    PAID_STATUSES,
    LOCATION_DETAILS,
    COMPANY_CONTACT,
    ORDER_CONFIRMATION_COPY
};

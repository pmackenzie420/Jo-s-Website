class CheckoutHttpError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'CheckoutHttpError';
        this.status = status;
    }
}

module.exports = {
    CheckoutHttpError
};

const test = require('node:test');
const assert = require('node:assert/strict');

const loadEmailModule = ({
    emailFrom = 'orders@lesfermessoulard.farm',
    resendApiKey = 're_test_key',
    rateLimitPerSecond = '1000',
    maxSendAttempts = '4',
    requestTimeoutMs = '15000'
} = {}) => {
    process.env.EMAIL_FROM = emailFrom;
    if (resendApiKey === null) {
        delete process.env.RESEND_API_KEY;
    } else {
        process.env.RESEND_API_KEY = resendApiKey;
    }
    process.env.RESEND_RATE_LIMIT_PER_SECOND = rateLimitPerSecond;
    process.env.RESEND_MAX_SEND_ATTEMPTS = maxSendAttempts;
    process.env.RESEND_REQUEST_TIMEOUT_MS = requestTimeoutMs;

    const modulePath = require.resolve('../logic/email');
    delete require.cache[modulePath];
    return require(modulePath);
};

const createJsonResponse = ({ ok = true, status = 200, body = {}, headers = {} } = {}) => {
    const normalizedHeaders = Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
    );
    let consumed = false;
    return {
        ok,
        status,
        headers: {
            get(name) {
                return normalizedHeaders[String(name || '').toLowerCase()] || null;
            }
        },
        async json() {
            consumed = true;
            return body;
        },
        async text() {
            return consumed ? '' : JSON.stringify(body);
        }
    };
};

test('sendEmailMessage retries resend 429 responses and succeeds', async () => {
    const { sendEmailMessage } = loadEmailModule();
    const originalFetch = global.fetch;
    const fetchCalls = [];

    global.fetch = async (_url, options) => {
        fetchCalls.push(options);
        if (fetchCalls.length === 1) {
            return createJsonResponse({
                ok: false,
                status: 429,
                body: {
                    message: 'Too many requests.'
                },
                headers: {
                    'content-type': 'application/json',
                    'retry-after': '0'
                }
            });
        }
        return createJsonResponse({
            ok: true,
            status: 200,
            body: {
                id: 'provider-email-1'
            },
            headers: {
                'content-type': 'application/json'
            }
        });
    };

    try {
        const result = await sendEmailMessage({
            to: {
                email: 'customer@example.com',
                name: 'Customer'
            },
            subject: 'Pickup reminder',
            text: 'Reminder',
            idempotencyKey: 'email-1'
        });

        assert.equal(result.id, 'provider-email-1');
        assert.equal(fetchCalls.length, 2);
        assert.equal(fetchCalls[0]?.headers?.['Idempotency-Key'], 'email-1');
        assert.equal(fetchCalls[1]?.headers?.['Idempotency-Key'], 'email-1');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendEmailMessage fails before provider call when Resend key is missing', async () => {
    const { sendEmailMessage } = loadEmailModule({ resendApiKey: null });
    const originalFetch = global.fetch;
    let fetchCalled = false;
    global.fetch = async () => {
        fetchCalled = true;
        return createJsonResponse();
    };

    try {
        await assert.rejects(
            () => sendEmailMessage({
                to: { email: 'customer@example.com' },
                subject: 'Pickup reminder',
                text: 'Reminder'
            }),
            /Email provider API key is not configured/
        );
        assert.equal(fetchCalled, false);
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendEmailMessage times out stalled Resend requests', async () => {
    const { sendEmailMessage } = loadEmailModule({
        maxSendAttempts: '1',
        requestTimeoutMs: '1'
    });
    const originalFetch = global.fetch;

    global.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
        });
    });

    try {
        await assert.rejects(
            () => sendEmailMessage({
                to: { email: 'customer@example.com' },
                subject: 'Pickup reminder',
                text: 'Reminder'
            }),
            /Resend request timed out/
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendEmailMessage queues resend requests so only one provider call is in flight', async () => {
    const { sendEmailMessage } = loadEmailModule();
    const originalFetch = global.fetch;
    let fetchCallCount = 0;
    let resolveFirstResponse;

    global.fetch = (_url, _options) => {
        fetchCallCount += 1;
        if (fetchCallCount === 1) {
            return new Promise((resolve) => {
                resolveFirstResponse = () => resolve(createJsonResponse({
                    ok: true,
                    status: 200,
                    body: { id: 'provider-email-1' },
                    headers: {
                        'content-type': 'application/json'
                    }
                }));
            });
        }

        return Promise.resolve(createJsonResponse({
            ok: true,
            status: 200,
            body: { id: 'provider-email-2' },
            headers: {
                'content-type': 'application/json'
            }
        }));
    };

    try {
        const firstSend = sendEmailMessage({
            to: { email: 'first@example.com' },
            subject: 'First',
            text: 'First body'
        });
        const secondSend = sendEmailMessage({
            to: { email: 'second@example.com' },
            subject: 'Second',
            text: 'Second body'
        });

        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(fetchCallCount, 1);

        resolveFirstResponse();

        const [firstResult, secondResult] = await Promise.all([firstSend, secondSend]);
        assert.equal(firstResult.id, 'provider-email-1');
        assert.equal(secondResult.id, 'provider-email-2');
        assert.equal(fetchCallCount, 2);
    } finally {
        global.fetch = originalFetch;
    }
});

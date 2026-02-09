const test = require('node:test');
const assert = require('node:assert/strict');

const { createRateLimiter } = require('../middleware/auth');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createMockRes = () => {
    const headers = {};
    const res = {
        statusCode: 200,
        body: null,
        set(name, value) {
            headers[name] = value;
            return res;
        },
        status(code) {
            res.statusCode = code;
            return res;
        },
        json(payload) {
            res.body = payload;
            return res;
        }
    };
    return { res, headers };
};

test('rate limiter blocks when max is exceeded and resets after window', async () => {
    const limiter = createRateLimiter({
        windowMs: 40,
        max: 2,
        keyPrefix: `test-${Date.now()}`
    });

    const req = { headers: {}, ip: '127.0.0.1' };

    const first = createMockRes();
    let nextCalled = false;
    limiter(req, first.res, () => {
        nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(first.res.statusCode, 200);

    const second = createMockRes();
    nextCalled = false;
    limiter(req, second.res, () => {
        nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(second.res.statusCode, 200);

    const third = createMockRes();
    nextCalled = false;
    limiter(req, third.res, () => {
        nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(third.res.statusCode, 429);
    assert.equal(typeof third.headers['Retry-After'], 'string');
    assert.equal(third.res.body?.error?.includes('Too many requests'), true);

    await wait(60);

    const afterWindow = createMockRes();
    nextCalled = false;
    limiter(req, afterWindow.res, () => {
        nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(afterWindow.res.statusCode, 200);
});

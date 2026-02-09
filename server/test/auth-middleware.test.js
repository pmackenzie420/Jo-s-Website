const test = require('node:test');
const assert = require('node:assert/strict');

const createMockRes = () => {
    const res = {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        send(payload) {
            this.body = payload;
            return this;
        }
    };
    return res;
};

test('checkAuth only accepts admin session tokens', () => {
    const previousAdminSecret = process.env.ADMIN_SESSION_SECRET;
    const previousMainSecret = process.env.MAIN_SESSION_SECRET;
    process.env.ADMIN_SESSION_SECRET = 'admin-session-secret-for-tests';
    process.env.MAIN_SESSION_SECRET = 'main-session-secret-for-tests';

    delete require.cache[require.resolve('../middleware/auth')];
    const {
        checkAuth,
        signAdminSession,
        signMainSession,
        ADMIN_SESSION_COOKIE
    } = require('../middleware/auth');

    const reqWithAdminToken = {
        headers: {
            cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(signAdminSession({ sub: 'admin' }))}`
        }
    };
    const adminRes = createMockRes();
    let adminNextCalled = false;
    checkAuth(reqWithAdminToken, adminRes, () => {
        adminNextCalled = true;
    });
    assert.equal(adminNextCalled, true);
    assert.equal(adminRes.statusCode, 200);

    const reqWithMainToken = {
        headers: {
            cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(signMainSession({ sub: 'main' }))}`
        }
    };
    const mainRes = createMockRes();
    let mainNextCalled = false;
    checkAuth(reqWithMainToken, mainRes, () => {
        mainNextCalled = true;
    });
    assert.equal(mainNextCalled, false);
    assert.equal(mainRes.statusCode, 401);

    if (typeof previousAdminSecret === 'string') {
        process.env.ADMIN_SESSION_SECRET = previousAdminSecret;
    } else {
        delete process.env.ADMIN_SESSION_SECRET;
    }
    if (typeof previousMainSecret === 'string') {
        process.env.MAIN_SESSION_SECRET = previousMainSecret;
    } else {
        delete process.env.MAIN_SESSION_SECRET;
    }
    delete require.cache[require.resolve('../middleware/auth')];
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEmailVerifier } = require('../logic/email-verification');

const createError = (code) => {
    const error = new Error(code);
    error.code = code;
    return error;
};

test('email verifier blocks invalid format', async () => {
    const verifier = createEmailVerifier({
        resolver: {
            resolveMx: async () => [],
            resolve4: async () => [],
            resolve6: async () => []
        }
    });

    const result = await verifier.verify('not-an-email', { language: 'en' });
    assert.equal(result.accepted, false);
    assert.equal(result.shouldBlock, true);
    assert.equal(result.reason, 'invalid_format');
});

test('email verifier accepts domains with MX records', async () => {
    const verifier = createEmailVerifier({
        resolver: {
            resolveMx: async () => [{ exchange: 'mx.example.com', priority: 10 }],
            resolve4: async () => [],
            resolve6: async () => []
        }
    });

    const result = await verifier.verify('user@example.com', { language: 'en' });
    assert.equal(result.accepted, true);
    assert.equal(result.shouldBlock, false);
    assert.equal(result.reason, 'valid');
});

test('email verifier accepts implicit MX via A/AAAA fallback', async () => {
    const verifier = createEmailVerifier({
        resolver: {
            resolveMx: async () => { throw createError('ENODATA'); },
            resolve4: async () => ['203.0.113.1'],
            resolve6: async () => []
        }
    });

    const result = await verifier.verify('user@implicit-mx.test', { language: 'en' });
    assert.equal(result.accepted, true);
    assert.equal(result.shouldBlock, false);
});

test('email verifier blocks missing domains and suggests typo', async () => {
    const verifier = createEmailVerifier({
        resolver: {
            resolveMx: async () => { throw createError('ENOTFOUND'); },
            resolve4: async () => { throw createError('ENOTFOUND'); },
            resolve6: async () => { throw createError('ENOTFOUND'); }
        }
    });

    const result = await verifier.verify('name@gmial.com', { language: 'en' });
    assert.equal(result.accepted, false);
    assert.equal(result.shouldBlock, true);
    assert.equal(result.reason, 'domain_not_found');
    assert.equal(result.suggestion, 'name@gmail.com');
});

test('email verifier warns but does not block on temporary DNS failures', async () => {
    const verifier = createEmailVerifier({
        resolver: {
            resolveMx: async () => { throw createError('ETIMEOUT'); },
            resolve4: async () => { throw createError('ETIMEOUT'); },
            resolve6: async () => { throw createError('ETIMEOUT'); }
        }
    });

    const result = await verifier.verify('user@example.com', { language: 'en' });
    assert.equal(result.accepted, true);
    assert.equal(result.shouldBlock, false);
    assert.equal(result.reason, 'dns_unavailable');
});

test('email verifier warns on disposable domains', async () => {
    const verifier = createEmailVerifier({
        resolver: {
            resolveMx: async () => [{ exchange: 'mx.mailinator.com', priority: 10 }],
            resolve4: async () => [],
            resolve6: async () => []
        }
    });

    const result = await verifier.verify('user@mailinator.com', { language: 'en' });
    assert.equal(result.accepted, true);
    assert.equal(result.shouldBlock, false);
    assert.equal(result.reason, 'disposable_domain');
    assert.equal(result.status, 'warning');
});

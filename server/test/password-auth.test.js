const test = require('node:test');
const assert = require('node:assert/strict');

const {
    verifyPassword,
    parseAllowlist,
    isIpAllowed,
    hashPasswordScrypt
} = require('../utils/password-auth');

test('verifyPassword supports plain secret and scrypt hash', () => {
    const plain = 'dev-secret-123';
    const scryptHash = hashPasswordScrypt(plain);

    assert.equal(
        verifyPassword({ candidate: plain, plainSecret: plain, hashedSecret: null }),
        true
    );
    assert.equal(
        verifyPassword({ candidate: 'wrong', plainSecret: plain, hashedSecret: null }),
        false
    );
    assert.equal(
        verifyPassword({ candidate: plain, plainSecret: null, hashedSecret: scryptHash }),
        true
    );
    assert.equal(
        verifyPassword({ candidate: 'wrong', plainSecret: null, hashedSecret: scryptHash }),
        false
    );
});

test('allowlist parser and matcher supports optional admin IP restrictions', () => {
    const allowlist = parseAllowlist('127.0.0.1, 10.0.0.2');
    assert.deepEqual(allowlist, ['127.0.0.1', '10.0.0.2']);

    assert.equal(
        isIpAllowed({ ip: '127.0.0.1', headers: {} }, allowlist),
        true
    );
    assert.equal(
        isIpAllowed({ ip: '8.8.8.8', headers: {} }, allowlist),
        false
    );
    assert.equal(
        isIpAllowed({ ip: '8.8.8.8', headers: {} }, []),
        true
    );
});

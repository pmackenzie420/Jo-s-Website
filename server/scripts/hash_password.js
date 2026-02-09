const { hashPasswordScrypt } = require('../utils/password-auth');

const value = process.argv[2];
if (!value) {
    console.error('Usage: node scripts/hash_password.js "<password>"');
    process.exit(1);
}

const hashed = hashPasswordScrypt(value);
console.log(hashed);

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const [algorithm, salt, keyHex] = String(storedHash).split(':');
  if (algorithm !== 'scrypt' || !salt || !keyHex) return false;
  const storedKey = Buffer.from(keyHex, 'hex');
  const derivedKey = await scrypt(password, salt, storedKey.length);
  return storedKey.length === derivedKey.length && crypto.timingSafeEqual(storedKey, derivedKey);
}

function meetsPasswordRules(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 128
    && /[A-Z]/.test(password) && /[a-z]/.test(password)
    && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

module.exports = { hashPassword, verifyPassword, meetsPasswordRules };

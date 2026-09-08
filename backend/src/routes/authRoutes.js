const crypto = require('crypto');
const express = require('express');
const { pool } = require('../config/database');
const { hashPassword, verifyPassword, meetsPasswordRules } = require('../services/passwordService');
const { authenticate, tokenHash } = require('../middleware/authentication');

const router = express.Router();
const roles = new Set(['patient', 'staff', 'admin']);
const genders = new Set(['female', 'male', 'other', 'prefer-not-to-say']);

function validateRegistration(body) {
  const errors = {};
  const name = String(body.fullName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const digits = phone.replace(/\D/g, '');
  const birthDate = String(body.birthDate || '');
  if (name.length < 2 || name.length > 120 || !/^[\p{L}][\p{L} .'-]+$/u.test(name)) errors.fullName = 'Enter a valid full name.';
  if (email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (!/^[+0-9 ()-]+$/.test(phone) || digits.length < 8 || digits.length > 15) errors.phone = 'Enter a valid phone number with 8–15 digits.';
  const parsedBirthDate = new Date(`${birthDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(parsedBirthDate.valueOf()) || parsedBirthDate > new Date()) errors.birthDate = 'Enter a valid date of birth.';
  if (!genders.has(body.gender)) errors.gender = 'Select a gender option.';
  if (!meetsPasswordRules(body.password)) errors.password = 'Password does not meet the security requirements.';
  if (body.password !== body.confirmPassword) errors.confirmPassword = 'Passwords do not match.';
  if (body.terms !== true) errors.terms = 'Accept the Terms and Privacy Notice to continue.';
  return { errors, values: { name, email, phone, birthDate, gender: body.gender } };
}

function setSessionCookie(response, token, remember) {
  const maxAge = remember ? 30 * 24 * 60 * 60 : 8 * 60 * 60;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `mediq_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`);
  return maxAge;
}

router.post('/register', async (request, response) => {
  const { errors, values } = validateRegistration(request.body);
  if (Object.keys(errors).length) return response.status(422).json({ error: 'Check the highlighted fields.', fields: errors });
  try {
    const passwordHash = await hashPassword(request.body.password);
    const [result] = await pool.execute(
      `INSERT INTO users (full_name, email, password_hash, phone_number, birth_date, gender, role)
       VALUES (?, ?, ?, ?, ?, ?, 'patient')`,
      [values.name, values.email, passwordHash, values.phone, values.birthDate, values.gender],
    );
    return response.status(201).json({ message: 'Patient account created. You can now sign in.', userId: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ error: 'An account already uses this email address.', fields: { email: 'Email address is already registered.' } });
    return response.status(503).json({ error: 'Registration is unavailable. Check the database connection and try again.' });
  }
});

router.post('/login', async (request, response) => {
  const email = String(request.body.email || '').trim().toLowerCase();
  const role = String(request.body.role || '');
  if (!email || !request.body.password || !roles.has(role)) return response.status(400).json({ error: 'Email, password and a valid access role are required.' });
  try {
    const [rows] = await pool.execute('SELECT id, full_name, email, password_hash, role, is_active FROM users WHERE email = ? LIMIT 1', [email]);
    const user = rows[0];
    if (!user || !user.is_active || user.role !== role || !(await verifyPassword(request.body.password, user.password_hash))) {
      return response.status(401).json({ error: 'The sign-in details are incorrect for this portal.' });
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const maxAge = setSessionCookie(response, token, Boolean(request.body.remember));
    await pool.execute('INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))', [user.id, tokenHash(token), maxAge]);
    const redirect = user.role === 'patient'
      ? '/patient-dashboard.html'
      : user.role === 'staff' ? '/staff-dashboard.html' : '/dashboard.html?role=admin';
    return response.json({ message: 'Signed in successfully.', user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role }, redirect });
  } catch (error) {
    return response.status(503).json({ error: 'Sign-in is unavailable. Check the database connection and try again.' });
  }
});

router.get('/me', authenticate, (request, response) => response.json({ user: request.user }));

router.post('/logout', authenticate, async (request, response) => {
  const cookie = String(request.headers.cookie || '').match(/(?:^|;\s*)mediq_session=([^;]+)/);
  if (cookie) await pool.execute('DELETE FROM user_sessions WHERE token_hash = ?', [tokenHash(decodeURIComponent(cookie[1]))]);
  response.setHeader('Set-Cookie', 'mediq_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return response.json({ message: 'Signed out.' });
});

module.exports = router;

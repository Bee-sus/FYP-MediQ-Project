const crypto = require('crypto');
const express = require('express');
const { pool } = require('../config/database');
const { hashPassword, verifyPassword, meetsPasswordRules } = require('../services/passwordService');
const { authenticate, tokenHash } = require('../middleware/authentication');
const { createVerificationToken, sendVerificationEmail, hashToken } = require('../services/emailVerificationService');
const {createPatientVerification}=require('../services/patientOtpService');

const { validateIdentity } = require('../services/patientIdentity');
const router = express.Router();
router.use(require('./patientVerificationRoutes'));
router.use(require('./passwordRecoveryRoutes'));
const roles = new Set(['patient', 'staff', 'admin']);
const genders = new Set(['female', 'male', 'other', 'prefer-not-to-say']);

function validateRegistration(body) {
  const identity = validateIdentity(body);
  const errors = { ...identity.errors };
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
  return { errors, values: { name, email, phone, birthDate, gender: body.gender, identificationType: identity.type, identificationNumber: identity.number } };
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
      `INSERT INTO users (full_name, email, password_hash, phone_number, birth_date, gender, identification_type, identification_number, role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'patient')`,
      [values.name, values.email, passwordHash, values.phone, values.birthDate, values.gender, values.identificationType, values.identificationNumber],
    );
    const verificationSession=await createPatientVerification(pool,result.insertId);
    return response.status(201).json({message:'Account created. Verify your email to finish registration.',userId:result.insertId,requiresVerification:true,verificationMethod:'otp',verificationSession,verificationEmail:values.email});
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
    const [rows] = await pool.execute('SELECT id, full_name, email, password_hash, role, is_active, must_change_password, email_verified_at FROM users WHERE email = ? LIMIT 1', [email]);
    const user = rows[0];
    if (!user || !user.is_active || user.role !== role || !(await verifyPassword(request.body.password, user.password_hash))) {
      return response.status(401).json({ error: 'The sign-in details are incorrect for this portal.' });
    }
    if (user.role !== 'admin' && user.email_verified_at === null) {
      const verification = user.role==='patient'?{verificationMethod:'otp',verificationSession:await createPatientVerification(pool,user.id),verificationEmail:user.email}:{};
      return response.status(403).json({error:'Verify your email address before signing in.',emailVerificationRequired:true,...verification});
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const maxAge = setSessionCookie(response, token, Boolean(request.body.remember));
    await pool.execute('INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))', [user.id, tokenHash(token), maxAge]);
    const redirect = user.role === 'patient'
      ? '/patient-dashboard.html'
      : user.role === 'staff' ? `/staff-dashboard.html${user.must_change_password ? '#profile' : ''}` : '/admin-dashboard.html';
    return response.json({ message: 'Signed in successfully.', user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role, mustChangePassword: Boolean(user.must_change_password) }, redirect });
  } catch (error) {
    return response.status(503).json({ error: 'Sign-in is unavailable. Check the database connection and try again.' });
  }
});

router.post('/verify-email', async (request, response) => {
  const token = String(request.body.token || '');
  if (token.length < 20) return response.status(422).json({ error: 'This verification link is invalid.' });
  let connection;
  try {
    connection = await pool.getConnection(); await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT t.user_id AS userId, u.role FROM email_verification_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.expires_at > NOW() FOR UPDATE', [hashToken(token)]);
    if (!rows.length) { await connection.rollback(); return response.status(410).json({ error: 'This verification link is invalid or has expired.' }); }
    await connection.execute('UPDATE users SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP) WHERE id = ?', [rows[0].userId]);
    await connection.execute('DELETE FROM email_verification_tokens WHERE user_id = ?', [rows[0].userId]);
    await connection.commit(); return response.json({ message: 'Email verified successfully. You can now sign in.', role: rows[0].role });
  } catch (error) { if (connection) await connection.rollback(); return response.status(503).json({ error: 'Email verification is temporarily unavailable.' }); }
  finally { if (connection) connection.release(); }
});

router.post('/resend-verification', async (request, response) => {
  const email = String(request.body.email || '').trim().toLowerCase(); const role = String(request.body.role || 'patient');
  if(role==='patient')return response.json({message:'Sign in with your patient email and password to request a verification code.'});
  if(role!=='staff')return response.status(422).json({error:'Select a valid verification role.'});
  try {
    const [rows] = await pool.execute('SELECT id, full_name AS fullName, email, email_verified_at AS verifiedAt FROM users WHERE email = ? AND role = ? AND is_active = TRUE LIMIT 1', [email, role]);
    if (!rows.length || rows[0].verifiedAt) return response.json({ message: 'If an unverified account exists, a new verification email has been prepared.' });
    const token = await createVerificationToken(pool, rows[0].id); let delivery;
    try { delivery = await sendVerificationEmail({ email, fullName: rows[0].fullName, token }); } catch (error) { delivery = { sent: false, previewUrl: null }; }
    const message = delivery.sent ? 'Verification email sent.'
      : delivery.previewUrl ? 'Open the local verification link to continue.'
        : 'The verification email could not be sent. Check the mail settings.';
    return response.json({ message, verificationPreviewUrl: process.env.NODE_ENV === 'production' ? null : delivery.previewUrl });
  } catch (error) { return response.status(503).json({ error: 'Verification email could not be resent.' }); }
});

router.get('/me', authenticate, (request, response) => response.json({ user: request.user }));

router.post('/logout', authenticate, async (request, response) => {
  const cookie = String(request.headers.cookie || '').match(/(?:^|;\s*)mediq_session=([^;]+)/);
  if (cookie) await pool.execute('DELETE FROM user_sessions WHERE token_hash = ?', [tokenHash(decodeURIComponent(cookie[1]))]);
  response.setHeader('Set-Cookie', 'mediq_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return response.json({ message: 'Signed out.' });
});

module.exports = router;

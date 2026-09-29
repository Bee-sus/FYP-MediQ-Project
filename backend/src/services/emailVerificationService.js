const crypto = require('crypto');
const nodemailer = require('nodemailer');

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

async function createVerificationToken(connection, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await connection.execute('DELETE FROM email_verification_tokens WHERE user_id = ?', [userId]);
  await connection.execute('INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))', [userId, hashToken(token)]);
  return token;
}

function verificationUrl(token) {
  const base = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  return `${base}/verify-email.html?token=${encodeURIComponent(token)}`;
}

async function sendVerificationEmail({ email, fullName, token }) {
  const url = verificationUrl(token);
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) return { sent: false, previewUrl: url };
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Verify your MediQ email address',
    text: `Hello ${fullName},\n\nVerify your MediQ email address using this link:\n${url}\n\nThe link expires in 24 hours and can only be used once.`,
    html: `<p>Hello ${fullName},</p><p>Verify your MediQ email address by selecting the link below:</p><p><a href="${url}">Verify email address</a></p><p>This link expires in 24 hours and can only be used once.</p>`,
  });
  return { sent: true, previewUrl: null };
}

async function sendStaffWelcomeEmail({ email, fullName, staffCode, temporaryPassword, token }) {
  const url = verificationUrl(token);
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) return { sent: false, previewUrl: url };
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Your MediQ Staff account has been created',
    text: `Hello ${fullName},\n\nThe clinic administrator has created your MediQ Staff account.\n\nStaff ID: ${staffCode}\nLogin email: ${email}\nTemporary password: ${temporaryPassword}\n\nVerify your email here:\n${url}\n\nAfter your first sign-in, change the temporary password to a password of your choice. Keep these details private.`,
    html: `<p>Hello ${fullName},</p><p>The clinic administrator has created your MediQ Staff account.</p><p><strong>Staff ID:</strong> ${staffCode}<br><strong>Login email:</strong> ${email}<br><strong>Temporary password:</strong> ${temporaryPassword}</p><p><a href="${url}">Verify your email address</a></p><p>After your first sign-in, change the temporary password to a password of your choice. Keep these details private.</p>`,
  });
  return { sent: true, previewUrl: null };
}

module.exports = { createVerificationToken, sendVerificationEmail, sendStaffWelcomeEmail, hashToken };

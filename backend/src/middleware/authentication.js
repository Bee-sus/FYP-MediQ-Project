const crypto = require('crypto');
const { pool } = require('../config/database');

function readCookie(request, name) {
  const cookies = String(request.headers.cookie || '').split(';');
  const item = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function authenticate(request, response, next) {
  const token = readCookie(request, 'mediq_session');
  if (!token) return response.status(401).json({ error: 'Sign in is required.' });
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.full_name AS fullName, u.email, u.role, u.must_change_password AS mustChangePassword
       FROM user_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.is_active = TRUE LIMIT 1`,
      [tokenHash(token)],
    );
    if (!rows.length) return response.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    request.user = rows[0];
    request.sessionTokenHash = tokenHash(token);
    return next();
  } catch (error) {
    return response.status(503).json({ error: 'Account services are temporarily unavailable.' });
  }
}

function requireRole(...roles) {
  return [authenticate, (request, response, next) => {
    if (!roles.includes(request.user.role)) return response.status(403).json({ error: 'You do not have access to this area.' });
    if (request.user.role === 'staff' && request.user.mustChangePassword && !['/profile', '/password'].includes(request.path)) {
      return response.status(428).json({ error: 'Change your temporary password before using Staff features.', passwordChangeRequired: true });
    }
    return next();
  }];
}

module.exports = { authenticate, requireRole, tokenHash };

const express = require('express');
const { pool } = require('../config/database');
const { requireRole } = require('../middleware/authentication');
const { hashPassword, meetsPasswordRules } = require('../services/passwordService');
const { lockBookings, activeStatuses } = require('../services/appointmentService');
const { validateHours, readHours, slotsForDate } = require('../services/clinicScheduleService');

const router = express.Router();
router.use(...requireRole('admin'));
const validId = id => Number.isSafeInteger(id) && id > 0;
const problem = (status, message) => Object.assign(new Error(message), { status });

async function audit(connection, adminId, action, type, id, details) {
  await connection.execute(`INSERT INTO admin_audit_logs (admin_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`,
    [adminId, action, type, id, details]);
}

async function transaction(response, work) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return response.status(result.status || 200).json(result.body);
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ error: 'That email address or service name already exists.' });
    return response.status(error.status || 503).json({ error: error.status ? error.message : 'The change could not be saved. Please try again.' });
  } finally {
    if (connection) connection.release();
  }
}

router.get('/overview', async (request, response) => {
  try {
    const [users] = await pool.execute("SELECT SUM(role = 'patient') AS patients, SUM(role = 'staff' AND is_active = TRUE) AS activeStaff FROM users");
    const [services] = await pool.execute('SELECT COUNT(*) AS activeServices FROM clinic_services WHERE is_active = TRUE');
    const [appointments] = await pool.execute("SELECT COUNT(*) AS pendingAppointments FROM appointments WHERE status = 'pending'");
    return response.json({ user: request.user, summary: { patients: Number(users[0].patients || 0), activeStaff: Number(users[0].activeStaff || 0), activeServices: Number(services[0].activeServices), pendingAppointments: Number(appointments[0].pendingAppointments) } });
  } catch (error) { return response.status(503).json({ error: 'Administrator overview is unavailable.' }); }
});

router.get('/staff', async (request, response) => {
  try {
    const [staff] = await pool.execute("SELECT id, full_name AS fullName, email, is_active AS isActive, created_at AS createdAt FROM users WHERE role = 'staff' ORDER BY full_name, id");
    return response.json({ staff });
  } catch (error) { return response.status(503).json({ error: 'Staff accounts are unavailable.' }); }
});

router.post('/staff', async (request, response) => {
  const fullName = String(request.body.fullName || '').trim();
  const email = String(request.body.email || '').trim().toLowerCase();
  const password = request.body.password;
  if (fullName.length < 2 || fullName.length > 120 || !/^[\p{L}][\p{L} .'-]+$/u.test(fullName)
      || email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !meetsPasswordRules(password)) {
    return response.status(422).json({ error: 'Enter a valid staff name, email and a 12–128 character password with uppercase, lowercase, a number and a symbol.' });
  }
  return transaction(response, async connection => {
    const passwordHash = await hashPassword(password);
    const [result] = await connection.execute("INSERT INTO users (full_name, email, password_hash, role, is_active) VALUES (?, ?, ?, 'staff', TRUE)", [fullName, email, passwordHash]);
    await audit(connection, request.user.id, 'staff_created', 'staff', result.insertId, `Created staff account for ${fullName}.`);
    return { status: 201, body: { message: 'Staff account created. The staff member can now sign in.', staffId: result.insertId } };
  });
});

router.patch('/staff/:staffId', async (request, response) => {
  const id = Number(request.params.staffId);
  if (!validId(id) || typeof request.body.isActive !== 'boolean') return response.status(422).json({ error: 'Provide a valid staff account and active state.' });
  return transaction(response, async connection => {
    const [rows] = await connection.execute("SELECT id FROM users WHERE id = ? AND role = 'staff' FOR UPDATE", [id]);
    if (!rows.length) throw problem(404, 'Staff account not found.');
    await connection.execute("UPDATE users SET is_active = ? WHERE id = ? AND role = 'staff'", [request.body.isActive, id]);
    if (!request.body.isActive) await connection.execute('DELETE FROM user_sessions WHERE user_id = ?', [id]);
    await audit(connection, request.user.id, request.body.isActive ? 'staff_activated' : 'staff_deactivated', 'staff', id, request.body.isActive ? 'Staff access enabled.' : 'Staff access disabled and sessions revoked.');
    return { body: { message: request.body.isActive ? 'Staff account activated.' : 'Staff account deactivated and signed out.' } };
  });
});

router.get('/services', async (request, response) => {
  try {
    const [services] = await pool.execute('SELECT id, name, description, average_duration_minutes AS averageDurationMinutes, is_active AS isActive, is_queue_open AS isQueueOpen FROM clinic_services ORDER BY name');
    return response.json({ services });
  } catch (error) { return response.status(503).json({ error: 'Clinic services are unavailable.' }); }
});

async function saveService(request, response) {
  const id = request.params.serviceId == null ? null : Number(request.params.serviceId);
  const name = String(request.body.name || '').trim();
  const description = String(request.body.description || '').trim();
  const duration = Number(request.body.averageDurationMinutes);
  const isActive = request.body.isActive;
  if ((id !== null && !validId(id)) || name.length < 2 || name.length > 120 || description.length > 1000 || !Number.isInteger(duration) || duration < 1 || duration > 240 || typeof isActive !== 'boolean') {
    return response.status(422).json({ error: 'Provide a service name (2–120 characters), description (up to 1000 characters), duration (1–240 minutes) and active state.' });
  }
  return transaction(response, async connection => {
    await lockBookings(connection);
    let serviceId = id;
    if (id !== null) {
      const [rows] = await connection.execute('SELECT id FROM clinic_services WHERE id = ? FOR UPDATE', [id]);
      if (!rows.length) throw problem(404, 'Clinic service not found.');
      if (!isActive) {
        const [queues] = await connection.execute("SELECT id FROM queue_entries WHERE service_id = ? AND queue_date = CURRENT_DATE AND status IN ('waiting','called','in_progress') LIMIT 1", [id]);
        const [bookings] = await connection.execute(`SELECT id FROM appointments WHERE service_id = ? AND appointment_date >= DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')) AND status IN (${activeStatuses}) LIMIT 1`, [id]);
        if (queues.length || bookings.length) throw problem(409, 'Resolve this service’s active queues and upcoming appointments before deactivating it.');
      }
      await connection.execute('UPDATE clinic_services SET name = ?, description = ?, average_duration_minutes = ?, is_active = ?, is_queue_open = IF(?, is_queue_open, FALSE) WHERE id = ?', [name, description, duration, isActive, isActive, id]);
    } else {
      const [result] = await connection.execute('INSERT INTO clinic_services (name, description, average_duration_minutes, is_active, is_queue_open) VALUES (?, ?, ?, ?, ?)', [name, description, duration, isActive, isActive]);
      serviceId = result.insertId;
    }
    await audit(connection, request.user.id, id === null ? 'service_created' : 'service_updated', 'clinic_service', serviceId, `${name}; ${duration} minutes; ${isActive ? 'active' : 'inactive'}.`);
    return { status: id === null ? 201 : 200, body: { message: 'Clinic service saved.', serviceId } };
  });
}
router.post('/services', saveService);
router.put('/services/:serviceId', saveService);

router.get('/hours', async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [state] = await connection.execute('SELECT revision FROM clinic_schedule_state WHERE id = 1');
    const days = await readHours(connection);
    await connection.commit();
    return response.json({ days, revision: state[0].revision });
  } catch (error) {
    if (connection) await connection.rollback();
    return response.status(503).json({ error: 'Clinic hours are unavailable. Apply the administrator database migration.' });
  } finally { if (connection) connection.release(); }
});

router.put('/hours', async (request, response) => {
  const { days, revision } = request.body;
  const error = validateHours(days);
  if (error || !Number.isSafeInteger(revision) || revision < 0) return response.status(422).json({ error: error || 'Provide the current schedule revision.' });
  return transaction(response, async connection => {
    await lockBookings(connection);
    const [states] = await connection.execute('SELECT revision FROM clinic_schedule_state WHERE id = 1 FOR UPDATE');
    if (Number(states[0].revision) !== revision) throw problem(409, 'Another administrator changed the hours. Reload the schedule before saving.');
    const [bookings] = await connection.execute(`SELECT DATE_FORMAT(appointment_date, '%Y-%m-%d') AS appointmentDate, TIME_FORMAT(appointment_time, '%H:%i') AS appointmentTime
      FROM appointments WHERE appointment_date >= DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')) AND status IN (${activeStatuses})`);
    const affected = bookings.filter(entry => !slotsForDate(days, entry.appointmentDate).includes(entry.appointmentTime));
    if (affected.length) throw problem(409, `These hours would invalidate ${affected.length} existing appointment(s). Resolve those bookings before changing the schedule.`);
    for (const day of days) {
      await connection.execute('UPDATE clinic_hours SET is_open = ?, opens_at = ?, closes_at = ?, break_start = ?, break_end = ? WHERE day_of_week = ?',
        [day.isOpen, day.opensAt, day.closesAt, day.breakStart ?? null, day.breakEnd ?? null, day.dayOfWeek]);
    }
    await connection.execute('UPDATE clinic_schedule_state SET revision = revision + 1 WHERE id = 1');
    await audit(connection, request.user.id, 'clinic_hours_updated', 'clinic_hours', 1, `Weekly hours updated to revision ${revision + 1}; appointment slots remain 30 minutes.`);
    return { body: { message: 'Weekly clinic hours saved. Available appointment times now follow this schedule.', revision: revision + 1 } };
  });
});

router.get('/audit', async (request, response) => {
  const page = Number(request.query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return response.status(422).json({ error: 'Invalid audit page.' });
  try {
    const [items] = await pool.execute(`SELECT * FROM (
      SELECT a.id, 'Administrator' AS actorRole, u.full_name AS actorName, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.details, a.created_at AS createdAt
      FROM admin_audit_logs a JOIN users u ON u.id = a.admin_id
      UNION ALL
      SELECT s.id, 'Staff' AS actorRole, u.full_name AS actorName, s.action, s.entity_type AS entityType, s.entity_id AS entityId, s.details, s.created_at AS createdAt
      FROM staff_audit_logs s JOIN users u ON u.id = s.staff_id
    ) activity ORDER BY createdAt DESC, actorRole, id DESC LIMIT 26 OFFSET ${(page - 1) * 25}`);
    return response.json({ items: items.slice(0, 25), page, hasMore: items.length > 25 });
  } catch (error) { return response.status(503).json({ error: 'Activity records are unavailable.' }); }
});

module.exports = router;

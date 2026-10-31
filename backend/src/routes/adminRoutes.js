const express = require('express');
const { pool } = require('../config/database');
const { requireRole } = require('../middleware/authentication');
const { hashPassword, generateTemporaryPassword } = require('../services/passwordService');
const { validProfilePicture } = require('../services/profilePictureService');
const { createVerificationToken, sendStaffWelcomeEmail } = require('../services/emailVerificationService');
const { lockBookings, activeStatuses } = require('../services/appointmentService');
const { validateHours, readHours, slotsForDate } = require('../services/clinicScheduleService');
const { clinicDate } = require('../config/clinicTime');

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
    const [users] = await pool.execute("SELECT SUM(role = 'patient' AND deleted_at IS NULL) AS patients, SUM(role = 'staff' AND is_active = TRUE) AS activeStaff FROM users");
    const [services] = await pool.execute('SELECT COUNT(*) AS activeServices FROM clinic_services WHERE is_active = TRUE');
    const [appointments] = await pool.execute("SELECT COUNT(*) AS pendingAppointments FROM appointments WHERE status = 'pending'");
    return response.json({ user: request.user, summary: { patients: Number(users[0].patients || 0), activeStaff: Number(users[0].activeStaff || 0), activeServices: Number(services[0].activeServices), pendingAppointments: Number(appointments[0].pendingAppointments) } });
  } catch (error) { return response.status(503).json({ error: 'Administrator overview is unavailable.' }); }
});

router.get('/staff', async (request, response) => {
  try {
    const [staff] = await pool.execute(`SELECT u.id, u.staff_code AS staffCode, u.full_name AS fullName, u.email,
      u.phone_number AS phone, u.profile_picture_url AS profilePictureUrl, u.is_active AS isActive, u.created_at AS createdAt,
      EXISTS(SELECT 1 FROM staff_audit_logs a WHERE a.staff_id = u.id) AS hasActivityHistory
      FROM users u WHERE u.role = 'staff' ORDER BY u.full_name, u.id`);
    return response.json({ staff });
  } catch (error) { return response.status(503).json({ error: 'Staff accounts are unavailable.' }); }
});

router.post('/staff', async (request, response) => {
  const fullName = String(request.body.fullName || '').trim();
  const email = String(request.body.email || '').trim().toLowerCase();
  const password = generateTemporaryPassword();
  const phone = String(request.body.phone || '').trim();
  const profilePictureUrl = String(request.body.profilePictureUrl || '').trim();
  if (fullName.length < 2 || fullName.length > 120 || !/^[\p{L}][\p{L} .'-]+$/u.test(fullName)
      || phone.length < 7 || phone.length > 30
      || !validProfilePicture(profilePictureUrl)
      || email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response.status(422).json({ error: 'Enter a valid name, email, contact number and optional profile picture.' });
  }
  return transaction(response, async connection => {
    const passwordHash = await hashPassword(password);
    const [result] = await connection.execute("INSERT INTO users (staff_code, full_name, email, phone_number, profile_picture_url, password_hash, role, is_active, must_change_password) VALUES (NULL, ?, ?, ?, ?, ?, 'staff', TRUE, TRUE)", [fullName, email, phone, profilePictureUrl || null, passwordHash]);
    const staffCode = `STF-${String(result.insertId).padStart(6, '0')}`;
    await connection.execute("UPDATE users SET staff_code = ? WHERE id = ? AND role = 'staff'", [staffCode, result.insertId]);
    const verificationToken = await createVerificationToken(connection, result.insertId);
    let delivery;
    try { delivery = await sendStaffWelcomeEmail({ email, fullName, staffCode, temporaryPassword: password, token: verificationToken }); }
    catch (error) {
      console.error('Staff welcome email failed:', error.code || error.message);
      delivery = { sent: false, previewUrl: null, failed: true };
    }
    await audit(connection, request.user.id, 'staff_created', 'staff', result.insertId, `Created staff account for ${fullName}.`);
    const message = delivery.sent
      ? 'Staff account created and onboarding email sent.'
      : delivery.failed
        ? 'Staff account created, but the onboarding email failed to send. Check the SMTP settings and server log.'
        : delivery.previewUrl
          ? 'Staff account created. Open the local verification link to finish setup.'
          : 'Staff account created, but the onboarding email could not be sent.';
    return { status: 201, body: { message, staffId: result.insertId, credentials: { staffCode, fullName, email, temporaryPassword: password, emailSent: Boolean(delivery.sent), emailFailed: Boolean(delivery.failed), verificationPreviewUrl: process.env.NODE_ENV === 'production' ? null : delivery.previewUrl } } };
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

router.delete('/staff/:staffId', async (request, response) => {
  const id = Number(request.params.staffId);
  if (!validId(id)) return response.status(422).json({ error: 'Provide a valid staff account.' });
  return transaction(response, async connection => {
    const [rows] = await connection.execute("SELECT id, full_name AS fullName, staff_code AS staffCode FROM users WHERE id = ? AND role = 'staff' FOR UPDATE", [id]);
    if (!rows.length) throw problem(404, 'Staff account not found.');
    const staff = rows[0];
    const [history] = await connection.execute('SELECT id FROM staff_audit_logs WHERE staff_id = ? LIMIT 1 FOR UPDATE', [id]);
    if (history.length) throw problem(409, 'This staff account has activity history. Deactivate it to preserve clinic records.');
    await connection.execute('DELETE FROM user_sessions WHERE user_id = ?', [id]);
    await connection.execute('DELETE FROM email_verification_tokens WHERE user_id = ?', [id]);
    await audit(connection, request.user.id, 'staff_deleted', 'staff', id, `Permanently deleted Staff account ${staff.staffCode || id} (${staff.fullName}).`);
    await connection.execute("DELETE FROM users WHERE id = ? AND role = 'staff'", [id]);
    return { body: { message: `Staff account for ${staff.fullName} was permanently deleted.` } };
  });
});

router.get('/services', async (request, response) => {
  try {
    const [services] = await pool.execute('SELECT id, name, description, doctor_name AS doctorName, service_details AS serviceDetails, average_duration_minutes AS averageDurationMinutes, queue_capacity AS queueCapacity, is_active AS isActive, is_queue_open AS isQueueOpen FROM clinic_services ORDER BY name');
    return response.json({ services });
  } catch (error) { return response.status(503).json({ error: 'Clinic services are unavailable.' }); }
});

router.get('/patients', async (request, response) => {
  const query = String(request.query.query || '').trim().slice(0, 80);
  const status = String(request.query.status || '');
  const verification = String(request.query.verification || '');
  const sort = String(request.query.sort || 'name_asc');
  const requestedPage = Number(request.query.page || 1);
  const orders = { name_asc: 'full_name ASC, id ASC', name_desc: 'full_name DESC, id DESC', newest: 'created_at DESC, id DESC', oldest: 'created_at ASC, id ASC' };
  if (!['', 'active', 'inactive'].includes(status) || !['', 'verified', 'pending'].includes(verification)
      || !Object.hasOwn(orders, sort) || !Number.isSafeInteger(requestedPage) || requestedPage < 1) {
    return response.status(422).json({ error: 'Choose valid patient filters and a page number.' });
  }
  const conditions = ["role = 'patient'", 'deleted_at IS NULL'];
  const values = [];
  if (query) {
    const search = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push('(full_name LIKE ? OR email LIKE ? OR phone_number LIKE ?)');
    values.push(search, search, search);
  }
  if (status) conditions.push(status === 'active' ? 'is_active = TRUE' : 'is_active = FALSE');
  if (verification) conditions.push(verification === 'verified' ? 'email_verified_at IS NOT NULL' : 'email_verified_at IS NULL');
  const where = conditions.join(' AND ');
  try {
    const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM users WHERE ${where}`, values);
    const total = Number(count.total);
    const pages = Math.max(1, Math.ceil(total / 20));
    const page = Math.min(requestedPage, pages);
    const [patients] = await pool.execute(`SELECT id, full_name AS fullName, email, phone_number AS phone, is_active AS isActive, email_verified_at AS verifiedAt, created_at AS createdAt
      FROM users WHERE ${where} ORDER BY ${orders[sort]} LIMIT 20 OFFSET ${(page - 1) * 20}`, values);
    return response.json({ patients, total, pages, page, pageSize: 20, hasMore: page < pages });
  } catch (error) { return response.status(503).json({ error: 'Patient records are unavailable.' }); }
});

router.get('/patients/:patientId', async (request, response) => {
  const id = Number(request.params.patientId); if (!validId(id)) return response.status(422).json({ error: 'Invalid patient.' });
  try {
    const [patients] = await pool.execute("SELECT id, full_name AS fullName, email, phone_number AS phone, is_active AS isActive, birth_date AS birthDate, gender, created_at AS createdAt FROM users WHERE id = ? AND role = 'patient' AND deleted_at IS NULL", [id]);
    if (!patients.length) return response.status(404).json({ error: 'Patient not found.' });
    const [queues] = await pool.execute('SELECT q.queue_date AS queueDate, q.status, s.name AS serviceName FROM queue_entries q JOIN clinic_services s ON s.id = q.service_id WHERE q.patient_id = ? ORDER BY q.joined_at DESC LIMIT 20', [id]);
    const [appointments] = await pool.execute('SELECT a.appointment_date AS appointmentDate, a.appointment_time AS appointmentTime, a.status, s.name AS serviceName FROM appointments a JOIN clinic_services s ON s.id = a.service_id WHERE a.patient_id = ? ORDER BY a.appointment_date DESC LIMIT 20', [id]);
    return response.json({ patient: patients[0], queues, appointments });
  } catch (error) { return response.status(503).json({ error: 'Patient history is unavailable.' }); }
});

router.patch('/patients/:patientId',async(request,response)=>{
 const id=Number(request.params.patientId),{isActive,fullName,phone}=request.body;
 if(!validId(id))return response.status(422).json({error:'Choose a valid patient account.'});
 const accessChange=typeof isActive==='boolean';
 const name=String(fullName||'').trim(),contact=String(phone||'').trim();
 if(!accessChange&&(name.length<2||name.length>120||!/^[\p{L}][\p{L} .'-]+$/u.test(name)||!/^[+0-9 ()-]+$/.test(contact)||contact.replace(/\D/g,'').length<8||contact.replace(/\D/g,'').length>15||contact.length>30))return response.status(422).json({error:'Enter a valid patient name and contact number.'});
 return transaction(response,async connection=>{
  const [rows]=await connection.execute("SELECT id FROM users WHERE id=? AND role='patient' AND deleted_at IS NULL FOR UPDATE",[id]);
  if(!rows.length)throw problem(404,'Patient account not found.');
  if(accessChange){await connection.execute("UPDATE users SET is_active=? WHERE id=? AND role='patient'",[isActive,id]);if(!isActive)await connection.execute('DELETE FROM user_sessions WHERE user_id=?',[id]);}
  else await connection.execute("UPDATE users SET full_name=?,phone_number=? WHERE id=? AND role='patient'",[name,contact,id]);
  await audit(connection,request.user.id,accessChange?(isActive?'patient_activated':'patient_deactivated'):'patient_updated','patient',id,accessChange?(isActive?'Patient access restored.':'Patient access disabled and sessions revoked.'):'Patient name and contact details updated.');
  return {body:{message:accessChange?(isActive?'Patient account reactivated.':'Patient account deactivated and signed out.'):'Patient details saved.'}};
 });
});

router.delete('/patients/:patientId',async(request,response)=>{
 const id=Number(request.params.patientId);if(!validId(id))return response.status(422).json({error:'Choose a valid patient account.'});
 return transaction(response,async connection=>{
  await lockBookings(connection);
  const [rows]=await connection.execute("SELECT id FROM users WHERE id=? AND role='patient' AND deleted_at IS NULL FOR UPDATE",[id]);
  if(!rows.length)throw problem(404,'Patient account not found.');
  const [queues]=await connection.execute("SELECT id FROM queue_entries WHERE patient_id=? AND status IN ('waiting','called','in_progress','not_present') LIMIT 1",[id]);
  const [appointments]=await connection.execute("SELECT id FROM appointments WHERE patient_id=? AND status IN ('pending','approved','reschedule_proposed') LIMIT 1",[id]);
  if(queues.length||appointments.length)throw problem(409,'Finish or cancel this patient’s active queue entries and appointments before deleting the account.');
  await connection.execute('DELETE FROM user_sessions WHERE user_id=?',[id]);
  await connection.execute('DELETE FROM email_verification_tokens WHERE user_id=?',[id]);
  await connection.execute('DELETE FROM patient_email_codes WHERE user_id=?',[id]);
  await connection.execute('DELETE FROM password_reset_codes WHERE user_id=?',[id]);
  await connection.execute('DELETE FROM notifications WHERE patient_id=?',[id]);
  const crypto=require('crypto');
  await connection.execute(`UPDATE users SET full_name='Deleted patient',email=?,password_hash=?,phone_number=NULL,birth_date=NULL,gender=NULL,identification_type=NULL,identification_number=NULL,profile_picture_url=NULL,email_verified_at=NULL,is_active=FALSE,deleted_at=CURRENT_TIMESTAMP WHERE id=? AND role='patient'`,[`deleted-${id}-${crypto.randomBytes(12).toString('hex')}@example.invalid`,crypto.randomBytes(64).toString('hex'),id]);
  await audit(connection,request.user.id,'patient_deleted','patient',id,'Patient account details removed and access revoked. Anonymised visit links retained.');
  return {body:{message:'Patient account deleted. Linked clinic visit history has been retained anonymously.'}};
 });
});

router.get('/settings', async (request, response) => {
  try { const [rows] = await pool.execute('SELECT clinic_name AS clinicName, address, phone, timezone FROM clinic_settings WHERE id = 1'); return response.json({ settings: rows[0] }); }
  catch (error) { return response.status(503).json({ error: 'Clinic settings are unavailable.' }); }
});
router.put('/settings', async (request, response) => {
  const clinicName = String(request.body.clinicName || '').trim(), address = String(request.body.address || '').trim(), phone = String(request.body.phone || '').trim();
  if (clinicName.length < 2 || clinicName.length > 120 || address.length > 300 || phone.length > 30) return response.status(422).json({ error: 'Provide valid clinic details.' });
  try { await pool.execute('UPDATE clinic_settings SET clinic_name = ?, address = ?, phone = ? WHERE id = 1', [clinicName, address || null, phone || null]); return response.json({ message: 'Clinic settings saved.' }); }
  catch (error) { return response.status(503).json({ error: 'Clinic settings could not be saved.' }); }
});

async function saveService(request, response) {
  const id = request.params.serviceId == null ? null : Number(request.params.serviceId);
  const name = String(request.body.name || '').trim();
  const description = String(request.body.description || '').trim();
  const doctorName = String(request.body.doctorName || '').trim();
  const serviceDetails = String(request.body.serviceDetails || '').trim();
  const duration = Number(request.body.averageDurationMinutes);
  const capacity = request.body.queueCapacity === '' || request.body.queueCapacity == null ? null : Number(request.body.queueCapacity);
  const isActive = request.body.isActive;
  if ((id !== null && !validId(id)) || name.length < 2 || name.length > 120 || description.length > 1000 || doctorName.length > 120 || serviceDetails.length > 500 || !Number.isInteger(duration) || duration < 1 || duration > 240 || (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 500)) || typeof isActive !== 'boolean') {
    return response.status(422).json({ error: 'Provide valid service information, doctor name, duration and active state.' });
  }
  return transaction(response, async connection => {
    await lockBookings(connection);
    let serviceId = id;
    if (id !== null) {
      const [rows] = await connection.execute('SELECT id FROM clinic_services WHERE id = ? FOR UPDATE', [id]);
      if (!rows.length) throw problem(404, 'Clinic service not found.');
      if (!isActive) {
        const [queues] = await connection.execute("SELECT id FROM queue_entries WHERE service_id = ? AND queue_date = CURRENT_DATE AND status IN ('waiting','called','in_progress','not_present') LIMIT 1", [id]);
        const [bookings] = await connection.execute(`SELECT id FROM appointments WHERE service_id = ? AND appointment_date >= DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')) AND status IN (${activeStatuses}) LIMIT 1`, [id]);
        if (queues.length || bookings.length) throw problem(409, 'Resolve this service’s active queues and upcoming appointments before deactivating it.');
      }
      await connection.execute('UPDATE clinic_services SET name = ?, description = ?, doctor_name = ?, service_details = ?, average_duration_minutes = ?, queue_capacity = ?, is_active = ?, is_queue_open = IF(?, is_queue_open, FALSE) WHERE id = ?', [name, description, doctorName || null, serviceDetails || null, duration, capacity, isActive, isActive, id]);
    } else {
      const [result] = await connection.execute('INSERT INTO clinic_services (name, description, doctor_name, service_details, average_duration_minutes, queue_capacity, is_active, is_queue_open) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [name, description, doctorName || null, serviceDetails || null, duration, capacity, isActive, isActive]);
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

router.get('/closures', async (request, response) => {
  try {
    const [closures] = await pool.execute(`SELECT DATE_FORMAT(closure_date, '%Y-%m-%d') AS closureDate, reason, created_at AS createdAt
      FROM clinic_closures WHERE closure_date >= CURRENT_DATE ORDER BY closure_date`);
    return response.json({ closures });
  } catch (error) { return response.status(503).json({ error: 'Clinic closure dates are unavailable. Apply the administrator database migration.' }); }
});

router.post('/closures', async (request, response) => {
  const closureDate = String(request.body.closureDate || '');
  const reason = String(request.body.reason || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(closureDate) || closureDate < clinicDate()) return response.status(422).json({ error: 'Choose today or a future closure date.' });
  if (reason.length < 3 || reason.length > 200) return response.status(422).json({ error: 'Provide a closure reason between 3 and 200 characters.' });
  return transaction(response, async connection => {
    await lockBookings(connection);
    const [appointments] = await connection.execute(`SELECT id FROM appointments WHERE appointment_date = ? AND status IN (${activeStatuses}) LIMIT 1`, [closureDate]);
    if (appointments.length) throw problem(409, 'This date has an active appointment. Resolve it before closing the clinic.');
    await connection.execute('INSERT INTO clinic_closures (closure_date, reason, created_by) VALUES (?, ?, ?)', [closureDate, reason, request.user.id]);
    await audit(connection, request.user.id, 'clinic_closure_added', 'clinic_closure', 1, `${closureDate}: ${reason}`);
    return { status: 201, body: { message: 'Clinic closure added.' } };
  });
});

router.delete('/closures/:date', async (request, response) => {
  const closureDate = String(request.params.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(closureDate)) return response.status(422).json({ error: 'Invalid closure date.' });
  return transaction(response, async connection => {
    const [result] = await connection.execute('DELETE FROM clinic_closures WHERE closure_date = ?', [closureDate]);
    if (!result.affectedRows) throw problem(404, 'Closure date not found.');
    await audit(connection, request.user.id, 'clinic_closure_removed', 'clinic_closure', 1, closureDate);
    return { body: { message: 'Clinic closure removed. Appointments can use the weekly schedule again.' } };
  });
});

router.get('/audit', async (request, response) => {
  const page = Number(request.query.page || 1);
  const role = ['Administrator', 'Staff'].includes(request.query.role) ? request.query.role : '';
  const query = String(request.query.query || '').trim().slice(0, 80);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return response.status(422).json({ error: 'Invalid audit page.' });
  try {
    const [items] = await pool.execute(`SELECT * FROM (
      SELECT a.id, 'Administrator' AS actorRole, u.full_name AS actorName, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.details, a.created_at AS createdAt
      FROM admin_audit_logs a JOIN users u ON u.id = a.admin_id
      UNION ALL
      SELECT s.id, 'Staff' AS actorRole, u.full_name AS actorName, s.action, s.entity_type AS entityType, s.entity_id AS entityId, s.details, s.created_at AS createdAt
      FROM staff_audit_logs s JOIN users u ON u.id = s.staff_id
    ) activity WHERE (? = '' OR actorRole = ?) AND (? = '' OR actorName LIKE ? OR action LIKE ? OR details LIKE ?)
      ORDER BY createdAt DESC, actorRole, id DESC LIMIT 26 OFFSET ${(page - 1) * 25}`,
    [role, role, query, `%${query}%`, `%${query}%`, `%${query}%`]);
    return response.json({ items: items.slice(0, 25), page, hasMore: items.length > 25 });
  } catch (error) { return response.status(503).json({ error: 'Activity records are unavailable.' }); }
});

module.exports = router;

const express = require('express');
const { pool } = require('../config/database');
const { requireRole } = require('../middleware/authentication');
const { activeStatuses, validDate, futureSlot, lockBookings, hasConflict } = require('../services/appointmentService');

const { availableSlotsForDate, slotIsOpen } = require('../services/clinicScheduleService');

const staff = express.Router();
const patient = express.Router();
const statuses = new Set(['pending', 'approved', 'reschedule_proposed', 'rejected', 'cancelled', 'completed']);

async function availability(request, response) {
  const date = String(request.query.date || '');
  if (!validDate(date)) return response.status(422).json({ error: 'Select a valid date.' });
  try {
    const availability = await availableSlotsForDate(pool, date);
    const [booked] = await pool.execute(
      `SELECT TIME_FORMAT(appointment_time, '%H:%i') AS time FROM appointments
       WHERE appointment_date = ? AND status IN (${activeStatuses})`, [date],
    );
    const reserved = new Set(booked.map((item) => item.time));
    return response.json({ date, closureReason: availability.closureReason, slots: availability.slots.filter((time) => futureSlot(date, time) && !reserved.has(time)) });
  } catch (error) {
    return response.status(503).json({ error: 'Appointment availability is temporarily unavailable.' });
  }
}

patient.get('/appointments/availability', ...requireRole('patient'), availability);
staff.get('/appointments/availability', ...requireRole('staff'), availability);

staff.get('/appointments', ...requireRole('staff'), async (request, response) => {
  const status = String(request.query.status || '');
  const search = String(request.query.search || '').trim().slice(0, 80);
  const from = String(request.query.from || ''); const to = String(request.query.to || '');
  const page = Math.max(1, Number.parseInt(request.query.page, 10) || 1); const limit = 20; const offset = (page - 1) * limit;
  if (status && !statuses.has(status)) return response.status(422).json({ error: 'Select a valid appointment status.' });
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to)) return response.status(422).json({ error: 'Choose a valid appointment date range.' });
  try {
    const clauses = [], parameters = [];
    if (status) { clauses.push('a.status = ?'); parameters.push(status); }
    if (search) { clauses.push('(u.full_name LIKE ? OR s.name LIKE ?)'); parameters.push(`%${search}%`, `%${search}%`); }
    if (from) { clauses.push('a.appointment_date >= ?'); parameters.push(from); }
    if (to) { clauses.push('a.appointment_date <= ?'); parameters.push(to); }
    const [appointments] = await pool.execute(
      `SELECT a.id, a.patient_id AS patientId, a.status, a.notes, a.rejection_reason AS rejectionReason,
              DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointmentDate,
              TIME_FORMAT(a.appointment_time, '%H:%i') AS appointmentTime,
              s.name AS serviceName, u.full_name AS patientName
       FROM appointments a JOIN users u ON u.id = a.patient_id JOIN clinic_services s ON s.id = a.service_id
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY a.appointment_date DESC, a.appointment_time DESC, a.id DESC LIMIT ${limit + 1} OFFSET ${offset}`,
      parameters,
    );
    return response.json({ appointments: appointments.slice(0, limit), page, hasMore: appointments.length > limit });
  } catch (error) {
    return response.status(503).json({ error: 'Appointment requests are temporarily unavailable.' });
  }
});

staff.patch('/appointments/:appointmentId', ...requireRole('staff'), async (request, response) => {
  const id = Number(request.params.appointmentId);
  const action = String(request.body.action || '');
  const reason = String(request.body.reason || '').trim();
  const date = String(request.body.appointmentDate || '');
  const time = String(request.body.appointmentTime || '');
  if (!Number.isSafeInteger(id) || id < 1 || !['approve', 'reject', 'reschedule', 'complete'].includes(action)) {
    return response.status(422).json({ error: 'Provide a valid appointment and action.' });
  }
  if (['reject', 'reschedule'].includes(action) && (reason.length < 3 || reason.length > 300)) {
    return response.status(422).json({ error: 'Provide a reason between 3 and 300 characters.' });
  }
  if (action === 'reschedule' && !futureSlot(date, time)) {
    return response.status(422).json({ error: 'Select a future date and an available clinic time slot.' });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await lockBookings(connection);
    const [rows] = await connection.execute(
      `SELECT id, patient_id AS patientId, status,
              DATE_FORMAT(appointment_date, '%Y-%m-%d') AS appointmentDate,
              TIME_FORMAT(appointment_time, '%H:%i') AS appointmentTime
       FROM appointments WHERE id = ? FOR UPDATE`, [id],
    );
    if (!rows.length) {
      await connection.rollback();
      return response.status(404).json({ error: 'Appointment not found.' });
    }
    const entry = rows[0];
    const allowed = { approve: ['pending'], reject: ['pending', 'approved', 'reschedule_proposed'], reschedule: ['pending', 'approved', 'reschedule_proposed'], complete: ['approved'] };
    if (!allowed[action].includes(entry.status)) {
      await connection.rollback();
      return response.status(409).json({ error: 'This appointment has changed or does not allow that action. Refresh the list.' });
    }
    if (action === 'approve' && !futureSlot(entry.appointmentDate, entry.appointmentTime)) {
      await connection.rollback();
      return response.status(409).json({ error: 'This appointment time has passed. Propose a future slot instead.' });
    }
    if (action === 'complete' && futureSlot(entry.appointmentDate, entry.appointmentTime)) {
      await connection.rollback();
      return response.status(409).json({ error: 'An appointment cannot be completed before its scheduled time.' });
    }
    const nextDate = action === 'reschedule' ? date : entry.appointmentDate;
    const nextTime = action === 'reschedule' ? time : entry.appointmentTime;
    if (action === 'reschedule' && date === entry.appointmentDate && time === entry.appointmentTime) {
      await connection.rollback();
      return response.status(422).json({ error: 'Choose a different date or time.' });
    }
    if (['approve', 'reschedule'].includes(action) && !(await slotIsOpen(connection, nextDate, nextTime))) {
      await connection.rollback();
      return response.status(409).json({ error: 'The clinic is closed at that time. Select another slot.' });
    }
    if (['approve', 'reschedule'].includes(action) && await hasConflict(connection, entry.patientId, nextDate, nextTime, id)) {
      await connection.rollback();
      return response.status(409).json({ error: 'That slot is reserved, or the patient already has an appointment on that date.' });
    }
    const status = { approve: 'approved', reject: 'rejected', reschedule: 'reschedule_proposed', complete: 'completed' }[action];
    await connection.execute(
      'UPDATE appointments SET status = ?, appointment_date = ?, appointment_time = ?, rejection_reason = ? WHERE id = ?',
      [status, nextDate, nextTime, ['reject', 'reschedule'].includes(action) ? reason : null, id],
    );
    const title = { approve: 'Appointment approved', reject: 'Appointment rejected', reschedule: 'New appointment time proposed', complete: 'Appointment completed' }[action];
    const message = action === 'reschedule'
      ? `Staff propose ${date} at ${time} (Malaysia time). Accept or decline in Appointments. Your original slot is released. Reason: ${reason}`
      : `${title} for ${nextDate} at ${nextTime}.${action === 'reject' ? ` Reason: ${reason}` : ''}`;
    await connection.execute(
      `INSERT INTO notifications (patient_id, appointment_id, title, message, notification_type) VALUES (?, ?, ?, ?, 'appointment')`,
      [entry.patientId, id, title, message],
    );
    await connection.execute(
      `INSERT INTO staff_audit_logs (staff_id, action, entity_type, entity_id, details) VALUES (?, ?, 'appointment', ?, ?)`,
      [request.user.id, `appointment_${action}`, id, `${entry.appointmentDate} ${entry.appointmentTime} (${entry.status}) → ${nextDate} ${nextTime} (${status}). ${reason}`],
    );
    await connection.commit();
    return response.json({ message: action === 'reschedule' ? 'New time proposed. Awaiting patient acceptance.' : `${title}.` });
  } catch (error) {
    if (connection) await connection.rollback();
    return response.status(503).json({ error: 'The appointment could not be updated. Please try again.' });
  } finally {
    if (connection) connection.release();
  }
});

patient.post('/appointments/:appointmentId/respond', ...requireRole('patient'), async (request, response) => {
  const id = Number(request.params.appointmentId);
  const decision = request.body.decision;
  if (!Number.isSafeInteger(id) || id < 1 || !['accept', 'decline'].includes(decision)) {
    return response.status(422).json({ error: 'Select accept or decline for a valid appointment.' });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await lockBookings(connection);
    const [rows] = await connection.execute(
      `SELECT id, status, DATE_FORMAT(appointment_date, '%Y-%m-%d') AS appointmentDate,
              TIME_FORMAT(appointment_time, '%H:%i') AS appointmentTime
       FROM appointments WHERE id = ? AND patient_id = ? FOR UPDATE`, [id, request.user.id],
    );
    if (!rows.length) {
      await connection.rollback();
      return response.status(404).json({ error: 'Appointment not found.' });
    }
    const entry = rows[0];
    if (entry.status !== 'reschedule_proposed') {
      await connection.rollback();
      return response.status(409).json({ error: 'There is no pending time proposal. Refresh your appointments.' });
    }
    // Check the displayed proposal so a stale browser cannot accept a newer time.
    if (request.body.appointmentDate !== entry.appointmentDate || request.body.appointmentTime !== entry.appointmentTime) {
      await connection.rollback();
      return response.status(409).json({ error: 'The proposed time changed. Refresh and review it before responding.' });
    }
    if (decision === 'accept' && (!futureSlot(entry.appointmentDate, entry.appointmentTime)
        || !(await slotIsOpen(connection, entry.appointmentDate, entry.appointmentTime))
        || await hasConflict(connection, request.user.id, entry.appointmentDate, entry.appointmentTime, id))) {
      await connection.rollback();
      return response.status(409).json({ error: 'This proposed time is no longer available. Contact clinic staff.' });
    }
    await connection.execute(
      `UPDATE appointments SET status = ?, cancelled_at = ${decision === 'decline' ? 'CURRENT_TIMESTAMP' : 'NULL'} WHERE id = ?`,
      [decision === 'accept' ? 'approved' : 'cancelled', id],
    );
    const message = decision === 'accept' ? 'New appointment time accepted and confirmed.' : 'Proposed time declined. The appointment has been cancelled; you may request another slot.';
    await connection.execute(
      `INSERT INTO notifications (patient_id, appointment_id, title, message, notification_type) VALUES (?, ?, 'Appointment response recorded', ?, 'appointment')`,
      [request.user.id, id, message],
    );
    await connection.commit();
    return response.json({ message });
  } catch (error) {
    if (connection) await connection.rollback();
    return response.status(503).json({ error: 'Your response could not be saved. Please try again.' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = { staff, patient };

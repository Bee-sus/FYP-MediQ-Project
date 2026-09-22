const activeStatuses = "'pending','approved','reschedule_proposed'";

function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}

function futureSlot(date, time) {
  return validDate(date) && /^(?:[01]\d|2[0-3]):(?:00|30)$/.test(time) && new Date(`${date}T${time}:00+08:00`) > new Date();
}

// Every appointment writer takes this lock first, including cancellations.
// It serializes conflict checks across services and concurrent HTTP requests.
async function lockBookings(connection) {
  const [rows] = await connection.execute('SELECT id FROM appointment_booking_lock WHERE id = 1 FOR UPDATE');
  if (!rows.length) throw new Error('Appointment schema migration is required.');
}

async function hasConflict(connection, patientId, date, time, excludeId = 0) {
  const [rows] = await connection.execute(
    `SELECT id FROM appointments WHERE id <> ? AND appointment_date = ?
     AND status IN (${activeStatuses}) AND (appointment_time = ? OR patient_id = ?) LIMIT 1 FOR UPDATE`,
    [excludeId, date, time, patientId],
  );
  return rows.length > 0;
}

module.exports = { activeStatuses, validDate, futureSlot, lockBookings, hasConflict };

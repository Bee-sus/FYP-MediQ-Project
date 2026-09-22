const { validDate } = require('./appointmentService');

const toMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const validTime = time => typeof time === 'string' && /^(?:[01]\d|2[0-3]):(?:00|30)$/.test(time);

function validateHours(days) {
  if (!Array.isArray(days) || days.length !== 7) return 'Provide all seven days.';
  if (new Set(days.map(day => day?.dayOfWeek)).size !== 7) return 'Provide each weekday exactly once.';
  for (const day of days) {
    if (!day || !Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek > 6 || typeof day.isOpen !== 'boolean') return 'Invalid weekday or open status.';
    if (!validTime(day.opensAt) || !validTime(day.closesAt) || day.opensAt >= day.closesAt) return 'Opening and closing times must be half-hour times on the same day, with closing after opening.';
    const hasBreak = day.breakStart != null || day.breakEnd != null;
    if (hasBreak && (!validTime(day.breakStart) || !validTime(day.breakEnd) || day.breakStart < day.opensAt || day.breakEnd > day.closesAt || day.breakStart >= day.breakEnd)) return 'Break times must both be set within opening hours, with the end after the start.';
    if (day.isOpen && slotsForDay(day).length === 0) return 'An open day needs at least one appointment slot.';
  }
  return null;
}

function slotsForDay(day) {
  if (!day || !day.isOpen) return [];
  const slots = [];
  for (let minute = toMinutes(day.opensAt); minute + 30 <= toMinutes(day.closesAt); minute += 30) {
    if (day.breakStart && day.breakEnd && minute < toMinutes(day.breakEnd) && minute + 30 > toMinutes(day.breakStart)) continue;
    slots.push(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
  }
  return slots;
}

function slotsForDate(days, date) {
  if (!validDate(date)) return [];
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return slotsForDay(days.find(day => Number(day.dayOfWeek) === weekday));
}

async function readHours(connection) {
  const [rows] = await connection.execute(`SELECT day_of_week AS dayOfWeek, is_open AS isOpen,
    TIME_FORMAT(opens_at, '%H:%i') AS opensAt, TIME_FORMAT(closes_at, '%H:%i') AS closesAt,
    TIME_FORMAT(break_start, '%H:%i') AS breakStart, TIME_FORMAT(break_end, '%H:%i') AS breakEnd
    FROM clinic_hours ORDER BY day_of_week`);
  if (rows.length !== 7) throw new Error('Clinic hours migration is required.');
  return rows.map(row => ({ ...row, dayOfWeek: Number(row.dayOfWeek), isOpen: Boolean(row.isOpen) }));
}

async function slotIsOpen(connection, date, time) {
  return slotsForDate(await readHours(connection), date).includes(time);
}

module.exports = { validTime, validateHours, slotsForDay, slotsForDate, readHours, slotIsOpen };

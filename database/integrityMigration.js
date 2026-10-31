const integrityConstraints = [
  { table: 'queue_entries', name: 'ck_queue_number_positive', expression: 'queue_number > 0' },
  { table: 'clinic_services', name: 'ck_service_duration', expression: 'average_duration_minutes BETWEEN 1 AND 240' },
  { table: 'clinic_services', name: 'ck_service_capacity', expression: 'queue_capacity IS NULL OR queue_capacity BETWEEN 1 AND 500' },
  { table: 'waiting_time_predictions', name: 'ck_prediction_estimated_nonnegative', expression: 'estimated_minutes >= 0' },
  { table: 'waiting_time_predictions', name: 'ck_prediction_actual_nonnegative', expression: 'actual_wait_minutes IS NULL OR actual_wait_minutes >= 0' },
  { table: 'clinic_hours', name: 'ck_hours_weekday', expression: 'day_of_week BETWEEN 0 AND 6' },
  { table: 'clinic_hours', name: 'ck_hours_window', expression: "opens_at >= '00:00:00' AND closes_at < '24:00:00' AND opens_at < closes_at AND MOD(TIME_TO_SEC(opens_at), 1800) = 0 AND MOD(TIME_TO_SEC(closes_at), 1800) = 0" },
  { table: 'clinic_hours', name: 'ck_hours_break', expression: '(break_start IS NULL AND break_end IS NULL) OR (break_start IS NOT NULL AND break_end IS NOT NULL AND break_start >= opens_at AND break_end <= closes_at AND break_start < break_end AND MOD(TIME_TO_SEC(break_start), 1800) = 0 AND MOD(TIME_TO_SEC(break_end), 1800) = 0)' },
];

async function migrateIntegrity(connection) {
  const [[{ version }]] = await connection.query('SELECT VERSION() AS version');
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match || /mariadb/i.test(version) || Number(match[1]) < 8 ||
      (Number(match[1]) === 8 && Number(match[2]) === 0 && Number(match[3]) < 16)) {
    throw new Error('Enforced integrity checks require MySQL 8.0.16 or later. No changes were made.');
  }

  // Inspect all rows before any ALTER TABLE. Historical clinic data is never
  // silently repaired, deleted, or reclassified to satisfy a new constraint.
  const invalid = [];
  for (const constraint of integrityConstraints) {
    const [[{ invalidCount }]] = await connection.query(
      `SELECT COUNT(*) AS invalidCount FROM \`${constraint.table}\` WHERE NOT (${constraint.expression})`,
    );
    if (Number(invalidCount)) invalid.push(`${constraint.table}.${constraint.name}: ${invalidCount} row(s)`);
  }
  if (invalid.length) throw new Error(`Integrity migration stopped before schema changes. Review existing data: ${invalid.join('; ')}`);

  const added = [];
  for (const constraint of integrityConstraints) {
    const [existing] = await connection.execute(
      `SELECT ENFORCED AS enforced FROM information_schema.table_constraints
       WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ? AND constraint_type = 'CHECK'`,
      [constraint.table, constraint.name],
    );
    if (!existing.length) {
      await connection.query(`ALTER TABLE \`${constraint.table}\` ADD CONSTRAINT \`${constraint.name}\` CHECK (${constraint.expression})`);
      added.push(constraint.name);
    } else if (existing[0].enforced !== 'YES') {
      await connection.query(`ALTER TABLE \`${constraint.table}\` ALTER CHECK \`${constraint.name}\` ENFORCED`);
      added.push(constraint.name);
    }
  }
  return added;
}

module.exports = { migrateIntegrity, integrityConstraints };

if (require.main === module) {
  require('dotenv').config();
  const { pool } = require('../backend/src/config/database');
  (async () => {
    try {
      const added = await migrateIntegrity(pool);
      console.log(`Integrity checks ready (${added.length} added or enabled). Existing records were preserved.`);
    } finally {
      await pool.end();
    }
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

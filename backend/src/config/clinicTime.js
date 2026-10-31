const databaseDateOptions = { timezone: '+08:00', dateStrings: ['DATE'] };

async function setClinicTimeZone(connection) {
  await connection.query("SET time_zone = '+08:00'");
}

function clinicDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

module.exports = { databaseDateOptions, setClinicTimeZone, clinicDate };

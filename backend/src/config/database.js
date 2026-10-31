const mysql = require('mysql2/promise');
const { databaseDateOptions, setClinicTimeZone } = require('./clinicTime');

const connectionPool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || 'mediq',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ...databaseDateOptions,
});

// Initialise every checkout, including connections used for transactions. A driver
// timezone alone does not set MySQL's CURRENT_DATE / CURRENT_TIMESTAMP timezone.
const pool = {
  async getConnection() {
    const connection = await connectionPool.getConnection();
    try {
      await setClinicTimeZone(connection);
      return connection;
    } catch (error) {
      connection.destroy();
      throw error;
    }
  },
  execute(...args) { return withConnection('execute', args); },
  query(...args) { return withConnection('query', args); },
  end() { return connectionPool.end(); },
};

async function withConnection(method, args) {
  const connection = await pool.getConnection();
  try {
    return await connection[method](...args);
  } finally {
    connection.release();
  }
}

async function checkDatabaseConnection() {
  const connection = await pool.getConnection();
  try {
    await connection.ping();
    return true;
  } finally {
    connection.release();
  }
}

module.exports = { pool, checkDatabaseConnection };

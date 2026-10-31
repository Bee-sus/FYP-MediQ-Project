jest.mock('mysql2/promise', () => ({ createPool: jest.fn() }));
const mysql = require('mysql2/promise');
let connection;
let sourcePool;
let pool;

beforeEach(() => {
  connection = { query: jest.fn().mockResolvedValue([[]]), execute: jest.fn().mockResolvedValue([[{ id: 1 }]]), release: jest.fn(), destroy: jest.fn() };
  sourcePool = { getConnection: jest.fn().mockResolvedValue(connection), end: jest.fn().mockResolvedValue() };
  mysql.createPool.mockReturnValue(sourcePool);
  jest.isolateModules(() => { pool = require('../src/config/database').pool; });
});

test('a transaction connection is returned only after its SQL timezone is initialized', async () => {
  let finishInitialization;
  connection.query.mockReturnValue(new Promise(resolve => { finishInitialization = resolve; }));
  let acquired = false;
  const pending = pool.getConnection().then(result => { acquired = true; return result; });
  await Promise.resolve();
  expect(acquired).toBe(false);
  finishInitialization([[]]);
  expect(await pending).toBe(connection);
  expect(connection.query).toHaveBeenCalledWith("SET time_zone = '+08:00'");
});

test('initializes a reused connection on every checkout', async () => {
  await pool.getConnection();
  await pool.getConnection();
  expect(connection.query).toHaveBeenCalledTimes(2);
});

test('timezone initialization failure discards the connection and prevents queries', async () => {
  connection.query.mockRejectedValue(new Error('timezone unavailable'));
  await expect(pool.execute('SELECT 1')).rejects.toThrow('timezone unavailable');
  expect(connection.destroy).toHaveBeenCalledTimes(1);
  expect(connection.execute).not.toHaveBeenCalled();
});

test('query failures release the initialized connection', async () => {
  connection.execute.mockRejectedValue(new Error('query failed'));
  await expect(pool.execute('SELECT ?', [1])).rejects.toThrow('query failed');
  expect(connection.release).toHaveBeenCalledTimes(1);
});

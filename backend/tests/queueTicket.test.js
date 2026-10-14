const { formatQueueTicket } = require('../src/services/queueTicket');

test('queue tickets distinguish services while preserving each service sequence', () => {
  expect(formatQueueTicket(2, 1)).toBe('Q2-001');
  expect(formatQueueTicket(3, 1)).toBe('Q3-001');
  expect(formatQueueTicket(2, 1000)).toBe('Q2-1000');
});

test('queue tickets reject invalid identifiers', () => {
  expect(() => formatQueueTicket(0, 1)).toThrow(RangeError);
  expect(() => formatQueueTicket(2, 0)).toThrow(RangeError);
});

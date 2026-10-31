const { clinicDate } = require('../src/config/clinicTime');

test.each([
  ['2026-10-26T15:59:59.999Z', '2026-10-26'],
  ['2026-10-26T16:00:00.000Z', '2026-10-27'],
  ['2026-12-31T16:00:00.000Z', '2027-01-01'],
  ['2028-02-28T16:00:00.000Z', '2028-02-29'],
])('clinic date at %s is %s regardless of server timezone', (instant, expected) => {
  expect(clinicDate(new Date(instant))).toBe(expected);
});

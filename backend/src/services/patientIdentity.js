function validateIdentity(body) {
  const type = String(body.identificationType || '').trim();
  const raw = String(body.identificationNumber || '').trim();
  const number = raw.replace(/[\s-]/g, '').toUpperCase();
  const errors = {};
  if (!type && !number) return { type: null, number: null, errors };
  if (!['mykad', 'passport'].includes(type)) errors.identificationType = 'Choose MyKad or Passport.';
  else if (type === 'mykad' && !/^\d{12}$/.test(number)) errors.identificationNumber = 'Enter a 12-digit MyKad number.';
  else if (type === 'passport' && !/^[A-Z0-9]{6,20}$/.test(number)) errors.identificationNumber = 'Use 6–20 letters or numbers for a passport number.';
  return { type: type || null, number: number || null, errors };
}
module.exports = { validateIdentity };

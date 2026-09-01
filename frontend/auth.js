const registrationMessages = {
  fullName: 'Enter your full name using at least 2 letters.', email: 'Enter a valid email address.',
  phone: 'Enter a valid phone number containing 8–15 digits.', birthDate: 'Enter a valid date of birth that is not in the future.',
  gender: 'Select a gender option.', password: 'Meet all five password requirements.',
  confirmPassword: 'Re-enter the same password.', terms: 'Accept the Terms and Privacy Notice to register.',
};

function passwordRules(value) {
  return { length: value.length >= 12, upper: /[A-Z]/.test(value), lower: /[a-z]/.test(value), number: /\d/.test(value), symbol: /[^A-Za-z0-9]/.test(value) };
}

function setFieldState(field, showMessage = true) {
  const error = document.querySelector(`#${field.id}-error`);
  if (!error) return field.checkValidity();
  field.setCustomValidity('');
  let message = '';
  if (field.name === 'birthDate' && field.value && new Date(`${field.value}T00:00:00`) > new Date()) message = registrationMessages.birthDate;
  else if (field.name === 'phone' && field.value && (field.value.replace(/\D/g, '').length < 8 || field.value.replace(/\D/g, '').length > 15)) message = registrationMessages.phone;
  else if (field.name === 'password' && !Object.values(passwordRules(field.value)).every(Boolean)) message = registrationMessages.password;
  else if (field.name === 'confirmPassword' && field.value !== document.querySelector('#password').value) message = registrationMessages.confirmPassword;
  else if (!field.validity.valid) message = registrationMessages[field.name] || 'Check this field.';
  field.setCustomValidity(message); error.textContent = showMessage ? message : ''; field.setAttribute('aria-invalid', String(Boolean(message)));
  return !message;
}

function updatePasswordMatch() {
  const confirmation = document.querySelector('#confirm-password'); if (!confirmation) return;
  const status = document.querySelector('#password-match'); const matches = confirmation.value && confirmation.value === document.querySelector('#password').value;
  status.textContent = !confirmation.value ? 'Re-enter your password.' : matches ? 'Passwords match.' : 'Passwords do not match.';
  status.classList.toggle('success', Boolean(matches)); status.classList.toggle('error', Boolean(confirmation.value && !matches));
  setFieldState(confirmation, confirmation.dataset.touched === 'true' || Boolean(confirmation.value));
}

function updatePasswordDisplay() {
  const password = document.querySelector('#password'); if (!password || !document.querySelector('#password-strength')) return;
  const rules = passwordRules(password.value);
  Object.entries(rules).forEach(([rule, passed]) => document.querySelector(`[data-rule="${rule}"]`)?.classList.toggle('met', passed));
  const score = Object.values(rules).filter(Boolean).length; const labels = ['Not entered', 'Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  document.querySelector('#password-strength').textContent = password.value ? labels[score] : labels[0];
  document.querySelector('#strength-bar').style.width = password.value ? `${score * 20}%` : '0';
  setFieldState(password, password.dataset.touched === 'true'); updatePasswordMatch();
}

function configurePasswordToggles() {
  document.querySelectorAll('[data-password-toggle]').forEach((button) => button.addEventListener('click', () => {
    const input = document.querySelector(`#${button.dataset.passwordToggle}`); const show = input.type === 'password';
    input.type = show ? 'text' : 'password'; button.textContent = show ? 'Hide' : 'Show';
    button.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} ${input.id === 'password' ? 'password' : 'confirmed password'}`);
  }));
}

function showServerFieldErrors(fields = {}) {
  Object.entries(fields).forEach(([name, message]) => {
    const field = document.querySelector(`[name="${name}"]`); const error = field && document.querySelector(`#${field.id}-error`);
    if (field) field.setAttribute('aria-invalid', 'true'); if (error) error.textContent = message;
  });
}

async function submitAuthForm(form, status) {
  const values = Object.fromEntries(new FormData(form));
  const isRegistration = form.dataset.authForm === 'register';
  const roles = { 'patient-login': 'patient', 'staff-login': 'staff', 'admin-login': 'admin' };
  const payload = { ...values, terms: values.terms === 'on', remember: values.remember === 'on' };
  if (!isRegistration) payload.role = roles[form.dataset.authForm];
  const response = await fetch(`/api/auth/${isRegistration ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) { showServerFieldErrors(result.fields); throw new Error(result.error || 'The request could not be completed.'); }
  status.textContent = result.message; status.className = 'form-status'; status.hidden = false;
  if (result.redirect) window.location.assign(result.redirect);
  else if (isRegistration) setTimeout(() => window.location.assign('/patient-login.html'), 900);
}

function configureAuthForm() {
  const form = document.querySelector('[data-auth-form]'); if (!form) return; configurePasswordToggles();
  if (form.dataset.authForm === 'register') {
    const birthDate = form.querySelector('#birth-date'); const now = new Date(); birthDate.max = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    form.querySelectorAll('input, select').forEach((field) => {
      field.addEventListener('blur', () => { field.dataset.touched = 'true'; setFieldState(field); });
      field.addEventListener(field.type === 'checkbox' || field.tagName === 'SELECT' ? 'change' : 'input', () => setFieldState(field, field.dataset.touched === 'true'));
    });
    form.querySelector('#password').addEventListener('input', updatePasswordDisplay); form.querySelector('#confirm-password').addEventListener('input', updatePasswordMatch); updatePasswordDisplay();
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const status = document.querySelector('#form-status');
    if (form.dataset.authForm === 'register') {
      const fields = [...form.querySelectorAll('input, select')]; fields.forEach((field) => { field.dataset.touched = 'true'; setFieldState(field); });
      const firstInvalid = fields.find((field) => !field.checkValidity());
      if (firstInvalid) { status.textContent = 'Please correct the highlighted registration fields.'; status.className = 'form-status error'; status.hidden = false; firstInvalid.focus(); return; }
    }
    const button = form.querySelector('.submit-button'); button.disabled = true; status.textContent = 'Please wait…'; status.className = 'form-status'; status.hidden = false;
    try { await submitAuthForm(form, status); } catch (error) { status.textContent = error.message; status.className = 'form-status error'; status.hidden = false; } finally { button.disabled = false; }
  });
}

configureAuthForm();

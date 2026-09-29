const status = document.querySelector('#verification-status');
const login = document.querySelector('#verification-login');
const card = document.querySelector('.verify-card');
const description = document.querySelector('#verification-description');
const heading = document.querySelector('#verification-heading');
const token = new URLSearchParams(window.location.search).get('token');
(async () => {
  try {
    const response = await fetch('/api/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    card.dataset.state = 'success'; heading.textContent = result.role === 'staff' ? 'Staff email verified' : 'Email verified';
    description.textContent = result.role === 'staff' ? 'Your Staff account is ready. Sign in with the credentials provided by the clinic, then change your temporary password.' : 'Your account is ready. You can now sign in to MediQ.';
    status.textContent = result.message; status.className = 'form-status'; login.href = result.role === 'staff' ? '/staff-login.html' : '/patient-login.html'; login.hidden = false;
  } catch (error) { card.dataset.state = 'error'; description.textContent = 'This link may have expired or already been used. Request a new account email from the clinic if needed.'; status.textContent = error.message || 'This verification link could not be used.'; status.className = 'form-status error'; }
})();

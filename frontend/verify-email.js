const status = document.querySelector('#verification-status');
const login = document.querySelector('#verification-login');
const card = document.querySelector('.verify-card');
const description = document.querySelector('#verification-description');
const heading = document.querySelector('#verification-heading');
const token = new URLSearchParams(window.location.search).get('token');
(async () => {
  try {
    const response = await fetch('/api/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    if(!(response.headers.get('content-type')||'').includes('application/json'))throw new Error('The server could not process verification. Refresh the page or restart MediQ and retry.');
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    card.dataset.state = 'success'; heading.textContent = result.role === 'staff' ? 'Staff email verified' : 'Email verified';
    description.textContent = result.role === 'staff' ? 'Your Staff account is ready. Sign in with the credentials provided by the clinic, then change your temporary password.' : 'Your account is ready. You can now sign in to MediQ.';
    status.textContent = result.message; status.className = 'form-status'; login.href = result.role === 'staff' ? '/staff-login.html' : '/patient-login.html'; login.hidden = false;
  } catch (error) { card.dataset.state = 'error'; document.querySelector('#verification-icon').textContent='!';description.textContent = 'If you already verified your email, you can sign in. Otherwise, request a new verification link from the clinic.'; status.textContent = error instanceof TypeError?'Connection lost. Check your connection and retry.':error.message || 'This verification link could not be used.'; status.className = 'form-status error';login.href='/';login.textContent='Choose your sign-in portal';login.hidden=false; }
})();

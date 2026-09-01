const roleNames = {
  patient: 'Patient',
  staff: 'Staff',
  admin: 'Administrator',
};

async function loadDashboard() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('unauthorised');

    const { user } = await response.json();
    document.title = `${roleNames[user.role]} Dashboard | MediQ`;
    document.querySelector('#role-label').textContent = `${roleNames[user.role]} portal`;
    document.querySelector('#welcome-heading').textContent = `Welcome, ${user.fullName}`;
    document.querySelector('#dashboard-message').textContent =
      `You are securely signed in with ${roleNames[user.role].toLowerCase()} access.`;
  } catch (error) {
    window.location.replace('/patient-login.html');
  }
}

document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.replace('/');
});

loadDashboard();

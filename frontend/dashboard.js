async function loadDashboard() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('unauthorised');

    const { user } = await response.json();
    window.location.replace(user.role === 'admin' ? '/admin-dashboard.html' : user.role === 'staff' ? '/staff-dashboard.html' : '/patient-dashboard.html');
  } catch (error) {
    window.location.replace('/patient-login.html');
  }
}

document.querySelector('#logout-button').addEventListener('click', event => {
  window.mediqSignOut(event.currentTarget);
});

loadDashboard();

const statusLabels = {
  waiting: 'Waiting',
  called: 'Called',
  in_progress: 'In consultation',
  completed: 'Completed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
};

function formatDate(value) {
  return new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function renderQueue(queue) {
  const container = document.querySelector('#active-queue');
  if (!queue) {
    container.className = 'queue-dashboard-card empty-queue';
    container.innerHTML = `
      <div>
        <span class="empty-icon" aria-hidden="true">Q</span>
        <h3>You are not in a queue today</h3>
        <p>Choose an available clinic service below when you are ready to join.</p>
      </div>
      <a class="action-button primary-action" href="#services">View services</a>
    `;
    return;
  }

  container.className = 'queue-dashboard-card active-queue';
  container.innerHTML = `
    <div class="queue-identity">
      <span>${queue.serviceName}</span>
      <strong>${queue.queueNumber}</strong>
      <small>Your queue number</small>
    </div>
    <div class="queue-metrics">
      <div><span>Status</span><strong>${statusLabels[queue.status] || queue.status}</strong></div>
      <div><span>People ahead</span><strong>${queue.peopleAhead}</strong></div>
      <div>
        <span>Estimated wait</span>
        <strong>${queue.estimatedMinutes == null ? 'Calculating' : `~${Math.round(queue.estimatedMinutes)} min`}</strong>
      </div>
    </div>
  `;
}

function renderServices(services) {
  const container = document.querySelector('#patient-services');
  if (!services.length) {
    container.innerHTML = '<p class="dashboard-empty">No clinic services are currently available.</p>';
    return;
  }

  container.replaceChildren(...services.map((service) => {
    const card = document.createElement('article');
    card.className = 'patient-service-card';
    card.innerHTML = `
      <div><h3></h3><p></p></div>
      <div class="service-card-footer">
        <span></span><button type="button" disabled>Join queue soon</button>
      </div>
    `;
    card.querySelector('h3').textContent = service.name;
    card.querySelector('p').textContent = service.description || 'Clinic consultation service.';
    card.querySelector('span').textContent = `Approx. ${service.averageDurationMinutes} min`;
    return card;
  }));
}

function renderHistory(items) {
  const container = document.querySelector('#queue-history');
  if (!items.length) {
    container.innerHTML = `
      <div class="dashboard-empty">
        <strong>No previous queue visits</strong>
        <p>Your completed and cancelled queue entries will appear here.</p>
      </div>
    `;
    return;
  }

  container.replaceChildren(...items.map((item) => {
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `
      <div><strong></strong><span></span></div>
      <div><span class="history-status"></span><strong class="history-number"></strong></div>
    `;
    row.querySelector('strong').textContent = item.serviceName;
    row.querySelector('div span').textContent = formatDate(item.queueDate);
    row.querySelector('.history-status').textContent = statusLabels[item.status] || item.status;
    row.querySelector('.history-number').textContent = `#${item.queueNumber}`;
    return row;
  }));
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.replace('/');
}

async function loadPatientDashboard() {
  document.querySelector('#current-date').textContent = new Intl.DateTimeFormat('en-MY', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  try {
    const response = await fetch('/api/patient/overview', { credentials: 'same-origin' });
    if (response.status === 401 || response.status === 403) {
      window.location.replace('/patient-login.html');
      return;
    }

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Dashboard could not be loaded.');
    document.querySelector('#patient-name').textContent = data.user.fullName;
    document.querySelector('#welcome-heading').textContent = `Welcome, ${data.user.fullName.split(' ')[0]}`;
    renderQueue(data.activeQueue);
    renderServices(data.services);
    renderHistory(data.recentQueues);
  } catch (error) {
    const alert = document.querySelector('#dashboard-alert');
    alert.textContent = error.message;
    alert.hidden = false;
  }
}

let noticeTimer;
document.querySelectorAll('[data-upcoming]').forEach((button) => {
  button.addEventListener('click', () => {
    const notice = document.querySelector('#portal-notice');
    notice.textContent = `${button.dataset.upcoming} will be implemented after the queue workflow.`;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.hidden = true;
    }, 4000);
  });
});

document.querySelector('#logout-button').addEventListener('click', logout);
loadPatientDashboard();

fetch('/api/settings').then(response => response.json()).then(data => document.querySelectorAll('.brand small').forEach(item => { item.textContent = data.settings.clinicName; })).catch(() => {});
let activeQueue = null;
const labels = { waiting: 'Waiting', called: 'Please proceed', in_progress: 'In consultation' };

function formatQueueNumber(value) {
  return `Q-${String(value).padStart(3, '0')}`;
}

function renderNoQueue() {
  document.querySelector('#queue-status-content').innerHTML = `
    <div class="queue-status-empty">
      <span class="empty-icon" aria-hidden="true">Q</span>
      <h2>You do not have an active queue</h2>
      <p>Choose a clinic service to join today’s queue.</p>
      <a class="action-button primary-action" href="/join-queue.html">Join a queue</a>
    </div>
  `;
}

function renderActiveQueue(queue) {
  const content = document.querySelector('#queue-status-content');
  content.innerHTML = `
    <div class="status-hero-card">
      <div class="status-number"><span>Your queue number</span><strong id="queue-number"></strong><small id="service-name"></small></div>
      <div class="status-summary">
        <span id="queue-status-badge" class="queue-status-badge"></span>
        <h2 id="queue-guidance"></h2>
        <p id="joined-time"></p><small id="queue-last-updated" class="queue-last-updated"></small>
        <div class="status-metrics"><div><strong id="people-ahead"></strong><span>People ahead</span></div><div><strong id="estimated-wait"></strong><span>Prototype estimate</span></div></div>
        <p class="estimate-explanation estimate-explanation-dark">Calculated from people ahead and average consultation duration—not a trained ML prediction.</p>
      </div>
    </div>
    <div class="queue-progress-card">
      <div class="progress-heading"><div data-stage="joined"><span class="progress-icon" aria-hidden="true">✓</span><div><strong>Queue joined</strong><small>Your place is reserved</small></div></div><span class="progress-line"></span><div data-stage="called"><span class="progress-icon upcoming" aria-hidden="true">2</span><div><strong>Wait for call</strong><small>Monitor this page</small></div></div><span class="progress-line"></span><div data-stage="consultation"><span class="progress-icon upcoming" aria-hidden="true">3</span><div><strong>Consultation</strong><small>Proceed when called</small></div></div></div>
    </div>
    <div class="status-actions-row">
      <div class="status-notice"><span class="notice-symbol" aria-hidden="true">i</span><div><strong>Stay ready</strong><p>Queue positions and estimates may change when clinical priorities arise. Select Refresh status for the latest position.</p></div></div>
      <button id="open-cancel-dialog" class="text-danger-button" type="button">Cancel queue entry</button>
    </div>
  `;
  document.querySelector('#queue-number').textContent = formatQueueNumber(queue.queueNumber);
  document.querySelector('#service-name').textContent = queue.serviceName;
  document.querySelector('#queue-status-badge').textContent = labels[queue.status] || queue.status;
  document.querySelector('#queue-guidance').textContent = queue.status === 'called' ? 'It is nearly your turn.' : queue.status === 'in_progress' ? 'Your consultation is in progress.' : 'You are in the queue.';
  document.querySelector('#joined-time').textContent = `Joined ${new Intl.DateTimeFormat('en-MY', { hour: 'numeric', minute: '2-digit' }).format(new Date(queue.joinedAt))}`;
  document.querySelector('#people-ahead').textContent = queue.peopleAhead;
  document.querySelector('#estimated-wait').textContent = queue.estimatedMinutes == null ? 'Calculating' : `~${Math.round(queue.estimatedMinutes)} min`;
  document.querySelector('#queue-last-updated').textContent = `Automatically updated ${new Intl.DateTimeFormat('en-MY', { timeStyle: 'short' }).format(new Date())}`;
  const calledIcon = document.querySelector('[data-stage="called"] .progress-icon');
  const consultationIcon = document.querySelector('[data-stage="consultation"] .progress-icon');
  if (queue.status === 'called' || queue.status === 'in_progress') {
    calledIcon.classList.remove('upcoming');
    calledIcon.textContent = '✓';
  }
  if (queue.status === 'in_progress') {
    consultationIcon.classList.remove('upcoming');
    consultationIcon.textContent = '✓';
  }
  const cancelButton = document.querySelector('#open-cancel-dialog');
  if (queue.status === 'in_progress') cancelButton.hidden = true;
  else cancelButton.addEventListener('click', () => document.querySelector('#cancel-dialog').showModal());
}

async function loadQueueStatus(showMessage = false) {
  const alert = document.querySelector('#status-alert');
  try {
    const [accountResponse, queueResponse] = await Promise.all([fetch('/api/auth/me'), fetch('/api/patient/queues/active')]);
    if (accountResponse.status === 401 || accountResponse.status === 403) {
      window.location.replace('/patient-login.html');
      return;
    }
    const account = await accountResponse.json();
    if (!accountResponse.ok) throw new Error(account.error || 'Your account could not be verified.');
    document.querySelector('#patient-name').textContent = account.user.fullName;
    const data = await queueResponse.json();
    if (!queueResponse.ok) throw new Error(data.error);
    activeQueue = data.queue;
    if (activeQueue) renderActiveQueue(activeQueue);
    else renderNoQueue();
    if (showMessage || new URLSearchParams(window.location.search).has('joined')) {
      alert.textContent = activeQueue ? 'Queue status is up to date.' : 'No active queue was found.';
      alert.className = 'dashboard-alert success';
      alert.hidden = false;
      window.history.replaceState({}, '', '/queue-status.html');
    }
  } catch (error) {
    alert.textContent = error.message || 'Queue status could not be loaded.';
    alert.className = 'dashboard-alert';
    alert.hidden = false;
  }
}

async function cancelQueue(event) {
  event.preventDefault();
  const reason = document.querySelector('#cancellation-reason').value.trim();
  const error = document.querySelector('#cancel-error');
  if (reason.length < 3) {
    error.textContent = 'Enter at least 3 characters.';
    return;
  }
  const response = await fetch(`/api/patient/queues/${activeQueue.id}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
  });
  const result = await response.json();
  if (!response.ok) {
    error.textContent = result.error || 'The queue could not be cancelled.';
    return;
  }
  document.querySelector('#cancel-dialog').close();
  const alert = document.querySelector('#status-alert');
  alert.textContent = result.message;
  alert.className = 'dashboard-alert success';
  alert.hidden = false;
  activeQueue = null;
  renderNoQueue();
}

document.querySelector('#refresh-queue').addEventListener('click', () => loadQueueStatus(true));
document.querySelector('#keep-queue').addEventListener('click', () => document.querySelector('#cancel-dialog').close());
document.querySelector('#cancel-form').addEventListener('submit', cancelQueue);
document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.replace('/');
});
loadQueueStatus();
setInterval(() => { if (!document.hidden) loadQueueStatus(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadQueueStatus(); });

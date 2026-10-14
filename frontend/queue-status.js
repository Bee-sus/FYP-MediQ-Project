fetch('/api/settings').then(response => response.json()).then(data => document.querySelectorAll('.brand small').forEach(item => { item.textContent = data.settings.clinicName; })).catch(() => {});
let activeQueue = null;
const labels = { waiting: 'Waiting', called: 'Please proceed', in_progress: 'In consultation' };
const malaysiaClock = new Intl.DateTimeFormat('en-MY', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });

function formatQueueTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : malaysiaClock.format(date);
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
      <div class="status-topline">
        <div class="status-number"><span>Your queue number</span><strong id="queue-number"></strong><small id="service-name"></small></div>
        <div class="status-heading">
          <span id="queue-status-badge" class="queue-status-badge"></span>
          <h2 id="queue-guidance"></h2>
          <p id="joined-time"></p><small id="queue-last-updated" class="queue-last-updated"></small>
        </div>
      </div>
      <div class="status-summary">
        <div class="status-metrics"><div><strong id="people-ahead"></strong><span>People ahead</span></div><div><span class="status-wait-main"><strong id="estimated-wait"></strong><em id="estimated-time-range" class="estimated-time-range" hidden></em></span><span id="wait-metric-label">Estimated wait to consultation</span></div></div>
      </div>
      <div class="queue-journey">
        <div class="queue-journey-heading"><strong>Your visit progress</strong><span id="journey-message"></span></div>
        <div id="queue-journey-track" class="queue-journey-track" role="progressbar" aria-label="Visit progress" aria-valuemin="0" aria-valuemax="3"><span id="queue-journey-fill"></span></div>
        <div class="queue-journey-labels"><span>Joined</span><span>Called</span><span>Consultation</span></div>
      </div>
    </div>
    <div class="status-actions-row">
      <div class="status-notice"><span class="notice-symbol" aria-hidden="true">i</span><div><strong id="status-notice-title"></strong><p id="status-notice-message"></p></div></div>
      <button id="open-cancel-dialog" class="text-danger-button" type="button">Cancel queue entry</button>
    </div>
  `;
  document.querySelector('#queue-number').textContent = formatQueueTicket(queue.serviceId, queue.queueNumber);
  document.querySelector('#service-name').textContent = queue.serviceName;
  document.querySelector('#queue-status-badge').textContent = labels[queue.status] || queue.status;
  document.querySelector('#queue-guidance').textContent = queue.status === 'called' ? 'You have been called. Please proceed.' : queue.status === 'in_progress' ? 'Your consultation is in progress.' : 'You are in the queue.';
  const updatedAt = new Date();
  const joinedAt = new Date(queue.joinedAt);
  const joinedTime = formatQueueTime(joinedAt);
  const updatedTime = formatQueueTime(updatedAt);
  const waitingAtFront = queue.status === 'waiting' && Number(queue.peopleAhead) === 0;
  const estimate = queueEstimatePresentation(queue, updatedAt);
  document.querySelector('#joined-time').textContent = joinedTime ? `Joined ${joinedTime}` : 'Joined today';
  document.querySelector('#queue-last-updated').textContent = `Automatically updated ${updatedTime}`;
  document.querySelector('#people-ahead').textContent = queue.peopleAhead;
  const waitValue = document.querySelector('#estimated-wait');
  const waitLabel = document.querySelector('#wait-metric-label');
  const timeRange = document.querySelector('#estimated-time-range');
  waitValue.textContent = estimate.waitValue;
  waitLabel.textContent = estimate.waitLabel;
  timeRange.hidden = !estimate.clockText;
  timeRange.textContent = estimate.clockText;
  const stage = queue.status === 'in_progress' ? 3 : queue.status === 'called' ? 2 : 1;
  const journey = document.querySelector('.queue-journey');
  journey.dataset.stage = String(stage);
  const journeyTrack = document.querySelector('#queue-journey-track');
  journeyTrack.setAttribute('aria-valuenow', String(stage));
  journeyTrack.setAttribute('aria-valuetext', stage === 3 ? 'In consultation' : stage === 2 ? 'Called' : 'Joined, waiting for call');
  document.querySelector('#queue-journey-fill').style.width = `${stage / 3 * 100}%`;
  document.querySelector('#journey-message').textContent = stage === 3 ? 'Consultation in progress'
    : stage === 2 ? 'Please proceed to the clinic counter'
      : waitingAtFront ? 'Waiting for call' : `${queue.peopleAhead} ${Number(queue.peopleAhead) === 1 ? 'person' : 'people'} ahead`;
  document.querySelector('#status-notice-title').textContent = stage === 3 ? 'Consultation underway' : stage === 2 ? 'Please proceed now' : queue.reminderMessage ? 'Queue reminder' : 'Stay ready';
  document.querySelector('#status-notice-message').textContent = stage === 3 ? 'Your queue status will update after staff complete the consultation.'
    : stage === 2 ? 'Staff have called your queue number. Please proceed to the clinic counter.'
      : queue.reminderMessage || 'Queue position and remaining-wait estimate refresh every 30 seconds. Select Refresh status to update sooner.';
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
window.setInterval(() => {
  if (!document.hidden) loadQueueStatus(false);
}, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadQueueStatus(false); });

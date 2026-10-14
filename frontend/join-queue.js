fetch('/api/settings').then(response => response.json()).then(data => document.querySelectorAll('.brand small').forEach(item => { item.textContent = data.settings.clinicName; })).catch(() => {});
let selectedService = null;

function setDateText() {
  const formatted = new Intl.DateTimeFormat('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  document.querySelector('#current-date').textContent = formatted;
  document.querySelector('#confirm-date').textContent = formatted;
}

function updateJoinButton() {
  document.querySelector('#join-queue-button').disabled = !(selectedService && document.querySelector('#queue-agreement').checked);
}

function selectService(service, card) {
  selectedService = service;
  document.querySelectorAll('.queue-service-option').forEach((item) => {
    const selected = item === card;
    item.classList.toggle('selected', selected);
    item.setAttribute('aria-checked', String(selected));
  });
  document.querySelector('#confirm-service').textContent = service.name;
  updateJoinButton();
}

function renderServices(services) {
  const container = document.querySelector('#queue-services');
  if (!services.length) {
    container.innerHTML = '<p class="dashboard-empty">No services are available for queue registration.</p>';
    return;
  }
  const requestedId = Number(new URLSearchParams(window.location.search).get('service'));
  container.replaceChildren(...services.map((service) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'queue-service-option';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', 'false');
    card.innerHTML = '<span class="service-radio" aria-hidden="true"></span><span class="service-option-copy"><strong></strong><small></small></span>';
    card.querySelector('strong').textContent = service.name;
    card.querySelector('small').textContent = `${service.doctorName ? `Dr. ${service.doctorName} · ` : ''}${service.serviceDetails || service.description || 'Clinic consultation service.'}`;
    const full = service.queueCapacity && Number(service.activePatients) >= Number(service.queueCapacity);
    if (full) {
      card.disabled = true;
      const status = document.createElement('span');
      status.className = 'service-time';
      status.textContent = 'Queue full';
      card.append(status);
    }
    card.addEventListener('click', () => selectService(service, card));
    if (service.id === requestedId) queueMicrotask(() => selectService(service, card));
    return card;
  }));
}

async function loadJoinQueuePage() {
  setDateText();
  try {
    const [accountResponse, servicesResponse, queueResponse] = await Promise.all([
      fetch('/api/auth/me'), fetch('/api/patient/services'), fetch('/api/patient/queues/active'),
    ]);
    if (accountResponse.status === 401 || accountResponse.status === 403) {
      window.location.replace('/patient-login.html');
      return;
    }
    const account = await accountResponse.json();
    if (!accountResponse.ok) throw new Error(account.error || 'Your account could not be verified.');
    document.querySelector('#patient-name').textContent = account.user.fullName;
    document.querySelector('#confirm-patient').textContent = account.user.fullName;
    const queueData = await queueResponse.json();
    if (!queueResponse.ok) throw new Error(queueData.error || 'Your queue status could not be checked.');
    if (queueData.queue) {
      window.location.replace('/queue-status.html');
      return;
    }
    const servicesData = await servicesResponse.json();
    if (!servicesResponse.ok) throw new Error(servicesData.error);
    renderServices(servicesData.services);
  } catch (error) {
    const alert = document.querySelector('#page-alert');
    alert.textContent = error.message || 'The queue page could not be loaded.';
    alert.hidden = false;
  }
}

async function joinQueue() {
  const button = document.querySelector('#join-queue-button');
  const status = document.querySelector('#join-status');
  button.disabled = true;
  status.textContent = 'Joining the queue…';
  status.className = 'form-status';
  status.hidden = false;
  try {
    const response = await fetch('/api/patient/queues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: selectedService.id }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The queue could not be joined.');
    status.textContent = `Queue number ${formatQueueTicket(result.queue.serviceId, result.queue.queueNumber)} confirmed. Opening your queue status…`;
    setTimeout(() => window.location.assign('/queue-status.html?joined=true'), 800);
  } catch (error) {
    status.textContent = error.message;
    status.className = 'form-status error';
    button.disabled = false;
  }
}

document.querySelector('#queue-agreement').addEventListener('change', updateJoinButton);
document.querySelector('#join-queue-button').addEventListener('click', joinQueue);
document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.replace('/');
});
loadJoinQueuePage();

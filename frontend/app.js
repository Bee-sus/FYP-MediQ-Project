async function updateServerStatus() {
  const statusElement = document.querySelector('#server-status');

  try {
    const response = await fetch('/api/health');
    const health = await response.json();
    statusElement.textContent = `Server online · Database ${health.database}`;
    statusElement.classList.add('connected');
  } catch (error) {
    statusElement.textContent = 'Server status unavailable';
  }
}

function createServiceCard(service) {
  const card = document.createElement('article');
  card.className = 'service-card';

  const header = document.createElement('div');
  header.className = 'service-card-header';

  const name = document.createElement('h3');
  name.textContent = service.name;

  const availability = document.createElement('span');
  availability.className = 'service-availability';
  availability.textContent = service.availability;

  const description = document.createElement('p');
  description.textContent = service.description;

  const duration = document.createElement('span');
  duration.className = 'service-duration';
  duration.textContent = `Average duration: ${service.averageDurationMinutes} minutes`;

  header.append(name, availability);
  card.append(header, description, duration);
  return card;
}

async function loadClinicServices() {
  const servicesList = document.querySelector('#services-list');

  try {
    const response = await fetch('/api/services');
    if (!response.ok) {
      throw new Error('Clinic services could not be loaded.');
    }

    const data = await response.json();
    servicesList.replaceChildren(...data.services.map(createServiceCard));
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'services-message error';
    message.textContent = 'Clinic services are temporarily unavailable.';
    servicesList.replaceChildren(message);
  }
}

let noticeTimer;

function showDevelopmentNotice(feature) {
  const notice = document.querySelector('#demo-notice');
  notice.textContent = `${feature} is represented in the homepage prototype and will become functional in a later development milestone.`;
  notice.hidden = false;

  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.hidden = true;
  }, 4500);
}

function configureHomepageControls() {
  const audienceMessage = document.querySelector('#audience-message');
  const roleButtons = document.querySelectorAll('.role-button');

  roleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      roleButtons.forEach((roleButton) => {
        const isSelected = roleButton === button;
        roleButton.classList.toggle('active', isSelected);
        roleButton.setAttribute('aria-pressed', String(isSelected));
      });

      const role = button.dataset.role;
      audienceMessage.textContent = role === 'admin'
        ? 'Admin access selected · queue management and analytics will appear here.'
        : 'Patient access selected · queue and appointment tools will appear here.';
    });
  });

  document.querySelectorAll('[data-demo-action]').forEach((button) => {
    button.addEventListener('click', () => showDevelopmentNotice(button.dataset.demoAction));
  });

  document.querySelectorAll('[data-scroll-target]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelector(button.dataset.scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

updateServerStatus();
loadClinicServices();
configureHomepageControls();

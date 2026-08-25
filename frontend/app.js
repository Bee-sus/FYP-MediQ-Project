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

updateServerStatus();

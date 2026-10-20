/* Notifications are local browser alerts; no patient details leave this page. */
window.createQueueAlerts = function (role, container) {
  const key = role === 'staff' ? 'mediq-alert-options-staff-v2' : `mediq-alert-options-${role}`;
  let options = { sound: role === 'staff', browser: role === 'staff' };
  try { options = { ...options, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch (_) { /* Storage may be disabled. */ }
  const seen = new Set();
  let audio;
  container.className = 'queue-alert-options' + (role === 'staff' ? ' is-compact' : '');
  const controls = '<label><input type="checkbox" data-alert-sound /> Sound</label><button type="button" data-alert-browser>Enable browser alerts</button><button type="button" data-alert-test>Test alert</button><small role="status"></small>';
  const toastMarkup = '<div class="queue-auto-alert" data-alert-toast role="status" aria-live="polite" hidden><span></span><button type="button" data-alert-dismiss aria-label="Dismiss queue alert">Dismiss</button></div>';
  container.innerHTML = (role === 'staff'
    ? '<details class="alert-settings"><summary>Alert settings</summary><div class="alert-settings-panel" role="group" aria-label="Queue alert settings">' + controls + '</div></details>'
    : '<strong>Queue alerts</strong>' + controls) + toastMarkup;

  const sound = container.querySelector('[data-alert-sound]');
  const browser = container.querySelector('[data-alert-browser]');
  const message = container.querySelector('small');
  const toast = container.querySelector('[data-alert-toast]');
  container.querySelector('[data-alert-dismiss]').addEventListener('click', () => { toast.hidden = true; });
  sound.checked = options.sound;
  function save() { try { localStorage.setItem(key, JSON.stringify(options)); } catch (_) {} }
  function browserActive() { return options.browser && 'Notification' in window && Notification.permission === 'granted'; }
  function update() {
    browser.textContent = browserActive() ? 'Turn off browser alerts' : 'Enable browser alerts';
    browser.disabled = !('Notification' in window);
    message.textContent = !('Notification' in window) ? 'Browser alerts are unavailable here. Keep this page open for queue updates.'
      : Notification.permission === 'denied' ? 'Browser alerts are blocked. Change site permissions to enable them.'
        : role === 'staff' ? 'On-page alerts are automatic. Desktop alerts use your browser permission. Sound starts after you interact with this page.' : 'Keep this page open. Sound may require a click after reopening the page.';
  }
  async function unlockAudio() {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (Audio) { audio ||= new Audio(); await audio.resume().catch(() => {}); }
    } catch (_) {}
  }
  function beep() {
    if (!options.sound || !audio || audio.state !== 'running') return;
    try {
      const tone = audio.createOscillator(); const gain = audio.createGain();
      tone.connect(gain); gain.connect(audio.destination);
      tone.frequency.value = 740; gain.gain.setValueAtTime(0.08, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35);
      tone.start(); tone.stop(audio.currentTime + 0.35);
    } catch (_) {}
  }
  sound.addEventListener('change', () => { options.sound = sound.checked; if (options.sound) unlockAudio(); save(); });
  document.addEventListener('pointerdown', () => { if (options.sound) unlockAudio(); }, { once: true });
  document.addEventListener('keydown', () => { if (options.sound) unlockAudio(); }, { once: true });
  if (options.sound) unlockAudio();
  browser.addEventListener('click', async () => {
    if (browserActive()) { options.browser = false; save(); update(); return; }
    try { options.browser = await Notification.requestPermission() === 'granted'; save(); update(); }
    catch (_) { message.textContent = 'Browser alerts could not be enabled. Your on-page updates still work.'; }
  });
  function deliver(title, body) {
    toast.querySelector('span').textContent = `${title} — ${body}`;
    toast.hidden = false;
    beep();
    if (browserActive()) {
      try { const alert = new Notification(title, { body, tag: `mediq-${role}` }); alert.onclick = () => { window.focus(); alert.close(); }; }
      catch (_) { message.textContent = 'This browser cannot show alerts here. Use the on-page queue status.'; }
    }
  }
  container.querySelector('[data-alert-test]').addEventListener('click', async () => { await unlockAudio(); deliver('MediQ test alert', 'Queue alerts are ready.'); message.textContent = options.sound || browserActive() ? 'Test sent using your enabled options.' : 'Choose Sound or enable browser alerts first.'; });
  update();
  return {
    get backgroundEnabled() { return browserActive(); },
    notify(eventKey, title, body) {
      if (seen.has(eventKey)) return;
      seen.add(eventKey);
      try { if (sessionStorage.getItem(`mediq-event-${role}-${eventKey}`)) return; sessionStorage.setItem(`mediq-event-${role}-${eventKey}`, '1'); } catch (_) {}
      deliver(title, body);
    },
  };
};

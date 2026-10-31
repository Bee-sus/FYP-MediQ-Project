(function () {
  let timer;
  let signingOut = false;

  window.mediqFeedback = function (message, { type = 'success', title, retry, retryLabel = 'Try again' } = {}) {
    clearTimeout(timer);
    let toast = document.querySelector('#portal-feedback');
    if (!toast) {
      toast = document.createElement('section');
      toast.id = 'portal-feedback';
      toast.innerHTML = '<div class="portal-feedback-copy"><strong></strong><p></p><button type="button" class="portal-feedback-retry" hidden></button></div><button type="button" class="portal-feedback-close" aria-label="Dismiss message">×</button>';
      document.body.append(toast);
      toast.querySelector('.portal-feedback-close').onclick = () => { toast.hidden = true; clearTimeout(timer); };
    }
    toast.hidden = false;
    toast.dataset.type = type;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    toast.setAttribute('aria-atomic', 'true');
    toast.querySelector('strong').textContent = title || (type === 'error' ? 'Action could not be completed' : type === 'warning' ? 'Change saved' : 'Done');
    toast.querySelector('p').textContent = message;
    const retryButton = toast.querySelector('.portal-feedback-retry');
    retryButton.hidden = !retry;
    retryButton.textContent = retryLabel;
    retryButton.disabled = false;
    retryButton.onclick = async () => {
      if (retryButton.disabled) return;
      retryButton.disabled = true;
      retryButton.textContent = 'Please wait…';
      try { await retry(); }
      catch (_) { window.mediqFeedback('Please check your connection and try again.', { type: 'error', retry }); }
      finally { retryButton.disabled = false; retryButton.textContent = retryLabel; }
    };
    if (type === 'success' && !retry) timer = setTimeout(() => { toast.hidden = true; }, 6000);
  };

  window.mediqSignOut = async function (button) {
    if (signingOut || !button || button.disabled) return false;
    signingOut = true;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Signing out…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', signal: controller.signal });
      if (!response.ok && response.status !== 401) throw new Error('Sign-out failed');
      window.location.replace('/');
      return true;
    } catch (_) {
      window.mediqFeedback('Sign-out was not confirmed. Check your connection and try again.', {
        type: 'error', title: 'Could not sign out', retry: () => window.mediqSignOut(button),
      });
      return false;
    } finally {
      clearTimeout(timeout);
      signingOut = false;
      button.disabled = false;
      button.textContent = original;
    }
  };
}());

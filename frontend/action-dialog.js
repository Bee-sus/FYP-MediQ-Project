/* Shared confirmations keep keyboard focus and validation inside the page. */
window.mediqDialog = function ({ title, message = '', confirmLabel = 'Confirm', reason = false, danger = false }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'mediq-action-dialog';
    dialog.setAttribute('aria-labelledby', 'mediq-action-title');
    dialog.setAttribute('aria-describedby', 'mediq-action-message');
    dialog.innerHTML = '<form><p class="mediq-dialog-eyebrow">Confirm action</p><h2 id="mediq-action-title"></h2><p id="mediq-action-message"></p><label class="mediq-dialog-reason" hidden>Cancellation reason<textarea rows="3" maxlength="300" placeholder="Briefly explain why this entry is being cancelled" aria-describedby="mediq-reason-hint mediq-reason-error"></textarea><small id="mediq-reason-hint">3–300 characters</small><span id="mediq-reason-error" role="alert"></span></label><div class="mediq-dialog-actions"><button type="button" class="mediq-dialog-back">Go back</button><button type="submit" class="mediq-dialog-confirm"></button></div></form>';
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('#mediq-action-message').textContent = message;
    const confirm = dialog.querySelector('.mediq-dialog-confirm');
    confirm.textContent = confirmLabel;
    if (danger) confirm.classList.add('is-danger');
    const input = dialog.querySelector('textarea');
    dialog.querySelector('label').hidden = !reason;
    let result = null;
    dialog.querySelector('.mediq-dialog-back').addEventListener('click', () => dialog.close());
    dialog.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (reason && (value.length < 3 || value.length > 300)) {
        dialog.querySelector('#mediq-reason-error').textContent = 'Enter a reason between 3 and 300 characters.';
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      result = reason ? value : true;
      dialog.close();
    });
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      dialog.querySelector('#mediq-reason-error').textContent = '';
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(result);
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    (reason ? input : dialog.querySelector('.mediq-dialog-back')).focus();
  });
};

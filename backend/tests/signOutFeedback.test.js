const fs = require('fs');
const path = require('path');
const vm = require('vm');

function signOutUi(fetch) {
  const window = { location: { replace: jest.fn() } };
  const context = vm.createContext({ window, fetch, AbortController, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/portal-feedback.js'), 'utf8'), context);
  window.mediqFeedback = jest.fn();
  const button = { disabled: false, textContent: 'Sign out' };
  return { window, button, run: () => window.mediqSignOut(button) };
}

test.each([200, 204, 401])('sign out leaves the page only after success or an expired session (%i)', async status => {
  const fetch = jest.fn().mockResolvedValue({ ok: status < 300, status });
  const ui = signOutUi(fetch);
  expect(await ui.run()).toBe(true);
  expect(ui.window.location.replace).toHaveBeenCalledWith('/');
  expect(ui.window.mediqFeedback).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
});

test('failed sign out keeps the user on the page and offers a real retry', async () => {
  const fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, status: 200 });
  const ui = signOutUi(fetch);
  expect(await ui.run()).toBe(false);
  expect(ui.window.location.replace).not.toHaveBeenCalled();
  expect(ui.button).toEqual({ disabled: false, textContent: 'Sign out' });
  const [, options] = ui.window.mediqFeedback.mock.calls[0];
  expect(options).toMatchObject({ type: 'error', title: 'Could not sign out' });
  await options.retry();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(ui.window.location.replace).toHaveBeenCalledWith('/');
});

test('network failure restores the sign out control and is not an unhandled rejection', async () => {
  const ui = signOutUi(jest.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  expect(await ui.run()).toBe(false);
  expect(ui.window.location.replace).not.toHaveBeenCalled();
  expect(ui.button.disabled).toBe(false);
  expect(ui.window.mediqFeedback.mock.calls[0][0]).toContain('not confirmed');
});

test('rapid repeated sign out clicks send only one request', async () => {
  let complete;
  const fetch = jest.fn(() => new Promise(resolve => { complete = resolve; }));
  const ui = signOutUi(fetch);
  const first = ui.run();
  await ui.run();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(ui.button.disabled).toBe(true);
  complete({ ok: true, status: 200 });
  await first;
});

test('a stalled sign out times out and restores the retry controls', async () => {
  jest.useFakeTimers();
  try {
    const fetch = jest.fn((_, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Request aborted')));
    }));
    const ui = signOutUi(fetch);
    const pending = ui.run();
    await jest.advanceTimersByTimeAsync(10000);
    expect(await pending).toBe(false);
    expect(ui.button.disabled).toBe(false);
    expect(ui.window.mediqFeedback).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

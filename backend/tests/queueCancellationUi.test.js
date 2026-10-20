const fs = require('fs');
const path = require('path');
const vm = require('vm');

function cancellationUi(fetch) {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/queue-status.js'), 'utf8');
  const submit = { disabled: false };
  const form = { querySelector: () => submit, setAttribute() {}, removeAttribute() {} };
  const nodes = {
    '#cancel-form': form, '#keep-queue': {}, '#cancel-error': {},
    '#cancellation-reason': { value: 'Changed plans' }, '#status-alert': {},
    '#cancel-dialog': { close: jest.fn() },
  };
  const context = vm.createContext({ fetch, document: { querySelector: key => nodes[key] }, renderNoQueue: jest.fn() });
  vm.runInContext('let activeQueue = { id: 42 }; let cancellationPending = false; let arrivalPending = false;\n' +
    source.slice(source.indexOf('async function cancelQueue(event)'), source.indexOf("document.querySelector('#refresh-queue').addEventListener")), context);
  return { context, nodes, submit, cancel: () => context.cancelQueue({ preventDefault() {} }) };
}

test('blocks repeated cancellation requests while saving and restores controls afterwards', async () => {
  let complete;
  const fetch = jest.fn(() => new Promise(resolve => { complete = resolve; }));
  const ui = cancellationUi(fetch);
  const first = ui.cancel();
  await ui.cancel();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(ui.submit.disabled).toBe(true);
  complete({ ok: true, json: async () => ({ message: 'Cancelled' }) });
  await first;
  expect(ui.submit.disabled).toBe(false);
  expect(ui.nodes['#cancel-dialog'].close).toHaveBeenCalledTimes(1);
});

test('keeps reason and dialog after connection failure and allows retry', async () => {
  const fetch = jest.fn().mockRejectedValueOnce(new Error('Failed to fetch'))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Cancelled' }) });
  const ui = cancellationUi(fetch);
  await ui.cancel();
  expect(ui.nodes['#cancel-error'].textContent).toContain('not confirmed');
  expect(ui.nodes['#cancellation-reason'].value).toBe('Changed plans');
  expect(ui.nodes['#cancel-dialog'].close).not.toHaveBeenCalled();
  expect(ui.submit.disabled).toBe(false);
  await ui.cancel();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('rejects whitespace-only reasons without sending a cancellation', async () => {
  const fetch = jest.fn();
  const ui = cancellationUi(fetch);
  ui.nodes['#cancellation-reason'].value = '   ';
  await ui.cancel();
  expect(fetch).not.toHaveBeenCalled();
});

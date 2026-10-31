const fs = require('fs');
const path = require('path');
const vm = require('vm');
const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/database');
afterEach(() => jest.restoreAllMocks());
afterAll(() => pool.end());
function noticeDb({ failAudit = false, exists = true } = {}) {
  jest.spyOn(pool, 'execute').mockResolvedValue([[{ id: 2, role: 'staff' }]]);
  const connection = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    execute: jest.fn(async sql => {
      if (sql.startsWith('SELECT')) return [exists ? [{ id: 1 }] : []];
      if (sql.includes('staff_audit_logs') && failAudit) throw new Error('offline');
      return [{ affectedRows: 1 }];
    }) };
  jest.spyOn(pool, 'getConnection').mockResolvedValue(connection);
  return connection;
}
const save = notice => request(app).patch('/api/staff/services/1/notice').set('Cookie', 'mediq_session=test').send({ notice });
test.each(['Doctor delayed', ''])('staff can publish or clear a notice: %s', async notice => {
  const db = noticeDb();
  const response = await save(notice);
  expect(response.status).toBe(200);
  expect(response.body.delayNotice).toBe(notice || null);
  expect(db.execute.mock.calls[1][1]).toEqual([notice || null, 1]);
  expect(db.commit).toHaveBeenCalledTimes(1);
});
test.each(['x', 'a'.repeat(301), 4])('invalid notice is rejected', async notice => {
  const db = noticeDb();
  expect((await save(notice)).status).toBe(422);
  expect(db.beginTransaction).not.toHaveBeenCalled();
});
test('patient cannot publish a staff notice', async () => {
  jest.spyOn(pool, 'execute').mockResolvedValue([[{ id: 7, role: 'patient' }]]);
  expect((await save('Doctor delayed')).status).toBe(403);
});
test('notice is rolled back if audit persistence fails', async () => {
  const db = noticeDb({ failAudit: true });
  expect((await save('Doctor delayed')).status).toBe(503);
  expect(db.rollback).toHaveBeenCalled();
  expect(db.commit).not.toHaveBeenCalled();
});
test('unknown service cannot receive a notice', async () => {
  noticeDb({ exists: false });
  expect((await save('Doctor delayed')).status).toBe(404);
});
test('search matches names and tickets while respecting status without modifying entries', () => {
  const context = vm.createContext({ formatQueueTicket: (service, number) => `Q${service}-${String(number).padStart(3, '0')}` });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/queue-tools.js'), 'utf8'), context);
  const entry = Object.freeze({ patientName: 'Dylan Ng', serviceId: 2, queueNumber: 3, status: 'waiting' });
  expect(context.matchesQueueFilter(entry, 'DYLAN', '')).toBe(true);
  expect(context.matchesQueueFilter(entry, 'q2-003', 'waiting')).toBe(true);
  expect(context.matchesQueueFilter(entry, 'Dylan', 'called')).toBe(false);
  expect(context.matchesQueueFilter(entry, 'someone else', '')).toBe(false);
});

function alertHarness(browserEnabled, permission = 'granted', role = 'patient') {
  const nodes = {};
  for (const key of ['[data-alert-sound]', '[data-alert-browser]', '[data-alert-test]', 'small', '[data-alert-toast]', '[data-alert-dismiss]']) nodes[key] = { addEventListener: jest.fn() };
  const toastText = {}; nodes['[data-alert-toast]'].querySelector = () => toastText;
  const storage = new Map();
  const Notification = jest.fn(); Notification.permission = permission;
  Notification.requestPermission = jest.fn(async () => 'granted');
  const popupNodes = {h2:{},p:{}};
  const popup = {style:{},querySelector: selector=>popupNodes[selector],showModal:jest.fn()};
  const context = vm.createContext({
    window: { Notification }, Notification,
    document: { addEventListener: jest.fn(), querySelector: () => popup },
    localStorage: { getItem: () => browserEnabled === undefined ? null : JSON.stringify({ browser: browserEnabled, sound: false }), setItem: jest.fn() },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/queue-alerts.js'), 'utf8'), context);
  return { alerts: context.window.createQueueAlerts(role, { querySelector: key => nodes[key] }), Notification, nodes, popup, popupNodes };
}

test('patient call displays an on-page popup once per event', () => {
  const {alerts,popup,popupNodes}=alertHarness(false);
  alerts.notify('called-1','Your turn','Please proceed');
  alerts.notify('called-1','Your turn','Please proceed');
  expect(popup.showModal).toHaveBeenCalledTimes(1);
  expect(popupNodes.h2.textContent).toBe('Your turn');
  expect(popupNodes.p.textContent).toBe('Please proceed');
});
test('browser alerts are opt-in and never request permission automatically', () => {
  const { alerts, Notification } = alertHarness(false);
  alerts.notify('called-1', 'Called', 'Proceed');
  expect(Notification).not.toHaveBeenCalled();
  expect(Notification.requestPermission).not.toHaveBeenCalled();
  expect(alerts.backgroundEnabled).toBe(false);
});
test('repeated refresh does not send the same alert again', () => {
  const { alerts, Notification } = alertHarness(true);
  alerts.notify('called-1', 'Called', 'Proceed');
  alerts.notify('called-1', 'Called', 'Proceed');
  alerts.notify('called-2', 'Called again', 'Proceed');
  expect(Notification).toHaveBeenCalledTimes(2);
});
test('blocked browser notifications preserve on-page operation', () => {
  const { alerts, Notification } = alertHarness(true, 'denied');
  expect(() => alerts.notify('called-1', 'Called', 'Proceed')).not.toThrow();
  expect(Notification).not.toHaveBeenCalled();
  expect(alerts.backgroundEnabled).toBe(false);
});

test('staff alerts reuse granted browser permission automatically on first visit', () => {
  const { alerts, Notification, nodes } = alertHarness(undefined, 'granted', 'staff');
  expect(nodes['[data-alert-sound]'].checked).toBe(true);
  alerts.notify('new-arrival', 'Patient arrived', 'Review the queue');
  expect(Notification).toHaveBeenCalledTimes(1);
  expect(Notification.requestPermission).not.toHaveBeenCalled();
  expect(nodes['[data-alert-toast]'].hidden).toBe(false);
});
test('automatic staff on-page alert works without browser permission', () => {
  const { alerts, Notification, nodes } = alertHarness(undefined, 'default', 'staff');
  alerts.notify('new-arrival', 'Patient arrived', 'Review the queue');
  expect(nodes['[data-alert-toast]'].hidden).toBe(false);
  expect(Notification).not.toHaveBeenCalled();
  expect(Notification.requestPermission).not.toHaveBeenCalled();
});
test('staff can retain a saved preference to disable desktop alerts', () => {
  const { alerts, Notification } = alertHarness(false, 'granted', 'staff');
  alerts.notify('new-arrival', 'Patient arrived', 'Review the queue');
  expect(Notification).not.toHaveBeenCalled();
});

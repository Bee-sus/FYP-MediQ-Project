require('dotenv').config();
const app = require('./app');
const { sendDueQueueReminders } = require('./services/queueReminderService');

const port = Number(process.env.PORT || 3000);

const server = app.listen(port, () => {
  console.log(`MediQ development server is running at http://localhost:${port}`);
  setTimeout(checkQueueReminders, 5000).unref();
  setInterval(checkQueueReminders, 30000).unref();
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Open the existing MediQ server, or set a different PORT in .env and restart.`
    : `MediQ could not start (${error.code || 'server error'}). Check the server configuration and retry.`);
  process.exitCode = 1;
});

let reminderSweepRunning = false;
async function checkQueueReminders() {
  if (reminderSweepRunning) return;
  reminderSweepRunning = true;
  try {
    await sendDueQueueReminders();
  } catch (error) {
    console.warn(`Queue reminders could not be checked: ${error.message}`);
  } finally {
    reminderSweepRunning = false;
  }
}

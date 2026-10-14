require('dotenv').config();
const app = require('./app');
const { sendDueQueueReminders } = require('./services/queueReminderService');

const port = Number(process.env.PORT || 3100);

app.listen(port, () => {
  console.log(`MediQ development server is running at http://localhost:${port}`);
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

setTimeout(checkQueueReminders, 5000).unref();
setInterval(checkQueueReminders, 30000).unref();

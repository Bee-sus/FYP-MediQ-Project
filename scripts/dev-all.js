const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const windows = process.platform === 'win32';
const venvPython = path.join(
  root,
  'ml-service',
  '.venv',
  windows ? 'Scripts' : 'bin',
  windows ? 'python.exe' : 'python',
);
const python = fs.existsSync(venvPython) ? venvPython : (windows ? 'python' : 'python3');
const nodemon = path.join(root, 'node_modules', 'nodemon', 'bin', 'nodemon.js');
const commands = [
  { name: 'MediQ web app', command: process.execPath, args: [nodemon, 'backend/src/server.js'] },
  {
    name: 'MediQ ML service',
    command: python,
    args: ['-m', 'uvicorn', 'app.main:app', '--app-dir', './ml-service', '--port', '8000'],
  },
];

let remaining = commands.length;
let shuttingDown = false;
let exitCode = 0;
const children = [];

function stopChildren(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

for (const task of commands) {
  console.log(`[${task.name}] Starting...`);
  const child = spawn(task.command, task.args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);

  child.on('error', (error) => {
    console.error(`[${task.name}] Could not start: ${error.message}`);
    exitCode = 1;
    stopChildren();
  });

  child.on('close', (code) => {
    remaining -= 1;
    if (!shuttingDown) {
      exitCode = code || 0;
      stopChildren();
    } else if (code && exitCode === 0) {
      exitCode = code;
    }
    if (remaining === 0) process.exit(exitCode);
  });
}

process.on('SIGINT', () => stopChildren('SIGINT'));
process.on('SIGTERM', () => stopChildren('SIGTERM'));

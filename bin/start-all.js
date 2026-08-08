#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

function run(cmd, args) {
  const p = spawn(cmd, args, { stdio: 'inherit', cwd: root, shell: false });
  p.on('exit', (code) => process.exit(code));
  p.on('error', (err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
}

if (require.main === module) {
  if (isWin) {
    const script = path.join(root, 'bin', 'start-services.ps1');
    run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script]);
  } else {
    const script = path.join(root, 'bin', 'start-services.sh');
    run('sh', [script]);
  }
}

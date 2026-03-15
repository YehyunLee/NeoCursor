#!/usr/bin/env node
'use strict';
process.env.NODE_ENV = 'development';
const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

const appPath = path.join(__dirname, '..');
console.error('[dev-runner] Starting Electron with path:', appPath);

const child = spawn(electron, [appPath], {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (err) => {
  console.error('[dev-runner] Failed to start Electron:', err.message);
  process.exit(1);
});

child.on('close', (code, signal) => {
  if (signal) {
    console.error('[dev-runner] Electron exited with signal:', signal);
  } else if (code !== null && code !== 0) {
    console.error('[dev-runner] Electron exited with code:', code);
  }
  process.exit(code !== null ? code : 1);
});

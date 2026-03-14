#!/usr/bin/env node
'use strict';
process.env.NODE_ENV = 'development';
const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

const child = spawn(electron, [path.join(__dirname, '..')], {
  stdio: 'inherit',
  env: process.env,
});

child.on('close', (code) => {
  process.exit(code !== null ? code : 1);
});

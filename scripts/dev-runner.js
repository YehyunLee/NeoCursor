#!/usr/bin/env node
'use strict';
process.env.NODE_ENV = 'development';
const { spawnSync } = require('child_process');
const path = require('path');
const electron = require('electron');
const result = spawnSync(electron, [path.join(__dirname, '..')], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status !== null ? result.status : 1);

'use strict';

// pm2 does not read .env files on its own, so we parse one here and hand the
// values to the process. Keeps the key out of the config and out of git.
const fs = require('node:fs');
const path = require('node:path');

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (key) env[key] = value;
  }
  return env;
}

const env = readEnvFile(path.join(__dirname, '.env'));

if (!env.GOVEE_API_KEY) {
  console.warn('[ecosystem] No GOVEE_API_KEY in .env - the app will exit on start.');
}

module.exports = {
  apps: [
    {
      name: 'govee-hdmi-switch',
      script: 'index.js',
      cwd: __dirname,
      env,
      autorestart: true,
      // A crash loop here means bad config, not a transient fault, so back off early.
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '150M',
      time: true,
    },
  ],
};

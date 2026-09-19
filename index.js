#!/usr/bin/env node
'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');

const API = 'https://openapi.api.govee.com/router/api/v1';

const KEY = process.env.GOVEE_API_KEY;
const SKU = process.env.GOVEE_SKU || '';
const DEVICE = process.env.GOVEE_DEVICE || '';
const PORT = Number(process.env.PORT || 8088);
const TOKEN = process.env.AUTH_TOKEN || '';

if (!KEY) {
  console.error('GOVEE_API_KEY is missing. Copy .env.template to .env and fill in your key.');
  process.exit(1);
}

// Always available: /hdmi1 .. /hdmi4. SOURCE_ALIASES adds readable names,
// e.g. "apple:1,ps5:2" -> /apple and /ps5.
function parseAliases(raw) {
  const sources = { hdmi1: 1, hdmi2: 2, hdmi3: 3, hdmi4: 4 };
  for (const pair of (raw || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [name, value] = pair.split(':').map((s) => s.trim());
    const port = Number(value);
    if (!name || !Number.isInteger(port) || port < 1 || port > 4) {
      console.warn(`SOURCE_ALIASES: skipping "${pair}" (expected name:1-4)`);
      continue;
    }
    sources[name.toLowerCase()] = port;
  }
  return sources;
}

const SOURCES = parseAliases(process.env.SOURCE_ALIASES);

async function govee(endpoint, payload, method = 'POST') {
  const res = await fetch(`${API}/${endpoint}`, {
    method,
    headers: { 'Govee-API-Key': KEY, 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify({ requestId: randomUUID(), payload }),
    signal: AbortSignal.timeout(10000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.code !== 200) {
    const err = new Error(body.msg || body.message || `Govee responded ${res.status}`);
    err.status = res.status === 429 ? 429 : res.status === 401 ? 401 : 502;
    throw err;
  }
  return body;
}

/** Lists the account's devices and suggests ready-made .env config for those with HDMI inputs. */
async function listDevices() {
  const { data } = await govee('user/devices', null, 'GET');
  const devices = data.map((d) => {
    const hdmi = d.capabilities.find((c) => c.instance === 'hdmiSource');
    return {
      name: d.deviceName,
      sku: d.sku,
      device: d.device,
      type: d.type.split('.').pop(),
      hdmiSource: hdmi ? hdmi.parameters.options.map((o) => `${o.name} = ${o.value}`) : null,
    };
  });
  const switchable = devices.filter((d) => d.hdmiSource);
  return {
    devices,
    hint: switchable.length
      ? 'Copy the lines under "config" into your .env for the device you want to control.'
      : 'No devices with hdmiSource found. This server controls Sync Box models (e.g. H6604).',
    config: switchable.map((d) => ({
      name: d.name,
      env: [`GOVEE_SKU=${d.sku}`, `GOVEE_DEVICE=${d.device}`, 'SOURCE_ALIASES=apple:1,ps5:2'],
    })),
  };
}

const control = (type, instance, value) =>
  govee('device/control', { sku: SKU, device: DEVICE, capability: { type, instance, value } });

const setPower = (on) => control('devices.capabilities.on_off', 'powerSwitch', on ? 1 : 0);
const setSource = (n) => control('devices.capabilities.mode', 'hdmiSource', n);

async function readState() {
  const { payload } = await govee('device/state', { sku: SKU, device: DEVICE });
  const caps = Object.fromEntries(payload.capabilities.map((c) => [c.instance, c.state.value]));
  const named = Object.keys(SOURCES)
    .filter((k) => !/^hdmi[1-4]$/.test(k))
    .find((k) => SOURCES[k] === caps.hdmiSource);
  return {
    online: caps.online === true,
    power: caps.powerSwitch === 1 ? 'on' : 'off',
    hdmi: caps.hdmiSource ?? null,
    source: caps.powerSwitch === 1 ? named || `hdmi${caps.hdmiSource}` : 'off',
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Govee's state endpoint lags a command by roughly 2 seconds, so we poll until it
// catches up rather than sleeping blindly and reporting stale data.
// The cap is 30 state calls per minute per device, hence few and widely spaced attempts.
async function confirm(matches) {
  let state;
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(attempt === 0 ? 2000 : 1200);
    state = await readState();
    if (matches(state)) return { ...state, confirmed: true };
  }
  return { ...state, confirmed: false };
}

async function selectSource(name) {
  const hdmi = SOURCES[name];
  // The box ignores source changes while powered off, so switch it on and give it a moment.
  if ((await readState()).power === 'off') {
    await setPower(true);
    await sleep(1500);
  }
  await setSource(hdmi);
  return confirm((s) => s.power === 'on' && s.hdmi === hdmi);
}

async function turnOff() {
  await setPower(false);
  return confirm((s) => s.power === 'off');
}

async function turnOn() {
  await setPower(true);
  return confirm((s) => s.power === 'on');
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2) + '\n');
}

const routes = () => ['/devices', '/status', '/off', '/on', ...Object.keys(SOURCES).map((s) => `/${s}`)];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname.replace(/\/+$/, '').toLowerCase() || '/';

  if (TOKEN) {
    const given = url.searchParams.get('token') || (req.headers.authorization || '').replace(/^Bearer /i, '');
    if (given !== TOKEN) return send(res, 401, { error: 'unauthorized' });
  }

  try {
    if (route === '/') return send(res, 200, { routes: routes(), device: SKU ? { sku: SKU, device: DEVICE } : null });
    if (route === '/devices') return send(res, 200, await listDevices());

    // Everything below controls a specific device.
    if (!SKU || !DEVICE) {
      return send(res, 503, {
        error: 'GOVEE_SKU and GOVEE_DEVICE are not set',
        hint: 'Call /devices to find them, then add them to your .env.',
      });
    }

    if (route === '/status') return send(res, 200, await readState());
    if (route === '/off') return send(res, 200, await turnOff());
    if (route === '/on') return send(res, 200, await turnOn());

    const name = route.slice(1);
    if (name in SOURCES) return send(res, 200, await selectSource(name));

    return send(res, 404, { error: 'unknown route', routes: routes() });
  } catch (err) {
    console.error(`${route} ->`, err.message);
    return send(res, err.status || 500, { error: err.message });
  }
});

// `node index.js --devices` prints the devices and exits, for building the config.
if (process.argv.includes('--devices')) {
  listDevices()
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((err) => {
      console.error('Could not fetch devices:', err.message);
      process.exit(1);
    });
} else {
  server.listen(PORT, () => {
    console.log(`govee-hdmi-switch listening on :${PORT}`);
    console.log(SKU && DEVICE ? `device: ${SKU} ${DEVICE}` : 'no device configured - call /devices');
    console.log(`routes: ${routes().join(' ')}`);
  });
}

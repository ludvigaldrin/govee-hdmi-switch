# govee-hdmi-switch

A tiny HTTP API for switching the HDMI source on a **Govee AI Sync Box** (H6604 and similar).
Meant to run on a Raspberry Pi so that `curl http://pi:8088/ps5` switches to the PS5 — handy
from Home Assistant, Homey, iOS Shortcuts, a Stream Deck, or a button on the wall.

Zero npm dependencies. Node 18 or later is all you need.

```sh
curl http://raspberrypi.local:8088/apple
# { "online": true, "power": "on", "hdmi": 1, "source": "apple", "confirmed": true }
```

## Getting started

**1. Get an API key.** In the Govee app: *Profile → About Us → Apply for API Key*.
The key arrives by email within a minute or so.

**2. Install.**

```sh
git clone https://github.com/ludvigaldrin/govee-hdmi-switch.git
cd govee-hdmi-switch
cp .env.template .env
```

Put the key in `.env` (`GOVEE_API_KEY=...`) and save.

**3. Find your device.**

```sh
npm run devices
```

This lists every device on the account and suggests ready-made config for the ones that
have HDMI inputs:

```json
{
  "devices": [
    { "name": "Living room", "sku": "H6076", "device": "XX:XX:...", "type": "light", "hdmiSource": null },
    { "name": "Sync Box",    "sku": "H6604", "device": "YY:YY:...", "type": "light",
      "hdmiSource": ["HDMI 1 = 1", "HDMI 2 = 2", "HDMI 3 = 3", "HDMI 4 = 4"] }
  ],
  "config": [
    { "name": "Sync Box", "env": ["GOVEE_SKU=H6604", "GOVEE_DEVICE=YY:YY:...", "SOURCE_ALIASES=apple:1,ps5:2"] }
  ]
}
```

Paste the lines under `config` into your `.env`. Adjust `SOURCE_ALIASES` to match what you
actually have plugged in — the format is `name:port`, and every name becomes a route.

**4. Run it.**

```sh
set -a; . ./.env; set +a
npm start
```

## Routes

| Route | Does |
|---|---|
| `GET /` | lists available routes and the configured device |
| `GET /devices` | every device on the account, plus suggested config |
| `GET /status` | current state, changes nothing (fast) |
| `GET /<alias>` | selects that input, e.g. `/apple` or `/ps5` |
| `GET /hdmi1` … `/hdmi4` | the same without aliases, always available |
| `GET /on` | powers on, keeping the current source |
| `GET /off` | powers off |

Every controlling route responds with the device state after the command:

```json
{ "online": true, "power": "on", "hdmi": 2, "source": "ps5", "confirmed": true }
```

`confirmed: false` means Govee acknowledged the command but the box did not report the new
state within ~6 s. It has usually gone through anyway — re-read it with `/status`.

Switching source powers the box on first if it is off, since it ignores source changes
while powered down.

## Configuration

Everything is set through environment variables, see [`.env.template`](.env.template).

| Variable | Required | Description |
|---|---|---|
| `GOVEE_API_KEY` | yes | The key from the Govee app |
| `GOVEE_SKU` | to control | Model number, e.g. `H6604`. From `npm run devices` |
| `GOVEE_DEVICE` | to control | Device ID. From `npm run devices` |
| `SOURCE_ALIASES` | no | `apple:1,ps5:2` → routes `/apple` and `/ps5` |
| `PORT` | no | Defaults to `8088` |
| `AUTH_TOKEN` | no | If set, requests need `?token=...` or `Authorization: Bearer ...` |

The server starts without `GOVEE_SKU`/`GOVEE_DEVICE` so that `/devices` is reachable;
controlling routes then answer `503` with an explanation.

## Running it as a service with pm2

`./start.sh` installs pm2 if it is missing and starts the server:

```sh
./start.sh
```

Useful commands afterwards:

```sh
pm2 logs govee-hdmi-switch      # follow logs
pm2 restart govee-hdmi-switch   # after editing .env
pm2 status
```

To start on boot, run `pm2 startup` once and follow the command it prints.

pm2 does not read `.env` by itself, so `ecosystem.config.js` parses it and passes the
values to the process. Restart with `--update-env` after changing `.env`.

## How it works, and what it cannot do

The server talks to [Govee's cloud API](https://developer.govee.com/reference/control-you-devices)
(`openapi.api.govee.com`), not to the box directly. That means the Pi needs internet access and
the box has to be online — but it also means this works across any network or VLAN layout.

A few things worth knowing:

- **State lags a command by about 2 seconds.** The server polls until the state matches rather
  than replying with stale data, so a source switch takes 3–5 s to return. `/status` is immediate.
- **Rate limits:** 720 commands/min per account, 120/min per device, 30 state calls/min per
  device, and roughly 10,000 calls per day. A source switch costs 1–2 commands plus 1–4 state
  calls, so the limits are invisible in normal use — but avoid polling `/status` more than
  once every couple of seconds.
- **`hdmiSource` can be read back**, unlike scenes and music mode, which Govee returns as empty
  strings. That is why the server can report the real state instead of just what it tried to set.
- **There is no push.** The API is polling only; there is no way to subscribe to changes made
  in the Govee app or with the buttons on the box.

## Security

`.env` is gitignored — never commit your API key or device IDs. The key grants full control
over **every** Govee device on the account, not just the Sync Box.

The server has no authentication by default, which is reasonable on a trusted home network.
If you expose it more widely, set `AUTH_TOKEN` and put it behind a reverse proxy with TLS.

## License

MIT

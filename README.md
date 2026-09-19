# govee-hdmi-switch

Ett litet HTTP-API för att växla HDMI-källa på en **Govee AI Sync Box** (H6604 m.fl.).
Tänkt att köras på en Raspberry Pi så att `curl http://pi:8088/ps5` byter till PS5 —
användbart från Home Assistant, Homey, iOS-genvägar, en Stream Deck eller en knapp på väggen.

Noll npm-beroenden. Bara Node 18 eller senare.

```sh
curl http://raspberrypi.local:8088/apple
# { "online": true, "power": "on", "hdmi": 1, "source": "apple", "confirmed": true }
```

## Kom igång

**1. Skaffa en API-nyckel.** I Govee-appen: *Profil → Om oss → Apply for API Key*.
Nyckeln mejlas till dig inom någon minut.

**2. Installera.**

```sh
git clone https://github.com/ludvigaldrin/govee-hdmi-switch.git
cd govee-hdmi-switch
cp .env.template .env
```

Lägg in nyckeln i `.env` (`GOVEE_API_KEY=...`) och spara.

**3. Hitta din enhet.**

```sh
npm run devices
```

Den listar alla enheter på kontot och föreslår färdig config för dem som har HDMI-ingångar:

```json
{
  "devices": [
    { "name": "Vardagsrum", "sku": "H6076", "device": "XX:XX:...", "type": "light", "hdmiSource": null },
    { "name": "Sync Box",   "sku": "H6604", "device": "YY:YY:...", "type": "light",
      "hdmiSource": ["HDMI 1 = 1", "HDMI 2 = 2", "HDMI 3 = 3", "HDMI 4 = 4"] }
  ],
  "config": [
    { "name": "Sync Box", "env": ["GOVEE_SKU=H6604", "GOVEE_DEVICE=YY:YY:...", "SOURCE_ALIASES=apple:1,ps5:2"] }
  ]
}
```

Klistra in raderna under `config` i din `.env`. Justera `SOURCE_ALIASES` så den matchar
vad du faktiskt har inkopplat — formatet är `namn:port`, och varje namn blir en route.

**4. Kör.**

```sh
set -a; . ./.env; set +a
npm start
```

## Routes

| Route | Gör |
|---|---|
| `GET /` | listar tillgängliga routes och konfigurerad enhet |
| `GET /devices` | alla enheter på kontot + förslag på config |
| `GET /status` | nuvarande läge, ändrar inget (snabb) |
| `GET /<alias>` | väljer den ingången, t.ex. `/apple` eller `/ps5` |
| `GET /hdmi1` … `/hdmi4` | samma sak utan alias, finns alltid |
| `GET /on` | slår på, behåller nuvarande källa |
| `GET /off` | stänger av |

Alla styrande routes svarar med enhetens läge efter kommandot:

```json
{ "online": true, "power": "on", "hdmi": 2, "source": "ps5", "confirmed": true }
```

`confirmed: false` betyder att Govee kvitterade kommandot men att boxen inte hann
rapportera det nya läget inom ~6 s. Det har oftast gått fram ändå — läs om med `/status`.

Källbyte slår på boxen först om den är avstängd, eftersom den inte tar emot
källbyten i avstängt läge.

## Konfiguration

Allt sätts via miljövariabler, se [`.env.template`](.env.template).

| Variabel | Krävs | Beskrivning |
|---|---|---|
| `GOVEE_API_KEY` | ja | Nyckeln från Govee-appen |
| `GOVEE_SKU` | för styrning | Modellnummer, t.ex. `H6604`. Från `npm run devices` |
| `GOVEE_DEVICE` | för styrning | Enhetens ID. Från `npm run devices` |
| `SOURCE_ALIASES` | nej | `apple:1,ps5:2` → routes `/apple` och `/ps5` |
| `PORT` | nej | Standard `8088` |
| `AUTH_TOKEN` | nej | Om satt krävs `?token=...` eller `Authorization: Bearer ...` |

Servern startar även utan `GOVEE_SKU`/`GOVEE_DEVICE` så att `/devices` går att anropa;
styrande routes svarar då `503` med en förklaring.

## Köra som tjänst på en Raspberry Pi

Kontrollera att Node är v18+ (`node -v`); annars installera via
[NodeSource](https://github.com/nodesource/distributions), Raspbians paket är ofta äldre.

```sh
git clone https://github.com/ludvigaldrin/govee-hdmi-switch.git /home/pi/govee-hdmi-switch
cd /home/pi/govee-hdmi-switch
cp .env.template .env && nano .env

sudo cp govee-hdmi-switch.service /etc/systemd/system/
sudo systemctl enable --now govee-hdmi-switch
systemctl status govee-hdmi-switch
```

Loggar: `journalctl -u govee-hdmi-switch -f`

Unit-filen antar användaren `pi` och sökvägen `/home/pi/govee-hdmi-switch` — justera vid behov.

## Hur det fungerar, och begränsningar

Servern pratar med [Govees moln-API](https://developer.govee.com/reference/control-you-devices)
(`openapi.api.govee.com`), inte med boxen direkt. Det betyder att Pi:n behöver internet och
att boxen måste vara online — men också att det fungerar oavsett nät och VLAN.

Några saker som är värda att känna till:

- **State släpar ~2 sekunder efter ett kommando.** Servern pollar tills läget stämmer i stället
  för att svara med gammal data, så ett källbyte tar 3–5 s att returnera. `/status` är direkt.
- **Rate limits:** 720 kommandon/min per konto, 120/min per enhet, 30 state-anrop/min per enhet,
  och ~10 000 anrop per dygn. Ett källbyte kostar 1–2 kommandon plus 1–4 state-anrop, så
  gränserna märks inte vid normal användning — men undvik att polla `/status` oftare än
  varannan sekund.
- **`hdmiSource` går att läsa tillbaka**, till skillnad från t.ex. scener och musikläge som
  Govee returnerar som tomma strängar. Därför kan servern rapportera verkligt läge och inte
  bara vad den försökte sätta.
- **Ingen push.** API:et är rent polling; det finns inget sätt att prenumerera på ändringar
  som görs i Govee-appen eller på boxens knappar.

## Säkerhet

`.env` är gitignorerad — checka aldrig in din API-nyckel eller dina enhets-ID:n.
Nyckeln ger full kontroll över **alla** Govee-enheter på kontot, inte bara Sync Boxen.

Servern har ingen autentisering som standard, vilket är rimligt på ett betrott hemnät.
Exponerar du den bredare: sätt `AUTH_TOKEN` och lägg den bakom en reverse proxy med TLS.

## Licens

MIT

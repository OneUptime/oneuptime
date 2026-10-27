# SMS- og anropsgateway

OneUptime kan sende SMS og anrop gjennom en gateway du selv drifter, i stedet for Twilio. Bruk den når reglene dine krever at hver melding går gjennom din egen SMS- og taleleverandør, eller gjennom et system som kontrollerer den før den forlater nettverket ditt. OneUptime sender hver SMS og hvert anrop til gatewayen din som en signert JSON-forespørsel, og gatewayen din leverer den.

:::cards
- [Sett opp gatewayen](#sett-opp-gatewayen): En URL, og en signeringshemmelighet som lages for deg.
- [Hva gatewayen din mottar](#hva-gatewayen-din-mottar): Én signert JSON-forespørsel per SMS eller anrop.
- [Handle på en tilkalling](#handle-på-en-tilkalling): Bekreft, eskaler eller løs fra et anrop eller et svar.
- [Levering og nye forsøk](#levering-og-nye-forsøk): Hva som skjer når gatewayen din er nede.
:::

## Slik fungerer det

```mermaid title="En SMS gjennom din egen gateway"
flowchart LR
    OneUptime["OneUptime"]
    Gateway["Gatewayen din"]
    Provider["SMS- og taleleverandøren din"]
    Phone["Telefon"]
    OneUptime -->|"signert JSON-forespørsel"| Gateway
    Gateway --> Provider
    Provider --> Phone
```

Gatewayen tar plassen til serverens egen Twilio-konto for alt som ellers ville gått gjennom den: vakttilkallinger, varsler, verifiseringskoder og SMS til abonnenter på statussider. Prosjekter som legger til sin egen Twilio-konfigurasjon på kortet **Twilio-konfigurasjon** under **Prosjektinnstillinger > Varsler > Varselinnstillinger**, sender fortsatt gjennom den konfigurasjonen. Hvert prosjekts brytere for SMS og anrop, og saldoen der fakturering er slått på, kontrolleres som for Twilio.

## Sett opp gatewayen

:::steps
1. I Admin Dashboard går du til **Innstillinger > Anrop og SMS** og klikker på **Edit Provider** på kortet **SMS and Call Provider**.
2. Velg **Your own gateway**, og skriv inn **Gateway URL**. Gatewayen kan ligge på det private nettverket ditt.
3. Lagre. OneUptime lager en signeringshemmelighet for deg. Kopier den fra kortet inn i gatewayen din.
4. Klikk på **Send Test**. Gatewayen din skal svare med en 2xx-status og ikke sende noe.
:::

For å bytte ut hemmeligheten tømmer du **Signing Secret** under **Flere felt** og lagrer: OneUptime lager en ny. For å gå tilbake til Twilio velger du **Twilio** og lagrer.

## Hva gatewayen din mottar

Hver SMS og hvert anrop er én `POST`-forespørsel med en JSON-body og disse headerne:

| Header | Verdi |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-OneUptime-Event` | `sms`, `call` eller `test` |
| `X-OneUptime-Signature` | `sha256=` etterfulgt av HMAC-SHA256 av bodyen i heks, med signeringshemmeligheten som nøkkel |
| `User-Agent` | `OneUptime-CallAndSmsGateway/1.0` |

```json title="An on-call page by SMS"
{
  "version": 1,
  "event": "sms",
  "id": "7c5b0d0e-3e5f-4d1a-9a4f-2b8e6c1d9f00",
  "sentAt": "2026-10-27T09:30:00.000Z",
  "to": "+15551234567",
  "message": "OneUptime: A new alert has been created. Alert #42: Database is down…",
  "isSensitive": false,
  "project": {
    "id": "0f6b8c3a-1d2e-4f5a-8b9c-0d1e2f3a4b5c",
    "name": "Production"
  },
  "actions": {
    "acknowledge": "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/acknowledge?token=…",
    "escalate": "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/escalate?token=…",
    "resolve": "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/resolve?token=…"
  }
}
```

| Felt | Hva det er |
| --- | --- |
| `version` | Alltid `1` for denne formen. Det blir bare lagt til felt i den. |
| `event` | `sms`, `call` eller `test`, som i `X-OneUptime-Event`. |
| `id` | Unik for denne meldingen, og den samme i hvert forsøk på å levere den: Bruk den til å se bort fra en melding du allerede har sendt. |
| `sentAt` | Når OneUptime sendte den, i ISO 8601. |
| `to` | Telefonnummeret, i E.164-format. `null` i en test. |
| `message` | SMS-en, eller det anropet sier. En SMS er på høyst 1 600 tegn, og teksten i et anrop på høyst 16 384. En lengre tekst kuttes og slutter med en merknad om at resten finnes i OneUptime. |
| `isSensitive` | `true` for en verifiseringskode. Hold meldingen utenfor dine egne logger. |
| `project` | Prosjektets `id` og `name`, eller `null` når ikke noe prosjekt sendte den. |
| `actions` | For en vakttilkalling lenkene som handler på den. Ellers `null`. |

Et anrop beskrives i stedet for å skrives som et manus: `message` er det anropet sier, uten Twilios «trykk 1 for å bekrefte». Tilby handlingene på din egen måte, for eksempel med tastetrykk, og kall den tilsvarende lenken.

### Kontroller signaturen

Regn ut HMAC-en av forespørselens rå body før du parser den, og sammenlign den med headeren. Kontrollen er den samme som for en [egendefinert kanal](/docs/self-hosted/custom-notification-channels#kontroller-signaturen), så én verifikator holder for begge:

```javascript title="Node.js"
const crypto = require("crypto");

function isFromOneUptime(rawBody, signatureHeader, secret) {
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = String(signatureHeader || "");

  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  );
}
```

## Handle på en tilkalling

Når personen svarer under et anrop eller med et svar, sender gatewayen din en `POST`-forespørsel til den tilsvarende lenken i `actions`. Lenkene fungerer som lenkene til en egendefinert kanal: De trenger ingen API-nøkkel, hver har med seg et token som bare gjelder den ene tilkallingen og er gyldig i 7 dager, og handlingen registreres som utført av personen som ble tilkalt. Se [Handle på en tilkalling](/docs/self-hosted/custom-notification-channels#handle-på-en-tilkalling) for hver handling og svaret.

```bash title="Acknowledge a page"
curl -X POST "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/acknowledge?token=…"
```

## Levering og nye forsøk

En forespørsel regnes som levert når gatewayen din svarer med en 2xx-status innen 10 sekunder. En forespørsel den ikke svarte på, eller svarte på med 408, 429 eller en 5xx-status, sendes på nytt etter 1 sekund og etter ytterligere 4 sekunder: tre forsøk i alt. Ved alle andre 4xx-statuser sendes den ikke på nytt.

SMS- eller anropsloggen, og for en vakttilkalling personens vaktlogg, sier `Sent to the SMS and call gateway (HTTP 200).` eller hvorfor meldingen ikke ble levert, aldri URL-en. OneUptime får ikke vite om meldingen nådde telefonen, så en SMS vises som sendt så snart gatewayen din godtar den, og nummeret den gikk ut fra, står tomt.

## Testforespørsler

**Send test** sender en forespørsel med `event` satt til `test`, og `to`, `project` og `actions` satt til `null`. Svar på den med en 2xx-status, og send ingenting.

## Neste steg

:::cards
- [Egendefinerte varslingskanaler](/docs/self-hosted/custom-notification-channels): Tilkall folk gjennom din egen app.
- [Push-varsler](/docs/self-hosted/push-notifications): Slå av push for hele serveren.
- [Twilio-integrasjon](/docs/self-hosted/twilio-integration): Send gjennom Twilio i stedet.
- [Tilgang til privat nettverk](/docs/self-hosted/private-network-access): Hva serveren din kan nå på ditt eget nettverk.
:::

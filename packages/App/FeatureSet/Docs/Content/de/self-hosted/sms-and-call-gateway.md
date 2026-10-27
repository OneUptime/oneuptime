# SMS- und Anruf-Gateway

OneUptime kann seine SMS und Anrufe statt über Twilio über ein Gateway senden, das Sie selbst betreiben. Nutzen Sie es, wenn Ihre Vorgaben verlangen, dass jede Nachricht über Ihren eigenen SMS- und Sprachanbieter läuft oder über ein System, das sie prüft, bevor sie Ihr Netzwerk verlässt. OneUptime sendet jede SMS und jeden Anruf als signierte JSON-Anfrage an Ihr Gateway, und Ihr Gateway stellt sie zu.

:::cards
- [Gateway einrichten](#gateway-einrichten): Eine URL und ein Signaturgeheimnis, das für Sie erzeugt wird.
- [Was Ihr Gateway empfängt](#was-ihr-gateway-empfängt): Eine signierte JSON-Anfrage pro SMS oder Anruf.
- [Auf einen Alarm reagieren](#auf-einen-alarm-reagieren): Bestätigen, eskalieren oder beheben, direkt aus einem Anruf oder einer Antwort.
- [Zustellung und Wiederholungen](#zustellung-und-wiederholungen): Was passiert, wenn Ihr Gateway nicht erreichbar ist.
:::

## So funktioniert es

```mermaid title="Eine SMS über Ihr eigenes Gateway"
flowchart LR
    OneUptime["OneUptime"]
    Gateway["Ihr Gateway"]
    Provider["Ihr SMS- und Sprachanbieter"]
    Phone["Telefon"]
    OneUptime -->|"signierte JSON-Anfrage"| Gateway
    Gateway --> Provider
    Provider --> Phone
```

Das Gateway tritt an die Stelle des eigenen Twilio-Kontos des Servers, für alles, was darüber laufen würde: Bereitschaftsalarme, Benachrichtigungen, Verifizierungscodes und SMS an Abonnenten von Statusseiten. Projekte, die auf der Karte **Twilio-Konfiguration** unter **Projekteinstellungen > Benachrichtigungen > Benachrichtigungseinstellungen** eine eigene Twilio-Konfiguration hinzufügen, senden weiterhin über diese Konfiguration. Die SMS- und Anrufschalter jedes Projekts und, wo die Abrechnung eingeschaltet ist, sein Guthaben werden wie bei Twilio geprüft.

## Gateway einrichten

:::steps
1. Gehen Sie im Admin Dashboard zu **Einstellungen > Anrufe und SMS** und klicken Sie auf der Karte **SMS and Call Provider** auf **Edit Provider**.
2. Wählen Sie **Your own gateway** und geben Sie die **Gateway URL** ein. Das Gateway kann in Ihrem privaten Netzwerk liegen.
3. Speichern Sie. OneUptime erzeugt ein Signaturgeheimnis für Sie. Kopieren Sie es von der Karte in Ihr Gateway.
4. Klicken Sie auf **Send Test**. Ihr Gateway sollte mit einem 2xx-Status antworten und nichts senden.
:::

Um das Geheimnis zu ersetzen, leeren Sie **Signing Secret** unter **Weitere Felder** und speichern: OneUptime erzeugt ein neues. Um zu Twilio zurückzukehren, wählen Sie **Twilio** und speichern.

## Was Ihr Gateway empfängt

Jede SMS und jeder Anruf ist eine `POST`-Anfrage mit einem JSON-Body und diesen Headern:

| Header | Wert |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-OneUptime-Event` | `sms`, `call` oder `test` |
| `X-OneUptime-Signature` | `sha256=`, gefolgt vom HMAC-SHA256 des Bodys in Hex, mit dem Signaturgeheimnis als Schlüssel |
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

| Feld | Was es ist |
| --- | --- |
| `version` | Immer `1` für diese Form. Es kommen nur Felder hinzu. |
| `event` | `sms`, `call` oder `test`, wie in `X-OneUptime-Event`. |
| `id` | Eindeutig für diese Nachricht und bei jedem Zustellversuch gleich: Ignorieren Sie damit eine Nachricht, die Sie schon gesendet haben. |
| `sentAt` | Wann OneUptime sie gesendet hat, in ISO 8601. |
| `to` | Die Telefonnummer im E.164-Format. `null` bei einem Test. |
| `message` | Die SMS oder das, was der Anruf sagt. Eine SMS hat höchstens 1.600 Zeichen, der Text eines Anrufs höchstens 16.384. Ein längerer Text wird gekürzt und endet mit einem Hinweis, dass der Rest in OneUptime steht. |
| `isSensitive` | `true` bei einem Verifizierungscode. Halten Sie die Nachricht aus Ihren eigenen Logs heraus. |
| `project` | `id` und `name` des Projekts oder `null`, wenn kein Projekt sie gesendet hat. |
| `actions` | Bei einem Bereitschaftsalarm die Links, die auf ihn reagieren. Sonst `null`. |

Ein Anruf wird beschrieben, nicht als Skript vorgegeben: `message` ist das, was er sagt, ohne Twilios „Drücken Sie 1 zum Bestätigen“. Bieten Sie die Aktionen auf Ihre eigene Weise an, etwa per Tastendruck, und rufen Sie den passenden Link auf.

### Die Signatur prüfen

Berechnen Sie den HMAC des rohen Request-Bodys, bevor Sie ihn parsen, und vergleichen Sie ihn mit dem Header. Die Prüfung ist dieselbe wie bei einem [benutzerdefinierten Kanal](/docs/self-hosted/custom-notification-channels#die-signatur-prüfen), sodass eine Prüffunktion für beide reicht:

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

## Auf einen Alarm reagieren

Wenn die Person in einem Anruf oder mit einer Antwort reagiert, sendet Ihr Gateway eine `POST`-Anfrage an den passenden Link in `actions`. Die Links funktionieren wie die eines benutzerdefinierten Kanals: Sie brauchen keinen API-Schlüssel, jeder trägt ein Token nur für diesen einen Alarm, das 7 Tage gültig ist, und die Aktion wird als von der alarmierten Person ausgeführt erfasst. Unter [Auf einen Alarm reagieren](/docs/self-hosted/custom-notification-channels#auf-einen-alarm-reagieren) finden Sie jede Aktion und die Antwort.

```bash title="Acknowledge a page"
curl -X POST "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/acknowledge?token=…"
```

## Zustellung und Wiederholungen

Eine Anfrage gilt als zugestellt, wenn Ihr Gateway innerhalb von 10 Sekunden mit einem 2xx-Status antwortet. Eine Anfrage, auf die es nicht oder mit 408, 429 oder einem 5xx-Status geantwortet hat, wird nach 1 Sekunde und nach weiteren 4 Sekunden erneut gesendet: insgesamt drei Versuche. Bei jedem anderen 4xx-Status wird sie nicht erneut gesendet.

Im SMS- oder Anrufprotokoll und bei einem Bereitschaftsalarm im Bereitschaftsprotokoll der Person steht `Sent to the SMS and call gateway (HTTP 200).` oder der Grund, warum die Nachricht nicht zugestellt wurde, nie die URL. OneUptime erfährt nicht, ob die Nachricht das Telefon erreicht hat. Eine SMS erscheint daher als gesendet, sobald Ihr Gateway sie annimmt, und die Nummer, von der sie ausging, bleibt leer.

## Testanfragen

**Send test** sendet eine Anfrage, bei der `event` auf `test` und `to`, `project` und `actions` auf `null` gesetzt sind. Beantworten Sie sie mit einem 2xx-Status und senden Sie nichts.

## Nächste Schritte

:::cards
- [Benutzerdefinierte Benachrichtigungskanäle](/docs/self-hosted/custom-notification-channels): Menschen über Ihre eigene App alarmieren.
- [Push-Benachrichtigungen](/docs/self-hosted/push-notifications): Push für den ganzen Server ausschalten.
- [Twilio-Integration](/docs/self-hosted/twilio-integration): Stattdessen über Twilio senden.
- [Zugriff auf private Netzwerke](/docs/self-hosted/private-network-access): Was Ihr Server in Ihrem eigenen Netzwerk erreichen darf.
:::

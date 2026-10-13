# SMSEagle-Integration

Senden Sie Warnungen als SMS oder Anruf über [SMSEagle](https://www.smseagle.eu), ein Hardware-SMS-Gateway, das vor Ort in Ihrem eigenen Netzwerk steht. OneUptime bringt eingebaute **SMSEagle**-Workflow-Komponenten mit, die Einrichtung geht also schnell.

Diese Integration ist **ausgehend**: OneUptime sendet Nachrichten über die [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/).

```text
OneUptime-Warnung → On Create  ──►  SMSEagle-Komponente  ──►  SMS oder Anruf an ein Telefon
```

## Schritt 1: Einen API-Schlüssel erstellen

1. Öffnen Sie in der Web-GUI von SMSEagle **Settings → API → API v2** und klicken Sie auf **Create API key**.
2. Erlauben Sie unter **Permissions** die Berechtigung **Send SMS** und, wenn Sie Anrufe möchten, **Make a TTS Advanced Call**.
3. Kopieren Sie den Schlüssel. OneUptime nennt ihn **SMSEagle Access Token**.

## Schritt 2: OneUptime das Gerät erreichen lassen

1. Erlauben Sie die Verbindung von Ihrem OneUptime-Server zur Adresse des Geräts, etwa `https://192.168.0.100`, in allen Firewalls und VPNs dazwischen.
2. Ein SMSEagle-Gerät hat meist eine private Adresse, und die blockieren Workflows standardmäßig. Tragen Sie auf einer selbst gehosteten Instanz die IP-Adresse oder den Hostnamen des Geräts auf dem API-Server in `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` ein, etwa `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`, und starten Sie ihn neu. Siehe [Zugriff auf private Netzwerke](/docs/self-hosted/private-network-access).

## Schritt 3: Die Geheimnisse speichern

1. Öffnen Sie in OneUptime **Arbeitsabläufe → Globale Variablen → Erstellen**.
2. Legen Sie `SMSEAGLE_URL`, `SMSEAGLE_ACCESS_TOKEN` (geheim) und `ONCALL_PHONE` an.

## Schritt 4: Den Workflow bauen

1. Öffnen Sie **Arbeitsabläufe → Arbeitsablauf erstellen**, nennen Sie ihn `Alerts → SMSEagle` und öffnen Sie den **Editor**.
2. Fügen Sie einen Auslöser **Alert** mit **On Create** hinzu. Benennen Sie ihn in `Alert` um.
3. Fügen Sie eine Komponente **Send SMS via SMSEagle** hinzu und verbinden Sie sie mit dem Auslöser:
   - **SMSEagle URL**: `{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**: `{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**: `{{variable.ONCALL_PHONE}}`
   - **Message Text**: `New alert: {{Alert.title}}`
4. Klicken Sie auf **Speichern**, schalten Sie den Workflow ein und erstellen Sie eine Testwarnung. Die SMS kommt auf dem Telefon an.

Die Vorlage **Text a phone via SMSEagle when an alert fires** baut denselben Workflow.

## Anrufe statt SMS

Nehmen Sie stattdessen **Make a Call via SMSEagle**. Die Komponente hat dieselben Einstellungen und dazu eine **Voice ID**, die Text-to-Speech-Stimme auf dem Gerät, und liest den **Text to Read Out** vor. Der API-Schlüssel braucht die Berechtigung **Make a TTS Advanced Call**.

Die Vorlage **Call a phone via SMSEagle when an alert fires** baut denselben Workflow mit einem Anruf.

## Alternative: die API-Komponente

Ein **API**-Block funktioniert ebenfalls:

- **Method**: `POST`
- **URL**: `{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**: `access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**: `{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## Tipps

- Lehnt das Gerät die Nachricht ab, steht der Grund im Wert **Error** der Komponente. Protokollieren Sie ihn am Ausgang **Fehler**.
- Filtern Sie mit **Bedingungen** vor dem Senden nach Schweregrad.
- Um mehrere Personen zu erreichen, verbinden Sie mehrere SMSEagle-Komponenten, eine pro Nummer.

## Wie es weitergeht

- [Integrationen – Überblick](/docs/integrations/index): das Muster für ausgehende Integrationen.
- [Komponenten → SMSEagle](/docs/workflows/components#smseagle): die Referenz der Komponente.

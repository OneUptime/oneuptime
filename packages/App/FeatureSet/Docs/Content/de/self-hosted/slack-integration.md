# Slack-Integration

Verbinden Sie Ihr selbst gehostetes OneUptime-Projekt mit Slack, um Benachrichtigungen zu senden und Vorfallaktionen, Befehle und Nachrichtenereignisse zu verwenden.

## Einrichtung

1. Konfigurieren Sie den OneUptime-Hostnamen und HTTPS wie unten beschrieben. Kopieren Sie unter **Settings > Slack Integration** das generierte App-Manifest. Es ist auch unter `https://your-oneuptime-domain.com/api/slack/app-manifest` verfügbar.
2. [Erstellen Sie eine Slack-App](https://api.slack.com/apps) aus diesem Manifest in Ihrem Workspace. Verwenden Sie das Manifest Ihrer eigenen Bereitstellung, damit die URLs zu Ihrem Hostnamen passen.
3. Kopieren Sie **Client ID**, **Client Secret** und **Signing Secret** aus **Basic Information** der App für Docker Compose in `config.env`:

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   Für Helm verwenden Sie diese Werte:

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. Wenden Sie die Konfiguration an und warten Sie auf den Neustart von OneUptime. Falls die Events-URL-Prüfung vor der Einrichtung des Signing Secret scheiterte, wiederholen Sie sie jetzt.
5. Öffnen Sie erneut **Settings > Slack Integration**, wählen Sie **Connect to Slack** und autorisieren Sie die App. Verbinden Sie für Aktionen mit Benutzeridentität auch Ihr persönliches Slack-Konto in OneUptime.

## Netzwerkzugriff für selbst gehostete Bereitstellungen

### Verkehrsrichtung und Endpunkte

| Verkehr | Erforderlicher Zugriff |
| --- | --- |
| OneUptime → Slack | DNS und ausgehendes HTTPS über TCP 443 zu `slack.com` für Web API und OAuth-Tokenaustausch; zu `hooks.slack.com` für Befehlsantworten und verwendete Incoming-Webhooks |
| Slack → OneUptime | Öffentliches HTTPS über TCP 443 zu den vier POST-Routen unten für die vollständige Integration |
| Browser des Benutzers → OneUptime | Dashboard und OAuth-Weiterleitungen zu `/api/slack/auth/:projectId/:userId` und `/api/slack/auth/:projectId/:userId/user`; Zugriff über das Benutzer-VPN ist ausreichend |

Diese ausgehenden Domains beschreiben die OneUptime-Integration, keine vollständige Freigabeliste für Slack-Clients oder sämtliche Funktionen. Ein Slack-Incoming-Webhook wird von Slack gehostet: OneUptime sendet dorthin; er ist kein eingehender Endpunkt auf Ihrem Server. Siehe [Slacks Incoming-Webhook-Anleitung](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/).

Leiten Sie diese Provider-Callbacks über den Ingress an die OneUptime-Anwendung weiter:

| Methode und Pfad | Zweck |
| --- | --- |
| `POST /api/slack/events` | Events-API-Prüfung, Reaktionen, Erwähnungen und Nachrichten |
| `POST /api/slack/interactive` | Schaltflächen, Verknüpfungen, Modalübermittlungen, `/incident` und `/maintenance` |
| `POST /api/slack/options-load` | Anfragen für interaktive Menüoptionen |
| `POST /api/slack/command` | Befehl `/oneuptime` |

OAuth verwendet eine [Browserweiterleitung mit anschließendem serverseitigem Tokenaustausch](https://docs.slack.dev/authentication/installing-with-oauth/). Das Manifest registriert `/api/slack/auth` als URL-Präfix; OneUptime ergänzt bei der Autorisierung Projekt- und Benutzerpfade. Browserzugriff allein ermöglicht Slack keine Ereignis- oder Aktionszustellung.

### Private Bereitstellungen und Callback-Sicherheit

Verwenden Sie öffentliches DNS und ein Gateway mit öffentlich vertrauenswürdigem HTTPS-Zertifikat, vollständiger Zertifikatskette und privater Route zum OneUptime-Ingress. Erlauben Sie eingehendes TCP 443 und veröffentlichen Sie nur die oben genannten Provider-POST-Callbacks. Ein privater `ClusterIP`, internes DNS oder ein Mitarbeiter-VPN allein ermöglicht dem Provider keinen Zugriff. Mit Split-DNS bleiben Dashboard und Browser-OAuth-Routen unter demselben Hostnamen privat erreichbar.

Setzen Sie `HOST=oneuptime.example.com` und `HTTP_PROTOCOL=https` in `config.env`, beziehungsweise `host: oneuptime.example.com` und `httpProtocol: https` in Helm. Wenden Sie die Konfiguration an und warten Sie auf den Neustart. Diese Werte erzeugen URLs; DNS, TLS und Firewallzugriff müssen separat eingerichtet werden. Erzeugen und aktualisieren Sie das Slack-Manifest nach einer Änderung des Hostnamens neu.

Erhalten Sie Methode, Pfad, Abfrageparameter, unveränderten Body, `Content-Type`, `X-Slack-Signature` und `X-Slack-Request-Timestamp`. Übermitteln Sie öffentlichen Host und HTTPS-Schema über vertrauenswürdige Proxy-Header. Nehmen Sie Callback-Routen von Browser-SSO, CAPTCHA und Proxy-Anmeldeseiten aus, behalten Sie aber OneUptimes Signatur- und Zeitstempelprüfungen bei. Synchronisieren Sie die Serveruhr. Eine Quell-IP-Prüfung ersetzt nicht [Slacks Signaturprüfung](https://docs.slack.dev/authentication/verifying-requests-from-slack/).

### Zugriff prüfen und Einschränkungen verstehen

Prüfen Sie unter **Event Subscriptions** die Events Request URL: Slack sendet eine [POST-Challenge und prüft TLS](https://docs.slack.dev/apis/events-api/using-http-request-urls/). Senden Sie anschließend eine Testbenachrichtigung, führen Sie einen Slash-Befehl aus, betätigen Sie eine Vorfallschaltfläche und lösen Sie ein abonniertes Ereignis aus. Prüfen Sie Gateway- und OneUptime-Protokolle ohne Geheimnisse zu protokollieren. Slack erwartet schnelle Bestätigungen, bei [Interaktionen innerhalb von drei Sekunden](https://docs.slack.dev/interactivity/handling-user-interaction/). Ein Browser-GET oder eine ausgehende Nachricht bestätigt die POST-Callbacks nicht.

Ohne eingehende Verbindungen kann eine bereits autorisierte App weiterhin über ausgehendes HTTPS Nachrichten senden; Ereignisse, Schaltflächen, Verknüpfungen und Befehle funktionieren jedoch nicht. OneUptimes Manifest verwendet HTTP-Callbacks und deaktiviert Socket Mode. Das Aktivieren von Slack Socket Mode ist kein unterstützter Ersatz. Die [Einstellung für private Netzwerke](/docs/self-hosted/private-network-access) steuert ausgehende Anfragen an private Ziele und veröffentlicht keine Callbacks.

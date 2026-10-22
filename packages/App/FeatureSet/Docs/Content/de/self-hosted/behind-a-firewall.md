# Hinter einem VPN oder einer Firewall

Ein selbst gehostetes OneUptime kann vom öffentlichen Internet getrennt bleiben: Es versendet jeden Alarm über ausgehende Verbindungen. Ein paar Dinge kommen allerdings von außen herein. Eine alarmierte Person tippt in einer Nachricht auf **Acknowledge**, Twilio meldet eine bei einem Anruf gedrückte Taste, Slack meldet den Klick auf eine Schaltfläche. Diese Seite führt jedes davon auf, wer sich dafür mit Ihrem Server verbindet und über welchen Pfad, damit Sie nur veröffentlichen, was Sie nutzen, oder gar nichts.

:::cards
- [Wer sich mit Ihrem Server verbindet](#wer-sich-mit-ihrem-server-verbindet): Die Telefone der alarmierten Personen und die Anbieter, die zurückrufen.
- [Alles privat halten](#alles-privat-halten): Die Telefone der alarmierten Personen in Ihr VPN holen.
- [Nur die Bestätigungsseiten veröffentlichen](#nur-die-bestätigungsseiten-veröffentlichen): Ein schmaler Zugang für Bestätigungslinks.
- [Callbacks der Anbieter](#callbacks-der-anbieter): Telegram, Twilio, WhatsApp, Slack und Microsoft Teams.
:::

## Wer sich mit Ihrem Server verbindet

Das Senden braucht nie eingehenden Zugriff: OneUptime verbindet sich von sich aus mit Ihrem Mailserver, Twilio, Telegram, Meta, Slack, Microsoft und dem Push-Relay. Was von außen hereinkommt, ist eines der folgenden Dinge:

| Was passiert | Wer sich mit Ihrem Server verbindet | Lässt sich das über eine Allowlist von Quelladressen abdecken? |
| --- | --- | --- |
| Eine alarmierte Person tippt in einer E-Mail, SMS, WhatsApp- oder Telegram-Nachricht auf **Acknowledge** | Das Telefon oder der Computer dieser Person | Nein: Die Verbindung kommt von dort, wo die Person gerade ist |
| Eine alarmierte Person bestätigt in der App OneUptime On-Call | Das Telefon dieser Person | Nein: aus demselben Grund |
| Eine alarmierte Person drückt bei einem Bereitschaftsanruf die 1 | Twilio | Nur mit Static Proxy for Webhooks von Twilio |
| Jemand verknüpft sein Telegram-Konto | Telegram | Ja, oder Telegram abfragen und nichts freigeben |
| Jemand klickt auf eine Schaltfläche in einer Slack- oder Microsoft-Teams-Nachricht | Slack oder Microsoft | Nein: Keiner von beiden veröffentlicht feste Adressen |
| WhatsApp meldet, dass eine Nachricht zugestellt oder gelesen wurde | Meta | Nein: Meta veröffentlicht keine festen Adressen |

Ein selbst gehosteter Server spricht direkt mit diesen Anbietern, nie über die Server von OneUptime selbst, daher gibt es keine Liste von OneUptime-Adressen, die Sie freigeben müssten.

## Alles privat halten

Holen Sie die Telefone der alarmierten Personen in Ihr VPN: dauerhaft verbunden oder bei Bedarf für Ihren OneUptime-Hostnamen, damit um 3 Uhr nachts niemand erst das VPN verbinden muss, um eine Alarmierung zu bestätigen. Wenn nichts veröffentlicht ist:

- Die Bestätigungslinks in E-Mails, SMS, WhatsApp- und Telegram-Nachrichten öffnen sich, weil das Telefon Ihren Server erreicht.
- Die App OneUptime On-Call funktioniert: Geben Sie darin die Adresse Ihres Servers an. Push-Benachrichtigungen brauchen keinen eingehenden Zugriff, weil der Server sie über das Push-Relay sendet.
- Ihre Leute verknüpfen ihre Telegram-Konten, sobald Sie die Abfrage einschalten (siehe [Telegram](#telegram)).

Ein Link in einer Messaging-App öffnet sich im integrierten Browser dieser App oder im Standardbrowser des Telefons, nie in der OneUptime-App. Ein Per-App-VPN muss daher die Messaging-Apps und den Browser abdecken, nicht nur die OneUptime-App.

Das Drücken der 1 bei einem Anruf, Schaltflächen in Slack- und Microsoft-Teams-Nachrichten und die Zustellbestätigungen von WhatsApp brauchen weiterhin eine Verbindung vom jeweiligen Anbieter zu Ihrem Server.

## Nur die Bestätigungsseiten veröffentlichen

Wenn die Telefone der alarmierten Personen Ihr VPN nicht nutzen können, veröffentlichen Sie die Seiten, die ein Bestätigungslink öffnet, und sonst nichts. Setzen Sie einen Reverse-Proxy vor OneUptime oder einen ausgehenden Tunnel wie Cloudflare Tunnel, der keine eingehende Firewall-Regel braucht, und lassen Sie nur diese Pfade durch:

| Methode | Pfad | Was er ausliefert |
| --- | --- | --- |
| GET | `/l/*` | Die Kurzlinks in SMS, WhatsApp- und Telegram-Nachrichten |
| GET | `/api/user-notification-log-timeline/acknowledge-page/*` | Die Seite, die zeigt, worum es bei der Alarmierung geht, mit ihrer Schaltfläche **Acknowledge** |
| GET | `/api/user-notification-log-timeline/acknowledge/*` | Die Schaltfläche **Acknowledge** |
| GET | `/api/user-notification-log-timeline/pass-on-page/*` | Optional: die Seite, die die Alarmierung an die nächste Person weitergibt |
| POST | `/api/user-notification-log-timeline/pass-on/*` | Optional: ihre Schaltfläche |
| GET | `/oneuptime-assets/*` | Schriften, Styles und Logo dieser Seiten |

:::steps
### Einen öffentlichen Namen auf den Proxy richten
Die Links in den Nachrichten werden aus Ihrer Einstellung `HOST` gebildet, daher muss dieser Name öffentlich zum Proxy auflösen, mit einem öffentlich vertrauenswürdigen Zertifikat. Mit Split-DNS lösen Personen in Ihrem Netzwerk ihn weiterhin zur privaten Adresse auf und nutzen alles andere wie bisher.

### Die Pfade unverändert weiterleiten
Senden Sie diese Pfade mit Methode, Pfad und Query-String an den Ingress von OneUptime, und beantworten Sie alles andere mit 404.

### Die Anfragerate begrenzen
Jeder Link enthält eine zufällige ID, und ein Kurzlink ist acht Buchstaben lang. Begrenzen Sie die Anfragen, die jede Adresse stellen darf, damit niemand IDs in schneller Folge durchprobieren kann.
:::

Nachdem die Person bestätigt hat, öffnet die Seite die Warnung im Dashboard, das nur in Ihrem Netzwerk lädt. Die Bestätigung ist zu diesem Zeitpunkt bereits gespeichert.

## Callbacks der Anbieter

### Telegram

Das Senden von Alarmen braucht nur ausgehendes HTTPS zu `api.telegram.org`. Ein Konto zu verknüpfen heißt, dass Ihr Server die `/start`-Nachricht empfangen muss, die eine Person an Ihren Bot sendet, und dafür gibt es zwei Wege:

- **Abfrage**: Schalten Sie **Poll Telegram for Messages** unter **Admin Dashboard > Einstellungen > Telegram** ein. OneUptime ruft die Nachrichten des Bots alle paar Sekunden über ausgehendes HTTPS bei Telegram ab, sodass nichts Ihren Server erreichen muss.
- **Webhook**: Telegram sendet jede Nachricht an `POST /api/notification/telegram/webhook`. Telegram [sendet Webhooks](https://core.telegram.org/bots/webhooks) von `149.154.160.0/20` und `91.108.4.0/22` aus, sodass Sie nur diese Adressen freigeben können.

### Twilio

Wenn eine alarmierte Person bei einem Anruf die 1 drückt, um zu bestätigen, sendet Twilio die Taste an `POST /api/user-notification-log-timeline/call/gather-input/*`. Die Webhook-Adressen von Twilio ändern sich, es sei denn, Ihre Twilio-Edition umfasst [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy). Zustellungsupdates für SMS und eingehende Anrufe beschreibt die Seite [Twilio-Integration](/docs/self-hosted/twilio-integration).

### WhatsApp

Alarme zu senden und zu bestätigen braucht keinen eingehenden Zugriff. Meta sendet Zustell- und Lesebestätigungen an `/api/notification/whatsapp/webhook`; ohne sie kann das WhatsApp-Protokoll von OneUptime nicht zeigen, ob eine Nachricht zugestellt oder gelesen wurde oder fehlgeschlagen ist, nachdem Meta sie angenommen hatte. Meta signiert jede Anfrage und veröffentlicht keine festen Adressen.

### Slack und Microsoft Teams

Schaltflächen, Menüs und Befehle in ihren Nachrichten rufen Ihren Server auf, und zwar von Adressen, die keiner von beiden veröffentlicht. Die Pfade und wie Sie sie veröffentlichen, finden Sie unter [Slack-Integration](/docs/self-hosted/slack-integration) und [Microsoft-Teams-Integration](/docs/self-hosted/microsoft-teams-integration).

## Nächste Schritte

:::cards
- [Twilio-Integration](/docs/self-hosted/twilio-integration): SMS und Anrufe über Ihr eigenes Twilio-Konto.
- [Push-Benachrichtigungen](/docs/self-hosted/push-notifications): Das Push-Relay und was Ihr Server und die Telefone erreichen.
- [Apps – Übersicht](/docs/mobile-desktop-apps/index): Die App OneUptime On-Call mit Ihrem Server verbinden.
- [Zugriff auf private Netzwerke](/docs/self-hosted/private-network-access): Der umgekehrte Weg: OneUptime Ihre internen Werkzeuge erreichen lassen.
:::

# Externer Status-Seiten-Monitor

Der Externe Status-Seiten-Monitor ermöglicht die Überwachung von Status-Seiten Dritter und Benachrichtigungen, wenn von Ihnen abhängige Dienste Ausfälle oder Leistungseinbußen erleiden. OneUptime prüft regelmäßig externe Status-Seiten (wie AWS, GCP, Azure, GitHub und mehr) und wertet deren Status aus.

## Übersicht

Externe Status-Seiten-Monitore prüfen die Gesundheit von Diensten, auf die Sie sich verlassen, indem sie deren öffentliche Status-Seiten abfragen. Dies ermöglicht Ihnen:

- Verfügbarkeit von Drittanbieter-Diensten überwachen, von denen Ihre Anwendung abhängt
- Benachrichtigungen erhalten, wenn Upstream-Anbieter Ausfälle erleiden
- Einzelne Komponentenstatus verfolgen (z. B. „AWS EC2 us-east-1")
- Leistungseinbußen erkennen, bevor sie Ihre Benutzer beeinträchtigen
- Eigene Incidents mit Upstream-Anbieterproblemen korrelieren

## Unterstützte Anbieter

OneUptime unterstützt die Überwachung von Status-Seiten über folgende Methoden:

| Anbietertyp | Beschreibung |
|---|---|
| **Auto** (Standard) | Erkennt automatisch das Format der Status-Seite |
| **Atlassian Statuspage** | Status-Seiten betrieben von Atlassian Statuspage (JSON API) |
| **RSS** | Status-Seiten, die einen RSS-Feed bereitstellen |
| **Atom** | Status-Seiten, die einen Atom-Feed bereitstellen |

### Automatische Erkennung

Bei der Einstellung **Auto** versucht OneUptime, das Status-Seiten-Format automatisch zu erkennen:

1. Zuerst wird die Atlassian Statuspage JSON API versucht (`/api/v2/status.json` und `/api/v2/components.json`)
2. Falls dies fehlschlägt, wird versucht, die Seite als RSS- oder Atom-Feed zu parsen
3. Als letzten Ausweg wird eine einfache HTTP-Erreichbarkeitsprüfung durchgeführt

## Einen Externen Status-Seiten-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Externe Status-Seite** als Monitortyp
4. Geben Sie die URL der Status-Seite ein, die Sie überwachen möchten
5. Wählen Sie optional einen bestimmten Anbietertyp (oder belassen Sie es als Auto)
6. Geben Sie optional einen Komponentennamen ein, um die Überwachung auf eine bestimmte Komponente zu beschränken
7. Konfigurieren Sie bei Bedarf Überwachungskriterien

## Konfigurationsoptionen

### Status-Seiten-URL

Geben Sie die URL der externen Status-Seite ein, die Sie überwachen möchten.

### Anbietertyp

Wählen Sie den Anbietertyp für die Status-Seite. Verwenden Sie **Auto** (Standard), damit OneUptime das Format automatisch erkennt.

### Komponentenname-Filter

Wenn die Status-Seite über mehrere Komponenten berichtet, können Sie optional einen Komponentennamen angeben, um nur diese spezifische Komponente zu überwachen.

### Erweiterte Optionen

#### Timeout

Die maximale Zeit (in Millisekunden), auf eine Antwort von der Status-Seite zu warten. Standard ist 10000 ms (10 Sekunden).

#### Wiederholungsversuche

Die Anzahl der Wiederholungsversuche der Anfrage bei Fehlschlag. Standard ist 3 Versuche.

## Überwachungskriterien

Sie können Kriterien konfigurieren, um zu bestimmen, wann der externe Dienst als online, eingeschränkt oder offline gilt:

- **Ist online** – Ob die Status-Seite erreichbar ist und Statusdaten zurückgibt
- **Gesamtstatus** – Der allgemeine Statusindikator der Status-Seite (z. B. „operational", „major_outage")
- **Komponentenstatus** – Status einer bestimmten Komponente (beim Verwenden des Komponentennamen-Filters)
- **Aktive Incidents** – Anzahl der aktuell aktiven Incidents auf der Status-Seite
- **Antwortzeit** – Wie lange es dauert, die Status-Seiten-Daten abzurufen

## Beliebte Status-Seiten-URLs

| Dienst | Status-Seiten-URL |
|---|---|
| AWS | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform | `https://status.cloud.google.com` |
| Microsoft Azure | `https://status.azure.com` |
| GitHub | `https://www.githubstatus.com` |
| Cloudflare | `https://www.cloudflarestatus.com` |
| Datadog | `https://status.datadoghq.com` |
| PagerDuty | `https://status.pagerduty.com` |
| Twilio | `https://status.twilio.com` |
| Stripe | `https://status.stripe.com` |
| Slack | `https://status.slack.com` |
| Atlassian (Jira, Confluence) | `https://status.atlassian.com` |
| Vercel | `https://www.vercel-status.com` |
| Netlify | `https://www.netlifystatus.com` |
| DigitalOcean | `https://status.digitalocean.com` |
| Heroku | `https://status.heroku.com` |
| MongoDB Atlas | `https://status.cloud.mongodb.com` |
| Fastly | `https://status.fastly.com` |
| New Relic | `https://status.newrelic.com` |
| Sentry | `https://status.sentry.io` |
| CircleCI | `https://status.circleci.com` |

> **Hinweis:** Viele davon nutzen Atlassian Statuspage, sodass der **Auto**-Anbietertyp sie automatisch erkennt.

## Incident- & Benachrichtigungsvorlagen

Beim Erstellen von Incidents oder Benachrichtigungen aus Externen Status-Seiten-Monitoren können Sie folgende Vorlagenvariablen verwenden:

| Variable | Beschreibung |
|---|---|
| `{{isOnline}}` | Ob die Status-Seite online ist (true/false) |
| `{{responseTimeInMs}}` | Antwortzeit in Millisekunden |
| `{{failureCause}}` | Ursache des Fehlers, falls vorhanden |
| `{{overallStatus}}` | Der allgemeine Statusindikatorwert |
| `{{activeIncidentCount}}` | Anzahl aktiver Incidents |
| `{{componentStatuses}}` | JSON-Array von Komponentenstatus |

## Best Practices

- **Auto-Anbietertyp verwenden**, sofern Sie das genaue Format nicht kennen — die Auto-Erkennung funktioniert für die meisten Status-Seiten gut
- **Bestimmte Komponenten überwachen**, wenn Sie nur von bestimmten Diensten abhängen (z. B. einer bestimmten AWS-Region)
- **Incident-Korrelation einrichten** — wenn Ihre Monitore Probleme erkennen und die Upstream-Status-Seite auch Probleme zeigt, hilft das, Grundursachen schneller zu identifizieren
- **Mit anderen Monitoren kombinieren** — Externe Status-Seiten-Monitore mit Ihren eigenen API/Website-Monitoren für umfassende Sichtbarkeit koppeln

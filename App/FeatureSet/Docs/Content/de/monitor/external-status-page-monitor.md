# Externer Status-Seiten-Monitor

Der Externe Status-Seiten-Monitor ermöglicht die Überwachung von Status-Seiten Dritter und Benachrichtigungen, wenn von Ihnen abhängige Dienste Ausfälle oder Leistungseinbußen erleiden. OneUptime prüft regelmäßig externe Status-Seiten (wie AWS, GCP, Azure, GitHub, OpenAI, Anthropic und mehr) und wertet deren Status aus.

## Übersicht

Externe Status-Seiten-Monitore prüfen die Gesundheit von Diensten, auf die Sie sich verlassen, indem sie deren öffentliche Status-Seiten abfragen. Dies ermöglicht Ihnen:

- Verfügbarkeit von Drittanbieter-Diensten überwachen, von denen Ihre Anwendung abhängt
- Benachrichtigungen erhalten, wenn Upstream-Anbieter Ausfälle erleiden
- Einzelne Komponentenstatus verfolgen (z. B. „AWS EC2 us-east-1")
- Die Überwachung auf eine einzelne Komponentengruppe beschränken (z. B. nur die „APIs" von OpenAI), sodass nicht zusammenhängende Incidents an anderer Stelle der Seite Ihren Monitor nicht auslösen
- Leistungseinbußen erkennen, bevor sie Ihre Benutzer beeinträchtigen
- Eigene Incidents mit Upstream-Anbieterproblemen korrelieren

## Unterstützte Anbieter

OneUptime unterstützt die Überwachung von Status-Seiten über folgende Methoden:

| Anbietertyp              | Beschreibung                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| **Auto** (Standard)      | Erkennt automatisch das Format der Status-Seite                   |
| **Atlassian Statuspage** | Status-Seiten betrieben von Atlassian Statuspage (JSON API)       |
| **incident.io**          | Status-Seiten betrieben von incident.io (z. B. `https://status.openai.com`) |
| **RSS**                  | Status-Seiten, die einen RSS-Feed bereitstellen                  |
| **Atom**                 | Status-Seiten, die einen Atom-Feed bereitstellen                 |

### Automatische Erkennung

Bei der Einstellung **Auto** versucht OneUptime, das Status-Seiten-Format automatisch zu erkennen, und zwar in dieser Reihenfolge:

1. Zuerst wird die Atlassian Statuspage JSON API versucht (`/api/v2/status.json`, `/api/v2/components.json` und `/api/v2/incidents/unresolved.json`)
2. Als Nächstes wird die incident.io Status-Seiten-API versucht (`/proxy/<host>`)
3. Falls dies fehlschlägt, wird versucht, die Seite als RSS- oder Atom-Feed zu parsen
4. Als letzten Ausweg wird eine einfache HTTP-Erreichbarkeitsprüfung durchgeführt

## Einen Externen Status-Seiten-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Externe Status-Seite** als Monitortyp
4. Geben Sie die URL der Status-Seite ein, die Sie überwachen möchten
5. Wählen Sie optional einen bestimmten Anbietertyp (oder belassen Sie es als **Auto**)
6. Geben Sie optional eine **Komponentengruppe** ein, um die Überwachung auf eine Gruppe wie „APIs" zu beschränken
7. Geben Sie optional einen **Komponentennamen** ein, um auf eine einzelne Komponente zu filtern (innerhalb der Gruppe, falls eine Gruppe festgelegt ist)
8. Konfigurieren Sie bei Bedarf Überwachungskriterien

## Konfigurationsoptionen

### Status-Seiten-URL

Geben Sie die URL der externen Status-Seite ein, die Sie überwachen möchten. Für von Atlassian Statuspage und incident.io betriebene Seiten ist dies typischerweise die Root-URL (z. B. `https://status.example.com`). Für RSS-/Atom-Feeds geben Sie die Feed-URL direkt ein.

### Anbietertyp

Wählen Sie den Anbietertyp für die Status-Seite. Verwenden Sie **Auto** (Standard), damit OneUptime das Format automatisch erkennt, oder geben Sie **Atlassian Statuspage**, **incident.io**, **RSS** oder **Atom** an, wenn Sie es kennen.

### Komponentengruppen-Filter

Wenn die Status-Seite ihre Komponenten in Gruppen organisiert, können Sie den Monitor auf eine einzelne Gruppe beschränken. Auf `https://status.openai.com` beschränkt beispielsweise die Eingabe von `APIs` den Monitor auf die API-Dienste von OpenAI.

Wenn eine Komponentengruppe festgelegt ist, werden die **Anzahl aktiver Incidents** und der **Gesamtstatus** ausschließlich anhand der Komponenten in dieser Gruppe berechnet — ein Incident, der eine nicht zusammenhängende Gruppe betrifft (zum Beispiel ChatGPT), löst einen auf die Gruppe „APIs" beschränkten Monitor nicht aus.

Die Filterung nach Komponentengruppe wird für die Anbieter **Atlassian Statuspage** und **incident.io** unterstützt. (RSS-/Atom-Feeds stellen keine Komponentengruppen bereit.)

### Komponentenname-Filter

Wenn die Status-Seite über mehrere Komponenten berichtet, können Sie optional einen Komponentennamen angeben, um nur diese spezifische Komponente zu überwachen. Um beispielsweise nur AWS EC2 in us-east-1 zu überwachen, würden Sie `EC2 us-east-1` eingeben (den exakten Komponentennamen, wie er auf der Status-Seite angezeigt wird).

Wenn auch eine Komponentengruppe festgelegt ist, wird der Komponentenname-Filter **innerhalb** dieser Gruppe angewendet, sodass Sie eine einzelne Komponente innerhalb einer größeren Gruppe gezielt ansprechen können. Wenn keiner der Filter angegeben ist, werden alle Komponenten im Geltungsbereich überwacht.

### Erweiterte Optionen

#### Timeout

Die maximale Zeit (in Millisekunden), auf eine Antwort von der Status-Seite zu warten. Standard ist 10000 ms (10 Sekunden).

#### Wiederholungsversuche

Die Anzahl der Wiederholungsversuche der Anfrage bei Fehlschlag. Standard ist 3 Versuche.

## Überwachungskriterien

Sie können Kriterien konfigurieren, um basierend auf den folgenden Werten zu bestimmen, wann der externe Dienst als betriebsbereit oder ausgefallen gilt:

- **Ist online** – Ob die Status-Seite erreichbar ist und Statusdaten zurückgibt
- **Gesamtstatus** – Der allgemeine Statusindikator der Status-Seite (z. B. `operational`, `degraded_performance`, `partial_outage`, `major_outage`)
- **Komponentenstatus** – Der Status der Komponenten im Geltungsbereich (unter Berücksichtigung der Filter für Komponentengruppe / Komponentenname)
- **Aktive Incidents** – Die Anzahl der aktuell aktiven Incidents, die auf der Status-Seite gemeldet werden (beschränkt auf die Komponentengruppe / Komponente, wenn ein Filter festgelegt ist)
- **Antwortzeit** – Wie lange es dauert, die Status-Seiten-Daten abzurufen

### Standardkriterien

Standardmäßig setzt OneUptime Kriterien an, die sich daran orientieren, was bei einer Status-Seite tatsächlich zählt — ihren aktiven Incidents und der Komponentengesundheit, statt der bloßen Erreichbarkeit:

- Der Monitor wird als **Betriebsbereit** markiert, wenn es keine aktiven Incidents im Geltungsbereich gibt.
- Der Monitor wird als **Ausgefallen** markiert (und ein Incident wird erstellt), wenn es mindestens einen aktiven Incident im Geltungsbereich gibt oder wenn eine Komponente im Geltungsbereich `degraded_performance`, `partial_outage`, `major_outage` oder `full_outage` meldet.

Da die Anzahl aktiver Incidents und die Komponentenstatus die Filter für Komponentengruppe / Komponentenname berücksichtigen, zielen diese Standardkriterien automatisch nur auf die Komponenten ab, die für Sie relevant sind.

## Beliebte Status-Seiten-URLs

Hier finden Sie eine kuratierte Liste beliebter Dienst-Status-Seiten-URLs, die Sie überwachen können:

| Dienst                       | Status-Seiten-URL                             |
| ---------------------------- | --------------------------------------------- |
| AWS                          | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform        | `https://status.cloud.google.com`             |
| Microsoft Azure              | `https://status.azure.com`                    |
| GitHub                       | `https://www.githubstatus.com`                |
| OpenAI                       | `https://status.openai.com`                   |
| Anthropic                    | `https://status.anthropic.com`                |
| Cloudflare                   | `https://www.cloudflarestatus.com`            |
| Datadog                      | `https://status.datadoghq.com`                |
| PagerDuty                    | `https://status.pagerduty.com`                |
| Twilio                       | `https://status.twilio.com`                   |
| Stripe                       | `https://status.stripe.com`                   |
| Slack                        | `https://status.slack.com`                    |
| Atlassian (Jira, Confluence) | `https://status.atlassian.com`                |
| Vercel                       | `https://www.vercel-status.com`               |
| Netlify                      | `https://www.netlifystatus.com`               |
| DigitalOcean                 | `https://status.digitalocean.com`             |
| Heroku                       | `https://status.heroku.com`                   |
| MongoDB Atlas                | `https://status.cloud.mongodb.com`            |
| Fastly                       | `https://status.fastly.com`                   |
| New Relic                    | `https://status.newrelic.com`                 |
| Sentry                       | `https://status.sentry.io`                    |
| CircleCI                     | `https://status.circleci.com`                 |

> **Hinweis:** Viele davon nutzen Atlassian Statuspage oder incident.io, sodass der **Auto**-Anbietertyp sie automatisch erkennt.

## Incident- & Benachrichtigungsvorlagen

Beim Erstellen von Incidents oder Benachrichtigungen aus Externen Status-Seiten-Monitoren können Sie folgende Vorlagenvariablen verwenden:

| Variable                  | Beschreibung                                                 |
| ------------------------- | ------------------------------------------------------------ |
| `{{isOnline}}`            | Ob die Status-Seite online ist (true/false)                  |
| `{{responseTimeInMs}}`    | Antwortzeit in Millisekunden                                 |
| `{{failureCause}}`        | Ursache des Fehlers, falls vorhanden                         |
| `{{overallStatus}}`       | Der allgemeine Statusindikatorwert                           |
| `{{activeIncidentCount}}` | Anzahl aktiver Incidents (beschränkt auf den Filter, falls vorhanden) |
| `{{componentStatuses}}`   | JSON-Array von Komponentenstatus (`name`, `status`, `description`, `groupName`) |
| `{{provider}}`            | Erkannter Anbieter (Atlassian Statuspage, incident.io, RSS, Atom) |
| `{{componentGroup}}`      | Komponentengruppe, auf die der Monitor beschränkt ist, falls vorhanden |
| `{{componentName}}`       | Komponente, auf die der Monitor beschränkt ist, falls vorhanden |

## Best Practices

- **Auto-Anbietertyp verwenden**, sofern Sie das genaue Format nicht kennen — die Auto-Erkennung funktioniert für die meisten Status-Seiten gut
- **Auf eine Komponentengruppe beschränken**, wenn Sie nur von einem Teil eines Anbieters abhängen (z. B. nur den „APIs" von OpenAI), damit nicht zusammenhängende Incidents kein Rauschen erzeugen
- **Bestimmte Komponenten überwachen**, wenn Sie nur von bestimmten Diensten abhängen (z. B. einer bestimmten AWS-Region)
- **Incident-Korrelation einrichten** — wenn Ihre Monitore Probleme erkennen und die Upstream-Status-Seite auch Probleme zeigt, hilft das, Grundursachen schneller zu identifizieren
- **Mit anderen Monitoren kombinieren** — Externe Status-Seiten-Monitore mit Ihren eigenen API/Website-Monitoren für umfassende Sichtbarkeit koppeln

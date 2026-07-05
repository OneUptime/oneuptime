# MCP-Server

Der OneUptime Model Context Protocol (MCP)-Server bietet LLMs direkten Zugriff auf Ihre OneUptime-Instanz und ermöglicht KI-gestützte Überwachung, Incident-Management und Observability-Vorgänge.

## Was ist der OneUptime MCP-Server?

Der OneUptime MCP-Server ist eine Brücke zwischen Large Language Models (LLMs) und Ihrer OneUptime-Instanz. Er implementiert das Model Context Protocol (MCP) und ermöglicht KI-Assistenten wie Claude, direkt mit Ihrer Überwachungsinfrastruktur zu interagieren.

## Funktionsweise

Der MCP-Server wird zusammen mit Ihrer OneUptime-Instanz gehostet und ist über den Streamable HTTP-Transport zugänglich. Es ist keine lokale Installation erforderlich.

**Cloud-Benutzer**: `https://oneuptime.com/mcp`
**Selbst gehostete Benutzer**: `https://your-oneuptime-domain.com/mcp`

## Hauptfunktionen

- **~155 Tools**: Vollständige CRUD-Tools für 22 Ressourcentypen (Incidents, Alerts, Monitore, Status-Seiten, On-Call und mehr), schreibgeschützte Telemetrie-Tools sowie Workflow- und Hilfs-Tools
- **Echtzeit-Vorgänge**: Ressourcen in Echtzeit erstellen, lesen, aktualisieren und löschen
- **Typensichere Schnittstelle**: Vollständig typisiert mit umfassender Eingabevalidierung
- **Sichere Authentifizierung**: API-Schlüssel-Authentifizierung pro Anfrage mit korrekter Fehlerbehandlung
- **Sicherheitsannotationen**: Schreibgeschützte Tools tragen `readOnlyHint` und Lösch-Tools tragen `destructiveHint`, sodass MCP-Clients sichere Aufrufe automatisch genehmigen und vor destruktiven nachfragen können
- **Einfache Integration**: Funktioniert mit Claude Desktop und anderen MCP-kompatiblen Clients
- **Von Grund auf zustandslos**: Keine Sitzungs-IDs — jede Anfrage ist in sich abgeschlossen, sodass der Server hinter Load Balancern und in Multi-Replica-Deployments funktioniert

## Was Sie tun können

Mit dem OneUptime MCP-Server können KI-Assistenten Ihnen helfen bei:

- **Monitor-Verwaltung**: Monitore erstellen und konfigurieren, deren Status prüfen und den Statusverlauf einsehen
- **Incident-Reaktion**: Incidents erstellen, bestätigen und lösen, interne oder öffentliche Notizen hinzufügen und die Lösung verfolgen
- **Team-Vorgänge**: Teams und On-Call-Richtlinien verwalten
- **Status-Seiten**: Status-Seiten verwalten und Ankündigungen erstellen
- **Alarmierung**: Alerts bestätigen und lösen, Alert-Notizen hinzufügen sowie Alert-Zustände und -Schweregrade verwalten
- **Geplante Wartung**: Geplante Wartungsereignisse erstellen und verwalten
- **Telemetrie**: Logs, Metriken, Traces, Exceptions und Monitor-Logs abfragen (nur lesend)

## Anforderungen

- OneUptime-Instanz (Cloud oder selbst gehostet)
- MCP-kompatibler Client (Claude Desktop, VS Code mit GitHub Copilot usw.)
- Gültiger OneUptime-API-Schlüssel (nur für authentifizierte Vorgänge erforderlich – öffentliche Tools funktionieren ohne ihn)

## Ihren API-Schlüssel erhalten

1. Melden Sie sich bei Ihrer OneUptime-Instanz an
2. Navigieren Sie zu **Einstellungen** → **API-Schlüssel**
3. Klicken Sie auf **API-Schlüssel erstellen**
4. Geben Sie einen Namen an (z. B. "MCP Server")
5. Wählen Sie die entsprechenden Berechtigungen für Ihren Anwendungsfall
6. Kopieren Sie den generierten API-Schlüssel

API-Schlüssel sind projektbezogen: Der MCP-Server leitet Ihr Projekt aus dem Schlüssel ab, sodass Create-Tools niemals ein `projectId`-Argument benötigen.

> **Warnung — geben Sie einem KI-Agenten niemals einen Master-Schlüssel.** Ein OneUptime-*Master*-API-Schlüssel wird auf diesem Header ebenfalls akzeptiert und gewährt instanzweiten Admin-Zugriff. Verwenden Sie stets einen Projekt-API-Schlüssel mit den geringsten Rechten, die der Agent benötigt (ein Nur-Lese-Schlüssel genügt für alle `get_`-/`list_`-/`count_`-Tools).

## Konfiguration

### Claude Desktop-Konfiguration

Finden Sie Ihre Claude Desktop-Konfigurationsdatei:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### Für OneUptime Cloud

Fügen Sie die folgende Konfiguration hinzu:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### Für selbst gehostetes OneUptime

Ersetzen Sie `oneuptime.com` durch Ihre OneUptime-Domain:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### Öffentlicher Zugriff (kein API-Schlüssel)

Um nur öffentliche Tools zu verwenden (Status-Seiten-Informationen, Hilfe), können Sie sich ohne API-Schlüssel verbinden:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

Diese Konfiguration ermöglicht den Zugriff auf öffentliche Status-Seiten-Tools und Hilfsressourcen ohne Authentifizierung.

### VS Code mit GitHub Copilot

VS Code unterstützt MCP-Server nativ mit GitHub Copilot (Version 1.99+). Dadurch kann Copilot direkt auf OneUptime-Daten zugreifen.

#### Schritt 1: Anforderungen

- VS Code Version 1.99 oder höher
- GitHub Copilot-Erweiterung installiert und aktiviert
- GitHub Copilot Chat aktiviert

#### Schritt 2: MCP-Konfiguration öffnen

1. Drücken Sie `Ctrl+Shift+P` (Windows/Linux) oder `Cmd+Shift+P` (macOS)
2. Geben Sie "MCP: Open User Configuration" ein und drücken Sie Enter
3. Dadurch wird die `mcp.json`-Konfigurationsdatei geöffnet oder erstellt

Alternativ erstellen Sie `.vscode/mcp.json` in Ihrem Workspace für projektspezifische Konfiguration.

#### Für OneUptime Cloud

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### Für selbst gehostetes OneUptime

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### Schritt 3: MCP-Server starten

1. Drücken Sie `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Geben Sie "MCP: List Servers" ein, um verfügbare Server anzuzeigen
3. Klicken Sie auf "oneuptime", um den Server zu starten
4. Geben Sie bei Aufforderung Ihren OneUptime-API-Schlüssel ein

#### Schritt 4: Mit Copilot Chat verwenden

Öffnen Sie GitHub Copilot Chat und verwenden Sie den Agent-Modus (`@workspace` oder direkte Anfragen):

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### Sicherheitshinweis

Die obige Konfiguration verwendet Eingabevariablen mit `"password": true`, um sicher nach Ihrem API-Schlüssel zu fragen, anstatt ihn im Klartext zu speichern. VS Code fordert Sie auf, beim erstmaligen Start des MCP-Servers das Vertrauen zu bestätigen.

## Verfügbare Endpunkte

| Endpunkt      | Methode | Beschreibung                                                                                                                    |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`        | POST    | JSON-RPC-Anfragen für Tool-Aufrufe und andere Vorgänge                                                                            |
| `/mcp`        | GET     | Ohne SSE-`Accept`-Header: freundliche JSON-Discovery-Antwort. Mit einem solchen Header: `405` — der zustandslose Server bietet keinen eigenständigen SSE-Stream an (konforme Clients fahren ohne ihn fort) |
| `/mcp`        | DELETE  | No-op (der Server ist zustandslos, es gibt also keine Sitzung, die beendet werden könnte)                                          |
| `/mcp/health` | GET     | Health-Check-Endpunkt                                                                                                            |
| `/mcp/tools`  | GET     | REST API zum Auflisten verfügbarer Tools                                                                                          |

## Authentifizierung

Der MCP-Server unterstützt zwei Betriebsmodi:

### Öffentliche Tools (keine Authentifizierung erforderlich)

Sie können sich ohne API-Schlüssel mit dem MCP-Server verbinden, um auf öffentliche Tools zuzugreifen:

- **`oneuptime_help`**: Hilfe und Anleitungen zu OneUptime-MCP-Funktionen erhalten
- **`oneuptime_list_resources`**: Verfügbare Ressourcen und deren Vorgänge auflisten
- **`get_public_status_page_overview`**: Übersicht einer öffentlichen Status-Seite abrufen
- **`get_public_status_page_incidents`**: Incidents von einer öffentlichen Status-Seite abrufen
- **`get_public_status_page_scheduled_maintenance`**: Geplante Wartungsereignisse abrufen
- **`get_public_status_page_announcements`**: Ankündigungen von einer öffentlichen Status-Seite abrufen

Öffentliche Status-Seiten-Tools akzeptieren entweder eine Status-Seiten-ID (UUID) oder den Domänennamen der Status-Seite.

### Authentifizierte Tools (API-Schlüssel erforderlich)

Für alle anderen Vorgänge (Monitore, Incidents, Teams usw. verwalten) ist eine Authentifizierung über einen der folgenden Header erforderlich:

- `x-api-key`: Ihr OneUptime-API-Schlüssel
- `Authorization`: Bearer-Token mit Ihrem API-Schlüssel (z. B. `Bearer your-api-key-here`)

Das `Bearer`-Schema ist unabhängig von Groß- und Kleinschreibung. Tool-Fehler werden als In-Band-Tool-Ergebnisse (`isError: true`) mit einem `statusCode`, Details und einem Vorschlag zurückgegeben — nicht als MCP-Protokollfehler —, sodass Agenten den Fehler lesen und sich selbst korrigieren können.

## Workflow-Tools

Über die CRUD-Tools pro Ressource hinaus liefert der Server speziell entwickelte Workflow-Tools für die Incident- und Alert-Reaktion:

- **`acknowledge_incident`** / **`resolve_incident`**: Versetzen einen Incident in den Zustand „Bestätigt“ oder „Gelöst“ des Projekts — gleichbedeutend mit dem Klick auf die Schaltfläche im Dashboard
- **`acknowledge_alert`** / **`resolve_alert`**: Dasselbe für Alerts
- **`add_incident_note`**: Fügt einem Incident eine Notiz hinzu, mit `visibility: "internal"` (nur Team, der Standard) oder `visibility: "public"` (wird auf der Status-Seite veröffentlicht). Markdown wird unterstützt
- **`add_alert_note`**: Fügt einem Alert eine interne Notiz hinzu

Ein typischer Ablauf: `list_incidents` → `acknowledge_incident` → Untersuchung mit `list_logs` → `add_incident_note` (öffentlich) → `resolve_incident`.

## Who Am I

Das Tool **`oneuptime_whoami`** gibt das Projekt zurück, zu dem Ihr API-Schlüssel gehört (ID und Name). Es ist ein nützlicher erster Aufruf, mit dem sich ein Agent orientieren kann — und da Create-Tools die `projectId` aus dem API-Schlüssel ableiten, muss der Agent niemals eine Projekt-ID übergeben.

## Telemetrie abfragen

Logs, Metriken, Traces (Spans), Exceptions und Monitor-Logs werden als schreibgeschützte `list_`- und `count_`-Tools bereitgestellt (`list_logs`, `list_metrics`, `list_spans`, `list_exception_instances`, `list_monitor_logs` und ihre `count_`-Gegenstücke). Telemetrie wird über OpenTelemetry aufgenommen, daher gibt es keine Create-Tools.

Fragen Sie Telemetrie immer mit einem Zeitbereichsfilter ab. Abfragefelder akzeptieren entweder einen direkten Wert oder ein Operator-Objekt:

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

Unterstützte Operatoren: `EqualTo`, `NotEqual`, `IsNull`, `NotNull`, `EqualToOrNull`, `GreaterThan`, `LessThan`, `GreaterThanOrEqual`, `LessThanOrEqual`, `InBetween`, `Search`, `Includes`. Sortierwerte sind `"ASC"` oder `"DESC"`.

## Feldauswahl und Paginierung

`get_`- und `list_`-Tools akzeptieren ein optionales `select`-Array mit Feldnamen. Standardmäßig werden alle lesbaren Felder zurückgegeben, mit Ausnahme der schwergewichtigen (JSON-, Sehr-lange-Text- und HTML-Spalten), die explizit in `select` angefordert werden müssen.

List-Tools paginieren mit `limit` (Standard 10, maximal 100) und `skip`, und jede List-Antwort meldet genau, was sie zurückgegeben hat:

```json
{
  "returnedCount": 10,
  "totalCount": 42,
  "skip": 0,
  "limit": 10,
  "hasMore": true,
  "data": ["..."]
}
```

## Verifizierung

Überprüfen Sie, ob der MCP-Server läuft:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

Verfügbare Tools auflisten:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/tools
```

## Verwendungsbeispiele

### Grundlegende Informationsabfragen

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### Monitor-Verwaltung

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### Incident-Verwaltung

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### Team und On-Call

```
"List the teams in this project"
"Show me our on-call policies"
```

### Status-Seiten-Verwaltung

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### Öffentliche Status-Seiten-Abfragen (kein API-Schlüssel erforderlich)

Diese Abfragen funktionieren ohne Authentifizierung und verwenden nur die öffentlichen Status-Seiten-Tools:

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### Erweiterte Vorgänge

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## API-Schlüssel-Berechtigungen

### Nur-Lese-Zugriff

Für das reine Anzeigen von Daten fügen Sie Ihrem API-Schlüssel Leseberechtigungen hinzu.

### Vollzugriff

Für vollständigen Zugriff zum Erstellen, Aktualisieren und Löschen von Ressourcen stellen Sie sicher, dass Ihr API-Schlüssel Project Admin-Berechtigungen hat.

### Best Practices

- Spezifische Berechtigungen verwenden: Nur die minimal notwendigen Berechtigungen erteilen
- API-Schlüssel rotieren: Regelmäßig API-Schlüssel rotieren
- Nutzung überwachen: API-Schlüsselnutzung in OneUptime verfolgen
- Separate Schlüssel: Verschiedene API-Schlüssel für unterschiedliche Umgebungen verwenden

## Fehlerbehebung

### Berechtigungsfehler

Stellen Sie sicher, dass Ihr API-Schlüssel die erforderlichen Berechtigungen hat:

- Lesezugriff zum Auflisten von Ressourcen
- Schreibzugriff zum Erstellen/Aktualisieren von Ressourcen
- Löschzugriff, wenn Sie Ressourcen entfernen möchten

### Verbindungsprobleme

1. Überprüfen Sie, ob Ihre OneUptime-URL korrekt ist
2. Prüfen Sie, ob Ihr API-Schlüssel gültig ist
3. Stellen Sie sicher, dass Ihre OneUptime-Instanz erreichbar ist
4. Testen Sie den Health-Endpunkt

### Ungültiger API-Schlüssel

- Überprüfen Sie den API-Schlüssel in Ihren OneUptime-Einstellungen
- Prüfen Sie auf zusätzliche Leerzeichen oder Zeichen
- Stellen Sie sicher, dass der Schlüssel nicht abgelaufen ist

### Sitzungsfehler

Wenn Sie sitzungsbezogene Fehler erhalten:

- Der MCP-Server ist zustandslos — er vergibt und verfolgt keine Sitzungs-IDs, sodass jede Anfrage gegen jedes Server-Replikat funktioniert
- Clients, die einen `mcp-session-id`-Header aus einer früheren Serverversion senden, können ihn einfach weglassen; er wird ignoriert
- Aktualisieren Sie ältere MCP-Client-Konfigurationen, die erwarten, dass der Server eine Sitzungs-ID zurückgibt

## Verfügbare Ressourcen

Der MCP-Server bietet Tools für die folgenden Ressourcen:

**Überwachung**: Monitor, Monitor-Status, Monitor-Status-Ereignis
**Incidents**: Incident, Incident-Zustand, Incident-Schweregrad, Incident-Zustandsverlauf, Öffentliche Incident-Notiz, Interne Incident-Notiz
**Alerts**: Alert, Alert-Zustand, Alert-Schweregrad, Alert-Zustandsverlauf, Interne Alert-Notiz
**Status-Seiten**: Status-Seite, Status-Seiten-Ankündigung
**Geplante Wartung**: Geplantes Wartungsereignis, Wartungszustand, Wartungszustandsverlauf
**Teams & On-Call**: Team, On-Call-Richtlinie
**Labels**: Label
**Telemetrie (nur lesend)**: Log, Metrik, Span, Exception-Instanz, Monitor-Log

Jede Datenbankressource unterstützt Create, Get, List, Update, Delete und Count über snake_case-Tools — zum Beispiel `create_incident`, `get_incident`, `list_incidents`, `update_incident`, `delete_incident`, `count_incidents`. Telemetrie-Ressourcen stellen nur `list_`- und `count_`-Tools bereit (zum Beispiel `list_logs`, `count_spans`).

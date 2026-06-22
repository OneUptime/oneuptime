# MCP-Server

Der OneUptime Model Context Protocol (MCP)-Server bietet LLMs direkten Zugriff auf Ihre OneUptime-Instanz und ermöglicht KI-gestützte Überwachung, Incident-Management und Observability-Vorgänge.

## Was ist der OneUptime MCP-Server?

Der OneUptime MCP-Server ist eine Brücke zwischen Large Language Models (LLMs) und Ihrer OneUptime-Instanz. Er implementiert das Model Context Protocol (MCP) und ermöglicht KI-Assistenten wie Claude, direkt mit Ihrer Überwachungsinfrastruktur zu interagieren.

## Funktionsweise

Der MCP-Server wird zusammen mit Ihrer OneUptime-Instanz gehostet und ist über den Streamable HTTP-Transport zugänglich. Es ist keine lokale Installation erforderlich.

**Cloud-Benutzer**: `https://oneuptime.com/mcp`
**Selbst gehostete Benutzer**: `https://your-oneuptime-domain.com/mcp`

## Hauptfunktionen

- **Vollständige API-Abdeckung**: Zugriff auf 711 OneUptime-API-Endpunkte
- **126 Ressourcentypen**: Verwalten Sie alle OneUptime-Ressourcen einschließlich Monitore, Incidents, Teams, Probes und mehr
- **Echtzeit-Vorgänge**: Ressourcen in Echtzeit erstellen, lesen, aktualisieren und löschen
- **Typensichere Schnittstelle**: Vollständig typisiert mit umfassender Eingabevalidierung
- **Sichere Authentifizierung**: API-Schlüssel-basierte Authentifizierung mit korrekter Fehlerbehandlung
- **Einfache Integration**: Funktioniert mit Claude Desktop und anderen MCP-kompatiblen Clients
- **Sitzungsverwaltung**: Eingebaute Sitzungsverwaltung mit automatischer Reconnection-Unterstützung

## Was Sie tun können

Mit dem OneUptime MCP-Server können KI-Assistenten Ihnen helfen bei:

- **Monitor-Verwaltung**: Monitore erstellen und konfigurieren, deren Status prüfen und Monitor-Gruppen verwalten
- **Incident-Reaktion**: Incidents erstellen, Notizen hinzufügen, Teammitglieder zuweisen und Lösung verfolgen
- **Team-Vorgänge**: Teams, Berechtigungen und On-Call-Pläne verwalten
- **Status-Seiten**: Status-Seiten aktualisieren, Ankündigungen erstellen und Abonnenten verwalten
- **Benachrichtigungen**: Benachrichtigungsregeln konfigurieren, Eskalationsrichtlinien verwalten und Benachrichtigungsprotokolle prüfen
- **Probes**: Überwachungs-Probes an verschiedenen Standorten bereitstellen und verwalten
- **Berichte & Analysen**: Berichte erstellen und Überwachungsdaten analysieren

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

| Endpunkt      | Methode | Beschreibung                                                      |
| ------------- | ------- | ----------------------------------------------------------------- |
| `/mcp`        | GET     | Server-Sent-Events-Stream für Server-zu-Client-Benachrichtigungen |
| `/mcp`        | POST    | JSON-RPC-Anfragen für Tool-Aufrufe und andere Vorgänge            |
| `/mcp`        | DELETE  | Sitzungsbereinigung und -beendigung                               |
| `/mcp/health` | GET     | Health-Check-Endpunkt                                             |
| `/mcp/tools`  | GET     | REST API zum Auflisten verfügbarer Tools                          |

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

## Verifizierung

Überprüfen Sie, ob der MCP-Server läuft:

```bash
# Für OneUptime Cloud
curl https://oneuptime.com/mcp/health

# Für selbst gehostetes OneUptime
curl https://your-oneuptime-domain.com/mcp/health
```

Verfügbare Tools auflisten:

```bash
# Für OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# Für selbst gehostetes OneUptime
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
"Who are the members of the infrastructure team?"
"Who's currently on call for the infrastructure team?"
"Show me the on-call schedule for this week"
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

- Der MCP-Server verwendet den `mcp-session-id`-Header zur Sitzungsverfolgung
- Stellen Sie sicher, dass Ihr Client die vom Server zurückgegebene Sitzungs-ID korrekt verarbeitet
- Sitzungen werden automatisch bereinigt, wenn Verbindungen geschlossen werden

## Verfügbare Ressourcen

Der MCP-Server bietet Zugriff auf 126 Ressourcentypen, darunter:

**Überwachung**: Monitor, MonitorStatus, MonitorGroup, Probe
**Incidents**: Incident, IncidentState, IncidentNote, IncidentTemplate
**Benachrichtigungen**: Alert, AlertState, AlertSeverity
**Status-Seiten**: StatusPage, StatusPageAnnouncement, StatusPageSubscriber
**On-Call**: On-CallPolicy, EscalationRule, On-CallSchedule
**Teams**: Team, TeamMember, TeamPermission
**Telemetrie**: TelemetryService, Log, Span, Metric
**Workflows**: Workflow, WorkflowVariable, WorkflowLog

Jede Ressource unterstützt Standardvorgänge: List, Count, Get, Create, Update und Delete.

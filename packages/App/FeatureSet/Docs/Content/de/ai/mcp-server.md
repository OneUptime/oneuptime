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
- **Sichere Authentifizierung**: Anmeldung mit Ihrem OneUptime-Konto (OAuth 2.1) oder – für unbeaufsichtigte Agenten – ein API-Schlüssel, der mit jeder Anfrage gesendet wird
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
- Ein OneUptime-Konto, mit dem Sie sich anmelden, oder ein OneUptime-API-Schlüssel für einen Agenten, der unbeaufsichtigt läuft (nur für authentifizierte Vorgänge erforderlich – öffentliche Tools funktionieren ohne beides)

## Mit OneUptime anmelden

Am einfachsten verbinden Sie Ihren MCP-Client, indem Sie ihm die Server-URL geben und sonst nichts. Wenn der Client zum ersten Mal Ihre Daten benötigt, öffnet er in Ihrem Browser eine OneUptime-Seite, auf der Sie Folgendes tun:

1. Melden Sie sich bei OneUptime an, falls Sie noch nicht angemeldet sind
2. Wählen Sie das Projekt, in dem der Client arbeiten soll
3. Wählen Sie, ob der Client **lesen und schreiben** oder **nur lesen** darf
4. Klicken Sie auf **Autorisieren**

Der Client handelt danach in diesem Projekt in Ihrem Namen. Es muss kein API-Schlüssel erstellt, kopiert oder rotiert werden, und in keiner Konfigurationsdatei wird etwas Geheimes gespeichert.

Was ein verbundener Client tun kann:

- **Er hat Ihre Berechtigungen – und niemals mehr als diese.** Genau das, was Ihre Teams Ihnen im Projekt erlauben, kann auch der Client tun. Wenn sich Ihre Rolle ändert oder Sie das Projekt verlassen, gilt das schon für die nächste Anfrage des Clients. Wenn Sie das Projekt verlassen, wird der Client außerdem getrennt: Seine Autorisierung wird gelöscht, und wenn Sie wieder beitreten, verbinden Sie ihn erneut.
- **Nur lesen heißt nur lesen.** Ein Client, der nur zum Lesen autorisiert wurde, kann die `get_`-, `list_`- und `count_`-Tools verwenden. Tools, die etwas erstellen, aktualisieren, löschen, bestätigen oder lösen, werden abgelehnt – vom MCP-Server und von der OneUptime-API dahinter. Sie können einem Client niemals mehr Zugriff geben, als er angefordert hat.
- **Er arbeitet in genau einem Projekt.** Um ein zweites Projekt zu nutzen, verbinden Sie den Client erneut und wählen Sie dieses Projekt.
- **Er funktioniert nur über den MCP-Server.** Das Zugriffstoken des Clients wird vom MCP-Endpunkt akzeptiert und nirgendwo sonst. Es kann nicht verwendet werden, um die OneUptime-REST-API direkt aufzurufen.
- **Instanzadministratoren erhalten keine Sonderbehandlung.** Ein Client, den ein Master-Admin verbunden hat, hat das, was die Teams dieser Person im Projekt gewähren, und keinen instanzweiten Zugriff.

### Verbundene Clients verwalten

Jeder Client, der per Anmeldung verbunden wurde, ist unter **Projekteinstellungen** → **MCP-Server** → **Connected MCP Clients** aufgeführt, zusammen mit der Angabe, wer ihn verbunden hat, was er darf und wann er zuletzt verwendet wurde. Sie sehen die Clients, die Sie selbst verbunden haben; Projektinhaber und -administratoren sehen die Clients aller.

Klicken Sie auf **Disconnect**, um einen Client abzumelden. Er funktioniert sofort nicht mehr.

Ein Client bleibt verbunden, solange er verwendet wird. Ein Client, der 30 Tage lang nicht verwendet wurde, muss sich erneut anmelden.

### Steuern, wer Clients verbinden darf

Standardmäßig kann jedes Projektmitglied einen MCP-Client verbinden. Um die Mitglieder eines Teams daran zu hindern, öffnen Sie das Team, gehen Sie zu **Berechtigungen blockieren** und fügen Sie die Berechtigung **Authorize MCP Client** hinzu. Clients, die diese Mitglieder bereits verbunden haben, funktionieren sofort nicht mehr.

Wenn das Projekt Single Sign-On verlangt, melden Sie sich in Ihrem Browser per SSO beim Projekt an, bevor Sie einen Client autorisieren. Die Verbindung des Clients besteht so lange wie diese SSO-Anmeldung; läuft diese ab, verbinden Sie den Client erneut.

In OneUptime Cloud ist das Verbinden eines MCP-Clients in denselben Tarifen verfügbar wie API-Schlüssel (Growth und höher).

In der Enterprise Edition wird jede Änderung, die ein verbundener Client vornimmt, im Audit-Log unter der Person erfasst, die ihn verbunden hat, zusammen mit dem Namen des Clients. Änderungen, die mit einem API-Schlüssel vorgenommen wurden, zeigen den Namen des Schlüssels.

## Ihren API-Schlüssel erhalten

Verwenden Sie einen API-Schlüssel für einen Agenten, der unbeaufsichtigt läuft – einen geplanten Job oder eine CI-Pipeline –, bei dem niemand da ist, der sich anmelden könnte.

1. Melden Sie sich bei Ihrer OneUptime-Instanz an
2. Navigieren Sie zu **Projekteinstellungen** → **API-Schlüssel**
3. Klicken Sie auf **API-Schlüssel erstellen**
4. Geben Sie einen Namen an (z. B. "MCP Server")
5. Wählen Sie die entsprechenden Berechtigungen für Ihren Anwendungsfall
6. Kopieren Sie den generierten API-Schlüssel

API-Schlüssel sind projektbezogen: Der MCP-Server leitet Ihr Projekt aus dem Schlüssel ab, sodass Create-Tools niemals ein `projectId`-Argument benötigen.

> **Warnung — geben Sie einem KI-Agenten niemals einen Master-Schlüssel.** Ein OneUptime-*Master*-API-Schlüssel wird auf diesem Header ebenfalls akzeptiert und gewährt instanzweiten Admin-Zugriff. Verwenden Sie stets einen Projekt-API-Schlüssel mit den geringsten Rechten, die der Agent benötigt (ein Nur-Lese-Schlüssel genügt für alle `get_`-/`list_`-/`count_`-Tools).

## Konfiguration

### Per Anmeldung verbinden

Fügen Sie Ihrem Client die Server-URL ohne Anmeldedaten hinzu. Verwenden Sie für eine selbst gehostete Instanz `https://your-oneuptime-domain.com/mcp`.

**Claude Code**

```bash
claude mcp add --transport http oneuptime https://oneuptime.com/mcp
```

Führen Sie anschließend in Claude Code `/mcp` aus und wählen Sie **oneuptime**, um sich anzumelden.

**Claude (Web und Desktop)**

Öffnen Sie **Customize** → **Connectors**, wählen Sie **Add custom connector** und geben Sie `https://oneuptime.com/mcp` ein. Claude fordert Sie zur Anmeldung bei OneUptime auf, sobald Ihre Daten zum ersten Mal benötigt werden.

**VS Code mit GitHub Copilot**

Fügen Sie Folgendes zu Ihrer MCP-Konfiguration hinzu (wo diese Datei liegt, steht unter [VS Code mit GitHub Copilot](#vs-code-mit-github-copilot)). Wenn Sie den Server starten, öffnet VS Code OneUptime, damit Sie sich anmelden können:

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

**Cursor**

```json
{
  "mcpServers": {
    "oneuptime": {
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

Jeder andere Client, der die MCP-Autorisierung unterstützt, funktioniert genauso: Geben Sie ihm die URL, und er ermittelt alles Weitere selbst. Die Protokolldetails finden Sie unter [Anmeldung (OAuth 2.1)](#anmeldung-oauth-21).

Der Rest dieses Abschnitts zeigt, wie dieselben Clients stattdessen mit einem API-Schlüssel konfiguriert werden.

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

MCP-Clients, die sich anmelden, verwenden außerdem die folgenden OAuth-Endpunkte. Ein Client findet sie selbst; sie sind hier für alle aufgeführt, die einen Client schreiben oder einen Proxy konfigurieren.

| Endpunkt                                      | Methode | Beschreibung                                                             |
| --------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| `/mcp/.well-known/oauth-protected-resource`   | GET     | Metadaten der geschützten Ressource (RFC 9728). Auch unter `/.well-known/oauth-protected-resource/mcp` |
| `/.well-known/oauth-authorization-server/mcp` | GET     | Metadaten des Autorisierungsservers (RFC 8414). Auch unter `/mcp/.well-known/oauth-authorization-server` |
| `/mcp/oauth/authorize`                        | GET     | Autorisierungsendpunkt: Dorthin schickt der Client Ihren Browser, damit Sie sich anmelden |
| `/mcp/oauth/token`                            | POST    | Token-Endpunkt: tauscht einen Autorisierungscode oder ein Refresh-Token ein |
| `/mcp/oauth/register`                         | POST    | Dynamic Client Registration (RFC 7591)                                   |
| `/mcp/oauth/revoke`                           | POST    | Token-Widerruf (RFC 7009)                                                |

## Authentifizierung

Der MCP-Server unterstützt drei Betriebsmodi:

### Öffentliche Tools (keine Authentifizierung erforderlich)

Sie können sich ohne API-Schlüssel mit dem MCP-Server verbinden, um auf öffentliche Tools zuzugreifen:

- **`oneuptime_help`**: Hilfe und Anleitungen zu OneUptime-MCP-Funktionen erhalten
- **`oneuptime_list_resources`**: Verfügbare Ressourcen und deren Vorgänge auflisten
- **`get_public_status_page_overview`**: Übersicht einer öffentlichen Status-Seite abrufen
- **`get_public_status_page_incidents`**: Incidents von einer öffentlichen Status-Seite abrufen
- **`get_public_status_page_scheduled_maintenance`**: Geplante Wartungsereignisse abrufen
- **`get_public_status_page_announcements`**: Ankündigungen von einer öffentlichen Status-Seite abrufen

Öffentliche Status-Seiten-Tools akzeptieren entweder eine Status-Seiten-ID (UUID) oder den Domänennamen der Status-Seite.

### Anmeldung (OAuth 2.1)

Für alle anderen Vorgänge (Monitore, Incidents, Teams usw. verwalten) muss der Aufrufer identifiziert werden. Ein Client, der keine Anmeldedaten sendet und eines dieser Tools aufruft, erhält als Antwort `401 Unauthorized` und einen `WWW-Authenticate`-Header, der auf die Metadaten der geschützten Ressource des Servers verweist. Das ist das Signal, auf das ein MCP-Client reagiert, um Sie anzumelden; `initialize`, `tools/list` und die öffentlichen Tools verlangen nie eine Anmeldung.

Der Server implementiert die [MCP-Autorisierungsspezifikation](https://modelcontextprotocol.io/specification/latest/basic/authorization):

- **Ablauf**: Autorisierungscode-Flow nach OAuth 2.1 mit PKCE (nur `S256`). Zugriffstoken werden als `Authorization: Bearer` gesendet.
- **Discovery**: Metadaten der geschützten Ressource (RFC 9728) und Metadaten des Autorisierungsservers (RFC 8414). Aussteller und Ressource sind beide `https://<host>/mcp`.
- **Client-Identität**: ein Client ID Metadata Document (die Client-ID ist eine `https`-URL, die der Server abruft) oder Dynamic Client Registration (RFC 7591). Kein Client muss von einem Administrator registriert werden.
- **Scopes**: `mcp:read` für die `get_`-, `list_`- und `count_`-Tools; `mcp:write` fügt jedes Tool hinzu, das etwas ändert, und schließt `mcp:read` ein. Ein Nur-Lese-Token, das ein schreibendes Tool aufruft, erhält als Antwort `403` und `error="insufficient_scope"`.
- **Token-Lebensdauer**: Ein Zugriffstoken gilt eine Stunde. Ein Refresh-Token gilt 30 Tage und wird bei jeder Verwendung ersetzt; wird ein bereits ersetztes Refresh-Token verwendet, beendet das die Verbindung.
- **Ressourcenindikatoren** (RFC 8707): Ein Token wird für `https://<host>/mcp` ausgestellt und nirgendwo sonst akzeptiert.
- **Widerruf** (RFC 7009): Der Widerruf eines der beiden Token beendet die Verbindung.

### API-Schlüssel

Ein Agent, der unbeaufsichtigt läuft, authentifiziert sich mit einem OneUptime-API-Schlüssel in einem der folgenden Header:

- `x-api-key`: Ihr OneUptime-API-Schlüssel
- `Authorization`: Bearer-Token mit Ihrem API-Schlüssel (z. B. `Bearer your-api-key-here`)

Das `Bearer`-Schema ist unabhängig von Groß- und Kleinschreibung. Eine Anfrage, die einen API-Schlüssel enthält, wird nie zur Anmeldung aufgefordert.

Tool-Fehler werden als In-Band-Tool-Ergebnisse (`isError: true`) mit einem `statusCode`, Details und einem Vorschlag zurückgegeben — nicht als MCP-Protokollfehler —, sodass Agenten den Fehler lesen und sich selbst korrigieren können.

## Workflow-Tools

Über die CRUD-Tools pro Ressource hinaus liefert der Server speziell entwickelte Workflow-Tools für die Incident- und Alert-Reaktion:

- **`acknowledge_incident`** / **`resolve_incident`**: Versetzen einen Incident in den Zustand „Bestätigt“ oder „Gelöst“ des Projekts — gleichbedeutend mit dem Klick auf die Schaltfläche im Dashboard
- **`acknowledge_alert`** / **`resolve_alert`**: Dasselbe für Alerts
- **`add_incident_note`**: Fügt einem Incident eine Notiz hinzu, mit `visibility: "internal"` (nur Team, der Standard) oder `visibility: "public"` (wird auf der Status-Seite veröffentlicht). Markdown wird unterstützt
- **`add_alert_note`**: Fügt einem Alert eine interne Notiz hinzu

Ein typischer Ablauf: `list_incidents` → `acknowledge_incident` → Untersuchung mit `list_logs` → `add_incident_note` (öffentlich) → `resolve_incident`.

## Who Am I

Das Tool **`oneuptime_whoami`** gibt das Projekt zurück, zu dem Ihre Anmeldedaten gehören (ID und Name). Bei einem Client, der sich angemeldet hat, gibt das Tool außerdem zurück, als wer er angemeldet ist und ob er Änderungen vornehmen darf. Es ist ein nützlicher erster Aufruf, mit dem sich ein Agent orientieren kann — und da Create-Tools die `projectId` aus den Anmeldedaten ableiten, muss der Agent niemals eine Projekt-ID übergeben.

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

## Konfiguration für selbst gehostetes OneUptime

Die Anmeldung funktioniert auf einer selbst gehosteten Instanz ohne weitere Einrichtung. Es gibt zwei Einstellungen:

| Umgebungsvariable | Helm-Wert | Wirkung |
| --- | --- | --- |
| `DISABLE_MCP_OAUTH` | `mcpOAuth.disabled` | Auf `true` setzen, um die Anmeldung abzuschalten. Die OAuth-Endpunkte werden nicht mehr bereitgestellt, und der MCP-Server akzeptiert nur noch API-Schlüssel. Nichts wird gelöscht; verbundene Clients funktionieren wieder, sobald die Anmeldung wieder eingeschaltet wird. |
| `DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS` | `mcpOAuth.disableClientIdMetadataDocuments` | Auf `true` setzen, wenn die Instanz das Internet nicht erreichen kann. Ein Client kann sich mit einer URL ausweisen, die OneUptime abruft; ist dieser Wert gesetzt, registrieren sich Clients stattdessen direkt bei Ihrer Instanz, was keine ausgehende Anfrage erfordert. |

Wenn Sie vor OneUptime einen eigenen Reverse-Proxy betreiben, leiten Sie `/.well-known/oauth-protected-resource` und `/.well-known/oauth-authorization-server` (und alles darunter) zusammen mit `/mcp` an OneUptime weiter. Der mitgelieferte Ingress tut das bereits.

Der Server bildet jede OAuth-URL aus den Einstellungen `HOST` und `HTTP_PROTOCOL`; sie müssen daher der Adresse entsprechen, unter der Ihre Instanz erreicht wird.

## Fehlerbehebung

### Anmeldeprobleme

- **Der Client fordert mich nie zur Anmeldung auf**: Möglicherweise unterstützt der Client die MCP-Autorisierung nicht, oder er ist mit einem API-Schlüssel-Header konfiguriert, der Vorrang hat. Entfernen Sie den Header, um sich stattdessen anzumelden.
- **Mein Projekt ist auf der Autorisierungsseite ausgegraut**: Die Seite nennt den Grund neben dem Projektnamen – der Tarif des Projekts umfasst das Verbinden von MCP-Clients nicht, das Projekt verlangt SSO und dieser Browser ist dort nicht per SSO angemeldet, oder Ihr Team ist für das Verbinden von Clients gesperrt.
- **Ein Tool wird mit „read-only“ abgelehnt**: Der Client wurde nur zum Lesen autorisiert. Verbinden Sie ihn erneut und wählen Sie **Lesen und Schreiben**.
- **Der Client funktioniert nicht mehr**: Er wurde getrennt, wurde 30 Tage lang nicht verwendet, Sie wurden aus dem Projekt entfernt, oder die SSO-Anmeldung des Projekts ist abgelaufen. Verbinden Sie ihn erneut.
- **Selbst gehostet – der Client meldet, dass er den Autorisierungsserver nicht finden kann**: Prüfen Sie, ob `HOST` und `HTTP_PROTOCOL` Ihrer öffentlichen Adresse entsprechen und ob Ihr Proxy die Pfade unter `/.well-known/oauth-*` weiterleitet.

### Berechtigungsfehler

Stellen Sie sicher, dass Ihr API-Schlüssel – oder, bei einem Client, der sich angemeldet hat, Ihr eigenes Konto – die erforderlichen Berechtigungen hat:

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

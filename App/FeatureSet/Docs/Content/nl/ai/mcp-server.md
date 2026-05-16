# MCP Server

De OneUptime Model Context Protocol (MCP) Server biedt LLM's directe toegang tot uw OneUptime-instantie, waardoor door AI aangedreven monitoring-, incidentbeheer- en observabiliteitsbewerkingen mogelijk worden.

## Wat is de OneUptime MCP Server?

De OneUptime MCP Server is een brug tussen Large Language Models (LLM's) en uw OneUptime-instantie. Hij implementeert het Model Context Protocol (MCP), waardoor AI-assistenten zoals Claude direct kunnen communiceren met uw monitoringinfrastructuur.

## Hoe het werkt

De MCP-server wordt gehost naast uw OneUptime-instantie en is toegankelijk via het Streamable HTTP-transport. Er is geen lokale installatie vereist.

**Cloudgebruikers**: `https://oneuptime.com/mcp`
**Zelf-gehoste gebruikers**: `https://your-oneuptime-domain.com/mcp`

## Belangrijkste functies

- **Volledige API-dekking**: Toegang tot 711 OneUptime API-eindpunten
- **126 resourcetypen**: Beheer alle OneUptime-resources, waaronder monitors, incidenten, teams, probes en meer
- **Realtime bewerkingen**: Resources aanmaken, lezen, bijwerken en verwijderen in realtime
- **Type-veilige interface**: Volledig getypeerd met uitgebreide invoervalidatie
- **Veilige authenticatie**: Op API-sleutels gebaseerde authenticatie met correcte foutafhandeling
- **Eenvoudige integratie**: Werkt met Claude Desktop en andere MCP-compatibele clients
- **Sessiebeheer**: Ingebouwd sessiebeheer met automatische herverbindingsondersteuning

## Wat u kunt doen

Met de OneUptime MCP Server kunnen AI-assistenten u helpen bij:

- **Monitorbeheer**: Monitors aanmaken en configureren, hun status controleren en monitorgroepen beheren
- **Incidentrespons**: Incidenten aanmaken, notities toevoegen, teamleden toewijzen en de oplossing bijhouden
- **Teambewerkingen**: Teams, machtigingen en piketschema's beheren
- **Statuspagina's**: Statuspagina's bijwerken, aankondigingen aanmaken en abonnees beheren
- **Meldingen**: Meldingsregels configureren, escalatiebeleid beheren en notificatielogboeken bekijken
- **Probes**: Monitoringprobes implementeren en beheren op verschillende locaties
- **Rapporten en analyses**: Rapporten genereren en monitoringgegevens analyseren

## Vereisten

- OneUptime-instantie (cloud of zelf-gehost)
- MCP-compatibele client (Claude Desktop, VS Code met GitHub Copilot, enz.)
- Geldige OneUptime API-sleutel (alleen vereist voor geauthenticeerde bewerkingen — publieke tools werken zonder)

## Uw API-sleutel ophalen

1. Log in op uw OneUptime-instantie
2. Navigeer naar **Instellingen** → **API-sleutels**
3. Klik op **API-sleutel aanmaken**
4. Geef een naam op (bijv. "MCP Server")
5. Selecteer de juiste machtigingen voor uw gebruiksscenario
6. Kopieer de gegenereerde API-sleutel

## Configuratie

### Claude Desktop-configuratie

Zoek uw Claude Desktop-configuratiebestand:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### Voor OneUptime Cloud

Voeg de volgende configuratie toe:

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

### Voor zelf-gehoste OneUptime

Vervang `oneuptime.com` door uw OneUptime-domein:

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

### Openbare toegang (geen API-sleutel)

Om alleen publieke tools te gebruiken (statuspagina-informatie, hulp), kunt u verbinding maken zonder API-sleutel:

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

Deze configuratie biedt toegang tot publieke statuspagina-tools en hulpbronnen zonder authenticatie.

### VS Code met GitHub Copilot

VS Code ondersteunt MCP-servers native met GitHub Copilot (versie 1.99+). Hierdoor kan Copilot rechtstreeks toegang krijgen tot OneUptime-gegevens.

#### Stap 1: Vereisten

- VS Code versie 1.99 of hoger
- GitHub Copilot-extensie geïnstalleerd en geactiveerd
- GitHub Copilot Chat ingeschakeld

#### Stap 2: MCP-configuratie openen

1. Druk op `Ctrl+Shift+P` (Windows/Linux) of `Cmd+Shift+P` (macOS)
2. Typ "MCP: Open User Configuration" en druk op Enter
3. Hiermee wordt het `mcp.json`-configuratiebestand geopend of aangemaakt

U kunt ook `.vscode/mcp.json` aanmaken in uw werkruimte voor projectspecifieke configuratie.

#### Voor OneUptime Cloud

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

#### Voor zelf-gehoste OneUptime

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

#### Stap 3: De MCP Server starten

1. Druk op `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Typ "MCP: List Servers" om beschikbare servers te bekijken
3. Klik op "oneuptime" om de server te starten
4. Voer uw OneUptime API-sleutel in wanneer daarom wordt gevraagd

#### Stap 4: Gebruiken met Copilot Chat

Open GitHub Copilot Chat en gebruik de Agent-modus (`@workspace` of stel direct vragen):

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### Beveiligingsopmerking

De bovenstaande configuratie gebruikt invoervariabelen met `"password": true` om veilig naar uw API-sleutel te vragen in plaats van deze in platte tekst op te slaan. VS Code vraagt u om vertrouwen te bevestigen wanneer de MCP-server voor het eerst wordt gestart.

## Beschikbare eindpunten

| Eindpunt | Methode | Beschrijving |
|----------|--------|-------------|
| `/mcp` | GET | Server-sent events-stream voor server-naar-client-meldingen |
| `/mcp` | POST | JSON-RPC-verzoeken voor tool-aanroepen en andere bewerkingen |
| `/mcp` | DELETE | Sessie opruimen en beëindigen |
| `/mcp/health` | GET | Gezondheidscontrolepunt |
| `/mcp/tools` | GET | REST API om beschikbare tools te vermelden |

## Authenticatie

De MCP-server ondersteunt twee bedrijfsmodi:

### Publieke tools (geen authenticatie vereist)

U kunt verbinding maken met de MCP-server zonder API-sleutel om toegang te krijgen tot publieke tools:

- **`oneuptime_help`**: Hulp en begeleiding over OneUptime MCP-mogelijkheden ophalen
- **`oneuptime_list_resources`**: Beschikbare resources en hun bewerkingen weergeven
- **`get_public_status_page_overview`**: Overzicht van een publieke statuspagina ophalen
- **`get_public_status_page_incidents`**: Incidenten van een publieke statuspagina ophalen
- **`get_public_status_page_scheduled_maintenance`**: Geplande onderhoudsgebeurtenissen ophalen
- **`get_public_status_page_announcements`**: Aankondigingen van een publieke statuspagina ophalen

Publieke statuspagina-tools accepteren een statuspagina-ID (UUID) of de domeinnaam van de statuspagina.

### Geauthenticeerde tools (API-sleutel vereist)

Voor alle andere bewerkingen (monitoren, incidenten, teams beheren, enz.) is authenticatie vereist via een van de volgende headers:

- `x-api-key`: Uw OneUptime API-sleutel
- `Authorization`: Bearer-token met uw API-sleutel (bijv. `Bearer your-api-key-here`)

## Verificatie

Controleer of de MCP-server actief is:

```bash
# Voor OneUptime Cloud
curl https://oneuptime.com/mcp/health

# Voor zelf-gehost
curl https://your-oneuptime-domain.com/mcp/health
```

Beschikbare tools weergeven:

```bash
# Voor OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# Voor zelf-gehost
curl https://your-oneuptime-domain.com/mcp/tools
```

## Gebruiksvoorbeelden

### Basisinformatiequery's

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### Monitorbeheer

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### Incidentbeheer

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### Team en piket

```
"Who are the members of the infrastructure team?"
"Who's currently on call for the infrastructure team?"
"Show me the on-call schedule for this week"
```

### Statuspaginabeheer

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### Publieke statuspagina-query's (geen API-sleutel vereist)

Deze query's werken zonder authenticatie, met alleen de publieke statuspagina-tools:

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### Geavanceerde bewerkingen

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## API-sleutelmachtigingen

### Alleen-lezen toegang
Voeg voor het uitsluitend bekijken van gegevens leesmachtigingen toe aan uw API-sleutel.

### Volledige toegang
Voor volledige toegang om resources aan te maken, bij te werken en te verwijderen, zorgt u dat uw API-sleutel Project Admin-machtigingen heeft.

### Best practices
- Gebruik specifieke machtigingen: Verleen alleen de minimale vereiste machtigingen
- Roteer API-sleutels: Roteer uw API-sleutels regelmatig
- Houd gebruik bij: Volg het gebruik van API-sleutels in OneUptime
- Aparte sleutels: Gebruik verschillende API-sleutels voor verschillende omgevingen

## Probleemoplossing

### Machtigingsfouten
Zorg dat uw API-sleutel de benodigde machtigingen heeft:
- Leestoegang voor het weergeven van resources
- Schrijftoegang voor het aanmaken/bijwerken van resources
- Verwijdertoegang als u resources wilt verwijderen

### Verbindingsproblemen
1. Controleer of uw OneUptime-URL correct is
2. Controleer of uw API-sleutel geldig is
3. Zorg dat uw OneUptime-instantie bereikbaar is
4. Test het gezondheidscontrolepunt

### Ongeldige API-sleutel
- Controleer de API-sleutel in uw OneUptime-instellingen
- Controleer op extra spaties of tekens
- Zorg dat de sleutel niet is verlopen

### Sessiefouten
Als u sessiegerelateerde fouten ontvangt:
- De MCP-server gebruikt de `mcp-session-id`-header om sessies bij te houden
- Zorg dat uw client het sessie-ID dat de server retourneert correct verwerkt
- Sessies worden automatisch opgeruimd wanneer verbindingen worden gesloten

## Beschikbare resources

De MCP-server biedt toegang tot 126 resourcetypen, waaronder:

**Monitoring**: Monitor, MonitorStatus, MonitorGroup, Probe
**Incidenten**: Incident, IncidentState, IncidentNote, IncidentTemplate
**Meldingen**: Alert, AlertState, AlertSeverity
**Statuspagina's**: StatusPage, StatusPageAnnouncement, StatusPageSubscriber
**Piket**: On-CallPolicy, EscalationRule, On-CallSchedule
**Teams**: Team, TeamMember, TeamPermission
**Telemetrie**: TelemetryService, Log, Span, Metric
**Workflows**: Workflow, WorkflowVariable, WorkflowLog

Elke resource ondersteunt standaardbewerkingen: Weergeven, Tellen, Ophalen, Aanmaken, Bijwerken en Verwijderen.

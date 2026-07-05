# MCP Server

De OneUptime Model Context Protocol (MCP) Server biedt LLM's directe toegang tot uw OneUptime-instantie, waardoor door AI aangedreven monitoring-, incidentbeheer- en observabiliteitsbewerkingen mogelijk worden.

## Wat is de OneUptime MCP Server?

De OneUptime MCP Server is een brug tussen Large Language Models (LLM's) en uw OneUptime-instantie. Hij implementeert het Model Context Protocol (MCP), waardoor AI-assistenten zoals Claude direct kunnen communiceren met uw monitoringinfrastructuur.

## Hoe het werkt

De MCP-server wordt gehost naast uw OneUptime-instantie en is toegankelijk via het Streamable HTTP-transport. Er is geen lokale installatie vereist.

**Cloudgebruikers**: `https://oneuptime.com/mcp`
**Zelf-gehoste gebruikers**: `https://your-oneuptime-domain.com/mcp`

## Belangrijkste functies

- **~155 tools**: Volledige CRUD-tools voor 22 resourcetypen (incidenten, meldingen, monitors, statuspagina's, piket en meer), alleen-lezen telemetrietools, plus workflow- en hulptools
- **Realtime bewerkingen**: Resources aanmaken, lezen, bijwerken en verwijderen in realtime
- **Type-veilige interface**: Volledig getypeerd met uitgebreide invoervalidatie
- **Veilige authenticatie**: API-sleutelauthenticatie per verzoek met correcte foutafhandeling
- **Veiligheidsannotaties**: Alleen-lezen tools dragen `readOnlyHint` en verwijdertools dragen `destructiveHint`, zodat MCP-clients veilige aanroepen automatisch kunnen goedkeuren en om bevestiging kunnen vragen bij destructieve
- **Eenvoudige integratie**: Werkt met Claude Desktop en andere MCP-compatibele clients
- **Stateless by design**: Geen sessie-ID's — elk verzoek is op zichzelf staand, zodat de server werkt achter load balancers en implementaties met meerdere replica's

## Wat u kunt doen

Met de OneUptime MCP Server kunnen AI-assistenten u helpen bij:

- **Monitorbeheer**: Monitors aanmaken en configureren, hun status controleren en de statushistorie bekijken
- **Incidentrespons**: Incidenten aanmaken, bevestigen en oplossen, interne of publieke notities toevoegen en de oplossing bijhouden
- **Teambewerkingen**: Teams en piketbeleid beheren
- **Statuspagina's**: Statuspagina's beheren en aankondigingen aanmaken
- **Meldingen**: Meldingen bevestigen en oplossen, meldingsnotities toevoegen en meldingsstatussen en -ernstniveaus beheren
- **Gepland onderhoud**: Geplande onderhoudsgebeurtenissen aanmaken en beheren
- **Telemetrie**: Logs, metrics, traces, excepties en monitorlogs opvragen (alleen-lezen)

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

API-sleutels zijn projectgebonden: de MCP-server leidt uw project af uit de sleutel, zodat aanmaaktools nooit een `projectId`-argument nodig hebben.

> **Waarschuwing — geef een AI-agent nooit een master-sleutel.** Een OneUptime *master*-API-sleutel wordt ook op deze header geaccepteerd en verleent beheerderstoegang tot de hele instantie. Gebruik altijd een project-API-sleutel met de minste rechten die de agent nodig heeft (een alleen-lezen sleutel volstaat voor alle `get_`/`list_`/`count_`-tools).

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

| Eindpunt      | Methode | Beschrijving                                                                                                                    |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`        | POST   | JSON-RPC-verzoeken voor tool-aanroepen en andere bewerkingen                                                                      |
| `/mcp`        | GET    | Zonder een SSE-`Accept`-header: vriendelijke JSON-discovery-payload. Met zo'n header: `405` — de stateless server biedt geen zelfstandige SSE-stream (conforme clients gaan zonder verder) |
| `/mcp`        | DELETE | No-op (de server is stateless, dus er is geen sessie om te beëindigen)                                                            |
| `/mcp/health` | GET    | Gezondheidscontrolepunt                                                                                                           |
| `/mcp/tools`  | GET    | REST API om beschikbare tools te vermelden                                                                                        |

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

Voor alle andere bewerkingen (monitors, incidenten, teams beheren, enz.) is authenticatie vereist via een van de volgende headers:

- `x-api-key`: Uw OneUptime API-sleutel
- `Authorization`: Bearer-token met uw API-sleutel (bijv. `Bearer your-api-key-here`)

Het `Bearer`-schema is hoofdletterongevoelig. Toolfouten worden geretourneerd als in-band toolresultaten (`isError: true`) met een `statusCode`, details en een suggestie — niet als MCP-protocolfouten — zodat agenten de fout kunnen lezen en zichzelf kunnen corrigeren.

## Workflowtools

Naast de CRUD-tools per resource levert de server speciaal gebouwde workflowtools voor incident- en meldingsrespons:

- **`acknowledge_incident`** / **`resolve_incident`**: Verplaats een incident naar de status Bevestigd of Opgelost van het project — gelijkwaardig aan het indrukken van de knop in het dashboard
- **`acknowledge_alert`** / **`resolve_alert`**: Hetzelfde voor meldingen
- **`add_incident_note`**: Voeg een notitie toe aan een incident met `visibility: "internal"` (alleen team, de standaard) of `visibility: "public"` (gepubliceerd op de statuspagina). Markdown wordt ondersteund
- **`add_alert_note`**: Voeg een interne notitie toe aan een melding

Een typische lus: `list_incidents` → `acknowledge_incident` → onderzoeken met `list_logs` → `add_incident_note` (publiek) → `resolve_incident`.

## Wie ben ik

De tool **`oneuptime_whoami`** retourneert het project waartoe uw API-sleutel behoort (ID en naam). Het is een nuttige eerste aanroep waarmee een agent zich kan oriënteren — en omdat aanmaaktools `projectId` afleiden uit de API-sleutel, hoeft de agent nooit een project-ID mee te geven.

## Telemetrie opvragen

Logs, metrics, traces (spans), excepties en monitorlogs zijn beschikbaar als alleen-lezen `list_`- en `count_`-tools (`list_logs`, `list_metrics`, `list_spans`, `list_exception_instances`, `list_monitor_logs` en hun `count_`-tegenhangers). Telemetrie wordt geïngest via OpenTelemetry, dus er zijn geen aanmaaktools.

Bevraag telemetrie altijd met een tijdbereikfilter. Queryvelden accepteren een directe waarde of een operatorobject:

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

Ondersteunde operatoren: `EqualTo`, `NotEqual`, `IsNull`, `NotNull`, `EqualToOrNull`, `GreaterThan`, `LessThan`, `GreaterThanOrEqual`, `LessThanOrEqual`, `InBetween`, `Search`, `Includes`. Sorteerwaarden zijn `"ASC"` of `"DESC"`.

## Veldselectie en paginering

`get_`- en `list_`-tools accepteren een optionele `select`-array met veldnamen. Standaard worden alle leesbare velden geretourneerd, behalve zware velden (JSON-, zeer-lange-tekst- en HTML-kolommen), die expliciet in `select` moeten worden aangevraagd.

Lijsttools pagineren met `limit` (standaard 10, maximaal 100) en `skip`, en elke lijstrespons meldt exact wat er is geretourneerd:

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

## Verificatie

Controleer of de MCP-server actief is:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

Beschikbare tools weergeven:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
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
"List the teams in this project"
"Show me our on-call policies"
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

- De MCP-server is stateless — hij geeft geen sessie-ID's uit en houdt ze niet bij, dus elk verzoek werkt tegen elke serverreplica
- Clients die een `mcp-session-id`-header uit een eerdere serverversie sturen, kunnen deze gewoon weglaten; hij wordt genegeerd
- Werk oudere MCP-clientconfiguraties bij die verwachten dat de server een sessie-ID retourneert

## Beschikbare resources

De MCP-server biedt tools voor de volgende resources:

**Monitoring**: Monitor, Monitorstatus, Monitorstatusgebeurtenis
**Incidenten**: Incident, Incidentstatus, Incidenternst, Incidentstatustijdlijn, Publieke incidentnotitie, Interne incidentnotitie
**Meldingen**: Melding, Meldingsstatus, Meldingsernst, Meldingsstatustijdlijn, Interne meldingsnotitie
**Statuspagina's**: Statuspagina, Statuspagina-aankondiging
**Gepland onderhoud**: Geplande onderhoudsgebeurtenis, Gepland-onderhoudsstatus, Gepland-onderhoudsstatustijdlijn
**Teams en piket**: Team, Piketbeleid
**Labels**: Label
**Telemetrie (alleen-lezen)**: Log, Metric, Span, Exceptie-instantie, Monitorlog

Elke databaseresource ondersteunt Aanmaken, Ophalen, Weergeven, Bijwerken, Verwijderen en Tellen via snake_case-tools — bijvoorbeeld `create_incident`, `get_incident`, `list_incidents`, `update_incident`, `delete_incident`, `count_incidents`. Telemetrieresources bieden alleen `list_`- en `count_`-tools (bijvoorbeeld `list_logs`, `count_spans`).

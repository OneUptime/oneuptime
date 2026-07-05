# MCP Server

OneUptime Model Context Protocol (MCP) Serveren giver LLM'er direkte adgang til din OneUptime-instans, hvilket muliggør AI-drevet overvågning, incident management og observabilitetsoperationer.

## Hvad er OneUptime MCP Serveren?

OneUptime MCP Serveren er en bro mellem Large Language Models (LLM'er) og din OneUptime-instans. Den implementerer Model Context Protocol (MCP), som giver AI-assistenter som Claude mulighed for at interagere direkte med din overvågningsinfrastruktur.

## Sådan fungerer det

MCP-serveren hostes sammen med din OneUptime-instans og er tilgængelig via Streamable HTTP-transporten. Der kræves ingen lokal installation.

**Skybrugere**: `https://oneuptime.com/mcp`
**Selvhostede brugere**: `https://your-oneuptime-domain.com/mcp`

## Nøglefunktioner

- **~155 værktøjer**: Fulde CRUD-værktøjer til 22 ressourcetyper (incidents, advarsler, monitorer, statussider, vagtplaner og mere), skrivebeskyttede telemetriværktøjer samt workflow- og hjælpeværktøjer
- **Realtidsoperationer**: Opret, læs, opdater og slet ressourcer i realtid
- **Typesikker grænseflade**: Fuldt typet med omfattende inputvalidering
- **Sikker autentificering**: API-nøgleautentificering pr. anmodning med korrekt fejlhåndtering
- **Sikkerhedsannoteringer**: Skrivebeskyttede værktøjer bærer `readOnlyHint`, og sletteværktøjer bærer `destructiveHint`, så MCP-klienter automatisk kan godkende sikre kald og spørge før destruktive
- **Nem integration**: Fungerer med Claude Desktop og andre MCP-kompatible klienter
- **Tilstandsløs by design**: Ingen sessions-ID'er — hver anmodning er selvstændig, så serveren fungerer bag load balancers og deployments med flere replikaer

## Hvad du kan gøre

Med OneUptime MCP Serveren kan AI-assistenter hjælpe dig med:

- **Monitoradministration**: Opret og konfigurer monitorer, kontroller deres status og gennemgå statushistorik
- **Incident-respons**: Opret, kvitter for og løs incidents, tilføj interne eller offentlige noter og spor løsning
- **Teamoperationer**: Administrer teams og vagtpolitikker
- **Statussider**: Administrer statussider og opret meddelelser
- **Advarsler**: Kvitter for og løs advarsler, tilføj advarselsnoter og administrer advarselstilstande og alvorlighedsgrader
- **Planlagt vedligeholdelse**: Opret og administrer planlagte vedligeholdelsesbegivenheder
- **Telemetri**: Forespørg på logs, metrikker, traces, exceptions og monitorlogs (skrivebeskyttet)

## Krav

- OneUptime-instans (sky eller selvhostet)
- MCP-kompatibel klient (Claude Desktop, VS Code med GitHub Copilot osv.)
- Gyldig OneUptime API-nøgle (kræves kun til autentificerede operationer – offentlige værktøjer fungerer uden den)

## Hentning af din API-nøgle

1. Log ind på din OneUptime-instans
2. Naviger til **Indstillinger** → **API-nøgler**
3. Klik på **Opret API-nøgle**
4. Angiv et navn (f.eks. "MCP Server")
5. Vælg de relevante tilladelser til dit brugsscenarie
6. Kopiér den genererede API-nøgle

API-nøgler er projektafgrænsede: MCP-serveren udleder dit projekt fra nøglen, så oprettelsesværktøjer aldrig har brug for et `projectId`-argument.

> **Advarsel — giv aldrig en AI-agent en masternøgle.** En OneUptime-*master*-API-nøgle accepteres også på denne header og giver administratoradgang til hele instansen. Brug altid en projekt-API-nøgle med de mindst mulige rettigheder, agenten har brug for (en skrivebeskyttet nøgle er nok til alle `get_`-/`list_`-/`count_`-værktøjer).

## Konfiguration

### Claude Desktop-konfiguration

Find din Claude Desktop-konfigurationsfil:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### For OneUptime Cloud

Tilføj følgende konfiguration:

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

### For selvhostet OneUptime

Erstat `oneuptime.com` med dit OneUptime-domæne:

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

### Offentlig adgang (ingen API-nøgle)

For kun at bruge offentlige værktøjer (statussideinformation, hjælp) kan du oprette forbindelse uden en API-nøgle:

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

Denne konfiguration giver adgang til offentlige statussideværktøjer og hjælperessourcer uden autentificering.

### VS Code med GitHub Copilot

VS Code understøtter MCP-servere nativt med GitHub Copilot (version 1.99+). Dette giver Copilot mulighed for at få adgang til OneUptime-data direkte.

#### Trin 1: Krav

- VS Code version 1.99 eller nyere
- GitHub Copilot-udvidelse installeret og aktiveret
- GitHub Copilot Chat aktiveret

#### Trin 2: Åbn MCP-konfiguration

1. Tryk på `Ctrl+Shift+P` (Windows/Linux) eller `Cmd+Shift+P` (macOS)
2. Skriv "MCP: Open User Configuration" og tryk Enter
3. Dette åbner eller opretter konfigurationsfilen `mcp.json`

Alternativt kan du oprette `.vscode/mcp.json` i dit arbejdsområde til projektspecifik konfiguration.

#### For OneUptime Cloud

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

#### For selvhostet OneUptime

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

#### Trin 3: Start MCP Serveren

1. Tryk på `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Skriv "MCP: List Servers" for at se tilgængelige servere
3. Klik på "oneuptime" for at starte serveren
4. Når du bliver bedt om det, skal du indtaste din OneUptime API-nøgle

#### Trin 4: Brug med Copilot Chat

Åbn GitHub Copilot Chat og brug Agent-tilstand (`@workspace` eller spørg direkte):

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### Sikkerhedsbemærkning

Konfigurationen ovenfor bruger inputvariabler med `"password": true` for sikkert at bede om din API-nøgle frem for at gemme den som klartekst. VS Code beder dig bekræfte tillid, når du starter MCP-serveren for første gang.

## Tilgængelige endpoints

| Endpoint      | Metode | Beskrivelse                                                                                                                    |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`        | POST   | JSON-RPC-anmodninger til værktøjskald og andre operationer                                                                            |
| `/mcp`        | GET    | Uden en SSE-`Accept`-header: venlig JSON-discovery-payload. Med en: `405` — den tilstandsløse server tilbyder ingen selvstændig SSE-strøm (kompatible klienter fortsætter uden den) |
| `/mcp`        | DELETE | No-op (serveren er tilstandsløs, så der er ingen session at afslutte)                                                             |
| `/mcp/health` | GET    | Sundhedstjek-endpoint                                                                                                            |
| `/mcp/tools`  | GET    | REST API til liste over tilgængelige værktøjer                                                                                                 |

## Autentificering

MCP-serveren understøtter to driftstilstande:

### Offentlige værktøjer (ingen autentificering påkrævet)

Du kan oprette forbindelse til MCP-serveren uden en API-nøgle for at få adgang til offentlige værktøjer:

- **`oneuptime_help`**: Få hjælp og vejledning om OneUptime MCP-kapaciteter
- **`oneuptime_list_resources`**: Liste over tilgængelige ressourcer og deres operationer
- **`get_public_status_page_overview`**: Hent oversigt over en offentlig statusside
- **`get_public_status_page_incidents`**: Hent incidents fra en offentlig statusside
- **`get_public_status_page_scheduled_maintenance`**: Hent planlagte vedligeholdelsesbegivenheder
- **`get_public_status_page_announcements`**: Hent meddelelser fra en offentlig statusside

Offentlige statussideværktøjer accepterer enten et statusside-ID (UUID) eller statussidedomenets navn.

### Autentificerede værktøjer (API-nøgle påkrævet)

For alle andre operationer (administration af monitorer, incidents, teams osv.) kræves autentificering via en af følgende headers:

- `x-api-key`: Din OneUptime API-nøgle
- `Authorization`: Bearer-token med din API-nøgle (f.eks. `Bearer your-api-key-here`)

`Bearer`-skemaet skelner ikke mellem store og små bogstaver. Værktøjsfejl returneres som in-band-værktøjsresultater (`isError: true`) med en `statusCode`, detaljer og et forslag — ikke som MCP-protokolfejl — så agenter kan læse fejlen og selv rette op.

## Workflow-værktøjer

Ud over CRUD-værktøjerne pr. ressource leverer serveren specialbyggede workflow-værktøjer til incident- og advarselsrespons:

- **`acknowledge_incident`** / **`resolve_incident`**: Flyt et incident til projektets Acknowledged- eller Resolved-tilstand — svarende til at trykke på knappen i dashboardet
- **`acknowledge_alert`** / **`resolve_alert`**: Det samme for advarsler
- **`add_incident_note`**: Tilføj en note til et incident med `visibility: "internal"` (kun teamet, standarden) eller `visibility: "public"` (publiceres på statussiden). Markdown understøttes
- **`add_alert_note`**: Tilføj en intern note til en advarsel

Et typisk forløb: `list_incidents` → `acknowledge_incident` → undersøg med `list_logs` → `add_incident_note` (offentlig) → `resolve_incident`.

## Hvem er jeg

Værktøjet **`oneuptime_whoami`** returnerer det projekt, din API-nøgle tilhører (ID og navn). Det er et nyttigt første kald, så en agent kan orientere sig — og da oprettelsesværktøjer udleder `projectId` fra API-nøglen, behøver agenten aldrig at angive et projekt-ID.

## Forespørgsler på telemetri

Logs, metrikker, traces (spans), exceptions og monitorlogs eksponeres som skrivebeskyttede `list_`- og `count_`-værktøjer (`list_logs`, `list_metrics`, `list_spans`, `list_exception_instances`, `list_monitor_logs` og deres `count_`-modstykker). Telemetri indtages via OpenTelemetry, så der findes ingen oprettelsesværktøjer.

Forespørg altid på telemetri med et tidsintervalfilter. Forespørgselsfelter accepterer enten en direkte værdi eller et operatorobjekt:

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

Understøttede operatorer: `EqualTo`, `NotEqual`, `IsNull`, `NotNull`, `EqualToOrNull`, `GreaterThan`, `LessThan`, `GreaterThanOrEqual`, `LessThanOrEqual`, `InBetween`, `Search`, `Includes`. Sorteringsværdier er `"ASC"` eller `"DESC"`.

## Feltvalg og paginering

`get_`- og `list_`-værktøjer accepterer et valgfrit `select`-array med feltnavne. Som standard returneres alle læsbare felter undtagen de tunge (JSON-, meget-lang-tekst- og HTML-kolonner), som skal anmodes om eksplicit i `select`.

Listeværktøjer paginerer med `limit` (standard 10, maks. 100) og `skip`, og hvert listesvar rapporterer præcis, hvad det returnerede:

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

## Bekræftelse

Bekræft, at MCP-serveren kører:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

Liste over tilgængelige værktøjer:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/tools
```

## Eksempler på brug

### Grundlæggende informationsforespørgsler

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### Monitoradministration

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### Incident management

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### Team og vagtplan

```
"List the teams in this project"
"Show me our on-call policies"
```

### Statussideadministration

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### Offentlige statussideforespørgsler (ingen API-nøgle påkrævet)

Disse forespørgsler fungerer uden autentificering ved kun at bruge de offentlige statussideværktøjer:

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### Avancerede operationer

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## API-nøgletilladelser

### Skrivebeskyttet adgang

Til kun at se data skal du tilføje læsetilladelser til din API-nøgle.

### Fuld adgang

Til fuld adgang til at oprette, opdatere og slette ressourcer skal du sørge for, at din API-nøgle har Project Admin-tilladelser.

### Bedste praksis

- Brug specifikke tilladelser: Giv kun de minimum nødvendige tilladelser
- Roter API-nøgler: Roter regelmæssigt dine API-nøgler
- Overvåg brugen: Hold styr på API-nøglebrug i OneUptime
- Separate nøgler: Brug forskellige API-nøgler til forskellige miljøer

## Fejlfinding

### Tilladelsesfejl

Sørg for, at din API-nøgle har de nødvendige tilladelser:

- Læseadgang til at liste ressourcer
- Skriveadgang til at oprette/opdatere ressourcer
- Sletteadgang, hvis du vil fjerne ressourcer

### Forbindelsesproblemer

1. Bekræft, at din OneUptime URL er korrekt
2. Kontroller, at din API-nøgle er gyldig
3. Sørg for, at din OneUptime-instans er tilgængelig
4. Test health-endpointet

### Ugyldig API-nøgle

- Bekræft API-nøglen i dine OneUptime-indstillinger
- Kontroller for ekstra mellemrum eller tegn
- Sørg for, at nøglen ikke er udløbet

### Sessionsfejl

Hvis du modtager sessionsrelaterede fejl:

- MCP-serveren er tilstandsløs — den udsteder og sporer ikke sessions-ID'er, så hver anmodning fungerer mod enhver serverreplika
- Klienter, der sender en `mcp-session-id`-header fra en tidligere serverversion, kan blot udelade den; den ignoreres
- Opdater ældre MCP-klientkonfigurationer, der forventer, at serveren returnerer et sessions-ID

## Tilgængelige ressourcer

MCP-serveren tilbyder værktøjer til følgende ressourcer:

**Overvågning**: Monitor, Monitor Status, Monitor Status Event
**Incidents**: Incident, Incident State, Incident Severity, Incident State Timeline, Incident Public Note, Incident Internal Note
**Advarsler**: Alert, Alert State, Alert Severity, Alert State Timeline, Alert Internal Note
**Statussider**: Status Page, Status Page Announcement
**Planlagt vedligeholdelse**: Scheduled Maintenance Event, Scheduled Maintenance State, Scheduled Maintenance State Timeline
**Teams og vagtplan**: Team, On-Call Policy
**Labels**: Label
**Telemetri (skrivebeskyttet)**: Log, Metric, Span, Exception Instance, Monitor Log

Hver databaseressource understøtter Opret, Hent, Liste, Opdater, Slet og Tæl via snake_case-værktøjer — for eksempel `create_incident`, `get_incident`, `list_incidents`, `update_incident`, `delete_incident`, `count_incidents`. Telemetriressourcer eksponerer kun `list_`- og `count_`-værktøjer (for eksempel `list_logs`, `count_spans`).

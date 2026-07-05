# MCP-server

OneUptime Model Context Protocol (MCP)-servern ger LLM:er direkt åtkomst till din OneUptime-instans, vilket möjliggör AI-driven övervakning, incidenthantering och observabilitetsoperationer.

## Vad är OneUptime MCP-servern?

OneUptime MCP-servern är en brygga mellan stora språkmodeller (LLM:er) och din OneUptime-instans. Den implementerar Model Context Protocol (MCP), vilket gör det möjligt för AI-assistenter som Claude att interagera direkt med din övervakningsinfrastruktur.

## Hur det fungerar

MCP-servern körs tillsammans med din OneUptime-instans och är åtkomlig via Streamable HTTP-transport. Ingen lokal installation krävs.

**Molnanvändare**: `https://oneuptime.com/mcp`
**Egeninstallerade användare**: `https://your-oneuptime-domain.com/mcp`

## Nyckelfunktioner

- **Cirka 155 verktyg**: Fullständiga CRUD-verktyg för 22 resurstyper (incidenter, varningar, monitorer, statussidor, jour med mera), skrivskyddade telemetriverktyg samt arbetsflödes- och hjälpverktyg
- **Realtidsoperationer**: Skapa, läs, uppdatera och ta bort resurser i realtid
- **Typsäkert gränssnitt**: Fullständigt typsatt med omfattande indatavalidering
- **Säker autentisering**: API-nyckelautentisering per förfrågan med korrekt felhantering
- **Säkerhetsannoteringar**: Skrivskyddade verktyg bär `readOnlyHint` och borttagningsverktyg bär `destructiveHint`, så att MCP-klienter kan godkänna säkra anrop automatiskt och fråga före destruktiva
- **Enkel integration**: Fungerar med Claude Desktop och andra MCP-kompatibla klienter
- **Tillståndslös som design**: Inga sessions-ID:n — varje förfrågan är självständig, så servern fungerar bakom lastbalanserare och driftsättningar med flera repliker

## Vad du kan göra

Med OneUptime MCP-servern kan AI-assistenter hjälpa dig att:

- **Monitorhantering**: Skapa och konfigurera monitorer, kontrollera deras status och granska statushistorik
- **Incidentsvar**: Skapa, kvittera och lösa incidenter, lägga till interna eller offentliga anteckningar och spåra lösning
- **Teamoperationer**: Hantera team och jourpolicyer
- **Statussidor**: Hantera statussidor och skapa meddelanden
- **Varningar**: Kvittera och lösa varningar, lägga till varningsanteckningar och hantera varningstillstånd och allvarlighetsgrader
- **Schemalagt underhåll**: Skapa och hantera schemalagda underhållshändelser
- **Telemetri**: Fråga efter loggar, mätvärden, spårningar, undantag och monitorloggar (skrivskyddat)

## Krav

- OneUptime-instans (moln eller egeninstallerad)
- MCP-kompatibel klient (Claude Desktop, VS Code med GitHub Copilot etc.)
- Giltig OneUptime API-nyckel (krävs endast för autentiserade operationer – offentliga verktyg fungerar utan den)

## Hämta din API-nyckel

1. Logga in på din OneUptime-instans
2. Navigera till **Inställningar** → **API-nycklar**
3. Klicka på **Skapa API-nyckel**
4. Ange ett namn (t.ex. "MCP-server")
5. Välj lämpliga behörigheter för ditt användningsfall
6. Kopiera den genererade API-nyckeln

API-nycklar är projektbundna: MCP-servern härleder ditt projekt från nyckeln, så skapa-verktyg behöver aldrig ett `projectId`-argument.

> **Varning — ge aldrig en AI-agent en huvudnyckel.** En OneUptime-*huvudnyckel* (master-API-nyckel) accepteras också i detta huvud och ger administratörsåtkomst till hela instansen. Använd alltid en projekt-API-nyckel med de minsta behörigheter agenten behöver (en skrivskyddad nyckel räcker för alla `get_`-/`list_`-/`count_`-verktyg).

## Konfiguration

### Claude Desktop-konfiguration

Hitta din Claude Desktop-konfigurationsfil:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### För OneUptime Cloud

Lägg till följande konfiguration:

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

### För egeninstallerad OneUptime

Ersätt `oneuptime.com` med din OneUptime-domän:

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

### Offentlig åtkomst (utan API-nyckel)

För att endast använda offentliga verktyg (statussideinformation, hjälp) kan du ansluta utan en API-nyckel:

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

Denna konfiguration ger åtkomst till offentliga statussidverktyg och hjälpresurser utan att kräva autentisering.

### VS Code med GitHub Copilot

VS Code stöder MCP-servrar internt med GitHub Copilot (version 1.99+). Detta gör det möjligt för Copilot att komma åt OneUptime-data direkt.

#### Steg 1: Krav

- VS Code version 1.99 eller senare
- GitHub Copilot-tillägget installerat och aktiverat
- GitHub Copilot Chat aktiverat

#### Steg 2: Öppna MCP-konfiguration

1. Tryck på `Ctrl+Shift+P` (Windows/Linux) eller `Cmd+Shift+P` (macOS)
2. Skriv "MCP: Open User Configuration" och tryck Enter
3. Detta öppnar eller skapar konfigurationsfilen `mcp.json`

Alternativt kan du skapa `.vscode/mcp.json` i din arbetsyta för projektspecifik konfiguration.

#### För OneUptime Cloud

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

#### För egeninstallerad OneUptime

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

#### Steg 3: Starta MCP-servern

1. Tryck på `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Skriv "MCP: List Servers" för att se tillgängliga servrar
3. Klicka på "oneuptime" för att starta servern
4. När du uppmanas, ange din OneUptime API-nyckel

#### Steg 4: Använd med Copilot Chat

Öppna GitHub Copilot Chat och använd agentläge (`@workspace` eller fråga direkt):

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### Säkerhetsnotering

Konfigurationen ovan använder indatavariabler med `"password": true` för att på ett säkert sätt fråga efter din API-nyckel istället för att lagra den i klartext. VS Code ber dig att bekräfta tillit när du startar MCP-servern för första gången.

## Tillgängliga slutpunkter

| Slutpunkt     | Metod  | Beskrivning                                                                                                                    |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`        | POST   | JSON-RPC-förfrågningar för verktygsanrop och andra operationer                                                                   |
| `/mcp`        | GET    | Utan ett SSE-`Accept`-huvud: vänlig JSON-svarslast för upptäckt. Med ett: `405` — den tillståndslösa servern erbjuder ingen fristående SSE-ström (kompatibla klienter fortsätter utan den) |
| `/mcp`        | DELETE | Ingen åtgärd (servern är tillståndslös, så det finns ingen session att avsluta)                                                  |
| `/mcp/health` | GET    | Hälsokontrollslutpunkt                                                                                                           |
| `/mcp/tools`  | GET    | REST API för att lista tillgängliga verktyg                                                                                      |

## Autentisering

MCP-servern stöder två driftslägen:

### Offentliga verktyg (ingen autentisering krävs)

Du kan ansluta till MCP-servern utan en API-nyckel för att komma åt offentliga verktyg:

- **`oneuptime_help`**: Få hjälp och vägledning om OneUptime MCP-funktioner
- **`oneuptime_list_resources`**: Lista tillgängliga resurser och deras operationer
- **`get_public_status_page_overview`**: Hämta en översikt av en offentlig statussida
- **`get_public_status_page_incidents`**: Hämta incidenter från en offentlig statussida
- **`get_public_status_page_scheduled_maintenance`**: Hämta schemalagda underhållshändelser
- **`get_public_status_page_announcements`**: Hämta meddelanden från en offentlig statussida

Verktyg för offentliga statussidor accepterar antingen ett statussid-ID (UUID) eller statussidans domännamn.

### Autentiserade verktyg (API-nyckel krävs)

För alla andra operationer (hantering av monitorer, incidenter, team etc.) krävs autentisering via ett av följande huvuden:

- `x-api-key`: Din OneUptime API-nyckel
- `Authorization`: Bearer-token med din API-nyckel (t.ex. `Bearer your-api-key-here`)

`Bearer`-schemat är skiftlägesokänsligt. Verktygsfel returneras som verktygsresultat i själva svaret (`isError: true`) med en `statusCode`, detaljer och ett förslag — inte som MCP-protokollfel — så att agenter kan läsa felet och korrigera sig själva.

## Arbetsflödesverktyg

Utöver CRUD-verktygen per resurs levereras servern med särskilt byggda arbetsflödesverktyg för incident- och varningshantering:

- **`acknowledge_incident`** / **`resolve_incident`**: Flytta en incident till projektets tillstånd Kvitterad eller Löst — motsvarar att trycka på knappen i instrumentpanelen
- **`acknowledge_alert`** / **`resolve_alert`**: Samma sak för varningar
- **`add_incident_note`**: Lägg till en anteckning på en incident med `visibility: "internal"` (endast teamet, standardvärdet) eller `visibility: "public"` (publiceras på statussidan). Markdown stöds
- **`add_alert_note`**: Lägg till en intern anteckning på en varning

En typisk loop: `list_incidents` → `acknowledge_incident` → undersök med `list_logs` → `add_incident_note` (offentlig) → `resolve_incident`.

## Vem är jag

Verktyget **`oneuptime_whoami`** returnerar det projekt som din API-nyckel tillhör (ID och namn). Det är ett användbart första anrop för att en agent ska orientera sig — och eftersom skapa-verktyg härleder `projectId` från API-nyckeln behöver agenten aldrig skicka ett projekt-ID.

## Fråga efter telemetri

Loggar, mätvärden, spårningar (spans), undantag och monitorloggar exponeras som skrivskyddade `list_`- och `count_`-verktyg (`list_logs`, `list_metrics`, `list_spans`, `list_exception_instances`, `list_monitor_logs` och deras `count_`-motsvarigheter). Telemetri tas in via OpenTelemetry, så det finns inga skapa-verktyg.

Fråga alltid efter telemetri med ett tidsintervallfilter. Frågefält accepterar antingen ett direkt värde eller ett operatorobjekt:

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

Operatorer som stöds: `EqualTo`, `NotEqual`, `IsNull`, `NotNull`, `EqualToOrNull`, `GreaterThan`, `LessThan`, `GreaterThanOrEqual`, `LessThanOrEqual`, `InBetween`, `Search`, `Includes`. Sorteringsvärden är `"ASC"` eller `"DESC"`.

## Fältval och paginering

`get_`- och `list_`-verktyg accepterar en valfri `select`-array med fältnamn. Som standard returneras alla läsbara fält utom tunga fält (JSON-, mycket-lång-text- och HTML-kolumner), som måste begäras uttryckligen i `select`.

Listverktyg paginerar med `limit` (standard 10, max 100) och `skip`, och varje listsvar rapporterar exakt vad det returnerade:

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

## Verifiering

Verifiera att MCP-servern körs:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

Lista tillgängliga verktyg:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/tools
```

## Användningsexempel

### Grundläggande informationsfrågor

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### Monitorhantering

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### Incidenthantering

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### Team och jour

```
"List the teams in this project"
"Show me our on-call policies"
```

### Hantering av statussidor

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### Frågor om offentliga statussidor (ingen API-nyckel krävs)

Dessa frågor fungerar utan autentisering och använder bara de offentliga statussideverktygen:

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### Avancerade operationer

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## API-nyckelbehörigheter

### Skrivskyddad åtkomst

För att bara visa data, lägg till läsbehörigheter för din API-nyckel.

### Full åtkomst

För full åtkomst för att skapa, uppdatera och ta bort resurser, se till att din API-nyckel har projektadministratörsbehörigheter.

### Bästa praxis

- Använd specifika behörigheter: Bevilja endast de minimibehörigheter som behövs
- Rotera API-nycklar: Rotera dina API-nycklar regelbundet
- Övervaka användning: Håll koll på API-nyckelns användning i OneUptime
- Separata nycklar: Använd olika API-nycklar för olika miljöer

## Felsökning

### Behörighetsfel

Se till att din API-nyckel har de nödvändiga behörigheterna:

- Läsåtkomst för att lista resurser
- Skrivåtkomst för att skapa/uppdatera resurser
- Borttagningsåtkomst om du vill ta bort resurser

### Anslutningsproblem

1. Verifiera att din OneUptime URL är korrekt
2. Kontrollera att din API-nyckel är giltig
3. Se till att din OneUptime-instans är tillgänglig
4. Testa hälsoslutpunkten

### Ogiltig API-nyckel

- Verifiera API-nyckeln i dina OneUptime-inställningar
- Kontrollera efter extra mellanslag eller tecken
- Se till att nyckeln inte har löpt ut

### Sessionsfel

Om du får sessionsrelaterade fel:

- MCP-servern är tillståndslös — den utfärdar eller spårar inga sessions-ID:n, så varje förfrågan fungerar mot vilken serverreplik som helst
- Klienter som skickar ett `mcp-session-id`-huvud från en tidigare serverversion kan helt enkelt utelämna det; det ignoreras
- Uppdatera äldre MCP-klientkonfigurationer som förväntar sig att ett sessions-ID returneras av servern

## Tillgängliga resurser

MCP-servern tillhandahåller verktyg för följande resurser:

**Övervakning**: Monitor, Monitorstatus, Monitorstatushändelse
**Incidenter**: Incident, Incidenttillstånd, Incidentallvarlighetsgrad, Tidslinje för incidenttillstånd, Offentlig incidentanteckning, Intern incidentanteckning
**Varningar**: Varning, Varningstillstånd, Varningsallvarlighetsgrad, Tidslinje för varningstillstånd, Intern varningsanteckning
**Statussidor**: Statussida, Statussidemeddelande
**Schemalagt underhåll**: Schemalagd underhållshändelse, Tillstånd för schemalagt underhåll, Tidslinje för schemalagt underhållstillstånd
**Team och jour**: Team, Jourpolicy
**Etiketter**: Etikett
**Telemetri (skrivskyddat)**: Logg, Mätvärde, Span, Undantagsinstans, Monitorlogg

Varje databasresurs stöder Create, Get, List, Update, Delete och Count via verktyg i snake_case — till exempel `create_incident`, `get_incident`, `list_incidents`, `update_incident`, `delete_incident`, `count_incidents`. Telemetriresurser exponerar endast `list_`- och `count_`-verktyg (till exempel `list_logs`, `count_spans`).

# MCP-server

OneUptime Model Context Protocol (MCP)-servern ger LLM:er direkt åtkomst till din OneUptime-instans, vilket möjliggör AI-driven övervakning, incidenthantering och observabilitetsoperationer.

## Vad är OneUptime MCP-servern?

OneUptime MCP-servern är en brygga mellan stora språkmodeller (LLM:er) och din OneUptime-instans. Den implementerar Model Context Protocol (MCP), vilket gör det möjligt för AI-assistenter som Claude att interagera direkt med din övervakningsinfrastruktur.

## Hur det fungerar

MCP-servern körs tillsammans med din OneUptime-instans och är åtkomlig via Streamable HTTP-transport. Ingen lokal installation krävs.

**Molnanvändare**: `https://oneuptime.com/mcp`
**Egeninstallerade användare**: `https://your-oneuptime-domain.com/mcp`

## Nyckelfunktioner

- **Fullständig API-täckning**: Åtkomst till 711 OneUptime API-slutpunkter
- **126 resurstyper**: Hantera alla OneUptime-resurser inklusive monitorer, incidenter, team, sonder och mer
- **Realtidsoperationer**: Skapa, läs, uppdatera och ta bort resurser i realtid
- **Typsäkert gränssnitt**: Fullständigt typsatt med omfattande indatavalidering
- **Säker autentisering**: API-nyckelbaserad autentisering med korrekt felhantering
- **Enkel integration**: Fungerar med Claude Desktop och andra MCP-kompatibla klienter
- **Sessionshantering**: Inbyggd sessionshantering med automatisk återanslutningsstöd

## Vad du kan göra

Med OneUptime MCP-servern kan AI-assistenter hjälpa dig att:

- **Monitorhantering**: Skapa och konfigurera monitorer, kontrollera deras status och hantera monitorgrupper
- **Incidentsvar**: Skapa incidenter, lägg till anteckningar, tilldela teammedlemmar och spåra lösning
- **Teamoperationer**: Hantera team, behörigheter och jour-scheman
- **Statussidor**: Uppdatera statussidor, skapa meddelanden och hantera prenumeranter
- **Varning**: Konfigurera varningsregler, hantera eskaleringspolicyer och kontrollera aviseringsloggar
- **Sonder**: Distribuera och hantera övervakningssonder på olika platser
- **Rapporter och analys**: Generera rapporter och analysera övervakningsdata

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

| Slutpunkt | Metod | Beskrivning |
|-----------|-------|-------------|
| `/mcp` | GET | Server-sent events-ström för server-till-klient-aviseringar |
| `/mcp` | POST | JSON-RPC-förfrågningar för verktygsan rop och andra operationer |
| `/mcp` | DELETE | Sessionsrensning och avslutning |
| `/mcp/health` | GET | Hälsokontrollslutpunkt |
| `/mcp/tools` | GET | REST API för att lista tillgängliga verktyg |

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

Verktyg för offentliga statussidor accepterar antingen ett statussid-ID (UUID) eller statussidens domännamn.

### Autentiserade verktyg (API-nyckel krävs)

För alla andra operationer (hantering av monitorer, incidenter, team etc.) krävs autentisering via ett av följande huvuden:

- `x-api-key`: Din OneUptime API-nyckel
- `Authorization`: Bearer-token med din API-nyckel (t.ex. `Bearer your-api-key-here`)

## Verifiering

Verifiera att MCP-servern körs:

```bash
# För OneUptime Cloud
curl https://oneuptime.com/mcp/health

# För egeninstallerad
curl https://your-oneuptime-domain.com/mcp/health
```

Lista tillgängliga verktyg:

```bash
# För OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# För egeninstallerad
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
"Who are the members of the infrastructure team?"
"Who's currently on call for the infrastructure team?"
"Show me the on-call schedule for this week"
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
- MCP-servern använder `mcp-session-id`-huvudet för att spåra sessioner
- Se till att din klient hanterar sessions-ID:t som returneras av servern korrekt
- Sessioner rensas automatiskt när anslutningar stängs

## Tillgängliga resurser

MCP-servern ger åtkomst till 126 resurstyper inklusive:

**Övervakning**: Monitor, MonitorStatus, MonitorGroup, Probe
**Incidenter**: Incident, IncidentState, IncidentNote, IncidentTemplate
**Varningar**: Alert, AlertState, AlertSeverity
**Statussidor**: StatusPage, StatusPageAnnouncement, StatusPageSubscriber
**Jour**: On-CallPolicy, EscalationRule, On-CallSchedule
**Team**: Team, TeamMember, TeamPermission
**Telemetri**: TelemetryService, Log, Span, Metric
**Arbetsflöden**: Workflow, WorkflowVariable, WorkflowLog

Varje resurs stöder standardoperationer: List, Count, Get, Create, Update och Delete.

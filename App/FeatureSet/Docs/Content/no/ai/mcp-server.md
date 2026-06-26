# MCP-server

OneUptime Model Context Protocol (MCP)-serveren gir LLM-er direkte tilgang til OneUptime-instansen din, og muliggjør AI-drevne overvåkings-, hendelseshåndterings- og observabilitetsoperasjoner.

## Hva er OneUptime MCP-serveren?

OneUptime MCP-serveren er en bro mellom store språkmodeller (LLM-er) og OneUptime-instansen din. Den implementerer Model Context Protocol (MCP), slik at AI-assistenter som Claude kan samhandle direkte med overvåkingsinfrastrukturen din.

## Slik fungerer det

MCP-serveren er hostet sammen med OneUptime-instansen din og er tilgjengelig via Streamable HTTP-transport. Ingen lokal installasjon er nødvendig.

**Skybrukere**: `https://oneuptime.com/mcp`
**Selvhostede brukere**: `https://your-oneuptime-domain.com/mcp`

## Nøkkelfunksjoner

- **Fullstendig API-dekning**: Tilgang til 711 OneUptime API-endepunkter
- **126 ressurstyper**: Administrer alle OneUptime-ressurser inkludert monitorer, hendelser, team, prober og mer
- **Sanntidsoperasjoner**: Opprett, les, oppdater og slett ressurser i sanntid
- **Typesikkert grensesnitt**: Fullt typet med omfattende inndatavalidering
- **Sikker autentisering**: API-nøkkelbasert autentisering med riktig feilhåndtering
- **Enkel integrasjon**: Fungerer med Claude Desktop og andre MCP-kompatible klienter
- **Øktbehandling**: Innebygd økthåndtering med automatisk støtte for gjenoppretting av tilkobling

## Hva du kan gjøre

Med OneUptime MCP-serveren kan AI-assistenter hjelpe deg med:

- **Monitorbehandling**: Opprett og konfigurer monitorer, sjekk statusen deres og administrer monitorgrupper
- **Hendelsesrespons**: Opprett hendelser, legg til notater, tildel teammedlemmer og spor løsning
- **Teamoperasjoner**: Administrer team, tillatelser og vaktplaner
- **Statussider**: Oppdater statussider, opprett kunngjøringer og administrer abonnenter
- **Varsling**: Konfigurer varselregler, administrer eskaleringspolicyer og sjekk varsellogger
- **Prober**: Distribuer og administrer overvåkingsprober på tvers av ulike lokasjoner
- **Rapporter og analyse**: Generer rapporter og analyser overvåkingsdata

## Krav

- OneUptime-instans (sky eller selvhostet)
- MCP-kompatibel klient (Claude Desktop, VS Code med GitHub Copilot osv.)
- Gyldig OneUptime API-nøkkel (kun påkrevd for autentiserte operasjoner – offentlige verktøy fungerer uten)

## Hente API-nøkkelen din

1. Logg inn på OneUptime-instansen din
2. Naviger til **Innstillinger** → **API-nøkler**
3. Klikk **Opprett API-nøkkel**
4. Oppgi et navn (f.eks. "MCP-server")
5. Velg de riktige tillatelsene for bruksområdet ditt
6. Kopier den genererte API-nøkkelen

## Konfigurasjon

### Claude Desktop-konfigurasjon

Finn Claude Desktop-konfigurasjonsfilen din:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### For OneUptime Cloud

Legg til følgende konfigurasjon:

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

Erstatt `oneuptime.com` med ditt OneUptime-domene:

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

### Offentlig tilgang (ingen API-nøkkel)

For å bruke kun offentlige verktøy (statussideinformasjon, hjelp), kan du koble til uten API-nøkkel:

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

Denne konfigurasjonen gir tilgang til offentlige statussideverktøy og hjelperessurser uten å kreve autentisering.

### VS Code med GitHub Copilot

VS Code støtter MCP-servere innebygd med GitHub Copilot (versjon 1.99+). Dette lar Copilot få direkte tilgang til OneUptime-data.

#### Trinn 1: Krav

- VS Code versjon 1.99 eller nyere
- GitHub Copilot-utvidelse installert og aktivert
- GitHub Copilot Chat aktivert

#### Trinn 2: Åpne MCP-konfigurasjon

1. Trykk `Ctrl+Shift+P` (Windows/Linux) eller `Cmd+Shift+P` (macOS)
2. Skriv "MCP: Open User Configuration" og trykk Enter
3. Dette åpner eller oppretter `mcp.json`-konfigurasjonsfilen

Alternativt kan du opprette `.vscode/mcp.json` i arbeidsområdet ditt for prosjektspesifikk konfigurasjon.

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

#### Trinn 3: Start MCP-serveren

1. Trykk `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Skriv "MCP: List Servers" for å se tilgjengelige servere
3. Klikk på "oneuptime" for å starte serveren
4. Skriv inn OneUptime API-nøkkelen når du blir bedt om det

#### Trinn 4: Bruk med Copilot Chat

Åpne GitHub Copilot Chat og bruk agentmodus (`@workspace` eller spør direkte):

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### Sikkerhetsmerknad

Konfigurasjonen ovenfor bruker inndatavariabler med `"password": true` for å be om API-nøkkelen på en sikker måte i stedet for å lagre den i klartekst. VS Code vil be deg bekrefte tillit første gang du starter MCP-serveren.

## Tilgjengelige endepunkter

| Endepunkt     | Metode | Beskrivelse                                                |
| ------------- | ------ | ---------------------------------------------------------- |
| `/mcp`        | GET    | Serversendt hendelsesstrøm for server-til-klient-varsler   |
| `/mcp`        | POST   | JSON-RPC-forespørsler for verktøykall og andre operasjoner |
| `/mcp`        | DELETE | Øktopprydding og avslutning                                |
| `/mcp/health` | GET    | Helsekontrollendepunkt                                     |
| `/mcp/tools`  | GET    | REST API for å liste tilgjengelige verktøy                 |

## Autentisering

MCP-serveren støtter to driftsmodi:

### Offentlige verktøy (ingen autentisering påkrevd)

Du kan koble til MCP-serveren uten en API-nøkkel for å få tilgang til offentlige verktøy:

- **`oneuptime_help`**: Få hjelp og veiledning om OneUptime MCP-funksjoner
- **`oneuptime_list_resources`**: List tilgjengelige ressurser og operasjoner
- **`get_public_status_page_overview`**: Hent oversikt over en offentlig statusside
- **`get_public_status_page_incidents`**: Hent hendelser fra en offentlig statusside
- **`get_public_status_page_scheduled_maintenance`**: Hent planlagte vedlikeholdshendelser
- **`get_public_status_page_announcements`**: Hent kunngjøringer fra en offentlig statusside

Offentlige statussideverktøy aksepterer enten en statusside-ID (UUID) eller domenenavnet til statussiden.

### Autentiserte verktøy (API-nøkkel påkrevd)

For alle andre operasjoner (administrere monitorer, hendelser, team osv.) kreves autentisering via én av følgende overskrifter:

- `x-api-key`: OneUptime API-nøkkelen din
- `Authorization`: Bearer-token med API-nøkkelen din (f.eks. `Bearer your-api-key-here`)

## Bekreftelse

Bekreft at MCP-serveren kjører:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For selvhostet
curl https://your-oneuptime-domain.com/mcp/health
```

List tilgjengelige verktøy:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For selvhostet
curl https://your-oneuptime-domain.com/mcp/tools
```

## Brukseksempler

### Grunnleggende informasjonsforespørsler

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### Monitorbehandling

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### Hendelseshåndtering

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### Team og vaktordning

```
"Who are the members of the infrastructure team?"
"Who's currently on call for the infrastructure team?"
"Show me the on-call schedule for this week"
```

### Statussideadministrasjon

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### Offentlige statussideforespørsler (ingen API-nøkkel påkrevd)

Disse forespørslene fungerer uten autentisering, kun ved bruk av offentlige statussideverktøy:

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### Avanserte operasjoner

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## API-nøkkeltillatelser

### Skrivebeskyttet tilgang

For kun å se data, legg til lesetillatelser for API-nøkkelen din.

### Full tilgang

For full tilgang til å opprette, oppdatere og slette ressurser, sørg for at API-nøkkelen din har prosjektadministratortillatelser.

### Beste praksiser

- Bruk spesifikke tillatelser: Gi kun de minimumstillatelsene som er nødvendige
- Rullér API-nøkler: Rullér API-nøklene dine regelmessig
- Overvåk bruk: Hold oversikt over API-nøkkelbruk i OneUptime
- Separate nøkler: Bruk ulike API-nøkler for ulike miljøer

## Feilsøking

### Tillatelsefeil

Sørg for at API-nøkkelen din har de nødvendige tillatelsene:

- Lesetilgang for å liste ressurser
- Skrivetilgang for å opprette/oppdatere ressurser
- Slettetilgang hvis du vil fjerne ressurser

### Tilkoblingsproblemer

1. Verifiser at OneUptime-URL-en er riktig
2. Sjekk at API-nøkkelen er gyldig
3. Sørg for at OneUptime-instansen er tilgjengelig
4. Test helsekontrollendepunktet

### Ugyldig API-nøkkel

- Verifiser API-nøkkelen i OneUptime-innstillingene dine
- Sjekk for ekstra mellomrom eller tegn
- Sørg for at nøkkelen ikke har utløpt

### Øktfeil

Hvis du mottar øktrelaterte feil:

- MCP-serveren bruker `mcp-session-id`-overskriften til å spore økter
- Sørg for at klienten din håndterer økt-ID-en som returneres av serveren korrekt
- Økter ryddes automatisk opp når tilkoblinger lukkes

## Tilgjengelige ressurser

MCP-serveren gir tilgang til 126 ressurstyper inkludert:

**Overvåking**: Monitor, MonitorStatus, MonitorGroup, Probe
**Hendelser**: Incident, IncidentState, IncidentNote, IncidentTemplate
**Varsler**: Alert, AlertState, AlertSeverity
**Statussider**: StatusPage, StatusPageAnnouncement, StatusPageSubscriber
**Vaktordning**: On-CallPolicy, EscalationRule, On-CallSchedule
**Team**: Team, TeamMember, TeamPermission
**Telemetri**: TelemetryService, Log, Span, Metric
**Arbeidsflyter**: Workflow, WorkflowVariable, WorkflowLog

Hver ressurs støtter standardoperasjoner: List, Count, Get, Create, Update og Delete.

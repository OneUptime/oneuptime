# MCP-server

OneUptime Model Context Protocol (MCP)-serveren gir LLM-er direkte tilgang til OneUptime-instansen din, og muliggjør AI-drevne overvåkings-, hendelseshåndterings- og observabilitetsoperasjoner.

## Hva er OneUptime MCP-serveren?

OneUptime MCP-serveren er en bro mellom store språkmodeller (LLM-er) og OneUptime-instansen din. Den implementerer Model Context Protocol (MCP), slik at AI-assistenter som Claude kan samhandle direkte med overvåkingsinfrastrukturen din.

## Slik fungerer det

MCP-serveren er hostet sammen med OneUptime-instansen din og er tilgjengelig via Streamable HTTP-transport. Ingen lokal installasjon er nødvendig.

**Skybrukere**: `https://oneuptime.com/mcp`
**Selvhostede brukere**: `https://your-oneuptime-domain.com/mcp`

## Nøkkelfunksjoner

- **~155 verktøy**: Fullstendige CRUD-verktøy for 22 ressurstyper (hendelser, varsler, monitorer, statussider, vaktordning og mer), skrivebeskyttede telemetriverktøy, pluss arbeidsflyt- og hjelpeverktøy
- **Sanntidsoperasjoner**: Opprett, les, oppdater og slett ressurser i sanntid
- **Typesikkert grensesnitt**: Fullt typet med omfattende inndatavalidering
- **Sikker autentisering**: API-nøkkelautentisering per forespørsel med riktig feilhåndtering
- **Sikkerhetsannotasjoner**: Skrivebeskyttede verktøy har `readOnlyHint` og sletteverktøy har `destructiveHint`, slik at MCP-klienter kan godkjenne trygge kall automatisk og spørre før destruktive
- **Enkel integrasjon**: Fungerer med Claude Desktop og andre MCP-kompatible klienter
- **Tilstandsløs etter design**: Ingen økt-ID-er — hver forespørsel er selvstendig, slik at serveren fungerer bak lastbalanserere og distribusjoner med flere replikaer

## Hva du kan gjøre

Med OneUptime MCP-serveren kan AI-assistenter hjelpe deg med:

- **Monitorbehandling**: Opprett og konfigurer monitorer, sjekk statusen deres og gjennomgå statushistorikk
- **Hendelsesrespons**: Opprett, kvitter og løs hendelser, legg til interne eller offentlige notater og spor løsning
- **Teamoperasjoner**: Administrer team og vaktpolicyer
- **Statussider**: Administrer statussider og opprett kunngjøringer
- **Varsling**: Kvitter og løs varsler, legg til varselnotater og administrer varseltilstander og alvorlighetsgrader
- **Planlagt vedlikehold**: Opprett og administrer planlagte vedlikeholdshendelser
- **Telemetri**: Spør etter logger, metrikker, sporinger, unntak og monitorlogger (skrivebeskyttet)

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

API-nøkler er avgrenset til prosjekt: MCP-serveren utleder prosjektet ditt fra nøkkelen, slik at opprettingsverktøy aldri trenger et `projectId`-argument.

> **Advarsel — gi aldri en AI-agent en hovednøkkel.** En OneUptime-*hoved*-API-nøkkel aksepteres også på denne overskriften og gir administratortilgang til hele instansen. Bruk alltid en prosjekt-API-nøkkel med de laveste privilegiene agenten trenger (en skrivebeskyttet nøkkel er nok for alle `get_`-/`list_`-/`count_`-verktøy).

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

| Endepunkt     | Metode | Beskrivelse                                                                                                                    |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`        | POST   | JSON-RPC-forespørsler for verktøykall og andre operasjoner                                                                            |
| `/mcp`        | GET    | Uten en SSE-`Accept`-overskrift: vennlig JSON-oppdagelsesrespons. Med en: `405` — den tilstandsløse serveren tilbyr ingen frittstående SSE-strøm (kompatible klienter fortsetter uten den) |
| `/mcp`        | DELETE | Ingen operasjon (serveren er tilstandsløs, så det finnes ingen økt å avslutte)                                                             |
| `/mcp/health` | GET    | Helsekontrollendepunkt                                                                                                            |
| `/mcp/tools`  | GET    | REST API for å liste tilgjengelige verktøy                                                                                                 |

## Autentisering

MCP-serveren støtter to driftsmodi:

### Offentlige verktøy (ingen autentisering påkrevd)

Du kan koble til MCP-serveren uten en API-nøkkel for å få tilgang til offentlige verktøy:

- **`oneuptime_help`**: Få hjelp og veiledning om OneUptime MCP-funksjoner
- **`oneuptime_list_resources`**: List tilgjengelige ressurser og operasjonene deres
- **`get_public_status_page_overview`**: Hent oversikt over en offentlig statusside
- **`get_public_status_page_incidents`**: Hent hendelser fra en offentlig statusside
- **`get_public_status_page_scheduled_maintenance`**: Hent planlagte vedlikeholdshendelser
- **`get_public_status_page_announcements`**: Hent kunngjøringer fra en offentlig statusside

Offentlige statussideverktøy aksepterer enten en statusside-ID (UUID) eller domenenavnet til statussiden.

### Autentiserte verktøy (API-nøkkel påkrevd)

For alle andre operasjoner (administrere monitorer, hendelser, team osv.) kreves autentisering via én av følgende overskrifter:

- `x-api-key`: OneUptime API-nøkkelen din
- `Authorization`: Bearer-token med API-nøkkelen din (f.eks. `Bearer your-api-key-here`)

`Bearer`-skjemaet skiller ikke mellom store og små bokstaver. Verktøyfeil returneres som verktøyresultater i selve svaret (`isError: true`) med `statusCode`, detaljer og et forslag — ikke som MCP-protokollfeil — slik at agenter kan lese feilen og korrigere seg selv.

## Arbeidsflytverktøy

Utover CRUD-verktøyene per ressurs leveres serveren med formålsbygde arbeidsflytverktøy for hendelses- og varselrespons:

- **`acknowledge_incident`** / **`resolve_incident`**: Flytt en hendelse til prosjektets Kvittert- eller Løst-tilstand — tilsvarende å trykke på knappen i dashbordet
- **`acknowledge_alert`** / **`resolve_alert`**: Det samme for varsler
- **`add_incident_note`**: Legg til et notat på en hendelse med `visibility: "internal"` (kun for teamet, standard) eller `visibility: "public"` (publiseres på statussiden). Markdown støttes
- **`add_alert_note`**: Legg til et internt notat på et varsel

En typisk sløyfe: `list_incidents` → `acknowledge_incident` → undersøk med `list_logs` → `add_incident_note` (offentlig) → `resolve_incident`.

## Hvem er jeg

Verktøyet **`oneuptime_whoami`** returnerer prosjektet API-nøkkelen din tilhører (ID og navn). Det er et nyttig første kall for at en agent skal orientere seg — og siden opprettingsverktøy utleder `projectId` fra API-nøkkelen, trenger agenten aldri å sende med en prosjekt-ID.

## Spørre etter telemetri

Logger, metrikker, sporinger (spans), unntak og monitorlogger eksponeres som skrivebeskyttede `list_`- og `count_`-verktøy (`list_logs`, `list_metrics`, `list_spans`, `list_exception_instances`, `list_monitor_logs` og deres `count_`-motstykker). Telemetri tas inn via OpenTelemetry, så det finnes ingen opprettingsverktøy.

Spør alltid etter telemetri med et tidsintervallfilter. Spørrefelt aksepterer enten en direkte verdi eller et operatorobjekt:

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

Støttede operatorer: `EqualTo`, `NotEqual`, `IsNull`, `NotNull`, `EqualToOrNull`, `GreaterThan`, `LessThan`, `GreaterThanOrEqual`, `LessThanOrEqual`, `InBetween`, `Search`, `Includes`. Sorteringsverdier er `"ASC"` eller `"DESC"`.

## Feltvalg og paginering

`get_`- og `list_`-verktøy aksepterer en valgfri `select`-matrise med feltnavn. Som standard returneres alle lesbare felt bortsett fra tunge felt (JSON-, svært-lang-tekst- og HTML-kolonner), som må etterspørres eksplisitt i `select`.

Listeverktøy paginerer med `limit` (standard 10, maks 100) og `skip`, og hvert listesvar rapporterer nøyaktig hva det returnerte:

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

## Bekreftelse

Bekreft at MCP-serveren kjører:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

List tilgjengelige verktøy:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
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
"List the teams in this project"
"Show me our on-call policies"
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

- MCP-serveren er tilstandsløs — den utsteder eller sporer ikke økt-ID-er, så hver forespørsel fungerer mot en hvilken som helst serverreplika
- Klienter som sender en `mcp-session-id`-overskrift fra en tidligere serverversjon, kan ganske enkelt utelate den; den ignoreres
- Oppdater eldre MCP-klientkonfigurasjoner som forventer at serveren returnerer en økt-ID

## Tilgjengelige ressurser

MCP-serveren tilbyr verktøy for følgende ressurser:

**Overvåking**: Monitor, Monitorstatus, Monitorstatushendelse
**Hendelser**: Hendelse, Hendelsestilstand, Hendelsesalvorlighetsgrad, Tidslinje for hendelsestilstand, Offentlig hendelsesnotat, Internt hendelsesnotat
**Varsler**: Varsel, Varseltilstand, Varselalvorlighetsgrad, Tidslinje for varseltilstand, Internt varselnotat
**Statussider**: Statusside, Statussidekunngjøring
**Planlagt vedlikehold**: Planlagt vedlikeholdshendelse, Tilstand for planlagt vedlikehold, Tidslinje for tilstand for planlagt vedlikehold
**Team og vaktordning**: Team, Vaktpolicy
**Etiketter**: Etikett
**Telemetri (skrivebeskyttet)**: Logg, Metrikk, Span, Unntaksinstans, Monitorlogg

Hver databaseressurs støtter Create, Get, List, Update, Delete og Count via verktøy i snake_case — for eksempel `create_incident`, `get_incident`, `list_incidents`, `update_incident`, `delete_incident`, `count_incidents`. Telemetriressurser eksponerer kun `list_`- og `count_`-verktøy (for eksempel `list_logs`, `count_spans`).

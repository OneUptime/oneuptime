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
- **Sikker autentificering**: Log ind med din OneUptime-konto (OAuth 2.1), eller send en API-nøgle pr. anmodning for agenter, der kører uovervåget
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
- En OneUptime-konto til at logge ind med eller en OneUptime API-nøgle til en agent, der kører uovervåget (kræves kun til autentificerede operationer – offentlige værktøjer fungerer uden nogen af delene)

## Log ind med OneUptime

Den nemmeste måde at oprette forbindelse på er at give din MCP-klient serverens URL og intet andet. Første gang klienten har brug for dine data, åbner den en OneUptime-side i din browser, hvor du gør følgende:

1. Log ind på OneUptime, hvis du ikke allerede er logget ind
2. Vælg det projekt, klienten skal arbejde i
3. Vælg, om klienten skal have **læse- og skriveadgang** eller **kun læseadgang**
4. Klik på **Godkend**

Klienten handler derefter på dine vegne i det projekt. Der er ingen API-nøgle, der skal oprettes, kopieres eller roteres, og intet hemmeligt gemmes i en konfigurationsfil.

Hvad en forbundet klient kan gøre:

- **Den har dine tilladelser og aldrig flere.** Det, dine teams tillader dig at gøre i projektet, er det, klienten kan gøre. Hvis din rolle ændres, eller du forlader projektet, gælder det allerede for klientens næste anmodning.
- **Kun læseadgang betyder kun læseadgang.** En klient, der er godkendt med kun læseadgang, kan bruge `get_`-, `list_`- og `count_`-værktøjerne. Værktøjer, der opretter, opdaterer, sletter, kvitterer for eller løser noget, afvises – af MCP-serveren og af OneUptime API'et bag den. Du kan aldrig give en klient mere adgang, end den har bedt om.
- **Den gælder for ét projekt.** Hvis du vil bruge et andet projekt, skal du forbinde klienten igen og vælge det projekt.
- **Den virker kun gennem MCP-serveren.** Klientens adgangstoken accepteres af MCP-endpointet og ingen andre steder. Det kan ikke bruges til at kalde OneUptime REST API'et direkte.
- **Instansadministratorer får ingen særbehandling.** En klient, som en master-administrator har forbundet, har den adgang, som den pågældende persons teams giver i projektet – ikke adgang til hele instansen.

### Administration af forbundne klienter

Alle klienter, der er forbundet ved at logge ind, vises under **Projektindstillinger** → **MCP-server** → **Connected MCP Clients** med oplysning om, hvem der har forbundet dem, hvad de må, og hvornår de sidst blev brugt. Du ser de klienter, du selv har forbundet; projektejere og -administratorer ser alles.

Klik på **Disconnect** for at logge en klient ud. Den holder op med at virke med det samme.

En klient forbliver forbundet, så længe den bliver brugt. En klient, der ikke har været brugt i 30 dage, skal logge ind igen.

### Styring af, hvem der kan forbinde klienter

Som standard kan alle projektmedlemmer forbinde en MCP-klient. Hvis du vil forhindre medlemmerne af et team i at gøre det, skal du åbne teamet, gå til **Bloker tilladelser** og tilføje tilladelsen **Authorize MCP Client**. Klienter, som disse medlemmer allerede har forbundet, holder straks op med at virke.

Hvis projektet kræver single sign-on, skal du logge ind på projektet med SSO i din browser, før du godkender en klient. Klientens forbindelse varer lige så længe som det SSO-login; når det udløber, skal du forbinde klienten igen.

På OneUptime Cloud er det muligt at forbinde en MCP-klient på de samme planer som API-nøgler (Growth og derover).

I Enterprise Edition registreres enhver ændring, som en forbundet klient foretager, i auditloggen under den person, der forbandt den, sammen med klientens navn. Ændringer foretaget med en API-nøgle viser nøglens navn.

## Hentning af din API-nøgle

Brug en API-nøgle til en agent, der kører uovervåget – et planlagt job eller en CI-pipeline – hvor der ikke er nogen til at logge ind.

1. Log ind på din OneUptime-instans
2. Naviger til **Projektindstillinger** → **API-nøgler**
3. Klik på **Opret API-nøgle**
4. Angiv et navn (f.eks. "MCP Server")
5. Vælg de relevante tilladelser til dit brugsscenarie
6. Kopiér den genererede API-nøgle

API-nøgler er projektafgrænsede: MCP-serveren udleder dit projekt fra nøglen, så oprettelsesværktøjer aldrig har brug for et `projectId`-argument.

> **Advarsel — giv aldrig en AI-agent en masternøgle.** En OneUptime-*master*-API-nøgle accepteres også på denne header og giver administratoradgang til hele instansen. Brug altid en projekt-API-nøgle med de mindst mulige rettigheder, agenten har brug for (en skrivebeskyttet nøgle er nok til alle `get_`-/`list_`-/`count_`-værktøjer).

## Konfiguration

### Opret forbindelse ved at logge ind

Tilføj serverens URL til din klient uden legitimationsoplysninger. Brug `https://your-oneuptime-domain.com/mcp` til en selvhostet instans.

**Claude Code**

```bash
claude mcp add --transport http oneuptime https://oneuptime.com/mcp
```

Kør derefter `/mcp` i Claude Code, og vælg **oneuptime** for at logge ind.

**Claude (web og desktop)**

Åbn **Customize** → **Connectors**, vælg **Add custom connector**, og indtast `https://oneuptime.com/mcp`. Claude beder dig logge ind på OneUptime, første gang den har brug for dine data.

**VS Code med GitHub Copilot**

Tilføj dette til din MCP-konfiguration (under [VS Code med GitHub Copilot](#vs-code-med-github-copilot) kan du se, hvor filen ligger). VS Code åbner OneUptime, så du kan logge ind, når du starter serveren:

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

Enhver anden klient, der understøtter MCP-autorisation, fungerer på samme måde: Giv den URL'en, så finder den selv alt andet. Se [Log ind (OAuth 2.1)](#log-ind-oauth-21) for protokoldetaljerne.

Resten af dette afsnit viser de samme klienter konfigureret med en API-nøgle i stedet.

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

MCP-klienter, der logger ind, bruger også OAuth-endpointene nedenfor. En klient finder dem selv; de er anført her til dem, der skriver en klient eller konfigurerer en proxy.

| Endpoint                                      | Metode | Beskrivelse                                                              |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `/mcp/.well-known/oauth-protected-resource`   | GET    | Metadata for den beskyttede ressource (RFC 9728). Findes også på `/.well-known/oauth-protected-resource/mcp` |
| `/.well-known/oauth-authorization-server/mcp` | GET    | Metadata for autorisationsserveren (RFC 8414). Findes også på `/mcp/.well-known/oauth-authorization-server` |
| `/mcp/oauth/authorize`                        | GET    | Autorisations-endpoint: Hertil sender klienten din browser, så du kan logge ind |
| `/mcp/oauth/token`                            | POST   | Token-endpoint: udveksler en autorisationskode eller et refresh-token    |
| `/mcp/oauth/register`                         | POST   | Dynamic Client Registration (RFC 7591)                                   |
| `/mcp/oauth/revoke`                           | POST   | Tilbagekaldelse af token (RFC 7009)                                      |

## Autentificering

MCP-serveren understøtter tre driftstilstande:

### Offentlige værktøjer (ingen autentificering påkrævet)

Du kan oprette forbindelse til MCP-serveren uden en API-nøgle for at få adgang til offentlige værktøjer:

- **`oneuptime_help`**: Få hjælp og vejledning om OneUptime MCP-kapaciteter
- **`oneuptime_list_resources`**: Liste over tilgængelige ressourcer og deres operationer
- **`get_public_status_page_overview`**: Hent oversigt over en offentlig statusside
- **`get_public_status_page_incidents`**: Hent incidents fra en offentlig statusside
- **`get_public_status_page_scheduled_maintenance`**: Hent planlagte vedligeholdelsesbegivenheder
- **`get_public_status_page_announcements`**: Hent meddelelser fra en offentlig statusside

Offentlige statussideværktøjer accepterer enten et statusside-ID (UUID) eller statussidedomenets navn.

### Log ind (OAuth 2.1)

For alle andre operationer (administration af monitorer, incidents, teams osv.) skal kalderen identificeres. En klient, der kalder et af disse værktøjer uden at sende legitimationsoplysninger, får svaret `401 Unauthorized` og en `WWW-Authenticate`-header, der peger på serverens metadata for den beskyttede ressource. Det er det signal, en MCP-klient reagerer på for at logge dig ind; `initialize`, `tools/list` og de offentlige værktøjer beder aldrig om login.

Serveren implementerer [MCP-autorisationsspecifikationen](https://modelcontextprotocol.io/specification/latest/basic/authorization):

- **Flow**: OAuth 2.1-autorisationskode med PKCE (kun `S256`). Adgangstokens sendes som `Authorization: Bearer`.
- **Discovery**: metadata for den beskyttede ressource (RFC 9728) og metadata for autorisationsserveren (RFC 8414). Udstederen og ressourcen er begge `https://<host>/mcp`.
- **Klientidentitet**: et Client ID Metadata Document (klient-ID'et er en `https`-URL, som serveren henter) eller Dynamic Client Registration (RFC 7591). Ingen klient behøver at blive registreret af en administrator.
- **Scopes**: `mcp:read` til `get_`-, `list_`- og `count_`-værktøjerne; `mcp:write` tilføjer alle værktøjer, der ændrer noget, og omfatter `mcp:read`. Et token med kun læseadgang, der kalder et skriveværktøj, får svaret `403` og `error="insufficient_scope"`.
- **Tokenlevetid**: Et adgangstoken gælder i en time. Et refresh-token gælder i 30 dage og udskiftes, hver gang det bruges; bruges et refresh-token, der allerede er udskiftet, afsluttes forbindelsen.
- **Ressourceindikatorer** (RFC 8707): Et token udstedes til `https://<host>/mcp` og accepteres ikke andre steder.
- **Tilbagekaldelse** (RFC 7009): Tilbagekaldes et af de to tokens, afsluttes forbindelsen.

### API-nøgle

En agent, der kører uovervåget, autentificerer sig med en OneUptime API-nøgle i en af følgende headers:

- `x-api-key`: Din OneUptime API-nøgle
- `Authorization`: Bearer-token med din API-nøgle (f.eks. `Bearer your-api-key-here`)

`Bearer`-skemaet skelner ikke mellem store og små bogstaver. En anmodning, der indeholder en API-nøgle, bliver aldrig bedt om at logge ind.

Værktøjsfejl returneres som in-band-værktøjsresultater (`isError: true`) med en `statusCode`, detaljer og et forslag — ikke som MCP-protokolfejl — så agenter kan læse fejlen og selv rette op.

## Workflow-værktøjer

Ud over CRUD-værktøjerne pr. ressource leverer serveren specialbyggede workflow-værktøjer til incident- og advarselsrespons:

- **`acknowledge_incident`** / **`resolve_incident`**: Flyt et incident til projektets Acknowledged- eller Resolved-tilstand — svarende til at trykke på knappen i dashboardet
- **`acknowledge_alert`** / **`resolve_alert`**: Det samme for advarsler
- **`add_incident_note`**: Tilføj en note til et incident med `visibility: "internal"` (kun teamet, standarden) eller `visibility: "public"` (publiceres på statussiden). Markdown understøttes
- **`add_alert_note`**: Tilføj en intern note til en advarsel

Et typisk forløb: `list_incidents` → `acknowledge_incident` → undersøg med `list_logs` → `add_incident_note` (offentlig) → `resolve_incident`.

## Hvem er jeg

Værktøjet **`oneuptime_whoami`** returnerer det projekt, dine legitimationsoplysninger tilhører (ID og navn). For en klient, der er logget ind, returnerer det også, hvem den er logget ind som, og om den må foretage ændringer. Det er et nyttigt første kald, så en agent kan orientere sig — og da oprettelsesværktøjer udleder `projectId` fra legitimationsoplysningerne, behøver agenten aldrig at angive et projekt-ID.

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

## Konfiguration for selvhostet OneUptime

Login fungerer uden yderligere opsætning på en selvhostet instans. Der er to indstillinger:

| Miljøvariabel | Helm-værdi | Hvad den gør |
| --- | --- | --- |
| `DISABLE_MCP_OAUTH` | `mcpOAuth.disabled` | Sæt til `true` for at slå login fra. OAuth-endpointene stilles ikke længere til rådighed, og MCP-serveren accepterer kun API-nøgler. Intet slettes; forbundne klienter virker igen, når login slås til igen. |
| `DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS` | `mcpOAuth.disableClientIdMetadataDocuments` | Sæt til `true` på en instans, der ikke kan nå internettet. En klient kan identificere sig med en URL, som OneUptime henter; når dette er sat, registrerer klienter sig i stedet direkte hos din instans, hvilket ikke kræver nogen udgående anmodning. |

Hvis du kører din egen reverse proxy foran OneUptime, skal du videresende `/.well-known/oauth-protected-resource` og `/.well-known/oauth-authorization-server` (og alt under dem) til OneUptime sammen med `/mcp`. Den medfølgende ingress gør det allerede.

Serveren bygger alle OAuth-URL'er ud fra indstillingerne `HOST` og `HTTP_PROTOCOL`, så de skal svare til den adresse, folk bruger til at nå din instans.

## Fejlfinding

### Loginproblemer

- **Klienten beder mig aldrig om at logge ind**: Klienten understøtter måske ikke MCP-autorisation, eller den er måske konfigureret med en API-nøgle-header, som har forrang. Fjern headeren for at logge ind i stedet.
- **Mit projekt er nedtonet på godkendelsessiden**: Siden angiver årsagen ved siden af projektnavnet – projektets plan giver ikke mulighed for at forbinde MCP-klienter; projektet kræver SSO, og denne browser er ikke logget ind på det med SSO; eller dit team er blokeret fra at forbinde klienter.
- **Et værktøj afvises med "read-only"**: Klienten blev godkendt med kun læseadgang. Forbind den igen, og vælg **Læse- og skriveadgang**.
- **Klienten holdt op med at virke**: Den blev frakoblet, blev ikke brugt i 30 dage, du blev fjernet fra projektet, eller projektets SSO-login udløb. Forbind den igen.
- **Selvhostet – klienten melder, at den ikke kan finde autorisationsserveren**: Kontroller, at `HOST` og `HTTP_PROTOCOL` svarer til din offentlige adresse, og at din proxy videresender `/.well-known/oauth-*`-stierne.

### Tilladelsesfejl

Sørg for, at din API-nøgle – eller, for en klient, der er logget ind, din egen konto – har de nødvendige tilladelser:

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

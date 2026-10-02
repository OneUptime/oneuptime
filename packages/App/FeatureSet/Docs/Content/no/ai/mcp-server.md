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
- **Sikker autentisering**: Logg inn med OneUptime-kontoen din (OAuth 2.1), eller send en API-nøkkel per forespørsel for agenter som kjører uten tilsyn
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
- En OneUptime-konto å logge inn med, eller en OneUptime API-nøkkel for en agent som kjører uten tilsyn (kun påkrevd for autentiserte operasjoner – offentlige verktøy fungerer uten noen av delene)

## Logge inn med OneUptime

Den enkleste måten å koble til på er å gi MCP-klienten URL-en til serveren og ingenting annet. Første gang klienten trenger dataene dine, åpner den en OneUptime-side i nettleseren din, der du:

1. Logger inn på OneUptime, hvis du ikke allerede er innlogget
2. Velger prosjektet klienten skal arbeide i
3. Velger om klienten skal ha **lese- og skrivetilgang** eller **kun lesetilgang**
4. Klikker **Godkjenn**

Klienten handler deretter på dine vegne i det prosjektet. Det finnes ingen API-nøkkel å opprette, kopiere eller rullere, og ingenting hemmelig lagres i en konfigurasjonsfil.

Hva en tilkoblet klient kan gjøre:

- **Den har dine tillatelser, og aldri flere.** Det teamene dine lar deg gjøre i prosjektet, er det klienten kan gjøre. Hvis rollen din endres eller du forlater prosjektet, gjelder det allerede fra klientens neste forespørsel.
- **Kun lesetilgang betyr kun lesetilgang.** En klient som er godkjent med kun lesetilgang, kan bruke `get_`-, `list_`- og `count_`-verktøyene. Verktøy som oppretter, oppdaterer, sletter, kvitterer eller løser, blir avvist, både av MCP-serveren og av API-et til OneUptime bak den. Du kan aldri gi en klient mer tilgang enn den ba om.
- **Den gjelder for ett prosjekt.** For å bruke et annet prosjekt kobler du til klienten på nytt og velger det prosjektet.
- **Den fungerer bare gjennom MCP-serveren.** Klientens tilgangstoken godtas av MCP-endepunktet og ingen andre steder. Det kan ikke brukes til å kalle OneUptime REST API direkte.
- **Instansadministratorer får ingen særbehandling.** En klient som er koblet til av en master-admin, har det teamene til denne personen gir i prosjektet, ikke tilgang til hele instansen.

### Administrere tilkoblede klienter

Alle klienter som er koblet til ved innlogging, er oppført under **Prosjektinnstillinger** → **MCP-server** → **Connected MCP Clients** (tilkoblede MCP-klienter), med hvem som koblet dem til, hva de kan gjøre, og når de sist ble brukt. Du ser klientene du selv har koblet til; prosjekteiere og administratorer ser alles.

Klikk **Disconnect** (koble fra) for å logge en klient ut. Den slutter å fungere umiddelbart.

En klient forblir tilkoblet så lenge den er i bruk. En klient som ikke har vært brukt på 30 dager, må logge inn på nytt.

### Styre hvem som kan koble til klienter

Som standard kan alle prosjektmedlemmer koble til en MCP-klient. For å hindre medlemmene i et team i å gjøre det, åpner du teamet, går til **Blokker tillatelser** og legger til tillatelsen **Authorize MCP Client** (godkjenne MCP-klient). Klienter som disse medlemmene allerede har koblet til, slutter å fungere med en gang.

Hvis prosjektet krever Single Sign-On, logger du inn på prosjektet med SSO i nettleseren din før du godkjenner en klient. Klientens tilkobling varer like lenge som den SSO-innloggingen; når den utløper, kobler du til klienten på nytt.

På OneUptime Cloud er tilkobling av en MCP-klient tilgjengelig i de samme abonnementene som API-nøkler (Growth og høyere).

På Enterprise Edition blir hver endring en tilkoblet klient gjør, registrert i revisjonsloggen under personen som koblet den til, sammen med navnet på klienten. Endringer som er gjort med en API-nøkkel, viser navnet på nøkkelen.

## Hente API-nøkkelen din

Bruk en API-nøkkel for en agent som kjører uten tilsyn – en planlagt jobb eller en CI-pipeline – der ingen er til stede for å logge inn.

1. Logg inn på OneUptime-instansen din
2. Naviger til **Prosjektinnstillinger** → **API-nøkler**
3. Klikk **Opprett API-nøkkel**
4. Oppgi et navn (f.eks. "MCP-server")
5. Velg de riktige tillatelsene for bruksområdet ditt
6. Kopier den genererte API-nøkkelen

API-nøkler er avgrenset til prosjekt: MCP-serveren utleder prosjektet ditt fra nøkkelen, slik at opprettingsverktøy aldri trenger et `projectId`-argument.

> **Advarsel — gi aldri en AI-agent en hovednøkkel.** En OneUptime-*hoved*-API-nøkkel aksepteres også på denne overskriften og gir administratortilgang til hele instansen. Bruk alltid en prosjekt-API-nøkkel med de laveste privilegiene agenten trenger (en skrivebeskyttet nøkkel er nok for alle `get_`-/`list_`-/`count_`-verktøy).

## Konfigurasjon

### Koble til ved å logge inn

Legg til URL-en til serveren i klienten din, uten legitimasjon. Bruk `https://your-oneuptime-domain.com/mcp` for en selvhostet instans.

**Claude Code**

```bash
claude mcp add --transport http oneuptime https://oneuptime.com/mcp
```

Kjør deretter `/mcp` i Claude Code og velg **oneuptime** for å logge inn.

**Claude (nett og skrivebord)**

Åpne **Customize** → **Connectors**, velg **Add custom connector**, og skriv inn `https://oneuptime.com/mcp`. Claude ber deg logge inn på OneUptime første gang den trenger dataene dine.

**VS Code med GitHub Copilot**

Legg dette til i MCP-konfigurasjonen din (se [VS Code med GitHub Copilot](#vs-code-med-github-copilot) for hvor den filen ligger). VS Code åpner OneUptime slik at du kan logge inn når du starter serveren:

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

Alle andre klienter som støtter MCP-autorisasjon, fungerer på samme måte: gi klienten URL-en, så finner den resten selv. Se [Innlogging (OAuth 2.1)](#innlogging-oauth-21) for protokolldetaljene.

Resten av denne delen viser de samme klientene konfigurert med en API-nøkkel i stedet.

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

MCP-klienter som logger inn, bruker også OAuth-endepunktene nedenfor. En klient finner dem selv; de er oppført her for dem som skriver en klient eller konfigurerer en proxy.

| Endepunkt                                     | Metode | Beskrivelse |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `/mcp/.well-known/oauth-protected-resource`   | GET    | Metadata for beskyttet ressurs (RFC 9728). Også på `/.well-known/oauth-protected-resource/mcp` |
| `/.well-known/oauth-authorization-server/mcp` | GET    | Metadata for autorisasjonsserver (RFC 8414). Også på `/mcp/.well-known/oauth-authorization-server` |
| `/mcp/oauth/authorize`                        | GET    | Autorisasjonsendepunkt: dit klienten sender nettleseren din for å logge inn |
| `/mcp/oauth/token`                            | POST   | Token-endepunkt: veksler inn en autorisasjonskode eller et oppdateringstoken |
| `/mcp/oauth/register`                         | POST   | Dynamisk klientregistrering (RFC 7591) |
| `/mcp/oauth/revoke`                           | POST   | Tilbakekalling av token (RFC 7009) |

## Autentisering

MCP-serveren støtter tre driftsmodi:

### Offentlige verktøy (ingen autentisering påkrevd)

Du kan koble til MCP-serveren uten en API-nøkkel for å få tilgang til offentlige verktøy:

- **`oneuptime_help`**: Få hjelp og veiledning om OneUptime MCP-funksjoner
- **`oneuptime_list_resources`**: List tilgjengelige ressurser og operasjonene deres
- **`get_public_status_page_overview`**: Hent oversikt over en offentlig statusside
- **`get_public_status_page_incidents`**: Hent hendelser fra en offentlig statusside
- **`get_public_status_page_scheduled_maintenance`**: Hent planlagte vedlikeholdshendelser
- **`get_public_status_page_announcements`**: Hent kunngjøringer fra en offentlig statusside

Offentlige statussideverktøy aksepterer enten en statusside-ID (UUID) eller domenenavnet til statussiden.

### Innlogging (OAuth 2.1)

For alle andre operasjoner (administrere monitorer, hendelser, team osv.) må den som kaller, identifiseres. En klient som ikke sender legitimasjon og kaller et av disse verktøyene, får `401 Unauthorized` til svar, sammen med en `WWW-Authenticate`-overskrift som peker til serverens metadata for beskyttet ressurs. Det er signalet en MCP-klient handler på for å logge deg inn; `initialize`, `tools/list` og de offentlige verktøyene ber aldri om det.

Serveren implementerer [MCP-autorisasjonsspesifikasjonen](https://modelcontextprotocol.io/specification/latest/basic/authorization):

- **Flyt**: OAuth 2.1-autorisasjonskode med PKCE (kun `S256`). Tilgangstokener sendes som `Authorization: Bearer`.
- **Oppdagelse**: metadata for beskyttet ressurs (RFC 9728) og metadata for autorisasjonsserver (RFC 8414). Utstederen og ressursen er begge `https://<host>/mcp`.
- **Klientidentitet**: et Client ID Metadata Document (klient-ID-en er en `https`-URL som serveren henter), eller dynamisk klientregistrering (Dynamic Client Registration, RFC 7591). Ingen klient trenger å bli registrert av en administrator.
- **Omfang (scopes)**: `mcp:read` for `get_`-, `list_`- og `count_`-verktøyene; `mcp:write` legger til alle verktøy som endrer noe, og inkluderer `mcp:read`. Et token med kun lesetilgang som kaller et skriveverktøy, får `403` og `error="insufficient_scope"` til svar.
- **Levetid for tokener**: et tilgangstoken varer i én time. Et oppdateringstoken (refresh token) varer i 30 dager og erstattes hver gang det brukes; bruk av et oppdateringstoken som allerede er erstattet, avslutter tilkoblingen.
- **Ressursindikatorer** (RFC 8707): et token utstedes for `https://<host>/mcp` og godtas ikke noe annet sted.
- **Tilbakekalling** (RFC 7009): tilbakekalling av et av de to tokenene avslutter tilkoblingen.

### API-nøkkel

En agent som kjører uten tilsyn, autentiserer seg med en OneUptime API-nøkkel i én av følgende overskrifter:

- `x-api-key`: OneUptime API-nøkkelen din
- `Authorization`: Bearer-token med API-nøkkelen din (f.eks. `Bearer your-api-key-here`)

`Bearer`-skjemaet skiller ikke mellom store og små bokstaver. En forespørsel som inneholder en API-nøkkel, blir aldri bedt om å logge inn.

Verktøyfeil returneres som verktøyresultater i selve svaret (`isError: true`) med `statusCode`, detaljer og et forslag — ikke som MCP-protokollfeil — slik at agenter kan lese feilen og korrigere seg selv.

## Arbeidsflytverktøy

Utover CRUD-verktøyene per ressurs leveres serveren med formålsbygde arbeidsflytverktøy for hendelses- og varselrespons:

- **`acknowledge_incident`** / **`resolve_incident`**: Flytt en hendelse til prosjektets Kvittert- eller Løst-tilstand — tilsvarende å trykke på knappen i dashbordet
- **`acknowledge_alert`** / **`resolve_alert`**: Det samme for varsler
- **`add_incident_note`**: Legg til et notat på en hendelse med `visibility: "internal"` (kun for teamet, standard) eller `visibility: "public"` (publiseres på statussiden). Markdown støttes
- **`add_alert_note`**: Legg til et internt notat på et varsel

En typisk sløyfe: `list_incidents` → `acknowledge_incident` → undersøk med `list_logs` → `add_incident_note` (offentlig) → `resolve_incident`.

## Hvem er jeg

Verktøyet **`oneuptime_whoami`** returnerer prosjektet legitimasjonen din tilhører (ID og navn). For en klient som har logget inn, returnerer det også hvem den er innlogget som, og om den kan gjøre endringer. Det er et nyttig første kall for at en agent skal orientere seg — og siden opprettingsverktøy utleder `projectId` fra legitimasjonen, trenger agenten aldri å sende med en prosjekt-ID.

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

## Konfigurasjon for selvhostede instanser

Innlogging fungerer uten videre på en selvhostet instans. To innstillinger er tilgjengelige:

| Miljøvariabel | Helm-verdi | Hva den gjør |
| --- | --- | --- |
| `DISABLE_MCP_OAUTH` | `mcpOAuth.disabled` | Sett til `true` for å slå av innlogging. OAuth-endepunktene slutter å bli servert, og MCP-serveren godtar kun API-nøkler. Ingenting slettes; tilkoblede klienter fungerer igjen når innstillingen slås tilbake. |
| `DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS` | `mcpOAuth.disableClientIdMetadataDocuments` | Sett til `true` på en instans som ikke kan nå internett. En klient kan identifisere seg med en URL som OneUptime henter; med denne innstillingen registrerer klientene seg i stedet direkte hos instansen din, noe som ikke krever noen utgående forespørsel. |

Hvis du kjører din egen omvendte proxy foran OneUptime, må du videresende `/.well-known/oauth-protected-resource` og `/.well-known/oauth-authorization-server` (og alt under dem) til OneUptime sammen med `/mcp`. Den medfølgende ingressen gjør allerede det.

Serveren bygger alle OAuth-URL-er ut fra innstillingene `HOST` og `HTTP_PROTOCOL`, så de må samsvare med adressen folk bruker for å nå instansen din.

## Feilsøking

### Innloggingsproblemer

- **Klienten ber meg aldri om å logge inn**: klienten støtter kanskje ikke MCP-autorisasjon, eller den kan være konfigurert med en API-nøkkeloverskrift, som har forrang. Fjern overskriften for å logge inn i stedet.
- **Prosjektet mitt er grået ut på godkjenningssiden**: siden oppgir årsaken ved siden av prosjektnavnet – prosjektets abonnement omfatter ikke tilkobling av MCP-klienter, prosjektet krever SSO og denne nettleseren har ikke logget inn på det med SSO, eller teamet ditt er blokkert fra å koble til klienter.
- **Et verktøy blir avvist med "read-only"**: klienten ble godkjent med kun lesetilgang. Koble den til på nytt og velg **Lese- og skrivetilgang**.
- **Klienten sluttet å fungere**: den ble koblet fra, ble ikke brukt på 30 dager, du ble fjernet fra prosjektet, eller prosjektets SSO-innlogging utløp. Koble den til på nytt.
- **Selvhostet – klienten melder at den ikke finner autorisasjonsserveren**: sjekk at `HOST` og `HTTP_PROTOCOL` samsvarer med den offentlige adressen din, og at proxyen din videresender `/.well-known/oauth-*`-stiene.

### Tillatelsefeil

Sørg for at API-nøkkelen din – eller, for en klient som har logget inn, din egen konto – har de nødvendige tillatelsene:

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

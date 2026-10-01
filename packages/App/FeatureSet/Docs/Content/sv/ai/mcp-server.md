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
- **Säker autentisering**: Logga in med ditt OneUptime-konto (OAuth 2.1), eller skicka en API-nyckel per förfrågan för agenter som körs obevakat
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
- Ett OneUptime-konto att logga in med, eller en OneUptime API-nyckel för en agent som körs obevakat (krävs endast för autentiserade operationer – offentliga verktyg fungerar utan någondera)

## Logga in med OneUptime

Det enklaste sättet att ansluta är att ge din MCP-klient serverns URL och inget annat. Första gången klienten behöver dina data öppnar den en OneUptime-sida i din webbläsare, där du:

1. Loggar in på OneUptime, om du inte redan är inloggad
2. Väljer det projekt som klienten ska arbeta i
3. Väljer om klienten ska få **läs- och skrivåtkomst** eller **endast läsåtkomst**
4. Klickar på **Godkänn**

Klienten agerar sedan i ditt namn i det projektet. Det finns ingen API-nyckel att skapa, kopiera eller rotera, och inget hemligt lagras i en konfigurationsfil.

Vad en ansluten klient kan göra:

- **Den har dina behörigheter, och aldrig fler.** Det dina team låter dig göra i projektet är det klienten kan göra. Om din roll ändras eller du lämnar projektet gäller det redan vid klientens nästa förfrågan.
- **Endast läsåtkomst betyder endast läsåtkomst.** En klient som har godkänts med endast läsåtkomst kan använda `get_`-, `list_`- och `count_`-verktygen. Verktyg som skapar, uppdaterar, tar bort, kvitterar eller löser nekas, både av MCP-servern och av OneUptimes API bakom den. Du kan aldrig ge en klient mer åtkomst än den bad om.
- **Den gäller för ett projekt.** För att använda ett annat projekt ansluter du klienten igen och väljer det projektet.
- **Den fungerar bara via MCP-servern.** Klientens åtkomsttoken accepteras av MCP-slutpunkten och ingen annanstans. Den kan inte användas för att anropa OneUptimes REST API direkt.
- **Instansadministratörer får ingen särbehandling.** En klient som har anslutits av en master admin har det som den personens team ger i projektet, inte åtkomst till hela instansen.

### Hantera anslutna klienter

Varje klient som har anslutits genom inloggning visas under **Projektinställningar** → **MCP-server** → **Connected MCP Clients** (anslutna MCP-klienter), med vem som anslöt den, vad den får göra och när den senast användes. Du ser de klienter du själv har anslutit; projektägare och administratörer ser allas.

Klicka på **Disconnect** (koppla från) för att logga ut en klient. Den slutar fungera omedelbart.

En klient förblir ansluten så länge den används. En klient som inte har använts på 30 dagar måste logga in igen.

### Styra vem som får ansluta klienter

Som standard kan varje projektmedlem ansluta en MCP-klient. För att hindra medlemmarna i ett team från att göra det öppnar du teamet, går till **Blockera behörigheter** och lägger till behörigheten **Authorize MCP Client** (godkänna MCP-klient). Klienter som de medlemmarna redan har anslutit slutar fungera direkt.

Om projektet kräver Single Sign-On loggar du in på projektet med SSO i din webbläsare innan du godkänner en klient. Klientens anslutning varar lika länge som den SSO-inloggningen; när den löper ut ansluter du klienten igen.

På OneUptime Cloud är anslutning av en MCP-klient tillgänglig i samma planer som API-nycklar (Growth och högre).

I Enterprise Edition registreras varje ändring som en ansluten klient gör i granskningsloggen under den person som anslöt klienten, tillsammans med klientens namn. Ändringar som görs med en API-nyckel visar nyckelns namn.

## Hämta din API-nyckel

Använd en API-nyckel för en agent som körs obevakat – ett schemalagt jobb eller en CI-pipeline – där ingen finns på plats för att logga in.

1. Logga in på din OneUptime-instans
2. Navigera till **Projektinställningar** → **API-nycklar**
3. Klicka på **Skapa API-nyckel**
4. Ange ett namn (t.ex. "MCP-server")
5. Välj lämpliga behörigheter för ditt användningsfall
6. Kopiera den genererade API-nyckeln

API-nycklar är projektbundna: MCP-servern härleder ditt projekt från nyckeln, så skapa-verktyg behöver aldrig ett `projectId`-argument.

> **Varning — ge aldrig en AI-agent en huvudnyckel.** En OneUptime-*huvudnyckel* (master-API-nyckel) accepteras också i detta huvud och ger administratörsåtkomst till hela instansen. Använd alltid en projekt-API-nyckel med de minsta behörigheter agenten behöver (en skrivskyddad nyckel räcker för alla `get_`-/`list_`-/`count_`-verktyg).

## Konfiguration

### Ansluta genom att logga in

Lägg till serverns URL i din klient utan autentiseringsuppgifter. Använd `https://your-oneuptime-domain.com/mcp` för en egeninstallerad instans.

**Claude Code**

```bash
claude mcp add --transport http oneuptime https://oneuptime.com/mcp
```

Kör sedan `/mcp` i Claude Code och välj **oneuptime** för att logga in.

**Claude (webb och skrivbord)**

Öppna **Customize** → **Connectors**, välj **Add custom connector** och ange `https://oneuptime.com/mcp`. Claude ber dig logga in på OneUptime första gången den behöver dina data.

**VS Code med GitHub Copilot**

Lägg till detta i din MCP-konfiguration (se [VS Code med GitHub Copilot](#vs-code-med-github-copilot) för var den filen finns). VS Code öppnar OneUptime så att du kan logga in när du startar servern:

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

Alla andra klienter som stöder MCP-auktorisering fungerar på samma sätt: ge klienten URL:en så upptäcker den resten själv. Se [Inloggning (OAuth 2.1)](#inloggning-oauth-21) för protokolldetaljerna.

Resten av detta avsnitt visar samma klienter konfigurerade med en API-nyckel istället.

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

MCP-klienter som loggar in använder även OAuth-slutpunkterna nedan. En klient hittar dem själv; de listas här för den som skriver en klient eller konfigurerar en proxy.

| Slutpunkt                                     | Metod  | Beskrivning |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `/mcp/.well-known/oauth-protected-resource`   | GET    | Metadata för skyddad resurs (RFC 9728). Finns även på `/.well-known/oauth-protected-resource/mcp` |
| `/.well-known/oauth-authorization-server/mcp` | GET    | Metadata för auktoriseringsserver (RFC 8414). Finns även på `/mcp/.well-known/oauth-authorization-server` |
| `/mcp/oauth/authorize`                        | GET    | Auktoriseringsslutpunkt: dit klienten skickar din webbläsare för att logga in |
| `/mcp/oauth/token`                            | POST   | Tokenslutpunkt: växlar in en auktoriseringskod eller en uppdateringstoken |
| `/mcp/oauth/register`                         | POST   | Dynamisk klientregistrering (RFC 7591) |
| `/mcp/oauth/revoke`                           | POST   | Återkallande av token (RFC 7009) |

## Autentisering

MCP-servern stöder tre driftslägen:

### Offentliga verktyg (ingen autentisering krävs)

Du kan ansluta till MCP-servern utan en API-nyckel för att komma åt offentliga verktyg:

- **`oneuptime_help`**: Få hjälp och vägledning om OneUptime MCP-funktioner
- **`oneuptime_list_resources`**: Lista tillgängliga resurser och deras operationer
- **`get_public_status_page_overview`**: Hämta en översikt av en offentlig statussida
- **`get_public_status_page_incidents`**: Hämta incidenter från en offentlig statussida
- **`get_public_status_page_scheduled_maintenance`**: Hämta schemalagda underhållshändelser
- **`get_public_status_page_announcements`**: Hämta meddelanden från en offentlig statussida

Verktyg för offentliga statussidor accepterar antingen ett statussid-ID (UUID) eller statussidans domännamn.

### Inloggning (OAuth 2.1)

För alla andra operationer (hantering av monitorer, incidenter, team etc.) måste anroparen identifieras. En klient som inte skickar några autentiseringsuppgifter och anropar ett av dessa verktyg får `401 Unauthorized` till svar, tillsammans med ett `WWW-Authenticate`-huvud som pekar på serverns metadata för skyddad resurs. Det är den signal som en MCP-klient agerar på för att logga in dig; `initialize`, `tools/list` och de offentliga verktygen ber aldrig om det.

Servern implementerar [MCP-auktoriseringsspecifikationen](https://modelcontextprotocol.io/specification/latest/basic/authorization):

- **Flöde**: OAuth 2.1-auktoriseringskod med PKCE (endast `S256`). Åtkomsttoken skickas som `Authorization: Bearer`.
- **Upptäckt**: metadata för skyddad resurs (RFC 9728) och metadata för auktoriseringsserver (RFC 8414). Utfärdaren och resursen är båda `https://<host>/mcp`.
- **Klientidentitet**: ett Client ID Metadata Document (klient-ID:t är en `https`-URL som servern hämtar), eller dynamisk klientregistrering (Dynamic Client Registration, RFC 7591). Ingen klient behöver registreras av en administratör.
- **Omfång (scopes)**: `mcp:read` för `get_`-, `list_`- och `count_`-verktygen; `mcp:write` lägger till alla verktyg som ändrar något, och inkluderar `mcp:read`. En token med endast läsåtkomst som anropar ett skrivverktyg får `403` och `error="insufficient_scope"` till svar.
- **Tokenlivslängd**: en åtkomsttoken gäller i en timme. En uppdateringstoken (refresh token) gäller i 30 dagar och ersätts varje gång den används; att använda en uppdateringstoken som redan har ersatts avslutar anslutningen.
- **Resursindikatorer** (RFC 8707): en token utfärdas för `https://<host>/mcp` och accepteras inte någon annanstans.
- **Återkallande** (RFC 7009): om någon av de två token återkallas avslutas anslutningen.

### API-nyckel

En agent som körs obevakat autentiserar sig med en OneUptime API-nyckel i ett av följande huvuden:

- `x-api-key`: Din OneUptime API-nyckel
- `Authorization`: Bearer-token med din API-nyckel (t.ex. `Bearer your-api-key-here`)

`Bearer`-schemat är skiftlägesokänsligt. En förfrågan som innehåller en API-nyckel ombeds aldrig att logga in.

Verktygsfel returneras som verktygsresultat i själva svaret (`isError: true`) med en `statusCode`, detaljer och ett förslag — inte som MCP-protokollfel — så att agenter kan läsa felet och korrigera sig själva.

## Arbetsflödesverktyg

Utöver CRUD-verktygen per resurs levereras servern med särskilt byggda arbetsflödesverktyg för incident- och varningshantering:

- **`acknowledge_incident`** / **`resolve_incident`**: Flytta en incident till projektets tillstånd Kvitterad eller Löst — motsvarar att trycka på knappen i instrumentpanelen
- **`acknowledge_alert`** / **`resolve_alert`**: Samma sak för varningar
- **`add_incident_note`**: Lägg till en anteckning på en incident med `visibility: "internal"` (endast teamet, standardvärdet) eller `visibility: "public"` (publiceras på statussidan). Markdown stöds
- **`add_alert_note`**: Lägg till en intern anteckning på en varning

En typisk loop: `list_incidents` → `acknowledge_incident` → undersök med `list_logs` → `add_incident_note` (offentlig) → `resolve_incident`.

## Vem är jag

Verktyget **`oneuptime_whoami`** returnerar det projekt som dina autentiseringsuppgifter tillhör (ID och namn). För en klient som har loggat in returnerar det även vem den är inloggad som och om den får göra ändringar. Det är ett användbart första anrop för att en agent ska orientera sig — och eftersom skapa-verktyg härleder `projectId` från autentiseringsuppgifterna behöver agenten aldrig skicka ett projekt-ID.

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

## Konfiguration för egeninstallerade instanser

Inloggning fungerar direkt på en egeninstallerad instans, utan extra konfiguration. Två inställningar finns tillgängliga:

| Miljövariabel | Helm-värde | Vad den gör |
| --- | --- | --- |
| `DISABLE_MCP_OAUTH` | `mcpOAuth.disabled` | Sätt till `true` för att stänga av inloggning. OAuth-slutpunkterna slutar att tillhandahållas och MCP-servern accepterar endast API-nycklar. Ingenting tas bort; anslutna klienter fungerar igen när inställningen slås tillbaka. |
| `DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS` | `mcpOAuth.disableClientIdMetadataDocuments` | Sätt till `true` på en instans som inte kan nå internet. En klient kan identifiera sig med en URL som OneUptime hämtar; med den här inställningen registrerar sig klienterna istället direkt hos din instans, vilket inte kräver någon utgående förfrågan. |

Om du kör en egen omvänd proxy framför OneUptime ska du vidarebefordra `/.well-known/oauth-protected-resource` och `/.well-known/oauth-authorization-server` (och allt under dem) till OneUptime tillsammans med `/mcp`. Den medföljande ingressen gör redan det.

Servern bygger varje OAuth-URL utifrån inställningarna `HOST` och `HTTP_PROTOCOL`, så de måste stämma överens med den adress som användarna når din instans på.

## Felsökning

### Inloggningsproblem

- **Klienten ber mig aldrig att logga in**: klienten kanske inte stöder MCP-auktorisering, eller så är den konfigurerad med ett API-nyckelhuvud, som har företräde. Ta bort huvudet för att logga in istället.
- **Mitt projekt är nedtonat på godkännandesidan**: sidan anger orsaken bredvid projektnamnet – projektets plan omfattar inte anslutning av MCP-klienter, projektet kräver SSO och den här webbläsaren har inte loggat in på det med SSO, eller så är ditt team blockerat från att ansluta klienter.
- **Ett verktyg nekas med "read-only"**: klienten godkändes med endast läsåtkomst. Anslut den igen och välj **Läs- och skrivåtkomst**.
- **Klienten slutade fungera**: den kopplades från, användes inte på 30 dagar, du togs bort från projektet eller så löpte projektets SSO-inloggning ut. Anslut den igen.
- **Egeninstallerad – klienten rapporterar att den inte hittar auktoriseringsservern**: kontrollera att `HOST` och `HTTP_PROTOCOL` stämmer överens med din offentliga adress, och att din proxy vidarebefordrar `/.well-known/oauth-*`-sökvägarna.

### Behörighetsfel

Se till att din API-nyckel – eller, för en klient som har loggat in, ditt eget konto – har de nödvändiga behörigheterna:

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

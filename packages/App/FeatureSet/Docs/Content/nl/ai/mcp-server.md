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
- **Veilige authenticatie**: Inloggen met uw OneUptime-account (OAuth 2.1), of per verzoek een API-sleutel meesturen voor agenten die onbeheerd draaien
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
- Een OneUptime-account om mee in te loggen, of een OneUptime API-sleutel voor een agent die onbeheerd draait (alleen vereist voor geauthenticeerde bewerkingen — publieke tools werken zonder een van beide)

## Inloggen met OneUptime

De eenvoudigste manier om verbinding te maken is uw MCP-client de server-URL te geven en verder niets. De eerste keer dat de client uw gegevens nodig heeft, opent hij een OneUptime-pagina in uw browser. Daar doet u het volgende:

1. Log in bij OneUptime, als u nog niet bent ingelogd
2. Kies het project waarin de client moet werken
3. Kies of de client mag **lezen en schrijven**, of **alleen lezen**
4. Klik op **Autoriseren**

De client handelt daarna namens u in dat project. Er is geen API-sleutel om aan te maken, te kopiëren of te roteren, en er wordt niets geheims in een configuratiebestand opgeslagen.

Wat een gekoppelde client kan doen:

- **Hij heeft uw machtigingen, en nooit meer.** Wat uw teams u in het project toestaan, is wat de client kan doen. Als uw rol verandert of u het project verlaat, geldt dat al voor het eerstvolgende verzoek van de client.
- **Alleen lezen betekent alleen lezen.** Een client die voor alleen lezen is geautoriseerd, kan de `get_`-, `list_`- en `count_`-tools gebruiken. Tools die aanmaken, bijwerken, verwijderen, bevestigen of oplossen worden geweigerd, zowel door de MCP-server als door de OneUptime API erachter. U kunt een client nooit meer toegang geven dan waar hij om heeft gevraagd.
- **Hij geldt voor één project.** Om een tweede project te gebruiken, koppelt u de client opnieuw en kiest u dat project.
- **Hij werkt alleen via de MCP-server.** Het toegangstoken van de client wordt geaccepteerd door het MCP-eindpunt en nergens anders. Het kan niet worden gebruikt om de OneUptime REST API rechtstreeks aan te roepen.
- **Instantiebeheerders krijgen geen speciale behandeling.** Een client die door een master admin is gekoppeld, heeft wat de teams van die persoon in het project toekennen, en geen toegang tot de hele instantie.

### Gekoppelde clients beheren

Elke client die door in te loggen is gekoppeld, staat vermeld onder **Projectinstellingen** → **MCP-server** → **Connected MCP Clients** (gekoppelde MCP-clients), met wie hem heeft gekoppeld, wat hij mag doen en wanneer hij voor het laatst is gebruikt. U ziet de clients die u zelf hebt gekoppeld; projecteigenaren en -beheerders zien die van iedereen.

Klik op **Disconnect** (loskoppelen) om een client uit te loggen. Hij werkt dan onmiddellijk niet meer.

Een client blijft gekoppeld zolang hij wordt gebruikt. Een client die 30 dagen niet is gebruikt, moet opnieuw inloggen.

### Bepalen wie clients mag koppelen

Standaard kan elk projectlid een MCP-client koppelen. Om de leden van een team dat te beletten, opent u het team, gaat u naar **Machtigingen blokkeren** en voegt u de machtiging **Authorize MCP Client** (MCP-client autoriseren) toe. Clients die deze leden al hadden gekoppeld, werken dan meteen niet meer.

Als het project Single Sign-On vereist, logt u in uw browser met SSO in bij het project voordat u een client autoriseert. De koppeling van de client blijft bestaan zolang die SSO-login geldig is; wanneer die verloopt, koppelt u de client opnieuw.

Op OneUptime Cloud is het koppelen van een MCP-client beschikbaar in dezelfde abonnementen als API-sleutels (Growth en hoger).

In de Enterprise Edition wordt elke wijziging die een gekoppelde client aanbrengt, vastgelegd in het auditlogboek onder de persoon die de client heeft gekoppeld, samen met de naam van de client. Wijzigingen die met een API-sleutel zijn aangebracht, tonen de naam van de sleutel.

## Uw API-sleutel ophalen

Gebruik een API-sleutel voor een agent die onbeheerd draait — een geplande taak of een CI-pipeline — waarbij niemand aanwezig is om in te loggen.

1. Log in op uw OneUptime-instantie
2. Navigeer naar **Projectinstellingen** → **API-sleutels**
3. Klik op **API-sleutel aanmaken**
4. Geef een naam op (bijv. "MCP Server")
5. Selecteer de juiste machtigingen voor uw gebruiksscenario
6. Kopieer de gegenereerde API-sleutel

API-sleutels zijn projectgebonden: de MCP-server leidt uw project af uit de sleutel, zodat aanmaaktools nooit een `projectId`-argument nodig hebben.

> **Waarschuwing — geef een AI-agent nooit een master-sleutel.** Een OneUptime *master*-API-sleutel wordt ook op deze header geaccepteerd en verleent beheerderstoegang tot de hele instantie. Gebruik altijd een project-API-sleutel met de minste rechten die de agent nodig heeft (een alleen-lezen sleutel volstaat voor alle `get_`/`list_`/`count_`-tools).

## Configuratie

### Verbinding maken door in te loggen

Voeg de server-URL toe aan uw client, zonder inloggegevens. Gebruik `https://your-oneuptime-domain.com/mcp` voor een zelf-gehoste instantie.

**Claude Code**

```bash
claude mcp add --transport http oneuptime https://oneuptime.com/mcp
```

Voer daarna `/mcp` uit in Claude Code en kies **oneuptime** om in te loggen.

**Claude (web en desktop)**

Open **Customize** → **Connectors**, kies **Add custom connector** en voer `https://oneuptime.com/mcp` in. Claude vraagt u om in te loggen bij OneUptime zodra het voor het eerst uw gegevens nodig heeft.

**VS Code met GitHub Copilot**

Voeg dit toe aan uw MCP-configuratie (zie [VS Code met GitHub Copilot](#vs-code-met-github-copilot) voor de locatie van dat bestand). VS Code opent OneUptime zodat u kunt inloggen wanneer u de server start:

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

Elke andere client die MCP-autorisatie ondersteunt, werkt op dezelfde manier: geef hem de URL en hij ontdekt al het andere zelf. Zie [Inloggen (OAuth 2.1)](#inloggen-oauth-21) voor de protocoldetails.

De rest van deze sectie toont dezelfde clients, maar dan geconfigureerd met een API-sleutel.

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

MCP-clients die inloggen, gebruiken ook de onderstaande OAuth-eindpunten. Een client vindt ze zelf; ze staan hier vermeld voor wie een client schrijft of een proxy configureert.

| Eindpunt                                      | Methode | Beschrijving |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `/mcp/.well-known/oauth-protected-resource`   | GET    | Metadata van de beschermde resource (RFC 9728). Ook op `/.well-known/oauth-protected-resource/mcp` |
| `/.well-known/oauth-authorization-server/mcp` | GET    | Metadata van de autorisatieserver (RFC 8414). Ook op `/mcp/.well-known/oauth-authorization-server` |
| `/mcp/oauth/authorize`                        | GET    | Autorisatie-eindpunt: waar de client uw browser naartoe stuurt om in te loggen |
| `/mcp/oauth/token`                            | POST   | Token-eindpunt: wisselt een autorisatiecode of een vernieuwingstoken in |
| `/mcp/oauth/register`                         | POST   | Dynamische clientregistratie (RFC 7591) |
| `/mcp/oauth/revoke`                           | POST   | Intrekking van tokens (RFC 7009) |

## Authenticatie

De MCP-server ondersteunt drie bedrijfsmodi:

### Publieke tools (geen authenticatie vereist)

U kunt verbinding maken met de MCP-server zonder API-sleutel om toegang te krijgen tot publieke tools:

- **`oneuptime_help`**: Hulp en begeleiding over OneUptime MCP-mogelijkheden ophalen
- **`oneuptime_list_resources`**: Beschikbare resources en hun bewerkingen weergeven
- **`get_public_status_page_overview`**: Overzicht van een publieke statuspagina ophalen
- **`get_public_status_page_incidents`**: Incidenten van een publieke statuspagina ophalen
- **`get_public_status_page_scheduled_maintenance`**: Geplande onderhoudsgebeurtenissen ophalen
- **`get_public_status_page_announcements`**: Aankondigingen van een publieke statuspagina ophalen

Publieke statuspagina-tools accepteren een statuspagina-ID (UUID) of de domeinnaam van de statuspagina.

### Inloggen (OAuth 2.1)

Voor alle andere bewerkingen (monitors, incidenten, teams beheren, enz.) moet de aanroeper worden geïdentificeerd. Een client die geen inloggegevens meestuurt en een van deze tools aanroept, krijgt als antwoord `401 Unauthorized` en een `WWW-Authenticate`-header die verwijst naar de metadata van de beschermde resource van de server. Dat is het signaal waarop een MCP-client reageert om u te laten inloggen; `initialize`, `tools/list` en de publieke tools vragen daar nooit om.

De server implementeert de [MCP-autorisatiespecificatie](https://modelcontextprotocol.io/specification/latest/basic/authorization):

- **Flow**: OAuth 2.1-autorisatiecode met PKCE (alleen `S256`). Toegangstokens worden verstuurd als `Authorization: Bearer`.
- **Discovery**: metadata van de beschermde resource (RFC 9728) en metadata van de autorisatieserver (RFC 8414). De issuer en de resource zijn beide `https://<host>/mcp`.
- **Clientidentiteit**: een Client ID Metadata Document (de client-ID is een `https`-URL die de server ophaalt), of dynamische clientregistratie (Dynamic Client Registration, RFC 7591). Geen enkele client hoeft door een beheerder te worden geregistreerd.
- **Scopes**: `mcp:read` voor de `get_`-, `list_`- en `count_`-tools; `mcp:write` voegt elke tool toe die iets wijzigt, en omvat `mcp:read`. Een alleen-lezen token dat een schrijftool aanroept, krijgt als antwoord `403` en `error="insufficient_scope"`.
- **Levensduur van tokens**: een toegangstoken is één uur geldig. Een vernieuwingstoken (refresh token) is 30 dagen geldig en wordt bij elk gebruik vervangen; het gebruik van een vernieuwingstoken dat al is vervangen, beëindigt de koppeling.
- **Resource-indicatoren** (RFC 8707): een token wordt uitgegeven voor `https://<host>/mcp` en wordt nergens anders geaccepteerd.
- **Intrekking** (RFC 7009): het intrekken van een van beide tokens beëindigt de koppeling.

### API-sleutel

Een agent die onbeheerd draait, authenticeert zich met een OneUptime API-sleutel in een van de volgende headers:

- `x-api-key`: Uw OneUptime API-sleutel
- `Authorization`: Bearer-token met uw API-sleutel (bijv. `Bearer your-api-key-here`)

Het `Bearer`-schema is hoofdletterongevoelig. Een verzoek dat een API-sleutel bevat, krijgt nooit de vraag om in te loggen.

Toolfouten worden geretourneerd als in-band toolresultaten (`isError: true`) met een `statusCode`, details en een suggestie — niet als MCP-protocolfouten — zodat agenten de fout kunnen lezen en zichzelf kunnen corrigeren.

## Workflowtools

Naast de CRUD-tools per resource levert de server speciaal gebouwde workflowtools voor incident- en meldingsrespons:

- **`acknowledge_incident`** / **`resolve_incident`**: Verplaats een incident naar de status Bevestigd of Opgelost van het project — gelijkwaardig aan het indrukken van de knop in het dashboard
- **`acknowledge_alert`** / **`resolve_alert`**: Hetzelfde voor meldingen
- **`add_incident_note`**: Voeg een notitie toe aan een incident met `visibility: "internal"` (alleen team, de standaard) of `visibility: "public"` (gepubliceerd op de statuspagina). Markdown wordt ondersteund
- **`add_alert_note`**: Voeg een interne notitie toe aan een melding

Een typische lus: `list_incidents` → `acknowledge_incident` → onderzoeken met `list_logs` → `add_incident_note` (publiek) → `resolve_incident`.

## Wie ben ik

De tool **`oneuptime_whoami`** retourneert het project waartoe uw inloggegevens behoren (ID en naam). Voor een client die is ingelogd, retourneert de tool ook als wie de client is ingelogd en of hij wijzigingen mag aanbrengen. Het is een nuttige eerste aanroep waarmee een agent zich kan oriënteren — en omdat aanmaaktools `projectId` afleiden uit de inloggegevens, hoeft de agent nooit een project-ID mee te geven.

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

## Configuratie voor zelf-gehoste instanties

Inloggen werkt direct op een zelf-gehoste instantie, zonder extra configuratie. Er zijn twee instellingen beschikbaar:

| Omgevingsvariabele | Helm-waarde | Wat het doet |
| --- | --- | --- |
| `DISABLE_MCP_OAUTH` | `mcpOAuth.disabled` | Stel in op `true` om inloggen uit te schakelen. De OAuth-eindpunten worden dan niet meer aangeboden en de MCP-server accepteert alleen API-sleutels. Er wordt niets verwijderd; gekoppelde clients werken weer zodra de instelling wordt teruggezet. |
| `DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS` | `mcpOAuth.disableClientIdMetadataDocuments` | Stel in op `true` op een instantie die het internet niet kan bereiken. Een client kan zich identificeren met een URL die OneUptime ophaalt; met deze instelling registreren clients zich in plaats daarvan rechtstreeks bij uw instantie, waarvoor geen uitgaand verzoek nodig is. |

Als u een eigen reverse proxy vóór OneUptime gebruikt, stuur dan `/.well-known/oauth-protected-resource` en `/.well-known/oauth-authorization-server` (en alles daaronder) samen met `/mcp` door naar OneUptime. De meegeleverde ingress doet dat al.

De server bouwt elke OAuth-URL op uit de instellingen `HOST` en `HTTP_PROTOCOL`, dus die moeten overeenkomen met het adres waarmee mensen uw instantie bereiken.

## Probleemoplossing

### Inlogproblemen

- **De client vraagt me nooit om in te loggen**: mogelijk ondersteunt de client geen MCP-autorisatie, of is hij geconfigureerd met een API-sleutelheader, die voorrang heeft. Verwijder de header om in plaats daarvan in te loggen.
- **Mijn project is uitgegrijsd op de autorisatiepagina**: de pagina vermeldt de reden naast de projectnaam — het abonnement van het project omvat het koppelen van MCP-clients niet, het project vereist SSO en in deze browser is niet met SSO bij het project ingelogd, of het koppelen van clients is voor uw team geblokkeerd.
- **Een tool wordt geweigerd met "read-only"**: de client is voor alleen lezen geautoriseerd. Koppel hem opnieuw en kies **Lezen en schrijven**.
- **De client werkt niet meer**: hij is losgekoppeld, is 30 dagen niet gebruikt, u bent uit het project verwijderd, of de SSO-login van het project is verlopen. Koppel hem opnieuw.
- **Zelf-gehost — de client meldt dat hij de autorisatieserver niet kan vinden**: controleer of `HOST` en `HTTP_PROTOCOL` overeenkomen met uw openbare adres, en of uw proxy de `/.well-known/oauth-*`-paden doorstuurt.

### Machtigingsfouten

Zorg dat uw API-sleutel — of, voor een client die is ingelogd, uw eigen account — de benodigde machtigingen heeft:

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

# Architectuur

Een zelf gehoste OneUptime-installatie bestaat uit een handvol containers: één ingress waar elk verzoek binnenkomt, één app-image dat het werk doet, probes die de controles van uw monitors uitvoeren en drie gegevensopslagen. Deze pagina laat zien hoe ze in elkaar passen, wat elk onderdeel doet en welke verbindingen uw netwerk oversteken.

```mermaid title="Een zelf gehoste OneUptime-installatie"
flowchart TB
    People["Mensen en<br/>browsers"]
    Senders["Telemetrieverzenders:<br/>OpenTelemetry,<br/>Fluent Bit,<br/>syslog, agents"]
    Targets["Wat u bewaakt:<br/>intern en<br/>openbaar"]
    subgraph Install["Uw netwerk"]
        direction TB
        Ingress["Ingress<br/>(Nginx, TLS)"]
        App["App<br/>dashboards,<br/>statuspagina's,<br/>API, ingest,<br/>achtergrondtaken"]
        Runner["Globale Runner"]
        Probe["Probes"]
        subgraph Data["Gegevensopslagen"]
            direction LR
            Postgres[("PostgreSQL<br/>configuratie<br/>en status")]
            ClickHouse[("ClickHouse<br/>logs, metrics,<br/>traces")]
            Valkey[("Valkey<br/>cache en<br/>wachtrijen")]
        end
    end
    People -->|"HTTPS"| Ingress
    Senders -->|"OTLP, HTTPS"| Ingress
    Ingress --> App
    Runner -->|"taken claimen,<br/>resultaten<br/>sturen"| App
    Probe -->|"werk ophalen,<br/>resultaten<br/>sturen"| App
    Probe -->|"HTTP, TCP, ping,<br/>DNS, SNMP"| Targets
    App --> Postgres
    App --> ClickHouse
    App --> Valkey
    Targets ~~~ Probe
```

## Wat dit laat zien

- Mensen bereiken OneUptime via de **ingress**, die TLS afhandelt en elk verzoek naar de app stuurt: het Dashboard, statuspagina's, de API en elk ingest-eindpunt waar telemetrie naartoe wordt gestuurd.
- De **app** leest en schrijft zijn status in PostgreSQL, bewaart telemetrie in ClickHouse en gebruikt Valkey (de BSD-gelicentieerde fork van Redis 7.2) als cache en voor de wachtrijen die zijn achtergrondtaken afwerken.
- **Probes** kunnen binnen uw cluster draaien (aanbevolen) en/of elders in uw netwerk. Ze kunnen het volgende bewaken:
  - Interne/privé-services achter uw firewall.
  - Externe/openbare bronnen op internet.
- Proberesultaten worden naar de app gestuurd, in Valkey in de wachtrij gezet en door de achtergrondtaken in uw gegevensopslagen verwerkt. Een probe elders in uw netwerk bereikt de app via de ingress, op uw OneUptime-URL.
- Telemetrie (metrics, traces, logs en meer) wordt door dezelfde app opgenomen en in ClickHouse opgeslagen.

> [!NOTE]
> Als u een externe PostgreSQL, Valkey (of Redis) of ClickHouse gebruikt in plaats van de meegeleverde, maakt de app in plaats daarvan verbinding met uw externe eindpunten. De logische stroom blijft hetzelfde.

## De onderdelen

| Onderdeel | Docker Compose-service | Helm-chart | Wat het doet |
| --- | --- | --- | --- |
| Ingress | `ingress` | `nginx` | Handelt TLS af, bedient uw hostnaam en de domeinen van uw statuspagina's en stuurt elk verzoek naar de app. |
| App | `app` | `app` | Het Dashboard, statuspagina's, de API- en ingest-eindpunten en, tenzij u ze afsplitst, de achtergrondtaken. |
| Worker | Onderdeel van `app` | `worker` (standaard uit) | De achtergrondtaken, in eigen pods, zodat zware wachtrijverwerking nooit concurreert met API-verzoeken. |
| Telemetry writer | Onderdeel van `app` | `telemetryWriter` (standaard uit) | Een laag van vaste grootte die elke ClickHouse-insert uitvoert, zodat de inserts begrensd blijven hoe ver de workers ook schalen. |
| Probe | `probe-1` | `probes` | Voert monitorcontroles uit en stuurt de resultaten terug. Elke meegeleverde probe is een globale probe die alle projecten kunnen gebruiken. |
| Globale Runner | `global-runner` | `globalRunner` | Een [globale Runner](/docs/runbooks/agents#globale-runners): hij voert de JavaScript-stappen uit van elk project dat geen eigen Runner kiest, elk in een sandbox die alleen het internet bereikt, en de codecorrecties van OneUptime AI in elke coderepository die er geen kiest. Hij heeft een eigen sleutel en verder niets van de server. Bash-, SSH- en kubectl-stappen draaien op [Runners](/docs/runbooks/agents) die u installeert waar ze moeten draaien. |
| PostgreSQL | `postgres` | `postgresql`, of `postgresOperator.cnpg` | Projecten, monitors, incidenten, gebruikers en elke andere instelling en status. |
| ClickHouse | `clickhouse` | `clickhouse`, of `clickhouseOperator.altinity` | Logs, metrics, traces, exceptions, profielen en monitorlogs. |
| Valkey | `valkey` | `valkey` | De cache, de takenwachtrijen en kortlevende status zoals openstaande push-ontvangstbewijzen. |

Alle rollen van de app zijn hetzelfde image: Docker Compose draait ze in één `app`-container, en de Helm-chart kan de worker en de telemetry writer als eigen deployments draaien. Hoe u elke laag dimensioneert, leest u in [Dimensionering en capaciteitsplanning](/docs/installation/sizing).

## Verbindingen uit uw netwerk

Vier verbindingen worden gemaakt, tenzij u een instelling wijzigt:

- Eén keer per dag vraagt de app aan de API van GitHub (`api.github.com`) of er een nieuwere versie is. Ook leest de app de beveiligingsadviezen die OneUptime heeft gepubliceerd, zodat uw hoofdbeheerders te horen krijgen wanneer een ervan de versie treft die u draait ([Update- en beveiligingscontroles](/docs/self-hosted/update-checks)). Zet dit uit met `updateCheck.disabled: true` in de Helm-chart, of met `DISABLE_UPDATE_CHECK=true` in `config.env` bij Docker Compose.
- Eén keer per dag meldt de app het adres van uw installatie en de versie die ze draait aan `oneuptime.com`, zodat OneUptime weet welke installaties nog een versie met een beveiligingsprobleem draaien. Er wordt niets over uw gebruikers, projecten of monitoringgegevens verstuurd. Zet dit uit met `instanceCheckIn.disabled: true` in de Helm-chart, of met `DISABLE_INSTANCE_CHECK_IN=true` in `config.env` bij Docker Compose.
- Bij een aanmelding met „Stel mij op de hoogte van beveiligingspatches en nieuwe versies” aangevinkt, zoals het in het begin staat, gaan de naam en het e-mailadres van die persoon, een opgegeven bedrijf en telefoonnummer, en het adres en de versie van uw installatie naar `oneuptime.com`. Vink het uit op een netwerk zonder internettoegang.
- Op Kubernetes vallen probes na de eigen DNS van uw cluster terug op de openbare resolvers `8.8.8.8` en `1.1.1.1`. Zet `dnsConfig.nameservers` op `[]` om elke lookup op uw eigen DNS te houden.

Al het andere maakt alleen verbinding naar buiten als u het inschakelt, en voor elk is er een pagina die de exacte adressen noemt die u moet toestaan:

| Uitgaande verbinding | Gebruikt voor | Meer lezen |
| --- | --- | --- |
| E-mail (SMTP, of de API van SendGrid) | Meldingen en uitnodigingen | [SMTP](/docs/emails/smtp) |
| Twilio | Sms en telefoongesprekken | [Twilio-integratie](/docs/self-hosted/twilio-integration) |
| De push-relay van OneUptime, of Expo | Mobiele pushmeldingen | [Pushmeldingen](/docs/self-hosted/push-notifications) |
| Slack en Microsoft Teams | Meldingen en acties in de werkruimte | [Slack-integratie](/docs/self-hosted/slack-integration) |
| Een LLM-provider, zoals OpenAI, Anthropic, Microsoft Foundry of een model dat u zelf draait | OneUptime AI | [LLM-providers](/docs/ai/llm-provider) |
| `oneuptime.com` | Een Enterprise-licentie online activeren | [Enterprise Edition](/docs/self-hosted/enterprise) |

Verbindingen in de andere richting – SendGrid dat inkomende e-mail aflevert, Slack en Microsoft Teams die terugbellen – vereisen dat de ingress vanaf internet bereikbaar is. Welke privéadressen de app en de probes mogen bereiken, bepaalt u zelf: zie [Toegang tot privénetwerk](/docs/self-hosted/private-network-access).

Het logo van OneUptime zit in elke e-mail die OneUptime verstuurt, dus het verschijnt ook op een netwerk zonder internettoegang, en bij het openen van een e-mail wordt geen andere host om iets gevraagd. Een logo dat u zelf uploadt, zoals uw eigen logo of dat van een statuspagina, zit ook in de e-mail zelf als het een PNG, JPEG of GIF van maximaal 512 KB is. Elke andere afbeelding die u uploadt, wordt getoond vanaf uw OneUptime-URL, die de lezers van die e-mails moeten kunnen bereiken.

## Volgende stappen

:::cards
- [Docker Compose](/docs/installation/docker-compose): Installeer alle onderdelen op één machine.
- [Dimensionering en capaciteitsplanning](/docs/installation/sizing): Hoeveel CPU, geheugen en schijfruimte elke laag nodig heeft.
- [Eigen probes](/docs/probe/custom-probe): Draai een probe binnen een ander netwerk.
- [Enterprise Edition](/docs/self-hosted/enterprise): Wat de Enterprise-images toevoegen en hoe licenties werken.
:::

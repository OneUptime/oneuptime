# Docker-agent

OneUptime Docker-agenten er én container du kjører på en Docker-vert. Den leser statistikken og loggfilene til hver container på verten og sender dem til OneUptime, der verten vises med containerne, metrikkene og loggene sine. En andre container, Docker-AI-agenten, lar OneUptime AI undersøke verten. [Docker-monitorer](/docs/monitor/docker-monitor) varsler på det agenten sender.

:::cards
- [Installer agenten](#installer-agenten): To containere, med `docker run` eller Docker Compose.
- [Hva agenten samler inn](#hva-agenten-samler-inn): Metrikker, logger og et inventar over hver container.
- [Containerlogger trenger json-file](#containerlogger-trenger-loggdriveren-json-file): Sjekk og bytt loggdriveren til en container.
- [Feilsøking](#feilsøking): Omstartsløkker, manglende metrikker, manglende logger.
:::

## Slik fungerer det

Agenten er en OpenTelemetry Collector med OneUptimes konfigurasjon innebygd. Gjennom Docker-socketen leser den statistikken til hver container hvert 30. sekund og lister hver container, hvert image, hvert nettverk og hvert volum hvert 5. minutt. Den følger containernes loggfiler og sender alt til OneUptime-URL-en din over OTLP, med inntaksnøkkelen du gir den.

```mermaid title="To containere på Docker-verten din"
flowchart TB
    containers["Containerne dine"] -->|"statistikk, loggfiler,<br/>inventar"| agent["Docker-agent"]
    agent -->|"OTLP over HTTPS"| oneuptime["OneUptime"]
    oneuptime -->|"undersøker en hendelse<br/>eller et varsel"| ai["Docker-AI-agent"]
    ai -->|"skrivebeskyttede<br/>docker-kommandoer"| containers
```

Verten registrerer seg med de første dataene sine, under navnet du gir den i `DOCKER_HOST_NAME`. AI-agenten er valgfri: utelat den, og collectoren fungerer på samme måte.

## Før du begynner

- Docker Engine 20.10 eller nyere, og root-tilgang på verten: agenten leser `/var/run/docker.sock`.
- Docker Compose v2 (kommandoen `docker compose`), hvis du installerer med Docker Compose.
- En inntaksnøkkel. Opprett en under **Prosjektinnstillinger → Telemetri og APM → Inntaksnøkler** og kopier verdien.
- Utgående HTTPS fra verten til OneUptime-URL-en din.
- For containerlogger: containere som bruker loggdriveren `json-file` i Docker, som er standarden i Docker. Se [Containerlogger trenger loggdriveren json-file](#containerlogger-trenger-loggdriveren-json-file).

## Installer agenten

:::steps
### Start agenten

Erstatt `YOUR_ONEUPTIME_URL` med OneUptime-URL-en din, `YOUR_TELEMETRY_INGESTION_TOKEN` med inntaksnøkkelen og `my-docker-host` med et navn på denne verten, for eksempel `prod-docker-01`. Navnet er slik verten vises i OneUptime, så hold det stabilt: et nytt navn registrerer en ny vert.

:::tabs
@tab Docker CLI
```bash
docker run -d \
  --name oneuptime-docker-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /var/lib/docker/containers:/var/lib/docker/containers:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/docker-agent:release
```

Start deretter [AI-agenten](#ai-agent) ved siden av, med de samme verdiene. **AI-undersøkelser er på som standard**: mens OneUptime AI undersøker en hendelse eller et varsel på denne verten, kjører den skrivebeskyttede `docker`-kommandoer gjennom AI-agenten, og endrer ingenting med mindre du tillater rettelser. For å installere uten AI-undersøkelser, hopp over denne kommandoen.

```bash
docker run -d \
  --name oneuptime-docker-ai-agent \
  --user 0:0 \
  --restart unless-stopped \
  --read-only --tmpfs /tmp \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/resource-ai-agent:release
```
@tab Docker Compose
Lagre dette som `docker-compose.yml` i en mappe på verten. Den andre tjenesten er [AI-agenten](#ai-agent): utelat den for å kjøre collectoren uten AI-undersøkelser.

```yaml title="docker-compose.yml"
services:
  oneuptime-docker-agent:
    image: oneuptime/docker-agent:release
    container_name: oneuptime-docker-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - DOCKER_HOST_NAME=my-docker-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
  oneuptime-docker-ai-agent:
    image: oneuptime/resource-ai-agent:release
    container_name: oneuptime-docker-ai-agent
    user: "0:0"
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker
      - DOCKER_HOST_NAME=my-docker-host
```

Start den i den mappen:

```bash
docker compose up -d
```
:::

### Sjekk at agenten kjører

```bash
docker ps --filter name=oneuptime-docker-agent
docker logs -f oneuptime-docker-agent
```

Loggene skal vise denne linjen når collectoren har startet:

```text
Everything is ready. Begin running and processing data.
```

### Finn verten i OneUptime

Åpne **Produkter → Infrastruktur → Docker → Alle verter**. Verten vises under sitt `DOCKER_HOST_NAME` innen et minutt eller så, med containerne, metrikkene og loggene sine. AI-agenten vises som tilkoblet på vertens side **AI-agent**, og nederst på **Oversikt**.
:::

## Miljøvariabler

| Variabel | Påkrevd | Beskrivelse |
| --- | --- | --- |
| `ONEUPTIME_URL` | Ja | OneUptime-URL-en din, for eksempel `https://oneuptime.com` eller den selvhostede instansen din. Bruk `http://` og porten hvis instansen bare bruker HTTP. |
| `ONEUPTIME_SERVICE_TOKEN` | Ja | Inntaksnøkkelen fra **Prosjektinnstillinger → Telemetri og APM → Inntaksnøkler**. |
| `DOCKER_HOST_NAME` | Nei | Vertens navn i OneUptime. Standard er `docker-host`, så gi hver vert sitt eget. |
| `DOCKER_API_VERSION` | Nei | Versjonen av Docker Engine API som agenten snakker. Standard er `1.44`. Senk den på en eldre daemon, eller sett en tom verdi for å forhandle den med daemonen (se [Feilsøking](#feilsøking)). |

For å endre en verdi, fjern agenten og kjør kommandoen på nytt (Docker CLI), eller rediger `docker-compose.yml` og kjør `docker compose up -d` (Docker Compose).

## Hva agenten samler inn

| Data | Hva det er |
| --- | --- |
| Containermetrikker | CPU (bruk, prosentandel, struping), minne (bruk, grense, prosentandel), nettverks- og blokk-I/O, oppetid, omstarter og antall prosesser, per container, hvert 30. sekund. |
| Containerlogger | Stdout og stderr fra hver container, fra containerens `json-file`-loggfil. |
| Inventar | Hver container i hver tilstand, og hvert image, nettverk og volum, hvert 5. minutt. |

Metrikkene og loggene til hver container lagres under en tjeneste oppkalt etter containeren. Hver logglinje får en alvorlighetsgrad fra nivået den nevner, som `[ERROR]`, `level=warn` eller `{"level":"info"}`; en linje som ikke nevner noe, får strømmens: stderr er `ERROR`, stdout er `INFO`. Linjer som begynner med mellomrom eller en lukkende parentes, slås sammen med linjen før, så en stakksporing kommer inn som én post. Agentens egne logger utelates.

[Docker-overvåking](/docs/monitor/docker-monitor#innsamlede-metrikker) lister hver metrikk og hva den betyr.

## Containerlogger trenger loggdriveren json-file

Agenten følger `/var/lib/docker/containers/*/*-json.log`, filene loggdriveren `json-file` i Docker skriver. En container som bruker en annen driver, etterlater ingen fil å lese: `local` skriver binærfiler, og `journald`, `syslog`, `fluentd` og `gelf` sender loggene et annet sted. Metrikkene kommer fortsatt inn; loggene gjør det ikke.

Sjekk loggdriveren til en container, og daemonens standard:

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
docker info --format '{{.LoggingDriver}}'
```

Bytt en Compose-tjeneste til `json-file`, med rotasjon:

```yaml
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
```

Eller gjør den til standard for hver container som opprettes etterpå, i `/etc/docker/daemon.json`:

```json title="/etc/docker/daemon.json"
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Start deretter Docker på nytt og opprett containerne på nytt. En container beholder loggdriveren den ble opprettet med, så det er ikke nok å starte den på nytt.

## Oppgradere agenten

Når agenten er eldre enn OneUptime-en din, vises et varseltegn ved siden av **Agentversjon** på vertens **Oversikt**. Velg det for å se disse kommandoene.

:::tabs
@tab Docker CLI
```bash
docker pull oneuptime/docker-agent:release
docker pull oneuptime/resource-ai-agent:release
docker rm -f oneuptime-docker-agent oneuptime-docker-ai-agent
```

Kjør deretter begge `docker run`-kommandoene fra [Start agenten](#start-agenten) på nytt.
@tab Docker Compose
```bash
docker compose pull
docker compose up -d
```
:::

Taggen `release` peker alltid på den nyeste utgivelsen. For å feste en versjon, bruk `oneuptime/docker-agent:<version>`, for eksempel `oneuptime/docker-agent:10.0.31`. Det samme imaget finnes i GitHub Container Registry som `ghcr.io/oneuptime/docker-agent:release`.

## Avinstallere agenten

:::tabs
@tab Docker CLI
```bash
docker rm -f oneuptime-docker-agent
docker rm -f oneuptime-docker-ai-agent
```
@tab Docker Compose
```bash
docker compose down
```
:::

Verten blir værende i OneUptime med dataene den sendte. Hvis du ikke lenger trenger den, slett den med **Slett vert** i menyen.

## AI-agent

Kommandoene og Compose-filen over, Docker-agentens `install.sh` og `docker-compose.yml` i [DockerAgent-mappen](https://github.com/OneUptime/oneuptime/tree/master/agents/DockerAgent) kjører alle **Docker-AI-agenten**: en andre container, `oneuptime-docker-ai-agent` (image `oneuptime/resource-ai-agent:release`), som kjører de skrivebeskyttede `docker`-kommandoene OneUptime AI ber om mens den undersøker en hendelse eller et varsel på denne verten — `docker ps -a`, `docker logs --tail 200 web`, `docker container inspect web`, `docker stats --no-stream` — og, bare hvis du tillater det, utfører rettelser som å starte en navngitt container på nytt. Den leser de samme `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` og `DOCKER_HOST_NAME` som collectoren, så den betjener nøyaktig denne verten, og den vises på vertens side **AI-agent** i OneUptime.

- **AI-undersøkelser er på som standard.** Så snart agenten kobler seg til, undersøker OneUptime AI hendelser og varsler på denne verten med den, og vertens **Oversikt** viser agentens status. For å stoppe, sett `ONEUPTIME_AI_INVESTIGATION=false` der agenten kjører (**Endre** under **Hva AI kan gjøre** på AI-agentsiden viser hvordan), eller utelat agenten.
- Den er skrivebeskyttet med mindre du starter den med `ONEUPTIME_AI_ALLOW_WRITES=true`; `ONEUPTIME_AI_WRITE_TARGETS` (for eksempel `web-*,api-*`) begrenser hvilke containere en rettelse kan røre. Start den også med `ONEUPTIME_AI_FIXES` for å si hvordan rettelser kjører — `ask-for-approval` (en person godkjenner hver av dem), `automatic` eller `bypass-approval` — og AI-agentsiden viser det skrivebeskyttet ([Hva AI kan gjøre, satt av agenten](/docs/ai/infrastructure-ai-agents#what-ai-may-do-set-by-the-agent)).
- Den kjører som root med Docker-socketen montert, fordi socketen eies av root — og den som kan bruke socketen, er root på denne verten, `:ro` eller ikke. Agentens kommandopolicy er grensen: den kjører aldri `exec`, `run`, `rm` eller `prune`, og endrer aldri seg selv, collectoren eller noe i `ONEUPTIME_AI_PROTECTED_TARGETS` (glob-mønstre for containernavn). Miljøverdier i utdata fra `docker inspect` maskeres før noe forlater verten.
- `install.sh --no-ai-agent` utelater den; `docker rm -f oneuptime-docker-ai-agent` fjerner den. Oppgrader den som collectoren: `docker pull oneuptime/resource-ai-agent:release`, fjern den og start den igjen.

Hva den kan kjøre, hvordan rettelser fungerer og hvordan du feilsøker den: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).

## Feilsøking

:::details Agenten starter på nytt med "client version is too new"
Agentens logger viser:

```text
Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41
```

En daemon avviser en klient som er nyere enn sitt eget maksimum, så receiveren starter aldri og collectoren avslutter sammen med den. Finn daemonens maksimum:

```bash
docker version --format '{{ .Server.APIVersion }}'
```

Legg deretter til `-e DOCKER_API_VERSION=1.41` (eller verdien du fikk) i `docker run`, eller sett `DOCKER_API_VERSION` i Compose. Nyere daemoner betjener fortsatt eldre API-versjoner, så innstillingen forblir gyldig etter en oppgradering.

Vil du heller ikke slå opp tallet? Sett `DOCKER_API_VERSION` til den tomme strengen. Agenten forhandler da versjonen med daemonen (én `HEAD /_ping`, deretter daemonens eget maksimum), noe som fungerer mot både gamle og nye daemoner:

```bash
docker run -d ... -e DOCKER_API_VERSION= ...
```
:::

:::details Tilgang nektet til Docker-socketen
Agenten må kjøre som root for å lese `/var/run/docker.sock`. Sjekk at `--user 0:0` står i `docker run`-kommandoen din, eller `user: "0:0"` i Compose.
:::

:::details Verten vises som frakoblet
1. Sjekk at agenten kjører: `docker ps --filter name=oneuptime-docker-agent`
2. Se etter feil i loggene: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`
3. Sjekk `ONEUPTIME_URL` og `ONEUPTIME_SERVICE_TOKEN`: nøkkelen må være en gyldig inntaksnøkkel som ikke er deaktivert.
4. Sjekk at verten kan nå OneUptime-URL-en din over nettverket.
:::

:::details Ingen metrikker vises
1. Sjekk at Docker-socketen er montert i agenten. Imaget har ikke noe skall, så se fra en engangscontainer som deler monteringene: `docker run --rm --volumes-from oneuptime-docker-agent alpine:3.19 ls -la /var/run/docker.sock`
2. Se etter eksportfeil i loggene: `docker logs oneuptime-docker-agent 2>&1 | tail -100`
3. Sjekk at inntaksnøkkelen er gyldig og ikke har utløpt.
:::

:::details Metrikker kommer inn, men ingen containerlogger
Containerne dine bruker mest sannsynlig en annen loggdriver enn `json-file`. Sjekk hvilke filer agenten overvåker, og hvilken driver en container bruker:

```bash
docker logs oneuptime-docker-agent 2>&1 | grep -E "Started watching file|no files match"
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

Hvis agenten rapporterer `no files match the configured criteria`, bytt containerne til `json-file` og opprett dem på nytt, slik [Containerlogger trenger loggdriveren json-file](#containerlogger-trenger-loggdriveren-json-file) viser.
:::

:::details Loggene havner på en annen vert, eller verten heter docker-host
Vertens navn kommer fra `DOCKER_HOST_NAME`. En agent som startes uten den, rapporterer `docker-host`, så hver vert som er satt opp slik, ser ut som den samme; endre navnet senere, og OneUptime registrerer en ny vert, som da har de nye dataene. Sett `DOCKER_HOST_NAME` til et eget navn på hver vert, og opprett agenten på nytt. For å sjekke navnet agenten rapporterer:

```bash
docker inspect oneuptime-docker-agent --format '{{range .Config.Env}}{{println .}}{{end}}' | grep DOCKER_HOST_NAME
```
:::

## Neste trinn

:::cards
- [Docker-overvåking](/docs/monitor/docker-monitor): Varsle på CPU, minne og omstarter for containere.
- [Databaser](/docs/telemetry/databases): Databasecontainere på verten blir funnet og får egne sider.
- [Kubernetes-agent](/docs/telemetry/kubernetes-agent): Overvåk en Kubernetes-klynge i stedet.
- [OpenTelemetry-collector på verten](/docs/telemetry/host-otel-collector): Overvåk selve maskinen: CPU, disker, prosesser og logger.
:::

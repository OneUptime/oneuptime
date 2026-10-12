# Podman-agent

OneUptime Podman-agenten är en container som du kör på en Podman-värd. Den läser statistiken och loggfilerna för varje container på värden och skickar dem till OneUptime, där värden visas med sina containrar, mätvärden och loggar. En andra container, Podman-AI-agenten, låter OneUptime AI undersöka värden. [Podman-monitorer](/docs/monitor/podman-monitor) larmar på det som agenten skickar.

:::cards
- [Installera agenten](#installera-agenten): Två containrar, med `podman run` eller Podman Compose.
- [Vad agenten samlar in](#vad-agenten-samlar-in): Mätvärden, loggar och en inventering av varje container.
- [Containerloggar behöver k8s-file](#containerloggar-behöver-loggdrivrutinen-k8s-file): Podman loggar till journald om du inte byter.
- [Felsökning](#felsökning): Omstartsloopar, saknade mätvärden, saknade loggar.
:::

## Så fungerar det

Agenten är en OpenTelemetry Collector med OneUptimes konfiguration inbyggd. Via Podmans Docker-kompatibla API-socket läser den varje containers statistik var 30:e sekund och listar varje container, image, nätverk och volym var 5:e minut. Den följer containrarnas loggfiler och skickar allt till din OneUptime-URL över OTLP, med den intagningsnyckel du ger den.

```mermaid title="Två containrar på din Podman-värd"
flowchart TB
    containers["Dina containrar"] -->|"statistik, loggfiler,<br/>inventarie"| agent["Podman-agent"]
    agent -->|"OTLP över HTTPS"| oneuptime["OneUptime"]
    oneuptime -->|"undersöker en incident<br/>eller ett larm"| ai["Podman-AI-agent"]
    ai -->|"skrivskyddade<br/>docker-kommandon"| containers
```

Värden registrerar sig med sina första data, under det namn du ger den i `PODMAN_HOST_NAME`. AI-agenten är valfri: utelämna den så fungerar collectorn likadant.

## Innan du börjar

- Podman 4.0 eller senare, och root-åtkomst på värden.
- Podmans API-socket på `/run/podman/podman.sock`. Slå på den med `sudo systemctl enable --now podman.socket`.
- En intagningsnyckel. Skapa en under **Projektinställningar → Telemetri och APM → Intagningsnycklar** och kopiera värdet.
- Utgående HTTPS från värden till din OneUptime-URL.
- För containerloggar: containrar som använder loggdrivrutinen `k8s-file`. Rootful Podman loggar till `journald` som standard, vilket agenten inte kan läsa. Se [Containerloggar behöver loggdrivrutinen k8s-file](#containerloggar-behöver-loggdrivrutinen-k8s-file).

## Installera agenten

:::steps
### Starta agenten

Ersätt `YOUR_ONEUPTIME_URL` med din OneUptime-URL, `YOUR_TELEMETRY_INGESTION_TOKEN` med intagningsnyckeln och `my-podman-host` med ett namn på den här värden, till exempel `prod-podman-01`. Namnet är hur värden visas i OneUptime, så håll det stabilt: ett nytt namn registrerar en ny värd.

:::tabs
@tab Podman CLI
```bash
podman run -d \
  --name oneuptime-podman-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /run/podman/podman.sock:/run/podman/podman.sock:ro \
  -v /var/lib/containers/storage:/var/lib/containers/storage:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e PODMAN_HOST_NAME="my-podman-host" \
  oneuptime/podman-agent:release
```

Starta sedan [AI-agenten](#ai-agent) bredvid, med samma värden. **AI-undersökningar är på som standard**: medan OneUptime AI undersöker en incident eller ett larm på den här värden kör den skrivskyddade `docker`-kommandon genom AI-agenten, mot Podmans Docker-kompatibla API, och ändrar ingenting om du inte tillåter åtgärder. För att installera utan AI-undersökningar hoppar du över det här kommandot.

```bash
podman run -d \
  --name oneuptime-podman-ai-agent \
  --user 0:0 \
  --restart unless-stopped \
  --read-only --tmpfs /tmp \
  -v /run/podman/podman.sock:/run/podman/podman.sock:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=podman \
  -e PODMAN_HOST_NAME="my-podman-host" \
  oneuptime/resource-ai-agent:release
```
@tab Podman Compose
Spara detta som `docker-compose.yml` i en mapp på värden. Den andra tjänsten är [AI-agenten](#ai-agent): utelämna den för att köra collectorn utan AI-undersökningar.

```yaml title="docker-compose.yml"
services:
  oneuptime-podman-agent:
    image: oneuptime/podman-agent:release
    container_name: oneuptime-podman-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /run/podman/podman.sock:/run/podman/podman.sock:ro
      - /var/lib/containers/storage:/var/lib/containers/storage:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - PODMAN_HOST_NAME=my-podman-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
  oneuptime-podman-ai-agent:
    image: oneuptime/resource-ai-agent:release
    container_name: oneuptime-podman-ai-agent
    user: "0:0"
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - /run/podman/podman.sock:/run/podman/podman.sock:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - ONEUPTIME_AI_AGENT_RESOURCE_TYPE=podman
      - PODMAN_HOST_NAME=my-podman-host
```

Starta den i den mappen:

```bash
podman compose up -d
```
:::

### Kontrollera att agenten körs

```bash
podman ps --filter name=oneuptime-podman-agent
podman logs -f oneuptime-podman-agent
```

Loggarna ska visa den här raden när collectorn har startat:

```text
Everything is ready. Begin running and processing data.
```

### Hitta värden i OneUptime

Öppna **Produkter → Infrastruktur → Podman → Alla värdar**. Värden visas under sitt `PODMAN_HOST_NAME` inom en minut eller så, med sina containrar, mätvärden och loggar. AI-agenten visas som ansluten på värdens sida **AI-agent**, och längst ned på dess **Översikt**.
:::

## Miljövariabler

| Variabel | Obligatorisk | Beskrivning |
| --- | --- | --- |
| `ONEUPTIME_URL` | Ja | Din OneUptime-URL, till exempel `https://oneuptime.com` eller din självhostade instans. Använd `http://` och dess port om instansen bara använder HTTP. |
| `ONEUPTIME_SERVICE_TOKEN` | Ja | Intagningsnyckeln från **Projektinställningar → Telemetri och APM → Intagningsnycklar**. |
| `PODMAN_HOST_NAME` | Nej | Värdens namn i OneUptime. Standard är `podman-host`, så ge varje värd ett eget. |
| `DOCKER_API_VERSION` | Nej | Den Docker API-version som agenten talar med Podman-socketen. Standard är `1.44`. Sänk den om socketen rapporterar ett äldre maximum, eller sätt ett tomt värde för att förhandla fram den (se [Felsökning](#felsökning)). |

För att ändra ett värde tar du bort agenten och kör dess kommando igen (Podman CLI), eller redigerar `docker-compose.yml` och kör `podman compose up -d` (Podman Compose).

## Vad agenten samlar in

| Data | Vad det är |
| --- | --- |
| Containermätvärden | CPU (användning, procent, strypning), minne (användning, gräns, procent), nätverks- och block-I/O, drifttid, omstarter och antal processer, per container, var 30:e sekund. |
| Containerloggar | Stdout och stderr från varje container, från filen `ctr.log` som loggdrivrutinen `k8s-file` skriver. |
| Inventering | Varje container i alla tillstånd, och varje image, nätverk och volym, var 5:e minut. |

Varje containers mätvärden och loggar arkiveras under en tjänst som är uppkallad efter containern. Varje loggrad får en allvarlighetsgrad från den nivå den anger, som `[ERROR]`, `level=warn` eller `{"level":"info"}`; en rad som inte anger någon får sin ströms: stderr är `ERROR`, stdout är `INFO`. Rader som börjar med blanksteg eller en avslutande hakparentes slås ihop med raden före, så en stackspårning kommer in som en enda post. Agentens egna loggar utelämnas.

[Podman-övervakning](/docs/monitor/podman-monitor#insamlade-mätvärden) listar varje mätvärde och vad det betyder.

## Containerloggar behöver loggdrivrutinen k8s-file

Agenten följer `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`, de filer som Podmans loggdrivrutin `k8s-file` skriver (`json-file` är samma drivrutin i Podman). Standarddrivrutinen för rootful Podman är `journald`, som inte lämnar någon fil att läsa, och det gör inte heller en fjärrdrivrutin som `syslog`. En sådan containers mätvärden kommer fortfarande in; dess loggar gör det inte.

Kontrollera en containers loggdrivrutin och Podmans standard:

```bash
podman inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
podman info --format '{{.Host.LogDriver}}'
```

Kör en container med `k8s-file`, eller byt en Compose-tjänst till den:

```bash
podman run --log-driver k8s-file --log-opt max-size=100m ... <image>
```

```yaml
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "k8s-file"
      options:
        max-size: "100m"
```

Eller gör den till standard för varje container som skapas efteråt, i `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):

```toml title="containers.conf"
[containers]
log_driver = "k8s-file"
log_size_max = 104857600
```

Återskapa sedan containrarna. En container behåller den loggdrivrutin den skapades med, så det räcker inte att starta om den.

## Uppgradera agenten

När agenten är äldre än din OneUptime visas en varningssymbol bredvid **Agentversion** på värdens **Översikt**. Välj den för att se de här kommandona.

:::tabs
@tab Podman CLI
```bash
podman pull oneuptime/podman-agent:release
podman pull oneuptime/resource-ai-agent:release
podman rm -f oneuptime-podman-agent oneuptime-podman-ai-agent
```

Kör sedan båda `podman run`-kommandona från [Starta agenten](#starta-agenten) igen.
@tab Podman Compose
```bash
podman compose pull
podman compose up -d
```
:::

Taggen `release` pekar alltid på den senaste utgåvan. För att låsa en version använder du `oneuptime/podman-agent:<version>`, till exempel `oneuptime/podman-agent:10.0.31`. Samma image finns i GitHub Container Registry som `ghcr.io/oneuptime/podman-agent:release`.

## Avinstallera agenten

:::tabs
@tab Podman CLI
```bash
podman rm -f oneuptime-podman-agent
podman rm -f oneuptime-podman-ai-agent
```
@tab Podman Compose
```bash
podman compose down
```
:::

Värden finns kvar i OneUptime med de data den skickade. Om du inte längre behöver den tar du bort den med **Ta bort värd** i dess meny.

## AI-agent

Kommandona och Compose-filen ovan, Podman-agentens `install.sh` och `docker-compose.yml` i dess [PodmanAgent-katalog](https://github.com/OneUptime/oneuptime/tree/master/agents/PodmanAgent) kör alla **Podman-AI-agenten**: en andra container, `oneuptime-podman-ai-agent` (imagen `oneuptime/resource-ai-agent:release`), som kör de skrivskyddade kommandon som OneUptime AI ber om medan den undersöker en incident eller ett larm på den här värden — via Podmans Docker-kompatibla API, med `docker`-CLI:t: `docker ps -a`, `docker logs --tail 200 web`, `docker container inspect web` — och, bara om du tillåter det, genomför åtgärder som att starta om en namngiven container. Den läser samma `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` och `PODMAN_HOST_NAME` som collectorn, så den betjänar exakt den här värden, och den visas på värdens sida **AI-agent** i OneUptime.

- **AI-undersökningar är på som standard.** När agenten väl ansluter undersöker OneUptime AI incidenter och larm på den här värden med den, och värdens **Översikt** visar agentens status. För att stoppa sätter du `ONEUPTIME_AI_INVESTIGATION=false` där agenten körs (**Ändra** under **Vad AI får göra** på AI-agentsidan visar hur), eller utelämnar agenten.
- Den är skrivskyddad om du inte startar den med `ONEUPTIME_AI_ALLOW_WRITES=true`; `ONEUPTIME_AI_WRITE_TARGETS` (till exempel `web-*,api-*`) begränsar vilka containrar en åtgärd får röra. Starta den också med `ONEUPTIME_AI_FIXES` för att ange hur åtgärder körs — `ask-for-approval` (en person godkänner varje åtgärd), `automatic` eller `bypass-approval` — och AI-agentsidan visar det skrivskyddat ([Vad AI får göra, inställt av agenten](/docs/ai/infrastructure-ai-agents#what-ai-may-do-set-by-the-agent)).
- Den behöver samma socket som collectorn och körs som root med den monterad, eftersom socketen ägs av root — och för rootful Podman är den som kan använda socketen root på den här värden, `:ro` eller inte. Agentens kommandopolicy är gränsen: den kör aldrig `exec`, `run`, `rm` eller `prune`, och ändrar aldrig sig själv, collectorn eller något i `ONEUPTIME_AI_PROTECTED_TARGETS` (globmönster för containernamn).
- `install.sh --no-ai-agent` utelämnar den; `podman rm -f oneuptime-podman-ai-agent` tar bort den. Uppgradera den som collectorn: `podman pull oneuptime/resource-ai-agent:release`, ta bort den och starta den igen.

Vad den får köra, hur åtgärder fungerar och hur du felsöker den: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).

## Felsökning

:::details Agenten startar om med "client version is too new"
Agentens loggar visar:

```text
Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41
```

En Docker-API-server som tillämpar en högsta klientversion nekar en nyare, så receivern startar aldrig och collectorn avslutas med den. Kontrollera vilken API-version Podman-socketen rapporterar:

```bash
curl -s -o /dev/null -D - --unix-socket /run/podman/podman.sock http://localhost/_ping | grep -i '^api-version'
```

Lägg sedan till `-e DOCKER_API_VERSION=1.41` (eller värdet du fick) i `podman run`, eller sätt `DOCKER_API_VERSION` i Compose. Nyare servrar hanterar fortfarande äldre API-versioner, så inställningen förblir giltig efter en uppgradering.

Vill du hellre slippa slå upp numret? Sätt `DOCKER_API_VERSION` till den tomma strängen. Agenten förhandlar då fram versionen med socketen (en `HEAD /_ping`, sedan det maximum som socketen rapporterar) i stället för att låsa en:

```bash
podman run -d ... -e DOCKER_API_VERSION= ...
```
:::

:::details Åtkomst nekad till Podman-socketen, eller ingen socket
Agenten måste köras som root för att läsa `/run/podman/podman.sock`. Kontrollera att `--user 0:0` finns i ditt `podman run`-kommando, eller `user: "0:0"` i Compose, och att socketen är på: `sudo systemctl enable --now podman.socket`. Rootless Podman har i stället sin socket på `/run/user/<uid>/podman/podman.sock` (`systemctl --user enable --now podman.socket`): montera den sökvägen i stället för `/run/podman/podman.sock`.
:::

:::details Värden visas som frånkopplad
1. Kontrollera att agenten körs: `podman ps --filter name=oneuptime-podman-agent`
2. Leta efter fel i dess loggar: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`
3. Kontrollera `ONEUPTIME_URL` och `ONEUPTIME_SERVICE_TOKEN`: nyckeln måste vara en giltig intagningsnyckel som inte har inaktiverats.
4. Kontrollera att värden kan nå din OneUptime-URL över nätverket.
:::

:::details Inga mätvärden visas
1. Kontrollera att Podman-socketen är monterad i agenten. Dess image har inget skal, så titta från en tillfällig container som delar dess monteringar: `podman run --rm --volumes-from oneuptime-podman-agent alpine:3.19 ls -la /run/podman/podman.sock`
2. Leta efter exportfel i dess loggar: `podman logs oneuptime-podman-agent 2>&1 | tail -100`
3. Kontrollera att intagningsnyckeln är giltig och inte har gått ut.
:::

:::details Mätvärden kommer in men inga containerloggar
Dina containrar använder troligen `journald`, Podmans standarddrivrutin för loggar. Kontrollera vilka filer agenten bevakar, och vilken drivrutin en container använder:

```bash
podman logs oneuptime-podman-agent 2>&1 | grep -E "Started watching file|no files match"
podman inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

Om agenten rapporterar `no files match the configured criteria` byter du containrarna till `k8s-file` och återskapar dem, som [Containerloggar behöver loggdrivrutinen k8s-file](#containerloggar-behöver-loggdrivrutinen-k8s-file) visar.
:::

:::details Loggarna hamnar på en annan värd, eller värden heter podman-host
Värdens namn kommer från `PODMAN_HOST_NAME`. En agent som startats utan det rapporterar `podman-host`, så varje värd som konfigurerats på det sättet ser ut som samma värd; ändrar du namnet senare registrerar OneUptime en andra värd, som då innehåller de nya data. Sätt `PODMAN_HOST_NAME` till ett eget namn på varje värd och återskapa agenten. För att kontrollera vilket namn agenten rapporterar:

```bash
podman inspect oneuptime-podman-agent --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PODMAN_HOST_NAME
```
:::

## Nästa steg

:::cards
- [Podman-övervakning](/docs/monitor/podman-monitor): Larma på containrarnas CPU, minne och omstarter.
- [Databaser](/docs/telemetry/databases): Databascontainrar på värden hittas och får egna sidor.
- [Kubernetes-agent](/docs/telemetry/kubernetes-agent): Övervaka ett Kubernetes-kluster i stället.
- [OpenTelemetry-collector på värden](/docs/telemetry/host-otel-collector): Övervaka själva maskinen: CPU, diskar, processer och loggar.
:::

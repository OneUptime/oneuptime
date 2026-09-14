# OneUptime Docker Agent

## Oversikt

OneUptime Docker Agent er et ferdigbygd containerbilde som leveres med en finjustert OpenTelemetry Collector-konfigurasjon. Kjor den ved siden av dine eksisterende containere, så oppdager den automatisk hver container på verten, samler inn CPU-/minne-/nettverks-/blokk-I/O-metrikker pluss containerlogger, og videresender alt til OneUptime over OTLP. Ett bilde, én kommando.

Denne siden er **installasjonsveiledningen**. For å konfigurere Docker-monitorer og varsler på toppen av dataene agenten samler inn, se [Docker Monitor](/docs/monitor/docker-monitor).

## Forutsetninger

- Docker Engine 20.10+
- Tilgang til `/var/run/docker.sock` på verten
- Et **OneUptime Telemetry Ingestion Token** — opprett ett fra _Prosjektinnstillinger → Telemetri og APM → Inntaksnøkler_ og kopier verdien

## Hurtigstart (én kommando)

Erstatt `YOUR_ONEUPTIME_URL`, `YOUR_TELEMETRY_INGESTION_TOKEN` og vertsnavnet med verdier for ditt miljo. Vertsnavnet er hvordan denne Docker-verten vil vises i OneUptime — velg noe som `prod-docker-01`.

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

Det er alt. Når agenten kobler til, vil Docker-verten din vises automatisk i **Docker**-seksjonen i OneUptime-dashbordet.

## Alternativ — Docker Compose

Hvis du foretrekker Docker Compose, legg folgende inn i en `docker-compose.yml`:

```yaml
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
```

Start den:

```bash
docker compose up -d
```

## Miljovariabler

| Variabel                  | Pakrevd | Beskrivelse                                                                                                                                                                       |
| ------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`           | Ja      | URL-en til din OneUptime-instans (for eksempel `https://oneuptime.com` eller din selvhostede vert)                                                                                |
| `ONEUPTIME_SERVICE_TOKEN` | Ja      | Telemetry ingestion token fra _Prosjektinnstillinger → Telemetri og APM → Inntaksnøkler_                                                                                          |
| `DOCKER_HOST_NAME`        | Nei     | Vennlig navn for denne verten. Standardverdi er `docker-host`. Sett den til noe stabilt per vert (f.eks. `prod-docker-01`)                                                        |
| `DOCKER_API_VERSION`      | Nei     | Docker Engine API-versjonen agenten snakker. Standardverdi er `1.44`; senk den på verter med en eldre daemon, eller la den stå tom for å forhandle den automatisk (se Feilsoking) |

## Verifiser installasjonen

Sjekk at agenten kjorer:

```bash
docker ps --filter name=oneuptime-docker-agent
```

Sjekk agentloggene:

```bash
docker logs -f oneuptime-docker-agent
```

Se etter: `"Everything is ready. Begin running and processing data."`

I lopet av et minutt eller så skal verten vises i OneUptime-dashbordet med metrikker og logger som strommer inn.

## Oppgradere agenten

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# Kjor `docker run`-kommandoen ovenfor på nytt
```

Eller med Docker Compose:

```bash
docker compose pull
docker compose up -d
```

## Avinstallere agenten

```bash
docker rm -f oneuptime-docker-agent
```

Hvis du brukte Docker Compose:

```bash
docker compose down
```

## Hva som samles inn

| Kategori                | Data                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| **CPU-metrikker**       | Total bruk, bruksprosent, struping (throttling)-tid (per container) |
| **Minnemetrikker**      | Bruk, grense, prosent, RSS, cache (per container)                   |
| **Nettverksmetrikker**  | Byte og pakker mottatt / sendt (per container)                      |
| **Blokk-I/O-metrikker** | Lese-/skrive-byte og -operasjoner (per container)                   |
| **Containerinfo**       | Oppetid, antall omstarter, antall prosesser                         |
| **Containerlogger**     | stdout-/stderr-logger fra alle containere                           |

## Selvhostet OneUptime

Hvis du selvhoster OneUptime, sett `ONEUPTIME_URL` til din egen instans:

```bash
-e ONEUPTIME_URL="https://your-oneuptime-host.example.com"
```

Hvis instansen din kun er HTTP, bruk `http://` og riktig port.

## Feilsoking

### Docker Socket Permission Denied

Agentcontaineren må kjore som root (`--user 0:0`) for å få tilgang til `/var/run/docker.sock`. Sorg for at `--user 0:0`-flagget (eller `user: "0:0"` i Compose) er til stede.

### Agenten starter på nytt med "client version is too new"

```
Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41
```

En daemon avviser en klient som er nyere enn dens egen maksimumsversjon, så receiveren starter aldri, og collectoren avsluttes sammen med den. Sjekk daemonens maksimumsversjon og send den videre til agenten:

```bash
docker version --format '{{ .Server.APIVersion }}'
```

Legg deretter til `-e DOCKER_API_VERSION=1.41` (eller verdien du fikk) i `docker run`, eller sett `DOCKER_API_VERSION` i Compose. Nyere daemoner betjener fortsatt eldre API-versjoner, så innstillingen forblir gyldig etter en oppgradering.

Hvis du heller vil slippe å slå opp tallet, sett `DOCKER_API_VERSION` til den **tomme strengen**. Agenten ber da Docker-SDK-et om å forhandle versjonen med daemonen (én `HEAD /_ping`, deretter daemonens egen maksimumsversjon), noe som fungerer mot både gamle og nye daemoner:

```bash
docker run -d ... -e DOCKER_API_VERSION= ...
```

### Agenten vises som frakoblet

1. Sjekk at agenten kjorer: `docker ps --filter name=oneuptime-docker-agent`
2. Sjekk agentloggene: `docker logs oneuptime-docker-agent | grep -i error`
3. Verifiser at OneUptime-URL-en og service-token er riktige
4. Sorg for at Docker-verten din kan nå OneUptime-instansen over nettverket

### Ingen metrikker vises

1. Verifiser at Docker-socketen er tilgjengelig inne i agenten: `docker exec oneuptime-docker-agent ls -la /var/run/docker.sock`
2. Sjekk collector-loggene for eksportfeil: `docker logs oneuptime-docker-agent | tail -100`
3. Sorg for at service-token er gyldig og ikke utlopt

### Vertsnavnet vises som en container-ID

Sett miljovariabelen `DOCKER_HOST_NAME` til et vennlig navn og gjenopprett containeren.

## Neste steg

- Konfigurer **Docker-monitorer** for å varsle om CPU-/minne-/omstartstilstander for containere — se [Docker Monitor](/docs/monitor/docker-monitor).
- For Kubernetes-klynger i stedet for frittstående Docker-verter, bruk [OneUptime Kubernetes Agent](/docs/telemetry/kubernetes-agent).
- For ikke-containeriserte verter (Linux-/macOS-/Windows-VM-er og fysiske maskiner), bruk [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).

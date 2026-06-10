# OneUptime Docker Agent

## Oversigt

OneUptime Docker Agent er et færdigbygget container-image, der leveres med en finjusteret OpenTelemetry Collector-konfiguration. Kør den ved siden af dine eksisterende containere, så registrerer den automatisk alle containere på værten, indsamler CPU- / hukommelses- / netværks- / blok-I/O-metrikker plus container-logfiler og videresender alt til OneUptime via OTLP. Ét image, én kommando.

Denne side er **installationsvejledningen**. For konfiguration af Docker-monitorer og advarsler oven på de data, agenten indsamler, se [Docker Monitor](/docs/monitor/docker-monitor).

## Forudsætninger

- Docker Engine 20.10+
- Adgang til `/var/run/docker.sock` på værten
- Et **OneUptime Telemetry Ingestion Token** — opret et fra *Project Settings → Telemetry Ingestion Keys* og kopiér værdien

## Hurtig start (én kommando)

Erstat `YOUR_ONEUPTIME_URL`, `YOUR_TELEMETRY_INGESTION_TOKEN` og værtsnavnet med værdier for dit miljø. Værtsnavnet er, hvordan denne Docker-vært vil fremgå i OneUptime — vælg noget i stil med `prod-docker-01`.

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

Det er alt. Når agenten først har forbindelse, vil din Docker-vært automatisk fremgå i **Docker**-sektionen af OneUptime-dashboardet.

## Alternativ — Docker Compose

Hvis du foretrækker Docker Compose, så indsæt følgende i en `docker-compose.yml`:

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

## Miljøvariabler

| Variabel | Påkrævet | Beskrivelse |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Ja | URL'en til din OneUptime-instans (for eksempel `https://oneuptime.com` eller din selvhostede vært) |
| `ONEUPTIME_SERVICE_TOKEN` | Ja | Telemetry ingestion-token fra *Project Settings → Telemetry Ingestion Keys* |
| `DOCKER_HOST_NAME` | Nej | Brugervenligt navn til denne vært. Som standard `docker-host`. Sæt det til noget stabilt pr. vært (f.eks. `prod-docker-01`) |

## Verificér installationen

Tjek, at agenten kører:

```bash
docker ps --filter name=oneuptime-docker-agent
```

Tjek agentens logfiler:

```bash
docker logs -f oneuptime-docker-agent
```

Hold øje med: `"Everything is ready. Begin running and processing data."`

Inden for cirka et minut bør værten fremgå i OneUptime-dashboardet med metrikker og logfiler, der strømmer ind.

## Opgradering af agenten

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# Kør `docker run`-kommandoen ovenfor igen
```

Eller med Docker Compose:

```bash
docker compose pull
docker compose up -d
```

## Afinstallation af agenten

```bash
docker rm -f oneuptime-docker-agent
```

Hvis du brugte Docker Compose:

```bash
docker compose down
```

## Hvad indsamles der

| Kategori | Data |
|----------|------|
| **CPU-metrikker** | Forbrug i alt, forbrugsprocent, throttling-tid (pr. container) |
| **Hukommelsesmetrikker** | Forbrug, grænse, procent, RSS, cache (pr. container) |
| **Netværksmetrikker** | Modtagne / sendte bytes og pakker (pr. container) |
| **Blok-I/O-metrikker** | Læste / skrevne bytes og operationer (pr. container) |
| **Container-info** | Oppetid, antal genstarter, antal processer |
| **Container-logfiler** | stdout- / stderr-logfiler fra alle containere |

## Selvhostet OneUptime

Hvis du selvhoster OneUptime, så sæt `ONEUPTIME_URL` til din egen instans:

```bash
-e ONEUPTIME_URL="https://your-oneuptime-host.example.com"
```

Hvis din instans kun er HTTP, så brug `http://` og den korrekte port.

## Fejlfinding

### Docker Socket Permission Denied

Agent-containeren skal køre som root (`--user 0:0`) for at få adgang til `/var/run/docker.sock`. Sørg for, at flaget `--user 0:0` (eller `user: "0:0"` i Compose) er til stede.

### Agent vises som afbrudt

1. Tjek, at agenten kører: `docker ps --filter name=oneuptime-docker-agent`
2. Tjek agentens logfiler: `docker logs oneuptime-docker-agent | grep -i error`
3. Verificér, at din OneUptime-URL og service-token er korrekte
4. Sørg for, at din Docker-vært kan nå OneUptime-instansen over netværket

### Ingen metrikker fremgår

1. Verificér, at Docker-socket'en er tilgængelig inde i agenten: `docker exec oneuptime-docker-agent ls -la /var/run/docker.sock`
2. Tjek collector-logfilerne for eksportfejl: `docker logs oneuptime-docker-agent | tail -100`
3. Sørg for, at din service-token er gyldig og ikke er udløbet

### Værtsnavn vises som et container-ID

Sæt miljøvariablen `DOCKER_HOST_NAME` til et brugervenligt navn, og genskab containeren.

## Næste skridt

- Konfigurér **Docker Monitors** til at advare på betingelser for container-CPU / -hukommelse / -genstart — se [Docker Monitor](/docs/monitor/docker-monitor).
- For Kubernetes-clustre i stedet for selvstændige Docker-værter, brug [OneUptime Kubernetes Agent](/docs/telemetry/kubernetes-agent).
- For ikke-containeriserede værter (Linux / macOS / Windows VM'er og bare metal), brug [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).

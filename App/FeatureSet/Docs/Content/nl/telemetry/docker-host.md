# OneUptime Docker Agent

## Overzicht

De OneUptime Docker Agent is een kant-en-klare container-image die wordt geleverd met een afgestemde OpenTelemetry Collector-configuratie. Draai hem naast je bestaande containers en hij ontdekt automatisch elke container op de host, verzamelt CPU- / geheugen- / netwerk- / block-I/O-metrics plus containerlogs, en stuurt alles via OTLP door naar OneUptime. Eén image, één commando.

Deze pagina is de **installatiehandleiding**. Voor het configureren van Docker-monitors en -waarschuwingen bovenop de gegevens die de agent verzamelt, zie [Docker Monitor](/docs/monitor/docker-monitor).

## Vereisten

- Docker Engine 20.10+
- Toegang tot `/var/run/docker.sock` op de host
- Een **OneUptime Telemetry Ingestion Token** — maak er een aan via _Projectinstellingen → Telemetrie & APM → Ingestiesleutels_ en kopieer de waarde

## Snelstart (Eén commando)

Vervang `YOUR_ONEUPTIME_URL`, `YOUR_TELEMETRY_INGESTION_TOKEN` en de hostnaam door waarden voor jouw omgeving. De hostnaam is hoe deze Docker-host in OneUptime zal verschijnen — kies iets als `prod-docker-01`.

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

Dat is alles. Zodra de agent verbinding maakt, zal je Docker-host automatisch verschijnen in de **Docker**-sectie van het OneUptime-dashboard.

## Alternatief — Docker Compose

Als je de voorkeur geeft aan Docker Compose, plaats dan het volgende in een `docker-compose.yml`:

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

Start hem:

```bash
docker compose up -d
```

## Omgevingsvariabelen

| Variabele                 | Vereist | Beschrijving                                                                                                              |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`           | Ja      | De URL van je OneUptime-instantie (bijvoorbeeld `https://oneuptime.com` of je zelf-gehoste host)                          |
| `ONEUPTIME_SERVICE_TOKEN` | Ja      | Telemetry ingestion token uit _Projectinstellingen → Telemetrie & APM → Ingestiesleutels_                                            |
| `DOCKER_HOST_NAME`        | Nee     | Vriendelijke naam voor deze host. Standaard `docker-host`. Stel hem in op iets stabiels per host (bijv. `prod-docker-01`) |
| `DOCKER_API_VERSION`      | Nee     | De Docker Engine API-versie die de agent spreekt. Standaard `1.44`; verlaag hem op hosts met een oudere daemon, of laat hem leeg om automatisch te onderhandelen (zie Probleemoplossing) |

## De installatie verifiëren

Controleer of de agent draait:

```bash
docker ps --filter name=oneuptime-docker-agent
```

Bekijk de agent-logs:

```bash
docker logs -f oneuptime-docker-agent
```

Zoek naar: `"Everything is ready. Begin running and processing data."`

Binnen ongeveer een minuut zou de host in het OneUptime-dashboard moeten verschijnen, met metrics en logs die binnenstromen.

## De agent upgraden

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# Voer het `docker run`-commando hierboven opnieuw uit
```

Of met Docker Compose:

```bash
docker compose pull
docker compose up -d
```

## De agent verwijderen

```bash
docker rm -f oneuptime-docker-agent
```

Als je Docker Compose hebt gebruikt:

```bash
docker compose down
```

## Wat wordt er verzameld

| Categorie               | Gegevens                                                            |
| ----------------------- | ------------------------------------------------------------------- |
| **CPU-metrics**         | Totaal gebruik, gebruikspercentage, throttling-tijd (per container) |
| **Geheugen-metrics**    | Gebruik, limiet, percentage, RSS, cache (per container)             |
| **Netwerk-metrics**     | Ontvangen / verzonden bytes en packets (per container)              |
| **Block-I/O-metrics**   | Gelezen / geschreven bytes en bewerkingen (per container)           |
| **Containerinformatie** | Uptime, aantal herstarts, aantal processen                          |
| **Containerlogboeken**  | stdout- / stderr-logs van alle containers                           |

## Zelf-gehoste OneUptime

Als je OneUptime zelf host, stel `ONEUPTIME_URL` dan in op je eigen instantie:

```bash
-e ONEUPTIME_URL="https://your-oneuptime-host.example.com"
```

Als je instantie alleen HTTP gebruikt, gebruik dan `http://` en de juiste poort.

## Probleemoplossing

### Toegang tot Docker-socket geweigerd

De agent-container moet als root draaien (`--user 0:0`) om toegang te krijgen tot `/var/run/docker.sock`. Zorg ervoor dat de vlag `--user 0:0` (of `user: "0:0"` in Compose) aanwezig is.

### Agent herstart met "client version is too new"

```
Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41
```

Een daemon weigert een client die nieuwer is dan zijn eigen maximum, waardoor de receiver
nooit start en de collector er samen mee afsluit. Controleer het maximum van de daemon en
geef dat door aan de agent:

```bash
docker version --format '{{ .Server.APIVersion }}'
```

Voeg vervolgens `-e DOCKER_API_VERSION=1.41` (of de waarde die je hebt gekregen) toe aan
`docker run`, of stel `DOCKER_API_VERSION` in in Compose. Nieuwere daemons bedienen nog
steeds oudere API-versies, dus de instelling blijft geldig na een upgrade.

Als je het nummer liever niet opzoekt, stel `DOCKER_API_VERSION` dan in op de **lege
string**. De agent vraagt de Docker SDK dan om de versie met de daemon te onderhandelen
(één `HEAD /_ping`, daarna het eigen maximum van de daemon), wat werkt met zowel oude als
nieuwe daemons:

```bash
docker run -d ... -e DOCKER_API_VERSION= ...
```

### Agent wordt weergegeven als losgekoppeld

1. Controleer of de agent draait: `docker ps --filter name=oneuptime-docker-agent`
2. Bekijk de agent-logs: `docker logs oneuptime-docker-agent | grep -i error`
3. Verifieer dat je OneUptime-URL en service token correct zijn
4. Zorg ervoor dat je Docker-host de OneUptime-instantie via het netwerk kan bereiken

### Er verschijnen geen metrics

1. Verifieer dat de Docker-socket toegankelijk is binnen de agent: `docker exec oneuptime-docker-agent ls -la /var/run/docker.sock`
2. Bekijk de collector-logs op exportfouten: `docker logs oneuptime-docker-agent | tail -100`
3. Zorg ervoor dat je service token geldig is en niet verlopen

### Hostnaam wordt weergegeven als een container-ID

Stel de omgevingsvariabele `DOCKER_HOST_NAME` in op een vriendelijke naam en maak de container opnieuw aan.

## Volgende stappen

- Configureer **Docker Monitors** om te waarschuwen bij container-CPU- / geheugen- / herstart-condities — zie [Docker Monitor](/docs/monitor/docker-monitor).
- Voor Kubernetes-clusters in plaats van zelfstandige Docker-hosts, gebruik de [OneUptime Kubernetes Agent](/docs/telemetry/kubernetes-agent).
- Voor niet-gecontaineriseerde hosts (Linux- / macOS- / Windows-VM's en bare metal), gebruik de [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).

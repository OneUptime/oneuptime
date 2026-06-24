# Docker-monitor

Docker-overvåking lar deg overvåke helse og ytelse for Docker-vertene dine og containerne som kjører på dem. OneUptime samler inn metrikker og container-logger via en forhåndskonfigurert OpenTelemetry Collector (den **OneUptime Docker-agenten**) og evaluerer dem mot dine konfigurerte kriterier.

## Oversikt

Docker-monitorer bruker metrikker og logger fra vertene dine for å gi synlighet inn i container-arbeidsmengdene. Dette gjør det mulig å:

- Overvåke Docker-vert og per-container helse
- Spore CPU, minne, nettverk, blokk-I/U og prosessteller på tvers av containere
- Oppdage container-omstarter, krasj og CPU-struping
- Strømme strukturerte container-logger i det opprinnelige OpenTelemetry-formatet
- Varsle ved høy CPU, høyt minne, omstart-løkker og mer

## Opprette en Docker-monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **Docker** som monitortype
4. Velg Docker-verten og ressursomfanget som skal overvåkes
5. Konfigurer metrikk-spørringer og aggregering
6. Konfigurer overvåkingskriterier etter behov

## Konfigurasjonsalternativer

### Docker-vert

Velg Docker-verten som skal overvåkes. Verter registreres automatisk første gang OneUptime Docker-agenten sender telemetri fra dem – du trenger ikke opprette dem manuelt.

### Ressursomfang

Velg nivået det skal overvåkes på:

| Omfang    | Beskrivelse                                                        |
| --------- | ------------------------------------------------------------------ |
| Host      | Overvåke hele Docker-verten, aggregert på tvers av alle containere |
| Container | Overvåke en spesifikk container etter navn eller bilde             |

### Metrikk-spørringer

Konfigurer én eller flere metrikk-spørringer som skal evalueres. Hver spørring angir:

- **Metrikknavnet** – Container-metrikken som skal spørres
- **Aggregering** – Hvordan metrikkverdier skal aggregeres (Avg, Sum, Max, Min)
- **Filtre** – Ytterligere attributtbasert filtrering (f.eks. etter containernavn, bilde eller vert)
- **Grupper etter** – Valgfritt grupper etter `resource.container.name` slik at hver container evalueres uavhengig

Du kan også opprette **formler** som kombinerer flere metrikk-spørringer ved hjelp av matematiske uttrykk.

### Rullende tidsvindu

Velg tidsvinduet for metrikkevealuering:

- Siste 1 minutt
- Siste 5 minutter
- Siste 10 minutter
- Siste 15 minutter
- Siste 30 minutter
- Siste 60 minutter

## Innsamlede metrikker

Docker-agenten bruker OpenTelemetry `docker_stats`-mottakeren, som henter Docker Engine API med et konfigurerbart intervall (standard hvert 30. sekund).

### CPU

| Metrikk                                           | Beskrivelse                            |
| ------------------------------------------------- | -------------------------------------- |
| `container.cpu.utilization`                       | CPU-utnyttelse som prosent av vert-CPU |
| `container.cpu.usage.total`                       | Kumulativ CPU-tid brukt av containeren |
| `container.cpu.throttling_data.throttled_time`    | Tid containeren ble struet av cgroups  |
| `container.cpu.throttling_data.throttled_periods` | Antall struingsperioder                |

### Minne

| Metrikk                        | Beskrivelse                         |
| ------------------------------ | ----------------------------------- |
| `container.memory.usage.total` | Gjeldende minneforbruk i byte       |
| `container.memory.usage.limit` | Minnegrense i byte                  |
| `container.memory.percent`     | Minneforbruk som prosent av grensen |

### Nettverk

| Metrikk                               | Beskrivelse                 |
| ------------------------------------- | --------------------------- |
| `container.network.io.usage.rx_bytes` | Totalt antall mottatte byte |
| `container.network.io.usage.tx_bytes` | Totalt antall sendte byte   |

### Blokk-I/U

| Metrikk                                              | Beskrivelse                   |
| ---------------------------------------------------- | ----------------------------- |
| `container.blockio.io_service_bytes_recursive.read`  | Byte lest fra blokkenheter    |
| `container.blockio.io_service_bytes_recursive.write` | Byte skrevet til blokkenheter |

### Container-informasjon

| Metrikk                | Beskrivelse                                   |
| ---------------------- | --------------------------------------------- |
| `container.uptime`     | Container-oppetid i sekunder                  |
| `container.restarts`   | Antall ganger containeren har startet på nytt |
| `container.pids.count` | Antall prosesser inne i containeren           |

## Overvåkingskriterier

### Tilgjengelige kontrolltyper

| Kontrolltype | Beskrivelse                                                   |
| ------------ | ------------------------------------------------------------- |
| Metric Value | Verdien av den konfigurerte metrikk-spørringen eller formelen |

### Aggregeringstyper

| Aggregering   | Beskrivelse                             |
| ------------- | --------------------------------------- |
| Average       | Gjennomsnittlig verdi over tidsvinduet  |
| Sum           | Sum av alle verdier                     |
| Maximum Value | Høyeste verdi i tidsvinduet             |
| Minimum Value | Laveste verdi i tidsvinduet             |
| All Values    | Alle verdier må samsvare med kriteriene |
| Any Value     | Minst én verdi må samsvare              |

### Filtertyper

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Forhåndsbygde varslingsmaler

OneUptime tilbyr maler for vanlige Docker-overvåkingsscenarier:

| Mal                    | Beskrivelse                          | Terskel | Aggregering         |
| ---------------------- | ------------------------------------ | ------- | ------------------- |
| High Container CPU     | CPU-utnyttelse per container         | > 90 %  | Max (per container) |
| High Container Memory  | Minneforbruk som prosent av grensen  | > 85 %  | Max (per container) |
| High CPU Throttling    | CPU-struede perioder                 | > 0     | Max (per container) |
| Container Restart Loop | Antall container-omstarter           | > 3     | Sum                 |
| Container Down         | Container-oppetid tilbakestilt til 0 | = 0     | Min                 |

> Merk: CPU-, minne- og struingsmaler bruker **Max**-aggregering gruppert etter `resource.container.name`. Dette forhindrer at signalet fra en enkelt overbelastet container fortynnes av mange inaktive containere på samme vert.

## Innsamlede logger

I tillegg til metrikker haler Docker-agenten alle containerens `*-json.log`-filer via OpenTelemetry filelog-mottakeren og sender loggposter i det opprinnelige OTLP-loggformatet. Hver loggpost berikes med:

- `resource.host.name` – Docker-vert-identifikatoren
- `resource.container.id` – den fullstendige container-ID-en
- `resource.container.runtime` – alltid `docker`
- `attributes["log.iostream"]` – `stdout` eller `stderr`
- `severityText` / `severityNumber` – utledet fra strømmen: `stderr` → `ERROR`, `stdout` → `INFO`
- `body` – den rå logglinjen sendt av containerprosessen
- `time` – Docker-daemonens tidsstempel for linjen

Logger vises på Docker-vertens **Logs**-fane og på hver containers detaljside.

### Krav til loggdriver

**Docker-agenten henter bare logger fra containere som bruker Dockers `json-file`-loggdriver.** Dette er Dockers standard, men det kan overstyres per container eller globalt:

- **`local`**-driver – skriver binære protobuf-deler til `/var/lib/docker/containers/<id>/local-logs/container.log`. Filelog-mottakeren kan ikke analysere dette formatet.
- **`journald`**, **`syslog`**, **`fluentd`**, **`gelf`**, **`awslogs`**, **`splunk`**, osv. – sender logger til et eksternt mål; ingen fil å hale.
- **`none`** – forkaster logger helt.

Hvis noen av de ovennevnte er i bruk, vil du se metrikker på Docker-vertsiden, men **Logs**-fanen vil være tom (eller bare inneholde Docker-agentens egne logger).

**Sjekk en spesifikk containers loggdriver:**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**Sjekk daemonstandarden:**

```bash
docker info --format '{{.LoggingDriver}}'
```

**Bytt en Docker Compose-tjeneste til `json-file` med fornuftig rotering:**

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

**Bytt daemonstandarden** (gjelder for alle containere som opprettes etterpå) ved å redigere `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Start deretter Docker-daemonen på nytt og **gjenopprett** de berørte containerne. Docker binder loggdriveren ved container-opprettingstidspunktet, så en eksisterende container beholder sin gamle driver til den fjernes og gjenopprettes:

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# Vanlig docker
docker rm -f <container>
docker run ... <image>
```

## Krav til oppsett

For å bruke Docker-overvåking må du:

1. Installere OneUptime Docker-agenten på hver Docker-vert du ønsker å overvåke
2. Angi `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` og `DOCKER_HOST_NAME` som miljøvariabler
3. Sørge for at containerne du ønsker å observere bruker `json-file`-loggdriveren (se ovenfor)

Agenten publiseres som `oneuptime/docker-agent:release` på Docker Hub. Se [installasjonsguiden for Docker-agenten](https://github.com/OneUptime/oneuptime/tree/master/DockerAgent) for fullstendige eksempler med `docker run` og `docker compose`.

## Feilsøking

### Metrikker vises, men Logs-fanen er tom

Containerne dine bruker nesten helt sikkert ikke `json-file`-loggdriveren. Kjør diagnostikkkommandoene i avsnittet [Krav til loggdriver](#krav-til-loggdriver) ovenfor og bytt de containerne som trenger loggene sine sendt.

### Filelog-mottakeren logger `no files match the configured criteria`

Dette betyr at include-globen `/var/lib/docker/containers/*/*-json.log` ikke matchet noen filer da agenten startet. Enten:

1. Ingen container på denne verten bruker `json-file`, eller
2. Bind-monteringen `-v /var/lib/docker/containers:/var/lib/docker/containers:ro` mangler eller peker på en tom katalog, eller
3. Agenten kjører på Docker Desktop for macOS uten at Linux-VMens containerkatalog er eksponert.

### Logger kommer frem, men er gruppert under feil vertsnavn

OneUptime registrerer automatisk Docker-verter etter `resource.host.name`, som hentes fra `DOCKER_HOST_NAME`-miljøvariabelen. Å endre `DOCKER_HOST_NAME` etter den første telemetribatchen vil opprette en ny vertrad i stedet for å gi den eksisterende nytt navn.

### Hendelser utløses ikke for "High CPU"

Forsikre deg om at metrikk-spørringens aggregering er **Max** (ikke Avg) og at den grupperer etter `resource.container.name`. Et gjennomsnitt på tvers av alle containere på en travel vert fortynnes av inaktive containere og krysser sjelden terskelen.

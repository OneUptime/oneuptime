# Docker Monitor

Docker-overvågning giver dig mulighed for at overvåge sundheden og ydeevnen for dine Docker-hosts og de containere, der kører på dem. OneUptime indsamler metrikker og containerlogs via en forudkonfigureret OpenTelemetry Collector (**OneUptime Docker Agent**) og evaluerer dem mod dine konfigurerede kriterier.

## Oversigt

Docker-monitorer bruger metrikker og logs fra dine hosts til at give indsigt i dine container-arbejdsbelastninger. Dette giver dig mulighed for at:

- Overvåge Docker-host- og per-container-sundhed
- Spore CPU, hukommelse, netværk, blok-I/O og procesantal på tværs af containere
- Opdage containergenstart, -nedbrud og CPU-begrænsning
- Streame strukturerede containerlogs i det native OpenTelemetry-format
- Advare om høj CPU, høj hukommelse, genstartssløjfer og mere

## Oprettelse af en Docker Monitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Docker** som monitortype
4. Vælg Docker-host og ressourceomfang der skal overvåges
5. Konfigurer metriske forespørgsler og aggregering
6. Konfigurer overvågningskriterier efter behov

## Konfigurationsindstillinger

### Docker-host

Vælg den Docker-host, der skal overvåges. Hosts registreres automatisk første gang OneUptime Docker Agent sender telemetri fra dem – du behøver ikke oprette dem manuelt.

### Ressourceomfang

Vælg det niveau, som ressourcer skal overvåges på:

| Omfang | Beskrivelse |
|-------|-------------|
| Host | Overvåg hele Docker-hosten, aggregeret på tværs af alle containere |
| Container | Overvåg en specifik container efter navn eller billede |

### Metriske forespørgsler

Konfigurer én eller flere metriske forespørgsler til evaluering. Hver forespørgsel specificerer:

- **Metrisk navn** – Den container-metrik, der skal forespørges
- **Aggregering** – Sådan aggregeres metriske værdier (Gns., Sum, Maks., Min.)
- **Filtre** – Yderligere attributbaseret filtrering (f.eks. efter containernavn, billede eller host)
- **Grupper efter** – Valgfrit gruppering efter `resource.container.name`, så hver container evalueres uafhængigt

Du kan også oprette **formler**, der kombinerer flere metriske forespørgsler ved hjælp af matematiske udtryk.

### Rullende tidsvindue

Vælg tidsvinduet for metrisk evaluering:

- Seneste 1 minut
- Seneste 5 minutter
- Seneste 10 minutter
- Seneste 15 minutter
- Seneste 30 minutter
- Seneste 60 minutter

## Indsamlede metrikker

Docker Agent bruger OpenTelemetry `docker_stats`-modtageren, som skraber Docker Engine API med et konfigurerbart interval (standard hvert 30. sekund).

### CPU

| Metrik | Beskrivelse |
|--------|-------------|
| `container.cpu.utilization` | CPU-udnyttelse som en procentdel af host-CPU'en |
| `container.cpu.usage.total` | Kumulativ CPU-tid forbrugt af containeren |
| `container.cpu.throttling_data.throttled_time` | Tid, containeren var begrænset af cgroups |
| `container.cpu.throttling_data.throttled_periods` | Antal begrænsningsperioder |

### Hukommelse

| Metrik | Beskrivelse |
|--------|-------------|
| `container.memory.usage.total` | Aktuel hukommelsesanvendelse i bytes |
| `container.memory.usage.limit` | Hukommelsesgrænse i bytes |
| `container.memory.percent` | Hukommelsesanvendelse som en procentdel af grænsen |

### Netværk

| Metrik | Beskrivelse |
|--------|-------------|
| `container.network.io.usage.rx_bytes` | Samlede bytes modtaget |
| `container.network.io.usage.tx_bytes` | Samlede bytes transmitteret |

### Blok-I/O

| Metrik | Beskrivelse |
|--------|-------------|
| `container.blockio.io_service_bytes_recursive.read` | Bytes læst fra blokenheder |
| `container.blockio.io_service_bytes_recursive.write` | Bytes skrevet til blokenheder |

### Containerinfo

| Metrik | Beskrivelse |
|--------|-------------|
| `container.uptime` | Container-oppetid i sekunder |
| `container.restarts` | Antal gange containeren er genstartet |
| `container.pids.count` | Antal processer inde i containeren |

## Overvågningskriterier

### Tilgængelige kontroltyper

| Kontroltype | Beskrivelse |
|------------|-------------|
| Metrisk værdi | Værdien af den konfigurerede metriske forespørgsel eller formel |

### Aggregeringstyper

| Aggregering | Beskrivelse |
|-------------|-------------|
| Gennemsnit | Gennemsnitsværdi over tidsvinduet |
| Sum | Sum af alle værdier |
| Maksimumsværdi | Højeste værdi i tidsvinduet |
| Minimumsværdi | Laveste værdi i tidsvinduet |
| Alle værdier | Alle værdier skal opfylde kriterierne |
| Enhver værdi | Mindst én værdi skal opfylde kriterierne |

### Filtertyper

- **Større end**, **Mindre end**, **Større end eller lig med**, **Mindre end eller lig med**, **Lig med**, **Ikke lig med**

## Færdigbyggede advarsels-skabeloner

OneUptime leverer skabeloner til almindelige Docker-overvågningsscenarier:

| Skabelon | Beskrivelse | Grænseværdi | Aggregering |
|----------|-------------|-----------|-------------|
| Høj container-CPU | CPU-udnyttelse pr. container | > 90% | Maks. (pr. container) |
| Høj container-hukommelse | Hukommelsesanvendelse som procent af grænsen | > 85% | Maks. (pr. container) |
| Høj CPU-begrænsning | Antal begrænsede CPU-perioder | > 0 | Maks. (pr. container) |
| Container-genstartssløjfe | Antal containergenstart | > 3 | Sum |
| Container nede | Container-oppetid nulstillet til 0 | = 0 | Min. |

> Bemærk: CPU-, hukommelses- og begrænsningsskabeloner bruger **Maks.**-aggregering grupperet efter `resource.container.name`. Dette forhindrer, at en enkelt varm containers signal fortyndes af mange inaktive containere på den samme host.

## Indsamlede logs

Udover metrikker skraber Docker Agent alle containeres `*-json.log`-filer via OpenTelemetry filelog-modtageren og sender logposter i det native OTLP-logformat. Hver logpost er beriget med:

- `resource.host.name` – Docker-hostidentifikatoren
- `resource.container.id` – Det fulde container-ID
- `resource.container.runtime` – altid `docker`
- `attributes["log.iostream"]` – `stdout` eller `stderr`
- `severityText` / `severityNumber` – Afledt fra strømmen: `stderr` → `ERROR`, `stdout` → `INFO`
- `body` – Den rå loglinje udsendt af containerprocessen
- `time` – Docker-dæmonens tidsstempel for linjen

Logs vises på Docker-hostens **Logs**-fane og på hver containers detaljeside.

### Logdriver-krav

**Docker Agent indsamler kun logs fra containere, der bruger Dockers `json-file`-logdriver.** Dette er Dockers standard, men det kan tilsidesættes pr. container eller globalt:

- **`local`**-driver – Skriver binære protobuf-chunks til `/var/lib/docker/containers/<id>/local-logs/container.log`. Filelog-modtageren kan ikke parse dette format.
- **`journald`**, **`syslog`**, **`fluentd`**, **`gelf`**, **`awslogs`**, **`splunk`** osv. – Sender logs til en fjern destination; ingen fil at skrabe.
- **`none`** – Kasserer logs fuldstændigt.

Hvis nogen af ovenstående er i brug, vil du se metrikker på Docker-hostsiden, men **Logs**-fanen vil være tom (eller kun indeholde Docker Agents egne logs).

**Kontroller en specifik containers logdriver:**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**Kontroller dæmonstandarden:**

```bash
docker info --format '{{.LoggingDriver}}'
```

**Skift en Docker Compose-tjeneste til `json-file` med fornuftig rotation:**

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

**Skift dæmonstandarden** (gælder for alle containere oprettet efterfølgende) ved at redigere `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Genstart derefter Docker-dæmonen og **genopret** de berørte containere. Docker binder logdriveren ved containeroprettelsestidspunktet, så en eksisterende container beholder sin gamle driver, indtil den fjernes og genoprettes:

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# Alm. docker
docker rm -f <container>
docker run ... <image>
```

## Opsætningskrav

For at bruge Docker-overvågning skal du:

1. Installere OneUptime Docker Agent på hver Docker-host, du vil overvåge
2. Sende `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` og `DOCKER_HOST_NAME` som miljøvariabler
3. Sørge for, at de containere, du vil observere, bruger `json-file`-logdriveren (se ovenfor)

Agenten publiceres som `oneuptime/docker-agent:release` på Docker Hub. Se [Docker Agent-installationsvejledningen](https://github.com/OneUptime/oneuptime/tree/master/DockerAgent) for de fulde `docker run`- og `docker compose`-eksempler.

## Fejlfinding

### Metrikker vises, men Logs-fanen er tom

Dine containere bruger næsten helt sikkert ikke `json-file`-logdriveren. Kør de diagnostiske kommandoer i afsnittet [Logdriver-krav](#logdriver-krav) ovenfor og skift eventuelle containere, der har behov for at få deres logs sendt.

### Filelog-modtager logger `no files match the configured criteria`

Det betyder, at include-glob'en `/var/lib/docker/containers/*/*-json.log` ikke matchede nogen filer, da agenten startede. Enten:

1. Ingen container på denne host bruger `json-file`, eller
2. Bind-mount'en `-v /var/lib/docker/containers:/var/lib/docker/containers:ro` mangler eller peger på en tom mappe, eller
3. Agenten kører på Docker Desktop til macOS uden Linux VM's containermappe eksponeret.

### Logs ankommer men er grupperet under det forkerte hostnavn

OneUptime registrerer automatisk Docker-hosts via `resource.host.name`, som hentes fra `DOCKER_HOST_NAME`-miljøvariablen. Ændring af `DOCKER_HOST_NAME` efter den første telemetribatch vil oprette en anden host-række frem for at omdøbe den eksisterende.

### Incidents udløses ikke for "Høj CPU"

Sørg for, at metrisk forespørgselens aggregering er **Maks.** (ikke Gns.) og at den grupperer efter `resource.container.name`. Et gennemsnit på tværs af alle containere på en optaget host er fortyndet af inaktive containere og overskrider sjældent grænseværdien.

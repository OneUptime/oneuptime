# Docker-monitor

Docker-övervakning gör det möjligt att övervaka hälsan och prestandan hos dina Docker-värdar och de containers som körs på dem. OneUptime samlar in mätvärden och containerloggar via en förkonfigurerad OpenTelemetry Collector (**OneUptime Docker Agent**) och utvärderar dem mot dina konfigurerade kriterier.

## Översikt

Docker-monitorer använder mätvärden och loggar från dina värdar för att ge insyn i dina containerarbetsbelastningar. Detta gör det möjligt att:

- Övervaka Docker-värd och per-containerhälsa
- Spåra CPU, minne, nätverk, block-I/O och processantal för containers
- Identifiera containeromstarter, krascher och CPU-begränsning
- Strömma strukturerade containerloggar i ursprungligt OpenTelemetry-format
- Varna om hög CPU, högt minne, omstartsloops och mer

## Skapa en Docker-monitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Docker** som monitortyp
4. Välj Docker-värden och resursomfånget att övervaka
5. Konfigurera mätvärdesförfrågningar och aggregering
6. Konfigurera övervakningskriterier efter behov

## Konfigurationsalternativ

### Docker-värd

Välj Docker-värden att övervaka. Värdar registreras automatiskt första gången OneUptime Docker Agent skickar telemetri från dem – du behöver inte skapa dem manuellt.

### Resursomfång

Välj nivån att övervaka resurser på:

| Omfång    | Beskrivning                                                 |
| --------- | ----------------------------------------------------------- |
| Värd      | Övervaka hela Docker-värden, aggregerat för alla containers |
| Container | Övervaka en specifik container efter namn eller bild        |

### Mätvärdesförfrågningar

Konfigurera en eller flera mätvärdesförfrågningar att utvärdera. Varje förfrågan anger:

- **Mätvärdets namn** – Det containermätvärde att fråga
- **Aggregering** – Hur man aggregerar mätvärden (Medel, Summa, Max, Min)
- **Filter** – Ytterligare attributbaserad filtrering (t.ex. efter containernamn, bild eller värd)
- **Gruppera efter** – Valfritt gruppering efter `resource.container.name` så att varje container utvärderas oberoende

Du kan också skapa **formler** som kombinerar flera mätvärdesförfrågningar med matematiska uttryck.

### Rullande tidsfönster

Välj tidsfönstret för mätvärdesutvärdering:

- Senaste 1 minuten
- Senaste 5 minuterna
- Senaste 10 minuterna
- Senaste 15 minuterna
- Senaste 30 minuterna
- Senaste 60 minuterna

## Insamlade mätvärden

Docker Agent använder OpenTelemetry `docker_stats`-mottagaren som läser Docker Engine API med konfigurerbart intervall (standard var 30:e sekund).

### CPU

| Mätvärde                                          | Beskrivning                                    |
| ------------------------------------------------- | ---------------------------------------------- |
| `container.cpu.utilization`                       | CPU-utnyttjande som procentandel av värd-CPU   |
| `container.cpu.usage.total`                       | Kumulativ CPU-tid som konsumeras av containern |
| `container.cpu.throttling_data.throttled_time`    | Tid som containern begränsades av cgroups      |
| `container.cpu.throttling_data.throttled_periods` | Antal begränsningsperioder                     |

### Minne

| Mätvärde                       | Beskrivning                                  |
| ------------------------------ | -------------------------------------------- |
| `container.memory.usage.total` | Aktuell minnesanvändning i bytes             |
| `container.memory.usage.limit` | Minnesgräns i bytes                          |
| `container.memory.percent`     | Minnesanvändning som procentandel av gränsen |

### Nätverk

| Mätvärde                              | Beskrivning           |
| ------------------------------------- | --------------------- |
| `container.network.io.usage.rx_bytes` | Totalt mottagna bytes |
| `container.network.io.usage.tx_bytes` | Totalt skickade bytes |

### Block-I/O

| Mätvärde                                             | Beskrivning                     |
| ---------------------------------------------------- | ------------------------------- |
| `container.blockio.io_service_bytes_recursive.read`  | Bytes lästa från blockenheter   |
| `container.blockio.io_service_bytes_recursive.write` | Bytes skrivna till blockenheter |

### Containerinformation

| Mätvärde               | Beskrivning                             |
| ---------------------- | --------------------------------------- |
| `container.uptime`     | Containerns drifttid i sekunder         |
| `container.restarts`   | Antal gånger containern har startats om |
| `container.pids.count` | Antal processer inuti containern        |

## Övervakningskriterier

### Tillgängliga kontrolltyper

| Kontrolltyp | Beskrivning                                                  |
| ----------- | ------------------------------------------------------------ |
| Mätvärde    | Värdet av den konfigurerade mätvärdesförfrågan eller formeln |

### Aggregeringstyper

| Aggregering    | Beskrivning                          |
| -------------- | ------------------------------------ |
| Medelvärde     | Medelvärde under tidsfönstret        |
| Summa          | Summan av alla värden                |
| Maxvärde       | Högsta värdet i tidsfönstret         |
| Minvärde       | Lägsta värdet i tidsfönstret         |
| Alla värden    | Alla värden måste matcha kriterierna |
| Valfritt värde | Minst ett värde måste matcha         |

### Filtertyper

- **Större än**, **Mindre än**, **Större än eller lika med**, **Mindre än eller lika med**, **Lika med**, **Inte lika med**

## Förbyggda varningsmallar

OneUptime tillhandahåller mallar för vanliga Docker-övervakningsscenarier:

| Mall                  | Beskrivning                                  | Tröskel | Aggregering         |
| --------------------- | -------------------------------------------- | ------- | ------------------- |
| Hög container-CPU     | CPU-utnyttjande per container                | > 90%   | Max (per container) |
| Högt containerminne   | Minnesanvändning som procentandel av gränsen | > 85%   | Max (per container) |
| Hög CPU-begränsning   | Begränsade CPU-perioder                      | > 0     | Max (per container) |
| Containeromstartsloop | Antal containeromstarter                     | > 3     | Summa               |
| Container nere        | Containerns drifttid återställd till 0       | = 0     | Min                 |

> Observera: CPU-, minnes- och begränsningsmallarna använder **Max**-aggregering grupperad efter `resource.container.name`. Detta förhindrar att en enstaka het containers signal späs ut av många overksamma containers på samma värd.

## Insamlade loggar

Utöver mätvärden läser Docker Agent varje containers `*-json.log`-fil via OpenTelemetry filelog-mottagaren och skickar loggposter i ursprungligt OTLP-loggformat. Varje loggpost berikas med:

- `resource.host.name` – Docker-värd-identifieraren
- `resource.container.id` – Fullständigt container-ID
- `resource.container.runtime` – Alltid `docker`
- `attributes["log.iostream"]` – `stdout` eller `stderr`
- `severityText` / `severityNumber` – Härledd från strömmen: `stderr` → `ERROR`, `stdout` → `INFO`
- `body` – Den råa loggraden som containerprocessen skickade ut
- `time` – Docker-daemonens tidsstämpel för raden

Loggar visas på Docker-värdens **Loggar**-flik och på varje containers detaljsida.

### Krav på loggdrivrutin

**Docker Agent läser bara in loggar från containers som använder Dockers `json-file`-loggdrivrutin.** Detta är Dockers standard, men det kan åsidosättas per container eller globalt:

- **`local`**-drivrutin – skriver binära protobuf-chunks till `/var/lib/docker/containers/<id>/local-logs/container.log`. Filelog-mottagaren kan inte tolka detta format.
- **`journald`**, **`syslog`**, **`fluentd`**, **`gelf`**, **`awslogs`**, **`splunk`** etc. – skickar loggar till ett fjärrmål; ingen fil att läsa.
- **`none`** – kastar bort loggar helt.

Om något av ovanstående används ser du mätvärden på Docker-värdsidan men **Loggar**-fliken är tom (eller innehåller bara Docker Agents egna loggar).

**Kontrollera en specifik containers loggdrivrutin:**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**Kontrollera daemonens standard:**

```bash
docker info --format '{{.LoggingDriver}}'
```

**Byt en Docker Compose-tjänst till `json-file` med rimlig rotation:**

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

**Byt daemonens standard** (gäller varje container som skapas därefter) genom att redigera `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Starta sedan om Docker-daemonen och **återskapa** de berörda containrarna. Docker binder loggdrivrutinen vid containerskapande, så en befintlig container behåller sin gamla drivrutin tills den tas bort och återskapas:

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# Vanlig docker
docker rm -f <container>
docker run ... <image>
```

## Konfigurationskrav

För att använda Docker-övervakning behöver du:

1. Installera OneUptime Docker Agent på varje Docker-värd du vill övervaka
2. Skicka `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` och `DOCKER_HOST_NAME` som miljövariabler
3. Se till att de containers du vill observera använder `json-file`-loggdrivrutinen (se ovan)

Agenten publiceras som `oneuptime/docker-agent:release` på Docker Hub. Se [installationsguiden för Docker Agent](https://github.com/OneUptime/oneuptime/tree/master/DockerAgent) för fullständiga `docker run`- och `docker compose`-exempel.

## Felsökning

### Mätvärden visas men fliken Loggar är tom

Dina containers använder troligen inte `json-file`-loggdrivrutinen. Kör diagnoskommandona i avsnittet [Krav på loggdrivrutin](#krav-på-loggdrivrutin) ovan och byt ut containers som behöver sina loggar skickade.

### Filelog-mottagaren loggar `no files match the configured criteria`

Detta innebär att include-globen `/var/lib/docker/containers/*/*-json.log` inte matchade några filer när agenten startade. Antingen:

1. Ingen container på den här värden använder `json-file`, eller
2. Bindmontageringen `-v /var/lib/docker/containers:/var/lib/docker/containers:ro` saknas eller pekar på en tom katalog, eller
3. Agenten körs på Docker Desktop för macOS utan Linux VM:ens containerkatalog exponerad.

### Loggar anländer men grupperas under fel värdnamn

OneUptime registrerar automatiskt Docker-värdar efter `resource.host.name`, som tas från `DOCKER_HOST_NAME`-miljövariabeln. Att ändra `DOCKER_HOST_NAME` efter den första telemetribatchen skapar en ny värdrad istället för att byta namn på den befintliga.

### Incidenter utlöses inte för "Hög CPU"

Se till att mätvärdesförfrågans aggregering är **Max** (inte Medel) och att den grupperar efter `resource.container.name`. Ett medelvärde för alla containers på en aktiv värd späds ut av overksamma containers och överstiger sällan tröskeln.

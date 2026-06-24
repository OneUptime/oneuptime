# Docker Monitor

Docker-monitoring stelt u in staat de gezondheid en prestaties van uw Docker-hosts en de daarop draaiende containers te bewaken. OneUptime verzamelt metrics en containerlogboeken via een vooraf geconfigureerde OpenTelemetry Collector (de **OneUptime Docker Agent**) en evalueert deze aan de hand van uw geconfigureerde criteria.

## Overzicht

Docker-monitors gebruiken metrics en logboeken van uw hosts om inzicht te bieden in uw containerworkloads. Hiermee kunt u:

- Gezondheid van Docker-host en per container bewaken
- CPU, geheugen, netwerk, blok-I/O en procestelling per container bijhouden
- Container-herstarts, crashes en CPU-beperking detecteren
- Gestructureerde containerlogboeken streamen in het native OpenTelemetry-formaat
- Meldingen ontvangen bij hoge CPU, hoog geheugen, herstart-lussen en meer

## Een Docker Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **Docker** als het monitortype
4. Selecteer de te bewaken Docker-host en resourcebereik
5. Configureer metriekopvragen en aggregatie
6. Configureer monitoringcriteria naar wens

## Configuratie-opties

### Docker-host

Selecteer de te bewaken Docker-host. Hosts worden automatisch geregistreerd de eerste keer dat de OneUptime Docker Agent telemetrie van hen verstuurt — u hoeft ze niet handmatig aan te maken.

### Resourcebereik

Kies het niveau waarop u resources wilt bewaken:

| Bereik    | Beschrijving                                                     |
| --------- | ---------------------------------------------------------------- |
| Host      | De gehele Docker-host bewaken, geaggregeerd over alle containers |
| Container | Een specifieke container bewaken op naam of afbeelding           |

### Metriekopvragen

Configureer een of meer metriekopvragen om te evalueren. Elke opvraag specificeert:

- **Metrieknaam** — De te bevragen container-metriek
- **Aggregatie** — Hoe metriekwaarden te aggregeren (Gem, Som, Max, Min)
- **Filters** — Aanvullende attribuutgebaseerde filtering (bijv. op containernaam, afbeelding of host)
- **Groeperen op** — Optioneel groeperen op `resource.container.name` zodat elke container onafhankelijk wordt geëvalueerd

U kunt ook **formules** maken die meerdere metriekopvragen combineren met wiskundige expressies.

### Voortschrijdend tijdvenster

Selecteer het tijdvenster voor metriekverhoogde evaluatie:

- Afgelopen 1 minuut
- Afgelopen 5 minuten
- Afgelopen 10 minuten
- Afgelopen 15 minuten
- Afgelopen 30 minuten
- Afgelopen 60 minuten

## Verzamelde metrics

De Docker Agent gebruikt de OpenTelemetry `docker_stats`-ontvanger, die de Docker Engine API bevraagt met een configureerbaar interval (standaard elke 30 seconden).

### CPU

| Metriek                                           | Beschrijving                                     |
| ------------------------------------------------- | ------------------------------------------------ |
| `container.cpu.utilization`                       | CPU-gebruik als percentage van de host-CPU       |
| `container.cpu.usage.total`                       | Cumulatieve CPU-tijd verbruikt door de container |
| `container.cpu.throttling_data.throttled_time`    | Tijd dat de container werd beperkt door cgroups  |
| `container.cpu.throttling_data.throttled_periods` | Aantal beperkingsperioden                        |

### Geheugen

| Metriek                        | Beschrijving                                 |
| ------------------------------ | -------------------------------------------- |
| `container.memory.usage.total` | Huidig geheugengebruik in bytes              |
| `container.memory.usage.limit` | Geheugenlimiet in bytes                      |
| `container.memory.percent`     | Geheugengebruik als percentage van de limiet |

### Netwerk

| Metriek                               | Beschrijving           |
| ------------------------------------- | ---------------------- |
| `container.network.io.usage.rx_bytes` | Totaal ontvangen bytes |
| `container.network.io.usage.tx_bytes` | Totaal verzonden bytes |

### Blok-I/O

| Metriek                                              | Beschrijving                        |
| ---------------------------------------------------- | ----------------------------------- |
| `container.blockio.io_service_bytes_recursive.read`  | Bytes gelezen van blokapparaten     |
| `container.blockio.io_service_bytes_recursive.write` | Bytes geschreven naar blokapparaten |

### Containerinfo

| Metriek                | Beschrijving                              |
| ---------------------- | ----------------------------------------- |
| `container.uptime`     | Container-uptime in seconden              |
| `container.restarts`   | Aantal keren dat de container is herstart |
| `container.pids.count` | Aantal processen in de container          |

## Monitoringcriteria

### Beschikbare controletypen

| Controletype  | Beschrijving                                               |
| ------------- | ---------------------------------------------------------- |
| Metriekwaarde | De waarde van de geconfigureerde metriekopvraag of formule |

### Aggregatietypen

| Aggregatie    | Beschrijving                                |
| ------------- | ------------------------------------------- |
| Gemiddelde    | Gemiddelde waarde over het tijdvenster      |
| Som           | Som van alle waarden                        |
| Maximumwaarde | Hoogste waarde in het tijdvenster           |
| Minimumwaarde | Laagste waarde in het tijdvenster           |
| Alle waarden  | Alle waarden moeten voldoen aan de criteria |
| Elke waarde   | Ten minste één waarde moet voldoen          |

### Filtertypen

- **Groter dan**, **Kleiner dan**, **Groter dan of gelijk aan**, **Kleiner dan of gelijk aan**, **Gelijk aan**, **Niet gelijk aan**

## Voorgebouwde meldingssjablonen

OneUptime biedt sjablonen voor veelgebruikte Docker-monitoringscenario's:

| Sjabloon               | Beschrijving                              | Drempelwaarde | Aggregatie          |
| ---------------------- | ----------------------------------------- | ------------- | ------------------- |
| Hoog container-CPU     | CPU-gebruik per container                 | > 90%         | Max (per container) |
| Hoog containergeheugen | Geheugengebruik als percentage van limiet | > 85%         | Max (per container) |
| Hoge CPU-beperking     | Beperkte CPU-perioden                     | > 0           | Max (per container) |
| Container-herstart-lus | Aantal container-herstarts                | > 3           | Som                 |
| Container neer         | Container-uptime gereset naar 0           | = 0           | Min                 |

> Opmerking: CPU-, geheugen- en beperkingssjablonen gebruiken **Max**-aggregatie gegroepeerd op `resource.container.name`. Dit voorkomt dat het signaal van één drukke container wordt verdund door veel inactieve containers op dezelfde host.

## Verzamelde logboeken

Naast metrics volgt de Docker Agent elk containerbestand `*-json.log` via de OpenTelemetry filelog-ontvanger en verstuurt logrecords in het native OTLP-logformaat. Elk logrecord wordt verrijkt met:

- `resource.host.name` — de Docker-hostidentificator
- `resource.container.id` — het volledige container-ID
- `resource.container.runtime` — altijd `docker`
- `attributes["log.iostream"]` — `stdout` of `stderr`
- `severityText` / `severityNumber` — afgeleid van de stream: `stderr` → `ERROR`, `stdout` → `INFO`
- `body` — de ruwe logregel die door het containerproces wordt uitgestoten
- `time` — de tijdstempel van de Docker-daemon voor de regel

Logboeken verschijnen op het tabblad **Logboeken** van de Docker-host en op de detailpagina van elke container.

### Vereiste voor logstuurprogramma

**De Docker Agent verwerkt alleen logboeken van containers die het `json-file`-logstuurprogramma van Docker gebruiken.** Dit is de standaard van Docker, maar het kan per container of globaal worden overschreven:

- **`local`**-stuurprogramma — schrijft binaire protobuf-chunks naar `/var/lib/docker/containers/<id>/local-logs/container.log`. De filelog-ontvanger kan dit formaat niet verwerken.
- **`journald`**, **`syslog`**, **`fluentd`**, **`gelf`**, **`awslogs`**, **`splunk`**, enz. — sturen logboeken naar een externe bestemming; geen bestand om te volgen.
- **`none`** — gooit logboeken volledig weg.

Als een van de bovenstaande in gebruik is, ziet u wel metrics op de Docker-hostpagina, maar is het tabblad **Logboeken** leeg (of bevat alleen de eigen logboeken van de Docker Agent).

**Controleer het logstuurprogramma van een specifieke container:**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**Controleer de daemon-standaard:**

```bash
docker info --format '{{.LoggingDriver}}'
```

**Schakel een Docker Compose-service over naar `json-file` met verstandige rotatie:**

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

**Schakel de daemon-standaard over** (geldt voor elke daarna aangemaakte container) door `/etc/docker/daemon.json` te bewerken:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Herstart vervolgens de Docker-daemon en **maak** de betreffende containers **opnieuw aan**. Docker koppelt het logstuurprogramma bij het aanmaken van de container, zodat een bestaande container zijn oude stuurprogramma behoudt totdat het wordt verwijderd en opnieuw gemaakt:

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# Gewone docker
docker rm -f <container>
docker run ... <image>
```

## Installatievereisten

Voor Docker-monitoring moet u:

1. De OneUptime Docker Agent installeren op elke Docker-host die u wilt bewaken
2. `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` en `DOCKER_HOST_NAME` doorgeven als omgevingsvariabelen
3. Ervoor zorgen dat de te observeren containers het `json-file`-logstuurprogramma gebruiken (zie hierboven)

De agent wordt gepubliceerd als `oneuptime/docker-agent:release` op Docker Hub. Zie de [Docker Agent-installatiegids](https://github.com/OneUptime/oneuptime/tree/master/DockerAgent) voor de volledige `docker run`- en `docker compose`-voorbeelden.

## Probleemoplossing

### Metrics verschijnen maar het tabblad Logboeken is leeg

Uw containers gebruiken hoogstwaarschijnlijk niet het `json-file`-logstuurprogramma. Voer de diagnostische opdrachten uit in de sectie [Vereiste voor logstuurprogramma](#vereiste-voor-logstuurprogramma) hierboven en schakel eventuele containers over die hun logboeken moeten verzenden.

### Filelog-ontvanger logt `no files match the configured criteria`

Dit betekent dat de include-glob `/var/lib/docker/containers/*/*-json.log` geen bestanden matchte toen de agent startte. Ofwel:

1. Geen container op deze host gebruikt `json-file`, of
2. De bind-mount `-v /var/lib/docker/containers:/var/lib/docker/containers:ro` ontbreekt of wijst naar een lege map, of
3. De agent draait op Docker Desktop voor macOS zonder de containermap van de Linux VM blootgesteld.

### Logboeken komen aan maar zijn gegroepeerd onder de verkeerde hostnaam

OneUptime registreert Docker-hosts automatisch op `resource.host.name`, afkomstig van de omgevingsvariabele `DOCKER_HOST_NAME`. Als u `DOCKER_HOST_NAME` na de eerste telemetrielevering wijzigt, wordt een tweede hostrij aangemaakt in plaats van de bestaande te hernoemen.

### Er worden geen incidenten geactiveerd voor "Hoog CPU"

Zorg dat de aggregatie van de metriekopvraag **Max** is (niet Gem) en dat deze groepeert op `resource.container.name`. Een Gem over alle containers op een drukke host wordt verdund door inactieve containers en overschrijdt zelden de drempelwaarde.

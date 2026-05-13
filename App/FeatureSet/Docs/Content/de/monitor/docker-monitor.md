# Docker-Monitor

Der Docker-Monitor ermöglicht die Überwachung der Gesundheit und Leistung Ihrer Docker-Hosts und der darauf laufenden Container. OneUptime erfasst Metriken und Container-Logs über einen vorkonfigurierten OpenTelemetry Collector (den **OneUptime Docker Agent**) und wertet sie anhand Ihrer konfigurierten Kriterien aus.

## Übersicht

Docker-Monitore verwenden Metriken und Logs von Ihren Hosts, um Einblick in Ihre Container-Workloads zu ermöglichen. Dies erlaubt Ihnen:

- Docker-Host- und container-übergreifende Gesundheit überwachen
- CPU, Arbeitsspeicher, Netzwerk, Block-I/O und Prozessanzahl über Container hinweg verfolgen
- Container-Neustarts, Abstürze und CPU-Drosselung erkennen
- Strukturierte Container-Logs im nativen OpenTelemetry-Format streamen
- Benachrichtigungen bei hoher CPU, hohem Arbeitsspeicher, Neustart-Schleifen und mehr

## Einen Docker-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Docker** als Monitortyp
4. Wählen Sie den Docker-Host und den Ressourcenbereich zur Überwachung aus
5. Konfigurieren Sie Metrikabfragen und Aggregation
6. Konfigurieren Sie bei Bedarf Überwachungskriterien

## Konfigurationsoptionen

### Docker-Host

Wählen Sie den zu überwachenden Docker-Host. Hosts werden beim ersten Mal automatisch registriert, wenn der OneUptime Docker Agent Telemetrie von ihnen sendet – Sie müssen sie nicht manuell erstellen.

### Ressourcenbereich

Wählen Sie die Ebene, auf der Ressourcen überwacht werden sollen:

| Bereich | Beschreibung |
|-------|-------------|
| Host | Den gesamten Docker-Host überwachen, aggregiert über alle Container |
| Container | Einen bestimmten Container nach Name oder Image überwachen |

### Metrikabfragen

Konfigurieren Sie eine oder mehrere Metrikabfragen zur Auswertung. Jede Abfrage gibt an:

- **Metrikname** — Die abzufragende Container-Metrik
- **Aggregation** — Wie Metrikwerte aggregiert werden sollen (Durchschnitt, Summe, Maximum, Minimum)
- **Filter** — Zusätzliche attributbasierte Filterung (z. B. nach Container-Name, Image oder Host)
- **Gruppieren nach** — Optional nach `resource.container.name` gruppieren, sodass jeder Container unabhängig ausgewertet wird

Sie können auch **Formeln** erstellen, die mehrere Metrikabfragen mit mathematischen Ausdrücken kombinieren.

### Gleitendes Zeitfenster

Wählen Sie das Zeitfenster für die Metrikauswertung:

- Letzte 1 Minute
- Letzte 5 Minuten
- Letzte 10 Minuten
- Letzte 15 Minuten
- Letzte 30 Minuten
- Letzte 60 Minuten

## Erfasste Metriken

Der Docker Agent verwendet den OpenTelemetry `docker_stats`-Receiver, der die Docker Engine API in einem konfigurierbaren Intervall (Standard alle 30 Sekunden) abfragt.

### CPU

| Metrik | Beschreibung |
|--------|-------------|
| `container.cpu.utilization` | CPU-Auslastung als Prozentsatz der Host-CPU |
| `container.cpu.usage.total` | Kumulierte vom Container verbrauchte CPU-Zeit |
| `container.cpu.throttling_data.throttled_time` | Zeit, in der der Container von cgroups gedrosselt wurde |
| `container.cpu.throttling_data.throttled_periods` | Anzahl der Drosselungsperioden |

### Arbeitsspeicher

| Metrik | Beschreibung |
|--------|-------------|
| `container.memory.usage.total` | Aktuelle Arbeitsspeichernutzung in Bytes |
| `container.memory.usage.limit` | Arbeitsspeicherlimit in Bytes |
| `container.memory.percent` | Arbeitsspeichernutzung als Prozentsatz des Limits |

### Netzwerk

| Metrik | Beschreibung |
|--------|-------------|
| `container.network.io.usage.rx_bytes` | Gesamt empfangene Bytes |
| `container.network.io.usage.tx_bytes` | Gesamt gesendete Bytes |

### Block-I/O

| Metrik | Beschreibung |
|--------|-------------|
| `container.blockio.io_service_bytes_recursive.read` | Von Blockgeräten gelesene Bytes |
| `container.blockio.io_service_bytes_recursive.write` | Auf Blockgeräte geschriebene Bytes |

### Container-Info

| Metrik | Beschreibung |
|--------|-------------|
| `container.uptime` | Container-Betriebszeit in Sekunden |
| `container.restarts` | Anzahl der Container-Neustarts |
| `container.pids.count` | Anzahl der Prozesse im Container |

## Überwachungskriterien

### Verfügbare Prüftypen

| Prüftyp | Beschreibung |
|------------|-------------|
| Metrikwert | Der Wert der konfigurierten Metrikabfrage oder Formel |

### Aggregationstypen

| Aggregation | Beschreibung |
|-------------|-------------|
| Durchschnitt | Durchschnittswert über das Zeitfenster |
| Summe | Summe aller Werte |
| Maximalwert | Höchster Wert im Zeitfenster |
| Minimalwert | Niedrigster Wert im Zeitfenster |
| Alle Werte | Alle Werte müssen den Kriterien entsprechen |
| Beliebiger Wert | Mindestens ein Wert muss übereinstimmen |

### Filtertypen

- **Größer als**, **Kleiner als**, **Größer oder gleich**, **Kleiner oder gleich**, **Gleich**, **Ungleich**

## Vorgefertigte Benachrichtigungsvorlagen

OneUptime stellt Vorlagen für häufige Docker-Überwachungsszenarien bereit:

| Vorlage | Beschreibung | Schwellenwert | Aggregation |
|----------|-------------|-----------|-------------|
| Hohe Container-CPU | CPU-Auslastung pro Container | > 90% | Max (pro Container) |
| Hoher Container-Arbeitsspeicher | Arbeitsspeichernutzung als Prozentsatz des Limits | > 85% | Max (pro Container) |
| Hohe CPU-Drosselung | Gedrosselte CPU-Perioden | > 0 | Max (pro Container) |
| Container-Neustart-Schleife | Container-Neustartanzahl | > 3 | Summe |
| Container ausgefallen | Container-Betriebszeit zurückgesetzt auf 0 | = 0 | Min |

> Hinweis: CPU-, Arbeitsspeicher- und Drosselungsvorlagen verwenden **Max**-Aggregation, gruppiert nach `resource.container.name`. Dies verhindert, dass das Signal eines einzelnen überlasteten Containers durch viele inaktive Container auf demselben Host verwässert wird.

## Erfasste Logs

Zusätzlich zu Metriken liest der Docker Agent die `*-json.log`-Datei jedes Containers über den OpenTelemetry filelog-Receiver und sendet Log-Einträge im nativen OTLP-Log-Format. Jeder Log-Eintrag wird angereichert mit:

- `resource.host.name` — der Docker-Host-Bezeichner
- `resource.container.id` — die vollständige Container-ID
- `resource.container.runtime` — immer `docker`
- `attributes["log.iostream"]` — `stdout` oder `stderr`
- `severityText` / `severityNumber` — abgeleitet aus dem Stream: `stderr` → `ERROR`, `stdout` → `INFO`
- `body` — die rohe vom Container-Prozess ausgegebene Log-Zeile
- `time` — der Zeitstempel des Docker-Daemons für die Zeile

Logs erscheinen auf dem **Logs**-Tab des Docker-Hosts und auf der Detailseite jedes Containers.

### Log-Treiber-Anforderung

**Der Docker Agent erfasst nur Logs von Containern, die Dockers `json-file`-Log-Treiber verwenden.** Dies ist Dockers Standard, kann aber pro Container oder global überschrieben werden.

**Prüfen Sie den Log-Treiber eines bestimmten Containers:**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**Prüfen Sie den Daemon-Standard:**

```bash
docker info --format '{{.LoggingDriver}}'
```

**Wechseln Sie einen Docker Compose-Dienst zu `json-file` mit sinnvoller Rotation:**

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

**Wechseln Sie den Daemon-Standard** (gilt für alle danach erstellten Container) durch Bearbeitung von `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Starten Sie dann den Docker-Daemon neu und **erstellen** Sie die betroffenen Container **neu**:

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# Einfaches docker
docker rm -f <container>
docker run ... <image>
```

## Setup-Anforderungen

Um Docker-Monitoring zu verwenden, müssen Sie:

1. Den OneUptime Docker Agent auf jedem Docker-Host installieren, den Sie überwachen möchten
2. `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` und `DOCKER_HOST_NAME` als Umgebungsvariablen übergeben
3. Sicherstellen, dass die zu beobachtenden Container den `json-file`-Log-Treiber verwenden (siehe oben)

Der Agent wird als `oneuptime/docker-agent:release` auf Docker Hub veröffentlicht.

## Fehlerbehebung

### Metriken werden angezeigt, aber der Logs-Tab ist leer

Ihre Container verwenden höchstwahrscheinlich nicht den `json-file`-Log-Treiber. Führen Sie die Diagnosebefehle im Abschnitt [Log-Treiber-Anforderung](#log-treiber-anforderung) aus.

### Filelog-Receiver protokolliert „no files match the configured criteria"

Das Glob `/var/lib/docker/containers/*/*-json.log` hat beim Start des Agents keine Dateien gefunden. Entweder:

1. Kein Container auf diesem Host verwendet `json-file`, oder
2. Das Bind-Mount `-v /var/lib/docker/containers:/var/lib/docker/containers:ro` fehlt, oder
3. Der Agent läuft auf Docker Desktop für macOS ohne das Container-Verzeichnis der Linux-VM.

### Incidents werden für „Hohe CPU" nicht ausgelöst

Stellen Sie sicher, dass die Aggregation der Metrikabfrage **Max** ist (nicht Durchschnitt) und dass sie nach `resource.container.name` gruppiert. Ein Durchschnitt über alle Container auf einem ausgelasteten Host wird durch inaktive Container verwässert.

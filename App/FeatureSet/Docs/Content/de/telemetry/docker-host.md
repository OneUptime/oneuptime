# OneUptime Docker Agent

## Überblick

Der OneUptime Docker Agent ist ein vorgefertigtes Container-Image, das mit einer abgestimmten OpenTelemetry-Collector-Konfiguration ausgeliefert wird. Führen Sie ihn neben Ihren bestehenden Containern aus, und er erkennt automatisch jeden Container auf dem Host, sammelt CPU-/Arbeitsspeicher-/Netzwerk-/Block-I/O-Metriken sowie Container-Logs und leitet alles über OTLP an OneUptime weiter. Ein Image, ein Befehl.

Diese Seite ist die **Installationsanleitung**. Informationen zum Konfigurieren von Docker-Monitoren und Benachrichtigungen auf Basis der vom Agent gesammelten Daten finden Sie unter [Docker Monitor](/docs/monitor/docker-monitor).

## Voraussetzungen

- Docker Engine 20.10+
- Zugriff auf `/var/run/docker.sock` auf dem Host
- Ein **OneUptime Telemetry Ingestion Token** — erstellen Sie eines unter *Project Settings → Telemetry Ingestion Keys* und kopieren Sie den Wert

## Schnellstart (Ein Befehl)

Ersetzen Sie `YOUR_ONEUPTIME_URL`, `YOUR_TELEMETRY_INGESTION_TOKEN` und den Hostnamen durch die Werte für Ihre Umgebung. Der Hostname ist die Bezeichnung, unter der dieser Docker-Host in OneUptime erscheint — wählen Sie etwas wie `prod-docker-01`.

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

Das war's. Sobald der Agent eine Verbindung hergestellt hat, erscheint Ihr Docker-Host automatisch im Bereich **Docker** des OneUptime-Dashboards.

## Alternative — Docker Compose

Wenn Sie Docker Compose bevorzugen, fügen Sie Folgendes in eine `docker-compose.yml` ein:

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

Starten Sie ihn:

```bash
docker compose up -d
```

## Umgebungsvariablen

| Variable | Erforderlich | Beschreibung |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Ja | Die URL Ihrer OneUptime-Instanz (zum Beispiel `https://oneuptime.com` oder Ihr selbst gehosteter Host) |
| `ONEUPTIME_SERVICE_TOKEN` | Ja | Telemetry Ingestion Token aus *Project Settings → Telemetry Ingestion Keys* |
| `DOCKER_HOST_NAME` | Nein | Sprechender Name für diesen Host. Standardwert ist `docker-host`. Setzen Sie ihn pro Host auf einen stabilen Wert (z. B. `prod-docker-01`) |

## Installation überprüfen

Prüfen Sie, ob der Agent läuft:

```bash
docker ps --filter name=oneuptime-docker-agent
```

Prüfen Sie die Agent-Logs:

```bash
docker logs -f oneuptime-docker-agent
```

Achten Sie auf: `"Everything is ready. Begin running and processing data."`

Innerhalb von etwa einer Minute sollte der Host im OneUptime-Dashboard erscheinen, wobei Metriken und Logs einfließen.

## Agent aktualisieren

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# Führen Sie den obigen `docker run`-Befehl erneut aus
```

Oder mit Docker Compose:

```bash
docker compose pull
docker compose up -d
```

## Agent deinstallieren

```bash
docker rm -f oneuptime-docker-agent
```

Wenn Sie Docker Compose verwendet haben:

```bash
docker compose down
```

## Was gesammelt wird

| Kategorie | Daten |
|----------|------|
| **CPU-Metriken** | Nutzung gesamt, Nutzung in Prozent, Throttling-Zeit (pro Container) |
| **Arbeitsspeicher-Metriken** | Nutzung, Limit, Prozentsatz, RSS, Cache (pro Container) |
| **Netzwerk-Metriken** | Empfangene/gesendete Bytes und Pakete (pro Container) |
| **Block-I/O-Metriken** | Gelesene/geschriebene Bytes und Operationen (pro Container) |
| **Container-Informationen** | Uptime, Anzahl der Neustarts, Anzahl der Prozesse |
| **Container-Logs** | stdout-/stderr-Logs von allen Containern |

## Selbst gehostetes OneUptime

Wenn Sie OneUptime selbst hosten, setzen Sie `ONEUPTIME_URL` auf Ihre eigene Instanz:

```bash
-e ONEUPTIME_URL="https://your-oneuptime-host.example.com"
```

Wenn Ihre Instanz nur HTTP unterstützt, verwenden Sie `http://` und den entsprechenden Port.

## Fehlerbehebung

### Zugriff auf Docker-Socket verweigert

Der Agent-Container muss als root (`--user 0:0`) ausgeführt werden, um auf `/var/run/docker.sock` zugreifen zu können. Stellen Sie sicher, dass das Flag `--user 0:0` (oder `user: "0:0"` in Compose) vorhanden ist.

### Agent wird als getrennt angezeigt

1. Prüfen Sie, ob der Agent läuft: `docker ps --filter name=oneuptime-docker-agent`
2. Prüfen Sie die Agent-Logs: `docker logs oneuptime-docker-agent | grep -i error`
3. Überprüfen Sie, ob Ihre OneUptime-URL und Ihr Service-Token korrekt sind
4. Stellen Sie sicher, dass Ihr Docker-Host die OneUptime-Instanz über das Netzwerk erreichen kann

### Keine Metriken werden angezeigt

1. Überprüfen Sie, ob der Docker-Socket innerhalb des Agents zugänglich ist: `docker exec oneuptime-docker-agent ls -la /var/run/docker.sock`
2. Prüfen Sie die Collector-Logs auf Export-Fehler: `docker logs oneuptime-docker-agent | tail -100`
3. Stellen Sie sicher, dass Ihr Service-Token gültig und nicht abgelaufen ist

### Hostname wird als Container-ID angezeigt

Setzen Sie die Umgebungsvariable `DOCKER_HOST_NAME` auf einen sprechenden Namen und erstellen Sie den Container neu.

## Nächste Schritte

- Konfigurieren Sie **Docker Monitors**, um bei Bedingungen für Container-CPU/-Arbeitsspeicher/-Neustarts zu benachrichtigen — siehe [Docker Monitor](/docs/monitor/docker-monitor).
- Für Kubernetes-Cluster anstelle eigenständiger Docker-Hosts verwenden Sie den [OneUptime Kubernetes Agent](/docs/telemetry/kubernetes-agent).
- Für nicht containerisierte Hosts (Linux-/macOS-/Windows-VMs und Bare Metal) verwenden Sie den [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).

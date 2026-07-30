## Benutzerdefinierte Probes einrichten

Sie können benutzerdefinierte Probes in Ihrem Netzwerk einrichten, um Ressourcen in Ihrem privaten Netzwerk oder Ressourcen hinter Ihrer Firewall zu überwachen.

Um zu beginnen, müssen Sie eine benutzerdefinierte Probe in Ihren Projekteinstellungen > Probe erstellen. Sobald Sie die benutzerdefinierte Probe im OneUptime-Dashboard erstellt haben, sollten Sie die `PROBE_ID` und den `PROBE_KEY` haben.

### Probe bereitstellen

#### Docker

Um eine Probe auszuführen, stellen Sie sicher, dass Docker installiert ist. Sie können eine benutzerdefinierte Probe folgendermaßen ausführen:

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Wenn Sie OneUptime selbst hosten, können Sie `ONEUPTIME_URL` auf Ihre benutzerdefinierte selbst gehostete Instanz ändern.

##### Proxy-Konfiguration

Wenn Ihre Probe einen Proxy-Server verwenden muss, um OneUptime oder externe Ressourcen zu erreichen, können Sie Proxy-Einstellungen über diese Umgebungsvariablen konfigurieren:

```
# Für HTTP-Proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Für HTTPS-Proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Mit Proxy-Authentifizierung
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```

#### Docker Compose

Sie können die Probe auch mit docker-compose ausführen. Erstellen Sie eine `docker-compose.yml`-Datei mit folgendem Inhalt:

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

##### Mit Proxy-Konfiguration

Wenn Sie einen Proxy-Server verwenden müssen, können Sie Proxy-Umgebungsvariablen hinzufügen:

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      # Proxy-Konfiguration (optional)
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

Führen Sie dann den folgenden Befehl aus:

```
docker compose up -d
```

#### Kubernetes

Sie können die Probe auch mit Kubernetes ausführen. Erstellen Sie eine `oneuptime-probe.yaml`-Datei mit folgendem Inhalt:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

Führen Sie dann den folgenden Befehl aus:

```bash
kubectl apply -f oneuptime-probe.yaml
```

### Umgebungsvariablen

Die Probe unterstützt die folgenden Umgebungsvariablen:

#### Erforderliche Variablen

- `PROBE_KEY` - Der Probe-Schlüssel aus Ihrem OneUptime-Dashboard
- `PROBE_ID` - Die Probe-ID aus Ihrem OneUptime-Dashboard
- `ONEUPTIME_URL` - Die URL Ihrer OneUptime-Instanz (Standard: https://oneuptime.com)

#### Optionale Variablen

- `HTTP_PROXY_URL` - HTTP-Proxy-Server-URL für HTTP-Anfragen
- `HTTPS_PROXY_URL` - HTTP-Proxy-Server-URL für HTTPS-Anfragen
- `NO_PROXY` - Kommagetrennte Hosts oder Domains, die den Proxy umgehen sollen
- `PROBE_NAME` - Benutzerdefinierter Name für die Probe
- `PROBE_DESCRIPTION` - Beschreibung für die Probe
- `PROBE_MONITORING_WORKERS` - Anzahl der Überwachungs-Worker (Standard: 1)
- `PROBE_MONITOR_FETCH_LIMIT` - Anzahl der gleichzeitig abzurufenden Monitore (Standard: 10)
- `PROBE_MONITOR_RETRY_LIMIT` - Anzahl der Wiederholungsversuche für fehlgeschlagene Monitore (Standard: 3)
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` - Timeout für synthetische Monitor-Skripte in Millisekunden (Standard: 60000)
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` - Timeout für benutzerdefinierte Code-Monitor-Skripte in Millisekunden (Standard: 60000)
- `PROBE_API_REQUEST_TIMEOUT_IN_MS` - Zeitlimit für jede Anfrage, die die Probe an OneUptime sendet (Standard: 45000)
- `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` - Warnung protokollieren für Anfragen an OneUptime, die langsamer als dieser Wert sind (Standard: 10000)

### Verifizieren

Wenn die Probe erfolgreich läuft, sollte sie in Ihrem OneUptime-Dashboard als `Connected` angezeigt werden. Falls sie nicht als verbunden angezeigt wird, müssen Sie die Container-Logs prüfen. Wenn Sie weiterhin Probleme haben, erstellen Sie bitte ein Issue auf [GitHub](https://github.com/oneuptime/oneuptime) oder [kontaktieren Sie den Support](https://oneuptime.com/support)

### Eine getrennte Probe diagnostizieren

Eine Probe wird als `Disconnected` gekennzeichnet, wenn ihre Anfragen an OneUptime nicht mehr erfolgreich sind. Das Log der Probe gibt an, wo jede fehlgeschlagene Anfrage hängen geblieben ist, sodass Sie nur selten raten müssen.

**1. Lesen Sie den beim Start ausgegebenen Umgebungsblock.** Jede Probe gibt beim Start einen JSON-Block aus, der die verwendete OneUptime-URL, ihr Anfrage-Zeitlimit, ihre Proxy-Einstellungen, die geerbten DNS-Resolver, die Node-/OS-Version und die Information enthält, ob die TLS-Überprüfung deaktiviert wurde. Fügen Sie diesen Block jeder Problemmeldung bei.

**2. Suchen Sie den Fehlerbericht.** Jede fehlgeschlagene Anfrage an OneUptime protokolliert einen Block mit `stalledAt` und `whatThisMeans`. `stalledAt` ist die Phase, über die die Anfrage nie hinausgekommen ist:

| `stalledAt` | Bedeutung |
| --- | --- |
| `SocketAssignment` | Nichts hat den Rechner verlassen. Der Socket-Pool war ausgelastet, oder ein konfigurierter Proxy hat seinen CONNECT-Tunnel nie fertiggestellt. |
| `TcpConnect` | Der Rechner hat ein SYN gesendet und nichts zurückerhalten – eine Firewall oder Security-Appliance verwirft Pakete, oder der Host ist nicht erreichbar. |
| `TlsHandshake` | TCP wurde verbunden, TLS wurde nie abgeschlossen. Meist eine TLS-inspizierende Middlebox. |
| `RequestSend` | Verbunden, aber die Anfrage wurde nie vollständig geschrieben – die Gegenstelle hat aufgehört zu lesen. |
| `WaitingForServerResponse` | Die Anfrage wurde zugestellt und der Server hat nichts zurückgesendet. **Das Netzwerk der Probe ist in Ordnung** – prüfen Sie den OneUptime-Server, seinen Load Balancer und seinen Reverse Proxy. |
| `ResponseBody` | Der Server hat begonnen zu antworten und ist mittendrin stehen geblieben. |

Derselbe Block meldet außerdem `deadlineOverrunInMs`. Wenn ein Zeitlimit von 45000 ms deutlich länger als 45000 ms Echtzeit gedauert hat, war der Probe-Prozess selbst blockiert – prüfen Sie `probeProcess.eventLoopMaxDriftInMs` in diesem Block, bevor Sie das Netzwerk untersuchen.

**3. Lesen Sie den Konnektivitäts-Selbsttest.** Nach drei aufeinanderfolgenden Fehlschlägen testet die Probe denselben Server Schicht für Schicht – zuerst DNS, dann TCP, dann TLS, dann einen echten HTTP-Roundtrip – und protokolliert jede Stufe mit ihren Zeiten. Die erste Stufe, die fehlschlägt, ist Ihre Antwort. Wenn ein Proxy konfiguriert ist, testet die Probe den Hop zum Proxy, denn das ist der einzige Hop, den sie tatsächlich durchführt.

**4. Achten Sie auf langsame Anfragen, bevor sie zu Fehlern werden.** Anfragen, die zwar erfolgreich sind, aber länger als `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` dauern, werden mit ihrer Dauer protokolliert. Eine Probe, die anfängt, 20 Sekunden lange Anfragen zu protokollieren, ist auf dem besten Weg, das Zeitlimit von 45 Sekunden zu überschreiten.

Auf der OneUptime-Serverseite wird eine Probe-Anfrage, die langsam beantwortet wird – oder die die Probe abgebrochen hat, bevor eine Antwort gesendet wurde – ebenfalls dort protokolliert, zusammen mit der ID der Probe. Diese beiden Logs zusammen zeigen Ihnen, auf welcher Seite der Verbindung das Problem liegt.

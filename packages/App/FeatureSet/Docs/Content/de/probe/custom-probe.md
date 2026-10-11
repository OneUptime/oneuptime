# Benutzerdefinierte Probes

Eine benutzerdefinierte Sonde ist ein kleiner Agent, den Sie in Ihrem eigenen Netzwerk betreiben. Sie prüft die Monitore, denen Sie sie hinzufügen, etwa interne Websites, APIs und Server hinter Ihrer Firewall, und sendet die Ergebnisse an OneUptime. Sie baut nur ausgehende Verbindungen über HTTPS auf, sodass in Ihrem Netzwerk nichts Verbindungen aus dem Internet annehmen muss.

:::cards
- [So funktioniert es](#so-funktioniert-es): Was die Sonde tut und woran OneUptime erkennt, dass sie läuft.
- [Eine Sonde installieren](#eine-sonde-installieren): In OneUptime anlegen, mit Docker, Docker Compose oder Kubernetes starten und Monitoren hinzufügen.
- [Umgebungsvariablen](#umgebungsvariablen): Jede Einstellung, die die Sonde liest, mit ihrem Standardwert.
- [Eine getrennte Sonde untersuchen](#eine-getrennte-sonde-untersuchen): Herausfinden, wo die Anfragen der Sonde an OneUptime hängen bleiben.
:::

## So funktioniert es

```mermaid title="Was eine benutzerdefinierte Sonde tut"
sequenceDiagram
    participant P as Benutzerdefinierte Sonde
    participant O as OneUptime
    P->>O: Ich laufe<br/>(jede Minute)
    P->>O: Welche meiner Monitore<br/>sind fällig?
    O-->>P: Die zu prüfenden Monitore
    Note over P: Prüft jeden einzelnen<br/>in Ihrem Netzwerk
    P->>O: Die Ergebnisse senden
    Note over O: Aktualisiert den Status,<br/>öffnet Vorfälle oder Alarme
```

- **Die Sonde verbindet sich nach außen.** Jede Anfrage geht von der Sonde über HTTPS an `ONEUPTIME_URL`. Von außerhalb Ihres Netzwerks muss nichts die Sonde erreichen.
- **Sie prüft nur ihre eigenen Monitore.** Die Sonde fragt OneUptime nach den Monitoren, denen sie hinzugefügt ist, prüft jeden, sobald er fällig ist, und sendet das Ergebnis zurück. OneUptime entscheidet anhand der Ergebnisse, ob sich der Status eines Monitors ändert.
- **OneUptime achtet darauf, dass sie läuft.** Jede Anfrage der Sonde gilt als Lebenszeichen, und die Sonde sendet mindestens jede Minute eine. Nach etwa drei Minuten ohne eine zeigt die Sonde **Getrennt**, und ihre Eigentümer werden benachrichtigt. Hat eine Sonde keine Eigentümer, werden die Eigentümer des Projekts benachrichtigt.

## Bevor Sie beginnen

- **Der Growth-Plan, in OneUptime Cloud.** Das Anlegen einer Sonde setzt ihn voraus. Eine selbst gehostete Installation hat keine Plangrenzen.
- **Die Berechtigung, Sonden anzulegen.** Projekteigentümer, -administratoren und -mitglieder haben sie, ebenso alle, deren Rolle das Anlegen von Sonden erlaubt.
- **Ein Rechner in dem Netzwerk, das Sie überwachen möchten.** Er braucht Docker, Docker Compose oder Kubernetes, eine Route zu den Diensten, die die Sonde prüfen soll, und ausgehendes HTTPS zu `ONEUPTIME_URL`.

## Eine Sonde installieren

:::steps
### Die Sonde anlegen

Öffnen Sie **Monitore → Einstellungen → Sonden** und klicken Sie auf **Sonde erstellen**. Geben Sie ihr einen **Name** und eine **Beschreibung**: beide sind Pflicht. Unter **Weitere Felder** finden Sie das **Sondenlogo**, **Überwachung bei neuen Monitoren automatisch aktivieren**, womit diese Sonde für jeden neuen Monitor ausgewählt wird, den Sie anlegen, und **Beschriftungen**.

### ID und Schlüssel kopieren

Die Sonde braucht ihre ID und ihren Schlüssel, um sich zu verbinden. Zum Kopieren öffnen Sie das Menü der Sonde in der Tabelle **Benutzerdefinierte Sonden** und wählen **ID und Schlüssel anzeigen**. Jeder, der die Tabelle sieht, kann die ID einer Sonde kopieren; ihr Schlüssel wird nur Projekteigentümern und -administratoren angezeigt, die **ID und Schlüssel anzeigen** sehen, wo die anderen **ID anzeigen** sehen.

Projekteigentümer und -administratoren können auch auf die Sonde klicken: Die Karte **Ihre benutzerdefinierte Sonde einrichten** auf ihrer Seite zeigt den Docker-Befehl mit bereits eingesetzter ID und eingesetztem Schlüssel.

### Die Sonde starten

Starten Sie sie auf dem gewählten Rechner, mit der ID und dem Schlüssel der Sonde. Wenn Sie OneUptime selbst hosten, setzen Sie `ONEUPTIME_URL` auf die URL Ihrer Installation statt auf `https://oneuptime.com`.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
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

Starten Sie sie dann mit `docker compose up -d`.
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
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

Wenden Sie sie dann mit `kubectl apply -f oneuptime-probe.yaml` an.
:::

Mit Host-Networking (`--network host`, `network_mode: host`) nutzt die Sonde das Netzwerk des Hosts selbst, IPv6 eingeschlossen. Lesen Sie [IPv6-Ziele überwachen](#ipv6-ziele-überwachen), bevor Sie sie ohne Host-Networking starten.

### Prüfen, ob sie sich verbindet

Nach ein bis zwei Minuten zeigt der **Status** der Sonde in der Tabelle **Benutzerdefinierte Sonden** **Verbunden**. Zeigt er weiterhin **Getrennt**, steht der Grund im Log der Sonde: siehe [Eine getrennte Sonde untersuchen](#eine-getrennte-sonde-untersuchen).

### Einen Monitor von der Sonde prüfen lassen

Eine Sonde prüft nur die Monitore, denen sie hinzugefügt ist. Ein neuer Monitor wählt seine Sonden im Schritt **Sonden & Intervall** von **Monitor erstellen**. Bei einem bestehenden Monitor öffnen Sie ihn und gehen zu **Konfiguration → Sonden & Intervall**. Die Seite hat drei Karten:

- **Überwachungsintervall**: wie oft jede Sonde des Monitors ihn prüft. Wählen Sie ein Intervall, und es wird sofort gespeichert. Synthetische, Custom-Code- und SSL-Zertifikat-Monitore werden alle 5 Minuten oder seltener angeboten; einer, der schon auf einem kürzeren Intervall oder einem per API gesetzten Zeitplan läuft, behält ihn und zeigt ihn in der Liste.
- **Sonden**: Klicken Sie auf **Sonde hinzufügen** und wählen Sie Ihre benutzerdefinierte Sonde. Damit eine Sonde diesen Monitor nicht mehr prüft, schalten Sie sie mit **Bearbeiten** im Menü der Zeile aus oder löschen die Zeile.
- **Sondenübereinstimmung**: wie viele Sonden des Monitors dasselbe Ergebnis sehen müssen, bevor sich sein Status ändert, eingetragen in den Satz „Status dieses Monitors ändern, wenn ... Sonden übereinstimmen“. Lassen Sie das Feld leer für alle. Nur eingeschaltete und verbundene Sonden zählen, daher bedeutet eine größere Zahl ebenfalls alle. Die Zahl wird gespeichert, wenn Sie das Feld verlassen oder **Enter** drücken.

Monitore, die Sonden nicht prüfen (Manuell, Eingehende Anfrage, Eingehende E-Mail, Server, Netzwerkgerät und die Telemetrie-Monitore), haben keine Seite Sonden & Intervall.
:::

> [!TIP]
> Eine Sonde, die private Adressen wie `http://10.0.0.5/health` prüfen soll, braucht `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true`. Sonden lehnen private Adressen ab, bis Sie sie erlauben: siehe [Zugriff auf private Netzwerke](/docs/self-hosted/private-network-access).

## Über einen Proxy verbinden

Wenn die Sonde OneUptime oder die geprüften Sites nur über einen Proxy erreicht, geben Sie ihr die Adresse des Proxys:

| Variable | Was sie bewirkt |
| --- | --- |
| `HTTPS_PROXY_URL` | Der Proxy für HTTPS-Adressen, darunter OneUptime selbst und die meisten Sites. |
| `HTTP_PROXY_URL` | Der Proxy für reine HTTP-Adressen. |
| `NO_PROXY` | Hosts, die die Sonde direkt erreicht, durch Kommas getrennt. |

Schreiben Sie die Adresse eines Proxys als `http://proxy.example.com:8080`, oder als `http://username:password@proxy.example.com:8080`, wenn er Benutzername und Passwort verlangt. Die meisten Proxys bedienen beide Arten von Adressen, setzen Sie also beide Variablen auf dieselbe URL.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
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
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
```
:::

Was über den Proxy läuft:

- **Die eigenen Anfragen der Sonde an OneUptime.**
- **Die HTTP-Prüfungen von Monitoren**: Website-, API-, External-Status-Page-, Custom-Code-, SSL-Zertifikat-, synthetische und Domain-Monitore. SSL-Zertifikat- und synthetische Monitore nutzen `HTTPS_PROXY_URL`, oder `HTTP_PROXY_URL`, wenn nur diese gesetzt ist.
- **Nicht die übrigen Prüfungen.** Ping, Port, DNS, SNMP und die anderen Prüfungen, die kein HTTP sind, verbinden sich direkt.

Ein Eintrag in `NO_PROXY` ist ein Hostname (`api.internal`), eine Domain mit führendem Punkt oder `*.` für jeden Namen darunter (`.internal.example.com`), beides auch mit `:port`, oder `*` für alles. IP-Bereiche werden nicht gelesen: führen Sie jede Adresse einzeln auf. Die kleingeschriebenen Namen `http_proxy`, `https_proxy` und `no_proxy` sowie `HTTP_PROXY` und `HTTPS_PROXY` funktionieren ebenfalls.

## IPv6-Ziele überwachen

Eine Sonde kann ein IPv6-Ziel nur überwachen, wenn ihr eigenes Netzwerk IPv6 hat:

- **Docker mit `--network host` oder Compose mit `network_mode: host`** (die Setups oben): Die Sonde teilt sich das Netzwerk des Hosts und hat also genau dann IPv6, wenn der Host es hat.
- **Ein Docker-Bridge-Netzwerk** (was Sie ohne Host-Networking bekommen): kein IPv6, es sei denn, IPv6 ist für dieses Netzwerk eingeschaltet (siehe unten).
- **Kubernetes**: Pods haben IPv6 nur in einem Dual-Stack- oder reinen IPv6-Cluster.

Zum Prüfen pingen Sie aus der Sonde heraus eine öffentliche IPv6-Adresse an:

:::tabs
@tab Docker
```bash
docker exec oneuptime-probe ping -6 -c 1 2001:4860:4860::8888
```
@tab Kubernetes
```bash
kubectl exec deploy/oneuptime-probe -- ping -6 -c 1 2001:4860:4860::8888
```
:::

`1 received` bedeutet, dass die Sonde IPv6-Ziele erreichen kann. Hat die Sonde kein nutzbares IPv6, schlägt `ping` sofort fehl, und die Fehlermeldung sagt warum:

| Fehler | Was er bedeutet |
| --- | --- |
| `Network is unreachable` | Das Netzwerk der Sonde hat keine IPv6-Route: ein Docker-Bridge-Netzwerk ohne IPv6, ein reiner IPv4-Kubernetes-Cluster oder ein Host ohne IPv6-Konnektivität. |
| `Cannot assign requested address` | IPv6 ist im Netzwerk-Namespace der Sonde ausgeschaltet. Prüfen Sie `net.ipv6.conf.all.disable_ipv6` und `net.ipv6.conf.lo.disable_ipv6`: `cat /proc/sys/net/ipv6/conf/all/disable_ipv6` gibt in der Sonde `1` aus, wenn es aus ist. Mit Host-Networking sind das die Einstellungen des Hosts. |
| `Address family not supported by protocol` | Der Kernel wurde mit `ipv6.disable=1` gestartet, die Maschine hat also überhaupt kein IPv6. Entfernen Sie es aus der Kernel-Befehlszeile und starten Sie neu, oder betreiben Sie die Sonde auf einer anderen Maschine. |

In jedem dieser Fälle wurde nichts an das Ziel gesendet, daher kann die Sonde nicht sagen, ob es erreichbar ist. Die Prüfung schlägt trotzdem fehl, aber der Fehlergrund eines Ping-Monitors nennt die Sonde, statt zu behaupten, das Ziel habe nicht geantwortet:

```text
This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.
```

Der mit dem Fehler erfasste Netzwerkpfad sagt `Traceroute could not run: this probe cannot send IPv6 traffic (...)`. Reparieren Sie das Netzwerk der Sonde oder verschieben Sie den Monitor auf eine Sonde mit IPv6.

### IPv6 ohne Host-Networking

Wenn Sie kein Host-Networking verwenden können, hängen Sie die Sonde an ein Docker-Netzwerk mit eingeschaltetem IPv6. Der Host selbst braucht weiterhin IPv6.

```bash
docker network create --ipv6 oneuptime-probe-ipv6
docker run --name oneuptime-probe --network oneuptime-probe-ipv6 -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Docker Engine 27 und neuer wählt ein IPv6-Subnetz für das Netzwerk und maskiert das ausgehende IPv6 der Sonde hinter der Adresse des Hosts. Ältere Versionen brauchen ein ausdrückliches IPv6-Subnetz (zum Beispiel `docker network create --ipv6 --subnet fd00:0:0:1::/64 oneuptime-probe-ipv6`) sowie `"ip6tables": true` mit `"experimental": true` in `/etc/docker/daemon.json`. Mit Docker Compose entfernen Sie `network_mode: host` und setzen `enable_ipv6: true` im Netzwerk der Sonde.

## NetBIOS-Namensabfragen in Discovery-Scans

Ein [Netzwerk-Discovery-Scan](/docs/monitor/network-device-monitor) mit eingeschaltetem **Windows-Namen nachschlagen (NetBIOS)** sendet NetBIOS-Namensabfragen (NBSTAT) von der Sonde an jeden Host ohne SNMP-Systemnamen. Für Scans, die das nutzen, lassen Sie diesen Verkehr zu:

- **Welche Hosts abgefragt werden:** gefundene Hosts, die weder einen SNMP-Systemnamen noch einen Reverse-DNS-Namen (PTR) haben, und nur unter privaten Adressen (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) oder Carrier-Grade-NAT-Adressen (`100.64.0.0/10`). Öffentliche Adressen werden nie abgefragt, und ein Host, dessen Reverse-DNS-Abfrage von der Sonde aus einen Namen lieferte, bekommt nie eine Abfrage. Ein Host, dessen Abfrage fehlschlug, in eine Zeitüberschreitung lief oder übersprungen wurde, als das Zeitbudget der Abfragen aufgebraucht war, kann trotzdem abgefragt werden, selbst wenn er einen PTR-Eintrag hat.
- **Ausgehend:** UDP von einem flüchtigen (zufälligen, hohen) Quellport der Sonde an UDP-Port 137 dieser Hosts. Die Proxy-Einstellungen oben gelten dafür nicht.
- **Eingehend:** die Antworten, von UDP-Port 137 jedes Hosts zurück an diesen flüchtigen Port. Eine zustandsbehaftete Firewall lässt sie automatisch zu. Ohne sie werden die Hosts weiter nach ihrer IP-Adresse benannt.

Die Abfrage braucht keine zusätzliche Container-Capability und funktioniert aus dem Pod-Netzwerk von Kubernetes. Sie fragt höchstens 2.000 Hosts pro Scan ab (`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` erhöht das auf 4.000), schickt jedem Host ohne Antwort eine weitere Abfrage, taktet die Abfragen auf etwa 100 pro Sekunde und hört an einem Zeitlimit auf, das nach dieser Arbeit bemessen ist – etwa 54 Sekunden für eine volle Abfrage von 2.000 Hosts, und nie mehr als zwei Minuten. Globale Sonden senden nie NetBIOS-Abfragen, egal was der Scan sagt; führen Sie Scans, die NetBIOS-Namen brauchen, also von einer benutzerdefinierten Sonde aus. Die Option ist bei neuen Scans eingeschaltet. NBSTAT-Abfragen an viele Hosts können Regeln der Angriffserkennung auslösen; schalten Sie sie bei Scans von Netzwerken, in denen das wichtig ist, aus, oder informieren Sie vorher Ihr Sicherheitsteam.

## Umgebungsvariablen

Die Sonde liest ihre Einstellungen beim Start aus ihrer Umgebung: Ändern Sie eine, dann starten Sie die Sonde neu. Eine Zahl, die die Sonde nicht lesen kann, oder eine außerhalb des Bereichs, den eine Variable zulässt, wird ignoriert, und der Standardwert gilt; die Grenzen für Paketmitschnitte werden stattdessen in ihren Bereich gezogen.

### Pflicht

| Variable | Was sie ist |
| --- | --- |
| `PROBE_KEY` | Der Schlüssel der Sonde, aus **ID und Schlüssel anzeigen**. Ohne ihn hält die Sonde beim Start an. |
| `PROBE_ID` | Die ID der Sonde, aus **ID und Schlüssel anzeigen**. Ohne sie hält die Sonde beim Start an. |
| `ONEUPTIME_URL` | Wo OneUptime ist: `https://oneuptime.com` oder die URL Ihrer eigenen Installation. Ohne sie hält die Sonde beim Start an. |

### Monitore prüfen

| Variable | Standard | Was sie bewirkt |
| --- | --- | --- |
| `PROBE_MONITORING_WORKERS` | `1` | Wie viele Stapel von Monitoren die Sonde gleichzeitig prüft. |
| `PROBE_MONITOR_FETCH_LIMIT` | `10` | Wie viele Monitore in einem Stapel sind. |
| `PROBE_MONITOR_RETRY_LIMIT` | `3` | Wiederholungen nach dem ersten Versuch einer fehlgeschlagenen Monitorprüfung, wenn ein Schritt keine eigene Anzahl setzt, also bis zu 4 Versuche. `0` schaltet Wiederholungen aus. |
| `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` | `900000` | Frist für die Prüfung eines Monitors, nach der die Prüfung aufgegeben und im nächsten Zyklus wiederholt wird. Der Standard wächst, wenn das Zeitlimit für synthetische Skripte erhöht wird, damit ein Skript nie abgeschnitten wird. |
| `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Zeitlimit für Skripte synthetischer Monitore, in Millisekunden. |
| `PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED` | `false` | Auf `true` setzen, damit Chromium in synthetischen Monitoren in seiner eigenen Sandbox läuft. Schalten Sie es nur ein, wenn der Container der Sonde mit einem seccomp-Profil läuft, das die Sandbox erlaubt, etwa dem von Playwright: ohne ein solches kann Chromium nicht starten. Solange es aus ist, schreibt die Sonde beim Start eine Warnung ins Log. |
| `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Zeitlimit für Skripte von Custom-Code-Monitoren, in Millisekunden. |
| `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` | `false` | Auf `true` setzen, damit Website-, API-, External-Status-Page- und Custom-Code-Monitore auf dieser Sonde private Adressen erreichen dürfen. Siehe [Zugriff auf private Netzwerke](/docs/self-hosted/private-network-access). |
| `PROBE_NETWORK_DEVICE_POLL_CONCURRENCY` | `25` | Wie viele Netzwerkgeräte die Sonde gleichzeitig abfragt. Erhöhen Sie den Wert für eine Sonde, die viele Geräte abfragt. |

Die Grenzen, in denen ein synthetischer Monitor läuft (wie viele gleichzeitig laufen, ihr Speicher und ihr Plattenplatz), stehen auf der Seite [Synthetische Überwachung](/docs/monitor/synthetic-monitor).

### Verbindung zu OneUptime

| Variable | Standard | Was sie bewirkt |
| --- | --- | --- |
| `HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY` | keiner | Die Proxy-Einstellungen: siehe [Über einen Proxy verbinden](#über-einen-proxy-verbinden). |
| `PROBE_API_REQUEST_TIMEOUT_IN_MS` | `45000` | Frist für jede Anfrage, die die Sonde an OneUptime sendet. |
| `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` | `10000` | Für Anfragen an OneUptime, die länger dauern, eine Warnung protokollieren. |

### Netzwerk-Discovery

| Variable | Standard | Was sie bewirkt |
| --- | --- | --- |
| `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` | `5400000` (90 Minuten) | Frist für einen Netzwerk-Discovery-Durchlauf, nach der er aufgegeben und der Scan als fehlgeschlagen gemeldet wird. |
| `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` | `30000` | Wie oft ein laufender Discovery-Durchlauf die bisher gefundenen Hosts hochlädt, damit ein langer Scan Fortschritt zeigt und seine Geräte vor dem Ende importiert werden können. Minimum `5000`. |
| `PROBE_DISCOVERY_SCAN_CONCURRENCY` | `0` | Feste Anzahl von Adressen, die ein Discovery-Durchlauf gleichzeitig abtastet. Ungesetzt (oder `0`) lassen, damit sie nach dem Ziel des Scans bemessen wird – genau das wollen Sie, es sei denn, der Container der Sonde ist ungewöhnlich klein oder ungewöhnlich groß. |
| `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` | `0` | Zeitlimit in Millisekunden für das Nachschlagen von Reverse-DNS-Namen (PTR) der Hosts, die ein Durchlauf gefunden hat. Siehe unten. |
| `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` | `0` | Wie viele Hosts die NetBIOS-Abfrage eines Scans fragen darf. Siehe unten. |
| `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` | `4` | Höchstzahl unabhängiger Discovery-Scans, die gleichzeitig auf dieser Sonde laufen, von 1 bis 16. Siehe unten. |

`PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS`: Ungesetzt (oder `0`) wird das Limit nach der Anzahl der Hosts bemessen: 60 Sekunden für bis zu etwa 860 Hosts, wachsend bis höchstens 10 Minuten. Sie können es von 1000 bis 1200000 setzen. Hosts, die die Abfragen nicht rechtzeitig erreichen, bekommen keinen Reverse-DNS-Namen (sie werden nach IP-Adresse aufgeführt, sofern SNMP oder NetBIOS sie nicht benennt), und die Statusmeldung des Scans sagt, wie viele fehlen. Eine Abfrage, die in eine Zeitüberschreitung läuft oder fehlschlägt, wird einmal wiederholt, solange das Limit reicht, wobei jeder Nameserver der Sonde der Reihe nach gefragt wird. Erhöhen Sie es für ein großes Netzwerk hinter einem langsamen DNS-Server.

`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS`: Bei Scans mit eingeschalteten NetBIOS-Namen fragt die Abfrage jeden Host ohne SNMP-Systemnamen, Hosts ohne Reverse-DNS-Namen zuerst. Ungesetzt (oder `0`) bleibt es bei der eingebauten Obergrenze von 2.000; Sie können es von 1 bis 4000 setzen. Hosts über der Grenze werden nicht gefragt, und die Statusmeldung des Scans sagt, wie viele. Ein höherer Wert verlängert auch die Abfrage (ihr Zeitlimit wird daraus bemessen: etwa 104 Sekunden bei 4.000 Hosts) und bringt mehr NBSTAT-Datagramme ins Netzwerk, auf die Regeln der Angriffserkennung achten.

`PROBE_DISCOVERY_MAX_CONCURRENT_SCANS`: Die Sonde prüft jede Minute auf einen weiteren ausstehenden Scan, solange Kapazität frei ist, sodass ein langer Scan nicht alle anderen blockiert. Sind alle Plätze belegt, bleiben weitere Scans ausstehend, bis ein Platz frei wird. Jeder Scan hat seine eigene Host-Parallelität, daher wächst der Ressourcenbedarf mit beiden Einstellungen; senken Sie für kleine Container eine der beiden Grenzen. Setzen Sie den Wert auf 1, um Scans nacheinander auszuführen.

Aktualisieren Sie den OneUptime-Server, bevor Sie benutzerdefinierte Sonden für parallele Discovery aktualisieren. Der Server muss Scans ausschließen können, die die Sonde noch ausführt, damit das Bearbeiten eines laufenden Scans seine neue Konfiguration sicher einreiht. Verbinden Sie eine aktualisierte Sonde mit einem älteren Server, setzen Sie `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1`, bis der Server aktualisiert ist.

### Paketmitschnitt

| Variable | Standard | Was sie bewirkt |
| --- | --- | --- |
| `PROBE_PACKET_CAPTURE_ENABLED` | aus | Auf `true` setzen, damit Personen mit der Berechtigung Paketmitschnitte auf dieser Sonde aus dem Dashboard starten können. Mitschnitte brauchen außerdem Host-Networking und die Capability `NET_RAW`. Siehe [Paketmitschnitt](/docs/probe/packet-capture). |
| `PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS` | `1800` | Der längste Paketmitschnitt, den diese Sonde ausführt, von 5 bis 1800. |
| `PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB` | `25` | Die größte Mitschnittdatei, die diese Sonde erstellt, von 1 bis 25. |

### Worauf die Sonde lauscht

Eine Sonde baut nur ausgehende Verbindungen auf, es sei denn, Sie schalten einen Listener ein oder behalten einen, der standardmäßig an ist:

| Listener | Einstellung | Standard | Mehr dazu |
| --- | --- | --- | --- |
| Eingehende Anfragen und Heartbeats | `PROBE_INGRESS_PORT` | Aus | [Eingehende-Anfrage-Ingress](/docs/probe/incoming-request-ingress) |
| SNMP-Traps | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | An, UDP 162 | [Netzwerkgeräte-Überwachung](/docs/monitor/network-device-monitor) |
| Syslog | `PROBE_SYSLOG_RECEIVER_ENABLED` | Aus, UDP 5140 | [Leitfäden für Netzwerkhersteller](/docs/monitor/network-vendor-guides) |
| NetFlow, IPFIX und sFlow | `PROBE_NETFLOW_RECEIVER_ENABLED` | An, UDP 2055, 4739 und 6343 | [Netzwerkverkehr](/docs/monitor/network-traffic) |
| Health-Checks | `PORT` | An, TCP 3874 | `/status/live` und `/status/ready` |

In einem Container ist ein Port von anderen Maschinen aus nur mit Host-Networking erreichbar oder wenn Sie ihn veröffentlichen.

Der Syslog-Empfänger leitet höchstens `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` Nachrichten pro Minute weiter, standardmäßig `600`, verwirft den Rest und schreibt ins Log, wie viele er verworfen hat.

`PROBE_NAME` und `PROBE_DESCRIPTION` werden nur von Sonden gelesen, die sich mit `REGISTER_PROBE_KEY` selbst registrieren, etwa die Sonden, die eine selbst gehostete Installation für jedes Projekt betreibt. Eine benutzerdefinierte Sonde übernimmt Name und Beschreibung aus dem Dashboard.

## Fehlerbehebung

### Eine getrennte Sonde untersuchen

Eine Sonde wird als `Disconnected` markiert, wenn ihre Anfragen an OneUptime nicht mehr gelingen. Das Log der Sonde sagt, wo jede fehlgeschlagene Anfrage hängen blieb, sodass Sie selten raten müssen.

:::steps
#### Den beim Start ausgegebenen Umgebungsblock lesen

Jede Sonde gibt beim Start einen JSON-Block aus, mit der verwendeten OneUptime-URL, ihrer Anfragefrist, ihren Proxy-Einstellungen, den geerbten DNS-Resolvern, der Node- und OS-Version und der Angabe, ob die TLS-Prüfung abgeschaltet wurde. Fügen Sie diesen Block jeder Problemmeldung bei.

#### Den Fehlerbericht finden

Jede fehlgeschlagene Anfrage an OneUptime protokolliert einen Block mit `stalledAt` und `whatThisMeans`. `stalledAt` ist die Phase, über die die Anfrage nie hinauskam:

| `stalledAt` | Was es bedeutet |
| --- | --- |
| `SocketAssignment` | Nichts hat die Maschine verlassen. Der Socket-Pool war ausgelastet, oder ein eingerichteter Proxy hat seinen CONNECT-Tunnel nie aufgebaut. |
| `TcpConnect` | Die Maschine hat SYN gesendet und nichts zurückbekommen – eine Firewall oder ein Sicherheitsgerät verwirft Pakete, oder der Host ist nicht erreichbar. |
| `TlsHandshake` | TCP ist verbunden, TLS wurde nie fertig. Meist eine Middlebox, die TLS inspiziert. |
| `RequestSend` | Verbunden, aber die Anfrage wurde nie vollständig geschrieben – die Gegenseite hat aufgehört zu lesen. |
| `WaitingForServerResponse` | Die Anfrage wurde zugestellt, und der Server hat nichts zurückgeschickt. **Das Netzwerk der Sonde ist in Ordnung** – prüfen Sie den OneUptime-Server, seinen Load Balancer und seinen Reverse Proxy. |
| `ResponseBody` | Der Server hat zu antworten begonnen und ist mittendrin stehen geblieben. |
| `Unknown` | Die Sonde konnte nicht feststellen, wo die Anfrage stehen geblieben ist. Als Nächstes lesen Sie den Konnektivitäts-Selbsttest unten. |

Derselbe Block meldet auch `deadlineOverrunInMs`. Hat eine Frist von 45000ms deutlich länger als 45000ms Echtzeit gedauert, war der Prozess der Sonde selbst blockiert – prüfen Sie `probeProcess.eventLoopMaxDriftInMs` im Block, bevor Sie das Netzwerk untersuchen.

#### Den Konnektivitäts-Selbsttest lesen

Nach drei Fehlschlägen in Folge testet die Sonde denselben Server Schicht für Schicht – DNS, dann TCP, dann TLS, dann einen echten HTTP-Roundtrip – und protokolliert jede Stufe mit ihrer Dauer. Die erste Stufe, die fehlschlägt, ist Ihre Antwort. Ist ein Proxy eingerichtet, testet die Sonde die Strecke zum Proxy, denn das ist die einzige Verbindung, die sie tatsächlich aufbaut. Der Test läuft höchstens einmal alle fünf Minuten.

#### Langsame Anfragen bemerken, bevor sie scheitern

Anfragen, die gelingen, aber länger als `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` dauern, werden mit ihrer Dauer protokolliert. Eine Sonde, die anfängt, Anfragen von 20 Sekunden zu protokollieren, ist auf dem Weg, die Frist von 45 Sekunden zu überschreiten.
:::

Auch auf der Serverseite von OneUptime wird eine Sondenanfrage protokolliert, die langsam beantwortet wird – oder die die Sonde aufgegeben hat, bevor eine Antwort gesendet wurde –, mit der ID der Sonde. Beide Logs zusammen zeigen, auf welcher Seite der Verbindung der Fehler liegt.

### Andere Probleme

:::details Die Sonde hält gleich nach dem Start an
Ihr Log nennt, was fehlt: `PROBE_KEY is not set`, `PROBE_INGEST_URL or ONEUPTIME_URL is not set` oder `PROBE_ID or REGISTER_PROBE_KEY should be set`. Sind alle drei gesetzt, passen ID und Schlüssel aber zu keiner Sonde, versucht es die Sonde 10-mal im Abstand von 30 Sekunden und hält dann mit `Unable to register probe after 10 attempts` an. Kopieren Sie ID und Schlüssel erneut mit **ID und Schlüssel anzeigen**.
:::

:::details Die Sonde lief, bis jemand ihren Schlüssel zurückgesetzt hat
**Sonden-Schlüssel zurücksetzen** auf der Seite der Sonde erzeugt einen neuen Schlüssel, und der alte funktioniert sofort nicht mehr. Kopieren Sie den neuen Schlüssel mit **ID und Schlüssel anzeigen**, setzen Sie ihn als `PROBE_KEY` und starten Sie die Sonde neu.
:::

:::details Ein Monitor meldet, dass er eine private Adresse nicht erreichen kann
Sonden lehnen private Adressen ab, bis Sie sie erlauben. Setzen Sie `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` auf der Sonde und starten Sie sie neu: siehe [Zugriff auf private Netzwerke](/docs/self-hosted/private-network-access).
:::

Wenn Sie weiterhin Probleme haben, erstellen Sie ein Issue auf [GitHub](https://github.com/oneuptime/oneuptime) oder [wenden Sie sich an den Support](https://oneuptime.com/support).

## Nächste Schritte

:::cards
- [Einen Monitor erstellen](/docs/monitor/create-monitor): Festlegen, was geprüft wird und welche Sonden es prüfen.
- [Eingehende-Anfrage-Ingress](/docs/probe/incoming-request-ingress): Dienste ohne Internetzugang Heartbeats über die Sonde senden lassen.
- [Paketmitschnitt](/docs/probe/packet-capture): Den Verkehr, den die Sonde sieht, aus dem Dashboard mitschneiden.
- [Zugriff auf private Netzwerke](/docs/self-hosted/private-network-access): Eine Sonde private Adressen prüfen lassen.
:::

# Speicher-Array-Agent

Der OneUptime-Storage-Array-Agent überwacht Storage-Arrays: Kapazität und Datenreduktion, Latenz, IOPS und Bandbreite, Volumes, Hosts, Pods und Replikation, Hardware-Zustand, Dateisysteme und Buckets. Er ist ein unveränderter OpenTelemetry Collector, der die OpenMetrics-Endpunkte des Arrays mit dem API-Token eines schreibgeschützten Benutzers scrapt, jede Metrik mit der Identität Ihres Arrays versieht und sie an OneUptime sendet. [Storage-Array-Monitore](/docs/monitor/storage-array-monitor) alarmieren anhand dessen, was ankommt.

:::cards
- [Agent installieren](#agent-installieren): Ein schreibgeschützter Benutzer, dann das Installationsskript oder Docker Compose.
- [Was der Agent erfasst](#was-der-agent-erfasst): Jeder Endpunkt und die Seiten, die daraus entstehen.
- [Mehrere Arrays überwachen](#mehrere-arrays-überwachen): Ein Agent pro Array, auf einem Rechner.
- [Fehlerbehebung](#fehlerbehebung): Ein Diagnoseskript und die üblichen Probleme.
:::

## So funktioniert es

Storage Arrays ist ein Produkt, das für jeden Hersteller gleich funktioniert. Es unterstützt:

| Array | `storage.system` | Wie der Agent es liest | Collector-Konfiguration |
| --- | --- | --- | --- |
| **Pure Storage FlashArray**, Purity//FA 6.7 und neuer | `purestorage.flasharray` | Der eigene OpenMetrics-Endpunkt des Arrays (`https://<array>/metrics/...?namespace=purefa`): Neben dem Collector läuft nichts | `otel-collector-config.yaml` (der Standard) |
| **Pure Storage FlashArray**, älteres Purity//FA | `purestorage.flasharray` | Der FlashArray-OpenMetrics-Exporter von Pure, den dieselbe Compose-Datei als Dienst `pure-fa-exporter` ausführt | `otel-collector-config.flasharray-exporter.yaml` |
| **Pure Storage FlashBlade** | `purestorage.flashblade` | Der FlashBlade-OpenMetrics-Exporter von Pure, den dieselbe Compose-Datei als Dienst `pure-fb-exporter` ausführt | `otel-collector-config.flashblade.yaml` |
| **Dell PowerStore** | `dell.powerstore` | Der PowerStore Metrics Exporter von Dell, den dieselbe Compose-Datei als Dienst `powerstore-exporter` baut und ausführt; die Warnungen des Clusters kommen per Syslog bei ihrem Dienst `powerstore-syslog` an | `otel-collector-config.powerstore.yaml` |

Pure Storage hat sich im Februar 2026 in **Everpure** umbenannt. FlashArray, FlashBlade und Purity behielten ihre Namen, ebenso die Metriken `purefa_*` und `purefb_*`; alles auf dieser Seite gilt daher für Arrays, die unter dem einen oder dem anderen Namen verkauft werden.

```mermaid title="Vom Array zu OneUptime"
flowchart TB
    collector["Collector"] -->|"FlashArray,<br/>Purity//FA 6.7+"| array["Das Array,<br/>Port 443"]
    collector -->|"älteres FlashArray,<br/>FlashBlade"| exporter["Exporter von Pure"]
    exporter -->|"API-Token"| array
    collector -->|"OTLP"| oneuptime["OneUptime"]
    collector -->|"PowerStore"| dell["Dell's exporter"]
    dell -->|"user and password"| array
    array -->|"syslog, port 5514"| syslog["Syslog collector"]
    syslog -->|"OTLP"| oneuptime
```

Ein Agent überwacht ein Array: Führen Sie einen Agent pro Array aus (siehe [Mehrere Arrays überwachen](#mehrere-arrays-überwachen)). Das Array registriert sich mit seinen ersten Daten unter dem Namen, den der Agent als `storage.array.name` an jede Metrik hängt.

## Bevor Sie beginnen

- Docker Engine 20.10 oder neuer mit dem Plugin Docker Compose v2, auf einem Rechner, der die Management-Schnittstelle des Arrays per HTTPS (TCP 443) erreicht.
- Ein Administratorkonto auf dem Array, um einen Benutzer mit der eingebauten Rolle **readonly** und ein API-Token für ihn anzulegen.
- Für einen Dell PowerStore ein x86-64-Rechner (Dell baut seinen Exporter nur für x86-64) und ein PowerStore-Benutzer für den Agent: siehe [Dell PowerStore](#dell-powerstore).
- Ein Ingestion-Schlüssel. Legen Sie ihn unter **Projekteinstellungen → Telemetrie & APM → Ingestion-Schlüssel** an und kopieren Sie seinen Wert.

### Wo der Agent laufen sollte

Der Agent spricht per HTTPS mit der Management-Schnittstelle des Arrays; er kann daher auf jedem Rechner mit Docker und einer Route ins Managementnetz auf TCP 443 laufen: einem Monitoring-Host oder einer kleinen Management-VM. Bevorzugen Sie einen Rechner, dessen eigener Speicher nicht auf dem überwachten Array liegt: Fällt das Array aus, sollte Ihr Monitoring nicht mit ihm ausfallen. Der optionale Syslog-Listener setzt außerdem voraus, dass das Array den Agent auf dem Syslog-Port erreicht (siehe [Das Syslog des Arrays senden](#optional-das-syslog-des-arrays-senden)).

## Agent installieren

:::steps
### Den schreibgeschützten Benutzer und das API-Token anlegen

Der Agent liest immer nur. Geben Sie ihm einen eigenen Benutzer mit der eingebauten Rolle **readonly**, niemals einen Administrator, und ein API-Token für diesen Benutzer. Legen Sie das Token **ohne Ablaufdatum** an, sonst hört der Agent an dem Tag auf, an dem das Token abläuft.

:::tabs
@tab Purity CLI
Melden Sie sich per SSH als Administrator am FlashArray an. Der erste Befehl fragt nach dem Passwort des neuen Benutzers; der zweite gibt sein API-Token aus, eine UUID:

```bash
pureadmin create --role readonly oneuptime
pureadmin create --api-token oneuptime
```
@tab FlashArray GUI
1. Öffnen Sie _Settings → Users and Policies_ (_Settings → Access_ in älteren Releases).
2. Wählen Sie im ⋮-Menü des Bereichs **Users** den Eintrag **Create User…**, nennen Sie den Benutzer `oneuptime` und geben Sie ihm die Rolle readonly.
3. Wählen Sie im ⋮-Menü des neuen Benutzers **Create API Token…**, lassen Sie **Expires In** leer und kopieren Sie das Token.
@tab FlashBlade
Legen Sie auf dieselbe Weise einen Benutzer mit der Rolle **readonly** und ein API-Token für ihn an: in den Benutzereinstellungen der FlashBlade-GUI oder mit `pureadmin` in der Purity//FB-CLI. In einem Release ohne lokale Benutzer verwenden Sie ein Konto eines Verzeichnisdienstes (LDAP oder Active Directory), dessen Gruppe auf die Rolle readonly abgebildet ist. FlashBlade-API-Tokens beginnen mit `T-`.
:::

### Prüfen, ob das FlashArray seine eigenen Metriken liefert

Pure dokumentiert den nativen OpenMetrics-Endpunkt für **Purity//FA 6.7.0 und neuer** (der Abkündigungshinweis zum FlashArray-Exporter von Pure nennt 6.6.11 und neuer). Am schnellsten erfahren Sie es, indem Sie das Array fragen, von dem Rechner aus, auf dem der Agent laufen wird:

```bash
curl -k 'https://<array>/metrics/array?namespace=purefa' --header 'Authorization: Bearer <api-token>' | grep purefa_info
```

Eine Zeile `purefa_info{...} 1` bedeutet, dass das Array seine Metriken nativ liefert: Verwenden Sie die Standardkonfiguration. Ein `404` bedeutet, dass es das nicht tut: Verwenden Sie die Exporter-Konfiguration, die den Exporter von Pure neben dem Collector ausführt. Pure hat diesen Exporter abgekündigt; wechseln Sie daher zur nativen Konfiguration, sobald das Array aktualisiert ist. Ein FlashBlade läuft immer über den FlashBlade-Exporter von Pure; überspringen Sie diesen Schritt dafür.

### Den Agent installieren und starten

Jede OneUptime-Instanz stellt das Installationsskript und die Dateien des Agents für ihr eigenes Release bereit: Die Befehle unten laden sie von `https://oneuptime.com` herunter; ersetzen Sie diese Adresse bei einer selbst gehosteten Instanz durch Ihre URL. Das Installationsskript wird zuerst als `install.sh` gespeichert, sodass Sie es lesen können, bevor Sie es ausführen.

:::tabs
@tab install.sh
Laden Sie das Installationsskript herunter und führen Sie es auf dem Rechner aus, auf dem der Agent laufen soll:

```bash
curl -fsSL https://oneuptime.com/install/storage-array-agent -o install.sh
bash install.sh
```

Das Skript fragt, um welches Array es sich handelt (ein FlashArray mit nativen Metriken, ein FlashArray mit älterem Purity//FA oder ein FlashBlade), dann nach Ihrer OneUptime-URL, dem Ingestion-Schlüssel, einem Namen für das Array, der Management-Adresse des Arrays und dem API-Token des schreibgeschützten Benutzers (ohne Echo gelesen). Es installiert nach `/opt/oneuptime-storage-array-agent`, lädt die Compose-Datei und alle drei Collector-Konfigurationen herunter, schreibt eine mit `0600` geschützte `.env`-Datei mit der passenden Konfiguration und dem passenden Compose-Profil und startet den Agent mit Docker Compose. Es setzt jeden Wert so für Docker Compose in Anführungszeichen, wie Sie ihn eingegeben haben. Ein erneuter Lauf verwendet alles in einer vorhandenen `.env` wieder, statt erneut zu fragen, und bewahrt eine von Ihnen bearbeitete Datei als `<file>.bak.<timestamp>` auf, bevor er sie ersetzt.
@tab Docker Compose
Laden Sie `docker-compose.yml` und die drei Dateien `otel-collector-config*.yaml` von Ihrem OneUptime in einen neuen Ordner herunter:

```bash
curl -fsSLO https://oneuptime.com/install/storage-array-agent/docker-compose.yml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flasharray-exporter.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flashblade.yaml
```

Legen Sie daneben eine Datei `.env` an. Sie enthält das API-Token; schützen Sie sie daher mit `chmod 600 .env`. Für ein FlashArray mit nativen Metriken:

```bash title=".env"
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN
STORAGE_ARRAY_NAME=my-storage-array
STORAGE_SYSTEM=purestorage.flasharray
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.yaml
COMPOSE_PROFILES=
PURE_FA_ENDPOINT=fa-prod-01.example.com
PURE_FA_API_TOKEN=YOUR_READ_ONLY_API_TOKEN
PURE_FB_ENDPOINT=
PURE_FB_API_TOKEN=
STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true
POWERSTORE_ENDPOINT=
POWERSTORE_PASSWORD=
POWERSTORE_USERNAME=
POWERSTORE_BULK_METRICS=
POWERSTORE_API_VERSION=
POWERSTORE_REQUEST_LIMIT=
POWERSTORE_SYSLOG_PORT=
```

Laden Sie für einen Dell PowerStore außerdem `otel-collector-config.powerstore.yaml`, `powerstore-exporter.Dockerfile` und `powerstore-syslog.yaml` herunter, setzen Sie `STORAGE_SYSTEM=dell.powerstore`, `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.powerstore.yaml` und `COMPOSE_PROFILES=powerstore` und tragen Sie `POWERSTORE_ENDPOINT`, `POWERSTORE_USERNAME` und `POWERSTORE_PASSWORD` ein, das Passwort in einfachen Anführungszeichen.

Für ein FlashArray mit älterem Purity//FA setzen Sie `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` und `COMPOSE_PROFILES=flasharray-exporter`. Für ein FlashBlade setzen Sie `STORAGE_SYSTEM=purestorage.flashblade`, `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flashblade.yaml` und `COMPOSE_PROFILES=flashblade` und füllen `PURE_FB_ENDPOINT` und `PURE_FB_API_TOKEN` statt des Paars `PURE_FA_*` aus. Starten Sie den Agent:

```bash
docker compose up -d
```
:::

### Prüfen, ob der Agent läuft

```bash
docker compose ps
docker logs -f oneuptime-storage-array-agent
```

`docker compose ps` listet den Collector (`oneuptime-storage-array-agent`) und, bei einer Exporter-Konfiguration, den Exporter (`pure-fa-exporter` oder `pure-fb-exporter`) auf. Sobald der Collector gestartet ist, sollten seine Logs diese Zeile zeigen:

```text
Everything is ready. Begin running and processing data.
```

### Das Array in OneUptime finden

Öffnen Sie **Produkte → Infrastruktur → Speicher-Arrays → Alle Speicher-Arrays**. Nach dem ersten Scrape (etwa einer Minute) ist das Array mit seiner Kapazität, Leistung, offenen Warnungen und Hardware da. Volumes, Hosts und Pods folgen innerhalb von 2 Minuten, die Dateisysteme und Buckets eines FlashBlade innerhalb von 5 und FlashArray-Verzeichnisse innerhalb von 30. Die Seite **Topologie** des Arrays zeichnet seine Hosts, Volumes, Dateisysteme und Hardware als eine Karte: siehe [Topologie](/docs/telemetry/topology#die-eigene-karte-einer-ressource-öffnen).
:::

## Dell PowerStore

Der Agent liest einen PowerStore-Cluster über den PowerStore Metrics Exporter von Dell, Release `powerstore-metrics-exporter_v1.0.3`. Dell veröffentlicht ihn als Binärdatei, nicht als Image, daher baut der Dienst `powerstore-exporter` beim ersten Start das von Dell dokumentierte Image aus `powerstore-exporter.Dockerfile` und prüft dabei die SHA-256 der Binärdatei; dieser Build braucht einmal `quay.io` und `github.com`.

Der Exporter von Dell meldet sich mit Benutzername und Passwort an, denn PowerStore hat keine API-Token. Legen Sie im PowerStore Manager unter _Settings → Users_ einen lokalen Benutzer nur für den Agent an, mit der Rolle **Storage Operator**: Der Exporter liest die Leistung aus dem Fünf-Minuten-Bulk-Metrikarchiv von PowerStore, das er selbst einschaltet und das PowerStoreOS 4.1 und neuer verlangen, und laut der README von Dell kann die Rolle Operator es nicht einschalten. Auf einem älteren PowerStoreOS genügt die schreibgeschützte Rolle **Operator** mit `POWERSTORE_BULK_METRICS=false`. Nur der Exporter liest das Passwort, aus `.env`.

Der Exporter von Dell liest keine Warnungen, daher sendet der Cluster seine eigenen: Der Dienst `powerstore-syslog` nimmt sein Remote-Syslog auf Port 5514 per TCP und UDP an und legt jede Zeile auf der Seite **Protokolle** des Arrays ab, mit dem Datensatz von PowerStore in Attributen (`powerstore.alert.id`, `powerstore.alert.state`, `powerstore.event.code`) und einem Schweregrad aus den Ereigniscodes von Dell (`powerstore.alert.severity`). Öffnen Sie im PowerStore Manager _Settings → Security → Remote Logging_, fügen Sie diesen Rechner auf Port 5514 hinzu und öffnen Sie den Port in seiner Firewall. Syslog über TLS auf Port 6514 beschreibt `powerstore-syslog.yaml`.

Der Exporter von Dell meldet keine Hosts und keine Replikationssitzungen, daher hat diese Version keine.

## Umgebungsvariablen

Das Installationsskript schreibt diese nach `/opt/oneuptime-storage-array-agent/.env`; eine Docker-Compose-Installation liest sie aus der `.env` neben `docker-compose.yml`. Nachdem Sie einen Wert geändert haben, führen Sie in diesem Ordner `docker compose up -d` aus.

| Variable | Erforderlich | Beschreibung |
| --- | --- | --- |
| `ONEUPTIME_URL` | Ja | Ihre OneUptime-URL, etwa `https://oneuptime.com` oder Ihre selbst gehostete Instanz. Verwenden Sie `http://` und ihren Port, wenn die Instanz nur HTTP spricht. |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Der Ingestion-Schlüssel aus **Projekteinstellungen → Telemetrie & APM → Ingestion-Schlüssel**. |
| `STORAGE_ARRAY_NAME` | Ja | Der Name, unter dem sich das Array in OneUptime registriert, an jede Metrik als Ressourcenattribut `storage.array.name` gehängt. Halten Sie ihn stabil: Eine spätere Änderung registriert ein zweites Array. Ohne ihn startet der Collector nicht. |
| `STORAGE_SYSTEM` | Nein | Die Plattform, angehängt als Ressourcenattribut `storage.system`: `purestorage.flasharray` oder `purestorage.flashblade`. Standard ist `purestorage.flasharray`. |
| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Nein | Welche mitgelieferte Collector-Konfiguration läuft: `otel-collector-config.yaml` (FlashArray, nativ: der Standard), `otel-collector-config.flasharray-exporter.yaml` (älteres FlashArray) oder `otel-collector-config.flashblade.yaml` (FlashBlade). |
| `COMPOSE_PROFILES` | Nein | Startet den Exporter, den die gewählte Konfiguration scrapt: leer für die native FlashArray-Konfiguration, `flasharray-exporter` oder `flashblade` für die anderen beiden. |
| `PURE_FA_ENDPOINT` | FlashArray | Die Management-Adresse des FlashArray: ein Hostname oder eine IP, ohne `https://`. |
| `PURE_FA_API_TOKEN` | FlashArray | Das API-Token des FlashArray-Benutzers mit der Rolle readonly. |
| `PURE_FB_ENDPOINT` | FlashBlade | Die Management-Adresse des FlashBlade: ein Hostname oder eine IP, ohne `https://`. |
| `PURE_FB_API_TOKEN` | FlashBlade | Das API-Token des FlashBlade-Benutzers mit der Rolle readonly. |
| `POWERSTORE_ENDPOINT` | PowerStore | Die Management-Adresse des PowerStore-Clusters: ein Hostname oder eine IP, ohne `https://`. |
| `POWERSTORE_USERNAME` | PowerStore | Der PowerStore-Benutzer, mit dem sich der Exporter von Dell anmeldet. |
| `POWERSTORE_PASSWORD` | PowerStore | Das Passwort dieses Benutzers. Nur der Exporter liest es. |
| `POWERSTORE_BULK_METRICS` | Nein | `true` liest die Leistung aus dem Bulk-Metrikarchiv von PowerStore; `false` liest jedes Objekt einzeln. Standard ist `true`. |
| `POWERSTORE_API_VERSION` | Nein | `v3` für PowerStoreOS 3.6 und neuer, oder `v1`. Standard ist `v3`. |
| `POWERSTORE_REQUEST_LIMIT` | Nein | Wie viele Anfragen der Exporter gleichzeitig an den Cluster sendet. Standard ist `16`. |
| `POWERSTORE_SYSLOG_PORT` | Nein | Der Port, auf dem dieser Rechner das Syslog des Clusters annimmt, per TCP und UDP. Standard ist `5514`. |
| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | Nein | `true` akzeptiert am nativen Endpunkt das selbstsignierte Zertifikat des Arrays; `false` prüft es. Standard ist `true`. Die Exporter von Pure prüfen das Zertifikat des Arrays nie, daher gilt die Einstellung für sie nicht. |

## Wie der Agent scrapt

- **Ein Scrape-Job pro Endpunkt, jeder so oft gelesen, wie es sich lohnt.** FlashArray: `/metrics/array` alle 60 Sekunden; `/metrics/volumes`, `/metrics/hosts` und `/metrics/pods` alle 2 Minuten; `/metrics/directories` alle 30 Minuten, wie Pure selbst rät, weil der Platz von Verzeichnissen für das Array aufwendig zu berechnen ist. FlashBlade: `/metrics/array` alle 60 Sekunden; `/metrics/filesystems` und `/metrics/objectstore` alle 5 Minuten, wieder nach dem Rat von Pure, die Endpunkte für Dateisysteme und Objektspeicher seltener zu lesen als das Array.
- **Jeder Job versieht seine Serien mit dem Label `scrape_endpoint: <endpoint>`.** Jeder Endpunkt exportiert außerdem `purefa_info` oder `purefb_info`; so weiß OneUptime, von welchen Familien ein Batch die vollständige Liste ist: Auf diese Weise verlässt ein gelöschtes Volume, ein Host, ein Pod, ein Dateisystem oder ein Bucket das Inventar, statt darin hängen zu bleiben. Behalten Sie die Labels wie ausgeliefert.
- **Die Latenz pro Volume und pro Host behält drei Dimensionen.** Jedes Volume und jeder Host exportiert seine Latenz in bis zu sechzehn `dimension`s. Eine Regel `metric_relabel_configs` behält `usec_per_read_op`, `usec_per_write_op` und `usec_per_mirrored_write_op` und verwirft die Aufschlüsselung nach QoS-Ratenlimit, Warteschlange, SAN und Servicezeit, die die Serien eines großen Arrays vervielfacht. Die arrayweite Aufschlüsselung auf `purefa_array_performance_latency_usec` bleibt erhalten. Löschen Sie die Regel, um auch die Aufschlüsselung pro Volume zu behalten.
- **Das API-Token ist ein Bearer-Token.** Die native Konfiguration sendet es an das Array selbst; die Exporter-Konfigurationen senden es nur über das Compose-Netzwerk an den Exporter, und die Ports der Exporter werden nie veröffentlicht.
- **Ein PowerStore alle 5 Minuten.** Der Exporter von Dell stellt jeden Teil des Clusters unter `/metrics/<cluster>/<part>` bereit: Die Konfiguration liest `cluster` alle 60 Sekunden, seinen Heartbeat, und `appliance`, `capacity`, `hardware`, `port`, `volume`, `volumeGroup`, `nas` und `file` alle 5 Minuten, da PowerStore sie in Fünf-Minuten-Proben berechnet.
- **Kein `send_batch_max_size`.** OneUptime baut das Inventar aus einem ganzen Scrape pro Anfrage neu auf; der mitgelieferte Processor `batch` teilt einen Scrape daher nie auf mehrere Exporte auf. Behalten Sie die Batch-Einstellungen wie ausgeliefert.

## Was der Agent erfasst

Die semantischen Konventionen von Pure gelten gleichermaßen für den nativen FlashArray-Endpunkt und beide Exporter. Jeder Wert ist ein Gauge, den das Array selbst berechnet (Latenzen in Mikrosekunden pro Operation, Durchsatz pro Sekunde), daher müssen keine Raten berechnet werden, und Objekte werden über **Datenpunkt-Labels** benannt: `name` für Volumes, Pods, Verzeichnisse, Dateisysteme und Buckets, `host` für Hosts, `component_name` für FlashArray-Hardware. Der Agent hängt die Ressourcenattribute `storage.array.name` und `storage.system` an, sodass OneUptime alles unter Ihrem Array ablegt:

| Endpunkt | Metrikfamilien | Was OneUptime daraus baut |
| --- | --- | --- |
| FlashArray `/metrics/array` | `purefa_info`, `purefa_alerts_open`, `purefa_array_space_*`, `purefa_array_performance_*`, `purefa_hw_component_status`, `purefa_hw_component_temperature_celsius`, `purefa_hw_controller_info`, `purefa_drive_capacity_bytes`, `purefa_network_interface_*` | Name, Purity-Version und System-ID des Arrays; Kapazität, belegter Platz und Datenreduktion; Anzahl offener Warnungen; der Zustand des Arrays; die Seite **Hardware** (Komponenten, Laufwerke, Controller, Netzwerkschnittstellen) |
| FlashArray `/metrics/volumes` | `purefa_volume_performance_*`, `purefa_volume_space_*`, `purefa_volume_qos_*` | Die Seite **Volumes**: bereitgestellte und physische Größe, Datenreduktion, Lese- und Schreiblatenz, IOPS und Bandbreite pro Volume |
| FlashArray `/metrics/hosts` | `purefa_host_connectivity_info`, `purefa_host_connections_info`, `purefa_host_performance_*`, `purefa_host_space_*` | Die Seite **Hosts**: Konnektivität (redundante Pfade oder nicht), verbundene Volumes, Latenz, IOPS und Bandbreite pro Host |
| FlashArray `/metrics/pods` | `purefa_pod_performance_*`, `purefa_pod_space_*`, `purefa_pod_replica_links_*`, `purefa_pod_mediator_status` | Die Seite **Replikation**: ActiveCluster- und ActiveDR-Pods, Status und Verzögerung der Replikatverbindungen |
| FlashArray `/metrics/directories` | `purefa_directory_performance_*`, `purefa_directory_space_*` | Die Seite **Verzeichnisse** (FlashArray File Services) |
| FlashBlade `/metrics/array` | `purefb_info`, `purefb_alerts_open`, `purefb_array_space_*`, `purefb_array_performance_*`, `purefb_hardware_health` | Name, Purity-Version und System-ID des FlashBlade; Kapazität und Datenreduktion; Anzahl offener Warnungen; der Zustand des Arrays; die Seite **Hardware** |
| FlashBlade `/metrics/filesystems` | `purefb_file_systems_space_*`, `purefb_file_systems_performance_*` | Die Seite **Dateisysteme**: bereitgestellter und belegter Platz, Datenreduktion, Latenz, IOPS und Bandbreite pro Dateisystem |
| FlashBlade `/metrics/objectstore` | `purefb_buckets_space_*`, `purefb_buckets_quota_space_bytes`, `purefb_buckets_object_count`, `purefb_buckets_performance_*`, `purefb_object_store_accounts_*` | Die Seite **Buckets**: Platz, Kontingent, Objektanzahl und Leistung pro Bucket, nach Konto gruppiert |
| PowerStore `cluster`, `appliance`, `capacity` | `powerstore_cluster`, `powerstore_metro_*`, `powerstore_appliance`, `powerstore_perf_*`, `powerstore_cap_*` | Name und Zustand des Clusters; die Seite **Appliances**: Kapazität, Datenreduktion, Latenz, IOPS und Bandbreite jeder Appliance |
| PowerStore `hardware`, `port` | `powerstore_hardware_*`, `powerstore_wear_metrics_by_drive`, `powerstore_fc_port_*`, `powerstore_eth_port_*`, `powerstore_metricFcPort_*`, `powerstore_metricEthPort_*` | Die Seite **Hardware**: Knoten, Lüfter, Netzteile, Batterien, Laufwerke und Front-End-Ports, jeweils mit ihrer Appliance |
| PowerStore `volume`, `volumeGroup`, `nas`, `file` | `powerstore_volume_*`, `powerstore_metricVolume_*`, `powerstore_volumegroup_*`, `powerstore_metricVg_*`, `powerstore_nas_server_operational_status`, `powerstore_metricNas_*`, `powerstore_filesystem_*`, `powerstore_metricFilesystem_*` | Die Seiten **Volumes**, **Volume-Gruppen**, **NAS-Server** und **Dateisysteme** |

Die Spalte **Integrität** unter **Alle Speicher-Arrays** liest die eigenen Warnungen und die Hardware des Arrays aus seinen neuesten Daten: **Kritisch**, solange es eine offene kritische Warnung meldet oder eine Hardwarekomponente, ein Laufwerk oder einen Controller, die kritisch, ausgefallen, fehlend oder fehlerhaft sind; **Warnung**, solange es einen offenen Warnalarm oder eine beeinträchtigte oder unbekannte Komponente meldet; andernfalls **OK**; und **Unbekannt**, solange der Agent getrennt ist. Die **Übersicht** des Arrays beurteilt mehr, wie der nächste Abschnitt zeigt. In Monitorkriterien erhalten die Attribute des Arrays das Präfix `resource.` (`resource.storage.array.name`, `resource.storage.system`), während die Datenpunkt-Labels ohne Präfix bleiben (`name`, `host`, `dimension`, `space`).

Der Zustand eines PowerStore ist der seiner Hardware, da seine Warnungen als Protokolle ankommen. Der Agent berechnet `powerstore_cap_physical_used_percent` und `powerstore_filesystem_logical_used_percent` selbst und liest den Zustand eines Knotens als 1, solange er Healthy ist.

## Was die Seiten des Arrays zeigen

Die **Übersicht** des Arrays nennt seinen Zustand, **Fehlerfrei**, **Beeinträchtigt** oder **Fehlerhaft**, danach, was Aufmerksamkeit braucht, und listet das unter **Erfordert Aufmerksamkeit** auf, das Dringendste zuerst, jedes einen Schritt von der Stelle, an der man nachsieht:

- **Das Array selbst.** Eine offene Warnung, den das Array mit kritischem Schweregrad ausgelöst hat, ist kritisch, und einer mit dem Schweregrad Warnung braucht einen Blick. Über 80 % seiner nutzbaren Kapazität braucht es einen Blick und über 90 % ist es kritisch, dort, wo die Warnungen Capacity Above 80% und Capacity Above 90% auslösen. Ein FlashArray mit einer durchschnittlichen Lese- oder Schreiblatenz über 5 ms oder ein FlashBlade, dessen Lesevorgänge länger als 10 ms dauern, braucht einen Blick.
- **Hardware.** Eine Komponente, ein Laufwerk, ein Controller oder eine Netzwerkschnittstelle, die das Array als kritisch, ausgefallen, fehlend oder fehlerhaft meldet, ist kritisch: Die Redundanz ist weg, bis das Teil ersetzt ist. Eine, die es als beeinträchtigt, unbekannt, nicht erkannt oder nicht bereit meldet, braucht einen Blick. Nicht installierte, ausgeschaltete oder ungenutzte Teile werden nie aufgelistet.
- **Hosts.** Ein Host, der das Array nicht mehr über beide Controller erreicht, braucht einen Blick, mit dem Grund: nur über einen Controller, über ungleiche Pfade oder ganz ohne Pfad.
- **Pods.** Ein Pod, dessen Replikatverbindung das Array als fehlerhaft meldet, ist kritisch, und einer, der mehr als eine Minute im Rückstand ist, braucht einen Blick.
- **Dateisysteme.** Ein FlashBlade-Dateisystem, dem weniger als 10 % seiner bereitgestellten Größe bleiben, braucht einen Blick.

Die Listen **Hosts**, **Replikation** und **Dateisysteme** nennen den Zustand jedes Teils nach denselben Regeln, mit dem Grund darunter. Die eigene Seite eines Hosts und eines Dateisystems sagt, was daran Aufmerksamkeit braucht und welche Warnungen des Arrays es überwachen, mit einem Schritt, um die übrigen einzuschalten, und die Seite jedes Teils, auch eines Volumes und eines Buckets, sagt, was darauf offen ist. Solange der Agent getrennt ist, lautet der Zustand **Integrität unbekannt**: Die letzte Meldung des Arrays ist nicht mehr die Wahrheit. Jede Linie oben ist die, bei der ihre Warnungsvorlage auslöst, wie der [Speicher-Array-Monitor](/docs/monitor/storage-array-monitor) sie auflistet.

Auf einem PowerStore listen die Tabs **Appliances**, **Volume-Gruppen** und **NAS-Server** die Teile, die nur ein PowerStore hat, und die Seite **Hardware** nennt die Appliance jedes Teils, da jede Appliance ihre Teile gleich benennt.

## Optional — Das Syslog des Arrays senden

Der Syslog-Collector eines PowerStore läuft so, wie er ausgeliefert wird (siehe [Dell PowerStore](#dell-powerstore)): Dieser Abschnitt gilt für die Arrays von Pure.

Standardmäßig sendet der Agent nur Metriken, daher bleibt die Seite **Protokolle** des Arrays leer. Arrays leiten ihre Warnungen und Audit-Ereignisse als Syslog weiter, und jede mitgelieferte Collector-Konfiguration enthält ein auskommentiertes Receiver-Paar `syslog` (TCP und UDP auf Port 5514, RFC 3164), verbunden mit einer auskommentierten Pipeline `logs`, die `storage.array.name` anhängt, damit die Logs bei Ihrem Array landen.

:::steps
### Die Receiver einschalten

Kommentieren Sie die beiden Receiver `syslog/*` und die Pipeline `logs` in der verwendeten Collector-Konfiguration ein. Zeitstempel nach RFC 3164 tragen keine Zeitzone: Setzen Sie `location` auf die Zeitzone des Arrays, sofern seine Uhr nicht auf UTC läuft.

### Den Port öffnen

Kommentieren Sie den Block `ports:` in `docker-compose.yml` ein, damit der Rechner `5514/tcp` und `5514/udp` veröffentlicht, und führen Sie dann `docker compose up -d` aus. Öffnen Sie den Port in der Firewall des Rechners für das Managementnetz des Arrays.

### Das Array auf den Agent verweisen

Tun Sie dies als Administrator, nicht als schreibgeschützter Monitoring-Benutzer. Öffnen Sie auf einem FlashArray _Settings → System → Syslog Servers_, fügen Sie `udp://<agent-host>:5514` (oder `tcp://<agent-host>:5514`) hinzu und senden Sie eine Testnachricht. Fügen Sie auf einem FlashBlade in dessen Syslog-Einstellungen einen Syslog-Server mit derselben URI hinzu. Beide Arrays nehmen die Form `PROTOCOL://HOST:PORT` an, auch über ihre REST-APIs (`syslog-servers`).
:::

Ein Syslog-Receiver lauscht nur auf einem Transport, deshalb sind TCP und UDP zwei Receiver: Lassen Sie einen auskommentiert, wenn Sie nur den anderen brauchen. Das Standard-Image des Collectors liest Syslog unverändert: Es ist kein eigenes Image nötig.

## Das Array mit Projekt-Labels versehen

Ein Ressourcenattribut, das mit `oneuptime.label.` beginnt, wird zu einem Projekt-Label am Storage-Array: `oneuptime.label.<dimension>=<value>` ist das Label `<dimension>:<value>`. Fügen Sie die Attribute dem Processor `resource` in der verwendeten Collector-Konfiguration hinzu, neben `storage.array.name`:

```yaml
processors:
  resource:
    attributes:
      # ...existing attributes...
      - key: oneuptime.label.team
        value: storage
        action: upsert
      - key: oneuptime.label.env
        value: production
        action: upsert
```

Der Collector liest seine Konfiguration nur beim Start: Führen Sie `docker compose restart oneuptime-storage-array-agent` aus. Das Array zeigt dann die Labels `team:storage` und `env:production`. Labels werden ohne Rücksicht auf Groß- und Kleinschreibung verglichen, daher wird ein vorhandenes Label `Production` wiederverwendet statt dupliziert, und der Agent entfernt nie ein Label, das jemand in OneUptime hinzugefügt hat.

## Mehrere Arrays überwachen

Ein Agent liest ein Array. Um mehrere vom selben Rechner aus zu überwachen, installieren Sie jeden in einen eigenen Ordner mit eigener `.env`, etwa `INSTALL_DIR=/opt/oneuptime-storage-array-agent-fa02 bash install.sh`, und geben Sie jedem einen eigenen `container_name` in seiner `docker-compose.yml` (etwa `oneuptime-storage-array-agent-fa02`): Zwei Container können sich keinen Namen teilen. Übergeben Sie den Ordner mit `-d` an das Diagnoseskript.

Ein zweiter PowerStore-Agent braucht außerdem einen eigenen Syslog-Port: Setzen Sie `POWERSTORE_SYSLOG_PORT`, etwa `5515`, in seiner `.env`.

## Als systemd-Dienst ausführen

Um den Agent mit dem Rechner zu starten und bei einem Fehler neu zu starten, installieren Sie seine systemd-Unit. Sie geht davon aus, dass der Agent in `/opt/oneuptime-storage-array-agent` liegt, wo das Installationsskript ihn ablegt:

```bash
sudo curl -fsSL https://oneuptime.com/install/storage-array-agent/systemd/oneuptime-storage-array-agent.service -o /etc/systemd/system/oneuptime-storage-array-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-storage-array-agent
```

## Agent aktualisieren

Der Agent meldet die Collector-Version, die seine Dateien festlegen, als seine **Agent-Version**. Ist sie älter als die Version, die dieses OneUptime-Release festlegt, erscheint daneben auf der Seite **Übersicht** des Arrays ein Warnzeichen. Wählen Sie es aus, um diese Befehle zu sehen. Ein Agent, der installiert wurde, bevor seine Dateien eine Version meldeten, zeigt keine an, bis er auf diese Weise aktualisiert wurde.

Das Collector-Image ist in `docker-compose.yml` festgelegt, und seine Konfigurationen sind Dateien daneben; ein Pull allein bringt den Agent daher nicht voran. Führen Sie `install.sh` erneut aus: Es verwendet jeden Wert Ihrer vorhandenen `.env` wieder (es wird nichts erneut abgefragt), erneuert `docker-compose.yml` und die drei Collector-Konfigurationen (eine von Ihnen bearbeitete Datei wird als `<file>.bak.<timestamp>` aufbewahrt) und erstellt den Agent neu, damit der Collector seine neue Konfiguration liest. Ein Agent, der außerhalb von `/opt/oneuptime-storage-array-agent` installiert ist, braucht seinen Ordner: `INSTALL_DIR=<folder> bash install.sh`.

```bash
curl -fsSL https://oneuptime.com/install/storage-array-agent -o install.sh
bash install.sh
```

Haben Sie stattdessen mit Docker Compose installiert? Laden Sie im Ordner des Agents die Compose-Datei und die drei Collector-Konfigurationen erneut herunter (und nehmen Sie Ihre Änderungen daran erneut vor), ziehen Sie dann die Images und erstellen Sie den Agent neu:

```bash
curl -fsSLO https://oneuptime.com/install/storage-array-agent/docker-compose.yml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flasharray-exporter.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flashblade.yaml
docker compose pull
docker compose up -d --force-recreate
```

Ein PowerStore-Agent lädt auch `otel-collector-config.powerstore.yaml`, `powerstore-exporter.Dockerfile` und `powerstore-syslog.yaml` erneut herunter; `docker compose up` baut das Image des Exporters erneut, wenn ein neues Release sein Tag verschiebt.

## Agent deinstallieren

```bash
cd /opt/oneuptime-storage-array-agent
docker compose down
```

Löschen Sie dann den schreibgeschützten Benutzer und sein API-Token auf dem Array, wenn Sie sie nicht mehr brauchen.

Führen Sie auf einem PowerStore `docker compose --profile powerstore down` aus, damit auch der Exporter und der Syslog-Collector anhalten.

## Fehlerbehebung

:::details Zuerst das Diagnoseskript ausführen
Der Agent bringt ein Skript mit, [`troubleshoot.sh`](https://oneuptime.com/install/storage-array-agent/troubleshoot.sh), das die ganze Kette prüft: die Container-Laufzeit; den Endpunkt des Arrays genau so, wie der Collector ihn erreicht (den nativen Endpunkt oder den Exporter von Pure: DNS, TLS, ob ein FlashArray überhaupt den nativen Endpunkt hat und ob das Array das API-Token akzeptiert, das das Skript curl über stdin übergibt); den an jede Metrik gehängten Array-Namen; die Form des Tokens; die eigenen Metriken des Collectors; und ob OneUptime den Ingestion-Schlüssel akzeptiert. Diese letzte Prüfung zählt am meisten. OneUptime lehnt einen falschen Schlüssel mit `401` ab (`422` für einen deaktivierten Schlüssel oder einen Browser-Schlüssel), und der Collector behandelt beides als dauerhaft: Er verwirft den Batch und protokolliert einen Fehler `Exporting failed`, der leicht zu übersehen ist, während der Container gesund bleibt. Das Skript fragt `GET <url>/otlp/v1/validate` aus dem Netzwerk des Agents ab, um direkt `200` (gültig) oder `401` (ungültig) zu erhalten, und weicht auf älteren Servern auf `POST /fluentd/v1/logs` aus.

```bash
curl -fsSL https://oneuptime.com/install/storage-array-agent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-storage-array-agent
```

Es endet mit einem Urteil, das die wahrscheinlichste Ursache nennt.
:::

:::details Es erscheint kein Array in OneUptime
1. Lesen Sie die Logs des Collectors: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` bedeutet, dass das Array das API-Token abgelehnt hat, `404`, dass das FlashArray keinen nativen Endpunkt hat, `x509`, dass die TLS-Prüfung gegen das selbstsignierte Zertifikat des Arrays eingeschaltet ist, `no such host` oder `connection refused` einen falschen `PURE_FA_ENDPOINT` oder `PURE_FB_ENDPOINT`, und ein `401` beim Export einen falschen Ingestion-Schlüssel.
2. Fragen Sie das Array aus dem Netzwerk des Agents. Das Collector-Image hat weder Shell noch curl; fragen Sie daher aus einem Container in seinem Netzwerk: `docker run --rm --network container:oneuptime-storage-array-agent curlimages/curl -sk -H 'Authorization: Bearer <api-token>' 'https://<array>/metrics/array?namespace=purefa'` sollte `purefa_*`-Zeilen ausgeben.
3. Prüfen Sie, ob `STORAGE_ARRAY_NAME` gesetzt ist: Das Array wird über sein Ressourcenattribut `storage.array.name` gefunden, und ohne ihn startet der Collector nicht.
:::

:::details Das Array wird als getrennt angezeigt
Ein Array wird als getrennt angezeigt, wenn OneUptime 15 Minuten lang nichts von ihm empfangen hat; OneUptime prüft alle 5 Minuten, und Zeit, in der es selbst keine Daten empfing, zählt nicht. Prüfen Sie, ob der Collector läuft (`docker compose ps`), ob seine Logs keine Scrape- oder Exportfehler zeigen und ob der Rechner das Array und Ihre OneUptime-URL noch erreicht. Mit seinen nächsten Daten wird das Array wieder als verbunden angezeigt.
:::

:::details Das FlashArray antwortet mit 404
Sein Purity//FA hat keinen nativen OpenMetrics-Endpunkt. Führen Sie `install.sh` erneut aus und wählen Sie die Option für älteres Purity, oder setzen Sie `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` und `COMPOSE_PROFILES=flasharray-exporter` in `.env` und führen Sie `docker compose up -d` aus. Wechseln Sie nach dem Upgrade des Arrays auf Purity//FA 6.7 oder neuer zurück zur nativen Konfiguration und entfernen Sie das Profil.
:::

:::details Das Array lehnt das API-Token ab
Prüfen Sie, ob Sie das API-Token eingefügt haben und nicht das Passwort des Benutzers; ob der Benutzer noch existiert und die Rolle readonly hat; und ob das Token nicht abgelaufen ist. Legen Sie ein neues Token an (`pureadmin create --api-token oneuptime` auf einem FlashArray), tragen Sie es in `.env` ein und führen Sie `docker compose up -d` aus. Über die Exporter von Pure erscheint ein abgelehntes Token im Log des Collectors als HTTP-`400` vom Exporter, dessen Body `failed to login` lautet.
:::

:::details x509- oder TLS-Fehler
Arrays legen standardmäßig ein selbstsigniertes Zertifikat vor, dem kein Docker-Image vertraut. Setzen Sie entweder `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (die praktische Wahl in einem privaten Managementnetz), oder installieren Sie auf dem Array ein Zertifikat von einer CA, der das Collector-Image vertraut.
:::

:::details pure-fa-exporter oder pure-fb-exporter wird nicht aufgelöst
Der Exporter läuft nicht: `COMPOSE_PROFILES` muss zu `STORAGE_ARRAY_COLLECTOR_CONFIG` passen (`flasharray-exporter` für die FlashArray-Exporter-Konfiguration, `flashblade` für die FlashBlade-Konfiguration). Korrigieren Sie `.env` und führen Sie `docker compose up -d` aus; `docker compose ps` listet dann den Exporter auf.
:::

:::details Ein PowerStore sendet nichts
Lesen Sie das Log des Exporters mit `docker compose logs powerstore-exporter`: Ein `401` bedeutet einen falschen Benutzernamen oder ein falsches Passwort, und ein `403` auf `latest_five_min_metrics` bedeutet, dass die Rolle des Benutzers das Bulk-Metrikarchiv nicht einschalten kann (geben Sie ihm **Storage Operator**, oder setzen Sie `POWERSTORE_BULK_METRICS=false` auf einem PowerStoreOS älter als 4.1). Der Exporter braucht nach dem Start eine Minute, bevor er antwortet. Keine Warnungen auf der Seite **Protokolle**: Prüfen Sie die Einstellungen _Remote Logging_ des Clusters, die Firewall auf Port 5514 und `docker compose logs powerstore-syslog`.
:::

:::details Gelöschte Volumes oder Hosts bleiben im Inventar
OneUptime entfernt ein Objekt, wenn ein vollständiger Scrape seines Endpunkts es nicht mehr enthält, was es am Label `scrape_endpoint` erkennt. Haben Sie die mitgelieferte Collector-Konfiguration durch Ihre eigene ersetzt, behalten Sie die Labels `scrape_endpoint` an ihren Scrape-Jobs; andernfalls verlassen Objekte das Inventar erst, wenn sie veralten.
:::

:::details Metriken landen beim falschen Array
OneUptime registriert ein Storage-Array über sein `storage.array.name`, das der Agent aus `STORAGE_ARRAY_NAME` nimmt. Eine Änderung nach den ersten Daten legt ein zweites Array an, statt das erste umzubenennen.
:::

:::details Metriken ohne den Agent senden
Der Agent ist eine einzige unveränderte Collector-Konfiguration; Collectors, die Sie bereits betreiben, können daher dieselbe Aufgabe übernehmen: Kopieren Sie die Scrape-Jobs und den Processor `resource` aus der mitgelieferten Konfiguration in Ihre eigene. Das Ressourcenattribut `storage.array.name` registriert das Array in OneUptime, und das Löschen von `service.name` / `service.instance.id` verhindert, dass die Daten unter einem Service abgelegt werden: Behalten Sie beides, und behalten Sie die Labels `scrape_endpoint`.
:::

## Nächste Schritte

:::cards
- [Speicher-Array-Überwachung](/docs/monitor/storage-array-monitor): Alarmieren bei Warnungen, Kapazität, Latenz, Hardware, Hostpfaden, Replikation und Dateisystemen.
- [VMware-Agent](/docs/telemetry/vmware): Läuft VMware auf dem Array? Sehen Sie auch seine Datastores und VMs.
- [Host-OpenTelemetry-Collector](/docs/telemetry/host-otel-collector): Die Sicht des Betriebssystems auf die Rechner, die das Array nutzen.
:::

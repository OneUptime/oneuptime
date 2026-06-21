# Sizing & Kapazitätsplanung

Dieser Leitfaden hilft Ihnen, ein selbst gehostetes OneUptime-Deployment auf Kubernetes (Helm) zu dimensionieren. Er behandelt die drei Datenspeicher, von denen OneUptime abhängt — **PostgreSQL**, **Redis** und **ClickHouse** — sowie die Anwendungs-Rechenleistung und gibt Ihnen Ausgangsstufen an die Hand, die Sie anpassen können, sobald Sie reale Zahlen haben.

> **Lesen Sie dies zuerst:** Das Helm-Chart wird mit **keinen gesetzten CPU-/Speicheranforderungen oder -limits** und kleinen **25 Gi** Standard-Volumes für PostgreSQL und ClickHouse ausgeliefert. Diese Standardwerte existieren, damit sich das Chart auf jedem Cluster installieren und ausführen lässt — sie sind **kein** Produktions-Sizing. Für alles, was über einen schnellen Test hinausgeht, legen Sie Ressourcen und Speicher explizit anhand der untenstehenden Zahlen fest.

Wenn Sie stattdessen die Einzelserver-Installation mit Docker Compose betreiben, ist das Sizing einfacher — siehe [Docker Compose](/docs/installation/docker-compose) (empfohlen: 16 GB RAM, 8 Kerne, 400 GB Festplatte).

## Was jeden Datenspeicher antreibt

OneUptime benötigt in der Produktion drei Datenspeicher. Sie skalieren auf völlig unterschiedlichen Eingaben, dimensionieren Sie sie daher unabhängig voneinander.

| Datenspeicher | Was er speichert | Was seine Größe antreibt |
| --- | --- | --- |
| **ClickHouse** | Alle Telemetrie — Logs, Metriken, Traces, Exceptions, Profile | Telemetrie-**Aufnahmerate × Aufbewahrung**. Dies sind ~95 % Ihres Speichers und der dominierende Kostenfaktor. |
| **PostgreSQL** | Konfiguration und Zustand — Monitore, Incidents, Alerts, Benutzer, Teams, Projekte, Workflows, Status-Seiten, Dashboards | **Entitätsanzahl und Historie**, nicht Telemetrievolumen. Wächst langsam. |
| **Redis** | Cache, Arbeitswarteschlangen und Sitzungen | **Warteschlangentiefe und aktive Sitzungen**. Speichergebunden und bescheiden. Keine maßgebliche Datenquelle. |

Objektspeicher (S3/MinIO) ist für den Betrieb von OneUptime **nicht** erforderlich. Er wird nur optional für Datenbank-**Backups** verwendet (über das CloudNativePG Barman-Plugin für PostgreSQL oder `clickhouse-backup` für ClickHouse). OneUptime stuft Telemetrie nicht in Objektspeicher um — siehe den Abschnitt "Aufbewahrung und wie sie sich auf den Speicher auswirkt" weiter unten.

## ClickHouse — der dominierende Treiber

Nahezu Ihr gesamter Speicher und ein großer Teil Ihres RAM werden auf ClickHouse entfallen, denn jede Logzeile, jeder Metrikpunkt, jede Trace-Span und jede Exception lebt dort.

### Speicherformel

```
ClickHouse disk ≈ (daily raw telemetry GB ÷ compression) × retention days × replicas × 1.3 (headroom)
```

Die Komprimierung hängt vom Signal ab:

- **Logs** komprimieren gut — etwa **5:1**.
- **Metriken** komprimieren weniger — etwa **2:1** — und eine hohe Label-**Kardinalität** bläht sowohl Festplatte als auch RAM schneller auf als das reine Volumen. Halten Sie Labels niedrig-kardinal.
- **Traces** liegen dazwischen, abhängig von den Span-Attributen.

### Durchgerechnetes Beispiel

Eine Flotte von **10 Clustern**, jeder mit ~10 Knoten / ~100 Pods bei INFO-Verbositätsstufe, erzeugt etwa **50–150 GB rohe Logs pro Cluster über 30 Tage** (≈ 1,7–5 GB/Tag pro Cluster). Über die gesamte Flotte hinweg, mit hinzugefügten Metriken und Traces und nach Komprimierung, planen Sie ungefähr **5–15 GB/Tag komprimierte Telemetrie** ein.

| Aufbewahrung | Einzelne Replik | 2 Repliken + 30 % Reserve |
| --- | --- | --- |
| 30 Tage | ~150–450 GB | **~0.4–1.2 TB** |
| 90 Tage | ~0.45–1.35 TB | **~1.2–3.5 TB** |

Der Speicher skaliert **linear mit der Aufbewahrung** — ein 90-Tage-Fenster kostet ~3× ein 30-Tage-Fenster.

### RAM und Festplattentyp

- **Verwenden Sie NVMe/SSD.** Telemetrie ist schreiblastig mit stoßweisen Aggregationslesevorgängen; ClickHouse auf rotierenden Festplatten wird Mühe haben.
- **Geben Sie ClickHouse großzügig RAM.** Aggregationsabfragen sind speicherintensiv. Als Faustregel dimensionieren Sie den RAM auf einen nennenswerten Anteil (25–50 %) Ihres *heißen* (kürzlich abgefragten) komprimierten Datensatzes, mit einer praktischen Untergrenze von 16 GB für jede echte Produktionsflotte.
- **Überwachen Sie die Metrik-Kardinalität.** Sie ist der größte einzelne Hebel sowohl für den ClickHouse-RAM als auch für die Festplatte. Erzwingen Sie niedrig-kardinale Label-Konventionen auf der Erfassungsebene und beobachten Sie die Anzahl aktiver Serien.

## PostgreSQL — Konfiguration und Zustand

PostgreSQL speichert Ihre Konfiguration und Ihren Betriebszustand, nicht die Telemetrie, daher wächst es langsam und bleibt im Vergleich zu ClickHouse klein. Selbst große Deployments liegen typischerweise im Bereich von zweistelligen GB. Das standardmäßige **25 Gi** Volume ist für kleine Installationen ausreichend; planen Sie 50–100 GB für größere mit Reserve für die Incident-/Alert-Historie.

Wenn Sie viele Anwendungs-, Worker- und Probe-Repliken betreiben, kann die Anzahl der Datenbankverbindungen zum Engpass werden, bevor es der Speicher tut. Das Helm-Chart von OneUptime enthält einen optionalen **PgBouncer** Verbindungs-Pooler (`pgbouncer.enabled`) genau dafür — aktivieren Sie ihn für Deployments mit vielen Repliken.

## Redis — Cache, Warteschlangen und Sitzungen

Redis wird als Cache, Arbeitswarteschlange und Sitzungsspeicher verwendet. Es ist **speichergebunden** und die Persistenz ist **standardmäßig deaktiviert** (Redis ist hier keine maßgebliche Datenquelle — es kann neu aufgebaut werden). Dimensionieren Sie es nach der erwarteten Warteschlangentiefe und den gleichzeitigen Sitzungen; 2–8 GB Speicher decken die meisten Deployments ab. Beachten Sie, dass die standardmäßige Eviction-Richtlinie `noeviction` ist, daher überwachen Sie den Redis-Speicher, falls sich Warteschlangen bei anhaltender Überlast stauen.

## Anwendungs-Rechenleistung

Über die Datenspeicher hinaus dimensionieren Sie die zustandslosen Workloads (Ingress, Web/API, Worker und Probes). Alle sind standardmäßig auf **1 Replik** ohne Ressourcenlimits gesetzt — legen Sie sie explizit fest. Das Chart bündelt **KEDA**, damit Worker und Probes nach Warteschlangentiefe automatisch skalieren können; aktivieren Sie es für variable Last. Worker skalieren mit dem Verarbeitungsvolumen der Telemetrie-/Datenaufnahme, und Probes skalieren mit der Anzahl aktiver Monitore.

## Ausgangsstufen

Wählen Sie als Ausgangspunkt die Stufe, die Ihrer Umgebung am nächsten kommt, beobachten Sie dann die tatsächliche Nutzung (`kubectl top pods`, ClickHouse-/Postgres-Festplattenwachstum) und passen Sie an.

- **Klein / PoC** — 1–3 Cluster, ≤30 Knoten, ≤5 GB/Tag rohe Telemetrie, 30 Tage Aufbewahrung.
- **Mittel / Produktionsflotte** — ~10 Cluster, ~100 Knoten, 10–30 GB/Tag rohe Telemetrie, 30–90 Tage Aufbewahrung.
- **Groß / Multi-Flotte** — 50+ Cluster, 500+ Knoten, 100+ GB/Tag rohe Telemetrie, 90 Tage Aufbewahrung.

| | Klein / PoC | Mittel / Produktionsflotte | Groß / Multi-Flotte |
| --- | --- | --- | --- |
| **ClickHouse** | 4 vCPU / 16 GB / 200 GB NVMe | 8 vCPU / 32 GB / 1–3 TB NVMe | 16+ vCPU / 64–128 GB / 5–15 TB NVMe, **sharded** |
| **PostgreSQL** | 2 vCPU / 4 GB / 50 GB SSD | 4 vCPU / 8 GB / 100 GB SSD | 8 vCPU / 16–32 GB / 250 GB SSD (+ PgBouncer) |
| **Redis** | 1 vCPU / 2 GB | 2 vCPU / 4 GB | 4 vCPU / 8–16 GB |
| **Angenommene Aufbewahrung** | 30 Tage | 30–90 Tage | 90 Tage |

Diese dimensionieren das OneUptime-**Backend**. Die OneUptime-Collectors, die auf jedem überwachten Cluster laufen, werden separat dimensioniert — siehe die Sizing-Stufen des [Kubernetes-Agenten](/docs/telemetry/kubernetes-agent).

## Hochverfügbarkeit

Die im Chart integrierten Datenspeicher laufen standardmäßig als **Einzelinstanzen**. Für Produktions-HA:

- **PostgreSQL** — aktivieren Sie den gebündelten [CloudNativePG](https://cloudnative-pg.io)-Operator (`postgresOperator.cnpg.enabled`) mit **3 Instanzen** (1 Primary + 2 Hot Standbys) für automatisches Failover.
- **ClickHouse** — aktivieren Sie den gebündelten [Altinity](https://github.com/Altinity/clickhouse-operator)-Operator (`clickhouseOperator.altinity.enabled`) mit **≥2 Repliken pro Shard** und **3 ClickHouse Keeper**-Knoten für Quorum. Fügen Sie Shards hinzu, sobald die Festplatte oder der RAM eines einzelnen Knotens zum Limit wird.
- **Redis** — das Chart hat keine chart-interne Replikation. Für HA verweisen Sie OneUptime auf ein **externes verwaltetes Redis** (oder ein Sentinel-/Cluster-Deployment).

## Aufbewahrung und wie sie sich auf den Speicher auswirkt

Die Telemetrie-Aufbewahrung wird als **in Tagen konfigurierte ClickHouse-TTL** erzwungen, **pro Projekt** festgelegt und **pro Signal** (Logs, Metriken, Traces, Profile) sowie pro Bucket (zum Beispiel nach Log-Schweregrad) verfeinerbar. Der fest codierte Standard beträgt 15 Tage.

Da die Aufbewahrung den ClickHouse-Speicher direkt vervielfacht, legen Sie sie fest, bevor Sie die Festplatte dimensionieren. OneUptime archiviert oder stuft alte Telemetrie **nicht** automatisch in Objektspeicher um — für eine mehrjährige Compliance-Aufbewahrung erweitern Sie das Aufbewahrungsfenster und dimensionieren Sie den ClickHouse-Speicher entsprechend (oder exportieren Sie in ein externes Archiv Ihrer Wahl).

## Messen, bevor Sie sich festlegen

Das Telemetrievolumen variiert enorm mit der Anwendungs-Log-Verbosität, der Anzahl der Namespaces, dem Scrape-Intervall und ob irgendwo DEBUG-Logging aktiviert ist. Behandeln Sie die obigen Stufen als Ausgangspunkte: **instrumentieren Sie Ihre Umgebung für mindestens vier Wochen**, messen Sie die tatsächlichen GB/Tag pro Signal und dimensionieren Sie dann Aufbewahrung und Speicher anhand realer Daten.

## Verwandte Themen

- [Docker Compose](/docs/installation/docker-compose) — Einzelserver-Sizing
- [Self-Hosted-Architektur](/docs/self-hosted/architecture) — wie die Komponenten zusammenpassen
- [Kubernetes-Agent](/docs/telemetry/kubernetes-agent) — Collector-Sizing (Data-Plane)
- [Helm-Chart auf Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

# Sizing & capaciteitsplanning

Deze gids helpt je bij het dimensioneren van een zelf-gehoste OneUptime-deployment op Kubernetes (Helm). Het behandelt de drie datastores waarvan OneUptime afhankelijk is — **PostgreSQL**, **Redis** en **ClickHouse** — plus de applicatiecompute, en geeft startniveaus die je kunt aanpassen zodra je echte cijfers hebt.

> **Lees dit eerst:** de Helm-chart wordt geleverd met **geen ingestelde CPU/geheugen-requests of -limits** en kleine **25 Gi** standaardvolumes voor PostgreSQL en ClickHouse. Die standaardwaarden bestaan zodat de chart op elke cluster installeert en draait — het is **geen** productie-sizing. Voor alles wat verder gaat dan een snelle proef, stel je resources en opslag expliciet in met de onderstaande cijfers.

Als je in plaats daarvan de single-server Docker Compose-installatie draait, is de sizing eenvoudiger — zie [Docker Compose](/docs/installation/docker-compose) (aanbevolen: 16 GB RAM, 8 cores, 400 GB schijf).

## Wat de omvang van elke datastore bepaalt

OneUptime vereist drie datastores in productie. Ze schalen op volledig verschillende inputs, dus dimensioneer ze onafhankelijk.

| Datastore      | Wat het opslaat                                                                                                           | Wat de omvang bepaalt                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **ClickHouse** | Alle telemetrie — logs, metrics, traces, exceptions, profiles                                                             | Telemetrie-**ingestratio × retentie**. Dit is ~95% van je opslag en de dominante kostenpost.   |
| **PostgreSQL** | Configuratie en status — monitors, incidents, alerts, gebruikers, teams, projecten, workflows, statuspagina's, dashboards | **Aantal entiteiten en geschiedenis**, niet het telemetrievolume. Groeit langzaam.             |
| **Redis**      | Cache, werkwachtrijen en sessies                                                                                          | **Wachtrijdiepte en actieve sessies**. Geheugengebonden en bescheiden. Geen bron van waarheid. |

Objectopslag (S3/MinIO) is **niet** vereist om OneUptime te laten draaien. Het wordt alleen optioneel gebruikt voor database-**backups** (via de CloudNativePG Barman-plugin voor PostgreSQL, of `clickhouse-backup` voor ClickHouse). OneUptime tiert telemetrie niet naar objectopslag — zie de sectie "Retentie en hoe het de opslag beïnvloedt" hieronder.

## ClickHouse — de dominante factor

Vrijwel al je opslag en een groot deel van je RAM gaat naar ClickHouse, omdat elke logregel, elk metric-punt, elke trace-span en elke exception daar leeft.

### Opslagformule

```
ClickHouse disk ≈ (daily raw telemetry GB ÷ compression) × retention days × replicas × 1.3 (headroom)
```

Compressie hangt af van het signaal:

- **Logs** comprimeren goed — ruwweg **5:1**.
- **Metrics** comprimeren minder — ruwweg **2:1** — en hoge label-**cardinaliteit** doet zowel schijf als RAM sneller opzwellen dan ruw volume. Houd labels laag-cardinaal.
- **Traces** zitten ertussenin, afhankelijk van de span-attributen.

### Uitgewerkt voorbeeld

Een fleet van **10 clusters**, elk met ~10 nodes / ~100 pods op INFO-niveau, produceert ruwweg **50–150 GB ruwe logs per cluster over 30 dagen** (≈ 1.7–5 GB/dag per cluster). Over het hele fleet, met metrics en traces erbij en na compressie, reken op ruwweg **5–15 GB/dag aan gecomprimeerde telemetrie**.

| Retentie | Enkele replica | 2 replicas + 30% headroom |
| -------- | -------------- | ------------------------- |
| 30 dagen | ~150–450 GB    | **~0.4–1.2 TB**           |
| 90 dagen | ~0.45–1.35 TB  | **~1.2–3.5 TB**           |

Opslag schaalt **lineair met de retentie** — een venster van 90 dagen kost ~3× een venster van 30 dagen.

### RAM en schijftype

- **Gebruik NVMe/SSD.** Telemetrie is schrijf-intensief met piekerige aggregatie-reads; ClickHouse op een spinning disk zal moeite hebben.
- **Geef ClickHouse ruim RAM.** Aggregatie-queries zijn geheugen-intensief. Als vuistregel: dimensioneer RAM op een betekenisvolle fractie (25–50%) van je _hot_ (recent bevraagde) gecomprimeerde dataset, met een praktische ondergrens van 16 GB voor elk echt productie-fleet.
- **Beheers metric-cardinaliteit.** Het is de allergrootste hefboom op zowel ClickHouse-RAM als -schijf. Handhaaf laag-cardinale labelconventies op de verzamellaag en houd het aantal actieve series in de gaten.

## PostgreSQL — configuratie en status

PostgreSQL slaat je configuratie en operationele status op, geen telemetrie, dus het groeit langzaam en blijft klein ten opzichte van ClickHouse. Zelfs grote deployments zitten doorgaans in de tientallen GB. Het standaardvolume van **25 Gi** is prima voor kleine installaties; reken op 50–100 GB voor grotere met headroom voor incident-/alert-geschiedenis.

Als je veel applicatie-, worker- en probe-replicas draait, kan het aantal databaseverbindingen het knelpunt worden voordat de opslag dat doet. De Helm-chart van OneUptime bevat een optionele **PgBouncer** connection pooler (`pgbouncer.enabled`) precies hiervoor — schakel het in voor deployments met veel replicas.

## Redis — cache, wachtrijen en sessies

Redis wordt gebruikt als cache, werkwachtrij en sessieopslag. Het is **geheugengebonden** en persistentie is **standaard uitgeschakeld** (Redis is hier geen bron van waarheid — het kan opnieuw worden opgebouwd). Dimensioneer het op de verwachte wachtrijdiepte en gelijktijdige sessies; 2–8 GB geheugen dekt de meeste deployments. Let op dat het standaard eviction-beleid `noeviction` is, dus als wachtrijen oplopen bij aanhoudende overbelasting, monitor dan het Redis-geheugen.

## Applicatiecompute

Naast de datastores dimensioneer je de stateless workloads (ingress, web/API, workers en probes). Alle staan standaard op **1 replica** zonder resource-limits — stel ze expliciet in. De chart bevat **KEDA** zodat workers en probes kunnen autoschalen op wachtrijdiepte; schakel het in voor variabele belasting. Workers schalen met het verwerkingsvolume van telemetrie/ingest, en probes schalen met het aantal actieve monitors.

## Startniveaus

Kies het niveau dat het dichtst bij jouw omgeving ligt als startpunt, houd vervolgens het werkelijke gebruik in de gaten (`kubectl top pods`, schijfgroei van ClickHouse/Postgres) en pas aan.

- **Small / PoC** — 1–3 clusters, ≤30 nodes, ≤5 GB/dag ruwe telemetrie, 30-daagse retentie.
- **Medium / Production fleet** — ~10 clusters, ~100 nodes, 10–30 GB/dag ruwe telemetrie, 30–90-daagse retentie.
- **Large / Multi-fleet** — 50+ clusters, 500+ nodes, 100+ GB/dag ruwe telemetrie, 90-daagse retentie.

|                         | Small / PoC                  | Medium / Production fleet    | Large / Multi-fleet                              |
| ----------------------- | ---------------------------- | ---------------------------- | ------------------------------------------------ |
| **ClickHouse**          | 4 vCPU / 16 GB / 200 GB NVMe | 8 vCPU / 32 GB / 1–3 TB NVMe | 16+ vCPU / 64–128 GB / 5–15 TB NVMe, **sharded** |
| **PostgreSQL**          | 2 vCPU / 4 GB / 50 GB SSD    | 4 vCPU / 8 GB / 100 GB SSD   | 8 vCPU / 16–32 GB / 250 GB SSD (+ PgBouncer)     |
| **Redis**               | 1 vCPU / 2 GB                | 2 vCPU / 4 GB                | 4 vCPU / 8–16 GB                                 |
| **Retentie aangenomen** | 30 dagen                     | 30–90 dagen                  | 90 dagen                                         |

Deze dimensioneren de OneUptime-**backend**. De OneUptime-collectors die op elke gemonitorde cluster draaien, worden apart gedimensioneerd — zie de sizing-niveaus van de [Kubernetes Agent](/docs/telemetry/kubernetes-agent).

## Hoge beschikbaarheid

De in de chart ingebouwde datastores draaien standaard als **enkele instanties**. Voor productie-HA:

- **PostgreSQL** — schakel de meegeleverde [CloudNativePG](https://cloudnative-pg.io)-operator in (`postgresOperator.cnpg.enabled`) met **3 instanties** (1 primary + 2 hot standbys) voor automatische failover.
- **ClickHouse** — schakel de meegeleverde [Altinity](https://github.com/Altinity/clickhouse-operator)-operator in (`clickhouseOperator.altinity.enabled`) met **≥2 replicas per shard** en **3 ClickHouse Keeper**-nodes voor quorum. Voeg shards toe zodra de schijf of het RAM van een enkele node de beperking wordt.
- **Redis** — de chart heeft geen replicatie binnen de chart. Wijs OneUptime voor HA naar een **extern beheerd Redis** (of een Sentinel-/cluster-deployment).

## Retentie en hoe het de opslag beïnvloedt

Telemetrie-retentie wordt afgedwongen als een **ClickHouse TTL geconfigureerd in dagen**, ingesteld **per project** en verfijnbaar **per signaal** (logs, metrics, traces, profiles) en per bucket (bijvoorbeeld op log-ernst). De hardcoded standaard is 15 dagen.

Omdat retentie de ClickHouse-opslag direct vermenigvuldigt, beslis je dit voordat je de schijf dimensioneert. OneUptime archiveert of tiert oude telemetrie **niet** automatisch naar objectopslag — voor meerjarige compliance-retentie verleng je het retentievenster en dimensioneer je de ClickHouse-opslag dienovereenkomstig (of exporteer je naar een extern archief naar keuze).

## Meet voordat je je vastlegt

Telemetrievolume varieert enorm met de log-uitgebreidheid van de applicatie, het aantal namespaces, het scrape-interval en of DEBUG-logging ergens is ingeschakeld. Behandel de bovenstaande niveaus als startpunten: **instrumenteer je omgeving gedurende minstens vier weken**, meet de werkelijke GB/dag per signaal en dimensioneer vervolgens retentie en opslag op basis van echte data.

## Gerelateerd

- [Docker Compose](/docs/installation/docker-compose) — single-server sizing
- [Self-Hosted Architecture](/docs/self-hosted/architecture) — hoe de componenten in elkaar passen
- [Kubernetes Agent](/docs/telemetry/kubernetes-agent) — collector (data-plane) sizing
- [Helm chart on Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

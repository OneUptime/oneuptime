# Dimensionering og kapacitetsplanlægning

Denne vejledning hjælper dig med at dimensionere en selvhostet OneUptime-installation på Kubernetes (Helm). Den dækker de tre datalagre, som OneUptime afhænger af — **PostgreSQL**, **Redis** og **ClickHouse** — plus applikationscomputerkraften, og giver dig udgangsniveauer, du kan justere, når du har rigtige tal.

> **Læs dette først:** Helm-charten leveres med **ingen CPU/hukommelses-requests eller -limits sat** og små **25 Gi** standardvolumener til PostgreSQL og ClickHouse. Disse standarder findes, så charten kan installeres og køre på enhver klynge — de er **ikke** produktionsdimensionering. Til alt ud over en hurtig prøve bør du sætte ressourcer og lagring eksplicit ved hjælp af tallene nedenfor.

Hvis du i stedet kører enkelt-server Docker Compose-installationen, er dimensionering enklere — se [Docker Compose](/docs/installation/docker-compose) (anbefalet: 16 GB RAM, 8 kerner, 400 GB disk).

## Hvad driver hvert datalager

OneUptime kræver tre datalagre i produktion. De skalerer på helt forskellige input, så dimensionér dem uafhængigt af hinanden.

| Datalager | Hvad det lagrer | Hvad der driver dets størrelse |
| --- | --- | --- |
| **ClickHouse** | Al telemetri — logs, metrics, traces, exceptions, profiler | Telemetri-**ingestionsrate × opbevaring**. Dette er ~95 % af din lagring og den dominerende omkostning. |
| **PostgreSQL** | Konfiguration og tilstand — monitorer, hændelser, alarmer, brugere, teams, projekter, workflows, statussider, dashboards | **Antal entiteter og historik**, ikke telemetri-volumen. Vokser langsomt. |
| **Redis** | Cache, arbejdskøer og sessioner | **Kødybde og aktive sessioner**. Hukommelsesbundet og beskeden. Ikke en kilde til sandhed. |

Objektlagring (S3/MinIO) er **ikke** påkrævet for, at OneUptime kan køre. Det bruges kun valgfrit til database**sikkerhedskopier** (via CloudNativePG Barman-plugin'et til PostgreSQL eller `clickhouse-backup` til ClickHouse). OneUptime flytter ikke telemetri i lag til objektlagring — se afsnittet "Opbevaring og hvordan den påvirker lagring" nedenfor.

## ClickHouse — den dominerende driver

Næsten al din lagring og en stor andel af din RAM vil gå til ClickHouse, fordi hver loglinje, hvert metrikpunkt, hvert trace-span og hver exception lever der.

### Lagringsformel

```
ClickHouse disk ≈ (daily raw telemetry GB ÷ compression) × retention days × replicas × 1.3 (headroom)
```

Komprimering afhænger af signalet:

- **Logs** komprimerer godt — cirka **5:1**.
- **Metrics** komprimerer mindre — cirka **2:1** — og høj label-**kardinalitet** oppuster både disk og RAM hurtigere end rå volumen gør. Hold labels lav-kardinale.
- **Traces** ligger midt imellem, afhængigt af span-attributter.

### Gennemregnet eksempel

En flåde på **10 klynger**, hver med ~10 noder / ~100 pods ved INFO-niveau-verbositet, producerer cirka **50–150 GB rå logs pr. klynge over 30 dage** (≈ 1,7–5 GB/dag pr. klynge). På tværs af flåden, med metrics og traces tilføjet og efter komprimering, kan du budgettere med cirka **5–15 GB/dag komprimeret telemetri**.

| Opbevaring | Enkelt replika | 2 replikaer + 30 % headroom |
| --- | --- | --- |
| 30 dage | ~150–450 GB | **~0.4–1.2 TB** |
| 90 dage | ~0.45–1.35 TB | **~1.2–3.5 TB** |

Lagring skalerer **lineært med opbevaring** — et 90-dages vindue koster ~3× et 30-dages vindue.

### RAM og disktype

- **Brug NVMe/SSD.** Telemetri er skrivetung med stødvise aggregeringslæsninger; ClickHouse på roterende disk vil have det svært.
- **Giv ClickHouse rigelig RAM.** Aggregeringsforespørgsler er hukommelsesintensive. Som tommelfingerregel skal du dimensionere RAM til en betydelig brøkdel (25–50 %) af dit *varme* (nyligt forespurgte) komprimerede datasæt, med et praktisk minimum på 16 GB for enhver reel produktionsflåde.
- **Hold styr på metrik-kardinalitet.** Det er den enkeltstørste løftestang på både ClickHouse RAM og disk. Håndhæv lav-kardinale label-konventioner i indsamlingslaget og hold øje med antallet af aktive serier.

## PostgreSQL — konfiguration og tilstand

PostgreSQL lagrer din konfiguration og driftstilstand, ikke telemetri, så det vokser langsomt og forbliver lille i forhold til ClickHouse. Selv store installationer er typisk i størrelsesordenen tiere af GB. Standardvolumen på **25 Gi** er fin til små installationer; planlæg 50–100 GB til større med headroom til hændelses-/alarmhistorik.

Hvis du kører mange applikations-, worker- og probe-replikaer, kan antallet af databaseforbindelser blive flaskehalsen, før lagring gør det. OneUptimes Helm-chart inkluderer en valgfri **PgBouncer** forbindelses-pooler (`pgbouncer.enabled`) til netop dette — aktivér den til installationer med mange replikaer.

## Redis — cache, køer og sessioner

Redis bruges som cache, arbejdskø og session-lager. Det er **hukommelsesbundet**, og persistens er **deaktiveret som standard** (Redis er her ikke en kilde til sandhed — det kan genopbygges). Dimensionér det efter forventet kødybde og samtidige sessioner; 2–8 GB hukommelse dækker de fleste installationer. Bemærk, at standard-eviction-politikken er `noeviction`, så hvis køer hober sig op under vedvarende overbelastning, bør du overvåge Redis-hukommelsen.

## Applikationscomputerkraft

Ud over datalagrene skal du dimensionere de tilstandsløse arbejdsbelastninger (ingress, web/API, workers og probes). Alle har som standard **1 replika** uden ressourcegrænser — sæt dem eksplicit. Charten medfølger med **KEDA**, så workers og probes kan autoskalere på kødybde; aktivér det til variabel belastning. Workers skalerer med telemetri-/ingestionsbehandlingsvolumen, og probes skalerer med antallet af aktive monitorer.

## Udgangsniveauer

Vælg det niveau, der er tættest på dit miljø, som udgangspunkt, og hold derefter øje med det faktiske forbrug (`kubectl top pods`, ClickHouse/Postgres diskvækst) og justér.

- **Small / PoC** — 1–3 klynger, ≤30 noder, ≤5 GB/dag rå telemetri, 30-dages opbevaring.
- **Medium / Production fleet** — ~10 klynger, ~100 noder, 10–30 GB/dag rå telemetri, 30–90-dages opbevaring.
- **Large / Multi-fleet** — 50+ klynger, 500+ noder, 100+ GB/dag rå telemetri, 90-dages opbevaring.

| | Small / PoC | Medium / Production fleet | Large / Multi-fleet |
| --- | --- | --- | --- |
| **ClickHouse** | 4 vCPU / 16 GB / 200 GB NVMe | 8 vCPU / 32 GB / 1–3 TB NVMe | 16+ vCPU / 64–128 GB / 5–15 TB NVMe, **sharded** |
| **PostgreSQL** | 2 vCPU / 4 GB / 50 GB SSD | 4 vCPU / 8 GB / 100 GB SSD | 8 vCPU / 16–32 GB / 250 GB SSD (+ PgBouncer) |
| **Redis** | 1 vCPU / 2 GB | 2 vCPU / 4 GB | 4 vCPU / 8–16 GB |
| **Retention assumed** | 30 dage | 30–90 dage | 90 dage |

Disse dimensionerer OneUptime-**backend'en**. OneUptime-collectorerne, der kører på hver overvåget klynge, dimensioneres separat — se dimensioneringsniveauerne for [Kubernetes Agent](/docs/telemetry/kubernetes-agent).

## Høj tilgængelighed

Chartens indbyggede datalagre kører som **enkeltinstanser** som standard. For produktions-HA:

- **PostgreSQL** — aktivér den medfølgende [CloudNativePG](https://cloudnative-pg.io)-operator (`postgresOperator.cnpg.enabled`) med **3 instanser** (1 primær + 2 varme standbys) for automatisk failover.
- **ClickHouse** — aktivér den medfølgende [Altinity](https://github.com/Altinity/clickhouse-operator)-operator (`clickhouseOperator.altinity.enabled`) med **≥2 replikaer pr. shard** og **3 ClickHouse Keeper**-noder for quorum. Tilføj shards, når en enkelt nodes disk eller RAM bliver begrænsningen.
- **Redis** — charten har ingen replikering i charten. For HA skal du pege OneUptime mod en **ekstern administreret Redis** (eller en Sentinel/cluster-installation).

## Opbevaring og hvordan den påvirker lagring

Telemetri-opbevaring håndhæves som en **ClickHouse TTL konfigureret i dage**, sat **pr. projekt** og forfinelig **pr. signal** (logs, metrics, traces, profiler) og pr. bucket (for eksempel efter log-sværhedsgrad). Den hardkodede standard er 15 dage.

Fordi opbevaring direkte multiplicerer ClickHouse-lagring, bør du beslutte den, før du dimensionerer disk. OneUptime arkiverer eller lagdeler **ikke** automatisk gammel telemetri til objektlagring — for flerårig compliance-opbevaring skal du udvide opbevaringsvinduet og dimensionere ClickHouse-lagring til at matche (eller eksportere til et eksternt arkiv efter eget valg).

## Mål, før du forpligter dig

Telemetri-volumen varierer enormt med applikationens log-verbositet, antal namespaces, scrape-interval og hvorvidt DEBUG-logning er aktiveret nogetsteds. Behandl niveauerne ovenfor som udgangspunkter: **instrumentér dit miljø i mindst fire uger**, mål den faktiske GB/dag pr. signal, og dimensionér derefter opbevaring og lagring ud fra rigtige data.

## Relateret

- [Docker Compose](/docs/installation/docker-compose) — enkelt-server dimensionering
- [Selvhostet arkitektur](/docs/self-hosted/architecture) — hvordan komponenterne passer sammen
- [Kubernetes Agent](/docs/telemetry/kubernetes-agent) — collector (data-plane) dimensionering
- [Helm-chart på Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

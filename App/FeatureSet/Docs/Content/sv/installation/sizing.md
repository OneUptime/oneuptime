# Dimensionering och kapacitetsplanering

Den här guiden hjälper dig att dimensionera en självhostad OneUptime-distribution på Kubernetes (Helm). Den täcker de tre datalagren som OneUptime är beroende av — **PostgreSQL**, **Redis** och **ClickHouse** — plus applikationens beräkningskraft, och ger startnivåer som du kan justera när du har verkliga siffror.

> **Läs detta först:** Helm-charten levereras med **inga CPU-/minnesförfrågningar eller -gränser inställda** och små **25 Gi** standardvolymer för PostgreSQL och ClickHouse. Dessa standardvärden finns för att charten ska kunna installeras och köras på vilket kluster som helst — de är **inte** produktionsdimensionering. För allt utöver en snabb testkörning ska du ange resurser och lagring explicit med hjälp av siffrorna nedan.

Om du i stället kör enserversinstallationen med Docker Compose är dimensioneringen enklare — se [Docker Compose](/docs/installation/docker-compose) (rekommenderat: 16 GB RAM, 8 kärnor, 400 GB disk).

## Vad som styr varje datalager

OneUptime kräver tre datalager i produktion. De skalar utifrån helt olika indata, så dimensionera dem oberoende av varandra.

| Datalager      | Vad det lagrar                                                                                                             | Vad som styr dess storlek                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **ClickHouse** | All telemetri — loggar, metrik, spårningar, undantag, profiler                                                             | Telemetrins **inmatningstakt × retention**. Detta är ~95 % av din lagring och den dominerande kostnaden. |
| **PostgreSQL** | Konfiguration och tillstånd — monitorer, incidenter, larm, användare, team, projekt, arbetsflöden, statussidor, dashboards | **Antal entiteter och historik**, inte telemetrivolym. Växer långsamt.                                   |
| **Redis**      | Cache, arbetsköer och sessioner                                                                                            | **Ködjup och aktiva sessioner**. Minnesbundet och blygsamt. Inte en sanningskälla.                       |

Objektlagring (S3/MinIO) krävs **inte** för att OneUptime ska köras. Den används endast valfritt för databas**säkerhetskopior** (via CloudNativePG Barman-plugin för PostgreSQL, eller `clickhouse-backup` för ClickHouse). OneUptime nivåindelar inte telemetri till objektlagring — se avsnittet "Retention och hur det påverkar lagring" nedan.

## ClickHouse — den dominerande drivkraften

Nästan all din lagring och en stor del av ditt RAM går till ClickHouse, eftersom varje loggrad, metrikpunkt, spårningsspann och undantag finns där.

### Lagringsformel

```
ClickHouse disk ≈ (daily raw telemetry GB ÷ compression) × retention days × replicas × 1.3 (headroom)
```

Komprimering beror på signalen:

- **Loggar** komprimeras bra — ungefär **5:1**.
- **Metrik** komprimeras sämre — ungefär **2:1** — och hög etikett**kardinalitet** blåser upp både disk och RAM snabbare än vad rå volym gör. Håll etiketter lågkardinella.
- **Spårningar** ligger däremellan, beroende på spannattribut.

### Genomarbetat exempel

En flotta med **10 kluster**, vart och ett med ~10 noder / ~100 poddar vid INFO-nivåns utförlighet, producerar ungefär **50–150 GB rådata-loggar per kluster över 30 dagar** (≈ 1,7–5 GB/dag per kluster). Över hela flottan, med metrik och spårningar tillagda och efter komprimering, budgetera ungefär **5–15 GB/dag komprimerad telemetri**.

| Retention | Enkel replika | 2 replikor + 30 % headroom |
| --------- | ------------- | -------------------------- |
| 30 days   | ~150–450 GB   | **~0.4–1.2 TB**            |
| 90 days   | ~0.45–1.35 TB | **~1.2–3.5 TB**            |

Lagring skalar **linjärt med retention** — ett 90-dagarsfönster kostar ~3× ett 30-dagarsfönster.

### RAM och disktyp

- **Använd NVMe/SSD.** Telemetri är skrivintensiv med stötvisa aggregeringsläsningar; ClickHouse på snurrande disk kommer att kämpa.
- **Ge ClickHouse generöst med RAM.** Aggregeringsfrågor är minnesintensiva. Som tumregel, dimensionera RAM till en betydande andel (25–50 %) av din _heta_ (nyligen frågade) komprimerade datamängd, med ett praktiskt golv på 16 GB för varje verklig produktionsflotta.
- **Övervaka metrikkardinalitet.** Det är den enskilt största spaken på både ClickHouse-RAM och -disk. Tillämpa lågkardinella etikettkonventioner i insamlingslagret och håll koll på antalet aktiva serier.

## PostgreSQL — konfiguration och tillstånd

PostgreSQL lagrar din konfiguration och ditt driftstillstånd, inte telemetri, så den växer långsamt och förblir liten i förhållande till ClickHouse. Även stora distributioner ligger vanligtvis på tiotals GB. Standardvolymen på **25 Gi** är tillräcklig för små installationer; planera 50–100 GB för större med headroom för incident-/larmhistorik.

Om du kör många applikations-, arbetar- och probe-replikor kan antalet databasanslutningar bli flaskhalsen innan lagringen blir det. OneUptimes Helm-chart innehåller en valfri **PgBouncer**-anslutningspoolare (`pgbouncer.enabled`) just för detta — aktivera den för distributioner med många replikor.

## Redis — cache, köer och sessioner

Redis används som cache, arbetskö och sessionslager. Den är **minnesbunden** och persistens är **inaktiverad som standard** (Redis här är inte en sanningskälla — den kan byggas om). Dimensionera den efter förväntat ködjup och antal samtidiga sessioner; 2–8 GB minne täcker de flesta distributioner. Observera att standardpolicyn för borttagning är `noeviction`, så om köer hopar sig vid ihållande överbelastning, övervaka Redis-minnet.

## Applikationens beräkningskraft

Utöver datalagren, dimensionera de tillståndslösa arbetslasterna (ingress, webb/API, arbetare och probes). Alla har som standard **1 replika** utan resursgränser — ange dem explicit. Charten inkluderar **KEDA** så att arbetare och probes kan autoskala utifrån ködjup; aktivera det för varierande belastning. Arbetare skalar med bearbetningsvolymen för telemetri/inmatning, och probes skalar med antalet aktiva monitorer.

## Startnivåer

Välj den nivå som ligger närmast din miljö som utgångspunkt, övervaka sedan faktisk användning (`kubectl top pods`, disktillväxt för ClickHouse/Postgres) och justera.

- **Liten / PoC** — 1–3 kluster, ≤30 noder, ≤5 GB/dag rådata-telemetri, 30-dagars retention.
- **Medium / Produktionsflotta** — ~10 kluster, ~100 noder, 10–30 GB/dag rådata-telemetri, 30–90-dagars retention.
- **Stor / Multiflotta** — 50+ kluster, 500+ noder, 100+ GB/dag rådata-telemetri, 90-dagars retention.

|                       | Liten / PoC                  | Medium / Produktionsflotta   | Stor / Multiflotta                               |
| --------------------- | ---------------------------- | ---------------------------- | ------------------------------------------------ |
| **ClickHouse**        | 4 vCPU / 16 GB / 200 GB NVMe | 8 vCPU / 32 GB / 1–3 TB NVMe | 16+ vCPU / 64–128 GB / 5–15 TB NVMe, **shardad** |
| **PostgreSQL**        | 2 vCPU / 4 GB / 50 GB SSD    | 4 vCPU / 8 GB / 100 GB SSD   | 8 vCPU / 16–32 GB / 250 GB SSD (+ PgBouncer)     |
| **Redis**             | 1 vCPU / 2 GB                | 2 vCPU / 4 GB                | 4 vCPU / 8–16 GB                                 |
| **Retention assumed** | 30 days                      | 30–90 days                   | 90 days                                          |

Dessa dimensionerar OneUptime-**backend**. OneUptime-collectorerna som körs på varje övervakat kluster dimensioneras separat — se dimensioneringsnivåerna för [Kubernetes-agenten](/docs/telemetry/kubernetes-agent).

## Hög tillgänglighet

Chartens inbyggda datalager körs som **enskilda instanser** som standard. För produktions-HA:

- **PostgreSQL** — aktivera den medföljande [CloudNativePG](https://cloudnative-pg.io)-operatorn (`postgresOperator.cnpg.enabled`) med **3 instanser** (1 primär + 2 heta standbyenheter) för automatisk failover.
- **ClickHouse** — aktivera den medföljande [Altinity](https://github.com/Altinity/clickhouse-operator)-operatorn (`clickhouseOperator.altinity.enabled`) med **≥2 replikor per shard** och **3 ClickHouse Keeper**-noder för kvorum. Lägg till shards när en enskild nods disk eller RAM blir begränsningen.
- **Redis** — charten har ingen replikering inbyggd i charten. För HA, peka OneUptime mot ett **externt hanterat Redis** (eller en Sentinel-/klusterdistribution).

## Retention och hur det påverkar lagring

Telemetriretention tillämpas som en **ClickHouse TTL konfigurerad i dagar**, satt **per projekt** och justerbar **per signal** (loggar, metrik, spårningar, profiler) och per hink (till exempel efter loggallvarlighet). Det hårdkodade standardvärdet är 15 dagar.

Eftersom retention direkt multiplicerar ClickHouse-lagringen, bestäm den innan du dimensionerar disk. OneUptime arkiverar eller nivåindelar **inte** automatiskt gammal telemetri till objektlagring — för flerårig efterlevnadsretention, förläng retentionsfönstret och dimensionera ClickHouse-lagringen därefter (eller exportera till ett externt arkiv som du själv väljer).

## Mät innan du binder dig

Telemetrivolymen varierar enormt med applikationens loggutförlighet, antal namnrymder, scrape-intervall och om DEBUG-loggning är aktiverad någonstans. Behandla nivåerna ovan som utgångspunkter: **instrumentera din miljö i minst fyra veckor**, mät faktiskt GB/dag per signal, och dimensionera sedan retention och lagring utifrån verkliga data.

## Relaterat

- [Docker Compose](/docs/installation/docker-compose) — enserversdimensionering
- [Självhostad arkitektur](/docs/self-hosted/architecture) — hur komponenterna passar ihop
- [Kubernetes-agenten](/docs/telemetry/kubernetes-agent) — dimensionering av collector (dataplan)
- [Helm-chart på Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

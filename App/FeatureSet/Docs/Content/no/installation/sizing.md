# Dimensjonering og kapasitetsplanlegging

Denne veiledningen hjelper deg med å dimensjonere en selvhostet OneUptime-distribusjon på Kubernetes (Helm). Den dekker de tre datalagrene OneUptime er avhengig av — **PostgreSQL**, **Redis** og **ClickHouse** — i tillegg til applikasjonsberegningen, og gir startnivåer du kan justere når du har reelle tall.

> **Les dette først:** Helm-charten leveres med **ingen CPU-/minneforespørsler eller -grenser satt** og små **25 Gi** standardvolumer for PostgreSQL og ClickHouse. Disse standardene finnes for at charten skal installere og kjøre på enhver klynge — de er **ikke** produksjonsdimensjonering. For alt utover en rask prøvekjøring bør du sette ressurser og lagring eksplisitt ved hjelp av tallene nedenfor.

Hvis du i stedet kjører enkeltserver-installasjonen med Docker Compose, er dimensjonering enklere — se [Docker Compose](/docs/installation/docker-compose) (anbefalt: 16 GB RAM, 8 kjerner, 400 GB disk).

## Hva som driver hvert datalager

OneUptime krever tre datalagre i produksjon. De skalerer på helt forskjellige inndata, så dimensjoner dem uavhengig.

| Datalager      | Hva det lagrer                                                                                                             | Hva som driver størrelsen                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **ClickHouse** | All telemetri — logger, metrikker, sporinger, unntak, profiler                                                             | Telemetri-**inntaksrate × oppbevaring**. Dette er ~95 % av lagringen din og den dominerende kostnaden. |
| **PostgreSQL** | Konfigurasjon og tilstand — monitorer, hendelser, varsler, brukere, team, prosjekter, arbeidsflyter, statussider, dashbord | **Antall entiteter og historikk**, ikke telemetrivolum. Vokser sakte.                                  |
| **Redis**      | Cache, arbeidskøer og økter                                                                                                | **Kødybde og aktive økter**. Minnebundet og beskjedent. Ikke en kilde til sannhet.                     |

Objektlagring (S3/MinIO) er **ikke** påkrevd for at OneUptime skal kjøre. Den brukes kun valgfritt for database-**sikkerhetskopier** (via CloudNativePG Barman-pluginen for PostgreSQL, eller `clickhouse-backup` for ClickHouse). OneUptime nivådeler ikke telemetri til objektlagring — se avsnittet "Oppbevaring og hvordan det påvirker lagring" nedenfor.

## ClickHouse — den dominerende driveren

Nesten all lagringen din og en stor andel av RAM-en din vil gå til ClickHouse, fordi hver loggrad, hvert metrikkpunkt, hver sporings-span og hvert unntak lever der.

### Lagringsformel

```
ClickHouse disk ≈ (daily raw telemetry GB ÷ compression) × retention days × replicas × 1.3 (headroom)
```

Komprimering avhenger av signalet:

- **Logger** komprimeres godt — omtrent **5:1**.
- **Metrikker** komprimeres mindre — omtrent **2:1** — og høy etikett-**kardinalitet** blåser opp både disk og RAM raskere enn rå volum gjør. Hold etiketter lavkardinalitet.
- **Sporinger** ligger imellom, avhengig av span-attributter.

### Gjennomarbeidet eksempel

En flåte på **10 klynger**, hver ~10 noder / ~100 pods ved INFO-nivå-detaljgrad, produserer omtrent **50–150 GB rå logger per klynge over 30 dager** (≈ 1.7–5 GB/dag per klynge). På tvers av flåten, med metrikker og sporinger lagt til og etter komprimering, budsjetter omtrent **5–15 GB/dag komprimert telemetri**.

| Oppbevaring | Enkelt replika | 2 replikaer + 30 % slingringsmonn |
| ----------- | -------------- | --------------------------------- |
| 30 days     | ~150–450 GB    | **~0.4–1.2 TB**                   |
| 90 days     | ~0.45–1.35 TB  | **~1.2–3.5 TB**                   |

Lagring skalerer **lineært med oppbevaring** — et 90-dagers vindu koster ~3× et 30-dagers vindu.

### RAM og disktype

- **Bruk NVMe/SSD.** Telemetri er skrivetung med rykkvise aggregeringslesinger; ClickHouse på roterende disk vil slite.
- **Gi ClickHouse rikelig med RAM.** Aggregeringsspørringer er minneintensive. Som en tommelfingerregel, dimensjoner RAM til en meningsfull andel (25–50 %) av ditt _varme_ (nylig spurte) komprimerte datasett, med et praktisk gulv på 16 GB for enhver reell produksjonsflåte.
- **Hold metrikk-kardinalitet i sjakk.** Det er den enkeltstående største spaken på både ClickHouse RAM og disk. Håndhev lavkardinalitets-etikettkonvensjoner på innsamlingslaget og overvåk antall aktive serier.

## PostgreSQL — konfigurasjon og tilstand

PostgreSQL lagrer konfigurasjonen og driftstilstanden din, ikke telemetri, så den vokser sakte og holder seg liten i forhold til ClickHouse. Selv store distribusjoner er typisk i titalls GB. Standardvolumet på **25 Gi** er greit for små installasjoner; planlegg 50–100 GB for større med slingringsmonn for hendelses-/varselhistorikk.

Hvis du kjører mange applikasjons-, arbeider- og probe-replikaer, kan antallet databasekoblinger bli flaskehalsen før lagringen gjør det. OneUptimes Helm-chart inkluderer en valgfri **PgBouncer** koblingspooler (`pgbouncer.enabled`) for nettopp dette — aktiver den for distribusjoner med mange replikaer.

## Redis — cache, køer og økter

Redis brukes som en cache, en arbeidskø og et øktlager. Den er **minnebundet** og persistens er **deaktivert som standard** (Redis her er ikke en kilde til sannhet — den kan bygges på nytt). Dimensjoner den etter forventet kødybde og samtidige økter; 2–8 GB minne dekker de fleste distribusjoner. Merk at standard utkastelsespolicy er `noeviction`, så hvis køer hoper seg opp under vedvarende overbelastning, overvåk Redis-minne.

## Applikasjonsberegning

Utover datalagrene, dimensjoner de tilstandsløse arbeidsbelastningene (ingress, web/API, arbeidere og prober). Alle settes som standard til **1 replika** uten ressursgrenser — sett dem eksplisitt. Charten inkluderer **KEDA** slik at arbeidere og prober kan autoskalere på kødybde; aktiver den for variabel belastning. Arbeidere skalerer med telemetri-/inntaksbehandlingsvolum, og prober skalerer med antallet aktive monitorer.

## Startnivåer

Velg nivået nærmest miljøet ditt som utgangspunkt, og overvåk deretter faktisk bruk (`kubectl top pods`, ClickHouse-/Postgres-diskvekst) og juster.

- **Liten / PoC** — 1–3 klynger, ≤30 noder, ≤5 GB/dag rå telemetri, 30-dagers oppbevaring.
- **Middels / Produksjonsflåte** — ~10 klynger, ~100 noder, 10–30 GB/dag rå telemetri, 30–90-dagers oppbevaring.
- **Stor / Multi-flåte** — 50+ klynger, 500+ noder, 100+ GB/dag rå telemetri, 90-dagers oppbevaring.

|                        | Liten / PoC                  | Middels / Produksjonsflåte   | Stor / Multi-flåte                               |
| ---------------------- | ---------------------------- | ---------------------------- | ------------------------------------------------ |
| **ClickHouse**         | 4 vCPU / 16 GB / 200 GB NVMe | 8 vCPU / 32 GB / 1–3 TB NVMe | 16+ vCPU / 64–128 GB / 5–15 TB NVMe, **shardet** |
| **PostgreSQL**         | 2 vCPU / 4 GB / 50 GB SSD    | 4 vCPU / 8 GB / 100 GB SSD   | 8 vCPU / 16–32 GB / 250 GB SSD (+ PgBouncer)     |
| **Redis**              | 1 vCPU / 2 GB                | 2 vCPU / 4 GB                | 4 vCPU / 8–16 GB                                 |
| **Oppbevaring antatt** | 30 days                      | 30–90 days                   | 90 days                                          |

Disse dimensjonerer OneUptime-**backend**. OneUptime-innsamlerne som kjører på hver overvåket klynge dimensjoneres separat — se dimensjoneringsnivåene for [Kubernetes Agent](/docs/telemetry/kubernetes-agent).

## Høy tilgjengelighet

Chartens innebygde datalagre kjører som **enkeltinstanser** som standard. For produksjons-HA:

- **PostgreSQL** — aktiver den medfølgende [CloudNativePG](https://cloudnative-pg.io)-operatoren (`postgresOperator.cnpg.enabled`) med **3 instanser** (1 primær + 2 varme standby-er) for automatisk failover.
- **ClickHouse** — aktiver den medfølgende [Altinity](https://github.com/Altinity/clickhouse-operator)-operatoren (`clickhouseOperator.altinity.enabled`) med **≥2 replikaer per shard** og **3 ClickHouse Keeper**-noder for kvorum. Legg til shards når en enkelt nodes disk eller RAM blir begrensningen.
- **Redis** — charten har ingen replikering innebygd i charten. For HA, pek OneUptime mot en **ekstern administrert Redis** (eller en Sentinel-/klyngedistribusjon).

## Oppbevaring og hvordan det påvirker lagring

Telemetri-oppbevaring håndheves som en **ClickHouse TTL konfigurert i dager**, satt **per prosjekt** og kan finjusteres **per signal** (logger, metrikker, sporinger, profiler) og per bøtte (for eksempel etter loggalvorlighetsgrad). Den hardkodede standarden er 15 dager.

Fordi oppbevaring direkte multipliserer ClickHouse-lagring, bestem den før du dimensjonerer disk. OneUptime arkiverer eller nivådeler **ikke** automatisk gammel telemetri til objektlagring — for flerårig samsvarsoppbevaring, utvid oppbevaringsvinduet og dimensjoner ClickHouse-lagring deretter (eller eksporter til et eksternt arkiv etter eget valg).

## Mål før du forplikter deg

Telemetrivolum varierer enormt med applikasjonens loggdetaljgrad, antall navnerom, skrapeintervall, og om DEBUG-logging er aktivert noe sted. Behandle nivåene ovenfor som utgangspunkt: **instrumenter miljøet ditt i minst fire uker**, mål faktisk GB/dag per signal, og dimensjoner deretter oppbevaring og lagring fra reelle data.

## Relatert

- [Docker Compose](/docs/installation/docker-compose) — enkeltserver-dimensjonering
- [Selvhostet arkitektur](/docs/self-hosted/architecture) — hvordan komponentene passer sammen
- [Kubernetes Agent](/docs/telemetry/kubernetes-agent) — innsamler- (dataplan-) dimensjonering
- [Helm-chart på Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

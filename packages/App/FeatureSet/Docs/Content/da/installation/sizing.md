# Dimensionering og kapacitetsplanlægning

Planlæg CPU, hukommelse og disk til en selvhostet OneUptime på Kubernetes med [Helm-chartet](https://artifacthub.io/packages/helm/oneuptime/oneuptime). Dimensionér de tre datalagre – **ClickHouse**, **PostgreSQL** og **Valkey** – og applikationen hver for sig, start fra et af niveauerne nedenfor, og justér, når du har rigtige tal.

> [!IMPORTANT]
> Chartets standardværdier er ikke en produktionsdimensionering. Bortset fra Valkey sætter de tjenester, det kører som standard, **ingen CPU- eller hukommelses-requests eller -grænser**, og PostgreSQL og ClickHouse får små volumener på **25 Gi**, så chartet kan installeres på ethvert cluster. Til alt ud over en prøve sætter du selv ressourcer og lager med tallene på denne side.

Kører du i stedet Docker Compose-installationen på en enkelt server? Den er enklere at dimensionere: Se [kravene](/docs/installation/docker-compose#krav) (16 GB hukommelse, 8 kerner og 400 GB disk anbefales).

:::cards
- [Hvad der får hvert datalager til at vokse](#hvad-der-får-hvert-datalager-til-at-vokse): Tre lagre, der vokser med tre forskellige ting.
- [Startniveauer](#startniveauer): Små, mellemstore og store udgangspunkter.
- [Høj tilgængelighed](#høj-tilgængelighed): Replikaer og failover for hvert datalager.
- [Opbevaring](#opbevaring-og-hvordan-den-påvirker-lageret): Indstillingen, der ganger din disk.
:::

## Dimensionér din installation

:::steps
1. Find ud af, hvor meget telemetri du sender: antal GB logs, metrikker og traces om dagen. Mål det på en lille installation, hvis du kan.
2. Beslut, hvor mange dage du vil gemme det. Opbevaringen ganger ClickHouses disk (se [Opbevaring](#opbevaring-og-hvordan-den-påvirker-lageret)).
3. Beregn ClickHouses disk med [lagerformlen](#lagerformel) og derefter PostgreSQL's og Valkeys ud fra deres egne afsnit.
4. Vælg det [startniveau](#startniveauer), der ligger tættest på dine tal, og sæt dets CPU, hukommelse og lager i dine Helm-values.
5. Slå [høj tilgængelighed](#høj-tilgængelighed) til for de datalagre, der har brug for det, og følg så det faktiske forbrug og justér.
:::

## Hvad der får hvert datalager til at vokse

OneUptime skal bruge tre datalagre i produktion. Hvert vokser med noget forskelligt, så dimensionér dem uafhængigt af hinanden.

```mermaid title="Hvad hvert datalager vokser med"
flowchart TB
    Tel["Logs, metrikker,<br/>traces"] -->|"indtagelseshastighed<br/>× opbevaring"| CH[("ClickHouse")]
    State["Monitorer,<br/>hændelser,<br/>brugere"] -->|"antal objekter<br/>og historik"| PG[("PostgreSQL")]
    Work["Køer, cache,<br/>sessioner"] -->|"kødybde"| VK[("Valkey")]
```

| Datalager | Hvad det gemmer | Hvad der bestemmer størrelsen |
| --- | --- | --- |
| **ClickHouse** | Al telemetri – logs, metrikker, traces, exceptions, profiler | Telemetri: **indtagelseshastighed × opbevaring**. Det er ~95 % af dit lager og den største omkostning. |
| **PostgreSQL** | Konfiguration og tilstand – monitorer, hændelser, alarmer, brugere, teams, projekter, arbejdsgange, statussider, dashboards | **Antal objekter og historik**, ikke telemetrimængden. Vokser langsomt. |
| **Valkey** | Cache, arbejdskøer og sessioner | **Kødybde og aktive sessioner**. Hukommelsesbundet og beskedent. Ikke en autoritativ datakilde. |

OneUptime har aldrig brug for objektlager (S3, MinIO) for at køre, og det flytter ikke ældre telemetri til objektlager. Du skal kun bruge objektlager, hvis du vælger backups til objektlager: Barman Cloud-pluginet til CloudNativePG eller [clickhouse-backup](https://github.com/Altinity/clickhouse-backup) til ClickHouse. Chartets egen CloudNativePG-backup (`postgresOperator.cnpg.backup`) tager volumen-snapshots og kræver intet objektlager. CloudNativePG sletter aldrig gamle snapshots: Ryd selv op i dem, ellers bliver de ved med at vokse.

## ClickHouse – den største faktor

Næsten hele dit lager og en stor del af din hukommelse går til ClickHouse, fordi hver loglinje, hvert metrikpunkt, hvert trace-span og hver exception ligger der.

### Lagerformel

```text
ClickHouse disk ≈ (daily raw telemetry GB ÷ compression) × retention days × replicas × 1.3 (headroom)
```

Komprimeringen afhænger af signalet:

| Signal | Typisk komprimering | Hvad der ændrer den |
| --- | --- | --- |
| Logs | Cirka 5:1 | Logs komprimeres godt. |
| Metrikker | Cirka 2:1 | Høj **kardinalitet** af labels puster disk og hukommelse hurtigere op end den rå mængde. Hold kardinaliteten af labels lav. |
| Traces | Midt imellem | De span-attributter, du sender. |

### Regneeksempel

En flåde på **10 clustere**, hver med cirka 10 noder og 100 pods, der logger på INFO-niveau, producerer groft regnet **50–150 GB rå logs pr. cluster over 30 dage** (cirka 1,7–5 GB om dagen pr. cluster). For hele flåden, med metrikker og traces lagt til og efter komprimering, så budgettér med groft regnet **5–15 GB komprimeret telemetri om dagen**.

| Opbevaring | Én replika | 2 replikaer + 30 % reserve |
| --- | --- | --- |
| 30 dage | ~150–450 GB | **~0,4–1,2 TB** |
| 90 dage | ~0,45–1,35 TB | **~1,2–3,5 TB** |

Lageret vokser **lineært med opbevaringen**: Et vindue på 90 dage koster cirka tre gange så meget som et på 30.

### Hukommelse og disktype

- **Brug NVMe eller SSD.** Telemetri er skrivetung med udbrud af aggregeringslæsninger; ClickHouse har det svært på roterende diske.
- **Giv ClickHouse rigeligt med hukommelse.** Aggregeringsforespørgsler bruger meget hukommelse. Som tommelfingerregel dimensionerer du hukommelsen til 25–50 % af dine *varme* (nyligt forespurgte) komprimerede data, med en praktisk nedre grænse på 16 GB for enhver rigtig produktionsflåde.
- **Hold styr på metrikkernes kardinalitet.** Den er den største enkeltstående løftestang for både ClickHouses hukommelse og disk. Håndhæv labelkonventioner med lav kardinalitet, hvor du indsamler metrikker, og hold øje med antallet af aktive serier.

## PostgreSQL – konfiguration og tilstand

PostgreSQL gemmer din konfiguration og driftstilstand, ikke telemetri, så det vokser langsomt og forbliver lille ved siden af ClickHouse. Selv store installationer ligger typisk i titalsvis af GB. Standardvolumenet på **25 Gi** er fint til små installationer; planlæg 50–100 GB til større, med plads til historikken for hændelser og alarmer.

Løste hændelser og advarsler bliver, indtil hvert projekt vælger, hvor længe de skal beholdes. For at holde alle projekter til en grænse skal du indstille **Behold i højst** under **Admin Dashboard → Indstillinger → Server → Dataopbevaring**: Se [En grænse for hele serveren](/docs/incidents/settings#en-grænse-for-hele-serveren).

Med mange replikaer af app, workers og sonder kan databaseforbindelserne slippe op før lageret. Hver pod åbner som standard op til 50 forbindelser, og det medfølgende PostgreSQL tillader 500. Netop derfor indeholder chartet en valgfri connection pooler, **PgBouncer** (`pgbouncer.enabled`): Slå den til for installationer med mange replikaer.

## Valkey – cache, køer og sessioner

Cachelaget kører [Valkey](https://valkey.io), det BSD-licenserede fork af Redis 7.2, som cache, arbejdskø og sessionslager. Enhver server med Redis-protokollen kan træde i stedet, og dimensioneringen nedenfor gælder begge veje. Det er **hukommelsesbundet**, og persistens er **slået fra som standard**: Det er ikke en autoritativ datakilde og kan genopbygges. Dimensionér det efter kødybde og samtidige sessioner; 2–8 GB hukommelse dækker de fleste installationer. Chartet giver det en hukommelsesgrænse på 4 Gi og begrænser dets data til 75 % af den, 3 GiB (`valkey.maxmemory`), hvor det afviser skrivninger. Dets eviction-politik er `noeviction`, så hold øje med hukommelsen, hvis køer hober sig op under vedvarende belastning.

## Applikationens regnekraft

Ud over datalagrene dimensionerer du de tilstandsløse workloads. Hver kører **uden ressource-requests eller -grænser**, indtil du sætter dem, og med én replika, undtagen telemetry writeren, der kører med to.

| Workload | Values-nøgle | Vokser med |
| --- | --- | --- |
| App: dashboard, API og indtagelse | `app` | Brugere, API-kald og indkommende telemetri |
| Workers, når de er skilt fra appen | `worker` | Telemetri og behandling af baggrundsjob |
| Sonder | `probes` | Antallet af aktive monitorer |
| Ingress-gateway | `nginx` | Mængden af forespørgsler |
| Telemetry writer, når den er slået til | `telemetryWriter` | Ikke med belastningen: Den samler hver telemetri-indsættelse i ClickHouse, så den dimensioneres efter, hvad ClickHouse kan klare |

Hver af dem kører Node.js, som afpasser sin heap efter containerens hukommelsesgrænse (`resources.limits.memory`): 75 % af grænsen, mindst 256 MB og højst 8096 MB. Uden en grænse kan heapen vokse til 8096 MB. Resten af grænsen er til den hukommelse, Node.js bruger uden for sin heap. Vil du selv vælge heapen, så sæt `NODE_OPTIONS` til `--max-old-space-size=` efterfulgt af en størrelse i MB i tjenestens `extraEnv` (med Docker Compose i tjenestens `environment` i en override-fil). Det går forud for den størrelse, grænsen giver.

Chartet indeholder **KEDA**, så appen, workers, sonder og den globale Runner kan skalere efter deres køefterslæb. Slå `keda.enabled` til sammen med hver tjenestes egen `keda.enabled` (for eksempel `app.keda.enabled`). På et cluster, der endnu ikke har KEDA, kræver den første installation en ekstra omgang: Se chartets [KEDA-vejledning](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Docs/Keda.md). Tjenester, som KEDA ikke styrer, kan i stedet bruge en autoscaler baseret på CPU eller hukommelse (`autoscaling`).

## Kør mange monitorer

Hver worker i hver sonde beder app-pods om de monitorer, der skal tjekkes, en portion ad gangen, og hver monitor, der skal tjekkes, går til præcis én af dem. Alle monitorer, der tjekkes hvert minut, skal tjekkes på samme tid i starten af hvert minut, så det, der tæller, er, hvor hurtigt et helt minuts monitorer bliver delt ud. Tallene nedenfor er målt med 39.700 monitorer (28.200 tjekket hvert minut og 11.500 hvert femte minut) på én sonde med 20 replikaer, hvor hver databaseforespørgsel var 50 eller 100 ms langsommere end på en maskine uden belastning, som på en travl database.

### Del monitorer ud i større portioner

Hæv hver sondes hentegrænse (`monitorFetchLimit` i Helm-chartet, ellers `PROBE_MONITOR_FETCH_LIMIT`) fra 10 til 50. Hver forespørgsel deler så fem gange så mange monitorer ud til omtrent samme pris. Med tre app-pods og forespørgsler, der var 50 ms langsommere, blev hvert minuts 28.200 monitorer delt ud inden for 19 sekunder mod 44 med en grænse på 10, og de 39.700, der skal tjekkes hvert femte minut, inden for 19 sekunder mod 57. En replika af sonden kører så op til workers × hentegrænse tjek ad gangen, 150 med 3 workers: giv den hukommelsen til det, eller tilføj replikaer.

```yaml
probes:
  one:
    monitoringWorkers: 3
    monitorFetchLimit: 50
```

### Lad planlægningsgrænsen stå på standardværdien

`PROBE_SCHEDULING_MAX_CONCURRENT_REQUESTS` (`app.probeSchedulingMaxConcurrentRequests`) er, hvor mange sondeforespørgsler hver app-pod kører ad gangen: en femtedel af dens databasepulje, 10 af 50. Hver pod har sin egen, så de app-pods, du tilføjer, har deres med. Med alle 39.700 klar til tjek på én gang og forespørgsler, der var 100 ms langsommere, fik én sonde 313 monitorer i sekundet fra én app-pod, 659 fra tre og 763 fra seks, og at hæve grænsen til 20 gav 7 % mere. En sonde alene må bruge hver plads i en pod, og sonder, der konkurrerer, deler dem retfærdigt. Test Monitor-kørsler har 2 pladser for sig selv, så en test når en sonde inden for dens tick på ti sekunder, uanset hvor travlt monitorerne har det. Hæv kun grænsen, hvis sondeforespørgsler bliver ved med at vente på en plads, mens databasen har kapacitet til overs, og hæv podens databasepulje sammen med den.

### Én sonde eller mange

Sæt hver monitor på de sonder, den skal tjekke fra. Hver monitor, der skal tjekkes, går til én replika af dens sonde, uanset hvor mange replikaer der spørger på samme tid, så én sonde med mange replikaer følger lige så godt med som mange sonder. Når monitorer er forsinkede, og ingen forespørgsel venter på en plads, mangler der sonder: tilføj replikaer, eller lad KEDA skalere hver sonde efter de monitorer, den skal tjekke.

### Skalér automatisk efter det, sonder venter på

`/metrics/probe-scheduling` på appens port lægger hver app-pods billede af det seneste minut sammen. Skalér app-pods med KEDA efter dens `queueDepth`, ved siden af CPU og hukommelse, og giv en advarsel, når monitorer bliver delt ud for sent:

```yaml
keda:
  enabled: true
app:
  keda:
    enabled: true
    probeSchedulingQueueDepthThreshold: 5
```

| Felt | Hvad det fortæller |
| --- | --- |
| `queueDepth` | Sondeforespørgsler, der venter på en plads lige nu, på alle app-pods. Over 0 i flere minutter: tilføj app-pods. |
| `slotWaitP95Ms` | Hvor længe forespørgsler ventede på en plads, på den travleste app-pod. |
| `refusalsPerMinute` | Sondeforespørgsler, der fik svaret, at serveren var optaget. |
| `reconnectsAskedPerMinute` | Svar, der bad en sondes forbindelse om at forbinde igen, så dens næste forespørgsel kan gå til en anden app-pod: nogle få i sekundet, mens en app-pod er bagud. Over 0 i flere minutter: tilføj app-pods. |
| `dispatchLagP95Seconds` | Hvor sent monitorer blev delt ud efter det tidspunkt, hvor deres interval gjorde dem klar til tjek. Tæt på dit korteste interval, mens ingen forespørgsel venter: tilføj sondereplikaer. |
| `monitorsLateByAnIntervalPerMinute` | Monitorer, der blev delt ud et helt interval for sent: tjek, der blev sprunget over. |
| `monitorTestWaitP95Seconds` | Hvor længe Test Monitor-kørsler ventede på en sonde. |

## Startniveauer

Vælg det niveau, der ligger tættest på dit miljø, som udgangspunkt, følg så det faktiske forbrug (`kubectl top pods`, diskvæksten i ClickHouse og PostgreSQL), og justér.

- **Lille / PoC** – 1–3 clustere, ≤30 noder, ≤5 GB/dag rå telemetri, 30 dages opbevaring.
- **Mellem / Produktionsflåde** – ~10 clustere, ~100 noder, 10–30 GB/dag rå telemetri, 30–90 dages opbevaring.
- **Stor / Flere flåder** – 50+ clustere, 500+ noder, 100+ GB/dag rå telemetri, 90 dages opbevaring.

| | Lille / PoC | Mellem / Produktionsflåde | Stor / Flere flåder |
| --- | --- | --- | --- |
| **ClickHouse** | 4 vCPU / 16 GB / 200 GB NVMe | 8 vCPU / 32 GB / 1–3 TB NVMe | 16+ vCPU / 64–128 GB / 5–15 TB NVMe, **shardet** |
| **PostgreSQL** | 2 vCPU / 4 GB / 50 GB SSD | 4 vCPU / 8 GB / 100 GB SSD | 8 vCPU / 16–32 GB / 250 GB SSD (+ PgBouncer) |
| **Valkey** | 1 vCPU / 2 GB | 2 vCPU / 4 GB | 4 vCPU / 8–16 GB |
| **Forudsat opbevaring** | 30 dage | 30–90 dage | 90 dage |

Disse niveauer dimensionerer OneUptimes backend. Den agent, du installerer på hvert overvåget cluster, er beskrevet på siden [Kubernetes-agent](/docs/telemetry/kubernetes-agent), som også viser, hvordan du skærer ned på den datamængde, den sender.

## Høj tilgængelighed

Chartets indbyggede datalagre kører som standard som **enkeltinstanser**. Til høj tilgængelighed i produktion:

| Datalager | Til høj tilgængelighed |
| --- | --- |
| **PostgreSQL** | Slå den medfølgende [CloudNativePG](https://cloudnative-pg.io)-operator til (`postgresOperator.cnpg.enabled`) med **3 instanser** (`postgresOperator.cnpg.instances`): en primær og to hot standbys med automatisk failover. |
| **ClickHouse** | Slå den medfølgende [Altinity](https://github.com/Altinity/clickhouse-operator)-operator til (`clickhouseOperator.altinity.enabled`) med **2 eller flere replikaer pr. shard** (`clickhouseOperator.altinity.cluster.replicasCount`). Dens medfølgende ClickHouse Keeper kører på **3 noder** for quorum. Tilføj shards (`shardsCount`), når én nodes disk eller hukommelse bliver grænsen. |
| **Valkey** | Chartet replikerer det ikke. Peg OneUptime på et eksternt administreret Redis eller Valkey med automatisk failover (`externalValkey`). OneUptime forbinder til én enkelt vært og port, så brug tjenestens primære endpoint, ikke et i cluster-tilstand. |

> [!WARNING]
> Slår du en af operatorerne til for en eksisterende installation, starter en ny, tom database: Ingen af dem kopierer dataene fra den enkeltinstansdatabase, den erstatter. Migrér dine data, som chartets vejledninger beskriver – for [PostgreSQL](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Docs/MigratePostgresStandaloneToOperator.md) og for [ClickHouse](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Docs/MigrateClickhouseStandaloneToOperator.md).

## Opbevaring, og hvordan den påvirker lageret

Opbevaring af telemetri er en **ClickHouse-TTL talt i dage**. Hver udgave har projektets standard under **Projektindstillinger > Telemetri og APM > Dataopbevaring** (**Standardopbevaring (dage)**); når intet er sat, er den 15 dage. [Enterprise Edition](/docs/self-hosted/enterprise) tilføjer tilsidesættelser: pr. signal (logs, traces, metrikker, profiler), pr. log-alvorlighed og trace-status og pr. tjeneste eller ressource.

Logs og metrikker slettes én dag ad gangen, ved den første midnat (ClickHouse-servertid) efter deres opbevaring udløber, så ClickHouse slipper for at omskrive hver dag af dem hvert par timer, mens den udløber. Lige før midnat ligger der stadig op til én dag mere end opbevaringsvinduet på disken: Dimensionér logs og metrikker til **opbevaringsdage + 1**.

Fordi opbevaringen ganger ClickHouses lager, skal du beslutte den, før du dimensionerer disken. OneUptime arkiverer **ikke** gammel telemetri og flytter den heller ikke til objektlager. Til flerårig opbevaring af compliance-hensyn forlænger du opbevaringsvinduet og dimensionerer ClickHouses lager derefter, eller du eksporterer til et eksternt arkiv efter eget valg.

## Mål, før du binder dig

Telemetrimængden svinger enormt med applikationslogs' detaljeringsgrad, antallet af namespaces, scrape-intervallet og om DEBUG-logning er slået til et sted. Brug niveauerne ovenfor som udgangspunkter: **indsaml fra dit miljø i mindst fire uger**, mål de faktiske GB om dagen for hvert signal, og dimensionér så opbevaring og lager ud fra rigtige data.

## Næste trin

:::cards
- [Docker Compose](/docs/installation/docker-compose): Krav til en installation på en enkelt server.
- [Selvhostet arkitektur](/docs/self-hosted/architecture): Hvordan komponenterne hænger sammen.
- [Kubernetes-agent](/docs/telemetry/kubernetes-agent): Collectoren, der sender et clusters telemetri.
- [Enterprise Edition](/docs/self-hosted/enterprise): Tilsidesættelser af opbevaring og de andre Enterprise-funktioner.
:::

# Oppgradering av OneUptime

Denne veiledningen dekker hvordan du trygt oppgraderer din selvhostede OneUptime-installasjon.

## Generell veiledning

- Oppgrader trinn for trinn på tvers av store versjoner (for eksempel 6 → 7 → 8). Ikke hopp over store versjoner.
- Du kan hoppe over mindre/patch-versjoner (for eksempel 8.1 → 8.4) så lenge du følger versjonsnotatene.
- Ta alltid sikkerhetskopier før oppgradering, og valider at du kan gjenopprette dem.

## Oppgradering fra OneUptime 10 → 11

OneUptime 11 bygger om telemetrilagringen i ClickHouse. Denne siden forklarer hva som endres, hvem som må gjøre noe, og — for installasjoner som vil ta med historisk telemetri videre — hver eneste spørring som trengs for å gjøre det.

### Hva endres i v11

Telemetri (logger, traces, metrikker, unntak, profiler, monitorlogger, revisjonslogger) flyttes til nye ClickHouse-tabeller med tidsbasert partisjonering, komprimeringskodeker per kolonne og de nye entitetsmodell-kolonnene:

| Gammel tabell         | Ny tabell             |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

To kolonner får nytt navn på alle telemetritabeller: `serviceId` → `primaryEntityId` og `serviceType` → `primaryEntityType`. Dette er et hardt navnebytte — **hvis du spør OneUptime analytics-API-et direkte med `serviceId`-/`serviceType`-filtre, må du oppdatere dem til de nye navnene.** Dashbord, monitorer og varsler inne i OneUptime migreres automatisk.

Overgangen er **kun fremoverrettet**: de nye tabellene starter tomme, all telemetri som tas inn etter oppgraderingen havner i dem umiddelbart, og historikken fylles naturlig inn etter hvert som tiden går. De gamle tabellene beholdes og sletter seg selv gradvis via sin retention-TTL.

### Hvem må gjøre noe

- **Nyinstallasjoner:** ingenting å gjøre.
- **Oppgraderinger som ikke trenger telemetri fra før oppgraderingen i brukergrensesnittet:** ingenting å gjøre. Telemetrisidene viser ganske enkelt data fra oppgraderingstidspunktet og fremover; eldre data eldes usett ut av de gamle tabellene.
- **Oppgraderinger som vil ha telemetri fra før oppgraderingen synlig:** kjør den manuelle kopieringen nedenfor, når som helst etter oppgraderingen.

Som alltid: oppgrader store versjoner trinn for trinn (10 → 11, ikke hopp over), og ta sikkerhetskopier av Postgres og ClickHouse før du oppgraderer.

### Valgfritt: ta med telemetrihistorikk videre

Kjør disse **etter at oppgraderingen har startet helt opp** (de nye tabellene og deres materialiserte visninger må eksistere). Koble til direkte på ClickHouse-verten — den native protokollen har ingen HTTP-tidsavbrudd, så setninger som tar flere timer går fint:

```bash
clickhouse-client --database oneuptime
```

Greit å vite før du starter:

- Kopieringen er trygg å kjøre mens OneUptime er i drift. Ny telemetri skrives uavhengig til de nye tabellene; kopiert historikk fylles inn bak den.
- Forvent at det tar timer ved stor skala (hundrevis av GB).
- Hver setning nedenfor har en `insert_deduplication_token`, og de nye tabellene leveres med et dedupliseringsvindu — så **det er trygt å kjøre en setning som feilet underveis på nytt** (blokker som allerede er satt inn hoppes over, også i metrikk-rollupene), forutsatt at du kjører den på nytt innen rimelig tid. Under tung live-inntak vil vinduet (de siste 10 000 insert-blokkene per tabell) etter hvert kaste ut gamle tokener.
- Kopiering av metrikker gjenoppbygger også de forhåndsaggregerte dashbord-rollupene automatisk (hver kopierte rad mates på nytt inn i rollupenes materialiserte visninger) — dette gjør metrikk-kopieringen tregere enn de andre; kjør den sist.

#### Trinn 1 — list opp kildepartisjonene

Hver gammel tabell har maksimalt 16 partisjoner. For hver kildetabell:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2 ORDER BY _partition_id;
```

#### Trinn 2 — generer kopisetningen

Kolonnesettene kan variere litt mellom installasjoner (eldre utrullinger kan mangle nylig tilføyde kolonner), så generer setningen fra ditt live skjema i stedet for å kopiere en ferdigskrevet en. Sett `src` og `dst` i `WITH`-klausulen til ett av tabellparene fra tabellen ovenfor, og kjør:

```sql
WITH 'LogItemV2' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

Den genererte setningen kopierer bare kolonnene begge tabellene har felles (nye kolonner får standardverdiene sine), bytter navn på `serviceId`/`serviceType` underveis, sorterer radene deterministisk slik at en ny kjøring produserer identiske, dedupliserbare blokker, og opphever grensene for kjøretid og partisjonsantall som en setning av denne størrelsen trenger.

#### Trinn 3 — kjør den, én partisjon om gangen

Ta den genererte setningen og erstatt `{PARTITION}` (den forekommer to ganger — i `WHERE` og i tokenet) med hver partisjons-id fra trinn 1. Kjør setningene én om gangen, og gjenta deretter trinn 1–3 for hvert tabellpar.

Hvis en setning feiler underveis, kjør den **samme** setningen på nytt raskt — blokker som allerede er committet dedupliseres. Hvis du kjører på nytt mye senere, sammenlign radantall først (trinn 5).

#### Trinn 4 (valgfritt) — rollup-historikk for metrikker per vert

Kopierte rå metrikkrader gjenoppbygger rollupene på tjenestenivå automatisk, men ikke rollupen **per vert** (gamle rader har ingen vertsentitetsnøkkel). Oppgraderingen lar med vilje den gamle per-vert-rollup-tabellen stå, slik at du kan ta den med videre ved å beregne den nye nøkkelen fra vertsnavnet:

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

#### Trinn 5 — verifiser

Sammenlign totalene per tabellpar (den nye tabellen inneholder også rader fra etter oppgraderingen, så den bør være større enn eller lik den gamle):

```sql
SELECT
  (SELECT count() FROM LogItemV2) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Trinn 6 (valgfritt) — frigjør diskplass tidlig

De gamle tabellene tømmes av seg selv via TTL, men når du er fornøyd med kopien, kan du droppe dem umiddelbart:

```sql
DROP TABLE IF EXISTS LogItemV2;
DROP TABLE IF EXISTS MetricItemV2;
DROP TABLE IF EXISTS SpanItemV2;
DROP TABLE IF EXISTS ExceptionItemV2;
DROP TABLE IF EXISTS ProfileItemV2;
DROP TABLE IF EXISTS ProfileSampleItemV2;
DROP TABLE IF EXISTS MonitorLogV2;
DROP TABLE IF EXISTS AuditLogV1;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost;
```

> Tips: som ved enhver stor oppgradering, test i et stagingmiljø først og bekreft at telemetri flyter inn i de nye tabellene før du stoler på kopien i produksjon.



## Oppgradering fra OneUptime 9 → 10

Ingen endringer som krever manuelle tiltak. Følg bare den vanlige oppgraderingsprosessen.

## Oppgradering fra OneUptime 8 → 9

Helm-diagrammet klargjør ikke lenger en Kubernetes Ingress-ressurs. OneUptime leveres med en ingress gateway-container som allerede avslutter TLS, administrerer statusside-domener og ruter trafikk for plattformen, slik at en klynge ingress-kontroller ikke lenger er nødvendig.

- Fjern eventuelle `oneuptimeIngress`-overstyringer fra de egendefinerte `values.yaml`-filene dine før oppgradering. Disse nøklene ignoreres nå og vil forårsake valideringsfeil hvis de etterlates.
- Sørg for at `nginx.service.type` gjenspeiler hvordan du vil eksponere den medfølgende ingress gateway (for eksempel `LoadBalancer`, `NodePort` eller `ClusterIP` med en ekstern lastbalanserer).
- Verifiser at eventuelle DNS-poster for statussider eller primære verter fortsatt peker til tjenesten eller lastbalansereren som er foran OneUptime ingress gateway.
- Etter oppgraderingen, bekreft at TLS-sertifikater fortsetter å fornyes via den innebygde gateway og at statussidedomener løses opp korrekt.


## Oppgradering fra OneUptime 7 → 8

Hvis du kjører på Kubernetes, er det viktige endringer som bryter bakoverkompatibilitet:

- Vi bruker ikke lenger Bitnami-diagrammer for Postgres, Redis og ClickHouse på grunn av [Bitnami-lisensendringer](https://github.com/bitnami/charts/issues/35164)
- Disse endringene er ikke bakoverkompatible. Du må følge den nye strukturen i Helm-diagrammets `values.yaml`.
- Sikkerhetskopier dataene dine (Postgres, ClickHouse og eventuelle vedvarende volumer) før oppgradering.


> Tips: Test oppgraderingen i et stagingmiljø først. Bekreft at arbeidsbelastningene er sunne og at dataene er intakte før du oppgraderer produksjon.

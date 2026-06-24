# Oppgradering av OneUptime

Denne veiledningen dekker hvordan du trygt oppgraderer din selvhostede OneUptime-installasjon.

## Generell veiledning

- Oppgrader trinn for trinn på tvers av store versjoner (for eksempel 6 → 7 → 8). Ikke hopp over store versjoner.
- Du kan hoppe over mindre/patch-versjoner (for eksempel 8.1 → 8.4) så lenge du følger versjonsnotatene.
- Ta alltid sikkerhetskopier før oppgradering, og valider at du kan gjenopprette dem.

## Oppgradering fra OneUptime 10 → 11

OneUptime 11 bygger ClickHouse-telemetrilagringen på nytt. Denne siden forklarer hva som endres, hvem som må gjøre noe, og — for installasjoner som vil ta med historisk telemetri videre — hver eneste spørring som trengs.

### Hva endres i v11

Telemetri (logger, traces, metrikker, exceptions, profiler, monitor-logger, audit-logger) flyttes til nye ClickHouse-tabeller med tidsbasert partisjonering, komprimeringskodeker per kolonne og de nye entitetsmodell-kolonnene:

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

To kolonner får nytt navn i alle telemetritabeller: `serviceId` → `primaryEntityId` og `serviceType` → `primaryEntityType`. Dette er en hard navneendring — **hvis du spør OneUptimes analytics-API direkte med `serviceId`-/`serviceType`-filtre, må du oppdatere dem til de nye navnene.** Dashboards, monitorer og varsler inne i OneUptime migreres automatisk.

Overgangen er **kun fremoverrettet**: de nye tabellene starter tomme, all telemetri som tas inn etter oppgraderingen lander umiddelbart i dem, og historikken fylles naturlig opp etter hvert som tiden går. De gamle tabellene **slettes automatisk** under oppgraderingen for å frigjøre diskplassen — vil du beholde muligheten til å ta historikken med, gi dem nytt navn **før** oppgraderingen (Trinn 0 nedenfor).

> **Allerede på 11.0.0 eller 11.0.1?** Disse utgivelsene beholdt de gamle tabellene (de tømte seg via TTL, og kopien kunne kjøres «når som helst etter oppgraderingen»). Enhver senere oppdatering **sletter dem ved oppstart**. Hvis du fortsatt vil gjøre historikk-kopien og ikke har gjort det ennå, utfør Trinn 0 nedenfor før du tar i bruk oppdateringen.

### Hvem må gjøre noe

- **Nyinstallasjoner:** ingenting å gjøre.
- **Oppgraderinger som ikke trenger telemetri fra før oppgraderingen i grensesnittet:** ingenting å gjøre. Telemetrisidene viser ganske enkelt data fra oppgraderingstidspunktet og fremover; de gamle tabellene slettes under oppgraderingen.
- **Oppgraderinger som vil se telemetri fra før oppgraderingen:** gi de gamle tabellene nytt navn **før** oppgraderingen (Trinn 0 nedenfor), og kjør deretter den manuelle kopien når som helst etterpå.

Som alltid: oppgrader hovedversjoner trinn for trinn (10 → 11, ikke hopp over), og ta sikkerhetskopier av Postgres og ClickHouse før oppgraderingen.

### Valgfritt: ta telemetrihistorikken med videre

Trinn 0 utføres **før oppgraderingen**; alt fra Trinn 1 og utover utføres **etter at oppgraderingen har startet helt opp** (de nye tabellene og deres materialized views må eksistere). Koble til direkte på ClickHouse-verten — den native protokollen har ingen HTTP-tidsavbrudd, så setninger som tar flere timer er uproblematiske:

```bash
clickhouse-client --database oneuptime
```

Godt å vite før du begynner:

- Kopien kan trygt kjøres mens OneUptime er live. Ny telemetri skrives uavhengig til de nye tabellene; den kopierte historikken fyller seg opp bak.
- Forvent timer i stor skala (hundrevis av GB).
- Hver setning nedenfor bærer et `insert_deduplication_token`, og de nye tabellene leveres med et dedupliseringsvindu — så **det er trygt å kjøre en setning som feilet underveis på nytt** (allerede innsatte blokker hoppes over, også i metrikk-rollups), forutsatt at du kjører den på nytt rimelig raskt. Under tung live-inntak fortrenger vinduet (de siste 10 000 insert-blokkene per tabell) til slutt gamle tokens.
- Kopiering av metrikker bygger også automatisk de forhåndsaggregerte dashboard-rollupene på nytt (hver kopierte rad mater rollup-materialized-views på nytt) — det gjør metrikk-kopien tregere enn de andre; kjør den sist.

#### Trinn 0 — gi de gamle tabellene nytt navn før oppgraderingen

Oppgraderingen sletter de gamle tabellene ved oppstart, så flytt først dem du vil kopiere fra utenfor dens rekkevidde. Stopp OneUptime (skaler deploymentet ned) slik at ingenting skriver til dem eller kan gjenskape dem, og gi dem deretter nytt navn — `RENAME TABLE` er en øyeblikkelig metadata-operasjon, og `IF EXISTS` lar blokken hoppe over tabeller installasjonen din aldri har hatt (deployments eldre enn midten av 10.0.x kan mangle `AuditLogV1` eller noen `…V2`-tabeller — da finnes det ingen historikk av den typen å kopiere):

```sql
RENAME TABLE IF EXISTS LogItemV2 TO LogItemV2_backup;
RENAME TABLE IF EXISTS MetricItemV2 TO MetricItemV2_backup;
RENAME TABLE IF EXISTS SpanItemV2 TO SpanItemV2_backup;
RENAME TABLE IF EXISTS ExceptionItemV2 TO ExceptionItemV2_backup;
RENAME TABLE IF EXISTS ProfileItemV2 TO ProfileItemV2_backup;
RENAME TABLE IF EXISTS ProfileSampleItemV2 TO ProfileSampleItemV2_backup;
RENAME TABLE IF EXISTS MonitorLogV2 TO MonitorLogV2_backup;
RENAME TABLE IF EXISTS AuditLogV1 TO AuditLogV1_backup;
RENAME TABLE IF EXISTS MetricItemAggMV1mByHost TO MetricItemAggMV1mByHost_backup;
```

Oppgrader deretter og la OneUptime starte helt opp før du fortsetter.

> Ruller du tilbake til v10 etter navneendringen (v10 gjenskaper tomme tabeller med de gamle navnene ved oppstart), gi `_backup`-tabellene tilbake de opprinnelige navnene før du starter v10 på nytt — ellers lander telemetri som tas inn under tilbakerullingen i de gjenskapte tabellene og slettes ved den senere oppgraderingen.

#### Trinn 1 — list kildepartisjonene

Hver gamle tabell har høyst 16 partisjoner. For hver kildetabell:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Trinn 2 — generer kopisetningen

Kolonnesettene kan variere litt mellom installasjoner (eldre deployments kan mangle nylig tilførte kolonner), så generer setningen fra ditt live skjema i stedet for å lime inn en fast. Sett `src` og `dst` i `WITH`-klausulen til ett av tabellparene fra tabellen ovenfor (kilden bærer `_backup`-suffikset fra Trinn 0), og kjør:

```sql
WITH 'LogItemV2_backup' AS src, 'LogItemV3' AS dst
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

Den genererte setningen kopierer bare kolonnene begge tabellene deler (nye kolonner får standardverdiene sine), endrer navn på `serviceId`/`serviceType` underveis, sorterer radene deterministisk slik at en ny kjøring produserer identiske, dedupliserbare blokker, og opphever grensene for kjøretid og partisjonsantall som en setning av denne størrelsen trenger.

#### Trinn 3 — kjør den, én partisjon om gangen

Ta den genererte setningen og erstatt `{PARTITION}` (den forekommer to ganger — i `WHERE` og i tokenet) med hver partisjons-id fra Trinn 1. Kjør setningene én om gangen, og gjenta deretter Trinn 1–3 for hvert tabellpar.

> Merk: ble en kildetabell hoppet over i Trinn 0 fordi den ikke fantes på installasjonen din, feiler Trinn 1 med `UNKNOWN_TABLE` for det paret — hopp ganske enkelt over paret; det finnes ingen historikk av den typen å kopiere.

Feiler en setning underveis, kjør raskt **den samme** setningen på nytt — allerede committede blokker dedupliseres. Kjører du på nytt mye senere, sammenlign radantallene først (Trinn 5).

#### Trinn 4 (valgfritt) — historikk for metrikk-rollup per vert

Kopierte rå metrikkrader bygger automatisk rollupene på tjenestenivå på nytt, men ikke **per-vert**-rollupen (gamle rader har ingen vert-entitetsnøkkel). Den gamle rollup-tabellen som fikk nytt navn i Trinn 0 er den eneste kilden til denne historikken; ta den med ved å beregne den nye nøkkelen fra vertsnavnet:

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
FROM MetricItemAggMV1mByHost_backup
ORDER BY projectId, name, hostIdentifier, bucketTime, _id
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

`ORDER BY` betyr noe: den gjør at en ny kjøring produserer identiske insert-blokker som dedupliseringstokenet kan gjenkjenne. Uten den kunne en ny kjøring blitt hoppet stille over eller telt dobbelt. (Kanttilfelle: vertsnavn som inneholder `\`, `|` eller `=` — ikke gyldige RFC-1123-vertsnavntegn — ville beregnet en annen nøkkel enn applikasjonen; ignorer dette med mindre du vet at du har slike verter.)

#### Trinn 5 — verifiser

Sammenlign totalene per tabellpar (den nye tabellen inneholder også rader fra etter oppgraderingen, så den bør være større enn eller lik den gamle):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Trinn 6 — slett sikkerhetskopiene

Tabellene med nytt navn beholder retensjons-TTL-en sin, så de tømmes og krymper av seg selv — men så snart du er fornøyd med kopien, slett dem for å frigjøre disken umiddelbart:

```sql
DROP TABLE IF EXISTS LogItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS SpanItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ExceptionItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileSampleItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MonitorLogV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS AuditLogV1_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost_backup SETTINGS max_table_size_to_drop = 0;
```

(`max_table_size_to_drop = 0` opphever serverens 50 GB-slettebeskyttelse for akkurat den setningen.)

> Tips: som ved enhver større oppgradering, test først i et staging-miljø og bekreft at telemetri strømmer inn i de nye tabellene før du stoler på kopien i produksjon.

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

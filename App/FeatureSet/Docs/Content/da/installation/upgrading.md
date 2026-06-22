# Opgradering af OneUptime

Denne guide beskriver, hvordan du sikkert opgraderer din selvhostede OneUptime-installation.

## Generel vejledning

- Opgrader trin for trin på tværs af større versioner (f.eks. 6 → 7 → 8). Spring ikke større versioner over.
- Du kan springe mindre/patch-versioner over (f.eks. 8.1 → 8.4), så længe du følger udgivelsesnoterne.
- Tag altid sikkerhedskopier inden opgradering, og valider, at du kan gendanne dem.

## Opgradering fra OneUptime 10 → 11

OneUptime 11 genopbygger ClickHouse-telemetrilageret. Denne side forklarer, hvad der ændres, hvem der skal handle, og — for installationer der vil bevare historisk telemetri — hver eneste forespørgsel, der skal til.

### Hvad ændres i v11

Telemetri (logs, traces, metrikker, exceptions, profiler, monitor-logs, audit-logs) flyttes til nye ClickHouse-tabeller med tidsbaseret partitionering, komprimeringscodecs pr. kolonne og de nye entitetsmodel-kolonner:

| Gammel tabel          | Ny tabel              |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

To kolonner omdøbes i alle telemetritabeller: `serviceId` → `primaryEntityId` og `serviceType` → `primaryEntityType`. Det er en hård omdøbning — **hvis du forespørger OneUptimes analytics-API direkte med `serviceId`-/`serviceType`-filtre, skal du opdatere dem til de nye navne.** Dashboards, monitors og alerts inde i OneUptime migreres automatisk.

Skiftet er **kun fremadrettet**: de nye tabeller starter tomme, al telemetri der indtages efter opgraderingen lander straks i dem, og historikken fyldes naturligt op med tiden. De gamle tabeller **slettes automatisk** under opgraderingen for at frigive deres diskplads — vil du beholde muligheden for at tage historikken med, så omdøb dem **før** opgraderingen (Trin 0 nedenfor).

> **Allerede på 11.0.0 eller 11.0.1?** Disse udgivelser beholdt de gamle tabeller (de tømtes via TTL, og kopien kunne køres "når som helst efter opgraderingen"). Enhver senere opdatering **sletter dem ved opstart**. Hvis du stadig vil lave historik-kopien og ikke har gjort det endnu, så udfør Trin 0 nedenfor, før du anvender opdateringen.

### Hvem skal gøre noget

- **Nyinstallationer:** intet at gøre.
- **Opgraderinger der ikke behøver telemetri fra før opgraderingen i brugerfladen:** intet at gøre. Telemetrisiderne viser blot data fra opgraderingstidspunktet og frem; de gamle tabeller slettes under opgraderingen.
- **Opgraderinger der vil kunne se telemetri fra før opgraderingen:** omdøb de gamle tabeller **før** opgraderingen (Trin 0 nedenfor), og kør derefter den manuelle kopi når som helst bagefter.

Som altid: opgradér hovedversioner trin for trin (10 → 11, spring ikke over), og tag backup af Postgres og ClickHouse før opgraderingen.

### Valgfrit: tag telemetrihistorikken med

Trin 0 udføres **før opgraderingen**; alt fra Trin 1 og frem udføres, **efter at opgraderingen er startet helt op** (de nye tabeller og deres materialized views skal eksistere). Forbind direkte på din ClickHouse-host — den native protokol har ingen HTTP-timeouts, så statements der tager flere timer er uproblematiske:

```bash
clickhouse-client --database oneuptime
```

Godt at vide, før du går i gang:

- Kopien kan køres sikkert, mens OneUptime er live. Ny telemetri skrives uafhængigt til de nye tabeller; den kopierede historik fylder op bagved.
- Forvent timer ved stor skala (hundredvis af GB).
- Hvert statement nedenfor bærer et `insert_deduplication_token`, og de nye tabeller leveres med et deduplikeringsvindue — så **det er sikkert at genkøre et statement, der fejlede undervejs** (allerede indsatte blokke springes over, også i metrik-rollups), forudsat at du genkører det rimelig hurtigt. Under kraftig live-indtagelse fortrænger vinduet (de seneste 10.000 insert-blokke pr. tabel) til sidst gamle tokens.
- Kopiering af metrikker genopbygger også automatisk de præaggregerede dashboard-rollups (hver kopieret række fodrer rollup-materialized-views igen) — det gør metrik-kopien langsommere end de andre; kør den til sidst.

#### Trin 0 — omdøb de gamle tabeller før opgraderingen

Opgraderingen sletter de gamle tabeller ved opstart, så flyt først dem, du vil kopiere fra, uden for dens rækkevidde. Stop OneUptime (skaler deploymentet ned) så intet skriver til dem eller kan genskabe dem, og omdøb derefter — `RENAME TABLE` er en øjeblikkelig metadata-operation, og `IF EXISTS` lader blokken springe tabeller over, som din installation aldrig har haft (deployments ældre end midt i 10.0.x mangler muligvis `AuditLogV1` eller nogle `…V2`-tabeller — så findes der ingen historik af den type at kopiere):

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

Opgradér derefter, og lad OneUptime starte helt op, før du fortsætter.

> Ruller du tilbage til v10 efter omdøbningen (v10 genskaber tomme tabeller med de gamle navne ved opstart), så omdøb `_backup`-tabellerne tilbage til deres oprindelige navne, før du genstarter v10 — ellers lander telemetri indtaget under tilbagerulningen i de genskabte tabeller og slettes ved den senere opgradering.

#### Trin 1 — list kildepartitionerne

Hver gammel tabel har højst 16 partitioner. For hver kildetabel:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Trin 2 — generér kopi-statementet

Kolonnesættene kan variere en smule mellem installationer (ældre deployments kan mangle nyligt tilføjede kolonner), så generér statementet ud fra dit live-skema i stedet for at indsætte et fast. Sæt `src` og `dst` i `WITH`-klausulen til et af tabelparrene fra tabellen ovenfor (kilden bærer `_backup`-suffikset fra Trin 0), og kør:

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

Det genererede statement kopierer kun de kolonner, begge tabeller deler (nye kolonner får deres standardværdier), omdøber `serviceId`/`serviceType` undervejs, sorterer rækkerne deterministisk, så en genkørsel producerer identiske, deduplikerbare blokke, og ophæver de grænser for køretid og partitionsantal, som et statement af denne størrelse kræver.

#### Trin 3 — kør det, én partition ad gangen

Tag det genererede statement og erstat `{PARTITION}` (det optræder to gange — i `WHERE` og i tokenet) med hvert partitions-id fra Trin 1. Kør statements ét ad gangen, og gentag derefter Trin 1–3 for hvert tabelpar.

> Bemærk: blev en kildetabel sprunget over i Trin 0, fordi den ikke fandtes på din installation, fejler Trin 1 med `UNKNOWN_TABLE` for det par — spring blot parret over; der findes ingen historik af den type at kopiere.

Fejler et statement undervejs, så genkør hurtigt **det samme** statement — allerede committede blokke deduplikeres. Genkører du meget senere, så sammenlign først rækkeantallene (Trin 5).

#### Trin 4 (valgfrit) — historik for metrik-rollup pr. host

Kopierede rå metrikrækker genopbygger automatisk rollups på serviceniveau, men ikke **pr.-host**-rollupen (gamle rækker har ingen host-entitetsnøgle). Den gamle rollup-tabel, der blev omdøbt i Trin 0, er den eneste kilde til denne historik; tag den med ved at beregne den nye nøgle ud fra hostnavnet:

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

`ORDER BY` betyder noget: den sikrer, at en genkørsel producerer identiske insert-blokke, som deduplikeringstokenet kan genkende. Uden den kunne en genkørsel blive sprunget lydløst over eller talt dobbelt. (Kanttilfælde: hostnavne med `\`, `|` eller `=` — ikke gyldige RFC-1123-hostnavnstegn — ville beregne en anden nøgle end applikationen; ignorér det, medmindre du ved, at du har sådanne hosts.)

#### Trin 5 — verificér

Sammenlign totalerne pr. tabelpar (den nye tabel indeholder også rækker fra efter opgraderingen, så den bør være større end eller lig den gamle):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Trin 6 — slet backupperne

De omdøbte tabeller beholder deres retentions-TTL, så de tømmes og skrumper af sig selv — men så snart du er tilfreds med kopien, kan du slette dem og frigive disken med det samme:

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

(`max_table_size_to_drop = 0` ophæver serverens 50 GB-sletbeskyttelse for netop det statement.)

> Tip: test som ved enhver større opgradering først i et staging-miljø, og bekræft at telemetri strømmer ind i de nye tabeller, før du stoler på kopien i produktion.

## Opgradering fra OneUptime 9 → 10

Ingen ændringer, der kræver manuel handling. Følg blot den almindelige opgraderingsproces.

## Opgradering fra OneUptime 8 → 9

Helm-chartet klargører ikke længere en Kubernetes Ingress-ressource. OneUptime leverer en ingress gateway-container, der allerede afslutter TLS, administrerer statusside-domæner og dirigerer trafik til platformen, så en klynge-ingress-controller er ikke længere nødvendig.

- Fjern eventuelle `oneuptimeIngress`-tilsidesættelser fra dine brugerdefinerede `values.yaml`-filer inden opgradering. Disse nøgler ignoreres nu og vil forårsage valideringsfejl, hvis de efterlades.
- Sørg for, at `nginx.service.type` afspejler, hvordan du vil eksponere den medfølgende ingress gateway (f.eks. `LoadBalancer`, `NodePort` eller `ClusterIP` med en ekstern load balancer).
- Bekræft, at eventuelle DNS-poster til statussider eller primære hosts stadig peger på den service eller load balancer, der er foran OneUptime-ingress-gatewayen.
- Efter opgraderingen skal du bekræfte, at TLS-certifikater fortsat fornyes via den indlejrede gateway, og at statusside-domæner løses korrekt.

## Opgradering fra OneUptime 7 → 8

Hvis du kører på Kubernetes, er der vigtige ændringer der bryder bagudkompatibilitet:

- Vi bruger ikke længere Bitnami-charts til Postgres, Redis og ClickHouse på grund af [Bitnami-licensændringer](https://github.com/bitnami/charts/issues/35164)
- Disse ændringer er ikke bagudkompatible. Du skal følge den nye struktur i Helm-chartets `values.yaml`.
- Sikkerhedskopier dine data (Postgres, ClickHouse og alle persistente volumes) inden opgradering.

> Tip: Test opgraderingen i et staging-miljø først. Bekræft, at dine arbejdsbelastninger er sunde og dataene intakte, inden du opgraderer produktionen.

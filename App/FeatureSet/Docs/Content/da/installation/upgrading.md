# Opgradering af OneUptime

Denne guide beskriver, hvordan du sikkert opgraderer din selvhostede OneUptime-installation.

## Generel vejledning

- Opgrader trin for trin på tværs af større versioner (f.eks. 6 → 7 → 8). Spring ikke større versioner over.
- Du kan springe mindre/patch-versioner over (f.eks. 8.1 → 8.4), så længe du følger udgivelsesnoterne.
- Tag altid sikkerhedskopier inden opgradering, og valider, at du kan gendanne dem.

## Opgradering fra OneUptime 10 → 11

OneUptime 11 genopbygger ClickHouse-telemetrilagringen. Denne side forklarer,
hvad der ændres, hvem der skal foretage sig noget, og — for installationer,
der ønsker at tage historisk telemetri med videre — alle de forespørgsler,
der skal til.

### Hvad ændres i v11

Telemetri (logs, traces, metrikker, exceptions, profiler, monitor-logs,
audit-logs) flyttes til nye ClickHouse-tabeller med tidsbaseret
partitionering, komprimerings-codecs pr. kolonne og de nye
entitetsmodel-kolonner:

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

To kolonner omdøbes på alle telemetritabeller: `serviceId` →
`primaryEntityId` og `serviceType` → `primaryEntityType`. Det er en hård
omdøbning — **hvis du forespørger OneUptimes analytics-API direkte med
`serviceId`/`serviceType`-filtre, skal du opdatere dem til de nye navne.**
Dashboards, monitorer og alarmer inde i OneUptime migreres automatisk.

Skiftet er **kun fremadrettet**: de nye tabeller starter tomme, al
telemetri, der indtages efter opgraderingen, lander straks i dem, og
historikken fyldes naturligt op igen, efterhånden som tiden går. De gamle
tabeller beholdes og sletter gradvist sig selv via deres retentions-TTL.

### Hvem skal foretage sig noget

- **Nye installationer:** intet at gøre.
- **Opgraderinger, der ikke har brug for telemetri fra før opgraderingen i
  UI'et:** intet at gøre. Telemetrisiderne viser blot data fra
  opgraderingstidspunktet og frem; ældre data ældes ud af de gamle
  tabeller uden at blive vist.
- **Opgraderinger, der ønsker telemetri fra før opgraderingen synlig:**
  kør den manuelle kopiering nedenfor, når som helst efter opgraderingen.

Som altid: opgrader større versioner trin for trin (10 → 11, spring ikke
over), og tag sikkerhedskopier af Postgres og ClickHouse inden
opgradering.

### Valgfrit: tag telemetrihistorik med videre

Kør disse **efter at opgraderingen er fuldt startet op** (de nye tabeller
og deres materialized views skal findes). Forbind direkte på din
ClickHouse-host — den native protokol har ingen HTTP-timeouts, så
statements, der tager flere timer, er ikke et problem:

```bash
clickhouse-client --database oneuptime
```

Godt at vide, inden du går i gang:

- Kopieringen kan trygt køres, mens OneUptime er i drift. Ny telemetri
  skrives uafhængigt til de nye tabeller; den kopierede historik fylder
  op bagved.
- Forvent flere timer ved stor skala (hundredvis af GB).
- Hvert statement nedenfor bærer en `insert_deduplication_token`, og de
  nye tabeller leveres med et deduplikeringsvindue — så **det er sikkert
  at genkøre et statement, der fejlede undervejs** (allerede indsatte
  blokke springes over, også i metrik-rollups), forudsat at du genkører
  det rimeligt hurtigt. Under kraftig live-indtagelse vil vinduet (de
  seneste 10.000 insert-blokke pr. tabel) med tiden smide gamle tokens
  ud.
- Kopiering af metrikker genopbygger også automatisk de præaggregerede
  dashboard-rollups (hver kopieret række føder rollup-materialized-views
  igen) — det gør metrik-kopieringen langsommere end de andre; kør den
  til sidst.

#### Trin 1 — list kildepartitionerne

Hver gammel tabel har højst 16 partitioner. For hver kildetabel:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2 ORDER BY _partition_id;
```

#### Trin 2 — generér kopi-statementet

Kolonnesættene kan variere en smule mellem installationer (ældre
installationer kan mangle nyligt tilføjede kolonner), så generér
statementet ud fra dit live-skema i stedet for at kopiere et fast et.
Sæt `src` og `dst` i `WITH`-klausulen til et af tabelparrene fra tabellen
ovenfor, og kør:

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

Det genererede statement kopierer kun de kolonner, begge tabeller har til
fælles (nye kolonner får deres standardværdier), omdøber
`serviceId`/`serviceType` undervejs, sorterer rækkerne deterministisk, så
et nyt forsøg producerer identiske blokke, der kan deduplikeres, og
ophæver de grænser for eksekveringstid og antal partitioner, som et
statement af denne størrelse kræver.

#### Trin 3 — kør det, én partition ad gangen

Tag det genererede statement, og erstat `{PARTITION}` (det optræder to
gange — i `WHERE` og i tokenet) med hvert partitions-id fra trin 1. Kør
statements ét ad gangen, og gentag derefter trin 1–3 for hvert tabelpar.

Hvis et statement fejler undervejs, så genkør det **samme** statement
hurtigt — allerede committede blokke deduplikeres. Hvis du genkører meget
senere, så sammenlign rækkeantal først (trin 5).

#### Trin 4 (valgfrit) — historik for metrik-rollup pr. host

Kopierede rå metrikrækker genopbygger automatisk rollups på
serviceniveau, men ikke rollup'en **pr. host** (gamle rækker har ingen
host-entitetsnøgle). Opgraderingen efterlader bevidst den gamle
pr.-host-rollup-tabel, så du kan tage den med videre ved at beregne den
nye nøgle ud fra hostnavnet:

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

#### Trin 5 — verificér

Sammenlign totaler pr. tabelpar (den nye tabel indeholder også rækker fra
efter opgraderingen, så den bør være større end eller lig med den gamle):

```sql
SELECT
  (SELECT count() FROM LogItemV2) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Trin 6 (valgfrit) — frigiv diskplads tidligt

De gamle tabeller tømmes af sig selv via TTL, men når du er tilfreds med
kopien, kan du droppe dem med det samme:

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

> Tip: Som ved enhver større opgradering bør du teste i et staging-miljø
> først og bekræfte, at telemetri strømmer ind i de nye tabeller, inden
> du stoler på kopien i produktion.



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

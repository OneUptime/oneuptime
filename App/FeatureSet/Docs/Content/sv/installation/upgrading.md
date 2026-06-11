# Uppgradera OneUptime

Den här guiden beskriver hur du säkert uppgraderar din egeninstallerade OneUptime-installation.

## Allmän vägledning

- Uppgradera steg för steg mellan huvudversioner (till exempel 6 → 7 → 8). Hoppa inte över huvudversioner.
- Du kan hoppa över minor/patch-versioner (till exempel 8.1 → 8.4) så länge du följer versionsnoteringarna.
- Ta alltid säkerhetskopior innan du uppgraderar och validera att du kan återställa dem.

## Uppgradera från OneUptime 10 → 11

OneUptime 11 bygger om telemetrilagringen i ClickHouse. Den här sidan förklarar
vad som ändras, vem som behöver agera och — för installationer som vill ta med
sig historisk telemetri — varje fråga som behövs för att göra det.

### Vad som ändras i v11

Telemetri (loggar, traces, metrics, undantag, profiler, monitorloggar,
granskningsloggar) flyttas till nya ClickHouse-tabeller med tidsbaserad
partitionering, komprimeringskodekar per kolumn och de nya kolumnerna i
entitetsmodellen:

| Gammal tabell         | Ny tabell             |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

Två kolumner byter namn i varje telemetritabell: `serviceId` →
`primaryEntityId` och `serviceType` → `primaryEntityType`. Detta är ett hårt
namnbyte — **om du frågar OneUptimes analytics-API direkt med
`serviceId`/`serviceType`-filter måste du uppdatera dem till de nya namnen.**
Dashboards, monitorer och larm inuti OneUptime migreras automatiskt.

Övergången är **enbart framåtriktad**: de nya tabellerna börjar tomma, all
telemetri som tas emot efter uppgraderingen hamnar i dem omedelbart, och
historiken fylls på naturligt med tiden. De gamla tabellerna behålls och
raderar sig själva gradvis via sin retentions-TTL.

### Vem behöver göra något

- **Nyinstallationer:** ingenting att göra.
- **Uppgraderingar som inte behöver telemetri från före uppgraderingen i
  gränssnittet:** ingenting att göra. Telemetrisidorna visar helt enkelt data
  från uppgraderingsögonblicket och framåt; äldre data åldras osedd ut ur de
  gamla tabellerna.
- **Uppgraderingar som vill ha telemetri från före uppgraderingen synlig:**
  kör den manuella kopieringen nedan, när som helst efter uppgraderingen.

Som alltid: uppgradera huvudversioner steg för steg (10 → 11, hoppa inte
över), och ta säkerhetskopior av Postgres och ClickHouse innan du uppgraderar.

### Valfritt: ta med telemetrihistoriken framåt

Kör dessa **efter att uppgraderingen har startat upp helt** (de nya tabellerna
och deras materialiserade vyer måste finnas). Anslut direkt på din
ClickHouse-värd — det nativa protokollet har inga HTTP-timeouts, så satser som
tar flera timmar är inga problem:

```bash
clickhouse-client --database oneuptime
```

Bra att veta innan du börjar:

- Kopieringen är säker att köra medan OneUptime är i drift. Ny telemetri
  skrivs oberoende till de nya tabellerna; den kopierade historiken fylls i
  bakom den.
- Räkna med flera timmar vid stor skala (hundratals GB).
- Varje sats nedan bär en `insert_deduplication_token`, och de nya tabellerna
  levereras med ett dedupliceringsfönster — så **det är säkert att köra om en
  sats som misslyckades halvvägs** (block som redan satts in hoppas över,
  även i metric-rollupperna), förutsatt att du kör om den inom rimlig tid.
  Vid tung pågående inmatning evakuerar fönstret (de senaste 10 000
  insättningsblocken per tabell) så småningom gamla tokens.
- Kopiering av metrics bygger också automatiskt om de föraggregerade
  dashboard-rollupperna (varje kopierad rad matas på nytt genom de
  materialiserade rollup-vyerna) — detta gör metric-kopieringen långsammare
  än de övriga; kör den sist.

#### Steg 1 — lista källpartitionerna

Varje gammal tabell har högst 16 partitioner. För varje källtabell:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2 ORDER BY _partition_id;
```

#### Steg 2 — generera kopieringssatsen

Kolumnuppsättningarna kan skilja sig något mellan installationer (äldre
driftsättningar kan sakna nyligen tillagda kolumner), så generera satsen från
ditt aktiva schema i stället för att klistra in en fast variant. Sätt `src`
och `dst` i `WITH`-klausulen till ett av tabellparen från tabellen ovan och
kör:

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

Den genererade satsen kopierar endast de kolumner som båda tabellerna delar
(nya kolumner får sina standardvärden), byter namn på
`serviceId`/`serviceType` i farten, sorterar raderna deterministiskt så att en
omkörning producerar identiska, deduplicerbara block, och lyfter de gränser
för exekveringstid och partitionsantal som en sats av den här storleken
behöver.

#### Steg 3 — kör den, en partition i taget

Ta den genererade satsen och ersätt `{PARTITION}` (den förekommer två gånger —
i `WHERE` och i token) med varje partitions-id från Steg 1. Kör satserna en i
taget och upprepa sedan Steg 1–3 för varje tabellpar.

Om en sats misslyckas halvvägs, kör om **samma** sats snarast — block som
redan har skrivits dedupliceras. Om du kör om den långt senare, jämför
radantal först (Steg 5).

#### Steg 4 (valfritt) — rollup-historik för metrics per värd

Kopierade råa metric-rader bygger automatiskt om rollupperna på tjänstenivå,
men inte rollupen **per värd** (gamla rader saknar entitetsnyckel för värd).
Uppgraderingen lämnar avsiktligt kvar den gamla rolluptabellen per värd så att
du kan ta den med framåt, genom att beräkna den nya nyckeln från värdnamnet:

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

#### Steg 5 — verifiera

Jämför totalsummor per tabellpar (den nya tabellen innehåller även rader från
efter uppgraderingen, så den bör vara större än eller lika med den gamla):

```sql
SELECT
  (SELECT count() FROM LogItemV2) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Steg 6 (valfritt) — frigör diskutrymme tidigt

De gamla tabellerna töms av sig själva via TTL, men när du är nöjd med
kopieringen kan du ta bort dem omedelbart:

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

> Tips: som vid varje större uppgradering, testa i en staging-miljö först och
> bekräfta att telemetri flödar in i de nya tabellerna innan du förlitar dig
> på kopian i produktion.



## Uppgradera från OneUptime 9 → 10

Inga ändringar som kräver manuella åtgärder. Följ bara den vanliga uppgraderingsprocessen.

## Uppgradera från OneUptime 8 → 9

Helm-diagrammet tillhandahåller inte längre en Kubernetes Ingress-resurs. OneUptime levereras med en ingress gateway-container som redan avslutar TLS, hanterar statussidadomäner och dirigerar trafik för plattformen, så en kluster-ingress-kontroller är inte längre nödvändig.

- Ta bort eventuella `oneuptimeIngress`-åsidosättningar från dina anpassade `values.yaml`-filer innan uppgraderingen. Dessa nycklar ignoreras nu och orsakar valideringsfel om de lämnas kvar.
- Se till att `nginx.service.type` återspeglar hur du vill exponera den medföljande ingress-gatewayen (till exempel `LoadBalancer`, `NodePort` eller `ClusterIP` med en extern lastbalanserare).
- Verifiera att eventuella DNS-poster för statussidor eller primära värdar fortfarande pekar på den tjänst eller lastbalanserare som befinner sig framför OneUptime ingress gateway.
- Efter uppgraderingen, bekräfta att TLS-certifikat fortsätter att förnyas via den inbäddade gatewayen och att statussidadomäner löser sig korrekt.


## Uppgradera från OneUptime 7 → 8

Om du kör på Kubernetes finns det viktiga brytande ändringar:

- Vi använder inte längre Bitnami-diagram för Postgres, Redis och ClickHouse på grund av [Bitnami-licensändringar](https://github.com/bitnami/charts/issues/35164)
- Dessa ändringar är inte bakåtkompatibla. Du måste följa den nya strukturen i Helm-diagrammets `values.yaml`.
- Säkerhetskopiera dina data (Postgres, ClickHouse och eventuella persistenta volymer) innan uppgraderingen.


> Tips: Testa uppgraderingen i en staging-miljö först. Bekräfta att dina arbetsbelastningar är friska och att data är intakt innan du uppgraderar produktionen.

# Uppgradera OneUptime

Den här guiden beskriver hur du säkert uppgraderar din egeninstallerade OneUptime-installation.

## Allmän vägledning

- Uppgradera steg för steg mellan huvudversioner (till exempel 6 → 7 → 8). Hoppa inte över huvudversioner.
- Du kan hoppa över minor/patch-versioner (till exempel 8.1 → 8.4) så länge du följer versionsnoteringarna.
- Ta alltid säkerhetskopior innan du uppgraderar och validera att du kan återställa dem.

## Uppgradering från OneUptime 10 → 11

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for v11 SSO->Enterprise change). -->

### Identity features (SSO, OIDC, SCIM) now require the Enterprise Edition

In v11, the following authentication and access-management features moved to
the **OneUptime Enterprise Edition** and are no longer part of the free,
open-source (Community) build:

- **SAML SSO** — both project login and status-page login
- **OpenID Connect (OIDC)** — both project login and status-page login
- **SCIM user provisioning** — project and status page
- **Global (instance-wide) SSO / OIDC**
- **Team compliance settings**

**What you'll see after upgrading:** if you configured any of these on a
Community Edition build, sign-in through them is disabled after the upgrade,
and the settings pages show an upgrade prompt instead of the configuration
form. Your existing provider records are **preserved in the database** —
nothing is deleted — they simply become inactive until the instance runs the
Enterprise Edition.

**Availability:**

- **Self-hosted:** requires the **Enterprise Edition** build.
- **OneUptime Cloud:** requires the **Scale** plan (or above).

**If you rely on SSO and self-host**, email
[support@oneuptime.com](mailto:support@oneuptime.com) for an Enterprise Edition
license so you can restore SSO/OIDC/SCIM. Mention that you upgraded from v10 to
v11 and we'll help you get it back online. If your team is mid-upgrade and this
is blocking sign-in, contact us before upgrading production so we can plan it
with you.

OneUptime 11 bygger om ClickHouse-telemetrilagringen. Den här sidan förklarar vad som ändras, vem som behöver agera och — för installationer som vill ta med historisk telemetri — varje fråga som behövs för det.

### Vad ändras i v11

Telemetri (loggar, traces, mätvärden, exceptions, profiler, monitor-loggar, audit-loggar) flyttas till nya ClickHouse-tabeller med tidsbaserad partitionering, komprimeringskodekar per kolumn och de nya entitetsmodell-kolumnerna:

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

Två kolumner byter namn i alla telemetritabeller: `serviceId` → `primaryEntityId` och `serviceType` → `primaryEntityType`. Det är ett hårt namnbyte — **om du frågar OneUptimes analytics-API direkt med `serviceId`-/`serviceType`-filter ska du uppdatera dem till de nya namnen.** Dashboards, monitorer och larm inne i OneUptime migreras automatiskt.

Övergången är **endast framåtriktad**: de nya tabellerna börjar tomma, all telemetri som tas in efter uppgraderingen hamnar i dem direkt, och historiken fylls naturligt på med tiden. De gamla tabellerna **tas bort automatiskt** under uppgraderingen för att frigöra deras diskutrymme — vill du behålla möjligheten att ta med historiken, byt namn på dem **före** uppgraderingen (Steg 0 nedan).

> **Redan på 11.0.0 eller 11.0.1?** De utgåvorna behöll de gamla tabellerna (de tömdes via TTL, och kopian kunde köras ”när som helst efter uppgraderingen”). Varje senare uppdatering **tar bort dem vid uppstart**. Om du fortfarande vill göra historikkopian och inte har gjort den ännu, utför Steg 0 nedan innan du tillämpar uppdateringen.

### Vem behöver göra något

- **Nyinstallationer:** inget att göra.
- **Uppgraderingar som inte behöver telemetri från före uppgraderingen i gränssnittet:** inget att göra. Telemetrisidorna visar helt enkelt data från uppgraderingsögonblicket och framåt; de gamla tabellerna tas bort under uppgraderingen.
- **Uppgraderingar som vill se telemetri från före uppgraderingen:** byt namn på de gamla tabellerna **före** uppgraderingen (Steg 0 nedan) och kör sedan den manuella kopian när som helst efteråt.

Som alltid: uppgradera huvudversioner steg för steg (10 → 11, hoppa inte över) och ta säkerhetskopior av Postgres och ClickHouse före uppgraderingen.

### Valfritt: ta med telemetrihistoriken

Steg 0 utförs **före uppgraderingen**; allt från Steg 1 och framåt utförs **efter att uppgraderingen har startat helt** (de nya tabellerna och deras materialized views måste finnas). Anslut direkt på din ClickHouse-värd — det nativa protokollet har inga HTTP-timeouts, så satser som tar flera timmar är inga problem:

```bash
clickhouse-client --database oneuptime
```

Bra att veta innan du börjar:

- Kopian kan köras säkert medan OneUptime är live. Ny telemetri skrivs oberoende till de nya tabellerna; den kopierade historiken fylls på bakom.
- Räkna med timmar i stor skala (hundratals GB).
- Varje sats nedan bär ett `insert_deduplication_token`, och de nya tabellerna levereras med ett dedupliceringsfönster — så **det är säkert att köra om en sats som misslyckades halvvägs** (redan infogade block hoppas över, även i mätvärdes-rollups), förutsatt att du kör om den någorlunda snart. Vid tung live-intagning tränger fönstret (de senaste 10 000 insert-blocken per tabell) till slut ut gamla tokens.
- Kopiering av mätvärden bygger också automatiskt om de föraggregerade dashboard-rollups (varje kopierad rad matar rollup-materialized-views på nytt) — det gör mätvärdeskopian långsammare än de andra; kör den sist.

#### Steg 0 — byt namn på de gamla tabellerna före uppgraderingen

Uppgraderingen tar bort de gamla tabellerna vid uppstart, så flytta först de tabeller du vill kopiera ifrån utom räckhåll. Stoppa OneUptime (skala ner deploymentet) så att inget skriver till dem eller kan återskapa dem, och byt sedan namn — `RENAME TABLE` är en omedelbar metadata-operation, och `IF EXISTS` låter blocket hoppa över tabeller som din installation aldrig haft (deployments äldre än mitten av 10.0.x kan sakna `AuditLogV1` eller vissa `…V2`-tabeller — då finns ingen historik av den typen att kopiera):

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

Uppgradera sedan och låt OneUptime starta helt innan du fortsätter.

> Om du rullar tillbaka till v10 efter namnbytet (v10 återskapar tomma tabeller med de gamla namnen vid uppstart), byt tillbaka `_backup`-tabellerna till deras ursprungliga namn innan du startar om v10 — annars hamnar telemetri som tas in under tillbakarullningen i de återskapade tabellerna och tas bort vid den senare uppgraderingen.

#### Steg 1 — lista källpartitionerna

Varje gammal tabell har högst 16 partitioner. För varje källtabell:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Steg 2 — generera kopieringssatsen

Kolumnuppsättningarna kan skilja sig något mellan installationer (äldre deployments kan sakna nyligen tillagda kolumner), så generera satsen från ditt live-schema i stället för att klistra in en fast. Sätt `src` och `dst` i `WITH`-klausulen till ett av tabellparen från tabellen ovan (källan bär `_backup`-suffixet från Steg 0) och kör:

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

Den genererade satsen kopierar bara de kolumner båda tabellerna delar (nya kolumner får sina standardvärden), byter namn på `serviceId`/`serviceType` i farten, sorterar raderna deterministiskt så att en omkörning ger identiska, deduplicerbara block, och lyfter de gränser för körtid och partitionsantal som en sats av den här storleken behöver.

#### Steg 3 — kör den, en partition i taget

Ta den genererade satsen och ersätt `{PARTITION}` (förekommer två gånger — i `WHERE` och i tokenet) med varje partitions-id från Steg 1. Kör satserna en i taget och upprepa sedan Steg 1–3 för varje tabellpar.

> Obs: hoppades en källtabell över i Steg 0 för att den inte fanns på din installation, misslyckas Steg 1 med `UNKNOWN_TABLE` för det paret — hoppa helt enkelt över paret; det finns ingen historik av den typen att kopiera.

Om en sats misslyckas halvvägs, kör snabbt om **samma** sats — redan committade block dedupliceras. Kör du om mycket senare, jämför radantalen först (Steg 5).

#### Steg 4 (valfritt) — historik för mätvärdes-rollup per värd

Kopierade råa mätvärdesrader bygger automatiskt om rollups på tjänstenivå, men inte **per-värd**-rollupen (gamla rader saknar värd-entitetsnyckel). Den gamla rollup-tabellen som bytte namn i Steg 0 är den enda källan till denna historik; ta med den genom att beräkna den nya nyckeln från värdnamnet:

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

`ORDER BY` spelar roll: den gör att en omkörning producerar identiska insert-block som dedupliceringstokenet kan känna igen. Utan den kunde en omkörning hoppas över i tysthet eller räknas dubbelt. (Kantfall: värdnamn som innehåller `\`, `|` eller `=` — inte giltiga RFC-1123-värdnamnstecken — skulle beräkna en annan nyckel än applikationen; ignorera detta om du inte vet att du har sådana värdar.)

#### Steg 5 — verifiera

Jämför totalerna per tabellpar (den nya tabellen innehåller även rader från efter uppgraderingen, så den bör vara större än eller lika med den gamla):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Steg 6 — ta bort säkerhetskopiorna

Tabellerna med nya namn behåller sin retentions-TTL, så de töms och krymper av sig själva — men så snart du är nöjd med kopian, ta bort dem för att frigöra disken direkt:

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

(`max_table_size_to_drop = 0` lyfter serverns 50 GB-borttagningsskydd för just den satsen.)

> Tips: som vid varje större uppgradering, testa först i en staging-miljö och bekräfta att telemetri strömmar in i de nya tabellerna innan du litar på kopian i produktion.

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

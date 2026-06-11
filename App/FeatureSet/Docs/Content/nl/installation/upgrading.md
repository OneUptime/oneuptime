# OneUptime upgraden

Deze handleiding beschrijft hoe u uw zelf-gehoste OneUptime-installatie veilig kunt upgraden.

## Algemene richtlijnen

- Upgrade stap voor stap door hoofdversies (bijvoorbeeld 6 → 7 → 8). Sla geen hoofdversies over.
- U kunt kleine/patch-versies overslaan (bijvoorbeeld 8.1 → 8.4) zolang u de release-opmerkingen volgt.
- Maak altijd back-ups voordat u upgradet en valideer of u deze kunt herstellen.

## Upgraden van OneUptime 10 → 11

OneUptime 11 bouwt de ClickHouse-telemetrieopslag opnieuw op. Deze pagina legt
uit wat er verandert, wie er iets moet doen en — voor installaties die
historische telemetrie willen meenemen — elke query die daarvoor nodig is.

### Wat verandert er in v11

Telemetrie (logs, traces, metrics, exceptions, profielen, monitorlogs,
auditlogs) verhuist naar nieuwe ClickHouse-tabellen met tijdgebaseerde
partitionering, compressiecodecs per kolom en de nieuwe
entiteitsmodel-kolommen:

| Oude tabel            | Nieuwe tabel          |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

Op elke telemetrietabel worden twee kolommen hernoemd: `serviceId` →
`primaryEntityId` en `serviceType` → `primaryEntityType`. Dit is een harde
hernoeming — **als u de OneUptime analytics-API rechtstreeks bevraagt met
`serviceId`/`serviceType`-filters, werk deze dan bij naar de nieuwe namen.**
Dashboards, monitors en alerts binnen OneUptime worden automatisch
gemigreerd.

De overgang is **forward-only**: de nieuwe tabellen beginnen leeg, alle
telemetrie die na de upgrade wordt geïngest, komt er direct in terecht, en de
geschiedenis vult zichzelf vanzelf weer op naarmate de tijd verstrijkt. De
oude tabellen blijven bestaan en verwijderen zichzelf geleidelijk via hun
retentie-TTL.

### Wie moet er iets doen

- **Nieuwe installaties:** niets te doen.
- **Upgrades waarbij telemetrie van vóór de upgrade niet zichtbaar hoeft te
  zijn in de UI:** niets te doen. Telemetriepagina's tonen simpelweg data
  vanaf het moment van de upgrade; oudere data verdwijnt ongezien uit de
  oude tabellen.
- **Upgrades waarbij telemetrie van vóór de upgrade zichtbaar moet
  blijven:** voer de handmatige kopie hieronder uit, op elk gewenst moment
  na de upgrade.

Zoals altijd: upgrade hoofdversies stap voor stap (10 → 11, niet overslaan)
en maak back-ups van Postgres en ClickHouse voordat u upgradet.

### Optioneel: telemetriegeschiedenis meenemen

Voer deze stappen uit **nadat de upgrade volledig is opgestart** (de nieuwe
tabellen en hun materialized views moeten bestaan). Maak rechtstreeks
verbinding op uw ClickHouse-host — het native protocol kent geen
HTTP-time-outs, dus statements die meerdere uren duren zijn geen probleem:

```bash
clickhouse-client --database oneuptime
```

Goed om te weten voordat u begint:

- De kopie kan veilig worden uitgevoerd terwijl OneUptime live is. Nieuwe
  telemetrie schrijft onafhankelijk naar de nieuwe tabellen; de gekopieerde
  geschiedenis vult zich daarachter aan.
- Reken op meerdere uren bij grote schaal (honderden GB's).
- Elk statement hieronder bevat een `insert_deduplication_token`, en de
  nieuwe tabellen worden geleverd met een deduplicatievenster — dus **het
  opnieuw uitvoeren van een statement dat halverwege is mislukt, is
  veilig** (reeds ingevoegde blokken worden overgeslagen, ook in de
  metric-rollups), mits u het redelijk snel opnieuw uitvoert. Bij zware
  live-ingest verdrijft het venster (de laatste 10.000 insert-blokken per
  tabel) uiteindelijk oude tokens.
- Het kopiëren van metrics herbouwt ook automatisch de vooraf geaggregeerde
  dashboard-rollups (elke gekopieerde rij voedt de rollup materialized
  views opnieuw) — hierdoor is de metric-kopie trager dan de andere; voer
  deze als laatste uit.

#### Stap 1 — de bronpartities opvragen

Elke oude tabel heeft maximaal 16 partities. Voor elke brontabel:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2 ORDER BY _partition_id;
```

#### Stap 2 — het kopieerstatement genereren

Kolommensets kunnen per installatie iets verschillen (oudere deployments
missen mogelijk recent toegevoegde kolommen), dus genereer het statement op
basis van uw live schema in plaats van een vast statement te kopiëren en
plakken. Stel `src` en `dst` in de `WITH`-clausule in op een van de
tabelparen uit de tabel hierboven, en voer uit:

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

Het gegenereerde statement kopieert alleen de kolommen die beide tabellen
gemeen hebben (nieuwe kolommen krijgen hun standaardwaarden), hernoemt
`serviceId`/`serviceType` on-the-fly, sorteert rijen deterministisch zodat
een nieuwe poging identieke, dedupliceerbare blokken oplevert, en heft de
limieten voor uitvoeringstijd en aantal partities op die een statement van
deze omvang nodig heeft.

#### Stap 3 — uitvoeren, één partitie per keer

Neem het gegenereerde statement en vervang `{PARTITION}` (het komt twee
keer voor — in de `WHERE` en in het token) door elk partitie-id uit Stap 1.
Voer de statements één voor één uit en herhaal vervolgens Stappen 1–3 voor
elk tabelpaar.

Als een statement halverwege mislukt, voer dan snel **hetzelfde** statement
opnieuw uit — reeds gecommitte blokken worden gededupliceerd. Voert u het
veel later opnieuw uit, vergelijk dan eerst de rijaantallen (Stap 5).

#### Stap 4 (optioneel) — per-host metric-rollupgeschiedenis

Gekopieerde ruwe metric-rijen herbouwen automatisch de rollups op
serviceniveau, maar niet de **per-host**-rollup (oude rijen hebben geen
host-entiteitssleutel). De upgrade laat de oude per-host-rolluptabel bewust
staan, zodat u deze kunt meenemen door de nieuwe sleutel uit de hostnaam te
berekenen:

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

#### Stap 5 — verifiëren

Vergelijk de totalen per tabelpaar (de nieuwe tabel bevat ook rijen van na
de upgrade, dus deze moet groter dan of gelijk aan de oude zijn):

```sql
SELECT
  (SELECT count() FROM LogItemV2) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Stap 6 (optioneel) — schijfruimte eerder vrijmaken

De oude tabellen lopen vanzelf leeg via TTL, maar zodra u tevreden bent met
de kopie kunt u ze direct verwijderen:

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

> Tip: test, zoals bij elke grote upgrade, eerst in een stagingomgeving en
> bevestig dat telemetrie naar de nieuwe tabellen stroomt voordat u in
> productie op de kopie vertrouwt.



## Upgraden van OneUptime 9 → 10

Geen wijzigingen die handmatige actie vereisen. Volg gewoon het standaard upgradeproces.

## Upgraden van OneUptime 8 → 9

De Helm-chart provisioneert niet langer een Kubernetes Ingress-resource. OneUptime wordt geleverd met een ingress gateway-container die al TLS beëindigt, statuspaginadomeinen beheert en verkeer voor het platform routeert, zodat een cluster ingress controller niet langer nodig is.

- Verwijder eventuele `oneuptimeIngress`-overschrijvingen uit uw aangepaste `values.yaml`-bestanden voordat u upgradet. Deze sleutels worden nu genegeerd en veroorzaken validatiefouten als ze aanwezig zijn.
- Zorg dat `nginx.service.type` weergeeft hoe u de gebundelde ingress gateway wilt blootstellen (bijvoorbeeld `LoadBalancer`, `NodePort` of `ClusterIP` met een externe load balancer).
- Controleer of eventuele DNS-records voor statuspagina's of primaire hosts nog steeds verwijzen naar de Service of load balancer die de OneUptime ingress gateway beheert.
- Bevestig na de upgrade dat TLS-certificaten blijven verlengen via de ingebedde gateway en dat statuspaginadomeinen correct worden omgezet.


## Upgraden van OneUptime 7 → 8

Als u op Kubernetes draait, zijn er belangrijke ingrijpende wijzigingen:

- We gebruiken de Bitnami-charts voor Postgres, Redis en ClickHouse niet langer vanwege [Bitnami-licentiewijzigingen](https://github.com/bitnami/charts/issues/35164)
- Deze wijzigingen zijn niet achterwaarts compatibel. U moet de nieuwe structuur in de Helm-chart `values.yaml` volgen.
- Maak een back-up van uw gegevens (Postgres, ClickHouse en alle permanente volumes) voordat u upgradet.


> Tip: Test de upgrade eerst in een stagingomgeving. Bevestig dat uw workloads gezond zijn en gegevens intact zijn voordat u productie upgradet.

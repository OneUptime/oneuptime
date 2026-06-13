# OneUptime upgraden

Deze handleiding beschrijft hoe u uw zelf-gehoste OneUptime-installatie veilig kunt upgraden.

## Algemene richtlijnen

- Upgrade stap voor stap door hoofdversies (bijvoorbeeld 6 → 7 → 8). Sla geen hoofdversies over.
- U kunt kleine/patch-versies overslaan (bijvoorbeeld 8.1 → 8.4) zolang u de release-opmerkingen volgt.
- Maak altijd back-ups voordat u upgradet en valideer of u deze kunt herstellen.

## Upgraden van OneUptime 10 → 11

OneUptime 11 bouwt de ClickHouse-telemetrieopslag opnieuw op. Deze pagina legt uit wat er verandert, wie actie moet ondernemen en — voor installaties die historische telemetrie willen behouden — elke query die daarvoor nodig is.

### Wat verandert er in v11

Telemetrie (logs, traces, metrics, exceptions, profielen, monitor-logs, audit-logs) verhuist naar nieuwe ClickHouse-tabellen met tijdgebaseerde partitionering, compressiecodecs per kolom en de nieuwe entiteitsmodel-kolommen:

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

In elke telemetrietabel worden twee kolommen hernoemd: `serviceId` → `primaryEntityId` en `serviceType` → `primaryEntityType`. Dit is een harde hernoeming — **als u de OneUptime-analytics-API rechtstreeks bevraagt met `serviceId`-/`serviceType`-filters, werk ze dan bij naar de nieuwe namen.** Dashboards, monitors en alerts binnen OneUptime worden automatisch gemigreerd.

De overgang is **uitsluitend voorwaarts**: de nieuwe tabellen beginnen leeg, alle telemetrie die na de upgrade binnenkomt landt er direct in, en de historie vult zich vanzelf weer aan naarmate de tijd verstrijkt. De oude tabellen worden tijdens de upgrade **automatisch verwijderd** om hun schijfruimte vrij te maken — wilt u de mogelijkheid openhouden om de historie mee te nemen, hernoem ze dan **vóór** de upgrade (Stap 0 hieronder).

> **Al op 11.0.0 of 11.0.1?** Die releases behielden de oude tabellen (ze liepen leeg via de TTL, en de kopie kon "op elk moment na de upgrade" worden uitgevoerd). Elke latere update **verwijdert ze bij het opstarten**. Wilt u de historie-kopie nog uitvoeren en hebt u dat nog niet gedaan, voer dan Stap 0 hieronder uit voordat u de update toepast.

### Wie moet iets doen

- **Nieuwe installaties:** niets te doen.
- **Upgrades die geen telemetrie van vóór de upgrade in de interface nodig hebben:** niets te doen. De telemetriepagina's tonen simpelweg data vanaf het moment van de upgrade; de oude tabellen worden tijdens de upgrade verwijderd.
- **Upgrades die telemetrie van vóór de upgrade zichtbaar willen hebben:** hernoem de oude tabellen **vóór** de upgrade (Stap 0 hieronder) en voer daarna op elk gewenst moment de handmatige kopie uit.

Zoals altijd: upgrade hoofdversies stap voor stap (10 → 11, niet overslaan) en maak vóór de upgrade back-ups van Postgres en ClickHouse.

### Optioneel: telemetriehistorie meenemen

Stap 0 voert u uit **vóór de upgrade**; alles vanaf Stap 1 voert u uit **nadat de upgrade volledig is opgestart** (de nieuwe tabellen en hun materialized views moeten bestaan). Maak rechtstreeks verbinding op uw ClickHouse-host — het native protocol kent geen HTTP-timeouts, dus statements van meerdere uren zijn geen probleem:

```bash
clickhouse-client --database oneuptime
```

Goed om te weten voordat u begint:

- De kopie kan veilig draaien terwijl OneUptime live is. Nieuwe telemetrie schrijft onafhankelijk naar de nieuwe tabellen; de gekopieerde historie vult zich erachter aan.
- Reken op uren bij grote schaal (honderden GB's).
- Elk statement hieronder draagt een `insert_deduplication_token`, en de nieuwe tabellen hebben een deduplicatievenster — dus **een statement dat halverwege faalde opnieuw uitvoeren is veilig** (al ingevoegde blokken worden overgeslagen, ook in de metric-rollups), mits u het redelijk snel opnieuw uitvoert. Bij zware live-ingest verdringt het venster (de laatste 10.000 insert-blokken per tabel) uiteindelijk oude tokens.
- Het kopiëren van metrics bouwt ook automatisch de vooraf geaggregeerde dashboard-rollups opnieuw op (elke gekopieerde rij voedt de rollup-materialized-views opnieuw) — daardoor is de metric-kopie trager dan de andere; voer die als laatste uit.

#### Stap 0 — hernoem vóór de upgrade de oude tabellen

De upgrade verwijdert de oude tabellen bij het opstarten, dus haal de tabellen waaruit u wilt kopiëren eerst uit zijn bereik. Stop OneUptime (schaal het deployment naar nul) zodat niets er meer naar schrijft of ze opnieuw kan aanmaken, en hernoem dan — `RENAME TABLE` is een directe metadata-operatie, en `IF EXISTS` laat het blok tabellen overslaan die uw installatie nooit had (deployments ouder dan midden 10.0.x missen mogelijk `AuditLogV1` of sommige `…V2`-tabellen — er is dan geen historie van dat type om te kopiëren):

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

Voer daarna de upgrade uit en laat OneUptime volledig opstarten voordat u verdergaat.

> Rolt u na het hernoemen terug naar v10 (v10 maakt bij het opstarten lege tabellen met de oude namen opnieuw aan), hernoem de `_backup`-tabellen dan terug naar hun oorspronkelijke namen voordat u v10 herstart — anders landt telemetrie die tijdens de rollback binnenkomt in de opnieuw aangemaakte tabellen en wordt die bij de uiteindelijke upgrade verwijderd.

#### Stap 1 — de bronpartities oplijsten

Elke oude tabel heeft hoogstens 16 partities. Voor elke brontabel:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Stap 2 — het kopieerstatement genereren

Kolommensets kunnen per installatie iets verschillen (oudere deployments missen mogelijk recent toegevoegde kolommen), dus genereer het statement uit uw live schema in plaats van een vast statement te plakken. Zet `src` en `dst` in de `WITH`-clausule op een van de tabelparen uit de tabel hierboven (de bron draagt het `_backup`-achtervoegsel uit Stap 0) en voer uit:

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

Het gegenereerde statement kopieert alleen de kolommen die beide tabellen delen (nieuwe kolommen krijgen hun standaardwaarden), hernoemt `serviceId`/`serviceType` onderweg, sorteert de rijen deterministisch zodat een herhaling identieke, dedupliceerbare blokken oplevert, en heft de limieten voor uitvoeringstijd en partitie-aantal op die een statement van deze omvang nodig heeft.

#### Stap 3 — uitvoeren, partitie voor partitie

Neem het gegenereerde statement en vervang `{PARTITION}` (komt twee keer voor — in de `WHERE` en in het token) door elk partitie-id uit Stap 1. Voer de statements één voor één uit en herhaal daarna Stappen 1–3 voor elk tabelpaar.

> Let op: is een brontabel in Stap 0 overgeslagen omdat die niet op uw installatie bestond, dan faalt Stap 1 voor dat paar met `UNKNOWN_TABLE` — sla het paar gewoon over; er is geen historie van dat type om te kopiëren.

Faalt een statement halverwege, voer dan snel **hetzelfde** statement opnieuw uit — al gecommitte blokken worden gededupliceerd. Voert u het veel later opnieuw uit, vergelijk dan eerst de rijaantallen (Stap 5).

#### Stap 4 (optioneel) — historie van de per-host metric-rollup

Gekopieerde ruwe metric-rijen bouwen de rollups op serviceniveau automatisch opnieuw op, maar niet de **per-host**-rollup (oude rijen hebben geen host-entiteitssleutel). De in Stap 0 hernoemde oude rollup-tabel is de enige bron voor deze historie; neem die mee door de nieuwe sleutel uit de hostnaam te berekenen:

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

De `ORDER BY` doet ertoe: die zorgt dat een herhaling identieke insert-blokken oplevert die het deduplicatietoken kan herkennen. Zonder zou een herhaling stilletjes kunnen worden overgeslagen of dubbel geteld. (Randgeval: hostnamen met `\`, `|` of `=` — geen geldige RFC-1123-hostnaamtekens — zouden een andere sleutel berekenen dan de applicatie; negeer dit tenzij u weet dat u zulke hosts hebt.)

#### Stap 5 — verifiëren

Vergelijk de totalen per tabelpaar (de nieuwe tabel bevat ook rijen van na de upgrade, dus die hoort groter dan of gelijk aan de oude te zijn):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Stap 6 — de back-ups verwijderen

De hernoemde tabellen behouden hun retentie-TTL, dus ze lopen vanzelf leeg en krimpen — maar zodra u tevreden bent met de kopie, verwijdert u ze om de schijfruimte direct vrij te maken:

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

(`max_table_size_to_drop = 0` heft de 50 GB-verwijderbeveiliging van de server op voor alleen dat statement.)

> Tip: test zoals bij elke grote upgrade eerst in een staging-omgeving en bevestig dat telemetrie naar de nieuwe tabellen stroomt voordat u in productie op de kopie vertrouwt.


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

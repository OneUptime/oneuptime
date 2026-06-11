# OneUptime aktualisieren

Diese Anleitung beschreibt, wie Sie Ihre selbst gehostete OneUptime-Installation sicher aktualisieren können.

## Allgemeine Hinweise

- Führen Sie Upgrades schrittweise über Hauptversionen durch (z. B. 6 → 7 → 8). Überspringen Sie keine Hauptversionen.
- Sie können Neben-/Patch-Versionen überspringen (z. B. 8.1 → 8.4), sofern Sie die Release-Notes beachten.
- Erstellen Sie immer Backups vor dem Upgrade und überprüfen Sie, ob Sie diese wiederherstellen können.

## Upgrade von OneUptime 10 → 11

OneUptime 11 baut den ClickHouse-Telemetrie-Speicher neu auf. Diese Seite erklärt, was sich ändert, wer handeln muss und – für Installationen, die historische Telemetriedaten übernehmen möchten – jede dafür benötigte Abfrage.

### Was sich in v11 ändert

Telemetriedaten (Logs, Traces, Metriken, Exceptions, Profile, Monitor-Logs, Audit-Logs) werden in neue ClickHouse-Tabellen mit zeitbasierter Partitionierung, spaltenweisen Kompressions-Codecs und den neuen Entity-Modell-Spalten verschoben:

| Alte Tabelle          | Neue Tabelle          |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

In jeder Telemetrie-Tabelle werden zwei Spalten umbenannt: `serviceId` → `primaryEntityId` und `serviceType` → `primaryEntityType`. Dies ist eine harte Umbenennung – **wenn Sie die OneUptime-Analytics-API direkt mit `serviceId`-/`serviceType`-Filtern abfragen, stellen Sie diese auf die neuen Namen um.** Dashboards, Monitore und Alerts innerhalb von OneUptime werden automatisch migriert.

Der Umstieg erfolgt **ausschließlich vorwärtsgerichtet**: Die neuen Tabellen starten leer, alle nach dem Upgrade eingelieferten Telemetriedaten landen sofort darin, und die Historie füllt sich mit der Zeit auf natürliche Weise wieder auf. Die alten Tabellen bleiben erhalten und löschen sich über ihre Aufbewahrungs-TTL schrittweise selbst.

### Wer handeln muss

- **Neuinstallationen:** keine Maßnahmen erforderlich.
- **Upgrades, die keine Telemetriedaten aus der Zeit vor dem Upgrade in der Benutzeroberfläche benötigen:** keine Maßnahmen erforderlich. Die Telemetrie-Seiten zeigen einfach Daten ab dem Zeitpunkt des Upgrades; ältere Daten laufen ungesehen aus den alten Tabellen aus.
- **Upgrades, bei denen Telemetriedaten aus der Zeit vor dem Upgrade sichtbar sein sollen:** Führen Sie die manuelle Kopie unten aus – jederzeit nach dem Upgrade.

Wie immer gilt: Führen Sie Upgrades über Hauptversionen schrittweise durch (10 → 11, nicht überspringen) und erstellen Sie vor dem Upgrade Backups von Postgres und ClickHouse.

### Optional: Telemetrie-Historie übernehmen

Führen Sie die folgenden Schritte aus, **nachdem das Upgrade vollständig hochgefahren ist** (die neuen Tabellen und ihre Materialized Views müssen existieren). Verbinden Sie sich direkt auf Ihrem ClickHouse-Host – das native Protokoll kennt keine HTTP-Timeouts, daher sind mehrstündige Statements unproblematisch:

```bash
clickhouse-client --database oneuptime
```

Gut zu wissen, bevor Sie beginnen:

- Die Kopie kann sicher ausgeführt werden, während OneUptime live ist. Neue Telemetriedaten werden unabhängig davon in die neuen Tabellen geschrieben; die kopierte Historie füllt sich dahinter auf.
- Rechnen Sie bei großem Datenvolumen (Hunderte von GB) mit mehreren Stunden.
- Jedes Statement unten trägt ein `insert_deduplication_token`, und die neuen Tabellen werden mit einem Deduplizierungsfenster ausgeliefert – daher ist es **sicher, ein teilweise fehlgeschlagenes Statement erneut auszuführen** (bereits eingefügte Blöcke werden übersprungen, auch in den Metrik-Rollups), sofern die Wiederholung zeitnah erfolgt. Bei starkem laufendem Ingest verdrängt das Fenster (die letzten 10.000 Insert-Blöcke pro Tabelle) irgendwann alte Tokens.
- Das Kopieren der Metriken baut außerdem die voraggregierten Dashboard-Rollups automatisch neu auf (jede kopierte Zeile speist die Rollup-Materialized-Views erneut) – dadurch ist die Metrik-Kopie langsamer als die anderen; führen Sie sie zuletzt aus.

#### Schritt 1 – Quellpartitionen auflisten

Jede alte Tabelle hat höchstens 16 Partitionen. Für jede Quelltabelle:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2 ORDER BY _partition_id;
```

#### Schritt 2 – Kopier-Statement generieren

Die Spaltensätze können sich zwischen Installationen leicht unterscheiden (älteren Deployments können kürzlich hinzugefügte Spalten fehlen). Generieren Sie das Statement daher aus Ihrem Live-Schema, statt ein festes Statement zu kopieren. Setzen Sie `src` und `dst` in der `WITH`-Klausel auf eines der Tabellenpaare aus der obigen Tabelle und führen Sie aus:

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

Das generierte Statement kopiert nur die Spalten, die beide Tabellen gemeinsam haben (neue Spalten erhalten ihre Standardwerte), benennt `serviceId`/`serviceType` direkt beim Kopieren um, sortiert die Zeilen deterministisch, sodass eine Wiederholung identische, deduplizierbare Blöcke erzeugt, und hebt die Limits für Ausführungszeit und Partitionsanzahl auf, die ein Statement dieser Größe benötigt.

#### Schritt 3 – Ausführen, Partition für Partition

Nehmen Sie das generierte Statement und ersetzen Sie `{PARTITION}` (es kommt zweimal vor – im `WHERE` und im Token) durch jede Partitions-ID aus Schritt 1. Führen Sie die Statements nacheinander aus und wiederholen Sie dann die Schritte 1–3 für jedes Tabellenpaar.

Wenn ein Statement teilweise fehlschlägt, führen Sie zeitnah **dasselbe** Statement erneut aus – bereits committete Blöcke werden dedupliziert. Wenn die Wiederholung deutlich später erfolgt, vergleichen Sie zuerst die Zeilenanzahlen (Schritt 5).

#### Schritt 4 (optional) – Historie der Pro-Host-Metrik-Rollups

Kopierte rohe Metrikzeilen bauen die Rollups auf Service-Ebene automatisch neu auf, nicht jedoch das **Pro-Host**-Rollup (alte Zeilen haben keinen Host-Entity-Key). Das Upgrade lässt die alte Pro-Host-Rollup-Tabelle absichtlich bestehen, damit Sie sie übernehmen können, wobei der neue Schlüssel aus dem Hostnamen berechnet wird:

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

#### Schritt 5 – Überprüfen

Vergleichen Sie die Gesamtzahlen pro Tabellenpaar (die neue Tabelle enthält auch Zeilen aus der Zeit nach dem Upgrade, sie sollte daher größer oder gleich der alten sein):

```sql
SELECT
  (SELECT count() FROM LogItemV2) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Schritt 6 (optional) – Speicherplatz vorzeitig freigeben

Die alten Tabellen leeren sich von selbst über die TTL, aber sobald Sie mit der Kopie zufrieden sind, können Sie sie sofort löschen:

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

> Tipp: Testen Sie wie bei jedem Major-Upgrade zuerst in einer Staging-Umgebung und bestätigen Sie, dass Telemetriedaten in die neuen Tabellen fließen, bevor Sie sich in der Produktion auf die Kopie verlassen.



## Upgrade von OneUptime 9 → 10

Keine Änderungen, die manuelle Eingriffe erfordern. Folgen Sie einfach dem Standard-Upgrade-Prozess.

## Upgrade von OneUptime 8 → 9

Das Helm-Chart stellt keine Kubernetes Ingress-Ressource mehr bereit. OneUptime enthält einen Ingress-Gateway-Container, der bereits TLS terminiert, Status-Seiten-Domains verwaltet und den Datenverkehr für die Plattform routed – ein Cluster-Ingress-Controller ist daher nicht mehr erforderlich.

- Entfernen Sie alle `oneuptimeIngress`-Überschreibungen aus Ihren benutzerdefinierten `values.yaml`-Dateien vor dem Upgrade. Diese Schlüssel werden jetzt ignoriert und verursachen Validierungsfehler, wenn sie vorhanden bleiben.
- Stellen Sie sicher, dass `nginx.service.type` widerspiegelt, wie Sie das enthaltene Ingress-Gateway bereitstellen möchten (z. B. `LoadBalancer`, `NodePort` oder `ClusterIP` mit einem externen Load Balancer).
- Überprüfen Sie, ob DNS-Einträge für Status-Seiten oder primäre Hosts weiterhin auf den Service oder Load Balancer verweisen, der das OneUptime Ingress-Gateway bedient.
- Bestätigen Sie nach dem Upgrade, dass TLS-Zertifikate über das eingebettete Gateway weiterhin erneuert werden und dass Status-Seiten-Domains korrekt aufgelöst werden.


## Upgrade von OneUptime 7 → 8

Wenn Sie auf Kubernetes betreiben, gibt es wichtige Breaking Changes:

- Wir verwenden keine Bitnami-Charts mehr für Postgres, Redis und ClickHouse aufgrund von [Bitnami-Lizenzänderungen](https://github.com/bitnami/charts/issues/35164)
- Diese Änderungen sind nicht rückwärtskompatibel. Sie müssen die neue Struktur im Helm-Chart `values.yaml` befolgen.
- Sichern Sie Ihre Daten (Postgres, ClickHouse und alle persistenten Volumes) vor dem Upgrade.


> Tipp: Testen Sie das Upgrade zuerst in einer Staging-Umgebung. Bestätigen Sie, dass Ihre Workloads fehlerfrei sind und die Daten intakt sind, bevor Sie die Produktion upgraden.

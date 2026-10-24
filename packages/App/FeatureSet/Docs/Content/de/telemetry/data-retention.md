# Datenaufbewahrung

OneUptime bewahrt Ihre Protokolle, Traces, Metriken und Profile eine Anzahl von Tagen auf und löscht sie dann: 15 Tage, sofern Sie das nicht ändern. Diese Seite zeigt, wie diese Zahl ermittelt wird, wie Sie sie für das ganze Projekt ändern und wie Sie manche Telemetrie länger oder kürzer aufbewahren als den Rest.

:::cards
- [Wie lange Telemetrie aufbewahrt wird](#wie-lange-telemetrie-aufbewahrt-wird): Die Reihenfolge, in der OneUptime die Einstellungen liest.
- [Die Aufbewahrung des Projekts ändern](#die-aufbewahrung-des-projekts-ändern): Eine Zahl für Ihre gesamte Telemetrie.
- [Manche Telemetrie länger oder kürzer aufbewahren](#manche-telemetrie-länger-oder-kürzer-aufbewahren): Nach Typ, Schweregrad, Status oder Dienst.
- [Was Aufbewahrung kostet](#was-aufbewahrung-kostet): Abrechnung in OneUptime Cloud, Speicherplatz beim Selbsthosten.
:::

## Wie lange Telemetrie aufbewahrt wird

Jedes Protokoll, jeder Span, jeder Metrikpunkt und jede Profilprobe bekommt beim Ankommen seine Aufbewahrung. OneUptime ermittelt, wie viele Tage er aufbewahrt wird, stempelt das Datum, an dem er abläuft, und löscht ihn nach diesem Datum. Die genaueste Einstellung gewinnt:

```mermaid title="Welche Einstellung bestimmt, wie lange ein Datensatz bleibt"
flowchart TB
    arrive["Ein Protokoll, Span oder<br/>Metrikpunkt kommt an"] --> resource{"Am Dienst oder<br/>an der Ressource<br/>gesetzt?"}
    resource -->|"Nein"| byType{"Am Projekt für<br/>diesen Typ gesetzt?"}
    byType -->|"Nein"| projectDefault["Standard des Projekts:<br/>15 Tage, sofern<br/>nicht geändert"]
    resource -->|"Ja"| stamped["Mit Ablaufdatum<br/>gestempelt: Ankunft<br/>plus die Tage"]
    byType -->|"Ja"| stamped
    projectDefault --> stamped
    stamped --> deleted["Nach diesem<br/>Datum gelöscht"]
```

Vollständig liest OneUptime diese Einstellungen in dieser Reihenfolge, und die erste gesetzte entscheidet:

| Reihenfolge | Einstellung | Wo sie gesetzt wird |
| --- | --- | --- |
| 1 | Tage für einen Protokoll-Schweregrad oder Span-Status, für einen Dienst oder eine Ressource | **Aufbewahrung nach Telemetrietyp**, auf deren Seite **Einstellungen** |
| 2 | Tage für einen Telemetrietyp, für einen Dienst oder eine Ressource | Dieselbe Karte |
| 3 | Tage für alles von einem Dienst oder einer Ressource | **Aufbewahrung von Telemetriedaten**, auf derselben Seite |
| 4 | Tage für einen Protokoll-Schweregrad oder Span-Status, für das Projekt | **Aufbewahrung nach Telemetrietyp**, auf **Datenaufbewahrung** |
| 5 | Tage für einen Telemetrietyp, für das Projekt | Dieselbe Karte |
| 6 | Tage für alles andere | **Standardaufbewahrung (Tage)**, auf **Datenaufbewahrung** |

- **Die Einstellungen 1 bis 5 sind Aufbewahrungs-Überschreibungen.** Sie gehören zur [Enterprise Edition](/docs/self-hosted/enterprise) und in OneUptime Cloud zum Scale-Plan. Ohne sie wird jeder Datensatz für den Standard des Projekts aufbewahrt.
- **Eine Änderung gilt für neue Telemetrie.** Ein Datensatz behält das Datum, mit dem er gestempelt wurde: Eine kürzere Aufbewahrung löscht ihn nicht früher, und eine längere bewahrt ihn nicht länger auf. Neue Datensätze folgen einer Änderung nach etwa fünf Minuten.
- **Ausnahmen folgen dem, worin sie gefunden wurden.** Eine Ausnahme wird so lange aufbewahrt wie der Span oder das Protokoll, aus dem sie stammt. Session Replays haben eine eigene Aufbewahrung: siehe [Andere Daten mit eigener Aufbewahrung](#andere-daten-mit-eigener-aufbewahrung).

## Bevor Sie beginnen

- **Eine Rolle, die das Projekt ändern darf.** Project Owner oder Project Admin ändern die Aufbewahrung des Projekts. Die Aufbewahrung eines Dienstes oder einer Ressource erfordert die Rolle, die auch ihre anderen Einstellungen ändert.
- **Für Überschreibungen die Enterprise Edition oder der Scale-Plan.** Eine selbst gehostete Installation braucht eine Enterprise-Lizenz, ein Projekt in OneUptime Cloud den Scale-Plan oder höher. Die Standardaufbewahrung des Projekts gibt es in jeder Edition und jedem Plan.

## Die Aufbewahrung des Projekts ändern

:::steps
### Datenaufbewahrung öffnen

Gehen Sie zu **Projekteinstellungen → Telemetrie & APM → Datenaufbewahrung**. **Telemetrie & APM** ist im Seitenmenü anfangs eingeklappt: Klicken Sie darauf, um es zu öffnen. Die Karte **Aufbewahrung von Telemetriedaten** zeigt **Standardaufbewahrung (Tage)**.

### Die Anzahl der Tage festlegen

Klicken Sie auf **Aufbewahrungseinstellungen bearbeiten**, geben Sie die Anzahl der Tage ein, mindestens 1, und klicken Sie auf **Änderungen speichern**.
:::

Die neue Zahl gilt für jeden Datensatz, der ab dann ankommt und keine eigene Überschreibung hat.

## Manche Telemetrie länger oder kürzer aufbewahren

Überschreibungen bewahren auf, was Sie brauchen, länger und den Rest kürzer: Fehlerprotokolle etwa ein Quartal und Debug-Protokolle ein paar Tage.

### Für das ganze Projekt

Unter dem Standard legt die Karte **Aufbewahrung nach Telemetrietyp** Tage für jeden Telemetrietyp fest. Klicken Sie auf **Edit Overrides**, füllen Sie die Felder aus, die Sie brauchen, und lassen Sie den Rest leer:

| Typ | Felder |
| --- | --- |
| Protokolle | **Logs default (days)**, und ein Feld für jeden Protokoll-Schweregrad |
| Traces | **Traces default (days)**, und ein Feld für jeden Span-Status: Fehler, OK und Nicht festgelegt |
| Metriken | **Metrics default (days)** |
| Profile | **Profiles default (days)** |

Ein leeres Feld fällt auf die nächste Einstellung der obigen Reihenfolge zurück, sodass ein Schweregrad ohne eigene Tage seine Protokolle so lange aufbewahrt wie der Protokoll-Standard.

### Für einen Dienst oder eine Ressource

Öffnen Sie die Seite **Einstellungen** des Dienstes oder der Ressource. Ihre Karte **Aufbewahrung von Telemetriedaten** enthält **Telemetriedaten aufbewahren für (Tage)**, eine Zahl für alles, was sie sendet, und ihre Karte **Aufbewahrung nach Telemetrietyp** hat dieselben Felder wie die des Projekts. Lassen Sie ein Feld leer, um die Einstellungen des Projekts zu nutzen.

Dienste, Hosts, Kubernetes-Cluster, Docker- und Podman-Hosts, Docker Swarm-, Proxmox- und Ceph-Cluster, Speicher-Arrays, vCenter, Datenbanken, Serverless-Funktionen, Cloud-Ressourcen, RUM-Anwendungen und IoT-Flotten haben alle diese Karten. Siehe den [Dienstkatalog](/docs/telemetry/services#einen-dienst-ändern) für die Seite **Einstellungen** eines Dienstes.

### Wenn Plan oder Lizenz keine Überschreibungen mehr umfassen

- **In einer selbst gehosteten Installation** gelten Überschreibungen nicht mehr, sobald die Enterprise-Testphase oder die Kulanzfrist ohne Lizenz endet. Neue Telemetrie wird für den Standard des Projekts aufbewahrt, die Karten werden schreibgeschützt, und nichts, was Sie gesetzt haben, wird gelöscht: Aktivieren Sie eine Lizenz, und sie gelten wieder. Siehe [Enterprise Edition](/docs/self-hosted/enterprise#wenn-eine-lizenz-abläuft-oder-fehlt).
- **In OneUptime Cloud** gilt eine Überschreibung, die eine Testphase gesetzt hat, unterhalb des Scale-Plans weiter. Ihre Seite zeigt sie unter der Upgrade-Karte, mit einer Schaltfläche **Überschreibung entfernen**, die in jedem Plan funktioniert. Eine Überschreibung erneut zu setzen erfordert den Scale-Plan.

## Andere Daten mit eigener Aufbewahrung

| Daten | Aufbewahrt für | Wo sie geändert wird |
| --- | --- | --- |
| Session Replays | 7 Tage, sofern nicht geändert | Die Replay-Richtlinie der RUM-Anwendung: siehe [Anwendungen verwalten](/docs/rum/applications#aufbewahrung-der-sitzungswiedergabe). |
| Monitor-Protokolle, eine Zeile pro Prüfung | 1 Tag, sofern nicht geändert | In einer selbst gehosteten Installation **Aufbewahrung der Überwachungsprotokolle (Tage)** im Admin Dashboard |
| Monitor-Metriken und die Metriken, die SLOs aufzeichnen | 30 Tage, sofern nicht geändert | In einer selbst gehosteten Installation **Aufbewahrung der Überwachungsmetriken (Tage)** im Admin Dashboard |

## Was Aufbewahrung kostet

- **In OneUptime Cloud** wird Telemetrie pro aufgenommenem GB abgerechnet, und der Preis pro GB enthält 15 Tage Aufbewahrung. Längere Aufbewahrung kostet anteilig mehr: 30 Tage kosten pro GB doppelt so viel wie 15. Kürzere Aufbewahrung kostet anteilig weniger, aber Aufbewahrung unter 7 Tagen wird als 7 Tage abgerechnet. **Projekteinstellungen → Abrechnung und Rechnungen → Nutzungsverlauf** zeigt Tag für Tag, wie viel jeder Dienst gesendet hat und wie lange es aufbewahrt wird.
- **Beim Selbsthosten** liegt Telemetrie in ClickHouse, und die Aufbewahrung vervielfacht dessen Speicherplatz. Siehe [Dimensionierung](/docs/installation/sizing#aufbewahrung-und-ihr-einfluss-auf-den-speicher).

Telemetrie, die Sie nicht brauchen, kostet nichts, wenn sie nie gespeichert wird: [Drop-Filter & Scrub-Regeln](/docs/telemetry/drop-filters-and-scrub-rules) verwerfen sie beim Ankommen.

## Fehlerbehebung

:::details Ich habe die Aufbewahrung verkürzt, aber alte Daten sind noch da
Ein Datensatz behält das Ablaufdatum, mit dem er beim Ankommen gestempelt wurde. Vor der Änderung gespeicherte Datensätze werden an ihren eigenen Daten gelöscht, und nur neue Datensätze folgen der neuen Aufbewahrung.
:::

:::details Die Überschreibungskarten zeigen einen Upgrade-Hinweis
Aufbewahrungs-Überschreibungen erfordern in einer selbst gehosteten Installation die Enterprise Edition und in OneUptime Cloud den Scale-Plan. Bis dahin wird alles für den Standard des Projekts aufbewahrt.
:::

:::details Speicherplatz wird einen Tag nach dem Ablauf der Daten frei
Abgelaufene Datensätze erscheinen nicht mehr in Suchen, Diagrammen und Listen, sobald sie ablaufen. Auf der Festplatte werden Protokolle und Metriken um die erste Mitternacht danach gelöscht, sodass ihr Platz bis zu einen Tag später frei wird.
:::

## Nächste Schritte

:::cards
- [Ingestion-Schlüssel](/docs/telemetry/ingestion-keys): Telemetrie in Ihr Projekt senden.
- [Drop-Filter & Scrub-Regeln](/docs/telemetry/drop-filters-and-scrub-rules): Nur die Telemetrie behalten, die Sie brauchen.
- [Dienstkatalog](/docs/telemetry/services): Die eigene Aufbewahrung eines Dienstes festlegen.
- [Enterprise Edition](/docs/self-hosted/enterprise): Womit Aufbewahrungs-Überschreibungen kommen.
:::

# Datenbank-Integritätsüberwachung

Die Datenbank-Integritätsüberwachung verbindet sich nach Zeitplan mit PostgreSQL, MySQL oder Microsoft SQL Server und meldet die Gesundheitssignale des Servers selbst — Verbindungsreserve, blockierte Sitzungen, Replikationsverzögerung, Cache-Trefferquote, Datenbankgröße, Transaktions-ID-Wraparound und gut dreißig weitere —, sodass Sie darauf genauso alarmieren können wie auf eine Website, die nicht erreichbar ist.

Sie schreiben kein SQL. Die Sonde führt einen festen, je nach Engine gewählten Satz schreibgeschützter Katalogabfragen aus und meldet eine kleine Menge benannter Zahlen.

:::cards
- [Überwachungsbenutzer anlegen](#überwachungsbenutzer-anlegen): Die Berechtigungen, die jede Engine braucht. Auf diesen Schritt kommt es am meisten an.
- [Monitor erstellen](#einen-datenbank-integritäts-monitor-erstellen): Eine Sonde auf die Datenbank richten und auswählen, was erfasst wird.
- [Erfasste Metriken](#erfasste-metriken): Jede Zeitreihe, mit den Engines, die sie melden.
- [Kriterien einrichten](#kriterien-einrichten): Bei Verbindungen, Blockierungen, Verzögerung und Wraparound alarmieren.
:::

## Datenbank-Integrität oder SQL-Abfrage?

Die beiden Monitortypen für Datenbanken beantworten unterschiedliche Fragen und sind dafür gedacht, zusammen eingesetzt zu werden.

| | Datenbank-Integrität | [SQL-Abfrage](/docs/monitor/sql-monitor) |
|---|---|---|
| Beantwortete Frage | „Ist die Datenbank selbst gesund?“ | „Sind meine Daten so, wie ich sie erwarte?“ |
| Abfrage | Eingebaut, je Engine, schreibgeschützt | Ihre eigene |
| Meldet | Benannte numerische Metriken (siehe [Erfasste Metriken](#erfasste-metriken)) | Zeilenanzahl, Skalarwert, erste Zeile, Ausführungszeit |
| Typischer Alarm | Genutzte Verbindungen über 90 % | Mehr als 50 stornierte Bestellungen in den letzten fünf Minuten |
| Benötigte Berechtigungen | Lesezugriff auf Statistiken/DMVs — siehe [Überwachungsbenutzer anlegen](#überwachungsbenutzer-anlegen) | `SELECT` auf die Tabellen, die Ihre Abfrage berührt |

Wenn Sie bei einer fachlichen Bedingung alarmieren möchten, nutzen Sie den SQL-Abfrage-Monitor. Wenn Sie wissen möchten, dass dem Server die Verbindungen ausgehen, bevor die fachliche Bedingung überhaupt fehlschlagen kann, nutzen Sie diesen.

## Unterstützte Datenbanken

| Datenbank | Standardport |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

Azure SQL Database und Azure SQL Managed Instance verbinden sich als **Microsoft SQL Server**. Sie brauchen andere Berechtigungen — siehe [Überwachungsbenutzer anlegen](#überwachungsbenutzer-anlegen).

PostgreSQL- und MySQL-kompatible Engines, die dasselbe Wire-Protokoll sprechen, funktionieren meistens, stellen aber unter Umständen weniger Statistik-Views bereit; die betroffenen Metriken werden dann als nicht verfügbar gemeldet statt erfasst. Offiziell getestet sind nur die drei Engines oben.

Jede Datenbank, die Ihre Anwendungen, Cluster und Hosts nutzen — diese drei Engines und viele weitere —, erhält außerdem eine eigene Seite mit ihren Engine-Metriken, Logs und den Diensten, die sie aufrufen: siehe [Datenbanken](/docs/telemetry/databases). Wenn Host und Port, mit denen sich ein Datenbank-Integritäts-Monitor verbindet, einer der Endpunkte einer Datenbank sind, erscheinen die Alarme und Vorfälle des Monitors auch auf der Seite dieser Datenbank (siehe [Alarme bei einer Datenbank](/docs/telemetry/databases#alerts-on-a-database)).

## So funktioniert es

Bei jeder Prüfung macht eine Sonde Folgendes:

1. Sie verbindet sich mit den konfigurierten Zugangsdaten mit der Datenbank.
2. Sie führt eine leichtgewichtige Testabfrage aus. **Das ist die einzige Anweisung, deren Fehlschlag den Monitor offline nehmen kann.**
3. Sie führt die Katalogabfragen jeder aktivierten [Metrikgruppe](#metrikgruppen) nacheinander aus, jede mit einem Statement-Timeout.
4. Sie meldet die erfassten Zahlen und zu jeder Gruppe, die sie nicht erfassen konnte, einen Hinweis mit dem Grund.

```mermaid title="Eine Prüfung, und der einzige Schritt, der den Monitor offline nehmen kann"
flowchart TB
    connect["Mit der Datenbank verbinden"] --> probe{"Testabfrage OK?"}
    probe -->|"Nein"| offline["Monitor offline"]
    probe -->|"Ja"| groups["Jede Metrikgruppe ausführen"]
    groups --> group{"Gruppe erfasst?"}
    group -->|"Ja"| metrics["Metriken gemeldet"]
    group -->|"Nein"| issue["Metriken fehlen, Problem vermerkt"]
    metrics --> criteria["Kriterien ausgewertet"]
    issue --> criteria
```

An OneUptime werden nur benannte numerische Aggregate gesendet. Kein Abfragetext, keine Zeilen aus Ihren Tabellen und keine Schemanamen verlassen Ihr Netzwerk — die Abfragen lesen die engine-eigenen Statistik-Views (`pg_stat_activity`, `performance_schema.global_status`, `sys.dm_exec_sessions` und verwandte), niemals Ihre Daten.

Weil die Prüfung von einer Sonde aus läuft, muss die Datenbank nur von der Sonde aus erreichbar sein. Stellen Sie eine [benutzerdefinierte Sonde](/docs/probe/custom-probe) in Ihr Netzwerk, dann braucht OneUptime überhaupt keine Route zur Datenbank.

## Bevor Sie beginnen

- Eine **Sonde** mit Netzwerkzugriff auf Host und Port der Datenbank. Nutzen Sie eine von OneUptime gehostete Sonde, wenn die Datenbank aus dem Internet erreichbar ist, andernfalls eine [benutzerdefinierte Sonde](/docs/probe/custom-probe) in Ihrem Netzwerk.
- Ein **Überwachungsbenutzer**, angelegt wie im nächsten Abschnitt beschrieben, und seine Verbindungsdaten.

## Überwachungsbenutzer anlegen

**Das ist der wichtigste Schritt.** Der Monitor liest Statistik-Views, die gewöhnliche Logins nicht sehen dürfen, und ein Login mit zu wenigen Rechten scheitert nicht immer mit einem Fehler — auf PostgreSQL liefert er eine falsche Antwort. Legen Sie ein eigenes Login mit genau diesen Berechtigungen und nichts anderem an.

### PostgreSQL

```sql
CREATE USER oneuptime_health WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE mydb TO oneuptime_health;
-- The one grant that matters. Without it, see the note below.
GRANT pg_monitor TO oneuptime_health;
```

`pg_monitor` ist eine eingebaute Rolle (ab PostgreSQL 10), die Lesezugriff auf die Statistik- und Überwachungs-Views gewährt. Auf Ihre Tabellen gewährt sie keinen Zugriff.

> [!IMPORTANT]
> **Warum `pg_monitor` auf PostgreSQL nicht optional ist.** Ohne die Rolle schlägt `pg_stat_activity` nicht fehl — die Abfrage gelingt und liefert nur die eigene Zeile der Überwachungssitzung. Verbindungszahlen stünden dann für immer auf `1`, blockierte Sitzungen auf `0` und die Replikationsverzögerung auf `0`, auf einem Server, der in Wahrheit brennt. Deshalb prüft die Sonde, **bevor** sie diese Abfragen ausführt, ob das Login Mitglied von `pg_monitor` (oder `pg_read_all_stats`) oder ein Superuser ist. Trifft nichts davon zu, meldet die Sonde die Gruppen Connections, Activity und Locks als nicht verfügbar, zusammen mit dem `GRANT`, den Sie brauchen. Nichts zu melden ist die ehrliche Antwort; `1` zu melden ist es nicht.

Auf einem verwalteten Dienst, auf dem `pg_monitor` nicht verfügbar ist, deckt `pg_read_all_stats` dieselben Views ab. Auf Amazon RDS ist `GRANT rds_superuser` nicht nötig — `GRANT pg_monitor TO oneuptime_health;` funktioniert als Mitglied von `rds_superuser`.

### MySQL

```sql
CREATE USER 'oneuptime_health'@'%' IDENTIFIED BY 'a-strong-password';
-- INNODB_TRX (open transactions, longest query) and replication status.
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_health'@'%';
-- Status counters, server variables, and lock waits.
GRANT SELECT ON performance_schema.* TO 'oneuptime_health'@'%';
-- Database size: information_schema.TABLES only shows tables the login can see.
GRANT SELECT ON mydb.* TO 'oneuptime_health'@'%';
FLUSH PRIVILEGES;
```

Das `performance_schema` von MySQL muss aktiviert sein (`performance_schema = ON`, seit 5.6 die Voreinstellung). Ist es aus, melden die Gruppen Connections, Throughput und Locks sich als nicht verfügbar, und die Lösung ist ein Neustart des Servers, keine Berechtigung.

### Microsoft SQL Server und Azure SQL Managed Instance

```sql
-- A server-level grant only runs while the current database is master.
USE master;
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';
-- Every DMV the monitor reads. On SQL Server 2022 and later,
-- VIEW SERVER PERFORMANCE STATE alone is also enough.
GRANT VIEW SERVER STATE TO oneuptime_health;

USE mydb;
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
```

Aus jeder anderen Datenbank heraus schlägt `GRANT VIEW SERVER STATE` mit Msg 4621 fehl: „Permissions at the server scope can only be granted when the current database is master“.

> [!WARNING]
> **Lesezugriff auf Ihre Tabellen reicht nicht.** Ein Login, das nur Daten lesen kann — `db_datareader` oder eine andere Rolle mit „Lesezugriff“ —, kann sich verbinden und erhält die Datenbankgröße, sonst nichts. SQL Server verweigert die Views, die der Monitor liest, mit `The user does not have permission to perform this action.` (Msg 297). Die Meldung davor nennt, was verweigert wurde: Msg 300 `VIEW SERVER STATE` (`VIEW SERVER PERFORMANCE STATE` auf 2022) für die Server-Views, einschließlich Transaktionsprotokoll-Speicherplatz und freiem tempdb-Speicher, oder Msg 262 `VIEW DATABASE STATE` (`VIEW DATABASE PERFORMANCE STATE` auf 2022) für die Replikations-View. Der Monitor bleibt online, meldet bei den Gruppen Connections, Activity, Throughput, Locks, Storage und Replication eine fehlende Berechtigung und zeigt daneben den `GRANT` von oben. `VIEW SERVER STATE` deckt sie alle ab.
>
> Zwei Views verweigern nicht: Ohne die Berechtigung zeigen `sys.dm_exec_sessions` und `sys.dm_exec_requests` stillschweigend nur die eigene Sitzung des Monitors. Der Monitor liest sie nie für sich allein, sondern immer zusammen mit einer View, die verweigert — eine fehlende Berechtigung kann also nie als „1 Verbindung“ erfasst werden.

### Azure SQL Database

Azure SQL Database hat keine Berechtigungen auf Serverebene — `GRANT VIEW SERVER STATE` schlägt dort fehl —, daher öffnet stattdessen eine Berechtigung auf Datenbankebene dieselben Views. Legen Sie in `master` ein Login an, geben Sie ihm einen Benutzer in der überwachten Datenbank und erteilen Sie die Berechtigung dort, nicht in `master`:

```sql
-- Connected to master, as the server admin:
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';

-- Connected to the monitored database:
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
GRANT VIEW DATABASE STATE TO oneuptime_health;
```

Das reicht bei vCore-Datenbanken und bei DTU-Datenbanken ab S2. Bei **Basic, S0 und S1** sowie für jede Datenbank in einem **Pool für elastische Datenbanken** lässt Azure nur den Serveradministrator, den Microsoft Entra-Administrator oder Mitglieder der Serverrolle `##MS_ServerStateReader##` diese Views lesen, egal was die Berechtigungen der Datenbank sagen. Dort fügt der Serveradministrator das Login zusätzlich dieser Rolle hinzu:

```sql
-- Connected to master, as the server admin:
ALTER SERVER ROLE ##MS_ServerStateReader## ADD MEMBER oneuptime_health;
```

`##MS_ServerStateReader##` funktioniert auf jeder Dienstebene und ist daher auch der Ausweg, falls `VIEW DATABASE STATE` doch nicht reicht. Eine neue Rollenmitgliedschaft kann ein paar Minuten brauchen, bis sie greift, und gilt nur für neue Verbindungen; die Sonde öffnet bei jeder Prüfung eine neue Verbindung.

Ein eigenständiger Datenbankbenutzer (`CREATE USER oneuptime_health WITH PASSWORD = '...'` in der überwachten Datenbank, ohne Login) funktioniert ab S2 mit `VIEW DATABASE STATE`, kann aber nicht Mitglied von `##MS_ServerStateReader##` werden: Serverrollen nehmen nur Logins auf. Um einen eigenständigen Benutzer in die Rolle zu bringen, löschen Sie ihn (`DROP USER oneuptime_health;`) und folgen den Anweisungen oben.

Die Sonde erkennt Azure SQL Database an `SERVERPROPERTY('EngineEdition')` statt an der Version — Azure SQL Database meldet `12.0.2000.8`, egal was tatsächlich läuft, was sich wie SQL Server 2014 liest. Die **Engine** des Monitors lautet daher `Azure SQL Database 12.0.2000.8`, und eine fehlende Berechtigung wird als die Azure-Anweisung oben angezeigt, nie als `VIEW SERVER STATE`.

- **Replikation wird auf Azure SQL Database nicht erfasst.** Azure SQL Database hat kein `sys.dm_hadr_database_replica_states`, daher wird die Gruppe Replication dort übersprungen, statt bei jeder Prüfung als fehlgeschlagen gemeldet zu werden. Die eigenen Replikat-Views von Azure (`sys.dm_database_replica_states`, `sys.dm_geo_replication_link_status`) werden noch nicht gelesen.
- **Verbindungen gelten je Datenbank.** Mit `VIEW DATABASE STATE` zeigt Azure SQL Database nur die Sitzungen der überwachten Datenbank, daher zählt Connections diese Datenbank statt des logischen Servers. Überwachen Sie jede Datenbank, die Ihnen wichtig ist.
- **TempDB Free Space ist in einem Pool für elastische Datenbanken der Wert des Pools.** Die Datenbanken eines Pools teilen sich eine tempdb.

## Einen Datenbank-Integritäts-Monitor erstellen

:::steps
### Einen neuen Monitor beginnen

Gehen Sie zu **Monitore** und klicken Sie auf **Monitor erstellen**. Klicken Sie unter **Monitortyp** auf **Weitere Monitortypen** und wählen Sie **Datenbank-Integrität** unter **Database Monitoring**, oder geben Sie `health` in das Suchfeld ein. Geben Sie einen **Name** ein und klicken Sie dann auf **Weiter**.

### Die Verbindungsdaten eingeben

Wählen Sie den **Datenbanktyp** und füllen Sie dann Host, Port, Datenbankname und die Zugangsdaten des Überwachungsbenutzers aus. Verweisen Sie auf das Passwort als [Monitor-Geheimnis](#ein-monitor-geheimnis-für-das-passwort-verwenden), statt es einzutippen. Jedes Feld ist unter [Konfiguration](#konfiguration) beschrieben.

### Auswählen, was erfasst wird

Lassen Sie jede Gruppe unter **Metrikgruppen** eingeschaltet, sofern Sie keinen Grund haben, eine auszuschalten — siehe [Metrikgruppen](#metrikgruppen).

### Die Verbindung testen

Klicken Sie auf **Monitor testen**, um vor dem Speichern eine Prüfung auszuführen, und lesen Sie, was sie erfasst hat.

### Die Kriterien festlegen

Prüfen Sie die Kriterien, mit denen der Monitor startet, und fügen Sie Ihre eigenen hinzu — siehe [Kriterien einrichten](#kriterien-einrichten). Klicken Sie dann auf **Weiter**.

### Sonden wählen und erstellen

Wählen Sie die **Sonden**, die die Datenbank erreichen, und ein **Überwachungsintervall**, und klicken Sie dann auf **Monitor erstellen**.
:::

## Konfiguration

| Feld | Was Sie eingeben |
|---|---|
| **Datenbanktyp** | PostgreSQL, MySQL oder Microsoft SQL Server. Die Wahl eines Typs setzt den Standardport und entscheidet, welche Abfragen laufen. |
| **Host** | Der von der Sonde erreichbare Datenbank-Host (zum Beispiel `db.internal`). |
| **Port** | Der Port der Datenbank. |
| **Datenbankname** | Die Datenbank, mit der verbunden wird. Datenbankbezogene Metriken (Größe, Cache-Trefferquote, Auslagerung in temporäre Dateien) werden für diese Datenbank gemeldet; serverbezogene Metriken (Verbindungen, Betriebszeit, Replikation) für den ganzen Server — außer auf Azure SQL Database, wo Verbindungen nur für die überwachte Datenbank gezählt werden. |
| **Integrierte Windows-Authentifizierung verwenden** | Nur Microsoft SQL Server. Mit der Identität des Sondenprozesses statt mit Benutzername und Passwort authentifizieren. Siehe [Integrierte Windows-Authentifizierung](/docs/monitor/sql-monitor) auf der Seite zum SQL-Abfrage-Monitor — die Einrichtung ist identisch. |
| **Benutzername** | Der Überwachungsbenutzer. Erforderlich, es sei denn, Sie nutzen die integrierte Windows-Authentifizierung. |
| **Passwort** | Das Passwort. Verweisen Sie mit `{{monitorSecrets.name}}` auf ein [Monitor-Geheimnis](/docs/monitor/monitor-secrets), statt es im Klartext einzutippen (siehe [Ein Monitor-Geheimnis verwenden](#ein-monitor-geheimnis-für-das-passwort-verwenden)). |
| **SSL/TLS verwenden** | Über TLS verbinden. Wenn aktiviert, können Sie **Serverzertifikat verifizieren** für ein selbstsigniertes Zertifikat ausschalten. |
| **Metrikgruppen** | Welche Gruppen laufen: Verbindungen, Aktivität, Durchsatz, Locks and Blocking, Speicher, Replikation und Wartung. Alle sind standardmäßig eingeschaltet; siehe [Metrikgruppen](#metrikgruppen). Die Details des Monitors führen sie als **Erfasste Metrikgruppen** auf. |

### Weitere Felder

| Feld | Standard | Maximum | Was es begrenzt |
|---|---|---|---|
| **Verbindungs-Timeout (ms)** | `10000` | `30000` | Wie lange auf den Aufbau einer Verbindung gewartet wird. |
| **Statement-Timeout (ms)** | `10000` | `60000` | Die Obergrenze für jede einzelne Katalogabfrage. |

Der Standard für das Statement-Timeout ist bewusst knapper als beim SQL-Abfrage-Monitor: Diese Abfragen antworten auf einem gesunden Server in Millisekunden. Braucht `pg_stat_activity` zehn Sekunden, ist das nützliche Signal „dieser Server hat ein Problem“, nicht längeres Warten. Ein Wert über dem Maximum wird auf das Maximum gesenkt.

## Ein Monitor-Geheimnis für das Passwort verwenden

So wird das Passwort nie im Klartext am Monitor gespeichert:

:::steps
1. Gehen Sie zu **Monitore → Einstellungen → Geheimnisse** und legen Sie ein [Monitor-Geheimnis](/docs/monitor/monitor-secrets) an.
2. Benennen Sie es (zum Beispiel `dbPassword`) und geben Sie diesem Monitor Zugriff darauf.
3. Geben Sie im Feld **Passwort** des Monitors `{{monitorSecrets.dbPassword}}` ein.
:::

Das Geheimnis wird serverseitig aufgelöst, bevor die Konfiguration an eine Sonde übergeben wird. Die Felder Host, Benutzername und Datenbankname akzeptieren denselben Verweis. Zugangsdaten werden nie in Logs, Monitor-Feeds oder Alarmvorlagen geschrieben.

## Metrikgruppen

Eine Gruppe ist eine Einheit, die Sie ein- oder ausschalten, und die Einheit, für die eine fehlende Berechtigung gemeldet wird. Gruppen gibt es, damit eine fehlende Berechtigung Sie eine Gruppe kostet statt des ganzen Monitors. Die Anweisungen einer Gruppe laufen nacheinander, daher kann eine Gruppe teilweise erfasst sein: Sie erscheint dann sowohl in `collectedGroups` als auch in `unavailableGroups`. Der häufigste Fall ist die SQL-Server-Gruppe Storage für ein Login ohne `VIEW SERVER STATE` — die Datenbankgröße wird erfasst, Protokollspeicherplatz und freier tempdb-Speicher nicht.

| Gruppe | Was sie erfasst | Benötigt |
|---|---|---|
| Connections | Verbindungszahlen, die konfigurierte Obergrenze, abgebrochene Verbindungsversuche, Betriebszeit des Servers | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Activity | Am längsten laufende Abfrage, am längsten offene Transaktion, offene Transaktionen | PostgreSQL: `pg_monitor`. MySQL: `PROCESS`. SQL Server: `VIEW SERVER STATE` |
| Throughput | Transaktionen, Abfragen, Cache-Trefferquote, Lese- und Schreibzugriffe auf die Platte, I/O-Zeit | PostgreSQL: nichts über `CONNECT` hinaus. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Locks | Blockierte Sitzungen, Sperrwartezeiten, Deadlocks, Tabellensperr-Wartevorgänge | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Storage | Datenbankgröße, Auslagerung in temporäre Dateien, Protokollspeicherplatz, freier tempdb-Speicher | PostgreSQL: nichts über `CONNECT` hinaus. MySQL: `SELECT` auf die Datenbank. SQL Server: nichts für die Datenbankgröße; `VIEW SERVER STATE` für Protokollspeicherplatz und freien tempdb-Speicher |
| Replication | Verbundene Replikate, Replikationsverzögerung in Sekunden und Bytes, inaktive Slots, Recovery-Zustand | PostgreSQL: `pg_monitor`. MySQL: `REPLICATION CLIENT`. SQL Server: `VIEW SERVER STATE`; auf Azure SQL Database nicht erfasst |
| Maintenance | Reserve bis zum Transaktions-ID-Wraparound, tote Tupel, nie per Autovacuum bearbeitete Tabellen, Checkpoints | PostgreSQL: `pg_monitor` |

Lesen Sie auf Azure SQL Database `VIEW DATABASE STATE` überall dort, wo diese Tabelle `VIEW SERVER STATE` sagt — oder `##MS_ServerStateReader##` bei Basic, S0, S1 und Pools für elastische Datenbanken. Siehe [Azure SQL Database](#azure-sql-database).

Eine Gruppe auszuschalten geschieht still: keine Metriken, kein Erfassungsproblem, kein Alarm. Das ist in zwei Fällen der richtige Schritt:

- **Sie bekommen die Berechtigung nicht.** Wenn Sie die Gruppe ausschalten, wiederholt sich das Erfassungsproblem nicht mehr bei jeder Prüfung.
- **Die Abfragen sind zu teuer.** Auf MySQL ist **Speicher** der übliche Kandidat: Die Datenbankgröße entsteht durch Aufsummieren von `information_schema.TABLES`, was bei einem Schema mit Zehntausenden Tabellen nicht kostenlos ist und bei jeder Prüfung läuft. Schalten Sie die Gruppe aus oder setzen Sie diesen Monitor auf ein Intervall von fünf Minuten.

Alle Gruppen abzuwählen ist kein Weg, nichts zu erfassen — eine leere Liste wird wieder auf alle Gruppen gesetzt, sodass ein Monitor nie in einem Zustand gespeichert werden kann, in dem er stillschweigend nichts erfasst.

## Was passiert, wenn eine Metrik nicht erfasst werden kann

**Eine fehlende Berechtigung nimmt den Monitor nie offline.** Das ist das wichtigste Verhalten dieses Monitortyps, und es lohnt sich, es genau zu beschreiben.

| Was fehlschlägt | Monitorstatus | Was Sie sehen |
|---|---|---|
| **Die Verbindung** oder die Testabfrage — falsche Zugangsdaten, abgelehnte Verbindung, TLS-Fehler, Verbindungs-Timeout | **Offline** | `Database Is Online` ist false, und jeder Vorfall und jede Bereitschaftsrichtlinie, die Sie daran gehängt haben, wird ausgelöst. |
| **Eine Gruppe** — eine fehlende Berechtigung, ein deaktiviertes `performance_schema`, ein Statement-Timeout | **Bleibt online** | Die Metriken, die diese Gruppe nicht lesen konnte, **fehlen** — sie sind nicht null. Es wird keine Diagrammlinie gezeichnet, kein Schwellenwert auf diesen Zeitreihen kann zutreffen, und aus ihnen kann kein Vorfall entstehen. Die Prüfung vermerkt ein Erfassungsproblem mit der Gruppe, dem Grund und — wo es einen gibt — dem genauen `GRANT`, der auszuführen ist; es wird in der Zusammenfassung des Monitors angezeigt und in **Metric Groups Failed** gezählt. |
| **Die Engine kann eine Metrik gar nicht liefern** — Standard-MySQL hat keinen Deadlock-Zähler; SQL Server lässt seine Verbindungsobergrenze standardmäßig unbegrenzt, sodass ein „genutzter Prozentsatz“ bedeutungslos wäre | **Bleibt online** | Die Metrik fehlt einfach. Das ist **kein** Erfassungsproblem, zählt nicht zu Metric Groups Failed und muss nicht behoben werden. Siehe die Spalte Engines unter [Erfasste Metriken](#erfasste-metriken). |

Fehlend bedeutet immer fehlend. Ein Wert, der nicht gemessen wurde, wird nie als `0` gemeldet, denn ein Diagramm aus erfundenen Nullen ist schlimmer als eine Lücke — eine Lücke können Sie sehen.

> [!TIP]
> Um bei verlorener Sicht zu alarmieren, nutzen Sie `Database Collection Error` oder einen Schwellenwert auf **Metric Groups Failed**. Machen Sie aus beiden Alarme statt Vorfällen: Eine entzogene Berechtigung ist ein Ticket, kein Bereitschaftsruf.

### "The user does not have permission to perform this action"

Das ist die Meldung von SQL Server (Msg 297) für ein Login, das sich verbinden, aber die Zustands-Views des Servers nicht lesen kann. Sie bedeutet immer eine fehlende Berechtigung, nie einen Fehler in der Datenbank. SQL Server sendet sie als zweite Meldung, nach einer Meldung, die die verweigerte Berechtigung nennt, und der Monitor zeigt beide an: zum Beispiel `VIEW SERVER STATE permission was denied on object 'server', database 'master'. The user does not have permission to perform this action.` Daneben steht die Anweisung, die das Problem für die Plattform behebt, mit der sich die Sonde verbunden hat:

- **SQL Server oder Azure SQL Managed Instance** — `GRANT VIEW SERVER STATE TO oneuptime_health;`, ausgeführt in `master` (der Monitor zeigt sie als `GRANT VIEW SERVER STATE TO [<monitoring_login>]; -- run in master`).
- **Azure SQL Database** — `GRANT VIEW DATABASE STATE TO oneuptime_health;`, ausgeführt in der überwachten Datenbank; bei Basic, S0, S1 und Pools für elastische Datenbanken stattdessen die Mitgliedschaft in `##MS_ServerStateReader##`. Siehe [Azure SQL Database](#azure-sql-database).

Die Datenbankgröße wird währenddessen weiter erfasst, weil sie die einzige Metrik der Gruppe Storage ist, die jedes Login lesen kann.

## Erfasste Metriken

Einundvierzig Zeitreihen in acht Kategorien. Engines nennt die Engines, die die Zeitreihe tatsächlich liefern können; auf jeder anderen Engine fehlt sie einfach. Group ist die Erfassungsgruppe, zu der die Zeitreihe gehört — die Einheit, die Sie umschalten und die gemeinsam ausfällt.

### Verfügbarkeit

| Metrik | Zeitreihe | Group | Engines |
|---|---|---|---|
| **Uptime** (s) | `oneuptime.monitor.database.uptime.seconds` | Connections | PostgreSQL, MySQL, SQL Server |
| **Metric Groups Failed** | `oneuptime.monitor.database.metric.groups.failed` | Connections | PostgreSQL, MySQL, SQL Server |

### Verbindungen

| Metrik | Zeitreihe | Group | Engines |
|---|---|---|---|
| **Connections** | `oneuptime.monitor.database.connections.total` | Connections | PostgreSQL, MySQL, SQL Server |
| **Active Connections** | `oneuptime.monitor.database.connections.active` | Connections | PostgreSQL, MySQL, SQL Server |
| **Maximum Connections** | `oneuptime.monitor.database.connections.max` | Connections | PostgreSQL, MySQL |
| **Connections Used** (%) | `oneuptime.monitor.database.connections.used.percent` | Connections | PostgreSQL, MySQL |
| **Idle In Transaction** | `oneuptime.monitor.database.connections.idle.in.transaction` | Connections | PostgreSQL |
| **Aborted Connects** | `oneuptime.monitor.database.connections.aborted.total` | Connections | MySQL |

### Durchsatz

| Metrik | Zeitreihe | Group | Engines |
|---|---|---|---|
| **Transactions** | `oneuptime.monitor.database.transactions.total` | Throughput | PostgreSQL, SQL Server |
| **Queries** | `oneuptime.monitor.database.queries.total` | Throughput | MySQL, SQL Server |
| **Slow Queries** | `oneuptime.monitor.database.queries.slow.total` | Throughput | MySQL |
| **Rollback Ratio** (%) | `oneuptime.monitor.database.rollback.percent` | Throughput | PostgreSQL |
| **Longest Running Query** (s) | `oneuptime.monitor.database.query.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Longest Open Transaction** (s) | `oneuptime.monitor.database.transaction.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Open Transactions** | `oneuptime.monitor.database.transaction.open.count` | Activity | MySQL |

### Sperren und Blockierungen

| Metrik | Zeitreihe | Group | Engines |
|---|---|---|---|
| **Blocked Sessions** | `oneuptime.monitor.database.sessions.blocked` | Locks | PostgreSQL, MySQL, SQL Server |
| **Lock Waits** | `oneuptime.monitor.database.locks.waiting` | Locks | PostgreSQL, MySQL, SQL Server |
| **Deadlocks** | `oneuptime.monitor.database.deadlocks.total` | Locks | PostgreSQL, SQL Server |
| **Table Lock Waits** | `oneuptime.monitor.database.table.locks.waited.total` | Locks | MySQL |

Standard-MySQL stellt keinerlei Deadlock-Zähler bereit, deshalb gibt es Deadlocks nur auf PostgreSQL und SQL Server.

### Cache und I/O

| Metrik | Zeitreihe | Group | Engines |
|---|---|---|---|
| **Cache Hit Ratio** (%) | `oneuptime.monitor.database.cache.hit.percent` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Reads** | `oneuptime.monitor.database.disk.reads.total` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Writes** | `oneuptime.monitor.database.disk.writes.total` | Throughput | MySQL, SQL Server |
| **I/O Read Time** (ms) | `oneuptime.monitor.database.io.read.time.ms` | Throughput | PostgreSQL, SQL Server |
| **I/O Write Time** (ms) | `oneuptime.monitor.database.io.write.time.ms` | Throughput | PostgreSQL, SQL Server |
| **Page Life Expectancy** (s) | `oneuptime.monitor.database.page.life.expectancy.seconds` | Throughput | SQL Server |
| **Memory Grants Pending** | `oneuptime.monitor.database.memory.grants.pending` | Throughput | SQL Server |

PostgreSQL misst Lese- und Schreibzeiten für I/O nur, wenn `track_io_timing` eingeschaltet ist. Standardmäßig ist es aus, und dann meldet PostgreSQL beide als `0` — auf PostgreSQL bedeutet eine flache Null in diesen beiden Zeitreihen also meist „nicht gemessen“, nicht „schnell“. Das ist eine Servereinstellung, kein Berechtigungsproblem.

### Speicherplatz

| Metrik | Zeitreihe | Group | Engines |
|---|---|---|---|
| **Database Size** (Bytes) | `oneuptime.monitor.database.size.bytes` | Storage | PostgreSQL, MySQL, SQL Server |
| **Temp Bytes Written** (Bytes) | `oneuptime.monitor.database.temp.bytes.total` | Storage | PostgreSQL |
| **Temp Disk Tables** | `oneuptime.monitor.database.temp.disk.tables.total` | Storage | MySQL |
| **Log Space Used** (%) | `oneuptime.monitor.database.log.space.used.percent` | Storage | SQL Server |
| **TempDB Free Space** (Bytes) | `oneuptime.monitor.database.tempdb.free.bytes` | Storage | SQL Server |

### Replikation

| Metrik | Zeitreihe | Group | Engines |
|---|---|---|---|
| **Connected Replicas** | `oneuptime.monitor.database.replica.count` | Replication | PostgreSQL, SQL Server |
| **Replication Lag** (s) | `oneuptime.monitor.database.replication.lag.seconds` | Replication | PostgreSQL, MySQL |
| **Replication Lag (Bytes)** (Bytes) | `oneuptime.monitor.database.replication.lag.bytes` | Replication | PostgreSQL, SQL Server |
| **Is In Recovery** | `oneuptime.monitor.database.is.in.recovery` | Replication | PostgreSQL |
| **Inactive Replication Slots** | `oneuptime.monitor.database.replication.slots.inactive` | Replication | PostgreSQL |

Replikationsmetriken werden von der Seite der Verbindung gemeldet, mit der der Monitor verbunden ist. Richten Sie einen Monitor auf den Primärserver, um verbundene Replikate und die Sendewarteschlange zu sehen; richten Sie je einen auf jeden Standby, um zu sehen, wie weit dieser Standby tatsächlich zurückliegt.

Die Verzögerung in Sekunden steht auf einem untätigen Primärserver auf null, selbst wenn ein Replikat weit zurückliegt, weil nichts Neues geschrieben wurde. **Replication Lag (Bytes)** hat diesen blinden Fleck nicht, also alarmieren Sie auf beide.

### Wartung

| Metrik | Zeitreihe | Group | Engines |
|---|---|---|---|
| **Transaction ID Used** (%) | `oneuptime.monitor.database.transaction.id.used.percent` | Maintenance | PostgreSQL |
| **Dead Tuples** | `oneuptime.monitor.database.dead.tuples` | Maintenance | PostgreSQL |
| **Tables Never Autovacuumed** | `oneuptime.monitor.database.tables.never.autovacuumed` | Maintenance | PostgreSQL |
| **Requested Checkpoints** | `oneuptime.monitor.database.checkpoints.requested.total` | Maintenance | PostgreSQL |
| **Timed Checkpoints** | `oneuptime.monitor.database.checkpoints.timed.total` | Maintenance | PostgreSQL |

> [!IMPORTANT]
> **Transaction ID Used** verdient ein Kriterium auf jedem PostgreSQL-Monitor, den Sie anlegen. PostgreSQL verweigert alle Schreibvorgänge, wenn der Wert 100 % erreicht, die Wiederherstellung bedeutet ein Vacuum im Einzelbenutzermodus bei heruntergefahrener Datenbank, und fast niemand beobachtet ihn. Alarmieren Sie weit vor der Klippe — 80 % lassen bei den meisten Workloads Tage an Reserve.

Zähler, die auf `total` enden, sind seit dem Serverstart kumulativ. Vergleichen Sie zwei Zeitpunkte, um eine Rate zu erhalten; ein einzelner Wert ist nur gegenüber seinem eigenen Verlauf aussagekräftig, und er springt beim Neustart des Servers auf null zurück (was Ihnen **Uptime** zeigt).

## Kriterien einrichten

| Filtertyp | Was er prüft |
|---|---|
| **Database Is Online** | Ob die Datenbank erreichbar war und die Testabfrage gelang. Das ist das Offline-Kriterium, mit dem der Monitor angelegt wird, und die einzige Prüfung, die die Erreichbarkeit widerspiegelt. |
| **Database Metric** | Wählen Sie eine Metrik und vergleichen Sie sie: Greater Than, Less Than, Greater Than Or Equal To, Less Than Or Equal To, Equal To oder Not Equal To. Die Metrikauswahl bietet nur die Metriken an, die Ihre gewählte Engine liefern kann, sodass Sie kein Kriterium bauen können, das dauerhaft unerfüllt bliebe (eine Ausnahme: Die für Microsoft SQL Server angebotenen Replication-Metriken werden auf Azure SQL Database nie erfasst). Wurde die Metrik bei einer Prüfung nicht erfasst — die Gruppe ist fehlgeschlagen oder die Engine meldet sie nicht —, trifft der Filter nicht zu, und er trifft auch nicht als „false“ zu: Er wird übersprungen. Ein Berechtigungsproblem kann niemanden alarmieren. |
| **Database Collection Error** | Die Zusammenfassung der Erfassungsprobleme der Prüfung, eine Zeile „Gruppe: Meldung“ je nicht verfügbarer Gruppe. Alarmieren Sie, wenn sie nicht leer ist, um verlorene Sicht zu bemerken, oder nutzen Sie Contains, um auf eine bestimmte Gruppe zu achten. |
| **JavaScript Expression** | Volle Kontrolle. Siehe [JavaScript-Ausdrücke](/docs/monitor/javascript-expression). |

Schwellenwerte sind ganze Zahlen. Schreiben Sie `90`, nicht `90.5` — Prozentwerte und Sekunden werden als Ganzzahlen verglichen.

**Database Is Online** und **Database Metric** lassen sich über einen Zeitraum prüfen: Aktivieren Sie **Diese Kriterien über einen Zeitraum hinweg auswerten**, wählen Sie dann unter **Auswerten**, wie die Werte ausgewertet werden (zum Beispiel **All Values**), und **Für die letzten (in Minuten)**. Über einen Zeitraum entscheidet die Einstellung **Bei keinen Daten** des Filters, was ein fehlender Wert bedeutet; lassen Sie sie auf **Ignore**, damit eine fehlende Berechtigung weiterhin niemanden alarmieren kann.

### Variablen für JavaScript-Ausdrücke

Bei einem Datenbank-Integritäts-Monitor hat der Ausdruck Zugriff auf:

| Variable | Typ | Beschreibung |
|---|---|---|
| `isOnline` | boolean | Ob die Verbindung und die Testabfrage beide gelungen sind |
| `engineVersion` | string | Die Versionszeichenkette, die der Server gemeldet hat (auf SQL Server die bloße `ProductVersion`; die Zusammenfassung des Monitors nennt die Plattform daneben) |
| `connectionError` | string | Bereinigter Verbindungsfehler, leer, wenn es keinen gab |
| `collectedGroups` | array | Die Gruppen, die bei dieser Prüfung Werte geliefert haben |
| `unavailableGroups` | array | Die Gruppen mit einer Anweisung, die nicht erfasst werden konnte, jeweils mit Grund und Abhilfe. Eine teilweise erfasste Gruppe steht in beiden Listen |
| `metrics` | object | Erfasste Werte, nach Zeitreihenname geschlüsselt; eine nicht erfasste Zeitreihe fehlt |

```javascript
{{isOnline}} === true && {{collectedGroups}}.length >= 5
```

Um eine Metrik in einem Ausdruck zu lesen, indizieren Sie das ganze `metrics`-Objekt — die Zeitreihennamen enthalten Punkte und können daher nicht in die geschweiften Klammern:

```javascript
{{metrics}}['oneuptime.monitor.database.connections.used.percent'] > 90
```

Für einen Schwellenwert auf eine einzelne Metrik greifen Sie zu **Database Metric** statt zu einem Ausdruck: Es löst die Zeitreihe für Sie auf, bietet nur an, was Ihre Engine liefern kann, und überspringt die Prüfung, wenn der Wert nicht erfasst wurde, statt mit nichts zu vergleichen.

### Beispiel: ein PostgreSQL-Primärserver

| Reihenfolge | Kriterien | Filter |
|---|---|---|
| 1 | **Offline** | `Database Is Online` ist `false`. |
| 2 | **Beeinträchtigt** | `Database Metric` → Connections Used ist größer als `90`, ausgewertet über 5 Minuten mit All Values, damit eine einzelne Spitze niemanden alarmiert. |
| 3 | **Beeinträchtigt** | `Database Metric` → Transaction ID Used ist größer als `80`. |
| 4 | **Beeinträchtigt** | `Database Metric` → Blocked Sessions ist größer als `0`, über 5 Minuten. |
| 5 | **Online** | `Database Is Online` ist `true`. |

Kriterien werden von oben nach unten ausgewertet, und der erste Treffer gewinnt — führen Sie also die alarmierenden Kriterien zuerst auf und das gesunde zuletzt.

Hängen Sie eine Bereitschaftsrichtlinie an das Offline-Kriterium und lassen Sie alles, was von **Metric Groups Failed** oder `Database Collection Error` abgeleitet ist, als Alarm ohne Bereitschaftsrichtlinie.

## Was zu beachten ist

- **Die Abfragen laufen bei jeder Prüfung.** Sie sind bewusst günstig, aber „günstig“ ist relativ zum Intervall. Ein Intervall von einer Minute gegen einen Server mit Tausenden Sitzungen bedeutet mehr `pg_stat_activity`-Scans, als Sie vielleicht wollen; fünf Minuten reichen für Kapazitätsmetriken völlig.
- **Richten Sie den Monitor auf die Datenbank, die Ihnen wichtig ist.** Größe, Cache-Trefferquote und Auslagerung in temporäre Dateien gelten je Datenbank. Verbindungen, Betriebszeit und Replikation gelten je Server und lesen sich von jeder Datenbank dieser Instanz aus gleich.
- **Ein Monitor pro Instanz, nicht pro Datenbank**, es sei denn, Sie wollen gezielt Größen- und Cache-Metriken je Datenbank — sonst vervielfachen Sie die serverbezogenen Abfragen ohne neue Information. Azure SQL Database ist die Ausnahme: Es meldet Verbindungen je Datenbank, überwachen Sie dort also jede Datenbank.
- **Alarmieren Sie auf Raten, nicht auf Zähler.** Alles, was auf `total` endet, steigt nur, ein „größer als“-Schwellenwert darauf löst also einmal aus und erholt sich nie. Stellen Sie es als Diagramm dar oder vergleichen Sie es über ein Zeitfenster.
- **Ziehen Sie ein Monitor-Geheimnis einem Klartextpasswort vor.** Die Zugangsdaten bleiben dann im Ruhezustand verschlüsselt und erscheinen nie am Monitor.
- **Der Monitor schreibt nie.** Jede Abfrage ist ein Lesezugriff auf eine Statistik-View — auf PostgreSQL in einer schreibgeschützten Transaktion, auf MySQL in einer schreibgeschützten Sitzung. Was er nicht lesen kann, wird als fehlende Metrik gemeldet, nie als Ausfall.

## Fehlerbehebung

:::details Der Monitor ist offline, aber die Datenbank läuft
Offline heißt, dass die Sonde sich nicht verbinden konnte oder die Testabfrage fehlschlug: Host oder Port sind von der Sonde aus nicht erreichbar, das Login wurde abgelehnt, TLS schlug fehl oder die Verbindung lief in ein Timeout. Die Zusammenfassung des Monitors zeigt den Fehler. Prüfen Sie, ob die Sonde die Datenbank erreicht (eine von OneUptime gehostete Sonde braucht eine öffentliche Adresse; nutzen Sie sonst eine [benutzerdefinierte Sonde](/docs/probe/custom-probe)), prüfen Sie den Benutzernamen und das Passwort oder sein Monitor-Geheimnis, und schalten Sie **Serverzertifikat verifizieren** für ein selbstsigniertes Zertifikat aus. Klicken Sie dann auf **Monitor testen**, um erneut zu prüfen.
:::

:::details Connections, Activity und Locks fehlen auf PostgreSQL
Das Login ist weder Mitglied von `pg_monitor` oder `pg_read_all_stats` noch ein Superuser, daher überspringt die Sonde diese Gruppen, statt falsche Zahlen zu erfassen. Führen Sie `GRANT pg_monitor TO oneuptime_health;` aus, wie unter [PostgreSQL](#postgresql) beschrieben.
:::

:::details Connections, Throughput und Locks fehlen auf MySQL
Entweder fehlt dem Login `SELECT` auf `performance_schema`, oder `performance_schema` ist auf dem Server ausgeschaltet; die Zusammenfassung des Monitors zeigt die Meldung von MySQL. Bei einer fehlenden Berechtigung führen Sie die Anweisungen unter [MySQL](#mysql) aus. Ein deaktiviertes `performance_schema` braucht `performance_schema = ON` in der Serverkonfiguration und einen Neustart.
:::

:::details I/O Read Time und I/O Write Time sind auf PostgreSQL immer 0
PostgreSQL misst sie nur, wenn `track_io_timing` eingeschaltet ist, und das ist standardmäßig aus. Schalten Sie es in der Serverkonfiguration oder in der Parametergruppe Ihres verwalteten Dienstes ein, um echte Werte zu sehen. Es ist keine fehlende Berechtigung.
:::

:::details Metric Groups Failed liegt bei jeder Prüfung über 0
Eine Gruppe kann bei keiner Prüfung erfasst werden, daher wiederholt sich dasselbe Erfassungsproblem. Die Zusammenfassung des Monitors nennt die Gruppe, den Grund und den `GRANT`, der es behebt. Führen Sie die Berechtigung aus oder schalten Sie, wenn Sie sie nicht bekommen, diese Gruppe unter **Metrikgruppen** aus, damit sich das Problem nicht mehr wiederholt.
:::

## Nächste Schritte

:::cards
- [SQL-Abfrage-Überwachung](/docs/monitor/sql-monitor): Auf das Ergebnis Ihrer eigenen Abfrage alarmieren, neben der Gesundheit des Servers.
- [Datenbanken](/docs/telemetry/databases): Die Metriken, Logs und Aufrufer jeder Datenbank auf einer Seite sehen.
- [Überwachungs-Geheimnisse](/docs/monitor/monitor-secrets): Das Passwort des Überwachungsbenutzers verschlüsselt aufbewahren.
- [Benutzerdefinierte Probes](/docs/probe/custom-probe): Eine Datenbank in Ihrem Netzwerk erreichen.
:::

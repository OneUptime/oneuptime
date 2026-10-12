# SQL-Abfrage-Überwachung

Der SQL-Abfrage-Monitor führt nach Zeitplan auf einer Sonde eine schreibgeschützte SQL-Abfrage aus und alarmiert auf das Ergebnis — die Zahl der zurückgegebenen Zeilen, einen Skalarwert, die Dauer der Abfrage oder einen Abfragefehler. Er ist für den Fall "eine Abfrage ausführen und einen Vorfall eröffnen" gebaut, etwa um zu alarmieren, wenn die Zahl der in den letzten fünf Minuten stornierten Bestellungen sprunghaft steigt, wenn eine Warteschlangentabelle zu groß wird oder wenn eine wichtige Zeile verschwindet.

:::cards
- [Einen schreibgeschützten Benutzer anlegen](#einen-schreibgeschützten-benutzer-anlegen): Die Datenbankanmeldung, die der Monitor verwenden sollte.
- [Den Monitor erstellen](#einen-sql-abfrage-monitor-erstellen): Eine Sonde verbinden und die Abfrage eingeben.
- [Die Abfrage schreiben](#die-abfrage-schreiben): Den Wert, auf den Sie alarmieren, in die erste Spalte setzen.
- [Kriterien einrichten](#kriterien-einrichten): Auf eine Anzahl, einen Wert, eine langsame Abfrage oder einen Fehler alarmieren.
:::

## So funktioniert es

Bei jeder Prüfung verbindet sich die Sonde mit Ihrer Datenbank, führt Ihre Abfrage in einem schreibgeschützten Kontext aus, liest höchstens eine begrenzte Zahl von Zeilen zurück und meldet OneUptime eine kompakte Projektion. Die Kriterien Ihres Monitors werden dann an dieser Projektion geprüft.

Weil die Abfrage auf einer Sonde in Ihrem Netzwerk läuft, braucht OneUptime nie eine direkte Verbindung zu Ihrer Datenbank, und die vollständige Ergebnismenge verlässt die Sonde nie — nur eine kleine, begrenzte Projektion des Ergebnisses wird zurückgemeldet.

```mermaid title="Nur eine kleine Projektion des Ergebnisses verlässt Ihr Netzwerk"
sequenceDiagram
    participant O as OneUptime
    participant P as Sonde
    participant D as Ihre Datenbank
    O->>P: Monitoreinstellungen, Geheimnisse aufgelöst
    P->>D: Ihre Abfrage, schreibgeschützt
    D-->>P: Bis zu Max. Zeilen + 1 Zeilen
    P->>O: Zeilenzahl, Skalarwert, erste Zeile, Zeit, Fehler
    O->>O: Kriterien prüfen
```

Die Sonde meldet nur:

| Wert | Was es ist |
|---|---|
| **Zeilenanzahl** | Die Zahl der Zeilen, die die Abfrage zurückgegeben hat (begrenzt durch Max. Zeilen). |
| **Skalarwert** | Die erste Spalte der ersten Zeile. Das ist der natürliche Wert einer Abfrage im Stil von `SELECT COUNT(*)`. |
| **Erste Zeile** | Die erste Zeile als Paare aus Spalte und Wert, zur Einordnung in der Zusammenfassung der Prüfung angezeigt. |
| **Ausführungszeit** | Wie lange die Prüfung dauerte, in Millisekunden — mitsamt dem Verbindungsaufbau, nicht nur die Abfrage. |
| **Abfragefehler** | Eine bereinigte Fehlermeldung, falls die Abfrage fehlschlug. |

Die vollständige Ergebnismenge wird nie an OneUptime gesendet, Kundendaten werden also nicht in den Speicher von OneUptime kopiert.

## Unterstützte Datenbanken

| Datenbank | Standardport |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

MySQL- und PostgreSQL-kompatible Engines, die dasselbe Wire-Protokoll und denselben SQL-Dialekt sprechen, funktionieren in der Regel ebenfalls, offiziell getestet sind aber nur die drei Engines oben.

Wenn Host und Port, mit denen sich der Monitor verbindet, einer der Endpunkte einer Datenbank auf der Seite [Datenbanken](/docs/telemetry/databases) sind, erscheinen seine Warnungen und Vorfälle auch auf der Seite dieser Datenbank (siehe [Warnungen zu einer Datenbank](/docs/telemetry/databases#alerts-on-a-database)). Ein Host, der als Verweis auf ein Monitor-Geheimnis angegeben ist, wird nicht zugeordnet.

## Sicherheitsmodell

Eine vom Kunden gelieferte Abfrage gegen eine Produktionsdatenbank auszuführen ist heikel, deshalb ist der SQL-Abfrage-Monitor von Grund auf schreibgeschützt und schichtet mehrere Kontrollen:

| Kontrolle | Was sie bewirkt |
|---|---|
| **Datenbankbenutzer mit minimalen Rechten** (wichtigste Kontrolle) | Verbinden Sie sich immer mit einem eigenen, schreibgeschützten Datenbankbenutzer, der nur auf die Tabellen zugreifen darf, die die Abfrage braucht. Das ist die wichtigste Kontrolle — siehe [Einen schreibgeschützten Benutzer anlegen](#einen-schreibgeschützten-benutzer-anlegen). |
| **Schreibgeschützte Ausführung** | Auf PostgreSQL und MySQL öffnet die Sonde eine `READ ONLY`-Transaktion, die jeden Schreibvorgang (auch schreibende CTEs) unabhängig vom Abfragetext ablehnt. Auf Microsoft SQL Server, das keine schreibgeschützte Transaktion kennt, läuft die Sonde in einer Transaktion, die immer zurückgerollt wird. |
| **Einzelne Anweisung, erlaubte Abfragen** | Die Abfrage muss eine einzelne Anweisung sein, die mit `SELECT`, `WITH`, `VALUES` oder `TABLE` beginnt. Gestapelte Anweisungen (`SELECT 1; DROP TABLE …`) und Schreib- oder DDL-Schlüsselwörter wie `INSERT`, `UPDATE`, `DELETE`, `DROP`, `EXEC` und `INTO` lehnt die Sonde ab, bevor sie sich verbindet. Diese Prüfung ist ein Sicherheitsnetz, nicht die Grenze: Das ist der schreibgeschützte Benutzer. |
| **Statement-Zeitlimit** | Jede Abfrage hat ein hartes Zeitlimit. Eine Abfrage, die zu lange läuft, wird abgebrochen. |
| **Begrenzte Zeilen** | Es werden nie mehr als Max. Zeilen (plus eine, um eine Kürzung zu erkennen) zurückgelesen, was Speicher und Nutzlast der Sonde begrenzt. |
| **Schwärzung von Zugangsdaten** | Datenbankfehler werden vor dem Speichern bereinigt — das Passwort, Host, Benutzername und Datenbankname sowie jede Verbindungszeichenfolge werden geschwärzt, sodass Zugangsdaten nie in Fehlermeldungen gelangen. |

## Bevor Sie beginnen

- Eine **Sonde** mit Netzwerkzugang zu Host und Port Ihrer Datenbank. Das kann eine von OneUptime gehostete Sonde sein (wenn Ihre Datenbank aus dem Internet erreichbar ist) oder eine [benutzerdefinierte Sonde](/docs/probe/custom-probe) in Ihrem Netzwerk.
- Ein **schreibgeschützter Datenbankbenutzer** und die Verbindungsdaten (Host, Port, Datenbankname, Benutzername, Passwort) oder eine schreibgeschützte Windows-/Domänenidentität bei der integrierten Authentifizierung von SQL Server.

## Einen schreibgeschützten Benutzer anlegen

Verbinden Sie sich immer mit einem eigenen schreibgeschützten Benutzer. Führen Sie die Anweisungen für Ihre Engine als Administrator aus und ersetzen Sie `orders` durch Ihre Datenbank:

:::tabs
@tab PostgreSQL
```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- Include tables created in the future:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO oneuptime_ro;
```
@tab MySQL
```sql
-- MySQL
CREATE USER 'oneuptime_ro'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON orders.* TO 'oneuptime_ro'@'%';
FLUSH PRIVILEGES;
```
@tab Microsoft SQL Server
```sql
-- Microsoft SQL Server
CREATE LOGIN oneuptime_ro WITH PASSWORD = 'a-strong-password';
USE orders;
CREATE USER oneuptime_ro FOR LOGIN oneuptime_ro;
ALTER ROLE db_datareader ADD MEMBER oneuptime_ro;
```
:::

Für eine engere Berechtigung geben Sie dem Benutzer `SELECT` nur auf die Tabellen, die Ihre Abfrage liest.

## Einen SQL-Abfrage-Monitor erstellen

:::steps
### Einen neuen Monitor beginnen

Gehen Sie zu **Monitore** und klicken Sie auf **Monitor erstellen**. Klicken Sie unter **Monitortyp** auf **Weitere Monitortypen** und wählen Sie **SQL-Abfrage** unter **Database Monitoring**, oder tippen Sie `query` in das Suchfeld. Geben Sie einen **Name** ein und klicken Sie dann auf **Weiter**.

### Die Verbindungsdaten eingeben

Wählen Sie den **Datenbanktyp** — der Port springt auf den Standard dieser Engine — und tragen Sie dann Host, Datenbankname und die Zugangsdaten des schreibgeschützten Benutzers ein. Verweisen Sie für das Passwort auf ein [Monitor-Geheimnis](#ein-monitor-geheimnis-für-das-passwort-verwenden), statt es einzutippen. Jedes Feld ist unter [Konfiguration](#konfiguration) beschrieben.

### Die Abfrage eingeben

Geben Sie in **SQL-Abfrage** eine einzelne schreibgeschützte Anweisung ein (siehe [Die Abfrage schreiben](#die-abfrage-schreiben)).

### Es testen

Klicken Sie auf **Monitor testen**, um die Abfrage vor dem Speichern einmal auf einer Sonde auszuführen.

### Die Kriterien festlegen

Prüfen Sie die Kriterien, mit denen der Monitor beginnt, und fügen Sie eigene hinzu — siehe [Kriterien einrichten](#kriterien-einrichten). Klicken Sie dann auf **Weiter**.

### Sonden wählen und erstellen

Wählen Sie die **Sonden**, die die Datenbank erreichen, und ein **Überwachungsintervall** und klicken Sie dann auf **Monitor erstellen**.
:::

## Konfiguration

| Feld | Was eingetragen wird |
|---|---|
| **Datenbanktyp** | PostgreSQL, MySQL oder Microsoft SQL Server. Die Wahl eines Typs setzt den Standardport. |
| **Host** | Der Datenbankhost, den die Sonde erreicht (zum Beispiel `db.internal`). |
| **Port** | Der Datenbankport. |
| **Datenbankname** | Die Datenbank, gegen die die Abfrage läuft. |
| **Integrierte Windows-Authentifizierung verwenden** | Nur Microsoft SQL Server. Mit dem Konto authentifizieren, unter dem die Sonde läuft, statt mit SQL-Benutzername und Passwort. Siehe [Integrierte Windows-Authentifizierung](#integrierte-windows-authentifizierung). |
| **Benutzername** | Ein schreibgeschützter Datenbankbenutzer mit minimalen Rechten. |
| **Passwort** | Das Datenbankpasswort. Wir empfehlen dringend, mit `{{monitorSecrets.name}}` auf ein [Monitor-Geheimnis](/docs/monitor/monitor-secrets) zu verweisen, statt das Passwort im Klartext einzugeben (siehe [Ein Monitor-Geheimnis für das Passwort verwenden](#ein-monitor-geheimnis-für-das-passwort-verwenden)). |
| **SQL-Abfrage** | Die schreibgeschützte Abfrage, die ausgeführt wird (siehe [Die Abfrage schreiben](#die-abfrage-schreiben)). |
| **SSL/TLS verwenden** | Aktivieren, um sich über TLS zu verbinden. Ist es aktiviert, können Sie **Serverzertifikat verifizieren** ausschalten, wenn die Datenbank ein selbstsigniertes Zertifikat verwendet. |

### Weitere Felder

| Feld | Standard | Maximum | Was es begrenzt |
|---|---|---|---|
| **Verbindungs-Timeout (ms)** | `10000` | `30000` | Wie lange auf den Verbindungsaufbau gewartet wird. |
| **Statement-Timeout (ms)** | `15000` | `60000` | Die harte Obergrenze, wie lange die Abfrage laufen darf. |
| **Max. Zeilen** | `100` | `1000` | Die Obergrenze der aus der Datenbank zurückgelesenen Zeilen. |

Ein Wert über dem Maximum wird auf das Maximum gesenkt.

### Integrierte Windows-Authentifizierung

Für Microsoft SQL Server aktivieren Sie **Integrierte Windows-Authentifizierung verwenden**, um eine vertrauenswürdige Verbindung mit der Identität des Sondenprozesses zu öffnen. Die Felder Benutzername und Passwort werden in diesem Modus ignoriert und nicht an den Treiber übergeben. Weil die Sonde eine Identität braucht, der Ihre Domäne vertraut, verwenden Sie für diesen Authentifizierungsmodus eine selbst gehostete Sonde.

| Die Sonde läuft auf | Was einzurichten ist |
|---|---|
| **Windows** | Den Sondendienst unter einem Domänenkonto ausführen, das eine schreibgeschützte SQL-Server-Anmeldung hat. |
| **Linux oder macOS** | Kerberos für die SQL-Server-Domäne einrichten und dem Sondenprozess ein gültiges Ticket geben (zum Beispiel über eine Keytab). Das offizielle Linux-Image der Sonde enthält Microsoft ODBC Driver 18, unixODBC und den Kerberos-Client. Binden Sie die Kerberos-Konfiguration und den Ticket-Cache in den Container ein, machen Sie sie für den Sondenprozess lesbar und setzen Sie `KRB5_CONFIG` oder `KRB5CCNAME`, wenn sie nicht am Standardort liegen. |

Die Sonde braucht einen Microsoft ODBC Driver for SQL Server auf dem Host, auf dem sie läuft. Das offizielle Sonden-Image enthält **ODBC Driver 18**. Betreiben Sie eine selbst gehostete oder benutzerdefinierte Sonde, erkennt und verwendet sie automatisch den neuesten auf dem Host registrierten `ODBC Driver N for SQL Server` (zum Beispiel Driver 17, wenn dieser installiert ist) — Sie brauchen nicht genau Driver 18. Um einen bestimmten Treiber festzulegen, setzen Sie die Umgebungsvariable `SQL_SERVER_ODBC_DRIVER` der Sonde auf den genauen Treibernamen (zum Beispiel `ODBC Driver 17 for SQL Server`).

SQL Server braucht einen passenden Service Principal Name `MSSQLSvc`, die Uhren von Sonde und Domänencontroller müssen synchron laufen, und die Sonde muss den SQL Server unter dem Hostnamen auflösen und erreichen, den dieser Service Principal abdeckt. Geben Sie der vertrauenswürdigen Identität nur die Datenbankrechte, die die Überwachungsabfrage braucht.

## Die Abfrage schreiben

Die Abfrage muss eine **einzelne schreibgeschützte Anweisung** sein. Sie muss mit `SELECT`, `WITH`, `VALUES` oder `TABLE` beginnen. Ein abschließendes Semikolon ist erlaubt, mehrere Anweisungen nicht. Schreib- und DDL-Schlüsselwörter werden überall in der Abfrage abgelehnt — auch `INTO`, also wird `SELECT … INTO` ebenfalls abgelehnt.

Die Sonde prüft die Abfrage bei jeder Prüfung, nicht beim Speichern. Eine Abfrage, die gegen diese Regeln verstößt, lässt sich speichern, und dann schlägt jede Prüfung mit "Only read-only queries are allowed (must start with SELECT, WITH, VALUES, or TABLE)." fehl — die Standardkriterien nehmen den Monitor offline.

Halten Sie Abfragen günstig und eng gefasst — sie laufen bei jeder Prüfung, bevorzugen Sie also indizierte Spalten und schmale Zeitfenster. Diese Abfrage zählt die in den letzten fünf Minuten stornierten Bestellungen:

:::tabs
@tab PostgreSQL
```sql
-- Count recent cancellations (PostgreSQL)
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```
@tab MySQL
```sql
-- The same idea on MySQL
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```
@tab Microsoft SQL Server
```sql
-- The same idea on Microsoft SQL Server
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```
:::

> [!TIP]
> Bei einer Abfrage im Stil von `COUNT(*)` steht die Anzahl sowohl als **Zeilenanzahl** (die `1` ist, weil eine Zeile zurückkommt) als auch als **Skalarwert** (die Anzahl selbst, aus der ersten Spalte) zur Verfügung. Um auf "wie viele" zu alarmieren, vergleichen Sie mit dem **Skalarwert**.

## Ein Monitor-Geheimnis für das Passwort verwenden

Damit das Datenbankpasswort nie im Klartext am Monitor gespeichert wird, legen Sie ein [Monitor-Geheimnis](/docs/monitor/monitor-secrets) an und verweisen im Feld Passwort darauf:

:::steps
1. Gehen Sie zu **Monitore → Einstellungen → Geheimnisse** und legen Sie ein Monitor-Geheimnis an.
2. Benennen Sie es (zum Beispiel `dbPassword`) und geben Sie diesem Monitor Zugriff darauf.
3. Geben Sie im Feld **Passwort** des Monitors `{{monitorSecrets.dbPassword}}` ein.
:::

OneUptime löst das Geheimnis serverseitig auf, bevor die Konfiguration an die Sonde geht. OneUptime legt diese Geheimnisse nie für Sie an — ob Sie auf eines verweisen, entscheiden Sie. Die Felder **Benutzername**, **Host**, **Datenbankname** und **SQL-Abfrage** akzeptieren ebenfalls Verweise auf Geheimnisse; **Port** nicht.

## Kriterien einrichten

Fügen Sie Kriterien hinzu, um festzulegen, wann der Monitor als online, beeinträchtigt oder offline gilt. Diese Prüfungen stehen für einen SQL-Abfrage-Monitor zur Verfügung:

| Filtertyp | Was er prüft |
|---|---|
| **SQL Is Online** | Ob die Datenbank erreichbar war und die Abfrage erfolgreich lief. |
| **SQL Query Row Count** | Die Zahl der zurückgegebenen Zeilen. Vergleichen Sie mit Operatoren wie größer als, kleiner als oder gleich. |
| **SQL Query Scalar Value** | Die erste Spalte der ersten Zeile. Als Zahl verglichen, wenn der eingegebene Wert eine Zahl ist, sonst als Zeichenkette. Das ist die Prüfung für Abfragen im Stil von `COUNT(*)`. |
| **SQL Query Execution Time (in ms)** | Wie lange die Abfrage dauerte. Nützlich, um eine langsame Datenbank zu erkennen. |
| **SQL Query Error** | Die Fehlermeldung der Abfrage. Alarmieren, wenn sie leer (oder nicht leer) ist oder einer bestimmten Zeichenkette entspricht. |
| **JavaScript Expression** | Einen eigenen JavaScript-Ausdruck über `rowCount`, `scalarValue`, `firstRow`, `executionTimeInMs`, `queryError` und `isOnline` auswerten. Siehe [JavaScript-Ausdrücke](/docs/monitor/javascript-expression#sql-abfrage-monitore). |

Zahlenschwellen sind ganze Zahlen: Schreiben Sie `10`, nicht `10.5`. SQL-Abfrage-Filter lassen sich nicht über einen Zeitraum auswerten; jede Prüfung steht für sich.

Ein neuer SQL-Abfrage-Monitor beginnt mit zwei Kriterien: **SQL Is Online** ist falsch — der Monitor geht offline und eröffnet einen Vorfall, der sich selbst behebt — und **SQL Is Online** ist wahr, was ihn als online markiert. **Kriterien hinzufügen** fügt eines unten an; ziehen Sie es über das Online-Kriterium, denn Kriterien werden von oben geprüft, und das erste, das zutrifft, entscheidet.

### Beispiel: alarmieren, wenn Stornierungen sprunghaft steigen

Mit der Abfrage oben:

| Kriterium | Filter |
|---|---|
| **Beeinträchtigt** | `SQL Query Scalar Value` ist größer als `10`. |
| **Offline** | `SQL Query Scalar Value` ist größer als `50`, oder `SQL Is Online` ist `false`. |

Hängen Sie eine Bereitschaftsrichtlinie an das Kriterium, damit die richtigen Personen benachrichtigt werden. Ein SQL-Abfrage-Monitor hat keine eigenen Vorlagenvariablen: Der Titel eines Vorfalls kann den Monitor mit `{{monitorName}}` nennen, aber nicht das Ergebnis der Abfrage zitieren.

## Zu beachten

- Die Abfrage läuft bei jeder Prüfung, halten Sie sie also günstig. Verwenden Sie Indizes und schmale Zeitfenster, und verlassen Sie sich auf das Statement-Timeout als Absicherung.
- Gemeldet werden nur die Zeilenzahl, die erste Zelle (Skalar) und die erste Zeile — gestalten Sie Ihre Abfrage so, dass der Wert, auf den Sie alarmieren wollen, in der ersten Spalte steht.
- Wird das Ergebnis gekürzt, weil es Max. Zeilen überschritt, zeigt die Zusammenfassung der Prüfung **Zeilen gekürzt**: "Yes (result capped)". Erhöhen Sie Max. Zeilen nur, wenn Sie es brauchen; größere Ergebnismengen kosten mehr Speicher auf der Sonde.
- Schreibvorgänge und DDL werden immer abgelehnt. Wenn Sie einen Schreibpfad testen müssen, ist das nicht die Aufgabe dieses Monitors.
- Ziehen Sie ein Monitor-Geheimnis einem Klartextpasswort vor, damit die Zugangsdaten verschlüsselt gespeichert bleiben.
- Schlägt die Abfrage einer Prüfung fehl, wird sie eine Sekunde später erneut versucht, bis zu dreimal, bevor die Prüfung den Fehler meldet, sodass ein kurzer Verbindungsabbruch den Monitor nicht offline nimmt. Auf einer selbst gehosteten Sonde legt `PROBE_MONITOR_RETRY_LIMIT` fest, wie oft.

## Fehlerbehebung

:::details Jede Prüfung schlägt mit "Only read-only queries are allowed" fehl
Die Abfrage beginnt nicht mit `SELECT`, `WITH`, `VALUES` oder `TABLE`. Ein Kommentar davor ist in Ordnung, ein `SET` oder ein `DECLARE` nicht. Schreiben Sie sie als eine einzelne schreibgeschützte Anweisung.
:::

:::details Eine Prüfung schlägt mit "Disallowed SQL keyword" fehl
Irgendwo in der Abfrage steht ein Schreib-, DDL- oder Ausführungsschlüsselwort, auch innerhalb eines `SELECT`, etwa `INTO` oder `EXEC`. Wörter in Zeichenketten in Anführungszeichen und in Kommentaren zählen nicht. Entfernen Sie das Schlüsselwort, oder legen Sie die Logik in eine View, die der schreibgeschützte Benutzer lesen darf.
:::

:::details Die Prüfung läuft in ein Zeitlimit
Die Sonde konnte sich nicht innerhalb von **Verbindungs-Timeout (ms)** verbinden, oder die Abfrage lief länger als **Statement-Timeout (ms)**. Prüfen Sie, ob die Sonde Host und Port erreicht, und machen Sie die Abfrage dann günstiger: Filtern Sie auf indizierten Spalten über ein kurzes Zeitfenster.
:::

:::details Die Verbindung schlägt mit einem Zertifikatsfehler fehl
Das Zertifikat der Datenbank ist selbstsigniert, oder die Sonde vertraut ihm nicht. Schalten Sie **Serverzertifikat verifizieren** aus, das erscheint, sobald **SSL/TLS verwenden** aktiviert ist, oder geben Sie der Datenbank ein Zertifikat, dem die Sonde vertraut.
:::

:::details Die integrierte Windows-Authentifizierung schlägt fehl
Die Sonde braucht einen Microsoft ODBC Driver for SQL Server und eine Identität, der Ihre Domäne vertraut. Verwenden Sie das offizielle Sonden-Image oder installieren Sie den Treiber, und prüfen Sie dann die Einrichtung unter [Integrierte Windows-Authentifizierung](#integrierte-windows-authentifizierung).
:::

## Nächste Schritte

:::cards
- [Datenbank-Integritätsüberwachung](/docs/monitor/database-health-monitor): Verbindungen, Sperren und Replikation überwachen, ohne SQL zu schreiben.
- [Überwachungs-Geheimnisse](/docs/monitor/monitor-secrets): Das Datenbankpasswort verschlüsselt aufbewahren.
- [JavaScript-Ausdrücke](/docs/monitor/javascript-expression): Kriterien schreiben, die mehrere Werte kombinieren.
- [Benutzerdefinierte Probes](/docs/probe/custom-probe): Prüfungen aus Ihrem Netzwerk heraus ausführen.
:::

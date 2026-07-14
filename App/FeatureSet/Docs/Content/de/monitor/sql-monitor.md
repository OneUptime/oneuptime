# SQL-Abfrage-Monitor

Der SQL-Abfrage-Monitor führt planmäßig eine schreibgeschützte SQL-Abfrage von einer Probe aus aus und alarmiert anhand des Ergebnisses — der Anzahl der zurückgegebenen Zeilen, eines Skalarwerts, der Ausführungsdauer der Abfrage oder eines Abfragefehlers. Er ist für den Anwendungsfall „Abfrage ausführen und Vorfall eröffnen" konzipiert, zum Beispiel, um zu alarmieren, wenn die Anzahl der stornierten Bestellungen in den letzten fünf Minuten sprunghaft ansteigt, wenn eine Warteschlangentabelle zu groß wird oder wenn eine kritische Zeile verschwindet.

Da die Abfrage von einer Probe innerhalb Ihres Netzwerks ausgeführt wird, benötigt OneUptime niemals eine direkte Verbindung zu Ihrer Datenbank, und die vollständige Ergebnismenge verlässt niemals die Probe — nur eine kleine, begrenzte Projektion des Ergebnisses wird zurückgemeldet.

## Unterstützte Datenbanken

Der SQL-Abfrage-Monitor unterstützt die folgenden Datenbank-Engines:

- **PostgreSQL** (Standardport `5432`)
- **MySQL** (Standardport `3306`)
- **Microsoft SQL Server** (Standardport `1433`)

MySQL-kompatible und PostgreSQL-kompatible Engines, die dasselbe Wire-Protokoll und denselben SQL-Dialekt sprechen, funktionieren in der Regel ebenfalls, aber offiziell getestet sind nur die drei oben genannten Engines.

## Funktionsweise

Bei jeder Prüfung stellt die Probe eine Verbindung zu Ihrer Datenbank her, führt Ihre Abfrage in einem schreibgeschützten Kontext aus, liest höchstens eine begrenzte Anzahl von Zeilen zurück und meldet eine kompakte Projektion an OneUptime. Die Kriterien Ihres Monitors werden anschließend anhand dieser Projektion ausgewertet.

Die Probe meldet nur:

- **Zeilenanzahl** — die Anzahl der von der Abfrage zurückgegebenen Zeilen (begrenzt durch das Limit „Max. Zeilen").
- **Skalarwert** — die erste Spalte der ersten Zeile. Dies ist der natürliche Wert für eine Abfrage im Stil von `SELECT COUNT(*)`.
- **Erste Zeile** — die erste Zeile als eine Menge von Spalten-/Wertepaaren, die in der Prüfzusammenfassung zur Kontextinformation angezeigt wird.
- **Ausführungszeit** — die Ausführungsdauer der Abfrage in Millisekunden.
- **Abfragefehler** — eine bereinigte Fehlermeldung, falls die Abfrage fehlgeschlagen ist.

Die vollständige Ergebnismenge wird niemals an OneUptime gesendet, sodass Kundendaten nicht in den OneUptime-Speicher repliziert werden.

## Sicherheitsmodell

Das Ausführen einer vom Kunden bereitgestellten Abfrage gegen eine Produktionsdatenbank ist heikel, daher ist der SQL-Abfrage-Monitor von Grund auf schreibgeschützt und setzt mehrere Schutzmechanismen übereinander:

- **Datenbankbenutzer mit minimalen Rechten (primärer Schutz).** Sie sollten sich immer mit einem dedizierten, schreibgeschützten Datenbankbenutzer verbinden, der nur Zugriff auf die von der Abfrage benötigten Tabellen hat. Dies ist der wichtigste Schutz — siehe Einen schreibgeschützten Benutzer erstellen weiter unten.
- **Schreibgeschützte Ausführung.** Bei PostgreSQL und MySQL öffnet die Probe eine `READ ONLY`-Transaktion, die jeden Schreibvorgang (einschließlich schreibfähiger CTEs) unabhängig vom Abfragetext ablehnt. Bei Microsoft SQL Server, das keine schreibgeschützte Transaktion kennt, läuft die Probe innerhalb einer Transaktion, die immer zurückgerollt wird.
- **Einzelanweisungen mit Positivliste.** Die Abfrage muss eine einzelne Anweisung sein, die mit `SELECT`, `WITH`, `VALUES` oder `TABLE` beginnt. Aneinandergereihte Anweisungen (`SELECT 1; DROP TABLE …`) sowie Schreibvorgänge/DDL werden abgelehnt, bevor die Probe überhaupt eine Verbindung herstellt. Die Prüfung berücksichtigt Kommentare und String-Literale, sodass ein in einem Kommentar oder String verstecktes Schlüsselwort nicht durchrutscht.
- **Anweisungs-Timeout.** Jede Abfrage hat eine harte Zeitgrenze. Eine Abfrage, die zu lange läuft, wird abgebrochen.
- **Begrenzte Zeilen.** Es werden höchstens „Max. Zeilen" (plus eine, um eine Kürzung zu erkennen) Zeilen zurückgelesen, was den Probe-Speicher und die Nutzlastgröße begrenzt.
- **Redaktion von Anmeldeinformationen.** Datenbankfehler werden vor dem Speichern bereinigt — das Passwort und jede Verbindungszeichenfolge werden geschwärzt, sodass Anmeldeinformationen niemals in Fehlermeldungen gelangen.

## Voraussetzungen

- Eine **Probe** mit Netzwerkzugriff auf den Host und Port Ihrer Datenbank. Dies kann eine von OneUptime gehostete Probe sein (falls Ihre Datenbank aus dem Internet erreichbar ist) oder eine selbst gehostete Probe, die innerhalb Ihres Netzwerks läuft. Wie Sie eine benutzerdefinierte Probe installieren, erfahren Sie in der Probe-Dokumentation.
- Ein **schreibgeschützter Datenbankbenutzer** und die Verbindungsdetails (Host, Port, Datenbankname, Benutzername, Passwort).

## Konfiguration

Erstellen Sie einen neuen Monitor und wählen Sie **SQL-Abfrage** als Monitortyp, und füllen Sie dann die Verbindungsdetails aus:

- **Datenbanktyp** — PostgreSQL, MySQL oder Microsoft SQL Server. Die Auswahl eines Typs legt den Standardport fest.
- **Host** — der von der Probe aus erreichbare Datenbank-Host (zum Beispiel `db.internal`).
- **Port** — der Datenbankport.
- **Datenbankname** — die Datenbank, gegen die die Abfrage ausgeführt wird.
- **Benutzername** — ein schreibgeschützter Datenbankbenutzer mit minimalen Rechten.
- **Passwort** — das Datenbankpasswort. Wir empfehlen dringend, ein [Monitor-Geheimnis](/docs/monitor/monitor-secrets) mit `{{monitorSecrets.name}}` zu referenzieren, anstatt das Passwort im Klartext einzugeben (siehe unten).
- **SQL-Abfrage** — die auszuführende schreibgeschützte Abfrage (siehe Die Abfrage schreiben).
- **SSL/TLS verwenden** — aktivieren, um die Verbindung über TLS herzustellen. Wenn diese Option aktiviert ist, können Sie **Serverzertifikat überprüfen** deaktivieren, falls die Datenbank ein selbstsigniertes Zertifikat verwendet.

### Erweiterte Optionen

- **Verbindungs-Timeout (ms)** — wie lange auf den Aufbau einer Verbindung gewartet wird. Standard `10000`, Maximum `30000`.
- **Anweisungs-Timeout (ms)** — die harte Obergrenze dafür, wie lange die Abfrage laufen darf. Standard `15000`, Maximum `60000`.
- **Max. Zeilen** — die Obergrenze für die Anzahl der aus der Datenbank zurückgelesenen Zeilen. Standard `100`, Maximum `1000`.

## Die Abfrage schreiben

Die Abfrage muss eine **einzelne schreibgeschützte Anweisung** sein. Sie muss mit einem von `SELECT`, `WITH`, `VALUES` oder `TABLE` beginnen. Ein einzelnes abschließendes Semikolon ist erlaubt; mehrere Anweisungen sind es nicht.

Halten Sie Abfragen günstig und eng gefasst — sie werden bei jeder Prüfung ausgeführt, bevorzugen Sie daher indizierte Spalten und schmale Zeitfenster.

```sql
-- Aktuelle Stornierungen zählen (PostgreSQL)
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```

```sql
-- Dieselbe Idee bei MySQL
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```

```sql
-- Dieselbe Idee bei Microsoft SQL Server
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```

Bei einer Abfrage im Stil von `COUNT(*)` ist die Anzahl sowohl als **Zeilenanzahl** (die `1` ist, da eine Zeile zurückgegeben wird) als auch als **Skalarwert** (die Anzahl selbst, aus der ersten Spalte) verfügbar. Um auf „wie viele" zu alarmieren, vergleichen Sie mit dem **Skalarwert**.

## Ein Monitor-Geheimnis für das Passwort verwenden

Damit das Datenbankpasswort niemals im Klartext im Monitor gespeichert wird, erstellen Sie ein [Monitor-Geheimnis](/docs/monitor/monitor-secrets) und referenzieren Sie es aus dem Feld „Passwort":

1. Gehen Sie zum OneUptime-Dashboard → Projekteinstellungen → Monitor-Geheimnisse → Monitor-Geheimnis erstellen.
2. Erstellen Sie ein Geheimnis (zum Beispiel `dbPassword`) und gewähren Sie diesem Monitor Zugriff darauf.
3. Geben Sie im Feld „Passwort" des Monitors `{{monitorSecrets.dbPassword}}` ein.

OneUptime löst das Geheimnis serverseitig auf, bevor die Konfiguration an die Probe übergeben wird. OneUptime erstellt diese Geheimnisse niemals für Sie — ein Geheimnis zu referenzieren, ist Ihre Entscheidung.

## Kriterien einrichten

Fügen Sie Kriterien hinzu, um zu bestimmen, wann der Monitor als online, eingeschränkt oder offline gilt. Für einen SQL-Abfrage-Monitor sind die folgenden Prüfungen verfügbar:

- **SQL ist online** — ob die Datenbank erreichbar war und die Abfrage erfolgreich ausgeführt wurde.
- **SQL-Abfrage-Zeilenanzahl** — die Anzahl der zurückgegebenen Zeilen. Vergleichen Sie mit Operatoren wie größer als, kleiner als oder gleich.
- **SQL-Abfrage-Skalarwert** — die erste Spalte der ersten Zeile. Wird numerisch verglichen, wenn beide Seiten numerisch erscheinen, andernfalls als Zeichenketten. Dies ist die Prüfung für Abfragen im Stil von `COUNT(*)`.
- **SQL-Abfrage-Ausführungszeit (in ms)** — die Ausführungsdauer der Abfrage. Nützlich, um eine langsame Datenbank zu erkennen.
- **SQL-Abfrage-Fehler** — die Fehlermeldung der Abfrage. Alarmieren Sie, wenn sie (nicht) leer ist oder mit einer bestimmten Zeichenkette übereinstimmt.
- **JavaScript-Ausdruck** — werten Sie einen benutzerdefinierten JavaScript-Ausdruck für vollständige Kontrolle aus. Siehe [JavaScript-Ausdrücke](/docs/monitor/javascript-expression).

### Beispiel: Alarmieren, wenn Stornierungen sprunghaft ansteigen

Unter Verwendung der obigen Abfrage:

- **Kriterium: Eingeschränkt** — `SQL-Abfrage-Skalarwert` ist größer als `10`.
- **Kriterium: Offline** — `SQL-Abfrage-Skalarwert` ist größer als `50`, oder `SQL ist online` ist `false`.

Verknüpfen Sie eine Bereitschaftsrichtlinie mit den Kriterien, damit die richtigen Personen benachrichtigt werden.

## Einen schreibgeschützten Benutzer erstellen

Verbinden Sie sich immer mit einem dedizierten schreibgeschützten Benutzer. Beispiele:

```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- Auch künftig erstellte Tabellen einbeziehen:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO oneuptime_ro;
```

```sql
-- MySQL
CREATE USER 'oneuptime_ro'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON orders.* TO 'oneuptime_ro'@'%';
FLUSH PRIVILEGES;
```

```sql
-- Microsoft SQL Server
CREATE LOGIN oneuptime_ro WITH PASSWORD = 'a-strong-password';
USE orders;
CREATE USER oneuptime_ro FOR LOGIN oneuptime_ro;
ALTER ROLE db_datareader ADD MEMBER oneuptime_ro;
```

## Zu beachtende Punkte

- Die Abfrage wird bei jeder Prüfung ausgeführt, halten Sie sie daher günstig. Verwenden Sie Indizes und schmale Zeitfenster und verlassen Sie sich auf das Anweisungs-Timeout als Absicherung.
- Es werden nur die Zeilenanzahl, die erste Zelle (Skalarwert) und die erste Zeile gemeldet — gestalten Sie Ihre Abfrage so, dass der Wert, auf den Sie alarmieren möchten, die erste Spalte ist.
- Wenn das Ergebnis gekürzt wird, weil es „Max. Zeilen" überschritten hat, kennzeichnet die Prüfzusammenfassung es als begrenzt. Erhöhen Sie „Max. Zeilen" nur, wenn Sie es benötigen; größere Ergebnismengen kosten mehr Speicher auf der Probe.
- Schreibvorgänge und DDL werden immer abgelehnt. Wenn Sie einen Schreibpfad testen müssen, ist dieser Monitor dafür nicht gedacht.
- Bevorzugen Sie ein Monitor-Geheimnis gegenüber einem Klartext-Passwort, damit die Anmeldeinformation im Ruhezustand verschlüsselt bleibt.

/*
 * The Data Observability Documentation page in German: the
 * English text of Pages/DataObservability/Documentation.tsx, translated. Its
 * code, field names, metric names and product names are as the English
 * writes them, and it names what the product draws as the Dashboard's
 * German words it. Change it with the English, in the same pull
 * request (DataObservabilityDocumentationInLocale).
 */
const DOCUMENTATION: string = `
## Was Data Observability überwacht

Jede Tabelle und jede Sicht jeder verbundenen Datenbank, alle fünf Minuten:

- **Zeilenanzahl und Größe**, aus den eigenen Statistiken der Engine.
- **Wann sie sich zuletzt geändert hat**: MySQL und SQL Server melden es; bei PostgreSQL beobachtet OneUptime die Zähler für Einfügungen, Aktualisierungen und Löschungen und vermerkt, wann sie sich bewegen.
- **Ihre Spalten**: Eine Spalte, die hinzugefügt, entfernt, umbenannt, im Typ geändert oder nullable gemacht wird, erscheint in der Zeitachse der Tabelle und unter Schemaänderungen.
- **Ihr üblicher Rhythmus**: wie oft sie sich üblicherweise ändert. Eine Tabelle, die deutlich über ihren Rhythmus hinausgeht, wird als **Verspätet** angezeigt.

Gelesen wird nur der Katalog der Datenbank, bei MongoDB außerdem die Feldnamen der neuesten Dokumente einer Collection. Kein Wert verlässt die Datenbank.

Ein Katalog kann melden, dass sich eine Tabelle geändert hat, obwohl sich nur ihre interne Verwaltung geändert hat, oder gar nichts melden. Benennen Sie in den **Einstellungen** einer Tabelle eine **Freshness-Spalte** wie \`updated_at\`, und ihre letzte Änderung wird zum neuesten Wert dieser Spalte. Das Login muss die Spalte lesen dürfen, und sie sollte indiziert sein.

Ein Lesereplikat von PostgreSQL oder SQL Server bewegt seine Schreibzähler nicht, daher lässt OneUptime sie dort weg und sagt das bei der Datenbank.

## Die Übersicht

Die **Übersicht** zeigt, wie es um Ihre Daten gerade steht. Solange das Projekt nicht eingerichtet ist, listet sie die verbleibenden Schritte auf: Warnungen für jede Datenbank, Eigentümer für die Tabellen, eine Prüfung und Ihre Pipeline-Läufe. **Handlungsbedarf** listet auf, was jemanden braucht, das Schlimmste zuerst: eine Datenbank, die nicht gelesen werden konnte, ein fehlgeschlagener oder verspäteter Pipeline-Lauf, eine fehlerhafte oder nicht ausführbare Prüfung, ein abgewichener Abgleich sowie ein verspätetes Datenprodukt oder eine verspätete Tabelle. Jeder Eintrag sagt, wem er gehört und ob seine Warnung offen ist, oder dass niemand benachrichtigt wird, weil für seine Datenbank keine Warnung eingeschaltet ist, und öffnet die Seite, auf der er behoben wird. **Datenbanken** zeigt, wie das letzte Lesen jeder Datenbank verlief und ob ihre Warnungen eingeschaltet sind. Die Zahl neben **Übersicht** im Menü zählt, was Handlungsbedarf hat, und **Probleme** darunter listet jeden Eintrag auf, eine Seite nach der anderen, gefiltert nach Art, Datenbank, Eigentümer (oder **Kein Eigentümer**) und danach, ob eine Warnung offen ist. Jede Zahl in der **Übersicht** öffnet ihre Liste: **Handlungsbedarf** öffnet **Probleme**, **Verspätete Tabellen** öffnet **Tabellen** mit nur den verspäteten und **Fehlerhafte Prüfungen** öffnet **Prüfungen** mit nur den fehlerhaften.

## Eine Datenbank verbinden

Verwenden Sie ein **schreibgeschütztes Login**. Wählen Sie in der Übersicht oder unter Datenbanken **Datenbank verbinden**, dann eines von beiden:

- **OneUptime verbindet sich**: Fügen Sie eine Verbindungszeichenfolge ein. Sie wird verschlüsselt gespeichert und nie wieder angezeigt.
- **Eine Sonde in meinem Netzwerk verbindet sich**: Wählen Sie eine der Sonden dieses Projekts und benennen Sie die Umgebungsvariable der Sonde, die die Verbindungszeichenfolge enthält (zum Beispiel \`ORDERS_DB_URL\`). Die Verbindungszeichenfolge verlässt Ihr Netzwerk nie. Aktualisieren Sie die Sonde zuerst auf die neueste Version.

Eine Datenbank, die bereits für die Datensicherheit verbunden ist, wird ebenfalls überwacht.

**Datenbanken, die Sie verbinden könnten** listet auf derselben Seite auf, was Ihr Projekt bereits kennt und noch niemand verbunden hat: Datenbanken, mit denen Ihre Traces sprechen, solche in Ihren Cloud-Konten und solche, die die Datenbanküberwachung beobachtet. **Verbinden** füllt das Formular mit dem vor, was über jede bekannt ist. Nichts wird gelesen, bevor Sie sie verbinden.

## Speicherpfade

Ein Export, der jede Nacht in einem Bucket landet, ist so verspätet oder so unvollständig wie jede Tabelle. Wählen Sie unter **Speicherpfade** für einen Bucket, den Ihre Cloud-Verbindung gefunden hat, auf Amazon S3, Google Cloud Storage oder einem Azure-Speicherkonto, **Pfade bearbeiten** und benennen Sie die Pfade, auf die es ankommt, einen pro Zeile. Jeder erscheint unter **Tabellen**: Sein neuestes Objekt ist der Zeitpunkt seiner letzten Änderung, seine Objekte sind seine Zeilen, und es gelten dieselben Warnungen. Gelesen werden nur Namen, Größen und Zeitpunkte, nie ein Objekt.

### Ein schreibgeschütztes Login, je Engine

PostgreSQL:

\`\`\`sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
\`\`\`

MySQL und MariaDB (\`performance_schema\` lässt OneUptime Schreibvorgänge zwischen den Erfassungen sehen):

\`\`\`sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
\`\`\`

SQL Server (\`VIEW DATABASE STATE\` lässt OneUptime Größen und letzte Aktualisierungen lesen):

\`\`\`sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
\`\`\`

Amazon Redshift: Verbinden Sie sich mit einer PostgreSQL-Verbindungszeichenfolge zum Endpunkt des Clusters oder der Arbeitsgruppe, zum Beispiel \`postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require\`. \`SYSLOG ACCESS UNRESTRICTED\` lässt OneUptime Zeilenanzahlen und Größen (\`svv_table_info\`), die letzten Schreib- und Lesevorgänge der Abfragen jedes Benutzers (\`stl_insert\`, \`stl_delete\`, \`stl_scan\`, einige Tage aufbewahrt) und die Datenherkunft der Abfragen jedes Benutzers lesen. Ohne sie zeigt die Änderung der Zeilen einer Tabelle trotzdem, wann sie sich geändert hat.

\`\`\`sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
\`\`\`

Snowflake: Legen Sie einen Benutzer mit einem Schlüsselpaar (ohne Passwort) an und verbinden Sie sich mit JSON, das die Kontokennung, den Benutzer, den privaten Schlüssel (unverschlüsseltes PKCS#8), die Datenbank und ein Warehouse für Prüfungen nennt:

\`\`\`json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
\`\`\`

Die Erfassung liest den Katalog mit SHOW, das kein Warehouse braucht, und kostet daher keine Credits. Nur Datenprüfungen laufen auf dem Warehouse, nach dem Zeitplan, den Sie ihnen geben. Snowflake nennt für keine Tabelle die letzte Änderung, daher hat sich eine Tabelle geändert, wenn sich ihre Zeilen oder Bytes bewegt haben.

\`\`\`sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
-- Warehouse spend reads SNOWFLAKE.ACCOUNT_USAGE.
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
-- Checks read rows: SELECT on the tables they check.
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
\`\`\`

Google BigQuery: Jedes Dataset, das Ihre Google-Cloud-Verbindung gefunden hat, wird bereits überwacht, mit dem Dienstkonto dieser Verbindung, ohne etwas zu verbinden. Geben Sie dem Dienstkonto **BigQuery Metadata Viewer** und **BigQuery Job User** für das Projekt und **BigQuery Data Viewer** für die Tabellen, die Ihre Prüfungen lesen. Jede Erfassung liest \`__TABLES__\` des Datasets (Zeilen, Bytes und letzte Änderung, kostenlos) und seine \`INFORMATION_SCHEMA.COLUMNS\` (abgerechnet mit dem Minimum von 10 MB bei BigQuery). Fügen Sie **BigQuery Resource Viewer** für das Projekt hinzu, um die Datenherkunft aus seinen Jobs zu erhalten, einmal pro Stunde gelesen (siehe Datenherkunft, die die Datenbanken nennen). Um ein Dataset ohne Google-Cloud-Verbindung zu verbinden, wählen Sie **Google BigQuery** und geben JSON mit einem Dienstkontoschlüssel an:

\`\`\`json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
\`\`\`

ClickHouse: Verbinden Sie sich über seine HTTP-Schnittstelle, Port 8443 mit TLS (ClickHouse Cloud) oder 8123 ohne, zum Beispiel \`clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics\`. Nennen Sie eine Datenbank, um nur sie zu überwachen; lassen Sie sie weg, um jede Datenbank außer den eigenen des Servers zu überwachen. \`system.parts\` lässt OneUptime jede Einfügung zwischen den Erfassungen sehen (ein Merge zählt nicht), \`system.part_log\` liefert, wo der Server es führt, den Zeitpunkt jeder Einfügung, und \`system.query_log\` liefert einmal pro Stunde den letzten Lesevorgang jeder Tabelle und die Datenherkunft aus \`INSERT ... SELECT\`. Jede Anweisung läuft mit gesetztem \`readonly\`, sodass selbst ein Login, das schreiben könnte, es nicht kann.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
-- Checks read rows: SELECT on the tables they check.
\`\`\`

Databricks: Ein Unity-Catalog-Katalog ist eine Datenbank. Seine Schemas, Tabellen, Sichten und Spalten sowie der letzte Commit jeder Delta-Tabelle werden über die REST-API von Unity Catalog ohne SQL-Warehouse gelesen, sodass die Erfassung keine Rechenleistung kostet. Datenprüfungen sowie Datenherkunft, letzte Schreib- und Lesevorgänge aus der Systemtabelle \`system.access.table_lineage\` (einmal pro Stunde) laufen auf dem SQL-Warehouse, das Sie nennen. Verbinden Sie sich mit einem Dienstprinzipal (oder einem persönlichen Zugriffstoken anstelle von \`clientId\` und \`clientSecret\`: \`"token": "dapi..."\`):

\`\`\`json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
\`\`\`

\`\`\`sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE SCHEMA ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE CATALOG ON CATALOG system TO \`oneuptime-reader\`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO \`oneuptime-reader\`;
-- Checks read rows: SELECT on the tables they check. And CAN USE on the SQL warehouse.
\`\`\`

Oracle: Verbinden Sie sich mit \`oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1\` oder mit JSON \`{ "user", "password", "connectString" }\`. Gelesen wird über das eigene Protokoll von Oracle, ohne einen Oracle-Client zu installieren. Das Login sieht die Tabellen, die es lesen darf: Gewähren Sie \`READ\` für jede zu überwachende Tabelle (es kann sie abfragen, aber nie sperren oder ändern). \`SELECT_CATALOG_ROLE\` lässt OneUptime die Größe jeder Tabelle lesen; ohne sie haben nur die eigenen Tabellen des Logins eine. \`ALL_TAB_MODIFICATIONS\` nennt die Einfügungen, Aktualisierungen und Löschungen jeder Tabelle seit ihren letzten Statistiken und wann sie sich zuletzt geändert hat.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
\`\`\`

Amazon Athena: Eine Glue-Datenbank ist eine Datenbank. Ihre Tabellen und Sichten, deren Spalten und Statistiken sowie der letzte Commit jeder Iceberg-Tabelle kommen aus der API des Glue Data Catalog, die keine Daten liest und nichts kostet; Prüfungen laufen als Athena-Abfragen in der Arbeitsgruppe, die Sie nennen. Verbinden Sie sich mit den Schlüsseln eines IAM-Benutzers oder einer IAM-Rolle, die die Glue-Datenbank lesen und Athena-Abfragen ausführen darf:

\`\`\`json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
\`\`\`

Es braucht \`glue:GetDatabase\` und \`glue:GetTables\` für die Datenbank und ihre Tabellen und für Prüfungen \`athena:StartQueryExecution\`, \`athena:GetQueryExecution\`, \`athena:GetQueryResults\` und \`athena:StopQueryExecution\` für die Arbeitsgruppe, mit Lesezugriff auf die S3-Daten der Tabellen und Schreibzugriff auf den Ausgabeort.

MongoDB: Verbinden Sie sich mit seiner Verbindungszeichenfolge - \`mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/\` oder \`mongodb://\` mit den Hosts eines Replikatsatzes. Eine Datenbank im Pfad ist die einzige überwachte; ohne eine wird jede Datenbank überwacht, die das Login lesen darf. Die Dokumente, die Größe und die Schreibvorgänge jeder Collection kommen aus \`$collStats\`, und wann sie zuletzt ein Dokument aufgenommen hat, aus ihrer neuesten \`_id\`. Ihre Felder kommen aus dem JSON-Schema ihres Validators oder sonst aus den Namen und Typen der Felder ihrer 100 neuesten Dokumente, ermittelt in der Datenbank, sodass kein Wert sie verlässt. Dokumente werden auf einem Secondary gelesen, wo es einen gibt. Die Quell-Collection einer Sicht ist Datenherkunft, und eine benutzerdefinierte Prüfung ist eine Aggregations-Pipeline, als JSON.

\`\`\`javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
\`\`\`

Um nur eine Datenbank zu überwachen, gewähren Sie \`{ role: "read", db: "orders" }\` anstelle von \`readAnyDatabase\`.

Microsoft Dataverse: Eine Umgebung ist eine Datenbank, ihre Tabellen in \`dbo\`, wie ihr SQL-Endpunkt sie benennt. OneUptime meldet sich als App an: Registrieren Sie eine in Microsoft Entra ID mit einem geheimen Clientschlüssel und fügen Sie sie der Umgebung als Anwendungsbenutzer hinzu (Power Platform admin center > the environment > Settings > Users + permissions > Application users), mit einer Sicherheitsrolle, die die Tabellen lesen darf. Verbinden Sie sich mit JSON oder mit einer Dataverse-Verbindungszeichenfolge, die \`AuthType=ClientSecret\` angibt. Den Mandanten können Sie weglassen: Die Umgebung sagt, in welchem sie ist.

\`\`\`json
{ "environmentUrl": "https://contoso.crm.dynamics.com", "tenantId": "...", "clientId": "...", "clientSecret": "..." }
\`\`\`

Alle fünf Minuten liefert die Web-API die Definition jeder Tabelle, ihre Zeilen aus dem Snapshot, den Dataverse einmal am Tag erstellt (sie hinken also bis zu einem Tag hinterher), und ihr neuestes \`modifiedon\`, den Zeitpunkt ihrer letzten Änderung. Ihre Spalten werden einmal pro Stunde gelesen. Jeder Lesevorgang zählt gegen die Dataverse-Anforderungslimits der App, und eine Erfassung, die gebeten wird, langsamer zu werden, überlässt den Rest der nächsten. Eine Umgebung enthält Hunderte eigener Tabellen, daher werden nur die zentralen Geschäftstabellen (Konten, Kontakte, Leads, Verkaufschancen, Angebote, Aufträge, Rechnungen, Produkte, Fälle, E-Mails, Telefonanrufe, Termine, Aufgaben und Notizen) und Ihre eigenen benutzerdefinierten Tabellen überwacht. Tabellen der Apps von Microsoft (\`msdyn_\`, \`adx_\` und die anderen \`ms\`-Präfixe) werden ausgelassen: Nennen Sie jede andere Tabelle, die überwacht werden soll, wie in \`"tables": ["msdyn_workorder"]\`.

Datenprüfungen laufen als schreibgeschütztes SQL auf dem TDS-Endpunkt der Umgebung, auf Port 1433 oder 5558. Er ist eingeschaltet, sofern ein Administrator ihn nicht ausgeschaltet hat; wo die Zugriffskontrolle auf Benutzerebene dafür eingeschaltet ist, braucht die Rolle der App die Berechtigung **Allow user to access TDS endpoint**. Sein SQL kennt keine regulären Ausdrücke, kein \`WITH\` und keine Stichprobe.

## Metriken, die jede Tabelle schreibt

Jede Erfassung schreibt diese für jede Tabelle, sodass Sie sie in Diagrammen darstellen, auf Dashboards legen und wie jede andere Metrik mit Warnungen versehen können:

| Metrik | Was sie ist |
| --- | --- |
| \`oneuptime.data.table.row_count\` | Zeilen in der Tabelle |
| \`oneuptime.data.table.size\` | Bytes, die die Tabelle und ihre Indizes belegen |
| \`oneuptime.data.table.seconds_since_change\` | Sekunden, seit zuletzt eine Zeile eingefügt, aktualisiert oder gelöscht wurde |
| \`oneuptime.data.table.overdue_seconds\` | Sekunden, die die Tabelle über den Zeitpunkt hinaus ist, bis zu dem sie sich üblicherweise ändert; 0, solange sie pünktlich ist. Geschrieben, sobald ihr Rhythmus gelernt ist |
| \`oneuptime.data.table.row_count_change_percent\` | Wie stark sich die Zeilenanzahl seit der vorigen Erfassung bewegt hat, in Prozent (-50 heißt, die Hälfte der Zeilen ist weg). Tabellen unter 1.000 Zeilen werden ausgelassen |
| \`oneuptime.data.table.schema_changes\` | Spalten, die sich seit der vorigen Erfassung geändert haben |
| \`oneuptime.data.table.breaking_schema_changes\` | Spalten, die seit der vorigen Erfassung entfernt, umbenannt oder im Typ geändert wurden |

Jede Zeile trägt \`oneuptime.data.store.id\`, \`oneuptime.data.store.name\`, \`oneuptime.data.table.id\`, \`oneuptime.data.table.schema\`, \`oneuptime.data.table.name\` und \`oneuptime.data.table.key\` (\`schema.table\`). Ein Metrik-Monitor, gruppiert nach \`oneuptime.data.table.key\`, warnt einmal pro Tabelle, und seine Filter **Anomal hoch** und **Anomal niedrig** vergleichen jede Tabelle mit ihrem eigenen üblichen Wert für diese Stunde der Woche, sodass kein Schwellenwert gesetzt werden muss.

## Warnungen

Eine Datenbank, die Sie verbinden, öffnet sich auf ihrer Seite **Empfohlene Warnungen**; später wählen Sie diese unter **Datenbanken** für sie aus. Jede Empfehlung ist ein Metrik-Monitor für die ganze Datenbank, der einmal pro Tabelle warnt, sodass auch eine später angelegte Tabelle überwacht wird:

| Warnung | Wird ausgelöst, wenn |
| --- | --- |
| **Tabelle ist verspätet** | Eine Tabelle bleibt fünfzehn Minuten lang über den Zeitpunkt hinaus, bis zu dem sie sich üblicherweise ändert - dieselbe Regel wie beim Hinweis **Verspätet** |
| **Zeilenanzahl stark gesunken** | Eine Tabelle verliert zwischen zwei Erfassungen die Hälfte ihrer Zeilen oder mehr |
| **Zeilenanzahl ungewöhnlich niedrig** | Eine Tabelle enthält weit weniger Zeilen als für diese Stunde der Woche üblich (lernt über zwei Wochen) |
| **Schema geändert** | Spalten einer Tabelle werden entfernt, umbenannt oder im Typ geändert. Eine hinzugefügte Spalte macht nichts kaputt und bleibt in der Zeitachse |
| **Tabellenzustand meldet nicht mehr** | Keine Tabelle der Datenbank wurde fünfzehn Minuten lang gelesen |

Wählen Sie Schweregrade, Bereitschaftsrichtlinien, Eigentümer und Beschriftungen, wenn Sie sie erstellen. Von da an sind es gewöhnliche Monitore: Bearbeiten Sie sie, schalten Sie sie stumm oder legen Sie sie auf eine Statusseite wie jeden anderen.

Ein Backfill oder eine Migration sollte niemanden alarmieren. Nennen Sie die Datenbank in einem Wartungsereignis unter **Data Observability Datenbanken** oder nehmen Sie ihren Datenbankserver in eines auf, und ihre Datenwarnungen bleiben still, solange das Ereignis läuft.

## Eigentümer und Beschriftungen

Der Tab **Eigentümer** einer Tabelle nennt die Personen und Teams, denen sie gehört, und eine Warnung der Tabelle geht an sie; ohne Eigentümer an die Eigentümer ihrer Datenbank. **Eigentümerregeln** und **Beschriftungsregeln** gelten für jede Tabelle, sobald sie erstmals erscheint, abgeglichen über ihre Beschriftungen oder über einen regulären Ausdruck auf ihren Namen, ihr Schema oder ihre Datenbank. Eine auf \`Owned\` beschränkte Berechtigung reicht nur bis zu den Tabellen, die ihr Inhaber oder seine Teams besitzen, samt deren Prüfungen, Aktivität und gemeldeten Problemen. Wer eine Datenbank besitzt, besitzt dadurch nicht ihre Tabellen: Verwenden Sie eine Eigentümerregel, um einem Team eine ganze Datenbank zu geben.

## Wenn sich eine Warnung öffnet

Eine Warnung einer Tabelle hat eine Karte **Daten**, die sagt, warum sie höchstwahrscheinlich ausgelöst wurde, nach Wahrscheinlichkeit geordnet: eine Warnung weiter oben in der Datenherkunft, ein fehlgeschlagener Lauf, ein Deployment eines Dienstes, der in sie schreibt, ihre fehlschlagenden Schreibvorgänge, eine geänderte Spalte, die Datenbank oder der Server, auf dem sie läuft. Darunter steht, was von ihr abhängt: Tabellen, Dashboards, Dienste und die Personen, denen sie gehören.

Sagen Sie, was Sie davon halten: **Nützlich**, **Erwartet** (ein geplantes Ereignis: nichts ändert sich) oder **Kein Problem** (die Tabelle bekommt mehr Spielraum, sodass dasselbe beim nächsten Mal still bleibt). Wenn eine Person ein Problem zuerst findet, hält **Ein Problem melden** an der Tabelle es fest. Die **Übersicht** zeigt, wie es sich summiert: nützliche Meldungen pro Woche, wie viele kein Rauschen waren, wie oft ein Problem gemeldet wurde, bevor jemand es selbst meldete, wie schnell, und wie oft die wahrscheinliche Ursache die tatsächliche war.


## Datenprodukte

Die Menschen, die Daten nutzen (Analysten, Finanzen, Führungskräfte, KI-Agenten), denken in dem, was sie nutzen: „die Tabellen des Umsatz-Dashboards“, nicht in Datenbanken. Ein Datenprodukt benennt diese Tabellen, mit seinem Eigentümer, seinen Nutzern und seinem Aktualitäts-SLA. Legen Sie eines unter **Datenprodukte** an. Sein SLA ist eines oder beides von:
- **Aktuell bis zu einer Tageszeit (UTC):** Die Daten jedes Tages landen an diesem Tag, bis dahin. Ab dieser Uhrzeit muss sich jede Tabelle an diesem Tag geändert haben; bis dahin gilt die Ladung von gestern. Eine Ladung, die immer eine halbe Stunde zu spät kommt, ist jeden Tag diese halbe Stunde lang verspätet.
- **Ein maximales Alter:** Die letzte Änderung keiner Tabelle darf älter sein als dieses.

Alle fünf Minuten werden die Tabellen jedes Produkts mit seinem SLA verglichen. Das Produkt ist **Verspätet**, wenn eine seiner Tabellen es ist, und der Stand seiner Daten ist die älteste letzte Änderung unter ihnen. Es schreibt \`oneuptime.data.product.late_tables\` und \`oneuptime.data.product.data_age\`, sodass Sie die Aktualität aller Produkte nebeneinander darstellen können.

Beim Speichern eines Produkts entsteht außerdem, in Ihrem Namen und mit Ihren Berechtigungen:
- **Ein Monitor**, der das Produkt auf einer Statusseite darstellt. Er ist beeinträchtigt, solange eine Tabelle verspätet ist, und öffnet einen Vorfall und eine Warnung auf der niedrigsten Schwere Ihres Projekts, die sich von selbst auflösen. Fügen Sie ihn einer Statusseite, privat oder öffentlich, als Ressource hinzu: Nutzer, die sie abonnieren, erfahren, wenn das Produkt verspätet ist und wenn es wieder aktuell ist.
- **Ein SLO** über diesem Monitor: der Anteil der Zeit, in dem die Daten pünktlich sind, gemessen am SLA-Ziel des Produkts über 30 Tage, mit den Warnungen für schnelle und langsame Burn-Rate, mit denen jedes SLO beginnt.

Wenn Sie das Produkt löschen, werden beide gelöscht. Jedes Produkt hat außerdem ein **Badge**, das sagt, auf welchem Stand seine Daten sind, grün, solange sie pünktlich sind, und bernsteinfarben mit „late“, sobald nicht. Betten Sie es in der Übersicht des Produkts in ein BI-Dashboard, eine Wiki-Seite oder eine README ein. Sein Link braucht keine Anmeldung, behandeln Sie ihn also wie einen geteilten Link; **Badge-Link zurücksetzen** erstellt einen neuen und macht den alten ungültig.

## Prüfungen der Werte einer Tabelle

Der Tabellenzustand sagt, ob sich eine Tabelle ändert. Eine **Prüfung** sagt, ob stimmt, was sie enthält. Fügen Sie eine im Tab **Prüfungen** einer Tabelle hinzu:

| Prüfung | Was sie liest |
| --- | --- |
| **Anteil NULL-Werte** | Prozentsatz der Zeilen, deren Spalte leer ist |
| **Anteil Duplikate** | Prozentsatz der Werte, die den Wert einer anderen Zeile wiederholen |
| **Anzahl eindeutiger Werte** | Wie viele verschiedene Werte die Spalte enthält |
| **Minimum**, **Maximum**, **Durchschnitt**, **Summe** | Einer numerischen Spalte (eine Summe über keine Zeilen ist 0) |
| **Anteil ungültiger Werte** | Prozentsatz der Werte außerhalb einer Liste, die Sie angeben |
| **Anteil Formatabweichungen** | Prozentsatz der Werte, die nicht in einem Format sind, das Sie wählen, etwa E-Mail, UUID oder Ländercode, oder die nicht auf einen regulären Ausdruck von Ihnen passen (jede Engine außer SQL Server) |
| **Anzahl verwaister Zeilen** | Zeilen, deren Wert keine Entsprechung in der Spalte einer anderen Tabelle hat |
| **Zeilenanzahl** | Zeilen in der Tabelle, am nützlichsten mit **Segmentieren nach** |
| **Benutzerdefiniertes SQL** | Die Zahl, die ein schreibgeschütztes SELECT von Ihnen zurückgibt |

**Vorgeschlagene Prüfungen** im selben Tab bieten die Prüfungen an, die die Spalten einer Tabelle nahelegen, allein aus ihren Namen und Typen:
- Eine ID ist eindeutig.
- Eine \`customer_id\` hat eine passende Zeile in \`customers\`.
- Eine E-Mail-Adresse sieht wie eine aus, und ein Betrag ist nicht negativ.
- Ein Status behält seine üblichen Werte.
- Eine nach Mandanten aufgeteilte Tabelle wird pro Mandant gezählt.

Fügen Sie eine hinzu, fügen Sie alle hinzu oder verwerfen Sie eine endgültig.

**Segmentieren nach** führt eine Prüfung einmal pro Wert einer Spalte aus, etwa pro Mandant oder Region: eine Reihe und eine Warnung für jeden, für die größten 100 Segmente. Eine segmentierte Zeilenanzahl warnt, wenn ein Mandant keine Daten mehr sendet.

Prüfungen laufen mit der Erfassung der Datenbank, bei OneUptime oder auf ihrer Sonde, alle 15 Minuten, stündlich, alle 6 Stunden oder täglich. Jede läuft als eine einzige Aggregatanweisung in einer schreibgeschützten Transaktion mit einem Timeout für Anweisungen: Nur die Zahl verlässt die Datenbank, es sei denn, ein Projekt entscheidet sich, eine maskierte Stichprobe fehlerhafter Zeilen aufzubewahren. Der Wert wird als \`oneuptime.data.check.value\` geschrieben, mit \`oneuptime.data.check.id\`, \`oneuptime.data.check.name\` und \`oneuptime.data.check.segment\`.

Setzen Sie **Warnen, wenn**, um bei einer Prüfung zu warnen:
- **Ungewöhnlich hoch** oder **Ungewöhnlich niedrig** vergleicht jeden Wert mit seiner eigenen gelernten Baseline für diese Stunde der Woche.
- **Über** oder **Unter** vergleicht ihn mit einem Schwellenwert.

Beim Speichern der Prüfung entsteht ein Metrik-Monitor für sie, in Ihrem Namen und mit Ihren Berechtigungen. Wenn Sie die Bedingung leeren, wird der Monitor entfernt.

**Fehlerhafte Zeilen** zählt die Zeilen, die ein schreibgeschütztes SELECT von Ihnen zurückgibt: die Zeilen, die es nicht geben sollte. 0 ist gesund.

Drei Dinge halten die Kosten einer Prüfung im Griff. **Stichprobenanteil (%)** liest einen Teil der Zeilen, für eine Prüfung, die eine Rate liest. **Maximal von einer Prüfung lesbar (GB)** unter **Einstellungen** stoppt eine Prüfung bei BigQuery oder Athena, bevor sie mehr als so viel liest. **Warten, wenn eine Datenbank ausgelastet ist**, ebenfalls dort, lässt fällige Prüfungen für die nächste Erfassung liegen, wenn eine PostgreSQL-, MySQL- oder SQL-Server-Datenbank ausgelastet wirkt.

**Fehlerhafte Zeilen aufbewahren** unter **Einstellungen** behält bis zu 20 fehlerhafte Zeilen einer Prüfung, wobei sensible Spalten maskiert werden, bevor sie die Datenbank verlassen. Die Einstellung ist aus, bis Sie sie einschalten. Die Zeilen werden in OneUptime gespeichert, bei OneUptime Cloud auf den Servern von OneUptime und bei einer selbst gehosteten Installation auf Ihren eigenen, und wenn Sie die Einstellung ausschalten, werden sie gelöscht.

Halten Sie Prüfungen in einer Datei in Ihrem Repository und wenden Sie sie aus der CI mit \`oneuptime data-checks apply checks.yaml\` an. Führen Sie es bei einem Pull Request mit \`--dry-run\` aus. Ein Fehler irgendwo in der Datei bewirkt, dass nichts angewendet wird. Das Format der Datei steht in der Dokumentation.


## Abgleiche

Kopien weichen ab: Das Warehouse hat weniger Bestellungen als die Datenbank der Anwendung, oder eine Migration hat Zeilen verloren. Ein Abgleich vergleicht ein Maß zweier Tabellen, in einer Datenbank oder in zweien:
- **Zeilenanzahl**
- **Summe** einer Spalte
- **Anzahl eindeutiger Werte** einer Spalte
- **Benutzerdefiniertes SQL**: eine schreibgeschützte Abfrage, die eine Zahl namens \`value\` zurückgibt.

Er hat eine Toleranz, einen **Absolut**en Betrag oder einen **Prozent**satz des Werts der Quelle. Legen Sie einen unter **Abgleiche** an.

Jede Seite wird von einer eigenen Datenprüfung gelesen, die der Abgleich anlegt und pflegt, mit der Erfassung ihrer Datenbank: bei OneUptime oder auf der Sonde der Datenbank. Ein Abgleich kann daher eine PostgreSQL-Tabelle in Ihrem Netzwerk mit ihrer Kopie in Snowflake oder BigQuery vergleichen. Seine Prüfungen erscheinen im Tab Prüfungen jeder Tabelle und werden nur über den Abgleich geändert.

Die beiden Werte werden verglichen, sobald beide innerhalb von 15 Minuten voneinander gelesen wurden, und beide Seiten werden dann so eingeplant, dass sie wieder gemeinsam gelesen werden. Ein Abgleich schreibt:
- \`oneuptime.data.reconciliation.drifted\`: 1, wenn die beiden über die Toleranz hinaus abgewichen sind, 0, wenn sie übereinstimmen. Sein Monitor liest dies und warnt, wenn sie abweichen.
- \`oneuptime.data.reconciliation.difference\`: der Wert des Ziels minus den der Quelle.
- \`oneuptime.data.reconciliation.difference_percent\`: die Differenz als Prozentsatz des Werts der Quelle.

Eine Seite, deren Prüfung fehlschlägt, sagt, warum. Eine Kopie, die nach Zeitplan geladen wird, hinkt ihrer Quelle hinterher: Vergleichen Sie ein Maß, bei dem beide zur Ruhe gekommen sind, etwa Zeilen, die älter als eine Stunde sind, mit benutzerdefiniertem SQL, oder berücksichtigen Sie die Verzögerung in der Toleranz.

## Pipelines und Datenherkunft, aus OpenLineage

Airflow, Dagster, Spark, dbt und Flink beschreiben jeden Lauf eines Jobs mit [OpenLineage](https://openlineage.io)-Ereignissen. Senden Sie sie unverändert an OneUptime, mit einem Telemetrie-Ingestion-Schlüssel (Projekteinstellungen > Telemetrie & APM > Ingestion-Schlüssel):

- **URL:** \`https://oneuptime.com/telemetry/openlineage\` (bei einem selbst gehosteten OneUptime Ihre eigene Adresse)
- **Endpunkt:** \`api/v1/lineage\`, der Standard von OpenLineage
- **API-Schlüssel:** der Ingestion-Schlüssel. Er wird als \`Authorization: Bearer\` gesendet, oder setzen Sie \`x-oneuptime-token\`.

Für den OpenLineage-Provider von Airflow:

\`\`\`bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
\`\`\`

Für jeden OpenLineage-Client setzen Sie \`OPENLINEAGE_URL\` und \`OPENLINEAGE_API_KEY\`.

Jeder Job erscheint unter **Pipelines**, mit seinem neuesten Lauf: wann er begann und endete, wie lange er dauerte, und dem Fehler eines fehlgeschlagenen Laufs. Ein Lauf, der Tabellen liest und schreibt, die OneUptime überwacht, wird zur **Datenherkunft**: Der Tab **Datenherkunft** einer Tabelle zeigt die Tabellen, aus denen sie erstellt wird, die Pipelines, die in sie schreiben, mit ihrem neuesten Lauf, und die Tabellen, die aus ihr erstellt werden.

Datasets werden nach der OpenLineage-Namensspezifikation Tabellen zugeordnet: \`postgres://host:5432\` mit \`database.schema.table\`, \`mysql://host:3306\` mit \`database.table\`, \`sqlserver://host:1433\` und \`redshift://cluster:5439\` mit \`database.schema.table\`, \`snowflake://account\` mit \`database.schema.table\`, \`bigquery\` mit \`project.dataset.table\`, \`clickhouse://host:8443\` mit \`database.table\` und \`databricks://workspace-host\` mit \`catalog.schema.table\`.

Jede Pipeline lernt aus ihren eigenen Läufen, wie lange ein Lauf üblicherweise dauert (der Median ihrer letzten 20 abgeschlossenen Läufe) und wie lange sie nach ihrem Zeitplan zwischen Läufen pausiert (die längste Lücke zwischen ihren letzten 50 Starts, die kein Einzelfall ist). Beides ist nach fünf Läufen bekannt und passt zu einem Job, der alle fünf Minuten läuft, ebenso wie zu einem, der nachts läuft. Wenn Ihr Scheduler das Facet \`nominalTime\` von OpenLineage sendet, wie Airflow es tut, steht die geplante Zeit eines Laufs für seinen Start, sodass ein Backfill weiterhin wie der Zeitplan aussieht.

Die Seite einer Pipeline empfiehlt drei Monitore, jeder mit einem Klick erstellt:
- **Pipeline-Lauf fehlgeschlagen**: Ein Lauf ist fehlgeschlagen oder wurde abgebrochen.
- **Pipeline-Lauf ungewöhnlich lang**: Ein Lauf hat doppelt so lange gedauert wie üblich, oder länger. Er wird alle fünf Minuten geprüft, während der Lauf andauert, sodass ein hängender Lauf erkannt wird, bevor er endet.
- **Pipeline ist verspätet**: Seit länger, als der Zeitplan erlaubt, hat kein Lauf begonnen, mit einem Viertel des Intervalls und mindestens fünfzehn Minuten Spielraum.

Sie lesen diese Metriken, jede mit \`oneuptime.data.pipeline.id\` und \`oneuptime.data.pipeline.name\` versehen:
- \`oneuptime.data.pipeline.run_failed\`: 1 oder 0, wenn jeder Lauf endet.
- \`oneuptime.data.pipeline.run_duration\`: Sekunden, wenn jeder Lauf endet.
- \`oneuptime.data.pipeline.run_duration_ratio\`: die Dauer des Laufs geteilt durch die des üblichen Laufs (mindestens als eine Minute gezählt), wenn jeder Lauf endet und alle fünf Minuten, während er läuft.
- \`oneuptime.data.pipeline.overdue_seconds\`: wie lange der nächste Lauf über seinem Zeitplan liegt, alle fünf Minuten; 0, solange er pünktlich ist.

Die Seite einer Pipeline zeichnet ihre **Datenherkunft**, die erste Anlaufstelle, wenn ein Lauf fehlschlägt oder sich verspätet: links die Tabellen, die sie liest, rechts die Tabellen, die sie schreibt, und wie es um jede gerade steht. Wählen Sie mehr Schritte, um zu sehen, woraus diese Tabellen erstellt werden und was aus ihnen erstellt wird; eine Anzahl nicht gezeichneter Tabellen, auf der Karte der Pipeline oder einer Tabelle, zeichnet mehr von ihnen an Ort und Stelle. Dieselbe Datenherkunft steht unter \`POST /api/data-observability/pipelines/lineage\` bereit, für Ihre eigenen Werkzeuge. Wählen Sie eine der Spalten, die sie schreibt, um ihr über die Pipeline hinweg zu folgen: hinauf zur Spalte jeder gelesenen Tabelle, aus der sie erstellt wurde, und hinunter zu jeder Tabelle, in die sie sie schreibt. Senden Sie für Ihre eigenen Werkzeuge \`"withColumns": true\` für die Spalten, die ihre Läufe bewegt haben.



## Fivetran- und Airbyte-Synchronisierungen

Fivetran und Airbyte laden Ihre Rohtabellen und senden keine OpenLineage-Ereignisse, aber ihre Webhooks sagen, wann jede Synchronisierung beginnt und endet. Jeder Fivetran-Connector und jede Airbyte-Verbindung wird zu einer Pipeline unter **Pipelines** und jede Synchronisierung zu einem Lauf, mit demselben Laufverlauf, derselben gelernten Dauer und demselben Zeitplan und denselben Warnungen wie jede Pipeline: ein fehlgeschlagener Lauf, ein ungewöhnlich langer und ein verspäteter. **Pipelines > Fivetran oder Airbyte verbinden** füllt die URLs unten mit einem Ihrer Ingestion-Schlüssel aus.

- **Fivetran:** Erstellen Sie mit der REST-API von Fivetran einen Webhook für Ihr Konto oder eine Zielgruppe, mit den Ereignissen \`sync_start\` und \`sync_end\`. Seine URL ist \`https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>\`, und sein Geheimnis ist dieser Ingestion-Schlüssel. Fivetran signiert jede Zustellung mit dem Geheimnis, sodass der Schlüssel selbst nie in der URL steht, und eine Zustellung, die nicht damit signiert ist, wird abgelehnt.
- **Airbyte:** Setzen Sie in den Benachrichtigungseinstellungen Ihres Arbeitsbereichs den Webhook auf \`https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>\` und schalten Sie ihn für fehlgeschlagene und erfolgreiche Synchronisierungen ein. Airbyte signiert nichts, daher trägt seine URL den Schlüssel: Geben Sie Airbyte einen eigenen Schlüssel.

Eine Pipeline heißt so, wie das Werkzeug den Connector oder die Verbindung nennt, unter \`fivetran://<destination group>\` oder \`airbyte://<workspace>\`. Der Lauf einer fehlgeschlagenen Synchronisierung zeigt den Fehler des Werkzeugs. Eine Fivetran-Synchronisierung, die wegen des Ratenlimits einer API neu geplant wird, endet als **Neu geplant**: Sie ist kein Fehler, alarmiert daher niemanden, und ihre Zeit lehrt keine Dauer.

Ein Fivetran-Connector lädt das Schema seines Ziels, das nach ihm benannt ist. Wenn genau eine überwachte Datenbank dieses Schema hat, vermerken ihre Tabellen den Connector als ihren Schreiber: Eine Tabelle, die veraltet, verweist auf die Synchronisierung, die sie hätte laden sollen, und die Warnung einer fehlgeschlagenen Synchronisierung ist die Ursache der Warnungen der Tabellen (siehe Eine Meldung pro Ursache). Airbyte nennt keine Tabellen.

## Dashboards in BI-Tools

Die wirkliche Auswirkung schlechter Daten ist das Dashboard, das jemand öffnet. Fügen Sie unter **BI-Dashboards** Ihre BI-Tools mit Zugangsdaten hinzu, die ihre Dashboards lesen dürfen:

| Tool | Zugangsdaten (JSON) |
| --- | --- |
| **Metabase** | \`{ "apiKey": "mb_..." }\` (oder \`username\` und \`password\` eines Benutzers) |
| **Superset** | \`{ "username": "...", "password": "..." }\` |
| **Tableau** | \`{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }\`, ein persönliches Zugriffstoken |
| **Looker** | \`{ "clientId": "...", "clientSecret": "..." }\`, ein API-Client |
| **Power BI** | \`{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }\`, ein Dienstprinzipal, der die Admin-APIs von Power BI nutzen darf |
| **Hightouch** | \`{ "apiKey": "..." }\`: jede Synchronisierung wird als ein weiteres Ding gelesen, das von einer Tabelle abhängt |
| **Census** | \`{ "apiKey": "...", "region": "us" }\`: jede Synchronisierung wird als ein weiteres Ding gelesen, das von einer Tabelle abhängt |

Jede Stunde, und wenn ein Tool hinzugefügt wird oder Sie **Jetzt lesen** wählen, liest OneUptime jedes Dashboard und die Tabellen dahinter: die Tabelle einer Karte und das SQL einer nativen Frage (Metabase), die Tabelle eines Datasets oder das SQL eines virtuellen Datasets (Superset), die vorgelagerten Tabellen der Metadata API (Tableau), das Explore jeder Kachel (Looker) und das Dataset jedes Berichts (Power BI, aus einem Arbeitsbereichsscan). Jede Tabelle wird über ihre Datenbank, ihr Schema und ihren Namen einer überwachten zugeordnet; ein Name, der weiterhin auf zwei überwachte Tabellen passt, bleibt nicht zugeordnet. Der Tab **Datenherkunft** einer Tabelle, die Karte **Daten** ihrer Warnungen und die Produktionsprüfung listen die Dashboards auf, die auf ihr aufbauen, und auf den Tabellen, die aus ihr erstellt werden. Gelesen werden nur Namen und Links, nie die Daten eines Dashboards.

Ein Power-BI-Tool kann außerdem bei fehlgeschlagenen Aktualisierungen seiner Datasets warnen. Mit eingeschalteter Einstellung **Warnung bei fehlgeschlagenen Aktualisierungen**, wie bei einem jetzt hinzugefügten Tool, führt OneUptime einen Monitor für das Tool, der für jedes Dataset, dessen letzte Aktualisierung fehlgeschlagen ist oder abgebrochen wurde, eine Warnung öffnet, benannt im Titel der Warnung, und sie auflöst, sobald eine spätere Aktualisierung abgeschlossen ist. Er liest \`oneuptime.data.bi.refresh_failed\`, versehen mit \`oneuptime.data.bi.dataset.name\` und \`oneuptime.data.bi.workspace.name\`: Alle fünf Minuten schreibt jedes Dataset, das das stündliche Lesen als fehlgeschlagen vorfand, 1, und 0 für die Stunde nach einer später abgeschlossenen Aktualisierung. Eine noch laufende Aktualisierung ändert nichts, sodass ein Fehler eine Warnung ist, egal wie viele stündliche Lesevorgänge ihn sehen.

## Jobs in Ihren Traces

Ein Kubernetes-CronJob oder eine Funktion mit Timer braucht keine Installation, um als Pipeline zu erscheinen: Spans mit \`k8s.cronjob.name\` oder \`k8s.job.name\`, oder \`faas.name\` mit einem \`faas.trigger\` von \`timer\` oder \`datasource\`, werden zu einer, mit ihren Läufen und den Tabellen, die ihre Datenbankaufrufe berührt haben. Jeder Lauf verlinkt auf seinen Trace und seine Logs, und ein CronJob, der nicht mehr läuft, wird als verspätet erkannt.

## Datenherkunft, die die Datenbanken nennen

Datenherkunft braucht keine Pipeline, die OpenLineage sendet. Jede Datenbank nennt selbst einen Teil davon, und OneUptime liest ihn mit der Erfassung der Datenbank:
- **Sichten:** Eine Sicht wird aus den Tabellen erstellt, auf denen sie definiert ist, in PostgreSQL, Redshift, MySQL 8 und SQL Server. Wenn eine Sicht neu definiert oder gelöscht wird, verschwindet ihre alte Datenherkunft mit ihr.
- **Abfrageverlauf:** Eine Abfrage, die eine Tabelle gelesen und eine andere geschrieben hat, etwa eine geplante Abfrage, ein dbt-Modell oder ein MERGE, ist ebenfalls Datenherkunft. Sie kommt aus den Jobs von BigQuery (der Sicht \`INFORMATION_SCHEMA.JOBS\` des Projekts und Standorts des Datasets, die **BigQuery Resource Viewer** braucht) und dem Abfrageprotokoll von Redshift (\`stl_insert\` und \`stl_scan\`, die \`SYSLOG ACCESS UNRESTRICTED\` brauchen). Nur Jobs, die im eigenen Projekt des Datasets ausgeführt wurden, stehen in seiner Jobs-Sicht.

Die Datenherkunft wird einmal pro Stunde gelesen, zurück bis zum letzten Lesen, und bei der ersten Erfassung einer Datenbank eine Woche zurück, sodass sie von Anfang an da ist. Ein Lesen bei BigQuery wird für die Stunden an Jobs abgerechnet, die es liest, meist mit dem Minimum von 10 MB bei BigQuery.

Jede Kante im Tab **Datenherkunft** einer Tabelle sagt, wo sie gesehen wurde: im Lauf einer Pipeline, im Abfrageverlauf (mit einem Login, dessen Abfragen die Daten bewegt haben) oder in der Definition einer Sicht. Datenherkunft aus jeder Quelle zählt für **Eine Meldung pro Ursache**.

Oben im Tab **Datenherkunft** einer Tabelle zeichnet ein Diagramm ihre Datenherkunft einige Schritte in jede Richtung (drei, oder wählen Sie 1, 2 oder 5): links, woraus sie erstellt wird, rechts die Tabellen und Dashboards, die aus ihr erstellt werden, und die Pipelines, die Daten von außen laden, dort, wo sie hereinkommen. Jede Karte sagt, wie es um sie steht - verspätet, eine offene Warnung, ein fehlgeschlagener Lauf -, und ein Pfeil wird rot, wenn der neueste Lauf seiner Pipeline fehlgeschlagen ist, sodass sich eine verspätete Tabelle bis zu dem Lauf zurückverfolgen lässt, der sie kaputt gemacht hat. Öffnen Sie eine beliebige Tabelle, um das Diagramm auf sie zu zentrieren. Eine Karte zeichnet höchstens zehn Tabellen in jede Richtung und zählt den Rest, etwa **+14**: Wählen Sie die Anzahl, um die nächsten davon dort zu zeichnen, wo sie sind, und **Diagramm zurücksetzen**, um zurückzugehen. Wo die Quellen Spalten nennen, wählen Sie unter **Einer Spalte folgen** eine der Spalten der Tabelle, um hervorzuheben, woher sie kommt und wohin sie geht, selbst wo sie unterwegs umbenannt wird. Dieselbe Datenherkunft steht unter \`POST /api/data-observability/tables/lineage\` bereit, für Ihre eigenen Werkzeuge: Senden Sie \`"withColumns": true\` für die Spalten jedes Pfeils, und fragen Sie \`POST /api/data-observability/lineage/expand\` nach den nächsten Tabellen einer Karte. Die Datenherkunft zeigt nur die Tabellen und Pipelines, die Ihre Rolle lesen darf: Eine, die Sie nicht lesen dürfen, wird nie gezeichnet, auf einem Pfeil genannt oder gezählt.

## dbt

Senden Sie nach \`dbt build\` (oder run, test, seed oder snapshot) die Artefakte des Projekts mit der CLI und einem Telemetrie-Ingestion-Schlüssel. Sie liest \`target/manifest.json\` und \`target/run_results.json\` und sendet nur das, was Data Observability davon liest:

\`\`\`bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
\`\`\`

Führen Sie in der CI \`oneuptime dbt upload\` als den Schritt nach dem Build aus, auch wenn der Build fehlschlägt, damit fehlgeschlagene Tests festgehalten werden. Laden Sie bei einem dbt-Cloud-Job seine Artefakte mit der API von dbt Cloud herunter und laden Sie sie dann mit \`--manifest\` und \`--run-results\` hoch. Oder senden Sie sie selbst: \`POST /telemetry/dbt/v1/artifacts\` mit \`{ "manifest": ..., "run_results": ... }\` und dem Schlüssel in \`x-oneuptime-token\`.

Was jeder Upload bewirkt:
- **Tabellen:** Jedes Modell, jeder Seed, jeder Snapshot und jede Quelle, die eine von OneUptime überwachte Tabelle ist, bekommt in ihrer Übersicht eine Karte **dbt**: den Knoten, seine Materialisierung, Eigentümer, Tags und den letzten Build. Ihre dbt-Beschreibung füllt die Beschreibung der Tabelle, wenn diese leer ist. Eine Tabelle wird über ihre Datenbank, ihr Schema und ihren Namen zugeordnet, für PostgreSQL, MySQL, SQL Server, Redshift, Snowflake, BigQuery, ClickHouse und Databricks. dbt kennt den Host nicht, daher bleiben die Tabellen zweier überwachter Datenbanken mit gleichem Namen nicht zugeordnet, es sei denn, nur eine von ihnen enthält die Tabelle.
- **Datenherkunft:** Woraus jedes Modell erstellt wird, wird zur Datenherkunft im Tab **Datenherkunft** der Tabelle, über die Pipeline des Projekts.
- **Tests:** Jeder Test einer überwachten Tabelle erscheint in ihrem Tab **Prüfungen**, mit seinem letzten Ergebnis und den Zeilen, die er als fehlerhaft fand. Klicken Sie auf **Bei Fehlern warnen**, damit ein fehlschlagender Test eine Warnung öffnet.
- **Builds:** Jeder Build ist ein Lauf der Pipeline des Projekts unter **Pipelines** (Namespace \`dbt\`). Ein Build mit einem Fehler oder einem fehlgeschlagenen Test ist ein fehlgeschlagener Lauf, sodass die Pipeline-Warnungen auch bei dbt-Builds funktionieren: fehlgeschlagen, ungewöhnlich lang und verspätet.

## Ungenutzte Tabellen

Jede Engine zählt die Lesevorgänge jeder Tabelle in ihren eigenen Statistiken:
- PostgreSQL: ihre Scans.
- MySQL: die Lesevorgänge von performance_schema.
- SQL Server: ihre Seeks, Scans und Lookups, mit dem Zeitpunkt des letzten.

Jede Erfassung vergleicht den Zähler mit dem zuletzt gespeicherten, sodass der Wert **Zuletzt gelesen** einer Tabelle auf die Stunde genau bekannt ist, ebenso der Zeitpunkt, seit dem sie keinen hatte. Ein Zähler von 0 bei der ersten Erfassung einer Tabelle bedeutet, dass sie nicht gelesen wurde, seit die Statistiken der Engine begonnen haben, sodass eine ungenutzte Tabelle von Anfang an als ungenutzt erscheint, nicht erst nach Monaten der Überwachung. Ein Lesevorgang, der in den Datenbank-Spans eines Dienstes gesehen wird, zählt ebenfalls.

**Ungenutzte Tabellen** listet die Tabellen auf, die seit 90 Tagen niemand gelesen hat, die größten zuerst, mit dem Zeitpunkt, an dem in jede zuletzt geschrieben wurde: Eine Tabelle, in die noch geschrieben, die aber nie gelesen wird, kostet ihre Schreibvorgänge und ihren Speicher. Die Übersicht zeigt, wie viele es gibt und was sie enthalten. Sichten führen keine eigenen Zähler, daher werden sie nie aufgelistet. Wenn das Datenbank-Login die Zähler nicht lesen kann, ist der letzte Lesevorgang einer Tabelle nicht bekannt.

## Warehouse-Ausgaben

Einmal pro Stunde, mit der Erfassung jedes Warehouses, liest OneUptime, was Snowflake und BigQuery am letzten Tag ausgegeben haben, Job für Job: die Compute-Credits von Snowflake aus \`QUERY_ATTRIBUTION_HISTORY\` (mit \`IMPORTED PRIVILEGES\` auf der Datenbank \`SNOWFLAKE\`, ausgeführt auf dem Warehouse der Verbindung) und die abgerechneten Bytes von BigQuery aus seiner Jobs-Sicht (mit **BigQuery Resource Viewer**). Ein Job ist eine immer wieder ausgeführte Abfrage - die parametrisierte Abfrage von Snowflake, die Abfrage von BigQuery ohne ihre Literale -, benannt nach ihrem Query-Tag oder Label oder danach, was sie tut und welche Tabelle sie schreibt, und nie nach dem Text ihrer Abfrage.

**Warehouse-Ausgaben** zeigt die Credits und abgerechneten Bytes des Tages, nach Team (das \`team\` im Query-Tag oder Label eines Jobs, sonst wer ihn ausführt), die Tabellen, deren Schreibvorgänge am meisten kosten (die Ausgaben eines Jobs aufgeteilt auf die Tabellen, die er schreibt, wo ACCESS_HISTORY von Snowflake oder die Zieltabelle von BigQuery sagt, welche), die fehlgeschlagenen Jobs und was auf Jobs entfällt, die nur Tabellen schreiben, die seit 90 Tagen niemand gelesen hat.

## Eine Meldung pro Ursache

Wenn eine Tabelle veraltet, veraltet auch jede Tabelle, die aus ihr erstellt wird. Bevor sich eine Datenwarnung öffnet, sucht OneUptime in der Datenherkunft nach einer bereits offenen Warnung für das, woraus ihre Tabelle oder Pipeline erstellt wird: die vorgelagerten Tabellen, die Pipelines, die in sie schreiben, und die Datenbanken, in denen sie liegen, bis zu fünf Schritte nach oben. Findet es eine, ist die neue Warnung die Folge dieser Warnung:
- Sie beginnt **bestätigt**, sodass niemand für ein Problem zweimal alarmiert wird. Sie erholt sich von selbst, sobald ihre Daten es tun.
- Ihr Feed sagt, welche Warnung sie verursacht hat, und ihre Karte **Daten** ebenso.
- Sie schließt sich der Episode der Ursache an, wenn die Ursache in einer ist.

Die Karte **Daten** der Ursache listet ihre **Auswirkung auf nachgelagerte Daten** auf: jede Warnung, die sie verursacht hat. Die Karte einer Tabellenwarnung zeigt außerdem die Dienste, die in die Tabelle schreiben, mit ihren fehlgeschlagenen Schreibvorgängen sowie ihren Deployments und anderen Änderungen am Tag vor der Warnung.

Unter der Karte **Daten** zeichnet die Seite einer Warnung ihre **Datenherkunft**: rund um ihre Tabelle, wie der Tab **Datenherkunft** der Tabelle sie zeichnet, oder rund um ihre Pipeline, wobei der Weg hinauf zu der Warnung, die sie verursacht hat, und hinunter zu jeder Warnung, die sie verursacht hat, hervorgehoben ist, die Ursache mit **Ursache** und jede verursachte Warnung mit **Folge** markiert. Wenn die Ursache bei einer Pipeline liegt, die auf einem Pfeil gezeichnet ist, sagt der Pfeil **Ursache** unter dem Namen der Pipeline. Eine Warnung aus einer Prüfung auf einer Spalte, etwa einer Prüfung Anteil NULL-Werte auf \`customer_id\`, öffnet sich mit dieser verfolgten Spalte neben diesen Wegen, wie im Tab **Datenherkunft** der Tabelle; wählen Sie dort eine andere Spalte der Tabelle, oder leeren Sie die Auswahl, um nur die Wege zu sehen. Wer die Warnung, die sie verursacht hat, nicht sehen darf, bekommt weder die Karte **Daten** noch die Datenherkunft, und eine verursachte Warnung, die er nicht sehen darf, wird weder hervorgehoben noch gezählt. Dieselbe Datenherkunft steht unter \`POST /api/data-observability/alerts/<alert ID>/lineage\` bereit, mit der \`column\`, die die Warnung einer Spaltenprüfung liest, und den Spalten, die jeder Pfeil trägt. Eine verursachte Warnung bei einer Pipeline, die auf einem Pfeil gezeichnet ist, sagt dort ebenso **Folge**, und die Spaltenauswahl bietet zuerst die Spalte der Prüfung an, dann die übrigen Spalten der Tabelle in deren eigener Reihenfolge.


## OneUptime AI

- **Untersuchungen von Datenwarnungen.** Wenn OneUptime AI eine Warnung zu einer Tabelle, einer Pipeline oder einer Datenbank untersucht, liest es, was daneben liegt: die Aktualität der Tabelle und ihre offenen Warnungen, die Warnung, deren Folge sie ist, die Läufe der Pipelines, die seit dem Vortag in sie schreiben (ein fehlgeschlagener Lauf mit seinem Fehler), die Dienste, die in sie schreiben, mit ihren fehlgeschlagenen Schreibvorgängen und ihren Deployments und anderen Änderungen, und ihre Datenherkunft: die Tabellen, aus denen sie erstellt wird, und die Tabellen, die aus ihr erstellt werden, die mit einem Problem zuerst, mit dem Ort, an dem die Warnung liegt, deren Folge sie ist, und auf welchen Tabellen die Warnungen liegen, die sie verursacht hat. Bei einer Warnung aus einer Prüfung auf einer Spalte verfolgt es diese Spalte auch durch die Datenherkunft: die Spalten, aus denen sie weiter oben erstellt wird, und die Spalten, die weiter unten aus ihr erstellt werden, Tabelle für Tabelle. Es nennt den Lauf, das Deployment oder die vorgelagerte Tabelle hinter der Warnung.
- **Eine Prüfung aus einem Satz.** Im Tab Prüfungen einer Tabelle macht **Prüfung aus einem Satz schreiben** aus einer Regel wie „Bestellungen haben nie einen negativen Gesamtbetrag“ eine Prüfung mit benutzerdefiniertem SQL, die die Zeilen zählt, die gegen sie verstoßen, mit einer Warnung, sobald es welche gibt. Sie lesen die Abfrage, bevor **Prüfung hinzufügen** sie hinzufügt, und sie unterliegt allem, was für jede Prüfung mit benutzerdefiniertem SQL gilt: eine einzige schreibgeschützte Anweisung, ausgeführt in einer schreibgeschützten Transaktion.
- **Ist diese Tabelle aktuell?** Fragen Sie OneUptime AI in KI fragen, Slack oder Microsoft Teams („ist die Tabelle orders aktuell?“). Es antwortet mit der Aktualität der Tabelle nach ihrem eigenen Rhythmus, wann sie sich zuletzt geändert hat, ihren offenen Warnungen, den neuesten Läufen ihrer Schreiber und den Datenprodukten, zu denen sie gehört. KI-Agenten fragen dasselbe über das Werkzeug \`get_data_table_freshness\` des MCP-Servers, bevor sie die Daten verwenden.
- **Woraus wird diese Tabelle erstellt?** Fragen Sie auf dieselbe Weise („was speist die Tabelle revenue?“, „was geht kaputt, wenn raw.orders nicht mehr lädt?“). Es folgt der Datenherkunft der Tabelle drei Schritte in jede Richtung, oder bis zu fünf, wenn danach gefragt wird, und stellt die vor- und nachgelagerten Tabellen an den Anfang, die verspätet oder gelöscht sind, offene Warnungen haben oder deren Pipeline ihren letzten Lauf nicht bestanden hat, die nächsten zuerst, mit der Anzahl der Schritte bis zu jeder und den Tabellen dazwischen; dann den Rest, die Pipelines, die ihre Quellen von außerhalb dessen laden, was OneUptime überwacht, und die BI-Dashboards, die auf ihr aufbauen. Offene Warnungen werden gezählt, nie benannt, und nur die, die die fragende Person sehen darf. KI-Agenten fragen dasselbe über das Werkzeug \`get_data_table_lineage\` des MCP-Servers, bevor sie eine Tabelle ändern. Die Tabellen jenseits dessen, was sie nennt, zählt sie je einmal, egal neben wie vielen genannten Tabellen sie liegen. Auf der Seite einer Tabelle geöffnet, weiß KI fragen, welche Tabelle „diese Tabelle“ ist, und fragt nach genau dieser, selbst wenn mehrere Datenbanken eine Tabelle dieses Namens haben. Wie jede Ansicht der Datenherkunft nennt sie nur die Tabellen und Pipelines, die die fragende Person lesen darf.

## Dienste, die jede Tabelle nutzen

Der Tab **Dienste** einer Tabelle listet die Dienste auf, die beim Schreiben und Lesen in ihr gesehen wurden, mit den Anweisungen, die jeder ausgeführt hat, seinen Aufrufen und Fehlern in der letzten Stunde und dem Zeitpunkt, an dem er zuletzt gesehen wurde. Das stammt aus den Datenbank-Spans, die Ihre Dienste bereits mit OpenTelemetry senden: ein Client-Span mit \`db.system.name\`, \`db.namespace\` und \`db.collection.name\` (oder \`db.sql.table\`, oder ein Span mit einem Namen wie \`INSERT orders\`). Nichts zusätzlich zu installieren. Es wird alle 15 Minuten aktualisiert.

Jeder Dienst zeigt außerdem die Endpunkte, die seine Aufrufe auslösen, und wird als **KI-App** markiert, wenn er auch ein Modell aufruft. **Fehler, die diese Tabelle nennen** listet die offenen Ausnahmen und die Fehlerlogs des letzten Tages der Dienste auf, die in die Tabelle schreiben, wenn sie sie beim Namen nennen.

Ein Span wird einer Tabelle nur zugeordnet, wenn seine Datenbank diejenige ist, die eine Erfassung gelesen hat, und wenn zwei Datenbanken einen Namen teilen, nur wenn seine \`server.address\` eine der ihren ist. Wenn es nicht sicher ist, lässt es den Span weg.

Diese Metriken sind OneUptimes eigene Betriebsdaten und werden nicht als Telemetrie abgerechnet.
`;

export default DOCUMENTATION;

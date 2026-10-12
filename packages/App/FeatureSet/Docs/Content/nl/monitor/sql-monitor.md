# SQL-query-monitor

De SQL-query-monitor voert volgens een schema vanaf een sonde een alleen-lezen SQL-query uit en waarschuwt op het resultaat: het aantal teruggegeven rijen, een scalaire waarde, hoe lang de query duurde of een queryfout. Hij is gebouwd voor het geval "een query uitvoeren en een incident openen", bijvoorbeeld waarschuwen als het aantal geannuleerde bestellingen in de laatste vijf minuten piekt, als een wachtrijtabel te groot wordt of als een cruciale rij verdwijnt.

:::cards
- [Een alleen-lezen gebruiker maken](#een-alleen-lezen-gebruiker-maken): De databaseaanmelding die de monitor moet gebruiken.
- [De monitor maken](#een-sql-query-monitor-maken): Verbind een sonde en voer de query in.
- [De query schrijven](#de-query-schrijven): Zet de waarde waarop u waarschuwt in de eerste kolom.
- [Criteria instellen](#criteria-instellen): Waarschuw op een aantal, een waarde, een trage query of een fout.
:::

## Zo werkt het

Bij elke controle maakt de sonde verbinding met uw database, voert uw query uit in een alleen-lezen context, leest hoogstens een begrensd aantal rijen terug en meldt OneUptime een compacte projectie. De criteria van uw monitor worden daarna aan die projectie getoetst.

Omdat de query vanaf een sonde binnen uw netwerk draait, heeft OneUptime nooit een directe verbinding met uw database nodig, en verlaat de volledige resultaatset de sonde nooit: alleen een kleine, begrensde projectie van het resultaat wordt teruggemeld.

```mermaid title="Alleen een kleine projectie van het resultaat verlaat uw netwerk"
sequenceDiagram
    participant O as OneUptime
    participant P as Sonde
    participant D as Uw database
    O->>P: Monitorinstellingen, geheimen opgelost
    P->>D: Uw query, alleen-lezen
    D-->>P: Tot Max Rows + 1 rijen
    P->>O: Aantal rijen, scalair, eerste rij, tijd, fout
    O->>O: Criteria toetsen
```

De sonde meldt alleen:

| Waarde | Wat het is |
|---|---|
| **Row Count** | Het aantal rijen dat de query teruggaf (begrensd door de limiet Max Rows). |
| **Scalaire waarde** | De eerste kolom van de eerste rij. Dit is de natuurlijke waarde voor een query in de stijl van `SELECT COUNT(*)`. |
| **First Row** | De eerste rij als paren van kolom en waarde, getoond in de samenvatting van de controle voor context. |
| **Execution Time** | Hoe lang de controle duurde, in milliseconden, inclusief het verbinden en niet alleen de query. |
| **Queryfout** | Een opgeschoonde foutmelding als de query mislukte. |

De volledige resultaatset wordt nooit naar OneUptime gestuurd, dus klantgegevens worden niet naar de opslag van OneUptime gekopieerd.

## Ondersteunde databases

| Database | Standaardpoort |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

MySQL- en PostgreSQL-compatibele engines die hetzelfde wire-protocol en hetzelfde SQL-dialect spreken, werken meestal ook, maar alleen de drie engines hierboven worden officieel getest.

Zijn de host en poort waarmee de monitor verbinding maakt een van de endpoints van een database op de pagina [Databases](/docs/telemetry/databases), dan verschijnen de waarschuwingen en incidenten ervan ook op de pagina van die database (zie [Waarschuwingen voor een database](/docs/telemetry/databases#alerts-on-a-database)). Een host die als verwijzing naar een monitorgeheim is opgegeven, wordt niet gekoppeld.

## Beveiligingsmodel

Een door de klant aangeleverde query uitvoeren op een productiedatabase is gevoelig, daarom is de SQL-query-monitor bewust alleen-lezen en stapelt hij meerdere controles:

| Controle | Wat ze doet |
|---|---|
| **Databasegebruiker met minimale rechten** (belangrijkste controle) | Maak altijd verbinding met een eigen, alleen-lezen databasegebruiker die alleen toegang heeft tot de tabellen die de query nodig heeft. Dit is de belangrijkste controle: zie [Een alleen-lezen gebruiker maken](#een-alleen-lezen-gebruiker-maken). |
| **Alleen-lezen uitvoering** | Op PostgreSQL en MySQL opent de sonde een `READ ONLY`-transactie, die elke schrijfactie (ook schrijvende CTE's) weigert, wat de querytekst ook is. Op Microsoft SQL Server, dat geen alleen-lezen transactie kent, draait de sonde binnen een transactie die altijd wordt teruggedraaid. |
| **Eén instructie, toegestane queries** | De query moet één instructie zijn die begint met `SELECT`, `WITH`, `VALUES` of `TABLE`. Gestapelde instructies (`SELECT 1; DROP TABLE …`) en schrijf- of DDL-sleutelwoorden zoals `INSERT`, `UPDATE`, `DELETE`, `DROP`, `EXEC` en `INTO` weigert de sonde voordat ze verbinding maakt. Deze controle is een vangnet, niet de grens: dat is de alleen-lezen gebruiker. |
| **Time-out van de instructie** | Elke query heeft een harde tijdslimiet. Een query die te lang loopt, wordt geannuleerd. |
| **Begrensde rijen** | Er worden nooit meer dan Max Rows rijen teruggelezen (plus één, om afkappen te herkennen), wat het geheugen van de sonde en de omvang van de gegevens begrenst. |
| **Afscherming van inloggegevens** | Databasefouten worden opgeschoond voordat ze worden opgeslagen: het wachtwoord, de host, gebruikersnaam en databasenaam, en elke verbindingsreeks worden afgeschermd, zodat inloggegevens nooit in foutmeldingen lekken. |

## Voordat u begint

- Een **sonde** met netwerktoegang tot de host en poort van uw database. Dat kan een door OneUptime gehoste sonde zijn (als uw database vanaf internet bereikbaar is) of een [aangepaste sonde](/docs/probe/custom-probe) binnen uw netwerk.
- Een **alleen-lezen databasegebruiker** en de verbindingsgegevens (host, poort, databasenaam, gebruikersnaam, wachtwoord), of een alleen-lezen Windows- of domeinidentiteit bij geïntegreerde verificatie van SQL Server.

## Een alleen-lezen gebruiker maken

Maak altijd verbinding met een eigen alleen-lezen gebruiker. Voer de instructies voor uw engine uit als beheerder en vervang `orders` door uw database:

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

Voor een nauwere toekenning geeft u de gebruiker `SELECT` op alleen de tabellen die uw query leest.

## Een SQL-query-monitor maken

:::steps
### Een nieuwe monitor beginnen

Ga naar **Monitoren** en klik op **Monitor maken**. Klik onder **Monitortype** op **Meer monitortypen** en kies **SQL Query** onder **Database Monitoring**, of typ `query` in het zoekvak. Voer een **Naam** in en klik op **Volgende**.

### De verbindingsgegevens invoeren

Kies het **Database Type** (de poort springt naar de standaard van die engine) en vul dan de host, de databasenaam en de inloggegevens van de alleen-lezen gebruiker in. Verwijs voor het wachtwoord naar een [monitorgeheim](#een-monitorgeheim-voor-het-wachtwoord-gebruiken) in plaats van het in te typen. Elk veld wordt beschreven onder [Configuratie](#configuratie).

### De query invoeren

Typ één alleen-lezen instructie in **SQL Query** (zie [De query schrijven](#de-query-schrijven)).

### Het testen

Klik op **Monitor testen** om de query vóór het opslaan één keer vanaf een sonde uit te voeren.

### De criteria instellen

Kijk de criteria na waarmee de monitor begint en voeg uw eigen toe: zie [Criteria instellen](#criteria-instellen). Klik daarna op **Volgende**.

### Sondes kiezen en maken

Selecteer de **Sondes** die de database bereiken en een **Bewakingsinterval**, en klik op **Monitor maken**.
:::

## Configuratie

| Veld | Wat u invult |
|---|---|
| **Database Type** | PostgreSQL, MySQL of Microsoft SQL Server. Een type kiezen stelt de standaardpoort in. |
| **Host** | De databasehost die de sonde bereikt (bijvoorbeeld `db.internal`). |
| **Poort** | De databasepoort. |
| **Databasenaam** | De database waarop de query wordt uitgevoerd. |
| **Use Windows Integrated Authentication** | Alleen Microsoft SQL Server. Verifiëren met het account waaronder de sonde draait in plaats van met een SQL-gebruikersnaam en -wachtwoord. Zie [Geïntegreerde Windows-verificatie](#geïntegreerde-windows-verificatie). |
| **Gebruikersnaam** | Een alleen-lezen databasegebruiker met minimale rechten. |
| **Wachtwoord** | Het databasewachtwoord. We raden sterk aan met `{{monitorSecrets.name}}` naar een [monitorgeheim](/docs/monitor/monitor-secrets) te verwijzen in plaats van het wachtwoord als platte tekst in te typen (zie [Een monitorgeheim voor het wachtwoord gebruiken](#een-monitorgeheim-voor-het-wachtwoord-gebruiken)). |
| **SQL Query** | De alleen-lezen query die wordt uitgevoerd (zie [De query schrijven](#de-query-schrijven)). |
| **Use SSL/TLS** | Zet dit aan om via TLS verbinding te maken. Staat het aan, dan kunt u **Verify server certificate** uitzetten als de database een zelfondertekend certificaat gebruikt. |

### Meer velden

| Veld | Standaard | Maximum | Wat het begrenst |
|---|---|---|---|
| **Connection Timeout (ms)** | `10000` | `30000` | Hoe lang er op het opzetten van een verbinding wordt gewacht. |
| **Statement Timeout (ms)** | `15000` | `60000` | De harde bovengrens voor hoe lang de query mag lopen. |
| **Max Rows** | `100` | `1000` | De bovengrens van rijen die uit de database worden teruggelezen. |

Een waarde boven het maximum wordt verlaagd tot het maximum.

### Geïntegreerde Windows-verificatie

Zet voor Microsoft SQL Server **Use Windows Integrated Authentication** aan om een vertrouwde verbinding te openen met de identiteit van het sondeproces. De velden Gebruikersnaam en Wachtwoord worden in deze modus genegeerd en niet aan het stuurprogramma doorgegeven. Omdat de sonde een identiteit nodig heeft die uw domein vertrouwt, gebruikt u voor deze verificatiemodus een zelfgehoste sonde.

| De sonde draait op | Wat u instelt |
|---|---|
| **Windows** | De sondeservice laten draaien onder een domeinaccount met een alleen-lezen aanmelding bij SQL Server. |
| **Linux of macOS** | Kerberos instellen voor het SQL Server-domein en het sondeproces een geldig ticket geven (bijvoorbeeld via een keytab). Het officiële Linux-image van de sonde bevat Microsoft ODBC Driver 18, unixODBC en de Kerberos-client. Koppel de Kerberos-configuratie en de ticketcache in de container, maak ze leesbaar voor het sondeproces en stel `KRB5_CONFIG` of `KRB5CCNAME` in als ze niet op de standaardlocatie staan. |

De sonde heeft een Microsoft ODBC Driver for SQL Server nodig op de host waarop ze draait. Het officiële sonde-image bevat **ODBC Driver 18**. Draait u een zelfgehoste of aangepaste sonde, dan detecteert en gebruikt die automatisch de nieuwste `ODBC Driver N for SQL Server` die op de host geregistreerd is (bijvoorbeeld Driver 17 als die geïnstalleerd is): u hebt niet precies Driver 18 nodig. Om een specifiek stuurprogramma vast te leggen, stelt u de omgevingsvariabele `SQL_SERVER_ODBC_DRIVER` van de sonde in op de exacte naam van het stuurprogramma (bijvoorbeeld `ODBC Driver 17 for SQL Server`).

SQL Server moet een passende service principal name `MSSQLSvc` hebben, de klokken van de sonde en de domeincontroller moeten gelijklopen, en de sonde moet SQL Server kunnen opzoeken en bereiken onder de hostnaam die die service principal dekt. Geef de vertrouwde identiteit alleen de databaserechten die de bewakingsquery nodig heeft.

## De query schrijven

De query moet **één alleen-lezen instructie** zijn. Ze moet beginnen met `SELECT`, `WITH`, `VALUES` of `TABLE`. Een puntkomma aan het einde mag; meerdere instructies niet. Schrijf- en DDL-sleutelwoorden worden overal in de query geweigerd, ook `INTO`, dus `SELECT … INTO` wordt ook geweigerd.

De sonde controleert de query bij elke controle, niet bij het opslaan. Een query die deze regels overtreedt, wordt opgeslagen, en daarna mislukt elke controle met "Only read-only queries are allowed (must start with SELECT, WITH, VALUES, or TABLE)."; de standaardcriteria zetten de monitor offline.

Houd queries goedkoop en afgebakend: ze draaien bij elke controle, dus geef de voorkeur aan geïndexeerde kolommen en smalle tijdvensters. Deze query telt de bestellingen die in de laatste vijf minuten zijn geannuleerd:

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
> Bij een query in de stijl van `COUNT(*)` is het aantal beschikbaar als **Row Count** (dat `1` is, omdat er één rij terugkomt) en als **Scalaire waarde** (het aantal zelf, uit de eerste kolom). Om op "hoeveel" te waarschuwen, vergelijkt u met de **Scalaire waarde**.

## Een monitorgeheim voor het wachtwoord gebruiken

Zodat het databasewachtwoord nooit als platte tekst op de monitor wordt opgeslagen, maakt u een [monitorgeheim](/docs/monitor/monitor-secrets) aan en verwijst u ernaar vanuit het veld Wachtwoord:

:::steps
1. Ga naar **Monitoren → Instellingen → Geheimen** en maak een monitorgeheim aan.
2. Geef het een naam (bijvoorbeeld `dbPassword`) en geef deze monitor er toegang toe.
3. Voer in het veld **Wachtwoord** van de monitor `{{monitorSecrets.dbPassword}}` in.
:::

OneUptime lost het geheim op de server op voordat de configuratie aan de sonde wordt overgedragen. OneUptime maakt deze geheimen nooit voor u aan: of u ernaar verwijst, is uw keuze. De velden **Gebruikersnaam**, **Host**, **Databasenaam** en **SQL Query** accepteren ook verwijzingen naar geheimen; **Poort** niet.

## Criteria instellen

Voeg criteria toe om te bepalen wanneer de monitor als online, verminderd of offline geldt. Voor een SQL-query-monitor zijn deze controles beschikbaar:

| Filtertype | Wat het controleert |
|---|---|
| **SQL Is Online** | Of de database bereikbaar was en de query slaagde. |
| **SQL Query Row Count** | Het aantal teruggegeven rijen. Vergelijk met operatoren zoals groter dan, kleiner dan of gelijk aan. |
| **SQL Query Scalar Value** | De eerste kolom van de eerste rij. Als getal vergeleken als de waarde die u invoert een getal is, anders als tekenreeks. Dit is de controle voor queries in de stijl van `COUNT(*)`. |
| **SQL Query Execution Time (in ms)** | Hoe lang de query duurde. Handig om een trage database op te merken. |
| **SQL Query Error** | De foutmelding van de query. Waarschuw als die (niet) leeg is, of overeenkomt met een bepaalde tekenreeks. |
| **JavaScript Expression** | Een eigen JavaScript-expressie evalueren over `rowCount`, `scalarValue`, `firstRow`, `executionTimeInMs`, `queryError` en `isOnline`. Zie [JavaScript-expressies](/docs/monitor/javascript-expression#sql-querymonitoren). |

Numerieke drempels zijn gehele getallen: schrijf `10`, niet `10.5`. SQL Query-filters kunnen niet over een periode worden geëvalueerd; elke controle staat op zichzelf.

Een nieuwe SQL-query-monitor begint met twee criteria: **SQL Is Online** is onwaar (de monitor gaat offline en verklaart een incident dat zichzelf oplost) en **SQL Is Online** is waar, wat hem als online markeert. **Criteria toevoegen** voegt er een onderaan toe; sleep het boven het online-criterium, want criteria worden van boven af gecontroleerd en het eerste dat overeenkomt, beslist.

### Voorbeeld: waarschuwen als annuleringen pieken

Met de query hierboven:

| Criterium | Filter |
|---|---|
| **Verminderd** | `SQL Query Scalar Value` is groter dan `10`. |
| **Offline** | `SQL Query Scalar Value` is groter dan `50`, of `SQL Is Online` is `false`. |

Koppel een on-callbeleid aan het criterium, zodat de juiste mensen worden opgeroepen. Een SQL-query-monitor heeft geen eigen sjabloonvariabelen: de titel van een incident kan de monitor noemen met `{{monitorName}}`, maar kan het resultaat van de query niet citeren.

## Om rekening mee te houden

- De query draait bij elke controle, dus houd hem goedkoop. Gebruik indexen en smalle tijdvensters, en vertrouw op de Statement Timeout als vangnet.
- Alleen het aantal rijen, de eerste cel (scalair) en de eerste rij worden gemeld: ontwerp uw query zo dat de waarde waarop u wilt waarschuwen in de eerste kolom staat.
- Wordt het resultaat afgekapt omdat het Max Rows overschreed, dan toont de samenvatting van de controle **Rows Truncated**: "Yes (result capped)". Verhoog Max Rows alleen als u het nodig hebt; grotere resultaatsets kosten meer geheugen op de sonde.
- Schrijfacties en DDL worden altijd geweigerd. Moet u een schrijfpad testen, dan is deze monitor daar niet voor.
- Geef de voorkeur aan een monitorgeheim boven een wachtwoord in platte tekst, zodat de inloggegevens versleuteld opgeslagen blijven.
- Een controle waarvan de query mislukt, wordt een seconde later opnieuw geprobeerd, tot nog drie keer, voordat de fout wordt gemeld, zodat een korte verbindingsonderbreking de monitor niet offline zet. Op een zelfgehoste sonde bepaalt `PROBE_MONITOR_RETRY_LIMIT` hoe vaak.

## Probleemoplossing

:::details Elke controle mislukt met "Only read-only queries are allowed"
De query begint niet met `SELECT`, `WITH`, `VALUES` of `TABLE`. Een opmerking ervoor mag; een `SET` of een `DECLARE` niet. Herschrijf hem als één alleen-lezen instructie.
:::

:::details Een controle mislukt met "Disallowed SQL keyword"
Ergens in de query staat een schrijf-, DDL- of uitvoeringssleutelwoord, zelfs binnen een `SELECT`, zoals `INTO` of `EXEC`. Woorden tussen aanhalingstekens en in opmerkingen tellen niet mee. Haal het sleutelwoord weg, of zet de logica in een view die de alleen-lezen gebruiker mag lezen.
:::

:::details De controle loopt in een time-out
De sonde kon geen verbinding maken binnen de **Connection Timeout (ms)**, of de query liep langer dan de **Statement Timeout (ms)**. Controleer of de sonde de host en poort bereikt, en maak de query daarna goedkoper: filter op geïndexeerde kolommen over een kort tijdvenster.
:::

:::details De verbinding mislukt met een certificaatfout
Het certificaat van de database is zelfondertekend, of de sonde vertrouwt het niet. Zet **Verify server certificate** uit (dat verschijnt zodra **Use SSL/TLS** aanstaat), of geef de database een certificaat dat de sonde vertrouwt.
:::

:::details Geïntegreerde Windows-verificatie mislukt
De sonde heeft een Microsoft ODBC Driver for SQL Server nodig en een identiteit die uw domein vertrouwt. Gebruik het officiële sonde-image, of installeer het stuurprogramma, en controleer dan de inrichting onder [Geïntegreerde Windows-verificatie](#geïntegreerde-windows-verificatie).
:::

## Volgende stappen

:::cards
- [Databasegezondheid-monitor](/docs/monitor/database-health-monitor): Verbindingen, vergrendelingen en replicatie bewaken zonder SQL te schrijven.
- [Monitor-geheimen](/docs/monitor/monitor-secrets): Het databasewachtwoord versleuteld bewaren.
- [JavaScript-expressies](/docs/monitor/javascript-expression): Criteria schrijven die meerdere waarden combineren.
- [Aangepaste probes](/docs/probe/custom-probe): Controles vanuit uw eigen netwerk uitvoeren.
:::

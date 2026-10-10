# Databasegezondheid-monitor

De Database Health-monitor maakt volgens een schema verbinding met PostgreSQL, MySQL of Microsoft SQL Server en rapporteert de gezondheidssignalen van de server zelf — ruimte voor verbindingen, geblokkeerde sessies, replicatievertraging, cache-hitratio, databasegrootte, transactie-ID-wraparound en nog zo'n dertig andere — zodat je erop kunt alarmeren zoals je alarmeert op een website die plat ligt.

Je schrijft geen SQL. De sonde voert een vaste set alleen-lezen catalogusquery's uit, gekozen per engine, en rapporteert een kleine set getallen met een naam.

:::cards
- [Een monitoringgebruiker maken](#een-monitoringgebruiker-maken): De rechten die elke engine nodig heeft. Dit is de stap waar het het meest om gaat.
- [De monitor maken](#een-database-health-monitor-maken): Een sonde op de database richten en kiezen wat er wordt verzameld.
- [Verzamelde metrics](#verzamelde-metrics): Elke reeks, met de engines die hem rapporteren.
- [Criteria instellen](#criteria-instellen): Alarmeren op verbindingen, blokkades, vertraging en wraparound.
:::

## Database Health of SQL Query?

De twee databasemonitortypen beantwoorden verschillende vragen en zijn bedoeld om samen te gebruiken.

| | Database Health | [SQL Query](/docs/monitor/sql-monitor) |
|---|---|---|
| Vraag die hij beantwoordt | "Is de database zelf gezond?" | "Zijn mijn gegevens wat ik verwacht?" |
| Query | Ingebouwd, per engine, alleen-lezen | Die van jou |
| Rapporteert | Numerieke metrics met een naam (zie [Verzamelde metrics](#verzamelde-metrics)) | Aantal rijen, scalaire waarde, eerste rij, uitvoeringstijd |
| Typisch alarm | Gebruikte verbindingen boven 90% | Meer dan 50 geannuleerde bestellingen in de laatste vijf minuten |
| Benodigde rechten | Leestoegang tot statistieken/DMV's — zie [Een monitoringgebruiker maken](#een-monitoringgebruiker-maken) | `SELECT` op de tabellen die je query raakt |

Wil je alarmeren op een zakelijke voorwaarde, gebruik dan de SQL Query-monitor. Wil je weten dat de server door zijn verbindingen heen raakt voordat de zakelijke voorwaarde ook maar kan mislukken, gebruik dan deze.

## Ondersteunde databases

| Database | Standaardpoort |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

Azure SQL Database en Azure SQL Managed Instance maken verbinding als **Microsoft SQL Server**. Ze hebben andere rechten nodig — zie [Een monitoringgebruiker maken](#een-monitoringgebruiker-maken).

PostgreSQL- en MySQL-compatibele engines die hetzelfde wire-protocol spreken werken meestal, maar kunnen minder statistiekviews bieden; de betreffende metrics worden dan als niet beschikbaar gerapporteerd in plaats van verzameld. Alleen de drie engines hierboven zijn officieel getest.

Elke database die je applicaties, clusters en hosts gebruiken — deze drie engines en nog veel meer — krijgt ook een eigen pagina met de engine-metrics, logs en de services die hem aanroepen: zie [Databases](/docs/telemetry/databases). Als de host en poort waarmee een Database Health-monitor verbinding maakt een van de endpoints van een database zijn, verschijnen de alarmen en incidenten van de monitor ook op de pagina van die database (zie [Alarmen bij een database](/docs/telemetry/databases#alerts-on-a-database)).

## Hoe het werkt

Bij elke controle doet een sonde het volgende:

1. Hij maakt verbinding met de database met de inloggegevens die je instelt.
2. Hij voert één lichte testquery uit. **Dit is de enige statement waarvan het mislukken de monitor offline kan halen.**
3. Hij voert de catalogusquery's van elke ingeschakelde [metricgroep](#metricgroepen) uit, één voor één, elk met een statement-time-out.
4. Hij rapporteert de verzamelde getallen, plus een notitie voor elke groep die hij niet kon verzamelen en waarom.

```mermaid title="Eén controle, en de enige stap die de monitor offline kan halen"
flowchart TB
    connect["Verbinding maken met de database"] --> probe{"Testquery OK?"}
    probe -->|"Nee"| offline["Monitor offline"]
    probe -->|"Ja"| groups["Elke metricgroep uitvoeren"]
    groups --> group{"Groep verzameld?"}
    group -->|"Ja"| metrics["Metrics gerapporteerd"]
    group -->|"Nee"| issue["Metrics ontbreken, probleem genoteerd"]
    metrics --> criteria["Criteria geëvalueerd"]
    issue --> criteria
```

Alleen numerieke aggregaten met een naam worden naar OneUptime gestuurd. Geen querytekst, geen rijen uit je tabellen en geen schemanamen verlaten je netwerk — de query's lezen de eigen statistiekviews van de engine (`pg_stat_activity`, `performance_schema.global_status`, `sys.dm_exec_sessions` en verwante), nooit je gegevens.

Omdat de controle vanaf een sonde draait, hoeft de database alleen vanaf de sonde bereikbaar te zijn. Zet een [aangepaste sonde](/docs/probe/custom-probe) in je netwerk en OneUptime heeft helemaal geen route naar de database nodig.

## Voordat je begint

- Een **sonde** met netwerktoegang tot de host en poort van de database. Gebruik een door OneUptime gehoste sonde als de database vanaf internet bereikbaar is, of anders een [aangepaste sonde](/docs/probe/custom-probe) in je netwerk.
- Een **monitoringgebruiker**, gemaakt zoals beschreven in de volgende sectie, en de verbindingsgegevens ervan.

## Een monitoringgebruiker maken

**Dit is de belangrijkste stap.** De monitor leest statistiekviews die gewone logins niet mogen zien, en een login met te weinig rechten faalt niet altijd met een fout — op PostgreSQL geeft hij een verkeerd antwoord. Maak een aparte login met precies deze rechten en niets anders.

### PostgreSQL

```sql
CREATE USER oneuptime_health WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE mydb TO oneuptime_health;
-- The one grant that matters. Without it, see the note below.
GRANT pg_monitor TO oneuptime_health;
```

`pg_monitor` is een ingebouwde rol (PostgreSQL 10 en later) die leestoegang geeft tot de statistiek- en monitoringviews. Hij geeft geen toegang tot je tabellen.

> [!IMPORTANT]
> **Waarom `pg_monitor` op PostgreSQL niet optioneel is.** Zonder deze rol mislukt `pg_stat_activity` niet — de query slaagt en geeft alleen de eigen rij van de monitoringsessie terug. Het aantal verbindingen zou dan voor altijd op `1` staan, geblokkeerde sessies op `0` en de replicatievertraging op `0`, op een server die in werkelijkheid in brand staat. Daarom controleert de sonde, **voordat** hij die query's uitvoert, of de login lid is van `pg_monitor` (of `pg_read_all_stats`) of een superuser is. Is het geen van deze, dan rapporteert de sonde de groepen Connections, Activity en Locks als niet beschikbaar, samen met de `GRANT` die je nodig hebt. Niets rapporteren is het eerlijke antwoord; `1` rapporteren is dat niet.

Op een beheerde dienst waar `pg_monitor` niet beschikbaar is, dekt `pg_read_all_stats` dezelfde views. Op Amazon RDS is `GRANT rds_superuser` niet nodig — `GRANT pg_monitor TO oneuptime_health;` werkt als lid van `rds_superuser`.

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

Het `performance_schema` van MySQL moet ingeschakeld zijn (`performance_schema = ON`, de standaard sinds 5.6). Staat het uit, dan worden de groepen Connections, Throughput en Locks als niet beschikbaar gerapporteerd, en de oplossing is een herstart van de server, geen recht.

### Microsoft SQL Server en Azure SQL Managed Instance

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

Vanuit elke andere database mislukt `GRANT VIEW SERVER STATE` met Msg 4621, "Permissions at the server scope can only be granted when the current database is master".

> [!WARNING]
> **Leestoegang tot je tabellen is niet genoeg.** Een login die alleen gegevens kan lezen — `db_datareader` of een andere rol met "leestoegang" — kan verbinding maken en krijgt de databasegrootte, verder niets. SQL Server weigert de views die de monitor leest met `The user does not have permission to perform this action.` (Msg 297). Het bericht ervoor noemt wat er geweigerd is: Msg 300 `VIEW SERVER STATE` (`VIEW SERVER PERFORMANCE STATE` op 2022) voor de serverviews, inclusief de ruimte van het transactielogboek en de vrije ruimte van tempdb, of Msg 262 `VIEW DATABASE STATE` (`VIEW DATABASE PERFORMANCE STATE` op 2022) voor de replicatieview. De monitor blijft online, meldt dat de groepen Connections, Activity, Throughput, Locks, Storage en Replication een recht missen, en toont de `GRANT` van hierboven ernaast. `VIEW SERVER STATE` dekt ze allemaal.
>
> Twee views weigeren niet: zonder het recht tonen `sys.dm_exec_sessions` en `sys.dm_exec_requests` stilletjes alleen de eigen sessie van de monitor. De monitor leest ze nooit los, altijd samen met een view die wel weigert, dus een ontbrekend recht kan nooit als "1 verbinding" worden vastgelegd.

### Azure SQL Database

Azure SQL Database heeft geen rechten op serverniveau — `GRANT VIEW SERVER STATE` mislukt daar — dus dezelfde views worden in plaats daarvan geopend door een recht op databaseniveau. Maak een login in `master`, geef hem een gebruiker in de database die je bewaakt, en verleen het recht daar, niet in `master`:

```sql
-- Connected to master, as the server admin:
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';

-- Connected to the monitored database:
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
GRANT VIEW DATABASE STATE TO oneuptime_health;
```

Dat is genoeg voor vCore-databases en voor DTU-databases vanaf S2. Bij **Basic, S0 en S1**, en voor elke database in een **elastische pool**, laat Azure alleen de serverbeheerder, de Microsoft Entra-beheerder of leden van de serverrol `##MS_ServerStateReader##` deze views lezen, wat de rechten van de database ook zeggen. Daar voegt de serverbeheerder de login ook aan die rol toe:

```sql
-- Connected to master, as the server admin:
ALTER SERVER ROLE ##MS_ServerStateReader## ADD MEMBER oneuptime_health;
```

`##MS_ServerStateReader##` werkt op elke servicelaag, dus het is ook de terugvaloptie als `VIEW DATABASE STATE` toch niet genoeg blijkt. Een nieuw rollidmaatschap kan een paar minuten nodig hebben om door te werken en geldt alleen voor nieuwe verbindingen; de sonde opent bij elke controle een nieuwe verbinding.

Een ingesloten databasegebruiker (`CREATE USER oneuptime_health WITH PASSWORD = '...'` in de bewaakte database, zonder login) werkt vanaf S2 met `VIEW DATABASE STATE`, maar kan geen lid worden van `##MS_ServerStateReader##`: serverrollen nemen alleen logins op. Om een ingesloten gebruiker naar de rol te verplaatsen, verwijder je hem (`DROP USER oneuptime_health;`) en volg je de statements hierboven.

De sonde herkent Azure SQL Database aan `SERVERPROPERTY('EngineEdition')` en niet aan de versie — Azure SQL Database rapporteert `12.0.2000.8`, wat er ook echt draait, en dat leest als SQL Server 2014. De **Engine** van de monitor toont daarom `Azure SQL Database 12.0.2000.8`, en een ontbrekend recht wordt getoond als de Azure-statement hierboven, nooit als `VIEW SERVER STATE`.

- **Replicatie wordt op Azure SQL Database niet verzameld.** Azure SQL Database heeft geen `sys.dm_hadr_database_replica_states`, dus de groep Replication wordt daar overgeslagen in plaats van bij elke controle als mislukt gerapporteerd. De eigen replicaviews van Azure (`sys.dm_database_replica_states`, `sys.dm_geo_replication_link_status`) worden nog niet gelezen.
- **Verbindingen gelden per database.** Met `VIEW DATABASE STATE` toont Azure SQL Database alleen de sessies van de bewaakte database, dus Connections telt die database in plaats van de logische server. Bewaak elke database die belangrijk voor je is.
- **In een elastische pool is TempDB Free Space die van de pool.** De databases in een pool delen één tempdb.

## Een Database Health-monitor maken

:::steps
### Een nieuwe monitor beginnen

Ga naar **Monitoren** en klik op **Monitor maken**. Klik onder **Monitortype** op **Meer monitortypen** en kies **Database Health** onder **Database Monitoring**, of typ `health` in het zoekvak. Vul een **Naam** in en klik op **Volgende**.

### De verbindingsgegevens invullen

Kies het **Database Type** en vul dan de host, de poort, de databasenaam en de inloggegevens van de monitoringgebruiker in. Verwijs naar het wachtwoord als [monitorgeheim](#een-monitorgeheim-gebruiken-voor-het-wachtwoord) in plaats van het in te typen. Elk veld wordt beschreven onder [Configuratie](#configuratie).

### Kiezen wat er wordt verzameld

Laat elke groep onder **Metric Groups** aan staan, tenzij je een reden hebt om er een uit te zetten — zie [Metricgroepen](#metricgroepen).

### De verbinding testen

Klik op **Monitor testen** om vóór het opslaan één controle uit te voeren, en lees wat die heeft verzameld.

### De criteria vastleggen

Bekijk de criteria waarmee de monitor begint en voeg je eigen criteria toe — zie [Criteria instellen](#criteria-instellen). Klik dan op **Volgende**.

### Sondes kiezen en maken

Selecteer de **Sondes** die de database kunnen bereiken en een **Bewakingsinterval**, en klik dan op **Monitor maken**.
:::

## Configuratie

| Veld | Wat je invult |
|---|---|
| **Database Type** | PostgreSQL, MySQL of Microsoft SQL Server. Een type kiezen stelt de standaardpoort in en bepaalt welke query's draaien. |
| **Host** | De databasehost die vanaf de sonde bereikbaar is (bijvoorbeeld `db.internal`). |
| **Poort** | De poort van de database. |
| **Databasenaam** | De database waarmee verbinding wordt gemaakt. Metrics op databaseniveau (grootte, cache-hitratio, uitwijken naar tijdelijke bestanden) worden voor deze database gerapporteerd; metrics op serverniveau (verbindingen, uptime, replicatie) voor de hele server — behalve op Azure SQL Database, waar verbindingen alleen voor de bewaakte database worden geteld. |
| **Use Windows Integrated Authentication** | Alleen Microsoft SQL Server. Verifiëren met de identiteit van het sondeproces in plaats van een gebruikersnaam en wachtwoord. Zie [Geïntegreerde Windows-verificatie](/docs/monitor/sql-monitor) op de pagina van de SQL Query-monitor — de inrichting is identiek. |
| **Gebruikersnaam** | De monitoringgebruiker. Verplicht, tenzij je geïntegreerde Windows-verificatie gebruikt. |
| **Wachtwoord** | Het wachtwoord. Verwijs met `{{monitorSecrets.name}}` naar een [monitorgeheim](/docs/monitor/monitor-secrets) in plaats van het als platte tekst in te typen (zie [Een monitorgeheim gebruiken](#een-monitorgeheim-gebruiken-voor-het-wachtwoord)). |
| **Use SSL/TLS** | Verbinding maken via TLS. Als dit aan staat, kun je **Verify server certificate** uitzetten voor een zelfondertekend certificaat. |
| **Metric Groups** | Welke groepen draaien: Connections, Activiteit, Throughput, Locks and Blocking, Opslag, Replication en Onderhoud. Standaard staan ze allemaal aan; zie [Metricgroepen](#metricgroepen). De details van de monitor tonen ze als **Collected Metric Groups**. |

### Meer velden

| Veld | Standaard | Maximum | Wat het begrenst |
|---|---|---|---|
| **Connection Timeout (ms)** | `10000` | `30000` | Hoe lang er wordt gewacht om een verbinding op te bouwen. |
| **Statement Timeout (ms)** | `10000` | `60000` | De bovengrens voor elke afzonderlijke catalogusquery. |

De standaard statement-time-out is bewust krapper dan die van de SQL Query-monitor: deze query's antwoorden op een gezonde server binnen milliseconden, dus als `pg_stat_activity` tien seconden duurt, is het nuttige signaal "deze server zit in de problemen", niet langer wachten. Een waarde boven het maximum wordt naar het maximum verlaagd.

## Een monitorgeheim gebruiken voor het wachtwoord

Zo wordt het wachtwoord nooit als platte tekst op de monitor opgeslagen:

:::steps
1. Ga naar **Monitoren → Instellingen → Geheimen** en maak een [monitorgeheim](/docs/monitor/monitor-secrets).
2. Geef het een naam (bijvoorbeeld `dbPassword`) en geef deze monitor er toegang toe.
3. Vul in het veld **Wachtwoord** van de monitor `{{monitorSecrets.dbPassword}}` in.
:::

Het geheim wordt aan de serverkant opgelost voordat de configuratie aan een sonde wordt doorgegeven. De velden Host, Gebruikersnaam en Databasenaam accepteren dezelfde verwijzing. Inloggegevens worden nooit naar logs, monitorfeeds of alarmsjablonen geschreven.

## Metricgroepen

Een groep is één eenheid die je aan- of uitzet, en de eenheid waarvoor een ontbrekend recht wordt gemeld. Groepen bestaan zodat een ontbrekend recht je één groep kost in plaats van de hele monitor. De statements van een groep draaien één voor één, dus een groep kan gedeeltelijk verzameld zijn: hij staat dan zowel in `collectedGroups` als in `unavailableGroups`. Het gebruikelijke geval is de groep Storage van SQL Server voor een login zonder `VIEW SERVER STATE` — de databasegrootte wordt verzameld, de logruimte en de vrije ruimte van tempdb niet.

| Groep | Wat hij verzamelt | Vereist |
|---|---|---|
| Connections | Aantallen verbindingen, het ingestelde plafond, afgebroken verbindingen, uptime van de server | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Activity | Langst lopende query, langst openstaande transactie, open transacties | PostgreSQL: `pg_monitor`. MySQL: `PROCESS`. SQL Server: `VIEW SERVER STATE` |
| Throughput | Transacties, query's, cache-hitratio, schijflezingen en -schrijfacties, I/O-tijd | PostgreSQL: niets naast `CONNECT`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Locks | Geblokkeerde sessies, lock-wachttijden, deadlocks, wachttijden voor tabellocks | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Storage | Databasegrootte, uitwijken naar tijdelijke bestanden, logruimte, vrije ruimte van tempdb | PostgreSQL: niets naast `CONNECT`. MySQL: `SELECT` op de database. SQL Server: niets voor de databasegrootte; `VIEW SERVER STATE` voor logruimte en vrije ruimte van tempdb |
| Replication | Verbonden replica's, replicatievertraging in seconden en bytes, inactieve slots, herstelstatus | PostgreSQL: `pg_monitor`. MySQL: `REPLICATION CLIENT`. SQL Server: `VIEW SERVER STATE`; niet verzameld op Azure SQL Database |
| Maintenance | Ruimte tot de transactie-ID-wraparound, dode tuples, tabellen die nooit door autovacuum zijn behandeld, checkpoints | PostgreSQL: `pg_monitor` |

Lees op Azure SQL Database `VIEW DATABASE STATE` overal waar deze tabel `VIEW SERVER STATE` zegt — of `##MS_ServerStateReader##` bij Basic, S0, S1 en elastische pools. Zie [Azure SQL Database](#azure-sql-database).

Een groep uitzetten gebeurt stil: geen metrics, geen verzamelprobleem, geen alarm. In twee gevallen is dat de juiste stap:

- **Je krijgt het recht niet.** Door de groep uit te zetten herhaalt het verzamelprobleem zich niet meer bij elke controle.
- **De query's zijn te duur.** Op MySQL is **Opslag** de gebruikelijke kandidaat: de databasegrootte komt uit het optellen van `information_schema.TABLES`, wat bij een schema met tienduizenden tabellen niet gratis is en bij elke controle draait. Zet hem uit, of zet die monitor op een interval van vijf minuten.

Alle groepen uitvinken is geen manier om niets te verzamelen — een lege lijst wordt teruggezet naar alle groepen, zodat een monitor nooit kan worden opgeslagen in een toestand waarin hij stilletjes niets verzamelt.

## Wat er gebeurt als een metric niet kan worden verzameld

**Een ontbrekend recht haalt de monitor nooit offline.** Dit is het belangrijkste gedrag van dit monitortype, en het is de moeite waard om het precies te beschrijven.

| Wat er misgaat | Monitorstatus | Wat je ziet |
|---|---|---|
| **De verbinding**, of de testquery — verkeerde inloggegevens, geweigerde verbinding, TLS-fout, verbindingstime-out | **Offline** | `Database Is Online` is false, en elk incident en elk on-callbeleid dat je eraan hebt gekoppeld wordt geactiveerd. |
| **Een groep** — een ontbrekend recht, een uitgeschakeld `performance_schema`, een statement-time-out | **Blijft online** | De metrics die die groep niet kon lezen **ontbreken**; ze staan niet op nul. Er wordt geen lijn in de grafiek getekend, geen drempel op die reeksen kan overeenkomen en er kan geen incident uit ontstaan. De controle legt één verzamelprobleem vast met de groep, de reden en — als die er is — de exacte `GRANT` om uit te voeren; dit wordt getoond in de samenvatting van de monitor en meegeteld in **Metric Groups Failed**. |
| **De engine kan een metric helemaal niet leveren** — standaard-MySQL heeft geen deadlockteller; SQL Server laat zijn verbindingsplafond standaard onbeperkt, dus een "gebruikt percentage" zou zinloos zijn | **Blijft online** | De metric ontbreekt gewoon. Dit is **geen** verzamelprobleem, telt niet mee in Metric Groups Failed en hoeft niet te worden opgelost. Zie de kolom Engines onder [Verzamelde metrics](#verzamelde-metrics). |

Ontbrekend betekent altijd ontbrekend. Een waarde die niet is gemeten wordt nooit als `0` gerapporteerd, want een grafiek vol verzonnen nullen is erger dan een gat — een gat kun je zien.

> [!TIP]
> Gebruik `Database Collection Error` of een drempel op **Metric Groups Failed** om te alarmeren op verloren zicht. Maak van beide alarmen in plaats van incidenten: een ingetrokken recht is een ticket, geen oproep.

### "The user does not have permission to perform this action"

Dit is het bericht van SQL Server (Msg 297) voor een login die verbinding kan maken maar de statusviews van de server niet kan lezen. Het betekent altijd een ontbrekend recht, nooit een fout in de database. SQL Server stuurt het als tweede, na een bericht dat noemt welk recht geweigerd is, en de monitor toont ze allebei: bijvoorbeeld `VIEW SERVER STATE permission was denied on object 'server', database 'master'. The user does not have permission to perform this action.` Ernaast staat de statement die het oplost voor het platform waarmee de sonde verbinding maakte:

- **SQL Server of Azure SQL Managed Instance** — `GRANT VIEW SERVER STATE TO oneuptime_health;`, uitgevoerd in `master` (de monitor toont hem als `GRANT VIEW SERVER STATE TO [<monitoring_login>]; -- run in master`).
- **Azure SQL Database** — `GRANT VIEW DATABASE STATE TO oneuptime_health;`, uitgevoerd in de bewaakte database; bij Basic, S0, S1 en elastische pools in plaats daarvan lidmaatschap van `##MS_ServerStateReader##`. Zie [Azure SQL Database](#azure-sql-database).

De databasegrootte wordt intussen gewoon verzameld, omdat dat de enige metric van de groep Storage is die elke login kan lezen.

## Verzamelde metrics

Eenenveertig reeksen in acht categorieën. Engines noemt de engines die de reeks echt kunnen leveren; op elke andere engine ontbreekt hij gewoon. Group is de verzamelgroep waartoe de reeks behoort: wat je aan- of uitzet en wat samen uitvalt.

### Beschikbaarheid

| Metric | Reeks | Group | Engines |
|---|---|---|---|
| **Uptime** (s) | `oneuptime.monitor.database.uptime.seconds` | Connections | PostgreSQL, MySQL, SQL Server |
| **Metric Groups Failed** | `oneuptime.monitor.database.metric.groups.failed` | Connections | PostgreSQL, MySQL, SQL Server |

### Verbindingen

| Metric | Reeks | Group | Engines |
|---|---|---|---|
| **Connections** | `oneuptime.monitor.database.connections.total` | Connections | PostgreSQL, MySQL, SQL Server |
| **Active Connections** | `oneuptime.monitor.database.connections.active` | Connections | PostgreSQL, MySQL, SQL Server |
| **Maximum Connections** | `oneuptime.monitor.database.connections.max` | Connections | PostgreSQL, MySQL |
| **Connections Used** (%) | `oneuptime.monitor.database.connections.used.percent` | Connections | PostgreSQL, MySQL |
| **Idle In Transaction** | `oneuptime.monitor.database.connections.idle.in.transaction` | Connections | PostgreSQL |
| **Aborted Connects** | `oneuptime.monitor.database.connections.aborted.total` | Connections | MySQL |

### Doorvoer

| Metric | Reeks | Group | Engines |
|---|---|---|---|
| **Transactions** | `oneuptime.monitor.database.transactions.total` | Throughput | PostgreSQL, SQL Server |
| **Queries** | `oneuptime.monitor.database.queries.total` | Throughput | MySQL, SQL Server |
| **Slow Queries** | `oneuptime.monitor.database.queries.slow.total` | Throughput | MySQL |
| **Rollback Ratio** (%) | `oneuptime.monitor.database.rollback.percent` | Throughput | PostgreSQL |
| **Longest Running Query** (s) | `oneuptime.monitor.database.query.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Longest Open Transaction** (s) | `oneuptime.monitor.database.transaction.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Open Transactions** | `oneuptime.monitor.database.transaction.open.count` | Activity | MySQL |

### Locks en blokkades

| Metric | Reeks | Group | Engines |
|---|---|---|---|
| **Blocked Sessions** | `oneuptime.monitor.database.sessions.blocked` | Locks | PostgreSQL, MySQL, SQL Server |
| **Lock Waits** | `oneuptime.monitor.database.locks.waiting` | Locks | PostgreSQL, MySQL, SQL Server |
| **Deadlocks** | `oneuptime.monitor.database.deadlocks.total` | Locks | PostgreSQL, SQL Server |
| **Table Lock Waits** | `oneuptime.monitor.database.table.locks.waited.total` | Locks | MySQL |

Standaard-MySQL biedt geen enkele deadlockteller, daarom bestaat Deadlocks alleen op PostgreSQL en SQL Server.

### Cache en I/O

| Metric | Reeks | Group | Engines |
|---|---|---|---|
| **Cache Hit Ratio** (%) | `oneuptime.monitor.database.cache.hit.percent` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Reads** | `oneuptime.monitor.database.disk.reads.total` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Writes** | `oneuptime.monitor.database.disk.writes.total` | Throughput | MySQL, SQL Server |
| **I/O Read Time** (ms) | `oneuptime.monitor.database.io.read.time.ms` | Throughput | PostgreSQL, SQL Server |
| **I/O Write Time** (ms) | `oneuptime.monitor.database.io.write.time.ms` | Throughput | PostgreSQL, SQL Server |
| **Page Life Expectancy** (s) | `oneuptime.monitor.database.page.life.expectancy.seconds` | Throughput | SQL Server |
| **Memory Grants Pending** | `oneuptime.monitor.database.memory.grants.pending` | Throughput | SQL Server |

PostgreSQL meet de lees- en schrijftijd van I/O alleen als `track_io_timing` aan staat. Standaard staat het uit, en dan rapporteert PostgreSQL beide als `0` — op PostgreSQL betekent een vlakke nul in die twee reeksen dus meestal "niet gemeten", niet "snel". Dat is een serverinstelling, geen rechtenprobleem.

### Opslagruimte

| Metric | Reeks | Group | Engines |
|---|---|---|---|
| **Database Size** (bytes) | `oneuptime.monitor.database.size.bytes` | Storage | PostgreSQL, MySQL, SQL Server |
| **Temp Bytes Written** (bytes) | `oneuptime.monitor.database.temp.bytes.total` | Storage | PostgreSQL |
| **Temp Disk Tables** | `oneuptime.monitor.database.temp.disk.tables.total` | Storage | MySQL |
| **Log Space Used** (%) | `oneuptime.monitor.database.log.space.used.percent` | Storage | SQL Server |
| **TempDB Free Space** (bytes) | `oneuptime.monitor.database.tempdb.free.bytes` | Storage | SQL Server |

### Replicatie

| Metric | Reeks | Group | Engines |
|---|---|---|---|
| **Connected Replicas** | `oneuptime.monitor.database.replica.count` | Replication | PostgreSQL, SQL Server |
| **Replication Lag** (s) | `oneuptime.monitor.database.replication.lag.seconds` | Replication | PostgreSQL, MySQL |
| **Replication Lag (Bytes)** (bytes) | `oneuptime.monitor.database.replication.lag.bytes` | Replication | PostgreSQL, SQL Server |
| **Is In Recovery** | `oneuptime.monitor.database.is.in.recovery` | Replication | PostgreSQL |
| **Inactive Replication Slots** | `oneuptime.monitor.database.replication.slots.inactive` | Replication | PostgreSQL |

Replicatiemetrics worden gerapporteerd vanaf de kant van de koppeling waarmee de monitor verbonden is. Richt een monitor op de primaire server om verbonden replica's en de verzendwachtrij te zien; richt er een op elke standby om te zien hoe ver die standby echt achterloopt.

De vertraging in seconden staat op een inactieve primaire server op nul, ook als een replica ver achterloopt, omdat er niets nieuws is geschreven. **Replication Lag (Bytes)** heeft die blinde vlek niet, dus alarmeer op allebei.

### Onderhoud

| Metric | Reeks | Group | Engines |
|---|---|---|---|
| **Transaction ID Used** (%) | `oneuptime.monitor.database.transaction.id.used.percent` | Maintenance | PostgreSQL |
| **Dead Tuples** | `oneuptime.monitor.database.dead.tuples` | Maintenance | PostgreSQL |
| **Tables Never Autovacuumed** | `oneuptime.monitor.database.tables.never.autovacuumed` | Maintenance | PostgreSQL |
| **Requested Checkpoints** | `oneuptime.monitor.database.checkpoints.requested.total` | Maintenance | PostgreSQL |
| **Timed Checkpoints** | `oneuptime.monitor.database.checkpoints.timed.total` | Maintenance | PostgreSQL |

> [!IMPORTANT]
> **Transaction ID Used** verdient een criterium op elke PostgreSQL-monitor die je maakt. PostgreSQL weigert alle schrijfacties zodra de waarde 100% bereikt, herstel betekent een vacuum in single-usermodus met de database plat, en bijna niemand houdt het in de gaten. Alarmeer ruim voor de afgrond — 80% laat bij de meeste workloads dagen speling.

Tellers die op `total` eindigen zijn cumulatief sinds de server is gestart. Vergelijk twee momenten om een snelheid te krijgen; één losse waarde zegt alleen iets ten opzichte van de eigen geschiedenis, en hij valt terug naar nul als de server herstart (wat **Uptime** je laat zien).

## Criteria instellen

| Filtertype | Wat het controleert |
|---|---|
| **Database Is Online** | Of de database bereikbaar was en de testquery slaagde. Dit is het offline-criterium waarmee de monitor wordt gemaakt, en de enige controle die de bereikbaarheid weergeeft. |
| **Database Metric** | Kies een metric en vergelijk hem: Greater Than, Less Than, Greater Than Or Equal To, Less Than Or Equal To, Equal To of Not Equal To. De metrickiezer biedt alleen de metrics aan die je gekozen engine kan leveren, dus je kunt geen criterium bouwen dat voorgoed onvervuld blijft (één uitzondering: de Replication-metrics die voor Microsoft SQL Server worden aangeboden, worden op Azure SQL Database nooit verzameld). Als de metric bij een controle niet is verzameld — de groep mislukte of de engine rapporteert hem niet — komt het filter niet overeen, en ook niet als "false": het wordt overgeslagen. Een rechtenprobleem kan niemand oproepen. |
| **Database Collection Error** | De samenvatting van de verzamelproblemen van de controle, één "groep: bericht" per niet-beschikbare groep. Alarmeer als die niet leeg is om verloren zicht op te merken, of gebruik Contains om op één specifieke groep te letten. |
| **JavaScript Expression** | Volledige controle. Zie [JavaScript-expressies](/docs/monitor/javascript-expression). |

Drempels zijn gehele getallen. Schrijf `90`, niet `90.5` — percentages en seconden worden als gehele getallen vergeleken.

**Database Is Online** en **Database Metric** kunnen over een periode worden gecontroleerd: vink **Evalueer deze criteria over een bepaalde periode** aan, kies dan onder **Evalueren** hoe de waarden worden beoordeeld (bijvoorbeeld **All Values**) en vul **Voor de laatste (in minuten)** in. Over een periode bepaalt de instelling **Als geen gegevens** van het filter wat een ontbrekende waarde betekent; laat die op **Ignore** staan, zodat een ontbrekend recht nog steeds niemand kan oproepen.

### Variabelen voor JavaScript-expressies

Bij een Database Health-monitor heeft de expressie toegang tot:

| Variabele | Type | Beschrijving |
|---|---|---|
| `isOnline` | boolean | Of de verbinding en de testquery allebei zijn geslaagd |
| `engineVersion` | string | De versietekenreeks die de server rapporteerde (op SQL Server de kale `ProductVersion`; de samenvatting van de monitor noemt het platform ernaast) |
| `connectionError` | string | Opgeschoonde verbindingsfout, leeg als er geen was |
| `collectedGroups` | array | De groepen die bij deze controle waarden opleverden |
| `unavailableGroups` | array | De groepen met een statement die niet kon worden verzameld, elk met een reden en een oplossing. Een gedeeltelijk verzamelde groep staat in beide lijsten |
| `metrics` | object | De verzamelde waarden, met de reeksnaam als sleutel; een reeks die niet is verzameld ontbreekt |

```javascript
{{isOnline}} === true && {{collectedGroups}}.length >= 5
```

Om één metric in een expressie te lezen, indexeer je het hele `metrics`-object — de reeksnamen bevatten punten en kunnen dus niet tussen de accolades:

```javascript
{{metrics}}['oneuptime.monitor.database.connections.used.percent'] > 90
```

Gebruik voor een drempel op één metric liever **Database Metric** dan een expressie: het zoekt de reeks voor je op, biedt alleen aan wat je engine kan leveren, en slaat de controle over als de waarde niet is verzameld in plaats van met niets te vergelijken.

### Voorbeeld: een primaire PostgreSQL-server

| Volgorde | Criteria | Filter |
|---|---|---|
| 1 | **Offline** | `Database Is Online` is `false`. |
| 2 | **Verminderd** | `Database Metric` → Connections Used is groter dan `90`, geëvalueerd over 5 minuten met All Values, zodat één enkele piek niemand oproept. |
| 3 | **Verminderd** | `Database Metric` → Transaction ID Used is groter dan `80`. |
| 4 | **Verminderd** | `Database Metric` → Blocked Sessions is groter dan `0`, over 5 minuten. |
| 5 | **Online** | `Database Is Online` is `true`. |

Criteria worden van boven naar beneden geëvalueerd en de eerste overeenkomst wint, dus zet de alarmerende criteria bovenaan en het gezonde criterium onderaan.

Koppel een on-callbeleid aan het offline-criterium en laat alles wat is afgeleid van **Metric Groups Failed** of `Database Collection Error` een alarm zonder gekoppeld on-callbeleid.

## Waar je rekening mee houdt

- **De query's draaien bij elke controle.** Ze zijn bewust goedkoop, maar "goedkoop" is relatief ten opzichte van het interval. Een interval van één minuut tegen een server met duizenden sessies betekent meer scans van `pg_stat_activity` dan je misschien wilt; vijf minuten is ruim genoeg voor capaciteitsmetrics.
- **Richt de monitor op de database die belangrijk voor je is.** Grootte, cache-hitratio en uitwijken naar tijdelijke bestanden gelden per database. Verbindingen, uptime en replicatie gelden per server en lezen hetzelfde vanuit elke database op die instantie.
- **Eén monitor per instantie, niet per database**, tenzij je specifiek grootte- en cachemetrics per database wilt — anders vermenigvuldig je de query's op serverniveau zonder nieuwe informatie. Azure SQL Database is de uitzondering: het rapporteert verbindingen per database, dus bewaak daar elke database.
- **Alarmeer op snelheden, niet op tellers.** Alles wat op `total` eindigt stijgt alleen maar, dus een drempel "groter dan" erop gaat één keer af en herstelt nooit. Zet het in een grafiek of vergelijk het over een tijdvenster.
- **Kies liever een monitorgeheim dan een wachtwoord als platte tekst.** De inloggegevens blijven dan versleuteld opgeslagen en verschijnen nooit op de monitor.
- **De monitor schrijft nooit.** Elke query is een leesactie op een statistiekview — op PostgreSQL binnen een alleen-lezen transactie, op MySQL in een alleen-lezen sessie. Wat hij niet kan lezen, wordt gemeld als ontbrekende metric, nooit als storing.

## Problemen oplossen

:::details De monitor is offline, maar de database draait
Offline betekent dat de sonde geen verbinding kon maken of dat de testquery mislukte: de host of poort is vanaf de sonde niet bereikbaar, de login werd geweigerd, TLS mislukte of de verbinding liep in een time-out. De samenvatting van de monitor toont de fout. Controleer of de sonde de database kan bereiken (een door OneUptime gehoste sonde heeft een openbaar adres nodig; gebruik anders een [aangepaste sonde](/docs/probe/custom-probe)), controleer de gebruikersnaam en het wachtwoord of het monitorgeheim ervan, en zet **Verify server certificate** uit voor een zelfondertekend certificaat. Klik dan op **Monitor testen** om opnieuw te controleren.
:::

:::details Connections, Activity en Locks ontbreken op PostgreSQL
De login is geen lid van `pg_monitor` of `pg_read_all_stats` en is geen superuser, dus de sonde slaat die groepen over in plaats van verkeerde getallen vast te leggen. Voer `GRANT pg_monitor TO oneuptime_health;` uit zoals beschreven onder [PostgreSQL](#postgresql).
:::

:::details Connections, Throughput en Locks ontbreken op MySQL
Ofwel mist de login `SELECT` op `performance_schema`, ofwel staat `performance_schema` op de server uit; de samenvatting van de monitor toont het bericht van MySQL. Voer bij een ontbrekend recht de statements onder [MySQL](#mysql) uit. Een uitgeschakeld `performance_schema` heeft `performance_schema = ON` in de serverconfiguratie en een herstart nodig.
:::

:::details I/O Read Time en I/O Write Time zijn op PostgreSQL altijd 0
PostgreSQL meet ze alleen als `track_io_timing` aan staat, en standaard staat het uit. Zet het aan in de serverconfiguratie, of in de parametergroep van je beheerde dienst, om echte waarden te zien. Het is geen ontbrekend recht.
:::

:::details Metric Groups Failed staat bij elke controle boven 0
Een groep kan bij geen enkele controle worden verzameld, dus hetzelfde verzamelprobleem herhaalt zich. De samenvatting van de monitor noemt de groep, de reden en de `GRANT` die het oplost. Voer het recht uit, of zet die groep, als je het niet kunt krijgen, uit onder **Metric Groups**, zodat het probleem zich niet meer herhaalt.
:::

## Volgende stappen

:::cards
- [SQL-query-monitor](/docs/monitor/sql-monitor): Alarmeren op het resultaat van je eigen query, naast de gezondheid van de server.
- [Databases](/docs/telemetry/databases): De metrics, logs en aanroepers van elke database op één pagina zien.
- [Monitor-geheimen](/docs/monitor/monitor-secrets): Het wachtwoord van de monitoringgebruiker versleuteld bewaren.
- [Aangepaste probes](/docs/probe/custom-probe): Een database binnen je netwerk bereiken.
:::

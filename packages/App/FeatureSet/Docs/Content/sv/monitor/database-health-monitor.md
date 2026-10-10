# Övervakning av databashälsa

Database Health-monitorn ansluter till PostgreSQL, MySQL eller Microsoft SQL Server enligt ett schema och rapporterar serverns egna hälsosignaler — marginal för anslutningar, blockerade sessioner, replikeringsfördröjning, träffkvot i cachen, databasstorlek, wraparound för transaktions-ID och ett trettiotal till — så att du kan larma på dem på samma sätt som du larmar när en webbplats ligger nere.

Du skriver ingen SQL. Proben kör en fast uppsättning skrivskyddade katalogfrågor, vald efter databasmotor, och rapporterar en liten uppsättning namngivna tal.

:::cards
- [Skapa en övervakningsanvändare](#skapa-en-övervakningsanvändare): Behörigheterna som varje motor behöver. Det här är steget som betyder mest.
- [Skapa monitorn](#skapa-en-database-health-monitor): Rikta en probe mot databasen och välj vad som ska samlas in.
- [Insamlade mätvärden](#insamlade-mätvärden): Varje serie, med motorerna som rapporterar den.
- [Ställ in kriterier](#ställ-in-kriterier): Larma på anslutningar, blockering, fördröjning och wraparound.
:::

## Database Health eller SQL Query?

De två monitortyperna för databaser besvarar olika frågor och är tänkta att användas tillsammans.

| | Database Health | [SQL Query](/docs/monitor/sql-monitor) |
|---|---|---|
| Frågan den besvarar | ”Är själva databasen frisk?” | ”Är mina data som jag förväntar mig?” |
| Fråga | Inbyggd, per motor, skrivskyddad | Din egen |
| Rapporterar | Namngivna numeriska mätvärden (se [Insamlade mätvärden](#insamlade-mätvärden)) | Antal rader, skalärt värde, första raden, körtid |
| Typiskt larm | Använda anslutningar över 90 % | Fler än 50 avbeställda ordrar de senaste fem minuterna |
| Behörigheter som krävs | Läsåtkomst till statistik/DMV:er — se [Skapa en övervakningsanvändare](#skapa-en-övervakningsanvändare) | `SELECT` på tabellerna som din fråga rör |

Vill du larma på ett affärsvillkor använder du SQL Query-monitorn. Vill du veta att servern håller på att få slut på anslutningar innan affärsvillkoret ens hinner fallera använder du den här.

## Databaser som stöds

| Databas | Standardport |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

Azure SQL Database och Azure SQL Managed Instance ansluter som **Microsoft SQL Server**. De kräver andra behörigheter — se [Skapa en övervakningsanvändare](#skapa-en-övervakningsanvändare).

PostgreSQL- och MySQL-kompatibla motorer som talar samma wire-protokoll fungerar oftast, men de kan exponera färre statistikvyer; då rapporteras de berörda mätvärdena som otillgängliga i stället för att samlas in. Bara de tre motorerna ovan är officiellt testade.

Varje databas som dina applikationer, kluster och värdar använder — de här tre motorerna och många fler — får också en egen sida med motorns mätvärden, loggar och tjänsterna som anropar den: se [Databaser](/docs/telemetry/databases). När värden och porten som en Database Health-monitor ansluter till är en av en databas slutpunkter visas monitorns larm och incidenter också på den databasens sida (se [Larm på en databas](/docs/telemetry/databases#alerts-on-a-database)).

## Så fungerar det

Vid varje kontroll gör en probe följande:

1. Den ansluter till databasen med inloggningsuppgifterna som du konfigurerar.
2. Den kör en lätt testfråga. **Det här är den enda satsen vars fel kan ta monitorn offline.**
3. Den kör katalogfrågorna för varje aktiverad [mätvärdesgrupp](#mätvärdesgrupper), en i taget, var och en med en tidsgräns för satsen.
4. Den rapporterar de tal den samlade in, plus en anteckning för varje grupp som den inte kunde samla in, och varför.

```mermaid title="En kontroll, och det enda steget som kan ta monitorn offline"
flowchart TB
    connect["Anslut till databasen"] --> probe{"Testfråga OK?"}
    probe -->|"Nej"| offline["Monitor offline"]
    probe -->|"Ja"| groups["Kör varje mätvärdesgrupp"]
    groups --> group{"Grupp insamlad?"}
    group -->|"Ja"| metrics["Mätvärden rapporterade"]
    group -->|"Nej"| issue["Mätvärden saknas, problem noterat"]
    metrics --> criteria["Kriterier utvärderade"]
    issue --> criteria
```

Bara namngivna numeriska aggregat skickas till OneUptime. Ingen frågetext, inga rader från dina tabeller och inga schemanamn lämnar ditt nätverk — frågorna läser motorns egna statistikvyer (`pg_stat_activity`, `performance_schema.global_status`, `sys.dm_exec_sessions` med flera), aldrig dina data.

Eftersom kontrollen körs från en probe behöver databasen bara vara nåbar från proben. Placera en [anpassad probe](/docs/probe/custom-probe) i ditt nätverk, så behöver OneUptime ingen väg till databasen alls.

## Innan du börjar

- En **probe** med nätverksåtkomst till databasens värd och port. Använd en probe som OneUptime driver om databasen kan nås från internet, och annars en [anpassad probe](/docs/probe/custom-probe) i ditt nätverk.
- En **övervakningsanvändare**, skapad enligt nästa avsnitt, och dess anslutningsuppgifter.

## Skapa en övervakningsanvändare

**Det här är det viktigaste steget.** Monitorn läser statistikvyer som vanliga inloggningar inte får se, och en inloggning med för få behörigheter misslyckas inte alltid med ett fel — på PostgreSQL ger den ett felaktigt svar. Skapa en särskild inloggning med exakt de här behörigheterna och inget annat.

### PostgreSQL

```sql
CREATE USER oneuptime_health WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE mydb TO oneuptime_health;
-- The one grant that matters. Without it, see the note below.
GRANT pg_monitor TO oneuptime_health;
```

`pg_monitor` är en inbyggd roll (PostgreSQL 10 och senare) som ger läsåtkomst till statistik- och övervakningsvyerna. Den ger ingen åtkomst till dina tabeller.

> [!IMPORTANT]
> **Varför `pg_monitor` inte är valfri på PostgreSQL.** Utan den misslyckas inte `pg_stat_activity` — frågan lyckas och returnerar bara övervakningssessionens egen rad. Antalet anslutningar skulle visa `1`, blockerade sessioner `0` och replikeringsfördröjningen `0`, för alltid, på en server som i själva verket brinner. Därför kontrollerar proben, **innan** den kör de frågorna, att inloggningen är medlem i `pg_monitor` (eller `pg_read_all_stats`) eller är superanvändare. Om den inte är något av detta rapporterar proben grupperna Connections, Activity och Locks som otillgängliga, tillsammans med den `GRANT` du behöver. Att inte rapportera något är det ärliga svaret; att rapportera `1` är det inte.

På en hanterad tjänst där `pg_monitor` inte är tillgänglig täcker `pg_read_all_stats` samma vyer. På Amazon RDS behövs inte `GRANT rds_superuser` — `GRANT pg_monitor TO oneuptime_health;` fungerar som medlem i `rds_superuser`.

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

MySQL:s `performance_schema` måste vara påslaget (`performance_schema = ON`, standard sedan 5.6). När det är avstängt rapporteras grupperna Connections, Throughput och Locks som otillgängliga, och lösningen är en omstart av servern, inte en behörighet.

### Microsoft SQL Server och Azure SQL Managed Instance

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

Körd från någon annan databas misslyckas `GRANT VIEW SERVER STATE` med Msg 4621, ”Permissions at the server scope can only be granted when the current database is master”.

> [!WARNING]
> **Läsåtkomst till dina tabeller räcker inte.** En inloggning som bara kan läsa data — `db_datareader` eller någon annan roll med ”läsåtkomst” — kan ansluta och får databasstorleken, men inget annat. SQL Server nekar vyerna som monitorn läser med `The user does not have permission to perform this action.` (Msg 297). Meddelandet före det anger vad som nekades: Msg 300 `VIEW SERVER STATE` (`VIEW SERVER PERFORMANCE STATE` på 2022) för servervyerna, inklusive utrymmet i transaktionsloggen och ledigt utrymme i tempdb, eller Msg 262 `VIEW DATABASE STATE` (`VIEW DATABASE PERFORMANCE STATE` på 2022) för replikeringsvyn. Monitorn förblir online, rapporterar att grupperna Connections, Activity, Throughput, Locks, Storage och Replication saknar en behörighet och visar `GRANT` ovan bredvid dem. `VIEW SERVER STATE` täcker alla.
>
> Två vyer nekar inte: utan behörigheten visar `sys.dm_exec_sessions` och `sys.dm_exec_requests` i tysthet bara monitorns egen session. Monitorn läser dem aldrig ensamma — alltid tillsammans med en vy som nekar — så en saknad behörighet kan aldrig registreras som ”1 anslutning”.

### Azure SQL Database

Azure SQL Database har inga behörigheter på servernivå — `GRANT VIEW SERVER STATE` misslyckas där — så samma vyer öppnas i stället av en behörighet på databasnivå. Skapa en inloggning i `master`, ge den en användare i databasen som du övervakar och tilldela behörigheten där, inte i `master`:

```sql
-- Connected to master, as the server admin:
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';

-- Connected to the monitored database:
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
GRANT VIEW DATABASE STATE TO oneuptime_health;
```

Det räcker på vCore-databaser och på DTU-databaser från S2 och uppåt. På **Basic, S0 och S1**, och för alla databaser i en **elastisk pool**, låter Azure bara serveradministratören, Microsoft Entra-administratören eller medlemmar i serverrollen `##MS_ServerStateReader##` läsa de här vyerna, oavsett vad databasens behörigheter säger. Där lägger serveradministratören också till inloggningen i den rollen:

```sql
-- Connected to master, as the server admin:
ALTER SERVER ROLE ##MS_ServerStateReader## ADD MEMBER oneuptime_health;
```

`##MS_ServerStateReader##` fungerar på alla nivåer, så den är också reservlösningen om `VIEW DATABASE STATE` ändå inte räcker. Ett nytt rollmedlemskap kan ta några minuter att slå igenom och gäller bara nya anslutningar; proben öppnar en ny anslutning vid varje kontroll.

En innesluten databasanvändare (`CREATE USER oneuptime_health WITH PASSWORD = '...'` i den övervakade databasen, utan inloggning) fungerar med `VIEW DATABASE STATE` från S2 och uppåt, men kan inte gå med i `##MS_ServerStateReader##`: serverroller tar bara inloggningar. För att flytta en innesluten användare till rollen tar du bort den (`DROP USER oneuptime_health;`) och följer satserna ovan.

Proben känner igen Azure SQL Database på `SERVERPROPERTY('EngineEdition')` och inte på versionen — Azure SQL Database rapporterar `12.0.2000.8` vad den än faktiskt kör, vilket läses som SQL Server 2014. Därför visar monitorns **Engine** `Azure SQL Database 12.0.2000.8`, och en saknad behörighet visas som Azure-satsen ovan, aldrig som `VIEW SERVER STATE`.

- **Replikering samlas inte in på Azure SQL Database.** Azure SQL Database har ingen `sys.dm_hadr_database_replica_states`, så gruppen Replication hoppas över där i stället för att rapporteras som misslyckad vid varje kontroll. Azures egna replikvyer (`sys.dm_database_replica_states`, `sys.dm_geo_replication_link_status`) läses inte ännu.
- **Anslutningar gäller per databas.** Med `VIEW DATABASE STATE` visar Azure SQL Database bara den övervakade databasens sessioner, så Connections räknar den databasen och inte den logiska servern. Övervaka varje databas som är viktig för dig.
- **I en elastisk pool är TempDB Free Space poolens.** Databaserna i en pool delar en tempdb.

## Skapa en Database Health-monitor

:::steps
### Starta en ny monitor

Gå till **Monitorer** och klicka på **Skapa monitor**. Under **Monitortyp** klickar du på **Fler monitortyper** och väljer **Database Health** under **Database Monitoring**, eller skriver `health` i sökrutan. Ange ett **Namn** och klicka sedan på **Nästa**.

### Ange anslutningsuppgifterna

Välj **Database Type** och fyll sedan i värd, port, databasnamn och övervakningsanvändarens inloggningsuppgifter. Hänvisa till lösenordet som en [monitorhemlighet](#använd-en-monitorhemlighet-för-lösenordet) i stället för att skriva det. Varje fält beskrivs under [Konfiguration](#konfiguration).

### Välj vad som ska samlas in

Låt alla grupper under **Metric Groups** vara påslagna, om du inte har ett skäl att stänga av någon — se [Mätvärdesgrupper](#mätvärdesgrupper).

### Testa anslutningen

Klicka på **Testa monitor** för att köra en kontroll innan du sparar, och läs vad den samlade in.

### Fastställ kriterierna

Gå igenom kriterierna som monitorn börjar med och lägg till dina egna — se [Ställ in kriterier](#ställ-in-kriterier). Klicka sedan på **Nästa**.

### Välj prober och skapa

Välj de **Sonder** som kan nå databasen och ett **Övervakningsintervall**, och klicka sedan på **Skapa monitor**.
:::

## Konfiguration

| Fält | Vad du anger |
|---|---|
| **Database Type** | PostgreSQL, MySQL eller Microsoft SQL Server. Valet av typ sätter standardporten och avgör vilka frågor som körs. |
| **Värd** | Databasvärden som kan nås från proben (till exempel `db.internal`). |
| **Port** | Databasens port. |
| **Databasnamn** | Databasen som det ansluts till. Mätvärden på databasnivå (storlek, träffkvot i cachen, utskrivning till temporära filer) rapporteras för den här databasen; mätvärden på servernivå (anslutningar, drifttid, replikering) för hela servern — utom på Azure SQL Database, där anslutningar bara räknas för den övervakade databasen. |
| **Use Windows Integrated Authentication** | Bara Microsoft SQL Server. Autentisera med probeprocessens identitet i stället för ett användarnamn och lösenord. Se [Integrerad Windows-autentisering](/docs/monitor/sql-monitor) på sidan om SQL Query-monitorn — inställningen är densamma. |
| **Användarnamn** | Övervakningsanvändaren. Krävs, om du inte använder integrerad Windows-autentisering. |
| **Lösenord** | Lösenordet. Hänvisa till en [monitorhemlighet](/docs/monitor/monitor-secrets) med `{{monitorSecrets.name}}` i stället för att skriva det i klartext (se [Använd en monitorhemlighet](#använd-en-monitorhemlighet-för-lösenordet)). |
| **Use SSL/TLS** | Anslut via TLS. När det är påslaget kan du stänga av **Verify server certificate** för ett självsignerat certifikat. |
| **Metric Groups** | Vilka grupper som körs: Connections, Aktivitet, Throughput, Locks and Blocking, Lagring, Replication och Underhåll. Alla är påslagna som standard; se [Mätvärdesgrupper](#mätvärdesgrupper). Monitorns detaljer visar dem som **Collected Metric Groups**. |

### Fler fält

| Fält | Standard | Max | Vad det begränsar |
|---|---|---|---|
| **Connection Timeout (ms)** | `10000` | `30000` | Hur länge det väntas på att upprätta en anslutning. |
| **Statement Timeout (ms)** | `10000` | `60000` | Taket för varje enskild katalogfråga. |

Standardtidsgränsen för satser är medvetet snävare än SQL Query-monitorns: de här frågorna svarar på millisekunder på en frisk server, så om `pg_stat_activity` tar tio sekunder är den användbara signalen ”den här servern har problem”, inte längre väntan. Ett värde över max sänks till max.

## Använd en monitorhemlighet för lösenordet

Så sparas lösenordet aldrig i klartext på monitorn:

:::steps
1. Gå till **Monitorer → Inställningar → Hemligheter** och skapa en [monitorhemlighet](/docs/monitor/monitor-secrets).
2. Ge den ett namn (till exempel `dbPassword`) och ge den här monitorn åtkomst till den.
3. Ange `{{monitorSecrets.dbPassword}}` i monitorns fält **Lösenord**.
:::

Hemligheten slås upp på servern innan konfigurationen lämnas över till en probe. Fälten Värd, Användarnamn och Databasnamn accepterar samma hänvisning. Inloggningsuppgifter skrivs aldrig till loggar, monitorflöden eller larmmallar.

## Mätvärdesgrupper

En grupp är en enhet som du slår på eller av, och den enhet som en saknad behörighet rapporteras mot. Grupperna finns för att en saknad behörighet ska kosta dig en grupp i stället för hela monitorn. En grupps satser körs en i taget, så en grupp kan vara delvis insamlad: den står då både i `collectedGroups` och i `unavailableGroups`. Det vanliga fallet är SQL Servers grupp Storage för en inloggning utan `VIEW SERVER STATE` — databasstorleken samlas in, men inte loggutrymmet och ledigt utrymme i tempdb.

| Grupp | Vad den samlar in | Kräver |
|---|---|---|
| Connections | Antal anslutningar, det konfigurerade taket, avbrutna anslutningsförsök, serverns drifttid | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Activity | Längst pågående fråga, längst öppna transaktion, öppna transaktioner | PostgreSQL: `pg_monitor`. MySQL: `PROCESS`. SQL Server: `VIEW SERVER STATE` |
| Throughput | Transaktioner, frågor, träffkvot i cachen, diskläsningar och -skrivningar, I/O-tid | PostgreSQL: inget utöver `CONNECT`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Locks | Blockerade sessioner, låsväntan, deadlocks, väntan på tabellås | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Storage | Databasstorlek, utskrivning till temporära filer, loggutrymme, ledigt utrymme i tempdb | PostgreSQL: inget utöver `CONNECT`. MySQL: `SELECT` på databasen. SQL Server: inget för databasstorleken; `VIEW SERVER STATE` för loggutrymme och ledigt utrymme i tempdb |
| Replication | Anslutna repliker, replikeringsfördröjning i sekunder och byte, inaktiva slots, återställningsläge | PostgreSQL: `pg_monitor`. MySQL: `REPLICATION CLIENT`. SQL Server: `VIEW SERVER STATE`; samlas inte in på Azure SQL Database |
| Maintenance | Marginal till wraparound för transaktions-ID, döda tupler, tabeller som autovacuum aldrig har behandlat, checkpoints | PostgreSQL: `pg_monitor` |

På Azure SQL Database läser du `VIEW DATABASE STATE` där den här tabellen säger `VIEW SERVER STATE` — eller `##MS_ServerStateReader##` på Basic, S0, S1 och elastiska pooler. Se [Azure SQL Database](#azure-sql-database).

Att stänga av en grupp sker i tysthet: inga mätvärden, inget insamlingsproblem, inget larm. Det är rätt drag i två fall:

- **Du kan inte få behörigheten.** När du stänger av gruppen slutar insamlingsproblemet att upprepas vid varje kontroll.
- **Frågorna är för dyra.** På MySQL är **Lagring** den vanliga kandidaten: databasstorleken kommer från en summering av `information_schema.TABLES`, vilket inte är gratis på ett schema med tiotusentals tabeller och körs vid varje kontroll. Stäng av den, eller flytta den monitorn till ett intervall på fem minuter.

Att avmarkera alla grupper är inget sätt att samla in ingenting — en tom lista normaliseras tillbaka till alla grupper, så att en monitor aldrig kan sparas i ett läge där den i tysthet inte samlar in något.

## Vad som händer när ett mätvärde inte kan samlas in

**En saknad behörighet tar aldrig monitorn offline.** Det här är det viktigaste beteendet hos den här monitortypen, och det är värt att beskriva exakt.

| Vad som fallerar | Monitorstatus | Vad du ser |
|---|---|---|
| **Anslutningen** eller testfrågan — fel inloggningsuppgifter, nekad anslutning, TLS-fel, tidsgräns vid anslutning | **Offline** | `Database Is Online` är false, och den incident och jourpolicy som du har kopplat till den utlöses. |
| **En grupp** — en saknad behörighet, ett avstängt `performance_schema`, en tidsgräns för en sats | **Förblir online** | Mätvärdena som gruppen inte kunde läsa **saknas** — de är inte noll. Ingen diagramlinje ritas, ingen tröskel på de serierna kan matcha och ingen incident kan uppstå ur dem. Kontrollen registrerar ett insamlingsproblem som anger gruppen, orsaken och — där en sådan finns — den exakta `GRANT` som ska köras; det visas i monitorns sammanfattning och räknas i **Metric Groups Failed**. |
| **Motorn kan inte leverera ett mätvärde alls** — standard-MySQL har ingen räknare för deadlocks; SQL Server lämnar som standard sitt anslutningstak obegränsat, så en ”använd procent” skulle vara meningslös | **Förblir online** | Mätvärdet saknas helt enkelt. Det är **inte** ett insamlingsproblem, räknas inte i Metric Groups Failed och är inget som ska åtgärdas. Se kolumnen Engines under [Insamlade mätvärden](#insamlade-mätvärden). |

Saknas betyder alltid saknas. Ett värde som inte mättes rapporteras aldrig som `0`, eftersom ett diagram med påhittade nollor är värre än en lucka — en lucka kan du se.

> [!TIP]
> För att larma om förlorad insyn använder du `Database Collection Error` eller en tröskel på **Metric Groups Failed**. Gör båda till larm i stället för incidenter: en återkallad behörighet är ett ärende, inte ett jourlarm.

### "The user does not have permission to perform this action"

Det här är SQL Servers meddelande (Msg 297) för en inloggning som kan ansluta men inte kan läsa serverns tillståndsvyer. Det betyder alltid en saknad behörighet, aldrig ett fel i databasen. SQL Server skickar det som nummer två, efter ett meddelande som anger vilken behörighet som nekades, och monitorn visar båda: till exempel `VIEW SERVER STATE permission was denied on object 'server', database 'master'. The user does not have permission to perform this action.` Bredvid står satsen som åtgärdar det för plattformen som proben anslöt till:

- **SQL Server eller Azure SQL Managed Instance** — `GRANT VIEW SERVER STATE TO oneuptime_health;`, körd i `master` (monitorn visar den som `GRANT VIEW SERVER STATE TO [<monitoring_login>]; -- run in master`).
- **Azure SQL Database** — `GRANT VIEW DATABASE STATE TO oneuptime_health;`, körd i den övervakade databasen; på Basic, S0, S1 och elastiska pooler i stället medlemskap i `##MS_ServerStateReader##`. Se [Azure SQL Database](#azure-sql-database).

Databasstorleken fortsätter att samlas in under tiden, eftersom det är det enda mätvärdet i gruppen Storage som alla inloggningar kan läsa.

## Insamlade mätvärden

Fyrtioen serier i åtta kategorier. Engines anger motorerna som faktiskt kan leverera serien; på alla andra motorer saknas den helt enkelt. Group är insamlingsgruppen som serien hör till — det du slår av och på, och det som fallerar tillsammans.

### Tillgänglighet

| Mätvärde | Serie | Group | Engines |
|---|---|---|---|
| **Uptime** (s) | `oneuptime.monitor.database.uptime.seconds` | Connections | PostgreSQL, MySQL, SQL Server |
| **Metric Groups Failed** | `oneuptime.monitor.database.metric.groups.failed` | Connections | PostgreSQL, MySQL, SQL Server |

### Anslutningar

| Mätvärde | Serie | Group | Engines |
|---|---|---|---|
| **Connections** | `oneuptime.monitor.database.connections.total` | Connections | PostgreSQL, MySQL, SQL Server |
| **Active Connections** | `oneuptime.monitor.database.connections.active` | Connections | PostgreSQL, MySQL, SQL Server |
| **Maximum Connections** | `oneuptime.monitor.database.connections.max` | Connections | PostgreSQL, MySQL |
| **Connections Used** (%) | `oneuptime.monitor.database.connections.used.percent` | Connections | PostgreSQL, MySQL |
| **Idle In Transaction** | `oneuptime.monitor.database.connections.idle.in.transaction` | Connections | PostgreSQL |
| **Aborted Connects** | `oneuptime.monitor.database.connections.aborted.total` | Connections | MySQL |

### Genomströmning

| Mätvärde | Serie | Group | Engines |
|---|---|---|---|
| **Transactions** | `oneuptime.monitor.database.transactions.total` | Throughput | PostgreSQL, SQL Server |
| **Queries** | `oneuptime.monitor.database.queries.total` | Throughput | MySQL, SQL Server |
| **Slow Queries** | `oneuptime.monitor.database.queries.slow.total` | Throughput | MySQL |
| **Rollback Ratio** (%) | `oneuptime.monitor.database.rollback.percent` | Throughput | PostgreSQL |
| **Longest Running Query** (s) | `oneuptime.monitor.database.query.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Longest Open Transaction** (s) | `oneuptime.monitor.database.transaction.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Open Transactions** | `oneuptime.monitor.database.transaction.open.count` | Activity | MySQL |

### Lås och blockering

| Mätvärde | Serie | Group | Engines |
|---|---|---|---|
| **Blocked Sessions** | `oneuptime.monitor.database.sessions.blocked` | Locks | PostgreSQL, MySQL, SQL Server |
| **Lock Waits** | `oneuptime.monitor.database.locks.waiting` | Locks | PostgreSQL, MySQL, SQL Server |
| **Deadlocks** | `oneuptime.monitor.database.deadlocks.total` | Locks | PostgreSQL, SQL Server |
| **Table Lock Waits** | `oneuptime.monitor.database.table.locks.waited.total` | Locks | MySQL |

Standard-MySQL har ingen räknare för deadlocks över huvud taget, och därför finns Deadlocks bara på PostgreSQL och SQL Server.

### Cache och I/O

| Mätvärde | Serie | Group | Engines |
|---|---|---|---|
| **Cache Hit Ratio** (%) | `oneuptime.monitor.database.cache.hit.percent` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Reads** | `oneuptime.monitor.database.disk.reads.total` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Writes** | `oneuptime.monitor.database.disk.writes.total` | Throughput | MySQL, SQL Server |
| **I/O Read Time** (ms) | `oneuptime.monitor.database.io.read.time.ms` | Throughput | PostgreSQL, SQL Server |
| **I/O Write Time** (ms) | `oneuptime.monitor.database.io.write.time.ms` | Throughput | PostgreSQL, SQL Server |
| **Page Life Expectancy** (s) | `oneuptime.monitor.database.page.life.expectancy.seconds` | Throughput | SQL Server |
| **Memory Grants Pending** | `oneuptime.monitor.database.memory.grants.pending` | Throughput | SQL Server |

PostgreSQL mäter bara läs- och skrivtid för I/O när `track_io_timing` är påslaget. Det är avstängt som standard, och då rapporterar PostgreSQL båda som `0` — på PostgreSQL betyder en platt nolla i de två serierna därför oftast ”inte mätt”, inte ”snabbt”. Det är en serverinställning, inte ett behörighetsproblem.

### Lagringsutrymme

| Mätvärde | Serie | Group | Engines |
|---|---|---|---|
| **Database Size** (byte) | `oneuptime.monitor.database.size.bytes` | Storage | PostgreSQL, MySQL, SQL Server |
| **Temp Bytes Written** (byte) | `oneuptime.monitor.database.temp.bytes.total` | Storage | PostgreSQL |
| **Temp Disk Tables** | `oneuptime.monitor.database.temp.disk.tables.total` | Storage | MySQL |
| **Log Space Used** (%) | `oneuptime.monitor.database.log.space.used.percent` | Storage | SQL Server |
| **TempDB Free Space** (byte) | `oneuptime.monitor.database.tempdb.free.bytes` | Storage | SQL Server |

### Replikering

| Mätvärde | Serie | Group | Engines |
|---|---|---|---|
| **Connected Replicas** | `oneuptime.monitor.database.replica.count` | Replication | PostgreSQL, SQL Server |
| **Replication Lag** (s) | `oneuptime.monitor.database.replication.lag.seconds` | Replication | PostgreSQL, MySQL |
| **Replication Lag (Bytes)** (byte) | `oneuptime.monitor.database.replication.lag.bytes` | Replication | PostgreSQL, SQL Server |
| **Is In Recovery** | `oneuptime.monitor.database.is.in.recovery` | Replication | PostgreSQL |
| **Inactive Replication Slots** | `oneuptime.monitor.database.replication.slots.inactive` | Replication | PostgreSQL |

Replikeringsmätvärden rapporteras från den sida av länken som monitorn är ansluten till. Rikta en monitor mot primärservern för att se anslutna repliker och sändkön; rikta en mot varje standby för att se hur långt efter just den standbyn faktiskt ligger.

Fördröjningen i sekunder visar noll på en inaktiv primärserver även när en replik ligger långt efter, eftersom inget nytt har skrivits. **Replication Lag (Bytes)** har inte den döda vinkeln, så larma på båda.

### Underhåll

| Mätvärde | Serie | Group | Engines |
|---|---|---|---|
| **Transaction ID Used** (%) | `oneuptime.monitor.database.transaction.id.used.percent` | Maintenance | PostgreSQL |
| **Dead Tuples** | `oneuptime.monitor.database.dead.tuples` | Maintenance | PostgreSQL |
| **Tables Never Autovacuumed** | `oneuptime.monitor.database.tables.never.autovacuumed` | Maintenance | PostgreSQL |
| **Requested Checkpoints** | `oneuptime.monitor.database.checkpoints.requested.total` | Maintenance | PostgreSQL |
| **Timed Checkpoints** | `oneuptime.monitor.database.checkpoints.timed.total` | Maintenance | PostgreSQL |

> [!IMPORTANT]
> **Transaction ID Used** förtjänar ett kriterium på varje PostgreSQL-monitor som du skapar. PostgreSQL nekar alla skrivningar när värdet når 100 %, återställning innebär en vacuum i enanvändarläge med databasen nere, och nästan ingen håller koll på det. Larma i god tid före stupet — 80 % ger dagar av marginal på de flesta arbetsbelastningar.

Räknare som slutar på `total` är kumulativa sedan servern startade. Jämför två tidpunkter för att få en takt; ett enskilt värde säger bara något i förhållande till sin egen historik, och det nollställs när servern startas om (vilket **Uptime** visar dig).

## Ställ in kriterier

| Filtertyp | Vad den kontrollerar |
|---|---|
| **Database Is Online** | Om databasen gick att nå och testfrågan lyckades. Det här är offline-kriteriet som monitorn skapas med, och den enda kontrollen som speglar nåbarheten. |
| **Database Metric** | Välj ett mätvärde och jämför det: Greater Than, Less Than, Greater Than Or Equal To, Less Than Or Equal To, Equal To eller Not Equal To. Mätvärdesväljaren erbjuder bara de mätvärden som din valda motor kan leverera, så du kan inte bygga ett kriterium som för alltid förblir ouppfyllt (ett undantag: Replication-mätvärdena som erbjuds för Microsoft SQL Server samlas aldrig in på Azure SQL Database). Om mätvärdet inte samlades in vid en kontroll — gruppen misslyckades, eller motorn rapporterar det inte — matchar inte filtret, och det matchar inte heller som ”false”: det hoppas över. Ett behörighetsproblem kan inte larma någon. |
| **Database Collection Error** | Sammanfattningen av kontrollens insamlingsproblem, en ”grupp: meddelande” per otillgänglig grupp. Larma när den inte är tom för att upptäcka förlorad insyn, eller använd Contains för att bevaka en viss grupp. |
| **JavaScript Expression** | Full kontroll. Se [JavaScript-uttryck](/docs/monitor/javascript-expression). |

Trösklar är heltal. Skriv `90`, inte `90.5` — procent och sekunder jämförs som heltal.

**Database Is Online** och **Database Metric** kan kontrolleras över tid: kryssa i **Utvärdera dessa kriterier över en tidsperiod**, välj sedan under **Utvärdera** hur värdena ska bedömas (till exempel **All Values**) och fyll i **Under de senaste (i minuter)**. Över tid avgör filtrets inställning **Om ingen data** vad ett saknat värde betyder; låt den stå på **Ignore**, så att en saknad behörighet fortfarande inte kan larma någon.

### Variabler för JavaScript-uttryck

För en Database Health-monitor har uttrycket åtkomst till:

| Variabel | Typ | Beskrivning |
|---|---|---|
| `isOnline` | boolean | Om både anslutningen och testfrågan lyckades |
| `engineVersion` | string | Versionssträngen som servern rapporterade (på SQL Server den rena `ProductVersion`; monitorns sammanfattning anger plattformen bredvid) |
| `connectionError` | string | Rensat anslutningsfel, tomt när det inte fanns något |
| `collectedGroups` | array | Grupperna som levererade värden vid den här kontrollen |
| `unavailableGroups` | array | Grupperna med en sats som inte kunde samlas in, var och en med en orsak och en åtgärd. En delvis insamlad grupp finns i båda listorna |
| `metrics` | object | De insamlade värdena med serienamnet som nyckel; en serie som inte samlades in saknas |

```javascript
{{isOnline}} === true && {{collectedGroups}}.length >= 5
```

För att läsa ett mätvärde i ett uttryck indexerar du hela `metrics`-objektet — serienamnen innehåller punkter och kan därför inte stå inom klammerparenteserna:

```javascript
{{metrics}}['oneuptime.monitor.database.connections.used.percent'] > 90
```

För en tröskel på ett enda mätvärde är **Database Metric** ett bättre val än ett uttryck: det slår upp serien åt dig, erbjuder bara det som din motor kan leverera och hoppar över kontrollen när värdet inte samlades in, i stället för att jämföra med ingenting.

### Exempel: en primär PostgreSQL-server

| Ordning | Kriterier | Filter |
|---|---|---|
| 1 | **Offline** | `Database Is Online` är `false`. |
| 2 | **Försämrad** | `Database Metric` → Connections Used är större än `90`, utvärderat över 5 minuter med All Values så att en enstaka topp inte larmar någon. |
| 3 | **Försämrad** | `Database Metric` → Transaction ID Used är större än `80`. |
| 4 | **Försämrad** | `Database Metric` → Blocked Sessions är större än `0`, över 5 minuter. |
| 5 | **Online** | `Database Is Online` är `true`. |

Kriterier utvärderas uppifrån och ned och den första träffen vinner, så lägg de larmande kriterierna först och det friska sist.

Koppla en jourpolicy till offline-kriteriet och låt allt som härleds från **Metric Groups Failed** eller `Database Collection Error` vara ett larm utan kopplad jourpolicy.

## Att tänka på

- **Frågorna körs vid varje kontroll.** De är billiga av design, men ”billig” är relativt intervallet. Ett intervall på en minut mot en server med tusentals sessioner innebär fler genomsökningar av `pg_stat_activity` än du kanske vill; fem minuter räcker gott för kapacitetsmätvärden.
- **Rikta monitorn mot den databas som är viktig för dig.** Storlek, träffkvot i cachen och utskrivning till temporära filer gäller per databas. Anslutningar, drifttid och replikering gäller per server och ser likadana ut från alla databaser på den instansen.
- **En monitor per instans, inte per databas**, om du inte specifikt vill ha storleks- och cachemätvärden per databas — annars mångfaldigar du frågorna på servernivå utan ny information. Azure SQL Database är undantaget: den rapporterar anslutningar per databas, så där övervakar du varje databas.
- **Larma på takter, inte på räknare.** Allt som slutar på `total` ökar bara, så en ”större än”-tröskel på det utlöses en gång och återhämtar sig aldrig. Visa det i ett diagram eller jämför det över ett tidsfönster.
- **Välj hellre en monitorhemlighet än ett lösenord i klartext.** Inloggningsuppgifterna förblir då krypterade när de lagras och visas aldrig på monitorn.
- **Monitorn skriver aldrig.** Varje fråga är en läsning från en statistikvy — på PostgreSQL i en skrivskyddad transaktion, på MySQL i en skrivskyddad session. Det som den inte kan läsa rapporteras som ett saknat mätvärde, aldrig som ett avbrott.

## Felsökning

:::details Monitorn är offline, men databasen är igång
Offline betyder att proben inte kunde ansluta eller att testfrågan misslyckades: värden eller porten går inte att nå från proben, inloggningen nekades, TLS misslyckades eller anslutningen nådde sin tidsgräns. Monitorns sammanfattning visar felet. Kontrollera att proben kan nå databasen (en probe som OneUptime driver behöver en offentlig adress; använd annars en [anpassad probe](/docs/probe/custom-probe)), kontrollera användarnamnet och lösenordet eller dess monitorhemlighet, och stäng av **Verify server certificate** för ett självsignerat certifikat. Klicka sedan på **Testa monitor** för att kontrollera igen.
:::

:::details Connections, Activity och Locks saknas på PostgreSQL
Inloggningen är varken medlem i `pg_monitor` eller `pg_read_all_stats` och är inte superanvändare, så proben hoppar över de grupperna i stället för att registrera felaktiga tal. Kör `GRANT pg_monitor TO oneuptime_health;` enligt beskrivningen under [PostgreSQL](#postgresql).
:::

:::details Connections, Throughput och Locks saknas på MySQL
Antingen saknar inloggningen `SELECT` på `performance_schema`, eller så är `performance_schema` avstängt på servern; monitorns sammanfattning visar meddelandet från MySQL. Vid en saknad behörighet kör du satserna under [MySQL](#mysql). Ett avstängt `performance_schema` kräver `performance_schema = ON` i serverns konfiguration och en omstart.
:::

:::details I/O Read Time och I/O Write Time är alltid 0 på PostgreSQL
PostgreSQL mäter dem bara när `track_io_timing` är påslaget, och det är avstängt som standard. Slå på det i serverns konfiguration, eller i parametergruppen för din hanterade tjänst, för att se riktiga värden. Det är ingen saknad behörighet.
:::

:::details Metric Groups Failed ligger över 0 vid varje kontroll
En grupp kan inte samlas in vid någon kontroll, så samma insamlingsproblem upprepas. Monitorns sammanfattning anger gruppen, orsaken och den `GRANT` som åtgärdar det. Kör behörigheten, eller stäng av gruppen under **Metric Groups** om du inte kan få den, så att problemet slutar upprepas.
:::

## Nästa steg

:::cards
- [SQL-frågeövervakning](/docs/monitor/sql-monitor): Larma på resultatet av din egen fråga, bredvid serverns hälsa.
- [Databaser](/docs/telemetry/databases): Se varje databas mätvärden, loggar och anropare på en sida.
- [Övervakningshemligheter](/docs/monitor/monitor-secrets): Håll övervakningsanvändarens lösenord krypterat.
- [Anpassade probes](/docs/probe/custom-probe): Nå en databas inne i ditt nätverk.
:::

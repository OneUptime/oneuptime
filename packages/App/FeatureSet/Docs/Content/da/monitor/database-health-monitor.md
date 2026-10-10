# Databasetilstands-monitor

Database Health-monitoren forbinder til PostgreSQL, MySQL eller Microsoft SQL Server efter en tidsplan og rapporterer serverens egne helbredssignaler — luft i forbindelserne, blokerede sessioner, replikeringsforsinkelse, cache-hitrate, databasestørrelse, transaktions-ID-wraparound og en god snes flere — så du kan sende advarsler på dem, ligesom du sender en advarsel, når et websted er nede.

Du skriver ingen SQL. Proben kører et fast sæt skrivebeskyttede katalogforespørgsler, valgt efter databasemotor, og rapporterer et lille sæt navngivne tal.

:::cards
- [Opret en overvågningsbruger](#opret-en-overvågningsbruger): De rettigheder, hver motor har brug for. Det er det trin, der betyder mest.
- [Opret monitoren](#opret-en-database-health-monitor): Ret en probe mod databasen, og vælg, hvad der skal indsamles.
- [Indsamlede metrikker](#indsamlede-metrikker): Hver serie med de motorer, der rapporterer den.
- [Opsæt kriterier](#opsæt-kriterier): Send advarsler om forbindelser, blokeringer, forsinkelse og wraparound.
:::

## Database Health eller SQL Query?

De to monitortyper til databaser besvarer forskellige spørgsmål og er beregnet til at blive brugt sammen.

| | Database Health | [SQL Query](/docs/monitor/sql-monitor) |
|---|---|---|
| Spørgsmål, den besvarer | "Er selve databasen sund?" | "Er mine data, som jeg forventer?" |
| Forespørgsel | Indbygget, pr. motor, skrivebeskyttet | Din egen |
| Rapporterer | Navngivne numeriske metrikker (se [Indsamlede metrikker](#indsamlede-metrikker)) | Antal rækker, skalarværdi, første række, udførelsestid |
| Typisk advarsel | Brugte forbindelser over 90 % | Mere end 50 annullerede ordrer inden for de seneste fem minutter |
| Nødvendige rettigheder | Læseadgang til statistik/DMV'er — se [Opret en overvågningsbruger](#opret-en-overvågningsbruger) | `SELECT` på de tabeller, din forespørgsel rører |

Hvis du vil sende en advarsel om en forretningsbetingelse, så brug SQL Query-monitoren. Hvis du vil vide, at serveren er ved at løbe tør for forbindelser, før forretningsbetingelsen overhovedet får mulighed for at fejle, så brug denne.

## Understøttede databaser

| Database | Standardport |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

Azure SQL Database og Azure SQL Managed Instance forbinder som **Microsoft SQL Server**. De kræver andre rettigheder — se [Opret en overvågningsbruger](#opret-en-overvågningsbruger).

PostgreSQL- og MySQL-kompatible motorer, der taler den samme wire-protokol, virker som regel, men kan have færre statistikvisninger; så rapporteres de berørte metrikker som utilgængelige i stedet for at blive indsamlet. Kun de tre motorer ovenfor er officielt testet.

Hver database, som dine applikationer, klynger og værter bruger — disse tre motorer og mange flere — får også sin egen side med motorens metrikker, logs og de tjenester, der kalder den: se [Databaser](/docs/telemetry/databases). Når den vært og port, en Database Health-monitor forbinder til, er et af en databases endpoints, vises monitorens advarsler og hændelser også på den databases side (se [Advarsler på en database](/docs/telemetry/databases#alerts-on-a-database)).

## Sådan virker det

Ved hver kontrol gør en probe følgende:

1. Den forbinder til databasen med de loginoplysninger, du angiver.
2. Den kører én let testforespørgsel. **Det er den eneste sætning, hvis fejl kan tage monitoren offline.**
3. Den kører katalogforespørgslerne for hver aktiveret [metrikgruppe](#metrikgrupper), én ad gangen, hver med en timeout for sætningen.
4. Den rapporterer de indsamlede tal plus en note for hver gruppe, den ikke kunne indsamle, og hvorfor.

```mermaid title="Én kontrol, og det eneste trin, der kan tage monitoren offline"
flowchart TB
    connect["Forbind til databasen"] --> probe{"Testforespørgsel OK?"}
    probe -->|"Nej"| offline["Monitor offline"]
    probe -->|"Ja"| groups["Kør hver metrikgruppe"]
    groups --> group{"Gruppe indsamlet?"}
    group -->|"Ja"| metrics["Metrikker rapporteret"]
    group -->|"Nej"| issue["Metrikker mangler, problem noteret"]
    metrics --> criteria["Kriterier evalueret"]
    issue --> criteria
```

Kun navngivne numeriske aggregater sendes til OneUptime. Ingen forespørgselstekst, ingen rækker fra dine tabeller og ingen skemanavne forlader dit netværk — forespørgslerne læser motorens egne statistikvisninger (`pg_stat_activity`, `performance_schema.global_status`, `sys.dm_exec_sessions` og lignende), aldrig dine data.

Fordi kontrollen kører fra en probe, behøver databasen kun at kunne nås fra proben. Placér en [brugerdefineret probe](/docs/probe/custom-probe) i dit netværk, så behøver OneUptime slet ingen rute til databasen.

## Før du begynder

- En **probe** med netværksadgang til databasens vært og port. Brug en probe, som OneUptime hoster, hvis databasen kan nås fra internettet, og ellers en [brugerdefineret probe](/docs/probe/custom-probe) i dit netværk.
- En **overvågningsbruger**, oprettet som beskrevet i næste afsnit, og dens forbindelsesoplysninger.

## Opret en overvågningsbruger

**Det er det vigtigste trin.** Monitoren læser statistikvisninger, som almindelige logins ikke må se, og et login med for få rettigheder fejler ikke altid med en fejl — på PostgreSQL giver det et forkert svar. Opret et dedikeret login med præcis disse rettigheder og intet andet.

### PostgreSQL

```sql
CREATE USER oneuptime_health WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE mydb TO oneuptime_health;
-- The one grant that matters. Without it, see the note below.
GRANT pg_monitor TO oneuptime_health;
```

`pg_monitor` er en indbygget rolle (PostgreSQL 10 og nyere), der giver læseadgang til statistik- og overvågningsvisningerne. Den giver ingen adgang til dine tabeller.

> [!IMPORTANT]
> **Hvorfor `pg_monitor` ikke er valgfri på PostgreSQL.** Uden den fejler `pg_stat_activity` ikke — forespørgslen lykkes og returnerer kun overvågningssessionens egen række. Antallet af forbindelser ville stå på `1`, blokerede sessioner på `0` og replikeringsforsinkelsen på `0`, for evigt, på en server, der i virkeligheden brænder. Derfor kontrollerer proben, **før** den kører de forespørgsler, at loginnet er medlem af `pg_monitor` (eller `pg_read_all_stats`) eller er superbruger. Er det ingen af delene, rapporterer proben grupperne Connections, Activity og Locks som utilgængelige sammen med den `GRANT`, du har brug for. At rapportere ingenting er det ærlige svar; at rapportere `1` er ikke.

På en administreret tjeneste, hvor `pg_monitor` ikke er tilgængelig, dækker `pg_read_all_stats` de samme visninger. På Amazon RDS er `GRANT rds_superuser` ikke nødvendig — `GRANT pg_monitor TO oneuptime_health;` virker som medlem af `rds_superuser`.

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

MySQL's `performance_schema` skal være slået til (`performance_schema = ON`, standard siden 5.6). Når den er slået fra, rapporteres grupperne Connections, Throughput og Locks som utilgængelige, og løsningen er en genstart af serveren, ikke en rettighed.

### Microsoft SQL Server og Azure SQL Managed Instance

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

Kørt fra en hvilken som helst anden database fejler `GRANT VIEW SERVER STATE` med Msg 4621, "Permissions at the server scope can only be granted when the current database is master".

> [!WARNING]
> **Læseadgang til dine tabeller er ikke nok.** Et login, der kun kan læse data — `db_datareader` eller en anden rolle med "læseadgang" — kan forbinde og får databasestørrelsen og intet andet. SQL Server afviser de visninger, monitoren læser, med `The user does not have permission to perform this action.` (Msg 297). Meddelelsen før den nævner, hvad der blev afvist: Msg 300 `VIEW SERVER STATE` (`VIEW SERVER PERFORMANCE STATE` på 2022) for servervisningerne, herunder transaktionslogpladsen og den ledige plads i tempdb, eller Msg 262 `VIEW DATABASE STATE` (`VIEW DATABASE PERFORMANCE STATE` på 2022) for replikeringsvisningen. Monitoren forbliver online, rapporterer, at grupperne Connections, Activity, Throughput, Locks, Storage og Replication mangler en rettighed, og viser den `GRANT`, der står ovenfor, ved siden af. `VIEW SERVER STATE` dækker dem alle.
>
> To visninger afviser ikke: uden rettigheden viser `sys.dm_exec_sessions` og `sys.dm_exec_requests` stille og roligt kun monitorens egen session. Monitoren læser dem aldrig alene — altid sammen med en visning, der afviser — så en manglende rettighed kan aldrig blive registreret som "1 forbindelse".

### Azure SQL Database

Azure SQL Database har ingen rettigheder på serverniveau — `GRANT VIEW SERVER STATE` fejler der — så de samme visninger åbnes i stedet af en rettighed på databaseniveau. Opret et login i `master`, giv det en bruger i den database, du overvåger, og tildel rettigheden der, ikke i `master`:

```sql
-- Connected to master, as the server admin:
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';

-- Connected to the monitored database:
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
GRANT VIEW DATABASE STATE TO oneuptime_health;
```

Det er nok på vCore-databaser og på DTU-databaser fra S2 og op. På **Basic, S0 og S1** og for enhver database i en **elastisk pulje** lader Azure kun serveradministratoren, Microsoft Entra-administratoren eller medlemmer af serverrollen `##MS_ServerStateReader##` læse disse visninger, uanset hvad databasens rettigheder siger. Der tilføjer serveradministratoren også loginnet til den rolle:

```sql
-- Connected to master, as the server admin:
ALTER SERVER ROLE ##MS_ServerStateReader## ADD MEMBER oneuptime_health;
```

`##MS_ServerStateReader##` virker på alle niveauer, så det er også reserveløsningen, hvis `VIEW DATABASE STATE` alligevel ikke er nok. Et nyt rollemedlemskab kan tage et par minutter om at slå igennem og gælder kun nye forbindelser; proben åbner en ny forbindelse ved hver kontrol.

En indesluttet databasebruger (`CREATE USER oneuptime_health WITH PASSWORD = '...'` i den overvågede database, uden login) virker med `VIEW DATABASE STATE` fra S2 og op, men kan ikke blive medlem af `##MS_ServerStateReader##`: serverroller tager kun logins. For at flytte en indesluttet bruger til rollen skal du slette den (`DROP USER oneuptime_health;`) og følge sætningerne ovenfor.

Proben genkender Azure SQL Database på `SERVERPROPERTY('EngineEdition')` og ikke på versionen — Azure SQL Database rapporterer `12.0.2000.8`, uanset hvad den faktisk kører, hvilket læses som SQL Server 2014. Derfor viser monitorens **Engine** `Azure SQL Database 12.0.2000.8`, og en manglende rettighed vises som Azure-sætningen ovenfor, aldrig som `VIEW SERVER STATE`.

- **Replikering indsamles ikke på Azure SQL Database.** Azure SQL Database har ingen `sys.dm_hadr_database_replica_states`, så gruppen Replication springes over der i stedet for at blive rapporteret som fejlet ved hver kontrol. Azures egne replikavisninger (`sys.dm_database_replica_states`, `sys.dm_geo_replication_link_status`) læses endnu ikke.
- **Forbindelser gælder pr. database.** Med `VIEW DATABASE STATE` viser Azure SQL Database kun den overvågede databases sessioner, så Connections tæller den database og ikke den logiske server. Overvåg hver database, du holder øje med.
- **I en elastisk pulje er TempDB Free Space puljens.** Databaserne i en pulje deler én tempdb.

## Opret en Database Health-monitor

:::steps
### Start en ny monitor

Gå til **Monitorer**, og klik på **Opret monitor**. Under **Monitortype** skal du klikke på **Flere monitortyper** og vælge **Database Health** under **Database Monitoring** eller skrive `health` i søgefeltet. Angiv et **Navn**, og klik derefter på **Næste**.

### Angiv forbindelsesoplysningerne

Vælg **Database Type**, og udfyld derefter vært, port, databasenavn og overvågningsbrugerens loginoplysninger. Henvis til adgangskoden som en [monitorhemmelighed](#brug-en-monitorhemmelighed-til-adgangskoden) i stedet for at skrive den. Hvert felt er beskrevet under [Konfiguration](#konfiguration).

### Vælg, hvad der skal indsamles

Lad alle grupper under **Metric Groups** være slået til, medmindre du har en grund til at slå en fra — se [Metrikgrupper](#metrikgrupper).

### Test forbindelsen

Klik på **Test monitor** for at køre én kontrol, før du gemmer, og læs, hvad den indsamlede.

### Fastlæg kriterierne

Gennemgå de kriterier, monitoren starter med, og tilføj dine egne — se [Opsæt kriterier](#opsæt-kriterier). Klik derefter på **Næste**.

### Vælg prober, og opret

Vælg de **Sonder**, der kan nå databasen, og et **Overvågningsinterval**, og klik derefter på **Opret monitor**.
:::

## Konfiguration

| Felt | Hvad du angiver |
|---|---|
| **Database Type** | PostgreSQL, MySQL eller Microsoft SQL Server. Valget af type sætter standardporten og afgør, hvilke forespørgsler der kører. |
| **Vært** | Databaseværten, som proben kan nå (for eksempel `db.internal`). |
| **Port** | Databasens port. |
| **Databasenavn** | Den database, der forbindes til. Metrikker på databaseniveau (størrelse, cache-hitrate, udskrivning til midlertidige filer) rapporteres for denne database; metrikker på serverniveau (forbindelser, oppetid, replikering) for hele serveren — undtagen på Azure SQL Database, hvor forbindelser kun tælles for den overvågede database. |
| **Use Windows Integrated Authentication** | Kun Microsoft SQL Server. Godkend med probeprocessens identitet i stedet for et brugernavn og en adgangskode. Se [Integreret Windows-godkendelse](/docs/monitor/sql-monitor) på siden om SQL Query-monitoren — opsætningen er den samme. |
| **Brugernavn** | Overvågningsbrugeren. Påkrævet, medmindre du bruger integreret Windows-godkendelse. |
| **Adgangskode** | Adgangskoden. Henvis til en [monitorhemmelighed](/docs/monitor/monitor-secrets) med `{{monitorSecrets.name}}` i stedet for at skrive den i klartekst (se [Brug en monitorhemmelighed](#brug-en-monitorhemmelighed-til-adgangskoden)). |
| **Use SSL/TLS** | Forbind over TLS. Når det er slået til, kan du slå **Verify server certificate** fra for et selvsigneret certifikat. |
| **Metric Groups** | Hvilke grupper der kører: Connections, Aktivitet, Throughput, Locks and Blocking, Lagerplads, Replication og Vedligeholdelse. Alle er slået til som standard; se [Metrikgrupper](#metrikgrupper). Monitorens detaljer viser dem som **Collected Metric Groups**. |

### Flere felter

| Felt | Standard | Maksimum | Hvad det begrænser |
|---|---|---|---|
| **Connection Timeout (ms)** | `10000` | `30000` | Hvor længe der ventes på at oprette en forbindelse. |
| **Statement Timeout (ms)** | `10000` | `60000` | Loftet for hver enkelt katalogforespørgsel. |

Standardtimeouten for sætninger er bevidst strammere end SQL Query-monitorens: disse forespørgsler svarer på millisekunder på en sund server, så hvis `pg_stat_activity` tager ti sekunder, er det nyttige signal "denne server er i problemer", ikke længere ventetid. En værdi over maksimum sænkes til maksimum.

## Brug en monitorhemmelighed til adgangskoden

Sådan bliver adgangskoden aldrig gemt i klartekst på monitoren:

:::steps
1. Gå til **Monitorer → Indstillinger → Hemmeligheder**, og opret en [monitorhemmelighed](/docs/monitor/monitor-secrets).
2. Giv den et navn (for eksempel `dbPassword`), og giv denne monitor adgang til den.
3. Skriv `{{monitorSecrets.dbPassword}}` i monitorens felt **Adgangskode**.
:::

Hemmeligheden slås op på serveren, før konfigurationen gives videre til en probe. Felterne Vært, Brugernavn og Databasenavn accepterer den samme henvisning. Loginoplysninger skrives aldrig i logs, monitorfeeds eller advarselsskabeloner.

## Metrikgrupper

En gruppe er én enhed, som du slår til eller fra, og den enhed, en manglende rettighed rapporteres for. Grupperne findes, så en manglende rettighed koster dig én gruppe i stedet for hele monitoren. En gruppes sætninger kører én ad gangen, så en gruppe kan være delvist indsamlet: Den står så både i `collectedGroups` og i `unavailableGroups`. Det almindelige tilfælde er SQL Servers gruppe Storage for et login uden `VIEW SERVER STATE` — databasestørrelsen indsamles, logpladsen og den ledige plads i tempdb gør ikke.

| Gruppe | Hvad den indsamler | Kræver |
|---|---|---|
| Connections | Antal forbindelser, det konfigurerede loft, afbrudte forbindelsesforsøg, serverens oppetid | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Activity | Længst kørende forespørgsel, længst åbne transaktion, åbne transaktioner | PostgreSQL: `pg_monitor`. MySQL: `PROCESS`. SQL Server: `VIEW SERVER STATE` |
| Throughput | Transaktioner, forespørgsler, cache-hitrate, disklæsninger og -skrivninger, I/O-tid | PostgreSQL: intet ud over `CONNECT`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Locks | Blokerede sessioner, låseventetider, deadlocks, ventetider på tabellåse | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Storage | Databasestørrelse, udskrivning til midlertidige filer, logplads, ledig plads i tempdb | PostgreSQL: intet ud over `CONNECT`. MySQL: `SELECT` på databasen. SQL Server: intet for databasestørrelsen; `VIEW SERVER STATE` for logplads og ledig plads i tempdb |
| Replication | Forbundne replikaer, replikeringsforsinkelse i sekunder og bytes, inaktive slots, gendannelsestilstand | PostgreSQL: `pg_monitor`. MySQL: `REPLICATION CLIENT`. SQL Server: `VIEW SERVER STATE`; indsamles ikke på Azure SQL Database |
| Maintenance | Luft til transaktions-ID-wraparound, døde tupler, tabeller, som autovacuum aldrig har behandlet, checkpoints | PostgreSQL: `pg_monitor` |

På Azure SQL Database skal du læse `VIEW DATABASE STATE`, hvor denne tabel siger `VIEW SERVER STATE` — eller `##MS_ServerStateReader##` på Basic, S0, S1 og elastiske puljer. Se [Azure SQL Database](#azure-sql-database).

At slå en gruppe fra sker i stilhed: ingen metrikker, intet indsamlingsproblem, ingen advarsel. Det er det rigtige valg i to tilfælde:

- **Du kan ikke få rettigheden.** Når du slår gruppen fra, holder indsamlingsproblemet op med at gentage sig ved hver kontrol.
- **Forespørgslerne er for dyre.** På MySQL er **Lagerplads** den sædvanlige kandidat: databasestørrelsen kommer fra en sum over `information_schema.TABLES`, hvilket ikke er gratis på et skema med titusindvis af tabeller og kører ved hver kontrol. Slå den fra, eller flyt den monitor til et interval på fem minutter.

At fjerne markeringen fra alle grupper er ikke en måde at indsamle ingenting på — en tom liste normaliseres tilbage til alle grupper, så en monitor aldrig kan gemmes i en tilstand, hvor den i stilhed ikke indsamler noget.

## Hvad der sker, når en metrik ikke kan indsamles

**En manglende rettighed tager aldrig monitoren offline.** Det er den vigtigste egenskab ved denne monitortype, og den er værd at beskrive præcist.

| Hvad fejler | Monitorstatus | Hvad du ser |
|---|---|---|
| **Forbindelsen** eller testforespørgslen — forkerte loginoplysninger, afvist forbindelse, TLS-fejl, timeout ved forbindelse | **Offline** | `Database Is Online` er false, og den hændelse og den vagtpolitik, du har knyttet til den, udløses. |
| **En gruppe** — en manglende rettighed, en slået-fra `performance_schema`, en timeout for en sætning | **Forbliver online** | De metrikker, gruppen ikke kunne læse, **mangler** — de er ikke nul. Der tegnes ingen graflinje, ingen tærskel på de serier kan matche, og ingen hændelse kan opstå fra dem. Kontrollen registrerer ét indsamlingsproblem, der nævner gruppen, årsagen og — hvor der er en — den præcise `GRANT`, der skal køres; det vises i monitorens oversigt og tælles med i **Metric Groups Failed**. |
| **Motoren kan slet ikke levere en metrik** — standard-MySQL har ingen deadlock-tæller; SQL Server lader som standard sit forbindelsesloft være ubegrænset, så en "brugt procent" ville være meningsløs | **Forbliver online** | Metrikken mangler bare. Det er **ikke** et indsamlingsproblem, tæller ikke med i Metric Groups Failed og skal ikke rettes. Se kolonnen Engines under [Indsamlede metrikker](#indsamlede-metrikker). |

Mangler betyder altid mangler. En værdi, der ikke er målt, rapporteres aldrig som `0`, for en graf med opdigtede nuller er værre end et hul — et hul kan du se.

> [!TIP]
> Brug `Database Collection Error` eller en tærskel på **Metric Groups Failed** for at få besked om tabt overblik. Gør begge til advarsler frem for hændelser: en tilbagekaldt rettighed er en sag i køen, ikke et vagtkald.

### "The user does not have permission to perform this action"

Det er SQL Servers meddelelse (Msg 297) for et login, der kan forbinde, men ikke kan læse serverens tilstandsvisninger. Den betyder altid en manglende rettighed, aldrig en fejl i databasen. SQL Server sender den som nummer to, efter en meddelelse, der nævner den afviste tilladelse, og monitoren viser dem begge: for eksempel `VIEW SERVER STATE permission was denied on object 'server', database 'master'. The user does not have permission to perform this action.` Ved siden af står den sætning, der løser det for den platform, proben forbandt til:

- **SQL Server eller Azure SQL Managed Instance** — `GRANT VIEW SERVER STATE TO oneuptime_health;`, kørt i `master` (monitoren viser den som `GRANT VIEW SERVER STATE TO [<monitoring_login>]; -- run in master`).
- **Azure SQL Database** — `GRANT VIEW DATABASE STATE TO oneuptime_health;`, kørt i den overvågede database; på Basic, S0, S1 og elastiske puljer i stedet medlemskab af `##MS_ServerStateReader##`. Se [Azure SQL Database](#azure-sql-database).

Databasestørrelsen bliver ved med at blive indsamlet i mellemtiden, fordi det er den eneste metrik i gruppen Storage, som ethvert login kan læse.

## Indsamlede metrikker

Enogfyrre serier fordelt på otte kategorier. Engines viser de motorer, der faktisk kan levere serien; på enhver anden motor mangler den bare. Group er den indsamlingsgruppe, serien hører til — det, du slår til og fra, og det, der svigter samlet.

### Tilgængelighed

| Metrik | Serie | Group | Engines |
|---|---|---|---|
| **Uptime** (s) | `oneuptime.monitor.database.uptime.seconds` | Connections | PostgreSQL, MySQL, SQL Server |
| **Metric Groups Failed** | `oneuptime.monitor.database.metric.groups.failed` | Connections | PostgreSQL, MySQL, SQL Server |

### Forbindelser

| Metrik | Serie | Group | Engines |
|---|---|---|---|
| **Connections** | `oneuptime.monitor.database.connections.total` | Connections | PostgreSQL, MySQL, SQL Server |
| **Active Connections** | `oneuptime.monitor.database.connections.active` | Connections | PostgreSQL, MySQL, SQL Server |
| **Maximum Connections** | `oneuptime.monitor.database.connections.max` | Connections | PostgreSQL, MySQL |
| **Connections Used** (%) | `oneuptime.monitor.database.connections.used.percent` | Connections | PostgreSQL, MySQL |
| **Idle In Transaction** | `oneuptime.monitor.database.connections.idle.in.transaction` | Connections | PostgreSQL |
| **Aborted Connects** | `oneuptime.monitor.database.connections.aborted.total` | Connections | MySQL |

### Gennemløb

| Metrik | Serie | Group | Engines |
|---|---|---|---|
| **Transactions** | `oneuptime.monitor.database.transactions.total` | Throughput | PostgreSQL, SQL Server |
| **Queries** | `oneuptime.monitor.database.queries.total` | Throughput | MySQL, SQL Server |
| **Slow Queries** | `oneuptime.monitor.database.queries.slow.total` | Throughput | MySQL |
| **Rollback Ratio** (%) | `oneuptime.monitor.database.rollback.percent` | Throughput | PostgreSQL |
| **Longest Running Query** (s) | `oneuptime.monitor.database.query.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Longest Open Transaction** (s) | `oneuptime.monitor.database.transaction.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Open Transactions** | `oneuptime.monitor.database.transaction.open.count` | Activity | MySQL |

### Låse og blokeringer

| Metrik | Serie | Group | Engines |
|---|---|---|---|
| **Blocked Sessions** | `oneuptime.monitor.database.sessions.blocked` | Locks | PostgreSQL, MySQL, SQL Server |
| **Lock Waits** | `oneuptime.monitor.database.locks.waiting` | Locks | PostgreSQL, MySQL, SQL Server |
| **Deadlocks** | `oneuptime.monitor.database.deadlocks.total` | Locks | PostgreSQL, SQL Server |
| **Table Lock Waits** | `oneuptime.monitor.database.table.locks.waited.total` | Locks | MySQL |

Standard-MySQL har ingen som helst deadlock-tæller, og derfor findes Deadlocks kun på PostgreSQL og SQL Server.

### Cache og I/O

| Metrik | Serie | Group | Engines |
|---|---|---|---|
| **Cache Hit Ratio** (%) | `oneuptime.monitor.database.cache.hit.percent` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Reads** | `oneuptime.monitor.database.disk.reads.total` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Writes** | `oneuptime.monitor.database.disk.writes.total` | Throughput | MySQL, SQL Server |
| **I/O Read Time** (ms) | `oneuptime.monitor.database.io.read.time.ms` | Throughput | PostgreSQL, SQL Server |
| **I/O Write Time** (ms) | `oneuptime.monitor.database.io.write.time.ms` | Throughput | PostgreSQL, SQL Server |
| **Page Life Expectancy** (s) | `oneuptime.monitor.database.page.life.expectancy.seconds` | Throughput | SQL Server |
| **Memory Grants Pending** | `oneuptime.monitor.database.memory.grants.pending` | Throughput | SQL Server |

PostgreSQL måler kun læse- og skrivetid for I/O, når `track_io_timing` er slået til. Den er slået fra som standard, og så rapporterer PostgreSQL begge som `0` — på PostgreSQL betyder et fladt nul i de to serier derfor som regel "ikke målt", ikke "hurtig". Det er en serverindstilling, ikke et rettighedsproblem.

### Lagring

| Metrik | Serie | Group | Engines |
|---|---|---|---|
| **Database Size** (bytes) | `oneuptime.monitor.database.size.bytes` | Storage | PostgreSQL, MySQL, SQL Server |
| **Temp Bytes Written** (bytes) | `oneuptime.monitor.database.temp.bytes.total` | Storage | PostgreSQL |
| **Temp Disk Tables** | `oneuptime.monitor.database.temp.disk.tables.total` | Storage | MySQL |
| **Log Space Used** (%) | `oneuptime.monitor.database.log.space.used.percent` | Storage | SQL Server |
| **TempDB Free Space** (bytes) | `oneuptime.monitor.database.tempdb.free.bytes` | Storage | SQL Server |

### Replikering

| Metrik | Serie | Group | Engines |
|---|---|---|---|
| **Connected Replicas** | `oneuptime.monitor.database.replica.count` | Replication | PostgreSQL, SQL Server |
| **Replication Lag** (s) | `oneuptime.monitor.database.replication.lag.seconds` | Replication | PostgreSQL, MySQL |
| **Replication Lag (Bytes)** (bytes) | `oneuptime.monitor.database.replication.lag.bytes` | Replication | PostgreSQL, SQL Server |
| **Is In Recovery** | `oneuptime.monitor.database.is.in.recovery` | Replication | PostgreSQL |
| **Inactive Replication Slots** | `oneuptime.monitor.database.replication.slots.inactive` | Replication | PostgreSQL |

Replikeringsmetrikker rapporteres fra den side af forbindelsen, monitoren er forbundet til. Ret en monitor mod den primære server for at se forbundne replikaer og sendekøen; ret en mod hver standby for at se, hvor langt bagud netop den standby faktisk er.

Forsinkelsen i sekunder står på nul på en inaktiv primær server, selv når en replika er langt bagud, fordi intet nyt er blevet skrevet. **Replication Lag (Bytes)** har ikke den blinde vinkel, så send advarsler på begge.

### Vedligeholdelse

| Metrik | Serie | Group | Engines |
|---|---|---|---|
| **Transaction ID Used** (%) | `oneuptime.monitor.database.transaction.id.used.percent` | Maintenance | PostgreSQL |
| **Dead Tuples** | `oneuptime.monitor.database.dead.tuples` | Maintenance | PostgreSQL |
| **Tables Never Autovacuumed** | `oneuptime.monitor.database.tables.never.autovacuumed` | Maintenance | PostgreSQL |
| **Requested Checkpoints** | `oneuptime.monitor.database.checkpoints.requested.total` | Maintenance | PostgreSQL |
| **Timed Checkpoints** | `oneuptime.monitor.database.checkpoints.timed.total` | Maintenance | PostgreSQL |

> [!IMPORTANT]
> **Transaction ID Used** fortjener et kriterium på hver PostgreSQL-monitor, du opretter. PostgreSQL afviser alle skrivninger, når værdien når 100 %, gendannelse kræver en vacuum i enkeltbrugertilstand med databasen nede, og næsten ingen holder øje med den. Send en advarsel i god tid før afgrunden — 80 % giver dages luft på de fleste arbejdsbelastninger.

Tællere, der ender på `total`, er kumulative siden serverens start. Sammenlign to tidspunkter for at få en rate; en enkelt værdi giver kun mening i forhold til dens egen historik, og den nulstilles, når serveren genstarter (hvilket **Uptime** viser dig).

## Opsæt kriterier

| Filtertype | Hvad den kontrollerer |
|---|---|
| **Database Is Online** | Om databasen kunne nås, og testforespørgslen lykkedes. Det er det offline-kriterium, monitoren oprettes med, og den eneste kontrol, der afspejler tilgængeligheden. |
| **Database Metric** | Vælg en metrik, og sammenlign den: Greater Than, Less Than, Greater Than Or Equal To, Less Than Or Equal To, Equal To eller Not Equal To. Metrikvælgeren tilbyder kun de metrikker, din valgte motor kan levere, så du kan ikke bygge et kriterium, der for altid forbliver uopfyldt (én undtagelse: de Replication-metrikker, der tilbydes for Microsoft SQL Server, indsamles aldrig på Azure SQL Database). Hvis metrikken ikke blev indsamlet ved en kontrol — gruppen fejlede, eller motoren rapporterer den ikke — matcher filteret ikke, og det matcher heller ikke som "false": det springes over. Et rettighedsproblem kan ikke tilkalde nogen. |
| **Database Collection Error** | Oversigten over kontrollens indsamlingsproblemer, én "gruppe: meddelelse" pr. utilgængelig gruppe. Send en advarsel, når den ikke er tom, for at opdage tabt overblik, eller brug Contains til at holde øje med én bestemt gruppe. |
| **JavaScript Expression** | Fuld kontrol. Se [JavaScript-udtryk](/docs/monitor/javascript-expression). |

Tærskler er heltal. Skriv `90`, ikke `90.5` — procenter og sekunder sammenlignes som heltal.

**Database Is Online** og **Database Metric** kan kontrolleres over tid: Sæt flueben ved **Evaluér disse kriterier over en periode**, vælg derefter under **Evaluér**, hvordan værdierne vurderes (for eksempel **All Values**), og udfyld **For de seneste (i minutter)**. Over tid afgør filterets indstilling **Hvis ingen data**, hvad en manglende værdi betyder; lad den stå på **Ignore**, så en manglende rettighed stadig ikke kan tilkalde nogen.

### Variabler til JavaScript-udtryk

For en Database Health-monitor har udtrykket adgang til:

| Variabel | Type | Beskrivelse |
|---|---|---|
| `isOnline` | boolean | Om både forbindelsen og testforespørgslen lykkedes |
| `engineVersion` | string | Den versionsstreng, serveren rapporterede (på SQL Server den rene `ProductVersion`; monitorens oversigt nævner platformen ved siden af) |
| `connectionError` | string | Renset forbindelsesfejl, tom når der ikke var nogen |
| `collectedGroups` | array | De grupper, der leverede værdier ved denne kontrol |
| `unavailableGroups` | array | Grupperne med en sætning, der ikke kunne indsamles, hver med en årsag og en løsning. En delvist indsamlet gruppe står på begge lister |
| `metrics` | object | De indsamlede værdier med serienavnet som nøgle; en serie, der ikke blev indsamlet, mangler |

```javascript
{{isOnline}} === true && {{collectedGroups}}.length >= 5
```

For at læse én metrik i et udtryk skal du indeksere hele `metrics`-objektet — serienavnene indeholder punktummer og kan derfor ikke stå inden for de krøllede parenteser:

```javascript
{{metrics}}['oneuptime.monitor.database.connections.used.percent'] > 90
```

Til en tærskel på en enkelt metrik bør du vælge **Database Metric** frem for et udtryk: det slår serien op for dig, tilbyder kun det, din motor kan levere, og springer kontrollen over, når værdien ikke blev indsamlet, i stedet for at sammenligne med ingenting.

### Eksempel: en primær PostgreSQL-server

| Rækkefølge | Kriterier | Filter |
|---|---|---|
| 1 | **Offline** | `Database Is Online` er `false`. |
| 2 | **Forringet** | `Database Metric` → Connections Used er større end `90`, evalueret over 5 minutter med All Values, så en enkelt spids ikke tilkalder nogen. |
| 3 | **Forringet** | `Database Metric` → Transaction ID Used er større end `80`. |
| 4 | **Forringet** | `Database Metric` → Blocked Sessions er større end `0`, over 5 minutter. |
| 5 | **Online** | `Database Is Online` er `true`. |

Kriterier evalueres oppefra og ned, og det første match vinder, så placér de advarende kriterier først og det sunde sidst.

Knyt en vagtpolitik til offline-kriteriet, og lad alt, der er afledt af **Metric Groups Failed** eller `Database Collection Error`, være en advarsel uden tilknyttet vagtpolitik.

## Det skal du være opmærksom på

- **Forespørgslerne kører ved hver kontrol.** De er billige af design, men "billig" er relativt til intervallet. Et interval på ét minut mod en server med tusindvis af sessioner betyder flere gennemløb af `pg_stat_activity`, end du måske ønsker; fem minutter er rigeligt til kapacitetsmetrikker.
- **Ret monitoren mod den database, du holder øje med.** Størrelse, cache-hitrate og udskrivning til midlertidige filer gælder pr. database. Forbindelser, oppetid og replikering gælder pr. server og ser ens ud fra enhver database på den instans.
- **Én monitor pr. instans, ikke pr. database**, medmindre du specifikt vil have størrelses- og cachemetrikker pr. database — ellers mangedobler du forespørgslerne på serverniveau uden ny information. Azure SQL Database er undtagelsen: den rapporterer forbindelser pr. database, så overvåg hver database dér.
- **Send advarsler på rater, ikke på tællere.** Alt, der ender på `total`, stiger kun, så en "større end"-tærskel på det udløses én gang og bliver aldrig normal igen. Vis det i en graf, eller sammenlign det over et tidsvindue.
- **Vælg hellere en monitorhemmelighed end en adgangskode i klartekst.** Loginoplysningerne forbliver så krypterede, når de er gemt, og vises aldrig på monitoren.
- **Monitoren skriver aldrig.** Hver forespørgsel er en læsning af en statistikvisning — på PostgreSQL i en skrivebeskyttet transaktion, på MySQL i en skrivebeskyttet session. Det, den ikke kan læse, rapporteres som en manglende metrik, aldrig som et nedbrud.

## Fejlfinding

:::details Monitoren er offline, men databasen kører
Offline betyder, at proben ikke kunne forbinde, eller at testforespørgslen fejlede: værten eller porten kan ikke nås fra proben, loginnet blev afvist, TLS fejlede, eller forbindelsen fik timeout. Monitorens oversigt viser fejlen. Kontrollér, at proben kan nå databasen (en probe, som OneUptime hoster, kræver en offentlig adresse; brug ellers en [brugerdefineret probe](/docs/probe/custom-probe)), kontrollér brugernavnet og adgangskoden eller dens monitorhemmelighed, og slå **Verify server certificate** fra for et selvsigneret certifikat. Klik derefter på **Test monitor** for at kontrollere igen.
:::

:::details Connections, Activity og Locks mangler på PostgreSQL
Loginnet er hverken medlem af `pg_monitor` eller `pg_read_all_stats` og er ikke superbruger, så proben springer de grupper over i stedet for at registrere forkerte tal. Kør `GRANT pg_monitor TO oneuptime_health;` som beskrevet under [PostgreSQL](#postgresql).
:::

:::details Connections, Throughput og Locks mangler på MySQL
Enten mangler loginnet `SELECT` på `performance_schema`, eller også er `performance_schema` slået fra på serveren; monitorens oversigt viser MySQL's meddelelse. Ved en manglende rettighed skal du køre sætningerne under [MySQL](#mysql). En slået-fra `performance_schema` kræver `performance_schema = ON` i serverens konfiguration og en genstart.
:::

:::details I/O Read Time og I/O Write Time er altid 0 på PostgreSQL
PostgreSQL måler dem kun, når `track_io_timing` er slået til, og den er slået fra som standard. Slå den til i serverens konfiguration eller i parametergruppen for din administrerede tjeneste for at se rigtige værdier. Det er ikke en manglende rettighed.
:::

:::details Metric Groups Failed er over 0 ved hver kontrol
En gruppe kan ikke indsamles ved nogen kontrol, så det samme indsamlingsproblem gentager sig. Monitorens oversigt nævner gruppen, årsagen og den `GRANT`, der løser det. Kør rettigheden, eller slå, hvis du ikke kan få den, gruppen fra under **Metric Groups**, så problemet holder op med at gentage sig.
:::

## Næste trin

:::cards
- [SQL-forespørgsel-monitor](/docs/monitor/sql-monitor): Send advarsler om resultatet af din egen forespørgsel ved siden af serverens helbred.
- [Databaser](/docs/telemetry/databases): Se hver databases metrikker, logs og kaldere på én side.
- [Monitorhemmeligheder](/docs/monitor/monitor-secrets): Hold overvågningsbrugerens adgangskode krypteret.
- [Brugerdefinerede probes](/docs/probe/custom-probe): Nå en database inde i dit netværk.
:::

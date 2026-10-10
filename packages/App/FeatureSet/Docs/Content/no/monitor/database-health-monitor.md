# Databasehelse-overvåking

Database Health-monitoren kobler til PostgreSQL, MySQL eller Microsoft SQL Server etter en tidsplan og rapporterer serverens egne helsesignaler — ledig kapasitet for tilkoblinger, blokkerte økter, replikeringsforsinkelse, treffrate i hurtigbufferen, databasestørrelse, transaksjons-ID-wraparound og rundt tretti til — slik at du kan varsle på dem på samme måte som du varsler når et nettsted er nede.

Du skriver ingen SQL. Proben kjører et fast sett skrivebeskyttede katalogspørringer, valgt etter databasemotor, og rapporterer et lite sett navngitte tall.

:::cards
- [Opprett en overvåkingsbruker](#opprett-en-overvåkingsbruker): Rettighetene hver motor trenger. Dette er steget som betyr mest.
- [Opprett monitoren](#opprett-en-database-health-monitor): Rett en probe mot databasen og velg hva som skal samles inn.
- [Innsamlede metrikker](#innsamlede-metrikker): Hver serie, med motorene som rapporterer den.
- [Sett opp kriterier](#sett-opp-kriterier): Varsle om tilkoblinger, blokkering, forsinkelse og wraparound.
:::

## Database Health eller SQL Query?

De to monitortypene for databaser svarer på ulike spørsmål og er ment å brukes sammen.

| | Database Health | [SQL Query](/docs/monitor/sql-monitor) |
|---|---|---|
| Spørsmål den svarer på | «Er selve databasen frisk?» | «Er dataene mine slik jeg forventer?» |
| Spørring | Innebygd, per motor, skrivebeskyttet | Din egen |
| Rapporterer | Navngitte numeriske metrikker (se [Innsamlede metrikker](#innsamlede-metrikker)) | Antall rader, skalarverdi, første rad, kjøretid |
| Typisk varsel | Brukte tilkoblinger over 90 % | Over 50 kansellerte ordrer de siste fem minuttene |
| Nødvendige rettigheter | Lesetilgang til statistikk/DMV-er — se [Opprett en overvåkingsbruker](#opprett-en-overvåkingsbruker) | `SELECT` på tabellene spørringen din berører |

Vil du varsle om en forretningsbetingelse, bruker du SQL Query-monitoren. Vil du vite at serveren er i ferd med å gå tom for tilkoblinger før forretningsbetingelsen i det hele tatt får sjansen til å feile, bruker du denne.

## Støttede databaser

| Database | Standardport |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

Azure SQL Database og Azure SQL Managed Instance kobler til som **Microsoft SQL Server**. De krever andre rettigheter — se [Opprett en overvåkingsbruker](#opprett-en-overvåkingsbruker).

PostgreSQL- og MySQL-kompatible motorer som snakker samme wire-protokoll, fungerer vanligvis, men de kan ha færre statistikkvisninger; da rapporteres de berørte metrikkene som utilgjengelige i stedet for å bli samlet inn. Bare de tre motorene over er offisielt testet.

Hver database som applikasjonene, klyngene og vertene dine bruker — disse tre motorene og mange flere — får også sin egen side med motorens metrikker, logger og tjenestene som kaller den: se [Databaser](/docs/telemetry/databases). Når verten og porten en Database Health-monitor kobler til er et av endepunktene til en database, vises monitorens varsler og hendelser også på siden til den databasen (se [Varsler på en database](/docs/telemetry/databases#alerts-on-a-database)).

## Slik fungerer det

Ved hver kontroll gjør en probe dette:

1. Den kobler til databasen med påloggingsinformasjonen du konfigurerer.
2. Den kjører én lett testspørring. **Dette er den eneste setningen som kan ta monitoren offline hvis den feiler.**
3. Den kjører katalogspørringene for hver aktiverte [metrikkgruppe](#metrikkgrupper), én om gangen, hver med en tidsavbruddsgrense for setningen.
4. Den rapporterer tallene den samlet inn, pluss et notat for hver gruppe den ikke kunne samle inn, og hvorfor.

```mermaid title="Én kontroll, og det eneste steget som kan ta monitoren offline"
flowchart TB
    connect["Koble til databasen"] --> probe{"Testspørring OK?"}
    probe -->|"Nei"| offline["Monitor frakoblet"]
    probe -->|"Ja"| groups["Kjør hver metrikkgruppe"]
    groups --> group{"Gruppe samlet inn?"}
    group -->|"Ja"| metrics["Metrikker rapportert"]
    group -->|"Nei"| issue["Metrikker mangler, problem notert"]
    metrics --> criteria["Kriterier evaluert"]
    issue --> criteria
```

Bare navngitte numeriske aggregater sendes til OneUptime. Ingen spørringstekst, ingen rader fra tabellene dine og ingen skjemanavn forlater nettverket ditt — spørringene leser motorens egne statistikkvisninger (`pg_stat_activity`, `performance_schema.global_status`, `sys.dm_exec_sessions` og lignende), aldri dataene dine.

Fordi kontrollen kjører fra en probe, trenger databasen bare å kunne nås fra proben. Sett en [egendefinert probe](/docs/probe/custom-probe) inn i nettverket ditt, så trenger OneUptime ingen rute til databasen i det hele tatt.

## Før du begynner

- En **probe** med nettverkstilgang til databasens vert og port. Bruk en probe som OneUptime drifter hvis databasen kan nås fra internett, og ellers en [egendefinert probe](/docs/probe/custom-probe) i nettverket ditt.
- En **overvåkingsbruker**, opprettet som beskrevet i neste avsnitt, og tilkoblingsinformasjonen dens.

## Opprett en overvåkingsbruker

**Dette er det viktigste steget.** Monitoren leser statistikkvisninger som vanlige pålogginger ikke har lov til å se, og en pålogging med for få rettigheter feiler ikke alltid med en feilmelding — på PostgreSQL gir den et feil svar. Opprett en egen pålogging med nøyaktig disse rettighetene og ingenting annet.

### PostgreSQL

```sql
CREATE USER oneuptime_health WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE mydb TO oneuptime_health;
-- The one grant that matters. Without it, see the note below.
GRANT pg_monitor TO oneuptime_health;
```

`pg_monitor` er en innebygd rolle (PostgreSQL 10 og nyere) som gir lesetilgang til statistikk- og overvåkingsvisningene. Den gir ingen tilgang til tabellene dine.

> [!IMPORTANT]
> **Hvorfor `pg_monitor` ikke er valgfri på PostgreSQL.** Uten den feiler ikke `pg_stat_activity` — spørringen lykkes og returnerer bare overvåkingsøktens egen rad. Antall tilkoblinger ville vist `1`, blokkerte økter `0` og replikeringsforsinkelsen `0`, for alltid, på en server som i virkeligheten står i brann. Derfor sjekker proben, **før** den kjører de spørringene, at påloggingen er medlem av `pg_monitor` (eller `pg_read_all_stats`) eller er superbruker. Er den ingen av delene, rapporterer proben gruppene Connections, Activity og Locks som utilgjengelige, sammen med `GRANT`-en du trenger. Å rapportere ingenting er det ærlige svaret; å rapportere `1` er det ikke.

På en administrert tjeneste der `pg_monitor` ikke er tilgjengelig, dekker `pg_read_all_stats` de samme visningene. På Amazon RDS trengs ikke `GRANT rds_superuser` — `GRANT pg_monitor TO oneuptime_health;` fungerer som medlem av `rds_superuser`.

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

MySQLs `performance_schema` må være slått på (`performance_schema = ON`, standard siden 5.6). Når den er slått av, rapporteres gruppene Connections, Throughput og Locks som utilgjengelige, og løsningen er en omstart av serveren, ikke en rettighet.

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

Kjørt fra en hvilken som helst annen database feiler `GRANT VIEW SERVER STATE` med Msg 4621, «Permissions at the server scope can only be granted when the current database is master».

> [!WARNING]
> **Lesetilgang til tabellene dine er ikke nok.** En pålogging som bare kan lese data — `db_datareader` eller en annen rolle med «lesetilgang» — kan koble til og får databasestørrelsen, men ingenting annet. SQL Server avviser visningene monitoren leser med `The user does not have permission to perform this action.` (Msg 297). Meldingen før den sier hva som ble avvist: Msg 300 `VIEW SERVER STATE` (`VIEW SERVER PERFORMANCE STATE` på 2022) for servervisningene, inkludert plassen i transaksjonsloggen og ledig plass i tempdb, eller Msg 262 `VIEW DATABASE STATE` (`VIEW DATABASE PERFORMANCE STATE` på 2022) for replikeringsvisningen. Monitoren forblir online, rapporterer at gruppene Connections, Activity, Throughput, Locks, Storage og Replication mangler en rettighet, og viser `GRANT`-en ovenfor ved siden av. `VIEW SERVER STATE` dekker alle sammen.
>
> To visninger avviser ikke: uten rettigheten viser `sys.dm_exec_sessions` og `sys.dm_exec_requests` i det stille bare monitorens egen økt. Monitoren leser dem aldri alene — alltid sammen med en visning som avviser — så en manglende rettighet kan aldri bli registrert som «1 tilkobling».

### Azure SQL Database

Azure SQL Database har ingen rettigheter på servernivå — `GRANT VIEW SERVER STATE` feiler der — så de samme visningene åpnes i stedet av en rettighet på databasenivå. Opprett en pålogging i `master`, gi den en bruker i databasen du overvåker, og gi rettigheten der, ikke i `master`:

```sql
-- Connected to master, as the server admin:
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';

-- Connected to the monitored database:
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
GRANT VIEW DATABASE STATE TO oneuptime_health;
```

Det er nok på vCore-databaser og på DTU-databaser fra S2 og oppover. På **Basic, S0 og S1**, og for enhver database i en **elastisk pool**, lar Azure bare serveradministratoren, Microsoft Entra-administratoren eller medlemmer av serverrollen `##MS_ServerStateReader##` lese disse visningene, uansett hva databasens rettigheter sier. Der legger serveradministratoren også påloggingen til den rollen:

```sql
-- Connected to master, as the server admin:
ALTER SERVER ROLE ##MS_ServerStateReader## ADD MEMBER oneuptime_health;
```

`##MS_ServerStateReader##` fungerer på alle nivåer, så det er også reserveløsningen hvis `VIEW DATABASE STATE` likevel ikke er nok. Et nytt rollemedlemskap kan bruke noen minutter på å tre i kraft og gjelder bare nye tilkoblinger; proben åpner en ny tilkobling ved hver kontroll.

En innesluttet databasebruker (`CREATE USER oneuptime_health WITH PASSWORD = '...'` i den overvåkede databasen, uten pålogging) fungerer med `VIEW DATABASE STATE` fra S2 og oppover, men kan ikke bli medlem av `##MS_ServerStateReader##`: serverroller tar bare pålogginger. For å flytte en innesluttet bruker til rollen sletter du den (`DROP USER oneuptime_health;`) og følger setningene ovenfor.

Proben gjenkjenner Azure SQL Database på `SERVERPROPERTY('EngineEdition')` og ikke på versjonen — Azure SQL Database rapporterer `12.0.2000.8` uansett hva den faktisk kjører, noe som leses som SQL Server 2014. Derfor viser monitorens **Engine** `Azure SQL Database 12.0.2000.8`, og en manglende rettighet vises som Azure-setningen ovenfor, aldri som `VIEW SERVER STATE`.

- **Replikering samles ikke inn på Azure SQL Database.** Azure SQL Database har ingen `sys.dm_hadr_database_replica_states`, så gruppen Replication hoppes over der i stedet for å bli rapportert som feilet ved hver kontroll. Azures egne replikavisninger (`sys.dm_database_replica_states`, `sys.dm_geo_replication_link_status`) leses ikke ennå.
- **Tilkoblinger gjelder per database.** Med `VIEW DATABASE STATE` viser Azure SQL Database bare øktene til den overvåkede databasen, så Connections teller den databasen og ikke den logiske serveren. Overvåk hver database du bryr deg om.
- **I en elastisk pool er TempDB Free Space poolens.** Databasene i en pool deler én tempdb.

## Opprett en Database Health-monitor

:::steps
### Start en ny monitor

Gå til **Monitorer** og klikk på **Opprett monitor**. Under **Monitortype** klikker du på **Flere monitortyper** og velger **Database Health** under **Database Monitoring**, eller skriver `health` i søkefeltet. Skriv inn et **Navn**, og klikk deretter på **Neste**.

### Fyll inn tilkoblingsinformasjonen

Velg **Database Type**, og fyll deretter inn vert, port, databasenavn og påloggingsinformasjonen til overvåkingsbrukeren. Henvis til passordet som en [monitorhemmelighet](#bruk-en-monitorhemmelighet-for-passordet) i stedet for å skrive det inn. Hvert felt er beskrevet under [Konfigurasjon](#konfigurasjon).

### Velg hva som skal samles inn

La alle gruppene under **Metric Groups** være slått på, med mindre du har en grunn til å slå av en av dem — se [Metrikkgrupper](#metrikkgrupper).

### Test tilkoblingen

Klikk på **Test monitor** for å kjøre én kontroll før du lagrer, og les hva den samlet inn.

### Fastsett kriteriene

Gå gjennom kriteriene monitoren starter med, og legg til dine egne — se [Sett opp kriterier](#sett-opp-kriterier). Klikk deretter på **Neste**.

### Velg prober og opprett

Velg **Sonder** som kan nå databasen, og et **Overvåkingsintervall**, og klikk deretter på **Opprett monitor**.
:::

## Konfigurasjon

| Felt | Hva du fyller inn |
|---|---|
| **Database Type** | PostgreSQL, MySQL eller Microsoft SQL Server. Valg av type setter standardporten og avgjør hvilke spørringer som kjøres. |
| **Vert** | Databaseverten som kan nås fra proben (for eksempel `db.internal`). |
| **Port** | Databasens port. |
| **Databasenavn** | Databasen det kobles til. Metrikker på databasenivå (størrelse, treffrate i hurtigbufferen, utskriving til midlertidige filer) rapporteres for denne databasen; metrikker på servernivå (tilkoblinger, oppetid, replikering) for hele serveren — unntatt på Azure SQL Database, der tilkoblinger bare telles for den overvåkede databasen. |
| **Use Windows Integrated Authentication** | Bare Microsoft SQL Server. Autentiser med identiteten til probeprosessen i stedet for et brukernavn og passord. Se [Integrert Windows-autentisering](/docs/monitor/sql-monitor) på siden om SQL Query-monitoren — oppsettet er det samme. |
| **Brukernavn** | Overvåkingsbrukeren. Påkrevd, med mindre du bruker integrert Windows-autentisering. |
| **Passord** | Passordet. Henvis til en [monitorhemmelighet](/docs/monitor/monitor-secrets) med `{{monitorSecrets.name}}` i stedet for å skrive det inn i klartekst (se [Bruk en monitorhemmelighet](#bruk-en-monitorhemmelighet-for-passordet)). |
| **Use SSL/TLS** | Koble til over TLS. Når dette er slått på, kan du slå av **Verify server certificate** for et selvsignert sertifikat. |
| **Metric Groups** | Hvilke grupper som kjøres: Connections, Aktivitet, Throughput, Locks and Blocking, Lagring, Replication og Vedlikehold. Alle er slått på som standard; se [Metrikkgrupper](#metrikkgrupper). Monitorens detaljer viser dem som **Collected Metric Groups**. |

### Flere felt

| Felt | Standard | Maksimum | Hva det begrenser |
|---|---|---|---|
| **Connection Timeout (ms)** | `10000` | `30000` | Hvor lenge det ventes på å opprette en tilkobling. |
| **Statement Timeout (ms)** | `10000` | `60000` | Taket for hver enkelt katalogspørring. |

Standard tidsavbrudd for setninger er bevisst strammere enn SQL Query-monitorens: disse spørringene svarer på millisekunder på en frisk server, så hvis `pg_stat_activity` bruker ti sekunder, er det nyttige signalet «denne serveren er i trøbbel», ikke lengre venting. En verdi over maksimum senkes til maksimum.

## Bruk en monitorhemmelighet for passordet

Slik blir passordet aldri lagret i klartekst på monitoren:

:::steps
1. Gå til **Monitorer → Innstillinger → Hemmeligheter** og opprett en [monitorhemmelighet](/docs/monitor/monitor-secrets).
2. Gi den et navn (for eksempel `dbPassword`) og gi denne monitoren tilgang til den.
3. Skriv `{{monitorSecrets.dbPassword}}` i monitorens **Passord**-felt.
:::

Hemmeligheten slås opp på serveren før konfigurasjonen gis videre til en probe. Feltene Vert, Brukernavn og Databasenavn godtar den samme henvisningen. Påloggingsinformasjon skrives aldri til logger, monitorfeeder eller varselmaler.

## Metrikkgrupper

En gruppe er én enhet du slår på eller av, og enheten en manglende rettighet rapporteres mot. Gruppene finnes for at en manglende rettighet skal koste deg én gruppe i stedet for hele monitoren. Setningene i en gruppe kjøres én om gangen, så en gruppe kan være delvis innsamlet: den står da både i `collectedGroups` og i `unavailableGroups`. Det vanlige tilfellet er SQL Servers gruppe Storage for en pålogging uten `VIEW SERVER STATE` — databasestørrelsen samles inn, men ikke loggplassen og ledig plass i tempdb.

| Gruppe | Hva den samler inn | Krever |
|---|---|---|
| Connections | Antall tilkoblinger, det konfigurerte taket, avbrutte tilkoblingsforsøk, serverens oppetid | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Activity | Lengst kjørende spørring, lengst åpne transaksjon, åpne transaksjoner | PostgreSQL: `pg_monitor`. MySQL: `PROCESS`. SQL Server: `VIEW SERVER STATE` |
| Throughput | Transaksjoner, spørringer, treffrate i hurtigbufferen, disklesinger og -skrivinger, I/O-tid | PostgreSQL: ingenting utover `CONNECT`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Locks | Blokkerte økter, ventetid på låser, vranglåser, ventetid på tabellåser | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Storage | Databasestørrelse, utskriving til midlertidige filer, loggplass, ledig plass i tempdb | PostgreSQL: ingenting utover `CONNECT`. MySQL: `SELECT` på databasen. SQL Server: ingenting for databasestørrelsen; `VIEW SERVER STATE` for loggplass og ledig plass i tempdb |
| Replication | Tilkoblede replikaer, replikeringsforsinkelse i sekunder og byte, inaktive slots, gjenopprettingstilstand | PostgreSQL: `pg_monitor`. MySQL: `REPLICATION CLIENT`. SQL Server: `VIEW SERVER STATE`; samles ikke inn på Azure SQL Database |
| Maintenance | Margin til transaksjons-ID-wraparound, døde tupler, tabeller autovacuum aldri har behandlet, checkpoints | PostgreSQL: `pg_monitor` |

På Azure SQL Database leser du `VIEW DATABASE STATE` der denne tabellen sier `VIEW SERVER STATE` — eller `##MS_ServerStateReader##` på Basic, S0, S1 og elastiske pooler. Se [Azure SQL Database](#azure-sql-database).

Å slå av en gruppe skjer i det stille: ingen metrikker, ikke noe innsamlingsproblem, ikke noe varsel. Det er riktig grep i to tilfeller:

- **Du får ikke rettigheten.** Når du slår av gruppen, slutter innsamlingsproblemet å gjenta seg ved hver kontroll.
- **Spørringene er for dyre.** På MySQL er **Lagring** den vanlige kandidaten: databasestørrelsen kommer fra en summering av `information_schema.TABLES`, noe som ikke er gratis på et skjema med titusenvis av tabeller, og som kjøres ved hver kontroll. Slå den av, eller flytt den monitoren til et intervall på fem minutter.

Å fjerne avkrysningen for alle gruppene er ikke en måte å samle inn ingenting på — en tom liste normaliseres tilbake til alle grupper, slik at en monitor aldri kan lagres i en tilstand der den i det stille ikke samler inn noe.

## Hva som skjer når en metrikk ikke kan samles inn

**En manglende rettighet tar aldri monitoren offline.** Dette er den viktigste egenskapen ved denne monitortypen, og den er verdt å beskrive nøyaktig.

| Hva som feiler | Monitorstatus | Hva du ser |
|---|---|---|
| **Tilkoblingen** eller testspørringen — feil påloggingsinformasjon, avvist tilkobling, TLS-feil, tidsavbrudd ved tilkobling | **Frakoblet** | `Database Is Online` er false, og hendelsen og vaktpolicyen du har knyttet til den, utløses. |
| **En gruppe** — en manglende rettighet, en avslått `performance_schema`, et tidsavbrudd for en setning | **Forblir online** | Metrikkene gruppen ikke kunne lese, **mangler** — de er ikke null. Ingen graflinje tegnes, ingen terskel på de seriene kan slå til, og ingen hendelse kan oppstå fra dem. Kontrollen registrerer ett innsamlingsproblem som nevner gruppen, årsaken og — der det finnes en — den nøyaktige `GRANT`-en som skal kjøres; det vises i monitorens sammendrag og telles i **Metric Groups Failed**. |
| **Motoren kan ikke levere en metrikk i det hele tatt** — standard-MySQL har ingen teller for vranglåser; SQL Server lar tilkoblingstaket være ubegrenset som standard, så en «brukt prosent» ville vært meningsløs | **Forblir online** | Metrikken mangler rett og slett. Dette er **ikke** et innsamlingsproblem, teller ikke i Metric Groups Failed og er ikke noe som skal fikses. Se kolonnen Engines under [Innsamlede metrikker](#innsamlede-metrikker). |

Mangler betyr alltid mangler. En verdi som ikke ble målt, rapporteres aldri som `0`, fordi en graf med oppdiktede nuller er verre enn et hull — et hull kan du se.

> [!TIP]
> For å varsle om tapt innsyn bruker du `Database Collection Error` eller en terskel på **Metric Groups Failed**. Gjør begge til varsler i stedet for hendelser: en tilbakekalt rettighet er en sak i køen, ikke et vaktanrop.

### "The user does not have permission to perform this action"

Dette er SQL Servers melding (Msg 297) for en pålogging som kan koble til, men ikke kan lese serverens tilstandsvisninger. Den betyr alltid en manglende rettighet, aldri en feil i databasen. SQL Server sender den som nummer to, etter en melding som nevner tillatelsen som ble avvist, og monitoren viser begge: for eksempel `VIEW SERVER STATE permission was denied on object 'server', database 'master'. The user does not have permission to perform this action.` Ved siden av står setningen som løser det for plattformen proben koblet til:

- **SQL Server eller Azure SQL Managed Instance** — `GRANT VIEW SERVER STATE TO oneuptime_health;`, kjørt i `master` (monitoren viser den som `GRANT VIEW SERVER STATE TO [<monitoring_login>]; -- run in master`).
- **Azure SQL Database** — `GRANT VIEW DATABASE STATE TO oneuptime_health;`, kjørt i den overvåkede databasen; på Basic, S0, S1 og elastiske pooler i stedet medlemskap i `##MS_ServerStateReader##`. Se [Azure SQL Database](#azure-sql-database).

Databasestørrelsen samles fortsatt inn i mellomtiden, fordi det er den eneste metrikken i gruppen Storage som enhver pålogging kan lese.

## Innsamlede metrikker

Førtien serier fordelt på åtte kategorier. Engines viser motorene som faktisk kan levere serien; på enhver annen motor mangler den rett og slett. Group er innsamlingsgruppen serien hører til — det du slår av og på, og det som svikter samlet.

### Tilgjengelighet

| Metrikk | Serie | Group | Engines |
|---|---|---|---|
| **Uptime** (s) | `oneuptime.monitor.database.uptime.seconds` | Connections | PostgreSQL, MySQL, SQL Server |
| **Metric Groups Failed** | `oneuptime.monitor.database.metric.groups.failed` | Connections | PostgreSQL, MySQL, SQL Server |

### Tilkoblinger

| Metrikk | Serie | Group | Engines |
|---|---|---|---|
| **Connections** | `oneuptime.monitor.database.connections.total` | Connections | PostgreSQL, MySQL, SQL Server |
| **Active Connections** | `oneuptime.monitor.database.connections.active` | Connections | PostgreSQL, MySQL, SQL Server |
| **Maximum Connections** | `oneuptime.monitor.database.connections.max` | Connections | PostgreSQL, MySQL |
| **Connections Used** (%) | `oneuptime.monitor.database.connections.used.percent` | Connections | PostgreSQL, MySQL |
| **Idle In Transaction** | `oneuptime.monitor.database.connections.idle.in.transaction` | Connections | PostgreSQL |
| **Aborted Connects** | `oneuptime.monitor.database.connections.aborted.total` | Connections | MySQL |

### Gjennomstrømning

| Metrikk | Serie | Group | Engines |
|---|---|---|---|
| **Transactions** | `oneuptime.monitor.database.transactions.total` | Throughput | PostgreSQL, SQL Server |
| **Queries** | `oneuptime.monitor.database.queries.total` | Throughput | MySQL, SQL Server |
| **Slow Queries** | `oneuptime.monitor.database.queries.slow.total` | Throughput | MySQL |
| **Rollback Ratio** (%) | `oneuptime.monitor.database.rollback.percent` | Throughput | PostgreSQL |
| **Longest Running Query** (s) | `oneuptime.monitor.database.query.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Longest Open Transaction** (s) | `oneuptime.monitor.database.transaction.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Open Transactions** | `oneuptime.monitor.database.transaction.open.count` | Activity | MySQL |

### Låser og blokkering

| Metrikk | Serie | Group | Engines |
|---|---|---|---|
| **Blocked Sessions** | `oneuptime.monitor.database.sessions.blocked` | Locks | PostgreSQL, MySQL, SQL Server |
| **Lock Waits** | `oneuptime.monitor.database.locks.waiting` | Locks | PostgreSQL, MySQL, SQL Server |
| **Deadlocks** | `oneuptime.monitor.database.deadlocks.total` | Locks | PostgreSQL, SQL Server |
| **Table Lock Waits** | `oneuptime.monitor.database.table.locks.waited.total` | Locks | MySQL |

Standard-MySQL har ingen teller for vranglåser i det hele tatt, og derfor finnes Deadlocks bare på PostgreSQL og SQL Server.

### Hurtigbuffer og I/O

| Metrikk | Serie | Group | Engines |
|---|---|---|---|
| **Cache Hit Ratio** (%) | `oneuptime.monitor.database.cache.hit.percent` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Reads** | `oneuptime.monitor.database.disk.reads.total` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Writes** | `oneuptime.monitor.database.disk.writes.total` | Throughput | MySQL, SQL Server |
| **I/O Read Time** (ms) | `oneuptime.monitor.database.io.read.time.ms` | Throughput | PostgreSQL, SQL Server |
| **I/O Write Time** (ms) | `oneuptime.monitor.database.io.write.time.ms` | Throughput | PostgreSQL, SQL Server |
| **Page Life Expectancy** (s) | `oneuptime.monitor.database.page.life.expectancy.seconds` | Throughput | SQL Server |
| **Memory Grants Pending** | `oneuptime.monitor.database.memory.grants.pending` | Throughput | SQL Server |

PostgreSQL måler bare lese- og skrivetid for I/O når `track_io_timing` er slått på. Den er slått av som standard, og da rapporterer PostgreSQL begge som `0` — på PostgreSQL betyr en flat null i de to seriene derfor som regel «ikke målt», ikke «rask». Det er en serverinnstilling, ikke et rettighetsproblem.

### Lagringsplass

| Metrikk | Serie | Group | Engines |
|---|---|---|---|
| **Database Size** (byte) | `oneuptime.monitor.database.size.bytes` | Storage | PostgreSQL, MySQL, SQL Server |
| **Temp Bytes Written** (byte) | `oneuptime.monitor.database.temp.bytes.total` | Storage | PostgreSQL |
| **Temp Disk Tables** | `oneuptime.monitor.database.temp.disk.tables.total` | Storage | MySQL |
| **Log Space Used** (%) | `oneuptime.monitor.database.log.space.used.percent` | Storage | SQL Server |
| **TempDB Free Space** (byte) | `oneuptime.monitor.database.tempdb.free.bytes` | Storage | SQL Server |

### Replikering

| Metrikk | Serie | Group | Engines |
|---|---|---|---|
| **Connected Replicas** | `oneuptime.monitor.database.replica.count` | Replication | PostgreSQL, SQL Server |
| **Replication Lag** (s) | `oneuptime.monitor.database.replication.lag.seconds` | Replication | PostgreSQL, MySQL |
| **Replication Lag (Bytes)** (byte) | `oneuptime.monitor.database.replication.lag.bytes` | Replication | PostgreSQL, SQL Server |
| **Is In Recovery** | `oneuptime.monitor.database.is.in.recovery` | Replication | PostgreSQL |
| **Inactive Replication Slots** | `oneuptime.monitor.database.replication.slots.inactive` | Replication | PostgreSQL |

Replikeringsmetrikker rapporteres fra den siden av koblingen monitoren er koblet til. Rett en monitor mot primærserveren for å se tilkoblede replikaer og sendekøen; rett én mot hver standby for å se hvor langt etter akkurat den standbyen faktisk ligger.

Forsinkelsen i sekunder står på null på en inaktiv primærserver selv når en replika ligger langt etter, fordi ingenting nytt er skrevet. **Replication Lag (Bytes)** har ikke den blindsonen, så varsle på begge.

### Vedlikehold

| Metrikk | Serie | Group | Engines |
|---|---|---|---|
| **Transaction ID Used** (%) | `oneuptime.monitor.database.transaction.id.used.percent` | Maintenance | PostgreSQL |
| **Dead Tuples** | `oneuptime.monitor.database.dead.tuples` | Maintenance | PostgreSQL |
| **Tables Never Autovacuumed** | `oneuptime.monitor.database.tables.never.autovacuumed` | Maintenance | PostgreSQL |
| **Requested Checkpoints** | `oneuptime.monitor.database.checkpoints.requested.total` | Maintenance | PostgreSQL |
| **Timed Checkpoints** | `oneuptime.monitor.database.checkpoints.timed.total` | Maintenance | PostgreSQL |

> [!IMPORTANT]
> **Transaction ID Used** fortjener et kriterium på hver PostgreSQL-monitor du oppretter. PostgreSQL avviser alle skrivinger når verdien når 100 %, gjenoppretting betyr en vacuum i enbrukermodus med databasen nede, og nesten ingen følger med på den. Varsle i god tid før stupet — 80 % gir dager med margin for de fleste arbeidslaster.

Tellere som slutter på `total`, er kumulative siden serveren startet. Sammenlign to tidspunkter for å få en rate; én enkelt verdi gir bare mening sammenlignet med sin egen historikk, og den nullstilles når serveren starter på nytt (noe **Uptime** viser deg).

## Sett opp kriterier

| Filtertype | Hva den sjekker |
|---|---|
| **Database Is Online** | Om databasen kunne nås og testspørringen lyktes. Dette er offline-kriteriet monitoren opprettes med, og den eneste kontrollen som gjenspeiler tilgjengeligheten. |
| **Database Metric** | Velg en metrikk og sammenlign den: Greater Than, Less Than, Greater Than Or Equal To, Less Than Or Equal To, Equal To eller Not Equal To. Metrikkvelgeren tilbyr bare metrikkene den valgte motoren kan levere, så du kan ikke bygge et kriterium som for alltid forblir uoppfylt (ett unntak: Replication-metrikkene som tilbys for Microsoft SQL Server, samles aldri inn på Azure SQL Database). Hvis metrikken ikke ble samlet inn ved en kontroll — gruppen feilet, eller motoren rapporterer den ikke — samsvarer ikke filteret, og det samsvarer heller ikke som «false»: det hoppes over. Et rettighetsproblem kan ikke tilkalle noen. |
| **Database Collection Error** | Sammendraget av innsamlingsproblemene ved kontrollen, én «gruppe: melding» per utilgjengelig gruppe. Varsle når det ikke er tomt for å oppdage tapt innsyn, eller bruk Contains for å følge med på én bestemt gruppe. |
| **JavaScript Expression** | Full kontroll. Se [JavaScript-uttrykk](/docs/monitor/javascript-expression). |

Terskler er heltall. Skriv `90`, ikke `90.5` — prosenter og sekunder sammenlignes som heltall.

**Database Is Online** og **Database Metric** kan kontrolleres over tid: kryss av for **Evaluer disse kriteriene over en tidsperiode**, velg deretter under **Evaluer** hvordan verdiene skal vurderes (for eksempel **All Values**), og fyll inn **For de siste (i minutter)**. Over tid avgjør filterets innstilling **Hvis ingen data** hva en manglende verdi betyr; la den stå på **Ignore**, slik at en manglende rettighet fortsatt ikke kan tilkalle noen.

### Variabler for JavaScript-uttrykk

For en Database Health-monitor har uttrykket tilgang til:

| Variabel | Type | Beskrivelse |
|---|---|---|
| `isOnline` | boolean | Om både tilkoblingen og testspørringen lyktes |
| `engineVersion` | string | Versjonsstrengen serveren rapporterte (på SQL Server den rene `ProductVersion`; monitorens sammendrag nevner plattformen ved siden av) |
| `connectionError` | string | Renset tilkoblingsfeil, tom når det ikke var noen |
| `collectedGroups` | array | Gruppene som leverte verdier ved denne kontrollen |
| `unavailableGroups` | array | Gruppene med en setning som ikke kunne samles inn, hver med en årsak og en løsning. En delvis innsamlet gruppe står i begge listene |
| `metrics` | object | De innsamlede verdiene med serienavnet som nøkkel; en serie som ikke ble samlet inn, mangler |

```javascript
{{isOnline}} === true && {{collectedGroups}}.length >= 5
```

For å lese én metrikk i et uttrykk indekserer du hele `metrics`-objektet — serienavnene inneholder punktum og kan derfor ikke stå inne i krøllparentesene:

```javascript
{{metrics}}['oneuptime.monitor.database.connections.used.percent'] > 90
```

For en terskel på én enkelt metrikk bør du bruke **Database Metric** fremfor et uttrykk: det slår opp serien for deg, tilbyr bare det motoren din kan levere, og hopper over kontrollen når verdien ikke ble samlet inn, i stedet for å sammenligne med ingenting.

### Eksempel: en primær PostgreSQL-server

| Rekkefølge | Kriterier | Filter |
|---|---|---|
| 1 | **Frakoblet** | `Database Is Online` er `false`. |
| 2 | **Redusert** | `Database Metric` → Connections Used er større enn `90`, evaluert over 5 minutter med All Values, slik at én enkelt topp ikke tilkaller noen. |
| 3 | **Redusert** | `Database Metric` → Transaction ID Used er større enn `80`. |
| 4 | **Redusert** | `Database Metric` → Blocked Sessions er større enn `0`, over 5 minutter. |
| 5 | **Online** | `Database Is Online` er `true`. |

Kriteriene evalueres ovenfra og ned, og det første treffet vinner, så sett varslingskriteriene først og det friske sist.

Knytt en vaktpolicy til offline-kriteriet, og la alt som er avledet av **Metric Groups Failed** eller `Database Collection Error`, være et varsel uten tilknyttet vaktpolicy.

## Dette bør du tenke på

- **Spørringene kjøres ved hver kontroll.** De er billige med vilje, men «billig» er relativt til intervallet. Et intervall på ett minutt mot en server med tusenvis av økter betyr flere gjennomganger av `pg_stat_activity` enn du kanskje ønsker; fem minutter er mer enn nok for kapasitetsmetrikker.
- **Rett monitoren mot databasen du bryr deg om.** Størrelse, treffrate i hurtigbufferen og utskriving til midlertidige filer gjelder per database. Tilkoblinger, oppetid og replikering gjelder per server og viser det samme fra hvilken som helst database på den instansen.
- **Én monitor per instans, ikke per database**, med mindre du spesifikt vil ha størrelses- og hurtigbuffermetrikker per database — ellers mangedobler du spørringene på servernivå uten ny informasjon. Azure SQL Database er unntaket: den rapporterer tilkoblinger per database, så der overvåker du hver database.
- **Varsle på rater, ikke på tellere.** Alt som slutter på `total`, går bare oppover, så en «større enn»-terskel på det utløses én gang og blir aldri normal igjen. Vis det i en graf, eller sammenlign det over et tidsvindu.
- **Velg heller en monitorhemmelighet enn et passord i klartekst.** Påloggingsinformasjonen forblir da kryptert når den er lagret, og vises aldri på monitoren.
- **Monitoren skriver aldri.** Hver spørring er en lesing fra en statistikkvisning — på PostgreSQL i en skrivebeskyttet transaksjon, på MySQL i en skrivebeskyttet økt. Det den ikke kan lese, rapporteres som en manglende metrikk, aldri som et brudd.

## Feilsøking

:::details Monitoren er frakoblet, men databasen kjører
Frakoblet betyr at proben ikke kunne koble til, eller at testspørringen feilet: verten eller porten kan ikke nås fra proben, påloggingen ble avvist, TLS feilet eller tilkoblingen fikk tidsavbrudd. Monitorens sammendrag viser feilen. Sjekk at proben kan nå databasen (en probe som OneUptime drifter, trenger en offentlig adresse; bruk ellers en [egendefinert probe](/docs/probe/custom-probe)), sjekk brukernavnet og passordet eller monitorhemmeligheten for det, og slå av **Verify server certificate** for et selvsignert sertifikat. Klikk deretter på **Test monitor** for å sjekke igjen.
:::

:::details Connections, Activity og Locks mangler på PostgreSQL
Påloggingen er verken medlem av `pg_monitor` eller `pg_read_all_stats` og er ikke superbruker, så proben hopper over de gruppene i stedet for å registrere feil tall. Kjør `GRANT pg_monitor TO oneuptime_health;` slik det er beskrevet under [PostgreSQL](#postgresql).
:::

:::details Connections, Throughput og Locks mangler på MySQL
Enten mangler påloggingen `SELECT` på `performance_schema`, eller så er `performance_schema` slått av på serveren; monitorens sammendrag viser meldingen fra MySQL. Ved en manglende rettighet kjører du setningene under [MySQL](#mysql). En avslått `performance_schema` krever `performance_schema = ON` i serverens konfigurasjon og en omstart.
:::

:::details I/O Read Time og I/O Write Time er alltid 0 på PostgreSQL
PostgreSQL måler dem bare når `track_io_timing` er slått på, og den er slått av som standard. Slå den på i serverens konfigurasjon, eller i parametergruppen til den administrerte tjenesten din, for å se ekte verdier. Det er ikke en manglende rettighet.
:::

:::details Metric Groups Failed er over 0 ved hver kontroll
En gruppe kan ikke samles inn ved noen kontroll, så det samme innsamlingsproblemet gjentar seg. Monitorens sammendrag nevner gruppen, årsaken og `GRANT`-en som løser det. Kjør rettigheten, eller, hvis du ikke får den, slå av den gruppen under **Metric Groups**, slik at problemet slutter å gjenta seg.
:::

## Neste steg

:::cards
- [SQL-spørring-overvåking](/docs/monitor/sql-monitor): Varsle om resultatet av din egen spørring, ved siden av serverens helse.
- [Databaser](/docs/telemetry/databases): Se hver databases metrikker, logger og kallere på én side.
- [Overvåkingshemmeligheter](/docs/monitor/monitor-secrets): Hold passordet til overvåkingsbrukeren kryptert.
- [Egendefinerte probes](/docs/probe/custom-probe): Nå en database inne i nettverket ditt.
:::

# Monitor stato database

Il monitor Database Health si connette a PostgreSQL, MySQL o Microsoft SQL Server a intervalli regolari e riporta i segnali di salute del server stesso — margine di connessioni, sessioni bloccate, ritardo di replica, cache hit ratio, dimensione del database, wraparound degli ID di transazione e una trentina di altri — così puoi impostare avvisi su di essi come li imposti quando un sito web non risponde.

Non scrivi SQL. La sonda esegue un insieme fisso di query di catalogo in sola lettura, scelto in base al motore, e riporta un piccolo insieme di numeri con un nome.

:::cards
- [Crea un utente di monitoraggio](#crea-un-utente-di-monitoraggio): I permessi di cui ha bisogno ogni motore. È il passaggio che conta di più.
- [Crea il monitor](#crea-un-monitor-database-health): Punta una sonda al database e scegli cosa raccogliere.
- [Metriche raccolte](#metriche-raccolte): Ogni serie, con i motori che la riportano.
- [Imposta i criteri](#imposta-i-criteri): Avvisi su connessioni, blocchi, ritardo e wraparound.
:::

## Database Health o SQL Query?

I due tipi di monitor per database rispondono a domande diverse e sono pensati per essere usati insieme.

| | Database Health | [SQL Query](/docs/monitor/sql-monitor) |
|---|---|---|
| Domanda a cui risponde | "Il database in sé è in salute?" | "I miei dati sono quelli che mi aspetto?" |
| Query | Integrata, per motore, in sola lettura | La tua |
| Riporta | Metriche numeriche con nome (vedi [Metriche raccolte](#metriche-raccolte)) | Numero di righe, valore scalare, prima riga, tempo di esecuzione |
| Avviso tipico | Connessioni usate oltre il 90% | Più di 50 ordini annullati negli ultimi cinque minuti |
| Permessi necessari | Lettura di statistiche/DMV — vedi [Crea un utente di monitoraggio](#crea-un-utente-di-monitoraggio) | `SELECT` sulle tabelle toccate dalla tua query |

Se vuoi un avviso su una condizione di business, usa il monitor SQL Query. Se vuoi sapere che il server sta esaurendo le connessioni prima ancora che la condizione di business possa fallire, usa questo.

## Database supportati

| Database | Porta predefinita |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

Azure SQL Database e Azure SQL Managed Instance si connettono come **Microsoft SQL Server**. Richiedono permessi diversi — vedi [Crea un utente di monitoraggio](#crea-un-utente-di-monitoraggio).

I motori compatibili con PostgreSQL e MySQL che parlano lo stesso protocollo di rete di solito funzionano, ma possono esporre meno viste di statistiche; in quel caso le metriche interessate vengono segnalate come non disponibili invece di essere raccolte. Solo i tre motori qui sopra sono testati ufficialmente.

Ogni database usato dalle tue applicazioni, dai tuoi cluster e dai tuoi host — questi tre motori e molti altri — ha anche una propria pagina con le metriche del motore, i log e i servizi che lo chiamano: vedi [Database](/docs/telemetry/databases). Quando host e porta a cui si connette un monitor Database Health sono uno degli endpoint di un database, gli avvisi e gli incidenti del monitor compaiono anche nella pagina di quel database (vedi [Avvisi su un database](/docs/telemetry/databases#alerts-on-a-database)).

## Come funziona

A ogni controllo, una sonda:

1. Si connette al database con le credenziali che configuri.
2. Esegue una query di prova leggera. **È l'unica istruzione il cui fallimento può mandare il monitor offline.**
3. Esegue le query di catalogo di ogni [gruppo di metriche](#gruppi-di-metriche) attivo, una alla volta, ciascuna con un timeout di istruzione.
4. Riporta i numeri raccolti, più una nota per ogni gruppo che non è riuscita a raccogliere, con il motivo.

```mermaid title="Un controllo, e l'unico passaggio che può mandare il monitor offline"
flowchart TB
    connect["Connessione al database"] --> probe{"Query di prova OK?"}
    probe -->|"No"| offline["Monitor offline"]
    probe -->|"Sì"| groups["Esegui ogni gruppo di metriche"]
    groups --> group{"Gruppo raccolto?"}
    group -->|"Sì"| metrics["Metriche riportate"]
    group -->|"No"| issue["Metriche assenti, problema annotato"]
    metrics --> criteria["Criteri valutati"]
    issue --> criteria
```

A OneUptime vengono inviati solo aggregati numerici con un nome. Nessun testo di query, nessuna riga delle tue tabelle e nessun nome di schema lascia la tua rete: le query leggono le viste di statistiche del motore stesso (`pg_stat_activity`, `performance_schema.global_status`, `sys.dm_exec_sessions` e simili), mai i tuoi dati.

Poiché il controllo parte da una sonda, il database deve essere raggiungibile solo dalla sonda. Metti una [sonda personalizzata](/docs/probe/custom-probe) nella tua rete e OneUptime non avrà mai bisogno di una route verso il database.

## Prima di iniziare

- Una **sonda** con accesso di rete all'host e alla porta del database. Usa una sonda ospitata da OneUptime se il database è raggiungibile da internet, altrimenti una [sonda personalizzata](/docs/probe/custom-probe) nella tua rete.
- Un **utente di monitoraggio**, creato come descritto nella sezione successiva, e i suoi dati di connessione.

## Crea un utente di monitoraggio

**Questo è il passaggio più importante.** Il monitor legge viste di statistiche che i login normali non possono vedere, e un login con privilegi insufficienti non sempre fallisce con un errore: su PostgreSQL dà una risposta sbagliata. Crea un login dedicato con esattamente questi permessi e nient'altro.

### PostgreSQL

```sql
CREATE USER oneuptime_health WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE mydb TO oneuptime_health;
-- The one grant that matters. Without it, see the note below.
GRANT pg_monitor TO oneuptime_health;
```

`pg_monitor` è un ruolo integrato (PostgreSQL 10 e successivi) che concede l'accesso in lettura alle viste di statistiche e di monitoraggio. Non concede alcun accesso alle tue tabelle.

> [!IMPORTANT]
> **Perché `pg_monitor` non è facoltativo su PostgreSQL.** Senza questo ruolo, `pg_stat_activity` non fallisce: la query riesce e restituisce solo la riga della sessione di monitoraggio stessa. Il numero di connessioni segnerebbe `1`, le sessioni bloccate `0` e il ritardo di replica `0`, per sempre, su un server che in realtà sta andando a fuoco. Per questo la sonda controlla, **prima** di eseguire quelle query, che il login sia membro di `pg_monitor` (o di `pg_read_all_stats`) oppure superuser. Se non è nessuna di queste cose, la sonda segnala i gruppi Connections, Activity e Locks come non disponibili, insieme al `GRANT` che ti serve. Non riportare nulla è la risposta onesta; riportare `1` non lo è.

Su un servizio gestito in cui `pg_monitor` non è disponibile, `pg_read_all_stats` copre le stesse viste. Su Amazon RDS non serve `GRANT rds_superuser`: `GRANT pg_monitor TO oneuptime_health;` funziona come membro di `rds_superuser`.

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

Il `performance_schema` di MySQL deve essere attivo (`performance_schema = ON`, il valore predefinito dalla 5.6). Se è disattivato, i gruppi Connections, Throughput e Locks risultano non disponibili e la soluzione è un riavvio del server, non un permesso.

### Microsoft SQL Server e Azure SQL Managed Instance

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

Eseguito da qualunque altro database, `GRANT VIEW SERVER STATE` fallisce con Msg 4621, "Permissions at the server scope can only be granted when the current database is master".

> [!WARNING]
> **L'accesso in lettura alle tue tabelle non basta.** Un login che può solo leggere dati — `db_datareader` o qualsiasi altro ruolo di "accesso in lettura" — può connettersi e ottiene la dimensione del database, nient'altro. SQL Server rifiuta le viste lette dal monitor con `The user does not have permission to perform this action.` (Msg 297). Il messaggio precedente indica cosa è stato rifiutato: Msg 300 `VIEW SERVER STATE` (`VIEW SERVER PERFORMANCE STATE` su 2022) per le viste del server, compresi lo spazio del log delle transazioni e lo spazio libero di tempdb, oppure Msg 262 `VIEW DATABASE STATE` (`VIEW DATABASE PERFORMANCE STATE` su 2022) per la vista della replica. Il monitor resta online, segnala che ai gruppi Connections, Activity, Throughput, Locks, Storage e Replication manca un permesso e mostra accanto il `GRANT` qui sopra. `VIEW SERVER STATE` li copre tutti.
>
> Due viste non rifiutano: senza il permesso, `sys.dm_exec_sessions` e `sys.dm_exec_requests` mostrano in silenzio solo la sessione del monitor stesso. Il monitor non le legge mai da sole, ma sempre insieme a una vista che rifiuta, quindi un permesso mancante non può mai essere registrato come "1 connessione".

### Azure SQL Database

Azure SQL Database non ha autorizzazioni a livello di server — lì `GRANT VIEW SERVER STATE` fallisce — quindi le stesse viste vengono aperte da un permesso a livello di database. Crea un login in `master`, dagli un utente nel database che monitori e concedi il permesso lì, non in `master`:

```sql
-- Connected to master, as the server admin:
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';

-- Connected to the monitored database:
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
GRANT VIEW DATABASE STATE TO oneuptime_health;
```

Questo basta sui database vCore e sui database DTU da S2 in su. Su **Basic, S0 e S1**, e per qualsiasi database in un **pool elastico**, Azure lascia leggere queste viste solo all'amministratore del server, all'amministratore Microsoft Entra o ai membri del ruolo server `##MS_ServerStateReader##`, qualunque cosa dicano i permessi del database. In quei casi l'amministratore del server aggiunge anche il login a quel ruolo:

```sql
-- Connected to master, as the server admin:
ALTER SERVER ROLE ##MS_ServerStateReader## ADD MEMBER oneuptime_health;
```

`##MS_ServerStateReader##` funziona su tutti i livelli di servizio, quindi è anche la soluzione di riserva se `VIEW DATABASE STATE` si rivela insufficiente. Una nuova appartenenza a un ruolo può richiedere qualche minuto per essere applicata e vale solo per le nuove connessioni; la sonda apre una nuova connessione a ogni controllo.

Un utente di database indipendente (`CREATE USER oneuptime_health WITH PASSWORD = '...'` nel database monitorato, senza login) funziona con `VIEW DATABASE STATE` da S2 in su, ma non può entrare in `##MS_ServerStateReader##`: i ruoli server accettano solo login. Per spostare un utente indipendente nel ruolo, eliminalo (`DROP USER oneuptime_health;`) e segui le istruzioni qui sopra.

La sonda riconosce Azure SQL Database da `SERVERPROPERTY('EngineEdition')` e non dalla versione: Azure SQL Database riporta `12.0.2000.8` qualunque versione esegua davvero, che si legge come SQL Server 2014. Per questo l'**Engine** del monitor indica `Azure SQL Database 12.0.2000.8`, e un permesso mancante viene mostrato come l'istruzione Azure qui sopra, mai come `VIEW SERVER STATE`.

- **La replica non viene raccolta su Azure SQL Database.** Azure SQL Database non ha `sys.dm_hadr_database_replica_states`, quindi lì il gruppo Replication viene saltato invece di essere segnalato come fallito a ogni controllo. Le viste di replica proprie di Azure (`sys.dm_database_replica_states`, `sys.dm_geo_replication_link_status`) non vengono ancora lette.
- **Le connessioni sono per database.** Con `VIEW DATABASE STATE`, Azure SQL Database mostra solo le sessioni del database monitorato, quindi Connections conta quel database e non il server logico. Monitora ogni database che ti interessa.
- **In un pool elastico, TempDB Free Space è quello del pool.** I database di un pool condividono un'unica tempdb.

## Crea un monitor Database Health

:::steps
### Inizia un nuovo monitor

Vai su **Monitor** e fai clic su **Crea monitor**. In **Tipo di monitor**, fai clic su **Altri tipi di monitor** e scegli **Database Health** in **Database Monitoring**, oppure digita `health` nella casella di ricerca. Inserisci un **Nome**, poi fai clic su **Avanti**.

### Inserisci i dati di connessione

Scegli il **Database Type**, poi compila host, porta, nome del database e le credenziali dell'utente di monitoraggio. Fai riferimento alla password come [segreto del monitor](#usare-un-segreto-del-monitor-per-la-password) invece di digitarla. Ogni campo è descritto in [Configurazione](#configurazione).

### Scegli cosa raccogliere

Lascia attivo ogni gruppo in **Metric Groups**, a meno che tu non abbia un motivo per disattivarne uno — vedi [Gruppi di metriche](#gruppi-di-metriche).

### Testa la connessione

Fai clic su **Testa il monitor** per eseguire un controllo prima di salvare e leggi cosa ha raccolto.

### Definisci i criteri

Controlla i criteri con cui parte il monitor e aggiungi i tuoi — vedi [Imposta i criteri](#imposta-i-criteri). Poi fai clic su **Avanti**.

### Scegli le sonde e crea

Seleziona le **Sonde** che raggiungono il database e un **Intervallo di monitoraggio**, poi fai clic su **Crea monitor**.
:::

## Configurazione

| Campo | Cosa inserire |
|---|---|
| **Database Type** | PostgreSQL, MySQL o Microsoft SQL Server. La scelta del tipo imposta la porta predefinita e decide quali query vengono eseguite. |
| **Host** | L'host del database raggiungibile dalla sonda (ad esempio `db.internal`). |
| **Porta** | La porta del database. |
| **Nome del database** | Il database a cui connettersi. Le metriche a livello di database (dimensione, cache hit ratio, scritture su file temporanei) vengono riportate per questo database; quelle a livello di server (connessioni, uptime, replica) per l'intero server, tranne su Azure SQL Database, dove le connessioni vengono contate solo per il database monitorato. |
| **Use Windows Integrated Authentication** | Solo Microsoft SQL Server. Autentica con l'identità del processo della sonda invece che con nome utente e password. Vedi [Autenticazione integrata di Windows](/docs/monitor/sql-monitor#autenticazione-integrata-di-windows) nella pagina del monitor SQL Query: la configurazione è identica. |
| **Nome utente** | L'utente di monitoraggio. Obbligatorio, a meno che tu non usi l'autenticazione integrata di Windows. |
| **Password** | La password. Fai riferimento a un [segreto del monitor](/docs/monitor/monitor-secrets) con `{{monitorSecrets.name}}` invece di digitarla in chiaro (vedi [Usare un segreto del monitor](#usare-un-segreto-del-monitor-per-la-password)). |
| **Use SSL/TLS** | Connessione tramite TLS. Quando è attivo puoi disattivare **Verify server certificate** per un certificato autofirmato. |
| **Metric Groups** | Quali gruppi eseguire: Connections, Attività, Throughput, Locks and Blocking, Archiviazione, Replication e Manutenzione. Sono tutti attivi per impostazione predefinita; vedi [Gruppi di metriche](#gruppi-di-metriche). I dettagli del monitor li elencano come **Collected Metric Groups**. |

### Altri campi

| Campo | Predefinito | Massimo | Cosa limita |
|---|---|---|---|
| **Connection Timeout (ms)** | `10000` | `30000` | Quanto attendere per stabilire una connessione. |
| **Statement Timeout (ms)** | `10000` | `60000` | Il limite di ogni singola query di catalogo. |

Il timeout di istruzione predefinito è volutamente più stretto di quello del monitor SQL Query: queste query rispondono in millisecondi su un server sano, quindi se `pg_stat_activity` impiega dieci secondi il segnale utile è "questo server è in difficoltà", non un'attesa più lunga. Un valore oltre il massimo viene ridotto al massimo.

## Usare un segreto del monitor per la password

Per non salvare mai la password in chiaro sul monitor:

:::steps
1. Vai su **Monitor → Impostazioni → Segreti** e crea un [segreto del monitor](/docs/monitor/monitor-secrets).
2. Dagli un nome (ad esempio `dbPassword`) e dai a questo monitor l'accesso al segreto.
3. Nel campo **Password** del monitor, inserisci `{{monitorSecrets.dbPassword}}`.
:::

Il segreto viene risolto lato server prima che la configurazione sia consegnata a una sonda. I campi Host, Nome utente e Nome del database accettano lo stesso riferimento. Le credenziali non vengono mai scritte in log, feed del monitor o modelli di avviso.

## Gruppi di metriche

Un gruppo è un'unità che attivi o disattivi, e l'unità per cui viene segnalato un permesso mancante. I gruppi esistono perché un permesso mancante ti costi un gruppo e non l'intero monitor. Le istruzioni di un gruppo vengono eseguite una alla volta, quindi un gruppo può essere raccolto in parte: in quel caso compare sia in `collectedGroups` sia in `unavailableGroups`. Il caso tipico è il gruppo Storage di SQL Server per un login senza `VIEW SERVER STATE`: la dimensione del database viene raccolta, lo spazio del log e lo spazio libero di tempdb no.

| Gruppo | Cosa raccoglie | Richiede |
|---|---|---|
| Connections | Numero di connessioni, limite configurato, connessioni interrotte, uptime del server | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Activity | Query in esecuzione più lunga, transazione aperta più lunga, transazioni aperte | PostgreSQL: `pg_monitor`. MySQL: `PROCESS`. SQL Server: `VIEW SERVER STATE` |
| Throughput | Transazioni, query, cache hit ratio, letture e scritture su disco, tempo di I/O | PostgreSQL: niente oltre a `CONNECT`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Locks | Sessioni bloccate, attese di lock, deadlock, attese di lock sulle tabelle | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Storage | Dimensione del database, scritture su file temporanei, spazio del log, spazio libero di tempdb | PostgreSQL: niente oltre a `CONNECT`. MySQL: `SELECT` sul database. SQL Server: niente per la dimensione del database; `VIEW SERVER STATE` per lo spazio del log e lo spazio libero di tempdb |
| Replication | Repliche connesse, ritardo di replica in secondi e in byte, slot inattivi, stato di recovery | PostgreSQL: `pg_monitor`. MySQL: `REPLICATION CLIENT`. SQL Server: `VIEW SERVER STATE`; non raccolto su Azure SQL Database |
| Maintenance | Margine prima del wraparound degli ID di transazione, tuple morte, tabelle mai passate da autovacuum, checkpoint | PostgreSQL: `pg_monitor` |

Su Azure SQL Database, leggi `VIEW DATABASE STATE` ovunque questa tabella dica `VIEW SERVER STATE`, oppure `##MS_ServerStateReader##` su Basic, S0, S1 e pool elastici. Vedi [Azure SQL Database](#azure-sql-database).

Disattivare un gruppo è silenzioso: niente metriche, nessun problema di raccolta, nessun avviso. È la scelta giusta in due casi:

- **Non riesci a ottenere il permesso.** Disattivare il gruppo evita che il problema di raccolta si ripeta a ogni controllo.
- **Le query costano troppo.** Su MySQL, **Archiviazione** è il candidato tipico: la dimensione del database si ottiene sommando `information_schema.TABLES`, cosa che su uno schema con decine di migliaia di tabelle non è gratuita e viene eseguita a ogni controllo. Disattivalo, oppure porta quel monitor a un intervallo di cinque minuti.

Deselezionare tutti i gruppi non è un modo per non raccogliere nulla: un elenco vuoto viene riportato a tutti i gruppi, così un monitor non può mai essere salvato in uno stato in cui non raccoglie nulla senza dirlo.

## Cosa succede quando una metrica non può essere raccolta

**Un permesso mancante non manda mai il monitor offline.** È il comportamento più importante di questo tipo di monitor, e vale la pena descriverlo con precisione.

| Cosa fallisce | Stato del monitor | Cosa vedi |
|---|---|---|
| **La connessione**, o la query di prova: credenziali errate, connessione rifiutata, errore TLS, timeout di connessione | **Offline** | `Database Is Online` è false, e scattano l'incidente e la policy di reperibilità che ci hai collegato. |
| **Un gruppo**: un permesso mancante, un `performance_schema` disattivato, un timeout di istruzione | **Resta online** | Le metriche che quel gruppo non è riuscito a leggere sono **assenti**, non a zero. Non viene disegnata alcuna linea nel grafico, nessuna soglia su quelle serie può scattare e da esse non può nascere alcun incidente. Il controllo registra un problema di raccolta che indica il gruppo, il motivo e, quando c'è, l'esatto `GRANT` da eseguire; viene mostrato nel riepilogo del monitor e conteggiato in **Metric Groups Failed**. |
| **Il motore non può produrre affatto la metrica**: MySQL standard non ha un contatore di deadlock; SQL Server lascia illimitato per impostazione predefinita il limite di connessioni, quindi una "percentuale usata" non avrebbe senso | **Resta online** | La metrica è semplicemente assente. **Non** è un problema di raccolta, non conta in Metric Groups Failed e non c'è niente da correggere. Vedi la colonna Engines in [Metriche raccolte](#metriche-raccolte). |

Assente significa sempre assente. Un valore che non è stato misurato non viene mai riportato come `0`, perché un grafico di zeri inventati è peggio di un buco: un buco lo puoi vedere.

> [!TIP]
> Per un avviso sulla perdita di visibilità, usa `Database Collection Error` o una soglia su **Metric Groups Failed**. Rendi entrambi avvisi e non incidenti: un permesso revocato è un ticket, non una chiamata di reperibilità.

### "The user does not have permission to perform this action"

È il messaggio di SQL Server (Msg 297) per un login che può connettersi ma non può leggere le viste di stato del server. Indica sempre un permesso mancante, mai un guasto del database. SQL Server lo invia per secondo, dopo un messaggio che indica l'autorizzazione rifiutata, e il monitor li mostra entrambi: ad esempio `VIEW SERVER STATE permission was denied on object 'server', database 'master'. The user does not have permission to perform this action.` Accanto c'è l'istruzione che lo risolve per la piattaforma a cui si è connessa la sonda:

- **SQL Server o Azure SQL Managed Instance**: `GRANT VIEW SERVER STATE TO oneuptime_health;`, eseguito in `master` (il monitor lo mostra come `GRANT VIEW SERVER STATE TO [<monitoring_login>]; -- run in master`).
- **Azure SQL Database**: `GRANT VIEW DATABASE STATE TO oneuptime_health;`, eseguito nel database monitorato; su Basic, S0, S1 e pool elastici, invece, l'appartenenza a `##MS_ServerStateReader##`. Vedi [Azure SQL Database](#azure-sql-database).

Nel frattempo la dimensione del database continua a essere raccolta, perché è l'unica metrica del gruppo Storage che qualsiasi login può leggere.

## Metriche raccolte

Quarantuno serie in otto categorie. Engines elenca i motori che possono davvero produrre la serie; su qualsiasi altro motore è semplicemente assente. Group è il gruppo di raccolta a cui appartiene la serie: è ciò che attivi o disattivi e ciò che si degrada insieme.

### Disponibilità

| Metrica | Serie | Group | Engines |
|---|---|---|---|
| **Uptime** (s) | `oneuptime.monitor.database.uptime.seconds` | Connections | PostgreSQL, MySQL, SQL Server |
| **Metric Groups Failed** | `oneuptime.monitor.database.metric.groups.failed` | Connections | PostgreSQL, MySQL, SQL Server |

### Connessioni

| Metrica | Serie | Group | Engines |
|---|---|---|---|
| **Connections** | `oneuptime.monitor.database.connections.total` | Connections | PostgreSQL, MySQL, SQL Server |
| **Active Connections** | `oneuptime.monitor.database.connections.active` | Connections | PostgreSQL, MySQL, SQL Server |
| **Maximum Connections** | `oneuptime.monitor.database.connections.max` | Connections | PostgreSQL, MySQL |
| **Connections Used** (%) | `oneuptime.monitor.database.connections.used.percent` | Connections | PostgreSQL, MySQL |
| **Idle In Transaction** | `oneuptime.monitor.database.connections.idle.in.transaction` | Connections | PostgreSQL |
| **Aborted Connects** | `oneuptime.monitor.database.connections.aborted.total` | Connections | MySQL |

### Throughput

| Metrica | Serie | Group | Engines |
|---|---|---|---|
| **Transactions** | `oneuptime.monitor.database.transactions.total` | Throughput | PostgreSQL, SQL Server |
| **Queries** | `oneuptime.monitor.database.queries.total` | Throughput | MySQL, SQL Server |
| **Slow Queries** | `oneuptime.monitor.database.queries.slow.total` | Throughput | MySQL |
| **Rollback Ratio** (%) | `oneuptime.monitor.database.rollback.percent` | Throughput | PostgreSQL |
| **Longest Running Query** (s) | `oneuptime.monitor.database.query.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Longest Open Transaction** (s) | `oneuptime.monitor.database.transaction.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Open Transactions** | `oneuptime.monitor.database.transaction.open.count` | Activity | MySQL |

### Lock e blocchi

| Metrica | Serie | Group | Engines |
|---|---|---|---|
| **Blocked Sessions** | `oneuptime.monitor.database.sessions.blocked` | Locks | PostgreSQL, MySQL, SQL Server |
| **Lock Waits** | `oneuptime.monitor.database.locks.waiting` | Locks | PostgreSQL, MySQL, SQL Server |
| **Deadlocks** | `oneuptime.monitor.database.deadlocks.total` | Locks | PostgreSQL, SQL Server |
| **Table Lock Waits** | `oneuptime.monitor.database.table.locks.waited.total` | Locks | MySQL |

MySQL standard non espone alcun contatore di deadlock, ecco perché Deadlocks esiste solo su PostgreSQL e SQL Server.

### Cache e I/O

| Metrica | Serie | Group | Engines |
|---|---|---|---|
| **Cache Hit Ratio** (%) | `oneuptime.monitor.database.cache.hit.percent` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Reads** | `oneuptime.monitor.database.disk.reads.total` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Writes** | `oneuptime.monitor.database.disk.writes.total` | Throughput | MySQL, SQL Server |
| **I/O Read Time** (ms) | `oneuptime.monitor.database.io.read.time.ms` | Throughput | PostgreSQL, SQL Server |
| **I/O Write Time** (ms) | `oneuptime.monitor.database.io.write.time.ms` | Throughput | PostgreSQL, SQL Server |
| **Page Life Expectancy** (s) | `oneuptime.monitor.database.page.life.expectancy.seconds` | Throughput | SQL Server |
| **Memory Grants Pending** | `oneuptime.monitor.database.memory.grants.pending` | Throughput | SQL Server |

PostgreSQL misura i tempi di lettura e scrittura di I/O solo quando `track_io_timing` è attivo. Per impostazione predefinita è disattivato, e allora PostgreSQL riporta entrambi come `0`: su PostgreSQL uno zero piatto in queste due serie di solito significa "non misurato", non "veloce". È un'impostazione del server, non un problema di permessi.

### Spazio di archiviazione

| Metrica | Serie | Group | Engines |
|---|---|---|---|
| **Database Size** (byte) | `oneuptime.monitor.database.size.bytes` | Storage | PostgreSQL, MySQL, SQL Server |
| **Temp Bytes Written** (byte) | `oneuptime.monitor.database.temp.bytes.total` | Storage | PostgreSQL |
| **Temp Disk Tables** | `oneuptime.monitor.database.temp.disk.tables.total` | Storage | MySQL |
| **Log Space Used** (%) | `oneuptime.monitor.database.log.space.used.percent` | Storage | SQL Server |
| **TempDB Free Space** (byte) | `oneuptime.monitor.database.tempdb.free.bytes` | Storage | SQL Server |

### Replica

| Metrica | Serie | Group | Engines |
|---|---|---|---|
| **Connected Replicas** | `oneuptime.monitor.database.replica.count` | Replication | PostgreSQL, SQL Server |
| **Replication Lag** (s) | `oneuptime.monitor.database.replication.lag.seconds` | Replication | PostgreSQL, MySQL |
| **Replication Lag (Bytes)** (byte) | `oneuptime.monitor.database.replication.lag.bytes` | Replication | PostgreSQL, SQL Server |
| **Is In Recovery** | `oneuptime.monitor.database.is.in.recovery` | Replication | PostgreSQL |
| **Inactive Replication Slots** | `oneuptime.monitor.database.replication.slots.inactive` | Replication | PostgreSQL |

Le metriche di replica vengono riportate dal lato del collegamento a cui è connesso il monitor. Punta un monitor al primario per vedere le repliche connesse e la coda di invio; puntane uno a ogni standby per vedere quanto è davvero indietro quello standby.

Il ritardo in secondi segna zero su un primario inattivo anche quando una replica è molto indietro, perché non è stato scritto nulla di nuovo. **Replication Lag (Bytes)** non ha questo punto cieco, quindi imposta avvisi su entrambi.

### Manutenzione

| Metrica | Serie | Group | Engines |
|---|---|---|---|
| **Transaction ID Used** (%) | `oneuptime.monitor.database.transaction.id.used.percent` | Maintenance | PostgreSQL |
| **Dead Tuples** | `oneuptime.monitor.database.dead.tuples` | Maintenance | PostgreSQL |
| **Tables Never Autovacuumed** | `oneuptime.monitor.database.tables.never.autovacuumed` | Maintenance | PostgreSQL |
| **Requested Checkpoints** | `oneuptime.monitor.database.checkpoints.requested.total` | Maintenance | PostgreSQL |
| **Timed Checkpoints** | `oneuptime.monitor.database.checkpoints.timed.total` | Maintenance | PostgreSQL |

> [!IMPORTANT]
> **Transaction ID Used** merita un criterio su ogni monitor PostgreSQL che crei. PostgreSQL rifiuta tutte le scritture quando arriva al 100%, il ripristino richiede un vacuum in modalità utente singolo con il database fermo, e quasi nessuno lo tiene d'occhio. Imposta l'avviso ben prima del precipizio: l'80% lascia giorni di margine per la maggior parte dei carichi.

I contatori che finiscono con `total` sono cumulativi dall'avvio del server. Confronta due momenti per ottenere un tasso; un singolo valore ha senso solo rispetto alla propria storia, e torna a zero quando il server si riavvia (cosa che ti mostrerà **Uptime**).

## Imposta i criteri

| Tipo di filtro | Cosa controlla |
|---|---|
| **Database Is Online** | Se il database era raggiungibile e la query di prova è riuscita. È il criterio offline con cui viene creato il monitor, e l'unico controllo che riflette la raggiungibilità. |
| **Database Metric** | Scegli una metrica e confrontala: Greater Than, Less Than, Greater Than Or Equal To, Less Than Or Equal To, Equal To o Not Equal To. Il selettore delle metriche offre solo le metriche che il motore scelto può produrre, quindi non puoi costruire un criterio che resterebbe per sempre non soddisfatto (un'eccezione: le metriche Replication offerte per Microsoft SQL Server non vengono mai raccolte su Azure SQL Database). Se la metrica non è stata raccolta in un controllo — il gruppo è fallito o il motore non la riporta —, il filtro non corrisponde, e non corrisponde nemmeno come "false": viene saltato. Un problema di permessi non può chiamare nessuno. |
| **Database Collection Error** | Il riepilogo dei problemi di raccolta del controllo, un "gruppo: messaggio" per ogni gruppo non disponibile. Imposta un avviso quando non è vuoto per accorgerti della perdita di visibilità, oppure usa Contains per tenere d'occhio un gruppo specifico. |
| **JavaScript Expression** | Controllo completo. Vedi [Espressioni JavaScript](/docs/monitor/javascript-expression). |

Le soglie sono numeri interi. Scrivi `90`, non `90.5`: percentuali e secondi vengono confrontati come interi.

**Database Is Online** e **Database Metric** possono essere controllati nel tempo: spunta **Valuta questo criterio su un periodo di tempo**, poi scegli come **Valuta** i valori (ad esempio **All Values**) e **Per gli ultimi (in minuti)**. Nel tempo, l'impostazione **Se nessun dato** del filtro decide cosa significa un valore mancante; lasciala su **Ignore**, così un permesso mancante continua a non poter chiamare nessuno.

### Variabili delle espressioni JavaScript

Per un monitor Database Health, l'espressione ha accesso a:

| Variabile | Tipo | Descrizione |
|---|---|---|
| `isOnline` | boolean | Se la connessione e la query di prova sono riuscite entrambe |
| `engineVersion` | string | La stringa di versione riportata dal server (su SQL Server, la semplice `ProductVersion`; il riepilogo del monitor indica la piattaforma accanto) |
| `connectionError` | string | Errore di connessione ripulito, vuoto se non ce n'è stato |
| `collectedGroups` | array | I gruppi che hanno prodotto valori in questo controllo |
| `unavailableGroups` | array | I gruppi con un'istruzione che non è stato possibile raccogliere, ciascuno con un motivo e una soluzione. Un gruppo raccolto in parte è in entrambi gli elenchi |
| `metrics` | object | I valori raccolti, indicizzati per nome della serie; una serie non raccolta è assente |

```javascript
{{isOnline}} === true && {{collectedGroups}}.length >= 5
```

Per leggere una metrica in un'espressione, indicizza l'intero oggetto `metrics`: i nomi delle serie contengono punti, quindi non possono stare tra le parentesi graffe:

```javascript
{{metrics}}['oneuptime.monitor.database.connections.used.percent'] > 90
```

Per una soglia su una singola metrica, usa **Database Metric** invece di un'espressione: risolve la serie al posto tuo, offre solo ciò che il tuo motore può produrre e salta il controllo quando il valore non è stato raccolto, invece di confrontarlo con il nulla.

### Esempio: un primario PostgreSQL

| Ordine | Criterio | Filtro |
|---|---|---|
| 1 | **Offline** | `Database Is Online` è `false`. |
| 2 | **Degradato** | `Database Metric` → Connections Used è maggiore di `90`, valutato su 5 minuti con All Values così che un singolo picco non chiami nessuno. |
| 3 | **Degradato** | `Database Metric` → Transaction ID Used è maggiore di `80`. |
| 4 | **Degradato** | `Database Metric` → Blocked Sessions è maggiore di `0`, su 5 minuti. |
| 5 | **Online** | `Database Is Online` è `true`. |

I criteri vengono valutati dall'alto verso il basso e vince la prima corrispondenza, quindi metti prima i criteri di avviso e per ultimo quello sano.

Collega una policy di reperibilità al criterio offline e lascia tutto ciò che deriva da **Metric Groups Failed** o da `Database Collection Error` come avviso senza policy di reperibilità.

## Cose da considerare

- **Le query vengono eseguite a ogni controllo.** Sono economiche per progettazione, ma "economico" dipende dall'intervallo. Un intervallo di un minuto su un server con migliaia di sessioni significa più scansioni di `pg_stat_activity` di quante ne vorresti; cinque minuti bastano e avanzano per le metriche di capacità.
- **Punta il monitor al database che ti interessa.** Dimensione, cache hit ratio e scritture su file temporanei sono per database. Connessioni, uptime e replica sono per server e danno lo stesso valore da qualsiasi database di quell'istanza.
- **Un monitor per istanza, non per database**, a meno che tu non voglia proprio le metriche di dimensione e di cache per database: altrimenti moltiplichi le query a livello di server senza informazioni nuove. Azure SQL Database è l'eccezione: riporta le connessioni per database, quindi lì monitora ogni database.
- **Imposta avvisi sui tassi, non sui contatori.** Tutto ciò che finisce con `total` cresce soltanto, quindi una soglia "maggiore di" su di esso scatta una volta e non rientra mai. Mostralo in un grafico, oppure confrontalo su una finestra di tempo.
- **Preferisci un segreto del monitor a una password in chiaro.** La credenziale resta così cifrata a riposo e non compare mai sul monitor.
- **Il monitor non scrive mai.** Ogni query è una lettura di una vista di statistiche: su PostgreSQL dentro una transazione in sola lettura, su MySQL in una sessione in sola lettura. Ciò che non riesce a leggere viene segnalato come metrica mancante, mai come interruzione.

## Risoluzione dei problemi

:::details Il monitor è offline, ma il database funziona
Offline significa che la sonda non è riuscita a connettersi o che la query di prova è fallita: host o porta non sono raggiungibili dalla sonda, il login è stato rifiutato, TLS è fallito oppure la connessione è andata in timeout. Il riepilogo del monitor mostra l'errore. Verifica che la sonda raggiunga il database (una sonda ospitata da OneUptime ha bisogno di un indirizzo pubblico; altrimenti usa una [sonda personalizzata](/docs/probe/custom-probe)), controlla il nome utente e la password o il suo segreto del monitor, e disattiva **Verify server certificate** per un certificato autofirmato. Poi fai clic su **Testa il monitor** per controllare di nuovo.
:::

:::details Connections, Activity e Locks mancano su PostgreSQL
Il login non è membro di `pg_monitor` né di `pg_read_all_stats` e non è superuser, quindi la sonda salta quei gruppi invece di registrare numeri sbagliati. Esegui `GRANT pg_monitor TO oneuptime_health;` come descritto in [PostgreSQL](#postgresql).
:::

:::details Connections, Throughput e Locks mancano su MySQL
O al login manca `SELECT` su `performance_schema`, oppure `performance_schema` è disattivato sul server; il riepilogo del monitor mostra il messaggio di MySQL. Per un permesso mancante, esegui le istruzioni in [MySQL](#mysql). Un `performance_schema` disattivato richiede `performance_schema = ON` nella configurazione del server e un riavvio.
:::

:::details I/O Read Time e I/O Write Time valgono sempre 0 su PostgreSQL
PostgreSQL li misura solo quando `track_io_timing` è attivo, e per impostazione predefinita è disattivato. Attivalo nella configurazione del server, o nel parameter group del tuo servizio gestito, per vedere valori reali. Non è un permesso mancante.
:::

:::details Metric Groups Failed è sopra 0 a ogni controllo
Un gruppo non può essere raccolto in nessun controllo, quindi lo stesso problema di raccolta si ripete. Il riepilogo del monitor indica il gruppo, il motivo e il `GRANT` che lo risolve. Esegui il permesso oppure, se non riesci a ottenerlo, disattiva quel gruppo in **Metric Groups** perché il problema smetta di ripetersi.
:::

## Passaggi successivi

:::cards
- [Monitor query SQL](/docs/monitor/sql-monitor): Avvisi sul risultato della tua query, accanto alla salute del server.
- [Database](/docs/telemetry/databases): Vedi metriche, log e chiamanti di ogni database in un'unica pagina.
- [Segreti del monitor](/docs/monitor/monitor-secrets): Mantieni cifrata la password dell'utente di monitoraggio.
- [Sonde personalizzate](/docs/probe/custom-probe): Raggiungi un database all'interno della tua rete.
:::

# Monitor query SQL

Il monitor di query SQL esegue a intervalli regolari, da una sonda, una query SQL in sola lettura e genera avvisi sul risultato: il numero di righe restituite, un valore scalare, quanto è durata la query o un errore della query. È pensato per il caso «eseguire una query e aprire un incidente», per esempio avvisare quando il numero di ordini annullati negli ultimi cinque minuti schizza in alto, quando una tabella di coda cresce troppo o quando una riga critica scompare.

:::cards
- [Creare un utente in sola lettura](#creare-un-utente-in-sola-lettura): L'accesso al database che il monitor deve usare.
- [Creare il monitor](#creare-un-monitor-di-query-sql): Collegate una sonda e inserite la query.
- [Scrivere la query](#scrivere-la-query): Mettete nella prima colonna il valore su cui volete gli avvisi.
- [Impostare i criteri](#impostare-i-criteri): Avvisi su un conteggio, un valore, una query lenta o un errore.
:::

## Come funziona

A ogni controllo, la sonda si connette al vostro database, esegue la query in un contesto di sola lettura, rilegge al massimo un numero limitato di righe e invia a OneUptime una proiezione compatta. I criteri del monitor vengono poi valutati su questa proiezione.

Poiché la query viene eseguita da una sonda all'interno della vostra rete, OneUptime non ha mai bisogno di una connessione diretta al database, e l'insieme completo dei risultati non lascia mai la sonda: viene riportata solo una proiezione piccola e limitata del risultato.

```mermaid title="Solo una piccola proiezione del risultato lascia la vostra rete"
sequenceDiagram
    participant O as OneUptime
    participant P as Sonda
    participant D as Il vostro database
    O->>P: Impostazioni del monitor, segreti risolti
    P->>D: La vostra query, in sola lettura
    D-->>P: Fino a Max Rows + 1 righe
    P->>O: Numero di righe, scalare, prima riga, tempo, errore
    O->>O: Valutare i criteri
```

La sonda riporta solo:

| Valore | Che cos'è |
|---|---|
| **Row Count** | Il numero di righe restituite dalla query (limitato dal limite Max Rows). |
| **Valore scalare** | La prima colonna della prima riga. È il valore naturale di una query in stile `SELECT COUNT(*)`. |
| **First Row** | La prima riga come coppie colonna/valore, mostrata nel riepilogo del controllo come contesto. |
| **Execution Time** | Quanto è durato il controllo, in millisecondi, compresa la connessione e non solo la query. |
| **Errore della query** | Un messaggio d'errore ripulito se la query è fallita. |

L'insieme completo dei risultati non viene mai inviato a OneUptime, quindi i dati dei vostri clienti non vengono replicati nell'archivio di OneUptime.

## Database supportati

| Database | Porta predefinita |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

I motori compatibili con MySQL e PostgreSQL che usano lo stesso protocollo di rete e lo stesso dialetto SQL in genere funzionano anch'essi, ma solo i tre motori sopra sono testati ufficialmente.

Quando l'host e la porta a cui si connette il monitor sono uno degli endpoint di un database della pagina [Database](/docs/telemetry/databases), i suoi avvisi e incidenti compaiono anche nella pagina di quel database (consultate [Avvisi su un database](/docs/telemetry/databases#alerts-on-a-database)). Un host indicato come riferimento a un segreto del monitor non viene abbinato.

## Modello di sicurezza

Eseguire una query fornita dal cliente su un database di produzione è delicato, per questo il monitor di query SQL è in sola lettura per progettazione e sovrappone diversi controlli:

| Controllo | Cosa fa |
|---|---|
| **Utente del database con privilegi minimi** (controllo principale) | Collegatevi sempre con un utente del database dedicato e in sola lettura, che abbia accesso solo alle tabelle di cui la query ha bisogno. È il controllo più importante: consultate [Creare un utente in sola lettura](#creare-un-utente-in-sola-lettura). |
| **Esecuzione in sola lettura** | Su PostgreSQL e MySQL la sonda apre una transazione `READ ONLY`, che rifiuta qualsiasi scrittura (comprese le CTE di scrittura) a prescindere dal testo della query. Su Microsoft SQL Server, che non ha una transazione in sola lettura, la sonda lavora dentro una transazione che viene sempre annullata. |
| **Query a istruzione singola e consentite** | La query deve essere una singola istruzione che inizia con `SELECT`, `WITH`, `VALUES` o `TABLE`. Le istruzioni impilate (`SELECT 1; DROP TABLE …`) e le parole chiave di scrittura o DDL come `INSERT`, `UPDATE`, `DELETE`, `DROP`, `EXEC` e `INTO` vengono rifiutate dalla sonda prima di connettersi. Questo controllo è una rete di sicurezza, non il confine: il confine è l'utente in sola lettura. |
| **Timeout dell'istruzione** | Ogni query ha un limite di tempo rigido. Una query che dura troppo viene annullata. |
| **Righe limitate** | Vengono rilette al massimo Max Rows righe (più una, per rilevare il troncamento), il che limita la memoria della sonda e la dimensione dei dati inviati. |
| **Oscuramento delle credenziali** | Gli errori del database vengono ripuliti prima di essere salvati: la password, l'host, il nome utente e il nome del database, e qualsiasi stringa di connessione, vengono oscurati, così le credenziali non finiscono mai nei messaggi d'errore. |

## Prima di iniziare

- Una **sonda** con accesso di rete all'host e alla porta del database. Può essere una sonda ospitata da OneUptime (se il database è raggiungibile da Internet) o una [sonda personalizzata](/docs/probe/custom-probe) in esecuzione all'interno della vostra rete.
- Un **utente del database in sola lettura** e i dati di connessione (host, porta, nome del database, nome utente, password), oppure un'identità Windows o di dominio in sola lettura se usate l'autenticazione integrata di SQL Server.

## Creare un utente in sola lettura

Collegatevi sempre con un utente dedicato in sola lettura. Eseguite come amministratore le istruzioni del vostro motore, sostituendo `orders` con il vostro database:

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

Per un permesso più ristretto, date all'utente `SELECT` solo sulle tabelle che la query legge.

## Creare un monitor di query SQL

:::steps
### Iniziare un nuovo monitor

Andate in **Monitor** e fate clic su **Crea monitor**. In **Tipo di monitor**, fate clic su **Altri tipi di monitor** e scegliete **SQL Query** sotto **Database Monitoring**, oppure digitate `query` nella casella di ricerca. Inserite un **Nome**, poi fate clic su **Avanti**.

### Inserire i dati di connessione

Scegliete il **Database Type** (la porta passa a quella predefinita del motore), poi compilate host, nome del database e credenziali dell'utente in sola lettura. Fate riferimento alla password con un [segreto del monitor](#usare-un-segreto-del-monitor-per-la-password) invece di digitarla. Ogni campo è descritto in [Configurazione](#configurazione).

### Inserire la query

Scrivete una singola istruzione in sola lettura in **SQL Query** (consultate [Scrivere la query](#scrivere-la-query)).

### Testarlo

Fate clic su **Testa il monitor** per eseguire la query una volta da una sonda prima di salvare.

### Impostare i criteri

Rivedete i criteri con cui parte il monitor e aggiungete i vostri: consultate [Impostare i criteri](#impostare-i-criteri). Poi fate clic su **Avanti**.

### Scegliere le sonde e creare

Selezionate le **Sonde** che raggiungono il database e un **Intervallo di monitoraggio**, poi fate clic su **Crea monitor**.
:::

## Configurazione

| Campo | Cosa inserire |
|---|---|
| **Database Type** | PostgreSQL, MySQL o Microsoft SQL Server. La scelta di un tipo imposta la porta predefinita. |
| **Host** | L'host del database raggiungibile dalla sonda (per esempio `db.internal`). |
| **Porta** | La porta del database. |
| **Nome del database** | Il database su cui eseguire la query. |
| **Use Windows Integrated Authentication** | Solo Microsoft SQL Server. Autenticarsi con l'account che esegue la sonda invece che con nome utente e password SQL. Consultate [Autenticazione integrata di Windows](#autenticazione-integrata-di-windows). |
| **Nome utente** | Un utente del database in sola lettura, con privilegi minimi. |
| **Password** | La password del database. Consigliamo vivamente di fare riferimento a un [segreto del monitor](/docs/monitor/monitor-secrets) con `{{monitorSecrets.name}}` invece di digitare la password in chiaro (consultate [Usare un segreto del monitor per la password](#usare-un-segreto-del-monitor-per-la-password)). |
| **SQL Query** | La query in sola lettura da eseguire (consultate [Scrivere la query](#scrivere-la-query)). |
| **Use SSL/TLS** | Attivatelo per connettervi tramite TLS. Quando è attivo, potete disattivare **Verify server certificate** se il database usa un certificato autofirmato. |

### Altri campi

| Campo | Predefinito | Massimo | Cosa limita |
|---|---|---|---|
| **Connection Timeout (ms)** | `10000` | `30000` | Quanto attendere per stabilire una connessione. |
| **Statement Timeout (ms)** | `15000` | `60000` | Il limite rigido di durata della query. |
| **Max Rows** | `100` | `1000` | Il tetto di righe rilette dal database. |

Un valore sopra il massimo viene abbassato al massimo.

### Autenticazione integrata di Windows

Per Microsoft SQL Server, attivate **Use Windows Integrated Authentication** per aprire una connessione attendibile con l'identità del processo della sonda. I campi Nome utente e Password vengono ignorati in questa modalità e non vengono passati al driver. Poiché la sonda ha bisogno di un'identità considerata attendibile dal vostro dominio, usate una sonda self-hosted per questa modalità di autenticazione.

| La sonda gira su | Cosa configurare |
|---|---|
| **Windows** | Eseguire il servizio della sonda con un account di dominio che abbia un accesso SQL Server in sola lettura. |
| **Linux o macOS** | Configurare Kerberos per il dominio di SQL Server e dare al processo della sonda un ticket valido (per esempio tramite un keytab). L'immagine Linux ufficiale della sonda include Microsoft ODBC Driver 18, unixODBC e il client Kerberos. Montate nel container la configurazione Kerberos e la cache dei ticket, rendetele leggibili dal processo della sonda e impostate `KRB5_CONFIG` o `KRB5CCNAME` quando le loro posizioni non sono quelle predefinite. |

La sonda ha bisogno di un Microsoft ODBC Driver for SQL Server installato sull'host che la esegue. L'immagine ufficiale della sonda include **ODBC Driver 18**. Quando eseguite una sonda self-hosted o personalizzata, questa rileva e usa automaticamente il più recente `ODBC Driver N for SQL Server` registrato sull'host (per esempio Driver 17, se è quello installato): non serve avere esattamente Driver 18. Per fissare un driver preciso, impostate la variabile d'ambiente `SQL_SERVER_ODBC_DRIVER` della sonda con il nome esatto del driver (per esempio `ODBC Driver 17 for SQL Server`).

SQL Server deve avere un nome dell'entità servizio `MSSQLSvc` adeguato, gli orologi della sonda e del controller di dominio devono essere sincronizzati, e la sonda deve risolvere e raggiungere SQL Server con il nome host coperto da quell'entità servizio. Concedete all'identità attendibile solo i permessi sul database di cui ha bisogno la query di monitoraggio.

## Scrivere la query

La query deve essere una **singola istruzione in sola lettura**. Deve iniziare con `SELECT`, `WITH`, `VALUES` o `TABLE`. È consentito un punto e virgola finale; più istruzioni no. Le parole chiave di scrittura e DDL vengono rifiutate in qualsiasi punto della query, compresa `INTO`, quindi anche `SELECT … INTO` viene rifiutata.

La sonda controlla la query a ogni controllo, non al salvataggio. Una query che viola queste regole si salva, e poi ogni controllo fallisce con "Only read-only queries are allowed (must start with SELECT, WITH, VALUES, or TABLE)."; i criteri predefiniti portano il monitor offline.

Tenete le query economiche e mirate: vengono eseguite a ogni controllo, quindi preferite colonne indicizzate e finestre temporali strette. Questa query conta gli ordini annullati negli ultimi cinque minuti:

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
> Per una query in stile `COUNT(*)`, il conteggio è disponibile sia come **Row Count** (che vale `1`, perché viene restituita una riga) sia come **Valore scalare** (il conteggio stesso, dalla prima colonna). Per avvisi su «quanti», confrontate con il **Valore scalare**.

## Usare un segreto del monitor per la password

Perché la password del database non venga mai salvata in chiaro sul monitor, create un [segreto del monitor](/docs/monitor/monitor-secrets) e fatevi riferimento dal campo Password:

:::steps
1. Andate in **Monitor → Impostazioni → Segreti** e create un segreto del monitor.
2. Dategli un nome (per esempio `dbPassword`) e concedete a questo monitor l'accesso.
3. Nel campo **Password** del monitor, inserite `{{monitorSecrets.dbPassword}}`.
:::

OneUptime risolve il segreto lato server prima di passare la configurazione alla sonda. OneUptime non crea mai questi segreti al posto vostro: farvi riferimento è una vostra scelta. Anche i campi **Nome utente**, **Host**, **Nome del database** e **SQL Query** accettano riferimenti a segreti; **Porta** no.

## Impostare i criteri

Aggiungete criteri per decidere quando il monitor è considerato online, degradato oppure offline. Per un monitor di query SQL sono disponibili questi controlli:

| Tipo di filtro | Cosa controlla |
|---|---|
| **SQL Is Online** | Se il database era raggiungibile e la query è riuscita. |
| **SQL Query Row Count** | Il numero di righe restituite. Confrontate con operatori come maggiore di, minore di o uguale a. |
| **SQL Query Scalar Value** | La prima colonna della prima riga. Confrontata come numero quando il valore inserito è un numero, altrimenti come stringa. È il controllo da usare per le query in stile `COUNT(*)`. |
| **SQL Query Execution Time (in ms)** | Quanto è durata la query. Utile per individuare un database lento. |
| **SQL Query Error** | Il messaggio d'errore della query. Avvisi quando è (o non è) vuoto, o quando corrisponde a una stringa precisa. |
| **JavaScript Expression** | Valutare un'espressione JavaScript personalizzata su `rowCount`, `scalarValue`, `firstRow`, `executionTimeInMs`, `queryError` e `isOnline`. Consultate [Espressioni JavaScript](/docs/monitor/javascript-expression#monitor-delle-query-sql). |

Le soglie numeriche sono numeri interi: scrivete `10`, non `10.5`. I filtri SQL Query non si possono valutare su un periodo di tempo; ogni controllo fa storia a sé.

Un nuovo monitor di query SQL parte con due criteri: **SQL Is Online** è falso (il monitor va offline e dichiara un incidente che si risolve da solo) e **SQL Is Online** è vero, che lo segna online. **Aggiungi criteri** ne aggiunge uno in fondo; trascinatelo sopra il criterio online, perché i criteri vengono controllati dall'alto e decide il primo che corrisponde.

### Esempio: avvisare quando gli annullamenti schizzano in alto

Con la query sopra:

| Criterio | Filtro |
|---|---|
| **Degradato** | `SQL Query Scalar Value` è maggiore di `10`. |
| **Offline** | `SQL Query Scalar Value` è maggiore di `50`, oppure `SQL Is Online` è `false`. |

Collegate una policy di reperibilità al criterio, così vengono avvisate le persone giuste. Un monitor di query SQL non ha variabili di modello proprie: il titolo di un incidente può nominare il monitor con `{{monitorName}}`, ma non può citare il risultato della query.

## Aspetti da considerare

- La query viene eseguita a ogni controllo, quindi tenetela economica. Usate indici e finestre temporali strette, e contate sullo Statement Timeout come rete di sicurezza.
- Vengono riportati solo il numero di righe, la prima cella (scalare) e la prima riga: progettate la query in modo che il valore su cui volete gli avvisi sia nella prima colonna.
- Se il risultato viene troncato perché superava Max Rows, il riepilogo del controllo mostra **Rows Truncated**: "Yes (result capped)". Aumentate Max Rows solo se serve; insiemi di risultati più grandi costano più memoria sulla sonda.
- Scritture e DDL vengono sempre rifiutati. Se dovete testare un percorso di scrittura, questo monitor non fa al caso vostro.
- Preferite un segreto del monitor a una password in chiaro, così la credenziale resta cifrata a riposo.
- Un controllo la cui query fallisce viene ritentato un secondo dopo, fino a tre volte in più, prima di riportare l'errore, così una breve interruzione della connessione non porta il monitor offline. Su una sonda self-hosted, `PROBE_MONITOR_RETRY_LIMIT` stabilisce quante volte.

## Risoluzione dei problemi

:::details Ogni controllo fallisce con "Only read-only queries are allowed"
La query non inizia con `SELECT`, `WITH`, `VALUES` o `TABLE`. Un commento prima va bene; un `SET` o un `DECLARE` no. Riscrivetela come una singola istruzione in sola lettura.
:::

:::details Un controllo fallisce con "Disallowed SQL keyword"
Da qualche parte nella query compare una parola chiave di scrittura, DDL o esecuzione, anche dentro una `SELECT`, come `INTO` o `EXEC`. Le parole tra virgolette e nei commenti non contano. Togliete la parola chiave, oppure spostate la logica in una vista che l'utente in sola lettura può leggere.
:::

:::details Il controllo va in timeout
La sonda non è riuscita a connettersi entro il **Connection Timeout (ms)**, oppure la query è durata più dello **Statement Timeout (ms)**. Verificate che la sonda raggiunga host e porta, poi rendete la query meno costosa: filtrate su colonne indicizzate in una finestra temporale breve.
:::

:::details La connessione fallisce con un errore di certificato
Il certificato del database è autofirmato, oppure la sonda non lo considera attendibile. Disattivate **Verify server certificate**, che compare quando **Use SSL/TLS** è attivo, oppure date al database un certificato che la sonda considera attendibile.
:::

:::details L'autenticazione integrata di Windows fallisce
La sonda ha bisogno di un Microsoft ODBC Driver for SQL Server e di un'identità considerata attendibile dal vostro dominio. Usate l'immagine ufficiale della sonda, oppure installate il driver, poi controllate la configurazione in [Autenticazione integrata di Windows](#autenticazione-integrata-di-windows).
:::

## Passi successivi

:::cards
- [Monitor stato database](/docs/monitor/database-health-monitor): Tenete d'occhio connessioni, lock e replica senza scrivere SQL.
- [Segreti del monitor](/docs/monitor/monitor-secrets): Mantenete cifrata la password del database.
- [Espressioni JavaScript](/docs/monitor/javascript-expression): Scrivete criteri che combinano più valori.
- [Sonde personalizzate](/docs/probe/custom-probe): Eseguite i controlli dall'interno della vostra rete.
:::

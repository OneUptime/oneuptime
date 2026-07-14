# Monitor Query SQL

Il Monitor Query SQL esegue una query SQL di sola lettura in modo pianificato da un probe e genera avvisi in base al risultato: il numero di righe restituite, un valore scalare, la durata di esecuzione della query o un errore della query. È progettato per il caso d'uso «esegui una query e apri un incidente», ad esempio per generare avvisi quando il numero di ordini annullati negli ultimi cinque minuti aumenta improvvisamente, quando una tabella di coda cresce troppo, oppure quando una riga critica scompare.

Poiché la query viene eseguita da un probe all'interno della tua rete, OneUptime non necessita mai di una connessione diretta al tuo database e l'intero set di risultati non lascia mai il probe: viene riportata solo una piccola proiezione limitata del risultato.

## Database supportati

Il Monitor Query SQL supporta i seguenti motori di database:

- **PostgreSQL** (porta predefinita `5432`)
- **MySQL** (porta predefinita `3306`)
- **Microsoft SQL Server** (porta predefinita `1433`)

I motori compatibili con MySQL e con PostgreSQL che utilizzano lo stesso protocollo wire e lo stesso dialetto SQL generalmente funzionano anch'essi, ma solo i tre motori sopra elencati sono testati ufficialmente.

## Come funziona

Ad ogni controllo, il probe si connette al tuo database, esegue la query in un contesto di sola lettura, legge al massimo un numero limitato di righe e riporta una proiezione compatta a OneUptime. I criteri del tuo monitor vengono quindi valutati rispetto a tale proiezione.

Il probe riporta solo:

- **Numero di righe** — il numero di righe restituite dalla query (limitato dal valore Righe massime).
- **Valore scalare** — la prima colonna della prima riga. Questo è il valore naturale per una query in stile `SELECT COUNT(*)`.
- **Prima riga** — la prima riga come insieme di coppie colonna/valore, mostrata nel riepilogo del controllo per fornire contesto.
- **Tempo di esecuzione** — la durata di esecuzione della query, in millisecondi.
- **Errore della query** — un messaggio di errore sanificato se la query non è riuscita.

L'intero set di risultati non viene mai inviato a OneUptime, quindi i dati dei clienti non vengono replicati nello storage di OneUptime.

## Modello di sicurezza

Eseguire una query fornita dal cliente su un database di produzione è un'operazione delicata, quindi il Monitor Query SQL è di sola lettura per progettazione e adotta diversi livelli di controllo:

- **Utente del database con privilegi minimi (controllo principale).** Dovresti sempre connetterti con un utente del database dedicato e di sola lettura che abbia accesso solo alle tabelle di cui la query ha bisogno. Questo è il controllo più importante — vedi Creare un utente di sola lettura di seguito.
- **Esecuzione in sola lettura.** Su PostgreSQL e MySQL il probe apre una transazione `READ ONLY`, che rifiuta qualsiasi scrittura (incluse le CTE scrivibili) indipendentemente dal testo della query. Su Microsoft SQL Server, che non dispone di transazioni di sola lettura, il probe viene eseguito all'interno di una transazione che viene sempre annullata (rollback).
- **Query a istruzione singola e con lista di elementi consentiti.** La query deve essere una singola istruzione che inizia con `SELECT`, `WITH`, `VALUES` o `TABLE`. Le istruzioni concatenate (`SELECT 1; DROP TABLE …`) e le scritture/DDL vengono rifiutate prima che il probe si connetta. Il controllo tiene conto di commenti e stringhe letterali, quindi una parola chiave nascosta in un commento o in una stringa non riesce a passare inosservata.
- **Timeout dell'istruzione.** Ogni query ha un limite di tempo rigido. Una query che viene eseguita troppo a lungo viene annullata.
- **Righe limitate.** Viene letto al massimo il numero di righe impostato in Righe massime (più una, per rilevare il troncamento), il che limita la memoria del probe e la dimensione del payload.
- **Oscuramento delle credenziali.** Gli errori del database vengono sanificati prima di essere archiviati: la password ed eventuali stringhe di connessione vengono oscurate, in modo che le credenziali non trapelino mai nei messaggi di errore.

## Prerequisiti

- Un **probe** con accesso di rete all'host e alla porta del tuo database. Può essere un probe ospitato da OneUptime (se il tuo database è raggiungibile da internet) oppure un probe self-hosted in esecuzione all'interno della tua rete. Consulta la documentazione del probe per sapere come installare un probe personalizzato.
- Un **utente del database di sola lettura** e i dettagli di connessione (host, porta, nome del database, nome utente, password).

## Configurazione

Crea un nuovo monitor e scegli **Query SQL** come tipo di monitor, quindi inserisci i dettagli di connessione:

- **Tipo di database** — PostgreSQL, MySQL o Microsoft SQL Server. La scelta di un tipo imposta la porta predefinita.
- **Host** — l'host del database raggiungibile dal probe (ad esempio `db.internal`).
- **Porta** — la porta del database.
- **Nome del database** — il database su cui eseguire la query.
- **Nome utente** — un utente del database di sola lettura e con privilegi minimi.
- **Password** — la password del database. Consigliamo vivamente di fare riferimento a un [Segreto del Monitor](/docs/monitor/monitor-secrets) con `{{monitorSecrets.name}}` invece di digitare la password in chiaro (vedi di seguito).
- **Query SQL** — la query di sola lettura da eseguire (vedi Scrivere la query).
- **Usa SSL/TLS** — abilita per connetterti tramite TLS. Quando è abilitato, puoi disattivare **Verifica il certificato del server** se il database utilizza un certificato autofirmato.

### Opzioni avanzate

- **Timeout di connessione (ms)** — quanto tempo attendere per stabilire una connessione. Predefinito `10000`, massimo `30000`.
- **Timeout dell'istruzione (ms)** — il limite massimo rigido sul tempo di esecuzione consentito alla query. Predefinito `15000`, massimo `60000`.
- **Righe massime** — il limite superiore sul numero di righe lette dal database. Predefinito `100`, massimo `1000`.

## Scrivere la query

La query deve essere una **singola istruzione di sola lettura**. Deve iniziare con uno tra `SELECT`, `WITH`, `VALUES` o `TABLE`. È consentito un singolo punto e virgola finale; più istruzioni non lo sono.

Mantieni le query economiche e ben delimitate: vengono eseguite ad ogni controllo, quindi preferisci colonne indicizzate e finestre temporali ristrette.

```sql
-- Conta le cancellazioni recenti (PostgreSQL)
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```

```sql
-- La stessa idea su MySQL
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```

```sql
-- La stessa idea su Microsoft SQL Server
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```

Per una query in stile `COUNT(*)`, il conteggio è disponibile sia come **Numero di righe** (che è `1`, poiché viene restituita una sola riga) sia come **Valore scalare** (il conteggio stesso, dalla prima colonna). Per generare avvisi su «quanti», confronta con il **Valore scalare**.

## Usare un Segreto del Monitor per la password

Affinché la password del database non venga mai archiviata in chiaro nel monitor, crea un [Segreto del Monitor](/docs/monitor/monitor-secrets) e fai riferimento ad esso dal campo Password:

1. Vai su Dashboard di OneUptime → Impostazioni Progetto → Segreti del Monitor → Crea Segreto del Monitor.
2. Crea un segreto (ad esempio `dbPassword`) e concedi a questo monitor l'accesso ad esso.
3. Nel campo Password del monitor, inserisci `{{monitorSecrets.dbPassword}}`.

OneUptime risolve il segreto lato server prima che la configurazione venga consegnata al probe. OneUptime non crea mai questi segreti al posto tuo: fare riferimento a uno è una tua scelta.

## Impostare i criteri

Aggiungi criteri per decidere quando il monitor è considerato online, degradato od offline. I seguenti controlli sono disponibili per un Monitor Query SQL:

- **SQL è online** — se il database era raggiungibile e la query è riuscita.
- **Numero di righe della query SQL** — il numero di righe restituite. Confronta con operatori come maggiore di, minore di o uguale a.
- **Valore scalare della query SQL** — la prima colonna della prima riga. Confrontato numericamente quando entrambi i lati sembrano numerici, altrimenti come stringhe. Questo è il controllo da usare per le query in stile `COUNT(*)`.
- **Tempo di esecuzione della query SQL (in ms)** — la durata di esecuzione della query. Utile per individuare un database lento.
- **Errore della query SQL** — il messaggio di errore della query. Genera avvisi quando è (o non è) vuoto, oppure quando corrisponde a una stringa specifica.
- **Espressione JavaScript** — valuta un'espressione JavaScript personalizzata per il pieno controllo. Vedi [Espressioni JavaScript](/docs/monitor/javascript-expression).

### Esempio: genera un avviso quando le cancellazioni aumentano improvvisamente

Usando la query sopra:

- **Criterio: Degradato** — `Valore scalare della query SQL` è maggiore di `10`.
- **Criterio: Offline** — `Valore scalare della query SQL` è maggiore di `50`, oppure `SQL è online` è `false`.

Associa una politica di reperibilità ai criteri in modo che vengano contattate le persone giuste.

## Creare un utente di sola lettura

Connettiti sempre con un utente di sola lettura dedicato. Esempi:

```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- Includi le tabelle create in futuro:
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

## Aspetti da considerare

- La query viene eseguita ad ogni controllo, quindi mantienila economica. Usa indici e finestre temporali ristrette e affidati al Timeout dell'istruzione come misura di protezione.
- Vengono riportati solo il numero di righe, la prima cella (scalare) e la prima riga: progetta la tua query in modo che il valore su cui vuoi generare avvisi sia la prima colonna.
- Se il risultato viene troncato perché ha superato il valore Righe massime, il riepilogo del controllo lo segnala come limitato. Aumenta Righe massime solo se ne hai bisogno; set di risultati più grandi consumano più memoria sul probe.
- Le scritture e il DDL vengono sempre rifiutati. Se hai bisogno di testare un percorso di scrittura, non è questo lo scopo di tale monitor.
- Preferisci un Segreto del Monitor a una password in chiaro, in modo che la credenziale rimanga crittografata a riposo.

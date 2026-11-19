/*
 * The Data Observability Documentation page in Italian: the
 * English text of Pages/DataObservability/Documentation.tsx, translated. Its
 * code, field names, metric names and product names are as the English
 * writes them, and it names what the product draws as the Dashboard's
 * Italian words it. Change it with the English, in the same pull
 * request (DataObservabilityDocumentationInLocale).
 */
const DOCUMENTATION: string = `
## Cosa sorveglia Data Observability

Ogni tabella e ogni vista di ogni database collegato, ogni cinque minuti:

- **Numero di righe e dimensione**, dalle statistiche proprie del motore.
- **Quando è cambiata l'ultima volta**: MySQL e SQL Server lo indicano; per PostgreSQL, OneUptime osserva i contatori di inserimenti, aggiornamenti ed eliminazioni e annota quando si muovono.
- **Le sue colonne**: una colonna aggiunta, rimossa, rinominata, con un tipo diverso o resa nullable finisce nella cronologia della tabella e nelle modifiche allo schema.
- **Il suo ritmo abituale**: quanto spesso cambia di solito. Una tabella che supera di molto il suo ritmo compare come **In ritardo**.

Viene letto solo il catalogo del database e, su MongoDB, i nomi dei campi dei documenti più recenti di una collection. Nessun valore lascia il database.

Un catalogo può dire che una tabella è cambiata quando è cambiata solo la sua manutenzione interna, oppure non dire nulla. Nelle **Impostazioni** di una tabella, indica una **Colonna Freshness** come \`updated_at\`, e la sua ultima modifica diventa il valore più recente di quella colonna. L'utenza deve poter leggere la colonna, che dovrebbe essere indicizzata.

Una replica in lettura di PostgreSQL o SQL Server non muove i suoi contatori di scrittura, quindi OneUptime li esclude lì e lo segnala sul database.

## La panoramica

La **Panoramica** dice come stanno i tuoi dati adesso. Finché il progetto non è configurato, elenca i passi rimasti: avvisi su ogni database, proprietari per le tabelle, un controllo e le esecuzioni delle tue pipeline. **Da gestire** elenca ciò che ha bisogno di qualcuno, dal più grave: un database che non è stato possibile leggere, un'esecuzione di pipeline non riuscita o in ritardo, un controllo che fallisce o non è stato possibile eseguire, una riconciliazione che si è discostata, e un prodotto di dati o una tabella in ritardo. Ogni voce dice a chi appartiene e se il suo avviso è aperto, oppure che nessuno viene avvisato perché il suo database non ha avvisi attivi, e apre la pagina dove si risolve. **Database** mostra com'è andata l'ultima lettura di ogni database e se i suoi avvisi sono attivi. Il numero accanto a **Panoramica** nel menu conta ciò che ha bisogno di qualcuno, e **Problemi**, subito sotto, li elenca tutti, una pagina alla volta, filtrati per tipo, database, proprietario (o **Nessun proprietario**) e secondo se un avviso è aperto. Ogni numero della **Panoramica** apre il suo elenco: **Da gestire** apre **Problemi**, **Tabelle in ritardo** apre **Tabelle** mostrando solo quelle in ritardo, e **Controlli in errore** apre **Controlli** mostrando solo quelli in errore.

## Collegare un database

Usa un'**utenza in sola lettura**. Nella panoramica o in Database, scegli **Collega un database**, poi una delle due opzioni:

- **OneUptime si collega**: incolla una stringa di connessione. Viene salvata cifrata e non viene più mostrata.
- **Una sonda nella mia rete si collega**: scegli una delle sonde di questo progetto e indica la variabile d'ambiente della sonda che contiene la stringa di connessione (per esempio \`ORDERS_DB_URL\`). La stringa di connessione non lascia mai la tua rete. Aggiorna prima la sonda all'ultima versione.

Anche un database già collegato per la Sicurezza dei dati viene sorvegliato.

**Database che potresti collegare**, nella stessa pagina, elenca ciò che il tuo progetto conosce già e che nessuno ha collegato: i database con cui parlano le tue tracce, quelli nei tuoi account cloud e quelli che osserva il Monitoraggio dei database. **Collega** precompila il modulo con ciò che si sa di ciascuno. Non viene letto nulla finché non lo colleghi.

## Percorsi di archiviazione

Un'esportazione che arriva ogni notte in un bucket può essere in ritardo, o incompleta, come qualsiasi tabella. In **Percorsi di archiviazione**, scegli **Modifica percorsi** per un bucket trovato dalla tua connessione cloud, su Amazon S3, Google Cloud Storage o un account di archiviazione Azure, e indica i percorsi che contano, uno per riga. Ciascuno compare in **Tabelle**: il suo oggetto più recente indica quando è cambiato l'ultima volta, i suoi oggetti sono le sue righe e valgono gli stessi avvisi. Vengono letti solo nomi, dimensioni e orari, mai un oggetto.

### Un'utenza in sola lettura, per motore

PostgreSQL:

\`\`\`sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
\`\`\`

MySQL e MariaDB (\`performance_schema\` permette a OneUptime di vedere le scritture tra una raccolta e l'altra):

\`\`\`sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
\`\`\`

SQL Server (\`VIEW DATABASE STATE\` permette a OneUptime di leggere dimensioni e ultimi aggiornamenti):

\`\`\`sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
\`\`\`

Amazon Redshift: collegati con una stringa di connessione PostgreSQL all'endpoint del cluster o del gruppo di lavoro, per esempio \`postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require\`. \`SYSLOG ACCESS UNRESTRICTED\` permette a OneUptime di leggere numero di righe e dimensioni (\`svv_table_info\`), le ultime scritture e letture delle query di ogni utente (\`stl_insert\`, \`stl_delete\`, \`stl_scan\`, conservate per alcuni giorni) e la derivazione delle query di ogni utente. Senza, il cambiamento delle righe di una tabella dice comunque quando è cambiata.

\`\`\`sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
\`\`\`

Snowflake: crea un utente con una coppia di chiavi (senza password) e collegati con un JSON che indica l'identificatore dell'account, l'utente, la chiave privata (PKCS#8 non cifrata), il database e un warehouse per i controlli:

\`\`\`json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
\`\`\`

La raccolta legge il catalogo con SHOW, che non ha bisogno di un warehouse, quindi non costa crediti. Solo i controlli dei dati vengono eseguiti sul warehouse, con la pianificazione che dai loro. Snowflake non indica l'ultima modifica di nessuna tabella, quindi una tabella è cambiata quando si sono mosse le sue righe o i suoi byte.

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

Google BigQuery: ogni dataset trovato dalla tua connessione Google Cloud è già sorvegliato, con l'account di servizio di quella connessione, senza nulla da collegare. Assegna all'account di servizio **BigQuery Metadata Viewer** e **BigQuery Job User** sul progetto, e **BigQuery Data Viewer** sulle tabelle che i tuoi controlli leggono. Ogni raccolta legge \`__TABLES__\` del dataset (righe, byte e ultima modifica, senza costi) e le sue \`INFORMATION_SCHEMA.COLUMNS\` (fatturate con il minimo di 10 MB di BigQuery). Aggiungi **BigQuery Resource Viewer** sul progetto per la derivazione dai suoi job, letta una volta all'ora (vedi La derivazione che indicano i database). Per collegare un dataset senza una connessione Google Cloud, scegli **Google BigQuery** e fornisci un JSON con una chiave dell'account di servizio:

\`\`\`json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
\`\`\`

ClickHouse: collegati tramite la sua interfaccia HTTP, porta 8443 con TLS (ClickHouse Cloud) o 8123 senza, per esempio \`clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics\`. Indica un database per sorvegliare solo quello; omettilo per sorvegliare tutti i database tranne quelli del server stesso. \`system.parts\` permette a OneUptime di vedere ogni inserimento tra una raccolta e l'altra (un merge non conta), \`system.part_log\`, dove il server lo tiene, fornisce l'orario di ogni inserimento, e \`system.query_log\` fornisce l'ultima lettura di ogni tabella e la derivazione da \`INSERT ... SELECT\`, una volta all'ora. Ogni istruzione viene eseguita con \`readonly\` impostato, così nemmeno un'utenza che potrebbe scrivere può farlo.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
-- Checks read rows: SELECT on the tables they check.
\`\`\`

Databricks: un catalogo di Unity Catalog è un database. I suoi schemi, tabelle, viste e colonne, e l'ultimo commit di ogni tabella Delta, vengono letti dall'API REST di Unity Catalog senza un SQL warehouse, quindi la raccolta non costa calcolo. I controlli dei dati, e la derivazione, le ultime scritture e le ultime letture dalla tabella di sistema \`system.access.table_lineage\` (una volta all'ora), vengono eseguiti sul SQL warehouse che indichi. Collegati con un'entità servizio (o un token di accesso personale al posto di \`clientId\` e \`clientSecret\`: \`"token": "dapi..."\`):

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

Oracle: collegati con \`oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1\`, oppure con un JSON \`{ "user", "password", "connectString" }\`. Viene letto tramite il protocollo proprio di Oracle, senza un client Oracle da installare. L'utenza vede le tabelle che può leggere: concedi \`READ\` su ogni tabella da sorvegliare (può interrogarle, mai bloccarle o modificarle). \`SELECT_CATALOG_ROLE\` permette a OneUptime di leggere la dimensione di ogni tabella; senza, solo le tabelle proprie dell'utenza ne hanno una. \`ALL_TAB_MODIFICATIONS\` indica gli inserimenti, gli aggiornamenti e le eliminazioni di ogni tabella dalle sue ultime statistiche, e quando è cambiata l'ultima volta.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
\`\`\`

Amazon Athena: un database Glue è un database. Le sue tabelle e viste, le loro colonne e statistiche, e l'ultimo commit di ogni tabella Iceberg arrivano dall'API del Glue Data Catalog, che non legge dati e non costa nulla; i controlli vengono eseguiti come query Athena nel gruppo di lavoro che indichi. Collegati con le chiavi di un utente o di un ruolo IAM che possa leggere il database Glue ed eseguire query Athena:

\`\`\`json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
\`\`\`

Servono \`glue:GetDatabase\` e \`glue:GetTables\` sul database e sulle sue tabelle e, per i controlli, \`athena:StartQueryExecution\`, \`athena:GetQueryExecution\`, \`athena:GetQueryResults\` e \`athena:StopQueryExecution\` sul gruppo di lavoro, con accesso in lettura ai dati S3 delle tabelle e in scrittura alla posizione di output.

MongoDB: collegati con la sua stringa di connessione - \`mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/\`, oppure \`mongodb://\` con gli host di un replica set. Un database nel percorso è l'unico sorvegliato; senza, viene sorvegliato ogni database che l'utenza può leggere. I documenti, la dimensione e le scritture di ogni collection arrivano da \`$collStats\`, e quando ha ricevuto l'ultimo documento, dal suo \`_id\` più recente. I suoi campi arrivano dallo schema JSON del suo validatore oppure, in alternativa, dai nomi e dai tipi dei campi dei suoi 100 documenti più recenti, calcolati nel database così che nessun valore lo lasci. I documenti vengono letti su un secondario, se c'è. La collection di origine di una vista è derivazione, e un controllo personalizzato è una pipeline di aggregazione, in JSON.

\`\`\`javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
\`\`\`

Per sorvegliare un solo database, concedi \`{ role: "read", db: "orders" }\` al posto di \`readAnyDatabase\`.

Microsoft Dataverse: un ambiente è un database, con le sue tabelle in \`dbo\`, come le chiama il suo endpoint SQL. OneUptime accede come app: registrane una in Microsoft Entra ID con un segreto client e aggiungila all'ambiente come utente applicazione (Power Platform admin center > the environment > Settings > Users + permissions > Application users) con un ruolo di sicurezza che possa leggere le tabelle. Collegati con un JSON, oppure con una stringa di connessione Dataverse che indica \`AuthType=ClientSecret\`. Il tenant si può omettere: l'ambiente dice in quale si trova.

\`\`\`json
{ "environmentUrl": "https://contoso.crm.dynamics.com", "tenantId": "...", "clientId": "...", "clientSecret": "..." }
\`\`\`

Ogni cinque minuti la Web API fornisce la definizione di ogni tabella, le sue righe, dallo snapshot che Dataverse fa una volta al giorno (quindi sono in ritardo fino a un giorno), e il suo \`modifiedon\` più recente, che è quando è cambiata l'ultima volta. Le sue colonne vengono lette una volta all'ora. Ogni lettura conta nei limiti di richieste Dataverse dell'app, e una raccolta a cui viene chiesto di rallentare lascia il resto alla successiva. Un ambiente contiene centinaia di tabelle proprie, quindi vengono sorvegliate solo le tabelle aziendali principali (account, contatti, lead, opportunità, offerte, ordini, fatture, prodotti, casi, e-mail, telefonate, appuntamenti, attività e note) e le tue tabelle personalizzate. Le tabelle delle app di Microsoft (\`msdyn_\`, \`adx_\` e gli altri prefissi \`ms\`) sono escluse: indica qualsiasi altra tabella da sorvegliare, come in \`"tables": ["msdyn_workorder"]\`.

I controlli dei dati vengono eseguiti come SQL in sola lettura sull'endpoint TDS dell'ambiente, sulla porta 1433 o 5558. È attivo a meno che un amministratore non l'abbia disattivato; dove è attivo il controllo di accesso a livello utente, il ruolo dell'app ha bisogno del privilegio **Allow user to access TDS endpoint**. Il suo SQL non ha espressioni regolari, né \`WITH\`, né campionamento.

## Le metriche che ogni tabella scrive

Ogni raccolta le scrive per ogni tabella, così puoi rappresentarle in grafici, metterle nelle dashboard e creare avvisi su di esse come su qualsiasi altra metrica:

| Metrica | Cos'è |
| --- | --- |
| \`oneuptime.data.table.row_count\` | Righe nella tabella |
| \`oneuptime.data.table.size\` | Byte occupati dalla tabella e dai suoi indici |
| \`oneuptime.data.table.seconds_since_change\` | Secondi dall'ultimo inserimento, aggiornamento o eliminazione di una riga |
| \`oneuptime.data.table.overdue_seconds\` | Secondi di ritardo della tabella rispetto al momento in cui di solito cambia; 0 finché è puntuale. Scritta una volta appreso il suo ritmo |
| \`oneuptime.data.table.row_count_change_percent\` | Di quanto si è mosso il numero di righe dalla raccolta precedente, in percentuale (-50 significa metà delle righe sparite). Le tabelle sotto le 1.000 righe sono escluse |
| \`oneuptime.data.table.schema_changes\` | Colonne cambiate dalla raccolta precedente |
| \`oneuptime.data.table.breaking_schema_changes\` | Colonne rimosse, rinominate o con un tipo diverso dalla raccolta precedente |

Ogni riga porta \`oneuptime.data.store.id\`, \`oneuptime.data.store.name\`, \`oneuptime.data.table.id\`, \`oneuptime.data.table.schema\`, \`oneuptime.data.table.name\` e \`oneuptime.data.table.key\` (\`schema.table\`). Un monitor di metriche raggruppato per \`oneuptime.data.table.key\` avvisa una volta per tabella, e i suoi filtri **Anomalmente alto** e **Anomalmente basso** confrontano ogni tabella con il suo valore abituale per quell'ora della settimana, così non serve impostare alcuna soglia.

## Avvisi

Un database che colleghi si apre sui suoi **Avvisi consigliati**; più avanti, sceglili per lui in **Database**. Ogni consiglio è un monitor di metriche per l'intero database che avvisa una volta per tabella, così anche una tabella creata in seguito viene sorvegliata:

| Avviso | Scatta quando |
| --- | --- |
| **Tabella in ritardo** | Una tabella resta oltre il momento in cui di solito cambia per quindici minuti - la stessa regola dell'etichetta **In ritardo** |
| **Numero di righe in forte calo** | Una tabella perde metà delle sue righe o più tra due raccolte |
| **Numero di righe insolitamente basso** | Una tabella contiene molte meno righe del solito per quell'ora della settimana (impara in due settimane) |
| **Schema modificato** | Colonne di una tabella vengono rimosse, rinominate o cambiano tipo. Una colonna aggiunta non rompe nulla e resta nella cronologia |
| **Lo stato delle tabelle non arriva più** | Nessuna tabella del database è stata letta per quindici minuti |

Scegli gravità, criteri di reperibilità, proprietari ed etichette quando li crei. Da quel momento sono monitor normali: modificali, silenziali o mettili su una pagina di stato come qualsiasi altro.

Un backfill o una migrazione non dovrebbe avvisare nessuno. Indica il database in **Data Observability Database** in un evento di manutenzione, oppure includi il suo server di database in uno, e i suoi avvisi sui dati restano in silenzio finché l'evento è in corso.

## Proprietari ed etichette

La scheda **Proprietari** di una tabella indica le persone e i team a cui appartiene, e gli avvisi della tabella vanno a loro; se non ne ha, ai proprietari del suo database. Le **Regole del proprietario** e le **Regole etichette** si applicano a ogni tabella appena compare, in base alle sue etichette o a un'espressione regolare sul suo nome, sul suo schema o sul suo database. Un'autorizzazione limitata a \`Owned\` raggiunge solo le tabelle che il suo titolare o i suoi team possiedono, con i loro controlli, la loro attività e i problemi segnalati. Possedere un database non rende qualcuno proprietario delle sue tabelle: usa una regola del proprietario per dare a un team un intero database. Nella loro scheda **Regole pipeline**, le regole del proprietario indicano anche i proprietari di una pipeline, con un'espressione regolare sul suo nome o sul suo namespace, quando OneUptime vede la pipeline per la prima volta.

## Quando si apre un avviso

L'avviso di una tabella ha una scheda **Dati** che dice perché si è verificato con più probabilità, in ordine: un avviso a monte, un'esecuzione non riuscita, un deployment di un servizio che vi scrive, le sue scritture non riuscite, una colonna cambiata, il database o il server su cui gira. Sotto c'è ciò che dipende da essa: tabelle, dashboard, servizi e le persone a cui appartengono. Come la scheda **Derivazione** dell'avviso, parla solo delle tabelle e delle pipeline che il tuo ruolo può leggere.

Di' che cosa ne pensi: **Utile**, **Previsto** (un evento pianificato: non cambia nulla) oppure **Non è un problema** (la tabella riceve più margine, così la stessa cosa resta in silenzio la prossima volta). Se una persona trova per prima un problema, **Segnala un problema** sulla tabella lo registra. La **Panoramica** mostra il bilancio: avvisi utili a settimana, quanti non erano rumore, quanto spesso un problema è stato rilevato prima che qualcuno lo segnalasse, con che rapidità, e quanto spesso la causa probabile era quella vera.


## Prodotti di dati

Chi usa i dati (analisti, finanza, dirigenti, agenti AI) pensa in termini di ciò che usa: «le tabelle della dashboard dei ricavi», non i database. Un prodotto di dati nomina quelle tabelle, con il suo proprietario, i suoi consumatori e il suo SLA di freschezza. Creane uno in **Prodotti di dati**. Il suo SLA è uno dei due, o entrambi:
- **Aggiornato entro un'ora del giorno (UTC):** i dati di ogni giorno arrivano quel giorno, entro quell'ora. Da quell'ora, ogni tabella deve essere cambiata quel giorno; fino ad allora, vale il caricamento di ieri. Un caricamento che arriva sempre con mezz'ora di ritardo è in ritardo per quella mezz'ora ogni giorno.
- **Un'età massima:** l'ultima modifica di nessuna tabella può essere più vecchia di così.

Ogni cinque minuti le tabelle di ogni prodotto vengono confrontate con il suo SLA. Il prodotto è **In ritardo** quando lo è una sua tabella, e i suoi dati risalgono all'ultima modifica più vecchia tra di esse. Scrive \`oneuptime.data.product.late_tables\` e \`oneuptime.data.product.data_age\`, così puoi rappresentare fianco a fianco la freschezza di ogni prodotto.

Salvare un prodotto crea anche, a tuo nome e con le tue autorizzazioni:
- **Un monitor**, che rappresenta il prodotto su una pagina di stato. È degradato finché una tabella è in ritardo, e apre un incidente e un avviso al livello meno grave del tuo progetto, che si risolvono da soli. Aggiungilo a una pagina di stato, privata o pubblica, come risorsa: i consumatori che si iscrivono vengono a sapere quando il prodotto è in ritardo e quando è di nuovo aggiornato.
- **Uno SLO** su quel monitor: la quota di tempo in cui i dati sono puntuali, rispetto all'obiettivo dello SLA del prodotto su 30 giorni, con gli avvisi di burn rate rapido e lento con cui parte ogni SLO.

Eliminare il prodotto elimina entrambi. Ogni prodotto ha anche un **badge** che dice a quando risalgono i suoi dati, verde finché sono puntuali e ambra con «late» quando non lo sono. Incorporalo in una dashboard BI, una pagina wiki o un README dalla panoramica del prodotto. Il suo link non richiede l'accesso, quindi trattalo come un link condiviso; **Reimposta link del badge** ne crea uno nuovo e ritira il vecchio.

## Controlli sui valori di una tabella

Lo stato di una tabella dice se cambia. Un **controllo** dice se ciò che contiene è corretto. Aggiungine uno nella scheda **Controlli** di una tabella:

| Controllo | Che cosa legge |
| --- | --- |
| **Percentuale di NULL** | Percentuale delle righe la cui colonna è vuota |
| **Percentuale di duplicati** | Percentuale dei valori che ripetono quello di un'altra riga |
| **Conteggio dei valori distinti** | Quanti valori diversi contiene la colonna |
| **Minimo**, **Massimo**, **Media**, **Somma** | Di una colonna numerica (la somma di nessuna riga è 0) |
| **Percentuale di valori non validi** | Percentuale dei valori fuori da un elenco che indichi tu |
| **Percentuale di formato errato** | Percentuale dei valori che non sono in un formato che scegli, come E-mail, UUID o Codice paese, o che non corrispondono a una tua espressione regolare (tutti i motori tranne SQL Server) |
| **Conteggio delle righe orfane** | Righe il cui valore non ha corrispondenza nella colonna di un'altra tabella |
| **Numero di righe** | Righe nella tabella, più utile con **Segmenta per** |
| **SQL personalizzato** | Il numero che restituisce una tua SELECT in sola lettura |

I **Controlli suggeriti**, nella stessa scheda, propongono i controlli che le colonne di una tabella richiedono, solo in base ai loro nomi e tipi:
- Un id è univoco.
- Un \`customer_id\` ha una riga corrispondente in \`customers\`.
- Un'e-mail sembra un'e-mail, e un importo non è negativo.
- Uno stato mantiene i suoi valori abituali.
- Una tabella suddivisa per tenant viene contata per tenant.

Aggiungine uno, aggiungili tutti oppure scartane uno per sempre.

**Segmenta per** esegue un controllo una volta per ogni valore di una colonna, come un tenant o una regione: una serie e un avviso ciascuno, per i 100 segmenti più grandi. Un numero di righe segmentato avvisa quando un tenant smette di inviare dati.

I controlli vengono eseguiti con la raccolta del database, da OneUptime o dalla sua sonda, ogni 15 minuti, ogni ora, ogni 6 ore o ogni giorno. Ciascuno viene eseguito come un'unica istruzione di aggregazione in una transazione in sola lettura con un timeout dell'istruzione: dal database esce solo il numero, a meno che un progetto non scelga di conservare un campione mascherato di righe in errore. Il valore viene scritto come \`oneuptime.data.check.value\`, con \`oneuptime.data.check.id\`, \`oneuptime.data.check.name\` e \`oneuptime.data.check.segment\`.

Imposta **Avvisa quando** per creare un avviso su un controllo:
- **Insolitamente alto** o **Insolitamente basso** confronta ogni valore con la sua baseline appresa per quell'ora della settimana.
- **Sopra** o **Sotto** lo confronta con una soglia.

Salvare il controllo crea un monitor di metriche per esso, a tuo nome e con le tue autorizzazioni. Svuotare la condizione rimuove il monitor.

**Righe in errore** conta le righe che restituisce una tua SELECT in sola lettura: le righe che non dovrebbero esistere. 0 significa che va tutto bene.

Tre cose tengono sotto controllo il costo di un controllo. **Percentuale di campionamento** legge una parte delle righe, per un controllo che legge un tasso. **Massimo che un controllo può leggere (GB)**, in **Impostazioni**, ferma un controllo su BigQuery o Athena prima che legga più di quel valore. **Attendi quando un database è occupato**, anch'esso lì, lascia i controlli in scadenza alla raccolta successiva quando un database PostgreSQL, MySQL o SQL Server sembra occupato.

**Conserva le righe in errore**, in **Impostazioni**, conserva fino a 20 righe in errore di un controllo, con le colonne sensibili mascherate prima che lascino il database. È disattivato finché non lo attivi. Le righe vengono salvate in OneUptime, sui server di OneUptime con OneUptime Cloud e sui tuoi con un'installazione self-hosted, e disattivarlo le elimina.

Tieni i controlli in un file del tuo repository e applicali dalla CI con \`oneuptime data-checks apply checks.yaml\`. Eseguilo con \`--dry-run\` su una pull request. Un errore in qualsiasi punto del file fa sì che non venga applicato nulla. Il formato del file è descritto nella documentazione.


## Riconciliazioni

Le copie si discostano: il warehouse ha meno ordini del database dell'applicazione, oppure una migrazione ha perso righe. Una riconciliazione confronta una misura di due tabelle, in un database o in due:
- **Numero di righe**
- **Somma** di una colonna
- **Conteggio dei valori distinti** di una colonna
- **SQL personalizzato**: una query in sola lettura che restituisce un numero, chiamato \`value\`.

Ha una tolleranza, un importo **Assoluta** o una **Percentuale** del valore dell'origine. Creane una in **Riconciliazioni**.

Ogni lato viene letto da un controllo dei dati proprio, che la riconciliazione crea e mantiene, con la raccolta del suo database: da OneUptime o dalla sonda del database. Una riconciliazione può quindi confrontare una tabella PostgreSQL nella tua rete con la sua copia in Snowflake o BigQuery. I suoi controlli compaiono nella scheda Controlli di ogni tabella e si modificano solo dalla riconciliazione.

I due valori vengono confrontati appena entrambi sono stati letti a meno di 15 minuti l'uno dall'altro, e poi entrambi i lati vengono pianificati per essere letti di nuovo insieme. Una riconciliazione scrive:
- \`oneuptime.data.reconciliation.drifted\`: 1 quando i due si sono discostati oltre la tolleranza, 0 quando coincidono. Il suo monitor lo legge e avvisa quando si discostano.
- \`oneuptime.data.reconciliation.difference\`: il valore della destinazione meno quello dell'origine.
- \`oneuptime.data.reconciliation.difference_percent\`: la differenza come percentuale del valore dell'origine.

Un lato il cui controllo non riesce dice perché. Una copia caricata secondo una pianificazione è in ritardo rispetto alla sua origine: confronta una misura su cui entrambe si sono assestate, come le righe più vecchie di un'ora, con SQL personalizzato, oppure tieni conto del ritardo nella tolleranza.

## Pipeline e derivazione, da OpenLineage

Airflow, Dagster, Spark, dbt e Flink descrivono ogni esecuzione di un job con eventi [OpenLineage](https://openlineage.io). Inviali a OneUptime, senza modifiche, con una chiave di acquisizione della telemetria (Impostazioni del progetto > Telemetria e APM > Chiavi di acquisizione):

- **URL:** \`https://oneuptime.com/telemetry/openlineage\` (su un OneUptime self-hosted, il tuo indirizzo)
- **Endpoint:** \`api/v1/lineage\`, il predefinito di OpenLineage
- **Chiave API:** la chiave di acquisizione. Viene inviata come \`Authorization: Bearer\`, oppure imposta \`x-oneuptime-token\`.

Per il provider OpenLineage di Airflow:

\`\`\`bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
\`\`\`

Per qualsiasi client OpenLineage, imposta \`OPENLINEAGE_URL\` e \`OPENLINEAGE_API_KEY\`.

Ogni job compare in **Pipeline**, con la sua ultima esecuzione: quando è iniziata e finita, quanto è durata e l'errore di un'esecuzione non riuscita. Un'esecuzione che legge e scrive tabelle sorvegliate da OneUptime diventa **derivazione**: la scheda **Derivazione** di una tabella mostra le tabelle da cui è costruita, le pipeline che vi scrivono con la loro ultima esecuzione e le tabelle costruite a partire da essa.

I dataset vengono associati alle tabelle secondo la specifica di denominazione di OpenLineage: \`postgres://host:5432\` con \`database.schema.table\`, \`mysql://host:3306\` con \`database.table\`, \`sqlserver://host:1433\` e \`redshift://cluster:5439\` con \`database.schema.table\`, \`snowflake://account\` con \`database.schema.table\`, \`bigquery\` con \`project.dataset.table\`, \`clickhouse://host:8443\` con \`database.table\`, e \`databricks://workspace-host\` con \`catalog.schema.table\`.

Ogni pipeline impara dalle proprie esecuzioni quanto dura di solito un'esecuzione (la mediana delle sue ultime 20 esecuzioni completate) e quanto tempo passa tra un'esecuzione e l'altra secondo la sua pianificazione (l'intervallo più lungo tra i suoi ultimi 50 avvii che non sia un caso isolato). Entrambi sono noti dopo cinque esecuzioni, e vanno bene sia per un job che gira ogni cinque minuti sia per uno notturno. Quando il tuo scheduler invia il facet \`nominalTime\` di OpenLineage, come fa Airflow, l'orario pianificato di un'esecuzione vale come il suo avvio, così un backfill si legge comunque come la pianificazione.

La pagina di una pipeline consiglia tre monitor, ciascuno creato con un clic:
- **Esecuzione della pipeline non riuscita**: un'esecuzione non è riuscita o è stata interrotta.
- **Esecuzione della pipeline insolitamente lunga**: un'esecuzione ha impiegato il doppio del tempo abituale, o più. Viene verificato ogni cinque minuti mentre l'esecuzione è in corso, così un'esecuzione bloccata viene notata prima che finisca.
- **Pipeline in ritardo**: nessuna esecuzione è partita da più tempo di quanto consenta la pianificazione, con un quarto dell'intervallo e almeno quindici minuti di margine.

Leggono queste metriche, ciascuna etichettata con \`oneuptime.data.pipeline.id\` e \`oneuptime.data.pipeline.name\`:
- \`oneuptime.data.pipeline.run_failed\`: 1 o 0, al termine di ogni esecuzione.
- \`oneuptime.data.pipeline.run_duration\`: secondi, al termine di ogni esecuzione.
- \`oneuptime.data.pipeline.run_duration_ratio\`: il tempo dell'esecuzione diviso per quello dell'esecuzione tipica (contato come almeno un minuto), al termine di ogni esecuzione e ogni cinque minuti mentre è in corso.
- \`oneuptime.data.pipeline.overdue_seconds\`: di quanto la prossima esecuzione è oltre la sua pianificazione, ogni cinque minuti; 0 finché è puntuale.

La pagina di una pipeline disegna la sua **Derivazione**, il primo posto in cui guardare quando un'esecuzione non riesce o è in ritardo: a sinistra le tabelle che legge, a destra le tabelle che scrive, e come sta ciascuna adesso. Scegli più passi per vedere da cosa sono costruite quelle tabelle e cosa è costruito da esse; un conteggio di tabelle non disegnate, sulla scheda della pipeline o di una tabella, ne disegna altre sul posto. La stessa derivazione è disponibile su \`POST /api/data-observability/pipelines/lineage\`, per i tuoi strumenti. Scegli una delle colonne che scrive per seguirla attraverso la pipeline: a monte fino alla colonna di ogni tabella letta da cui è stata costruita, e a valle fino a ogni tabella in cui la scrive. Per i tuoi strumenti, invia \`"withColumns": true\` per le colonne che le sue esecuzioni hanno spostato.

La pagina **Circuit breaker** di una pipeline prepara un passaggio che chiede, prima che la pipeline venga eseguita, se le tabelle che legge sono in salute: un controllo in errore ferma l'esecuzione, e anche una tabella in ritardo finché **Ferma quando una tabella che legge è in ritardo** è attivo. Una pipeline fermata compare in **Da gestire** finché il circuit breaker non risponde di nuovo go o non inizia un'esecuzione.



## Sincronizzazioni di Fivetran e Airbyte

Fivetran e Airbyte caricano le tue tabelle grezze e non inviano eventi OpenLineage, ma i loro webhook dicono quando ogni sincronizzazione inizia e finisce. Ogni connettore Fivetran e ogni connessione Airbyte diventa una pipeline in **Pipeline**, e ogni sincronizzazione un'esecuzione, con la stessa cronologia delle esecuzioni, la stessa durata e pianificazione apprese e gli stessi avvisi di qualsiasi pipeline: un'esecuzione non riuscita, una insolitamente lunga e una in ritardo. **Pipeline > Connetti Fivetran o Airbyte** compila gli URL qui sotto con una delle tue chiavi di acquisizione.

- **Fivetran:** crea un webhook con l'API REST di Fivetran, per il tuo account o per un gruppo di destinazione, con gli eventi \`sync_start\` e \`sync_end\`. Il suo URL è \`https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>\`, e il suo segreto è quella chiave di acquisizione. Fivetran firma ogni consegna con il segreto, così la chiave stessa non viaggia mai nell'URL, e una consegna non firmata con essa viene rifiutata.
- **Airbyte:** nelle impostazioni di notifica del tuo spazio di lavoro, imposta il webhook su \`https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>\` e attivalo per le sincronizzazioni non riuscite e per quelle riuscite. Airbyte non firma nulla, quindi il suo URL porta la chiave: dai ad Airbyte una chiave tutta sua.

Una pipeline prende il nome che lo strumento dà al connettore o alla connessione, in \`fivetran://<destination group>\` o \`airbyte://<workspace>\`. L'esecuzione di una sincronizzazione non riuscita mostra l'errore dello strumento. Una sincronizzazione Fivetran riprogrammata per il limite di frequenza di un'API termina come **Riprogrammata**: non è un errore, quindi non avvisa nessuno, e il suo tempo non insegna alcuna durata.

Un connettore Fivetran carica lo schema della sua destinazione che porta il suo nome. Quando esattamente un database sorvegliato ha quello schema, le sue tabelle registrano il connettore come loro autore delle scritture: una tabella che diventa obsoleta rimanda alla sincronizzazione che avrebbe dovuto caricarla, e l'avviso di una sincronizzazione non riuscita è la causa degli avvisi delle tabelle (vedi Un solo problema per causa). Airbyte non nomina tabelle.

## Dashboard negli strumenti BI

Il vero impatto di dati sbagliati è la dashboard che qualcuno apre. In **Dashboard BI**, aggiungi i tuoi strumenti BI con credenziali che possano leggere le loro dashboard:

| Strumento | Credenziali (JSON) |
| --- | --- |
| **Metabase** | \`{ "apiKey": "mb_..." }\` (oppure \`username\` e \`password\` di un utente) |
| **Superset** | \`{ "username": "...", "password": "..." }\` |
| **Tableau** | \`{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }\`, un token di accesso personale |
| **Looker** | \`{ "clientId": "...", "clientSecret": "..." }\`, un client API |
| **Power BI** | \`{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }\`, un'entità servizio autorizzata a usare le API di amministrazione di Power BI |
| **Hightouch** | \`{ "apiKey": "..." }\`: ogni sincronizzazione viene letta come un'altra cosa che dipende da una tabella |
| **Census** | \`{ "apiKey": "...", "region": "us" }\`: ogni sincronizzazione viene letta come un'altra cosa che dipende da una tabella |

Ogni ora, e quando viene aggiunto uno strumento o scegli **Leggi ora**, OneUptime legge ogni dashboard e le tabelle che ci sono dietro: la tabella di una scheda e l'SQL di una domanda nativa (Metabase), la tabella di un dataset o l'SQL di un dataset virtuale (Superset), le tabelle a monte della Metadata API (Tableau), l'explore di ogni riquadro (Looker) e il dataset di ogni report (Power BI, da una scansione dell'area di lavoro). Ogni tabella viene associata a una tabella sorvegliata tramite il suo database, il suo schema e il suo nome; un nome che corrisponde ancora a due tabelle sorvegliate resta non associato. La scheda **Derivazione** di una tabella, la scheda **Dati** dei suoi avvisi e la Revisione di produzione elencano le dashboard costruite su di essa, e sulle tabelle costruite a partire da essa. Vengono letti solo nomi e link, mai i dati di una dashboard.

Uno strumento Power BI può anche avvisare sugli aggiornamenti non riusciti dei suoi dataset. Con **Avvisa per gli aggiornamenti non riusciti** attivo, come lo è per uno strumento aggiunto ora, OneUptime mantiene un monitor per lo strumento che apre un avviso per ogni dataset il cui ultimo aggiornamento non è riuscito o è stato annullato, indicato nel titolo dell'avviso, e lo risolve appena termina un aggiornamento successivo. Legge \`oneuptime.data.bi.refresh_failed\`, etichettata con \`oneuptime.data.bi.dataset.name\` e \`oneuptime.data.bi.workspace.name\`: ogni cinque minuti, ogni dataset che la lettura oraria ha trovato in errore scrive 1, e 0 per l'ora successiva al termine di un aggiornamento successivo. Un aggiornamento ancora in corso non cambia nulla, quindi un errore è un solo avviso, per quante letture orarie lo vedano.

## I job nelle tue tracce

Un CronJob Kubernetes, o una funzione con un timer, non ha bisogno di nulla di installato per comparire come pipeline: gli span con \`k8s.cronjob.name\` o \`k8s.job.name\`, oppure \`faas.name\` con un \`faas.trigger\` di \`timer\` o \`datasource\`, ne diventano una, con le sue esecuzioni e le tabelle toccate dalle sue chiamate al database. Ogni esecuzione rimanda alla sua traccia e ai suoi log, e un CronJob che smette di girare viene visto come in ritardo.

## La derivazione che indicano i database

La derivazione non ha bisogno di una pipeline che invii OpenLineage. Ogni database ne indica da sé una parte, e OneUptime la legge con la raccolta del database:
- **Viste:** una vista è costruita dalle tabelle su cui è definita, in PostgreSQL, Redshift, MySQL 8 e SQL Server. Quando una vista viene ridefinita o eliminata, la sua vecchia derivazione se ne va con lei.
- **Cronologia delle query:** una query che ha letto una tabella e ne ha scritta un'altra, come una query pianificata, un modello dbt o un MERGE, è anch'essa derivazione. Arriva dai job di BigQuery (la vista \`INFORMATION_SCHEMA.JOBS\` del progetto e della località del dataset, che richiede **BigQuery Resource Viewer**) e dal log delle query di Redshift (\`stl_insert\` e \`stl_scan\`, che richiedono \`SYSLOG ACCESS UNRESTRICTED\`). Nella vista dei job compaiono solo i job eseguiti nel progetto stesso del dataset.

La derivazione viene letta una volta all'ora, fino all'ultima lettura, e una settimana indietro alla prima raccolta di un database, così c'è fin dall'inizio. Una lettura BigQuery viene fatturata per le ore di job che legge, per lo più con il minimo di 10 MB di BigQuery.

Ogni arco nella scheda **Derivazione** di una tabella dice dove è stato visto: nell'esecuzione di una pipeline, nella cronologia delle query (con un'utenza le cui query hanno spostato i dati) o nella definizione di una vista. La derivazione da ogni fonte conta per **Un solo problema per causa**.

In cima alla scheda **Derivazione** di una tabella, un diagramma disegna la sua derivazione per qualche passo in ogni direzione (tre, oppure scegli 1, 2 o 5): a sinistra ciò da cui è costruita, a destra le tabelle e le dashboard costruite a partire da essa, e le pipeline che caricano dati dall'esterno dove entrano. Ogni scheda dice com'è adesso - in ritardo, un avviso aperto, un'esecuzione non riuscita - e una freccia diventa rossa quando l'ultima esecuzione della sua pipeline non è riuscita, così si può seguire una tabella in ritardo fino all'esecuzione che l'ha rotta. Apri una tabella qualsiasi per centrare il diagramma su di essa. Una scheda disegna al massimo dieci tabelle in ogni direzione e conta le altre, come **+14**: seleziona il conteggio per disegnare le successive dove sono, e **Reimposta il diagramma** per tornare indietro. Dove le fonti nominano le colonne, scegli una delle colonne della tabella in **Segui una colonna** per evidenziare da dove viene e dove va, anche dove viene rinominata lungo il percorso. La stessa derivazione è disponibile su \`POST /api/data-observability/tables/lineage\`, per i tuoi strumenti: invia \`"withColumns": true\` per le colonne di ogni freccia, e chiedi a \`POST /api/data-observability/lineage/expand\` le tabelle successive di una scheda. La derivazione mostra solo le tabelle e le pipeline che il tuo ruolo può leggere: ciò che non puoi leggere non viene mai disegnato, nominato su una freccia o contato.

## dbt

Dopo \`dbt build\` (o run, test, seed o snapshot), invia gli artefatti del progetto con la CLI e una chiave di acquisizione della telemetria. Legge \`target/manifest.json\` e \`target/run_results.json\` e invia solo ciò che Data Observability ne legge:

\`\`\`bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
\`\`\`

In CI, esegui \`oneuptime dbt upload\` come passo successivo al build, anche quando il build non riesce, così i test non riusciti vengono registrati. Per un job dbt Cloud, scarica i suoi artefatti con l'API di dbt Cloud, poi caricali con \`--manifest\` e \`--run-results\`. Oppure inviali tu: \`POST /telemetry/dbt/v1/artifacts\` con \`{ "manifest": ..., "run_results": ... }\` e la chiave in \`x-oneuptime-token\`.

Che cosa fa ogni caricamento:
- **Tabelle:** ogni modello, seed, snapshot e sorgente che è una tabella sorvegliata da OneUptime riceve una scheda **dbt** nella sua panoramica: il nodo, la sua materializzazione, il proprietario, i tag e l'ultimo build. La sua descrizione dbt riempie la descrizione della tabella quando è vuota. Una tabella viene associata tramite il suo database, il suo schema e il suo nome, per PostgreSQL, MySQL, SQL Server, Redshift, Snowflake, BigQuery, ClickHouse e Databricks. dbt non conosce l'host, quindi quando due database sorvegliati condividono un nome, le loro tabelle restano non associate, a meno che solo uno dei due contenga la tabella.
- **Derivazione:** ciò da cui è costruito ogni modello diventa derivazione nella scheda **Derivazione** della tabella, tramite la pipeline del progetto.
- **Test:** ogni test di una tabella sorvegliata compare nella sua scheda **Controlli**, con il suo ultimo risultato e le righe che ha trovato in errore. Fai clic su **Avvisa in caso di errori** perché un test che fallisce apra un avviso.
- **Build:** ogni build è un'esecuzione della pipeline del progetto in **Pipeline** (namespace \`dbt\`). Un build con un errore o un test non riuscito è un'esecuzione non riuscita, quindi gli avvisi delle pipeline funzionano anche sui build dbt: non riuscito, insolitamente lungo e in ritardo.

## Tabelle inutilizzate

Ogni motore conta le letture di ogni tabella nelle proprie statistiche:
- PostgreSQL: le sue scansioni.
- MySQL: le letture di performance_schema.
- SQL Server: i suoi seek, scan e lookup, con l'orario dell'ultimo.

Ogni raccolta confronta il contatore con l'ultimo conservato, così l'**Ultima lettura** di una tabella è nota con precisione all'ora, e così il momento da cui non ne ha avute. Un contatore a 0 alla prima raccolta di una tabella significa che non è stata letta da quando sono partite le statistiche del motore, così una tabella inutilizzata compare come inutilizzata fin dall'inizio, non dopo mesi di sorveglianza. Conta anche una lettura vista negli span di database di un servizio.

**Tabelle inutilizzate** elenca le tabelle che nessuno ha letto da 90 giorni, dalle più grandi, con quando ciascuna è stata scritta l'ultima volta: una tabella ancora scritta ma mai letta costa le sue scritture e il suo spazio. La panoramica mostra quante sono e che cosa contengono. Le viste non tengono contatori propri, quindi non vengono mai elencate. Quando l'utenza del database non può leggere i contatori, l'ultima lettura di una tabella non è nota.

## Spesa del warehouse

Una volta all'ora, con la raccolta di ogni warehouse, OneUptime legge quanto Snowflake e BigQuery hanno speso nell'ultimo giorno, job per job: i crediti di calcolo di Snowflake da \`QUERY_ATTRIBUTION_HISTORY\` (con \`IMPORTED PRIVILEGES\` sul database \`SNOWFLAKE\`, eseguito sul warehouse della connessione) e i byte fatturati di BigQuery dalla sua vista dei job (con **BigQuery Resource Viewer**). Un job è una query eseguita più e più volte - la query parametrizzata di Snowflake, la query di BigQuery senza i suoi letterali - indicata dal suo query tag o dalla sua etichetta, oppure da ciò che fa e dalla tabella che scrive, e mai dal testo della sua query.

**Spesa del warehouse** mostra i crediti e i byte fatturati della giornata, per team (il \`team\` nel query tag o nell'etichetta di un job, altrimenti chi lo esegue), le tabelle le cui scritture costano di più (la spesa di un job divisa tra le tabelle che scrive, dove ACCESS_HISTORY di Snowflake o la tabella di destinazione di BigQuery dicono quali), i job non riusciti e quanto va a job che scrivono solo tabelle che nessuno ha letto da 90 giorni.

## Un solo problema per causa

Quando una tabella diventa obsoleta, diventa obsoleta anche ogni tabella costruita a partire da essa. Prima che si apra un avviso sui dati, OneUptime cerca nella derivazione un avviso già aperto su ciò da cui è costruita la sua tabella o la sua pipeline: le tabelle a monte, le pipeline che vi scrivono e i database in cui si trovano, fino a cinque passi verso l'alto. Quando ne trova uno, il nuovo avviso è la conseguenza di quell'avviso:
- Parte **riconosciuto**, così nessuno viene avvisato due volte per un solo problema. Si risolve da solo appena lo fanno i suoi dati.
- Il suo feed dice quale avviso l'ha causato, e lo dice anche la sua scheda **Dati**.
- Si unisce all'episodio della causa, quando la causa è in uno.

La scheda **Dati** della causa elenca il suo **Impatto a valle**: ogni avviso che ha causato. La scheda di un avviso su una tabella mostra anche i servizi che scrivono nella tabella, con le loro scritture non riuscite, e i loro deployment e altre modifiche nel giorno precedente all'avviso.

Sotto la scheda **Dati**, la pagina di un avviso disegna la sua **Derivazione**: attorno alla sua tabella, come la disegna la scheda **Derivazione** della tabella, oppure attorno alla sua pipeline, con evidenziato il percorso verso l'alto fino all'avviso che l'ha causato e verso il basso fino a ogni avviso che ha causato, la causa contrassegnata con **Causa** e ogni avviso causato con **Conseguenza**. Quando la causa è su una pipeline disegnata su una freccia, la freccia dice **Causa** sotto il nome della pipeline. Un avviso da un controllo su una colonna, come un controllo Percentuale di NULL su \`customer_id\`, si apre con quella colonna seguita accanto a questi percorsi, come nella scheda **Derivazione** della tabella; scegli lì un'altra colonna della tabella, oppure svuotala per vedere solo i percorsi. Chi non può vedere l'avviso che l'ha causato non riceve né la scheda **Dati** né la derivazione, e un avviso causato che non può vedere non viene né evidenziato né contato. La stessa derivazione è disponibile su \`POST /api/data-observability/alerts/<alert ID>/lineage\`, con la \`column\` che legge l'avviso di un controllo su una colonna e le colonne che porta ogni freccia. Un avviso causato su una pipeline disegnata su una freccia vi dice **Conseguenza** allo stesso modo, e il selettore delle colonne offre prima la colonna del controllo, poi le altre colonne della tabella nel suo ordine.


## OneUptime AI

- **Indagini sugli avvisi sui dati.** Quando OneUptime AI indaga su un avviso su una tabella, una pipeline o un database, legge ciò che le sta accanto: la freschezza della tabella e i suoi avvisi aperti, l'avviso di cui è conseguenza, le esecuzioni delle pipeline che vi scrivono dal giorno prima (un'esecuzione non riuscita con il suo errore), i servizi che vi scrivono con le loro scritture non riuscite e i loro deployment e altre modifiche, e la sua derivazione: le tabelle da cui è costruita e le tabelle costruite a partire da essa, prima quelle con un problema, con dove si trova l'avviso di cui è conseguenza e su quali tabelle si trovano gli avvisi che ha causato. Per un avviso da un controllo su una colonna, segue anche quella colonna lungo la derivazione: le colonne da cui è costruita a monte e le colonne costruite a partire da essa a valle, tabella per tabella. Indica l'esecuzione, il deployment o la tabella a monte dietro l'avviso. Chiunque possa vedere l'avviso legge il suo rapporto, quindi legge solo ciò che tutti loro possono leggere: dove un ruolo legge tabelle o pipeline solo in base a **Proprietari** o **Etichette**, nessuna di quelle che questi mettono da parte, oltre alla tabella o alla pipeline dell'avviso stesso. Non ne nomina né ne conta mai altre, né in ciò da cui parte né in ciò che chiede lungo il percorso.
- **Un controllo da una frase.** Nella scheda Controlli di una tabella, **Scrivi un controllo da una frase** trasforma una regola come «gli ordini non hanno mai un totale negativo» in un controllo SQL personalizzato che conta le righe che la violano, con un avviso appena ce ne sono. Leggi la query prima che **Aggiungi controllo** la aggiunga, ed è soggetta a tutto ciò a cui è soggetto qualsiasi controllo SQL personalizzato: un'unica istruzione in sola lettura, eseguita in una transazione in sola lettura.
- **Questa tabella è aggiornata?** Chiedilo a OneUptime AI in Chiedi all'IA, Slack o Microsoft Teams («la tabella orders è aggiornata?»). Risponde con la freschezza della tabella secondo il suo ritmo, quando è cambiata l'ultima volta, i suoi avvisi aperti, le ultime esecuzioni di chi vi scrive e i prodotti di dati di cui fa parte. Gli agenti AI chiedono la stessa cosa tramite lo strumento \`get_data_table_freshness\` del server MCP, prima di usare i dati.
- **Da cosa è costruita questa tabella?** Chiedilo allo stesso modo («cosa alimenta la tabella revenue?», «cosa si rompe se raw.orders smette di caricarsi?»). Segue la derivazione della tabella per tre passi in ogni direzione, o fino a cinque se richiesto, e mette per prime le tabelle a monte e a valle che sono in ritardo, eliminate, hanno avvisi aperti o la cui pipeline ha fallito l'ultima esecuzione, dalle più vicine, con a quanti passi si trova ciascuna e le tabelle intermedie; poi il resto, le pipeline che caricano le sue sorgenti dall'esterno di ciò che OneUptime sorveglia, e le dashboard BI costruite su di essa. Gli avvisi aperti vengono contati, mai nominati, e solo quelli che può vedere chi chiede. Gli agenti AI chiedono la stessa cosa tramite lo strumento \`get_data_table_lineage\` del server MCP, prima di modificare una tabella. Conta una sola volta ogni tabella oltre ciò che dice, per quante tabelle citate le stiano accanto. Aperto sulla pagina di una tabella, Chiedi all'IA sa quale tabella è «questa tabella» e chiede di quella, anche quando più database hanno una tabella con quel nome. Come ogni vista della derivazione, parla solo delle tabelle e delle pipeline che chi chiede può leggere.

## I servizi che usano ogni tabella

La scheda **Servizi** di una tabella elenca i servizi visti scrivere e leggere in essa, con le istruzioni che ciascuno ha eseguito, le sue chiamate e i suoi errori nell'ultima ora, e quando è stato visto l'ultima volta. Viene dagli span di database che i tuoi servizi inviano già con OpenTelemetry: uno span client con \`db.system.name\`, \`db.namespace\` e \`db.collection.name\` (oppure \`db.sql.table\`, o uno span con un nome come \`INSERT orders\`). Niente in più da installare. Viene aggiornata ogni 15 minuti.

Ogni servizio mostra anche gli endpoint che fanno le sue chiamate, ed è contrassegnato come **App IA** quando chiama anche un modello. **Errori che citano questa tabella** elenca le eccezioni aperte e i log di errore dell'ultimo giorno dei servizi che scrivono nella tabella, quando la nominano.

Uno span viene legato a una tabella solo quando il suo database è quello letto da una raccolta e, quando due database condividono un nome, solo quando il suo \`server.address\` è uno dei loro. Quando non è sicuro, lascia fuori lo span.

Queste metriche sono dati operativi propri di OneUptime e non vengono fatturate come telemetria.
`;

export default DOCUMENTATION;

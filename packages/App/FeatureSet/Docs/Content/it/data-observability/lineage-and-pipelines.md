# Lineage e pipeline

Il lineage dice da quali tabelle viene costruita ogni tabella, e quali pipeline la scrivono. Osservabilità dei dati lo raccoglie da sei fonti contemporaneamente - eventi OpenLineage, dbt, sincronizzazioni di Fivetran e Airbyte, job nei tuoi trace, viste e la cronologia delle query di ogni database - e lo usa per collegare ogni tabella in ritardo o danneggiata all'esecuzione che ne è la causa, così un problema apre una sola segnalazione.

## Da dove viene il lineage

| Fonte | Cosa fornisce |
| --- | --- |
| **OpenLineage** | Ogni esecuzione di un job Airflow, Dagster, Spark, dbt o Flink, con le tabelle che ha letto e scritto |
| **dbt** | Da cosa viene costruito ogni modello, ogni build come esecuzione, e il risultato di ogni test |
| **Fivetran e Airbyte** | Ogni sincronizzazione come esecuzione del suo connettore, e le tabelle grezze che carica |
| **Job nei tuoi trace** | Un CronJob Kubernetes o una funzione pianificata, le sue esecuzioni, e le tabelle che le chiamate al suo database hanno letto e scritto |
| **Viste** | Una vista viene costruita dalle tabelle su cui è definita (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, Snowflake, viste materializzate di ClickHouse, Databricks, MongoDB) |
| **Cronologia delle query** | Una query che ha letto una tabella e ne ha scritta un'altra (la cronologia degli accessi di Snowflake, i job di BigQuery, il log delle query di Redshift, il log delle query di ClickHouse, la tabella di lineage di Databricks) |

La scheda **Derivazione** di una tabella mostra le tabelle da cui viene costruita, le pipeline che la scrivono con la loro ultima esecuzione, e le tabelle costruite a partire da essa. Ogni arco indica dove è stato osservato.

In cima alla scheda, un diagramma disegna questa derivazione per alcuni passi in ogni direzione (tre, oppure scegli 1, 2 o 5): a sinistra ciò da cui viene costruita la tabella, a destra le tabelle e le dashboard costruite a partire da essa, e le pipeline che caricano dati dall'esterno, nel punto in cui entrano. Ogni riquadro dice com'è adesso - in ritardo, un avviso aperto, un'esecuzione non riuscita - e una freccia diventa rossa quando l'ultima esecuzione della sua pipeline non è riuscita, così una tabella in ritardo si può seguire fino all'esecuzione che l'ha fermata. Apri qualsiasi tabella per centrare il diagramma su di essa.

Un riquadro disegna al massimo dieci tabelle in ogni direzione e conta le altre, per esempio **+14**. Seleziona il numero per disegnarne fino a dieci in più dove si trovano, prima quelle con problemi, con ogni freccia tra loro e ciò che è già disegnato. **Reimposta il diagramma** torna al diagramma com'era disegnato all'inizio. Quando un lato contiene tante tabelle quante un diagramma ne può contenere, apri una tabella per centrare il diagramma su di essa.

Dove la fonte indica le colonne, la scheda **Colonne** di una tabella dice da dove viene ciascuna colonna e cosa alimenta: la cronologia degli accessi di Snowflake (edizione Enterprise, che richiede `IMPORTED PRIVILEGES` sul database `SNOWFLAKE`) e la faccetta `columnLineage` di OpenLineage.

Nella scheda **Derivazione**, scegli una colonna della tabella in **Segui una colonna** per evidenziare da dove viene e dove va: risalendo il diagramma fino alle colonne da cui è costruita, scendendo fino alle colonne costruite a partire da essa, ciascuna indicata sulla sua tabella, anche dove è stata rinominata lungo il percorso. Una freccia le cui fonti non indicano colonne può portarla oltre ciò che è evidenziato, e il diagramma lo dice.

## OpenLineage

Invia gli eventi OpenLineage a OneUptime, senza modifiche, con una [chiave di acquisizione](/docs/telemetry/ingestion-keys) della telemetria:

- **URL:** `https://oneuptime.com/telemetry/openlineage` (su un OneUptime self-hosted, il tuo indirizzo)
- **Endpoint:** `api/v1/lineage`, il valore predefinito di OpenLineage
- **Chiave API:** la chiave di acquisizione, inviata come `Authorization: Bearer`, oppure imposta `x-oneuptime-token`

Per il provider OpenLineage di Airflow:

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

Per qualsiasi altro client OpenLineage, imposta `OPENLINEAGE_URL` e `OPENLINEAGE_API_KEY`. I dataset vengono associati alle tabelle secondo la convenzione di denominazione di OpenLineage, ad esempio `postgres://host:5432` con `database.schema.table`, `snowflake://account` con `database.schema.table`, `clickhouse://host:8443` con `database.table` e `databricks://workspace-host` con `catalog.schema.table`.

## dbt

Dopo `dbt build` (oppure run, test, seed o snapshot), invia gli artefatti del progetto con la [CLI di OneUptime](/docs/cli/index):

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

In CI, esegui `oneuptime dbt upload` come passaggio successivo alla build, anche quando la build fallisce, così i test non superati vengono registrati. Ogni tabella che dbt costruisce riceve un riquadro **dbt** nella sua panoramica, il lineage dei suoi modelli e i suoi test nella scheda **Controlli**; ogni build è un'esecuzione della pipeline del progetto.

## Fivetran e Airbyte

I loro webhook indicano quando ogni sincronizzazione inizia e finisce. **Pipeline > Connetti Fivetran o Airbyte** compila gli URL con una delle tue chiavi di acquisizione:

- **Fivetran:** un webhook creato con l'API REST di Fivetran, per gli eventi `sync_start` e `sync_end`, verso `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`, con la chiave di acquisizione come segreto. Fivetran firma ogni consegna con essa, così la chiave non viaggia mai nell'URL.
- **Airbyte:** il webhook dell'area di lavoro impostato su `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`, attivo per le sincronizzazioni non riuscite e per quelle riuscite. Dai ad Airbyte una chiave dedicata.

Una sincronizzazione di Fivetran riprogrammata per il limite di frequenza di un'API termina come **Riprogrammata**: non è un errore, quindi non chiama nessuno.

## Job nei tuoi trace

Molte pipeline sono un CronJob Kubernetes, o una funzione su un timer, senza uno scheduler che invii il lineage. I loro trace lo dicono comunque, senza nulla da installare. Ogni quindici minuti, gli span con l'attributo di risorsa `k8s.cronjob.name` o `k8s.job.name`, oppure `faas.name` con un `faas.trigger` pari a `timer` o `datasource`, diventano una pipeline in **Pipeline**:

- Un'esecuzione di un CronJob è il suo Job Kubernetes, e un'esecuzione di una funzione è il suo `faas.invocation_id`.
- Un'esecuzione non è riuscita quando lo è stato lo span in cima al suo trace. Una chiamata fallita e ritentata al suo interno non la fa fallire.
- Le tabelle che ha scritto e letto provengono dai suoi span di database.

Ogni esecuzione rimanda al suo trace, con i suoi registri. Valgono gli stessi tre monitor, quindi un CronJob che smette di girare viene visto come in ritardo.

## Dashboard negli strumenti BI

Il vero impatto dei dati sbagliati è la dashboard che qualcuno apre. In **Dashboard BI**, aggiungi i tuoi strumenti BI con credenziali che possano leggerne le dashboard. Ogni ora l'Osservabilità dei dati legge ogni dashboard e le tabelle che la alimentano, abbina ogni tabella a una monitorata e mostra le dashboard costruite su una tabella, e sulle tabelle costruite da essa, nella sua scheda **Derivazione**, nei suoi avvisi e in Production Review.

| Strumento | Credenziali |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, un service principal autorizzato a usare le API di amministrazione di sola lettura di Power BI. Vengono letti sia i report sia le dashboard, con le loro visualizzazioni e i loro aggiornamenti (sotto) |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (oppure `eu`) |

Hightouch e Census sono strumenti di reverse ETL: una sincronizzazione che copia una tabella in un CRM dipende da quella tabella come una dashboard, quindi viene letta allo stesso modo e nominata negli avvisi della tabella.

Vengono letti solo nomi e link delle dashboard, le tabelle che interrogano e, per Power BI, chi le apre e come sono andati i loro aggiornamenti: mai i loro dati.

### Visualizzazioni e aggiornamenti in Power BI

Per ogni report e dashboard di Power BI, **Dashboard BI** mostra per primi quante volte è stato aperto negli ultimi 28 giorni, quando è stato aperto l'ultima volta e com'è andato l'ultimo aggiornamento dei suoi dati, con l'errore di un aggiornamento non riuscito. Quante persone l'hanno aperto, chi l'ha aperto di più e i suoi ultimi aggiornamenti sono colonne che puoi attivare. La scheda **Derivazione** di una tabella dice lo stesso di ogni dashboard costruita su di essa, con il proprietario e chi la visualizza sotto **Altro**.

- Le **visualizzazioni** vengono dal log attività di Power BI, letto tramite la sua API di amministrazione degli eventi di attività. Power BI ne conserva 28 giorni, risponde a 200 richieste all'ora e divide ogni richiesta in ore, quindi OneUptime lo legge un'ora alla volta: ogni lettura oraria aggiunge le ore trascorse dalla precedente, poi risale i 28 giorni, dalle più recenti, con al massimo 100 richieste. Un nuovo strumento Power BI mostra subito gli ultimi giorni, e tutti i 28 giorni entro un giorno; fino ad allora, le visualizzazioni dicono da quando vengono contate. Un evento può impiegare fino a un'ora per arrivare nel log, quindi le visualizzazioni sono indietro fino a due ore. Chi visualizza è indicato come lo indica Power BI, con il suo indirizzo email.
- Gli **aggiornamenti** dei set di dati su una capacità (Premium, Premium per utente o Fabric) vengono dall'elenco di amministrazione degli elementi aggiornabili di Power BI: l'ultimo aggiornamento di ogni set di dati con il suo errore, e quanti aggiornamenti sono stati eseguiti e non sono riusciti nei sette giorni che Power BI conserva.
- Gli **aggiornamenti dei set di dati su capacità condivisa** non sono in quell'elenco. Power BI mostra la cronologia degli aggiornamenti di un set di dati solo a chi può modificarlo, quindi aggiungi il service principal alla sua area di lavoro come **Collaboratore**, **Membro** o **Amministratore** e attiva per lui **Service principals can call Fabric public APIs** nelle impostazioni per sviluppatori del portale di amministrazione di Fabric. OneUptime legge allora ogni aggiornamento, con il suo errore. Fino ad allora, lo strumento BI dice di quanti set di dati non ha potuto leggere gli aggiornamenti.
- Una dashboard di Power BI i cui riquadri vengono da più set di dati mostra l'ultimo aggiornamento non riuscito o, se nessuno è fallito, il più vecchio: i suoi dati sono aggiornati solo quanto quello.

Le visualizzazioni, e gli aggiornamenti sulle capacità, non richiedono altro che l'accesso alle API di amministrazione indicato sopra: il service principal in un gruppo di sicurezza consentito da **Service principals can access read-only admin APIs**, senza autorizzazioni Power BI sull'app che richiedano il consenso di un amministratore. Quando le visualizzazioni o gli aggiornamenti non possono essere letti, le dashboard vengono comunque lette e mantenute, lo strumento BI dice cosa è stato saltato e perché, e la lettura successiva riprova.

### Avvisi sugli aggiornamenti non riusciti

Attiva **Alert on Failed Refreshes** quando aggiungi o modifichi uno strumento Power BI (uno nuovo parte con l'opzione attiva) e OneUptime mantiene per lo strumento un monitor in **Monitor**, con il suo nome. Il monitor apre un avviso per ogni set di dati il cui ultimo aggiornamento non è riuscito o è stato annullato, con il set di dati e la sua area di lavoro nel titolo dell'avviso, e lo risolve non appena un aggiornamento successivo viene completato. Un set di dati pubblicato più tardi viene sorvegliato non appena viene letto. Disattivando l'interruttore, o rimuovendo lo strumento, il monitor viene rimosso; fino ad allora è un monitor come gli altri, con i suoi proprietari, le sue policy di reperibilità e le sue finestre di manutenzione.

Gli aggiornamenti non riusciti non usano i monitor delle pipeline. Un set di dati il cui aggiornamento non è riuscito continua a mostrare i dati del suo ultimo aggiornamento completato finché non se ne completa uno successivo, quindi il suo avviso resta aperto fino ad allora, mentre l'avviso di un'esecuzione non riuscita si chiude un'ora dopo l'esecuzione. E gli aggiornamenti vengono letti una volta all'ora: un aggiornamento letto fino a un'ora dopo la sua fine cadrebbe spesso fuori dall'ora che guarda **Pipeline Run Failed**, un set di dati aggiornato ogni mezz'ora diventerebbe continuamente **Pipeline Is Late**, e un aggiornamento finito ma non ancora letto sembrerebbe **Pipeline Run Unusually Long**.

- Ogni lettura oraria conserva i set di dati il cui ultimo aggiornamento terminato non è riuscito o è stato annullato. Ogni cinque minuti ciascuno scrive `oneuptime.data.bi.refresh_failed`, 1 finché fallisce e 0 per l'ora successiva al completamento di un aggiornamento successivo, e il monitor lo legge, così un errore apre un solo avviso, per quante letture orarie lo vedano.
- Un errore viene visto alla lettura oraria successiva: il suo avviso si apre fino a un'ora dopo che l'aggiornamento non è riuscito, e si risolve fino a un'ora dopo il completamento di un aggiornamento successivo.
- Un aggiornamento ancora in corso non cambia nulla: l'avviso di un set di dati il cui aggiornamento non è riuscito resta aperto mentre è in corso il suo aggiornamento successivo, e si risolve solo quando un aggiornamento viene completato.
- Su una capacità, l'elenco degli elementi aggiornabili di Power BI dà solo l'ultimo aggiornamento di ogni set di dati, quindi un aggiornamento non riuscito seguito da uno completato nella stessa ora non viene mai visto: a quel punto i dati sono di nuovo aggiornati.
- I set di dati su capacità condivisa generano avvisi solo dove i loro aggiornamenti possono essere letti (sopra), e un set di dati i cui aggiornamenti non è stato possibile leggere mantiene il suo avviso com'era finché non si possono leggere.

## Pipeline

Ogni job, progetto dbt e sincronizzazione compare in **Pipeline**, con le sue esecuzioni: quando ciascuna è iniziata e finita, quanto è durata, a quale tentativo corrispondeva dove lo scheduler lo indica (il numero di tentativo di Airflow), e l'errore di un'esecuzione non riuscita. Dopo cinque esecuzioni, ogni pipeline impara dalle proprie esecuzioni quanto dura di solito un'esecuzione e quanto tempo passa tra un'esecuzione e l'altra secondo la sua pianificazione. La pagina di una pipeline consiglia tre monitor:

- **Pipeline Run Failed**: un'esecuzione non è riuscita o è stata interrotta.
- **Pipeline Run Unusually Long**: un'esecuzione ha impiegato il doppio del tempo abituale o più, verificato ogni cinque minuti mentre è in corso, così un'esecuzione bloccata viene notata prima che finisca.
- **Pipeline Is Late**: nessuna esecuzione è partita da più tempo di quanto la sua pianificazione consenta.

La pagina di una pipeline disegna la sua **Derivazione**, il primo posto in cui guardare quando un'esecuzione non riesce o è in ritardo: a sinistra le tabelle che legge, a destra le tabelle che scrive, la pipeline in mezzo, e ogni riquadro dice com'è adesso. Scegli più passi per vedere da cosa sono costruite quelle tabelle e cosa è costruito a partire da esse, e apri qualsiasi tabella per vedere la sua scheda **Derivazione**. Un numero di tabelle non disegnate, sul riquadro della pipeline o su quello di una tabella, ne disegna altre sul posto anche qui.

## Una segnalazione per causa

Quando una tabella smette di essere aggiornata, ogni tabella costruita a partire da essa smette di esserlo a sua volta. Prima che si apra un avviso sui dati, OneUptime cerca nel lineage un avviso già aperto su ciò da cui viene costruita la sua tabella o la sua pipeline: le tabelle a monte, le pipeline che le scrivono e i database in cui si trovano, fino a cinque livelli più su. Se ne trova uno, il nuovo avviso è una conseguenza di quell'avviso:

- Parte nello stato **Riconosciuto**, così nessuno viene chiamato due volte per lo stesso problema, e si risolve da solo non appena i suoi dati tornano a posto.
- Il suo feed e il suo riquadro **Dati** indicano quale avviso lo ha causato, e si unisce all'episodio della causa.

Il riquadro **Dati** della causa elenca il suo **Impatto a valle**: ogni avviso che ha causato. Il riquadro di un avviso su una tabella mostra anche i servizi che scrivono la tabella, con le loro scritture non riuscite, e i loro deploy e le altre modifiche nel giorno precedente l'avviso.

Sotto il riquadro **Dati**, la pagina di un avviso disegna la sua **Derivazione**: attorno alla sua tabella, come la disegna la scheda **Derivazione** della tabella, o attorno alla sua pipeline. Il percorso che sale fino all'avviso che lo ha causato e scende fino a ogni avviso che ha causato è evidenziato - la tabella o la pipeline della causa segnata come **Causa**, quelle di ogni avviso causato come **Conseguenza** - e il resto si attenua, così chi lo apre vede in quale punto della catena è iniziato il problema. Quando la causa è su una pipeline disegnata su una freccia, la freccia indica **Causa** sotto il nome della pipeline. Quando la causa riguarda un intero database, o si trova più in alto di dove arriva il diagramma, il riquadro lo dice a parole. Un avviso da un controllo su una sola colonna, come un controllo Percentuale di NULL su `customer_id`, si apre con quella colonna seguita accanto a questi percorsi, come nella scheda **Derivazione** della tabella: da dove viene e dove va, indicata su ciascuna tabella. Scegli lì un'altra colonna della tabella, oppure cancellala per vedere solo i percorsi. **Esplora la derivazione** apre la scheda **Derivazione** della tabella, o la pagina della pipeline.

Chi non può vedere l'avviso che lo ha causato non riceve né il riquadro **Dati** né la derivazione, e un avviso causato che non può vedere non viene né evidenziato né contato.

## Prima che una modifica venga unita

Quando una pull request modifica una tabella sorvegliata, [Production Review](/docs/ai/ai-agent) indica sulla pull request cosa ne dipende: i servizi che la leggono, le tabelle costruite a partire da essa, le dashboard su di essa e i suoi prodotti di dati. Una tabella con una copia su un database contrassegnato come Staging indica anche in cosa la copia differisce: le sue righe, le sue colonne e ciò che i controlli della tabella leggono lì, eseguiti al momento. Su un database raggiungibile solo da una sonda, i controlli vengono omessi, e lo indica.

## Passaggi successivi

:::cards
- [Prodotti di dati](/docs/data-observability/data-products): SLA di freschezza sulle tabelle che le persone usano.
- [OneUptime AI e l'API](/docs/data-observability/ai-and-api): Indagini che partono da chi scrive una tabella e dalle sue esecuzioni. In Chiedi all'IA e dagli agenti IA si può chiedere da cosa è costruita una tabella.
:::

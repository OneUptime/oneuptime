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

Dove la fonte indica le colonne, la scheda **Colonne** di una tabella dice da dove viene ciascuna colonna e cosa alimenta: la cronologia degli accessi di Snowflake (edizione Enterprise, che richiede `IMPORTED PRIVILEGES` sul database `SNOWFLAKE`) e la faccetta `columnLineage` di OpenLineage.

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
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, un service principal autorizzato a usare le API di amministrazione di Power BI |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (oppure `eu`) |

Hightouch e Census sono strumenti di reverse ETL: una sincronizzazione che copia una tabella in un CRM dipende da quella tabella come una dashboard, quindi viene letta allo stesso modo e nominata negli avvisi della tabella.

Vengono letti solo nomi e link delle dashboard e le tabelle che interrogano: mai i loro dati.

## Pipeline

Ogni job, progetto dbt e sincronizzazione compare in **Pipeline**, con le sue esecuzioni: quando ciascuna è iniziata e finita, quanto è durata, a quale tentativo corrispondeva dove lo scheduler lo indica (il numero di tentativo di Airflow), e l'errore di un'esecuzione non riuscita. Dopo cinque esecuzioni, ogni pipeline impara dalle proprie esecuzioni quanto dura di solito un'esecuzione e quanto tempo passa tra un'esecuzione e l'altra secondo la sua pianificazione. La pagina di una pipeline consiglia tre monitor:

- **Pipeline Run Failed**: un'esecuzione non è riuscita o è stata interrotta.
- **Pipeline Run Unusually Long**: un'esecuzione ha impiegato il doppio del tempo abituale o più, verificato ogni cinque minuti mentre è in corso, così un'esecuzione bloccata viene notata prima che finisca.
- **Pipeline Is Late**: nessuna esecuzione è partita da più tempo di quanto la sua pianificazione consenta.

## Una segnalazione per causa

Quando una tabella smette di essere aggiornata, ogni tabella costruita a partire da essa smette di esserlo a sua volta. Prima che si apra un avviso sui dati, OneUptime cerca nel lineage un avviso già aperto su ciò da cui viene costruita la sua tabella o la sua pipeline: le tabelle a monte, le pipeline che le scrivono e i database in cui si trovano, fino a cinque livelli più su. Se ne trova uno, il nuovo avviso è una conseguenza di quell'avviso:

- Parte nello stato **Riconosciuto**, così nessuno viene chiamato due volte per lo stesso problema, e si risolve da solo non appena i suoi dati tornano a posto.
- Il suo feed e il suo riquadro **Dati** indicano quale avviso lo ha causato, e si unisce all'episodio della causa.

Il riquadro **Dati** della causa elenca il suo **Downstream Impact**: ogni avviso che ha causato. Il riquadro di un avviso su una tabella mostra anche i servizi che scrivono la tabella, con le loro scritture non riuscite, e i loro deploy e le altre modifiche nel giorno precedente l'avviso.

## Prima che una modifica venga unita

Quando una pull request modifica una tabella sorvegliata, [Production Review](/docs/ai/ai-agent) indica sulla pull request cosa ne dipende: i servizi che la leggono, le tabelle costruite a partire da essa, le dashboard su di essa e i suoi prodotti di dati. Una tabella con una copia su un database contrassegnato come Staging indica anche in cosa la copia differisce: le sue righe, le sue colonne e ciò che i controlli della tabella leggono lì, eseguiti al momento. Su un database raggiungibile solo da una sonda, i controlli vengono omessi, e lo indica.

## Passaggi successivi

:::cards
- [Prodotti di dati](/docs/data-observability/data-products): SLA di freschezza sulle tabelle che le persone usano.
- [OneUptime AI e l'API](/docs/data-observability/ai-and-api): Indagini che partono da chi scrive una tabella e dalle sue esecuzioni.
:::

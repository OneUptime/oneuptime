# Lineage e pipeline

Il lineage dice da quali tabelle viene costruita ogni tabella, e quali pipeline la scrivono. Osservabilità dei dati lo raccoglie da cinque fonti contemporaneamente - eventi OpenLineage, dbt, sincronizzazioni di Fivetran e Airbyte, viste e la cronologia delle query di ogni database - e lo usa per collegare ogni tabella in ritardo o danneggiata all'esecuzione che ne è la causa, così un problema apre una sola segnalazione.

## Da dove viene il lineage

| Fonte | Cosa fornisce |
| --- | --- |
| **OpenLineage** | Ogni esecuzione di un job Airflow, Dagster, Spark, dbt o Flink, con le tabelle che ha letto e scritto |
| **dbt** | Da cosa viene costruito ogni modello, ogni build come esecuzione, e il risultato di ogni test |
| **Fivetran e Airbyte** | Ogni sincronizzazione come esecuzione del suo connettore, e le tabelle grezze che carica |
| **Viste** | Una vista viene costruita dalle tabelle su cui è definita (PostgreSQL, Redshift, MySQL 8, SQL Server, viste materializzate di ClickHouse, Databricks) |
| **Cronologia delle query** | Una query che ha letto una tabella e ne ha scritta un'altra (i job di BigQuery, il log delle query di Redshift, il log delle query di ClickHouse, la tabella di lineage di Databricks) |

La scheda **Derivazione** di una tabella mostra le tabelle da cui viene costruita, le pipeline che la scrivono con la loro ultima esecuzione, e le tabelle costruite a partire da essa. Ogni arco indica dove è stato osservato.

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

## Pipeline

Ogni job, progetto dbt e sincronizzazione compare in **Pipeline**, con le sue esecuzioni: quando ciascuna è iniziata e finita, quanto è durata, e l'errore di un'esecuzione non riuscita. Dopo cinque esecuzioni, ogni pipeline impara dalle proprie esecuzioni quanto dura di solito un'esecuzione e quanto tempo passa tra un'esecuzione e l'altra secondo la sua pianificazione. La pagina di una pipeline consiglia tre monitor:

- **Pipeline Run Failed**: un'esecuzione non è riuscita o è stata interrotta.
- **Pipeline Run Unusually Long**: un'esecuzione ha impiegato il doppio del tempo abituale o più, verificato ogni cinque minuti mentre è in corso, così un'esecuzione bloccata viene notata prima che finisca.
- **Pipeline Is Late**: nessuna esecuzione è partita da più tempo di quanto la sua pianificazione consenta.

## Una segnalazione per causa

Quando una tabella smette di essere aggiornata, ogni tabella costruita a partire da essa smette di esserlo a sua volta. Prima che si apra un avviso sui dati, OneUptime cerca nel lineage un avviso già aperto su ciò da cui viene costruita la sua tabella o la sua pipeline: le tabelle a monte, le pipeline che le scrivono e i database in cui si trovano, fino a cinque livelli più su. Se ne trova uno, il nuovo avviso è una conseguenza di quell'avviso:

- Parte nello stato **Riconosciuto**, così nessuno viene chiamato due volte per lo stesso problema, e si risolve da solo non appena i suoi dati tornano a posto.
- Il suo feed e il suo riquadro **Dati** indicano quale avviso lo ha causato, e si unisce all'episodio della causa.

Il riquadro **Dati** della causa elenca il suo **Downstream Impact**: ogni avviso che ha causato. Il riquadro di un avviso su una tabella mostra anche i servizi che scrivono la tabella, con le loro scritture non riuscite, e i loro deploy e le altre modifiche nel giorno precedente l'avviso.

## Passaggi successivi

:::cards
- [Prodotti di dati](/docs/data-observability/data-products): SLA di freschezza sulle tabelle che le persone usano.
- [OneUptime AI e l'API](/docs/data-observability/ai-and-api): Indagini che partono da chi scrive una tabella e dalle sue esecuzioni.
:::

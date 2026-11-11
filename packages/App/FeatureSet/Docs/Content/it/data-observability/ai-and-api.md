# OneUptime AI e l'API

OneUptime AI conosce i tuoi dati: indaga su un avviso sui dati partendo da chi scrive nella tabella, dalle sue esecuzioni e dalla sua derivazione, risponde ovunque glielo si chieda se una tabella è aggiornata e da cosa è costruita, e scrive un controllo a partire da una regola espressa in una frase. Tutto ciò che mostra Osservabilità dei dati è disponibile anche per i tuoi strumenti, tramite i suoi endpoint, le sue metriche e il server MCP.

## OneUptime AI

- **Indagini sugli avvisi relativi ai dati.** Quando OneUptime AI indaga su un avviso relativo a una tabella, una pipeline o un database, parte da ciò che gli sta accanto: la freschezza e gli avvisi aperti della tabella, l'avviso di cui è conseguenza, le esecuzioni delle pipeline che la scrivono dal giorno prima (un'esecuzione non riuscita con il suo errore, oppure l'esecuzione che non è mai arrivata), i servizi che la scrivono con le loro scritture non riuscite, i loro deploy e le altre modifiche, la sua derivazione (le tabelle da cui viene costruita e le tabelle costruite a partire da essa, prima quelle con un problema, dove vi si trova l'avviso di cui è conseguenza e su quali tabelle sono gli avvisi che ha causato) e le colonne che sono cambiate. Per un avviso da un controllo su una sola colonna, segue anche quella colonna lungo la derivazione: le colonne a monte da cui è costruita e le colonne a valle costruite a partire da essa, tabella per tabella, come le indicano le fonti della derivazione. Indica l'esecuzione, il deploy o la tabella a monte che ha causato l'avviso. Vedi [AI SRE](/docs/ai/ai-sre).
- **Questa tabella è aggiornata?** Chiedilo in [Chiedi all'IA](/docs/ai/ask-ai), Slack o Microsoft Teams: «la tabella orders è aggiornata?». La risposta indica la freschezza della tabella secondo il suo ritmo, quando è cambiata l'ultima volta, i suoi avvisi aperti, le ultime esecuzioni di chi la scrive e i prodotti di dati di cui fa parte. A un nome condiviso da più database viene data una risposta per ciascuno, così a nessuno viene detto che la tabella sbagliata è aggiornata.
- **Da cosa è costruita questa tabella?** Chiedi «cosa alimenta la tabella revenue?» o «cosa si rompe se raw.orders smette di caricarsi?». La risposta segue la derivazione della tabella per tre passi in ogni direzione, o fino a cinque se richiesto, e mette prima ciò che non va: le tabelle a monte e a valle in ritardo, eliminate, con avvisi aperti o la cui pipeline ha fallito l'ultima esecuzione, prima le più vicine, ognuna con quanti passi la separano e le tabelle in mezzo. Seguono le altre, le pipeline che caricano le sue sorgenti dall'esterno di ciò che OneUptime sorveglia e le dashboard BI costruite su di essa. Gli avvisi aperti vengono contati, mai nominati, e solo quelli che la persona che chiede può vedere.
- **Un controllo da una frase.** Nella scheda **Controlli** di una tabella, **Scrivi un controllo da una frase** trasforma una regola in un controllo SQL personalizzato nel SQL del tuo motore. Vedi [Controlli e riconciliazioni](/docs/data-observability/checks).

- **Deriva lenta.** Le righe di una tabella, o il valore di un controllo, che si spostano di un quinto o più in una settimana, troppo lentamente per qualsiasi avviso, arrivano in Insight IA come un punto da guardare. Non chiama nessuno.
- **Dati obsoleti dietro le app AI.** Un servizio che chiama un modello e legge anche una tabella è il consumatore AI di quella tabella. Quando una tabella di questo tipo va in ritardo, la pagina **Conversazioni** del prodotto AI lo dice: un'app che risponde con dati vecchi non mostra nulla di sbagliato nei propri trace.

Ognuna di queste funzioni richiede che OneUptime AI sia attivo per il progetto, e agisce con le autorizzazioni della persona che chiede.

## Agenti IA e il server MCP

Gli agenti IA dovrebbero verificare che i dati siano aggiornati prima di usarli, e cosa viene costruito da una tabella prima di modificarla. Il [server MCP](/docs/ai/mcp-server) ha strumenti di sola lettura per entrambe le cose:

| Strumento | A cosa risponde |
| --- | --- |
| `get_data_table_freshness` | Se una tabella sorvegliata è aggiornata, quando è cambiata l'ultima volta, i suoi avvisi aperti, le ultime esecuzioni di chi la scrive e i suoi prodotti di dati. Indica `table` come `schema.table`, solo con il nome della tabella o con il suo ID |
| `get_data_table_lineage` | Da cosa è costruita una tabella sorvegliata e cosa viene costruito a partire da essa, per tre passi in ogni direzione o fino a cinque: prima le tabelle con un problema, prima le più vicine, poi le altre, le pipeline che caricano le sue sorgenti dall'esterno e le dashboard BI costruite su di essa. Indica `table` come per la sua freschezza, e `depth` da 1 a 5 |

Funzionano entrambi con un accesso di sola lettura, e rispondono come la persona o la chiave API che ha effettuato l'accesso.

## Endpoint

| Endpoint | A cosa serve | Firmato con |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | Eventi OpenLineage da Airflow, Dagster, Spark, dbt o Flink | Una chiave di acquisizione della telemetria |
| `POST /telemetry/dbt/v1/artifacts` | Il `manifest` e i `run_results` di una build di dbt | Una chiave di acquisizione della telemetria |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | I webhook di sincronizzazione di Fivetran | La chiave di acquisizione, come segreto di firma di Fivetran |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | I webhook di sincronizzazione di Airbyte | La chiave di acquisizione nell'URL |
| `POST /api/data-observability/tables/freshness` | La freschezza di una tabella, come la restituisce lo strumento MCP, con `{ "table": "public.orders" }` | Una chiave API |
| `POST /api/data-observability/tables/lineage` | La derivazione di una tabella per alcuni passi in ogni direzione, con lo stato di ogni tabella, come la disegna la sua scheda **Derivazione**, con `{ "dataAssetId": "<table ID>", "depth": 3 }`, e con `"withColumns": true` le colonne che ogni freccia trasporta | Una chiave API |
| `POST /api/data-observability/tables/lineage/answer` | La derivazione di una tabella raccontata a parole, prima le tabelle con un problema, come la restituisce lo strumento MCP, con `{ "table": "public.orders", "depth": 3 }` | Una chiave API |
| `POST /api/data-observability/pipelines/lineage` | Le tabelle che una pipeline legge e scrive, con lo stato di ogni tabella, come le disegna la sua pagina, con `{ "dataPipelineId": "<pipeline ID>", "depth": 1 }` | Una chiave API |
| `POST /api/data-observability/alerts/<alert ID>/lineage` | La derivazione di un avviso sui dati, come la disegna la sua pagina, con il percorso verso l'avviso che lo ha causato e verso gli avvisi che ha causato, e per un avviso da un controllo su una sola colonna, la sua `column` e le colonne che porta ogni freccia | Una chiave API |
| `POST /api/data-observability/lineage/expand` | Le tabelle successive che un riquadro di un diagramma di derivazione non disegna, come le disegna la selezione del suo numero: il riquadro come `nodeId` con il suo `side`, e ciò che è disegnato come `focusNodeId`, `tables` e `dataDashboardIds` | Una chiave API |
| `POST /api/data-observability/checks/apply` | Fa corrispondere i controlli del progetto a un file, come fa `oneuptime data-checks apply`, con `{ "manifest": "...", "isDryRun": true, "shouldPrune": false }` | Una chiave API |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | Il badge «data as of» di un prodotto di dati | Il token proprio del badge |

Tabelle, controlli, riconciliazioni, pipeline, prodotti di dati, connessioni BI e job del warehouse sono anche normali risorse dell'[API](/docs/api-reference/api-reference), che si leggono e si modificano con una chiave API che abbia le autorizzazioni corrispondenti, e del server MCP e dei workflow.

## Metriche

Ogni numero che Osservabilità dei dati conserva è una metrica che puoi rappresentare in un grafico, mettere in una dashboard o usare per gli avvisi: `oneuptime.data.table.*` per ogni tabella, `oneuptime.data.check.value` per ogni controllo, `oneuptime.data.reconciliation.*` per ogni riconciliazione, `oneuptime.data.pipeline.*` per ogni pipeline e `oneuptime.data.product.*` per ogni prodotto di dati. Sono dati operativi propri di OneUptime e non vengono fatturati come telemetria.

## Passaggi successivi

:::cards
- [Server MCP](/docs/ai/mcp-server): Collega un agente IA a OneUptime.
- [Osservabilità dei dati](/docs/data-observability/index): Torna alla panoramica.
:::

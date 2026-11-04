# OneUptime AI e l'API

OneUptime AI conosce i tuoi dati: indaga su un avviso sui dati partendo da chi scrive nella tabella, dalle sue esecuzioni e dalle sue tabelle a monte, risponde ovunque glielo si chieda se una tabella è aggiornata, e scrive un controllo a partire da una regola espressa in una frase. Tutto ciò che mostra Osservabilità dei dati è disponibile anche per i tuoi strumenti, tramite i suoi endpoint, le sue metriche e il server MCP.

## OneUptime AI

- **Indagini sugli avvisi relativi ai dati.** Quando OneUptime AI indaga su un avviso relativo a una tabella, una pipeline o un database, parte da ciò che gli sta accanto: la freschezza e gli avvisi aperti della tabella, l'avviso di cui è conseguenza, le esecuzioni delle pipeline che la scrivono dal giorno prima (un'esecuzione non riuscita con il suo errore, oppure l'esecuzione che non è mai arrivata), i servizi che la scrivono con le loro scritture non riuscite, i loro deploy e le altre modifiche, e le tabelle da cui viene costruita. Indica l'esecuzione, il deploy o la tabella a monte che ha causato l'avviso. Vedi [AI SRE](/docs/ai/ai-sre).
- **Questa tabella è aggiornata?** Chiedilo in [Chiedi all'IA](/docs/ai/ask-ai), Slack o Microsoft Teams: «la tabella orders è aggiornata?». La risposta indica la freschezza della tabella secondo il suo ritmo, quando è cambiata l'ultima volta, i suoi avvisi aperti, le ultime esecuzioni di chi la scrive e i prodotti di dati di cui fa parte. A un nome condiviso da più database viene data una risposta per ciascuno, così a nessuno viene detto che la tabella sbagliata è aggiornata.
- **Un controllo da una frase.** Nella scheda **Controlli** di una tabella, **Scrivi un controllo da una frase** trasforma una regola in un controllo SQL personalizzato nel SQL del tuo motore. Vedi [Controlli e riconciliazioni](/docs/data-observability/checks).

Ognuna di queste funzioni richiede che OneUptime AI sia attivo per il progetto, e agisce con le autorizzazioni della persona che chiede.

## Agenti IA e il server MCP

Gli agenti IA dovrebbero verificare che i dati siano aggiornati prima di usarli. Il [server MCP](/docs/ai/mcp-server) ha uno strumento di sola lettura per questo:

| Strumento | A cosa risponde |
| --- | --- |
| `get_data_table_freshness` | Se una tabella sorvegliata è aggiornata, quando è cambiata l'ultima volta, i suoi avvisi aperti, le ultime esecuzioni di chi la scrive e i suoi prodotti di dati. Indica `table` come `schema.table`, solo con il nome della tabella o con il suo ID |

Funziona con un accesso di sola lettura, e risponde come la persona o la chiave API che ha effettuato l'accesso.

## Endpoint

| Endpoint | A cosa serve | Firmato con |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | Eventi OpenLineage da Airflow, Dagster, Spark, dbt o Flink | Una chiave di acquisizione della telemetria |
| `POST /telemetry/dbt/v1/artifacts` | Il `manifest` e i `run_results` di una build di dbt | Una chiave di acquisizione della telemetria |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | I webhook di sincronizzazione di Fivetran | La chiave di acquisizione, come segreto di firma di Fivetran |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | I webhook di sincronizzazione di Airbyte | La chiave di acquisizione nell'URL |
| `POST /api/data-observability/tables/freshness` | La freschezza di una tabella, come la restituisce lo strumento MCP, con `{ "table": "public.orders" }` | Una chiave API |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | Il badge «data as of» di un prodotto di dati | Il token proprio del badge |

Tabelle, controlli, riconciliazioni, pipeline e prodotti di dati sono anche normali risorse dell'[API](/docs/api-reference/api-reference), che si leggono e si modificano con una chiave API che abbia le autorizzazioni corrispondenti.

## Metriche

Ogni numero che Osservabilità dei dati conserva è una metrica che puoi rappresentare in un grafico, mettere in una dashboard o usare per gli avvisi: `oneuptime.data.table.*` per ogni tabella, `oneuptime.data.check.value` per ogni controllo, `oneuptime.data.reconciliation.*` per ogni riconciliazione, `oneuptime.data.pipeline.*` per ogni pipeline e `oneuptime.data.product.*` per ogni prodotto di dati. Sono dati operativi propri di OneUptime e non vengono fatturati come telemetria.

## Passaggi successivi

:::cards
- [Server MCP](/docs/ai/mcp-server): Collega un agente IA a OneUptime.
- [Osservabilità dei dati](/docs/data-observability/index): Torna alla panoramica.
:::

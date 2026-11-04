# Controlli e riconciliazioni

La salute delle tabelle dice se una tabella cambia. Un **controllo** dice se ciò che contiene è corretto, una **riconciliazione** dice se due copie dei dati coincidono, e i **test di dbt** riferiscono sulle tabelle che dbt costruisce. Ognuno viene eseguito dove viene eseguita la raccolta del database, da OneUptime o dalla sua sonda, e dal database esce sempre e solo un numero.

## Controlli

Aggiungi un controllo nella scheda **Controlli** di una tabella:

| Controllo | Cosa legge |
| --- | --- |
| **Null Percent** | Percentuale di righe la cui colonna è vuota |
| **Duplicate Percent** | Percentuale di valori che ripetono quello di un'altra riga |
| **Distinct Count** | Quanti valori diversi contiene la colonna |
| **Minimo**, **Massimo**, **Media**, **Somma** | Di una colonna numerica (la somma di zero righe è 0) |
| **Invalid Percent** | Percentuale di valori fuori da un elenco che fornisci tu |
| **Format Mismatch Percent** | Percentuale di valori che non corrispondono a un'espressione regolare (tutti i motori tranne SQL Server) |
| **Orphan Count** | Righe il cui valore non ha corrispondenza nella colonna di un'altra tabella |
| **Row Count** | Righe nella tabella, utile soprattutto con **Segment By** |
| **SQL personalizzato** | Il numero restituito da una tua SELECT di sola lettura, chiamato `value` (su MongoDB, quello di una pipeline di aggregazione) |

Ogni controllo viene eseguito ogni 15 minuti, ogni ora, ogni 6 ore o ogni giorno, come un'unica istruzione di aggregazione in una transazione di sola lettura con un timeout per l'istruzione. Il suo valore viene scritto come `oneuptime.data.check.value`, con `oneuptime.data.check.id`, `oneuptime.data.check.name` e `oneuptime.data.check.segment`.

## Controlli suggeriti

**Suggested Checks**, nella stessa scheda, propone i controlli che le colonne di una tabella richiedono, solo in base ai loro nomi e tipi: un id è univoco, un `customer_id` ha una riga corrispondente in `customers`, un'email ha l'aspetto di un'email, un importo non è negativo, uno stato mantiene i suoi valori abituali, e una tabella suddivisa per tenant viene contata per tenant. Aggiungine uno, aggiungili tutti, oppure scartane uno per sempre.

## Un controllo da una frase

**Scrivi un controllo da una frase** trasforma una regola come «gli ordini non hanno mai un totale negativo» in un controllo SQL personalizzato che conta le righe che la violano, nel SQL del tuo motore, con un avviso non appena ce n'è qualcuna. Leggi la query prima che **Aggiungi controllo** la aggiunga, ed è soggetta a tutte le regole di qualsiasi controllo SQL personalizzato. Richiede che OneUptime AI sia attivo per il progetto.

## Segmenti

**Segment By** esegue un controllo una volta per ogni valore di una colonna, come un tenant o una regione: una serie e un avviso per ciascuno, per i 100 segmenti più grandi. Un numero di righe segmentato avvisa quando un tenant smette di inviare dati mentre gli altri continuano.

## Avvisi su un controllo

Imposta **Alert When** per ricevere un avviso su un controllo:

- **Unusually High** o **Unusually Low** confronta ogni valore con la sua baseline appresa per quell'ora della settimana.
- **Sopra** o **Sotto** lo confronta con una soglia.

Salvando il controllo si crea un monitor di metriche per esso, a tuo nome e con le tue autorizzazioni. Svuotando la condizione si rimuove il monitor.

## Riconciliazioni

Le copie divergono: il data warehouse ha meno ordini del database dell'applicazione, oppure una migrazione ha perso delle righe. Una riconciliazione confronta una misura di due tabelle, nello stesso database o in due diversi, in **Riconciliazioni**:

- **Row Count**
- **Somma** di una colonna
- **Distinct Count** di una colonna
- **SQL personalizzato**: una query di sola lettura che restituisce un numero, chiamato `value`

Ha una tolleranza: un valore fisso (**Assoluta**) oppure una percentuale del valore dell'origine (**Percentuale**). Ogni lato viene letto da un controllo dedicato, che la riconciliazione crea e mantiene, insieme alla raccolta del suo database, così una riconciliazione può confrontare una tabella PostgreSQL nella tua rete con la sua copia in Snowflake. I due valori vengono confrontati non appena entrambi sono stati letti a non più di 15 minuti di distanza l'uno dall'altro. Una riconciliazione scrive:

- `oneuptime.data.reconciliation.drifted`: 1 quando i due valori divergono oltre la tolleranza, 0 quando coincidono. Il suo monitor legge questo valore.
- `oneuptime.data.reconciliation.difference`: il valore della destinazione meno quello dell'origine.
- `oneuptime.data.reconciliation.difference_percent`: la differenza come percentuale del valore dell'origine.

Una copia caricata secondo una pianificazione resta indietro rispetto alla sua origine: confronta con un SQL personalizzato una misura su cui entrambe si sono già stabilizzate, come le righe più vecchie di un'ora, oppure tieni conto del ritardo nella tolleranza.

## Test di dbt

Dopo una build di dbt, `oneuptime dbt upload` invia gli artefatti del progetto (vedi [Lineage e pipeline](/docs/data-observability/lineage-and-pipelines)). Ogni test di una tabella sorvegliata compare allora nella sua scheda **Controlli**, con il suo ultimo risultato e le righe che ha trovato in errore. Scegli **Alert on Failures** perché un test non superato apra un avviso.

## Passaggi successivi

:::cards
- [Lineage e pipeline](/docs/data-observability/lineage-and-pipelines): Invia gli artefatti di dbt, e guarda l'esecuzione dietro un controllo non superato.
- [Prodotti di dati](/docs/data-observability/data-products): Prometti a chi usa i dati che sono aggiornati.
:::

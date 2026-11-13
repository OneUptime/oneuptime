# Controlli e riconciliazioni

La salute delle tabelle dice se una tabella cambia. Un **controllo** dice se ciò che contiene è corretto, una **riconciliazione** dice se due copie dei dati coincidono, e i **test di dbt** riferiscono sulle tabelle che dbt costruisce. Ognuno viene eseguito dove viene eseguita la raccolta del database, da OneUptime o dalla sua sonda, e dal database esce solo un numero, a meno che un progetto scelga di conservare un campione mascherato delle righe in errore.

## Controlli

Aggiungi un controllo nella scheda **Controlli** di una tabella:

| Controllo | Cosa legge |
| --- | --- |
| **Percentuale di NULL** | Percentuale di righe la cui colonna è vuota |
| **Percentuale di duplicati** | Percentuale di valori che ripetono quello di un'altra riga |
| **Conteggio dei valori distinti** | Quanti valori diversi contiene la colonna |
| **Minimo**, **Massimo**, **Media**, **Somma** | Di una colonna numerica (la somma di zero righe è 0) |
| **Percentuale di valori non validi** | Percentuale di valori fuori da un elenco che fornisci tu |
| **Percentuale di formato errato** | Percentuale di valori che non sono in un formato che scegli, come Email, UUID o Country Code, oppure che non corrispondono a un'espressione regolare tua (tutti i motori tranne SQL Server e Dataverse) |
| **Conteggio delle righe orfane** | Righe il cui valore non ha corrispondenza nella colonna di un'altra tabella |
| **Numero di righe** | Righe nella tabella, utile soprattutto con **Segmenta per** |
| **SQL personalizzato** | Il numero restituito da una tua SELECT di sola lettura, chiamato `value` (su MongoDB, quello di una pipeline di aggregazione) |
| **Righe in errore** | Quante righe restituisce una tua SELECT di sola lettura: le righe che non dovrebbero esistere. 0 significa tutto a posto (su MongoDB, i documenti con cui termina una pipeline) |

Ogni controllo viene eseguito ogni 15 minuti, ogni ora, ogni 6 ore o ogni giorno, come un'unica istruzione di aggregazione in una transazione di sola lettura con un timeout per l'istruzione. Il suo valore viene scritto come `oneuptime.data.check.value`, con `oneuptime.data.check.id`, `oneuptime.data.check.name` e `oneuptime.data.check.segment`.

## Controlli suggeriti

**Controlli suggeriti**, nella stessa scheda, propone i controlli che le colonne di una tabella richiedono, solo in base ai loro nomi e tipi: un id è univoco, un `customer_id` ha una riga corrispondente in `customers`, un'email ha l'aspetto di un'email, un importo non è negativo, uno stato mantiene i suoi valori abituali, e una tabella suddivisa per tenant viene contata per tenant. Una colonna che Data Security sa contenere un indirizzo email, un numero di telefono o un indirizzo IP viene vincolata a quel formato, qualunque sia il suo nome. Aggiungine uno, aggiungili tutti, oppure scartane uno per sempre.

## Un controllo da una frase

**Scrivi un controllo da una frase** trasforma una regola come «gli ordini non hanno mai un totale negativo» in un controllo SQL personalizzato che conta le righe che la violano, nel SQL del tuo motore, con un avviso non appena ce n'è qualcuna. Leggi la query prima che **Aggiungi controllo** la aggiunga, ed è soggetta a tutte le regole di qualsiasi controllo SQL personalizzato. Richiede che OneUptime AI sia attivo per il progetto. Su MongoDB il risultato è una pipeline di aggregazione.

## Segmenti

**Segmenta per** esegue un controllo una volta per ogni valore di una colonna, come un tenant o una regione: una serie e un avviso per ciascuno, per i 100 segmenti più grandi. Un numero di righe segmentato avvisa quando un tenant smette di inviare dati mentre gli altri continuano.

## Avvisi su un controllo

Imposta **Avvisa quando** per ricevere un avviso su un controllo:

- **Insolitamente alto** o **Insolitamente basso** confronta ogni valore con la sua baseline appresa per quell'ora della settimana.
- **Sopra** o **Sotto** lo confronta con una soglia.

Salvando il controllo si crea un monitor di metriche per esso, a tuo nome e con le tue autorizzazioni. Svuotando la condizione si rimuove il monitor.

Lo **Stato** di un controllo, in **Controlli** e nella scheda **Controlli** della sua tabella, dice come sta: **In errore** finché il suo avviso è aperto, **In regola** finché non lo è, e **Esecuzione non riuscita** quando la sua query è fallita. Un controllo senza avviso mostra solo **Eseguita**: la sua query ha funzionato. Un controllo in errore, e uno che non è stato possibile eseguire, compare anche nella **Panoramica**.

## Quanto costa un controllo

Un controllo compete con la tua applicazione per il database e, su un warehouse che fattura in base a ciò che una query legge, costa denaro. Tre cose lo tengono sotto controllo:

- **Percentuale di campionamento** legge una parte delle righe invece di tutte, per un controllo che legge una percentuale: Percentuale di NULL, Media, Percentuale di valori non validi e Percentuale di formato errato. La maggior parte dei motori salta intere pagine della tabella; MySQL, Redshift, ClickHouse e MongoDB leggono comunque ogni riga, e risparmiano il lavoro sul resto. Dataverse non usa il campionamento: lì un controllo legge ogni riga. Una vista può rifiutarla, e il controllo lo segnala.
- **Massimo che un controllo può leggere (GB)**, in **Impostazioni**, ferma un controllo su BigQuery o Athena prima che legga più di quel numero di gigabyte. Vale 10 finché non lo cambi.
- **Attendi quando un database è occupato**, in **Impostazioni**, lascia i controlli in scadenza alla raccolta successiva quando un database PostgreSQL, MySQL o SQL Server sembra occupato. È attivo finché non lo disattivi, e il database indica quando i controlli hanno atteso.

## Righe in errore

Un numero dice che qualcosa non va; poche righe dicono cosa. **Conserva Failing Rows** in **Impostazioni** conserva fino a 20 delle righe trovate da un controllo Righe in errore, Percentuale di valori non validi, Percentuale di formato errato o Conteggio delle righe orfane, e **Righe in errore** sul controllo le mostra. È disattivato finché non lo attivi. Le colonne sensibili sono mascherate dove la riga viene letta, in base a ciò che Data Security vi ha trovato o ai loro nomi, quindi ciò che lascia il database, o una sonda, è già mascherato. Una colonna sensibile che nessuna scansione ha trovato e il cui nome non la rivela viene conservata così com'è.

Le righe sono archiviate in OneUptime: sui server di OneUptime con OneUptime Cloud, e sui tuoi con un'installazione self-hosted. Chiunque possa leggere i controlli del progetto può vederle. Un controllo conserva solo le righe della sua ultima esecuzione, e disattivare **Conserva Failing Rows** elimina ciò che ogni controllo aveva conservato.

## Controlli in un file

I controlli scritti a mano si scostano dal codice che modifica le tabelle. Tienili nel tuo repository, rivisti nella stessa pull request:

```yaml
checks:
  - name: Orders have a total
    table: public.orders
    type: Null Percent
    column: total
    every: 60
    alert: { when: Above, threshold: 1 }
  - name: Emails look right
    table: public.customers
    database: Orders database
    type: Format Mismatch Percent
    column: email
    format: Email
    sample_percent: 10
  - name: Orders have a customer
    table: public.orders
    type: Orphan Count
    column: customer_id
    references: public.customers.id
  - name: No negative totals
    table: public.orders
    type: Failing Rows
    query: SELECT id FROM orders WHERE total < 0
    alert: { when: Above, threshold: 0 }
```

Applicalo da CI con la [CLI di OneUptime](/docs/cli/index) e una chiave API:

```bash
oneuptime data-checks apply checks.yaml --dry-run
oneuptime data-checks apply checks.yaml --prune
```

Un controllo è lo stesso controllo se ha lo stesso nome sulla stessa tabella, quindi applicare un file due volte non cambia nulla. Un errore in qualsiasi punto del file non applica nulla e termina con un errore, quindi esegui `--dry-run` sulla pull request e applica al merge. Con `--prune`, un controllo creato da un'applicazione precedente che il file non nomina più viene eliminato. Un controllo aggiunto a mano non lo è mai. Un controllo da un file lo indica sulla sua riga, e la sua applicazione successiva sovrascrive ciò che è stato modificato a mano.

Le chiavi sono `name`, `table`, `database`, `type`, `column`, `segment`, `accepted_values`, `format`, `pattern`, `references`, `query`, `sample_percent`, `every`, `alert`, `description` e `enabled`.

## Riconciliazioni

Le copie divergono: il data warehouse ha meno ordini del database dell'applicazione, oppure una migrazione ha perso delle righe. Una riconciliazione confronta una misura di due tabelle, nello stesso database o in due diversi, in **Riconciliazioni**:

- **Numero di righe**
- **Somma** di una colonna
- **Conteggio dei valori distinti** di una colonna
- **SQL personalizzato**: una query di sola lettura che restituisce un numero, chiamato `value`

Ha una tolleranza: un valore fisso (**Assoluta**) oppure una percentuale del valore dell'origine (**Percentuale**). Ogni lato viene letto da un controllo dedicato, che la riconciliazione crea e mantiene, insieme alla raccolta del suo database, così una riconciliazione può confrontare una tabella PostgreSQL nella tua rete con la sua copia in Snowflake. I due valori vengono confrontati non appena entrambi sono stati letti a non più di 15 minuti di distanza l'uno dall'altro. Una riconciliazione scrive:

- `oneuptime.data.reconciliation.drifted`: 1 quando i due valori divergono oltre la tolleranza, 0 quando coincidono. Il suo monitor legge questo valore.
- `oneuptime.data.reconciliation.difference`: il valore della destinazione meno quello dell'origine.
- `oneuptime.data.reconciliation.difference_percent`: la differenza come percentuale del valore dell'origine.

Una copia caricata secondo una pianificazione resta indietro rispetto alla sua origine: confronta con un SQL personalizzato una misura su cui entrambe si sono già stabilizzate, come le righe più vecchie di un'ora, oppure tieni conto del ritardo nella tolleranza.

## Test di dbt

Dopo una build di dbt, `oneuptime dbt upload` invia gli artefatti del progetto (vedi [Lineage e pipeline](/docs/data-observability/lineage-and-pipelines)). Ogni test di una tabella sorvegliata compare allora nella sua scheda **Controlli**, con il suo ultimo risultato e le righe che ha trovato in errore. Scegli **Avvisa in caso di errori** perché un test non superato apra un avviso.

## Passaggi successivi

:::cards
- [Lineage e pipeline](/docs/data-observability/lineage-and-pipelines): Invia gli artefatti di dbt, e guarda l'esecuzione dietro un controllo non superato.
- [Prodotti di dati](/docs/data-observability/data-products): Prometti a chi usa i dati che sono aggiornati.
:::

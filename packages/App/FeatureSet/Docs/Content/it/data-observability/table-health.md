# Salute delle tabelle

Ogni cinque minuti, il catalogo di ogni database collegato dice come sta ogni tabella: quando è cambiata l'ultima volta, quante righe contiene, quanto è grande e quali sono le sue colonne. Osservabilità dei dati ne ricava il ritmo di ogni tabella, e segnala quando una tabella è in ritardo, si riduce o cambia struttura, senza alcuna soglia da impostare.

## Cosa viene letto

Per ogni tabella e vista:

- **Numero di righe e dimensioni**, dalle statistiche del motore stesso.
- **Quando è cambiata l'ultima volta**: l'orario registrato dal motore stesso, dove ne tiene uno, oppure il momento in cui i suoi contatori di scrittura, le sue righe o i suoi byte si sono mossi tra due raccolte.
- **Le sue colonne**, con i loro tipi e l'indicazione se possono essere vuote.
- **Quando è stata letta l'ultima volta**, dove il motore conta le letture.

Viene letto solo il catalogo, e su MongoDB i nomi dei campi dei documenti più recenti di una collezione. Nessun valore lascia il database.

## Freschezza

Il **ritmo** di una tabella è la frequenza con cui cambia di solito, appresa dal tempo che passa tra una modifica e l'altra. Una tabella che va ben oltre il suo ritmo compare come **In ritardo**, sulla sua pagina e in **Tabelle**, e scrive di quanto lo ha superato. La sua freschezza è nota non appena è cambiata due volte: una tabella caricata ogni ora viene appresa in poche ore, una caricata ogni notte in pochi giorni.

Una vista non contiene righe proprie, quindi la sua freschezza è quella delle sue origini: vedi [Lineage e pipeline](/docs/data-observability/lineage-and-pipelines).

Un catalogo può dire che una tabella è cambiata quando è cambiata solo la sua manutenzione interna, oppure non dire nulla. In **Impostazioni** di una tabella, indica una **Colonna Freshness** come `updated_at`, e la sua ultima modifica diventa il valore più recente di quella colonna. L'utenza deve poter leggere la colonna, che viene letta a ogni raccolta, quindi dovrebbe essere indicizzata; su BigQuery e Athena, che fatturano in base a ciò che una query legge, viene letta una volta all'ora. Gli orari senza fuso orario sono considerati UTC.

## Modifiche di volume e di schema

- Le **Righe** vengono confrontate tra una raccolta e l'altra: una tabella che perde metà delle sue righe, o che ne contiene molte meno del solito per quell'ora della settimana, lo segnala.
- Anche le **Colonne** vengono confrontate. Una colonna aggiunta, rimossa, rinominata, con un tipo diverso o resa nullable finisce nella **Cronologia** della tabella e in **Modifiche allo schema**, che elenca ogni modifica di ogni database, dalla più recente. Una colonna rimossa, rinominata o con un tipo diverso rompe ciò che la legge, e può generare un avviso. Una aggiunta non rompe nulla e resta nella cronologia.
- Le **Tabelle eliminate** vengono conservate in **Tabelle eliminate**, con il momento in cui sono state viste l'ultima volta, e tornano con la loro cronologia se la tabella ricompare.

## Avvisi consigliati

In **Database**, scegli **Avvisi consigliati** per un database. Ogni raccomandazione è un unico monitor di metriche per l'intero database che avvisa una volta per tabella, così anche una tabella creata in seguito viene sorvegliata:

| Avviso | Scatta quando |
| --- | --- |
| **Table Is Late** | Una tabella resta per quindici minuti oltre l'orario entro cui di solito cambia |
| **Row Count Fell Sharply** | Una tabella perde metà delle sue righe o più tra due raccolte |
| **Row Count Unusually Low** | Una tabella contiene molte meno righe del solito per quell'ora della settimana (appreso in due settimane) |
| **Schema Changed** | Colonne di una tabella vengono rimosse, rinominate o cambiano tipo |
| **Table Health Stopped Reporting** | Nessuna tabella del database è stata letta da quindici minuti |

Scegli gravità, policy di reperibilità, proprietari ed etichette quando li crei. Da quel momento sono monitor come gli altri: modificali, silenziali o mettili su una pagina di stato come qualsiasi altro.

Un backfill o una migrazione non dovrebbe avvisare nessuno. Indica il database in **Data Observability Database** su un [evento di manutenzione](/docs/scheduled-maintenance/index), oppure inserisci il suo server di database in uno, e i suoi avvisi sui dati restano silenziosi mentre l'evento è attivo.

## Metriche che ogni tabella scrive

Ogni raccolta scrive queste metriche per ogni tabella, così puoi rappresentarle in grafici, metterle nelle dashboard e usarle per gli avvisi come qualsiasi altra metrica:

| Metrica | Cos'è |
| --- | --- |
| `oneuptime.data.table.row_count` | Righe nella tabella |
| `oneuptime.data.table.size` | Byte occupati dalla tabella e dai suoi indici |
| `oneuptime.data.table.seconds_since_change` | Secondi dall'ultima modifica della tabella |
| `oneuptime.data.table.overdue_seconds` | Secondi di ritardo della tabella rispetto all'orario entro cui di solito cambia; 0 finché è puntuale |
| `oneuptime.data.table.row_count_change_percent` | Quanto è variato il numero di righe dalla raccolta precedente, in percentuale |
| `oneuptime.data.table.schema_changes` | Colonne modificate dalla raccolta precedente |
| `oneuptime.data.table.breaking_schema_changes` | Colonne rimosse, rinominate o con un tipo diverso dalla raccolta precedente |

Ogni riga riporta `oneuptime.data.store.id`, `oneuptime.data.store.name`, `oneuptime.data.table.id`, `oneuptime.data.table.schema`, `oneuptime.data.table.name` e `oneuptime.data.table.key` (`schema.table`). Un [monitor di metriche](/docs/monitor/metrics-monitor) raggruppato per `oneuptime.data.table.key` avvisa una volta per tabella, e i suoi filtri **Anomalmente alto** e **Anomalmente basso** confrontano ogni tabella con il suo valore abituale per quell'ora della settimana. Queste metriche sono dati operativi propri di OneUptime e non vengono fatturate come telemetria.

## Tabelle inutilizzate

Ogni motore che conta le letture dice quando ogni tabella è stata letta l'ultima volta: le scansioni di PostgreSQL, il performance_schema di MySQL, le seek, le scansioni e i lookup di SQL Server, e la cronologia delle query di Redshift, ClickHouse e Databricks. Conta anche una lettura vista negli span di database dei tuoi servizi.

**Tabelle inutilizzate** elenca le tabelle che nessuno ha letto da 90 giorni, dalla più grande, con il momento in cui ciascuna è stata scritta l'ultima volta: una tabella ancora scritta ma mai letta costa le sue scritture e il suo spazio di archiviazione. Un contatore a 0 alla prima raccolta di una tabella significa che non è stata letta da quando sono partite le statistiche del motore, quindi una tabella inutilizzata risulta inutilizzata fin dall'inizio.

## Spesa del warehouse

Ogni ora l'Osservabilità dei dati legge quanto ha speso nell'ultimo giorno ogni warehouse Snowflake e BigQuery, job per job: i crediti di calcolo di Snowflake, da `QUERY_ATTRIBUTION_HISTORY`, e i byte fatturati di BigQuery, dalla sua vista dei job, che richiede **BigQuery Resource Viewer**. Un job è una query eseguita più e più volte, chiamata col suo tag o label, oppure con ciò che fa e la tabella che scrive: mai col testo della query.

**Spesa del warehouse** mostra i totali per team (il `team` nel tag o nel label di un job, altrimenti chi lo esegue), le tabelle le cui scritture costano di più, i job non riusciti e quanto va ai job che scrivono solo tabelle che nessuno legge da 90 giorni.

## Servizi che usano ogni tabella

La scheda **Servizi** di una tabella elenca i servizi visti scriverla e leggerla, con le istruzioni eseguite da ciascuno, le sue chiamate e i suoi errori nell'ultima ora, e il momento in cui è stato visto l'ultima volta. I dati arrivano dagli span di database che i tuoi servizi già inviano con OpenTelemetry: uno span client con `db.system.name`, `db.namespace` e `db.collection.name`. Non c'è nulla in più da installare.

Uno span viene collegato a una tabella solo quando il suo database è uno di quelli letti da una raccolta e, quando due database hanno lo stesso nome, solo quando il suo `server.address` è quello di uno dei due.

Ogni servizio mostra anche gli endpoint che effettuano le sue chiamate, dallo span server nello stesso trace, ed è contrassegnato come **App AI** quando chiama anche un modello. **Errori che citano questa tabella** elenca le eccezioni aperte e i registri di errore dell'ultimo giorno dei servizi che scrivono la tabella, quando la menzionano per nome.

## Proprietari ed etichette

La scheda **Proprietari** di una tabella indica le persone e i team a cui appartiene, e l'avviso di una tabella va a loro; se non ce ne sono, ai proprietari del suo database. In **Impostazioni** di una tabella, assegnale delle **Etichette** tue.

Non dovresti doverlo fare centinaia di volte. Le **Regole del proprietario** e le **Regole etichette** si applicano a ogni tabella quando compare per la prima volta, in base alle sue etichette, oppure a un'espressione regolare sul suo nome, schema o database: tutto ciò che è in `finance` va al team finance, e tutto ciò che si chiama `*_pii` riceve un'etichetta.

Un'autorizzazione limitata a `Owned` raggiunge solo le tabelle di cui sono proprietari il suo titolare o i suoi team, con i relativi controlli, attività e problemi segnalati. Essere proprietario di un database non rende proprietario delle sue tabelle: usa una regola sui proprietari per affidare un intero database a un team.

## Quando si apre un avviso

L'avviso di una tabella ha una scheda **Dati** che dice perché è più probabilmente successo, in ordine di probabilità: un avviso a monte, un'esecuzione non riuscita, un deploy di un servizio che la scrive, le sue scritture in errore, una colonna che è cambiata, il database stesso o il server su cui gira. Sotto c'è ciò che ne dipende: le tabelle più a valle nella sua derivazione, le dashboard, i servizi e le persone che ne sono proprietarie.

Dì cosa ne hai concluso:

- **Useful**: aveva ragione.
- **Expected**: un evento pianificato. Nulla cambia, e anche il successivo viene generato.
- **Non è un problema**: alla tabella viene dato più margine, così la stessa cosa resta silenziosa la volta successiva. L'intervallo abituale di una tabella in ritardo si allunga, e la tolleranza sul numero di righe si allarga.

Se una persona trova un problema per prima, **Segnala un problema** sulla tabella lo registra. **Panoramica** mostra allora come se la cava Osservabilità dei dati per il tuo progetto: problemi utili a settimana, quanti non erano rumore, quante tabelle vengono lette, con quale frequenza ha segnalato un problema prima che qualcuno lo segnalasse, con quale rapidità, e con quale frequenza la sua causa probabile era quella reale.

## Passaggi successivi

:::cards
- [Controlli e riconciliazioni](/docs/data-observability/checks): Regole su ciò che contiene una tabella, oltre al fatto che cambi.
- [Lineage e pipeline](/docs/data-observability/lineage-and-pipelines): Da dove vengono i dati di una tabella in ritardo, e l'esecuzione che avrebbe dovuto caricarla.
:::

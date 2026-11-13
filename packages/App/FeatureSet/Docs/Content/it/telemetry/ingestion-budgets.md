# Budget di acquisizione

Un budget di acquisizione limita quanta telemetria un progetto invia in un giorno, così che un servizio rumoroso o un ciclo di log fuori controllo non possa riempire il vostro storage. L'amministratore dell'istanza imposta un budget giornaliero per ogni segnale, per tutti i progetti o per un solo progetto, e chiunque possa modificare una chiave di acquisizione può dare alla chiave un budget proprio più piccolo. Ogni budget può avere anche un limite di frequenza al secondo.

:::cards
- [Come funzionano i budget](#come-funzionano-i-budget): Tre livelli, conteggiati man mano che la telemetria arriva.
- [Impostare i budget predefiniti di tutti i progetti](#impostare-i-budget-predefiniti-di-tutti-i-progetti): Nelle impostazioni dell'Admin Dashboard.
- [Dare a una chiave di acquisizione un budget proprio](#dare-a-una-chiave-di-acquisizione-un-budget-proprio): Una quota del budget del progetto.
- [Ricevere avvisi su un budget](#ricevere-avvisi-su-un-budget): Prima che sia esaurito, e quando lo è.
:::

## Come funzionano i budget

La telemetria viene conteggiata man mano che arriva: sul budget del suo progetto per il suo segnale, e su quello della sua chiave di acquisizione quando la chiave ne ha uno. Quando un budget giornaliero è esaurito, quel segnale viene rifiutato finché il budget non si azzera.

```mermaid title="Che cosa verifica OneUptime prima di salvare la telemetria"
flowchart TB
    request["La telemetria arriva<br/>con una chiave<br/>di acquisizione"] --> budget{"Budget di oggi<br/>esaurito?"}
    budget -->|"Sì"| refused["Rifiutata con 403<br/>fino all'azzeramento"]
    budget -->|"No"| rate{"Più veloce del<br/>limite di frequenza?"}
    rate -->|"Sì"| throttled["Rifiutata con 429:<br/>il mittente riprova"]
    rate -->|"No"| counted["Conteggiata, poi<br/>salvata"]
```

- **Tre livelli.** Il predefinito dell'istanza si applica a ogni progetto. L'amministratore dell'istanza può dare invece a un progetto un budget proprio, oppure nessun limite. Il budget di una chiave suddivide soltanto quello del suo progetto: può essere più piccolo, mai più grande.
- **Cinque segnali.** Log, tracce, metriche, profili ed eventi di sicurezza hanno ciascuno un proprio budget. Le riproduzioni delle sessioni hanno limiti propri: vedete [Riproduzione delle sessioni](/docs/telemetry/session-replay).
- **I byte vengono conteggiati decompressi.** Una richiesta conta la dimensione del suo corpo una volta decompresso, quindi comprimerla non cambia ciò che conta. Un GB corrisponde a 1024³ byte, e un MB a 1024² byte.
- **Si conteggia ciò che arriva, non ciò che viene salvato.** La telemetria che un [filtro di scarto](/docs/telemetry/drop-filters-and-scrub-rules) rimuove in seguito conta comunque, quindi un budget può indicare più della pagina [Utilizzo della telemetria](/docs/telemetry/usage), che conteggia ciò che è stato salvato.
- **L'ultima richiesta viene salvata per intero.** Una richiesta che arriva quando un budget ha ancora spazio viene salvata completamente, quindi un budget esaurito può indicare poco più del 100%.
- **Nulla è limitato finché non si imposta un budget.** Ogni installazione parte senza budget, e un progetto senza budget non viene conteggiato affatto.
- **Le modifiche raggiungono ogni server entro un minuto.**
- **La telemetria viene accettata quando non può essere conteggiata.** I budget vengono conteggiati in Valkey. Finché Valkey non è raggiungibile, OneUptime salva la telemetria senza conteggiarla anziché rifiutarla, e le pagine dei budget lo segnalano.

## Prima di iniziare

- **Per i budget dell'istanza e di un progetto, l'Admin Dashboard.** Su un'installazione self-hosted, solo l'amministratore dell'istanza li imposta. I proprietari e gli amministratori di un progetto ne vedono i budget, ma non possono modificarli.
- **Per il budget proprio di una chiave, un ruolo che modifica le chiavi di acquisizione.** Project Owner o Project Admin, oppure un ruolo personalizzato con il permesso Edit Ingestion Key.
- **Per vedere i budget, un ruolo che vede l'utilizzo del progetto.** I ruoli che vedono la pagina [Utilizzo della telemetria](/docs/telemetry/usage) vi vedono i budget del progetto.

## Impostare i budget predefiniti di tutti i progetti

:::steps
### Aprire i budget di acquisizione

Nell'Admin Dashboard, andate in **Impostazioni → Telemetria → Budget di acquisizione**. **Telemetria** parte compresso nel menu laterale: fateci clic per aprirlo.

### Impostare i budget giornalieri

Nella scheda **Budget giornalieri predefiniti**, fate clic su **Modifica budget giornalieri predefiniti**, inserite un numero di GB per ogni segnale da limitare, ad esempio **Registri (GB al giorno)**, e fate clic su **Salva modifiche**. Lasciate vuoto un segnale per non avere limiti.

### Impostare i limiti di frequenza, se vi servono

Nella scheda **Limiti di frequenza predefiniti**, fate clic su **Modifica limiti di frequenza predefiniti** e inserite un numero di MB al secondo per un segnale, ad esempio **Registri (MB al secondo)**. Un limite di frequenza impedisce a un singolo picco di esaurire in pochi minuti il budget di un giorno.
:::

La scheda **Avviso e azzeramento** contiene la soglia di avviso e l'ora in cui si azzera il giorno di budget: vedete [L'avviso e l'azzeramento](#lavviso-e-lazzeramento).

## Impostare i budget di un progetto

:::steps
### Aprire il progetto

Nell'Admin Dashboard, andate in **Progetti**, fate clic sul progetto, poi su **Budget di acquisizione** nel suo menu laterale. La pagina si apre con ciò che il progetto ha usato oggi dei suoi budget.

### Impostarne i budget giornalieri

Nella scheda **Budget giornalieri di questo progetto**, fate clic su **Modifica budget giornalieri**. Inserite un numero di GB al posto del predefinito dell'istanza per un segnale, oppure 0 per nessun limite. Lasciate vuoto un segnale per mantenere il predefinito dell'istanza.

### Impostarne i limiti di frequenza

Nella scheda **Limiti di frequenza di questo progetto**, fate clic su **Modifica limiti di frequenza** e impostateli allo stesso modo: un numero di MB al secondo, 0 per nessun limite, oppure vuoto per il predefinito dell'istanza.
:::

I membri del progetto vedono questi budget nella loro pagina [Utilizzo della telemetria](/docs/telemetry/usage), in sola lettura.

## Dare a una chiave di acquisizione un budget proprio

Il budget di una chiave è una quota di quello del suo progetto: un mittente che inonda la propria chiave si ferma al budget della chiave, mentre le altre chiavi del progetto continuano a inviare.

:::steps
### Aprire la chiave

Andate in **Impostazioni del progetto → Telemetria e APM → Chiavi di acquisizione** e fate clic sulla chiave. **Telemetria e APM** parte compresso nel menu laterale: fateci clic per aprirlo.

### Impostarne i budget

Nella scheda **Budget di acquisizione**, fate clic su **Modifica budget di acquisizione**. Inserite un numero di GB al giorno per ogni segnale da limitare nel passaggio **Budget giornalieri**, e un numero di MB al secondo nel passaggio **Limiti di frequenza**. Lasciate vuoto un segnale perché la chiave non abbia un budget proprio.

### Salvare i budget

Fate clic su **Salva modifiche**. Il budget di una chiave non può superare quello del suo progetto: OneUptime lo rifiuta e indica il massimo possibile.
:::

- **Contano entrambi i budget.** La telemetria inviata con la chiave viene conteggiata sul budget della chiave e su quello del progetto, e quello che si esaurisce per primo la rifiuta.
- **Un budget di progetto abbassato vale anche per la chiave.** Quando il budget del progetto viene abbassato sotto quello di una chiave, la chiave è limitata a quello del progetto.

## Che cosa vedono i mittenti

| Quando | Su HTTP | Su OTLP/gRPC | Che cosa fa il mittente |
| --- | --- | --- | --- |
| Un budget giornaliero è esaurito | `403` | `RESOURCE_EXHAUSTED` | Scarta il batch: riprovare non serve prima dell'azzeramento |
| Un limite di frequenza è superato | `429` con `Retry-After` | `RESOURCE_EXHAUSTED` con un ritardo prima di riprovare | Riprova il batch dopo il ritardo |

Ogni rifiuto dice il perché. Su OTLP/HTTP il suo corpo è un `google.rpc.Status`, in protobuf o JSON a seconda di come è stata inviata la richiesta, quindi il log del mittente mostra un motivo come:

```text
This project's daily logs ingestion budget of 10 GB is used up, so OneUptime is not storing logs from this project until the budget resets at 2026-11-10 00:00 UTC.
```

- **Gli altri mittenti HTTP ricevono JSON.** Fluent Bit, Fluentd, Syslog e gli altri endpoint HTTP ricevono `error`, `message` e `resetsAt`, più `retryAfterSeconds` in caso di limite di frequenza.
- **MQTT e gli stream cloud non possono essere avvisati.** La telemetria che arriva su MQTT o dallo stream di un provider cloud viene scartata non appena il suo budget è esaurito. Non le si applica alcun limite di frequenza: non potrebbe essere inviata di nuovo.
- **I rifiuti vengono conteggiati.** Ciò che un budget esaurito rifiuta o scarta viene conteggiato come scartato, e ogni richiesta rifiutata da un limite di frequenza come limitata: vedete [Vedere l'utilizzo e gli scarti di oggi](#vedere-lutilizzo-e-gli-scarti-di-oggi).

## L'avviso e l'azzeramento

- **L'avviso.** Quando un budget giornaliero supera la soglia di avviso, l'80% a meno che l'amministratore dell'istanza non la cambi, i proprietari del progetto ricevono un'e-mail, e gli explorer mostrano un banner sopra i dati di quel segnale. Ricevono un'altra e-mail quando il budget è esaurito. Ogni budget invia ogni e-mail al massimo una volta al giorno.
- **L'azzeramento.** Ogni giorno di budget ricomincia alle 00:00 UTC, a meno che l'amministratore dell'istanza non lo cambi. La scheda **Avviso e azzeramento** imposta **Soglia di avviso (%)**, da 1 a 99, **Ora di azzeramento**, come HH:MM, e **Fuso orario dell'azzeramento**: fate clic su **Modifica avviso e azzeramento**.
- **Ora legale.** L'azzeramento segue l'orologio del fuso orario, quindi il giorno di budget in cui cambia l'ora dura un'ora in meno o in più. Un'ora di azzeramento che il cambio d'ora salta avviene altrettanto tempo dopo il salto.
- **Un azzeramento modificato inizia un nuovo giorno.** Cambiare l'ora di azzeramento o il fuso orario inizia subito un nuovo giorno di budget, senza nulla ancora conteggiato.

## Vedere l'utilizzo e gli scarti di oggi

Andate in **Impostazioni del progetto → Telemetria e APM → Utilizzo**. Finché per il progetto è impostato un budget o un limite di frequenza, la pagina si apre con la scheda **Budget di acquisizione**, e le chiavi con un budget proprio si trovano nella scheda **Budget delle chiavi di acquisizione**:

| Colonna | Che cosa mostra |
| --- | --- |
| **Segnale** | Il segnale a cui si riferisce la riga. |
| **Usato oggi** | Ciò che è stato conteggiato dall'inizio del giorno di budget, e la sua quota del budget. |
| **Budget giornaliero** | Il budget in vigore, e dove è stato impostato: **Predefinito dell'istanza**, **Impostato per questo progetto** o **Proprio di questa chiave**. |
| **Limite di frequenza** | Il limite di frequenza in vigore. |
| **Scartati** | Ciò che è stato rifiutato o scartato perché il budget era esaurito. |
| **Limitata** | Quante richieste ha rifiutato il limite di frequenza. |
| **Stato** | **Entro il budget**, **Soglia di avviso superata** o **Esaurito**, **Nessun budget giornaliero** per un segnale con solo un limite di frequenza, e **Sconosciuto** finché i conteggi non si possono leggere. |

- **Nella pagina di una chiave**, la scheda **Utilizzo del budget di oggi** mostra ciò che la chiave ha usato dei propri budget.
- **Negli explorer**, un banner sopra i dati di log, tracce, metriche, profili ed eventi di sicurezza indica quando il budget di quel segnale ha superato la soglia di avviso o è esaurito, con **Vedi i budget** per aprire la pagina Utilizzo.
- **Nell'Admin Dashboard**, la pagina **Budget di acquisizione** di un progetto mostra gli stessi valori.

## Ricevere avvisi su un budget

Ogni 5 minuti, OneUptime scrive i valori del giorno di ogni budget come metriche del progetto, e un [monitor metriche](/docs/monitor/metrics-monitor) invia avvisi su di esse come su qualsiasi altra metrica:

| Metrica | Unità | Che cosa contiene |
| --- | --- | --- |
| `oneuptime.telemetry.budget.used.bytes` | `By` | I byte conteggiati sul budget giornaliero dall'inizio del giorno di budget. |
| `oneuptime.telemetry.budget.used.percent` | `%` | Lo stesso, come percentuale del budget giornaliero. A 100 o più, il segnale viene rifiutato fino all'azzeramento. |
| `oneuptime.telemetry.budget.dropped.bytes` | `By` | I byte rifiutati o scartati dall'inizio del giorno di budget perché il budget era esaurito. |
| `oneuptime.telemetry.budget.throttled.requests` | `{request}` | Le richieste rifiutate dal limite di frequenza dall'inizio del giorno di budget. |

Ogni punto porta questi attributi:

| Attributo | Valore |
| --- | --- |
| `projectId` | L'ID del progetto. |
| `signal` | `logs`, `traces`, `metrics`, `profiles` o `security-events`. |
| `scope` | `project`, oppure `ingestion-key` per il budget proprio di una chiave. |
| `ingestionKeyId` | L'ID della chiave, per il budget proprio di una chiave. |
| `ingestionKeyName` | Il nome della chiave quando il punto è stato scritto, per il budget proprio di una chiave. |

Per essere avvisati al 90% del budget dei log del progetto, create un monitor metriche su `oneuptime.telemetry.budget.used.percent`, filtrato su `signal` `logs` e `scope` `project`, che invii un avviso quando il massimo supera 90:

- **Aggregate con il massimo.** Ogni valore può solo crescere durante un giorno di budget.
- **Usate una finestra di 15 minuti o più.** Un punto viene scritto ogni 5 minuti, e una finestra senza punti risolve l'avviso.
- **Aspettatevi vuoti, non zeri.** Non viene scritto nulla per un valore pari a 0, né finché i conteggi non si possono leggere.
- **Non costano nulla.** Queste metriche non vengono conteggiate su alcun budget né come utilizzo della telemetria, e vengono conservate quanto le metriche dei monitor: 30 giorni, a meno che l'amministratore dell'istanza non lo cambi. I nomi di metrica che iniziano con `oneuptime.telemetry.budget.` sono riservati a loro: le metriche che le vostre applicazioni inviano con un nome simile vengono scartate.

## Risoluzione dei problemi

:::details Un collector registra 403 per le sue esportazioni
Il budget giornaliero del progetto o della chiave per quel segnale è esaurito, e il collector scarta ciò che non può inviare finché il budget non si azzera. Guardate **Usato oggi** nella pagina Utilizzo. Chiedete all'amministratore dell'istanza di aumentare il budget del progetto, oppure inviate meno dati: un filtro di scarto qui non aiuta, perché rimuove la telemetria dopo che è stata conteggiata.
:::

:::details Un collector registra 429 e riprova
Invia più velocemente di quanto consenta un limite di frequenza. Riprova dopo il ritardo indicato da `Retry-After`, quindi non si perde nulla a meno che la sua coda non si riempia. Aumentate il limite di frequenza, oppure distribuite gli invii in modo più uniforme.
:::

:::details «Usato oggi» è più di quanto mostra la pagina Utilizzo della telemetria
Un budget conteggia la telemetria man mano che arriva, decompressa, compreso ciò che i filtri di scarto rimuovono in seguito. La pagina Utilizzo conteggia ciò che è stato salvato, il giorno dopo.
:::

:::details I budget dicono che non è stato possibile leggere i conteggi di oggi
OneUptime non riesce a raggiungere Valkey, dove vengono conteggiati i budget. Finché non ci riesce, la telemetria viene salvata senza essere conteggiata, e nessun budget viene applicato.
:::

## Passaggi successivi

:::cards
- [Utilizzo della telemetria](/docs/telemetry/usage): Vedete che cosa invia ogni progetto e ogni servizio.
- [Filtri di scarto e regole di mascheramento](/docs/telemetry/drop-filters-and-scrub-rules): Smettete di salvare la telemetria che non vi serve.
- [Chiavi di acquisizione](/docs/telemetry/ingestion-keys): Una chiave per ogni mittente, così che ognuno possa avere un budget.
- [Monitor metriche](/docs/monitor/metrics-monitor): Ricevete avvisi sulle metriche dei budget.
:::

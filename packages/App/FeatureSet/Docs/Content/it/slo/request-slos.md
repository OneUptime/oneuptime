# SLO di richieste e latenza

Uno SLO di richieste misura ciò che i tuoi utenti ottengono da un servizio: la quota delle sue richieste che vanno a buon fine, o che vengono servite abbastanza in fretta. OneUptime le conta dalle tracce che i tuoi servizi inviano già, quindi non c'è nessun monitor da configurare: scegli i servizi e un obiettivo, e OneUptime li misura ogni 5 minuti.

:::cards
- [Creare uno SLO di richieste](#creare-uno-slo-di-richieste): I servizi, una soglia per la latenza e un obiettivo.
- [Contare solo alcune richieste](#contare-solo-alcune-richieste): Un solo endpoint, o tutte le richieste tranne i controlli di salute.
- [SLO basati su una metrica](#slo-basati-su-una-metrica): Un contatore o un istogramma, per i servizi che non inviano tracce.
- [Come si contano le richieste](#come-si-contano-le-richieste): Quali span contano, e quando.
- [Controlli dei rilasci](/docs/slo/release-checks): Fai il rollback di un rilascio che consuma il budget di errore.
:::

## Successo e latenza delle richieste

| Cosa misura | Una richiesta è cattiva quando | Il suo budget di errore conta |
| --- | --- | --- |
| **Successo delle richieste** | Lo stato del suo span è `Error`. Uno span senza stato conta come buono, nel senso che gli dà OpenTelemetry. | Le richieste fallite |
| **Latenza delle richieste** | Ha impiegato più della **Soglia di latenza (ms)** dello SLO, qualunque sia il suo stato. | Le richieste lente |

Lo SLI è la quota di richieste buone nella finestra di conformità, e il budget di errore sono le richieste cattive che l'obiettivo consente: al 99,9%, una ogni 1.000. Uno SLO di latenza conta come buona una richiesta che è fallita in fretta, quindi misura un servizio importante in entrambi i modi: uno SLO per dire che funziona, e uno per dire che è veloce.

## Come funziona

```mermaid title="Dalle tracce allo stato di uno SLO di richieste"
flowchart TB
    services["I servizi dello SLO"] --> spans["I loro span di ingresso,<br/>dalle tracce"]
    spans --> steps["Richieste buone e totali,<br/>contate a passi di 5 minuti"]
    steps --> sli["SLI: quota di richieste buone<br/>nella finestra di conformità"]
    sli --> budget["Budget di errore rimanente,<br/>in richieste"]
    budget --> status["Stato: Integro, A rischio<br/>o Budget esaurito"]
    steps --> burn["Tasso di consumo sulle finestre<br/>di ogni regola del tasso di consumo"]
    burn --> rules["Avvisi e incidenti per<br/>il tuo team di reperibilità"]
```

Una richiesta è uno span di ingresso di uno dei servizi dello SLO: lo span in cui una richiesta o un messaggio entra nel servizio, cioè quelli che l'elenco delle [Tracce](/docs/telemetry/traces-explorer#tracce-e-span) mostra per impostazione predefinita. Una richiesta che passa per due dei servizi dello SLO conta una volta in ciascuno.

Per il resto uno SLO di richieste funziona come qualsiasi altro. Il suo stato, le regole del tasso di consumo, la policy del budget di errore, i proprietari e le notifiche sono gli stessi, con il budget di errore espresso in richieste invece che in minuti.

## Prima di iniziare

- I servizi inviano tracce a OneUptime: vedi [OpenTelemetry](/docs/telemetry/open-telemetry). Ognuno compare nel [catalogo servizi](/docs/telemetry/services) con il suo `service.name`.
- Un ruolo che possa creare SLO: Proprietario del progetto, Amministratore del progetto o un ruolo personalizzato con il permesso Create Service Level Objective.

## Creare uno SLO di richieste

:::steps
### Aprire gli SLO

Apri **SLOs** dal menu **Prodotti** nella barra in alto e fai clic su **Crea: Obiettivo del livello di servizio**.

### Scegliere cosa misura

In **Cosa misura**, scegli **Successo delle richieste** o **Latenza delle richieste**, poi i **Servizi** di cui contare le richieste. Per **Latenza delle richieste**, imposta anche la **Soglia di latenza (ms)**: una richiesta servita entro questo tempo conta come abbastanza veloce, per esempio `300`. Per contare solo alcune delle loro richieste, inserisci un **Filtro delle richieste**: vedi [Contare solo alcune richieste](#contare-solo-alcune-richieste). Fai clic su **Avanti**.

### Dargli un nome e fissare un obiettivo

Inserisci un **Nome**, per esempio «Checkout requests», e un **Obiettivo (%)**: la quota di richieste che devono essere buone. Fai clic su **Crea: Obiettivo del livello di servizio**.

### Vedere arrivare i primi numeri

La prima valutazione, entro 5 minuti, conta le richieste delle ultime 6 ore, così lo SLO ha subito dei numeri. Le valutazioni successive contano anche le richieste più vecchie, finché la finestra di conformità non è coperta.
:::

La pagina **SLOs** di un servizio elenca gli SLO che lo misurano, e il suo **Crea: Obiettivo del livello di servizio** apre lo stesso modulo con il servizio già scelto. Per cambiare in seguito cosa misura uno SLO, i suoi servizi, la sua soglia o il suo filtro, apri le sue **Impostazioni** e fai clic su **Modifica cosa misura**.

## Contare solo alcune richieste

Uno SLO di richieste conta tutte le richieste dei suoi servizi. Un **Filtro delle richieste** conta solo quelle che interessano, come quelle dell'endpoint di checkout, oppure ne esclude alcune, come i controlli di salute, che farebbero sembrare lo SLI migliore di ciò che ottengono gli utenti. Scrivilo come una ricerca di tracce, con la stessa [sintassi di ricerca](/docs/telemetry/search-syntax#corrispondenza-dei-valori) dell'esploratore di tracce:

| Filtro delle richieste | Cosa conta |
| --- | --- |
| `@http.route:/checkout*` | Le richieste il cui percorso inizia con `/checkout`. |
| `-@http.route:/health` | Tutte le richieste tranne i controlli di salute. |
| `@http.request.method:[POST, PUT]` | Le richieste POST e PUT. |
| `name:"POST /checkout"` | Le richieste il cui span si chiama `POST /checkout`. |

Ogni termine deve corrispondere, quindi `@http.route:/checkout* -@http.route:/checkout/health` conta le richieste di checkout tranne il loro controllo di salute. Un termine con `@` è un attributo dello span della richiesta, e `name:` è il nome dello span. Il testo libero e gli altri campi dell'esploratore, come `status:` e `duration:`, qui non sono filtri: lo SLO decide già quali richieste sono cattive o lente. Un filtro contiene fino a 10 termini in 500 caratteri.

La **Panoramica** mostra il filtro sotto i servizi dello SLO, e le **Impostazioni** lo mostrano sotto **Cosa misura**. Cambiarlo fa ricontare le richieste dello SLO dall'inizio.

## SLO basati su una metrica

Quando i tuoi servizi contano già le loro richieste come metriche, o non inviano tracce, misura invece lo SLO da un contatore o da un istogramma. In **Cosa misura**, scegli **Metrica** e i **Servizi** che la inviano, poi nel passaggio **Metrica**:

| Campo | Cosa inserire |
| --- | --- |
| **Metrica** | Il nome della metrica, scelto tra le metriche del tuo progetto o digitato, come `http_requests_total` o `http.server.request.duration`. |
| **Eventi buoni** | **Un contatore, in base a una condizione** o **Un istogramma, in base a un valore**. |
| **Buono quando** | Per un contatore: gli eventi buoni, come ricerca sui suoi attributi, per esempio `@http.response.status_code:<500`. |
| **Buono fino a** | Per un istogramma: il valore che un'osservazione buona non supera, nell'unità propria della metrica, per esempio `0.3` per 300 ms in un istogramma in secondi. Usa uno dei limiti dei suoi bucket. |
| **Filtro della metrica** | Facoltativo: le serie che contano, come `-@http.route:/health`. |

Gli eventi di un contatore sono di quanto è cresciuto in ogni passo di 5 minuti, come lo legge `increase()` di Prometheus: un contatore che riparte conta di nuovo da zero, e contano sia i contatori cumulativi sia quelli delta. Gli eventi di un istogramma sono le sue osservazioni, e quelli buoni sono quelli nei bucket pari o inferiori al valore. Contano solo i punti propri della metrica, e solo quelli dei servizi dello SLO: un gauge con lo stesso nome non conta nulla. Uno SLO su un gauge, come lo è ogni metrica cloud, lo dice nella sua pagina, e così il selettore della metrica: misura una metrica cloud con un monitor di metriche e uno SLO della disponibilità di quel monitor.

Per il resto uno SLO di metrica funziona come uno SLO di richieste, con il budget di errore, le regole del tasso di consumo e i controlli dei rilasci espressi in eventi. Cambiare la metrica fa ricontare i suoi eventi dall'inizio.

## Come si contano le richieste

OneUptime conta le richieste buone e totali di ogni SLO a passi di 5 minuti e conserva i conteggi, così lo SLO legge la sua finestra dai propri conteggi invece di rileggere ogni volta tutti gli span:

- Un passo viene contato 2 minuti dopo la sua fine, così include gli span arrivati in ritardo, e la valutazione successiva conta di nuovo gli ultimi due passi per gli span che arrivano ancora più tardi.
- Un nuovo SLO parte dalle ultime 6 ore. Ogni valutazione successiva conta fino a un giorno di richieste più vecchie, a partire dalle più recenti, finché la finestra non è coperta.
- Si possono contare solo le richieste ancora entro la [conservazione della telemetria](/docs/telemetry/data-retention#per-quanto-tempo-viene-conservata-la-telemetria). I passi contati vengono conservati per 400 giorni, più di qualsiasi finestra di conformità, quindi una finestra più lunga della conservazione si riempie man mano che lo SLO invecchia.
- Cambiare cosa misura lo SLO, i suoi servizi, la sua soglia di latenza o il suo filtro delle richieste fa ricontare le sue richieste dall'inizio. Una finestra di conformità più lunga si riempie contando più indietro nel tempo.

Finché i conteggi coprono solo una parte della finestra di conformità, la **Panoramica** lo dice con un indicatore **Finestra piena al 23%**, e il riquadro **Budget di errore rimasto** lo ripete sotto il suo numero. Entrambi spariscono quando i conteggi coprono tutta la finestra.

## Il budget di errore in richieste

Il budget sono le richieste cattive che l'obiettivo consente tra quelle contate nella finestra, quindi cresce con il traffico: al 99,9%, una finestra di 2.000.000 di richieste ne consente 2.000 fallite. Nella **Panoramica**:

- **Budget di errore rimasto** dice quante richieste cattive restano e su quante, oppure di quante richieste lo SLO ha superato il budget.
- **Autonomia del budget** dice quanto dura il budget al tasso di consumo attuale, purché il traffico resti com'era.
- Il riepilogo conta i servizi dello SLO, e uno SLO di latenza indica la sua soglia sotto l'obiettivo.

Anche gli avvisi di tasso di consumo, le notifiche e il feed esprimono il budget in richieste. La metrica `oneuptime.slo.error.budget.remaining.seconds` non viene inviata per uno SLO di richieste: usa invece `oneuptime.slo.error.budget.remaining.percent` nei grafici.

Uno SLO di richieste riceve le stesse regole **Fast burn**, **Slow burn** e **Slow leak** di ogni nuovo SLO. In un'ora tranquilla con una manciata di richieste basta un solo errore per consumare in fretta, quindi una regola può ignorare le finestre con troppo poche richieste: imposta il **Numero minimo di richieste** della regola, e la regola salta una finestra lunga che ha meno richieste di quel numero.

## Risoluzione dei problemi

:::details Lo SLO mostra In attesa di richieste
Nessuno dei suoi servizi ha ancora servito una richiesta nella finestra. Controlla che i servizi inviino tracce a OneUptime e che i loro span includano span di ingresso: un servizio i cui span sono tutti interni non ha richieste da contare. Se lo SLO ha un **Filtro delle richieste**, usalo per cercare nell'[esploratore di tracce](/docs/telemetry/traces-explorer): un filtro che lì non trova nessuna richiesta non lascia allo SLO nulla da contare.
:::

:::details Lo SLI è cambiato dopo che ho cambiato i servizi
Cambiare cosa misura lo SLO, i suoi servizi, la sua soglia di latenza o il suo filtro delle richieste fa ricontare le sue richieste, a partire dalle ultime 6 ore, quindi lo SLI e il budget ripartono da lì. L'indicatore **Finestra piena al 23%** mostra quanta parte della finestra è stata contata finora.
:::

## Passi successivi

:::cards
- [Controlli dei rilasci](/docs/slo/release-checks): Lascia che Argo Rollouts, Flagger o una pipeline facciano il rollback di un rilascio che consuma il budget.
- [Avvisi e incidenti di tasso di consumo](/docs/slo/burn-rate-alerts): Avvisa il tuo team quando il budget si consuma troppo in fretta.
- [Policy del budget di errore](/docs/slo/error-budget-policy): Concorda cosa fa il team mentre il budget si esaurisce.
:::

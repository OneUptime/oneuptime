# Monitor tracce

Un monitor tracce conta, in una finestra di tempo, gli span che i vostri servizi inviano a OneUptime e che corrispondono ai vostri filtri (nome dello span, stato, servizio, attributi). Quando il conteggio soddisfa i vostri criteri, cambia lo stato del monitor, crea un avviso o dichiara un incidente. Usatelo per essere avvisati di richieste non riuscite verso un endpoint, di un picco di span in errore o di un servizio che ha smesso di inviare tracce.

:::cards
- [Creare il monitor](#creare-un-monitor-tracce): Scegliere quali span contare e quando avvisare.
- [Codici di stato degli span](#codici-di-stato-degli-span): Cosa significano OK, ERROR e UNSET, e su quale filtrare.
- [Come viene valutato](#come-viene-valutato): La finestra di tempo, il conteggio e il ciclo di un minuto.
- [Criteri](#criteri): Soglie, rilevamento delle anomalie e valori predefiniti.
:::

## Come funziona

```mermaid title="Ogni minuto, un monitor tracce conta e controlla"
flowchart TB
    App["I vostri servizi"] -->|OpenTelemetry| Store[("Span in OneUptime")]
    Store --> Count["Contare gli span corrispondenti<br/>nella finestra di tempo"]
    Count --> Check{"Criteri soddisfatti?"}
    Check -->|"Prima corrispondenza"| Act["Cambiare lo stato,<br/>avviso o incidente"]
    Check -->|Nessuno| Default["Stato predefinito"]
```

Ogni minuto, OneUptime conta gli span che corrispondono ai filtri del monitor e sono iniziati nella sua finestra di tempo. Confronta quel conteggio con i criteri del monitor dall'alto verso il basso, e il primo criterio che corrisponde decide cosa succede. Se nessuno corrisponde, il monitor torna al suo stato predefinito.

## Prima di iniziare

- I vostri servizi inviano tracce a OneUptime tramite OpenTelemetry. Vedete [OpenTelemetry](/docs/telemetry/open-telemetry).
- Cercate nell'esploratore delle tracce il nome esatto dello span da sorvegliare: i nomi degli span li stabilisce la vostra strumentazione, per esempio `POST /api/checkout` o `GET`.

## Creare un monitor tracce

:::steps
### Iniziare un nuovo monitor

Andate in **Monitor** e fate clic su **Crea monitor**. Oppure, nell'esploratore delle tracce, filtrate gli span di cui volete essere informati e fate clic su **Crea monitor** (la campanella) nella sua barra degli strumenti: il nuovo monitor parte osservando i servizi, gli stati, il nome dello span e gli attributi dell'esploratore.

### Scegliere Traces

In **Tipo di monitor**, fate clic su **Altri tipi di monitor** e scegliete **Tracce** sotto **Telemetria**, oppure digitate `traces` nella casella di ricerca. Inserite un **Nome**, poi fate clic su **Avanti**.

### Scegliere di cosa vi informa il monitor

In **Di cosa deve informarti questo monitor?**, scegliete **Troppe richieste fallite** o **Le richieste si fermano**. Ogni scelta compila gli span da osservare e la regola, che potete modificare più in basso. Scegliete **Qualcos'altro** per impostarli voi.

### Scegliere gli span da contare

In **Span da osservare**, impostate **Stato dello span** e **Il nome dello span contiene**. Un filtro lasciato vuoto corrisponde a tutti gli span. **Span corrispondenti**, sotto i filtri, mostra gli span a cui corrispondono in questo momento.

### Restringere il campo (facoltativo)

Aprite **Altri campi** per filtrare per servizio di telemetria, entità dell'infrastruttura o attributo.

### Dire quando avvisare

In **Quando avvisare**, scegliete una **Condizione**, il **Numero di span** e una **Finestra temporale**. La frase sotto di essi ripete la regola con parole semplici. Il grafico sotto la frase conta gli span corrispondenti in ogni finestra nelle ultime ore, disegna il numero della regola come una linea e dice quante volte la regola avrebbe avvisato. Il suo pulsante propone un numero che la regola non avrebbe superato in quel periodo.

### Scegliere cosa succede

In **Cosa succede**, scegliete **Crea un avviso**, **Dichiara un incidente** o **Entrambi**, e dategli un titolo e una gravità. Finché la regola corrisponde, il monitor mostra lo stato indicato in **Altri campi**; quando smette di corrispondere, il monitor torna al suo stato predefinito e l'avviso o l'incidente si risolve da solo.

### Creare il monitor

Fate clic su **Crea monitor**. Il monitor si apre sulla sua pagina **Panoramica**, e la sua prima valutazione avviene entro un minuto.
:::

> [!TIP]
> Per sapere quando una funzione di IA risponde male (risposte non riuscite, rifiutate, troncate, vuote, segnalate o lente), scegliete invece **IA / LLM** sotto **Telemetria**. Quel monitor legge per voi le chiamate di IA nelle vostre tracce, senza filtri sugli span da scrivere. Vedete [Osservabilità IA / LLM](/docs/telemetry/ai-llm-observability#vieni-avvisato-quando-lia-risponde-male).

## Cosa interroga

| Campo | A cosa corrisponde | Predefinito |
| --- | --- | --- |
| **Stato dello span** | Span con uno qualsiasi degli stati scelti: **Non impostato**, **Ok** o **Errore**. | Vuoto: tutti gli stati |
| **Il nome dello span contiene** | Span il cui nome contiene questo testo, senza distinzione tra maiuscole e minuscole. | Vuoto: tutti gli span |
| **Finestra temporale** (in **Quando avvisare**) | Span iniziati negli ultimi 5 secondi fino alle ultime 24 ore. | **Ultimi 5 minuti** |
| **Filtra per servizio di telemetria** (in **Altri campi**) | Span di uno qualsiasi dei servizi scelti. | Vuoto: tutti i servizi |
| **Filtra per entità dell'infrastruttura** (in **Altri campi**) | Span di uno qualsiasi degli host, pod, container e altre entità scelti. | Vuoto: tutte le entità |
| **Filtra per attributi** (in **Altri campi**) | Span i cui attributi soddisfano ogni condizione. Ogni condizione ha il proprio operatore, come «uguale a» o «contiene». | Vuoto: nessuna condizione |

Tutti i filtri che impostate devono corrispondere perché uno span venga contato.

### Codici di Stato degli Span

- **OK** — L'operazione è stata contrassegnata esplicitamente come riuscita, dal codice dell'applicazione o da una pipeline di tracce
- **ERROR** — L'operazione ha incontrato un errore
- **UNSET** — Non è stato impostato alcuno stato di errore. È lo stato predefinito di OpenTelemetry

UNSET non significa che manchino dei dati. La strumentazione OpenTelemetry imposta ERROR quando un'operazione non riesce e lascia in UNSET gli span andati a buon fine, quindi su un servizio in salute la maggior parte degli span è UNSET. OneUptime li mostra in verde come «Unset (no error)». Registrare un'eccezione non modifica lo stato di uno span, quindi uno span in UNSET può comunque avere eccezioni, che vengono elencate insieme allo span. Per ricevere avvisi in caso di errore, filtrare per ERROR. Per contare tutti gli span che non sono falliti, selezionare sia OK sia UNSET.

Se si desidera che le richieste riuscite vengano mostrate come OK, aggiungere una pipeline di tracce in **Tracce > Impostazioni > Pipeline** con la condizione di filtro **Stato = Non impostato** e un **Rimappatore di stato** che mappi su Ok i valori di `http.response.status_code` come `200`.

## Come viene valutato

- **Ogni minuto.** Un monitor tracce non viene controllato da sonde, quindi non ha un intervallo da impostare né una pagina **Sonde e intervallo**.
- **Un numero per valutazione.** Il monitor conta gli span che corrispondono a ogni filtro e sono iniziati entro la **Finestra temporale** prima della valutazione. Con **Ultimi 5 minuti**, ogni valutazione guarda indietro di cinque minuti, quindi le finestre di valutazioni consecutive si sovrappongono.
- **Nessuno span significa un conteggio di 0.** Un servizio che smette di inviare tracce produce 0, che è ciò che cerca **Le richieste si fermano**.
- **L'interruzione di OneUptime stesso non è silenzio.** Finché la finestra di tempo contiene un periodo in cui OneUptime stesso non riceveva dati (si stava riavviando, veniva aggiornato o recuperava un arretrato), il controllo attende: lo stato non cambia e nessun incidente o avviso viene aperto o risolto. Vedete [Quando OneUptime non riceve dati](/docs/monitor/when-oneuptime-is-not-receiving).
- **Criteri dall'alto verso il basso.** Decide il primo criterio che corrisponde, quindi mettete per primo il più grave.

Ogni cambio di stato, con il suo motivo, viene registrato nella **Cronologia di stato** del monitor.

## Criteri

I criteri di un monitor tracce hanno un solo **Tipo di filtro**: **Span Count**, il numero di span che hanno corrisposto nella finestra. **Quando avvisare** imposta un criterio, la cui **Condizione** è **Più di**, **Almeno**, **Meno di**, **Al massimo**, **Esattamente**, **Insolitamente alto**, **Insolitamente basso** o **Insolitamente alto o basso**. Per più criteri, o per uno con più di un filtro, fate clic su **Modifica come criteri personalizzati** in **Altri campi** di **Cosa succede**: lì ogni criterio ha una **Condizione del filtro** e, per una condizione di soglia, un **Valore**.

| Condizione del filtro | Corrisponde quando il conteggio degli span è… |
| --- | --- |
| **Maggiore di** | sopra il valore |
| **Maggiore o uguale a** | pari al valore o superiore |
| **Minore di** | sotto il valore |
| **Minore o uguale a** | pari al valore o inferiore |
| **Uguale a** | esattamente il valore |
| **Anomalously High** | sopra l'intervallo atteso per quest'ora della settimana |
| **Anomalously Low** | sotto quell'intervallo |
| **Anomalous** | fuori da quell'intervallo, in un senso o nell'altro |

Le condizioni di anomalia non hanno un **Valore**. Scegliete una **Sensibilità** (Basso, Medio, quella predefinita, oppure Alto) e, nei criteri personalizzati, una **Finestra di riferimento** di 14 (quella predefinita), 28, 60 o 90 giorni. OneUptime trasforma il conteggio in un tasso al minuto e lo confronta con la stessa ora della settimana in quella finestra. Il riferimento copre solo i servizi e gli stati degli span del monitor: i suoi filtri sul nome dello span e sugli attributi non ne fanno parte. Finché quell'ora della settimana non ha abbastanza storico, il criterio sta ancora imparando e non scatta.

Un monitor tracce creato in Crea monitor parte con la regola di ciò che avete scelto in **Di cosa deve informarti questo monitor?**:

| Scelta | Regola | Cosa succede |
| --- | --- | --- |
| **Troppe richieste fallite** | **Stato dello span** **Errore**, **Più di** `10` in **Ultimi 5 minuti** | Crea un avviso, che si risolve da solo |
| **Le richieste si fermano** | **Esattamente** `0` in **Ultimi 10 minuti** | Dichiara un incidente, che si risolve da solo |

Un monitor tracce creato tramite l'API o Terraform senza criteri parte con questi criteri:

| Criterio | Filtro | Effetto |
| --- | --- | --- |
| Check if … is offline | **Span Count** **Uguale a** `0` | Mette il monitor offline e dichiara un incidente, risolto automaticamente |
| Check if … is online | **Span Count** **Maggiore di** `0` | Mette il monitor online |

## Esempio pratico: richieste di checkout non riuscite

In cinque minuti, il servizio di checkout registra 1.200 span chiamati `POST /api/checkout`: 1.150 UNSET, 20 OK e 30 ERROR. Lo stesso monitor conta numeri molto diversi a seconda di **Stato dello span**:

| Stato dello span | Span Count | Cosa misura |
| --- | --- | --- |
| **Errore** | 30 | Le richieste non riuscite |
| **Ok** | 20 | Solo le richieste che il vostro codice ha contrassegnato come riuscite |
| **Non impostato** e **Ok** | 1.170 | Tutte le richieste che non sono fallite |
| Vuoto | 1.200 | Tutte le richieste |

Per essere avvisati quando più di 10 richieste di checkout non riescono in cinque minuti:

- **Il nome dello span contiene**: `POST /api/checkout`
- **Finestra temporale**: **Ultimi 5 minuti**
- **Stato dello span**: **Errore**
- **Quando avvisare**: **Più di** `10`
- **Cosa succede**: **Dichiara un incidente**

Con 30 richieste non riuscite, la regola corrisponde e viene dichiarato l'incidente. Quando passano cinque minuti con 10 errori o meno, la regola smette di corrispondere, il monitor torna online e l'incidente si risolve da solo.

## Risoluzione dei problemi

:::details Il monitor non conta alcuno span per il mio endpoint
**Il nome dello span contiene** viene confrontato con il nome dello span, e la strumentazione spesso nomina gli span del server in base alla rotta (`POST /api/checkout`) o solo al metodo (`GET`). Cercate il nome esatto nell'esploratore delle tracce. Poi aprite la pagina **Criteri** del monitor (sotto **Configurazione**) e fate clic su **Edit Monitoring Criteria**: **Span corrispondenti** mostra a cosa corrispondono i filtri in questo momento.
:::

:::details Le richieste riuscite non vengono contate quando filtro su Ok
La maggior parte delle strumentazioni lascia gli span riusciti in UNSET, non in OK (vedete [Codici di stato degli span](#codici-di-stato-degli-span)). Selezionate sia **Non impostato** sia **Ok**, oppure aggiungete la pipeline di tracce descritta lì.
:::

:::details Uno span ha un'eccezione ma non viene contato come errore
Registrare un'eccezione non modifica lo stato di uno span. Filtrate su **Errore**, oppure usate un [monitor eccezioni](/docs/monitor/exceptions-monitor) per essere avvisati delle eccezioni stesse.
:::

:::details Un criterio di anomalia non scatta mai
Sta ancora imparando: l'ora della settimana con cui confronta non ha ancora abbastanza storico nella **Finestra di riferimento**.
:::

## Passaggi successivi

:::cards
- [Monitor eccezioni](/docs/monitor/exceptions-monitor): Avvisare sulle eccezioni che i vostri servizi registrano.
- [Monitor log](/docs/monitor/logs-monitor): Avvisare sul volume e sul contenuto dei log.
- [Sintassi di ricerca](/docs/telemetry/search-syntax): Trovare nomi e stati degli span nell'esploratore delle tracce.
- [Modelli di incidenti e avvisi](/docs/monitor/incident-alert-templating): Scrivere titoli e descrizioni degli avvisi utili.
:::

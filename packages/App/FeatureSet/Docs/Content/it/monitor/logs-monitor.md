# Monitor log

Un monitor log conta, in una finestra di tempo, i log che i vostri servizi inviano a OneUptime e che corrispondono ai vostri filtri (testo, gravità, servizio, attributi). Quando il conteggio soddisfa i vostri criteri, cambia lo stato del monitor, crea un avviso o dichiara un incidente. Usatelo per individuare picchi di errori, un messaggio di errore preciso o un servizio che ha smesso di scrivere log.

:::cards
- [Creare il monitor](#creare-un-monitor-log): Scegliere quali log contare e quando avvisare.
- [Come viene valutato](#come-viene-valutato): La finestra di tempo, il conteggio e il ciclo di un minuto.
- [Criteri](#criteri): Soglie, rilevamento delle anomalie e valori predefiniti.
- [Avvisi per gruppo](#avvisi-per-gruppo-group-by): Un avviso per tunnel, utente o interfaccia.
:::

## Come funziona

```mermaid title="Ogni minuto, un monitor log conta e controlla"
flowchart TB
    App["I vostri servizi"] -->|OpenTelemetry| Store[("Log in OneUptime")]
    Store --> Count["Contare i log corrispondenti<br/>nella finestra di tempo"]
    Count --> Check{"Criteri soddisfatti?"}
    Check -->|"Prima corrispondenza"| Act["Cambiare lo stato,<br/>avviso o incidente"]
    Check -->|Nessuno| Default["Stato predefinito"]
```

Ogni minuto, OneUptime conta i log che corrispondono ai filtri del monitor e sono arrivati nella sua finestra di tempo. Confronta quel conteggio con i criteri del monitor dall'alto verso il basso, e il primo criterio che corrisponde decide cosa succede. Se nessuno corrisponde, il monitor torna al suo stato predefinito.

## Prima di iniziare

- I vostri servizi inviano log a OneUptime tramite OpenTelemetry (o un'altra sorgente di log che OneUptime acquisisce). Vedete [OpenTelemetry](/docs/telemetry/open-telemetry).
- Per filtrare o raggruppare in base a un valore contenuto nella riga di log, come il nome di un tunnel o di un utente, trasformatelo prima in un attributo con una [pipeline dei log](/docs/telemetry/log-pipelines).

## Creare un monitor log

:::steps
### Iniziare un nuovo monitor

Andate in **Monitor** e fate clic su **Crea monitor**. Oppure, nell'esploratore dei log, cercate i log di cui volete essere informati e fate clic su **Crea monitor** (la campanella) nella sua barra degli strumenti: il nuovo monitor parte osservando la ricerca, le gravità, i servizi e gli attributi dell'esploratore.

### Scegliere Logs

In **Tipo di monitor**, fate clic su **Altri tipi di monitor** e scegliete **Registri** sotto **Telemetria**, oppure digitate `logs` nella casella di ricerca. Inserite un **Nome**, poi fate clic su **Avanti**.

### Scegliere di cosa vi informa il monitor

In **Di cosa deve informarti questo monitor?**, scegliete **Troppi errori**, **Compare un messaggio** o **I log si fermano**. Ogni scelta compila i log da osservare e la regola, che potete modificare più in basso. Scegliete **Qualcos'altro** per impostarli voi.

### Scegliere i log da contare

In **Log da osservare**, impostate **Gravità del log** e **Il messaggio contiene**. Un filtro lasciato vuoto corrisponde a tutti i log. **Log corrispondenti**, sotto i filtri, mostra i log a cui corrispondono in questo momento.

### Restringere il campo (facoltativo)

Aprite **Altri campi** per filtrare per servizio di telemetria, entità dell'infrastruttura o attributo. Per ricevere un avviso per tunnel, utente o interfaccia invece di uno per l'intero monitor, aggiungete l'attributo in **Group by Attributes** (vedete [Avvisi per gruppo](#avvisi-per-gruppo-group-by)).

### Dire quando avvisare

In **Quando avvisare**, scegliete una **Condizione**, il **Numero di log** e una **Finestra temporale**. La frase sotto di essi ripete la regola con parole semplici. Il grafico sotto la frase conta i log corrispondenti in ogni finestra nelle ultime ore, disegna il numero della regola come una linea e dice quante volte la regola avrebbe avvisato. Il suo pulsante propone un numero che la regola non avrebbe superato in quel periodo.

### Scegliere cosa succede

In **Cosa succede**, scegliete **Crea un avviso**, **Dichiara un incidente** o **Entrambi**, e dategli un titolo e una gravità. Finché la regola corrisponde, il monitor mostra lo stato indicato in **Altri campi**; quando smette di corrispondere, il monitor torna al suo stato predefinito e l'avviso o l'incidente si risolve da solo.

### Creare il monitor

Fate clic su **Crea monitor**. Il monitor si apre sulla sua pagina **Panoramica**, e la sua prima valutazione avviene entro un minuto.
:::

## Cosa interroga

| Campo | A cosa corrisponde | Predefinito |
| --- | --- | --- |
| **Gravità del log** | Log con una qualsiasi delle gravità scelte. | Vuoto: tutte le gravità |
| **Il messaggio contiene** | Log il cui corpo contiene questo testo, senza distinzione tra maiuscole e minuscole. | Vuoto: tutti i log |
| **Finestra temporale** (in **Quando avvisare**) | Log degli ultimi 5 secondi fino alle ultime 24 ore. | **Ultimi 5 minuti** |
| **Group by Attributes** | Non è un filtro: conta separatamente ogni combinazione di valori di questi attributi. | Vuoto: un solo conteggio |
| **Risolto per attributi** | Non è un filtro: il log che risolve un gruppo. Compare appena **Group by Attributes** ha un attributo; vedi [Risolto da un log](#risolto-da-un-log). | Vuoto: un gruppo si risolve quando i suoi log si fermano |
| **Filtra per servizio di telemetria** (in **Altri campi**) | Log di uno qualsiasi dei servizi scelti. | Vuoto: tutti i servizi |
| **Filtra per entità dell'infrastruttura** (in **Altri campi**) | Log di uno qualsiasi degli host, pod, container e altre entità scelti. | Vuoto: tutte le entità |
| **Filtra per attributi** (in **Altri campi**) | Log i cui attributi soddisfano ogni condizione. Ogni condizione ha il proprio operatore, come «uguale a» o «contiene». | Vuoto: nessuna condizione |

Tutti i filtri che impostate devono corrispondere perché un log venga contato.

### Gravità dei log

Ogni log viene salvato con una di sette gravità. Per i log OpenTelemetry deriva dal numero di gravità del log, quindi scegliete la gravità, non il testo stampato dal vostro logger:

| Gravità | Numeri di gravità OpenTelemetry |
| --- | --- |
| **Traccia** | 1–4 |
| **Debug** | 5–8 |
| **Information** | 9–12 |
| **Warning** | 13–16 |
| **Errore** | 17–20 |
| **Fatal** | 21–24 |
| **Non specificato** | Tutto il resto |

## Come viene valutato

- **Ogni minuto.** Un monitor log non viene controllato da sonde, quindi non ha un intervallo da impostare né una pagina **Sonde e intervallo**.
- **Un numero per valutazione.** Il monitor conta i log che corrispondono a ogni filtro e sono arrivati entro la **Finestra temporale** prima della valutazione. Con **Ultimi 5 minuti**, ogni valutazione guarda indietro di cinque minuti, quindi le finestre di valutazioni consecutive si sovrappongono.
- **Nessun log significa un conteggio di 0.** Un servizio che smette di scrivere log produce 0, che è ciò che cerca **I log si fermano**.
- **L'interruzione di OneUptime stesso non è silenzio.** Finché la finestra di tempo contiene un periodo in cui OneUptime stesso non riceveva dati (si stava riavviando, veniva aggiornato o recuperava un arretrato), il controllo attende: lo stato non cambia e nessun incidente o avviso viene aperto o risolto. Vedete [Quando OneUptime non riceve dati](/docs/monitor/when-oneuptime-is-not-receiving).
- **Criteri dall'alto verso il basso.** Decide il primo criterio che corrisponde, quindi mettete per primo il più grave. Un monitor raggruppato funziona diversamente: controlla ogni criterio per ogni gruppo (vedete [La valutazione dei criteri cambia](#la-valutazione-dei-criteri-cambia)).

Ogni cambio di stato, con il suo motivo, viene registrato nella **Cronologia di stato** del monitor.

## Criteri

I criteri di un monitor log hanno un solo **Tipo di filtro**: **Log Count**, il numero di log che hanno corrisposto nella finestra. **Quando avvisare** imposta un criterio, la cui **Condizione** è **Più di**, **Almeno**, **Meno di**, **Al massimo**, **Esattamente**, **Insolitamente alto**, **Insolitamente basso** o **Insolitamente alto o basso**. Per più criteri, o per uno con più di un filtro, fate clic su **Modifica come criteri personalizzati** in **Altri campi** di **Cosa succede**: lì ogni criterio ha una **Condizione del filtro** e, per una condizione di soglia, un **Valore**.

| Condizione del filtro | Corrisponde quando il conteggio dei log è… |
| --- | --- |
| **Maggiore di** | sopra il valore |
| **Maggiore o uguale a** | pari al valore o superiore |
| **Minore di** | sotto il valore |
| **Minore o uguale a** | pari al valore o inferiore |
| **Uguale a** | esattamente il valore |
| **Anomalously High** | sopra l'intervallo atteso per quest'ora della settimana |
| **Anomalously Low** | sotto quell'intervallo |
| **Anomalous** | fuori da quell'intervallo, in un senso o nell'altro |

Le condizioni di anomalia non hanno un **Valore**. Scegliete una **Sensibilità** (Basso, Medio, quella predefinita, oppure Alto) e, nei criteri personalizzati, una **Finestra di riferimento** di 14 (quella predefinita), 28, 60 o 90 giorni. OneUptime trasforma il conteggio in un tasso al minuto e lo confronta con la stessa ora della settimana in quella finestra. Il riferimento copre solo i servizi e le gravità del monitor: i suoi filtri di testo e di attributi non ne fanno parte. Finché quell'ora della settimana non ha abbastanza storico, il criterio sta ancora imparando e non scatta.

Un monitor log creato in Crea monitor parte con la regola di ciò che avete scelto in **Di cosa deve informarti questo monitor?**:

| Scelta | Regola | Cosa succede |
| --- | --- | --- |
| **Troppi errori** | **Gravità del log** **Errore** e **Fatal**, **Più di** `10` in **Ultimi 5 minuti** | Crea un avviso, che si risolve da solo |
| **Compare un messaggio** | **Più di** `0` in **Ultimi 5 minuti** | Crea un avviso, che si risolve da solo |
| **I log si fermano** | **Esattamente** `0` in **Ultimi 10 minuti** | Dichiara un incidente, che si risolve da solo |

Un monitor log creato tramite l'API o Terraform senza criteri parte con questi criteri:

| Criterio | Filtro | Effetto |
| --- | --- | --- |
| Check if … is offline | **Log Count** **Uguale a** `0` | Mette il monitor offline e dichiara un incidente, risolto automaticamente |
| Check if … is online | **Log Count** **Maggiore di** `0` | Mette il monitor online |

## Esempio pratico: un picco di errori

Volete un incidente quando il servizio di checkout registra più di 50 errori in cinque minuti:

- **Gravità del log**: **Errore**
- **Finestra temporale**: **Ultimi 5 minuti**
- **Filtra per servizio di telemetria**: `checkout`
- **Quando avvisare**: **Più di** `50`
- **Cosa succede**: **Dichiara un incidente**

Quattro valutazioni consecutive:

| Ora | Log di errore degli ultimi 5 minuti | La regola corrisponde? | Cosa succede |
| --- | --- | --- | --- |
| 10:00 | 12 | No | Il monitor è online. |
| 10:01 | 64 | Sì | Il monitor va offline e viene dichiarato un incidente. |
| 10:02 | 81 | Sì | Ancora offline. L'incidente è già aperto, quindi non ne viene dichiarato un secondo. |
| 10:06 | 9 | No | Il monitor torna online, e l'incidente si risolve da solo perché **Risoluzione automatica dell'incidente** è attiva. |

Poiché le finestre si sovrappongono, una sola raffica di errori tiene alto il conteggio fino a cinque minuti dopo la sua fine. Usate una finestra più breve per un monitor che deve riprendersi prima.

## Avvisi per gruppo (Group By)

**Group by Attributes** divide il conteggio di un monitor log in un conteggio per ogni combinazione distinta di valori degli attributi (uno per tunnel IPsec, per utente VPN, per interfaccia del firewall) e valuta i criteri su ciascun gruppo separatamente. È l'equivalente, per i log, del [Group By](/docs/monitor/metrics-monitor#avvisi-per-serie-group-by) di un monitor metriche.

### Un avviso per gruppo

Senza Group By, un monitor che sorveglia i tunnel IPsec terminati è un unico conteggio per l'intero monitor e genera **un solo avviso per l'intero monitor**. Finché quell'avviso è aperto, la caduta di un secondo tunnel non produce nulla di nuovo: il monitor sta già avvisando.

Con Group By sul nome del tunnel, la terminazione del tunnel `HQ-Branch1` apre il proprio avviso, e la terminazione del tunnel `Branch2` dieci minuti dopo apre un **secondo avviso, separato**, accanto al primo.

```mermaid title="Senza e con Group By"
flowchart TB
    subgraph Without["Senza Group By"]
        direction TB
        A1["HQ-Branch1 cade"] --> M1["Un solo conteggio"]
        B1["Branch2 cade"] --> M1
        M1 --> X1["Un solo avviso"]
    end
    subgraph With["Raggruppato per con_name"]
        direction TB
        A2["HQ-Branch1 cade"] --> X2["Avviso per HQ-Branch1"]
        B2["Branch2 cade"] --> Y2["Avviso per Branch2"]
    end
    Without ~~~ With
```

### Risoluzione indipendente

L'avviso o l'incidente di ogni gruppo si risolve per conto proprio. Appena un gruppo non soddisfa più i criteri (`HQ-Branch1` non registra più terminazioni nella finestra di tempo), il suo avviso si risolve, mentre quello di `Branch2` resta aperto finché anche `Branch2` non si ferma. Il ripristino di un gruppo non chiude mai l'avviso di un altro.

Un monitor log vede eventi, non stati: l'avviso di un gruppo si risolve non appena quel gruppo non ha registrato nulla che soddisfi i criteri per un'intera finestra di tempo, che il tunnel sia tornato o no, a meno che il monitor non indichi il log che ne segnala il ritorno, come spiegato sotto.

### Risolto da un log

Un dispositivo che segnala un tunnel caduto di solito ne segnala anche il ritorno. **Risolto per attributi** indica quel log: una volta impostato, l'avviso o l'incidente di un gruppo resta aperto finché non arriva un log con quegli attributi per lo stesso gruppo, invece di risolversi quando i log del gruppo si fermano.

Prendi un monitor che conta i log con `event.name` = `vpn.tunnel_down`, raggruppati per `event.device` e `vpn.tunnel.name`, con **Risolto per attributi** impostato su `event.name` = `vpn.tunnel_up`. La caduta del tunnel `HQ-Branch1` apre il suo avviso. L'avviso resta aperto per tutta la notte, anche se il firewall non registra più nulla sul tunnel, e si risolve quando il firewall segnala `HQ-Branch1` di nuovo attivo. Se il tunnel cade di nuovo, si apre un nuovo avviso.

- Il campo compare appena **Group by Attributes** ha un attributo. Accetta fino a 10 attributi, e un log di risoluzione li porta tutti.
- Un log di risoluzione appartiene a un gruppo quando ha i valori del gruppo per gli attributi di raggruppamento, quindi entrambi i tipi di log devono portare quegli attributi.
- I servizi di telemetria e la finestra di tempo del monitor valgono anche per i log di risoluzione. I suoi filtri di testo e di gravità no: descrivono il problema.
- Un gruppo il cui log più recente è di risoluzione viene chiuso. Uno che ha registrato di nuovo il problema dopo resta aperto.
- Puoi sempre risolvere un avviso da te.

[Eventi di rete](/docs/monitor/network-events) crea questi monitor per te, un clic per avviso.

### Esempio: un avviso per tunnel IPsec Sophos

Si presuppone che le righe syslog del firewall vengano scomposte in attributi con un [parser Key=Value](/docs/telemetry/log-pipelines#keyvalue-parser), senza prefisso di destinazione, in modo che il nome del tunnel sia l'attributo `con_name`:

```text
log_component="IPSec" con_name="HQ-Branch1" status="Terminated" message="IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated."
```

:::steps
1. Create un monitor **Registri** e scegliete **Compare un messaggio**.
2. Impostate **Il messaggio contiene** su `terminated` e la **Finestra temporale** su **Ultimi 5 minuti**.
3. In **Altri campi**, aggiungete il filtro di attributo `log_component` = `IPSec`.
4. In **Group by Attributes**, aggiungete `con_name`.
5. Lasciate la regola su **Più di** `0`, e intitolate l'avviso o l'incidente `IPsec tunnel {{con_name}} terminated`.
:::

Ogni tunnel che registra una terminazione riceve ora il proprio avviso (`IPsec tunnel HQ-Branch1 terminated`, `IPsec tunnel Branch2 terminated`), e ciascuno si risolve per conto proprio.

### Valori del gruppo in titoli e descrizioni

Il valore di ogni attributo di Group By è una [variabile di modello](/docs/monitor/incident-alert-templating) nel titolo, nella descrizione e nelle note di rimedio dell'avviso o dell'incidente, come le etichette di una serie di metriche: raggruppare per `con_name` vi dà `{{con_name}}`. Una chiave con punti si legge come un percorso, quindi `sophos.con_name` è `{{sophos.con_name}}`. Quando il titolo non nomina già il gruppo, il gruppo viene aggiunto (`IPsec tunnel terminated - Con Name: HQ-Branch1`), e `{{seriesResourceSuffix}}` e `{{seriesResourceSummary}}` funzionano come nei monitor metriche.

### Come vengono contati i gruppi

- Fino a 10 attributi. Ogni combinazione distinta dei loro valori è un gruppo.
- Un log che non porta un attributo di Group By viene contato con un **valore vuoto** per quell'attributo, quindi i log senza l'attributo formano un gruppo a sé, il cui avviso non nomina alcun valore per esso. Se tutti gli avvisi arrivano senza valore di gruppo, controllate la chiave dell'attributo: una pipeline dei log con un prefisso di destinazione salva `con_name` come `sophos.con_name`.
- I valori di gruppo più lunghi di 256 caratteri vengono troncati a 256.
- Per ogni controllo vengono valutati al massimo **100 gruppi**: i 100 con più log. Quando ne corrispondono di più, gli altri vengono saltati per quel controllo e viene registrato un avviso nel log; restringete i filtri del monitor per coprirli.

### La valutazione dei criteri cambia

- **Ogni criterio viene valutato**, come in un monitor metriche raggruppato, quindi gruppi diversi possono soddisfare criteri diversi allo stesso tempo. Un gruppo che soddisfa due criteri riceve comunque un solo avviso, quello del primo, quindi ordinate i criteri dal più grave al meno grave.
- **Un gruppo esiste solo se ha registrato qualcosa nella finestra di tempo.** Per questo i criteri **Uguale a 0** e **Minore di** scattano solo per i gruppi che hanno registrato almeno una volta; per essere avvisati quando i log smettono del tutto di arrivare, usate un monitor senza Group By.
- **Il rilevamento delle anomalie** (**Anomalously High**, **Anomalously Low**, **Anomalous**) non viene valutato per gruppo (il suo riferimento copre l'intero monitor), quindi questi filtri non corrispondono mai su un monitor raggruppato.
- Lo stato del monitor segue il primo criterio che un qualsiasi gruppo soddisfa. Quando nessun gruppo soddisfa alcun criterio, il monitor torna al suo stato predefinito.

## Risoluzione dei problemi

:::details Il monitor è offline, ma il mio servizio scrive log
Il conteggio era 0, quindi i filtri non corrispondono a nessuno dei log che il servizio invia. Aprite la pagina **Criteri** del monitor (sotto **Configurazione**) e fate clic su **Edit Monitoring Criteria**: **Log corrispondenti** mostra a cosa corrispondono i filtri in questo momento, e il grafico in **Quando avvisare** li conta in ogni finestra. Le cause più comuni sono una gravità scelta in base al testo stampato dal logger invece che al suo numero di gravità (vedete [Gravità dei log](#gravità-dei-log)), un filtro di servizio o di attributo che non corrisponde, e una finestra di tempo più breve dell'intervallo tra i log del servizio.
:::

:::details C'è stato un picco, ma nessun avviso
I criteri vengono controllati dall'alto verso il basso e decide la prima corrispondenza. Un criterio ampio sopra quello che vi aspettavate, come **Log Count** **Maggiore di** `0`, corrisponde per primo e ferma gli altri. Mettete in cima il criterio più grave.
:::

:::details Un criterio di anomalia non scatta mai
Sta ancora imparando: l'ora della settimana con cui confronta non ha ancora abbastanza storico. Su un monitor con **Group by Attributes**, le condizioni di anomalia non corrispondono mai; usate lì una soglia.
:::

:::details Gli avvisi di gruppo arrivano senza valore di gruppo
I log che non portano l'attributo di Group By vengono contati con un valore vuoto. Controllate il nome esatto della chiave nell'esploratore dei log: una pipeline dei log con un prefisso di destinazione salva `con_name` come `sophos.con_name`.
:::

## Passaggi successivi

:::cards
- [Pipeline dei log](/docs/telemetry/log-pipelines): Scomporre le righe di log in attributi su cui filtrare e raggruppare.
- [Modelli di incidenti e avvisi](/docs/monitor/incident-alert-templating): Inserire valori di gruppo e conteggi in titoli e descrizioni.
- [Monitor metriche](/docs/monitor/metrics-monitor): Avvisare su una metrica, per host o per container.
- [Monitor tracce](/docs/monitor/traces-monitor): Avvisare allo stesso modo sugli span non riusciti.
:::

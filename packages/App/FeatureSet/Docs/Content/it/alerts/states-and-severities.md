# Stati e gravità degli avvisi

Ogni avviso ha uno **stato**, a che punto è il vostro team con esso, e una **gravità**, quanto conta. Gli stati guidano ciò che fa OneUptime: chi viene ancora chiamato, che cosa conta come attivo, quando un episodio si risolve. Le gravità ordinano gli avvisi, e le regole possono basarsi su di esse. Questa pagina è per chi li configura, o si chiede perché un avviso abbia chiamato o meno.

:::cards
- [Gli stati predefiniti](#gli-stati-predefiniti): Identified, Riconosciuto e Risolto, e che cosa fa ciascuno.
- [Aggiungere i vostri stati](#aggiungere-i-vostri-stati): Un passaggio tutto vostro, come «In analisi».
- [Far passare un avviso tra i suoi stati](#far-passare-un-avviso-tra-i-suoi-stati): Tutti i modi in cui cambia uno stato.
- [Gravità](#le-gravità-predefinite): High e Low, e come aggiungere le vostre.
:::

## Come funziona

Gli stati di avviso di un progetto formano un unico elenco ordinato, e gli avvisi lo percorrono solo verso il basso. La posizione di uno stato decide come conta un avviso che vi si trova: non ancora riconosciuto, riconosciuto o risolto. Gli episodi di avvisi percorrono lo stesso elenco.

```mermaid title="Gli avvisi scendono solo lungo la lista; la posizione di uno stato decide come conta"
flowchart TB
    subgraph open["Conta come<br/>non riconosciuto"]
        identified["Identified"]
    end
    subgraph working["Conta come<br/>riconosciuto"]
        acknowledged["Riconosciuto"]
        investigating["In analisi<br/>(vostro)"]
    end
    subgraph done["Conta come<br/>risolto"]
        resolved["Risolto"]
        closed["Chiuso<br/>(vostro)"]
    end
    identified --> acknowledged
    acknowledged --> investigating
    investigating --> resolved
    resolved --> closed
    identified -. "salta" .-> resolved
```

Il modello `AlertState` ha `name`, `description`, `color` e `order`, più tre flag: `isCreatedState`, `isAcknowledgedState` e `isResolvedState`. OneUptime legge i flag e l'ordine, mai il nome, quindi potete rinominare **Risolto** in «Chiuso» senza rompere nulla. Il modello `AlertSeverity` ha `name`, `description`, `color` e `order`, e nessun flag.

> [!TIP]
> Entrambi gli elenchi si trovano in **Avvisi → Impostazioni**, che nel menu laterale parte compresso: espandete **Impostazioni** per trovare **Stato avviso** e **Gravità avviso**.

## Gli stati predefiniti

Ogni nuovo progetto parte con tre stati di avviso, in quest'ordine:

| Stato            | `order` | Flag                  | Colore    | Che cosa significa                                |
| ---------------- | ------- | --------------------- | --------- | ------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | Lo stato in cui partono i nuovi avvisi.           |
| **Riconosciuto** | `2`     | `isAcknowledgedState` | `#ffbf53` | Qualcuno se ne sta occupando, e le chiamate si fermano. |
| **Risolto**      | `3`     | `isResolvedState`     | `#2ab57d` | L'avviso è concluso e non conta più come attivo.  |

I tre stati con flag portano l'etichetta **Integrato** nella pagina delle impostazioni. Potete rinominarli, ricolorarli e trascinarli, ma mantengono il loro ordine, creazione prima di riconoscimento prima di risoluzione, e non possono essere eliminati: il loro **Elimina** resta bloccato e ne spiega il motivo.

## Che cosa fa ogni flag

| Flag                  | Che cosa ne fa OneUptime                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | I nuovi avvisi partono da qui quando nessuno sceglie un altro stato: ogni avviso sollevato da un monitor, e ogni avviso creato lasciando vuoto **Stato iniziale**.              |
| `isAcknowledgedState` | **Riconosci** porta qui un avviso. In questo stato o in qualsiasi stato successivo, l'avviso conta come riconosciuto: le sue policy di reperibilità smettono di chiamare e **Riconosci** non viene più offerto. |
| `isResolvedState`     | **Risolvi** porta qui un avviso. In questo stato o in qualsiasi stato successivo, l'avviso conta come risolto: lascia **Avvisi attivi**, i suoi promemoria si fermano e il suo episodio può risolversi. |

## Aggiungere i vostri stati

Uno stato che aggiungete è un passaggio che il vostro team attraversa e che i tre stati predefiniti non nominano: «In analisi», «Mitigato», «Chiuso».

:::steps
### Aprire l'elenco degli stati

Andate in **Avvisi → Impostazioni → Stato avviso**. La scheda **Avviso Stati** elenca i vostri stati nel loro ordine. Ogni riga mostra il suo colore e il suo nome, come **Conta come** un avviso che vi si trova, e la sua descrizione.

### Creare lo stato

Fate clic su **Crea: Stato avviso** e compilate **Nome**, **Descrizione** e **Colore**. Il colore è già scelto: uno che nessun altro stato usa ancora. Il nuovo stato viene aggiunto subito sopra lo stato risolto, così mantiene gli avvisi attivi.

### Trascinarlo al suo posto

Trascinate una riga dalla maniglia per spostarla; il nuovo ordine viene salvato quando la rilasciate. La colonna **Conta come** si adegua: sopra lo stato riconosciuto un avviso è **Non riconosciuto**, da esso in giù **Riconosciuto**, e dallo stato risolto in giù **Risolto**.
:::

Uno stato che aggiungete non ha flag, quindi è la sua posizione a dargli significato. Mettete un passaggio di mitigazione tra **Riconosciuto** e **Risolto**, e un passaggio di triage sopra **Riconosciuto**. Uno stato posto sotto **Risolto** conta come risolto ovunque.

Portate un avviso in uno stato vostro dal menu **⋯** nell'intestazione dell'avviso, sotto **Cambia stato in**, che elenca ogni stato successivo a quello attuale. La sua conferma si intitola **Segna l'avviso come {{state}}**, con il nome dello stato al suo interno.

> [!NOTE]
> Su OneUptime Cloud, aggiungere o modificare stati e gravità degli avvisi richiede il piano **Growth** o superiore. Ogni piano può leggerli, usarli ed eliminare uno stato che avete aggiunto.

## L'ordine è obbligatorio

Ogni cambio di stato di un avviso viene confrontato con l'elenco, chiunque lo faccia: la dashboard, Slack, Microsoft Teams, l'API, Terraform, un workflow o OneUptime stesso.

- **I passi indietro vengono rifiutati**, con un messaggio che nomina entrambi gli stati: «Alert cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of alert states.»
- **Passare allo stato in cui si trova già viene rifiutato**: «Alert state cannot be same as previous state.»
- **I selettori offrono solo gli stati successivi a quello attuale**, così a nessuno viene proposto un cambio che verrebbe rifiutato.

Gli episodi di avvisi seguono lo stesso elenco, con i propri messaggi («Episode cannot transition to …»). L'unico passo indietro lungo l'elenco è di OneUptime stesso: una regola di raggruppamento che riapre un episodio risolto di recente. Per correggere uno stato impostato per errore, eliminate la sua riga nella pagina **Cronologia stato** dell'avviso; l'avviso torna allo stato della sua riga più recente rimasta.

## Le gravità predefinite

Ogni nuovo progetto parte con due gravità di avviso, dalla più grave:

| Gravità  | `order` | Colore    | Descrizione predefinita                                                           |
| -------- | ------- | --------- | --------------------------------------------------------------------------------- |
| **High** | `1`     | `#b70400` | Issues causing very high impact to customers. Immediate attention is required.    |
| **Low**  | `2`     | `#ffbf53` | Issues causing low impact to customers.                                           |

Gli incidenti partono con tre gravità e gli avvisi con due. Quando il modello di una raccomandazione di monitor dice **Critico** o **Warning**, OneUptime lo associa alla vostra prima e seconda gravità di avviso, che in un nuovo progetto sono **High** e **Low**.

## Modificare le gravità

Andate in **Avvisi → Impostazioni → Gravità avviso**. La scheda **Avviso Gravità** le elenca dalla più grave; trascinate una riga per cambiarne il grado. **Crea: Gravità avviso** ne aggiunge una in fondo all'elenco, la meno grave, con gli stessi **Nome**, **Descrizione** e **Colore** di uno stato.

Il grado decide quale gravità prevale dove OneUptime le confronta: la gravità di un episodio sale fino a quella dell'avviso più grave che vi entra. Le gravità non hanno flag né blocco di eliminazione: qualsiasi gravità può essere eliminata, comprese le due predefinite.

Una gravità da sola non chiama nessuno. Per chiamare in base alla gravità, aggiungete una regola di reperibilità le cui **Avviso Gravità** vi corrispondano: vedere [Regole e impostazioni degli avvisi](/docs/alerts/settings). Cambiare la gravità di un avviso scrive una voce nel suo feed e ricalcola la sua regola di promemoria.

## Archiviare uno stato o una gravità

Archivia uno stato o una gravità che il tuo team non deve più usare, invece di eliminarlo. L'archiviazione non modifica alcun avviso. Eliminare uno stato toglie le sue righe dalla cronologia di ogni avviso, e una gravità non può essere eliminata finché ci sono avvisi che la hanno.

- **Archivia** si trova nel menu **⋯** della riga. Chiede prima conferma ed elenca le regole, le misurazioni, i criteri dei monitor e i flussi di lavoro configurati per usare il valore: continuano a usarlo finché non li modifichi.
- **Nessuno può più sceglierlo.** **Cambia stato**, l'intestazione dell'avviso, Slack, Microsoft Teams, le regole e i criteri dei monitor lo escludono. L'API, Terraform e MCP lo rifiutano, indicando il valore e dove annullarne l'archiviazione.
- **Gli avvisi lo mantengono.** Un avviso che lo ha lo mantiene a ogni modifica successiva, la sua cronologia degli stati lo mostra ancora e puoi ancora filtrare in base a esso.
- **I valori archiviati sono elencati a parte**, nella sezione compressa **Stati avviso archiviati** o **Gravità avviso archiviate** sotto la tabella, con chi ha archiviato ciascuno e quando. **Annulla archiviazione** ne ripristina uno com'era.
- **Alcuni non possono essere archiviati.** Gli stati creato, confermato e risolto, e l'ultima gravità non archiviata del progetto. Il loro **Archivia** è bloccato, con il motivo.

**Elimina** dice prima cosa farebbe. Finché avvisi o episodi hanno il valore, l'eliminazione viene rifiutata e la finestra di dialogo li elenca. Altrimenti elenca cosa cambierebbe l'eliminazione e offre **Archivia invece**.

## Far passare un avviso tra i suoi stati

| Modo                             | Dove                                                                                      | Che cosa chiede                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Pulsanti dell'intestazione**   | L'intestazione dell'avviso: **Riconosci**, **Risolvi** e **Cambia stato in** nel suo menu **⋯** | Una breve conferma, **Riconosci avviso**, **Risolvi avviso** o **Segna l'avviso come {{state}}**, con una nota facoltativa sotto **Aggiungi una nota privata**. |
| **State timeline**               | **Cronologia stato** nel menu laterale dell'avviso                                        | Una riga che aggiungete a mano, con **Stato dell'avviso** e **Inizia il**.                                                            |
| **Riga dell'elenco** | Il menu **⋯** sulla riga di un avviso nell'elenco degli avvisi: **Riconosci**, **Risolvi** e **Cambia stato** | La conferma dell'intestazione, con il nome dell'avviso. Un avviso che un'altra modifica ha già spostato resta com'è, e la finestra dice perché. |
| **Modifica in blocco**           | **Riconosci**, **Risolvi** o **Cambia stato** su una selezione nell'elenco degli avvisi                                | Lo stato, e una nota privata aggiunta a ogni avviso. Gli avvisi già in quello stato o oltre vengono saltati.                         |
| **Automaticamente**              | Un monitor, un episodio, un incidente collegato o il vostro codice                       | **Risoluzione automatica dell'avviso** nei criteri di un monitor, il cambio di stato di un episodio, gli interruttori degli incidenti su [Avvisi collegati](/docs/incidents/linked-alerts), o una riga creata su `/api/alert-state-timeline`. |

L'intestazione offre **Riconosci** e **Risolvi** finché l'avviso non è ancora riconosciuto, e solo **Risolvi** dopo. Un avviso risolto non mostra nessuno dei due. Chi, con il proprio ruolo, non può cambiare lo stato dell'avviso vede i pulsanti bloccati e nessun menu degli altri stati: puntandone uno, compaiono le autorizzazioni che glielo permetterebbero.

## Che cosa fa il riconoscimento

Un avviso è riconosciuto dal momento in cui passa al vostro stato riconosciuto, o a qualsiasi stato successivo, compreso uno risolto. A quel punto:

- **La reperibilità smette di chiamare per esso.** Le sue policy di reperibilità non chiamano il livello successivo.
- **Riconosci non viene più offerto**, né nell'intestazione né in Slack e Microsoft Teams, dove un nuovo riconoscimento viene rifiutato con «Alert is already acknowledged.» o «Alert is already resolved.» Chi risponde alla propria chiamata dopo quel momento vede la chiamata riconosciuta, e l'avviso resta dov'è.
- **Il tempo di riconoscimento viene fissato**, dal primo di questi passaggi: il primo riquadro della **Panoramica**, e una misurazione che termina quando **L'avviso viene riconosciuto**.

## Che cosa fa la risoluzione

Un avviso è risolto quando passa al vostro stato risolto, o a qualsiasi stato successivo. A quel punto:

- **Lascia Avvisi attivi**, e il conteggio del menu laterale.
- **I suoi promemoria si fermano**, qualunque cosa dica la sua regola di promemoria.
- **Il suo episodio può risolversi.** Un episodio si risolve da solo quando ogni avviso al suo interno è risolto. Vedere [Episodi di avvisi e regole di raggruppamento](/docs/alerts/episodes).
- **Il suo monitor può sollevare un nuovo avviso.** Un criterio mantiene un solo avviso aperto alla volta; una volta risolto quello, la corrispondenza successiva ne apre un altro.

Passare da **Risolto** a uno stato successivo, ad esempio «Chiuso», non cambia nulla di tutto questo: l'avviso era già risolto.

## La cronologia degli stati

La pagina **Cronologia stato** dell'avviso è il registro di ogni stato in cui è stato. La sua scheda, **Cronologia di stato**, li disegna come una cronologia: una banda con ogni stato lungo quanto è durato e, sotto, ogni cambio, dal più recente. **Tabella**, nell'intestazione della scheda, li elenca invece in righe, con **Stato dell'avviso**, **Inizia il**, **Termina il** e **Durata**.

- **Visualizza causa** mostra la causa principale registrata con quel cambio.
- **Visualizza log** mostra che cosa ha registrato OneUptime quando l'avviso è cambiato, come il controllo del monitor che lo ha provocato.

Le righe possono essere aggiunte ed eliminate, ma non modificate, e un avviso ne conserva sempre almeno una. Eliminare la riga più recente riporta l'avviso allo stato della riga precedente.

> [!WARNING]
> Eliminare una riga riscrive la storia dell'avviso e ogni misurazione ricavata da essa. Usatelo per correggere un errore, non per fare ordine.

## L'elenco Avvisi attivi

**Avvisi → Avvisi attivi** contiene ogni avviso il cui stato si trova sopra il vostro stato risolto, e nient'altro lo decide: né la gravità, né l'età, né se qualcuno l'ha riconosciuto. Il badge rosso accanto, nel menu laterale, conta gli stessi avvisi.

Quindi uno stato vostro sopra **Risolto** mantiene gli avvisi nell'elenco, e uno sotto li toglie, come fa la risoluzione. **Episodi attivi** funziona allo stesso modo per gli episodi.

## Passi successivi

:::cards
- [Panoramica degli avvisi](/docs/alerts/index): Da dove arrivano gli avvisi e come il vostro team li gestisce.
- [Episodi di avvisi e regole di raggruppamento](/docs/alerts/episodes): Come lo stato di un episodio sposta i suoi avvisi.
- [Regole e impostazioni degli avvisi](/docs/alerts/settings): Chiamare e ricordare in base alla gravità.
- [Stati e gravità degli incidenti](/docs/incidents/states-and-severities): Lo stesso ciclo di vita, per gli incidenti.
:::

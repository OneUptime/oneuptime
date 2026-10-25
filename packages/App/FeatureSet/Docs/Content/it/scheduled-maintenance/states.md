# Stati della manutenzione

Ogni evento di manutenzione programmata si trova in un solo **stato**: a che punto è il lavoro, da pianificato ad approvato. Gli stati decidono cosa fa OneUptime con l'evento: quando i suoi monitor smettono di essere controllati, cosa mostrano le vostre pagine di stato, quando si fermano i suoi promemoria. Questa pagina tratta i quattro stati con cui parte ogni progetto, cosa sposta un evento dall'uno all'altro e come aggiungere passi vostri.

:::cards
- [Gli stati iniziali](#gli-stati-iniziali): Programmato, In corso, Terminato e Completato.
- [Cosa fa avanzare un evento](#cosa-fa-avanzare-un-evento): L'orologio, l'intestazione, la cronologia, la chat e l'API.
- [Stati vostri](#stati-vostri): Un passo prima che inizi il lavoro, o una verifica dopo.
- [La cronologia di stato](#la-cronologia-di-stato): Ogni stato in cui è stato un evento, e come correggerlo.
:::

## Come funziona

Gli stati di manutenzione di un progetto sono un unico elenco ordinato, e gli eventi lo percorrono solo verso il basso. La posizione di uno stato decide come conta un evento che vi si trova: in attesa di iniziare, in corso o concluso.

```mermaid title="Gli eventi scendono soltanto lungo l'elenco; la posizione di uno stato decide come conta"
flowchart TB
    subgraph waiting["In attesa di iniziare"]
        scheduled["Programmato"]
        confirmed["Confermato<br/>(vostro)"]
    end
    subgraph progress["In corso"]
        ongoing["In corso"]
        verifying["In verifica<br/>(vostro)"]
    end
    subgraph over["Concluso"]
        ended["Terminato"]
        completed["Completato"]
    end
    scheduled --> confirmed
    confirmed -->|"il suo Inizia il"| ongoing
    ongoing --> verifying
    verifying -->|"il suo Termina il"| ended
    ended --> completed
```

Il modello `ScheduledMaintenanceState` ha `name`, `description`, `color` e `order`, più quattro flag: `isScheduledState`, `isOngoingState`, `isEndedState` e `isResolvedState`. OneUptime legge i flag e l'ordine, mai il nome, quindi potete rinominare **Completato** in «Approvato» senza rompere nulla.

> [!TIP]
> L'elenco si trova in **Manutenzione programmata → Impostazioni → Stato evento**. **Impostazioni** parte chiusa nel menu laterale: apritela prima.

## Gli stati iniziali

Ogni nuovo progetto parte con quattro stati di manutenzione, in quest'ordine:

| Stato         | `order` | Flag               | Colore    | Cosa significa                                                 |
| ------------- | ------- | ------------------ | --------- | -------------------------------------------------------------- |
| **Programmato** | `1`   | `isScheduledState` | `#000000` | Ogni nuovo evento parte da qui e aspetta la sua ora di inizio. |
| **In corso**  | `2`     | `isOngoingState`   | `#ffbf53` | Il lavoro è in corso, e i monitor dell'evento non vengono controllati. |
| **Terminato** | `3`     | `isEndedState`     | `#4a4a4a` | La finestra è finita, e i controlli riprendono.                |
| **Completato** | `4`    | `isResolvedState`  | `#2ab57d` | Qualcuno ha approvato il lavoro, e i promemoria ai proprietari si fermano. |

I quattro stati contrassegnati portano l'etichetta **Integrato** nella pagina delle impostazioni. Potete rinominarli, ricolorarli e trascinarli, ma mantengono il loro ordine e non si possono eliminare: il loro **Elimina** resta bloccato, e dice perché.

**Terminato** e **Completato** sono entrambi conclusi. La differenza è chi sposta l'evento: OneUptime lo porta a **Terminato** al suo **Termina il**, e una persona, un pulsante della chat o l'API lo porta a **Completato** una volta verificato il lavoro.

## Cosa fa avanzare un evento

| Modo             | Dove                                                                                        | Cosa chiede                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **L'orologio**   | Un processo che gira ogni minuto                                                            | Niente: a **Inizia il** porta un evento in attesa a **In corso**, e a **Termina il** un evento in corso a **Terminato**. |
| **L'intestazione** | La **Panoramica** dell'evento: i pulsanti **Segna come {{state}}**, e **Cambia stato in** nel suo menu **⋯** | Una breve finestra di dialogo, **Segna la manutenzione programmata come {{state}}**, con **Notifica gli iscritti alla pagina di stato** e una nota facoltativa in **Aggiungi una nota pubblica**. |
| **La cronologia** | **Cronologia stato** nel menu laterale dell'evento                                         | Una riga che aggiungete a mano, con **Stato della manutenzione programmata** e **Inizia il**.                   |
| **Modifica in blocco** | **Cambia stato** su una selezione nell'elenco degli eventi                            | Lo stato, e una nota pubblica aggiunta a ogni evento. Gli eventi già in quello stato o oltre vengono saltati.  |
| **La chat**      | I pulsanti dei messaggi Slack e Microsoft Teams dell'evento                                 | La stessa modifica, fatta a vostro nome. Vedere [Slack](/docs/workspace-connections/slack#agire-su-incidenti-avvisi-ed-eventi-da-slack). |
| **L'API**        | Una riga creata in `/api/scheduled-maintenance-state-timeline`                              | Lo stato, e se gli iscritti vengono avvisati.                                                                   |

I pulsanti dell'intestazione prendono il nome dai vostri stati. Finché l'evento è in attesa ne offre due: uno che lo avvia, con il nome del vostro stato in corso, e uno che lo chiude, con il nome del vostro stato terminato. Mentre l'evento è in corso, solo il secondo. Il menu **⋯** elenca ogni altro stato successivo a quello attuale. Chi, con il proprio ruolo, non può cambiare lo stato dell'evento vede i pulsanti bloccati e nessun menu degli altri stati: puntandone uno, compaiono le autorizzazioni che glielo permetterebbero.

## Cosa fanno l'avvio e la fine

Un evento si avvia quando passa da uno stato in cui è in attesa a **In corso**, oppure direttamente a uno stato vostro posto tra **In corso** e **Terminato**. Allora:

- **I suoi monitor smettono di essere controllati** e passano al suo **Cambia lo stato del monitor in**, se ne ha uno. Anche un monitor che aggiungete all'evento mentre è in corso cambia.
- **Le sue pagine di stato lo elencano come in corso**, e i suoi iscritti vengono avvisati: alla sua ora se **Quando l'evento inizia** è attivo, e a mano come dice **Notifica gli iscritti alla pagina di stato** nella finestra di dialogo.
- **I suoi proprietari vengono avvisati**, se hanno attivato la notifica di cambio di stato, e l'evento compare in **Eventi in corso**.

Un evento termina quando passa da uno stato in cui è in corso a **Terminato**, **Completato** o a uno stato vostro posto dopo **Terminato**. Allora i suoi monitor tornano a essere controllati e tornano «operativi», a meno che un altro evento in corso li trattenga ancora, e i suoi iscritti vengono avvisati allo stesso modo: alla sua ora se **Quando l'evento termina** è attivo, e a mano come dice la finestra di dialogo.

Passare da **In corso** a «In verifica», o da **Terminato** a **Completato**, non avvia né chiude nulla di nuovo: l'evento era già iniziato, o già terminato.

## L'orologio dell'intestazione

Prima dell'inizio, l'intestazione fa il conto alla rovescia; mentre l'evento è in corso, conta da quanto dura; una volta concluso, dice quanto è durato. Quando l'evento manca un limite di oltre due minuti, un avviso ambra lo segnala:

- **Inizio in ritardo**: l'evento è ancora in attesa dopo il suo **Inizia il**.
- **In sforamento**: l'evento è ancora in corso dopo il suo **Termina il**.

L'avviso indica l'ora pianificata e lo stato che l'evento non ha ancora raggiunto. Subito dopo un limite, il processo che fa avanzare gli eventi potrebbe non essere ancora partito, quindi nei minuti successivi l'intestazione ricontrolla da sola e mostra il nuovo stato senza ricaricare.

## L'ordine è obbligatorio

Ogni cambio di stato viene controllato rispetto all'elenco, chiunque lo faccia: la dashboard, Slack, Microsoft Teams, l'API, Terraform, un workflow o OneUptime stesso.

- **I passi indietro vengono rifiutati**, con un messaggio che nomina entrambi gli stati: "Scheduled Maintenance cannot transition to Scheduled state from Ongoing state because Scheduled is before Ongoing in the order of scheduled maintenance states."
- **Passare allo stato in cui si trova già viene rifiutato**: "Scheduled Maintenance state cannot be same as previous state."
- **I selettori offrono solo gli stati successivi a quello attuale**, così a nessuno viene proposto un cambio che verrebbe rifiutato.

Per correggere uno stato impostato per errore, eliminate la sua riga nella pagina **Cronologia stato** dell'evento; l'evento torna allo stato della riga precedente.

## Stati vostri

Uno stato che aggiungete è un passo che il vostro team attraversa e che i quattro iniziali non nominano: «Confermato» prima che inizi il lavoro, «In verifica» dopo.

:::steps
### Aprire l'elenco degli stati

Andate in **Manutenzione programmata → Impostazioni → Stato evento**. La scheda **Pianificato Manutenzione Stati** elenca i vostri stati nel loro ordine. Ogni riga mostra il colore e il nome, come conta un evento che vi si trova (colonna **Conta come**) e la descrizione.

### Creare lo stato

Fate clic su **Crea: Pianificato Manutenzione Stato** e compilate **Nome**, **Descrizione** e **Colore**. Il nuovo stato viene aggiunto subito sopra lo stato completato.

### Trascinarlo al suo posto

Trascinate una riga dalla sua maniglia per spostarla; il nuovo ordine viene salvato quando la rilasciate. La colonna **Conta come** segue la posizione in cui la rilasciate.
:::

Uno stato che aggiungete non ha flag, quindi la sua posizione è ciò che significa:

| Dove lo mettete                         | Un evento che vi si trova                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Tra **Programmato** e **In corso**      | Aspetta il suo **Inizia il**, come in **Programmato**, e da lì si avvia alla sua ora.                            |
| Tra **In corso** e **Terminato**        | È in corso, come in **In corso**: i suoi monitor restano non controllati, e termina al suo **Termina il**.       |
| Tra **Terminato** e **Completato**      | È concluso, ma non ancora completato: i promemoria che durano fino al completamento continuano.                  |
| Sotto **Completato**                    | È completato, come in **Completato**.                                                                            |

Tenete i vostri stati sotto **Programmato**: ogni nuovo evento parte da lì, e un evento non risale mai l'elenco, quindi uno stato sopra non viene mai raggiunto. Portate un evento in uno stato vostro dal menu **⋯** della sua intestazione, in **Cambia stato in**.

> [!NOTE]
> Su OneUptime Cloud, aggiungere o modificare gli stati di manutenzione richiede il piano **Growth** o superiore. Ogni piano può leggerli, usarli ed eliminare uno stato che avete aggiunto.

## Archiviare uno stato

Archivia uno stato creato da te che il tuo team non deve più usare, invece di eliminarlo. L'archiviazione non modifica alcun evento: un evento in quello stato vi resta e prosegue come al solito, e la sua cronologia degli stati lo mostra ancora.

- **Archivia** si trova nel menu **⋯** della riga. Chiede prima conferma ed elenca le misurazioni e i flussi di lavoro configurati per usare lo stato.
- **Nessuno può più sceglierlo.** L'intestazione dell'evento, **Cambia stato**, Slack e Microsoft Teams lo escludono, e l'API, Terraform e MCP lo rifiutano. Puoi ancora filtrare gli eventi in base a esso.
- **Gli stati archiviati sono elencati a parte**, nella sezione compressa **Stati di manutenzione pianificata archiviati** sotto la tabella. **Annulla archiviazione** ne ripristina uno com'era.
- **I quattro stati predefiniti non possono essere archiviati**: OneUptime vi sposta gli eventi. Il loro **Archivia** è bloccato, con il motivo.

## La cronologia di stato

La pagina **Cronologia stato** dell'evento è la registrazione di ogni stato in cui è stato. La sua scheda, **Cronologia di stato**, li disegna come una cronologia: una banda con ogni stato lungo quanto è durato e, sotto, ogni cambio, il più recente per primo. **Tabella**, nell'intestazione della scheda, li elenca invece come righe, con **Stato della manutenzione programmata**, **Inizia il**, **Termina il**, **Durata**, se gli iscritti dovevano essere avvisati e com'è andata la loro notifica.

Nella dashboard le righe si possono aggiungere ed eliminare, ma non modificare, e un evento ne conserva sempre almeno una. Tramite l'API si può correggere lo `startsAt` di una riga, e ogni misurazione calcolata dalla cronologia lo segue. Eliminare la riga più recente riporta l'evento allo stato della riga precedente.

> [!WARNING]
> Eliminare una riga riscrive la storia dell'evento e ogni misurazione calcolata da essa. Usatelo per correggere un errore, non per fare ordine.

## Risoluzione dei problemi

:::details L'intestazione indica Start overdue
L'evento è ancora in attesa più di due minuti dopo il suo **Inizia il**, quindi il processo che avvia gli eventi non l'ha ancora fatto avanzare. Avviatelo voi con il pulsante dell'intestazione: un avvio a mano fa tutto ciò che fa il processo, anche per i suoi monitor.
:::

:::details Un evento non può tornare a uno stato in cui è stato
Gli stati scendono soltanto lungo l'elenco. Eliminate le righe successive allo stato che volete nella pagina **Cronologia stato** dell'evento, partendo dalla più recente.
:::

:::details Lo stato completato manca tra i pulsanti dell'intestazione
I pulsanti dell'intestazione avviano e chiudono l'evento. Completarlo si trova nel menu **⋯**, in **Cambia stato in**.
:::

## Passi successivi

:::cards
- [Panoramica della manutenzione programmata](/docs/scheduled-maintenance/index): Dove si trova tutto, e cosa influenza un evento.
- [Creare eventi di manutenzione](/docs/scheduled-maintenance/creating-events): Il modulo, campo per campo.
- [Regole e impostazioni della manutenzione](/docs/scheduled-maintenance/settings): Ricordare l'evento ai proprietari finché non è completato.
- [Stati e gravità degli incidenti](/docs/incidents/states-and-severities): Lo stesso elenco ordinato, per gli incidenti.
:::

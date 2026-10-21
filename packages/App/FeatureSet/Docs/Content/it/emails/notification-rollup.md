# Riepilogo delle notifiche

Quando qualcosa va davvero storto, raramente va storto una volta sola. Un collegamento a monte instabile fa cadere quaranta monitor, vengono dichiarati, riconosciuti e risolti quaranta incidenti, e ogni proprietario riceve un'e-mail per ogni passaggio: duecento messaggi in una sola casella, e nessuno li legge più.

OneUptime raccoglie automaticamente queste raffiche in un'unica e-mail. È attivo per tutti e non c'è niente da configurare, ma se preferisci ricevere ogni notifica in un'e-mail a sé puoi [disattivare il riepilogo per te](#disattivare-il-riepilogo-per-te), un progetto alla volta.

:::cards
- [Come funziona](#come-funziona): Quattro e-mail partono subito, il resto arriva insieme.
- [Cosa non viene mai riepilogato](#cosa-non-viene-mai-riepilogato): Chiamate di reperibilità, sicurezza, fatturazione ed e-mail agli iscritti.
- [Disattivare il riepilogo](#disattivare-il-riepilogo-per-te): Ricevere di nuovo ogni notifica in un'e-mail a sé.
- [Meno e-mail di routine](#ridurre-ancora): Disattivare in un colpo le e-mail informative.
:::

## Come funziona

Ogni e-mail di notifica per i proprietari che ricevi viene conteggiata su un piccolo budget, tenuto per progetto, per destinatario, per indirizzo e-mail e per **categoria** di risorsa: incidenti, avvisi, monitor, manutenzioni programmate, pagine di stato, sonde, SLO e così via.

```mermaid title="Come viene recapitata un'e-mail di notifica per i proprietari"
flowchart TB
    N["E-mail di notifica per i proprietari"] --> O{"Riepilogo attivo<br/>per te?"}
    O -->|"No"| S["Inviata subito"]
    O -->|"Sì"| C{"Quinta o successiva in questa<br/>categoria in 30 minuti?"}
    C -->|"No"| S
    C -->|"Sì"| H["Trattenuta"]
    H -->|"Circa 5 minuti dopo"| R["Un'unica e-mail di riepilogo<br/>per il progetto"]
```

- Le **prime quattro** e-mail di una categoria in qualsiasi finestra di trenta minuti vengono inviate subito, esattamente come sempre. Stesso oggetto, stesso modello, stessi link.
- La **quinta e tutte le successive** in quella finestra vengono trattenute.
- Circa cinque minuti dopo, tutto ciò che è stato trattenuto per te in quel progetto, in tutte le categorie, arriva come **un'unica** e-mail che elenca cosa è successo, con un link a ogni risorsa.

Il riepilogo include le notifiche a cui sei ancora iscritto al momento dell'invio. Se disattivi l'e-mail di un evento mentre le sue notifiche sono in coda, quelle notifiche vengono escluse dal riepilogo. Riattivare l'e-mail in seguito non reinvia gli aggiornamenti saltati.

Sotto la soglia la funzione non fa nulla. Un progetto che produce tre e-mail per i proprietari al giorno continua a inviarle separatamente.

## Com'è fatta l'e-mail di riepilogo

La riga dell'oggetto ti dice la portata _e il tipo_ di tempesta prima ancora di aprirla:

```text
[Acme Production] 112 notifications: 63 Monitors, 41 Incidents, 6 Alerts +2 more
```

All'interno, una scheda di sintesi riporta il totale, l'intervallo di tempo coperto dal riepilogo e la suddivisione per categoria. Sotto, le notifiche sono raggruppate in una sezione per categoria, dalla più urgente: incidenti, poi avvisi, poi i monitor e le sonde che li hanno rilevati, così la prima cosa sotto la sintesi è anche la prima che vale la pena aprire.

Ogni sezione contiene una riga per risorsa anziché una riga per evento:

- **Le righe mostrano come è finita una risorsa.** Se un incidente è stato creato, poi riconosciuto, poi risolto, è un'unica riga nel suo stato più recente, il che rende il riepilogo _più_ aggiornato di quanto sarebbero state tre e-mail separate.
- **I conteggi tornano.** Ogni riga riporta l'ora del suo ultimo aggiornamento, e una riga che ne ha assorbiti diversi dice quanti, così le sezioni e la scheda di sintesi danno sempre lo stesso totale.
- **Gravità e stato sono indicati.** Le schede di avvisi e incidenti mostrano la gravità e lo stato della loro ultima notifica, compresi i nomi personalizzati. Le notifiche più vecchie in coda senza questi dati compaiono comunque, senza le etichette mancanti.

Gli orari sono in UTC, con anche la data quando un riepilogo copre più di un giorno.

![Un'e-mail di riepilogo con quindici notifiche](/docs/static/images/NotificationRollupEmail.png)

## Cosa non viene mai riepilogato

Il riepilogo riguarda soltanto le notifiche per proprietari e membri, la famiglia del «è cambiato qualcosa di cui sei responsabile». Non può raggiungere nient'altro, perché si trova nell'unico percorso di codice seguito da queste notifiche, e da nessun'altra.

Mai ritardate e mai conteggiate:

| Categoria | Esempi |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Chiamate di reperibilità | Ogni chiamata di una policy di escalation e ogni richiesta di riconoscimento |
| Orari di reperibilità | «Sei reperibile ora», «sei il prossimo reperibile», «il tuo turno inizia a breve», «il tuo turno è stato riassegnato» |
| Sicurezza dell'account | Reimpostazione della password, verifica dell'e-mail, password cambiata, codice di backup a due fattori usato o rigenerato |
| Avvisi amministrativi sul tuo account | Un amministratore ha modificato i tuoi metodi di notifica o le tue regole di reperibilità |
| Fatturazione e saldo | Fatture, abbonamento scaduto, «non siamo riusciti a chiamare nessuno perché la carta è stata rifiutata» |
| Stato dell'istanza | Avvisi su Postgres, Valkey e ClickHouse agli amministratori dell'istanza |
| Iscritti alle pagine di stato | Ogni e-mail che la tua pagina di stato invia ai tuoi iscritti |
| Violazioni degli SLA | Inviate subito anche se riutilizzano il tipo di notifica per gli incidenti creati |

Riguarda solo le e-mail. SMS, telefonate, notifiche push, WhatsApp, Telegram, Slack, Microsoft Teams e webhook vengono recapitati subito, esattamente come prima, anche per le notifiche la cui e-mail è stata trattenuta.

## Limiti

| Limite | Valore |
| --- | --- |
| Notifiche in un'e-mail di riepilogo | Al massimo **500**. Quelle in eccesso restano in coda e partono con il riepilogo successivo, al massimo cinque minuti dopo. |
| Righe mostrate in un'e-mail di riepilogo | Al massimo **100**. Le righe sono accorpate per risorsa, quindi sono 100 risorse distinte; oltre, l'e-mail riporta i totali completi e rimanda al progetto. |
| E-mail di riepilogo a un destinatario da un progetto | Al massimo **12** all'ora. |
| Ritardo aggiunto a una notifica trattenuta | Circa sei minuti, nel caso peggiore. |

Il limite orario è imposto dal database, non da un timer, quindi regge anche durante una tempesta che dura ore.

## Disattivare il riepilogo per te

C'è chi vuole il raggruppamento. Altri archiviano ogni notifica appena arriva, o affidano la casella a qualcosa che lo fa, e un'e-mail di riepilogo rompe questo flusso. Per questo il riepilogo si può disattivare, per persona e per progetto.

:::steps
### Aprire Preferenze e-mail

Nel progetto, vai a **Impostazioni utente → Preferenze e-mail**, la stessa pagina a cui rimanda il fondo di ogni e-mail di riepilogo.

### Disattivare Email Rollup

Nella scheda **Email Rollup**, disattiva l'interruttore. Si salva da solo, e la scheda mostra poi "Off: every notification arrives as its own email, immediately."
:::

Con il riepilogo disattivato, ogni e-mail di notifica per proprietari e membri di quel progetto ti viene di nuovo inviata singolarmente e subito: stesso oggetto, stesso modello, stessi link, nessuna soglia e nessuna attesa di cinque minuti. Ciò che era già in coda per te quando lo disattivi arriva ancora come un ultimo riepilogo qualche minuto dopo; tutto il resto arriva uno alla volta.

L'interruttore è **solo tuo e vale per un solo progetto**. Disattivarlo non cambia ciò che ricevono i tuoi colleghi e non si estende agli altri progetti: così il rumoroso progetto di produzione può continuare a raggruppare mentre quello interno e tranquillo invia tutto singolarmente, o viceversa. È attivo per tutti finché ciascuno non lo disattiva.

Cosa **non** tocca:

- **Quali notifiche ricevi.** Questa è l'impostazione per tipo di evento e per canale in **Impostazioni utente → Impostazioni notifiche**, nella pagina accanto. Il riepilogo e questo interruttore cambiano soltanto in quante e-mail vengono raccolte quelle notifiche.
- **Chiamate di reperibilità ed e-mail sui turni**, **e-mail sulla sicurezza dell'account**, **e-mail di fatturazione**, avvisi sullo stato dell'istanza ed e-mail agli iscritti delle pagine di stato. Nessuna di queste viene mai riepilogata, quindi disattivare il riepilogo non cambia nulla per loro: vedi [Cosa non viene mai riepilogato](#cosa-non-viene-mai-riepilogato).
- **Qualsiasi altro canale.** SMS, telefonate, push, WhatsApp, Telegram, Slack, Microsoft Teams e webhook sono già immediati.

## Ridurre ancora

Il riepilogo raccoglie insieme gli aggiornamenti di routine; puoi anche smettere di riceverne la maggior parte.

:::steps
### Aprire le preferenze da un'e-mail di riepilogo

Apri il link alle preferenze in fondo a un'e-mail di riepilogo, oppure vai a **Impostazioni utente → Preferenze e-mail**.

### Scegliere Reduce routine emails

Nella scheda **Fewer routine emails**, seleziona **Reduce routine emails**. Quando la modifica è salvata, la scheda indica **E-mail di routine disattivate.**
:::

Questo disattiva per te, nel progetto corrente, queste e-mail informative:

- Note pubblicate su incidenti, avvisi, episodi e manutenzioni programmate.
- Avvisi che sei stato aggiunto come proprietario di una risorsa.
- Nuovi monitor e nuove pagine di stato.
- Incidenti o avvisi aggiunti a episodi esistenti.
- L'aggiunta a una policy di reperibilità o la rimozione da essa.

Mantiene le tue scelte attuali per la creazione di incidenti e avvisi, i cambi di stato, i promemoria, le assegnazioni degli incidenti, lo stato dei monitor e i turni di reperibilità, e non attiva nessuna e-mail che avevi disattivato. Chiamate di reperibilità, altri canali di consegna, e-mail dell'account, e-mail di fatturazione ed e-mail agli iscritti delle pagine di stato non cambiano.

Le modifiche vengono salvate insieme. Controlla gli interruttori per evento in **Impostazioni utente → Impostazioni notifiche** per riattivare una singola e-mail. Queste preferenze valgono anche per le notifiche in attesa di un riepilogo; un'e-mail già inviata non si può richiamare. Il riepilogo e-mail resta un'impostazione separata che controlla il raggruppamento degli eventi che mantieni.

## Risoluzione dei problemi

:::details Un'e-mail di notifica è arrivata con qualche minuto di ritardo
Era la quinta e-mail o successiva della sua categoria in trenta minuti, quindi è stata trattenuta e inviata in un riepilogo circa cinque minuti dopo. Cerca un'e-mail di riepilogo dello stesso progetto: la notifica è una riga al suo interno. Le chiamate di reperibilità e gli altri canali non sono stati ritardati.
:::

:::details Ho disattivato il riepilogo ma ho ricevuto comunque un'e-mail di riepilogo
Le notifiche già in coda per te quando lo hai disattivato arrivano come un ultimo riepilogo qualche minuto dopo. Tutto ciò che segue arriva un'e-mail alla volta.
:::

:::details In un'e-mail di riepilogo manca un aggiornamento che mi aspettavo
Ogni riga mostra una risorsa nel suo stato più recente, quindi un incidente creato, riconosciuto e risolto è una sola riga, con il numero di aggiornamenti che ha assorbito. Una notifica viene anche esclusa se hai disattivato l'e-mail di quell'evento in **Impostazioni utente → Impostazioni notifiche** mentre era in coda.
:::

## Passaggi successivi

:::cards
- [Configurazione SMTP](/docs/emails/smtp): Inviare le e-mail di OneUptime tramite il tuo server di posta.
- [Regole di escalation](/docs/on-call/escalation-rules): Come le chiamate di reperibilità raggiungono le persone, mai riepilogate.
:::

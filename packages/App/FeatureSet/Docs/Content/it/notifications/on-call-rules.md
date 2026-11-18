# Come contattarmi

Le vostre regole di reperibilità decidono come una chiamata vi raggiunge: quali dei vostri metodi di notifica OneUptime prova, e quanto tempo dopo l'inizio della chiamata. Ogni tipo di chiamata ha le sue regole, un insieme per gravità, così un incidente critico può telefonarvi subito mentre un avviso di bassa gravità aspetta un'e-mail. Le impostate in **Impostazioni utente → Come contattarmi**.

> [!NOTE]
> Queste regole sono solo vostre. Le **Regole di reperibilità** in **Incidenti → Regole** e **Avvisi → Regole** sono un'altra cosa: decidono quali politiche di reperibilità esegue un nuovo incidente o un nuovo avviso.

:::cards
- [Come una chiamata vi raggiunge](#come-una-chiamata-vi-raggiunge): Le vostre regole per una chiamata, passo dopo passo.
- [Una sola sequenza per tutto](#una-sola-sequenza-per-tutto): I passaggi che ogni chiamata prova, impostati una volta.
- [Le regole con cui partite](#le-regole-con-cui-partite): Cosa aggiunge ogni metodo verificato, e come sfoltirlo.
- [Aggiungere una regola](#aggiungere-una-regola): Un metodo e un ritardo per una gravità.
- [Regole push](#regole-push): Suonare anche in silenzioso, e ripetere finché qualcuno non riconosce.
:::

## Come una chiamata vi raggiunge

Una politica di reperibilità vi chiama quando una delle sue regole di escalation nomina voi, un team di cui fate parte o una pianificazione in cui siete di reperibilità. OneUptime scorre allora le vostre regole per quel tipo di chiamata e la sua gravità: ogni regola scatta sul proprio metodo appena è trascorso il suo ritardo dall'inizio della chiamata. Riconoscere l'incidente o l'avviso, da qualsiasi messaggio o in OneUptime, ferma ogni regola che non è ancora scattata.

```mermaid title="Una chiamata critica, tre regole, finché non riconoscete"
flowchart TB
    page["Un incidente critico<br/>vi chiama"] --> first["Subito:<br/>notifica push"]
    first --> second["Dopo 5 minuti:<br/>SMS"]
    second --> third["Dopo 10 minuti:<br/>telefonata"]
    ack["Riconoscete"] -.->|"ferma il resto"| third
```

La maggior parte dei messaggi può riconoscere la chiamata: e-mail, SMS e messaggi WhatsApp, Telegram, Slack, Microsoft Teams e Mattermost contengono un link per riconoscerla, e una telefonata vi chiede di premere 1. Se non potete gestire una chiamata, gli stessi messaggi vi permettono di escalarla, e una telefonata vi chiede di premere 2: la policy avvisa subito il livello successivo, e non venite più avvisati al riguardo. Vedi [Escalare un avviso](/docs/on-call/escalation-rules#escalare-un-avviso). Ogni chiamata ricevuta compare in **Impostazioni utente → Log di reperibilità**, dove **Visualizza cronologia** mostra ogni messaggio inviato e se è stato consegnato.

## Una sola sequenza per tutto

**Impostazioni utente → Come contattarmi** si apre sulla tua sequenza: passaggi numerati che ogni chiamata prova a turno, per incidenti, avvisi ed episodi di qualsiasi gravità. Ogni passaggio è un momento, ad esempio subito o dopo 5 minuti, con i metodi verificati che partono insieme in quel momento. Un passaggio successivo parte solo se nessuno ha ancora confermato la chiamata.

:::steps
### Aggiungere un modo per raggiungerti

Fai clic su **Aggiungi** in un passaggio per inviare uno dei tuoi metodi verificati al momento di quel passaggio, oppure su **Aggiungi passaggio** per iniziare un nuovo passaggio dopo l'ultimo. Un numero o un indirizzo che aspetta ancora il suo codice compare in **Non ancora verificato**, con **Verifica**. Senza lasciare la pagina, **Aggiungi il tuo telefono** sotto i passaggi invia un codice al tuo numero e, una volta verificato, il numero ti chiama via SMS e con una chiamata telefonica; **Usa questo browser** e **Scarica l'app** aggiungono il push allo stesso modo.

### Scegliere quando usarlo

Fai clic sul momento di un passaggio, ad esempio **Subito**, e scegline un altro, fino a un'ora: l'intero passaggio si sposta. Un passaggio push dice anche come suona e se si ripete: vedi [Regole push](#regole-push).

### Salvare

Fai clic su **Salva modifiche**, che compare appena qualcosa cambia. Scrive le stesse regole in ogni scheda di ogni tab: le regole che aggiungeresti a mano a ogni scheda.
:::

**Testa le tue chiamate**, in fondo alla pagina, ti invia una chiamata di prova attraverso di esse.

Quando il vostro server al momento non può inviare e-mail, SMS o chiamate telefoniche, un passaggio di quel tipo è segnato con **Non inviato al momento**, e la pagina dice una sola volta chi può configurarlo.

Quando una gravità merita altro, **Diverso per alcune gravità**, il pulsante accanto al titolo, apre i tab e le schede descritti più sotto. Una scheda diversa dalla tua sequenza è segnata con **Diverso dalla sequenza**. La pagina si apre comunque sui tuoi passaggi ed elenca sotto di essi ogni scheda diversa e cosa fa al suo posto. **Salva modifiche** lascia quelle schede come sono; **Usa questa sequenza per ogni gravità**, alla fine di quell'elenco, dà anche a loro la tua sequenza, dopo aver nominato le schede che perdono la loro differenza. Una gravità che il tuo progetto ha archiviato mantiene le sue regole.

Una policy di reperibilità decide chi viene chiamato e quando arriva il suo livello successivo. Come vieni raggiunto è questa sequenza, per ogni policy che ti chiama.

## Le quattro schede

**Impostazioni utente → Come contattarmi** ha una scheda per ogni tipo di chiamata. Ogni scheda ha un riquadro per gravità, con il nome e il colore scelti dal vostro progetto:

| Scheda | Chiamate per | Riquadri per |
| --- | --- | --- |
| **Incidenti** | Incidenti | Gravità degli incidenti |
| **Episodi di incidenti** | Episodi che raggruppano incidenti | Gravità degli incidenti |
| **Avvisi** | Avvisi | Gravità degli avvisi |
| **Episodi di avvisi** | Episodi che raggruppano avvisi | Gravità degli avvisi |

Un episodio vi chiama tramite le proprie politiche di reperibilità, separatamente dagli incidenti o avvisi che contiene, per questo le sue regole hanno una scheda a parte. L'indirizzo della pagina indica la scheda aperta, per esempio `/dashboard/{projectId}/user-settings/on-call-rules?type=alerts`; gli altri valori sono `incident-episodes` e `alert-episodes`, e senza `type` la pagina si apre su **Incidenti**.

Una gravità che il tuo progetto ha archiviato compare dopo le altre, contrassegnata come **Archiviato**, finché hai regole per essa: gli incidenti e gli avvisi che ce l'hanno ancora ti contattano con quelle regole. Puoi modificarle o rimuoverle, ma non aggiungerne di nuove.

## Le regole con cui partite

Ogni metodo che verificate riceve una regola su ogni riquadro di ogni scheda, inviata appena venite chiamati. La vostra e-mail di accesso le ha dal giorno in cui siete entrati, perché una chiamata vi raggiunga sempre. Verificate un numero di telefono per gli SMS, e ogni chiamata vi manda anche un SMS. Quando il vostro progetto ha una sequenza predefinita, un metodo che verificate la segue invece: vedete [La sequenza predefinita](#la-sequenza-predefinita).

È un inizio sicuro, e di solito troppo. Riducetelo a ciò che ogni gravità merita:

| Gravità | Un insieme sensato |
| --- | --- |
| Critica | Push subito, una telefonata dopo 5 minuti |
| Alta | Push subito, un SMS dopo 10 minuti |
| Minore o bassa | Un'e-mail subito |

Le vostre regole non hanno fasce di silenzio: lasciate le gravità basse sull'e-mail, o su una regola push impostata su **Standard**, così non vi svegliano mai. Perché la chiamata di una gravità bassa attenda l'orario di lavoro per tutti, impostate la regola di reperibilità che la attiva su **Solo durante l'orario di lavoro**: vedere [Regole di reperibilità](/docs/alerts/settings#regole-di-reperibilità).

## La sequenza predefinita

Un progetto può avere una sequenza predefinita: come viene chiamato un membro appena verifica un modo per essere raggiunto. Un Proprietario del progetto o un Amministratore del progetto la imposta in **Sequenza predefinita per i nuovi membri**, chiusa in **Altre impostazioni** su **Impostazioni del progetto → Notifiche → Canali di notifica**, con canali invece che con i dispositivi di ciascuno: per esempio un push subito e una chiamata telefonica dopo 5 minuti.

Con una sequenza predefinita, un metodo che verificate riceve una regola a ogni passaggio del suo canale, su ogni riquadro di ogni scheda, e un canale che la sequenza esclude non ne riceve nessuna. Le regole che avete già non cambiano mai, e una chiamata che non trova alcuna regola ricade comunque sui vostri metodi verificati.

Per darla ai membri che hanno già delle regole, un amministratore usa **Applica sequenza predefinita** nella pagina Prontezza: vedete [Applicare la sequenza predefinita](/docs/on-call/readiness#applicare-la-sequenza-predefinita). Ognuno di loro riceve un'e-mail.

Per seguirla voi stessi, fate clic su **Parti dalla sequenza predefinita**, accanto a **Diverso per alcune gravità**. I vostri passaggi diventano quelli della sequenza, con i vostri metodi verificati: un modo che non avete verificato viene escluso e nominato, e al suo posto tenete i vostri passaggi. Nulla cambia finché non fate clic su **Salva modifiche**.

**Telefono per le persone reperibili**, accanto, chiede a tutte le persone reperibili un numero verificato per SMS, chiamate telefoniche o WhatsApp. Finché non ne avete uno, questa pagina lo dice sopra **Aggiungi il tuo telefono**, e Prontezza e Stato della configurazione vi nominano. Nessuno resta escluso.

## Aggiungere una regola

:::steps
### Aprite il riquadro

Andate in **Impostazioni utente → Come contattarmi**, aprite la scheda del tipo di chiamata e trovate il riquadro della gravità.

### Scegliete il metodo

Fate clic su **Aggiungi regola di notifica**. In **Metodo di notifica**, scegliete uno dei vostri metodi verificati; un metodo che non avete verificato non viene proposto.

### Scegliete il suono di un push

Per un telefono, scegliete **Notifica push**: **Avviso critico** o **Standard**. Per qualsiasi dispositivo push, scegliete **Ripeti fino al riconoscimento**. Vedete [Regole push](#regole-push).

### Impostate il ritardo

Scegliete **Notificami dopo**: **Immediatamente**, **5 minuti**, **10 minuti**, **15 minuti**, **30 minuti** o **1 ora**. Poi fate clic su **Aggiungi regola di notifica** nella finestra.
:::

Il riquadro elenca le sue regole in ordine di ritardo, con **Metodo di notifica** e **Notifica dopo** per ciascuna.

## Modificare o eliminare una regola

- **Modifica** nella riga di una regola cambia il suo ritardo. Per inviare una regola a un altro metodo, eliminatela e aggiungetene una nuova.
- Su una regola push, fate clic sull'etichetta sotto il metodo per passare da **Avviso critico** a **Standard**, o per cambiare ogni quanto si ripete. Si salva subito.
- **Elimina** chiede prima conferma, e dice se la gravità resta senza regola. Una gravità senza regola ripiega sui vostri metodi verificati; vedete [Quando una gravità non ha una regola](#quando-una-gravità-non-ha-una-regola).

## Regole push

Una regola che chiama un telefono dice come suona il suo push:

| Scelta | Cosa fa il telefono |
| --- | --- |
| **Avviso critico** | Suona anche quando il telefono è in silenzioso o in Non disturbare, una volta attivato Critical On-Call Alerts nell'app OneUptime On-Call. Una nuova regola per telefono parte da qui. |
| **Standard** | Segue le impostazioni di suono, silenzioso e Non disturbare del telefono. |

Una regola push, per un telefono o un browser, può anche reinviare il suo push finché qualcuno non riconosce: **Non ripetere**, l'impostazione predefinita, oppure **Ogni minuto**, **Ogni 2 minuti**, **Ogni 3 minuti**, **Ogni 5 minuti**, **Ogni 10 minuti**, **Ogni 15 minuti** o **Ogni 30 minuti**. Si ripete fino a 10 volte in più, e si ferma appena l'incidente, l'avviso o l'episodio viene riconosciuto. Un avviso che continua dopo un riconoscimento, come un nuovo avviso, si ripete finché non risponde qualcuno che ha avvisato o finché l'incidente, l'avviso o l'episodio non viene risolto: [Quando avvisano più policy](/docs/on-call/policies#quando-avvisano-più-policy) li elenca. Vedete [Avvisi di reperibilità critici](/docs/self-hosted/push-notifications#avvisi-critici-di-reperibilità-superare-la-modalità-silenziosa).

## Quando una gravità non ha una regola

Una gravità che il vostro progetto aggiunge in seguito riceve regole entro pochi minuti, ricavate dalle scelte che avete già fatto in quella scheda: gli stessi metodi, dopo gli stessi ritardi, e un push che suona e si ripete allo stesso modo. Se in quella scheda non avevate regole, riceve la vostra e-mail verificata, subito. Quando il vostro progetto ha una sequenza predefinita, la vostra e-mail la segue invece: vedete [La sequenza predefinita](#la-sequenza-predefinita).

Una chiamata che non trova comunque una regola viene inviata lo stesso ai vostri metodi verificati, e ricevete un'e-mail al riguardo; vedete [Quando nessuna regola corrisponde](/docs/notifications/index#quando-nessuna-regola-corrisponde).

:::details Disattivare una gravità di proposito
L'API può salvare una regola di esclusione, con `isOptOut` impostato e senza metodo: allora non venite chiamati per quel tipo di chiamata e quella gravità, e niente subentra. La riga mostra **Silenziato: notifiche disattivate per questa regola**, ed eliminarla riattiva le chiamate. Anche una gravità aggiunta in seguito resta muta, se ogni regola che avete in quella scheda è un'esclusione.
:::

:::details Disattivare il ripiego per un intero progetto
Un Proprietario del progetto, o qualcuno con **Manage Billing**, può impostare `disableOnCallNotificationFallback` del progetto tramite l'API. Una chiamata che non trova una regola allora non viene consegnata, e il suo log dice che l'utente deve aggiungere regole in **Impostazioni utente → Come contattarmi**.
:::

## Le regole di un collega

I Proprietari del progetto e gli Amministratori del progetto possono vedere e cambiare la stessa pagina per chiunque nel progetto: in **Utenti** aprono la persona, poi **Come contattarmi** nella sezione **Reperibilità**. **Prontezza**, lì accanto, mostra se ogni gravità la raggiunge. Quando qualcun altro aggiunge, cambia o elimina le vostre regole, ricevete un'e-mail al riguardo, e ogni modifica compare nel log di audit del progetto.

## Risoluzione dei problemi

:::details Il mio telefono è rimasto muto per una chiamata critica
Controllate che il push della regola sia **Avviso critico** e non **Standard**, e che **Avvisi critici** sia attivo per il telefono in **Impostazioni utente → Metodi di notifica**, nella scheda **Notifiche push**.
:::

:::details Vengo chiamato due volte per ogni incidente
Ogni metodo verificato ha una regola per ogni gravità, inviata subito. Eliminate le regole che non volete, o date loro un ritardo. Un incidente in un episodio può chiamarvi una volta per l'incidente e una per l'episodio, tramite due politiche.
:::

:::details Ho ricevuto un'e-mail anche se la mia regola dice SMS
La chiamata non ha trovato una regola per il suo tipo o la sua gravità, ed è ripiegata sui vostri metodi gratuiti: aggiungete la regola nella scheda e nel riquadro giusti. Oppure l'e-mail era un aggiornamento su un elemento vostro, che segue le **Impostazioni notifiche**, non le vostre regole. I vostri **Log di reperibilità** elencano solo le chiamate.
:::

## Passi successivi

:::cards
- [Metodi di notifica](/docs/notifications/notification-methods): Aggiungete e verificate i metodi a cui puntano le vostre regole.
- [Regole di escalation](/docs/on-call/escalation-rules): Come una politica di reperibilità chiama le persone, livello per livello.
- [Notifiche push](/docs/self-hosted/push-notifications): Avvisi critici, suonerie e ripetizioni sui telefoni.
- [Come OneUptime vi raggiunge](/docs/notifications/index): Come si combinano metodi, regole e impostazioni.
:::

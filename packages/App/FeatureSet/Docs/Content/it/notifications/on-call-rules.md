# Regole di reperibilità personali

Le vostre regole di reperibilità decidono come una chiamata vi raggiunge: quali dei vostri metodi di notifica OneUptime prova, e quanto tempo dopo l'inizio della chiamata. Ogni tipo di chiamata ha le sue regole, un insieme per gravità, così un incidente critico può telefonarvi subito mentre un avviso di bassa gravità aspetta un'e-mail. Le impostate in **Impostazioni utente → Regole di reperibilità**.

> [!NOTE]
> Queste regole sono solo vostre. Le **Regole di reperibilità** in **Incidenti → Regole** e **Avvisi → Regole** sono un'altra cosa: decidono quali politiche di reperibilità esegue un nuovo incidente o un nuovo avviso.

:::cards
- [Come una chiamata vi raggiunge](#come-una-chiamata-vi-raggiunge): Le vostre regole per una chiamata, passo dopo passo.
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

La maggior parte dei messaggi può riconoscere la chiamata: e-mail, SMS e messaggi WhatsApp, Telegram, Slack e Microsoft Teams contengono un link per riconoscerla, e una telefonata vi chiede di premere 1. Se non potete gestire una chiamata, gli stessi messaggi vi permettono di escalarla, e una telefonata vi chiede di premere 2: la policy avvisa subito il livello successivo, e non venite più avvisati al riguardo. Vedi [Escalare un avviso](/docs/on-call/escalation-rules#escalare-un-avviso). Ogni chiamata ricevuta compare in **Impostazioni utente → Registri di reperibilità**, dove **Visualizza cronologia** mostra ogni messaggio inviato e se è stato consegnato.

## Le quattro schede

**Impostazioni utente → Regole di reperibilità** ha una scheda per ogni tipo di chiamata. Ogni scheda ha un riquadro per gravità, con il nome e il colore scelti dal vostro progetto:

| Scheda | Chiamate per | Riquadri per |
| --- | --- | --- |
| **Incidenti** | Incidenti | Gravità degli incidenti |
| **Incidente Episodi** | Episodi che raggruppano incidenti | Gravità degli incidenti |
| **Avvisi** | Avvisi | Gravità degli avvisi |
| **Avviso Episodi** | Episodi che raggruppano avvisi | Gravità degli avvisi |

Un episodio vi chiama tramite le proprie politiche di reperibilità, separatamente dagli incidenti o avvisi che contiene, per questo le sue regole hanno una scheda a parte. L'indirizzo della pagina indica la scheda aperta, per esempio `/dashboard/{projectId}/user-settings/on-call-rules?type=alerts`; gli altri valori sono `incident-episodes` e `alert-episodes`, e senza `type` la pagina si apre su **Incidenti**.

## Le regole con cui partite

Ogni metodo che verificate riceve una regola su ogni riquadro di ogni scheda, inviata appena venite chiamati. La vostra e-mail di accesso le ha dal giorno in cui siete entrati, perché una chiamata vi raggiunga sempre. Verificate un numero di telefono per gli SMS, e ogni chiamata vi manda anche un SMS.

È un inizio sicuro, e di solito troppo. Riducetelo a ciò che ogni gravità merita:

| Gravità | Un insieme sensato |
| --- | --- |
| Critica | Push subito, una telefonata dopo 5 minuti |
| Alta | Push subito, un SMS dopo 10 minuti |
| Minore o bassa | Un'e-mail subito |

Le vostre regole non hanno fasce di silenzio: lasciate le gravità basse sull'e-mail, o su una regola push impostata su **Standard**, così non vi svegliano mai. Perché la chiamata di una gravità bassa attenda l'orario di lavoro per tutti, impostate la regola di reperibilità che la attiva su **Solo durante l'orario di lavoro**: vedere [Regole di reperibilità](/docs/alerts/settings#regole-di-reperibilità).

## Aggiungere una regola

:::steps
### Aprite il riquadro

Andate in **Impostazioni utente → Regole di reperibilità**, aprite la scheda del tipo di chiamata e trovate il riquadro della gravità.

### Scegliete il metodo

Fate clic su **Aggiungi: Notifica Regola**. In **Metodo di notifica**, scegliete uno dei vostri metodi verificati; un metodo che non avete verificato non viene proposto.

### Scegliete il suono di un push

Per un telefono, scegliete **Notifica push**: **Avviso critico** o **Standard**. Per qualsiasi dispositivo push, scegliete **Ripeti fino al riconoscimento**. Vedete [Regole push](#regole-push).

### Impostate il ritardo

Scegliete **Notificami dopo**: **Immediatamente**, **5 minuti**, **10 minuti**, **15 minuti**, **30 minuti** o **1 ora**. Poi fate clic su **Aggiungi: Notifica Regola** nella finestra.
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

Una regola push, per un telefono o un browser, può anche reinviare il suo push finché qualcuno non riconosce: **Non ripetere**, l'impostazione predefinita, oppure **Ogni minuto**, **Ogni 2 minuti**, **Ogni 3 minuti**, **Ogni 5 minuti**, **Ogni 10 minuti**, **Ogni 15 minuti** o **Ogni 30 minuti**. Si ripete fino a 10 volte in più, e si ferma appena l'incidente, l'avviso o l'episodio viene riconosciuto. Vedete [Avvisi di reperibilità critici](/docs/self-hosted/push-notifications#avvisi-critici-di-reperibilità-superare-la-modalità-silenziosa).

## Quando una gravità non ha una regola

Una gravità che il vostro progetto aggiunge in seguito riceve regole entro pochi minuti, ricavate dalle scelte che avete già fatto in quella scheda: gli stessi metodi, dopo gli stessi ritardi. Se in quella scheda non avevate regole, riceve la vostra e-mail verificata, subito.

Una chiamata che non trova comunque una regola viene inviata lo stesso ai vostri metodi verificati, e ricevete un'e-mail al riguardo; vedete [Quando nessuna regola corrisponde](/docs/notifications/index#quando-nessuna-regola-corrisponde).

:::details Disattivare una gravità di proposito
L'API può salvare una regola di esclusione, con `isOptOut` impostato e senza metodo: allora non venite chiamati per quel tipo di chiamata e quella gravità, e niente subentra. La riga mostra **Muted - notifications turned off for this rule**, ed eliminarla riattiva le chiamate. Anche una gravità aggiunta in seguito resta muta, se ogni regola che avete in quella scheda è un'esclusione.
:::

:::details Disattivare il ripiego per un intero progetto
Un proprietario del progetto, o qualcuno con **Manage Billing**, può impostare `disableOnCallNotificationFallback` del progetto tramite l'API. Una chiamata che non trova una regola allora non viene consegnata, e il suo registro dice che l'utente deve aggiungere regole in **Impostazioni utente → Regole di reperibilità**.
:::

## Le regole di un collega

I proprietari e gli amministratori del progetto possono vedere e cambiare la stessa pagina per chiunque nel progetto: in **Utenti** aprono la persona, poi **Regole di reperibilità** nella sezione **Reperibilità**. **Prontezza**, lì accanto, mostra se ogni gravità la raggiunge. Quando qualcun altro aggiunge, cambia o elimina le vostre regole, ricevete un'e-mail al riguardo, e ogni modifica compare nel registro di audit del progetto.

## Risoluzione dei problemi

:::details Il mio telefono è rimasto muto per una chiamata critica
Controllate che il push della regola sia **Avviso critico** e non **Standard**, e che **Avvisi critici** sia attivo per il telefono in **Impostazioni utente → Metodi di notifica**, nella scheda **Push Notifications**.
:::

:::details Vengo chiamato due volte per ogni incidente
Ogni metodo verificato ha una regola per ogni gravità, inviata subito. Eliminate le regole che non volete, o date loro un ritardo. Un incidente in un episodio può chiamarvi una volta per l'incidente e una per l'episodio, tramite due politiche.
:::

:::details Ho ricevuto un'e-mail anche se la mia regola dice SMS
La chiamata non ha trovato una regola per il suo tipo o la sua gravità, ed è ripiegata sui vostri metodi gratuiti: aggiungete la regola nella scheda e nel riquadro giusti. Oppure l'e-mail era un aggiornamento su un elemento vostro, che segue le **Impostazioni notifiche**, non le vostre regole. I vostri **Registri di reperibilità** elencano solo le chiamate.
:::

## Passi successivi

:::cards
- [Metodi di notifica](/docs/notifications/notification-methods): Aggiungete e verificate i metodi a cui puntano le vostre regole.
- [Regole di escalation](/docs/on-call/escalation-rules): Come una politica di reperibilità chiama le persone, livello per livello.
- [Notifiche push](/docs/self-hosted/push-notifications): Avvisi critici, suonerie e ripetizioni sui telefoni.
- [Come OneUptime vi raggiunge](/docs/notifications/index): Come si combinano metodi, regole e impostazioni.
:::

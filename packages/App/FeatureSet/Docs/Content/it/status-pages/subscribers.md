# Iscritti e annunci

Una pagina di stato è un posto dove le persone vanno. Gli iscritti sono le persone che preferirebbero non doverci andare — ti lasciano una volta sola un indirizzo email, un numero di telefono, un webhook Slack o un endpoint HTTP, e da lì in poi sono i tuoi aggiornamenti ad andare da loro.

Gli annunci sono l'altra metà dello stesso lavoro. Un monitor può dire ai tuoi visitatori che il checkout risponde con degli errori 500; nessun monitor può dire loro che sabato migrerai i database, che un fornitore esterno sta avendo una giornata storta, o che l'incidente di cui hanno letto ieri è ormai chiuso del tutto. Gli annunci sono il canale a testo libero per tutto ciò che i tuoi controlli non possono vedere, e raggiungono lo stesso elenco di iscritti.

Questa pagina copre entrambi: i cinque canali di iscrizione e come i visitatori si registrano, che cosa gli iscritti possono scegliere di ricevere, i flussi di doppia conferma e di annullamento, e come si scrivono, si pianificano e si trasformano in modelli gli annunci.

## Canali di iscrizione

Una pagina di stato supporta cinque canali, ognuno con il proprio interruttore sulla pagina di stato. Vai su **Pagine di stato → la tua pagina → Iscritti → Impostazioni iscritti**:

- **Abilita abbonati via email** (`enableEmailSubscribers`) — attivo per impostazione predefinita. Tutto il resto resta spento finché non lo accendi tu.
- **Abilita abbonati SMS** (`enableSmsSubscribers`) — spento per impostazione predefinita.
- **Abilita abbonati Slack** (`enableSlackSubscribers`) — spento per impostazione predefinita.
- **Abilita abbonati Microsoft Teams** (`enableMicrosoftTeamsSubscribers`) — spento per impostazione predefinita.
- **Abilita abbonati webhook** (`enableWebhookSubscribers`) — spento per impostazione predefinita.

Ogni canale ha anche il proprio elenco nel menu laterale della pagina di stato, sotto **Iscritti**: **Iscritti email**, **Iscritti SMS**, **Iscritti Slack**, **Iscritti MS Teams** e **Iscritti webhook**. È lì che guardi chi si è registrato, aggiungi qualcuno a mano o lasci a te stesso una **Note** (`internalNote`) su un singolo iscritto.

**Un solo interruttore non basta.** La voce **Iscriviti** nella barra di navigazione della pagina di stato compare solo quando **Mostra pagina iscritti** (`showSubscriberPageOnStatusPage`) è attivo *e* almeno un canale è abilitato. Se accendi **Abilita abbonati via email** ma lasci spento **Mostra pagina iscritti**, i visitatori non hanno alcun modo di raggiungere il modulo.

Gli stessi cinque interruttori compaiono una seconda volta nella scheda **Impostazioni iscritti** dentro **Impostazioni avanzate**, insieme a **Mostra pagina iscritti**. Sotto ci sono le stesse colonne — scegli una schermata e resta lì, preferibilmente la pagina dedicata **Impostazioni iscritti**, perché è dove vive tutto il resto della configurazione degli iscritti.

## Che cosa vede un visitatore nella pagina di iscrizione

La pagina **Iscriviti** ha un sottomenu con una scheda per ogni canale abilitato — **E-mail**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — mappate su `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` e `/subscribe/webhooks`. Ogni scheda chiede il minimo indispensabile:

- **E-mail** — titolo **Iscriviti via e-mail**, un solo campo **La tua e-mail** con segnaposto `subscriber@company.com`.
- **SMS** — titolo **Iscriviti via SMS**, un solo campo **Il tuo numero di telefono** con segnaposto `+11234567890`.
- **Slack** — titolo **Iscriviti via Slack**, con **Nome dell'area di lavoro Slack** (usato per la convalida) e **URL del webhook in entrata Slack**, segnaposto `https://hooks.slack.com/services/...`.
- **MS Teams** — titolo **Iscriviti via Microsoft Teams**, con **Nome dell'area di lavoro Microsoft Teams** e **URL del webhook in entrata Microsoft Teams**, segnaposto `https://outlook.office.com/webhook/...`.
- **Webhooks** — titolo **Iscriviti tramite webhook**, un solo campo **URL del webhook**. A ogni evento della pagina di stato viene inviata lì una richiesta JSON `POST`.

Il pulsante di invio dice **Iscriviti**, e una registrazione riuscita mostra *Iscrizione effettuata con successo.* La pagina porta anche la divisione tra **Nuova iscrizione** e **Gestisci iscrizione esistente**, così chi si è già iscritto può tornare alle proprie preferenze senza mettersi a cercare una vecchia email.

## Lasciare che gli iscritti scelgano risorse e tipi di evento

Per impostazione predefinita un iscritto riceve tutto quello che c'è sulla pagina. Due interruttori nella scheda **Impostazioni avanzate degli iscritti** cambiano le cose:

- **Consenti agli iscritti di scegliere le risorse** (`allowSubscribersToChooseResources`) — spento per impostazione predefinita. Accendilo e il modulo di iscrizione guadagna un interruttore **Iscriviti a tutte le risorse**; togli la spunta e compare **Seleziona le risorse a cui iscriverti**, così il visitatore sceglie le singole risorse.
- **Consenti agli iscritti di scegliere i tipi di evento** (`allowSubscribersToChooseEventTypes`) — spento per impostazione predefinita. Stessa forma: un interruttore **Iscriviti a tutti i tipi di eventi** e, quando lo togli, **Seleziona i tipi di eventi a cui iscriverti** sotto.

I tipi di evento sono `Incident`, `Announcement` e `Scheduled Event`.

Le scelte finiscono sul record dell'iscritto come **Is Subscribed to All Resources** (`isSubscribedToAllResources`, predefinito true), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, predefinito true), **Subscribed to Resources** e **Subscribed to Event Types**.

Utile quando: la pagina copre più prodotti. Un cliente che usa solo la tua API non vuole una notifica ogni volta che il sito di marketing vacilla — meglio lasciargli restringere l'elenco da solo che vederlo annullare del tutto l'iscrizione.

Nella stessa scheda si trovano anche i **Fusi orari abbonati**.

## Doppia conferma per le email

Gli iscritti via email confermano sempre. Quando un iscritto viene creato con un indirizzo email e non è già stato creato come confermato, **Is Subscription Confirmed** (`isSubscriptionConfirmed`) viene forzato a `false` e viene generato un **Subscription Confirmation Token** di sei cifre. OneUptime invia poi via email un link di conferma nella forma `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. Il visitatore arriva su una pagina **Conferma iscrizione** e, una volta andata a buon fine, legge *Iscrizione confermata con successo*.

Gli iscritti via SMS, Slack, Microsoft Teams e webhook saltano questo passaggio — vengono creati con `isSubscriptionConfirmed` già impostato a `true`.

**Non confermato vuol dire silenzio.** La query che recupera gli iscritti per una notifica filtra su `isUnsubscribed: false` e `isSubscriptionConfirmed: true`. Un indirizzo email che non ha mai cliccato il link resterà nel tuo elenco **Iscritti email** senza ricevere nulla. Se qualcuno giura di essere iscritto ma non riceve niente, controlla prima quella colonna.

Non c'è un interruttore per disattivare la conferma via email — è obbligatoria per chiunque si registri dalla pagina di stato. Una colonna separata per singolo iscritto, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, predefinito true), controlla invece l'email di benvenuto che parte una volta che l'iscritto è confermato.

## Gestire e annullare un'iscrizione

Ogni email agli iscritti porta con sé un link di annullamento nella forma `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Quella pagina si intitola **Aggiorna iscrizione** e dice al visitatore che lì può aggiornare le proprie preferenze o annullare l'iscrizione. Contiene:

- I selettori di risorse e tipi di evento che la pagina consente.
- Un interruttore **Annulla iscrizione**, descritto come annullamento dell'iscrizione a tutte le risorse. Scrive **È disiscritto** (`isUnsubscribed`, predefinito false).
- Un pulsante di invio che dice **Aggiorna iscrizione**; al salvataggio compare *Le tue modifiche sono state salvate.*

Chi ha perso il link usa **Gestisci iscrizione esistente** nella pagina **Iscriviti** e preme **Invia link di gestione**. OneUptime risponde che un'email con il link è stata inviata e che, se non arriva, conviene controllare la cartella spam.

Gli endpoint dietro tutto questo sono `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` e `PUT .../update-subscription/:statusPageId/:subscriberId`.

L'annullamento ribalta un flag invece di eliminare una riga, quindi il record resta nell'elenco del canale con **È disiscritto** impostato — comodo quando più avanti devi spiegare perché un certo indirizzo ha smesso di ricevere posta.

## Di che cosa vengono avvisati gli iscritti

Gli iscritti ricevono notizie sui tre tipi di evento visti sopra, ma ogni sorgente ha il suo interruttore, così non parte niente per sbaglio.

### Notifiche degli annunci

L'annuncio stesso porta il campo **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), esposto nel modulo di creazione come casella **Notifica gli iscritti alla pagina di stato** e attivo per impostazione predefinita. Se l'annuncio indica dei monitor sotto **Monitor interessati (facoltativo)**, la notifica è limitata a quei monitor; lascialo vuoto e vengono avvisati tutti gli iscritti.

### Eventi di manutenzione programmata

Un evento di manutenzione programmata ha il proprio insieme di colonne dedicate agli iscritti: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, più **Subscriber notifications before the event** e **Next subscriber notification before the event at?** per gli avvisi anticipati. **Pagine di stato** sull'evento decide su quali pagine appare, e **Should be visible on status page?** decide se appare del tutto.

### Incidenti

`Incident` è il terzo tipo di evento. Che cosa porta un incidente su una pagina di stato — quali risorse tocca e quali stati lo tengono visibile — è trattato in [Stati e gravità degli incidenti](/docs/incidents/states-and-severities).

La sezione **Registri di notifica** nel menu laterale della pagina di stato (`{id}/notification-logs`) è dove vai quando devi vedere che cosa la pagina ha effettivamente inviato.

## Personalizzare i modelli di notifica

La scheda **Modelli di notifica** in **Impostazioni iscritti** elenca i modelli usati da questa pagina di stato, con le colonne **Nome del modello**, **Tipo di evento** e **Metodo di notifica** — così puoi variare il testo per tipo di evento e per canale, invece di accettare un unico messaggio buono per tutto.

I modelli validi per l'intero progetto stanno un livello più su, in **Pagine di stato → Impostazioni → Modelli iscritti**, accanto a **Modelli di annunci**.

## Piè di pagina delle email, SMTP personalizzato e Twilio

Altre tre schede in **Impostazioni iscritti** controllano come i messaggi agli iscritti escono dal tuo progetto:

- **Impostazioni piè di pagina email** — **Abilita testo personalizzato per il piè di pagina email** e **Testo del piè di pagina delle notifiche email per gli abbonati** mettono un piè di pagina tuo sulle email agli iscritti.
- **SMTP personalizzato** — **Configurazione SMTP personalizzata** fa uscire le email agli iscritti dal tuo server di posta invece che da quello predefinito.
- **Configurazione Twilio** — **Configurazione Twilio** è l'account Twilio usato per gli iscritti via SMS.

Se hai iscritti via email, vale la pena configurare presto l'SMTP personalizzato: la posta che arriva dal tuo dominio ha molte meno probabilità di essere filtrata e molte più probabilità di essere creduta dal cliente che la legge alle due di notte.

## Annunci

Un annuncio è un record a livello di progetto (il modello `StatusPageAnnouncement`) che distribuisci a una o più pagine di stato, eventualmente limitato a monitor specifici, con una finestra temporale durante la quale viene mostrato.

Ne crei uno da **Pagine di stato → Altro → Annunci**, oppure da **Annunci** nel menu laterale di una singola pagina di stato. Il modulo di creazione è una procedura guidata in quattro passaggi:

1. **Informazioni di base** — **Titolo dell'annuncio** (obbligatorio, almeno due caratteri), **Descrizione** (Markdown, facoltativa) e **Allegati** per i file che devono essere disponibili insieme all'annuncio sulla pagina di stato.
2. **Pagine di stato** — **Mostra annuncio su queste pagine di stato**, una selezione multipla obbligatoria. Un solo annuncio può raggiungere più pagine in una volta.
3. **Risorse interessate** — **Monitor interessati (facoltativo)**. Se non ne selezioni nessuno, vengono avvisati tutti gli iscritti.
4. **Pianificazione e impostazioni** — **Inizia a mostrare l'annuncio alle** (obbligatorio, per impostazione predefinita adesso), **Termina la visualizzazione dell'annuncio il** (facoltativo) e **Notifica gli iscritti alla pagina di stato** (attivo per impostazione predefinita).

I visitatori leggono gli annunci su `/announcements`, divisi tra **Annunci attivi** e **Annunci passati**, ciascuno con la data di **Annunciato il**. Gli annunci attivi in questo momento vengono anche fissati in cima alla pagina panoramica. Quando non c'è nulla da mostrare, la pagina dice *Nessun annuncio* con la nota che finora non ne è stato pubblicato nessuno.

Gli allegati sono serviti da `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, dietro lo stesso controllo di lettura della pagina di stato — quindi un allegato su una pagina privata resta privato.

## Come funziona la pianificazione degli annunci

**Show At** (`showAnnouncementAt`) e **End At** (`endAnnouncementAt`) governano tutto, ma la pagina panoramica e l'elenco degli annunci si pongono domande diverse, e la differenza fa inciampare parecchia gente.

- **La pagina panoramica** mostra un annuncio quando `showAnnouncementAt` è nel passato e `endAnnouncementAt` è nel futuro oppure è vuoto.
- **L'elenco `/announcements`** mostra gli annunci il cui `showAnnouncementAt` ricade entro **Mostra cronologia annunci (in giorni)** (`showAnnouncementHistoryInDays`, predefinito 14), e poi li divide lato client tra attivi e passati.

Due conseguenze da tenere in conto:

- **Un annuncio senza data di fine non scade mai.** Lascia vuoto **Termina la visualizzazione dell'annuncio il** e resterà fissato sulla pagina panoramica all'infinito. Metti una data di fine su tutto ciò che ha una durata definita.
- **Un annuncio vecchio ma ancora attivo può sparire dall'elenco.** Se è iniziato più di `showAnnouncementHistoryInDays` fa, esce da `/announcements` pur restando sulla panoramica. Allarga la finestra della cronologia se tieni avvisi di lunga durata.

Se gli annunci compaiano o meno è deciso dalla scheda **Impostazioni annuncio** in **Impostazioni avanzate**: **Mostra annunci** (`showAnnouncementsOnStatusPage`, predefinito true) e **Mostra cronologia annunci (in giorni)** (predefinito 14). Con **Mostra annunci** spento, l'endpoint degli annunci rifiuta la richiesta in blocco.

## Modelli di annunci

Se pubblichi ripetutamente lo stesso tipo di avviso — il preavviso mensile di manutenzione, il degrado ricorrente di un servizio esterno — preparalo in anticipo. **Pagine di stato → Impostazioni → Modelli di annunci** contiene il modello `StatusPageAnnouncementTemplate`, e il suo modulo chiede **Nome del modello**, **Descrizione del modello**, **Titolo dell'annuncio**, **Descrizione**, **Mostra annuncio su queste pagine di stato**, **Monitor interessati (facoltativo)** e **Notifica agli iscritti**: così la distribuzione e la decisione sulla notifica si prendono una volta sola invece che ogni volta.

## Iscritti webhook e protezione SSRF

Gli iscritti webhook ricevono una richiesta JSON `POST` a ogni evento della pagina di stato, il che li rende il modo più semplice per far confluire gli aggiornamenti della pagina di stato in un sistema tuo — un chatbot, una dashboard interna, una coda di ticket.

Siccome l'iscrizione è un'operazione pubblica su una pagina pubblica, OneUptime protegge la destinazione:

- Un **URL del webhook** generico viene convalidato prima di essere accettato, e gli indirizzi privati, di loopback, link-local e dei metadati cloud vengono rifiutati. Non puoi puntare un'iscrizione a qualcosa che sta dentro la rete dell'installazione OneUptime.
- Un **URL del webhook in entrata Slack** deve iniziare con `https://hooks.slack.com/services/`.

Se un'iscrizione via webhook viene rifiutata in fase di registrazione, la prima cosa da controllare è un URL interno o malformato.

## Cosa leggere dopo

- [Panoramica delle pagine di stato](/docs/status-pages/index) — che cos'è una pagina di stato e come è composta.
- [Risorse e gruppi della pagina di stato](/docs/status-pages/resources-and-groups) — i monitor e i gruppi tra cui gli iscritti possono scegliere.
- [Branding e domini della pagina di stato](/docs/status-pages/branding-and-domains) — domini personalizzati, loghi e l'aspetto della pagina a cui puntano le tue email.
- [API pubblica](/docs/status-pages/public-api) — leggere i dati della pagina di stato in modo programmatico.
- [Stati e gravità degli incidenti](/docs/incidents/states-and-severities) — che cosa mette un incidente su una pagina di stato e che cosa lo toglie.
- [Impostazioni e automazione degli incidenti](/docs/incidents/settings) — le regole a livello di progetto dietro la comunicazione degli incidenti.

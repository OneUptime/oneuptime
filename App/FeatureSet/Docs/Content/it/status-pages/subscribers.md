# Iscritti e annunci

Una pagina di stato è un luogo che le persone visitano. Gli iscritti sono le persone che preferirebbero non doverlo fare: ti forniscono un indirizzo email, un numero di telefono, un webhook Slack o un endpoint HTTP una volta sola, e da quel momento i tuoi aggiornamenti arrivano a loro.

Gli annunci sono l'altra metà dello stesso compito. Un monitor può dire ai tuoi visitatori che il checkout sta restituendo errori 500; nessun monitor può dire loro che state migrando i database sabato, che un provider terzo sta avendo una giornata difficile, o che l'incidente di cui hanno letto ieri è stato completamente chiuso. Gli annunci sono il canale di testo libero per tutto ciò che i tuoi controlli non possono vedere, e raggiungono la stessa lista di iscritti.

Questa pagina copre entrambi gli argomenti: i cinque canali di iscrizione e come i visitatori si registrano, cosa gli iscritti possono scegliere di ricevere, i flussi di doppia conferma (double opt-in) e disiscrizione, e come gli annunci vengono scritti, pianificati e trasformati in modelli.

## Canali di iscrizione

Una pagina di stato supporta cinque canali, ciascuno con il proprio interruttore sulla pagina di stato. Vai a **Status Pages → your page → Subscribers → Subscriber Settings**:

- **Enable Email Subscribers** (`enableEmailSubscribers`) — attivo per impostazione predefinita. Tutto il resto è disattivato finché non lo attivi.
- **Enable SMS Subscribers** (`enableSmsSubscribers`) — disattivato per impostazione predefinita.
- **Enable Slack Subscribers** (`enableSlackSubscribers`) — disattivato per impostazione predefinita.
- **Enable Microsoft Teams Subscribers** (`enableMicrosoftTeamsSubscribers`) — disattivato per impostazione predefinita.
- **Enable Webhook Subscribers** (`enableWebhookSubscribers`) — disattivato per impostazione predefinita.

Ogni canale ha anche il proprio elenco nel menu laterale della pagina di stato sotto **Subscribers**: **Email Subscribers**, **SMS Subscribers**, **Slack Subscribers**, **MS Teams Subscribers** e **Webhook Subscribers**. È lì che vedi chi è iscritto, aggiungi qualcuno manualmente, o lasci una **Notes** (`internalNote`) su un particolare iscritto.

**Un solo interruttore non basta.** La voce **Subscribe** nella barra di navigazione della pagina di stato compare solo quando **Show Subscriber Page** (`showSubscriberPageOnStatusPage`) è attivo *e* almeno un canale è abilitato. Se attivi **Enable Email Subscribers** ma lasci disattivato **Show Subscriber Page**, i visitatori non hanno modo di raggiungere il modulo.

Gli stessi cinque interruttori compaiono una seconda volta nella scheda **Subscriber Settings** in **Advanced Settings**, insieme a **Show Subscriber Page**. Sono le stesse colonne sottostanti: scegli una schermata e resta su quella, preferendo la pagina dedicata **Subscriber Settings** dato che è lì che risiede il resto della configurazione degli iscritti.

## Cosa vede un visitatore sulla pagina Subscribe

La pagina **Subscribe** ha un sottomenu con una scheda per ogni canale abilitato — **Email**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — mappate su `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` e `/subscribe/webhooks`. Ogni scheda richiede il minimo indispensabile:

- **Email** — intestazione **Iscriviti via e-mail**, un campo **La tua e-mail** con il segnaposto `subscriber@company.com`.
- **SMS** — intestazione **Iscriviti via SMS**, un campo **Il tuo numero di telefono** con il segnaposto `+11234567890`.
- **Slack** — intestazione **Iscriviti via Slack**, con **Nome dell'area di lavoro Slack** (usato per la convalida) e **URL del webhook in entrata Slack**, segnaposto `https://hooks.slack.com/services/...`.
- **MS Teams** — intestazione **Iscriviti via Microsoft Teams**, con **Nome dell'area di lavoro Microsoft Teams** e **URL del webhook in entrata Microsoft Teams**, segnaposto `https://outlook.office.com/webhook/...`.
- **Webhooks** — intestazione **Iscriviti tramite webhook**, un campo **URL del webhook**. Ad ogni evento della pagina di stato viene inviata una richiesta JSON `POST`.

Il pulsante di invio recita **Iscriviti**, e un'iscrizione riuscita mostra *Iscrizione effettuata con successo.* La pagina presenta anche una suddivisione **Nuova iscrizione** / **Gestisci iscrizione esistente**, in modo che chi si è già iscritto possa tornare alle proprie preferenze senza doversi mettere a cercare una vecchia email.

## Lasciare che gli iscritti scelgano risorse e tipi di evento

Per impostazione predefinita un iscritto riceve tutto quello che è presente sulla pagina. Due interruttori nella scheda **Advanced Subscriber Settings** cambiano questo comportamento:

- **Allow Subscribers to Choose Resources** (`allowSubscribersToChooseResources`) — disattivato per impostazione predefinita. Attivalo e il modulo di iscrizione mostra un interruttore **Subscribe to All Resources**; disattivalo e compare **Select Resources to Subscribe** in modo che il visitatore possa scegliere singole risorse.
- **Allow Subscribers to Choose Event Types** (`allowSubscribersToChooseEventTypes`) — disattivato per impostazione predefinita. Stessa logica: un interruttore **Subscribe to All Event Types**, e **Select Event Types to Subscribe** sottostante quando è disattivato.

I tipi di evento sono `Incident`, `Announcement` ed `Scheduled Event`.

Le scelte finiscono nel record dell'iscritto come **Is Subscribed to All Resources** (`isSubscribedToAllResources`, predefinito true), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, predefinito true), **Subscribed to Resources** e **Subscribed to Event Types**.

Utile per: una pagina che copre più prodotti. Un cliente che usa solo la tua API non vuole una pagina ogni volta che il sito marketing vacilla — lascia che riduca l'elenco da solo piuttosto che vederlo disiscriversi del tutto.

La stessa scheda contiene anche **Subscriber Timezones**.

## Doppia conferma (double opt-in) per email

Gli iscritti via email confermano sempre. Quando un iscritto viene creato con un indirizzo email e non è già stato creato come confermato, **Is Subscription Confirmed** (`isSubscriptionConfirmed`) viene forzato a `false` e viene generato un **Subscription Confirmation Token** di sei cifre. OneUptime invia quindi via email un link di conferma nella forma `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. Il visitatore arriva su una pagina **Confirm Subscription** e, una volta completata, vede *Iscrizione confermata con successo*.

Gli iscritti SMS, Slack, Microsoft Teams e webhook saltano questo passaggio: vengono creati con `isSubscriptionConfirmed` già impostato a `true`.

**Non confermato significa silenzioso.** La query che recupera gli iscritti per una notifica filtra su `isUnsubscribed: false` e `isSubscriptionConfirmed: true`. Un indirizzo email che non ha mai cliccato sul link resterà nel tuo elenco **Email Subscribers** senza ricevere nulla. Se qualcuno giura di essere iscritto ma non riceve nulla, controlla prima questa colonna.

Non esiste un interruttore per disattivare la conferma email: è incondizionata per chiunque si iscriva tramite la pagina di stato. Una colonna separata per ogni iscritto, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, predefinito true), controlla l'email "ti sei iscritto" che viene inviata una volta che un iscritto è confermato.

## Gestire e annullare un'iscrizione

Ogni email inviata a un iscritto contiene un link di disiscrizione nella forma `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Quella pagina si intitola **Update Subscription** e informa il visitatore che può aggiornare le proprie preferenze o disiscriversi lì. Contiene:

- I selettori di risorse e tipi di evento che la pagina consente.
- Un interruttore **Unsubscribe**, descritto come disiscrizione da tutte le risorse. Scrive **Is Unsubscribed** (`isUnsubscribed`, predefinito false).
- Un pulsante di invio con testo **Update Subscription**; il salvataggio mostra *Le tue modifiche sono state salvate.*

Chi ha perso il link usa **Manage Existing Subscription** sulla pagina **Subscribe** e preme **Send Management Link**. OneUptime risponde che un'email con il link è stata inviata, e di controllare la cartella spam se non arriva.

Gli endpoint dietro tutto questo sono `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` e `PUT .../update-subscription/:statusPageId/:subscriberId`.

Disiscriversi imposta un flag anziché eliminare una riga, quindi il record rimane nell'elenco del canale con **Is Unsubscribed** impostato: utile quando devi spiegare in seguito perché un particolare indirizzo ha smesso di ricevere email.

## Di cosa vengono notificati gli iscritti

Gli iscritti ricevono notifiche sui tre tipi di evento sopra elencati, ma ogni sorgente ha il proprio interruttore, così nulla viene inviato per errore.

### Notifiche sugli annunci

L'annuncio stesso contiene **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), esposto nel modulo di creazione come casella **Notify Status Page Subscribers**, attiva per impostazione predefinita. Se l'annuncio indica dei monitor sotto **Monitors affected (Optional)**, la notifica è limitata a quei monitor; lasciando il campo vuoto, vengono notificati tutti gli iscritti.

### Eventi di manutenzione programmata

Un evento di manutenzione programmata ha il proprio set di colonne per gli iscritti: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, oltre a **Subscriber notifications before the event** e **Next subscriber notification before the event at?** per gli avvisi anticipati. **Status Pages** sull'evento decide su quali pagine compare, e **Should be visible on status page?** decide se compare affatto.

### Incidenti

`Incident` è il terzo tipo di evento. Cosa fa sì che un incidente raggiunga una pagina di stato in primo luogo — quali risorse tocca e quali stati lo mantengono visibile — è trattato in [Stati e gravità degli incidenti](/docs/incidents/states-and-severities).

La sezione **Notification Logs** nel menu laterale della pagina di stato (`{id}/notification-logs`) è dove andare quando devi vedere cosa la pagina ha effettivamente inviato.

## Personalizzare i modelli di notifica

La scheda **Notification Templates** in **Subscriber Settings** elenca i modelli usati da questa pagina di stato, con le colonne **Template Name**, **Event Type** e **Notification Method**, in modo da poter variare il testo per tipo di evento e per canale invece di accettare un unico messaggio predefinito per tutto.

I modelli a livello di progetto risiedono un livello più in alto, in **Status Pages → Settings → Subscriber Templates**, accanto a **Announcement Templates**.

## Piè di pagina email, SMTP personalizzato e Twilio

Altre tre schede in **Subscriber Settings** controllano come i messaggi per gli iscritti lasciano il tuo progetto:

- **Email Footer Settings** — **Enable Custom Email Footer Text** e **Subscriber Email Notification Footer Text** aggiungono un piè di pagina personalizzato alle email per gli iscritti.
- **Custom SMTP** — **Custom SMTP Config** invia le email per gli iscritti attraverso il tuo server di posta invece di quello predefinito.
- **Twilio Config** — **Twilio Config** è l'account Twilio usato per gli iscritti SMS.

Vale la pena configurare SMTP personalizzato fin da subito se hai iscritti email: la posta che arriva dal tuo stesso dominio ha molte meno probabilità di essere filtrata, e molte più probabilità di essere considerata affidabile dal cliente che la legge alle 2 del mattino.

## Annunci

Un annuncio è un record a livello di progetto (il modello `StatusPageAnnouncement`) che distribuisci a una o più pagine di stato, eventualmente limitato a monitor specifici, con una finestra temporale durante la quale viene mostrato.

Lo crei da **Status Pages → More → Announcements**, oppure da **Announcements** nel menu laterale di una singola pagina di stato. Il modulo di creazione è una procedura guidata a quattro passaggi:

1. **Basic Information** — **Announcement Title** (obbligatorio, almeno due caratteri), **Description** (Markdown, opzionale) e **Attachments** per i file che dovrebbero essere disponibili con l'annuncio sulla pagina di stato.
2. **Status Pages** — **Show announcement on these status pages**, una selezione multipla obbligatoria. Un annuncio può avere come destinazione più pagine contemporaneamente.
3. **Resources Affected** — **Monitors affected (Optional)**. Se non ne selezioni nessuno, vengono notificati tutti gli iscritti.
4. **Schedule & Settings** — **Start Showing Announcement At** (obbligatorio, predefinito ora), **End Showing Announcement At** (opzionale) e **Notify Status Page Subscribers** (attivo per impostazione predefinita).

I visitatori leggono gli annunci su `/announcements`, suddivisi in **Annunci attivi** e **Annunci passati**, ciascuno con il timbro **Annunciato il**. Gli annunci attualmente attivi vengono anche fissati in cima alla pagina panoramica. Quando non c'è nulla da mostrare, la pagina riporta *Nessun annuncio* con la nota che finora non ne sono stati pubblicati.

Gli allegati vengono serviti da `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, dietro lo stesso controllo di lettura della pagina di stato stessa, quindi un allegato su una pagina privata resta privato.

## Come funziona la pianificazione degli annunci

**Show At** (`showAnnouncementAt`) ed **End At** (`endAnnouncementAt`) guidano tutto, ma la pagina panoramica e l'elenco degli annunci pongono domande diverse, e la differenza trae in inganno.

- **La pagina panoramica** mostra un annuncio quando `showAnnouncementAt` è nel passato ed `endAnnouncementAt` è nel futuro oppure vuoto.
- **L'elenco `/announcements`** mostra gli annunci il cui `showAnnouncementAt` rientra in **Show Announcement History (in days)** (`showAnnouncementHistoryInDays`, predefinito 14), per poi suddividerli lato client in attivi e passati.

Due conseguenze da tenere presenti:

- **Un annuncio senza data di fine non scade mai.** Lascia vuoto **End Showing Announcement At** e resterà fissato indefinitamente sulla pagina panoramica. Imposta una data di fine per tutto ciò che è limitato nel tempo.
- **Un annuncio vecchio ma ancora attivo può sparire dall'elenco.** Se è iniziato più di `showAnnouncementHistoryInDays` giorni fa, scompare da `/announcements` pur restando sulla pagina panoramica. Aumenta la finestra di cronologia se mantieni avvisi di lunga durata.

Se gli annunci compaiono affatto è controllato dalla scheda **Announcement Settings** in **Advanced Settings**: **Show Announcements** (`showAnnouncementsOnStatusPage`, predefinito true) e **Show Announcement History (in days)** (predefinito 14). Con **Show Announcements** disattivato, l'endpoint degli annunci rifiuta direttamente la richiesta.

## Modelli di annuncio

Se pubblichi ripetutamente lo stesso tipo di avviso — un promemoria mensile di manutenzione, un degrado ricorrente di un provider terzo — precompilalo. **Status Pages → Settings → Announcement Templates** memorizza il modello `StatusPageAnnouncementTemplate`, e il suo modulo richiede **Template Name**, **Template Description**, **Announcement Title**, **Description**, **Show announcement on these status pages**, **Monitors affected (Optional)** e **Notify Subscribers**, in modo che la distribuzione e la decisione di notifica vengano prese una volta sola invece che ogni volta.

## Iscritti webhook e protezione SSRF

Gli iscritti webhook ricevono una richiesta JSON `POST` per ogni evento della pagina di stato, il che li rende il modo più semplice per incanalare gli aggiornamenti della pagina di stato in un sistema tuo — un chatbot, una dashboard interna, una coda di ticket.

Poiché iscriversi è un'operazione pubblica su una pagina pubblica, OneUptime protegge la destinazione:

- Un generico **URL del webhook** viene convalidato prima di essere accettato, e gli indirizzi privati, di loopback, link-local e di metadati cloud vengono rifiutati. Non puoi puntare un'iscrizione verso qualcosa all'interno della rete stessa del deployment di OneUptime.
- Un **URL del webhook in entrata Slack** deve iniziare con `https://hooks.slack.com/services/`.

Se un'iscrizione webhook viene rifiutata al momento della registrazione, la prima cosa da controllare è un URL interno o malformato.

## Dove leggere il prossimo

- [Panoramica delle pagine di stato](/docs/status-pages/index) — cos'è una pagina di stato e come è strutturata.
- [Risorse e gruppi della pagina di stato](/docs/status-pages/resources-and-groups) — i monitor e i gruppi tra cui gli iscritti possono scegliere.
- [Branding e domini della pagina di stato](/docs/status-pages/branding-and-domains) — domini personalizzati, loghi e l'aspetto della pagina a cui rimandano le tue email.
- [API pubblica](/docs/status-pages/public-api) — leggere i dati della pagina di stato in modo programmatico.
- [Stati e gravità degli incidenti](/docs/incidents/states-and-severities) — cosa porta un incidente su una pagina di stato e cosa lo rimuove.
- [Impostazioni e automazione degli incidenti](/docs/incidents/settings) — le regole a livello di progetto dietro la comunicazione degli incidenti.

# Il tuo account

Il tuo account è il modo in cui OneUptime ti conosce: l'e-mail e la password con cui accedi, il tuo nome, il tuo fuso orario e la tua lingua, e ciò che protegge il tuo accesso. Un account può appartenere a molti progetti, e queste impostazioni ti seguono in ognuno di essi. Come OneUptime ti raggiunge, e quando ti avvisa, si imposta in ogni progetto, in **Impostazioni utente**.

```mermaid title="Cosa appartiene al tuo account, e cosa conserva per te ogni progetto"
flowchart TB
    account["Il tuo account:<br/>accesso e profilo"] --> projectA["Progetto A"]
    account --> projectB["Progetto B"]
    projectA --> settingsA["Impostazioni utente in A:<br/>come vieni avvisato"]
    projectB --> settingsB["Impostazioni utente in B:<br/>come vieni avvisato"]
```

:::cards
- [Il tuo profilo](#il-tuo-profilo): Il tuo nome, la tua e-mail, il fuso orario, la lingua e la tua foto.
- [Accedere in sicurezza](#accedere-in-sicurezza): La password, i link di accesso, le passkey e l'autenticazione a due fattori.
- [I tuoi progetti](#i-tuoi-progetti): Cambiare progetto, crearne uno e accettare inviti.
- [Impostazioni utente](#cosa-conserva-per-te-ogni-progetto): Come OneUptime ti raggiunge in ogni progetto.
:::

## Il menu utente

Fai clic sulla tua foto in alto a destra nella dashboard.

| Voce | Cosa fa |
| --- | --- |
| **Profilo** | Apre **Profilo utente**: il tuo nome, la tua e-mail, il fuso orario, la lingua, la foto e la sicurezza dell'accesso. |
| **Impostazioni admin** | Apre l'Admin Dashboard. La vedono solo gli amministratori principali di un'installazione self-hosted. |
| **Tema** | Imposta il tema della dashboard: **Chiaro**, **Scuro** o **Sistema**, che è chiaro o scuro in base all'impostazione del tuo dispositivo. |
| **Esci** | Ti disconnette, subito su ogni server OneUptime. Dove il tuo amministratore l'ha configurato, ti disconnette anche dal tuo provider di identità. |

**Profilo utente** ha un proprio menu laterale. **Base** contiene **Panoramica** e **Immagine del profilo**. **Sicurezza** e **Zona pericolosa** sono compresse: fai clic sul titolo di una sezione per aprirla.

## Il tuo profilo

:::steps
### Aprire il tuo profilo

Fai clic sulla tua foto in alto a destra e scegli **Profilo**. La pagina **Panoramica** si apre sulla scheda **Informazioni di base**: il tuo nome, la tua e-mail, il tuo fuso orario e la tua lingua.

### Modificare i tuoi dati

Fai clic su **Modifica: Utente** e cambia ciò che ti serve:

- **E-mail**: l'indirizzo con cui accedi. Se lo cambi, OneUptime invia un link al nuovo indirizzo, e il tuo indirizzo cambia quando lo apri. Fino ad allora accedi con quello attuale, e **Annulla modifica** ferma la modifica. L'indirizzo di un amministratore principale cambia subito. Se il link scade, **Invia di nuovo il link** ne invia uno nuovo. Ogni volta che il tuo indirizzo cambia, OneUptime invia un'e-mail all'indirizzo che avevi.
- **Nome completo**: il nome che il tuo team vede in tutto OneUptime.
- **Fuso orario**: il fuso orario in cui la dashboard mostra e legge gli orari, e quello degli orari nelle notifiche che ti vengono inviate.
- **Lingua**: la lingua della dashboard in ogni browser in cui accedi, e quella delle tue chiamate di reperibilità. Se non è impostata, le chiamate sono in inglese e la dashboard segue il tuo browser.

Fai clic su **Salva modifiche**.

### Aggiungere una foto

Scegli **Immagine del profilo**, fai clic su **Update Profile Picture** e carica un'immagine. Compare nel tuo menu utente, e accanto al tuo nome negli elenchi di persone.
:::

> [!NOTE]
> La prima volta che accedi da un browser, OneUptime salva nel tuo profilo il fuso orario di quel browser. Se in seguito accedi dove il browser ha un fuso orario diverso, la dashboard ti chiede se vuoi **Aggiorna fuso orario**. Chiudi la domanda, e non te la riproporrà per quel fuso orario.

## Accedere in sicurezza

Espandi **Sicurezza** nel menu laterale di **Profilo utente**. Contiene tre pagine.

| Pagina | A cosa serve |
| --- | --- |
| **Gestione password** | Impostare una nuova password. |
| **Passkey** | Accedere senza password, con impronta digitale, volto, blocco schermo o una chiave di sicurezza. |
| **Autenticazione a due fattori** | Chiedere un secondo passaggio dopo la password o un link inviato via e-mail: un codice da un'app, o una chiave di sicurezza. |

### Cambiare la password

:::steps
1. Apri **Sicurezza → Gestione password**.
2. Inserisci la nuova password in **Nuova password** e di nuovo in **Conferma password**. Deve essere lunga almeno 15 caratteri e non essere prevedibile, come una password comune o una sequenza ripetuta: alcune parole senza legame tra loro funzionano bene. La checklist sotto il campo spunta ogni requisito mentre scrivi.
3. Fai clic su **Aggiorna password**.
:::

Una nuova password disconnette tutti i dispositivi dal tuo account, e qualsiasi link di reimpostazione o di accesso già inviato smette di funzionare.

Ogni pagina che imposta una password chiede lo stesso: la registrazione, il link di reimpostazione di **Password dimenticata?**, questa pagina e **Imposta password** di un amministratore del server. Una password impostata prima di questa regola continua a funzionare finché non la cambi.

### Aggiungere una passkey

:::steps
1. Apri **Sicurezza → Passkey** e fai clic su **Aggiungi passkey**.
2. Dalle un nome che riconoscerai, come il tuo dispositivo o il tuo gestore di password, e fai clic su **Crea passkey**.
3. Segui la richiesta del browser per salvare la passkey.
:::

La prossima volta, scegli **Altri modi per accedere** → **Accedi con una passkey** nella pagina di accesso.

### Accedere con un link inviato via e-mail

Puoi accedere con un link invece della password. Non c'è nulla da configurare.

:::steps
1. Nella pagina di accesso, scegli **Altri modi per accedere** → **Inviami un link di accesso**.
2. Inserisci il tuo indirizzo e-mail e fai clic su **Inviami un link di accesso**. La pagina mostra quindi **Controlla la tua e-mail**.
3. Apri il link nell'e-mail e fai clic su **Accedi**.
:::

Il link funziona una sola volta, per 15 minuti, e un link più recente lo sostituisce. Puoi aprirlo su un altro dispositivo, e l'accesso avviene lì. Se usi l'autenticazione a due fattori, OneUptime ti chiede comunque il secondo passaggio.

> [!NOTE]
> Gli amministratori principali di un'installazione self-hosted possono disattivare i link di accesso con **Consenti l'accesso con un link inviato via e-mail**, in **Admin Dashboard > Impostazioni > Autenticazione**. I link già inviati smettono quindi di funzionare. Finché il server richiede l'SSO, la pagina di accesso offre solo l'SSO.

### Attivare l'autenticazione a due fattori

L'autenticazione a due fattori si applica quando accedi con la tua password o con un link ricevuto via email. Si attiva solo quando il tuo secondo passaggio funziona, quindi non ti chiede mai un passaggio che non hai.

:::steps
### Scegliere il secondo passaggio

Apri **Sicurezza → Autenticazione a due fattori** e fai clic su **Attiva l'autenticazione a due fattori**. Scegli **App di autenticazione** o **Chiave di sicurezza** e fai clic su **Continua**.

### Configurarlo

Per un'app di autenticazione, scansiona il codice QR con un'app come 1Password, Google Authenticator o Microsoft Authenticator, inserisci il codice di 6 cifre che mostra e fai clic su **Verifica e completa**. Per una chiave USB o NFC, dalle un nome e segui le istruzioni del browser. L'autenticazione a due fattori è quindi attiva e la scheda mostra **Abilitato**. Dal tuo prossimo accesso con password o con un link via email, OneUptime ti chiede il secondo passaggio.

### Salvare i codici di backup

La prima volta che aggiungi un'app, una chiave o una passkey, OneUptime mostra **I tuoi codici di backup**. Ogni codice ti fa accedere una volta se perdi l'app o la chiave. Copiali o scaricali, spunta la casella che conferma di averli salvati e fai clic su **Fatto**.
:::

Se hai già un'app in **App di autenticazione** o una chiave in **Chiavi di sicurezza**, **Attiva l'autenticazione a due fattori** ti chiede solo di confermare. Finché è attiva, non puoi rimuovere l'ultima app, chiave o passkey: aggiungine prima un'altra, oppure disattiva l'autenticazione a due fattori. Se la scheda mostra **Configurazione necessaria**, l'autenticazione a due fattori è attiva ma non è ancora configurato nulla, spesso perché un amministratore l'ha richiesta: fai clic su **Completa la configurazione**, altrimenti ti verrà chiesto al prossimo accesso.

### Configurare l'autenticazione a due fattori durante l'accesso

Quando un amministratore richiede l'autenticazione a due fattori e non hai ancora configurato nulla, il tuo prossimo accesso con una password o con un link via email ti chiede di configurarla prima di farti entrare. Scegli **App di autenticazione** o **Chiave di sicurezza** e fai clic su **Continua**:

- **App di autenticazione**: scansiona il codice QR, inserisci il codice di 6 cifre che mostra la tua app e fai clic su **Verifica e accedi**.
- **Chiave di sicurezza**: fai clic su **Registra la chiave di sicurezza** e segui le istruzioni del browser. Tocca una chiave USB o NFC, oppure usa l'impronta digitale, il volto o il blocco schermo del tuo telefono o computer.

Se non hai ancora codici di backup, OneUptime te li mostra una sola volta, e hai effettuato l'accesso. **Scegli un altro metodo** torna alla scelta. Un browser che non può registrare una chiave di sicurezza, come uno su una pagina senza HTTPS, offre solo l'app di autenticazione.

> [!TIP]
> Ti restano pochi codici di backup? **Rigenera i codici** nella stessa pagina ti dà un nuovo set, e i vecchi codici smettono subito di funzionare.

### Quando la tua organizzazione gestisce il tuo accesso

Su un server che richiede il single sign-on, accedi solo tramite il provider di identità della tua organizzazione, come Okta o Microsoft Entra ID, e OneUptime non imposta per te password, passkey né autenticazione a due fattori. Il **Profilo utente** non ha quindi la sezione **Sicurezza**, e la sua **Panoramica** indica il tuo provider in **Single Sign-On**. Cambia la password e il secondo passaggio presso il tuo provider di identità. Quello che avevi configurato prima resta salvato: torna a funzionare solo se il server smette di richiedere il single sign-on, a meno che un amministratore del server non lo cancelli, e in quel caso ricevi un'email. Gli amministratori principali mantengono le proprie impostazioni di **Sicurezza**.

Lo stesso accade quando ogni progetto a cui appartieni richiede il single sign-on e ha attivo **Gestisci l'accesso con l'SSO**. La tua password ti fa ancora accedere a OneUptime, ma ogni progetto chiede l'SSO, quindi OneUptime non imposta per te nessuna nuova password, passkey o secondo passaggio:

- **Un progetto che non lo fa**: appena sei membro di un progetto, o vieni invitato in uno, che non richiede l'SSO o non ha attivo **Gestisci l'accesso con l'SSO**, la tua sezione **Sicurezza** torna. La **Panoramica** indica allora quei progetti in **Single Sign-On**, come motivo per cui le impostazioni sono tue. Lasciare quel progetto te le toglie di nuovo.
- **Progetti con provider diversi**: se tutti i tuoi progetti gestiscono l'accesso, ciascuno con il proprio provider di identità, la **Panoramica** indica ogni provider.
- **Gli amministratori principali** mantengono sempre le proprie impostazioni di **Sicurezza**.
- **Quello che avevi configurato prima** resta salvato. Può cancellarlo un amministratore del server, e anche un proprietario di tutti i progetti a cui appartieni; ricevi un'email quando lo fanno.

### Confermare che sei tu

Alcune modifiche ti chiedono prima di confermare che sei tu, anche se hai già effettuato l'accesso, così che nessuno possa farle da un browser in cui sei rimasto connesso. OneUptime lo chiede prima che tu:

- cambi il tuo indirizzo email o la tua password;
- aggiunga o rimuova una passkey, una chiave di sicurezza o un'app di autenticazione;
- ottenga nuovi codici di backup mentre ne hai ancora di inutilizzati;
- disattivi l'autenticazione a due fattori;
- elimini il tuo account.

La finestra **Conferma che sei tu** chiede la tua password e, finché l'autenticazione a due fattori è attiva, il tuo secondo passaggio: un codice dalla tua app di autenticazione, la tua chiave di sicurezza o uno dei tuoi codici di backup. Con una passkey, fai invece clic su **Usa una passkey**. Se accedi solo con il single sign-on, Google o Microsoft, fai clic su **Accedi di nuovo**: OneUptime fa sì che il tuo provider di identità ti chieda di accedere di nuovo, poi ti riporta alla pagina. A quel punto la modifica viene applicata. Se accedi solo con Vercel, che non può confermare che sei tu, scegli invece **Accedi in un altro modo** e accedi con un link che ti inviamo via email.

Dopo la conferma, non ti viene chiesto di nuovo per 10 minuti in quel browser. Cinque tentativi sbagliati disconnettono quel browser, ma non bloccano mai il tuo account: accedi di nuovo e riprova. OneUptime ti invia un'email quando succede, e ogni volta che un codice di backup conferma che sei tu.

Su un server self-hosted, gli amministratori principali confermano allo stesso modo che sono loro prima di cambiare il modo in cui un'altra persona accede, eliminare l'account di un'altra persona, rendere qualcuno amministratore principale, cambiare i provider di single sign-on o le impostazioni email del server, o creare una chiave API master o riattivarla. La chiave API master non può fare queste modifiche.

Il nuovo accesso conta solo se il tuo provider di identità dice che hai effettuato l'accesso dopo che OneUptime ti ci ha mandato. Se il provider ti fa accedere con una sessione che ha già, senza chiederti la password, non conferma nulla: esci prima dal provider, poi fai clic su **Accedi di nuovo**. Dove il tuo server consente di accedere con un link inviato via email, **Accedi in un altro modo** fa questo al suo posto. Cosa chiede OneUptime a ciascun provider, e cosa può cambiare un amministratore quando il nuovo accesso non conferma nulla:

| Provider | Cosa chiede OneUptime | Quando non conferma nulla |
| --- | --- | --- |
| SAML | `ForceAuthn="true"` e il momento in cui hai effettuato l'accesso (`AuthnInstant`) | Fai rispettare la richiesta al provider, ad esempio con Honor Force Authentication in Okta. |
| OpenID Connect | `prompt=login` e `max_age=0` (Microsoft Entra ID: solo `prompt=login`), e il momento in cui hai effettuato l'accesso (`auth_time`) | Fai inviare `auth_time` dal provider. In Microsoft Entra ID, aggiungilo al token ID come attestazione facoltativa. |
| Google | Il momento in cui hai effettuato l'accesso (`auth_time`). A Google non si può chiedere di farti accedere di nuovo. | Attiva Session age claims per l'app di accesso Google del server, che deve essere pubblicata e verificata. |
| Microsoft | `prompt=login`, e il momento in cui hai effettuato l'accesso (`auth_time`) | Aggiungi `auth_time` al token ID dell'app di accesso Microsoft del server come attestazione facoltativa. |
| Vercel | Niente: a Vercel non si può chiedere di farti accedere di nuovo, e non dice quando hai effettuato l'accesso. | Non conferma mai. Scegli **Accedi in un altro modo** e accedi con un link che ti inviamo via email, oppure imposta una password con **Password dimenticata?** e conferma con quella. |

Cosa impostare in Okta, Microsoft Entra ID, Keycloak e Google Workspace è spiegato nella pagina [SSO](/docs/identity/sso#accedere-di-nuovo-per-confermare-che-sei-tu).

## I tuoi progetti

Puoi appartenere a quanti progetti vuoi. Il selettore di progetti in alto a sinistra nella dashboard li elenca: scegline uno per passarci.

- **Creare un progetto**: apri il selettore di progetti e fai clic su **Crea nuovo progetto**. In un'installazione self-hosted, l'amministratore può riservare la creazione dei progetti agli amministratori.
- **Accettare un invito**: quando qualcuno ti invita, la campanella in alto a destra mostra l'invito in sospeso e apre **Inviti al progetto**. Lì puoi scegliere **Accetta** o **Rifiuta**.
- **Lasciare un progetto**: chiedi a chi gestisce gli utenti del progetto di rimuoverti, con **Rimuovi dal progetto** nella sua pagina **Utenti**.

## Cosa conserva per te ogni progetto

Le **Impostazioni utente**, a destra nella barra sotto la barra superiore, sono solo tue, e ogni progetto ha le sue. Aprile in ogni progetto in cui sei reperibile. Si aprono su **Elenco di configurazione** finché resta qualcosa da configurare, e su **Metodi di notifica** quando non manca più nulla di essenziale.

| Pagina | A cosa serve | Per saperne di più |
| --- | --- | --- |
| **Elenco di configurazione** | Ti guida in tutto ciò che segue, e mostra cosa resta da fare. | |
| **Metodi di notifica** | Le e-mail, i numeri di telefono, le app e i webhook con cui OneUptime può raggiungerti. La tua e-mail di accesso viene aggiunta per te. | |
| **Come contattarmi** | Quale metodo usare, e dopo quanto tempo, quando una policy di reperibilità ti avvisa. | [Regole di escalation](/docs/on-call/escalation-rules) |
| **Impostazioni notifiche** | Quali aggiornamenti ricevi su incidenti, avvisi, monitor e altro, e su quale canale. | |
| **Preferenze e-mail** | Quante e-mail ricevi: una alla volta, o raggruppate. | [Riepilogo delle notifiche](/docs/emails/notification-rollup) |
| **Log di reperibilità** | Ogni avviso inviato a te, e cosa ne è stato. | |
| **Numeri di telefono in entrata** | Il numero su cui ti chiama una politica di chiamate in arrivo. | [Politica chiamate in arrivo](/docs/on-call/incoming-call-policy) |
| **Feed calendario** | I tuoi turni di reperibilità in Google Calendar, Apple Calendar o Outlook. | [Feed calendario](/docs/on-call/calendar-feeds) |

## Lingua e tema

Il tuo tema viene salvato nel tuo browser: impostalo di nuovo su un altro browser o dispositivo. La tua lingua viene salvata nel tuo account appena la scegli, e ogni browser in cui accedi parte in quella lingua. Restano anche quando esci, quindi su un computer condiviso la persona successiva parte dalle tue impostazioni.

- **Lingua**: la dashboard parte nella lingua del tuo browser. Per cambiarla, usa il menu delle lingue in fondo a ogni pagina. La tua scelta viene salvata nel tuo account, come **Lingua** nel tuo profilo, e OneUptime scrive in quella lingua le tue chiamate di reperibilità. Vedi [La lingua delle tue chiamate](/docs/notifications/index#la-lingua-delle-vostre-chiamate). Questa documentazione ha un proprio menu delle lingue, in alto.
- **Tema**: scegli **Chiaro**, **Scuro** o **Sistema** nel menu utente. **Sistema** è chiaro o scuro in base all'impostazione del tuo dispositivo, e cambia con essa; ogni browser parte da qui. Le pagine di accesso usano lo stesso tema.

## Eliminare il tuo account

Apri **Zona pericolosa → Elimina account**. Puoi eliminare il tuo account solo quando non fai più parte di alcun progetto: la pagina elenca i progetti in cui sei ancora. Lasciali prima, poi fai clic su **Elimina account** e conferma. L'eliminazione dell'account è definitiva e non si può annullare. Prima di eliminare il tuo account, OneUptime ti chiede di confermare che sei tu.

## Risoluzione dei problemi

:::details Non ho ricevuto l'e-mail per verificare il mio indirizzo
Accedere di nuovo invia un nuovo link: controlla anche la cartella dello spam. Se non riesci ad accedere, usa **Password dimenticata?** nella pagina di accesso. Il suo link di reimpostazione verifica anche il tuo indirizzo.
:::

:::details La registrazione mi ha inviato un'e-mail che dice che ho già un account
Quell'indirizzo ha già un account OneUptime, quindi la registrazione non ha creato né cambiato nulla. Accedi con quello, oppure usa **Password dimenticata?** nella pagina di accesso se non ricordi la password. La pagina di registrazione dice lo stesso per ogni indirizzo, quindi non rivela a nessuno quali indirizzi hanno un account.
:::

:::details Il mio indirizzo e-mail non è cambiato
Il tuo indirizzo cambia solo quando apri il link che OneUptime ha inviato al nuovo indirizzo. Il link funziona per 24 ore: una volta scaduto, il tuo profilo lo indica, e **Invia di nuovo il link** ne invia uno nuovo. Se un altro account usa già quell'indirizzo, l'e-mail inviata lì lo dice, e il tuo indirizzo resta com'è.
:::

:::details Ho ricevuto un'e-mail che dice che il mio indirizzo e-mail è stato cambiato
OneUptime invia un'e-mail all'indirizzo che aveva il tuo account ogni volta che l'indirizzo cambia: quando apri il link inviato a un nuovo indirizzo, quando un amministratore del server lo cambia o quando lo cambia il provider di identità della tua organizzazione. Se la modifica l'hai fatta tu, non devi fare nulla. Altrimenti, qualcuno che poteva accedere al tuo account lo ha spostato su un proprio indirizzo: dal tuo vecchio indirizzo, contatta l'amministratore del tuo server o, su OneUptime Cloud, support@oneuptime.com, che possono ripristinarlo. L'e-mail mostra solo una parte del nuovo indirizzo e non contiene alcun link per annullare la modifica: un link del genere funzionerebbe per chiunque legga la tua vecchia casella di posta.
:::

:::details Ho perso la mia app di autenticazione
Al secondo passaggio dell'accesso, scegli **Hai perso l'accesso alla tua app di autenticazione?** e inserisci uno dei tuoi codici di backup. Poi apri **Sicurezza → Autenticazione a due fattori** e aggiungi la nuova app. Senza codici di backup, chiedi a un amministratore della tua installazione di OneUptime di reimpostare l'autenticazione a due fattori del tuo account.
:::

:::details L'accesso mi chiede di aspettare prima di provare un altro codice
Dopo cinque codici sbagliati di fila, ogni codice successivo attende prima di essere controllato: un minuto, poi due, poi quattro e così via, fino a un'ora. OneUptime conta i codici sbagliati del tuo account da qualunque luogo vengano inseriti, ti invia un'e-mail quando iniziano le attese e ricomincia a contare quando inserisci un codice giusto. Aspetta e riprova, accedi con una chiave di sicurezza, oppure scegli **Hai perso l'accesso alla tua app di autenticazione?** e inserisci un codice di backup. Se non hai inserito tu quei codici, qualcuno conosce la tua password o può leggere la tua e-mail, e l'e-mail inviata da OneUptime ti dice quale delle due cose. Se quella persona può leggere la tua e-mail, prima cambia la password del tuo account e-mail e rimuovi qualsiasi inoltro che non hai impostato tu: una nuova password di OneUptime da sola non le impedisce di chiedere un altro link di accesso. Poi reimposta la tua password con **Password dimenticata?** nella pagina di accesso, il che pone fine all'attesa e a qualsiasi link di accesso già inviato.
:::

:::details Gli orari nella dashboard sono sfasati di un'ora
La dashboard mostra gli orari nel **Fuso orario** del tuo profilo, non in quello del tuo computer. Controllalo in **Profilo utente → Panoramica**.
:::

## Passaggi successivi

:::cards
- [Home page e scorciatoie](/docs/introduction/home): Orientarsi nella dashboard.
- [Regole di escalation](/docs/on-call/escalation-rules): Come ti avvisa una policy di reperibilità.
- [Utenti, team e autorizzazioni](/docs/permissions/index): Cosa decide ciò che puoi fare in un progetto.
- [SSO](/docs/identity/sso): Accedere tramite il provider di identità della tua azienda.
:::

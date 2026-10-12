# Il tuo account

Il tuo account è il modo in cui OneUptime ti conosce: l'e-mail e la password con cui accedi, il tuo nome e il tuo fuso orario, e ciò che protegge il tuo accesso. Un account può appartenere a molti progetti, e queste impostazioni ti seguono in ognuno di essi. Come OneUptime ti raggiunge, e quando ti avvisa, si imposta in ogni progetto, in **Impostazioni utente**.

```mermaid title="Cosa appartiene al tuo account, e cosa conserva per te ogni progetto"
flowchart TB
    account["Il tuo account:<br/>accesso e profilo"] --> projectA["Progetto A"]
    account --> projectB["Progetto B"]
    projectA --> settingsA["Impostazioni utente in A:<br/>come vieni avvisato"]
    projectB --> settingsB["Impostazioni utente in B:<br/>come vieni avvisato"]
```

:::cards
- [Il tuo profilo](#il-tuo-profilo): Il tuo nome, la tua e-mail, il fuso orario e la tua foto.
- [Accedere in sicurezza](#accedere-in-sicurezza): La password, le passkey e l'autenticazione a due fattori.
- [I tuoi progetti](#i-tuoi-progetti): Cambiare progetto, crearne uno e accettare inviti.
- [Impostazioni utente](#cosa-conserva-per-te-ogni-progetto): Come OneUptime ti raggiunge in ogni progetto.
:::

## Il menu utente

Fai clic sulla tua foto in alto a destra nella dashboard.

| Voce | Cosa fa |
| --- | --- |
| **Profilo** | Apre **Profilo utente**: il tuo nome, la tua e-mail, il fuso orario, la foto e la sicurezza dell'accesso. |
| **Impostazioni admin** | Apre l'Admin Dashboard. La vedono solo gli amministratori principali di un'installazione self-hosted. |
| **Tema scuro** | Passa la dashboard al tema scuro. Con il tema scuro, la voce diventa **Tema chiaro**. |
| **Esci** | Ti disconnette. |

**Profilo utente** ha un proprio menu laterale. **Base** contiene **Panoramica** e **Immagine del profilo**. **Sicurezza** e **Zona pericolosa** sono compresse: fai clic sul titolo di una sezione per aprirla.

## Il tuo profilo

:::steps
### Aprire il tuo profilo

Fai clic sulla tua foto in alto a destra e scegli **Profilo**. La pagina **Panoramica** si apre sulla scheda **Informazioni di base**: il tuo nome, la tua e-mail e il tuo fuso orario.

### Modificare i tuoi dati

Fai clic su **Modifica: Utente** e cambia ciò che ti serve:

- **E-mail**: l'indirizzo con cui accedi. Se lo cambi, verifichi di nuovo il nuovo indirizzo.
- **Nome completo**: il nome che il tuo team vede in tutto OneUptime.
- **Fuso orario**: il fuso orario in cui la dashboard mostra e legge gli orari, e quello degli orari nelle notifiche che ti vengono inviate.

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
| **Passkeys** | Accedere senza password, con impronta digitale, volto, blocco schermo o una chiave di sicurezza. |
| **Two-factor authentication** | Chiedere un secondo passaggio dopo la password: un codice da un'app, o una chiave di sicurezza. |

### Cambiare la password

:::steps
1. Apri **Sicurezza → Gestione password**.
2. Inserisci la nuova password in **Password** e di nuovo in **Conferma password**. Deve essere lunga almeno 6 caratteri.
3. Fai clic su **Aggiorna password**.
:::

### Aggiungere una passkey

:::steps
1. Apri **Sicurezza → Passkeys** e fai clic su **Add Passkey**.
2. Dalle un nome che riconoscerai, come il tuo dispositivo o il tuo gestore di password, e fai clic su **Create Passkey**.
3. Segui la richiesta del browser per salvare la passkey.
:::

La prossima volta, scegli **Accedi con una passkey** nella pagina di accesso.

### Attivare l'autenticazione a due fattori

L'autenticazione a due fattori si applica quando accedi con la password. Aggiungi prima un secondo passaggio, poi attivala.

:::steps
### Aggiungere un'app di autenticazione

Apri **Sicurezza → Two-factor authentication**. In **Authenticator apps**, aggiungi un'app e dalle un nome. Scansiona il codice QR con un'app come 1Password, Google Authenticator o Microsoft Authenticator, inserisci il codice a 6 cifre che mostra e fai clic su **Verify and finish**. Per usare invece una chiave USB o NFC, aggiungila in **Security keys**.

### Salvare i codici di backup

La prima volta che aggiungi un'app, una chiave o una passkey, OneUptime mostra **Your backup codes**. Ogni codice ti fa accedere una volta se perdi l'app o la chiave. Copiali o scaricali, spunta la casella che conferma di averli salvati e fai clic su **Fatto**.

### Attivarla

In cima alla pagina, fai clic su **Enable two-factor authentication** e conferma. La scheda ora mostra **Abilitato**. Dal prossimo accesso con password, OneUptime ti chiede il secondo passaggio.
:::

> [!TIP]
> Ti restano pochi codici di backup? **Regenerate codes** nella stessa pagina ti dà un nuovo set, e i vecchi codici smettono subito di funzionare.

## I tuoi progetti

Puoi appartenere a quanti progetti vuoi. Il selettore di progetti in alto a sinistra nella dashboard li elenca: scegline uno per passarci.

- **Creare un progetto**: apri il selettore di progetti e fai clic su **Crea nuovo progetto**. In un'installazione self-hosted, l'amministratore può riservare la creazione dei progetti agli amministratori.
- **Accettare un invito**: quando qualcuno ti invita, la campanella in alto a destra mostra l'invito in sospeso e apre **Inviti al progetto**. Lì puoi scegliere **Accetta** o **Reject**.
- **Lasciare un progetto**: chiedi a chi gestisce gli utenti del progetto di rimuoverti, con **Rimuovi dal progetto** nella sua pagina **Utenti**.

## Cosa conserva per te ogni progetto

Le **Impostazioni utente**, a destra nella barra sotto la barra superiore, sono solo tue, e ogni progetto ha le sue. Aprile in ogni progetto in cui sei reperibile.

| Pagina | A cosa serve | Per saperne di più |
| --- | --- | --- |
| **Elenco di configurazione** | Ti guida in tutto ciò che segue, e mostra cosa resta da fare. | |
| **Metodi di notifica** | Le e-mail, i numeri di telefono, le app e i webhook con cui OneUptime può raggiungerti. La tua e-mail di accesso viene aggiunta per te. | |
| **Regole di reperibilità** | Quale metodo usare, e dopo quanto tempo, quando una policy di reperibilità ti avvisa. | [Regole di escalation](/docs/on-call/escalation-rules) |
| **Impostazioni notifiche** | Quali aggiornamenti ricevi su incidenti, avvisi, monitor e altro, e su quale canale. | |
| **Preferenze e-mail** | Quante e-mail ricevi: una alla volta, o raggruppate. | [Riepilogo delle notifiche](/docs/emails/notification-rollup) |
| **Registri di reperibilità** | Ogni avviso inviato a te, e cosa ne è stato. | |
| **Numeri di telefono in entrata** | Il numero su cui ti chiama una politica di chiamate in arrivo. | [Politica chiamate in arrivo](/docs/on-call/incoming-call-policy) |
| **Feed calendario** | I tuoi turni di reperibilità in Google Calendar, Apple Calendar o Outlook. | [Feed calendario](/docs/on-call/calendar-feeds) |

## Lingua e tema

Entrambi vengono salvati nel tuo browser, non nel tuo account: impostali di nuovo su un altro browser o dispositivo.

- **Lingua**: la dashboard parte nella lingua del tuo browser. Per cambiarla, usa il menu delle lingue in fondo a ogni pagina. Questa documentazione ha un proprio menu delle lingue, in alto.
- **Tema**: scegli **Tema scuro** nel menu utente. La dashboard parte con il tema chiaro.

## Eliminare il tuo account

Apri **Zona pericolosa → Elimina account**. Puoi eliminare il tuo account solo quando non fai più parte di alcun progetto: la pagina elenca i progetti in cui sei ancora. Lasciali prima, poi fai clic su **Elimina account** e conferma. L'eliminazione dell'account è definitiva e non si può annullare.

## Risoluzione dei problemi

:::details Non ho ricevuto l'e-mail per verificare il mio indirizzo
Accedere di nuovo invia un nuovo link: controlla anche la cartella dello spam. Se non riesci ad accedere, usa **Password dimenticata?** nella pagina di accesso. Il suo link di reimpostazione verifica anche il tuo indirizzo.
:::

:::details Ho perso la mia app di autenticazione
Al secondo passaggio dell'accesso, scegli **Hai perso l'accesso alla tua app di autenticazione?** e inserisci uno dei tuoi codici di backup. Poi apri **Sicurezza → Two-factor authentication** e aggiungi la nuova app. Senza codici di backup, chiedi a un amministratore della tua installazione di OneUptime di reimpostare l'autenticazione a due fattori del tuo account.
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

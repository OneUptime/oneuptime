# Installazione Windows

La dashboard di OneUptime si installa su Windows come app, da Microsoft Edge o Google Chrome. Si apre in una finestra tutta sua, con la sua icona nella barra delle applicazioni e nel menu Start, e può mostrare notifiche. Non c'è niente da scaricare: l'app è la dashboard del tuo OneUptime, ed è aggiornata non appena lo è il tuo OneUptime.

:::cards
- [Installare l'app](#installare-lapp): Da Edge o Chrome, in pochi clic.
- [Aggiungerla alla barra e avviarla con Windows](#aggiungerla-alla-barra-e-avviarla-con-windows): Tenerla a un clic.
- [Ricevere notifiche su questo computer](#ricevere-notifiche-su-questo-computer): Registrare il browser per le notifiche push.
- [Risoluzione dei problemi](#risoluzione-dei-problemi): Nessuna icona di installazione, nessuna notifica, nuovo accesso.
:::

## Come funziona l'app desktop

```mermaid title="Cosa ti dà installare la dashboard"
flowchart TB
    Browser["Edge o Chrome apre<br/>la tua dashboard"]
    Install["La installi<br/>come app"]
    App["OneUptime in una<br/>finestra sua, nella<br/>barra delle applicazioni<br/>e nel menu Start"]
    OneUptime["Il tuo OneUptime serve<br/>la dashboard"]
    Browser --> Install --> App
    App -->|"carica la dashboard<br/>a ogni apertura"| OneUptime
```

L'app installata condivide con il suo browser l'accesso, le impostazioni e il permesso per le notifiche. Chiudi il browser e l'app continua a funzionare nella sua finestra.

## Prima di iniziare

- Windows 10 o Windows 11, con un Microsoft Edge o Google Chrome recente.
- L'indirizzo del tuo OneUptime, in HTTPS: `https://oneuptime.com` su OneUptime Cloud, o il tuo, ad esempio `https://oneuptime.example.com`.
- Un account con cui accedere alla dashboard.

## Installare l'app

:::tabs
@tab Edge
1. Apri il tuo OneUptime in Edge e accedi.
2. In qualsiasi pagina della dashboard, fai clic sull'icona di installazione a destra della barra degli indirizzi, poi su **Installa**. Oppure apri **Impostazioni e altro (…) → Altri strumenti → App → Installa questo sito come app**.
3. Edge apre OneUptime in una finestra sua, e può proporti di aggiungerlo alla barra delle applicazioni o a Start.
@tab Chrome
1. Apri il tuo OneUptime in Chrome e accedi.
2. In qualsiasi pagina della dashboard, fai clic sull'icona di installazione a destra della barra degli indirizzi, poi su **Installa**. Oppure apri **⋮ → Trasmetti, salva e condividi → Installa pagina come app…**.
3. Chrome apre OneUptime in una finestra sua e lo aggiunge al menu Start.
:::

Installa da una pagina della dashboard, dopo aver effettuato l'accesso: la pagina di accesso non è l'app. Cerca OneUptime nel menu Start per aprirla in seguito.

## Aggiungerla alla barra e avviarla con Windows

- **Barra delle applicazioni.** Con l'app aperta, fai clic con il tasto destro sulla sua icona nella barra delle applicazioni e scegli **Aggiungi alla barra delle applicazioni**.
- **Avvio con Windows.** In Edge, apri `edge://apps`, scegli **Dettagli** su OneUptime e attiva **Avvio automatico all'accesso al dispositivo**. La stessa pagina aggiunge l'app alla barra delle applicazioni o a Start, o crea un collegamento sul desktop.

## Ricevere notifiche su questo computer

L'app mostra notifiche tramite il suo browser, una volta che hai registrato il browser per le notifiche push in ogni progetto da cui vuoi riceverle.

:::steps
### Aprire i tuoi dispositivi push
Nell'app, apri **Impostazioni utente → Metodi di notifica** e la scheda **Push Notifications**.

### Registrare questo browser
Fai clic su **Registra dispositivo**, mantieni il valore proposto in **Nome del dispositivo**, ad esempio `Edge on Windows`, o modificalo, e fai di nuovo clic su **Registra dispositivo**. Quando il browser chiede se OneUptime può mostrare notifiche, scegli **Consenti**.

### Inviare un test
Nella finestra di dialogo **Browser Registered**, fai clic su **Send Test Notification**. Se non compare nulla, guarda le impostazioni di notifica di Windows: vedi [Risoluzione dei problemi](#risoluzione-dei-problemi).
:::

Un browser non suona più forte di quanto Windows gli permetta: non può superare Non disturbare. Per gli avvisi che devono svegliarti, usa l'app mobile con gli avvisi critici: vedi [Installazione Android](/docs/mobile-desktop-apps/android-installation#suonare-in-modalità-silenziosa) o [Installazione iOS](/docs/mobile-desktop-apps/ios-installation#suonare-in-modalità-silenziosa).

Su un OneUptime self-hosted, le notifiche del browser richiedono le chiavi VAPID del server: vedi [Notifiche push](/docs/self-hosted/push-notifications#configurazione-self-hosted).

## Aggiornamenti

Non c'è niente da aggiornare. L'app carica la dashboard dal tuo OneUptime a ogni apertura, quindi cambia quando il tuo OneUptime viene aggiornato. Se una finestra è aperta dall'aggiornamento, ricaricala con Ctrl+R.

## Disinstallare

:::tabs
@tab Edge
Apri `edge://apps`, scegli **Dettagli** su OneUptime, poi **Disinstalla**.
@tab Chrome
Nella finestra dell'app, apri il menu **⋮**, scegli la voce che disinstalla l'app, poi **Rimuovi**.
:::

Windows elenca l'app anche in **Impostazioni → App → App installate**, dove **Disinstalla** la rimuove a sua volta.

Disinstallare l'app non annulla la registrazione del suo browser: continua a ricevere notifiche. Per fermarle, elimina il browser in **Impostazioni utente → Metodi di notifica**, nella scheda **Push Notifications**, con **Elimina**.

## Risoluzione dei problemi

:::details Nessuna icona di installazione nella barra degli indirizzi
Apri una pagina della dashboard dopo l'accesso, non la pagina di accesso, e controlla che l'indirizzo inizi con `https://`: i browser installano app solo da siti sicuri. Se l'icona ancora non compare, usa il menu del browser come sopra. Altri browser potrebbero non installare siti come app; usa Edge o Chrome.
:::

:::details Non compare nessuna notifica
- In **Impostazioni utente → Metodi di notifica**, scheda **Push Notifications**, controlla che questo browser sia elencato, e inviagli una **Notifica di test**.
- In Windows, apri **Impostazioni → Sistema → Notifiche**: le notifiche devono essere attive, anche per il browser, e Non disturbare disattivato. Windows 10 chiama la pagina «Notifiche e azioni».
- Se il browser blocca le notifiche per OneUptime, fai clic sull'icona a sinistra della barra degli indirizzi, consenti le notifiche per il sito e registra di nuovo il browser.
- Su un OneUptime self-hosted, la finestra di dialogo **Registra dispositivo** indica quando il server non ha le chiavi VAPID.
:::

:::details L'app ti chiede di accedere di nuovo
L'app condivide l'accesso del suo browser. Uscire nel browser, o cancellarne i cookie, disconnette anche l'app.
:::

## Passi successivi

:::cards
- [Installazione macOS](/docs/mobile-desktop-apps/macos-installation): La stessa app su un Mac.
- [Installazione Android](/docs/mobile-desktop-apps/android-installation): Ricevere gli avvisi sul telefono.
- [FAQ e risoluzione dei problemi](/docs/mobile-desktop-apps/faq-troubleshooting): Risposte su entrambe le app.
- [Il tuo account](/docs/introduction/your-account): Come OneUptime ti raggiunge in ogni progetto.
:::

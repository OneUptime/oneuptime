# FAQ e risoluzione dei problemi

Risposte alle domande frequenti sulle app mobile e desktop di OneUptime, e soluzioni a ciò che va storto più spesso: l'accesso, le notifiche che non arrivano e un telefono che deve registrarsi di nuovo.

:::cards
- [Domande sull'app mobile](#domande-sullapp-mobile): Dispositivi, progetti, self-hosting e sicurezza.
- [Domande sull'app desktop](#domande-sullapp-desktop): Che cos'è l'app desktop, e cosa non può fare.
- [Quando un telefono deve registrarsi di nuovo](#quando-un-telefono-deve-registrarsi-di-nuovo): Perché un telefono smette di ricevere avvisi, e come torna.
- [Risoluzione dei problemi](#risoluzione-dei-problemi): Problemi di accesso, notifiche e installazione.
:::

## Domande sull'app mobile

:::details L'app è gratuita?
Sì. OneUptime On-Call è gratuita nell'App Store, su Google Play e come APK su GitHub. Accedi con il tuo account OneUptime.
:::

:::details Su quali telefoni e tablet funziona?
Su iPhone e iPad con iOS o iPadOS 16.4 o successivo, e su telefoni e tablet Android con Android 7.0 o successivo.
:::

:::details Funziona con un OneUptime self-hosted?
Sì. Inserisci l'indirizzo `https://` del tuo OneUptime all'avvio dell'app, oppure tocca **Change Server** nella schermata di accesso. Per impostazione predefinita il tuo server invia gli avvisi ai telefoni tramite il relay push di OneUptime, quindi non gli serve alcun account Apple, Google o Expo: vedi [Notifiche push](/docs/self-hosted/push-notifications).
:::

:::details Posso usarla con più progetti?
Sì. L'app registra il telefono in ogni progetto di cui fai parte, così ogni progetto può avvisarti. Mostra un progetto alla volta: tocca il nome del progetto in cima a una schermata per cambiarlo.
:::

:::details Posso accedere su più di un telefono?
Sì. Ogni telefono o tablet è un dispositivo push a sé, con le sue regole di reperibilità e la sua impostazione degli avvisi critici.
:::

:::details Cosa posso fare nell'app?
- **Home**: ciò che richiede attenzione nel progetto: incidenti e avvisi attivi, casi di sicurezza aperti se il tuo ruolo ti permette di vederli, monitor con problemi ed eventi raggruppati.
- **Monitors**: tutti i monitor, filtrati per stato, con i loro dettagli.
- **Inbox**: incidenti e avvisi, e gli episodi che li raggruppano. Aprine uno per usare **Acknowledge**, **Resolve** o **Add Note**. Se il tuo ruolo ti permette di vedere i casi di sicurezza del progetto, **Security** elenca quelli aperti: aprine uno per usare **Approve** o **Reject** su un passo di playbook in attesa di approvazione, prendere in carico il caso con **Assign to me** o usare **Close case**.
- **On-Call**: se sei reperibile e fino a quando, chi altro lo è, gli avvisi inviati a te, e **Cover for me**, che passa i tuoi avvisi a un collega per un po'.
- **Settings**: i tuoi progetti e il single sign-on, l'aspetto, gli avvisi critici e il suono di allarme, **Biometrics Login**, il tuo feed di calendario della reperibilità, e **Log Out**.

Tutto il resto è nella dashboard.
:::

:::details Posso confermare un avviso dalla notifica?
No. Tocca la notifica: l'app apre l'incidente, l'avviso, l'episodio o il caso di sicurezza a cui si riferisce, nel progetto giusto, e lo confermi lì. Se l'app è bloccata o non hai effettuato l'accesso, apre l'avviso appena entri.
:::

:::details Il mio accesso è al sicuro sul telefono?
L'app parla con il tuo OneUptime solo in HTTPS. Il tuo accesso è conservato nella memoria propria dell'app sul telefono, e **Log Out** lo cancella e chiude anche la sessione sul server. Attiva **Biometrics Login** perché l'app ti chieda volto, impronta o codice a ogni avvio.
:::

:::details L'app funziona offline?
No. Senza connessione mostra **No internet connection** in cima allo schermo, e riprende appena la connessione torna.
:::

## Domande sull'app desktop

:::details Che cos'è l'app desktop?
La dashboard di OneUptime, installata dal tuo browser come app: una finestra sua, un'icona nel menu Start, nel Dock o nel tuo launcher, e le notifiche. Fa tutto quello che fa la dashboard, perché è la dashboard.
:::

:::details Perché non è in nessuno store?
Non le serve. L'app carica la dashboard dal tuo OneUptime a ogni apertura, quindi è sempre la versione che esegue il tuo OneUptime, su Windows, macOS e Linux allo stesso modo, senza niente da aggiornare.
:::

:::details Può svegliarmi come il telefono?
No. I browser non possono superare Non disturbare o una modalità Full immersion, quindi una notifica desktop non è più forte di quanto il computer permetta. Per gli avvisi che devono svegliarti, usa l'app mobile con gli avvisi critici.
:::

:::details Funziona offline?
No. Ha bisogno di una connessione al tuo OneUptime, come la dashboard in una scheda del browser.
:::

## Quando un telefono deve registrarsi di nuovo

OneUptime invia gli avvisi di un telefono tramite Expo, che li passa ad Apple o Google. Quando Expo dice che il telefono non è più raggiungibile, OneUptime smette di inviargli qualsiasi cosa, finché l'app non lo registra di nuovo.

```mermaid title="Come un telefono smette di ricevere avvisi, e come torna"
flowchart TB
    Registered["Il telefono è registrato,<br/>e gli avvisi gli arrivano"]
    Gone["Expo lo dà per perso:<br/>un push viene rifiutato,<br/>o la sua ricevuta lo dice<br/>circa 15 minuti dopo"]
    Marked["OneUptime lo segna<br/>Non riceve notifiche<br/>e smette di inviare;<br/>le sue regole restano"]
    Open["Apri l'app<br/>da connesso"]
    Renewed["L'app si registra di nuovo,<br/>rinnova il suo token<br/>push, e gli avvisi gli<br/>arrivano di nuovo"]
    Registered --> Gone --> Marked --> Open --> Renewed
```

Expo dà un telefono per perso quando l'app ne è stata rimossa, o quando il suo token push non è più valido. Il telefono non viene eliminato: **Impostazioni utente → Metodi di notifica**, nella scheda **Push Notifications**, lo mostra come **Non riceve notifiche**, e la cronologia di reperibilità di un avviso che non gli è arrivato dice perché. Gli altri tuoi telefoni e metodi di notifica ricevono avvisi come sempre.

L'app registra il telefono a ogni avvio, quando accedi, e quando ci torni, al massimo una volta ogni cinque minuti. La registrazione chiede di nuovo il token push a Expo, che così lo rinnova, e il telefono riceve di nuovo gli avvisi con le regole che aveva.

| Cosa è successo | Cosa fare | Cosa fa OneUptime |
| --- | --- | --- |
| L'app è ancora installata | Aprila da connesso | Il telefono riceve di nuovo notifiche, con le sue regole |
| Hai reinstallato l'app su un iPhone o iPad | Installala e accedi | Di solito torna la stessa voce, con le sue regole |
| Hai reinstallato l'app su Android | Installala, accedi ed elimina la vecchia voce | Una nuova voce con le regole predefinite; la vecchia resta segnata |
| Un telefono nuovo, configurato da un backup del vecchio | Apri l'app sul telefono nuovo | Se la voce del vecchio telefono è segnata, il nuovo la prende, con le sue regole; altrimenti il nuovo telefono riceve una voce sua |
| Un telefono nuovo, configurato da zero | Accedi ed elimina la vecchia voce | Una nuova voce con le regole predefinite |
| Sei uscito dall'app | Accedi di nuovo | L'uscita ha rimosso il telefono e le sue regole; torna con le regole predefinite |

Anche un browser può smettere di ricevere notifiche, quando la sua sottoscrizione push scade. La dashboard la rinnova quando può; se il browser resta segnato, registralo di nuovo con **Registra dispositivo** in quel browser.

## Risoluzione dei problemi

### Accesso

:::details «Could not connect to the server»
L'app non è riuscita a raggiungere `https://<your-oneuptime>/api/status`. Controlla l'indirizzo, compreso `https://`: l'app non si connette in HTTP semplice. Se il tuo OneUptime è su una rete privata, collega prima il telefono a quella rete, ad esempio tramite la VPN. Aperto nel browser del telefono, quell'indirizzo mostra `{"status":"ok"}` quando il telefono raggiunge OneUptime.
:::

:::details «No SSO configuration found for the email»
Nessuno dei progetti di cui fa parte quell'email ha configurato il single sign-on, oppure l'email non ha un account su questo OneUptime. Controlla l'email, o accedi con la password. I provider che l'amministratore ha configurato per tutta l'installazione sono elencati prima del campo email.
:::

:::details Una chiave di sicurezza è il tuo unico secondo fattore
L'app non può usare una chiave di sicurezza. Accedi con uno dei tuoi codici di backup, o aggiungi un'app di autenticazione al tuo account nella dashboard: vedi [Attivare l'autenticazione a due fattori](/docs/introduction/your-account#attivare-lautenticazione-a-due-fattori).
:::

:::details L'accesso con passkey non riesce
Le passkey richiedono che l'indirizzo del tuo OneUptime inizi con `https://`, e una passkey aggiunta per questo OneUptime: vedi [Aggiungere una passkey](/docs/introduction/your-account#aggiungere-una-passkey). Per usare un altro server, tocca **Change Server** nella schermata di accesso.
:::

### Notifiche

:::details Nessuna notifica sul telefono
- Controlla che il telefono consenta le notifiche di OneUptime On-Call, e che Non disturbare o una modalità Full immersion non le trattengano.
- In **Impostazioni utente → Metodi di notifica**, scheda **Push Notifications**, controlla che il telefono sia elencato, e inviagli una **Notifica di test**.
- Se è segnato **Non riceve notifiche**, apri l'app da connesso: vedi [Quando un telefono deve registrarsi di nuovo](#quando-un-telefono-deve-registrarsi-di-nuovo).
- Controlla le tue regole di reperibilità in **Impostazioni utente → Regole di reperibilità**: decidono quali avvisi raggiungono quale metodo.
- Su un OneUptime self-hosted, controlla che il server raggiunga il suo relay push: vedi [Notifiche push](/docs/self-hosted/push-notifications#accesso-di-rete).
:::

:::details Gli avvisi arrivano in ritardo su Android
Imposta l'utilizzo della batteria dell'app su **Senza restrizioni** nelle impostazioni di Android per OneUptime On-Call, ed escludi l'app da qualsiasi elenco di risparmio energetico: vedi [Evitare che gli avvisi arrivino in ritardo](/docs/mobile-desktop-apps/android-installation#evitare-che-gli-avvisi-arrivino-in-ritardo).
:::

:::details Gli avvisi critici non suonano in modalità silenziosa
Apri **Settings** nell'app: la riga sotto **Critical On-Call Alerts** dice cosa manca su quel telefono. Poi controlla in **Impostazioni utente → Regole di reperibilità** che la regola di reperibilità che ha inviato l'avviso sia impostata su **Avviso critico**, non su **Standard**. Ogni telefono ha il suo interruttore.
:::

### App desktop

:::details Nessuna icona di installazione nella barra degli indirizzi
Installa da una pagina della dashboard dopo l'accesso, in `https://`, in Edge o Chrome, o in Safari su macOS Sonoma 14 o successivo. Se l'icona non compare, anche il menu del browser installa l'app: vedi [Installazione Windows](/docs/mobile-desktop-apps/windows-installation#installare-lapp).
:::

:::details Nessuna notifica sul desktop
Registra il browser in **Impostazioni utente → Metodi di notifica**, scheda **Push Notifications**, con **Registra dispositivo**, consenti le notifiche quando ti viene chiesto, e controlla le impostazioni di notifica del computer stesso. Un OneUptime self-hosted ha bisogno delle sue chiavi VAPID per le notifiche del browser.
:::

## Ottenere aiuto

Se qualcosa qui non corrisponde a ciò che vedi, [apri una issue su GitHub](https://github.com/OneUptime/oneuptime/issues) con la versione della tua app, in fondo alla sua schermata **Settings**, e la piattaforma che usi.

## Passi successivi

:::cards
- [Panoramica delle app](/docs/mobile-desktop-apps/index): Quale app usare, e come raggiungono OneUptime.
- [Installazione Android](/docs/mobile-desktop-apps/android-installation): Installare e configurare l'app su Android.
- [Installazione iOS](/docs/mobile-desktop-apps/ios-installation): Installare e configurare l'app su un iPhone o iPad.
- [Notifiche push](/docs/self-hosted/push-notifications): Come un OneUptime self-hosted invia gli avvisi, e gli errori di Expo.
:::

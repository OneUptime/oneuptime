# Panoramica delle app

OneUptime ha un'app per il telefono e una per il computer. **OneUptime On-Call**, per iPhone, iPad e Android, ti avvisa quando sei reperibile e ti permette di confermare e risolvere ovunque ti trovi. Su Windows, macOS e Linux, la dashboard di OneUptime si installa dal browser come app desktop, con una finestra tutta sua. Entrambe funzionano con OneUptime Cloud e con un OneUptime ospitato da te.

:::cards
- [Scegliere un'app](#scegliere-unapp): A cosa serve ogni app, fianco a fianco.
- [Come le app raggiungono OneUptime](#come-le-app-raggiungono-oneuptime): Il percorso dell'accesso e degli avvisi di reperibilità.
- [Ottenere l'app mobile](#ottenere-lapp-mobile): Dall'App Store, da Google Play o da GitHub.
- [Ottenere l'app desktop](#ottenere-lapp-desktop): Installare la dashboard da Edge, Chrome o Safari.
:::

## Scegliere un'app

|  | App mobile | App desktop |
| --- | --- | --- |
| Che cos'è | OneUptime On-Call, un'app nativa per iPhone, iPad e Android | La dashboard di OneUptime, installata dal tuo browser |
| Dove si ottiene | Dall'App Store, da Google Play, o come APK da GitHub | Dal tuo OneUptime: non c'è niente da scaricare |
| Avvisi di reperibilità | Notifiche push, che possono suonare nonostante la modalità silenziosa e Non disturbare | Notifiche del browser, una volta registrato il browser |
| Cosa puoi fare | Incidenti, avvisi, casi di sicurezza, monitor e chi è reperibile; confermare, risolvere, approvare passaggi di playbook e aggiungere note | Tutto quello che fa la dashboard |
| Aggiornamenti | Dallo store, o installando un APK più recente | A ogni apertura carica la dashboard dal tuo OneUptime |
| Funziona su | iOS 16.4 o successivo, Android 7.0 o successivo | Windows, macOS e Linux, con Edge o Chrome, o Safari su macOS Sonoma 14 o successivo |

Puoi usarle entrambe: tieni l'app desktop aperta al lavoro, e lascia che di notte ti svegli il telefono.

## Come le app raggiungono OneUptime

```mermaid title="Come gli avvisi di reperibilità raggiungono il tuo telefono e il tuo computer"
flowchart TB
    OneUptime["Il tuo OneUptime:<br/>Cloud o self-hosted"]
    Expo["Servizio push di Expo,<br/>poi Apple o Google"]
    WebPush["Il servizio push<br/>del tuo browser"]
    Phone["OneUptime On-Call<br/>sul tuo telefono"]
    Desktop["L'app desktop<br/>sul tuo computer"]
    OneUptime -->|"verso un telefono"| Expo
    OneUptime -->|"verso un browser<br/>registrato"| WebPush
    Expo -->|"notifica push"| Phone
    WebPush -->|"notifica"| Desktop
```

L'app mobile accede al tuo OneUptime e registra il telefono in ogni progetto di cui fai parte. Da quel momento OneUptime invia le notifiche push del telefono, compresi gli avvisi di reperibilità, tramite il servizio push di Expo, che le passa ad Apple o Google per la consegna. Per impostazione predefinita un OneUptime self-hosted le invia tramite il relay push di OneUptime, quindi non gli serve alcun account Apple, Google o Expo: vedi [Notifiche push](/docs/self-hosted/push-notifications).

L'app desktop è la dashboard stessa, in una finestra tutta sua. Mostra notifiche una volta che hai registrato il suo browser per le notifiche push: le pagine su Windows, macOS e Linux spiegano come.

## Prima di iniziare

- Un account in un progetto OneUptime. Per ricevere avvisi devi anche essere reperibile: vedi [Regole di escalation](/docs/on-call/escalation-rules).
- L'indirizzo del tuo OneUptime. Su OneUptime Cloud è `https://oneuptime.com`; un OneUptime self-hosted ha il suo, ad esempio `https://oneuptime.example.com`.
- Il tuo OneUptime servito in HTTPS. L'app mobile non si connette in HTTP semplice, e i browser mostrano notifiche, ed Edge e Chrome installano app, solo per siti HTTPS.

## Ottenere l'app mobile

:::steps
### Installare OneUptime On-Call
Scaricala dall'[App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) su un iPhone o iPad, o da [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall) su Android. Per un telefono Android senza Google Play, installa invece l'[APK](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk). Gli stessi link si trovano nella dashboard, in **Impostazioni del progetto → Notifiche → App mobili**.

### Collegarla al tuo OneUptime
Apri l'app, lascia `https://oneuptime.com` per OneUptime Cloud o inserisci l'indirizzo del tuo OneUptime, e accedi con la password, una passkey o il single sign-on.

### Consentire le notifiche
Consentile quando il telefono lo chiede. L'app registra il telefono in ciascuno dei tuoi progetti, e i tuoi avvisi di reperibilità iniziano ad arrivargli.
:::

Ogni passaggio nel dettaglio, con cosa controllare dopo: [Installazione Android](/docs/mobile-desktop-apps/android-installation) e [Installazione iOS](/docs/mobile-desktop-apps/ios-installation).

## Ottenere l'app desktop

:::steps
### Aprire la dashboard
Accedi al tuo OneUptime in Microsoft Edge o Google Chrome, oppure in Safari su un Mac.

### Installarla
In Edge o Chrome, fai clic sull'icona di installazione a destra della barra degli indirizzi. In Safari, scegli **Archivio → Aggiungi al Dock**.

### Aprirla come qualsiasi altra app
Si apre in una finestra tutta sua, dal menu Start, dal Dock o dal tuo launcher di app.
:::

Ogni browser passo per passo: [Installazione Windows](/docs/mobile-desktop-apps/windows-installation), [Installazione macOS](/docs/mobile-desktop-apps/macos-installation) e [Installazione Linux](/docs/mobile-desktop-apps/linux-installation).

## Passi successivi

:::cards
- [Installazione Android](/docs/mobile-desktop-apps/android-installation): Installare l'app su Android, accedere e controllare che gli avvisi arrivino.
- [Installazione iOS](/docs/mobile-desktop-apps/ios-installation): Installare l'app su un iPhone o iPad e attivare gli avvisi critici.
- [Installazione Windows](/docs/mobile-desktop-apps/windows-installation): Installare la dashboard da Edge o Chrome.
- [Installazione macOS](/docs/mobile-desktop-apps/macos-installation): Aggiungere la dashboard al Dock da Safari, Chrome o Edge.
- [Installazione Linux](/docs/mobile-desktop-apps/linux-installation): Installare la dashboard da Chrome, Chromium o Edge.
- [FAQ e risoluzione dei problemi](/docs/mobile-desktop-apps/faq-troubleshooting): Risposte, soluzioni, e cosa fare quando un telefono smette di ricevere avvisi.
:::

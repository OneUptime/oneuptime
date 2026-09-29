# App Mobile e Desktop di OneUptime

OneUptime offre due modi per utilizzare la piattaforma al di fuori del browser:

- **App mobile native** per iOS e Android, pubblicate su **Apple App Store** e **Google Play**. Recapitano avvisi di reperibilità, allerte di incidenti e azioni di presa in carico direttamente sul tuo telefono.
- **App desktop installabili** per Windows, macOS e Linux, distribuite come Progressive Web App (PWA) installabili direttamente dal tuo browser. Forniscono alla dashboard di OneUptime una propria finestra, icona e area di notifica sul tuo computer.

## Mobile (App native)

L'app **OneUptime On-Call** è un'applicazione nativa sviluppata con React Native. Viene distribuita tramite gli store ufficiali, così ottieni aggiornamenti automatici, notifiche push e sblocco biometrico.

- **iOS** — [Scarica dall'App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391). Richiede iOS 15.0 o successivo. Consulta la [Guida all'installazione su iOS](./ios-installation.md).
- **Android** — [Ottienila su Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). Richiede Android 8.0 o successivo. È disponibile anche un [download diretto dell'APK](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) per dispositivi senza Google Play. Consulta la [Guida all'installazione su Android](./android-installation.md).

## Desktop (Progressive Web App)

La dashboard web di OneUptime è una Progressive Web App, quindi puoi installarla come applicazione desktop da un browser moderno senza passare attraverso alcuno store.

- [Installazione su Windows](./windows-installation.md)
- [Installazione su macOS](./macos-installation.md)
- [Installazione su Linux](./linux-installation.md)

### Per iniziare con il desktop

1. Apri la tua istanza OneUptime in un browser basato su Chromium (Chrome, Edge) o in Safari.
2. Cerca il pulsante **Installa** nella barra degli indirizzi oppure in **File → Aggiungi al Dock / App → Installa questo sito come app**.
3. Avvia l'app installata dal menu Start, dal Launchpad o dal launcher delle applicazioni.

### Risoluzione dei problemi desktop

**L'opzione di installazione non appare:**

- Assicurati di utilizzare un browser supportato.
- Verifica che la tua istanza OneUptime sia servita tramite HTTPS.
- Aggiorna la pagina o svuota la cache del browser.

**Le notifiche push non funzionano:**

- Concedi i permessi di notifica quando richiesto dal browser.
- Controlla le impostazioni di notifica del sistema operativo per il browser.
- Utenti self-hosted: verifica che le notifiche push siano configurate sulla tua istanza OneUptime.

## Supporto

- Problemi specifici per mobile: consulta le guide all'installazione per [iOS](./ios-installation.md) o [Android](./android-installation.md).
- Problemi specifici per desktop: consulta le guide all'installazione per [Windows](./windows-installation.md), [macOS](./macos-installation.md) o [Linux](./linux-installation.md).
- Domande generali: consulta la pagina [FAQ e Risoluzione dei problemi](./faq-troubleshooting.md).
- Segnala bug o richieste di funzionalità sul nostro [repository GitHub](https://github.com/OneUptime/oneuptime).

# FAQ e Risoluzione dei problemi

Domande frequenti e soluzioni per le app mobile e desktop di OneUptime.

## Come distribuisce OneUptime le sue app?

- **Mobile (iOS e Android):** OneUptime distribuisce un'app nativa chiamata **OneUptime On-Call**. È pubblicata su [Apple App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) e [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). È disponibile anche un [download dell'APK firmato](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) per dispositivi Android senza Google Play.
- **Desktop (Windows, macOS, Linux):** La dashboard web di OneUptime è una Progressive Web App (PWA). Puoi installarla come applicazione desktop direttamente da un browser basato su Chromium o da Safari — non è necessario alcun account dello store.

## FAQ App Mobile

### Quali dispositivi sono supportati?

- **iOS:** iPhone o iPad con iOS 15.0 o successivo.
- **Android:** Telefoni e tablet con Android 8.0 (Oreo) o successivo.

### L'app è gratuita?

Sì. L'app OneUptime On-Call è gratuita da installare. Accedi con il tuo account OneUptime esistente.

### Posso usare l'app con un'istanza self-hosted di OneUptime?

Sì. Al primo avvio, l'app chiede un **URL del server**. Inserisci l'URL della tua istanza self-hosted (ad esempio `https://oneuptime.example.com`). L'app verifica che il server sia raggiungibile prima di consentirti l'accesso.

Per le notifiche push sulle istanze self-hosted, segui la guida [Push Notifications](/docs/self-hosted/push-notifications).

### Come vengono recapitati gli aggiornamenti?

- **iOS:** Tramite l'App Store. Attiva gli aggiornamenti automatici in **Impostazioni → App Store**, o aggiorna manualmente dal tuo profilo App Store.
- **Android (Google Play):** Gli aggiornamenti automatici sono attivati per impostazione predefinita.
- **Android (sideload APK):** Scarica e installa l'ultimo APK dal link delle GitHub Releases sopra.

### Perché non ricevo le notifiche push?

Le push su mobile usano APNs (iOS) e FCM (Android) tramite Expo Push. Verifica quanto segue:

1. Le notifiche sono attive a livello di sistema operativo per **OneUptime On-Call**.
2. L'ottimizzazione della batteria è disattivata e l'attività in background è consentita (Android).
3. Le modalità Do Not Disturb o Full Immersion sono disattivate, oppure l'app è nell'elenco delle eccezioni.
4. Hai effettuato l'accesso — il token push viene registrato sul server solo dopo l'accesso.
5. **Solo self-hosted:** Le notifiche push sono configurate sulla tua istanza OneUptime. Consulta la guida [Push Notifications](/docs/self-hosted/push-notifications).

### I dati sul mio telefono sono al sicuro?

- Tutto il traffico API utilizza HTTPS.
- I token di accesso e di refresh sono memorizzati nel keystore sicuro del dispositivo (Keychain su iOS, Keystore su Android).
- Puoi richiedere lo sblocco con Face ID / Touch ID / impronta digitale dalla schermata **Impostazioni** dell'app.

### Posso installare l'app su più dispositivi?

Sì. Accedi con lo stesso account OneUptime su tutti i dispositivi che ti servono. Ogni dispositivo riceve le proprie notifiche push.

### Come disinstallo l'app?

- **iOS:** Tieni premuta l'icona → **Rimuovi app** → **Elimina app**.
- **Android:** Tieni premuta l'icona → **Disinstalla**, oppure **Impostazioni → App → OneUptime On-Call → Disinstalla**.

Il tuo account OneUptime e i tuoi dati sono memorizzati sul server e non vengono rimossi quando disinstalli l'app.

## FAQ App Desktop (PWA)

### Cos'è una Progressive Web App (PWA)?

Una Progressive Web App è un'applicazione web che può essere installata come un'app desktop nativa. Una volta installata, viene eseguita in una propria finestra, ha una propria icona nel launcher e può recapitare notifiche desktop — senza passare attraverso Windows Store, Mac App Store o qualsiasi altro canale di distribuzione.

### Perché l'app desktop utilizza la tecnologia PWA?

- **Aggiornamenti istantanei** — l'app rimane sincronizzata con la tua istanza OneUptime nel momento in cui esegui il deploy.
- **Nessun account dello store richiesto** — installa direttamente da qualsiasi browser moderno.
- **Codice unico** — la stessa dashboard funziona su Windows, macOS e Linux.

### Perché non appare il pulsante "Installa"?

1. Utilizza un browser basato su Chromium (Chrome, Edge, Brave, Arc) o Safari (macOS Sonoma+).
2. Verifica che la tua istanza OneUptime sia servita tramite HTTPS con un certificato valido.
3. Svuota la cache del browser e ricarica.
4. L'app potrebbe essere già installata — controlla le tue Applicazioni / il menu Start.

### Come aggiorno l'app desktop?

La PWA si aggiorna automaticamente ogni volta che la apri mentre sei online. Per forzare un aggiornamento, aggiorna la finestra con **Ctrl+R** (Windows/Linux) o **Cmd+R** (macOS).

### Come disinstallo la PWA desktop?

- **Windows:** **Impostazioni → App → OneUptime → Disinstalla**, o fai clic con il tasto destro sulla voce nel menu Start.
- **macOS:** Trascina l'app dalla cartella **Applicazioni** al Cestino, o fai clic con il tasto destro sull'icona nel Dock e scegli **Rimuovi**.
- **Linux:** Utilizza l'opzione di disinstallazione del launcher delle applicazioni, o rimuovi il relativo file `.desktop`.

## Risoluzione dei problemi

### Problemi dell'app mobile

**L'app non accede / "Errore di rete":**
- Verifica che l'**URL del server** sia corretto e raggiungibile dal tuo telefono.
- Verifica che il tuo telefono sia connesso a Internet.
- Per istanze self-hosted dietro una VPN, assicurati che la VPN sia attiva.

**Notifiche push in ritardo o mancanti (Android):**
- Disattiva l'ottimizzazione della batteria: **Impostazioni → App → OneUptime On-Call → Batteria → Senza restrizioni**.
- Disattiva il Risparmio dati per l'app.
- Sui dispositivi Samsung, disattiva **Manutenzione dispositivo → Batteria → Limiti utilizzo in background** per OneUptime On-Call.

**Notifiche push in ritardo o mancanti (iOS):**
- Evita di forzare la chiusura dell'app — iOS potrebbe sospendere la consegna in background.
- Disattiva la Modalità a basso consumo mentre sei in reperibilità.
- Aggiungi OneUptime On-Call all'elenco delle eccezioni di qualsiasi modalità Full Immersion attiva.

**Face ID / Touch ID / impronta digitale non funzionano:**
- Assicurati che la biometria sia registrata nelle impostazioni del sistema operativo.
- Riattiva lo sblocco biometrico dalla schermata **Impostazioni** all'interno dell'app OneUptime On-Call.

### Problemi dell'app desktop (PWA)

**Pulsante Installa mancante:**
- Utilizza un browser supportato (basato su Chromium o Safari su macOS Sonoma+).
- Assicurati che l'istanza OneUptime sia servita tramite HTTPS.
- Attendi il completamento del caricamento della pagina, quindi controlla la barra degli indirizzi per l'icona di installazione.

**Le notifiche desktop non appaiono:**
- Consenti le notifiche quando il browser te lo richiede.
- Controlla le impostazioni delle notifiche del sistema operativo (Assistente notifiche di Windows, Notifiche di macOS, daemon delle notifiche di Linux).
- Per le istanze self-hosted, assicurati che la configurazione di [Push Notifications](/docs/self-hosted/push-notifications) sia completa.

**L'app non mostra i dati più recenti:**
- Aggiorna con **Ctrl+R** / **Cmd+R**.
- Chiudi e riapri la finestra.
- Verifica la tua connessione di rete.

## Supporto

Se hai ancora bisogno di aiuto:

- Mobile: consulta le guide all'installazione per [iOS](./ios-installation.md) o [Android](./android-installation.md).
- Desktop: consulta le guide all'installazione per [Windows](./windows-installation.md), [macOS](./macos-installation.md) o [Linux](./linux-installation.md).
- Apri una segnalazione sul [repository GitHub di OneUptime](https://github.com/OneUptime/oneuptime).
- Contatta il supporto tramite la tua dashboard OneUptime.

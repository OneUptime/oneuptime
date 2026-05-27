# Guida all'installazione su Android

Installa l'app Android nativa **OneUptime On-Call** dal Google Play Store, oppure carica direttamente l'APK sui dispositivi senza Google Play.

## Requisiti

- Telefono o tablet Android con **Android 8.0 (Oreo) o successivo**
- Un account OneUptime attivo (o l'URL della tua istanza self-hosted di OneUptime)
- Connessione Internet per l'accesso e per ricevere le notifiche push

## Opzione 1: Installazione da Google Play (consigliata)

1. Apri il **Google Play Store** sul tuo dispositivo.
2. Cerca **"OneUptime On-Call"**, oppure apri questo link sul tuo dispositivo:
   [https://play.google.com/store/apps/details?id=com.oneuptime.oncall](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)
3. Tocca **Installa**.
4. Una volta installata, tocca **Apri** o avvia **OneUptime On-Call** dal drawer delle app.

## Opzione 2: Installazione diretta dell'APK

Per dispositivi senza Google Play (ad esempio GrapheneOS, /e/OS o dispositivi Huawei), installa l'APK ufficiale dalle GitHub Releases:

1. Sul tuo dispositivo Android, apri questo link:
   [https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)
2. Quando richiesto, autorizza il tuo browser a installare app sconosciute:
   **Impostazioni → App → \[Il tuo browser\] → Installa app sconosciute → Consenti da questa sorgente**.
3. Apri l'APK scaricato e tocca **Installa**.
4. Avvia **OneUptime On-Call** dal drawer delle app.

L'APK è compilato e firmato da OneUptime dallo stesso codice sorgente della release sul Play Store. Gli aggiornamenti dell'app non sono automatici quando si effettua il sideload — scarica l'ultimo APK dal link sopra quando viene rilasciata una nuova versione.

## Primo avvio e accesso

1. **URL del server**
   - Se utilizzi OneUptime Cloud, lascia il valore predefinito `https://oneuptime.com`.
   - Se sei in self-hosting, inserisci l'URL della tua istanza OneUptime (ad esempio `https://oneuptime.example.com`).
   - L'app verifica che il server sia raggiungibile prima di proseguire.
2. **Accedi**
   - Inserisci l'email e la password del tuo account OneUptime.
   - Facoltativamente, attiva lo **sblocco biometrico** (impronta digitale) per sbloccare più rapidamente l'app ai successivi avvii.
3. **Consenti le notifiche**
   - Quando richiesto, tocca **Consenti** in modo che l'app possa recapitare avvisi di reperibilità, allerte di incidenti e prese in carico.

## Notifiche push

Le notifiche push vengono recapitate tramite Firebase Cloud Messaging (FCM) tramite Expo Push. Per assicurarti che gli avvisi ti raggiungano in modo affidabile durante la reperibilità:

1. Apri **Impostazioni → App → OneUptime On-Call → Notifiche** e verifica che tutte le categorie siano attivate.
2. Apri **Impostazioni → App → OneUptime On-Call → Batteria** e scegli **Senza restrizioni** (o disattiva l'ottimizzazione della batteria) in modo che il sistema operativo non ritardi le notifiche push in background.
3. Consenti all'app di funzionare in background e disattiva eventuali restrizioni di "Risparmio dati" per essa.
4. Se utilizzi dispositivi Samsung, disattiva anche **Impostazioni → Manutenzione dispositivo → Batteria → Limiti utilizzo in background** per OneUptime On-Call.
5. Aggiungi OneUptime On-Call agli elenchi di eccezioni di **Do Not Disturb** in modo che gli avvisi continuino a suonare durante il tuo turno di reperibilità.

## Aggiornamenti

**Google Play:**
- Gli aggiornamenti si installano automaticamente. Per attivarne uno manualmente, apri **Play Store → Profilo → Gestisci app e dispositivo → Aggiornamenti disponibili → OneUptime On-Call → Aggiorna**.

**Sideload APK:**
- Scarica nuovamente l'ultimo APK dal link delle GitHub Releases sopra e installalo sopra l'app esistente — i tuoi dati, l'URL del server e l'accesso vengono preservati.

## Disinstallazione

1. **Tieni premuta** l'icona di **OneUptime On-Call**, quindi tocca **Disinstalla**.
2. Oppure apri **Impostazioni → App → OneUptime On-Call → Disinstalla**.
3. Conferma per rimuovere l'app.

Il tuo account OneUptime e i turni di reperibilità sono memorizzati lato server e non vengono rimossi quando disinstalli l'app.

## Risoluzione dei problemi

**"Errore di rete" durante l'accesso:**
- Verifica che l'**URL del server** sia corretto e raggiungibile dal tuo dispositivo.
- Se sei su una rete aziendale o VPN, assicurati che l'istanza OneUptime sia accessibile.
- Verifica che il server sia servito tramite HTTPS con un certificato valido.

**Non si ricevono notifiche push:**
- Verifica che le notifiche siano attive in **Impostazioni → App → OneUptime On-Call → Notifiche**.
- Disattiva l'ottimizzazione della batteria per OneUptime On-Call (vedi Notifiche push sopra).
- Assicurati che Do Not Disturb sia disattivato, o che OneUptime On-Call sia nell'elenco delle eccezioni.
- Esci e accedi nuovamente per aggiornare il token push registrato con il server.
- Utenti self-hosted: verifica che le notifiche push siano configurate sulla tua istanza OneUptime (consulta la guida self-hosted [Push Notifications](/docs/self-hosted/push-notifications)).

**Lo sblocco biometrico non funziona:**
- Registra un'impronta digitale in **Impostazioni → Sicurezza → Impronta digitale**.
- Riattiva lo sblocco biometrico dalla schermata **Impostazioni** all'interno dell'app OneUptime On-Call.

**Installazione APK bloccata:**
- Devi concedere al browser il permesso di installare app sconosciute (vedi Opzione 2 sopra).
- Alcuni operatori o profili aziendali del dispositivo bloccano completamente il sideloading; in tal caso, utilizza la versione di Google Play.

**L'app si blocca all'avvio:**
- Aggiorna all'ultima versione da Google Play o all'ultimo APK.
- Riavvia il dispositivo.
- Se il problema persiste, disinstalla e reinstalla, quindi accedi nuovamente.

## Supporto

Se hai ancora bisogno di aiuto, contattaci tramite la dashboard di OneUptime o apri una segnalazione sul nostro [repository GitHub](https://github.com/OneUptime/oneuptime).

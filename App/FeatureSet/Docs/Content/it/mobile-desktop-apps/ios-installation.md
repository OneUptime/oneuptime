# Guida all'installazione su iOS

Installa l'app iOS nativa **OneUptime On-Call** dall'Apple App Store sul tuo iPhone o iPad.

## Requisiti

- iPhone o iPad con **iOS 15.0 o successivo**
- Un account OneUptime attivo (o l'URL della tua istanza self-hosted di OneUptime)
- Connessione Internet per l'accesso e per ricevere le notifiche push

## Installazione dall'App Store

1. **Apri l'App Store** sul tuo iPhone o iPad.
2. Tocca la scheda **Cerca** e cerca **"OneUptime On-Call"**, oppure apri questo link sul tuo dispositivo:
   [https://apps.apple.com/us/app/oneuptime-on-call/id6759615391](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)
3. Tocca **Ottieni**, quindi autenticati con Face ID, Touch ID o la password del tuo Apple ID.
4. Una volta installata, tocca **Apri** o avvia **OneUptime On-Call** dalla schermata Home.

## Primo avvio e accesso

1. **URL del server**
   - Se utilizzi OneUptime Cloud, lascia il valore predefinito `https://oneuptime.com`.
   - Se sei in self-hosting, inserisci l'URL della tua istanza OneUptime (ad esempio `https://oneuptime.example.com`).
   - L'app verifica che il server sia raggiungibile prima di proseguire.
2. **Accedi**
   - Inserisci l'email e la password del tuo account OneUptime.
   - Facoltativamente, attiva **Face ID** o **Touch ID** per sbloccare più rapidamente l'app ai successivi avvii.
3. **Consenti le notifiche**
   - Quando richiesto, tocca **Consenti** in modo che l'app possa recapitare avvisi di reperibilità, allerte di incidenti e prese in carico.

## Notifiche push

Le notifiche push vengono recapitate tramite Apple Push Notification service (APNs) tramite Expo Push. Per assicurarti che gli avvisi ti raggiungano in modo affidabile:

1. Vai su **Impostazioni → Notifiche → OneUptime On-Call**.
2. Attiva **Consenti notifiche**, **Suoni**, **Badge** e la consegna su **Schermata di blocco / Banner / Centro Notifiche**.
3. Imposta **Raggruppamento notifiche** su **Automatico**.
4. Se sei in reperibilità, disattiva la **Modalità a basso consumo** durante il tuo turno ed evita di forzare la chiusura dell'app — iOS potrebbe ritardare la consegna in background se l'app viene forzatamente chiusa.
5. Aggiungi **OneUptime On-Call** a tutte le modalità **Full Immersion** in cui desideri comunque ricevere gli avvisi.

## Aggiornamenti

L'app viene aggiornata tramite l'App Store:

- Apri l'**App Store**, tocca la tua foto profilo, scorri fino a **OneUptime On-Call** e tocca **Aggiorna**.
- Oppure attiva **Impostazioni → App Store → Aggiornamenti app** per installare gli aggiornamenti automaticamente.

## Disinstallazione

1. **Tieni premuta** l'icona di **OneUptime On-Call** nella schermata Home.
2. Tocca **Rimuovi app → Elimina app**.
3. Conferma toccando **Elimina**.

Il tuo account OneUptime e i turni di reperibilità sono memorizzati lato server e non vengono rimossi quando disinstalli l'app.

## Risoluzione dei problemi

**L'App Store indica che l'app è "Non disponibile nella tua regione":**

- L'app è pubblicata sull'App Store globale. Se non appare nella tua regione, contatta il [supporto](mailto:support@oneuptime.com).

**"Errore di rete" durante l'accesso:**

- Verifica che l'**URL del server** sia corretto e raggiungibile dal tuo dispositivo.
- Se sei su una rete aziendale o VPN, assicurati che l'istanza OneUptime sia accessibile.
- Verifica che il server sia servito tramite HTTPS con un certificato valido.

**Non si ricevono notifiche push:**

- Apri **Impostazioni → Notifiche → OneUptime On-Call** e verifica che le notifiche siano consentite.
- Disattiva **Non disturbare** o aggiungi OneUptime On-Call all'elenco delle eccezioni della modalità Full Immersion attiva.
- Esci e accedi nuovamente per aggiornare il token push registrato con il server.
- Utenti self-hosted: verifica che le notifiche push siano configurate sulla tua istanza OneUptime (consulta la guida self-hosted [Push Notifications](/docs/self-hosted/push-notifications)).

**Face ID / Touch ID non funzionano:**

- Assicurati che la biometria sia registrata in **Impostazioni → Face ID e codice** o **Impostazioni → Touch ID e codice**.
- Riattiva lo sblocco biometrico dalla schermata **Impostazioni** all'interno dell'app OneUptime On-Call.

**L'app si blocca all'avvio:**

- Aggiorna all'ultima versione dall'App Store.
- Riavvia il dispositivo.
- Se il problema persiste, elimina e reinstalla l'app, quindi accedi nuovamente.

## Supporto

Se hai ancora bisogno di aiuto, contattaci tramite la dashboard di OneUptime o apri una segnalazione sul nostro [repository GitHub](https://github.com/OneUptime/oneuptime).

# Notifiche Push

Le notifiche push native (iOS/Android) sono alimentate da **Expo Push** e **non richiedono alcuna configurazione lato server** per le istanze self-hosted.

## Come Funziona

L'app mobile OneUptime registra un Expo Push Token nel backend. Quando il backend deve inviare una notifica, effettua una POST all'API pubblica di Expo Push, che instrada il messaggio ad Apple APNs o Google FCM per conto dell'app.

Le notifiche push web continuano a usare le chiavi VAPID e il protocollo Web Push.

## Configurazione Self-Hosted

Non è richiesta alcuna configurazione per le notifiche push. Il binario dell'app mobile gestisce automaticamente tutta la registrazione della piattaforma tramite l'infrastruttura push di Expo.

## Risoluzione dei Problemi

### Le notifiche push non arrivano

- Assicurarsi che l'app mobile sia stata compilata con EAS Build (Expo Go non supporta le notifiche push)
- Verificare che il dispositivo sia registrato nella tabella `UserPush` del database
- Controllare i log del server OneUptime per errori dell'API Expo Push
- Confermare che il dispositivo abbia una connessione internet attiva e i permessi per le notifiche abilitati

### Errori "DeviceNotRegistered" nei log

Il Token Expo Push non è più valido. Questo di solito significa che l'app è stata disinstallata o l'utente ha revocato i permessi per le notifiche. Il token verrà eliminato automaticamente.

## Supporto

Se si incontrano problemi con le notifiche push, si prega di:

1. Controllare la sezione di risoluzione dei problemi sopra
2. Esaminare i log di OneUptime per messaggi di errore dettagliati
3. Contattarci all'indirizzo [hello@oneuptime.com](mailto:hello@oneuptime.com)

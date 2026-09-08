# Notifiche Push

Le notifiche push native (iOS/Android) usano **Expo Push**. Le istanze self-hosted utilizzano per impostazione predefinita il relay OneUptime e richiedono accesso di rete in uscita verso di esso.

## Come Funziona

L’app mobile OneUptime registra un Expo Push Token nel backend. Il backend invia tramite il relay OneUptime oppure direttamente a Expo se è configurato `EXPO_ACCESS_TOKEN`. Expo inoltra i messaggi ad Apple APNs o Google FCM per la consegna al dispositivo.

Le notifiche push web continuano a usare le chiavi VAPID e il protocollo Web Push.

## Configurazione Self-Hosted

L’app mobile ufficiale con il relay predefinito non richiede credenziali Expo sul server. Per l’invio diretto, configura `EXPO_ACCESS_TOKEN` con le credenziali del progetto Expo dell’app. Web push richiede `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT`.

## Accesso alla rete

| Direzione | Destinazione | Protocollo / porta | Quando serve |
| --- | --- | --- | --- |
| OneUptime → relay predefinito | `https://oneuptime.com/api/notification/push-relay/send` | HTTPS / TCP 443 | Push mobile senza `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send` | HTTPS / TCP 443 | Push mobile diretto con `EXPO_ACCESS_TOKEN`. |
| OneUptime → servizio push del browser | Endpoint HTTPS della sottoscrizione push | HTTPS / normalmente TCP 443 | Web push. |
| App mobile o browser → OneUptime | Il tuo hostname OneUptime | HTTPS / TCP 443 | Accesso, registrazione del dispositivo e apertura dei link. |

Se cambi `PUSH_NOTIFICATION_RELAY_URL`, consenti il relativo hostname e la porta configurata. Un relay personalizzato deve implementare l’API relay OneUptime. Valori predefiniti e selezione della modalità sono nella [configurazione](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) e nel [servizio push OneUptime](https://github.com/OneUptime/oneuptime/blob/master/Common/Server/Services/PushNotificationService.ts); [Expo](https://docs.expo.dev/push-notifications/sending-notifications/) documenta l’endpoint diretto.

Per web push, consenti gli host effettivi degli endpoint dei browser utilizzati. OneUptime accetta `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` e `push.apple.com`, inclusi i sottodomini come `updates.push.services.mozilla.com` e `web.push.apple.com`. La [sottoscrizione del browser](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) determina la destinazione. Consentire solo Expo o il relay non abilita web push.

Consenti DNS e TLS in uscita dal processo OneUptime che invia notifiche. L’archivio dei certificati deve validare quello della destinazione; i proxy devono inoltrare le richieste API senza autenticazione interattiva. I provider push non chiamano webhook sul server OneUptime. Il server può restare privato se i dispositivi lo raggiungono tramite VPN o altra connessione privata. Senza accesso al relay o ai servizi push esterni, la consegna non è possibile.

I dispositivi hanno requisiti di connettività distinti. iOS richiede APNs, in genere TCP 5223 con TCP 443 come alternativa; consulta gli intervalli aggiornati di [Apple](https://support.apple.com/en-us/102266). Android richiede FCM su TCP 5228–5230 e 443; consulta host e regole aggiornati di [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). Non aprire queste porte in ingresso su OneUptime: il server usa il relay o Expo per il push mobile, non direttamente APNs/FCM.

Verifica DNS e HTTPS dal container o pod mittente alla destinazione della modalità scelta. Invia una prova da **User Settings > Notification Methods > Push** e conferma la ricezione sul dispositivo registrato. Prova web push separatamente su ogni browser. Controlla gli errori relay, Expo o web-push nei log OneUptime; l’accettazione dell’API non conferma la consegna al dispositivo.

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

# Push-meldingen

Native pushmeldingen (iOS/Android) gebruiken **Expo Push**. Zelfgehoste instanties gebruiken standaard de pushrelay van OneUptime en hebben uitgaande netwerktoegang nodig.

## Hoe het werkt

De mobiele OneUptime-app registreert een Expo Push Token bij de backend. De backend verstuurt via de OneUptime-relay of rechtstreeks naar Expo wanneer `EXPO_ACCESS_TOKEN` is ingesteld. Expo stuurt berichten naar Apple APNs of Google FCM voor bezorging op het apparaat.

Web push-meldingen blijven VAPID-sleutels en het Web Push-protocol gebruiken.

## Zelf-gehoste instelling

De officiële mobiele app met de standaardrelay heeft geen Expo-inloggegevens op de server nodig. Stel voor rechtstreekse bezorging `EXPO_ACCESS_TOKEN` in met gegevens voor het Expo-project van je app. Webpush vereist `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` en `VAPID_SUBJECT`.

## Netwerktoegang

| Richting | Bestemming | Protocol / poort | Wanneer nodig |
| --- | --- | --- | --- |
| OneUptime → standaardrelay | `https://oneuptime.com/api/notification/push-relay/send` | HTTPS / TCP 443 | Mobiele push zonder `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send` | HTTPS / TCP 443 | Rechtstreekse mobiele push met `EXPO_ACCESS_TOKEN`. |
| OneUptime → browserpushdienst | HTTPS-endpoint in het pushabonnement | HTTPS / doorgaans TCP 443 | Webpush. |
| Mobiele app of browser → OneUptime | Je OneUptime-hostnaam | HTTPS / TCP 443 | Aanmelden, apparaatregistratie en meldingslinks openen. |

Wijzig je `PUSH_NOTIFICATION_RELAY_URL`, sta dan de hostnaam en ingestelde poort toe. Een eigen relay moet de OneUptime-relay-API implementeren. Standaardwaarden en de keuze van bezorgingswijze staan in de [configuratie](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) en [pushdienst van OneUptime](https://github.com/OneUptime/oneuptime/blob/master/Common/Server/Services/PushNotificationService.ts); [Expo](https://docs.expo.dev/push-notifications/sending-notifications/) beschrijft het rechtstreekse endpoint.

Sta voor webpush de echte endpointhosts van de gebruikte browsers toe. OneUptime accepteert `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` en `push.apple.com`, inclusief subdomeinen zoals `updates.push.services.mozilla.com` en `web.push.apple.com`. Het [browserabonnement](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) bepaalt de bestemming. Alleen Expo of de relay toestaan maakt webpush niet mogelijk.

Sta DNS en uitgaand TLS toe vanuit het OneUptime-proces dat meldingen verstuurt. Het certificaatarchief moet het bestemmingscertificaat valideren; proxy’s moeten API-verzoeken zonder interactieve authenticatie doorlaten. Pushaanbieders roepen geen webhook op OneUptime aan. De server kan privé blijven wanneer apparaten hem via VPN of een andere privéverbinding bereiken. Zonder toegang tot de relay of externe pushdiensten is bezorging onmogelijk.

Apparaten hebben afzonderlijke netwerkvereisten: iOS gebruikt APNs, doorgaans TCP 5223 met TCP 443 als terugval; zie de actuele adresbereiken van [Apple](https://support.apple.com/en-us/102266). Android gebruikt FCM via TCP 5228–5230 en 443; zie de actuele hosts en regels van [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). Open deze apparaatpoorten niet inkomend op OneUptime. De server gebruikt de relay of Expo voor mobiele push, niet rechtstreeks APNs/FCM.

Controleer DNS en HTTPS vanuit de verzendende container of pod naar de bestemming van de gekozen bezorgingswijze. Verstuur een test via **User Settings > Notification Methods > Push** en bevestig ontvangst op een geregistreerd apparaat. Test webpush per browser. Bekijk relay-, Expo- of web-push-fouten in de OneUptime-logboeken; API-acceptatie alleen bevestigt geen apparaatbezorging.

## Probleemoplossing

### Push-meldingen arriveren niet

- Zorg dat de mobiele app is gebouwd met EAS Build (Expo Go ondersteunt geen push-meldingen)
- Verifieer dat het apparaat is geregistreerd in de `UserPush`-tabel in uw database
- Controleer de OneUptime-serverlogboeken op Expo Push API-fouten
- Bevestig dat het apparaat een actieve internetverbinding heeft en meldingsmachtigingen zijn ingeschakeld

### "DeviceNotRegistered"-fouten in logboeken

Het Expo Push Token is niet langer geldig. Dit betekent meestal dat de app is verwijderd of de gebruiker meldingsmachtigingen heeft ingetrokken. Het token wordt automatisch opgeruimd.

## Ondersteuning

Als u problemen ondervindt met push-meldingen:

1. Controleer de bovenstaande sectie voor probleemoplossing
2. Bekijk de OneUptime-logboeken voor gedetailleerde foutmeldingen
3. Neem contact op via [hello@oneuptime.com](mailto:hello@oneuptime.com)

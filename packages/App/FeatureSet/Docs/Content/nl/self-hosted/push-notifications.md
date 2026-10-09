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
| OneUptime → standaardrelay | `https://oneuptime.com/api/notification/push-relay/send`, `https://oneuptime.com/api/notification/push-relay/receipts` | HTTPS / TCP 443 | Mobiele push zonder `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send`, `https://exp.host/--/api/v2/push/getReceipts` | HTTPS / TCP 443 | Rechtstreekse mobiele push met `EXPO_ACCESS_TOKEN`. |
| OneUptime → browserpushdienst | HTTPS-endpoint in het pushabonnement | HTTPS / doorgaans TCP 443 | Webpush. |
| Mobiele app of browser → OneUptime | Je OneUptime-hostnaam | HTTPS / TCP 443 | Aanmelden, apparaatregistratie en meldingslinks openen. |

Wijzig je `PUSH_NOTIFICATION_RELAY_URL`, sta dan de hostnaam en ingestelde poort toe. Een eigen relay moet de OneUptime-relay-API implementeren. Standaardwaarden en de keuze van bezorgingswijze staan in de [configuratie](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) en [pushdienst van OneUptime](https://github.com/OneUptime/oneuptime/blob/master/packages/Common/Server/Services/PushNotificationService.ts); [Expo](https://docs.expo.dev/push-notifications/sending-notifications/) beschrijft het rechtstreekse endpoint. OneUptime leest afleverbevestigingen bij de relay op hetzelfde adres, met `/receipts` in plaats van `/send`. Een relay zonder die route levert pushberichten nog steeds af; een apparaat waarvan de app is verwijderd, valt dan pas op wanneer een latere push ernaartoe wordt geweigerd.

Sta voor webpush de echte endpointhosts van de gebruikte browsers toe. OneUptime accepteert `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` en `push.apple.com`, inclusief subdomeinen zoals `updates.push.services.mozilla.com` en `web.push.apple.com`. Het [browserabonnement](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) bepaalt de bestemming. Alleen Expo of de relay toestaan maakt webpush niet mogelijk.

Sta DNS en uitgaand TLS toe vanuit het OneUptime-proces dat meldingen verstuurt. Het certificaatarchief moet het bestemmingscertificaat valideren; proxy’s moeten API-verzoeken zonder interactieve authenticatie doorlaten. Pushaanbieders roepen geen webhook op OneUptime aan. De server kan privé blijven wanneer apparaten hem via VPN of een andere privéverbinding bereiken. Zonder toegang tot de relay of externe pushdiensten is bezorging onmogelijk.

Apparaten hebben afzonderlijke netwerkvereisten: iOS gebruikt APNs, doorgaans TCP 5223 met TCP 443 als terugval; zie de actuele adresbereiken van [Apple](https://support.apple.com/en-us/102266). Android gebruikt FCM via TCP 5228–5230 en 443; zie de actuele hosts en regels van [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). Open deze apparaatpoorten niet inkomend op OneUptime. De server gebruikt de relay of Expo voor mobiele push, niet rechtstreeks APNs/FCM.

Controleer DNS en HTTPS vanuit de verzendende container of pod naar de bestemming van de gekozen bezorgingswijze. Verstuur een test via **User Settings > Notification Methods > Push** en bevestig ontvangst op een geregistreerd apparaat. Test webpush per browser. Bekijk relay-, Expo- of web-push-fouten in de OneUptime-logboeken; API-acceptatie alleen bevestigt geen apparaatbezorging. Voor mobiele pushberichten leest OneUptime ook ongeveer 15 minuten na elke push de afleverbevestiging van Expo: een push die het apparaat nooit heeft bereikt, staat dan als niet afgeleverd in het pushlogboek en, bij een on-call-melding, in de on-call-tijdlijn.

## Probleemoplossing

### Push-meldingen arriveren niet

- Zorg dat de mobiele app is gebouwd met EAS Build (Expo Go ondersteunt geen push-meldingen)
- Verifieer dat het apparaat is geregistreerd in de `UserPush`-tabel in uw database
- Controleer de OneUptime-serverlogboeken op Expo Push API-fouten
- Bevestig dat het apparaat een actieve internetverbinding heeft en meldingsmachtigingen zijn ingeschakeld
- Controleer **User Settings > Notification Methods > Push**: een apparaat dat als **Ontvangt geen meldingen** is gemarkeerd, ontvangt geen meldingen meer en moet opnieuw worden geregistreerd (zie hieronder)

### Pushberichten gemarkeerd als "niet afgeleverd"

Dat Expo een push accepteert, betekent niet dat die het apparaat heeft bereikt: Apple of Google kunnen hem nog weigeren. OneUptime leest de afleverbevestiging van elk mobiel pushbericht ongeveer 15 minuten na het verzenden, via de push-relay als `EXPO_ACCESS_TOKEN` niet is ingesteld. Meldt de bevestiging een fout, dan veranderen het pushlogboek en de on-call-tijdlijn van de melding van verzonden in **Push notification not delivered**, met de foutcode van Expo:

- `DeviceNotRegistered`: de mobiele app is van het apparaat verwijderd, of het pushtoken is niet meer geldig. Zie de volgende sectie.
- `MessageRateExceeded`: er zijn in korte tijd te veel meldingen naar het apparaat gestuurd. Latere pushberichten ernaartoe worden gewoon verzonden.
- `MessageTooBig`: de melding was groter dan pushdiensten accepteren. OneUptime kort meldingen in zodat ze passen, dus dit zou niet moeten gebeuren; meld het als het toch gebeurt.
- `InvalidCredentials` of `MismatchSenderId`: de pushreferenties van het Expo-project dat de push verstuurde, zijn niet geldig. Controleer met `EXPO_ACCESS_TOKEN` de pushreferenties van uw Expo-project; neem bij de standaardrelay contact op met OneUptime-support.

Weigert Expo een push meteen, dan vermeldt het pushlogboek de reden meteen. Via de push-relay werkt dat ook: de relay geeft de foutcode van Expo door in plaats van te antwoorden met een serverfout.

### "DeviceNotRegistered"-fouten in logboeken

Expo meldt `DeviceNotRegistered` wanneer de mobiele app van het apparaat is verwijderd of het pushtoken van het apparaat niet meer geldig is. Meestal staat dat in de afleverbevestiging van een push, die OneUptime ongeveer 15 minuten na het verzenden leest, en soms weigert Expo de push meteen. In beide gevallen stuurt OneUptime niets meer naar dat apparaat. Het wordt gemarkeerd als niet meer ontvangend in plaats van verwijderd, zodat de meldingsregels behouden blijven, en het pushlogboek en de on-call-tijdlijn van de melding die niet aankwam, vermelden waarom. **User Settings > Notification Methods > Push** toont het als **Ontvangt geen meldingen**. De andere apparaten en meldingsmethoden van de eigenaar worden nog steeds gewaarschuwd.

Om het apparaat terug te krijgen, opent u de mobiele app erop terwijl u bent ingelogd. De app registreert zich opnieuw, waardoor het pushtoken bij Expo wordt vernieuwd, en het apparaat ontvangt weer meldingen met zijn regels. Is de app verwijderd, installeer hem dan opnieuw en log in. Een bevestiging van een push die werd verzonden voordat de app zich opnieuw registreerde, markeert het apparaat niet. Wanneer een bijgewerkte mobiele app op een nieuwe telefoon wordt ingesteld vanuit een back-up van de oude, geeft de app OneUptime het pushtoken door dat hij eerder had; ontvangt het apparaat van de oude telefoon geen meldingen meer, dan neemt de nieuwe telefoon het met zijn regels over.

Via de push-relay (zonder `EXPO_ACCESS_TOKEN`) werkt dit op dezelfde manier: de relay meldt `DeviceNotRegistered` wanneer hij een push verstuurt, en leest de afleverbevestigingen waar uw instantie om vraagt.

## Ondersteuning

Als u problemen ondervindt met push-meldingen:

1. Controleer de bovenstaande sectie voor probleemoplossing
2. Bekijk de OneUptime-logboeken voor gedetailleerde foutmeldingen
3. Neem contact op via [hello@oneuptime.com](mailto:hello@oneuptime.com)

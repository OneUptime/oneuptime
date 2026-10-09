# Push-aviseringar

Inbyggda push-aviseringar (iOS/Android) använder **Expo Push**. Egeninstallerade instanser använder OneUptimes push-relä som standard och behöver utgående nätverksåtkomst till det.

## Hur det fungerar

OneUptimes mobilapp registrerar en Expo Push Token hos backend. Backend skickar via OneUptimes relä eller direkt till Expo när `EXPO_ACCESS_TOKEN` har konfigurerats. Expo vidarebefordrar till Apple APNs eller Google FCM för leverans till enheten.

Webb-push-aviseringar fortsätter att använda VAPID-nycklar och Web Push-protokollet.

## Konfiguration för egeninstallation

Den officiella mobilappen med standardreläet kräver inga Expo-uppgifter på servern. För direktleverans konfigurerar du `EXPO_ACCESS_TOKEN` med behörighetsuppgifter för appens Expo-projekt. Webb-push kräver `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` och `VAPID_SUBJECT`.

## Nätverksåtkomst

| Riktning | Destination | Protokoll / port | När det krävs |
| --- | --- | --- | --- |
| OneUptime → standardrelä | `https://oneuptime.com/api/notification/push-relay/send`, `https://oneuptime.com/api/notification/push-relay/receipts` | HTTPS / TCP 443 | Mobil push utan `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send`, `https://exp.host/--/api/v2/push/getReceipts` | HTTPS / TCP 443 | Direkt mobil push med `EXPO_ACCESS_TOKEN`. |
| OneUptime → webbläsarens push-tjänst | HTTPS-endpoint i push-prenumerationen | HTTPS / normalt TCP 443 | Webb-push. |
| Mobilapp eller webbläsare → OneUptime | Ditt OneUptime-värdnamn | HTTPS / TCP 443 | Inloggning, enhetsregistrering och öppning av aviseringslänkar. |

Om `PUSH_NOTIFICATION_RELAY_URL` ändras, tillåt dess värdnamn och konfigurerade port. Ett eget relä måste implementera OneUptimes relä-API. Standardvärden och val av leveransväg finns i [konfigurationen](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) och [OneUptimes push-tjänst](https://github.com/OneUptime/oneuptime/blob/master/packages/Common/Server/Services/PushNotificationService.ts); direktendpointen beskrivs av [Expo](https://docs.expo.dev/push-notifications/sending-notifications/). OneUptime hämtar leveranskvitton från reläet på samma adress med `/receipts` i stället för `/send`. Ett relä utan den vägen levererar fortfarande push-aviseringar; en enhet vars app har tagits bort upptäcks då först när en senare push till den avvisas.

För webb-push tillåter du de faktiska endpointvärdarna för teamets webbläsare. OneUptime accepterar `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` och `push.apple.com` med underdomäner, exempelvis `updates.push.services.mozilla.com` och `web.push.apple.com`. [Webbläsarprenumerationen](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) anger destinationen. Tillgång enbart till Expo eller reläet aktiverar inte webb-push.

Tillåt DNS och utgående TLS från OneUptime-processen som skickar aviseringar. Dess certifikatlager måste validera destinationscertifikatet; proxyer måste släppa igenom API-anrop utan interaktiv autentisering. Push-leverantörerna anropar ingen webhook på OneUptime. Servern kan förbli privat om enheterna når den via VPN eller annan privat anslutning. Utan åtkomst till reläet eller externa push-tjänster kan aviseringarna inte levereras.

Enheterna har separata nätverkskrav: iOS behöver APNs, normalt TCP 5223 med TCP 443 som reserv; se aktuella destinationsnät hos [Apple](https://support.apple.com/en-us/102266). Android behöver FCM på TCP 5228–5230 och 443; se aktuella värdar och regler hos [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). Öppna inte dessa enhetsportar inkommande på OneUptime. Serverns mobila push använder reläet eller Expo, inte direkt APNs/FCM.

Kontrollera DNS och HTTPS från den sändande containern eller podden till destinationen för vald leveransväg. Skicka ett test via **User Settings > Notification Methods > Push** och bekräfta mottagning på en registrerad enhet. Testa varje webbläsare separat för webb-push. Kontrollera relä-, Expo- eller web-push-fel i OneUptime-loggarna; att API:et accepterar anropet bekräftar inte enhetsleverans. För mobila push-aviseringar hämtar OneUptime också Expos leveranskvitto ungefär 15 minuter efter varje push: en push som aldrig nådde enheten visas då som inte levererad i push-loggen och, för ett jourlarm, på jourtidslinjen.

## Felsökning

### Push-aviseringar anländer inte

- Se till att mobilappen byggdes med EAS Build (Expo Go stöder inte push-aviseringar)
- Verifiera att enheten är registrerad i tabellen `UserPush` i din databas
- Kontrollera OneUptime-serverloggarna efter Expo Push API-fel
- Bekräfta att enheten har en aktiv internetanslutning och aviseringsbehörigheter aktiverade
- Kontrollera **User Settings > Notification Methods > Push**: en enhet som är markerad **Tar inte emot aviseringar** har slutat ta emot dem och måste registreras igen (se nedan)

### Push-aviseringar markerade som "inte levererad"

Att Expo tar emot en push betyder inte att den nådde enheten: Apple eller Google kan fortfarande avvisa den. OneUptime hämtar leveranskvittot för varje mobil push-avisering ungefär 15 minuter efter att den skickats, via push-reläet när `EXPO_ACCESS_TOKEN` inte är satt. När kvittot rapporterar ett fel ändras push-loggen och jourtidslinjen för larmet från skickad till **Push notification not delivered**, med Expos felkod:

- `DeviceNotRegistered`: mobilappen har tagits bort från enheten, eller dess push-token är inte längre giltig. Se nästa avsnitt.
- `MessageRateExceeded`: för många aviseringar skickades till enheten på kort tid. Senare push-aviseringar till den skickas som vanligt.
- `MessageTooBig`: aviseringen var större än vad push-tjänsterna tar emot. OneUptime kortar aviseringar så att de får plats, så detta bör inte hända; rapportera det om det händer.
- `InvalidCredentials` eller `MismatchSenderId`: push-autentiseringsuppgifterna för Expo-projektet som skickade pushen är inte giltiga. Med `EXPO_ACCESS_TOKEN` kontrollerar du push-autentiseringsuppgifterna för ditt Expo-projekt; med standardreläet kontaktar du OneUptimes support.

När Expo avvisar en push direkt anger push-loggen orsaken direkt. Via push-reläet fungerar det också: reläet vidarebefordrar Expos felkod i stället för att svara med ett serverfel.

### "DeviceNotRegistered"-fel i loggar

Expo rapporterar `DeviceNotRegistered` när mobilappen har tagits bort från enheten eller enhetens push-token inte längre är giltig. Oftast står det i leveranskvittot för en push, som OneUptime hämtar ungefär 15 minuter efter att den skickats, och ibland avvisar Expo pushen direkt. I båda fallen slutar OneUptime skicka till den enheten. Den markeras som att den inte tar emot aviseringar i stället för att raderas, så att dess aviseringsregler finns kvar, och push-loggen och jourtidslinjen för larmet som inte kom fram anger varför. **User Settings > Notification Methods > Push** visar den som **Tar inte emot aviseringar**. Ägarens andra enheter och aviseringsmetoder larmas fortfarande.

För att få tillbaka enheten öppnar du mobilappen på den medan du är inloggad. Appen registrerar sig igen, vilket förnyar dess push-token hos Expo, och enheten tar emot aviseringar igen med sina regler. Om appen har tagits bort installerar du den igen och loggar in. Ett kvitto för en push som skickades innan appen registrerade sig igen markerar inte enheten. När en uppdaterad mobilapp ställs in på en ny telefon från en säkerhetskopia av den gamla talar den om för OneUptime vilken push-token den hade tidigare, och den gamla telefonens enhet flyttas med sina regler till den nya.

Via push-reläet (utan `EXPO_ACCESS_TOKEN`) fungerar det på samma sätt: reläet rapporterar `DeviceNotRegistered` när det skickar en push och hämtar de leveranskvitton som din instans frågar efter.

## Support

Om du stöter på problem med push-aviseringar:

1. Kontrollera felsökningsavsnittet ovan
2. Granska OneUptime-loggarna för detaljerade felmeddelanden
3. Kontakta oss på [hello@oneuptime.com](mailto:hello@oneuptime.com)

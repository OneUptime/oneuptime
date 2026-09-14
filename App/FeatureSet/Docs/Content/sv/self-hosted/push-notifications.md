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
| OneUptime → standardrelä | `https://oneuptime.com/api/notification/push-relay/send` | HTTPS / TCP 443 | Mobil push utan `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send` | HTTPS / TCP 443 | Direkt mobil push med `EXPO_ACCESS_TOKEN`. |
| OneUptime → webbläsarens push-tjänst | HTTPS-endpoint i push-prenumerationen | HTTPS / normalt TCP 443 | Webb-push. |
| Mobilapp eller webbläsare → OneUptime | Ditt OneUptime-värdnamn | HTTPS / TCP 443 | Inloggning, enhetsregistrering och öppning av aviseringslänkar. |

Om `PUSH_NOTIFICATION_RELAY_URL` ändras, tillåt dess värdnamn och konfigurerade port. Ett eget relä måste implementera OneUptimes relä-API. Standardvärden och val av leveransväg finns i [konfigurationen](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) och [OneUptimes push-tjänst](https://github.com/OneUptime/oneuptime/blob/master/Common/Server/Services/PushNotificationService.ts); direktendpointen beskrivs av [Expo](https://docs.expo.dev/push-notifications/sending-notifications/).

För webb-push tillåter du de faktiska endpointvärdarna för teamets webbläsare. OneUptime accepterar `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` och `push.apple.com` med underdomäner, exempelvis `updates.push.services.mozilla.com` och `web.push.apple.com`. [Webbläsarprenumerationen](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) anger destinationen. Tillgång enbart till Expo eller reläet aktiverar inte webb-push.

Tillåt DNS och utgående TLS från OneUptime-processen som skickar aviseringar. Dess certifikatlager måste validera destinationscertifikatet; proxyer måste släppa igenom API-anrop utan interaktiv autentisering. Push-leverantörerna anropar ingen webhook på OneUptime. Servern kan förbli privat om enheterna når den via VPN eller annan privat anslutning. Utan åtkomst till reläet eller externa push-tjänster kan aviseringarna inte levereras.

Enheterna har separata nätverkskrav: iOS behöver APNs, normalt TCP 5223 med TCP 443 som reserv; se aktuella destinationsnät hos [Apple](https://support.apple.com/en-us/102266). Android behöver FCM på TCP 5228–5230 och 443; se aktuella värdar och regler hos [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). Öppna inte dessa enhetsportar inkommande på OneUptime. Serverns mobila push använder reläet eller Expo, inte direkt APNs/FCM.

Kontrollera DNS och HTTPS från den sändande containern eller podden till destinationen för vald leveransväg. Skicka ett test via **User Settings > Notification Methods > Push** och bekräfta mottagning på en registrerad enhet. Testa varje webbläsare separat för webb-push. Kontrollera relä-, Expo- eller web-push-fel i OneUptime-loggarna; att API:et accepterar anropet bekräftar inte enhetsleverans.

## Felsökning

### Push-aviseringar anländer inte

- Se till att mobilappen byggdes med EAS Build (Expo Go stöder inte push-aviseringar)
- Verifiera att enheten är registrerad i tabellen `UserPush` i din databas
- Kontrollera OneUptime-serverloggarna efter Expo Push API-fel
- Bekräfta att enheten har en aktiv internetanslutning och aviseringsbehörigheter aktiverade

### "DeviceNotRegistered"-fel i loggar

Expo Push-token är inte längre giltig. Det beror vanligtvis på att appen avinstallerades eller att användaren återkallade aviserings behörigheter. Token rensas upp automatiskt.

## Support

Om du stöter på problem med push-aviseringar:

1. Kontrollera felsökningsavsnittet ovan
2. Granska OneUptime-loggarna för detaljerade felmeddelanden
3. Kontakta oss på [hello@oneuptime.com](mailto:hello@oneuptime.com)

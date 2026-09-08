# Push-notifikationer

Native push-notifikationer (iOS/Android) bruger **Expo Push**. Selvhostede instanser bruger som standard OneUptimes push-relay og skal have udgående netværksadgang til det.

## Sådan fungerer det

OneUptimes mobilapp registrerer et Expo Push Token hos backenden. Backenden sender via OneUptimes relay eller direkte til Expo, når `EXPO_ACCESS_TOKEN` er konfigureret. Expo videresender til Apple APNs eller Google FCM til levering på enheden.

Web push-notifikationer fortsætter med at bruge VAPID-nøgler og Web Push-protokollen.

## Selvhostet opsætning

Den officielle mobilapp og standard-relayet kræver ingen Expo-legitimationsoplysninger på serveren. Ved direkte levering skal `EXPO_ACCESS_TOKEN` bruge legitimationsoplysninger for appens Expo-projekt. Web push kræver `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` og `VAPID_SUBJECT`.

## Netværksadgang

| Retning | Destination | Protokol / port | Hvornår |
| --- | --- | --- | --- |
| OneUptime → standard-relay | `https://oneuptime.com/api/notification/push-relay/send` | HTTPS / TCP 443 | Mobil push uden `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send` | HTTPS / TCP 443 | Direkte mobil push med `EXPO_ACCESS_TOKEN`. |
| OneUptime → browserens push-tjeneste | HTTPS-endpoint i push-abonnementet | HTTPS / normalt TCP 443 | Web push. |
| Mobilapp eller browser → OneUptime | Dit OneUptime-værtsnavn | HTTPS / TCP 443 | Login, enhedsregistrering og åbning af notifikationslinks. |

Ændres `PUSH_NOTIFICATION_RELAY_URL`, tillad dets værtsnavn og konfigurerede port. Et eget relay skal implementere OneUptimes relay-API. Se standardværdier og valg af leveringsvej i [konfigurationen](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) og [OneUptimes push-tjeneste](https://github.com/OneUptime/oneuptime/blob/master/Common/Server/Services/PushNotificationService.ts); det direkte endpoint er dokumenteret hos [Expo](https://docs.expo.dev/push-notifications/sending-notifications/).

Ved web push tillades de faktiske endpoint-værter for teamets browsere. OneUptime accepterer `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` og `push.apple.com` samt underdomæner, fx `updates.push.services.mozilla.com` og `web.push.apple.com`. [Browserabonnementet](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) angiver destinationen. Adgang alene til Expo eller relayet aktiverer ikke web push.

Tillad DNS og udgående TLS fra den OneUptime-proces, der sender notifikationer. Dens certifikatlager skal kunne validere destinationens certifikat; proxyer skal tillade API-kald uden interaktiv godkendelse. Push-udbyderne kalder ingen webhook på OneUptime. Serveren kan forblive privat, hvis enhederne kan nå den via VPN eller anden privat forbindelse. Uden adgang til relay eller eksterne push-tjenester kan notifikationerne ikke leveres.

Enheder har separate forbindelseskrav: iOS kræver APNs, normalt TCP 5223 med TCP 443 som reserve; se aktuelle destinationsområder hos [Apple](https://support.apple.com/en-us/102266). Android kræver FCM på TCP 5228–5230 og 443; se aktuelle værter og regler hos [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). Åbn ikke disse enhedsporte indgående på OneUptime. Serverens mobile push bruger relay eller Expo frem for direkte APNs/FCM.

Kontrollér DNS og HTTPS fra den afsendende container eller pod til destinationen for den valgte leveringsvej. Send en test via **User Settings > Notification Methods > Push**, og bekræft modtagelse på en registreret enhed. Test hver browser separat for web push. Se relay-, Expo- eller web-push-fejl i OneUptime-loggene; API-accept alene bekræfter ikke enhedslevering.

## Fejlfinding

### Push-notifikationer ankommer ikke

- Sørg for, at mobilappen er bygget med EAS Build (Expo Go understøtter ikke push-notifikationer)
- Bekræft, at enheden er registreret i `UserPush`-tabellen i din database
- Kontroller OneUptime-serverlogge for Expo Push API-fejl
- Bekræft, at enheden har en aktiv internetforbindels og notifikationstilladelser aktiveret

### "DeviceNotRegistered"-fejl i logge

Expo Push Token er ikke længere gyldigt. Dette betyder normalt, at appen er afinstalleret, eller at brugeren har tilbagekaldt notifikationstilladelser. Token'et ryddes automatisk.

## Support

Hvis du støder på problemer med push-notifikationer:

1. Kontroller fejlfindingsafsnittet ovenfor
2. Gennemgå OneUptime-logs for detaljerede fejlmeddelelser
3. Kontakt os på [hello@oneuptime.com](mailto:hello@oneuptime.com)

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
| OneUptime → standard-relay | `https://oneuptime.com/api/notification/push-relay/send`, `https://oneuptime.com/api/notification/push-relay/receipts` | HTTPS / TCP 443 | Mobil push uden `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send`, `https://exp.host/--/api/v2/push/getReceipts` | HTTPS / TCP 443 | Direkte mobil push med `EXPO_ACCESS_TOKEN`. |
| OneUptime → browserens push-tjeneste | HTTPS-endpoint i push-abonnementet | HTTPS / normalt TCP 443 | Web push. |
| Mobilapp eller browser → OneUptime | Dit OneUptime-værtsnavn | HTTPS / TCP 443 | Login, enhedsregistrering og åbning af notifikationslinks. |

Ændres `PUSH_NOTIFICATION_RELAY_URL`, tillad dets værtsnavn og konfigurerede port. Et eget relay skal implementere OneUptimes relay-API. Se standardværdier og valg af leveringsvej i [konfigurationen](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) og [OneUptimes push-tjeneste](https://github.com/OneUptime/oneuptime/blob/master/packages/Common/Server/Services/PushNotificationService.ts); det direkte endpoint er dokumenteret hos [Expo](https://docs.expo.dev/push-notifications/sending-notifications/). OneUptime henter leveringskvitteringer fra relayet på samme adresse med `/receipts` i stedet for `/send`. Et relay uden den rute leverer stadig push-beskeder; en enhed, hvis app er fjernet, opdages så først, når en senere push til den bliver afvist.

Ved web push tillades de faktiske endpoint-værter for teamets browsere. OneUptime accepterer `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` og `push.apple.com` samt underdomæner, fx `updates.push.services.mozilla.com` og `web.push.apple.com`. [Browserabonnementet](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) angiver destinationen. Adgang alene til Expo eller relayet aktiverer ikke web push.

Tillad DNS og udgående TLS fra den OneUptime-proces, der sender notifikationer. Dens certifikatlager skal kunne validere destinationens certifikat; proxyer skal tillade API-kald uden interaktiv godkendelse. Push-udbyderne kalder ingen webhook på OneUptime. Serveren kan forblive privat, hvis enhederne kan nå den via VPN eller anden privat forbindelse. Uden adgang til relay eller eksterne push-tjenester kan notifikationerne ikke leveres.

Enheder har separate forbindelseskrav: iOS kræver APNs, normalt TCP 5223 med TCP 443 som reserve; se aktuelle destinationsområder hos [Apple](https://support.apple.com/en-us/102266). Android kræver FCM på TCP 5228–5230 og 443; se aktuelle værter og regler hos [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). Åbn ikke disse enhedsporte indgående på OneUptime. Serverens mobile push bruger relay eller Expo frem for direkte APNs/FCM.

Kontrollér DNS og HTTPS fra den afsendende container eller pod til destinationen for den valgte leveringsvej. Send en test via **User Settings > Notification Methods > Push**, og bekræft modtagelse på en registreret enhed. Test hver browser separat for web push. Se relay-, Expo- eller web-push-fejl i OneUptime-loggene; API-accept alene bekræfter ikke enhedslevering. For mobile push-beskeder henter OneUptime også Expos leveringskvittering cirka 15 minutter efter hver push: en push, der aldrig nåede enheden, vises så som ikke leveret i push-loggen og, for et vagtkald, på vagttidslinjen.

## Fejlfinding

### Push-notifikationer ankommer ikke

- Sørg for, at mobilappen er bygget med EAS Build (Expo Go understøtter ikke push-notifikationer)
- Bekræft, at enheden er registreret i `UserPush`-tabellen i din database
- Kontroller OneUptime-serverlogge for Expo Push API-fejl
- Bekræft, at enheden har en aktiv internetforbindels og notifikationstilladelser aktiveret
- Tjek **User Settings > Notification Methods > Push**: en enhed markeret **Modtager ikke notifikationer** er holdt op med at modtage dem og skal registreres igen (se nedenfor)

### Push-beskeder markeret som "ikke leveret"

At Expo accepterer en push, betyder ikke, at den nåede enheden: Apple eller Google kan stadig afvise den. OneUptime henter hver mobil push-beskeds leveringskvittering cirka 15 minutter efter afsendelsen, via push-relayet når `EXPO_ACCESS_TOKEN` ikke er sat. Når kvitteringen melder en fejl, skifter push-loggen og vagttidslinjen for kaldet fra sendt til **Push notification not delivered**, med Expos fejlkode:

- `DeviceNotRegistered`: mobilappen er fjernet fra enheden, eller dens push-token er ikke længere gyldigt. Se næste afsnit.
- `MessageRateExceeded`: der blev sendt for mange notifikationer til enheden på kort tid. Senere push-beskeder til den sendes som normalt.
- `MessageTooBig`: notifikationen var større, end push-tjenesterne accepterer. OneUptime forkorter notifikationer, så de passer, så dette bør ikke ske; rapportér det venligst, hvis det sker.
- `InvalidCredentials` eller `MismatchSenderId`: push-legitimationsoplysningerne for det Expo-projekt, der sendte push-beskeden, er ikke gyldige. Med `EXPO_ACCESS_TOKEN` skal du kontrollere dit Expo-projekts push-legitimationsoplysninger; med standard-relayet skal du kontakte OneUptime-support.

Når Expo afviser en push med det samme, angiver push-loggen årsagen med det samme. Via push-relayet virker det også: relayet videregiver Expos fejlkode i stedet for at svare med en serverfejl.

### "DeviceNotRegistered"-fejl i logge

Expo melder `DeviceNotRegistered`, når mobilappen er fjernet fra enheden, eller enhedens push-token ikke længere er gyldigt. Som regel står det i en push-beskeds leveringskvittering, som OneUptime henter cirka 15 minutter efter afsendelsen, og nogle gange afviser Expo push-beskeden med det samme. Under alle omstændigheder holder OneUptime op med at sende til den enhed. Den markeres som ikke modtagende i stedet for at blive slettet, så dens notifikationsregler bevares, og push-loggen og vagttidslinjen for det kald, der ikke nåede frem, fortæller hvorfor. **User Settings > Notification Methods > Push** viser den som **Modtager ikke notifikationer**. Ejerens andre enheder og notifikationsmetoder får stadig besked.

For at få enheden tilbage åbner du mobilappen på den, mens du er logget ind. Appen registrerer sig igen, hvilket fornyer dens push-token hos Expo, og enheden modtager igen notifikationer med sine regler. Hvis appen er fjernet, så installer den igen og log ind. En kvittering for en push, der blev sendt, før appen registrerede sig igen, markerer ikke enheden. Når en opdateret mobilapp sættes op på en ny telefon fra en sikkerhedskopi af den gamle, fortæller den OneUptime, hvilket push-token den havde før, og den gamle telefons enhed flytter med sine regler over til den nye telefon.

Via push-relayet (uden `EXPO_ACCESS_TOKEN`) virker det på samme måde: relayet melder `DeviceNotRegistered`, når det sender en push, og henter de leveringskvitteringer, din instans spørger efter.

## Support

Hvis du støder på problemer med push-notifikationer:

1. Kontroller fejlfindingsafsnittet ovenfor
2. Gennemgå OneUptime-logs for detaljerede fejlmeddelelser
3. Kontakt os på [hello@oneuptime.com](mailto:hello@oneuptime.com)

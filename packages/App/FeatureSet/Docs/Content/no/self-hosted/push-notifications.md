# Push-varsler

Native push-varsler (iOS/Android) bruker **Expo Push**. Selvhostede instanser bruker OneUptimes push-relé som standard og trenger utgående nettverkstilgang til det.

## Slik fungerer det

OneUptimes mobilapp registrerer et Expo Push Token hos backend. Backend sender via OneUptimes relé, eller direkte til Expo når `EXPO_ACCESS_TOKEN` er konfigurert. Expo videresender til Apple APNs eller Google FCM for levering til enheten.

Nettleser-push-varsler fortsetter å bruke VAPID-nøkler og Web Push-protokollen.

## Oppsett for selvhostede installasjoner

Den offisielle mobilappen med standardreléet krever ingen Expo-legitimasjon på serveren. For direkte levering må `EXPO_ACCESS_TOKEN` bruke legitimasjon for appens Expo-prosjekt. Nettleser-push krever `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` og `VAPID_SUBJECT`.

## Nettverkstilgang

| Retning | Destinasjon | Protokoll / port | Når nødvendig |
| --- | --- | --- | --- |
| OneUptime → standardrelé | `https://oneuptime.com/api/notification/push-relay/send`, `https://oneuptime.com/api/notification/push-relay/receipts` | HTTPS / TCP 443 | Mobil push uten `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send`, `https://exp.host/--/api/v2/push/getReceipts` | HTTPS / TCP 443 | Direkte mobil push med `EXPO_ACCESS_TOKEN`. |
| OneUptime → nettleserens push-tjeneste | HTTPS-endepunkt i push-abonnementet | HTTPS / vanligvis TCP 443 | Nettleser-push. |
| Mobilapp eller nettleser → OneUptime | Ditt OneUptime-vertsnavn | HTTPS / TCP 443 | Innlogging, enhetsregistrering og åpning av varslingslenker. |

Endres `PUSH_NOTIFICATION_RELAY_URL`, tillat vertsnavnet og den konfigurerte porten. Et eget relé må implementere OneUptimes relé-API. Se standardverdier og valg av leveringsmåte i [konfigurasjonen](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) og [OneUptimes push-tjeneste](https://github.com/OneUptime/oneuptime/blob/master/packages/Common/Server/Services/PushNotificationService.ts); det direkte endepunktet er dokumentert hos [Expo](https://docs.expo.dev/push-notifications/sending-notifications/). OneUptime henter leveringskvitteringer fra reléet på samme adresse med `/receipts` i stedet for `/send`. Et relé uten den ruten leverer fortsatt push-varsler; en enhet der appen er fjernet, blir da først oppdaget når en senere push til den blir avvist.

For nettleser-push må de faktiske endepunktvertene for nettleserne tillates. OneUptime godtar `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` og `push.apple.com`, inkludert underdomener som `updates.push.services.mozilla.com` og `web.push.apple.com`. [Nettleserabonnementet](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) angir destinasjonen. Tilgang bare til Expo eller reléet aktiverer ikke nettleser-push.

Tillat DNS og utgående TLS fra OneUptime-prosessen som sender varsler. Sertifikatlageret må validere destinasjonens sertifikat; proxyer må slippe gjennom API-kall uten interaktiv autentisering. Push-leverandører kaller ingen webhook på OneUptime. Serveren kan forbli privat hvis enhetene når den via VPN eller annen privat forbindelse. Uten tilgang til reléet eller eksterne push-tjenester kan varslene ikke leveres.

Enhetene har egne nettverkskrav: iOS trenger APNs, vanligvis TCP 5223 med TCP 443 som reserve; se gjeldende destinasjonsområder hos [Apple](https://support.apple.com/en-us/102266). Android trenger FCM på TCP 5228–5230 og 443; se gjeldende verter og regler hos [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). Ikke åpne disse enhetsportene innkommende på OneUptime. Serverens mobile push bruker relé eller Expo, ikke direkte APNs/FCM.

Kontroller DNS og HTTPS fra sendende container eller pod til destinasjonen for valgt leveringsmåte. Send en test via **User Settings > Notification Methods > Push**, og bekreft mottak på en registrert enhet. Test hver nettleser separat. Se relé-, Expo- eller web-push-feil i OneUptime-loggene; API-aksept alene bekrefter ikke levering til enheten. For mobile push-varsler henter OneUptime også Expos leveringskvittering omtrent 15 minutter etter hver push: en push som aldri nådde enheten, vises da som ikke levert i push-loggen og, for et vaktvarsel, på vakttidslinjen.

## Feilsøking

### Push-varsler ankommer ikke

- Sørg for at mobilappen ble bygget med EAS Build (Expo Go støtter ikke push-varsler)
- Verifiser at enheten er registrert i `UserPush`-tabellen i databasen din
- Sjekk OneUptime-serverlogger for Expo Push API-feil
- Bekreft at enheten har en aktiv internettilkobling og varslingstillatelser aktivert
- Sjekk **User Settings > Notification Methods > Push**: en enhet merket **Mottar ikke varsler** har sluttet å motta dem og må registreres på nytt (se nedenfor)

### Push-varsler merket som "ikke levert"

At Expo godtar en push, betyr ikke at den nådde enheten: Apple eller Google kan fortsatt avvise den. OneUptime henter leveringskvitteringen for hvert mobile push-varsel omtrent 15 minutter etter sending, via push-reléet når `EXPO_ACCESS_TOKEN` ikke er satt. Når kvitteringen melder en feil, endres push-loggen og vakttidslinjen for varselet fra sendt til **Push notification not delivered**, med Expos feilkode:

- `DeviceNotRegistered`: mobilappen er fjernet fra enheten, eller push-tokenet er ikke lenger gyldig. Se neste avsnitt.
- `MessageRateExceeded`: det ble sendt for mange varsler til enheten på kort tid. Senere push-varsler til den sendes som vanlig.
- `MessageTooBig`: varselet var større enn push-tjenestene godtar. OneUptime forkorter varsler så de får plass, så dette bør ikke skje; meld fra hvis det skjer.
- `InvalidCredentials` eller `MismatchSenderId`: push-legitimasjonen til Expo-prosjektet som sendte pushen, er ikke gyldig. Med `EXPO_ACCESS_TOKEN` kontrollerer du push-legitimasjonen til Expo-prosjektet ditt; med standardreléet kontakter du OneUptime-support.

Når Expo avviser en push med en gang, oppgir push-loggen årsaken med en gang. Via push-reléet fungerer det også: reléet videreformidler Expos feilkode i stedet for å svare med en serverfeil.

### "DeviceNotRegistered"-feil i logger

Expo melder `DeviceNotRegistered` når mobilappen er fjernet fra enheten eller enhetens push-token ikke lenger er gyldig. Vanligvis står det i leveringskvitteringen for en push, som OneUptime henter omtrent 15 minutter etter sending, og noen ganger avviser Expo pushen med en gang. Uansett slutter OneUptime å sende til den enheten. Den merkes som ikke mottakende i stedet for å bli slettet, så varslingsreglene beholdes, og push-loggen og vakttidslinjen for varselet som ikke kom frem, forteller hvorfor. **User Settings > Notification Methods > Push** viser den som **Mottar ikke varsler**. Eierens andre enheter og varslingsmetoder blir fortsatt varslet.

For å få enheten tilbake åpner du mobilappen på den mens du er logget inn. Appen registrerer seg på nytt, noe som fornyer push-tokenet hos Expo, og enheten mottar varsler igjen med reglene sine. Hvis appen er fjernet, installerer du den på nytt og logger inn. En kvittering for en push som ble sendt før appen registrerte seg på nytt, merker ikke enheten. Når en oppdatert mobilapp settes opp på en ny telefon fra en sikkerhetskopi av den gamle, forteller den OneUptime hvilket push-token den hadde før; hvis enheten til den gamle telefonen ikke lenger mottar varsler, overtar den nye telefonen den med reglene sine.

Via push-reléet (uten `EXPO_ACCESS_TOKEN`) fungerer dette på samme måte: reléet melder `DeviceNotRegistered` når det sender en push, og henter leveringskvitteringene som instansen din spør om.

## Støtte

Hvis du støter på problemer med push-varsler, vennligst:

1. Sjekk feilsøkingsseksjonen ovenfor
2. Se gjennom OneUptime-loggene for detaljerte feilmeldinger
3. Kontakt oss på [hello@oneuptime.com](mailto:hello@oneuptime.com)

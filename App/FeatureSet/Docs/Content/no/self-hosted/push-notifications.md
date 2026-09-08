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
| OneUptime → standardrelé | `https://oneuptime.com/api/notification/push-relay/send` | HTTPS / TCP 443 | Mobil push uten `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send` | HTTPS / TCP 443 | Direkte mobil push med `EXPO_ACCESS_TOKEN`. |
| OneUptime → nettleserens push-tjeneste | HTTPS-endepunkt i push-abonnementet | HTTPS / vanligvis TCP 443 | Nettleser-push. |
| Mobilapp eller nettleser → OneUptime | Ditt OneUptime-vertsnavn | HTTPS / TCP 443 | Innlogging, enhetsregistrering og åpning av varslingslenker. |

Endres `PUSH_NOTIFICATION_RELAY_URL`, tillat vertsnavnet og den konfigurerte porten. Et eget relé må implementere OneUptimes relé-API. Se standardverdier og valg av leveringsmåte i [konfigurasjonen](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) og [OneUptimes push-tjeneste](https://github.com/OneUptime/oneuptime/blob/master/Common/Server/Services/PushNotificationService.ts); det direkte endepunktet er dokumentert hos [Expo](https://docs.expo.dev/push-notifications/sending-notifications/).

For nettleser-push må de faktiske endepunktvertene for nettleserne tillates. OneUptime godtar `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` og `push.apple.com`, inkludert underdomener som `updates.push.services.mozilla.com` og `web.push.apple.com`. [Nettleserabonnementet](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) angir destinasjonen. Tilgang bare til Expo eller reléet aktiverer ikke nettleser-push.

Tillat DNS og utgående TLS fra OneUptime-prosessen som sender varsler. Sertifikatlageret må validere destinasjonens sertifikat; proxyer må slippe gjennom API-kall uten interaktiv autentisering. Push-leverandører kaller ingen webhook på OneUptime. Serveren kan forbli privat hvis enhetene når den via VPN eller annen privat forbindelse. Uten tilgang til reléet eller eksterne push-tjenester kan varslene ikke leveres.

Enhetene har egne nettverkskrav: iOS trenger APNs, vanligvis TCP 5223 med TCP 443 som reserve; se gjeldende destinasjonsområder hos [Apple](https://support.apple.com/en-us/102266). Android trenger FCM på TCP 5228–5230 og 443; se gjeldende verter og regler hos [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). Ikke åpne disse enhetsportene innkommende på OneUptime. Serverens mobile push bruker relé eller Expo, ikke direkte APNs/FCM.

Kontroller DNS og HTTPS fra sendende container eller pod til destinasjonen for valgt leveringsmåte. Send en test via **User Settings > Notification Methods > Push**, og bekreft mottak på en registrert enhet. Test hver nettleser separat. Se relé-, Expo- eller web-push-feil i OneUptime-loggene; API-aksept alene bekrefter ikke levering til enheten.

## Feilsøking

### Push-varsler ankommer ikke

- Sørg for at mobilappen ble bygget med EAS Build (Expo Go støtter ikke push-varsler)
- Verifiser at enheten er registrert i `UserPush`-tabellen i databasen din
- Sjekk OneUptime-serverlogger for Expo Push API-feil
- Bekreft at enheten har en aktiv internettilkobling og varslingstillatelser aktivert

### "DeviceNotRegistered"-feil i logger

Expo Push-tokenet er ikke lenger gyldig. Dette betyr vanligvis at appen ble avinstallert eller brukeren tilbakekalte varslingstillatelser. Tokenet vil ryddes opp automatisk.

## Støtte

Hvis du støter på problemer med push-varsler, vennligst:

1. Sjekk feilsøkingsseksjonen ovenfor
2. Se gjennom OneUptime-loggene for detaljerte feilmeldinger
3. Kontakt oss på [hello@oneuptime.com](mailto:hello@oneuptime.com)

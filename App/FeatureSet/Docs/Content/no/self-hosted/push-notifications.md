# Push-varsler

Native push-varsler (iOS/Android) er drevet av **Expo Push** og krever **ingen serversidekonfigurasjon** for selvhostede instanser.

## Slik fungerer det

OneUptime-mobilappen registrerer et Expo Push-token hos backend. Når backend trenger å sende et varsel, sender den en POST til den offentlige Expo Push API-en, som ruter meldingen til Apple APNs eller Google FCM på vegne av appen.

Nettleser-push-varsler fortsetter å bruke VAPID-nøkler og Web Push-protokollen.

## Oppsett for selvhostede installasjoner

Ingen push-varselkonfigurasjon er nødvendig. Mobilapp-binærfilen håndterer all plattformregistrering automatisk via Expos push-infrastruktur.

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

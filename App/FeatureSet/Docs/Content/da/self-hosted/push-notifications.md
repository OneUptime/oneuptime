# Push-notifikationer

Native push-notifikationer (iOS/Android) drives af **Expo Push** og kræver **ingen serverkonfiguration** for selvhostede instanser.

## Sådan fungerer det

OneUptime-mobilappen registrerer et Expo Push Token hos backenden. Når backenden skal sende en notifikation, poster den til den offentlige Expo Push API, som dirigerer meddelelsen til Apple APNs eller Google FCM på vegne af appen.

Web push-notifikationer fortsætter med at bruge VAPID-nøgler og Web Push-protokollen.

## Selvhostet opsætning

Ingen push-notifikationskonfiguration er påkrævet. Mobilapp-binæren håndterer al platformsregistrering automatisk via Expos push-infrastruktur.

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

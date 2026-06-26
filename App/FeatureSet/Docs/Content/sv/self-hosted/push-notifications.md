# Push-aviseringar

Inbyggda push-aviseringar (iOS/Android) drivs av **Expo Push** och kräver **ingen konfiguration på serversidan** för egeninstallerade instanser.

## Hur det fungerar

OneUptime-mobilappen registrerar en Expo Push-token med backend. När backend behöver skicka en avisering POSTar den till det offentliga Expo Push API:et, som dirigerar meddelandet till Apple APNs eller Google FCM för appens räkning.

Webb-push-aviseringar fortsätter att använda VAPID-nycklar och Web Push-protokollet.

## Konfiguration för egeninstallation

Ingen konfiguration för push-aviseringar krävs. Mobilappens binärfil hanterar all plattformsregistrering automatiskt via Expos push-infrastruktur.

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

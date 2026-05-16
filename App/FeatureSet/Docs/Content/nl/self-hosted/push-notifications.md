# Push-meldingen

Native push-meldingen (iOS/Android) worden aangedreven door **Expo Push** en vereisen **geen serverconfiguratie** voor zelf-gehoste instanties.

## Hoe het werkt

De OneUptime-mobiele app registreert een Expo Push Token bij de backend. Wanneer de backend een melding moet sturen, verstuurt het een POST naar de openbare Expo Push API, die het bericht doorstuurt naar Apple APNs of Google FCM namens de app.

Web push-meldingen blijven VAPID-sleutels en het Web Push-protocol gebruiken.

## Zelf-gehoste instelling

Er is geen push-meldingsconfiguratie vereist. Het binaire mobiele app-bestand verwerkt alle platformregistraties automatisch via Expo's push-infrastructuur.

## Probleemoplossing

### Push-meldingen arriveren niet

- Zorg dat de mobiele app is gebouwd met EAS Build (Expo Go ondersteunt geen push-meldingen)
- Verifieer dat het apparaat is geregistreerd in de `UserPush`-tabel in uw database
- Controleer de OneUptime-serverlogboeken op Expo Push API-fouten
- Bevestig dat het apparaat een actieve internetverbinding heeft en meldingsmachtigingen zijn ingeschakeld

### "DeviceNotRegistered"-fouten in logboeken

Het Expo Push Token is niet langer geldig. Dit betekent meestal dat de app is verwijderd of de gebruiker meldingsmachtigingen heeft ingetrokken. Het token wordt automatisch opgeruimd.

## Ondersteuning

Als u problemen ondervindt met push-meldingen:

1. Controleer de bovenstaande sectie voor probleemoplossing
2. Bekijk de OneUptime-logboeken voor gedetailleerde foutmeldingen
3. Neem contact op via [hello@oneuptime.com](mailto:hello@oneuptime.com)

# iOS-installationsvejledning

Installer den native iOS-app **OneUptime On-Call** fra Apple App Store på din iPhone eller iPad.

## Krav

- iPhone eller iPad med **iOS 15.0 eller nyere**
- En aktiv OneUptime-konto (eller URL'en til din selvhostede OneUptime-instans)
- Internetforbindelse til log ind og for at modtage push-notifikationer

## Installer fra App Store

1. **Åbn App Store** på din iPhone eller iPad.
2. Tryk på fanen **Søg**, og søg efter **"OneUptime On-Call"**, eller åbn dette link på din enhed:
   [https://apps.apple.com/us/app/oneuptime-on-call/id6759615391](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)
3. Tryk på **Hent**, og godkend derefter med Face ID, Touch ID eller din Apple ID-adgangskode.
4. Når den er installeret, skal du trykke på **Åbn** eller starte **OneUptime On-Call** fra din hjemmeskærm.

## Første start og log ind

1. **Server-URL**
   - Hvis du bruger OneUptime Cloud, så lad standarden `https://oneuptime.com` stå.
   - Hvis du selvhoster, skal du indtaste URL'en til din OneUptime-instans (f.eks. `https://oneuptime.example.com`).
   - Appen verificerer, at serveren kan nås, før du kan fortsætte.
2. **Log ind**
   - Indtast e-mail og adgangskode til din OneUptime-konto.
   - Aktivér eventuelt **Face ID** eller **Touch ID** for hurtigere oplåsning ved senere starter.
3. **Tillad notifikationer**
   - Når du bliver bedt om det, skal du trykke på **Tillad**, så appen kan levere on-call-tilkald, hændelsesalarmer og kvitteringer.

## Push-notifikationer

Push-notifikationer leveres via Apple Push Notification service (APNs) gennem Expo Push. For at sikre, at tilkald når sikkert frem til dig:

1. Gå til **Indstillinger → Notifikationer → OneUptime On-Call**.
2. Aktivér **Tillad notifikationer**, **Lyde**, **Mærker** og levering til **Låseskærm / Banner / Notifikationscenter**.
3. Indstil **Gruppering af notifikationer** til **Automatisk**.
4. Hvis du har on-call-vagt, skal du slå **Strømsparetilstand** fra under din vagt og undgå at tvangslukke appen — iOS kan forsinke baggrundslevering, hvis appen tvangslukkes.
5. Føj **OneUptime On-Call** til alle **Fokus**-tilstande, hvor du stadig vil modtage tilkald.

## Opdateringer

Appen opdateres via App Store:

- Åbn **App Store**, tryk på dit profilbillede, rul ned til **OneUptime On-Call**, og tryk på **Opdater**.
- Eller aktivér **Indstillinger → App Store → App-opdateringer** for at installere opdateringer automatisk.

## Afinstaller

1. **Tryk længe** på **OneUptime On-Call**-ikonet på din hjemmeskærm.
2. Tryk på **Fjern app → Slet app**.
3. Bekræft ved at trykke på **Slet**.

Din OneUptime-konto og dine on-call-planer er lagret på serversiden og fjernes ikke, når du afinstallerer appen.

## Fejlfinding

**App Store siger, at appen er "Ikke tilgængelig i din region":**
- Appen er udgivet i den globale App Store. Hvis den ikke vises i din region, så kontakt [support](mailto:support@oneuptime.com).

**"Netværksfejl" ved log ind:**
- Bekræft, at **Server-URL** er korrekt og kan nås fra din enhed.
- Hvis du er på et virksomhedsnetværk eller en VPN, så sørg for, at OneUptime-instansen er tilgængelig.
- Bekræft, at serveren serveres over HTTPS med et gyldigt certifikat.

**Modtager ikke push-notifikationer:**
- Åbn **Indstillinger → Notifikationer → OneUptime On-Call**, og bekræft, at notifikationer er tilladt.
- Slå **Forstyr ikke** fra, eller føj OneUptime On-Call til din aktive Fokus-tilstands tilladelsesliste.
- Log ud, og log ind igen for at opdatere det push-token, der er registreret hos serveren.
- Selvhostede brugere: bekræft, at push-notifikationer er konfigureret på din OneUptime-instans (se vejledningen [Push-notifikationer](/docs/self-hosted/push-notifications) for selvhostning).

**Face ID / Touch ID virker ikke:**
- Sørg for, at biometri er registreret i **Indstillinger → Face ID og adgangskode** eller **Indstillinger → Touch ID og adgangskode**.
- Genaktivér biometrisk oplåsning fra **Indstillinger**-skærmen i OneUptime On-Call-appen.

**Appen går ned ved start:**
- Opdater til den nyeste version fra App Store.
- Genstart din enhed.
- Hvis problemet fortsætter, så slet og geninstaller appen, og log ind igen.

## Support

Hvis du stadig har brug for hjælp, kan du kontakte os via dit OneUptime-dashboard eller åbne et issue på vores [GitHub-repository](https://github.com/OneUptime/oneuptime).

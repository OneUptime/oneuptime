# FAQ og fejlfinding

Ofte stillede spørgsmål og løsninger til OneUptimes mobil- og desktop-apps.

## Hvordan distribuerer OneUptime sine apps?

- **Mobil (iOS og Android):** OneUptime leverer en native app kaldet **OneUptime On-Call**. Den er udgivet i [Apple App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) og [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). En signeret [APK-download](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) er også tilgængelig for Android-enheder uden Google Play.
- **Desktop (Windows, macOS, Linux):** OneUptimes webdashboard er en Progressive Web App (PWA). Du kan installere det som en desktop-applikation direkte fra en Chromium-baseret browser eller Safari — ingen butikskonto kræves.

## FAQ om mobilappen

### Hvilke enheder er understøttet?

- **iOS:** iPhone eller iPad med iOS 15.0 eller nyere.
- **Android:** Telefoner og tablets med Android 8.0 (Oreo) eller nyere.

### Er appen gratis?

Ja. OneUptime On-Call-appen er gratis at installere. Du logger ind med din eksisterende OneUptime-konto.

### Kan jeg bruge appen med en selvhostet OneUptime-instans?

Ja. Ved første start beder appen om en **Server-URL**. Indtast URL'en til din selvhostede instans (f.eks. `https://oneuptime.example.com`). Appen validerer, at serveren kan nås, før den lader dig logge ind.

For push-notifikationer på selvhostede instanser skal du følge vejledningen [Push-notifikationer](/docs/self-hosted/push-notifications).

### Hvordan leveres opdateringer?

- **iOS:** Via App Store. Aktivér automatiske opdateringer i **Indstillinger → App Store**, eller opdater manuelt fra din App Store-profil.
- **Android (Google Play):** Automatiske opdateringer er aktiveret som standard.
- **Android (APK-sideload):** Download og installer den nyeste APK fra GitHub Releases-linket ovenfor.

### Hvorfor modtager jeg ikke push-notifikationer?

Mobil push bruger APNs (iOS) og FCM (Android) gennem Expo Push. Tjek følgende:

1. Notifikationer er aktiveret på OS-niveau for **OneUptime On-Call**.
2. Batterioptimering er deaktiveret, og baggrundsaktivitet er tilladt (Android).
3. Do Not Disturb eller Fokus-tilstande er slået fra, eller appen er på undtagelseslisten.
4. Du er logget ind — push-tokenet registreres først hos serveren, efter du er logget ind.
5. **Kun selvhostet:** Push-notifikationer er konfigureret på din OneUptime-instans. Se vejledningen [Push-notifikationer](/docs/self-hosted/push-notifications).

### Er dataene på min telefon sikre?

- Al API-trafik bruger HTTPS.
- Access- og refresh-tokens gemmes i enhedens sikre keystore (Keychain på iOS, Keystore på Android).
- Du kan kræve Face ID / Touch ID / fingeraftryk-oplåsning fra **Indstillinger**-skærmen i appen.

### Kan jeg installere appen på flere enheder?

Ja. Log ind med den samme OneUptime-konto på så mange enheder, du har brug for. Hver enhed modtager sine egne push-notifikationer.

### Hvordan afinstallerer jeg?

- **iOS:** Tryk længe på ikonet → **Fjern app** → **Slet app**.
- **Android:** Tryk længe på ikonet → **Afinstaller**, eller **Indstillinger → Apps → OneUptime On-Call → Afinstaller**.

Din OneUptime-konto og dine data er lagret på serveren og fjernes ikke, når du afinstallerer appen.

## FAQ om desktop-appen (PWA)

### Hvad er en Progressive Web App (PWA)?

En Progressive Web App er en webapplikation, der kan installeres ligesom en native desktop-app. Når den er installeret, kører den i sit eget vindue, har sit eget ikon i din launcher og kan levere desktop-notifikationer — uden at skulle gennem Windows Store, Mac App Store eller en anden distributionskanal.

### Hvorfor bruger desktop-appen PWA-teknologi?

- **Øjeblikkelige opdateringer** — appen forbliver synkroniseret med din OneUptime-instans i det øjeblik, du deployer.
- **Ingen butikskonto kræves** — installer direkte fra enhver moderne browser.
- **Samme kodebase** — det samme dashboard kører på Windows, macOS og Linux.

### Hvorfor vises "Installer"-knappen ikke?

1. Brug en Chromium-baseret browser (Chrome, Edge, Brave, Arc) eller Safari (macOS Sonoma+).
2. Bekræft, at din OneUptime-instans serveres over HTTPS med et gyldigt certifikat.
3. Ryd din browsers cache, og genindlæs.
4. Appen er måske allerede installeret — tjek Programmer / Startmenu.

### Hvordan opdaterer jeg desktop-appen?

PWA'en opdateres automatisk, hver gang du åbner den, mens du er online. For at fremtvinge en opdatering skal du genindlæse vinduet med **Ctrl+R** (Windows/Linux) eller **Cmd+R** (macOS).

### Hvordan afinstallerer jeg desktop-PWA'en?

- **Windows:** **Indstillinger → Apps → OneUptime → Afinstaller**, eller højreklik på posten i startmenuen.
- **macOS:** Træk appen fra **Programmer** til papirkurven, eller højreklik på Dock-ikonet og vælg **Fjern**.
- **Linux:** Brug din applikationsstarters afinstalleringsmulighed, eller fjern den relevante `.desktop`-fil.

## Fejlfinding

### Problemer med mobilappen

**Appen kan ikke logge ind / "Netværksfejl":**

- Bekræft, at **Server-URL** er korrekt og kan nås fra din telefon.
- Tjek, at din telefon er forbundet til internettet.
- For selvhostede instanser bag en VPN skal du sikre, at VPN'en er aktiv.

**Push-notifikationer forsinkes eller mangler (Android):**

- Deaktiver batterioptimering: **Indstillinger → Apps → OneUptime On-Call → Batteri → Ubegrænset**.
- Deaktiver Datasparer for appen.
- På Samsung-enheder skal du slå **Enhedspleje → Batteri → Grænser for baggrundsforbrug** fra for OneUptime On-Call.

**Push-notifikationer forsinkes eller mangler (iOS):**

- Undgå at tvangslukke appen — iOS kan sætte baggrundslevering på pause.
- Slå Strømsparetilstand fra, mens du har on-call-vagt.
- Føj OneUptime On-Call til alle aktive Fokus-tilstandes tilladelseslister.

**Face ID / Touch ID / fingeraftryk virker ikke:**

- Sørg for, at biometri er registreret i dine OS-indstillinger.
- Genaktivér biometrisk oplåsning fra **Indstillinger**-skærmen i OneUptime On-Call-appen.

### Problemer med desktop-appen (PWA)

**Installer-knappen mangler:**

- Brug en understøttet browser (Chromium-baseret eller Safari på macOS Sonoma+).
- Sørg for, at OneUptime-instansen serveres over HTTPS.
- Vent på, at siden er færdig med at indlæse, og tjek derefter adresselinjen for installer-ikonet.

**Desktop-notifikationer vises ikke:**

- Tillad notifikationer, når browseren beder om det.
- Tjek OS-notifikationsindstillinger (Windows Fokushjælp, macOS-notifikationer, Linux-notifikationsdæmon).
- For selvhostede instanser skal du sikre, at konfigurationen af [Push-notifikationer](/docs/self-hosted/push-notifications) er fuldført.

**Appen viser ikke de nyeste data:**

- Genindlæs med **Ctrl+R** / **Cmd+R**.
- Luk og åbn vinduet igen.
- Tjek din netværksforbindelse.

## Support

Hvis du stadig har brug for hjælp:

- Mobil: se installationsvejledningerne til [iOS](./ios-installation.md) eller [Android](./android-installation.md).
- Desktop: se installationsvejledningerne til [Windows](./windows-installation.md), [macOS](./macos-installation.md) eller [Linux](./linux-installation.md).
- Åbn et issue på [OneUptime GitHub-repositoryet](https://github.com/OneUptime/oneuptime).
- Kontakt support via dit OneUptime-dashboard.

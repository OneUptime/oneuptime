# OneUptime Mobil- og Desktop-apps

OneUptime tilbyder to måder at bruge platformen på uden for din browser:

- **Native mobile apps** til iOS og Android, udgivet i **Apple App Store** og **Google Play**. Disse leverer on-call-tilkald, hændelsesalarmer og kvitteringshandlinger direkte til din telefon.
- **Installerbare desktop-apps** til Windows, macOS og Linux, leveret som en Progressive Web App (PWA), der installeres direkte fra din browser. Disse giver OneUptime-dashboardet sit eget vindue, ikon og notifikationsflade på din computer.

## Mobil (Native Apps)

**OneUptime On-Call**-appen er en native applikation bygget med React Native. Den distribueres gennem de officielle butikker, så du får automatiske opdateringer, push-notifikationer og biometrisk oplåsning.

- **iOS** — [Hent i App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391). Kræver iOS 15.0 eller nyere. Se [iOS-installationsvejledningen](./ios-installation.md).
- **Android** — [Hent på Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). Kræver Android 8.0 eller nyere. En direkte [APK-download](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) er også tilgængelig for enheder uden Google Play. Se [Android-installationsvejledningen](./android-installation.md).

## Desktop (Progressive Web App)

OneUptimes webdashboard er en Progressive Web App, så du kan installere det som en desktop-applikation fra en moderne browser uden at skulle gennem en butik.

- [Windows-installation](./windows-installation.md)
- [macOS-installation](./macos-installation.md)
- [Linux-installation](./linux-installation.md)

### Kom i gang med desktop

1. Åbn din OneUptime-instans i en Chromium-baseret browser (Chrome, Edge) eller Safari.
2. Se efter **Installer**-knappen i adresselinjen eller i **Fil → Føj til Dock / Apps → Installer dette websted som en app**.
3. Start den installerede app fra din startmenu, Launchpad eller applikationsstarter.

### Fejlfinding for desktop

**Installer-mulighed vises ikke:**

- Sørg for, at du bruger en understøttet browser.
- Bekræft, at din OneUptime-instans serveres over HTTPS.
- Genindlæs siden, eller ryd din browsers cache.

**Push-notifikationer virker ikke:**

- Giv notifikationstilladelser, når browseren beder om det.
- Tjek dit operativsystems notifikationsindstillinger for browseren.
- Selvhostede brugere: bekræft, at push-notifikationer er konfigureret på din OneUptime-instans.

## Support

- Mobilspecifikke problemer: tjek installationsvejledningerne til [iOS](./ios-installation.md) eller [Android](./android-installation.md).
- Desktop-specifikke problemer: tjek installationsvejledningerne til [Windows](./windows-installation.md), [macOS](./macos-installation.md) eller [Linux](./linux-installation.md).
- Generelle spørgsmål: se siden [FAQ og fejlfinding](./faq-troubleshooting.md).
- Indrapportér fejl eller funktionsønsker på vores [GitHub-repository](https://github.com/OneUptime/oneuptime).

# OneUptime Mobiele en Desktop Apps

OneUptime biedt twee manieren om het platform buiten uw browser te gebruiken:

- **Native mobiele apps** voor iOS en Android, gepubliceerd in de **Apple App Store** en **Google Play**. Deze leveren oproepen voor wachtdiensten, incidentmeldingen en bevestigingsacties rechtstreeks op uw telefoon af.
- **Installeerbare desktop apps** voor Windows, macOS en Linux, geleverd als een Progressive Web App (PWA) die rechtstreeks vanuit uw browser wordt geïnstalleerd. Deze geven het OneUptime dashboard een eigen venster, pictogram en notificatieoppervlak op uw computer.

## Mobiel (Native Apps)

De **OneUptime On-Call** app is een native applicatie gebouwd met React Native. Deze wordt gedistribueerd via de officiële stores, zodat u automatische updates, pushmeldingen en biometrische ontgrendeling krijgt.

- **iOS** — [Download in de App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391). Vereist iOS 15.0 of later. Zie de [iOS Installatiehandleiding](./ios-installation.md).
- **Android** — [Verkrijg op Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). Vereist Android 8.0 of later. Een directe [APK-download](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) is ook beschikbaar voor apparaten zonder Google Play. Zie de [Android Installatiehandleiding](./android-installation.md).

## Desktop (Progressive Web App)

Het webdashboard van OneUptime is een Progressive Web App, dus u kunt het als een desktopapplicatie installeren vanuit een moderne browser zonder gebruik te maken van een store.

- [Windows Installatie](./windows-installation.md)
- [macOS Installatie](./macos-installation.md)
- [Linux Installatie](./linux-installation.md)

### Desktop Aan de Slag

1. Open uw OneUptime instantie in een op Chromium gebaseerde browser (Chrome, Edge) of Safari.
2. Zoek naar de knop **Install** in de adresbalk of in **Bestand → Toevoegen aan Dock / Apps → Deze site installeren als app**.
3. Start de geïnstalleerde app vanuit uw Startmenu, Launchpad of applicatielauncher.

### Desktop Probleemoplossing

**Installatieoptie verschijnt niet:**

- Zorg ervoor dat u een ondersteunde browser gebruikt.
- Bevestig dat uw OneUptime instantie via HTTPS wordt aangeboden.
- Vernieuw de pagina of wis uw browsercache.

**Pushmeldingen werken niet:**

- Verleen meldingsrechten wanneer de browser daarom vraagt.
- Controleer de meldingsinstellingen van uw besturingssysteem voor de browser.
- Zelf-gehoste gebruikers: bevestig dat pushmeldingen zijn geconfigureerd op uw OneUptime instantie.

## Ondersteuning

- Mobiel-specifieke problemen: raadpleeg de installatiehandleidingen voor [iOS](./ios-installation.md) of [Android](./android-installation.md).
- Desktop-specifieke problemen: raadpleeg de installatiehandleidingen voor [Windows](./windows-installation.md), [macOS](./macos-installation.md) of [Linux](./linux-installation.md).
- Algemene vragen: zie de pagina [Veelgestelde Vragen en Probleemoplossing](./faq-troubleshooting.md).
- Dien bugs of functieverzoeken in via onze [GitHub repository](https://github.com/OneUptime/oneuptime).

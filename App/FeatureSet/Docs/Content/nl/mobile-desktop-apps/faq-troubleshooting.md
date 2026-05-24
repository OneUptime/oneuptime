# Veelgestelde Vragen en Probleemoplossing

Veelgestelde vragen en oplossingen voor de OneUptime mobiele en desktop apps.

## Hoe distribueert OneUptime zijn apps?

- **Mobiel (iOS en Android):** OneUptime levert een native app genaamd **OneUptime On-Call**. Deze is gepubliceerd in de [Apple App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) en [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). Een ondertekende [APK-download](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) is ook beschikbaar voor Android apparaten zonder Google Play.
- **Desktop (Windows, macOS, Linux):** Het OneUptime webdashboard is een Progressive Web App (PWA). U kunt het als een desktopapplicatie installeren rechtstreeks vanuit een op Chromium gebaseerde browser of Safari — er is geen storeaccount vereist.

## Veelgestelde Vragen Mobiele App

### Welke apparaten worden ondersteund?

- **iOS:** iPhone of iPad met iOS 15.0 of later.
- **Android:** Telefoons en tablets met Android 8.0 (Oreo) of later.

### Is de app gratis?

Ja. De OneUptime On-Call app is gratis te installeren. U logt in met uw bestaande OneUptime account.

### Kan ik de app gebruiken met een zelf-gehoste OneUptime instantie?

Ja. Bij de eerste start vraagt de app om een **Server URL**. Voer de URL van uw zelf-gehoste instantie in (bijvoorbeeld `https://oneuptime.example.com`). De app valideert of de server bereikbaar is voordat u kunt inloggen.

Volg voor pushmeldingen op zelf-gehoste instanties de handleiding [Pushmeldingen](/docs/self-hosted/push-notifications).

### Hoe worden updates geleverd?

- **iOS:** Via de App Store. Schakel automatische updates in via **Instellingen → App Store**, of werk handmatig bij vanuit uw App Store profiel.
- **Android (Google Play):** Automatische updates zijn standaard ingeschakeld.
- **Android (APK sideload):** Download en installeer de nieuwste APK via de bovenstaande GitHub Releases-link.

### Waarom ontvang ik geen pushmeldingen?

Mobiele push maakt gebruik van APNs (iOS) en FCM (Android) via Expo Push. Controleer het volgende:

1. Meldingen zijn op besturingssysteemniveau ingeschakeld voor **OneUptime On-Call**.
2. Batterijoptimalisatie is uitgeschakeld en achtergrondactiviteit is toegestaan (Android).
3. Niet storen of Focus modi zijn uitgeschakeld, of de app staat op de uitzonderingslijst.
4. U bent ingelogd — het push-token wordt pas bij de server geregistreerd nadat u bent ingelogd.
5. **Alleen zelf-gehost:** Pushmeldingen zijn geconfigureerd op uw OneUptime instantie. Zie de handleiding [Pushmeldingen](/docs/self-hosted/push-notifications).

### Zijn de gegevens op mijn telefoon veilig?

- Al het API-verkeer maakt gebruik van HTTPS.
- Toegangs- en vernieuwingstokens worden opgeslagen in de beveiligde sleutelopslag van het apparaat (Keychain op iOS, Keystore op Android).
- U kunt Face ID / Touch ID / vingerafdrukontgrendeling vereisen vanuit het scherm **Instellingen** binnen de app.

### Kan ik de app op meerdere apparaten installeren?

Ja. Log in met hetzelfde OneUptime account op zoveel apparaten als u nodig hebt. Elk apparaat ontvangt zijn eigen pushmeldingen.

### Hoe verwijder ik de app?

- **iOS:** Houd het pictogram ingedrukt → **Verwijder app** → **Verwijder app**.
- **Android:** Houd het pictogram ingedrukt → **Verwijderen**, of **Instellingen → Apps → OneUptime On-Call → Verwijderen**.

Uw OneUptime account en gegevens worden op de server opgeslagen en worden niet verwijderd wanneer u de app verwijdert.

## Veelgestelde Vragen Desktop App (PWA)

### Wat is een Progressive Web App (PWA)?

Een Progressive Web App is een webapplicatie die kan worden geïnstalleerd zoals een native desktop app. Eenmaal geïnstalleerd, draait deze in zijn eigen venster, heeft het zijn eigen pictogram in uw launcher en kan het desktopmeldingen afleveren — zonder gebruik te maken van de Windows Store, Mac App Store of een ander distributiekanaal.

### Waarom gebruikt de desktop app PWA-technologie?

- **Onmiddellijke updates** — de app blijft synchroon met uw OneUptime instantie zodra u implementeert.
- **Geen storeaccount vereist** — installeer rechtstreeks vanuit elke moderne browser.
- **Eén codebase** — hetzelfde dashboard draait op Windows, macOS en Linux.

### Waarom verschijnt de knop "Install" niet?

1. Gebruik een op Chromium gebaseerde browser (Chrome, Edge, Brave, Arc) of Safari (macOS Sonoma+).
2. Bevestig dat uw OneUptime instantie via HTTPS met een geldig certificaat wordt aangeboden.
3. Wis uw browsercache en herlaad de pagina.
4. De app is mogelijk al geïnstalleerd — controleer uw Programma's / Startmenu.

### Hoe werk ik de desktop app bij?

De PWA werkt automatisch bij wanneer u deze opent terwijl u online bent. Om een update te forceren, vernieuwt u het venster met **Ctrl+R** (Windows/Linux) of **Cmd+R** (macOS).

### Hoe verwijder ik de desktop PWA?

- **Windows:** **Instellingen → Apps → OneUptime → Verwijderen**, of klik met de rechtermuisknop op het Startmenu-item.
- **macOS:** Sleep de app vanuit **Programma's** naar de Prullenmand, of klik met de rechtermuisknop op het Dock-pictogram en kies **Verwijderen**.
- **Linux:** Gebruik de verwijderoptie van uw applicatielauncher, of verwijder het relevante `.desktop` bestand.

## Probleemoplossing

### Problemen met de Mobiele App

**App logt niet in / "Netwerkfout":**
- Bevestig dat de **Server URL** correct is en bereikbaar is vanaf uw telefoon.
- Controleer of uw telefoon verbonden is met het internet.
- Voor zelf-gehoste instanties achter een VPN, zorg ervoor dat de VPN actief is.

**Pushmeldingen vertraagd of ontbrekend (Android):**
- Schakel batterijoptimalisatie uit: **Instellingen → Apps → OneUptime On-Call → Batterij → Onbeperkt**.
- Schakel Databesparing uit voor de app.
- Op Samsung apparaten schakelt u **Apparaatonderhoud → Batterij → Limieten voor achtergrondgebruik** uit voor OneUptime On-Call.

**Pushmeldingen vertraagd of ontbrekend (iOS):**
- Vermijd het geforceerd afsluiten van de app — iOS kan aflevering op de achtergrond pauzeren.
- Schakel de Energiebesparingsmodus uit terwijl u dienst hebt.
- Voeg OneUptime On-Call toe aan de lijst met toegestane apps van elke actieve Focus modus.

**Face ID / Touch ID / vingerafdruk werkt niet:**
- Zorg ervoor dat biometrische gegevens zijn ingeschreven in uw OS-instellingen.
- Schakel biometrische ontgrendeling opnieuw in vanuit het scherm **Instellingen** binnen de OneUptime On-Call app.

### Problemen met de Desktop App (PWA)

**Installatieknop ontbreekt:**
- Gebruik een ondersteunde browser (op Chromium gebaseerd of Safari op macOS Sonoma+).
- Zorg ervoor dat de OneUptime instantie via HTTPS wordt aangeboden.
- Wacht tot de pagina volledig is geladen en controleer vervolgens de adresbalk op het installatiepictogram.

**Desktopmeldingen verschijnen niet:**
- Sta meldingen toe wanneer de browser daarom vraagt.
- Controleer de OS-meldingsinstellingen (Windows Focus-assistent, macOS Berichtgeving, Linux meldingsdaemon).
- Voor zelf-gehoste instanties, zorg ervoor dat de [Pushmeldingen](/docs/self-hosted/push-notifications) configuratie volledig is.

**App toont niet de nieuwste gegevens:**
- Vernieuw met **Ctrl+R** / **Cmd+R**.
- Sluit en heropen het venster.
- Controleer uw netwerkverbinding.

## Ondersteuning

Als u nog hulp nodig hebt:

- Mobiel: zie de installatiehandleidingen voor [iOS](./ios-installation.md) of [Android](./android-installation.md).
- Desktop: zie de installatiehandleidingen voor [Windows](./windows-installation.md), [macOS](./macos-installation.md) of [Linux](./linux-installation.md).
- Open een issue op de [OneUptime GitHub repository](https://github.com/OneUptime/oneuptime).
- Neem contact op met ondersteuning via uw OneUptime dashboard.

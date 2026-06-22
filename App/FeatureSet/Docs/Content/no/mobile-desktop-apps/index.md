# OneUptime mobil- og skrivebordsapper

OneUptime tilbyr to måter å bruke plattformen på utenfor nettleseren:

- **Native mobilapper** for iOS og Android, publisert i **Apple App Store** og **Google Play**. Disse leverer vakttilkallinger, hendelsesvarsler og bekreftelseshandlinger direkte til telefonen din.
- **Installerbare skrivebordsapper** for Windows, macOS og Linux, levert som en progressiv nettapp (PWA) som installeres direkte fra nettleseren. Disse gir OneUptime-dashbordet sitt eget vindu, ikon og varslingsflate på datamaskinen din.

## Mobil (native apper)

**OneUptime On-Call**-appen er en native applikasjon bygget med React Native. Den distribueres gjennom de offisielle butikkene, slik at du får automatiske oppdateringer, push-varsler og biometrisk opplåsing.

- **iOS** — [Last ned i App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391). Krever iOS 15.0 eller nyere. Se [installasjonsveiledningen for iOS](./ios-installation.md).
- **Android** — [Hent den i Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). Krever Android 8.0 eller nyere. En direkte [APK-nedlasting](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) er også tilgjengelig for enheter uten Google Play. Se [installasjonsveiledningen for Android](./android-installation.md).

## Skrivebord (progressiv nettapp)

OneUptimes nettbaserte dashbord er en progressiv nettapp, slik at du kan installere det som en skrivebordsapplikasjon fra en moderne nettleser uten å gå gjennom noen butikk.

- [Installasjon for Windows](./windows-installation.md)
- [Installasjon for macOS](./macos-installation.md)
- [Installasjon for Linux](./linux-installation.md)

### Kom i gang på skrivebordet

1. Åpne OneUptime-instansen din i en Chromium-basert nettleser (Chrome, Edge) eller Safari.
2. Se etter **Install**-knappen i adressefeltet eller i **File → Add to Dock / Apps → Install this site as an app**.
3. Start den installerte appen fra Start-menyen, Launchpad eller appstarteren din.

### Feilsøking for skrivebord

**Installeringsvalget vises ikke:**

- Forsikre deg om at du bruker en støttet nettleser.
- Bekreft at OneUptime-instansen din leveres over HTTPS.
- Last inn siden på nytt eller tøm nettleserens hurtigbuffer.

**Push-varsler fungerer ikke:**

- Gi varslingstillatelser når nettleseren ber om det.
- Sjekk operativsystemets varslingsinnstillinger for nettleseren.
- Selvhostede brukere: bekreft at push-varsler er konfigurert på OneUptime-instansen din.

## Brukerstøtte

- Mobilspesifikke problemer: se installasjonsveiledningene for [iOS](./ios-installation.md) eller [Android](./android-installation.md).
- Skrivebordsspesifikke problemer: se installasjonsveiledningene for [Windows](./windows-installation.md), [macOS](./macos-installation.md) eller [Linux](./linux-installation.md).
- Generelle spørsmål: se siden [Vanlige spørsmål og feilsøking](./faq-troubleshooting.md).
- Rapporter feil eller funksjonsønsker i [GitHub-repositoriet vårt](https://github.com/OneUptime/oneuptime).

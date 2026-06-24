# OneUptime mobil- och skrivbordsappar

OneUptime erbjuder två sätt att använda plattformen utanför webbläsaren:

- **Inbyggda mobilappar** för iOS och Android, publicerade i **Apple App Store** och **Google Play**. Dessa levererar jourutkallelser, incidentvarningar och bekräftelseåtgärder direkt till din telefon.
- **Installerbara skrivbordsappar** för Windows, macOS och Linux, levererade som en Progressive Web App (PWA) som installeras direkt från din webbläsare. Dessa ger OneUptime-instrumentpanelen ett eget fönster, en egen ikon och en egen aviseringsyta på din dator.

## Mobil (inbyggda appar)

Appen **OneUptime On-Call** är en inbyggd applikation byggd med React Native. Den distribueras via de officiella butikerna så att du får automatiska uppdateringar, push-aviseringar och biometrisk upplåsning.

- **iOS** — [Ladda ner i App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391). Kräver iOS 15.0 eller senare. Se [installationsguiden för iOS](./ios-installation.md).
- **Android** — [Hämta i Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). Kräver Android 8.0 eller senare. En direkt [APK-nedladdning](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) finns också tillgänglig för enheter utan Google Play. Se [installationsguiden för Android](./android-installation.md).

## Skrivbord (Progressive Web App)

OneUptimes webbinstrumentpanel är en Progressive Web App, så du kan installera den som ett skrivbordsprogram från en modern webbläsare utan att gå via någon butik.

- [Installation på Windows](./windows-installation.md)
- [Installation på macOS](./macos-installation.md)
- [Installation på Linux](./linux-installation.md)

### Kom igång med skrivbordsappen

1. Öppna din OneUptime-instans i en Chromium-baserad webbläsare (Chrome, Edge) eller Safari.
2. Leta efter knappen **Installera** i adressfältet eller via **Arkiv → Lägg till i Dock / Appar → Installera den här webbplatsen som en app**.
3. Starta den installerade appen från Start-menyn, Launchpad eller din applikationsstartare.

### Felsökning för skrivbordsappen

**Installationsalternativet visas inte:**

- Säkerställ att du använder en webbläsare som stöds.
- Bekräfta att din OneUptime-instans levereras via HTTPS.
- Uppdatera sidan eller töm webbläsarens cache.

**Push-aviseringar fungerar inte:**

- Bevilja behörigheter för aviseringar när webbläsaren ber om det.
- Kontrollera operativsystemets aviseringsinställningar för webbläsaren.
- Användare med egen drift: bekräfta att push-aviseringar är konfigurerade på din OneUptime-instans.

## Support

- Mobilspecifika problem: se installationsguiderna för [iOS](./ios-installation.md) eller [Android](./android-installation.md).
- Skrivbordsspecifika problem: se installationsguiderna för [Windows](./windows-installation.md), [macOS](./macos-installation.md) eller [Linux](./linux-installation.md).
- Allmänna frågor: se sidan [Vanliga frågor och felsökning](./faq-troubleshooting.md).
- Rapportera buggar eller funktionsönskemål på vårt [GitHub-arkiv](https://github.com/OneUptime/oneuptime).

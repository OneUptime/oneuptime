# Vanliga frågor och felsökning

Vanliga frågor och lösningar för OneUptimes mobil- och skrivbordsappar.

## Hur distribuerar OneUptime sina appar?

- **Mobil (iOS och Android):** OneUptime levererar en inbyggd app som heter **OneUptime On-Call**. Den är publicerad i [Apple App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) och [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). En signerad [APK-nedladdning](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) finns också tillgänglig för Android-enheter utan Google Play.
- **Skrivbord (Windows, macOS, Linux):** OneUptimes webbinstrumentpanel är en Progressive Web App (PWA). Du kan installera den som ett skrivbordsprogram direkt från en Chromium-baserad webbläsare eller Safari — inget butikskonto krävs.

## Vanliga frågor om mobilappen

### Vilka enheter stöds?

- **iOS:** iPhone eller iPad som kör iOS 15.0 eller senare.
- **Android:** Telefoner och surfplattor som kör Android 8.0 (Oreo) eller senare.

### Är appen gratis?

Ja. Appen OneUptime On-Call är gratis att installera. Du loggar in med ditt befintliga OneUptime-konto.

### Kan jag använda appen med en egendriven OneUptime-instans?

Ja. Vid första start ber appen om en **Server-URL**. Ange URL:en till din egendrivna instans (till exempel `https://oneuptime.example.com`). Appen validerar att servern är nåbar innan du kan logga in.

För push-aviseringar på egendrivna instanser, följ guiden [Push-aviseringar](/docs/self-hosted/push-notifications).

### Hur levereras uppdateringar?

- **iOS:** Via App Store. Aktivera automatiska uppdateringar i **Inställningar → App Store**, eller uppdatera manuellt från din App Store-profil.
- **Android (Google Play):** Automatiska uppdateringar är aktiverade som standard.
- **Android (sidoladdad APK):** Ladda ned och installera den senaste APK:n från GitHub Releases-länken ovan.

### Varför tar jag inte emot push-aviseringar?

Mobila push-aviseringar använder APNs (iOS) och FCM (Android) via Expo Push. Kontrollera följande:

1. Aviseringar är aktiverade på OS-nivå för **OneUptime On-Call**.
2. Batterioptimering är inaktiverad och bakgrundsaktivitet är tillåten (Android).
3. Stör ej eller Fokus-lägen är avstängda, eller appen finns på undantagslistan.
4. Du är inloggad — push-token registreras hos servern först efter att du loggat in.
5. **Endast egen drift:** Push-aviseringar är konfigurerade på din OneUptime-instans. Se guiden [Push-aviseringar](/docs/self-hosted/push-notifications).

### Är data på min telefon säker?

- All API-trafik använder HTTPS.
- Åtkomst- och uppdateringstoken lagras i enhetens säkra nyckellager (Keychain på iOS, Keystore på Android).
- Du kan kräva upplåsning med Face ID / Touch ID / fingeravtryck från skärmen **Inställningar** inuti appen.

### Kan jag installera appen på flera enheter?

Ja. Logga in med samma OneUptime-konto på så många enheter du behöver. Varje enhet får sina egna push-aviseringar.

### Hur avinstallerar jag?

- **iOS:** Tryck och håll på ikonen → **Ta bort app** → **Radera app**.
- **Android:** Tryck och håll på ikonen → **Avinstallera**, eller **Inställningar → Appar → OneUptime On-Call → Avinstallera**.

Ditt OneUptime-konto och dina data lagras på servern och tas inte bort när du avinstallerar appen.

## Vanliga frågor om skrivbordsappen (PWA)

### Vad är en Progressive Web App (PWA)?

En Progressive Web App är en webbapplikation som kan installeras som en inbyggd skrivbordsapp. När den är installerad körs den i ett eget fönster, har en egen ikon i din startare och kan leverera skrivbordsaviseringar — utan att gå via Windows Store, Mac App Store eller någon annan distributionskanal.

### Varför använder skrivbordsappen PWA-teknik?

- **Omedelbara uppdateringar** — appen håller sig synkroniserad med din OneUptime-instans i samma stund som du driftsätter.
- **Inget butikskonto krävs** — installera direkt från valfri modern webbläsare.
- **En enda kodbas** — samma instrumentpanel körs på Windows, macOS och Linux.

### Varför visas inte knappen "Installera"?

1. Använd en Chromium-baserad webbläsare (Chrome, Edge, Brave, Arc) eller Safari (macOS Sonoma+).
2. Bekräfta att din OneUptime-instans levereras via HTTPS med ett giltigt certifikat.
3. Töm webbläsarens cache och ladda om.
4. Appen kan redan vara installerad — kontrollera dina program/Start-menyn.

### Hur uppdaterar jag skrivbordsappen?

PWA:n uppdateras automatiskt när du öppnar den medan du är online. För att tvinga en uppdatering, uppdatera fönstret med **Ctrl+R** (Windows/Linux) eller **Cmd+R** (macOS).

### Hur avinstallerar jag skrivbords-PWA:n?

- **Windows:** **Inställningar → Appar → OneUptime → Avinstallera**, eller högerklicka på Start-menyposten.
- **macOS:** Dra appen från **Program** till papperskorgen, eller högerklicka på Dock-ikonen och välj **Ta bort**.
- **Linux:** Använd din applikationsstartares avinstallationsalternativ, eller ta bort den relevanta `.desktop`-filen.

## Felsökning

### Problem med mobilappen

**Appen loggar inte in / "Nätverksfel":**
- Bekräfta att **Server-URL** är korrekt och nåbar från din telefon.
- Kontrollera att din telefon är ansluten till internet.
- För egendrivna instanser bakom ett VPN, säkerställ att VPN:et är aktivt.

**Push-aviseringar fördröjda eller saknas (Android):**
- Inaktivera batterioptimering: **Inställningar → Appar → OneUptime On-Call → Batteri → Obegränsad**.
- Inaktivera Datasparare för appen.
- På Samsung-enheter, stäng av **Enhetsvård → Batteri → Bakgrundsbegränsningar** för OneUptime On-Call.

**Push-aviseringar fördröjda eller saknas (iOS):**
- Undvik att tvångsstänga appen — iOS kan pausa leverans i bakgrunden.
- Inaktivera Lågenergiläge medan du har jour.
- Lägg till OneUptime On-Call i listan över tillåtna appar för ditt aktiva Fokus-läge.

**Face ID / Touch ID / fingeravtryck fungerar inte:**
- Säkerställ att biometrisk data är registrerad i operativsystemets inställningar.
- Aktivera biometrisk upplåsning på nytt från skärmen **Inställningar** inuti appen OneUptime On-Call.

### Problem med skrivbordsappen (PWA)

**Installationsknappen saknas:**
- Använd en webbläsare som stöds (Chromium-baserad eller Safari på macOS Sonoma+).
- Säkerställ att OneUptime-instansen levereras via HTTPS.
- Vänta tills sidan har laddats klart och leta sedan efter installationsikonen i adressfältet.

**Skrivbordsaviseringar visas inte:**
- Tillåt aviseringar när webbläsaren ber om det.
- Kontrollera OS:ets aviseringsinställningar (Windows Fokushjälp, macOS-aviseringar, Linux-aviseringsdaemon).
- För egendrivna instanser, säkerställ att konfigurationen för [Push-aviseringar](/docs/self-hosted/push-notifications) är komplett.

**Appen visar inte senaste data:**
- Uppdatera med **Ctrl+R** / **Cmd+R**.
- Stäng och öppna fönstret igen.
- Kontrollera din nätverksanslutning.

## Support

Om du fortfarande behöver hjälp:

- Mobil: se installationsguiderna för [iOS](./ios-installation.md) eller [Android](./android-installation.md).
- Skrivbord: se installationsguiderna för [Windows](./windows-installation.md), [macOS](./macos-installation.md) eller [Linux](./linux-installation.md).
- Skapa ett ärende på [OneUptimes GitHub-arkiv](https://github.com/OneUptime/oneuptime).
- Kontakta supporten via din OneUptime-instrumentpanel.

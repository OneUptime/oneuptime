# Installationsguide för Android

Installera den inbyggda Android-appen **OneUptime On-Call** från Google Play Store, eller sidoladda APK:n direkt på enheter utan Google Play.

## Krav

- Android-telefon eller surfplatta som kör **Android 8.0 (Oreo) eller senare**
- Ett aktivt OneUptime-konto (eller URL:en till din egendrivna OneUptime-instans)
- Internetanslutning för inloggning och för att ta emot push-aviseringar

## Alternativ 1: Installera från Google Play (rekommenderas)

1. Öppna **Google Play Store** på din enhet.
2. Sök efter **"OneUptime On-Call"**, eller öppna den här länken på din enhet:
   [https://play.google.com/store/apps/details?id=com.oneuptime.oncall](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)
3. Tryck på **Installera**.
4. När installationen är klar trycker du på **Öppna** eller startar **OneUptime On-Call** från applådan.

## Alternativ 2: Installera APK:n direkt

För enheter utan Google Play (till exempel GrapheneOS, /e/OS eller Huawei-enheter) installerar du den officiella APK:n från GitHub Releases:

1. Öppna den här länken på din Android-enhet:
   [https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)
2. När du uppmanas, tillåt din webbläsare att installera okända appar:
   **Inställningar → Appar → \[Din webbläsare\] → Installera okända appar → Tillåt från den här källan**.
3. Öppna den nedladdade APK:n och tryck på **Installera**.
4. Starta **OneUptime On-Call** från applådan.

APK:n byggs och signeras av OneUptime från samma källkod som Play Store-versionen. Appuppdateringar sker inte automatiskt vid sidoladdning — ladda ner den senaste APK:n från länken ovan när en ny version släpps.

## Första start och inloggning

1. **Server-URL**
   - Om du använder OneUptime Cloud, behåll standardvärdet `https://oneuptime.com`.
   - Om du har egen drift anger du URL:en till din OneUptime-instans (t.ex. `https://oneuptime.example.com`).
   - Appen verifierar att servern är nåbar innan den fortsätter.
2. **Logga in**
   - Ange e-postadressen och lösenordet för ditt OneUptime-konto.
   - Aktivera valfritt **biometrisk upplåsning** (fingeravtryck) för snabbare upplåsning vid senare starter.
3. **Tillåt aviseringar**
   - När du tillfrågas trycker du på **Tillåt** så att appen kan leverera jourutkallelser, incidentvarningar och bekräftelser.

## Push-aviseringar

Push-aviseringar levereras via Firebase Cloud Messaging (FCM) genom Expo Push. För att säkerställa att utkallelser når dig pålitligt under jour:

1. Öppna **Inställningar → Appar → OneUptime On-Call → Aviseringar** och bekräfta att alla kategorier är aktiverade.
2. Öppna **Inställningar → Appar → OneUptime On-Call → Batteri** och välj **Obegränsad** (eller inaktivera batterioptimering) så att operativsystemet inte fördröjer push-meddelanden i bakgrunden.
3. Tillåt att appen körs i bakgrunden och inaktivera eventuella "Datasparare"-begränsningar för den.
4. Om du använder Samsung-enheter, stäng även av **Inställningar → Enhetsvård → Batteri → Bakgrundsbegränsningar** för OneUptime On-Call.
5. Lägg till OneUptime On-Call i alla undantagslistor för **Stör ej** så att utkallelser fortfarande ringer under ditt jourskift.

## Uppdateringar

**Google Play:**

- Uppdateringar installeras automatiskt. För att utlösa en manuellt, öppna **Play Store → Profil → Hantera appar och enheter → Uppdateringar tillgängliga → OneUptime On-Call → Uppdatera**.

**Sidoladdad APK:**

- Ladda ned den senaste APK:n från GitHub Releases-länken ovan och installera den ovanpå den befintliga appen — dina data, server-URL och inloggning bevaras.

## Avinstallera

1. **Tryck och håll** på ikonen för **OneUptime On-Call** och tryck sedan på **Avinstallera**.
2. Eller öppna **Inställningar → Appar → OneUptime On-Call → Avinstallera**.
3. Bekräfta för att ta bort appen.

Ditt OneUptime-konto och dina jourscheman lagras på serversidan och tas inte bort när du avinstallerar appen.

## Felsökning

**"Nätverksfel" vid inloggning:**

- Kontrollera att **Server-URL** är korrekt och nåbar från din enhet.
- Om du befinner dig på ett företagsnätverk eller VPN, säkerställ att OneUptime-instansen är åtkomlig.
- Bekräfta att servern levereras via HTTPS med ett giltigt certifikat.

**Tar inte emot push-aviseringar:**

- Bekräfta att aviseringar är aktiverade i **Inställningar → Appar → OneUptime On-Call → Aviseringar**.
- Inaktivera batterioptimering för OneUptime On-Call (se Push-aviseringar ovan).
- Säkerställ att Stör ej är avstängt, eller att OneUptime On-Call finns på undantagslistan.
- Logga ut och logga in igen för att uppdatera push-token som är registrerad hos servern.
- Användare med egen drift: bekräfta att push-aviseringar är konfigurerade på din OneUptime-instans (se guiden [Push-aviseringar](/docs/self-hosted/push-notifications) för egen drift).

**Biometrisk upplåsning fungerar inte:**

- Registrera ett fingeravtryck i **Inställningar → Säkerhet → Fingeravtryck**.
- Aktivera biometrisk upplåsning på nytt från skärmen **Inställningar** inuti appen OneUptime On-Call.

**APK-installation blockerad:**

- Du måste ge webbläsaren tillstånd att installera okända appar (se Alternativ 2 ovan).
- Vissa operatörer eller företagsenhetsprofiler blockerar sidoladdning helt; i det fallet, använd Google Play-versionen istället.

**Appen kraschar vid start:**

- Uppdatera till den senaste versionen från Google Play eller den senaste APK:n.
- Starta om enheten.
- Om problemet kvarstår, avinstallera och installera om och logga sedan in igen.

## Support

Om du fortfarande behöver hjälp, kontakta oss via din OneUptime-instrumentpanel eller skapa ett ärende på vårt [GitHub-arkiv](https://github.com/OneUptime/oneuptime).

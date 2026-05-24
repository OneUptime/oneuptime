# Installationsguide för iOS

Installera den inbyggda iOS-appen **OneUptime On-Call** från Apple App Store på din iPhone eller iPad.

## Krav

- iPhone eller iPad som kör **iOS 15.0 eller senare**
- Ett aktivt OneUptime-konto (eller URL:en till din egendrivna OneUptime-instans)
- Internetanslutning för inloggning och för att ta emot push-aviseringar

## Installera från App Store

1. **Öppna App Store** på din iPhone eller iPad.
2. Tryck på fliken **Sök** och sök efter **"OneUptime On-Call"**, eller öppna den här länken på din enhet:
   [https://apps.apple.com/us/app/oneuptime-on-call/id6759615391](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)
3. Tryck på **Hämta** och autentisera sedan med Face ID, Touch ID eller ditt Apple-ID-lösenord.
4. När installationen är klar trycker du på **Öppna** eller startar **OneUptime On-Call** från hemskärmen.

## Första start och inloggning

1. **Server-URL**
   - Om du använder OneUptime Cloud, behåll standardvärdet `https://oneuptime.com`.
   - Om du har egen drift anger du URL:en till din OneUptime-instans (t.ex. `https://oneuptime.example.com`).
   - Appen verifierar att servern är nåbar innan den fortsätter.
2. **Logga in**
   - Ange e-postadressen och lösenordet för ditt OneUptime-konto.
   - Aktivera valfritt **Face ID** eller **Touch ID** för snabbare upplåsning vid senare starter.
3. **Tillåt aviseringar**
   - När du tillfrågas trycker du på **Tillåt** så att appen kan leverera jourutkallelser, incidentvarningar och bekräftelser.

## Push-aviseringar

Push-aviseringar levereras via Apple Push Notification service (APNs) genom Expo Push. För att säkerställa att utkallelser når dig pålitligt:

1. Gå till **Inställningar → Aviseringar → OneUptime On-Call**.
2. Aktivera **Tillåt aviseringar**, **Ljud**, **Märken** och leverans till **Låsskärm / Banner / Aviseringscenter**.
3. Ställ in **Aviseringsgruppering** på **Automatisk**.
4. Om du har jour, inaktivera **Lågenergiläge** under ditt skift och undvik att tvångsstänga appen — iOS kan fördröja leverans i bakgrunden om appen tvångsstängs.
5. Lägg till **OneUptime On-Call** i alla **Fokus**-lägen där du fortfarande vill ta emot utkallelser.

## Uppdateringar

Appen uppdateras via App Store:

- Öppna **App Store**, tryck på din profilbild, scrolla till **OneUptime On-Call** och tryck på **Uppdatera**.
- Eller aktivera **Inställningar → App Store → Appuppdateringar** för att installera uppdateringar automatiskt.

## Avinstallera

1. **Tryck och håll** på ikonen för **OneUptime On-Call** på hemskärmen.
2. Tryck på **Ta bort app → Radera app**.
3. Bekräfta genom att trycka på **Radera**.

Ditt OneUptime-konto och dina jourscheman lagras på serversidan och tas inte bort när du avinstallerar appen.

## Felsökning

**App Store säger att appen "inte är tillgänglig i din region":**
- Appen är publicerad i den globala App Store. Om den inte visas i din region, kontakta [supporten](mailto:support@oneuptime.com).

**"Nätverksfel" vid inloggning:**
- Kontrollera att **Server-URL** är korrekt och nåbar från din enhet.
- Om du befinner dig på ett företagsnätverk eller VPN, säkerställ att OneUptime-instansen är åtkomlig.
- Bekräfta att servern levereras via HTTPS med ett giltigt certifikat.

**Tar inte emot push-aviseringar:**
- Öppna **Inställningar → Aviseringar → OneUptime On-Call** och bekräfta att aviseringar är tillåtna.
- Inaktivera **Stör ej** eller lägg till OneUptime On-Call i listan över tillåtna appar för ditt aktiva Fokus-läge.
- Logga ut och logga in igen för att uppdatera push-token som är registrerad hos servern.
- Användare med egen drift: bekräfta att push-aviseringar är konfigurerade på din OneUptime-instans (se guiden [Push-aviseringar](/docs/self-hosted/push-notifications) för egen drift).

**Face ID / Touch ID fungerar inte:**
- Se till att biometrisk data är registrerad i **Inställningar → Face ID och lösenkod** eller **Inställningar → Touch ID och lösenkod**.
- Aktivera biometrisk upplåsning på nytt från skärmen **Inställningar** inuti appen OneUptime On-Call.

**Appen kraschar vid start:**
- Uppdatera till den senaste versionen från App Store.
- Starta om enheten.
- Om problemet kvarstår, radera och installera om appen och logga sedan in igen.

## Support

Om du fortfarande behöver hjälp, kontakta oss via din OneUptime-instrumentpanel eller skapa ett ärende på vårt [GitHub-arkiv](https://github.com/OneUptime/oneuptime).

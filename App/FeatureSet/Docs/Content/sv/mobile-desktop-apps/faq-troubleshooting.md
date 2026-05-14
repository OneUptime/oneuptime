# Vanliga frågor och felsökning

Vanliga frågor och lösningar för OneUptime Mobil- och Skrivbordsappar (PWA).

## Allmänna frågor

### Vad är en Progressive Web App (PWA)?

En Progressive Web App är en webbapplikation som använder modern webbteknik för att leverera app-liknande upplevelser. PWA:er kan installeras direkt från webbläsare utan appbutiker, fungera offline, skicka push-aviseringar och integreras med enhetens operativsystem.

### Varför använder OneUptime inte traditionella appbutiker?

OneUptime använder PWA-teknik eftersom det erbjuder flera fördelar:
- **Omedelbara uppdateringar**: Ingen väntan på godkännande från appbutiker eller manuella uppdateringar
- **Plattformsoberoende**: Enstaka kodbas fungerar på alla enheter
- **Inga nedladdningsstorleksgränser**: Alla funktioner utan storleksbegränsningar
- **Direkt distribution**: Installera direkt från din OneUptime-instans
- **Alltid senaste versionen**: Användare har alltid den senaste versionen
- **Säkerhet**: Samma säkerhetsfördelar som webbapplikationer


### Hur mycket lagring använder OneUptime PWA?

- **Initial installation**: 10–20 MB
- **Cachetillväxt**: 50–100 MB med regelbunden användning
- **Maximal cache**: Vanligtvis begränsad till 200 MB av webbläsare
- **Automatisk rensning**: Webbläsare hanterar lagring automatiskt

### Stöder OneUptime PWA push-aviseringar?

Ja, OneUptime PWA stöder rika push-aviseringar:
- **Incidentvarningar**: Incidentaviseringar i realtid
- **Statusuppdateringar**: Varningar om monitorstatusändringar
- **Anpassade utlösare**: Konfigurera aviseringsregler
- **Rikt innehåll**: Bilder, åtgärder och detaljerad information
- **Ikonmärken**: Antal olästa på appikonen

## Installations-FAQ

### Varför ser jag inte knappen "Installera"?

Vanliga orsaker och lösningar:
1. **Webbläsarkompatibilitet**: Använd Chrome, Edge eller Safari
2. **HTTPS krävs**: Se till att OneUptime-instansen använder HTTPS
3. **PWA-krav**: Servern måste uppfylla PWA-manifestkrav
4. **Cacheproblem**: Rensa webbläsarcache och ladda om
5. **Redan installerad**: Appen kanske redan är installerad
6. **Väntetid**: Vissa webbläsare behöver 30+ sekunder på sidan

### Kan jag installera på flera enheter?

Ja! Du kan installera OneUptime PWA på:
- Obegränsat antal enheter per användare
- Flera webbläsare på samma enhet
- Olika operativsystem
- Delade enheter (med separata konton)

### Hur uppdaterar jag den installerade appen?

OneUptime PWA uppdateras automatiskt:
- **Automatiska uppdateringar**: Appen uppdateras när du besöker den medan du är online
- **Bakgrundsuppdateringar**: Uppdateringar laddas ner i bakgrunden
- **Omedelbar tillgänglighet**: Nya funktioner tillgängliga direkt
- **Ingen användaråtgärd**: Till skillnad från butiksappar krävs inga manuella uppdateringar

### Kan jag anpassa appnamnet under installationen?

Ja, under installationen kan du:
- Ändra appnamnet (standard: "OneUptime")
- Lägga till ditt organisationsnamn
- Använda anpassad namnkonvention
- Ändra ikonens etikett (plattformsberoende)

### Hur avinstallerar jag OneUptime PWA?

Avinstallation varierar beroende på plattform:

**Android:**
- Håll ned appikonen → Avinstallera
- Inställningar → Appar → OneUptime → Avinstallera

**iOS:**
- Håll ned appikonen → Ta bort app → Ta bort app

**Windows:**
- Inställningar → Appar → OneUptime → Avinstallera
- Högerklicka på Start-menyobjektet → Avinstallera

**macOS:**
- Dra från Program till papperskorgen
- Högerklicka på Dock-ikonen → Ta bort

**Linux:**
- Ta bort från programstartaren
- Ta bort .desktop-filen


## Aviserings-FAQ

### Varför tar jag inte emot aviseringar?

Vanliga aviseringsproblem och lösningar:

**Kontrollera behörigheter:**
```
1. Webbläsarens aviserings behörigheter aktiverade
2. Operativsystemets aviserings behörigheter
3. OneUptime-aviseringsinställningar konfigurerade
4. Stör ej-läge inaktiverat
```

**Plattformsspecifikt:**
- **Android**: Kontrollera inställningar för batterioptimering
- **iOS**: Verifiera aviseringsinställningar i appen Inställningar
- **Windows**: Kontrollera inställningar för Fokusassistent
- **macOS**: Verifiera behörigheter i aviseringscenter
- **Linux**: Kontrollera status för aviseringsdemon

### Kan jag anpassa aviseringsljud?

Anpassningsalternativ för aviseringar:
- **Systemljud**: Använd operativsystemets aviseringsljudinställningar
- **Webbläsarinställningar**: Konfigurera i webbläsarens aviseringsinställningar
- **OneUptime-inställningar**: Ange aviseringsinställningar i instrumentpanelen
- **Prioritetsnivåer**: Konfigurera olika ljud för allvarlighetsgrader

### Hur inaktiverar jag aviseringar tillfälligt?

Tillfällig inaktivering av aviseringar:
- **Stör ej**: Aktivera systemets stör ej-läge
- **Webbläsarinställningar**: Inaktivera webbplatsaviseringar tillfälligt
- **OneUptime-instrumentpanel**: Pausa aviseringar i inställningarna
- **Fokuslägen**: Använd operativsystemets fokus-/koncentrationslägen

## Säkerhets-FAQ

### Är OneUptime PWA säker?

Säkerhetsfunktioner och överväganden:
- **HTTPS-kryptering**: Alla data överförs säkert
- **Same-Origin-policy**: Webbläsarens säkerhetsbegränsningar gäller
- **Sandlådemiljö**: Körs i webbläsarens säkerhetssandlåda
- **Regelbundna uppdateringar**: Säkerhetskorrigeringar tillämpas automatiskt
- **Ingen rotåtkomst**: Begränsad systemåtkomst jämfört med inbyggda appar


*Observera: Känsliga data är krypterade och följer webbläsarens säkerhetsstandarder.*

### Kan jag använda OneUptime PWA på företagsnätverk?

Överväganden för företagsnätverk:
- **Brandväggsregler**: Se till att HTTPS (port 443) är tillgänglig
- **Proxykonfiguration**: Konfigurera proxyinställningar för webbläsaren
- **Certifikattillit**: Installera företagscertifikat vid behov
- **VPN-åtkomst**: Använd VPN för fjärråtkomst
- **Säkerhetspolicyer**: Följ IT-säkerhetskraven

## Felsökning

### Installationsproblem

**Problem**: Installationsknapp visas inte
```
Lösningar:
1. Vänta 30+ sekunder på OneUptime-sidan
2. Uppdatera sidan och vänta igen
3. Rensa webbläsarens cache och cookies
4. Prova en annan webbläsare (Chrome/Edge rekommenderas)
5. Verifiera HTTPS-anslutning (kontrollera låsikonen)
6. Kontrollera om den redan är installerad
```

**Problem**: Installationen misslyckas eller kraschar
```
Lösningar:
1. Se till att det finns tillräckligt med lagringsutrymme (100 MB+)
2. Stäng andra webbläsarflikar och program
3. Uppdatera webbläsaren till den senaste versionen
4. Inaktivera webbläsartillägg tillfälligt
5. Prova installation i privat/inkognitoläge
6. Starta om webbläsaren och försök igen
```

**Problem**: Appen installeras men visas inte
```
Lösningar:
1. Kontrollera alla appstartarplatser
2. Sök efter "OneUptime" i enhetssökning
3. Titta i webbläsarens apphanteringsavsnitt
4. Vänta 1-2 minuter för att systemet ska uppdateras
5. Starta om enheten och kontrollera igen
```

**Problem**: Appen kraschar ofta
```
Lösningar:
1. Uppdatera webbläsaren till den senaste versionen
2. Rensa all webbläsardata för OneUptime
3. Inaktivera webbläsartillägg
4. Kontrollera tillgängligt lagringsutrymme
5. Starta om operativsystemet
6. Installera om OneUptime PWA
```

**Problem**: Push-aviseringar fungerar inte
```
Lösningar:
1. Kontrollera aviserings behörigheter i webbläsaren
2. Verifiera systemets aviseringsinställningar
3. Testa med enkel avisering först
4. Rensa aviseringsdata och bevilja behörigheter igen
5. Kontrollera Stör ej/Fokus-läge inställningar
6. Verifiera OneUptime-aviseringskonfiguration
```

**Problem**: Appen synkroniserar inte senaste data
```
Lösningar:
1. Dra ned för att uppdatera (mobil)
2. Tryck på Ctrl+F5 (Windows/Linux) eller Cmd+R (Mac)
3. Stäng och öppna appen igen
4. Rensa appcache och ladda om
5. Kontrollera nätverksanslutning
```

### Plattformsspecifika problem

**Android-problem:**
```
Problem: Appen visas inte i applådan
Lösning: Kontrollera avsnittet "Nyligen tillagda" appar, sök i applådan

Problem: Aviseringar är försenade
Lösning: Inaktivera batterioptimering för webbläsarappen

Problem: Appen kraschar vid start
Lösning: Rensa Chrome-appdata, starta om enheten
```

**iOS-problem:**
```
Problem: Kan inte lägga till på startskärmen
Lösning: Använd Safari-webbläsare, se till att iOS 11.3+

Problem: App-ikonen saknas
Lösning: Kontrollera alla startskärmssidor och appbibliotek

Problem: Face ID fungerar inte
Lösning: Aktivera Face ID för Safari i inställningarna
```

**Windows-problem:**
```
Problem: Appen visas inte i Start-menyn
Lösning: Sök efter appnamnet, kontrollera installerade appar

Problem: Aviseringar visas inte
Lösning: Kontrollera Windows-aviseringsinställningar, aktivera för webbläsaren

Problem: Storleksproblem med fönster
Lösning: Ändra storlek manuellt, appen kommer ihåg dimensionerna
```

**macOS-problem:**
```
Problem: Kan inte installera via Safari
Lösning: Uppdatera till macOS Sonoma+, använd Fil → Lägg till i Dock

Problem: Appen inte i Program-mappen
Lösning: Kontrollera Launchpad, använd Spotlight-sökning

Problem: Aviseringar fungerar inte
Lösning: Kontrollera Systeminställningar → Aviseringar
```

**Linux-problem:**
```
Problem: PWA-installationsalternativet saknas
Lösning: Använd Chrome/Chromium, se till att skrivbordsmiljön stöder det

Problem: Ikonen visas inte i startaren
Lösning: Uppdatera skrivbordsdatabasen, kontrollera .desktop-filen

Problem: Ljudaviseringar fungerar inte
Lösning: Kontrollera PulseAudio, verifiera webbläsarens ljudbehörigheter
```

### Felmeddelanden

**"This site cannot be installed"**
```
Orsaker:
- OneUptime-instansen uppfyller inte PWA-kraven
- Saknat eller ogiltigt webbappmanifest
- HTTPS är inte korrekt konfigurerat
- Webbläsaren stöder inte PWA-installation

Lösningar:
- Kontakta administratören för att verifiera PWA-konfigurationen
- Prova en annan webbläsare
- Kontrollera webbläsarkonsolen för detaljerade fel
```

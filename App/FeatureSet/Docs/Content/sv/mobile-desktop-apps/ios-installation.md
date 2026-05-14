# Installationsguide för iOS

Installera OneUptime som en inbyggd app på din iPhone eller iPad för sömlös övervakning när du är på språng.

## Installationsmetoder

### Metod 1: Safari (rekommenderas)

Safari ger den bästa PWA-upplevelsen på iOS-enheter.

1. **Öppna OneUptime i Safari**
   - Starta Safari på din iOS-enhet
   - Navigera till URL:en för din OneUptime-instans
   - Vänta tills sidan laddas helt
   - Se till att du är inloggad på ditt OneUptime-konto

2. **Öppna delningsmenyn**
   - Tryck på **Dela-knappen** (fyrkant med pil uppåt) i det nedre verktygsfältet
   - Scrolla genom delningsalternativen för att hitta "Lägg till på startskärmen"

3. **Lägg till på startskärmen**
   - Tryck på **"Lägg till på startskärmen"**
   - Anpassa appnamnet (standard: "OneUptime")
   - Tryck på **"Lägg till"** i det övre högra hörnet

4. **Starta appen**
   - Hitta OneUptime-ikonen på din startskärm
   - Tryck för att starta i helskärms-appläge

### Metod 2: Chrome-webbläsare

Chrome fungerar, men Safari rekommenderas för bästa iOS PWA-upplevelse.

1. **Öppna OneUptime i Chrome**
   - Starta Chrome-webbläsaren
   - Gå till din OneUptime-instans
   - Låt sidan laddas helt

2. **Lägg till på startskärmen**
   - Tryck på **tredubbelpunktsmenyn** (fler alternativ)
   - Välj **"Lägg till på startskärmen"**
   - Anpassa appnamnet om du vill
   - Tryck på **"Lägg till"**

### Metod 3: Andra webbläsare

Firefox, Edge och andra webbläsare stöder grundläggande PWA-installation:

1. **Öppna OneUptime**
   - Starta din föredragna webbläsare
   - Navigera till OneUptime-URL:en
   - Vänta tills sidan laddas helt

2. **Leta efter installationsalternativ**
   - Kontrollera webbläsarmenyn för "Lägg till på startskärmen" eller "Installera"
   - Följ webbläsarspecifika installationsprompter

### Anpassningsalternativ

### App-ikon och namn
- **Anpassat namn**: Ändra under installationen eller senare
- **Ikonplacering**: Organisera i mappar eller specifika startskärmssidor
- **Märkaviseringar**: Visa antal olästa incidenter

### Aviseringskonfiguration
1. **Aktivera aviseringar**
   - Tryck på **"Tillåt"** för aviseringar när du uppmanas
   - Eller gå till Inställningar → Aviseringar → OneUptime
   - Aktivera alla aviseringstyper för heltäckande övervakning

2. **Anpassa varningsstilar**
   - **Låsskärm**: Visa incidentvarningar på låst enhet
   - **Bannerstil**: Välj tillfälliga eller bestående banners
   - **Ljud**: Anpassa aviseringsljud och vibrationer
   - **Kritiska varningar**: Aktivera för högprioriterade incidenter (kräver behörighet)

## Felsökning

### Installationsproblem

**"Lägg till på startskärmen" visas inte:**
```
Lösningar:
1. Se till att du använder Safari (bästa kompatibiliteten)
2. Uppdatera sidan och vänta 30 sekunder
3. Kontrollera att du är på rätt OneUptime-URL
4. Verifiera HTTPS-anslutning (leta efter låsikonen)
5. Rensa Safari-cache: Inställningar → Safari → Rensa historik och webbplatsdata
```

**Installationen är klar men ingen ikon visas:**
```
Lösningar:
1. Kontrollera alla startskärmssidor
2. Titta i Appbiblioteket (svep förbi den sista startskärmssidan)
3. Använd Spotlight-sökning för att hitta "OneUptime"
4. Starta om enheten och kontrollera igen
5. Installera om vid behov
```

**Appen kraschar vid start:**
```
Lösningar:
1. Tvångsstäng och öppna appen igen
2. Starta om din iOS-enhet
3. Rensa Safari-cache och installera om
4. Se till att iOS-versionen är 11.3 eller högre
5. Frigör enhetens lagringsutrymme
```

### Aviseringsproblem

**Tar inte emot push-aviseringar:**
```
Kontrollera dessa inställningar:
1. Inställningar → Aviseringar → OneUptime → Tillåt aviseringar
2. Inställningar → Skärmtid → Begränsningar för innehåll och sekretess → Tillåtna appar
3. Inställningar för Stör ej
4. Kontrollera aviseringsinställningar i OneUptime-instrumentpanelen
5. Logga ut och logga in igen på OneUptime
```

**Försenade eller missade aviseringar:**
```
Lösningar:
1. Håll appen igång i bakgrunden (tvångsstäng inte)
2. Inaktivera lågenergistudg under kritisk övervakning
3. Kontrollera Bakgrundsappuppdatering: Inställningar → Allmänt → Bakgrundsappuppdatering
4. Se till att det finns tillräckligt med lagringsutrymme
```

## Avinstallation

### Ta bort från startskärmen
1. **Håll ned** OneUptime-appikonen
2. Tryck på **"Ta bort app"**
3. Välj **"Ta bort app"**
4. Bekräfta borttagningen

### Alternativ metod
1. Gå till **Inställningar → Allmänt → iPhone-lagring**
2. Hitta **OneUptime** i applistan
3. Tryck på **"Ta bort app"**
4. Bekräfta borttagningen

## Uppdateringar och underhåll

### Automatiska uppdateringar
- OneUptime PWA uppdateras automatiskt när du är online
- Inga App Store-uppdateringar krävs
- Nya funktioner tillgängliga omedelbart efter serverdriftsättning
- Kritiska säkerhetsuppdateringar tillämpas direkt

## iPad-specifik installation

### Förbättrad iPad-upplevelse
1. **Större gränssnitt**: Optimerade layouter för iPad-skärmstorlekar
2. **Flerfönstersvisning**: Kör flera OneUptime-fönster samtidigt
3. **Tangentbordsgenvägar**: Fullständigt stöd för externa tangentbord
4. **Dra och släpp**: Flytta data mellan OneUptime och andra appar

### iPad-installationssteg
Samma som iPhone-installation, men med ytterligare överväganden:
- Använd liggande läge för optimal instrumentpanelsvisning
- Överväg delad visning med andra produktivitetsappar
- Konfigurera tangentbordsgenvägar för vanliga åtgärder

## Apple Watch-integration

Medan OneUptime inte har en dedikerad watchOS-app kan du:
- **Ta emot aviseringar**: Incidentvarningar visas på Apple Watch
- **Snabbåtgärder**: Bekräfta incidenter från klockaviseringar
- **Siri-integration**: Fråga Siri om systemstatus (när konfigurerad)

## Avancerad konfiguration

### Integration med Genvägar-appen
Skapa anpassade Siri-genvägar för OneUptime:
1. Öppna **Genvägar**-appen
2. Skapa **Ny genväg**
3. Lägg till åtgärden **"Öppna app"**
4. Välj **OneUptime**
5. Lägg till en röstfras som "Kontrollera systemstatus"

### Fokuslägen
Integrera OneUptime med iOS-fokuslägen:
1. **Inställningar → Fokus**
2. Välj eller skapa ett fokusläge
3. **Appar → Lägg till appar → OneUptime**
4. Konfigurera aviseringsbeteendet för olika fokuslägen

## Uppdateringar och underhåll

### Automatiska uppdateringar
- OneUptime PWA uppdateras automatiskt när du är online
- Inga App Store-uppdateringar krävs
- Nya funktioner tillgängliga omedelbart efter serverdriftsättning
- Kritiska säkerhetsuppdateringar tillämpas direkt

### Manuell uppdateringsprocess
Tvinga uppdatering av appen:
1. Öppna OneUptime i Safari
2. Dra ned för att uppdatera
3. Appen laddar ner senaste versionen
4. Nya funktioner tillgängliga omedelbart

## Bästa praxis

### Säkerhetsrekommendationer
1. **Verifiera URL**: Installera bara från din organisations officiella OneUptime-instans
2. **Endast HTTPS**: Se till att anslutningen är säker (leta efter låsikonen)
3. **Regelbundna uppdateringar**: Håll iOS uppdaterat för säkerhetskorrigeringar
4. **Appbehörigheter**: Bevilja bara nödvändiga behörigheter

### Prestandaoptimering
1. **Wi-Fi-installation**: Använd Wi-Fi för initial installation och stora uppdateringar
2. **Bakgrundsuppdatering**: Aktivera för aktuella aviseringar
3. **Lagringshantering**: Behåll tillräckligt med ledigt utrymme
4. **Regelbunden omstart**: Starta om appen varje vecka för optimal prestanda

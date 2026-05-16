# Installationsguide för Android

Installera OneUptime som en inbyggd app på din Android-enhet för den bästa övervakningsupplevelsen.

## Installationsmetoder

### Metod 1: Chrome-webbläsare (rekommenderas)

1. **Öppna OneUptime i Chrome**
   - Starta Google Chrome på din Android-enhet
   - Navigera till URL:en för din OneUptime-instans
   - Vänta tills sidan laddas helt

2. **Installationsprompt**
   - Leta efter bannern "Lägg till på startskärmen" längst ner
   - Tryck på "Installera" eller "Lägg till på startskärmen"
   - Om prompten inte syns, tryck på tredubbelpunktsmenyn (⋮) i det övre högra hörnet

3. **Manuell installation via menyn**
   - Tryck på Chrome-menyn (tre punkter)
   - Välj "Lägg till på startskärmen" eller "Installera app"
   - Anpassa appnamnet om du vill
   - Tryck på "Lägg till" för att bekräfta

4. **Starta appen**
   - Hitta OneUptime-ikonen på din startskärm eller i applådan
   - Tryck för att starta appen i helskärmsläge

### Metod 2: Samsung Internet

1. **Öppna OneUptime**
   - Starta Samsung Internet-webbläsaren
   - Gå till din OneUptime-instans
   - Vänta tills sidan laddas helt

2. **Lägg till på startskärmen**
   - Tryck på menyknappen (tre linjer)
   - Välj "Lägg till sida i" → "Startskärm"
   - Ange appnamnet och tryck på "Lägg till"

3. **Starta**
   - Hitta appikonen på din startskärm
   - Tryck för att öppna OneUptime i appläge

### Metod 3: Firefox

1. **Öppna OneUptime**
   - Starta Firefox-webbläsaren
   - Navigera till din OneUptime-URL
   - Låt sidan laddas helt

2. **Installera**
   - Tryck på tredubbelpunktsmenyn
   - Välj "Installera" (om tillgängligt)
   - Eller välj "Lägg till på startskärmen"
   - Bekräfta installationen

### Anpassningsalternativ

### Appnamn
- Under installationen kan du anpassa appnamnet
- Standard: "OneUptime"
- Rekommenderat: Behåll som "OneUptime" eller lägg till ditt företagsnamn

### Aviseringsinställningar
1. **Bevilja behörigheter**
   - Tillåt aviseringar när du uppmanas
   - Gå till Inställningar → Appar → OneUptime → Aviseringar
   - Aktivera alla aviserings kategorier för bästa upplevelse

2. **Anpassa varningar**
   - Konfigurera vilka incidenter som utlöser aviseringar
   - Ange aviserings prioritetsnivåer
   - Välj ljud- och vibrationsinställningar

## Felsökning

### Installationsproblem

**"Lägg till på startskärmen" visas inte:**
```
1. Rensa webbläsarens cache och cookies
2. Se till att du är på HTTPS (säker anslutning)
3. Vänta 2-3 minuter på sidan innan du letar efter prompten
4. Kontrollera om PWA-kraven uppfylls på din OneUptime-instans
```

**Installationen misslyckas:**
```
1. Frigör lagringsutrymme (behöver minst 50 MB)
2. Uppdatera din webbläsare till den senaste versionen
3. Starta om din webbläsare och försök igen
4. Prova en annan webbläsare (Chrome rekommenderas)
```

**App-ikonen visas inte:**
```
1. Kontrollera startskärmen och applådan
2. Titta i avsnittet "Nyligen tillagda" appar
3. Sök efter "OneUptime" i applådan
4. Installera om vid behov
```

### Aviseringsproblem

**Tar inte emot aviseringar:**
```
1. Kontrollera aviserings behörigheter:
   - Inställningar → Appar → OneUptime → Behörigheter → Aviseringar
2. Se till att aviseringar är aktiverade i OneUptime-instrumentpanelen
3. Kontrollera inställningarna för Stör ej
4. Verifiera att batterioptimerингsinställningar inte blockerar OneUptime
```

**Aviseringar är försenade:**
```
1. Inaktivera batterioptimering för OneUptime:
   - Inställningar → Appar → OneUptime → Batteri → Optimera batterianvändning
2. Tillåt bakgrundsaktivitet
3. Kontrollera inställningar för datasparläge
```

## Avinstallation

### Ta bort appen
1. **Håll ned** OneUptime-ikonen på startskärmen
2. Välj **"Avinstallera"** eller dra till papperskorgen
3. Bekräfta borttagningen

### Alternativ metod
1. Gå till **Inställningar → Appar**
2. Hitta **"OneUptime"**
3. Tryck på **"Avinstallera"**
4. Bekräfta borttagningen

## Uppdateringar och underhåll

### Automatiska uppdateringar
OneUptime PWA uppdateras automatiskt:
- **Automatiska uppdateringar**: Appen uppdateras när du besöker den medan du är online
- **Inga manuella uppdateringar**: Till skillnad från butiksappar krävs ingen användaråtgärd
- **Omedelbara uppdateringar**: Nya funktioner tillgängliga omedelbart
- **Säker återställning**: Dåliga uppdateringar kan snabbt återställas

## Avancerad konfiguration

### Utvecklaralternativ
För avancerade användare som vill inspektera PWA:n:
1. Aktivera Utvecklaralternativ i Android
2. Anslut till datorn med ADB
3. Använd Chrome DevTools för fjärrfelsökning

### Nätverkskonfiguration
- Konfigurera VPN om du använder en intern OneUptime-instans
- Konfigurera proxyinställningar om din organisation kräver det
- Se till att brandväggen tillåter PWA-resurser

## Uppdateringar

OneUptime PWA uppdateras automatiskt:
- **Automatiska uppdateringar**: Appen uppdateras när du besöker den medan du är online
- **Inga manuella uppdateringar**: Till skillnad från butiksappar krävs ingen användaråtgärd
- **Omedelbara uppdateringar**: Nya funktioner tillgängliga omedelbart
- **Säker återställning**: Dåliga uppdateringar kan snabbt återställas

## Bästa praxis

### För optimal prestanda
1. **Första start**: Alltid online för initial konfiguration
2. **Regelbunden användning**: Öppna appen regelbundet för att hålla cachen färsk
3. **Lagringshantering**: Behåll tillräckligt med ledigt utrymme
4. **Nätverk**: Använd Wi-Fi för initial installation och stora uppdateringar

### Säkerhetsrekommendationer
1. **Endast HTTPS**: Installera bara från säkra OneUptime-instanser
2. **Officiella URL:er**: Verifiera att du installerar från din organisations officiella OneUptime-URL
3. **Behörigheter**: Bevilja bara nödvändiga behörigheter
4. **Uppdateringar**: Håll ditt Android-operativsystem och webbläsare uppdaterade

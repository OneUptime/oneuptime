# iOS-installationsvejledning

Installer OneUptime som en native app på din iPhone eller iPad til problemfri overvågning på farten.

## Installationsmetoder

### Metode 1: Safari (anbefalet)

Safari leverer den bedste PWA-oplevelse på iOS-enheder.

1. **Åbn OneUptime i Safari**
   - Start Safari på din iOS-enhed
   - Naviger til din OneUptime-instans-URL
   - Vent på, at siden er fuldt indlæst
   - Sørg for, at du er logget ind på din OneUptime-konto

2. **Adgang til delingsmenuen**
   - Tryk på **Deleknappen** (firkant med pil opad) i den nederste værktøjslinje
   - Rul gennem delingsmulighederne for at finde "Tilføj til startskærm"

3. **Tilføj til startskærm**
   - Tryk på **"Tilføj til startskærm"**
   - Tilpas app-navnet (standard: "OneUptime")
   - Tryk på **"Tilføj"** i øverste højre hjørne

4. **Start appen**
   - Find OneUptime-ikonet på din startskærm
   - Tryk for at starte i fuld skærm-app-tilstand

### Metode 2: Chrome-browser

Selvom Chrome fungerer, anbefales Safari for den bedste iOS PWA-oplevelse.

1. **Åbn OneUptime i Chrome**
   - Start Chrome-browseren
   - Gå til din OneUptime-instans
   - Tillad fuldstændig sideindlæsning

2. **Tilføj til startskærm**
   - Tryk på **tre-punkts-menuen** (flere muligheder)
   - Vælg **"Tilføj til startskærm"**
   - Tilpas app-navn, hvis ønsket
   - Tryk på **"Tilføj"**

### Metode 3: Andre browsere

Firefox, Edge og andre browsere understøtter grundlæggende PWA-installation:

1. **Åbn OneUptime**
   - Start din foretrukne browser
   - Naviger til OneUptime-URL
   - Vent på fuld sideindlæsning

2. **Se efter installationsindstilling**
   - Kontroller browsermenuen for "Tilføj til startskærm" eller "Installer"
   - Følg browserspecifikke installationsprompter

### Tilpasningsmuligheder

### App-ikon og -navn
- **Brugerdefineret navn**: Skift under installation eller senere
- **Ikonplacering**: Organiser i mapper eller specifikke startskærmssider
- **Badge-notifikationer**: Vis antal ulæste incidents

### Notifikationskonfiguration
1. **Aktiver notifikationer**
   - Tryk på **"Tillad"** ved notifikationsprompt
   - Eller gå til Indstillinger → Notifikationer → OneUptime
   - Aktiver alle notifikationstyper for omfattende overvågning

2. **Tilpas advarselstyper**
   - **Låseskærm**: Vis incidentadvarsler på låst enhed
   - **Bannerstil**: Vælg midlertidige eller vedvarende bannere
   - **Lyde**: Tilpas notifikationslyde og vibrationer
   - **Kritiske advarsler**: Aktiver til høj-prioritets incidents (kræver tilladelse)

## Fejlfinding

### Installationsproblemer

**"Tilføj til startskærm" er ikke synlig:**
```
Løsninger:
1. Sørg for, at du bruger Safari (bedst kompatibilitet)
2. Opdater siden og vent 30 sekunder
3. Kontroller, at du er på den korrekte OneUptime-URL
4. Bekræft HTTPS-forbindelsen (se efter låseikon)
5. Ryd Safari-cache: Indstillinger → Safari → Ryd historik og webstedsdata
```

**Installationen fuldføres, men intet ikon vises:**
```
Løsninger:
1. Kontroller alle startskærmssider
2. Se i App-bibliotek (stryg til venstre forbi den sidste startskærmsside)
3. Brug Spotlight-søgning til at finde "OneUptime"
4. Genstart enheden og kontroller igen
5. Geninstaller om nødvendigt
```

**App crasher ved start:**
```
Løsninger:
1. Tving luk og åbn appen igen
2. Genstart din iOS-enhed
3. Ryd Safari-cache og geninstaller
4. Sørg for, at iOS-versionen er 11.3 eller højere
5. Frigør enhedslagringsplads
```

### Notifikationsproblemer

**Modtager ikke push-notifikationer:**
```
Kontroller disse indstillinger:
1. Indstillinger → Notifikationer → OneUptime → Tillad notifikationer
2. Indstillinger → Skærmtid → Indholds- og privatlivsbegrænsninger → Tilladte apps
3. Indstillinger for Forstyr ikke
4. Kontroller notifikationsindstillinger i OneUptime-dashboard
5. Log ud og log ind igen på OneUptime
```

**Forsinkede eller mistede notifikationer:**
```
Løsninger:
1. Hold appen kørende i baggrunden (tving ikke luk)
2. Deaktiver strømsparetilstand under kritisk overvågning
3. Kontroller Baggrundsapp-opdatering: Indstillinger → Generelt → Baggrundsapp-opdatering
4. Sørg for, at der er tilstrækkelig lagerplads til rådighed
```

## Afinstallation

### Fjern fra startskærm
1. **Langt tryk** på OneUptime-app-ikonet
2. Tryk på **"Fjern app"**
3. Vælg **"Slet app"**
4. Bekræft sletning

### Alternativ metode
1. Gå til **Indstillinger → Generelt → iPhone-lager**
2. Find **OneUptime** på listen over apps
3. Tryk på **"Slet app"**
4. Bekræft fjernelse

## Opdateringer og vedligeholdelse

### Automatiske opdateringer
- OneUptime PWA opdateres automatisk, når der er netværksforbindelse
- Ingen App Store-opdateringer kræves
- Nye funktioner er straks tilgængelige efter serverdeployment
- Kritiske sikkerhedsopdateringer anventes øjeblikkeligt

## iPad-specifik installation

### Forbedret iPad-oplevelse
1. **Større grænseflade**: Optimerede layouts til iPad-skærmstørrelser
2. **Multi-vindue**: Kør flere OneUptime-vinduer samtidigt
3. **Tastaturgenveje**: Fuld understøttelse af eksterne tastaturer
4. **Træk og slip**: Flyt data mellem OneUptime og andre apps

### iPad-installationstrin
Samme som iPhone-installation, men med yderligere overvejelser:
- Brug liggende tilstand for optimal dashboard-visning
- Overvej Split View-opsætning med andre produktivitetsapps
- Konfigurer tastaturgenveje til almindelige handlinger

## Apple Watch-integration

Selvom OneUptime ikke har en dedikeret watchOS-app, kan du:
- **Modtage notifikationer**: Incident-advarsler vises på Apple Watch
- **Hurtige handlinger**: Bekræft incidents fra ur-notifikationer
- **Siri-integration**: Spørg Siri om systemstatus (når konfigureret)

## Avanceret konfiguration

### Integration med Genveje-appen
Opret brugerdefinerede Siri-genveje til OneUptime:
1. Åbn **Genveje**-appen
2. Opret **Ny genvej**
3. Tilføj **"Åbn app"**-handling
4. Vælg **OneUptime**
5. Tilføj taletilstand som "Kontroller systemstatus"

### Fokusetilstande
Integrer OneUptime med iOS-fokusetilstande:
1. **Indstillinger → Fokus**
2. Vælg eller opret fokusetilstand
3. **Apps → Tilføj apps → OneUptime**
4. Konfigurer notifikationsadfærd for forskellige fokusetilstande

### Skærmtidsstyring
Konfigurer passende Skærmtidsindstillinger:
1. **Indstillinger → Skærmtid → App-grænser**
2. Tilføj OneUptime til kategorien "Produktivitet"
3. Sæt passende brugsgrænser, hvis det er nødvendigt

## Bedste praksis

### Sikkerhedsanbefalinger
1. **Bekræft URL**: Installer kun fra din organisations officielle OneUptime-instans
2. **Kun HTTPS**: Sørg for sikker forbindels (se efter låseikon)
3. **Regelmæssige opdateringer**: Hold iOS opdateret for sikkerhedsrettelser
4. **App-tilladelser**: Giv kun nødvendige tilladelser

### Ydeevneoptimering
1. **Wi-Fi-installation**: Brug Wi-Fi til den første installation og større opdateringer
2. **Baggrundsopdatering**: Aktiver for rettidige notifikationer
3. **Lagerstyring**: Oprethold tilstrækkelig ledig plads
4. **Regelmæssig genstart**: Genstart appen ugentligt for optimal ydeevne

### Bedste praksis for overvågning
1. **Kritiske notifikationer**: Aktiver kun til høj-prioritets advarsler
2. **Flere enheder**: Installer på både iPhone og iPad for redundans
3. **Teamadgang**: Del installationsvejledningen med teammedlemmer
4. **Test**: Test regelmæssigt notifikationslevering og offline-funktionalitet

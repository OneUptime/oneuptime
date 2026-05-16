# FAQ og fejlfinding

Ofte stillede spørgsmål og løsninger til OneUptime Mobil- og Desktop-apps (PWA).

## Generel FAQ

### Hvad er en Progressive Web App (PWA)?

En Progressive Web App er en webapplikation, der bruger moderne webteknologier til at levere app-lignende oplevelser. PWA'er kan installeres direkte fra browsere uden app-butikker, arbejde offline, sende push-notifikationer og integrere med din enheds operativsystem.

### Hvorfor bruger OneUptime ikke traditionelle app-butikker?

OneUptime bruger PWA-teknologi, fordi det tilbyder flere fordele:
- **Øjeblikkelige opdateringer**: Ingen ventetid på app-butiksgodk endelse eller manuelle opdateringer
- **Tværplatform**: En enkelt kodebase fungerer på alle enheder
- **Ingen downloadstørrelsesgrænser**: Fulde funktioner uden størrelsesrestriktioner
- **Direkte distribution**: Installer direkte fra din OneUptime-instans
- **Altid nyeste**: Brugere har altid den nyeste version
- **Sikkerhed**: Samme sikkerhedsfordele som webapplikationer


### Hvor meget lagerplads bruger OneUptime PWA?

- **Indledende installation**: 10-20 MB
- **Cache-vækst**: 50-100 MB ved regelmæssig brug
- **Maksimal cache**: Typisk begrænset til 200 MB af browsere
- **Automatisk oprydning**: Browsere administrerer automatisk lager

### Understøtter OneUptime PWA push-notifikationer?

Ja, OneUptime PWA understøtter avancerede push-notifikationer:
- **Incident-advarsler**: Realtids-incident-notifikationer
- **Statusopdateringer**: Advarsler om ændringer i monitorstatus
- **Brugerdefinerede udløsere**: Konfigurer notifikationsregler
- **Avanceret indhold**: Billeder, handlinger og detaljerede oplysninger
- **Badge-opdateringer**: Antal ulæste på app-ikon

## Installations-FAQ

### Hvorfor ser jeg ikke "Installer"-knappen?

Almindelige årsager og løsninger:
1. **Browserkompatibilitet**: Brug Chrome, Edge eller Safari
2. **HTTPS påkrævet**: Sørg for, at OneUptime-instansen bruger HTTPS
3. **PWA-krav**: Serveren skal opfylde PWA-manifestkrav
4. **Cache-problemer**: Ryd browsercache og genindlæs
5. **Allerede installeret**: Appen kan allerede være installeret
6. **Ventetid**: Nogle browsere har brug for 30+ sekunder på siden

### Kan jeg installere på flere enheder?

Ja! Du kan installere OneUptime PWA på:
- Ubegrænsede enheder pr. bruger
- Flere browsere på samme enhed
- Forskellige operativsystemer
- Delte/familieenheder (med separate konti)

### Hvordan opdaterer jeg den installerede app?

OneUptime PWA opdateres automatisk:
- **Automatiske opdateringer**: App opdateres, når du besøger den online
- **Baggrundsopdateringer**: Opdateringer downloades i baggrunden
- **Øjeblikkelig tilgængelighed**: Nye funktioner er straks tilgængelige
- **Ingen brugerhandling**: I modsætning til store-apps kræves ingen manuelle opdateringer

### Kan jeg tilpasse app-navnet under installationen?

Ja, under installationen kan du:
- Ændre app-navnet (standard: "OneUptime")
- Tilføje dit organisationsnavn
- Bruge brugerdefinerede navnekonventioner
- Ændre ikonlabel (platformsafhængigt)

### Hvordan afinstallerer jeg OneUptime PWA?

Afinstallation varierer afhængigt af platform:

**Android:**
- Langt tryk på app-ikon → Afinstaller
- Indstillinger → Apps → OneUptime → Afinstaller

**iOS:**
- Langt tryk på app-ikon → Fjern app → Slet app

**Windows:**
- Indstillinger → Apps → OneUptime → Afinstaller
- Højreklik på startmenupunkt → Afinstaller

**macOS:**
- Træk fra Programmer til Papirkurv
- Højreklik på Dock-ikon → Fjern

**Linux:**
- Fjern fra applikationsstarter
- Slet .desktop-fil


## Notifikations-FAQ

### Hvorfor modtager jeg ikke notifikationer?

Almindelige notifikationsproblemer og rettelser:

**Kontroller tilladelser:**
```
1. Browsernotifikationstilladelser aktiveret
2. Operativsystemets notifikationstilladelser
3. OneUptime-notifikationsindstillinger konfigureret
4. Forstyr ikke-tilstand deaktiveret
```

**Platformspecifikke:**
- **Android**: Kontroller batterioptimering
- **iOS**: Bekræft notifikationsindstillinger i Indstillinger-appen
- **Windows**: Kontroller Fokusassistent-indstillinger
- **macOS**: Bekræft tilladelser i notifikationscenter
- **Linux**: Kontroller notifikationsdæmon-status

### Kan jeg tilpasse notifikationslyde?

Tilpasningsmuligheder for notifikationer:
- **Systemlyde**: Brug OS-notifikationslydsindstillinger
- **Browserindstillinger**: Konfigurer i browsernotifikationspræferencer
- **OneUptime-indstillinger**: Sæt notifikationspræferencer i dashboard
- **Prioritetsniveauer**: Konfigurer forskellige lyde til alvorlighedsniveauer

### Hvordan deaktiverer jeg notifikationer midlertidigt?

Midlertidig deaktivering af notifikationer:
- **Forstyr ikke**: Aktiver system-DND-tilstand
- **Browserindstillinger**: Deaktiver sitenotifikationer midlertidigt
- **OneUptime-dashboard**: Sæt notifikationer på pause i indstillinger
- **Fokusetilstande**: Brug OS-fokus/koncentrationsindstillinger

## Sikkerheds-FAQ

### Er OneUptime PWA sikker?

Sikkerhedsfunktioner og overvejelser:
- **HTTPS-kryptering**: Alle data overføres sikkert
- **Same-Origin-politik**: Browsersikkerhedsbegrænsninger gælder
- **Sandboxet miljø**: Kører i browsersikkerhedssandbox
- **Regelmæssige opdateringer**: Sikkerhedsrettelser anvendes automatisk
- **Ingen rodadgang**: Begrænset systemadgang sammenlignet med native apps


*Bemærk: Følsomme data er krypteret og følger browsersikkerhedsstandarder.*

### Kan jeg bruge OneUptime PWA på virksomhedsnetværk?

Overvejelser for virksomhedsnetværk:
- **Firewallregler**: Sørg for HTTPS-adgang (port 443)
- **Proxykonfiguration**: Konfigurer browserproxyindstillinger
- **Certifikattillid**: Installer virksomhedscertifikater, hvis det er nødvendigt
- **VPN-adgang**: Brug VPN til fjernadgang
- **Sikkerhedspolitikker**: Overhold IT-sikkerhedskrav

## Fejlfinding

### Installationsproblemer

**Problem**: Installationsknap vises ikke
```
Løsninger:
1. Vent 30+ sekunder på OneUptime-siden
2. Opdater siden og vent igen
3. Ryd browsercache og cookies
4. Prøv en anden browser (Chrome/Edge anbefales)
5. Bekræft HTTPS-forbindelsen (kontroller for låseikon)
6. Kontroller, om det allerede er installeret
```

**Problem**: Installation mislykkes eller crasher
```
Løsninger:
1. Sørg for tilstrækkelig lagerplads (100 MB+)
2. Luk andre browserfaner og applikationer
3. Opdater browser til nyeste version
4. Deaktiver browserudvidelser midlertidigt
5. Prøv installation i privat/inkognitotilstand
6. Genstart browser og prøv igen
```

**Problem**: App installeres men vises ikke
```
Løsninger:
1. Kontroller alle app-startersteder
2. Søg efter "OneUptime" i enhedens søgning
3. Se i browserens app-administrationssektion
4. Vent 1-2 minutter på, at systemet opdaterer
5. Genstart enheden og kontroller igen
```

**Problem**: App crasher hyppigt
```
Løsninger:
1. Opdater browser til nyeste version
2. Ryd alle browserdata for OneUptime
3. Deaktiver browserudvidelser
4. Kontroller tilgængelig lagerplads
5. Genstart operativsystemet
6. Geninstaller OneUptime PWA
```

**Problem**: Push-notifikationer virker ikke
```
Løsninger:
1. Kontroller notifikationstilladelser i browser
2. Bekræft systemnotifikationsindstillinger
3. Test med simpel notifikation først
4. Ryd notifikationsdata og giv tilladelser igen
5. Kontroller indstillinger for Forstyr ikke/Fokus-tilstand
6. Bekræft OneUptime-notifikationskonfiguration
```

**Problem**: App synkroniserer ikke nyeste data
```
Løsninger:
1. Træk ned for at opdatere (mobil)
2. Tryk Ctrl+F5 (Windows/Linux) eller Cmd+R (Mac)
3. Luk og åbn appen igen
4. Ryd app-cache og genindlæs
5. Kontroller netværksforbindelsen
```

### Platformspecifikke problemer

**Android-problemer:**
```
Problem: App vises ikke i app-skuffe
Løsning: Kontroller afsnittet "Senest tilføjede" apps, søg i app-skuffe

Problem: Notifikationer forsinket
Løsning: Deaktiver batterioptimering for browser-app

Problem: App crasher ved start
Løsning: Ryd Chrome-app-data, genstart enhed
```

**iOS-problemer:**
```
Problem: Kan ikke tilføje til startskærm
Løsning: Brug Safari-browser, sørg for iOS 11.3+

Problem: App-ikon mangler
Løsning: Kontroller alle startskærmssider og App-bibliotek

Problem: Face ID virker ikke
Løsning: Aktiver Face ID til Safari i indstillinger
```

**Windows-problemer:**
```
Problem: App vises ikke i startmenu
Løsning: Søg efter app-navn, kontroller listen over installerede apps

Problem: Notifikationer vises ikke
Løsning: Kontroller Windows-notifikationsindstillinger, aktiver for browser

Problem: Vinduesstørrelsesproblemer
Løsning: Tilpas størrelse manuelt, app husker dimensionerne
```

**macOS-problemer:**
```
Problem: Kan ikke installere via Safari
Løsning: Opdater til macOS Sonoma+, brug Arkiv → Tilføj til Dock

Problem: App ikke i Programmapper
Løsning: Kontroller Launchpad, brug Spotlight-søgning

Problem: Notifikationer virker ikke
Løsning: Kontroller Systemindstillinger → Notifikationer
```

**Linux-problemer:**
```
Problem: PWA-installationsindstilling mangler
Løsning: Brug Chrome/Chromium, sørg for understøttelse af skrivebordsmiljø

Problem: Ikon vises ikke i starter
Løsning: Opdater skrivebordsdatabase, kontroller .desktop-fil

Problem: Lydnotifikationer virker ikke
Løsning: Kontroller PulseAudio, bekræft browserens lydtilladelser
```

### Fejlmeddelelser

**"Dette websted kan ikke installeres"**
```
Årsager:
- OneUptime-instansen opfylder ikke PWA-krav
- Manglende eller ugyldig webapp-manifest
- HTTPS ikke korrekt konfigureret
- Browser understøtter ikke PWA-installation

Løsninger:
- Kontakt administrator for at bekræfte PWA-opsætning
- Prøv en anden browser
- Kontroller browserkonsollen for detaljerede fejl
```

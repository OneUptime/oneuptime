# Windows-installationsvejledning

Installer OneUptime som en desktop-applikation på Windows til omfattende overvågning og incident management.


## Installationsmetoder

### Metode 1: Microsoft Edge (anbefalet)

Edge leverer den bedste Windows PWA-integration med native funktioner.

1. **Åbn OneUptime i Edge**
   - Start Microsoft Edge-browseren
   - Naviger til din OneUptime-instans-URL
   - Log ind på din OneUptime-konto
   - Vent på fuldstændig sideindlæsning

2. **Installer app**
   - Se efter **installer-ikonet** (⊞) i adresselinjen
   - Klik på knappen **"Installer OneUptime"**
   - Eller klik på **tre-punkts-menuen** → **Apps** → **Installer dette websted som en app**

3. **Tilpas installation**
   - **App-navn**: Ændr, hvis ønsket (standard: OneUptime)
   - **Startmenu**: Vælg, om der skal tilføjes til Startmenu
   - **Proceslinje**: Mulighed for at fastgøre til proceslinjen
   - **Skrivebord**: Opret skrivebordsgenvej

4. **Fuldfør installation**
   - Klik på **"Installer"** for at afslutte
   - OneUptime åbnes i sit eget vindue
   - Find det i Startmenu under installerede apps

### Metode 2: Google Chrome

Chrome tilbyder fremragende PWA-understøttelse med avanceret desktop-integration.

1. **Åbn OneUptime i Chrome**
   - Start Google Chrome
   - Gå til din OneUptime-instans
   - Sørg for, at du er logget ind
   - Tillad fuldstændig sideindlæsning

2. **Installer via adresselinje**
   - Se efter **installer-ikon** (⊞) i adresselinjen
   - Klik på **"Installer OneUptime"**
   - Eller brug menuen: **tre punkter** → **Flere værktøjer** → **Opret genvej**

3. **Installationsindstillinger**
   - Marker **"Åbn som vindue"** for app-lignende oplevelse
   - Tilpas app-navn, hvis ønsket
   - Klik på **"Installer"** eller **"Opret"**

4. **Start app**
   - Find OneUptime i Windows Startmenu
   - Eller start fra skrivebordsgenvej
   - App åbnes i dedikeret vindue

### Metode 3: Firefox

Firefox understøtter PWA-installation med grundlæggende desktop-integration.

1. **Åbn OneUptime i Firefox**
   - Start Firefox-browseren
   - Naviger til OneUptime-URL
   - Fuldfør loginprocessen

2. **Installer PWA**
   - Se efter **installationsprompt** eller banner
   - Eller klik på **menu** → **Installer**
   - Klik på **"Tilføj til startskærm"**-ækvivalent, hvis tilgængeligt


### Opstartskonfiguration
1. **Autostart**: Konfigurer OneUptime til at starte med Windows
   - Højreklik på proceslinje → Jobliste → Start
   - Aktiver OneUptime, hvis ønsket
2. **Standardstørrelse**: Sæt foretrukken vinduesstørrelse og -position

### Notifikationsindstillinger
1. **Windows-notifikationer**
   - Indstillinger → System → Notifikationer og handlinger
   - Find OneUptime og konfigurer advarselspræferencer
   - Aktiver bannernotifikationer til incidents

2. **Fokusassistent**
   - Konfigurer indstillinger for Forstyr ikke
   - Tillad OneUptime kritiske notifikationer
   - Sæt prioritetsniveauer for forskellige advarselstyper

## Avancerede installationsindstillinger


## Fejlfinding

### Installationsproblemer

**Installeringsknap vises ikke:**
```
Løsninger:
1. Sørg for, at du bruger Edge eller Chrome (anbefalede browsere)
2. Bekræft HTTPS-forbindelsen til OneUptime-instansen
3. Ryd browsercache og cookies
4. Opdater browser til nyeste version
5. Kontroller, om PWA-krav er opfyldt på serveren
6. Deaktiver browserudvidelser midlertidigt
```

**Installation mislykkes eller crasher:**
```
Løsninger:
1. Kør browser som administrator
2. Kontroller Windows User Account Control (UAC)-indstillinger
3. Sørg for tilstrækkelig diskplads (minimum 100 MB)
4. Deaktiver antivirussoftware midlertidigt
5. Ryd browserdata fuldstændigt
6. Genstart Windows og prøv igen
```

**App vises ikke i Startmenu:**
```
Løsninger:
1. Søg efter "OneUptime" i Windows-søgning
2. Kontroller, om det er installeret under et andet navn
3. Se i afsnittet "Nyligt tilføjede" apps
4. Geninstaller og sørg for, at "Tilføj til Startmenu" er markeret
5. Opret genvej manuelt om nødvendigt
```

### Notifikationsproblemer

**Windows-notifikationer virker ikke:**
```
Løsninger:
1. Windows-indstillinger → System → Notifikationer og handlinger
2. Aktiver notifikationer for OneUptime
3. Kontroller Fokusassistent-indstillinger
4. Sørg for notifikationstilladelser i OneUptime
5. Test med simpel notifikation først
```

## Afinstallation

### Fuldstændig fjernelse
1. **Windows Indstillinger-metoden**
   - Indstillinger → Apps → Apps og funktioner
   - Søg efter "OneUptime"
   - Klik og vælg "Afinstaller"

2. **Browser-metoden**
   - Åbn Edge/Chrome
   - Gå til edge://apps/ eller chrome://apps/
   - Find OneUptime
   - Klik på indstillinger → Afinstaller

3. **Startmenu-metoden**
   - Højreklik på OneUptime i Startmenu
   - Vælg "Afinstaller"
   - Bekræft fjernelse


## Opdateringer og vedligeholdelse

### Automatiske opdateringer
- OneUptime PWA opdateres automatisk, når der er netværksforbindelse
- Ingen manuel indgriben kræves
- Opdateringer anventes øjeblikkeligt ved genstart
- Kritiske rettelser deployeres øjeblikkeligt

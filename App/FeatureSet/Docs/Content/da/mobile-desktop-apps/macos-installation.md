# macOS-installationsvejledning

Installer OneUptime som en native desktop-applikation på macOS til problemfri overvågning og incident management.

## Installationsmetoder

### Metode 1: Safari (anbefalet til macOS)

Safari leverer fremragende PWA-integration med native macOS-funktioner.

1. **Åbn OneUptime i Safari**

   - Start Safari-browseren
   - Naviger til din OneUptime-instans-URL
   - Log ind på din OneUptime-konto
   - Vent på, at siden er fuldt indlæst

2. **Installer PWA**

   - Klik på **Arkiv** i menulinjen
   - Vælg **"Tilføj til Dock"** (macOS Sonoma+)
   - Eller se efter **installer-ikon** i adresselinjen
   - Alternativt: **Arkiv** → **"Tilføj til startskærm"** (ældre macOS)

3. **Tilpas installation**

   - **App-navn**: Ændr, hvis ønsket (standard: OneUptime)
   - **Dock**: Vælg at tilføje til Dock
   - **Launchpad**: Tilføj til Launchpad for nem adgang

4. **Start app**
   - Find OneUptime i Dock, Launchpad eller Programmapper
   - Klik for at starte i dedikeret vindue
   - App kører uafhængigt af Safari-browseren

### Metode 2: Google Chrome

Chrome tilbyder robust PWA-understøttelse med fremragende desktop-integration.

1. **Åbn OneUptime i Chrome**

   - Start Google Chrome
   - Gå til din OneUptime-instans
   - Sørg for, at du er logget ind
   - Tillad fuldstændig sideindlæsning

2. **Installer via menu**

   - Se efter **installer-ikon** (⊞) i adresselinjen
   - Klik på **"Installer OneUptime"**
   - Eller brug **Chrome-menu** → **Flere værktøjer** → **Opret genvej**

3. **Installationsindstillinger**

   - Marker **"Åbn som vindue"** for native app-oplevelse
   - Tilpas app-navn, hvis nødvendigt
   - Klik på **"Installer"** eller **"Opret"**

4. **Adgang til app**
   - Find OneUptime i Programmapper
   - Eller adgang via Spotlight-søgning
   - Fastgør til Dock for hurtig adgang

### Metode 3: Microsoft Edge

Edge leverer solid PWA-understøttelse med god macOS-integration.

1. **Åbn OneUptime i Edge**

   - Start Microsoft Edge
   - Naviger til OneUptime-URL
   - Fuldfør loginprocessen

2. **Installer app**
   - Klik på **tre-punkts-menuen** → **Apps** → **Installer dette websted som en app**
   - Eller se efter installationsprompt i adresselinjen
   - Tilpas app-navn, hvis ønsket
   - Klik på **"Installer"**

### Tilpasningsmuligheder

### Dock og Launchpad

1. **Dock-position**: Træk OneUptime til den foretrukne Dock-position
2. **Dock-størrelse**: Tilpas ikonets størrelse i Dock-præferencer
3. **Launchpad-organisation**: Opret overvågningsapp-mappe
4. **Badge-notifikationer**: Vis antal incidents på Dock-ikon

### Menulinje og notifikationer

1. **Notifikationscenter**

   - Systemindstillinger → Notifikationer → OneUptime
   - Konfigurer advarselstyper og levering
   - Sæt prioritetsniveauer for forskellige incidenttyper

2. **Menulinjeintegration**
   - Native menulinje til Safari PWA'er
   - Brugerdefinerede menupunkter til hyppige handlinger
   - Tastaturgenveje til almindelige opgaver

## Fejlfinding

### Installationsproblemer

**"Tilføj til Dock" ikke tilgængeligt i Safari:**

```
Løsninger:
1. Sørg for macOS Sonoma (14.0) eller nyere
2. Opdater Safari til nyeste version
3. Prøv alternativ: Arkiv → Tilføj til startskærm
4. Ryd Safari-cache og prøv igen
5. Brug Chrome eller Edge som alternativ
```

**PWA installeres ikke eller crasher:**

```
Løsninger:
1. Kontroller macOS-versionskompatibilitet
2. Sørg for tilstrækkelig diskplads (100 MB+)
3. Opdater browser til nyeste version
4. Ryd browsercache og cookies
5. Deaktiver browserudvidelser midlertidigt
6. Genstart Mac og prøv installation igen
```

**App vises ikke i Programmer:**

```
Løsninger:
1. Kontroller Launchpad for OneUptime-ikon
2. Søg med Spotlight (⌘+Mellemrum)
3. Se i browserens PWA-administrationssektion
4. Prøv at geninstallere med en anden browser
5. Kontroller, om det er installeret under et andet navn
```

### Notifikationsproblemer

**macOS-notifikationer virker ikke:**

```
Løsninger:
1. Systemindstillinger → Notifikationer → OneUptime
2. Aktiver "Tillad notifikationer"
3. Sæt passende advarselstype (bannere/advarsler)
4. Kontroller indstillinger for Forstyr ikke
5. Bekræft OneUptime-notifikationsindstillinger
6. Giv notifikationstilladelser, når du bliver bedt om det
```

## Afinstallation

### Fuldstændig fjernelse

1. **Programmermetoden**

   - Åbn Programmapper
   - Find OneUptime
   - Træk til Papirkurv eller højreklik → Flyt til papirkurv

2. **Dock-metoden**

   - Højreklik på OneUptime i Dock
   - Vælg "Indstillinger" → "Fjern fra Dock"
   - Slet derefter fra Programmapper

3. **Browser PWA-administration**
   - **Chrome**: chrome://apps/ → Find OneUptime → Fjern
   - **Edge**: edge://apps/ → Find OneUptime → Afinstaller
   - **Safari**: Ingen dedikeret administrationsside

## Opdateringer og vedligeholdelse

### Automatiske opdateringer

- OneUptime PWA opdateres automatisk, når der er netværksforbindelse
- Ingen App Store-opdateringer kræves
- Nye funktioner er straks tilgængelige
- Kritiske opdateringer anventes øjeblikkeligt

### Manuel opdateringsproces

Tving opdatering af applikationen:

1. **Safari PWA'er**: Opdater inden for Safari-browseren
2. **Chrome PWA'er**: Højreklik på app → Genindlæs eller ⌘+R
3. **Fuldstændig opdatering**: Luk app, åbn browser igen, besøg OneUptime

### Vedligeholdelsesplan

Regelmæssig vedligeholdelse for optimal ydeevne:

**Ugentligt:**

- Genstart OneUptime-appen
- Ryd browsercache, hvis du oplever problemer
- Kontroller for macOS-opdateringer

**Månedligt:**

- Gennemgå lagerbrug og ryd om nødvendigt
- Opdater browsere, hvis de ikke opdaterer automatisk
- Bekræft, at notifikationsindstillinger stadig fungerer

## Integration med macOS-funktioner

### Integration med Genveje-appen

Opret brugerdefinerede genveje til OneUptime:

1. Åbn **Genveje**-appen
2. Opret **Ny genvej**
3. Tilføj **"Åbn app"**-handling
4. Vælg **OneUptime**
5. Tilføj til Siri for stemmaktivering

### Automator-integration

Automatiser OneUptime-opgaver:

1. Start **Automator**
2. Opret **Applikation** eller **Arbejdsgang**
3. Tilføj **"Start applikation"**-handling
4. Vælg OneUptime PWA
5. Tilføj yderligere automatiseringstrin

### Terminal-integration

Administrer OneUptime via Terminal:

```bash
# Opret alias til hurtig OneUptime-start
echo 'alias oneuptime="open -a \"OneUptime\""' >> ~/.zshrc

# Funktion til at kontrollere, om OneUptime kører
oneuptime_status() {
    if pgrep -f "OneUptime" > /dev/null; then
        echo "OneUptime is running"
    else
        echo "OneUptime is not running"
    fi
}
```

## Sikkerhed og privatliv

### macOS-sikkerhedsfunktioner

1. **Gatekeeper**: Sørg for, at PWA-installationer er fra betroede kilder
2. **System Integrity Protection**: Beskytter systemfiler
3. **FileVault**: Krypter disk for databeskyttelse
4. **Keychain**: Sikker legitimationsoplysningslagring

### Privatlivsovervejelser

1. **Placeringstjenester**: Konfigurer, hvis det er nødvendigt til overvågning
2. **Kamera/mikrofon**: Giv tilladelser efter behov
3. **Skærmoptagelse**: Kan være nødvendig til visse overvågningsfunktioner
4. **Netværksadgang**: Sørg for korrekt firewallkonfiguration

### Bedste praksis

1. **Regelmæssige opdateringer**: Hold macOS og browsere opdaterede
2. **Stærk autentificering**: Brug Touch ID/Face ID, når det er tilgængeligt
3. **Netværkssikkerhed**: Brug VPN til fjernovervågningsadgang
4. **Datasikkerhedskopiering**: Regelmæssige Time Machine-sikkerhedskopier inkluderer PWA-data
5. **Tilladelsesgennemgang**: Gennemgå regelmæssigt tildelte tilladelser

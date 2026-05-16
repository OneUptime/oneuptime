# Android-installationsvejledning

Installer OneUptime som en native app på din Android-enhed for den bedste overvågningsoplevelse.

## Installationsmetoder

### Metode 1: Chrome-browser (anbefalet)

1. **Åbn OneUptime i Chrome**
   - Start Google Chrome på din Android-enhed
   - Naviger til din OneUptime-instans-URL
   - Vent på, at siden er fuldt indlæst

2. **Installationsprompt**
   - Se efter banneret "Tilføj til startskærm" nederst
   - Tryk på "Installer" eller "Tilføj til startskærm"
   - Hvis du ikke ser prompten, skal du trykke på tre-punkts-menuen (⋮) i øverste højre hjørne

3. **Manuel installation via menu**
   - Tryk på Chrome-menuen (tre punkter)
   - Vælg "Tilføj til startskærm" eller "Installer app"
   - Tilpas app-navnet, hvis ønsket
   - Tryk på "Tilføj" for at bekræfte

4. **Start appen**
   - Find OneUptime-ikonet på din startskærm eller i app-skuffen
   - Tryk for at starte appen i fuld skærm-tilstand

### Metode 2: Samsung Internet

1. **Åbn OneUptime**
   - Start Samsung Internet-browseren
   - Gå til din OneUptime-instans
   - Vent på fuldstændig sideindlæsning

2. **Tilføj til startskærm**
   - Tryk på menuknappen (tre linjer)
   - Vælg "Tilføj side til" → "Startskærm"
   - Indtast app-navn og tryk på "Tilføj"

3. **Start**
   - Find app-ikonet på din startskærm
   - Tryk for at åbne OneUptime i app-tilstand

### Metode 3: Firefox

1. **Åbn OneUptime**
   - Start Firefox-browseren
   - Naviger til din OneUptime-URL
   - Lad siden indlæse fuldstændigt

2. **Installer**
   - Tryk på tre-punkts-menuen
   - Vælg "Installer" (hvis tilgængeligt)
   - Eller vælg "Tilføj til startskærm"
   - Bekræft installationen

### Tilpasningsmuligheder

### App-navn
- Under installationen kan du tilpasse app-navnet
- Standard: "OneUptime"
- Anbefalet: Behold som "OneUptime" eller tilføj dit firmanavn

### Notifikationsindstillinger
1. **Giv tilladelser**
   - Tillad notifikationer, når du bliver bedt om det
   - Gå til Indstillinger → Apps → OneUptime → Notifikationer
   - Aktiver alle notifikationskategorier for den bedste oplevelse

2. **Tilpas advarsler**
   - Konfigurer hvilke incidents der udløser notifikationer
   - Sæt notifikationsprioritetsniveauer
   - Vælg lyd- og vibrationspræferencer

## Fejlfinding

### Installationsproblemer

**"Tilføj til startskærm" vises ikke:**
```
1. Ryd browsercache og cookies
2. Sørg for, at du er på HTTPS (sikker forbindelse)
3. Vent 2-3 minutter på siden, inden du leder efter prompten
4. Kontroller, om PWA-kravene er opfyldt på din OneUptime-instans
```

**Installation mislykkes:**
```
1. Frigør lagerplads (kræver mindst 50 MB)
2. Opdater din browser til den nyeste version
3. Genstart din browser og prøv igen
4. Prøv en anden browser (Chrome anbefales)
```

**App-ikon vises ikke:**
```
1. Kontroller startskærm og app-skuffe
2. Se i afsnittet "Senest tilføjede" apps
3. Søg efter "OneUptime" i app-skuffen
4. Geninstaller om nødvendigt
```

### Notifikationsproblemer

**Modtager ikke notifikationer:**
```
1. Kontroller notifikationstilladelser:
   - Indstillinger → Apps → OneUptime → Tilladelser → Notifikationer
2. Sørg for, at notifikationer er aktiveret i OneUptime-dashboardet
3. Kontroller indstillinger for Forstyr ikke
4. Bekræft, at batterioptimering ikke blokerer OneUptime
```

**Notifikationer forsinket:**
```
1. Deaktiver batterioptimering for OneUptime:
   - Indstillinger → Apps → OneUptime → Batteri → Optimer batteriforbrug
2. Tillad baggrundssaktivitet
3. Kontroller indstillinger for datasparer
```

## Afinstallation

### Fjern app
1. **Langt tryk** på OneUptime-ikonet på startskærmen
2. Vælg **"Afinstaller"** eller træk til papirkurven
3. Bekræft fjernelse

### Alternativ metode
1. Gå til **Indstillinger → Apps**
2. Find **"OneUptime"**
3. Tryk på **"Afinstaller"**
4. Bekræft fjernelse

### Ryd data
- Afinstallation fjerner alle cachelagrede data
- Dine OneUptime-kontodata forbliver sikre på serveren
- Geninstallation kræver nyt login

## Avanceret konfiguration

### Udviklermuligheder
For avancerede brugere, der ønsker at inspicere PWA'en:
1. Aktiver Udviklermuligheder i Android
2. Opret forbindelse til computer med ADB
3. Brug Chrome DevTools til fjerndebugning

### Netværkskonfiguration
- Konfigurer VPN, hvis du tilgår intern OneUptime-instans
- Opsæt proxyindstillinger, hvis det kræves af din organisation
- Sørg for, at firewall tillader PWA-ressourcer

## Opdateringer

OneUptime PWA opdateres automatisk:
- **Automatiske opdateringer**: App opdateres, når du besøger den online
- **Ingen manuelle opdateringer**: I modsætning til store-apps kræves ingen brugerhandling
- **Øjeblikkelige opdateringer**: Nye funktioner er straks tilgængelige
- **Tilbagerulningssikker**: Dårlige opdateringer kan hurtigt tilbagerulles

## Bedste praksis

### Til optimal ydeevne
1. **Første start**: Altid online til den første opsætning
2. **Regelmæssig brug**: Åbn app regelmæssigt for at holde cachen frisk
3. **Lagerstyring**: Hold tilstrækkelig ledig plads
4. **Netværk**: Brug Wi-Fi til den første installation og større opdateringer

### Sikkerhedsanbefalinger
1. **Kun HTTPS**: Installer kun fra sikre OneUptime-instanser
2. **Officielle URL'er**: Bekræft, at du installerer fra din organisations officielle OneUptime-URL
3. **Tilladelser**: Giv kun nødvendige tilladelser
4. **Opdateringer**: Hold dit Android OS og browsere opdaterede

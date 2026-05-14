# Installasjonsveiledning for Windows

Installer OneUptime som en skrivebordsapplikasjon på Windows for omfattende overvåking og hendelseshåndtering.


## Installasjonsmetoder

### Metode 1: Microsoft Edge (anbefalt)

Edge gir den beste Windows PWA-integrasjonen med innebygde funksjoner.

1. **Åpne OneUptime i Edge**
   - Start Microsoft Edge-nettleseren
   - Naviger til URL-en for OneUptime-instansen din
   - Logg inn på OneUptime-kontoen din
   - Vent til siden er fullstendig lastet

2. **Installer appen**
   - Se etter **installikonet** (⊞) i adressefeltet
   - Klikk knappen **"Installer OneUptime"**
   - Eller klikk **menyen med tre punkter** → **Apper** → **Installer dette nettstedet som en app**

3. **Tilpass installasjonen**
   - **Appnavn**: Endre om ønskelig (standard: OneUptime)
   - **Start-meny**: Velg om du vil legge til i Start-menyen
   - **Oppgavelinje**: Alternativ for å feste til oppgavelinjen
   - **Skrivebord**: Opprett snarvei på skrivebordet

4. **Fullfør installasjonen**
   - Klikk **"Installer"** for å fullføre
   - OneUptime åpner i sitt eget vindu
   - Finn det i Start-menyen under installerte apper

### Metode 2: Google Chrome

Chrome tilbyr utmerket PWA-støtte med rik skrivebordsintegrasjon.

1. **Åpne OneUptime i Chrome**
   - Start Google Chrome
   - Gå til OneUptime-instansen din
   - Sørg for at du er logget inn
   - Vent til siden er fullstendig lastet

2. **Installer via adressefeltet**
   - Se etter **installikonet** (⊞) i adressefeltet
   - Klikk **"Installer OneUptime"**
   - Eller bruk menyen: **tre punkter** → **Flere verktøy** → **Opprett snarvei**

3. **Installasjonsalternativer**
   - Huk av **"Åpne som vindu"** for app-lignende opplevelse
   - Tilpass appnavnet om ønskelig
   - Klikk **"Installer"** eller **"Opprett"**

4. **Start appen**
   - Finn OneUptime i Windows Start-menyen
   - Eller start fra snarveien på skrivebordet
   - Appen åpner i dedikert vindu

### Metode 3: Firefox

Firefox støtter PWA-installasjon med grunnleggende skrivebordsintegrasjon.

1. **Åpne OneUptime i Firefox**
   - Start Firefox-nettleseren
   - Naviger til OneUptime-URL-en
   - Fullfør innloggingsprosessen

2. **Installer PWA**
   - Se etter **installasjonsforespørsel** eller -banner
   - Eller klikk **meny** → **Installer**
   - Hvis tilgjengelig, klikk tilsvarende **"Legg til på startskjerm"**


### Oppstartkonfigurasjon
1. **Autostart**: Konfigurer OneUptime til å starte med Windows
   - Høyreklikk på oppgavelinjen → Oppgavebehandler → Oppstart
   - Aktiver OneUptime om ønskelig
2. **Standardstørrelse**: Angi foretrukket vindusstørrelse og -posisjon

### Varselinnstillinger
1. **Windows-varsler**
   - Innstillinger → System → Varsler og handlinger
   - Finn OneUptime og konfigurer varselpreferanser
   - Aktiver bannervarsler for hendelser

2. **Fokushjelp**
   - Konfigurer innstillinger for Ikke forstyrr
   - Tillat kritiske OneUptime-varsler
   - Sett prioritetsnivåer for ulike varseltyper

## Avanserte installasjonsalternativer


## Feilsøking

### Installasjonsproblemer

**Installeringsknapp vises ikke:**
```
Løsninger:
1. Sørg for at du bruker Edge eller Chrome (anbefalte nettlesere)
2. Bekreft HTTPS-tilkobling til OneUptime-instansen
3. Tøm nettleserens hurtigbuffer og informasjonskapsler
4. Oppdater nettleseren til nyeste versjon
5. Sjekk om PWA-kravene er oppfylt på serveren
6. Deaktiver nettleserutvidelser midlertidig
```

**Installasjonen mislykkes eller krasjer:**
```
Løsninger:
1. Kjør nettleseren som administrator
2. Sjekk Windows-innstillinger for brukerkontokontroll (UAC)
3. Sørg for tilstrekkelig diskplass (minimum 100 MB)
4. Deaktiver antivirusprogramvare midlertidig
5. Tøm nettleserdata fullstendig
6. Start Windows på nytt og prøv igjen
```

**Appen vises ikke i Start-menyen:**
```
Løsninger:
1. Søk etter "OneUptime" i Windows-søk
2. Sjekk om det er installert under et annet navn
3. Se i seksjonen "Nylig lagt til" apper
4. Installer på nytt og sørg for at "Legg til i Start-menyen" er huket av
5. Opprett snarvei manuelt om nødvendig
```

### Varslingsproblemer

**Windows-varsler fungerer ikke:**
```
Løsninger:
1. Windows Innstillinger → System → Varsler og handlinger
2. Aktiver varsler for OneUptime
3. Sjekk Fokushjelp-innstillinger
4. Sørg for varselstillatelser i OneUptime
5. Test med enkelt varsel først
```

## Avinstallasjon

### Fullstendig fjerning
1. **Windows Innstillinger-metode**
   - Innstillinger → Apper → Apper og funksjoner
   - Søk etter "OneUptime"
   - Klikk og velg "Avinstaller"

2. **Nettlesermetode**
   - Åpne Edge/Chrome
   - Gå til edge://apps/ eller chrome://apps/
   - Finn OneUptime
   - Klikk alternativer → Avinstaller

3. **Start-meny-metode**
   - Høyreklikk OneUptime i Start-menyen
   - Velg "Avinstaller"
   - Bekreft fjerning


## Oppdateringer og vedlikehold

### Automatiske oppdateringer
- OneUptime PWA oppdateres automatisk når den er tilkoblet
- Ingen manuell intervensjon påkrevd
- Oppdateringer brukes umiddelbart ved omstart
- Kritiske oppdateringer distribueres umiddelbart

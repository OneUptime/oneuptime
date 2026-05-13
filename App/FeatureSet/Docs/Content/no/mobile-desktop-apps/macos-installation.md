# Installasjonsveiledning for macOS

Installer OneUptime som en innebygd skrivebordsapplikasjon på macOS for sømløs overvåking og hendelseshåndtering.

## Installasjonsmetoder

### Metode 1: Safari (anbefalt for macOS)

Safari gir utmerket PWA-integrasjon med innebygde macOS-funksjoner.

1. **Åpne OneUptime i Safari**
   - Start Safari-nettleseren
   - Naviger til URL-en for OneUptime-instansen din
   - Logg inn på OneUptime-kontoen din
   - Vent til siden er fullstendig lastet

2. **Installer PWA**
   - Klikk **Fil** i menylinjen
   - Velg **"Legg til i Dock"** (macOS Sonoma+)
   - Eller se etter **installikone** i adressefeltet
   - Alternativt: **Fil** → **"Legg til på startskjerm"** (eldre macOS)

3. **Tilpass installasjonen**
   - **Appnavn**: Endre om ønskelig (standard: OneUptime)
   - **Dock**: Velg å legge til i Dock
   - **Launchpad**: Legg til i Launchpad for enkel tilgang

4. **Start appen**
   - Finn OneUptime i Dock, Launchpad eller Programmer-mappen
   - Klikk for å starte i dedikert vindu
   - Appen kjører uavhengig av Safari-nettleseren

### Metode 2: Google Chrome

Chrome tilbyr robust PWA-støtte med utmerket skrivebordsintegrasjon.

1. **Åpne OneUptime i Chrome**
   - Start Google Chrome
   - Gå til OneUptime-instansen din
   - Sørg for at du er logget inn
   - Vent til siden er fullstendig lastet

2. **Installer via meny**
   - Se etter **installikone** (⊞) i adressefeltet
   - Klikk **"Installer OneUptime"**
   - Eller bruk **Chrome-menyen** → **Flere verktøy** → **Opprett snarvei**

3. **Installasjonsalternativer**
   - Huk av **"Åpne som vindu"** for innebygd appopplevelse
   - Tilpass appnavnet om nødvendig
   - Klikk **"Installer"** eller **"Opprett"**

4. **Tilgang til appen**
   - Finn OneUptime i Programmer-mappen
   - Eller tilgang via Spotlight-søk
   - Fest til Dock for rask tilgang

### Metode 3: Microsoft Edge

Edge gir solid PWA-støtte med god macOS-integrasjon.

1. **Åpne OneUptime i Edge**
   - Start Microsoft Edge
   - Naviger til OneUptime-URL-en
   - Fullfør innloggingsprosessen

2. **Installer appen**
   - Klikk **menyen med tre punkter** → **Apper** → **Installer dette nettstedet som en app**
   - Eller se etter installasjonsforespørsel i adressefeltet
   - Tilpass appnavnet om ønskelig
   - Klikk **"Installer"**

### Tilpasningsalternativer

### Dock og Launchpad
1. **Dock-posisjon**: Dra OneUptime til foretrukket Dock-posisjon
2. **Dock-størrelse**: Endre størrelse på ikonet i Dock-preferanser
3. **Launchpad-organisering**: Opprett mappe for overvåkingsapper
4. **Badge-varsler**: Vis hendelsestellingen på Dock-ikonet

### Menylinje og varsler
1. **Varselsenter**
   - Systemvalg → Varsler → OneUptime
   - Konfigurer varselstiler og levering
   - Sett prioritetsnivåer for ulike hendelsestyper

2. **Menylinjeintegrasjon**
   - Innebygd menylinje for Safari-PWA-er
   - Egendefinerte menyelementer for hyppige handlinger
   - Tastatursnarveier for vanlige oppgaver

## Feilsøking

### Installasjonsproblemer

**"Legg til i Dock" er ikke tilgjengelig i Safari:**
```
Løsninger:
1. Sørg for macOS Sonoma (14.0) eller nyere
2. Oppdater Safari til nyeste versjon
3. Prøv alternativet: Fil → Legg til på startskjerm
4. Tøm Safari-hurtigbuffer og prøv igjen
5. Bruk Chrome eller Edge som alternativ
```

**PWA installerer ikke eller krasjer:**
```
Løsninger:
1. Sjekk macOS-versjonskompatibilitet
2. Sørg for tilstrekkelig diskplass (100 MB+)
3. Oppdater nettleseren til nyeste versjon
4. Tøm nettleserens hurtigbuffer og informasjonskapsler
5. Deaktiver nettleserutvidelser midlertidig
6. Start Mac på nytt og prøv installasjonen igjen
```

**Appen vises ikke i Programmer:**
```
Løsninger:
1. Sjekk Launchpad for OneUptime-ikonet
2. Søk med Spotlight (⌘+Mellomrom)
3. Se i nettleserens PWA-administrasjonsseksjon
4. Prøv reinstallasjon med en annen nettleser
5. Sjekk om det er installert under et annet navn
```

### Varslingsproblemer

**macOS-varsler fungerer ikke:**
```
Løsninger:
1. Systemvalg → Varsler → OneUptime
2. Aktiver "Tillat varsler"
3. Sett passende varselstil (bannere/varsler)
4. Sjekk innstillinger for Ikke forstyrr
5. Bekreft OneUptime-varselinnstillinger
6. Gi varselstillatelser når du blir bedt om det
```

## Avinstallasjon

### Fullstendig fjerning
1. **Programmer-mappemetode**
   - Åpne Programmer-mappen
   - Finn OneUptime
   - Dra til papirkurv eller høyreklikk → Flytt til papirkurv

2. **Dock-metode**
   - Høyreklikk OneUptime i Dock
   - Velg "Alternativer" → "Fjern fra Dock"
   - Slett deretter fra Programmer-mappen

3. **Nettleser PWA-administrasjon**
   - **Chrome**: chrome://apps/ → Finn OneUptime → Fjern
   - **Edge**: edge://apps/ → Finn OneUptime → Avinstaller
   - **Safari**: Ingen dedikert administrasjonsside

## Oppdateringer og vedlikehold

### Automatiske oppdateringer
- OneUptime PWA oppdateres automatisk når den er tilkoblet
- Ingen App Store-oppdateringer påkrevd
- Nye funksjoner er tilgjengelige umiddelbart
- Kritiske oppdateringer brukes umiddelbart

## Feilsøking

### Installasjonsproblemer

**"Legg til i Dock" er ikke tilgjengelig i Safari:**
```
Løsninger:
1. Sørg for macOS Sonoma (14.0) eller nyere
2. Oppdater Safari til nyeste versjon
3. Prøv alternativet: Fil → Legg til på startskjerm
4. Tøm Safari-hurtigbuffer og prøv igjen
5. Bruk Chrome eller Edge som alternativ
```

**PWA installerer ikke eller krasjer:**
```
Løsninger:
1. Sjekk macOS-versjonskompatibilitet
2. Sørg for tilstrekkelig diskplass (100 MB+)
3. Oppdater nettleseren til nyeste versjon
4. Tøm nettleserens hurtigbuffer og informasjonskapsler
5. Deaktiver nettleserutvidelser midlertidig
6. Start Mac på nytt og prøv installasjonen igjen
```

**Appen vises ikke i Programmer:**
```
Løsninger:
1. Sjekk Launchpad for OneUptime-ikonet
2. Søk med Spotlight (⌘+Mellomrom)
3. Se i nettleserens PWA-administrasjonsseksjon
4. Prøv reinstallasjon med en annen nettleser
5. Sjekk om det er installert under et annet navn
```

### Ytelsesproblemer

**Treg ytelse eller høy CPU-bruk:**
```
Løsninger:
1. Sjekk Aktivitetsovervåker for ressursbruk
2. Lukk unødvendige applikasjoner
3. Sørg for tilstrekkelig RAM (8 GB+ anbefalt)
4. Oppdater macOS og nettleser
5. Tøm nettleserens hurtigbuffer og appdata
6. Start OneUptime-appen på nytt
```

**Minnelekkasjer eller krasj:**
```
Løsninger:
1. Overvåk minnebruk i Aktivitetsovervåker
2. Start OneUptime-appen regelmessig på nytt
3. Oppdater til nyeste nettleserversjon
4. Tøm nettleserens hurtigbuffer fullstendig
5. Sjekk Konsoll-appen for feillogger
6. Rapporter problemer med krasjlogger
```

### Visnings- og vindusproblemer

**Problemer med vindusstørrelse eller -posisjon:**
```
Løsninger:
1. Endre størrelse og posisjon manuelt
2. Bruk Vindu-menyen → Zoom (Safari-PWA-er)
3. Tilbakestill vindustilstand ved å avslutte og åpne på nytt
4. Sjekk skjermskalering i Systemvalg
5. Prøv et annet skrivebordsplass eller fullskjermsmodus
```

**Appen svarer ikke:**
```
Løsninger:
1. Tving-avslutt: ⌘+Alternativ+Esc → Velg OneUptime
2. Eller høyreklikk Dock-ikonet → Tving avslutt
3. Start applikasjonen på nytt
4. Sjekk for macOS- og nettleseroppdateringer
5. Tøm app-hurtigbuffer og installer på nytt om nødvendig
```

### Varslingsproblemer

**macOS-varsler fungerer ikke:**
```
Løsninger:
1. Systemvalg → Varsler → OneUptime
2. Aktiver "Tillat varsler"
3. Sett passende varselstil (bannere/varsler)
4. Sjekk innstillinger for Ikke forstyrr
5. Bekreft OneUptime-varselinnstillinger
6. Gi varselstillatelser når du blir bedt om det
```

## Avinstallasjon

### Fullstendig fjerning
1. **Programmer-mappemetode**
   - Åpne Programmer-mappen
   - Finn OneUptime
   - Dra til papirkurv eller høyreklikk → Flytt til papirkurv

2. **Dock-metode**
   - Høyreklikk OneUptime i Dock
   - Velg "Alternativer" → "Fjern fra Dock"
   - Slett deretter fra Programmer-mappen

3. **Nettleser PWA-administrasjon**
   - **Chrome**: chrome://apps/ → Finn OneUptime → Fjern
   - **Edge**: edge://apps/ → Finn OneUptime → Avinstaller
   - **Safari**: Ingen dedikert administrasjonsside

### Ren avinstallasjon
Fjern alle tilknyttede data:

```bash
# Tøm Safari PWA-data (generelle nettsteddata)
rm -rf ~/Library/Safari/Databases
rm -rf ~/Library/Caches/com.apple.Safari

# Tøm Chrome PWA-data
rm -rf ~/Library/Application\ Support/Google/Chrome/Default/Web\ Applications

# Tøm Edge PWA-data
rm -rf ~/Library/Application\ Support/Microsoft\ Edge/Default/Web\ Applications
```

## Oppdateringer og vedlikehold

### Automatiske oppdateringer
- OneUptime PWA oppdateres automatisk når den er tilkoblet
- Ingen App Store-oppdateringer påkrevd
- Nye funksjoner er tilgjengelige umiddelbart
- Kritiske oppdateringer brukes umiddelbart

### Manuell oppdateringsprosess
Tving oppdatering av applikasjonen:
1. **Safari-PWA-er**: Oppdater innenfor Safari-nettleseren
2. **Chrome-PWA-er**: Høyreklikk på appen → Last inn på nytt eller ⌘+R
3. **Fullstendig oppdatering**: Lukk appen, åpne nettleseren på nytt, besøk OneUptime

### Vedlikeholdsplan
Regelmessig vedlikehold for optimal ytelse:

**Ukentlig:**
- Start OneUptime-appen på nytt
- Tøm nettleserens hurtigbuffer hvis du opplever problemer
- Sjekk for macOS-oppdateringer

**Månedlig:**
- Gjennomgå lagringsbruk og rydd om nødvendig
- Oppdater nettlesere hvis de ikke oppdateres automatisk
- Bekreft at varselinnstillingene fortsatt fungerer

## Integrasjon med macOS-funksjoner

### Snarveier-appintegrasjon
Opprett egendefinerte snarveier for OneUptime:
1. Åpne **Snarveier**-appen
2. Opprett **Ny snarvei**
3. Legg til **"Åpne app"**-handlingen
4. Velg **OneUptime**
5. Legg til Siri for stemmeaktivering

### Automator-integrasjon
Automatiser OneUptime-oppgaver:
1. Start **Automator**
2. Opprett **Applikasjon** eller **Arbeidsflyt**
3. Legg til **"Start applikasjon"**-handlingen
4. Velg OneUptime PWA
5. Legg til ytterligere automatiseringstrinn

### Terminal-integrasjon
Administrer OneUptime gjennom Terminal:

```bash
# Opprett alias for rask OneUptime-oppstart
echo 'alias oneuptime="open -a \"OneUptime\""' >> ~/.zshrc

# Funksjon for å sjekke om OneUptime kjører
oneuptime_status() {
    if pgrep -f "OneUptime" > /dev/null; then
        echo "OneUptime is running"
    else
        echo "OneUptime is not running"
    fi
}
```

## Sikkerhet og personvern

### macOS-sikkerhetsfunksjoner
1. **Gatekeeper**: Sørg for at PWA-installasjoner er fra pålitelige kilder
2. **System Integrity Protection**: Beskytter systemfiler
3. **FileVault**: Krypter disk for databeskyttelse
4. **Nøkkelring**: Sikker lagring av legitimasjon

### Personvernhensyn
1. **Stedstjenester**: Konfigurer om nødvendig for overvåking
2. **Kamera/mikrofon**: Gi tillatelser etter behov
3. **Skjermopptak**: Kan være nødvendig for visse overvåkingsfunksjoner
4. **Nettverkstilgang**: Sørg for riktig brannmurkonfigurasjon

### Beste praksiser
1. **Regelmessige oppdateringer**: Hold macOS og nettlesere oppdatert
2. **Sterk autentisering**: Bruk Touch ID/Face ID når tilgjengelig
3. **Nettverkssikkerhet**: Bruk VPN for ekstern overvåkingstilgang
4. **Datasikkerhetskopi**: Regelmessige Time Machine-sikkerhetskopier inkluderer PWA-data
5. **Gjennomgang av tillatelser**: Gjennomgå gitte tillatelser regelmessig

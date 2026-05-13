# Installasjonsveiledning for iOS

Installer OneUptime som en innebygd app på iPhone eller iPad for sømløs overvåking mens du er på farten.

## Installasjonsmetoder

### Metode 1: Safari (anbefalt)

Safari gir den beste PWA-opplevelsen på iOS-enheter.

1. **Åpne OneUptime i Safari**
   - Start Safari på iOS-enheten din
   - Naviger til URL-en for OneUptime-instansen din
   - Vent til siden er fullstendig lastet
   - Sørg for at du er logget inn på OneUptime-kontoen din

2. **Åpne delingsmenyen**
   - Trykk på **Del-knappen** (firkant med pil som peker opp) i den nederste verktøylinjen
   - Bla gjennom delingsalternativene for å finne "Legg til på startskjerm"

3. **Legg til på startskjerm**
   - Trykk **"Legg til på startskjerm"**
   - Tilpass appnavnet (standard: "OneUptime")
   - Trykk **"Legg til"** øverst til høyre

4. **Start appen**
   - Finn OneUptime-ikonet på startskjermen
   - Trykk for å starte i fullskjerm app-modus

### Metode 2: Chrome-nettleser

Chrome fungerer, men Safari er anbefalt for best iOS PWA-opplevelse.

1. **Åpne OneUptime i Chrome**
   - Start Chrome-nettleseren
   - Gå til OneUptime-instansen din
   - Vent til siden er fullstendig lastet

2. **Legg til på startskjerm**
   - Trykk på **menyen med tre punkter** (flere alternativer)
   - Velg **"Legg til på startskjerm"**
   - Tilpass appnavnet om ønskelig
   - Trykk **"Legg til"**

### Metode 3: Andre nettlesere

Firefox, Edge og andre nettlesere støtter grunnleggende PWA-installasjon:

1. **Åpne OneUptime**
   - Start foretrukken nettleser
   - Naviger til OneUptime-URL-en
   - Vent til siden er fullstendig lastet

2. **Se etter installasjonsalternativ**
   - Sjekk nettlesermeny for "Legg til på startskjerm" eller "Installer"
   - Følg nettleserspesifikke installasjonsprompter

### Tilpasningsalternativer

### App-ikon og navn
- **Egendefinert navn**: Endre under installasjon eller senere
- **Ikonplassering**: Organiser i mapper eller spesifikke startskjermsider
- **Badge-varsler**: Vis antall uleste hendelser

### Varselkonfigurasjon
1. **Aktiver varsler**
   - Trykk **"Tillat"** for varsler når du blir bedt om det
   - Eller gå til Innstillinger → Varsler → OneUptime
   - Aktiver alle varseltyper for omfattende overvåking

2. **Tilpass varselstiler**
   - **Låsskjerm**: Vis hendelsesvarsler på låst enhet
   - **Bannerstil**: Velg midlertidige eller vedvarende bannere
   - **Lyder**: Tilpass varselyder og vibrasjoner
   - **Kritiske varsler**: Aktiver for høyprioriterte hendelser (krever tillatelse)

## Feilsøking

### Installasjonsproblemer

**"Legg til på startskjerm" er ikke synlig:**
```
Løsninger:
1. Sørg for at du bruker Safari (best kompatibilitet)
2. Oppdater siden og vent 30 sekunder
3. Sjekk om du er på riktig OneUptime-URL
4. Bekreft HTTPS-tilkobling (se etter hengelåsikon)
5. Tøm Safari-hurtigbuffer: Innstillinger → Safari → Tøm historikk og nettsteddata
```

**Installasjonen fullføres men ikonet vises ikke:**
```
Løsninger:
1. Sjekk alle startskjermsider
2. Se i App Library (sveip til venstre forbi siste startskjermside)
3. Bruk Spotlight-søk for å finne "OneUptime"
4. Start enheten på nytt og sjekk igjen
5. Installer på nytt om nødvendig
```

**Appen krasjer ved oppstart:**
```
Løsninger:
1. Tving-lukk og åpne appen på nytt
2. Start iOS-enheten på nytt
3. Tøm Safari-hurtigbuffer og installer på nytt
4. Sørg for at iOS-versjon er 11.3 eller høyere
5. Frigjør enhetslagringsplass
```

### Varslingsproblemer

**Mottar ikke push-varsler:**
```
Sjekk disse innstillingene:
1. Innstillinger → Varsler → OneUptime → Tillat varsler
2. Innstillinger → Skjermtid → Innholds- og personvernbegrensninger → Tillatte apper
3. Innstillinger for Ikke forstyrr
4. Sjekk varselinnstillinger i OneUptime-dashbordet
5. Logg ut og logg inn igjen på OneUptime
```

**Forsinkede eller tapte varsler:**
```
Løsninger:
1. Hold appen kjørende i bakgrunnen (ikke tving-lukk)
2. Deaktiver strømsparingsmodus under kritisk overvåking
3. Sjekk Bakgrunnsapp-oppdatering: Innstillinger → Generelt → Bakgrunnsapp-oppdatering
4. Sørg for tilstrekkelig lagringsplass
```

## Avinstallasjon

### Fjern fra startskjerm
1. **Trykk og hold** OneUptime app-ikonet
2. Trykk **"Fjern app"**
3. Velg **"Slett app"**
4. Bekreft sletting

### Alternativ metode
1. Gå til **Innstillinger → Generelt → iPhone-lagring**
2. Finn **OneUptime** i applisten
3. Trykk **"Slett app"**
4. Bekreft fjerning

## Oppdateringer og vedlikehold

### Automatiske oppdateringer
- OneUptime PWA oppdateres automatisk når den er tilkoblet
- Ingen App Store-oppdateringer påkrevd
- Nye funksjoner er tilgjengelige umiddelbart etter serverdistribusjon
- Kritiske sikkerhetsoppdateringer brukes umiddelbart

## Feilsøking

### Installasjonsproblemer

**"Legg til på startskjerm" er ikke synlig:**
```
Løsninger:
1. Sørg for at du bruker Safari (best kompatibilitet)
2. Oppdater siden og vent 30 sekunder
3. Sjekk om du er på riktig OneUptime-URL
4. Bekreft HTTPS-tilkobling (se etter hengelåsikon)
5. Tøm Safari-hurtigbuffer: Innstillinger → Safari → Tøm historikk og nettsteddata
```

**Installasjonen fullføres men ikonet vises ikke:**
```
Løsninger:
1. Sjekk alle startskjermsider
2. Se i App Library (sveip til venstre forbi siste startskjermside)
3. Bruk Spotlight-søk for å finne "OneUptime"
4. Start enheten på nytt og sjekk igjen
5. Installer på nytt om nødvendig
```

**Appen krasjer ved oppstart:**
```
Løsninger:
1. Tving-lukk og åpne appen på nytt
2. Start iOS-enheten på nytt
3. Tøm Safari-hurtigbuffer og installer på nytt
4. Sørg for at iOS-versjon er 11.3 eller høyere
5. Frigjør enhetslagringsplass
```

### Ytelsesproblemer

**Treg lasting eller responstid:**
```
Løsninger:
1. Sørg for sterk internettforbindelse for første oppstart
2. Lukk andre apper for å frigjøre minne
3. Start OneUptime-appen på nytt
4. Tøm Safari-hurtigbuffer og data
5. Start enheten på nytt
```

**Frakoblet modus fungerer ikke:**
```
Løsninger:
1. Besøk alle seksjoner tilkoblet først for å hurtigbufre data
2. La appen laste fullstendig inn før du går frakoblet
3. Sjekk tilgjengelig lagringsplass
4. Installer appen på nytt for å oppdatere hurtigbufferen
```

### Varslingsproblemer

**Mottar ikke push-varsler:**
```
Sjekk disse innstillingene:
1. Innstillinger → Varsler → OneUptime → Tillat varsler
2. Innstillinger → Skjermtid → Innholds- og personvernbegrensninger → Tillatte apper
3. Innstillinger for Ikke forstyrr
4. Sjekk varselinnstillinger i OneUptime-dashbordet
5. Logg ut og logg inn igjen på OneUptime
```

**Forsinkede eller tapte varsler:**
```
Løsninger:
1. Hold appen kjørende i bakgrunnen (ikke tving-lukk)
2. Deaktiver strømsparingsmodus under kritisk overvåking
3. Sjekk Bakgrunnsapp-oppdatering: Innstillinger → Generelt → Bakgrunnsapp-oppdatering
4. Sørg for tilstrekkelig lagringsplass
```

## iPad-spesifikk installasjon

### Forbedret iPad-opplevelse
1. **Større grensesnitt**: Optimaliserte oppsett for iPad-skjermstørrelser
2. **Flervindu**: Kjør flere OneUptime-vinduer samtidig
3. **Tastatursnarveier**: Full støtte for eksterne tastaturer
4. **Dra og slipp**: Flytt data mellom OneUptime og andre apper

### iPad-installasjonstrinn
Samme som iPhone-installasjon, men med ytterligere vurderinger:
- Bruk liggende modus for optimal dashbordvisning
- Vurder oppsett med delt visning med andre produktivitetsapper
- Konfigurer tastatursnarveier for vanlige handlinger

## Apple Watch-integrasjon

Selv om OneUptime ikke har en dedikert watchOS-app, kan du:
- **Motta varsler**: Hendelsesvarsler vises på Apple Watch
- **Raske handlinger**: Bekreft hendelser fra klokkevarsler
- **Siri-integrasjon**: Spør Siri om systemstatus (når konfigurert)

## Avinstallasjon

### Fjern fra startskjerm
1. **Trykk og hold** OneUptime app-ikonet
2. Trykk **"Fjern app"**
3. Velg **"Slett app"**
4. Bekreft sletting

### Alternativ metode
1. Gå til **Innstillinger → Generelt → iPhone-lagring**
2. Finn **OneUptime** i applisten
3. Trykk **"Slett app"**
4. Bekreft fjerning

### Tøm alle data
- Avinstallering fjerner alle hurtigbufrede data
- OneUptime-kontoen din forblir intakt på serveren
- Reinstallasjon krever nytt oppsett

## Avansert konfigurasjon

### Snarveier-appintegrasjon
Opprett egendefinerte Siri-snarveier for OneUptime:
1. Åpne **Snarveier**-appen
2. Opprett **Ny snarvei**
3. Legg til **"Åpne app"**-handlingen
4. Velg **OneUptime**
5. Legg til talesetning som "Sjekk systemstatus"

### Fokus-modi
Integrer OneUptime med iOS-fokus-modi:
1. **Innstillinger → Fokus**
2. Velg eller opprett en fokus-modus
3. **Apper → Legg til apper → OneUptime**
4. Konfigurer varselatferd for ulike fokus-tilstander

### Skjermtidsstyring
Konfigurer passende skjermtidsinnstillinger:
1. **Innstillinger → Skjermtid → Applimitter**
2. Legg til OneUptime i kategorien "Produktivitet"
3. Sett passende bruksgrenser om nødvendig

## Oppdateringer og vedlikehold

### Automatiske oppdateringer
- OneUptime PWA oppdateres automatisk når den er tilkoblet
- Ingen App Store-oppdateringer påkrevd
- Nye funksjoner er tilgjengelige umiddelbart etter serverdistribusjon
- Kritiske sikkerhetsoppdateringer brukes umiddelbart

### Manuell oppdateringsprosess
Tving oppdatering av appen:
1. Åpne OneUptime i Safari
2. Dra ned for å oppdatere
3. Appen laster ned nyeste versjon
4. Nye funksjoner er tilgjengelige umiddelbart

### Hurtigbufferbehandling
Hold appen kjørende optimalt:
- **Regelmessig bruk**: Åpne appen daglig for å holde hurtigbufferen oppdatert
- **Lagringsovervåking**: Ha minst 1 GB ledig plass
- **Nettverkstilgang**: Koble til WiFi regelmessig for oppdateringer

## Beste praksiser

### Sikkerhetsanbefalinger
1. **Bekreft URL**: Installer kun fra organisasjonens offisielle OneUptime-instans
2. **Kun HTTPS**: Sørg for sikker tilkobling (se etter hengelåsikon)
3. **Regelmessige oppdateringer**: Hold iOS oppdatert for sikkerhetsoppdateringer
4. **App-tillatelser**: Gi kun nødvendige tillatelser

### Ytelsesoptimalisering
1. **WiFi-installasjon**: Bruk WiFi for første installasjon og store oppdateringer
2. **Bakgrunnsoppdatering**: Aktiver for rettidige varsler
3. **Lagringsstyring**: Ha tilstrekkelig ledig plass
4. **Regelmessig omstart**: Start appen på nytt ukentlig for optimal ytelse

### Beste praksiser for overvåking
1. **Kritiske varsler**: Aktiver kun for høyprioriterte varsler
2. **Flere enheter**: Installer på både iPhone og iPad for redundans
3. **Teamtilgang**: Del installasjonsveiledningen med teammedlemmer
4. **Testing**: Test varsellevering og frakoblet funksjonalitet regelmessig

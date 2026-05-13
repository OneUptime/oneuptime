# Vanlige spørsmål og feilsøking

Vanlige spørsmål og løsninger for OneUptime mobil- og skrivebordapper (PWA).

## Generelle spørsmål

### Hva er en Progressive Web App (PWA)?

En Progressive Web App er en nettapplikasjon som bruker moderne netteknologier for å levere app-liknende opplevelser. PWA-er kan installeres direkte fra nettlesere uten appbutikker, fungere frakoblet, sende push-varsler og integreres med enhetens operativsystem.

### Hvorfor bruker ikke OneUptime tradisjonelle appbutikker?

OneUptime bruker PWA-teknologi fordi det gir flere fordeler:
- **Umiddelbare oppdateringer**: Ingen ventetid for godkjenning fra appbutikk eller manuelle oppdateringer
- **Kryssplattform**: Én kodebase fungerer på alle enheter
- **Ingen grenser for nedlastingsstørrelse**: Fulle funksjoner uten størrelsesbegrensninger
- **Direkte distribusjon**: Installer direkte fra OneUptime-instansen din
- **Alltid nyeste**: Brukere har alltid den nyeste versjonen
- **Sikkerhet**: Samme sikkerhetsfordeler som nettapplikasjoner


### Hvor mye lagringsplass bruker OneUptime PWA?

- **Første installasjon**: 10–20 MB
- **Hurtigbuffervekst**: 50–100 MB ved regelmessig bruk
- **Maksimal hurtigbuffer**: Vanligvis begrenset til 200 MB av nettlesere
- **Automatisk opprydding**: Nettlesere administrerer lagring automatisk

### Støtter OneUptime PWA push-varsler?

Ja, OneUptime PWA støtter rike push-varsler:
- **Hendelsesvarsler**: Sanntidsvarsler for hendelser
- **Statusoppdateringer**: Varsler om endringer i monitorstatus
- **Egendefinerte utløsere**: Konfigurer varselregler
- **Rikt innhold**: Bilder, handlinger og detaljert informasjon
- **Badge-oppdateringer**: Antall uleste på app-ikonet

## Installasjonsspørsmål

### Hvorfor ser jeg ikke "Installer"-knappen?

Vanlige årsaker og løsninger:
1. **Nettleserkompatibilitet**: Bruk Chrome, Edge eller Safari
2. **HTTPS påkrevd**: Sørg for at OneUptime-instansen bruker HTTPS
3. **PWA-krav**: Server må oppfylle PWA-manifestkrav
4. **Hurtigbufferproblemer**: Tøm nettleserens hurtigbuffer og last inn på nytt
5. **Allerede installert**: Appen er kanskje allerede installert
6. **Ventetid**: Noen nettlesere trenger 30+ sekunder på siden

### Kan jeg installere på flere enheter?

Ja! Du kan installere OneUptime PWA på:
- Ubegrensede enheter per bruker
- Flere nettlesere på samme enhet
- Ulike operativsystemer
- Delte enheter (med separate kontoer)

### Hvordan oppdaterer jeg den installerte appen?

OneUptime PWA oppdateres automatisk:
- **Automatiske oppdateringer**: Appen oppdateres når du besøker den mens du er tilkoblet
- **Bakgrunnsoppdateringer**: Oppdateringer lastes ned i bakgrunnen
- **Umiddelbar tilgjengelighet**: Nye funksjoner er tilgjengelige umiddelbart
- **Ingen brukerhandling**: I motsetning til butikkapper kreves ingen manuelle oppdateringer

### Kan jeg tilpasse appnavnet under installasjonen?

Ja, under installasjonen kan du:
- Endre appnavnet (standard: "OneUptime")
- Legge til organisasjonsnavnet
- Bruke egendefinert navnekonvensjon
- Endre ikonetikett (plattformavhengig)

### Hvordan avinstallerer jeg OneUptime PWA?

Avinstallering varierer etter plattform:

**Android:**
- Trykk og hold app-ikonet → Avinstaller
- Innstillinger → Apper → OneUptime → Avinstaller

**iOS:**
- Trykk og hold app-ikonet → Fjern app → Slett app

**Windows:**
- Innstillinger → Apper → OneUptime → Avinstaller
- Høyreklikk Start-menyelement → Avinstaller

**macOS:**
- Dra fra Programmer til papirkurv
- Høyreklikk Dock-ikonet → Fjern

**Linux:**
- Fjern fra applikasjonsstarter
- Slett .desktop-fil


## Spørsmål om varsler

### Hvorfor mottar jeg ikke varsler?

Vanlige varslingsproblemer og løsninger:

**Sjekk tillatelser:**
```
1. Nettleserens varselstillatelser er aktivert
2. Operativsystemets varselstillatelser
3. OneUptime-varselinnstillinger konfigurert
4. Modusen Ikke forstyrr er deaktivert
```

**Plattformspesifikt:**
- **Android**: Sjekk batterioptimaliseringsinnstillinger
- **iOS**: Bekreft varselinnstillinger i Innstillinger-appen
- **Windows**: Sjekk Fokushjelp-innstillinger
- **macOS**: Bekreft tillatelser i varselsenter
- **Linux**: Sjekk status for varselsdemon

### Kan jeg tilpasse varselyder?

Alternativer for varseltilpasning:
- **Systemlyder**: Bruk OS-varsellydsinnstillinger
- **Nettleserinnstillinger**: Konfigurer i nettleserens varselpreferanser
- **OneUptime-innstillinger**: Angi varselpreferanser i dashbordet
- **Prioritetsnivåer**: Konfigurer ulike lyder for alvorlighetsgrader

### Hvordan deaktiverer jeg varsler midlertidig?

Midlertidig deaktivering av varsler:
- **Ikke forstyrr**: Aktiver system-DND-modus
- **Nettleserinnstillinger**: Deaktiver stedsvarsler midlertidig
- **OneUptime-dashbord**: Sett varsler på pause i innstillinger
- **Fokusmodi**: Bruk OS-fokus/konsentrasjonsmodi

## Sikkerhetsspørsmål

### Er OneUptime PWA sikkert?

Sikkerhetsfunksjoner og vurderinger:
- **HTTPS-kryptering**: Alle data overføres sikkert
- **Same-Origin-policy**: Nettlesersikkerhetsbegrensninger gjelder
- **Sandkassemiljø**: Kjører i nettleserens sikkerhetssandkasse
- **Regelmessige oppdateringer**: Sikkerhetsoppdateringer brukes automatisk
- **Ingen root-tilgang**: Begrenset systemtilgang sammenlignet med innebygde apper


*Merk: Sensitive data krypteres og følger nettlesersikkerhetsstandarder.*

### Kan jeg bruke OneUptime PWA på bedriftsnettverk?

Vurderinger for bedriftsnettverk:
- **Brannmurregler**: Sørg for HTTPS-tilgang (port 443)
- **Proxykonfigurasjon**: Konfigurer nettleserproxyinnstillinger
- **Sertifitatillit**: Installer bedriftssertifikater om nødvendig
- **VPN-tilgang**: Bruk VPN for ekstern tilgang
- **Sikkerhetspolicyer**: Overhold IT-sikkerhetskrav

## Feilsøking

### Installasjonsproblemer

**Problem**: Installasjonsknappen vises ikke
```
Løsninger:
1. Vent 30+ sekunder på OneUptime-siden
2. Oppdater siden og vent igjen
3. Tøm nettleserens hurtigbuffer og informasjonskapsler
4. Prøv en annen nettleser (Chrome/Edge anbefalt)
5. Bekreft HTTPS-tilkobling (se etter hengelåsikon)
6. Sjekk om allerede installert
```

**Problem**: Installasjonen mislykkes eller krasjer
```
Løsninger:
1. Sørg for tilstrekkelig lagringsplass (100 MB+)
2. Lukk andre nettleserfaner og applikasjoner
3. Oppdater nettleseren til nyeste versjon
4. Deaktiver nettleserutvidelser midlertidig
5. Prøv installasjon i privat/inkognitomodus
6. Start nettleseren på nytt og prøv igjen
```

**Problem**: Appen installeres men vises ikke
```
Løsninger:
1. Sjekk alle app-startplasseringer
2. Søk etter "OneUptime" i enhetsøket
3. Se i nettleserens appbehandlingsseksjon
4. Vent 1-2 minutter for at systemet skal oppdateres
5. Start enheten på nytt og sjekk igjen
```

**Problem**: Appen krasjer hyppig
```
Løsninger:
1. Oppdater nettleseren til nyeste versjon
2. Tøm alle nettleserdata for OneUptime
3. Deaktiver nettleserutvidelser
4. Sjekk tilgjengelig lagringsplass
5. Start operativsystemet på nytt
6. Installer OneUptime PWA på nytt
```

**Problem**: Push-varsler fungerer ikke
```
Løsninger:
1. Sjekk varselstillatelser i nettleseren
2. Bekreft systemvarselinnstillinger
3. Test med enkelt varsel først
4. Tøm varseldata og gi tillatelser på nytt
5. Sjekk innstillinger for Ikke forstyrr/Fokus-modus
6. Bekreft OneUptime-varselkonfigurasjon
```

**Problem**: Appen synkroniserer ikke nyeste data
```
Løsninger:
1. Dra ned for å oppdatere (mobil)
2. Trykk Ctrl+F5 (Windows/Linux) eller Cmd+R (Mac)
3. Lukk og åpne appen på nytt
4. Tøm app-hurtigbuffer og last inn på nytt
5. Sjekk nettverkstilkobling
```

### Plattformspesifikke problemer

**Android-problemer:**
```
Problem: Appen vises ikke i app-skuffen
Løsning: Sjekk seksjonen "Nylig lagt til" apper, søk i app-skuffen

Problem: Forsinkede varsler
Løsning: Deaktiver batterioptimalisering for nettleserappen

Problem: Appen krasjer ved oppstart
Løsning: Tøm Chrome app-data, start enheten på nytt
```

**iOS-problemer:**
```
Problem: Kan ikke legge til på startskjerm
Løsning: Bruk Safari-nettleseren, sørg for iOS 11.3+

Problem: App-ikonet mangler
Løsning: Sjekk alle startskjermsider og App Library

Problem: Face ID fungerer ikke
Løsning: Aktiver Face ID for Safari i innstillingene
```

**Windows-problemer:**
```
Problem: Appen vises ikke i Start-menyen
Løsning: Søk etter appnavn, sjekk listen over installerte apper

Problem: Varsler vises ikke
Løsning: Sjekk Windows-varselinnstillinger, aktiver for nettleser

Problem: Problemer med vindusstørrelse
Løsning: Endre størrelse manuelt, appen husker dimensjoner
```

**macOS-problemer:**
```
Problem: Kan ikke installere via Safari
Løsning: Oppdater til macOS Sonoma+, bruk Fil → Legg til i Dock

Problem: Appen er ikke i Programmer-mappen
Løsning: Sjekk Launchpad, bruk Spotlight-søk

Problem: Varsler fungerer ikke
Løsning: Sjekk Systemvalg → Varsler
```

**Linux-problemer:**
```
Problem: PWA-installasjonalternativet mangler
Løsning: Bruk Chrome/Chromium, sørg for støtte for skrivebordsmiljø

Problem: Ikonet vises ikke i starteren
Løsning: Oppdater skrivebordsdatabase, sjekk .desktop-filen

Problem: Lydvarsler fungerer ikke
Løsning: Sjekk PulseAudio, bekreft lydtillatelser i nettleseren
```

### Feilmeldinger

**"This site cannot be installed"**
```
Årsaker:
- OneUptime-instansen oppfyller ikke PWA-krav
- Manglende eller ugyldig web app-manifest
- HTTPS ikke riktig konfigurert
- Nettleseren støtter ikke PWA-installasjon

Løsninger:
- Kontakt administrator for å bekrefte PWA-oppsett
- Prøv en annen nettleser
- Sjekk nettleserkonsoll for detaljerte feil
```

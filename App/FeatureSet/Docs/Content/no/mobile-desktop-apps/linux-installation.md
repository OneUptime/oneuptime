# Installasjonsveiledning for Linux

Installer OneUptime som en skrivebordsapplikasjon på Linux-distribusjoner for omfattende overvåking og hendelseshåndtering.

## Installasjonsmetoder

### Metode 1: Google Chrome/Chromium (anbefalt)

Chrome og Chromium gir den beste Linux PWA-opplevelsen med innebygd skrivebordsintegrasjon.

#### PWA-installasjonstrinn:
1. **Åpne OneUptime i Chrome/Chromium**
   - Start nettleseren
   - Naviger til URL-en for OneUptime-instansen din
   - Logg inn på OneUptime-kontoen din
   - Vent til siden er fullstendig lastet

2. **Installer PWA**
   - Se etter **installikonet** (⊞) i adressefeltet
   - Klikk **"Installer OneUptime"**
   - Eller bruk **Chrome-menyen** (⋮) → **Flere verktøy** → **Opprett snarvei**

3. **Installasjonsalternativer**
   - Huk av **"Åpne som vindu"** for innebygd appopplevelse
   - Tilpass appnavnet om ønskelig
   - Velg om du vil opprette snarvei på skrivebordet
   - Klikk **"Installer"** eller **"Opprett"**

4. **Start appen**
   - Finn OneUptime i applikasjonssøkeren
   - Eller bruk snarveien på skrivebordet
   - Appen åpner i et dedikert vindu

### Metode 2: Firefox

Firefox støtter PWA-installasjon på Linux med grunnleggende skrivebordsintegrasjon.

1. **PWA-installasjon**:
   - Åpne OneUptime i Firefox
   - Se etter installasjonsbannereller -forespørsel
   - Klikk **"Installer"** når tilgjengelig
   - Merk: Begrenset skrivebordsintegrasjon sammenlignet med Chrome

### Metode 3: Microsoft Edge

Edge er tilgjengelig på Linux og gir god PWA-støtte.

1. **Installer PWA**: Følg samme trinn som Chrome-metoden




## Oppdateringer og vedlikehold

### Automatiske oppdateringer
OneUptime PWA oppdateres automatisk:
- Oppdateringer brukes når nettleseren oppdaterer appen
- Kritiske sikkerhetsoppdateringer distribueres umiddelbart
- Ingen manuell intervensjon påkrevd


## Avinstallasjon


### Nettleserspesifikk fjerning
```bash
# Chrome PWA-administrasjon
google-chrome chrome://apps/

# Fjern alle OneUptime-relaterte nettleserdata
rm -rf ~/.config/google-chrome/Default/Local\ Storage/leveldb/
rm -rf ~/.cache/google-chrome/Default/
```

## Oppdateringer og vedlikehold

### Automatiske oppdateringer
OneUptime PWA oppdateres automatisk:
- Oppdateringer brukes når nettleseren oppdaterer appen
- Kritiske sikkerhetsoppdateringer distribueres umiddelbart
- Ingen manuell intervensjon påkrevd

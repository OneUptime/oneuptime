# Installatiegids voor Linux

Installeer OneUptime als desktopapplicatie op Linux-distributies voor uitgebreide monitoring en incidentbeheer.

## Installatiemethoden

### Methode 1: Google Chrome/Chromium (aanbevolen)

Chrome en Chromium bieden de beste Linux PWA-ervaring met native desktopintegratie.

#### PWA-installatiestappen:

1. **OneUptime openen in Chrome/Chromium**

   - Start uw browser
   - Navigeer naar de URL van uw OneUptime-instantie
   - Meld u aan bij uw OneUptime-account
   - Wacht tot de pagina volledig is geladen

2. **PWA installeren**

   - Zoek het **installatiepictogram** (⊞) in de adresbalk
   - Klik op **"OneUptime installeren"**
   - Of gebruik het **Chrome-menu** (⋮) → **Meer hulpmiddelen** → **Snelkoppeling maken**

3. **Installatieopties**

   - Vink **"Als venster openen"** aan voor een native app-ervaring
   - Pas de app-naam aan indien gewenst
   - Kies voor het aanmaken van een bureaubladsnelkoppeling
   - Klik op **"Installeren"** of **"Maken"**

4. **App starten**
   - Zoek OneUptime in het applicatiestartprogramma
   - Of gebruik de bureaubladsnelkoppeling
   - App opent in een eigen venster

### Methode 2: Firefox

Firefox ondersteunt PWA-installatie op Linux met basisdesktopintegratie.

1. **PWA installeren**:
   - Open OneUptime in Firefox
   - Zoek naar installatiebanner of -prompt
   - Klik op **"Installeren"** wanneer beschikbaar
   - Opmerking: Beperkte desktopintegratie vergeleken met Chrome

### Methode 3: Microsoft Edge

Edge is beschikbaar op Linux en biedt goede PWA-ondersteuning.

1. **PWA installeren**: Volg dezelfde stappen als bij de Chrome-methode

## Updates en onderhoud

### Automatische updates

OneUptime PWA wordt automatisch bijgewerkt:

- Updates worden toegepast wanneer de browser de app vernieuwt
- Kritieke beveiligingsupdates worden onmiddellijk geïmplementeerd
- Geen handmatige tussenkomst vereist

## Verwijderen

### Browserspecifieke verwijdering

```bash
# Chrome PWA-beheer
google-chrome chrome://apps/

# Alle OneUptime-gerelateerde browsergegevens verwijderen
rm -rf ~/.config/google-chrome/Default/Local\ Storage/leveldb/
rm -rf ~/.cache/google-chrome/Default/
```

## Updates en onderhoud

### Automatische updates

OneUptime PWA wordt automatisch bijgewerkt:

- Updates worden toegepast wanneer de browser de app vernieuwt
- Kritieke beveiligingsupdates worden onmiddellijk geïmplementeerd
- Geen handmatige tussenkomst vereist

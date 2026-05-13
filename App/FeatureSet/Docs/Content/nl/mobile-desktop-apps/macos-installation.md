# Installatiegids voor macOS

Installeer OneUptime als native desktopapplicatie op macOS voor naadloze monitoring en incidentbeheer.

## Installatiemethoden

### Methode 1: Safari (aanbevolen voor macOS)

Safari biedt uitstekende PWA-integratie met native macOS-functies.

1. **OneUptime openen in Safari**
   - Start de Safari-browser
   - Navigeer naar de URL van uw OneUptime-instantie
   - Meld u aan bij uw OneUptime-account
   - Wacht tot de pagina volledig is geladen

2. **PWA installeren**
   - Klik op **Archief** in de menubalk
   - Selecteer **"Voeg toe aan Dock"** (macOS Sonoma+)
   - Of zoek het **installatiepictogram** in de adresbalk
   - Als alternatief: **Archief** → **"Voeg toe aan beginscherm"** (oudere macOS)

3. **Installatie aanpassen**
   - **App-naam**: Pas aan indien gewenst (standaard: OneUptime)
   - **Dock**: Kies om toe te voegen aan Dock
   - **Launchpad**: Voeg toe aan Launchpad voor eenvoudige toegang

4. **App starten**
   - Zoek OneUptime in Dock, Launchpad of de map Programma's
   - Klik om te starten in een eigen venster
   - App werkt onafhankelijk van de Safari-browser

### Methode 2: Google Chrome

Chrome biedt robuuste PWA-ondersteuning met uitstekende desktopintegratie.

1. **OneUptime openen in Chrome**
   - Start Google Chrome
   - Ga naar uw OneUptime-instantie
   - Zorg dat u bent aangemeld
   - Laat de pagina volledig laden

2. **Installeren via menu**
   - Zoek het **installatiepictogram** (⊞) in de adresbalk
   - Klik op **"OneUptime installeren"**
   - Of gebruik het **Chrome-menu** → **Meer hulpmiddelen** → **Snelkoppeling maken**

3. **Installatieopties**
   - Vink **"Als venster openen"** aan voor een native app-ervaring
   - Pas de app-naam aan indien nodig
   - Klik op **"Installeren"** of **"Maken"**

4. **Toegang tot app**
   - Zoek OneUptime in de map Programma's
   - Of gebruik Spotlight-zoekopdracht
   - Zet vast in Dock voor snelle toegang

### Methode 3: Microsoft Edge

Edge biedt solide PWA-ondersteuning met goede macOS-integratie.

1. **OneUptime openen in Edge**
   - Start Microsoft Edge
   - Navigeer naar de OneUptime-URL
   - Voltooi het aanmeldproces

2. **App installeren**
   - Klik op het **menu met drie puntjes** → **Apps** → **Deze site installeren als app**
   - Of zoek de installatieprompt in de adresbalk
   - Pas de app-naam aan indien gewenst
   - Klik op **"Installeren"**

### Aanpassingsopties

### Dock en Launchpad
1. **Dockpositie**: Sleep OneUptime naar de gewenste Dockpositie
2. **Dockgrootte**: Pas de pictogramgrootte aan in Dockvoorkeuren
3. **Launchpad-organisatie**: Maak een map voor monitoring-apps
4. **Badge-meldingen**: Toon incidenttelling op het Dock-pictogram

### Menubalk en meldingen
1. **Meldingencentrum**
   - Systeemvoorkeuren → Meldingen → OneUptime
   - Meldingsstijlen en bezorging configureren
   - Prioriteitsniveaus instellen voor verschillende incidenttypen

2. **Menubalintegratie**
   - Native menubalk voor Safari PWA's
   - Aangepaste menu-items voor veelgebruikte acties
   - Sneltoetsen voor veelgebruikte taken

## Probleemoplossing

### Installatieproblemen

**"Voeg toe aan Dock" niet beschikbaar in Safari:**
```
Oplossingen:
1. Zorg voor macOS Sonoma (14.0) of hoger
2. Safari bijwerken naar de nieuwste versie
3. Probeer alternatief: Archief → Voeg toe aan beginscherm
4. Safari-cache wissen en opnieuw proberen
5. Gebruik Chrome of Edge als alternatief
```

**PWA installeert niet of crasht:**
```
Oplossingen:
1. Controleer de macOS-versiecompatibiliteit
2. Zorg voor voldoende schijfruimte (100 MB+)
3. Browser bijwerken naar de nieuwste versie
4. Browsercache en cookies wissen
5. Browserextensies tijdelijk uitschakelen
6. Mac herstarten en installatie opnieuw proberen
```

**App verschijnt niet in Programma's:**
```
Oplossingen:
1. Controleer Launchpad op OneUptime-pictogram
2. Zoeken met Spotlight (⌘+spatiebalk)
3. Zoek in de PWA-beheersectie van de browser
4. Probeer te herinstalleren met een andere browser
5. Controleer of er onder een andere naam is geïnstalleerd
```

### Meldingsproblemen

**macOS-meldingen werken niet:**
```
Oplossingen:
1. Systeemvoorkeuren → Meldingen → OneUptime
2. Schakel "Meldingen toestaan" in
3. Stel de juiste meldingsstijl in (banners/meldingen)
4. Controleer de instellingen voor Niet storen
5. Controleer OneUptime-meldingsinstellingen
6. Verleen meldingsmachtigingen wanneer daarom wordt gevraagd
```

## Verwijderen

### Volledig verwijderen
1. **Via de map Programma's**
   - Open de map Programma's
   - Zoek OneUptime
   - Sleep naar Prullenbak of klik met rechtermuisknop → Verplaats naar prullenbak

2. **Via Dock**
   - Klik met rechtermuisknop op OneUptime in Dock
   - Selecteer "Opties" → "Verwijder uit Dock"
   - Verwijder daarna uit de map Programma's

3. **Via browser PWA-beheer**
   - **Chrome**: chrome://apps/ → Zoek OneUptime → Verwijderen
   - **Edge**: edge://apps/ → Zoek OneUptime → Verwijderen
   - **Safari**: Geen speciale beheerpagina

### Schone verwijdering
Verwijder alle bijbehorende gegevens:

```bash
# Safari PWA-gegevens wissen (algemene websitegegevens)
rm -rf ~/Library/Safari/Databases
rm -rf ~/Library/Caches/com.apple.Safari

# Chrome PWA-gegevens wissen
rm -rf ~/Library/Application\ Support/Google/Chrome/Default/Web\ Applications

# Edge PWA-gegevens wissen
rm -rf ~/Library/Application\ Support/Microsoft\ Edge/Default/Web\ Applications
```

## Updates en onderhoud

### Automatische updates
- OneUptime PWA wordt automatisch bijgewerkt wanneer online
- Geen App Store-updates vereist
- Nieuwe functies direct beschikbaar
- Kritieke updates worden onmiddellijk toegepast

### Handmatig updateproces
Forceer update van de applicatie:
1. **Safari PWA's**: Vernieuwen binnen Safari-browser
2. **Chrome PWA's**: Klik met rechtermuisknop op app → Herladen of ⌘+R
3. **Volledig vernieuwen**: Sluit app, heropen browser, bezoek OneUptime

### Onderhoudsschema
Regelmatig onderhoud voor optimale prestaties:

**Wekelijks:**
- Herstart OneUptime-app
- Wis browsercache indien er problemen zijn
- Controleer op macOS-updates

**Maandelijks:**
- Controleer opslaggebruik en wis indien nodig
- Werk browsers bij als ze niet automatisch bijwerken
- Controleer of meldingsinstellingen nog werken

## Integratie met macOS-functies

### Integratie met de Snelkoppelingen-app
Maak aangepaste snelkoppelingen voor OneUptime:
1. Open de **Snelkoppelingen**-app
2. Maak een **Nieuwe snelkoppeling** aan
3. Voeg de actie **"App openen"** toe
4. Selecteer **OneUptime**
5. Voeg toe aan Siri voor spraakactivering

### Terminalintegratie
Beheer OneUptime via Terminal:

```bash
# Alias aanmaken voor snelle OneUptime-start
echo 'alias oneuptime="open -a \"OneUptime\""' >> ~/.zshrc

# Functie om te controleren of OneUptime actief is
oneuptime_status() {
    if pgrep -f "OneUptime" > /dev/null; then
        echo "OneUptime is running"
    else
        echo "OneUptime is not running"
    fi
}
```

## Beveiliging en privacy

### macOS-beveiligingsfuncties
1. **Gatekeeper**: Zorg dat PWA-installaties van vertrouwde bronnen zijn
2. **Systeemintegriteitsbeveiliging**: Beschermt systeembestanden
3. **FileVault**: Versleutel schijf voor gegevensbescherming
4. **Sleutelhanger**: Veilige opslag van inloggegevens

### Privacyoverwegingen
1. **Locatiediensten**: Configureer indien nodig voor monitoring
2. **Camera/microfoon**: Verleen machtigingen indien vereist
3. **Schermopname**: Kan vereist zijn voor bepaalde monitoringfuncties
4. **Netwerktoegang**: Zorg voor de juiste firewallconfiguratie

### Best practices
1. **Regelmatige updates**: Houd macOS en browsers bijgewerkt
2. **Sterke authenticatie**: Gebruik Touch ID/Face ID indien beschikbaar
3. **Netwerkbeveiliging**: Gebruik VPN voor externe monitoringtoegang
4. **Gegevensback-up**: Regelmatige Time Machine-back-ups bevatten PWA-gegevens
5. **Machtigingscontrole**: Controleer regelmatig verleende machtigingen

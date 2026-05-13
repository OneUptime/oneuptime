# Veelgestelde vragen en probleemoplossing

Veelgestelde vragen en oplossingen voor OneUptime Mobiele en Desktopapps (PWA).

## Algemene veelgestelde vragen

### Wat is een Progressive Web App (PWA)?

Een Progressive Web App is een webapplicatie die gebruikmaakt van moderne webtechnologieën om app-achtige ervaringen te bieden. PWA's kunnen rechtstreeks vanuit browsers worden geïnstalleerd zonder app stores, werken offline, sturen push-meldingen en integreren met het besturingssysteem van uw apparaat.

### Waarom gebruikt OneUptime geen traditionele app stores?

OneUptime gebruikt PWA-technologie omdat dit verschillende voordelen biedt:
- **Directe updates**: Geen wachten op goedkeuring van de app store of handmatige updates
- **Platformoverschrijdend**: Één codebase werkt op alle apparaten
- **Geen downloadgroottebeperkingen**: Volledige functies zonder groottebeperkingen
- **Directe distributie**: Installeer rechtstreeks vanuit uw OneUptime-instantie
- **Altijd de nieuwste versie**: Gebruikers hebben altijd de nieuwste versie
- **Beveiliging**: Dezelfde beveiligingsvoordelen als webapplicaties


### Hoeveel opslag gebruikt de OneUptime PWA?

- **Initiële installatie**: 10-20 MB
- **Cache-groei**: 50-100 MB bij regelmatig gebruik
- **Maximale cache**: Doorgaans beperkt tot 200 MB door browsers
- **Automatisch opruimen**: Browsers beheren opslag automatisch

### Ondersteunt de OneUptime PWA push-meldingen?

Ja, de OneUptime PWA ondersteunt uitgebreide push-meldingen:
- **Incidentmeldingen**: Realtime incidentmeldingen
- **Statusupdates**: Meldingen bij wijziging van monitorstatus
- **Aangepaste triggers**: Meldingsregels configureren
- **Rijke inhoud**: Afbeeldingen, acties en gedetailleerde informatie
- **Badge-updates**: Ongelezen telling op app-pictogram

## Installatie veelgestelde vragen

### Waarom zie ik de knop "Installeren" niet?

Veelvoorkomende oorzaken en oplossingen:
1. **Browsercompatibiliteit**: Gebruik Chrome, Edge of Safari
2. **HTTPS vereist**: Zorg dat de OneUptime-instantie HTTPS gebruikt
3. **PWA-vereisten**: Server moet voldoen aan PWA-manifestvereisten
4. **Cacheproblemen**: Wis browsercache en laad opnieuw
5. **Al geïnstalleerd**: App is mogelijk al geïnstalleerd
6. **Wachttijd**: Sommige browsers hebben 30+ seconden op de pagina nodig

### Kan ik op meerdere apparaten installeren?

Ja! U kunt de OneUptime PWA installeren op:
- Onbeperkte apparaten per gebruiker
- Meerdere browsers op hetzelfde apparaat
- Verschillende besturingssystemen
- Gedeelde/gezinsapparaten (met afzonderlijke accounts)

### Hoe update ik de geïnstalleerde app?

OneUptime PWA wordt automatisch bijgewerkt:
- **Automatische updates**: App wordt bijgewerkt wanneer u online een bezoek brengt
- **Achtergrondupdates**: Updates worden op de achtergrond gedownload
- **Directe beschikbaarheid**: Nieuwe functies zijn onmiddellijk beschikbaar
- **Geen gebruikersactie**: In tegenstelling tot store-apps zijn geen handmatige updates nodig

### Kan ik de app-naam aanpassen tijdens de installatie?

Ja, tijdens de installatie kunt u:
- De app-naam wijzigen (standaard: "OneUptime")
- De naam van uw organisatie toevoegen
- Een aangepaste naamconventie gebruiken
- Het pictogramlabel aanpassen (platformafhankelijk)

### Hoe verwijder ik de OneUptime PWA?

Verwijdering verschilt per platform:

**Android:**
- Houd app-pictogram ingedrukt → Verwijderen
- Instellingen → Apps → OneUptime → Verwijderen

**iOS:**
- Houd app-pictogram ingedrukt → App verwijderen → App verwijderen

**Windows:**
- Instellingen → Apps → OneUptime → Verwijderen
- Klik met rechtermuisknop op Startmenu-item → Verwijderen

**macOS:**
- Sleep vanuit Programma's naar Prullenbak
- Klik met rechtermuisknop op Dock-pictogram → Verwijderen

**Linux:**
- Verwijder uit applicatiestartprogramma
- Verwijder het .desktop-bestand


## Meldingen veelgestelde vragen

### Waarom ontvang ik geen meldingen?

Veelvoorkomende meldingsproblemen en oplossingen:

**Controleer machtigingen:**
```
1. Browsermeldingsmachtigingen ingeschakeld
2. Meldingsmachtigingen voor besturingssysteem
3. OneUptime-meldingsinstellingen geconfigureerd
4. Modus Niet storen uitgeschakeld
```

**Platformspecifiek:**
- **Android**: Controleer batterijoptimalisatie-instellingen
- **iOS**: Controleer meldingsinstellingen in de Instellingen-app
- **Windows**: Controleer de instellingen voor Focus-assistent
- **macOS**: Controleer de machtigingen voor het Meldingencentrum
- **Linux**: Controleer de status van de meldingsdaemon

### Kan ik meldingsgeluiden aanpassen?

Aanpassingsmogelijkheden voor meldingen:
- **Systeemgeluiden**: Gebruik de geluidsinstelling van het OS voor meldingen
- **Browserinstellingen**: Configureer in browsermeldingenvoorkeuren
- **OneUptime-instellingen**: Stel meldingsvoorkeuren in op het dashboard
- **Prioriteitsniveaus**: Configureer verschillende geluiden voor ernstniveaus

### Hoe schakel ik meldingen tijdelijk uit?

Tijdelijk meldingen uitschakelen:
- **Niet storen**: Schakel de DND-modus van het systeem in
- **Browserinstellingen**: Schakel sitemeldingen tijdelijk uit
- **OneUptime-dashboard**: Pauzeer meldingen in instellingen
- **Focusmodi**: Gebruik OS-focus-/concentratiemodi

## Beveiliging veelgestelde vragen

### Is de OneUptime PWA veilig?

Beveiligingsfuncties en overwegingen:
- **HTTPS-versleuteling**: Alle gegevens worden veilig verzonden
- **Same-Origin Policy**: Beveiligingsbeperkingen van de browser zijn van toepassing
- **Sandbox-omgeving**: Draait in de beveiligingssandbox van de browser
- **Regelmatige updates**: Beveiligingspatches worden automatisch toegepast
- **Geen roottoegang**: Beperkte systeemtoegang vergeleken met native apps


*Opmerking: Gevoelige gegevens zijn versleuteld en voldoen aan de beveiligingsnormen van de browser.*

### Kan ik de OneUptime PWA gebruiken op bedrijfsnetwerken?

Overwegingen voor bedrijfsnetwerken:
- **Firewallregels**: Zorg voor HTTPS-toegang (poort 443)
- **Proxyconfiguratie**: Configureer browserproxyinstellingen
- **Certificaatvertrouwen**: Installeer bedrijfscertificaten indien nodig
- **VPN-toegang**: Gebruik VPN voor toegang op afstand
- **Beveiligingsbeleid**: Voldoe aan IT-beveiligingsvereisten

## Probleemoplossing

### Installatieproblemen

**Probleem**: Installatieknop verschijnt niet
```
Oplossingen:
1. Wacht 30+ seconden op de OneUptime-pagina
2. Vernieuw de pagina en wacht opnieuw
3. Wis browsercache en cookies
4. Probeer een andere browser (Chrome/Edge aanbevolen)
5. Verifieer HTTPS-verbinding (controleer op slotpictogram)
6. Controleer of al geïnstalleerd
```

**Probleem**: Installatie mislukt of crasht
```
Oplossingen:
1. Zorg voor voldoende opslagruimte (100 MB+)
2. Sluit andere browsertabs en applicaties
3. Browser bijwerken naar de nieuwste versie
4. Browserextensies tijdelijk uitschakelen
5. Probeer de installatie in privé-/incognitomodus
6. Browser herstarten en opnieuw proberen
```

**Probleem**: App installeert maar verschijnt niet
```
Oplossingen:
1. Controleer alle locaties van het app-startprogramma
2. Zoek naar "OneUptime" in apparaatzoekfunctie
3. Zoek in de sectie voor app-beheer van de browser
4. Wacht 1-2 minuten tot het systeem zich vernieuwt
5. Apparaat herstarten en opnieuw controleren
```

**Probleem**: App crasht regelmatig
```
Oplossingen:
1. Browser bijwerken naar de nieuwste versie
2. Alle browsergegevens voor OneUptime wissen
3. Browserextensies uitschakelen
4. Beschikbare opslagruimte controleren
5. Besturingssysteem herstarten
6. OneUptime PWA herinstalleren
```

**Probleem**: Push-meldingen werken niet
```
Oplossingen:
1. Controleer meldingsmachtigingen in browser
2. Controleer systeemmeldingsinstellingen
3. Test eerst met een eenvoudige melding
4. Meldingsgegevens wissen en machtigingen opnieuw verlenen
5. Controleer de instellingen voor Niet storen/Focusmodus
6. Controleer OneUptime-meldingsconfiguratie
```

**Probleem**: App synchroniseert de nieuwste gegevens niet
```
Oplossingen:
1. Veeg omlaag om te vernieuwen (mobiel)
2. Druk op Ctrl+F5 (Windows/Linux) of Cmd+R (Mac)
3. Sluit de app en open opnieuw
4. App-cache wissen en opnieuw laden
5. Netwerkconnectiviteit controleren
```

### Platformspecifieke problemen

**Android-problemen:**
```
Probleem: App verschijnt niet in app-lade
Oplossing: Controleer de sectie "Onlangs toegevoegd" apps, zoek in app-lade

Probleem: Meldingen vertraagd
Oplossing: Batterijoptimalisatie uitschakelen voor browser-app

Probleem: App crasht bij opstarten
Oplossing: Chrome-appgegevens wissen, apparaat herstarten
```

**iOS-problemen:**
```
Probleem: Kan niet toevoegen aan startscherm
Oplossing: Gebruik Safari-browser, zorg voor iOS 11.3+

Probleem: App-pictogram ontbreekt
Oplossing: Controleer alle startschermpagina's en App-bibliotheek

Probleem: Face ID werkt niet
Oplossing: Schakel Face ID in voor Safari in instellingen
```

**Windows-problemen:**
```
Probleem: App verschijnt niet in Startmenu
Oplossing: Zoek naar app-naam, controleer lijst met geïnstalleerde apps

Probleem: Meldingen worden niet weergegeven
Oplossing: Controleer Windows-meldingsinstellingen, schakel in voor browser

Probleem: Vensterformaatproblemen
Oplossing: Handmatig aanpassen, app onthoudt de afmetingen
```

**macOS-problemen:**
```
Probleem: Kan niet installeren via Safari
Oplossing: Update naar macOS Sonoma+, gebruik Archief → Voeg toe aan Dock

Probleem: App niet in map Programma's
Oplossing: Controleer Launchpad, gebruik Spotlight-zoekfunctie

Probleem: Meldingen werken niet
Oplossing: Controleer Systeemvoorkeuren → Meldingen
```

**Linux-problemen:**
```
Probleem: PWA-installatieoptie ontbreekt
Oplossing: Gebruik Chrome/Chromium, zorg voor ondersteuning van de desktopomgeving

Probleem: Pictogram verschijnt niet in startprogramma
Oplossing: Desktop-database bijwerken, controleer het .desktop-bestand

Probleem: Audio-meldingen werken niet
Oplossing: Controleer PulseAudio, verifieer audio-machtigingen van browser
```

### Foutmeldingen

**"Deze site kan niet worden geïnstalleerd"**
```
Oorzaken:
- OneUptime-instantie voldoet niet aan de PWA-vereisten
- Ontbrekend of ongeldig web-app-manifest
- HTTPS niet correct geconfigureerd
- Browser ondersteunt geen PWA-installatie

Oplossingen:
- Neem contact op met de beheerder om de PWA-configuratie te verifiëren
- Probeer een andere browser
- Controleer de browserconsole voor gedetailleerde fouten
```

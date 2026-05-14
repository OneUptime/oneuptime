# Server / VM Monitor

Server- en VM-monitoring stelt u in staat de gezondheid en prestaties van uw servers, virtuele machines en andere infrastructuur te bewaken door een lichtgewicht agent te installeren die systeemmetrics rapporteert aan OneUptime.

## Overzicht

Servermonitors gebruiken een infrastructuuragent die op uw servers is geïnstalleerd om systeemmetrics te verzamelen en te rapporteren. Hiermee kunt u:

- Server-uptime en beschikbaarheid bewaken
- CPU-, geheugen- en schijfgebruik bijhouden
- Actieve processen bewaken
- Meldingen instellen op basis van drempelwaarden voor resourcegebruik
- Infrastructuurproblemen detecteren voordat ze uw diensten beïnvloeden

## Een Server Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **Server / VM** als het monitortype
4. Er wordt een **Geheime sleutel** gegenereerd voor deze monitor — u heeft deze nodig om de agent te configureren
5. Volg de installatie-instructies om de agent op uw server in te stellen

## De infrastructuuragent installeren

De OneUptime Infrastructuuragent is een lichtgewicht, Go-gebaseerde daemon die elke 30 seconden systeemmetrics verzamelt en naar OneUptime stuurt. Hij ondersteunt Linux, macOS en Windows.

### Linux / macOS

```bash
# De agent installeren
curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh | sudo bash

# De agent configureren
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# De agent starten
sudo oneuptime-infrastructure-agent start
```

Vervang `YOUR_SECRET_KEY` door de geheime sleutel die wordt weergegeven in de instellingen van uw monitor, en `https://oneuptime.com` door de URL van uw OneUptime-instantie als u zelf host.

### Windows

1. Download de nieuwste agent van [GitHub Releases](https://github.com/OneUptime/oneuptime/releases/latest)
   - `oneuptime-infrastructure-agent_windows_amd64.zip` voor x64-systemen
   - `oneuptime-infrastructure-agent_windows_arm64.zip` voor ARM64-systemen
2. Pak het zip-bestand uit
3. Open een opdrachtprompt als beheerder en voer uit:

```bash
# De agent configureren
oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# De agent starten
oneuptime-infrastructure-agent start
```

### Proxy-ondersteuning

Als uw server verbinding maakt met internet via een proxy, kunt u de agent zo configureren dat deze deze gebruikt:

```bash
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com --proxy-url=http://proxy.example.com:8080
```

## Agentopdrachten

De infrastructuuragent ondersteunt de volgende opdrachten:

| Opdracht | Beschrijving |
|---------|-------------|
| `configure` | De agent configureren met uw geheime sleutel en OneUptime-URL |
| `start` | De agentdienst starten |
| `stop` | De agentdienst stoppen |
| `restart` | De agentdienst herstarten |
| `status` | De huidige dienststatus weergeven |
| `logs` | Agentlogboeken bekijken (gebruik `-n` voor aantal regels, `-f` om te volgen) |
| `uninstall` | De agentdienst verwijderen |

## Verzamelde metrics

De agent verzamelt de volgende metrics van uw server:

### CPU

- **CPU-gebruikspercentage** — Algeheel CPU-gebruik als percentage
- **CPU-cores** — Aantal CPU-cores

### Geheugen

- **Totaal geheugen** — Totaal beschikbaar geheugen
- **Gebruikt geheugen** — Momenteel in gebruik zijnd geheugen
- **Vrij geheugen** — Beschikbaar vrij geheugen
- **Geheugengebruikspercentage** — Geheugengebruik als percentage

### Schijf

Voor elke gemounte schijf/volume:

- **Totale schijfruimte** — Totale capaciteit van de schijf
- **Gebruikte schijfruimte** — Momenteel in gebruik zijnde ruimte
- **Vrije schijfruimte** — Beschikbare vrije ruimte
- **Schijfgebruikspercentage** — Schijfgebruik als percentage
- **Schijfpad** — Koppelpad van de schijf

### Processen

- **Procesnaam** — Naam van het actieve proces
- **Proces-ID (PID)** — Procesidentificator
- **Procesopdracht** — Volledige opdracht waarmee het proces is gestart

## Monitoringcriteria

U kunt criteria configureren om te bepalen wanneer uw server als online, gedegradeerd of offline wordt beschouwd.

### Beschikbare controletypen

| Controletype | Beschrijving |
|------------|-------------|
| Is online | Of de serveragent rapporteert (op basis van heartbeat) |
| CPU-gebruikspercentage | Huidig CPU-gebruikspercentage |
| Geheugengebruikspercentage | Huidig geheugengebruikspercentage |
| Schijfgebruikspercentage | Huidig schijfgebruikspercentage (voor een specifiek schijfpad) |
| Serverprocesnaam | Controleer of een proces met een specifieke naam actief is |
| Serverprocesopdracht | Controleer of een proces met een specifieke opdracht actief is |
| Serverprocesproces-ID | Controleer of een proces met een specifieke PID actief is |

### Filtertypen

Voor numerieke metrics (CPU, geheugen, schijf):

- **Groter dan** — Waarde overschrijdt een drempelwaarde
- **Kleiner dan** — Waarde is onder een drempelwaarde
- **Groter dan of gelijk aan** — Waarde is op of boven een drempelwaarde
- **Kleiner dan of gelijk aan** — Waarde is op of onder een drempelwaarde
- **Evalueren over tijd** — Evalueren met aggregatie (Gemiddelde, Som, Maximum, Minimum, Alle waarden, Elke waarde) over een tijdvenster

Voor procescontroles:

- **Wordt uitgevoerd** — Het proces is momenteel actief
- **Wordt niet uitgevoerd** — Het proces is niet actief

### Voorbeeldcriteria

#### Server als offline markeren als de agent stopt met rapporteren

- **Controleer op**: Is online
- **Filtertype**: False

#### Melding wanneer CPU-gebruik 90% overschrijdt

- **Controleer op**: CPU-gebruikspercentage
- **Filtertype**: Groter dan
- **Waarde**: 90

#### Melding wanneer schijfgebruik 85% overschrijdt

- **Controleer op**: Schijfgebruikspercentage
- **Schijfpad**: `/`
- **Filtertype**: Groter dan
- **Waarde**: 85

#### Melding wanneer geheugengebruik 80% overschrijdt

- **Controleer op**: Geheugengebruikspercentage
- **Filtertype**: Groter dan
- **Waarde**: 80

#### Melding als een kritiek proces stopt

- **Controleer op**: Serverprocesnaam
- **Filtertype**: Wordt niet uitgevoerd
- **Waarde**: `nginx`

## Probleemoplossing

### Agent rapporteert niet

- Controleer of de agent actief is: `sudo oneuptime-infrastructure-agent status`
- Bekijk agentlogboeken: `sudo oneuptime-infrastructure-agent logs -n 50`
- Bevestig dat de geheime sleutel correct is
- Zorg dat de server de URL van uw OneUptime-instantie kan bereiken
- Controleer of firewallregels uitgaande HTTPS-verbindingen toestaan

### Hoog resourcegebruik door agent

De agent is ontworpen om lichtgewicht te zijn. Als u hoog resourcegebruik opmerkt:
- Herstart de agent: `sudo oneuptime-infrastructure-agent restart`
- Controleer agentlogboeken op fouten

### Proxyproblemen

- Controleer of de proxy-URL en -poort correct zijn
- Zorg dat de proxy verbindingen met uw OneUptime-instantie toestaat
- Herconfigureer met: `sudo oneuptime-infrastructure-agent configure --proxy-url=http://proxy:port --secret-key=YOUR_KEY --oneuptime-url=YOUR_URL`

## Best practices

1. **Stel betekenisvolle drempelwaarden in** — Configureer gedegradeerde en offline criteria die overeenkomen met de normale bedrijfsrange van uw server
2. **Bewaken kritieke processen** — Gebruik procesmonitoring om ervoor te zorgen dat essentiële diensten zoals webservers en databases altijd actief zijn
3. **Bewaken schijfgebruik proactief** — Schijfruimteproblemen kunnen cascade-effecten veroorzaken op applicatiefouten; stel meldingen in ruim voordat schijven vol zijn
4. **Gebruik "Evalueren over tijd"** — Voor metrics zoals CPU die kort kunnen pieken, gebruik tijdgebaseerde aggregatie om valse meldingen te vermijden
5. **Houd de agent bijgewerkt** — Werk de infrastructuuragent regelmatig bij om de nieuwste verbeteringen en correcties te krijgen

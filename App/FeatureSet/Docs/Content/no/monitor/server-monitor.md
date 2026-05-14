# Server / VM-monitor

Server- og VM-overvåking lar deg overvåke helse og ytelse for servere, virtuelle maskiner og annen infrastruktur ved å installere en lettvektsagent som rapporterer systemmålinger til OneUptime.

## Oversikt

Server-monitorer bruker en infrastrukturagent installert på serverne dine for å samle inn og rapportere systemmålinger. Dette gjør det mulig å:

- Overvåke serveroppetid og tilgjengelighet
- Spore CPU-, minne- og diskforbruk
- Overvåke kjørende prosesser
- Sette opp varsler basert på ressursutnyttelsesterskler
- Oppdage infrastrukturproblemer før de påvirker tjenestene dine

## Opprette en server-monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **Server / VM** som monitortype
4. En **hemmelig nøkkel** vil bli generert for denne monitoren – du trenger den for å konfigurere agenten
5. Følg installasjonsinstruksjonene for å sette opp agenten på serveren din

## Installere infrastrukturagenten

OneUptime-infrastrukturagenten er en lettvekts Go-basert daemon som samler inn systemmålinger og sender dem til OneUptime hvert 30. sekund. Den støtter Linux, macOS og Windows.

### Linux / macOS

```bash
# Installer agenten
curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh | sudo bash

# Konfigurer agenten
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# Start agenten
sudo oneuptime-infrastructure-agent start
```

Erstatt `YOUR_SECRET_KEY` med den hemmelige nøkkelen som vises i monitorinnstillingene, og `https://oneuptime.com` med URL-en til din OneUptime-instans hvis du selvhoster.

### Windows

1. Last ned den nyeste agenten fra [GitHub Releases](https://github.com/OneUptime/oneuptime/releases/latest)
   - `oneuptime-infrastructure-agent_windows_amd64.zip` for x64-systemer
   - `oneuptime-infrastructure-agent_windows_arm64.zip` for ARM64-systemer
2. Pakk ut zip-filen
3. Åpne ledetekst som administrator og kjør:

```bash
# Konfigurer agenten
oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# Start agenten
oneuptime-infrastructure-agent start
```

### Proxy-støtte

Hvis serveren kobler til internett via en proxy, kan du konfigurere agenten til å bruke den:

```bash
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com --proxy-url=http://proxy.example.com:8080
```

## Agent-kommandoer

Infrastrukturagenten støtter følgende kommandoer:

| Kommando | Beskrivelse |
|----------|-------------|
| `configure` | Konfigurer agenten med den hemmelige nøkkelen og OneUptime-URL-en |
| `start` | Start agenttjenesten |
| `stop` | Stopp agenttjenesten |
| `restart` | Start agenttjenesten på nytt |
| `status` | Vis gjeldende tjenestestatus |
| `logs` | Vis agentlogger (bruk `-n` for linjeantall, `-f` for å følge) |
| `uninstall` | Avinstaller agenttjenesten |

## Innsamlede målinger

Agenten samler inn følgende målinger fra serveren:

### CPU

- **CPU Usage Percent** – Samlet CPU-utnyttelse som prosent
- **CPU Cores** – Antall CPU-kjerner

### Minne

- **Total Memory** – Totalt tilgjengelig minne
- **Used Memory** – Minne som er i bruk
- **Free Memory** – Tilgjengelig ledige minne
- **Memory Usage Percent** – Minneutnyttelse som prosent

### Disk

For hvert montert disk/volum:

- **Total Disk Space** – Total kapasitet for disken
- **Used Disk Space** – Plass som er i bruk
- **Free Disk Space** – Tilgjengelig ledig plass
- **Disk Usage Percent** – Diskutnyttelse som prosent
- **Disk Path** – Monteringsstien til disken

### Prosesser

- **Process Name** – Navn på den kjørende prosessen
- **Process ID (PID)** – Prosessidentifikator
- **Process Command** – Fullstendig kommando brukt til å starte prosessen

## Overvåkingskriterier

Du kan konfigurere kriterier for å bestemme når serveren anses som tilgjengelig, degradert eller utilgjengelig.

### Tilgjengelige kontrolltyper

| Kontrolltype | Beskrivelse |
|-------------|-------------|
| Is Online | Om serveragenten rapporterer (basert på hjerteslag) |
| CPU Usage Percent | Gjeldende CPU-utnyttelsesprosent |
| Memory Usage Percent | Gjeldende minneutnyttelsesprosent |
| Disk Usage Percent | Gjeldende diskutnyttelsesprosent (for en spesifikk disksti) |
| Server Process Name | Sjekk om en prosess med et spesifikt navn kjører |
| Server Process Command | Sjekk om en prosess med en spesifikk kommando kjører |
| Server Process PID | Sjekk om en prosess med en spesifikk PID kjører |

### Filtertyper

For numeriske målinger (CPU, minne, disk):

- **Greater Than** – Verdien overskrider en terskel
- **Less Than** – Verdien er under en terskel
- **Greater Than or Equal To** – Verdien er ved eller over en terskel
- **Less Than or Equal To** – Verdien er ved eller under en terskel
- **Evaluate Over Time** – Evaluer ved hjelp av aggregering (Average, Sum, Maximum, Minimum, All Values, Any Value) over et tidsvindu

For prosesskontroller:

- **Is Executing** – Prosessen kjører for øyeblikket
- **Is Not Executing** – Prosessen kjører ikke

### Eksempelkriterier

#### Marker server som utilgjengelig hvis agenten slutter å rapportere

- **Sjekk på**: Is Online
- **Filtertype**: False

#### Varsle når CPU-forbruk overskrider 90 %

- **Sjekk på**: CPU Usage Percent
- **Filtertype**: Greater Than
- **Verdi**: 90

#### Varsle når diskforbruk overskrider 85 %

- **Sjekk på**: Disk Usage Percent
- **Disksti**: `/`
- **Filtertype**: Greater Than
- **Verdi**: 85

#### Varsle når minneforbruk overskrider 80 %

- **Sjekk på**: Memory Usage Percent
- **Filtertype**: Greater Than
- **Verdi**: 80

#### Varsle hvis en kritisk prosess slutter å kjøre

- **Sjekk på**: Server Process Name
- **Filtertype**: Is Not Executing
- **Verdi**: `nginx`

## Feilsøking

### Agenten rapporterer ikke

- Verifiser at agenten kjører: `sudo oneuptime-infrastructure-agent status`
- Sjekk agentlogger: `sudo oneuptime-infrastructure-agent logs -n 50`
- Bekreft at den hemmelige nøkkelen er korrekt
- Sørg for at serveren kan nå URL-en til din OneUptime-instans
- Sjekk at brannmurregler tillater utgående HTTPS-tilkoblinger

### Høy ressursbruk av agenten

Agenten er designet for å være lettvekts. Hvis du merker høy ressursbruk:
- Start agenten på nytt: `sudo oneuptime-infrastructure-agent restart`
- Sjekk agentlogger for feil

### Proxy-problemer

- Verifiser at proxy-URL og port er korrekte
- Sørg for at proxyen tillater tilkoblinger til din OneUptime-instans
- Rekonfigurer med: `sudo oneuptime-infrastructure-agent configure --proxy-url=http://proxy:port --secret-key=YOUR_KEY --oneuptime-url=YOUR_URL`

## Beste praksis

1. **Sett meningsfulle terskler** – Konfigurer degradert og utilgjengelig kriterier som samsvarer med serverens normale driftsområder
2. **Overvåk kritiske prosesser** – Bruk prosesskontroll for å sikre at essensielle tjenester som webservere og databaser alltid kjører
3. **Overvåk diskforbruk proaktivt** – Diskplassproblemer kan eskalere til applikasjonsfeil; sett varsler i god tid før disker er fulle
4. **Bruk "Evaluate Over Time"** – For målinger som CPU som kan pigge kort, bruk tidsbasert aggregering for å unngå falske varsler
5. **Hold agenten oppdatert** – Oppdater infrastrukturagenten regelmessig for å få de nyeste forbedringene og rettelsene

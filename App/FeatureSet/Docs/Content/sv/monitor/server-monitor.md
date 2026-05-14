# Server/VM-monitor

Server- och VM-övervakning gör det möjligt att övervaka hälsan och prestandan hos dina servrar, virtuella maskiner och annan infrastruktur genom att installera en lätt agent som rapporterar systemmätvärden till OneUptime.

## Översikt

Servermonitorer använder en infrastrukturagent som installerats på dina servrar för att samla in och rapportera systemmätvärden. Detta gör det möjligt att:

- Övervaka server-drifttid och tillgänglighet
- Spåra CPU-, minnes- och diskanvändning
- Övervaka körande processer
- Ange varningar baserat på resursutnyttjandetrösklar
- Identifiera infrastrukturproblem innan de påverkar dina tjänster

## Skapa en servermonitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Server/VM** som monitortyp
4. En **Hemlig nyckel** kommer att genereras för den här monitorn – du behöver den för att konfigurera agenten
5. Följ installationsinstruktionerna för att konfigurera agenten på din server

## Installera infrastrukturagenten

OneUptime Infrastrukturagenten är en lätt Go-baserad daemon som samlar in systemmätvärden och skickar dem till OneUptime var 30:e sekund. Den stöder Linux, macOS och Windows.

### Linux / macOS

```bash
# Installera agenten
curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh | sudo bash

# Konfigurera agenten
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# Starta agenten
sudo oneuptime-infrastructure-agent start
```

Ersätt `YOUR_SECRET_KEY` med den hemliga nyckel som visas i monitorns inställningar och `https://oneuptime.com` med din OneUptime-instans-URL om du egeninstallerar.

### Windows

1. Ladda ner den senaste agenten från [GitHub Releases](https://github.com/OneUptime/oneuptime/releases/latest)
   - `oneuptime-infrastructure-agent_windows_amd64.zip` för x64-system
   - `oneuptime-infrastructure-agent_windows_arm64.zip` för ARM64-system
2. Extrahera zip-filen
3. Öppna kommandotolken som administratör och kör:

```bash
# Konfigurera agenten
oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# Starta agenten
oneuptime-infrastructure-agent start
```

### Proxystöd

Om din server ansluter till internet via en proxy kan du konfigurera agenten att använda den:

```bash
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com --proxy-url=http://proxy.example.com:8080
```

## Agentkommandon

Infrastrukturagenten stöder följande kommandon:

| Kommando | Beskrivning |
|---------|-------------|
| `configure` | Konfigurera agenten med din hemliga nyckel och OneUptime-URL |
| `start` | Starta agenttjänsten |
| `stop` | Stoppa agenttjänsten |
| `restart` | Starta om agenttjänsten |
| `status` | Visa aktuell tjänstestatus |
| `logs` | Visa agentloggar (använd `-n` för radantal, `-f` för att följa) |
| `uninstall` | Avinstallera agenttjänsten |

## Insamlade mätvärden

Agenten samlar in följande mätvärden från din server:

### CPU

- **CPU-användningsprocent** – Övergripande CPU-utnyttjande som procentandel
- **CPU-kärnor** – Antal CPU-kärnor

### Minne

- **Totalt minne** – Totalt tillgängligt minne
- **Använt minne** – Minne som för närvarande används
- **Ledigt minne** – Tillgängligt ledigt minne
- **Minnesanvändningsprocent** – Minnesutnyttjande som procentandel

### Disk

För varje monterad disk/volym:

- **Totalt diskutrymme** – Diskens totala kapacitet
- **Använt diskutrymme** – Utrymme som för närvarande används
- **Ledigt diskutrymme** – Tillgängligt ledigt utrymme
- **Diskanvändningsprocent** – Diskutnyttjande som procentandel
- **Disksökväg** – Diskens monteringssökväg

### Processer

- **Processnamn** – Namn på den körande processen
- **Process-ID (PID)** – Processidentifierare
- **Processkommando** – Fullständigt kommando som användes för att starta processen

## Övervakningskriterier

Du kan konfigurera kriterier för att avgöra när din server anses vara online, degraderad eller offline.

### Tillgängliga kontrolltyper

| Kontrolltyp | Beskrivning |
|------------|-------------|
| Är online | Om serveragenten rapporterar (baserat på hjärtslag) |
| CPU-användningsprocent | Aktuell CPU-utnyttjandeprocentens |
| Minnesanvändningsprocent | Aktuell minnesutnyttjandeprocentens |
| Diskanvändningsprocent | Aktuell diskutnyttjandeprocentens (för en specifik disksökväg) |
| Serverprocessnamn | Kontrollera om en process med ett specifikt namn körs |
| Serverprocesskommando | Kontrollera om en process med ett specifikt kommando körs |
| Serverprocess-PID | Kontrollera om en process med ett specifikt PID körs |

### Filtertyper

För numeriska mätvärden (CPU, minne, disk):

- **Större än** – Värdet överstiger ett tröskelvärde
- **Mindre än** – Värdet understiger ett tröskelvärde
- **Större än eller lika med** – Värdet är vid eller över ett tröskelvärde
- **Mindre än eller lika med** – Värdet är vid eller under ett tröskelvärde
- **Utvärdera över tid** – Utvärdera med aggregering (Medel, Summa, Maximum, Minimum, Alla värden, Valfritt värde) under ett tidsfönster

För processkontroller:

- **Körs** – Processen körs för närvarande
- **Körs inte** – Processen körs inte

### Exempelkriterier

#### Markera server som offline om agenten slutar rapportera

- **Kontrollera på**: Är online
- **Filtertyp**: Falskt

#### Varna när CPU-användningen överstiger 90%

- **Kontrollera på**: CPU-användningsprocent
- **Filtertyp**: Större än
- **Värde**: 90

#### Varna när diskanvändningen överstiger 85%

- **Kontrollera på**: Diskanvändningsprocent
- **Disksökväg**: `/`
- **Filtertyp**: Större än
- **Värde**: 85

#### Varna om en kritisk process slutar köras

- **Kontrollera på**: Serverprocessnamn
- **Filtertyp**: Körs inte
- **Värde**: `nginx`

## Felsökning

### Agenten rapporterar inte

- Verifiera att agenten körs: `sudo oneuptime-infrastructure-agent status`
- Kontrollera agentloggar: `sudo oneuptime-infrastructure-agent logs -n 50`
- Bekräfta att den hemliga nyckeln är korrekt
- Se till att servern kan nå din OneUptime-instans-URL
- Kontrollera att brandväggsregler tillåter utgående HTTPS-anslutningar

### Hög resursanvändning av agenten

Agenten är designad för att vara lätt. Om du märker hög resursanvändning:
- Starta om agenten: `sudo oneuptime-infrastructure-agent restart`
- Kontrollera agentloggar efter fel

## Bästa praxis

1. **Ange meningsfulla trösklar** – Konfigurera degraderade och offline-kriterier som matchar din servers normala driftsintervall
2. **Övervaka kritiska processer** – Använd processövervakning för att säkerställa att viktiga tjänster som webbservrar och databaser alltid körs
3. **Övervaka diskanvändning proaktivt** – Diskutrymmesprob lem kan kaskadresultera i applikationsmisslyckanden; ange varningar långt innan diskar är fulla
4. **Använd "Utvärdera över tid"** – För mätvärden som CPU som kan toppa kortvarigt, använd tidsbaserad aggregering för att undvika falska varningar
5. **Håll agenten uppdaterad** – Uppdatera infrastrukturagenten periodiskt för att få de senaste förbättringarna och korrigeringarna

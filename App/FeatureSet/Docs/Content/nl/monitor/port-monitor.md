# Poort Monitor

Poortmonitoring stelt u in staat de beschikbaarheid van specifieke TCP- of UDP-poorten op een host te bewaken. OneUptime probeert periodiek verbinding te maken met de opgegeven poort en controleert of deze open en responsief is.

## Overzicht

Poortmonitors testen of een specifieke netwerkpoort verbindingen accepteert. Hiermee kunt u:

- Beschikbaarheid van diensten op specifieke poorten bewaken
- Poortresponstijden bijhouden
- Verifiëren dat diensten zoals databases, mailservers en applicatieservers actief zijn
- Dienstuitval detecteren voordat deze gebruikers beïnvloedt

## Een Poort Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **Poort** als het monitortype
4. Voer de hostnaam of het IP-adres en het poortnummer in
5. Configureer monitoringcriteria naar wens

## Configuratie-opties

### Hostnaam of IP-adres

Voer de hostnaam of het IP-adres in van de doelhost (bijv. `example.com` of `192.168.1.1`).

### Poort

Voer het te bewaken poortnummer in (1-65535). Veelgebruikte voorbeelden:

| Poort | Dienst     |
| ----- | ---------- |
| 22    | SSH        |
| 25    | SMTP       |
| 80    | HTTP       |
| 443   | HTTPS      |
| 3306  | MySQL      |
| 5432  | PostgreSQL |
| 6379  | Redis      |
| 27017 | MongoDB    |

## Monitoringcriteria

U kunt criteria configureren om te bepalen wanneer uw poort als online, gedegradeerd of offline wordt beschouwd op basis van:

### Beschikbare controletypen

| Controletype        | Beschrijving                                                 |
| ------------------- | ------------------------------------------------------------ |
| Is online           | Of de poort open is en verbindingen accepteert               |
| Responstijd (in ms) | Tijd om een verbinding tot stand te brengen in milliseconden |
| Is verzoek time-out | Of de verbindingspoging een time-out heeft                   |

### Filtertypen

Voor **Is online** en **Is verzoek time-out**:

- **True** — Voorwaarde is waar
- **False** — Voorwaarde is onwaar

Voor **Responstijd**:

- **Groter dan** — Responstijd overschrijdt een drempelwaarde
- **Kleiner dan** — Responstijd is onder een drempelwaarde
- **Groter dan of gelijk aan** — Responstijd is op of boven een drempelwaarde
- **Kleiner dan of gelijk aan** — Responstijd is op of onder een drempelwaarde
- **Gelijk aan** — Responstijd komt exact overeen
- **Niet gelijk aan** — Responstijd komt niet overeen
- **Evalueren over tijd** — Evalueren met aggregatie (Gemiddelde, Som, Maximum, Minimum, Alle waarden, Elke waarde) over een tijdvenster

### Voorbeeldcriteria

#### Als offline markeren als poort gesloten is

- **Controleer op**: Is online
- **Filtertype**: False

#### Melding als verbindingstijd 500 ms overschrijdt

- **Controleer op**: Responstijd (in ms)
- **Filtertype**: Groter dan
- **Waarde**: 500

#### Als gedegradeerd markeren als verbinding traag is

- **Controleer op**: Responstijd (in ms)
- **Filtertype**: Groter dan
- **Waarde**: 200

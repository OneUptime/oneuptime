# IP Monitor

IP-monitoring stelt u in staat de beschikbaarheid en reactiesnelheid van elk IPv4- of IPv6-adres te bewaken. OneUptime test periodiek de connectiviteit naar het doel-IP-adres en rapporteert de status ervan.

## Overzicht

IP-monitors verifiëren dat een specifiek IP-adres bereikbaar en responsief is. Hiermee kunt u:

- Beschikbaarheid van IPv4- en IPv6-adressen bewaken
- Responstijden en latentie bijhouden
- Netwerkconnectiviteitsproblemen detecteren
- Verifiëren dat infrastructuur-eindpunten bereikbaar zijn

## Een IP Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **IP** als het monitortype
4. Voer het IP-adres in dat u wilt bewaken
5. Configureer monitoringcriteria naar wens

## Configuratie-opties

### IP-adres

Voer het IPv4- of IPv6-adres in dat u wilt bewaken (bijv. `192.168.1.1` of `2001:db8::1`). De waarde moet een geldig IP-adresformaat zijn.

## Monitoringcriteria

U kunt criteria configureren om te bepalen wanneer uw IP-adres als online, gedegradeerd of offline wordt beschouwd op basis van:

### Beschikbare controletypen

| Controletype        | Beschrijving                      |
| ------------------- | --------------------------------- |
| Is online           | Of het IP-adres bereikbaar is     |
| Responstijd (in ms) | Responstijd in milliseconden      |
| Is verzoek time-out | Of het verzoek een time-out heeft |

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
- **Evalueren over tijd** — Evalueren met behulp van aggregatie (Gemiddelde, Som, Maximum, Minimum, Alle waarden, Elke waarde) over een tijdvenster

### Voorbeeldcriteria

#### Als offline markeren als IP onbereikbaar is

- **Controleer op**: Is online
- **Filtertype**: False

#### Melding als latentie 100 ms overschrijdt

- **Controleer op**: Responstijd (in ms)
- **Filtertype**: Groter dan
- **Waarde**: 100

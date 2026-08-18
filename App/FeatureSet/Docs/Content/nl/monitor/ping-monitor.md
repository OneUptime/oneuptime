# Ping Monitor

Ping-monitoring stelt u in staat de beschikbaarheid en reactiesnelheid van elke host of elk IP-adres te bewaken. OneUptime verstuurt periodiek ping-verzoeken naar uw doel en controleert of het correct reageert.

## Overzicht

Ping-monitors testen basisnetwerkconnectiviteit door ICMP ping-verzoeken naar een host te sturen. Hiermee kunt u:

- Host-uptime en beschikbaarheid bewaken
- Netwerklatentie en responstijden bijhouden
- Connectiviteitsproblemen detecteren voordat ze uw diensten beïnvloeden
- Verifiëren dat servers en netwerkapparaten bereikbaar zijn

## Een Ping Monitor aanmaken

1. Ga naar **Monitoren** in het OneUptime-dashboard
2. Klik op **Monitor maken**
3. Selecteer **Ping** als het monitortype
4. Voer de hostnaam of het IP-adres in dat u wilt bewaken
5. Configureer monitoringcriteria naar wens

## Configuratie-opties

### Ping-hostnaam of IP-adres

Voer de hostnaam of het IP-adres in van het doel dat u wilt bewaken (bijv. `example.com` of `192.168.1.1`). Zowel hostnamen als IP-adressen worden geaccepteerd.

## Monitoringcriteria

U kunt criteria configureren om te bepalen wanneer uw host als online, gedegradeerd of offline wordt beschouwd op basis van:

### Beschikbare controletypen

| Controletype         | Beschrijving                                                      |
| -------------------- | ----------------------------------------------------------------- |
| Is online            | Of de host reageert op ping-verzoeken                             |
| Responstijd (in ms)  | Retourtijd van het ping-verzoek in milliseconden                  |
| Pakketverlies (in %) | Percentage ICMP echo-verzoeken zonder antwoord                    |
| Jitter (in ms)       | Standaarddeviatie van de retourtijden over de verzonden pakketten |
| Is verzoek time-out  | Of het ping-verzoek een time-out heeft                            |

### Filtertypen

Voor **Is online** en **Is verzoek time-out**:

- **True** — Voorwaarde is waar
- **False** — Voorwaarde is onwaar

Voor **Responstijd**, **Pakketverlies** en **Jitter**:

- **Groter dan** — Responstijd overschrijdt een drempelwaarde
- **Kleiner dan** — Responstijd is onder een drempelwaarde
- **Groter dan of gelijk aan** — Responstijd is op of boven een drempelwaarde
- **Kleiner dan of gelijk aan** — Responstijd is op of onder een drempelwaarde

**Dit criterium over een periode evalueren** is een selectievakje op het criteriaformulier, geen filtervoorwaarde. Zet het aan om een aggregatie — gekozen onder **Evalueren** (Gemiddelde, Som, Maximum, Minimum, Alle waarden, Elke waarde) over het venster dat is ingesteld bij **Voor de laatste (in minuten)** — te vergelijken in plaats van de waarde van de laatste controle.

### Voorbeeldcriteria

#### Als offline markeren als host onbereikbaar is

- **Controleer op**: Is online
- **Filtertype**: False

#### Melding als responstijd 200 ms overschrijdt

- **Controleer op**: Responstijd (in ms)
- **Filtertype**: Groter dan
- **Waarde**: 200

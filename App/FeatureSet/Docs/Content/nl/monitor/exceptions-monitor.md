# Uitzonderingen Monitor

Uitzonderingenmonitoring stelt u in staat applicatie-uitzonderingen en -fouten te bewaken en meldingen te activeren wanneer het aantal uitzonderingen uw geconfigureerde drempelwaarden overschrijdt. OneUptime evalueert uitzonderingsgegevens van uw telemetriediensten over een tijdvenster.

## Overzicht

Uitzonderingsmonitors tellen en filteren uitzonderingen die aan specifieke criteria voldoen. Hiermee kunt u:

- Meldingen ontvangen bij uitzondering-pieken in uw applicaties
- Specifieke uitzonderingstypes bewaken
- Uitzonderingen zoeken op foutbericht
- Opgeloste en actieve uitzonderingen afzonderlijk bijhouden
- Applicatiestabiliteitsproblemen detecteren op basis van foutpatronen

## Een Uitzonderingen Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **Uitzonderingen** als het monitortype
4. Selecteer de te bewaken telemetriediensten
5. Configureer uitzonderingsfilters en criteria naar wens

## Configuratie-opties

### Telemetriediensten

Selecteer een of meer diensten waarvan uitzonderingen worden bewaakt. Diensten moeten uitzonderingsgegevens via OpenTelemetry naar OneUptime sturen.

### Uitzonderingsfilters

| Filter                   | Beschrijving                                                                         | Vereist |
| ------------------------ | ------------------------------------------------------------------------------------ | ------- |
| Uitzonderingstypes       | Filteren op namen van uitzonderingstypes (bijv. `NullPointerException`, `TypeError`) | Nee     |
| Bericht                  | Zoek in tekst van uitzonderingsberichten                                             | Nee     |
| Opgeloste includeren     | Opgeloste uitzonderingen includeren (standaard: false)                               | Nee     |
| Gearchiveerde includeren | Gearchiveerde uitzonderingen includeren (standaard: false)                           | Nee     |
| Tijdvenster              | Hoe ver terug te zoeken naar uitzonderingen (in seconden, standaard: 60)             | Nee     |

## Monitoringcriteria

### Beschikbare controletypen

| Controletype         | Beschrijving                                                            |
| -------------------- | ----------------------------------------------------------------------- |
| Uitzonderingstelling | Het aantal uitzonderingen dat voldoet aan uw filters in het tijdvenster |

### Filtertypen

- **Groter dan** — Uitzonderingstelling overschrijdt een drempelwaarde
- **Kleiner dan** — Uitzonderingstelling is onder een drempelwaarde
- **Groter dan of gelijk aan** — Uitzonderingstelling is op of boven een drempelwaarde
- **Kleiner dan of gelijk aan** — Uitzonderingstelling is op of onder een drempelwaarde
- **Gelijk aan** — Uitzonderingstelling komt exact overeen
- **Niet gelijk aan** — Uitzonderingstelling komt niet overeen

### Voorbeeldcriteria

#### Melding bij meer dan 10 uitzonderingen in 60 seconden

- **Tijdvenster**: 60 seconden
- **Controleer op**: Uitzonderingstelling
- **Filtertype**: Groter dan
- **Waarde**: 10

#### Melding bij elke NullPointerException

- **Uitzonderingstypes**: `NullPointerException`
- **Tijdvenster**: 60 seconden
- **Controleer op**: Uitzonderingstelling
- **Filtertype**: Groter dan
- **Waarde**: 0

#### Uitzonderingen bewaken die een specifiek bericht bevatten

- **Bericht**: `out of memory`
- **Tijdvenster**: 300 seconden
- **Controleer op**: Uitzonderingstelling
- **Filtertype**: Groter dan
- **Waarde**: 0

## Installatievereisten

Uitzonderingenmonitoring vereist dat uw applicaties uitzonderingsgegevens via OpenTelemetry naar OneUptime sturen. Zie de [OpenTelemetry](/docs/telemetry/open-telemetry)-documentatie voor installatie-instructies.

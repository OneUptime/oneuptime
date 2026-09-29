# Uitzonderingen Monitor

Uitzonderingenmonitoring stelt u in staat applicatie-uitzonderingen en -fouten te bewaken en meldingen te activeren wanneer het aantal uitzonderingen uw geconfigureerde drempelwaarden overschrijdt. OneUptime evalueert uitzonderingsgegevens van uw telemetriediensten over een tijdvenster.

## Overzicht

Uitzonderingsmonitors tellen en filteren uitzonderingen die aan specifieke criteria voldoen. Hiermee kunt u:

- Meldingen ontvangen bij uitzondering-pieken in uw applicaties
- Specifieke uitzonderingstypes bewaken
- Meldingen beperken tot een deployment-omgeving zoals `production`
- Uitzonderingen zoeken op foutbericht
- Opgeloste en actieve uitzonderingen afzonderlijk bijhouden
- Applicatiestabiliteitsproblemen detecteren op basis van foutpatronen

## Een Uitzonderingen Monitor aanmaken

1. Ga naar **Monitoren** in het OneUptime-dashboard
2. Klik op **Monitor maken**
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
| Omgevingen               | Filteren op deployment-omgeving (bijv. `production`, `staging`)                      | Nee     |
| Bericht                  | Zoek in tekst van uitzonderingsberichten                                             | Nee     |
| Opgeloste includeren     | Opgeloste uitzonderingen includeren (standaard: false)                               | Nee     |
| Gearchiveerde includeren | Gearchiveerde uitzonderingen includeren (standaard: false)                           | Nee     |
| Tijdvenster              | Hoe ver terug te zoeken naar uitzonderingen (in seconden, standaard: 60)             | Nee     |

### Omgevingen

Omgevingen zijn afkomstig van het OpenTelemetry-resourceattribuut `deployment.environment` van elke uitzondering, dezelfde waarde waarop de uitzonderingenverkenner filtert met `env:production`. Voer één omgeving in, of meerdere gescheiden door komma's; een uitzondering wordt meegeteld wanneer de omgeving ervan overeenkomt met een van deze.

De vergelijking is exact en hoofdlettergevoelig: `production` komt niet overeen met `Production` of `prod`. Uitzonderingen zonder omgeving worden niet meegeteld wanneer dit filter is ingesteld. Laat het leeg om uitzonderingen uit alle omgevingen te tellen, inclusief uitzonderingen zonder omgeving.

Het omgevingsfilter wordt gecombineerd met alle andere filters, dus een monitor die is beperkt tot één telemetriedienst en `production` telt alleen de productie-uitzonderingen van die dienst.

Wanneer u de monitor via de API aanmaakt, stelt u `environments` in de `exceptionMonitor` van de stap in op een lijst met omgevingsnamen:

```json
{
  "exceptionMonitor": {
    "telemetryServiceIds": [],
    "environments": ["production"],
    "exceptionTypes": [],
    "message": "",
    "includeResolved": false,
    "includeArchived": false,
    "lastXSecondsOfExceptions": 300
  }
}
```

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

- **Uitzonderingstypen**: `NullPointerException`
- **Tijdvenster**: 60 seconden
- **Controleer op**: Uitzonderingstelling
- **Filtertype**: Groter dan
- **Waarde**: 0

#### Melding alleen bij productie-uitzonderingen

- **Omgevingen**: `production`
- **Tijdvenster**: 300 seconden
- **Controleer op**: Uitzonderingstelling
- **Filtertype**: Groter dan
- **Waarde**: 5

#### Uitzonderingen bewaken die een specifiek bericht bevatten

- **Bericht**: `out of memory`
- **Tijdvenster**: 300 seconden
- **Controleer op**: Uitzonderingstelling
- **Filtertype**: Groter dan
- **Waarde**: 0

## Installatievereisten

Uitzonderingenmonitoring vereist dat uw applicaties uitzonderingsgegevens via OpenTelemetry naar OneUptime sturen. Zie de [OpenTelemetry](/docs/telemetry/open-telemetry)-documentatie voor installatie-instructies.

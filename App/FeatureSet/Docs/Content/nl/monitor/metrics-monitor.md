# Metrics Monitor

Metrics-monitoring stelt u in staat aangepaste applicatie- en infrastructuurmetrics te bewaken die worden verzameld via OpenTelemetry. OneUptime evalueert metriekwaarden over een tijdvenster en activeert meldingen op basis van uw geconfigureerde criteria.

## Overzicht

Metrics-monitors bevragen en evalueren numerieke metrics van uw telemetriediensten. Hiermee kunt u:

- Aangepaste applicatiemetrics bewaken (verzoeksnelheden, wachtrijdieptes, foutsnelheden, enz.)
- Infrastructuurmetrics bijhouden (CPU, geheugen, schijf, netwerk)
- Complexe metriekopvragen maken met filters en aggregaties
- Meerdere metrics combineren met wiskundige formules
- Meldingen instellen op basis van metriekdrempelwaarden

## Een Metrics Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **Metrics** als het monitortype
4. Configureer metriekopvragen en optionele formules
5. Selecteer de aggregatiestrategie
6. Configureer monitoringcriteria naar wens

## Configuratie-opties

### Metriekopvragen

Definieer een of meer metriekopvragen. Elke opvraag bevat:

| Veld | Beschrijving | Vereist |
|-------|-------------|----------|
| Metrieknaam | De naam van de te bevragen metriek | Ja |
| Aggregatietype | Hoe ruwe metriekwaarden te aggregeren (som, gem, min, max, aantal) | Ja |
| Attributen | Sleutel-waardefilters om de metriekgegevens te verfijnen | Nee |
| Aggregeren op | Dimensies om de metriek op te groeperen | Nee |

Elke opvraag krijgt een alias (bijv. `a`, `b`, `c`) voor gebruik in formules.

### Formules

Combineer meerdere metriekopvragen met wiskundige expressies. Bijvoorbeeld:

- `a / b * 100` — Een percentage berekenen uit twee opvragen
- `a + b` — Twee metrics optellen
- `a - b` — Verschil tussen metrics

### Voortschrijdend tijdvenster

Selecteer het tijdvenster voor metriekverhoogde evaluatie:

- Afgelopen 1 minuut
- Afgelopen 5 minuten
- Afgelopen 10 minuten
- Afgelopen 15 minuten
- Afgelopen 30 minuten
- Afgelopen 60 minuten

### Aggregatiestrategie

Kies hoe de metriekwaarden voor evaluatie worden geaggregeerd:

| Strategie | Beschrijving |
|----------|-------------|
| Gemiddelde | Gemiddelde waarde over het tijdvenster |
| Som | Som van alle waarden |
| Maximumwaarde | Hoogste waarde in het tijdvenster |
| Minimumwaarde | Laagste waarde in het tijdvenster |
| Alle waarden | Alle waarden moeten voldoen aan de criteria |
| Elke waarde | Ten minste één waarde moet voldoen |

## Monitoringcriteria

### Beschikbare controletypen

| Controletype | Beschrijving |
|------------|-------------|
| Metriekwaarde | De geaggregeerde waarde van de geconfigureerde metriekopvraag of formule |

### Filtertypen

- **Groter dan** — Metriekwaarde overschrijdt een drempelwaarde
- **Kleiner dan** — Metriekwaarde is onder een drempelwaarde
- **Groter dan of gelijk aan** — Metriekwaarde is op of boven een drempelwaarde
- **Kleiner dan of gelijk aan** — Metriekwaarde is op of onder een drempelwaarde
- **Gelijk aan** — Metriekwaarde komt exact overeen
- **Niet gelijk aan** — Metriekwaarde komt niet overeen

### Voorbeeldcriteria

#### Melding als foutsnelheid 5% overschrijdt

- **Opvraag a**: `http_requests_total` gefilterd op `status=5xx`
- **Opvraag b**: `http_requests_total`
- **Formule**: `a / b * 100`
- **Controleer op**: Metriekwaarde
- **Filtertype**: Groter dan
- **Waarde**: 5

#### Melding als wachtrijdiepte voor verzoeken hoog is

- **Opvraag**: `request_queue_size`, aggregatie: Maximumwaarde
- **Controleer op**: Metriekwaarde
- **Filtertype**: Groter dan
- **Waarde**: 1000

## Installatievereisten

Metrics-monitoring vereist dat uw applicaties of infrastructuur metrics via OpenTelemetry naar OneUptime sturen. Zie de [OpenTelemetry](/docs/telemetry/open-telemetry)-documentatie voor installatie-instructies.

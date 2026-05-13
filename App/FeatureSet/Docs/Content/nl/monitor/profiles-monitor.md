# Profielen Monitor

Profilenmonitoring stelt u in staat continu profileergegevens van uw applicaties te bewaken en meldingen te activeren op basis van profieltellingen en -patronen. OneUptime evalueert profielgegevens van uw telemetriediensten over een tijdvenster.

## Overzicht

Profielenmonitors tellen en filteren profileergegevens die aan specifieke criteria voldoen. Hiermee kunt u:

- Continu profileergegevens van uw applicaties bewaken
- Profielen filteren op type (CPU, geheugen, goroutines, enz.)
- Profielvolume en -patronen bijhouden
- Meldingen ontvangen bij profileeranomalieën
- Filteren op aangepaste profielattributen

## Een Profielen Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **Profielen** als het monitortype
4. Selecteer de te bewaken telemetriediensten
5. Configureer profielfilters en criteria naar wens

## Configuratie-opties

### Telemetriediensten

Selecteer een of meer diensten waarvan profielen worden bewaakt. Diensten moeten continu profileergegevens via OpenTelemetry naar OneUptime sturen.

### Profielfilters

| Filter | Beschrijving | Vereist |
|--------|-------------|----------|
| Profieltypen | Filteren op namen van profieltypen (bijv. CPU, geheugen, goroutines) | Nee |
| Attributen | Sleutel-waardeparen om te filteren op aangepaste profielattributen | Nee |
| Tijdvenster | Hoe ver terug te zoeken naar profielen (in seconden, standaard: 60) | Nee |

## Monitoringcriteria

### Beschikbare controletypen

| Controletype | Beschrijving |
|------------|-------------|
| Profieltelling | Het aantal profielen dat voldoet aan uw filters in het tijdvenster |

### Filtertypen

- **Groter dan** — Profieltelling overschrijdt een drempelwaarde
- **Kleiner dan** — Profieltelling is onder een drempelwaarde
- **Groter dan of gelijk aan** — Profieltelling is op of boven een drempelwaarde
- **Kleiner dan of gelijk aan** — Profieltelling is op of onder een drempelwaarde
- **Gelijk aan** — Profieltelling komt exact overeen
- **Niet gelijk aan** — Profieltelling komt niet overeen

### Voorbeeldcriteria

#### Melding als er in 5 minuten geen profielen zijn ontvangen

- **Tijdvenster**: 300 seconden
- **Controleer op**: Profieltelling
- **Filtertype**: Gelijk aan
- **Waarde**: 0

## Installatievereisten

Profilenmonitoring vereist dat uw applicaties continu profileergegevens via OpenTelemetry naar OneUptime sturen. Zie de [OpenTelemetry](/docs/telemetry/open-telemetry)-documentatie voor installatie-instructies.

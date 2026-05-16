# Logboeken Monitor

Logboekenmonitoring stelt u in staat uw applicatielogboeken te bewaken en meldingen te activeren op basis van logpatronen, tellingen en ernstniveaus. OneUptime evalueert logboeken van uw telemetriediensten en controleert deze aan de hand van uw geconfigureerde criteria.

## Overzicht

Logboekenmonitors zoeken en tellen logboeken die aan specifieke filters voldoen over een tijdvenster. Hiermee kunt u:

- Meldingen ontvangen bij pieken in foutlogboeken
- Specifieke logpatronen of berichten bewaken
- Logvolume bijhouden op ernstniveau
- Logboeken filteren op dienst, attributen en inhoud
- Applicatieproblemen detecteren op basis van logpatronen

## Een Logboeken Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **Logboeken** als het monitortype
4. Selecteer de te bewaken telemetriediensten
5. Configureer logboekfilters en criteria naar wens

## Configuratie-opties

### Telemetriediensten

Selecteer een of meer diensten waarvan logboeken worden bewaakt. Diensten moeten logboeken via OpenTelemetry naar OneUptime sturen.

### Logboekfilters

| Filter | Beschrijving | Vereist |
|--------|-------------|----------|
| Ernstniveaus | Filteren op logboekernst (ERROR, WARN, INFO, DEBUG, enz.) | Nee |
| Lichaam | Zoek in tekst van het logboekberichtlichaam | Nee |
| Attributen | Sleutel-waardeparen om te filteren op aangepaste logboekattributen | Nee |
| Tijdvenster | Hoe ver terug te zoeken naar logboeken (in seconden, standaard: 60) | Nee |

### Ernstniveaus

Filter logboeken op een of meer ernstniveaus:

- **FATAAL** / **NOODGEVAL** / **KRITIEK**
- **FOUT**
- **WAARSCHUWING**
- **INFO** / **INFORMATIONEEL**
- **DEBUG**
- **TRACE**
- **NIET GESPECIFICEERD**

## Monitoringcriteria

### Beschikbare controletypen

| Controletype | Beschrijving |
|------------|-------------|
| Logboektelling | Het aantal logboeken dat voldoet aan uw filters in het tijdvenster |

### Filtertypen

- **Groter dan** — Logboektelling overschrijdt een drempelwaarde
- **Kleiner dan** — Logboektelling is onder een drempelwaarde
- **Groter dan of gelijk aan** — Logboektelling is op of boven een drempelwaarde
- **Kleiner dan of gelijk aan** — Logboektelling is op of onder een drempelwaarde
- **Gelijk aan** — Logboektelling komt exact overeen
- **Niet gelijk aan** — Logboektelling komt niet overeen

### Voorbeeldcriteria

#### Melding bij meer dan 100 foutlogboeken in 60 seconden

- **Ernstniveaus**: ERROR
- **Tijdvenster**: 60 seconden
- **Controleer op**: Logboektelling
- **Filtertype**: Groter dan
- **Waarde**: 100

#### Melding bij fatale logboeken

- **Ernstniveaus**: FATAL
- **Tijdvenster**: 60 seconden
- **Controleer op**: Logboektelling
- **Filtertype**: Groter dan
- **Waarde**: 0

#### Logboeken bewaken die een specifiek foutbericht bevatten

- **Lichaam**: `database connection timeout`
- **Tijdvenster**: 300 seconden
- **Controleer op**: Logboektelling
- **Filtertype**: Groter dan
- **Waarde**: 5

## Installatievereisten

Logboekenmonitoring vereist dat uw applicaties logboeken via OpenTelemetry naar OneUptime sturen. Zie de [OpenTelemetry](/docs/telemetry/open-telemetry)-documentatie voor installatie-instructies.

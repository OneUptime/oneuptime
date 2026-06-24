# SSL-certificaat Monitor

SSL-certificaatmonitoring stelt u in staat de geldigheid en vervaldatum van SSL/TLS-certificaten op uw websites en diensten te bewaken. OneUptime controleert uw certificaten periodiek en waarschuwt u voordat ze verlopen of als er problemen worden gedetecteerd.

## Overzicht

SSL-certificaatmonitors verbinden met uw HTTPS-eindpunten en inspecteren het SSL/TLS-certificaat. Hiermee kunt u:

- Vervaldatums van certificaten bewaken
- Verlopen of binnenkort vervallende certificaten detecteren
- Zelfondertekende certificaten identificeren
- Geldigheid van certificaten verifiëren
- Dienstuitval door verlopen certificaten voorkomen

## Een SSL-certificaat Monitor aanmaken

1. Ga naar **Monitors** in het OneUptime-dashboard
2. Klik op **Monitor aanmaken**
3. Selecteer **SSL-certificaat** als het monitortype
4. Voer de URL in van het HTTPS-eindpunt om te controleren
5. Configureer monitoringcriteria naar wens

## Configuratie-opties

### URL

Voer de volledige HTTPS-URL in van het eindpunt waarvan u het SSL-certificaat wilt bewaken (bijv. `https://example.com` of `https://example.com:8443`).

## Monitoringcriteria

U kunt criteria configureren om te bepalen wanneer uw certificaatstatus als online, gedegradeerd of offline wordt beschouwd op basis van:

### Beschikbare controletypen

| Controletype                   | Beschrijving                                                       |
| ------------------------------ | ------------------------------------------------------------------ |
| Is online                      | Of de server bereikbaar is                                         |
| Is geldig certificaat          | Of het certificaat geldig is (niet verlopen, niet zelfondertekend) |
| Is zelfondertekend certificaat | Of het certificaat zelfondertekend is                              |
| Is verlopen certificaat        | Of het certificaat verlopen is                                     |
| Is geen geldig certificaat     | Of het certificaat ongeldig is                                     |
| Verloopt over (uren)           | Aantal uren totdat het certificaat verloopt                        |
| Verloopt over (dagen)          | Aantal dagen totdat het certificaat verloopt                       |
| Is verzoek time-out            | Of de verbinding een time-out heeft                                |

### Filtertypen

Voor **Is online**, **Is geldig certificaat**, **Is zelfondertekend certificaat**, **Is verlopen certificaat**, **Is geen geldig certificaat** en **Is verzoek time-out**:

- **True** — Voorwaarde is waar
- **False** — Voorwaarde is onwaar

Voor **Verloopt over (uren)** en **Verloopt over (dagen)**:

- **Groter dan** — Vervaldatum is meer dan de opgegeven waarde verwijderd
- **Kleiner dan** — Vervaldatum is minder dan de opgegeven waarde verwijderd
- **Groter dan of gelijk aan** — Vervaldatum is op of meer dan de opgegeven waarde verwijderd
- **Kleiner dan of gelijk aan** — Vervaldatum is op of minder dan de opgegeven waarde verwijderd
- **Gelijk aan** — Vervaldatum komt exact overeen
- **Niet gelijk aan** — Vervaldatum komt niet overeen

### Voorbeeldcriteria

#### Als gedegradeerd markeren als certificaat binnen 30 dagen verloopt

- **Controleer op**: Verloopt over (dagen)
- **Filtertype**: Kleiner dan
- **Waarde**: 30

#### Als offline markeren als certificaat verlopen is

- **Controleer op**: Is verlopen certificaat
- **Filtertype**: True

#### Melding als certificaat zelfondertekend is

- **Controleer op**: Is zelfondertekend certificaat
- **Filtertype**: True

#### Als offline markeren als certificaat ongeldig is

- **Controleer op**: Is geen geldig certificaat
- **Filtertype**: True

## Best practices

1. **Stel meerdere drempelwaarden in** — Gebruik gedegradeerde status bij 30 dagen en offline bij 7 dagen voor vervaldatum om uzelf tijd te geven voor verlenging
2. **Bewaken alle eindpunten** — Als u meerdere domeinen of subdomeinen heeft, maak dan een monitor aan voor elk
3. **Includeren niet-standaard poorten** — Vergeet diensten niet die HTTPS uitvoeren op niet-standaard poorten
4. **Bewaken na verlenging** — Controleer na het verlengen van een certificaat of de monitor bevestigt dat het geldig is

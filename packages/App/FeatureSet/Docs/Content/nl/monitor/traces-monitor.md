# Traces Monitor

Traces-monitoring stelt u in staat gedistribueerde traces van uw applicaties te bewaken en meldingen te activeren op basis van span-patronen, tellingen en statussen. OneUptime evalueert trace-gegevens van uw telemetriediensten over een tijdvenster.

## Overzicht

Traces-monitors zoeken en tellen spans die aan specifieke filters voldoen. Hiermee kunt u:

- Meldingen ontvangen bij pieken in fout-spans in uw diensten
- Specifieke bewerkingen en eindpunten bewaken
- Span-volume en -patronen bijhouden
- Filteren op span-status, naam en aangepaste attributen
- Prestaties- en betrouwbaarheidsproblemen detecteren op basis van trace-gegevens

## Een Traces Monitor aanmaken

1. Ga naar **Monitoren** in het OneUptime-dashboard
2. Klik op **Monitor maken**
3. Selecteer **Traces** als het monitortype
4. Kies welke spans worden geteld: de spannaam, het tijdvenster en de spanstatussen
5. Open **Meer velden** onder deze filters om ze te beperken tot telemetriediensten, infrastructuurentiteiten of attributen
6. Configureer de criteria naar wens

## Configuratie-opties

### Telemetriediensten

Selecteer onder **Meer velden** een of meer diensten waarvan traces worden bewaakt. Laat het leeg om spans van alle diensten te bewaken. Diensten moeten traces via OpenTelemetry naar OneUptime sturen.

### Span-filters

| Filter         | Beschrijving                                                                  | Vereist |
| -------------- | ----------------------------------------------------------------------------- | ------- |
| Span-statussen | Filteren op span-statuscode (OK, ERROR, UNSET)                                | Nee     |
| Span-naam      | Zoek in tekst naar specifieke span-namen (bijv. bewerkings- of eindpuntnamen) | Nee     |
| Attributen     | Sleutel-waardeparen om te filteren op aangepaste span-attributen              | Nee     |
| Tijdvenster    | Hoe ver terug te zoeken naar spans (in seconden, standaard: 60)               | Nee     |

### Span-statuscodes

- **OK** — De bewerking is expliciet als geslaagd gemarkeerd, door applicatiecode of een trace-pipeline
- **ERROR** — De bewerking heeft een fout ondervonden
- **UNSET** — Er is geen foutstatus ingesteld. Dit is de standaardstatus van OpenTelemetry

UNSET betekent niet dat er gegevens ontbreken. OpenTelemetry-instrumentatie stelt ERROR in wanneer een bewerking mislukt en laat geslaagde spans op UNSET staan, dus bij een gezonde dienst zijn de meeste spans UNSET. OneUptime toont ze in het groen als "Unset (no error)". Het vastleggen van een uitzondering verandert de status van een span niet, dus een UNSET-span kan toch uitzonderingen bevatten; die worden bij de span vermeld. Filter op ERROR om meldingen te ontvangen bij fouten. Selecteer zowel OK als UNSET om alle spans te tellen die niet zijn mislukt.

Als u wilt dat geslaagde verzoeken als OK worden weergegeven, voeg dan onder **Traces > Instellingen > Pipelines** een trace-pipeline toe met de filtervoorwaarde **Status = Niet ingesteld** en een **Status-hertoewijzer** die waarden van `http.response.status_code`, zoals `200`, toewijst aan Ok.

## Monitoringcriteria

### Beschikbare controletypen

| Controletype | Beschrijving                                                   |
| ------------ | -------------------------------------------------------------- |
| Span-telling | Het aantal spans dat voldoet aan uw filters in het tijdvenster |

### Filtertypen

- **Groter dan** — Span-telling overschrijdt een drempelwaarde
- **Kleiner dan** — Span-telling is onder een drempelwaarde
- **Groter dan of gelijk aan** — Span-telling is op of boven een drempelwaarde
- **Kleiner dan of gelijk aan** — Span-telling is op of onder een drempelwaarde
- **Gelijk aan** — Span-telling komt exact overeen

### Voorbeeldcriteria

#### Melding bij meer dan 50 fout-spans in 60 seconden

- **Span-statussen**: ERROR
- **Tijdvenster**: 60 seconden
- **Controleer op**: Span-telling
- **Filtertype**: Groter dan
- **Waarde**: 50

#### Melding bij fouten in een specifiek eindpunt

- **Span-naam**: `POST /api/checkout`
- **Span-statussen**: ERROR
- **Tijdvenster**: 120 seconden
- **Controleer op**: Span-telling
- **Filtertype**: Groter dan
- **Waarde**: 0

## Installatievereisten

Traces-monitoring vereist dat uw applicaties gedistribueerde traces via OpenTelemetry naar OneUptime sturen. Zie de [OpenTelemetry](/docs/telemetry/open-telemetry)-documentatie voor installatie-instructies.

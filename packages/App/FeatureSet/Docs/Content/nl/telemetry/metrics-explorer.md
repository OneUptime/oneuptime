# Metriekverkenner

Metrieken zijn de getallen die uw services en infrastructuur in de loop van de tijd melden: aantallen verzoeken, latenties, CPU, wachtrijdiepte. De metriekverkenner toont elke metriek die uw project ontvangt, zet er elke willekeurige van in een grafiek, combineert ze met formules en maakt van een grafiek een monitor of een dashboardwidget.

:::cards
- [Een metriek vinden](#een-metriek-vinden): De lijst met metrieknamen doorzoeken.
- [Een metriek in een grafiek zetten](#een-metriek-in-een-grafiek-zetten): Een query aggregeren, filteren en groeperen.
- [Query's combineren met een formule](#querys-combineren-met-een-formule): Foutpercentages en andere verhoudingen.
- [Gebruiken wat u in een grafiek zette](#gebruiken-wat-u-in-een-grafiek-zette): Een monitor, een dashboardwidget of een link.
:::

## Hoe de verkenner werkt

De verkenner heeft twee niveaus. Het tabblad **Kijker** toont de metrieken die uw project ontvangt. Klik op een metriek, en de metriekverkenner opent met een query ervoor: een metriek, hoe die geaggregeerd wordt, en hoe die gefilterd en gegroepeerd wordt. Elke query is een variabele, `a`, `b` enzovoort, die een formule kan gebruiken.

```mermaid title="Van metriekquery's naar een grafiek, een monitor of een dashboard"
flowchart TB
    a["Query a: verzoeken,<br/>geaggregeerd met Sum"] --> f["Formule:<br/>$b / $a * 100"]
    b["Query b: fouten,<br/>geaggregeerd met Sum"] --> f
    f --> chart["Grafiek: foutpercentage<br/>in procenten"]
    chart --> monitor["Een metriekmonitor"]
    chart --> dash["Een dashboardwidget"]
```

De verkenner heeft vier tabbladen:

| Tabblad | Waarvoor het dient |
| --- | --- |
| **Kijker** | De lijst met metrieken, elk met een kleine grafiek en de laatste waarde. Opent op het afgelopen uur. |
| **Inzichten** | Welke services metrieken melden, en hoeveel. |
| **Installatiegids** | Hoe u metrieken verstuurt met OpenTelemetry, met een van uw ingestiesleutels. |
| **Instellingen** | **Pipelineregels** en **Opnameregels**: wat er met metrieken gebeurt als ze binnenkomen. |

## Voordat u begint

- **Binnenkomende metrieken.** Stuur ze met [OpenTelemetry](/docs/telemetry/open-telemetry), of vanuit een agent zoals de [OpenTelemetry-collector voor hosts](/docs/telemetry/host-otel-collector) of de [Kubernetes-agent](/docs/telemetry/kubernetes-agent).
- **Een rol die telemetrie mag lezen.** Project Owner, Project Admin, Project Member, Viewer, Telemetry Admin, Telemetry Member of Telemetry Viewer, of een aangepaste rol met de machtiging Read Telemetry Service Metrics. Zie [Telemetrie](/docs/permissions/index#telemetrie) voor welke metrieken die rol leest.

## Een metriek vinden

Ga naar **Producten → Observability → Metrieken**. De **Kijker** toont elke metriek die uw project heeft ontvangen, op naam, elk met een kleine grafiek van het tijdsbereik en de laatste waarde.

- Zoek namen met losse woorden of `name:`, bijvoorbeeld vindt `name:http.server` de metriek `http.server.request.duration`. Zie [Zoeksyntaxis](/docs/telemetry/search-syntax#metrieken).
- Filter in de zijbalk op **Service** om alleen de metrieken van één service te zien.
- Klik op een metriek om die in de metriekverkenner in een grafiek te zetten.

## Een metriek in een grafiek zetten

:::steps
### De metriek openen

Klik op de metriek in de **Kijker**. De verkenner opent met één query, `a`, voor het tijdsbereik en de filters van de lijst.

### Kiezen hoe u aggregeert

Kies onder **Aggregate by** hoe de waarden in elk punt van de grafiek worden gecombineerd: Avg, de standaard, Sum, Min, Max, Count, of een percentiel, P50, P75, P90, P95 of P99. Een percentiel van een histogrammetriek, zoals de duur van een verzoek, wordt berekend uit de buckets.

### Filteren en groeperen

Open **Filters & grouping**. **Filter by attributes** houdt de datapunten waarvan de attributen overeenkomen, zoals één `http.route`, en **Group by** tekent één lijn per waarde van de attributen die u kiest, zoals één lijn per host.

### De grafiek aanpassen

Open **Display Settings** om het **Chart type** te kiezen (lijn, vlak of staaf), een **Warning Threshold** en een **Critical Threshold** in de grafiek te tekenen, of **Convert to per-second rate** aan te zetten.
:::

> [!TIP]
> Een teller die alleen maar stijgt, zoals `system.disk.io`, leest het best als snelheid. Zet **Convert to per-second rate** aan om te tonen hoe snel hij verandert in plaats van zijn lopende totaal; de verkenner stelt dat voor als hij zo'n teller herkent.

Elke query tekent zijn eigen grafiek. Om een query in dezelfde grafiek als de vorige te tekenen, zet u **Overlay with previous query** aan in de **Display Settings** ervan.

## Query's combineren met een formule

:::steps
### De query's toevoegen

Klik op **Metriek toevoegen** voor elke metriek die u nodig hebt. De nieuwe query's heten `b`, `c` enzovoort.

### Een formule toevoegen

Klik op **Formule toevoegen** en schrijf de **Formule** met de variabelen van de query's, de operatoren `+`, `-`, `*`, `/`, `%` en `^`, en haakjes. Voor een foutpercentage schrijft u `$b / $a * 100`.
:::

Een variabele mag met of zonder `$` worden geschreven, in hoofdletters of kleine letters. Een formule die een query noemt die u niet hebt gedefinieerd, meldt dat in plaats van te tekenen.

## Rond een grafiek verkennen

De knoppen boven de grafieken werken met het tijdsbereik dat u bekijkt:

| Knop | Wat hij doet |
| --- | --- |
| **Logboeken** | Opent de [Logboekverkenner](/docs/telemetry/logs-explorer) voor dit tijdsbereik en uw filters. |
| **Traces** | Opent de [Traceverkenner](/docs/telemetry/traces-explorer) voor dit tijdsbereik en uw filters. |
| **Onderzoeken** | Opent een zijpaneel met de logboeken, traces en uitzonderingen van dit tijdsbereik. |
| **Gebeurtenissen** | Markeert de incidenten en waarschuwingen van dit tijdsbereik in de grafieken. |
| **Compare** | Tekent de vorige periode als stippellijn in elke grafiek, zodat u ziet wat er veranderde. |

Sleep over een grafiek om op een moment in te zoomen, en dubbelklik om weer uit te zoomen: zie [Inzoomen op een tijdsbereik](/docs/telemetry/charts-and-time-ranges).

## Gebruiken wat u in een grafiek zette

- **Acties → Monitor maken vanuit deze weergave** opent een nieuwe metriekmonitor waarin deze query's en formules al zijn ingevuld. Zie [Metrics-monitor](/docs/monitor/metrics-monitor).
- **Acties → Add to dashboard** voegt de grafiek toe aan een dashboard naar keuze. U hebt toestemming nodig om dat dashboard te bewerken.
- **Link kopiëren** kopieert een link naar precies deze weergave: query's, formules en tijdsbereik.
- **Saved Views** bewaart de weergave onder een naam voor iedereen in het project. De **Kijker** heeft eigen opgeslagen weergaven, voor zijn zoekopdracht en filters. Opgeslagen weergaven werken zoals in de [Logboekverkenner](/docs/telemetry/logs-explorer#een-weergave-opslaan).

## Inzichten in metrieken

Het tabblad **Inzichten** telt de metrieken in een tijdsbereik: **Actieve metrieken**, **Rapportageservices** en het gemiddelde per service. Het deelt de metrieken in categorieën in en toont de services die ze melden.

## Wat er met metrieken gebeurt als ze binnenkomen

**Metrieken → Instellingen → Pipelineregels** wijzigt metrieken als ze binnenkomen, voordat ze worden opgeslagen. Regels lopen in de volgorde van de lijst, die u wijzigt door te slepen; een regel voor één service loopt vóór de regels voor alle services.

| Regeltype | Wat het doet |
| --- | --- |
| Filter (allowlist) | Houdt alleen de overeenkomende datapunten en gooit de rest weg. |
| Verwijderen | Gooit de overeenkomende datapunten weg. |
| Metriek hernoemen | Geeft de metriek een andere naam. |
| Kenmerk hernoemen | Geeft de sleutel van een attribuut op overeenkomende datapunten een andere naam. |
| Attribuut toevoegen | Voegt een attribuut toe aan overeenkomende datapunten. |
| Kenmerk verwijderen | Haalt een attribuut weg, zoals een met te veel waarden om nuttig te zijn. |
| Kenmerk redigeren | Vervangt de waarde van een attribuut door een plaatshouder. |
| Voorbeeld | Houdt een percentage van de overeenkomende datapunten. |

**Metrieken → Instellingen → Opnameregels** berekent elke minuut nieuwe metrieken uit andere metrieken. Zie [Opnameregels voor logboeken](/docs/telemetry/log-recording-rules) voor hoe opnameregels werken.

## Problemen oplossen

:::details De grafiek van een teller stijgt alleen maar
Het is een cumulatieve teller. Zet **Convert to per-second rate** aan in de **Display Settings** van de query.
:::

:::details De lijst meldt dat er geen metrieken zijn gevonden
Wis eerst uw zoekopdracht en uw filterchips. Is de lijst dan nog leeg, dan heeft nog geen enkele metriek OneUptime bereikt: vergelijk uw configuratie met de **Installatiegids**.
:::

:::details De metrieken van een service ontbreken
Filter de **Kijker** op die **Service** en vergroot het tijdsbereik. Ontbreken ze nog steeds, dan laat het bereik van uw rol die service misschien buiten beschouwing: zie [Telemetrie](/docs/permissions/index#telemetrie).
:::

## Volgende stappen

:::cards
- [Metrics-monitor](/docs/monitor/metrics-monitor): Een melding krijgen als een metriek een drempel overschrijdt.
- [Een dashboard maken](/docs/dashboards/authoring): Uw grafieken naast elkaar zetten.
- [Zoeksyntaxis](/docs/telemetry/search-syntax): Elk filter dat het zoekvak begrijpt.
:::

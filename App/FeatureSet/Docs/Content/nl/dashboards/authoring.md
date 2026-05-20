# Een dashboard maken

Maak een dashboard aan onder **Dashboards → Create Dashboard**, geef het een naam en open het. Het canvas opent in **Edit**-modus, klaar voor widgets.

## Het canvas

Een dashboard is een grid. Het standaard canvas is **12 dashboard-eenheden breed** en **60 eenheden hoog** — je kunt de hoogte vergroten door rijen onder de onderkant toe te voegen. Elke eenheid is een vierkant dat meeschaalt met de viewport: op een desktop is het breder dan op een telefoon, maar elke widget houdt zijn verhoudingen.

Widgets nemen een rechthoek van eenheden in beslag. Jij bepaalt zowel de positie (linkerbovenhoek, gemeten in eenheden vanaf de linkerbovenhoek van het canvas) als de afmetingen (breedte en hoogte in eenheden). Minimumafmetingen zorgen ervoor dat een minuscule widget nog steeds leesbaar is.

## Edit vs. View

De toggle in de paginakop schakelt tussen de twee modi:

- **Edit** — het widget-palet is open, widgets zijn sleepbaar en herschaalbaar, elke widget heeft een instellingen-tandwiel. Gebruik dit tijdens het bouwen.
- **View** — het dashboard rendert alleen-lezen, precies zoals iemand met view-only-toegang (of een publieke bezoeker) het ziet. Gebruik dit om het resultaat te controleren voordat je gaat delen.

Hetzelfde dashboard wordt in beide modi getoond — er is geen aparte "publish"-stap. Een bewerking opslaan heeft direct effect voor elke kijker.

## Een widget toevoegen

1. Open het widget-palet (de **+**-knop in Edit-modus).
2. Kies het widget-type. Zie [Widgets](/docs/dashboards/widgets) voor de catalogus.
3. De widget landt op de eerstvolgende vrije positie op het canvas met een standaardgrootte.
4. Klik op het tandwiel van de widget om zijn instellingenpaneel te openen.
5. Configureer de databron (metric-query, lijstfilter, tekst-body, enz.) en eventuele weergaveopties (drempels, eenheden, assen, kolommen).
6. Sleep de widget om hem te positioneren. Sleep een hoek om hem te herschalen.

Herhaal. Het grid snapt widgets naar hele-eenheid-grenzen.

## Databronnen configureren

De meeste widgets lezen uit één van drie plekken:

- **Metrics** — een ClickHouse-gebaseerde metric-query. De widget bouwt een `metricQueryConfig` (één enkele reeks) of `metricQueryConfigs` (meerdere reeksen gestapeld of overlappend). Optioneel `transformAsRate` zet een cumulatieve OpenTelemetry-counter om in een veranderingsratio. Optioneel `formula` laat je twee queries combineren (bijvoorbeeld error count / total count).
- **Live resource-lijsten** — incidenten, alerts, monitors, Kubernetes-resources, Docker-resources, hosts. Elke lijst-widget neemt een filter (bijvoorbeeld labels, status, namespace) en toont de matchende rijen live.
- **Statische content** — de **Text**-widget neemt een Markdown-body. Gebruik die voor kopteksten, scheidingsstrepen, runbook-links en "wat is dit dashboard?"-annotaties.

Voor metric-widgets weerspiegelt de configuratie de inline querybuilder die je elders in OneUptime ziet — kies een metric, kies een aggregatie, voeg `WHERE`-filters toe, kies een tijdgroepering. De query draait tegen de telemetry-data van je project.

## Drempels en opmaak

Widgets die één enkel getal weergeven (**Value**, **Gauge**) nemen optionele drempels:

- **Waarschuwingsdrempel** — render de waarde in geel wanneer hij deze overschrijdt.
- **Kritieke drempel** — render de waarde in rood wanneer hij deze overschrijdt.

Charts laten je de eenheid van de Y-as, de positie van de legenda en het al dan niet stapelen van reeksen instellen. Tabellen laten je kiezen welke kolommen je toont en de rijlimiet.

## Tijdsbereik en refresh

De dashboard-header draagt twee globale controls die elke metric-widget beïnvloeden:

- **Tijdsbereik** — kies een preset (Afgelopen 1 uur, 24 uur, 7 dagen, 30 dagen) of een aangepast bereik. Elke metric-widget queryt tegen dit venster.
- **Refresh-interval** — Uit, 5s, 10s, 30s, 1m, 5m, 15m. Voert de query van elke widget opnieuw uit op het gekozen ritme. Lijst-widgets die natively websockets ondersteunen werken bij ongeacht het gekozen interval.

Voor widgets die het globale tijdsbereik negeren (bijvoorbeeld een tekstblok) heeft de control geen effect.

## Opslaan

Het canvas slaat automatisch op terwijl je werkt. Een kleine indicator in de header laat je zien wanneer de laatste wijziging is opgeslagen. Er is geen "publish" — elke bewerking is live zodra hij is opgeslagen. Als je een risicovolle wijziging maakt, dupliceer dan eerst het dashboard.

## Patronen die goed werken

- **Eén onderwerp per dashboard.** Weersta de neiging om "alles wat we monitoren" op één pagina te zetten. Drie dashboards gelabeld `oncall-checkout`, `oncall-payments`, `oncall-search` verouderen beter dan één mega-dashboard.
- **Anker de bovenkant van de pagina met de belangrijkste widget.** Mensen scannen vanaf de bovenkant — zorg dat het eerste wat ze zien het antwoord is op "is dit systeem gezond?"
- **Gebruik Text-widgets om secties te labelen.** Een korte koptekst om de paar rijen heen ("Latency" / "Errors" / "Capacity") maakt het dashboard van een afstand scanbaar.
- **Gebruik variabelen in plaats van dupliceren.** Als je merkt dat je hetzelfde dashboard twee keer bouwt voor twee services, dan wil je een `service`-variabele. Zie [Variabelen en filters](/docs/dashboards/variables).

## Waar verder lezen

- [Widgets](/docs/dashboards/widgets) — de catalogus en configuratie per widget.
- [Variabelen en filters](/docs/dashboards/variables) — templaten met variabelen, attribuutfilters en tijdsbereik.
- [Delen en publieke dashboards](/docs/dashboards/sharing) — een dashboard bereikbaar maken buiten het team.
- [Configuratie en machtigingen](/docs/dashboards/configuration) — eigenaarschap en toegangscontrole.

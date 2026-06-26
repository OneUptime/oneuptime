# Een dashboard maken

Om een dashboard te maken, open je **Dashboards → Create Dashboard**, geef je het een naam en open je het. Het canvas opent in **Edit**-modus, klaar voor je om widgets toe te voegen.

## Het canvas

Een dashboard is een grid. Widgets klikken op hun plek — jij bepaalt waar elke staat en hoe groot hij is. Je kunt de pagina naar beneden laten groeien naarmate je rijen toevoegt. Elke widget behoudt zijn verhoudingen op grotere of kleinere schermen.

## Edit en View

De schakelaar in de header wisselt tussen twee modi:

- **Edit** — het widget-palet staat open, je kunt widgets verslepen, vergroten of verkleinen en op elke widget klikken om zijn instellingen te wijzigen.
- **View** — het dashboard is alleen-lezen, precies zoals bezoekers en andere teamleden het zien. Gebruik dit om het resultaat te bekijken voordat je deelt.

Het is in beide modi hetzelfde dashboard. Er is geen aparte "publish"-stap — elke bewerking is live zodra hij is opgeslagen.

## Een widget toevoegen

1. Klik op de **+**-knop om het widget-palet te openen.
2. Kies het widget-type. Zie [Widgets](/docs/dashboards/widgets) voor de catalogus.
3. De widget verschijnt op het canvas.
4. Klik op het tandwielicoon op de widget om zijn instellingen te openen.
5. Kies de databron (een metric, een lijstfilter, een alinea tekst, enz.) en eventuele weergaveopties.
6. Sleep de widget om hem te verplaatsen. Sleep een hoek om hem te vergroten of verkleinen.

## Waar de data vandaan komt

De meeste widgets lezen uit één van drie bronnen:

- **Metrics** — kies een metric en een aggregatie (gemiddelde, max, count, percentiel). Voeg filters toe. Kies hoe je het resultaat groepeert. Dit is dezelfde query-builder die je elders in OneUptime ziet.
- **Live lijsten** — incidenten, alerts, monitors, Kubernetes-pods, Docker-containers, hosts. Elke lijst-widget neemt een filter en toont de overeenkomende items, live bijgewerkt.
- **Statische content** — de **Text**-widget neemt een blok Markdown. Gebruik hem voor koppen, context, links naar runbooks of tijdelijke notities tijdens een incident.

## Drempels en opmaak

Single-value-widgets (**Value**, **Gauge**) laten je instellen:

- Een **warning threshold** — de kleur wordt geel wanneer de waarde deze passeert.
- Een **critical threshold** — de kleur wordt rood wanneer de waarde deze passeert.

Bij charts kun je de Y-as-eenheid instellen, kiezen waar de legenda komt en bepalen of series op elkaar gestapeld of overlapt worden weergegeven. Bij tabellen kun je de kolommen kiezen die je wilt tonen en hoeveel rijen.

## Tijdsbereik en refresh

Bovenaan het dashboard beïnvloeden twee controls elke metric-widget:

- **Tijdsbereik** — een preset (afgelopen uur, 24 uur, 7 dagen, 30 dagen) of een aangepast bereik. Elke chart en elk getal gebruikt dit venster.
- **Refresh** — hoe vaak widgets opnieuw queryen. Uit, 5s, 10s, 30s, 1m, 5m, 15m. Live lijsten updaten zelf, ongeacht deze instelling.

Widgets die het tijdsbereik niet gebruiken (zoals een Text-widget) negeren beide controls.

## Opslaan

Het canvas slaat zelf op terwijl je werkt. Een kleine indicator in de header vertelt je wanneer de laatste wijziging is opgeslagen. Als je een grote wijziging doorvoert, dupliceer dan eerst het dashboard zodat je een veilige kopie hebt.

## Tips voor dashboards die goed verouderen

- **Eén onderwerp per dashboard.** Probeer niet "alles wat we monitoren" op één pagina te zetten. Een paar gerichte dashboards verslaan één enorme pagina.
- **Plaats de belangrijkste widget bovenaan.** Mensen scannen van boven naar beneden — maak het eerste wat ze zien het antwoord op "is dit systeem gezond?"
- **Label secties met Text-widgets.** Een korte kop om de paar rijen ("Latency", "Errors", "Capacity") maakt de pagina van afstand leesbaar.
- **Gebruik variabelen in plaats van te dupliceren.** Als je op het punt staat hetzelfde dashboard te bouwen voor een tweede service, bouw dan één dashboard met een `service`-variabele. Zie [Variabelen en filters](/docs/dashboards/variables).

## Waar verder lezen

- [Widgets](/docs/dashboards/widgets) — de catalogus.
- [Variabelen en filters](/docs/dashboards/variables) — variabelen, filters en het tijdsbereik.
- [Delen en publieke dashboards](/docs/dashboards/sharing) — delen buiten je team.
- [Configuratie en machtigingen](/docs/dashboards/configuration) — eigenaren en toegangscontrole.

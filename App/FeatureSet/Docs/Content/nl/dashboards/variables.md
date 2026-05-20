# Dashboard-variabelen en filters

Een variabele verandert één dashboard in een template. Definieer een `service`-variabele en dezelfde chart rerendert voor `checkout`, `payments` en `search` — kies uit een dropdown bovenaan in plaats van drie bijna identieke dashboards te bouwen.

Deze pagina behandelt de vier variabele-typen, hoe hun waarden in widget-queries worden geïnjecteerd, en de globale tijdsbereik- en refresh-controls die ernaast zitten.

## Variabele-typen

Voeg variabelen toe onder **Dashboard → Settings → Variables**. Elk heeft een naam (waarnaar verwezen wordt als `{{name}}` in widget-queries), een optioneel label en een type.

### Custom List

Een statische dropdown. Jij levert een door komma's gescheiden lijst van waarden; de kijker kiest er één.

Gebruik het wanneer: de set keuzes klein is, vast en alleen voor jouw team betekenisvol. `environment` met waarden `prod, staging, dev`. `region` met waarden `us-east-1, eu-west-1, ap-south-1`.

### Query

De opties voor de dropdown worden tijdens het renderen berekend door een ClickHouse-query.

Gebruik het wanneer: de keuzes dynamisch zijn en in je telemetry leven. "Elke klant-ID die in de afgelopen 24 uur is ingelogd" via `SELECT DISTINCT customer_id FROM ...`. De query draait tegen de data van je project; behandel het resultaat als niet-vertrouwde input ook al is het je eigen data.

### Text Input

Een vrij tekstveld. Wat de kijker ook typt, wordt geïnjecteerd.

Gebruik het wanneer: je wilt dat het dashboard zich gedraagt als een zoektool. Een "filter op IP"- of "filter op request-ID"-dashboard.

### Telemetry Attribute

De opties zijn de distinctieve waarden van een OpenTelemetry-attribuutsleutel over de telemetry van je project, over het tijdsbereik van het dashboard.

Configureer de **attribuutsleutel** (bijvoorbeeld `k8s.cluster.name`, `service.name`, `host.name`). De widget haalt distinctieve waarden op uit logs / metrics / traces en biedt ze aan als dropdown.

Gebruik het wanneer: de keuzes precies de entiteiten zijn waarmee je je telemetry al hebt getagd. Clusternaam, servicenaam, regio, klant-ID, deploy-omgeving — alles wat je al verstuurt als OpenTelemetry-resource of span-attribuut.

Dit is het meest voorkomende variabele-type voor service-gerichte dashboards omdat het zichzelf bijwerkt: wanneer je een nieuwe service verstuurt getagd `service.name = inventory`, verschijnt die waarde in de dropdown zonder dat iemand het dashboard bewerkt.

## Multi-select

Elke variabele kan **multi-select** worden geconfigureerd. Wanneer aan, kiest de kijker één of meer waarden; het dashboard filtert op `value IN (...)` in plaats van `value = ...`.

Gebruik multi-select wanneer: je "checkout + payments samen" wilt bekijken zonder het dashboard te verlaten. Vermijd het wanneer de chart-wiskunde niet optelt over de geselecteerde waarden — bijvoorbeeld: gemiddelden middelen.

## Standaardwaarden

Elke variabele neemt een optionele standaard. Het dashboard rendert met de standaard totdat de kijker de dropdown verandert. Voor publieke dashboards is de standaard wat bezoekers te zien krijgen.

## Hoe interpolatie werkt

Overal waar een widget-query een stringfilter neemt — een `WHERE`-clausule van een metric-query, het filter van een lijst-widget, een attribuutmatch van een log-stream — kun je verwijzen naar `{{variable_name}}`.

Bijvoorbeeld: de metric-query van een Chart zou kunnen zijn:

```
SELECT avg(latency_ms) FROM spans WHERE service.name = '{{service}}'
```

Wanneer `service` op `checkout` staat, draait de query met `service.name = 'checkout'`. Wanneer de kijker overschakelt naar `payments`, draait de query opnieuw met `service.name = 'payments'`.

Voor **Telemetry Attribute**-variabelen specifiek kent OneUptime de attribuutsleutel en injecteert hij het filter in elke widget die hetzelfde attribuut noemt — je hoeft niet handmatig de query van elke widget aan te passen wanneer de variabele verandert. Dit is de magie die service-getemplate-de dashboards out of the box laat werken.

## Tijdsbereik

De dashboard-header heeft een globale **tijdsbereik**-kiezer. Elke metric-widget queryt tegen dit venster. Keuzes:

- **Presets** — Afgelopen 1 uur, 24 uur, 7 dagen, 30 dagen, 90 dagen (afhankelijk van je retentie).
- **Aangepast bereik** — kies start- en eind-timestamps.

Het tijdsbereik maakt deel uit van de URL van het dashboard — de URL delen deelt het venster. Dit is handig tijdens een incident: pin het tijdsbereik op "10:00–10:30 UTC vandaag" en deel de link in het incident-kanaal.

## Refresh-interval

Naast het tijdsbereik kies je hoe vaak widgets opnieuw queryen:

- **Off** — widgets queryen één keer bij het laden.
- **5s / 10s / 30s / 1m / 5m / 15m** — auto-refresh.

Auto-refresh is handig voor een aan de muur gemonteerd scherm en een actueel-incident-view. Voor ad-hoc onderzoek laat je het uit, zodat de weergave stabiel blijft terwijl je scrollt.

## Alles bij elkaar

Een service-getemplate-de dashboard heeft typisch:

1. Een `service`-variabele van het type **Telemetry Attribute** gekoppeld aan `service.name`. Standaard: je meest bekeken service. Multi-select: uit (zodat charts altijd één service tegelijk laten zien).
2. Een `environment`-variabele van het type **Custom List**. Standaard: `prod`.
3. Een `cluster`-variabele van het type **Telemetry Attribute** gekoppeld aan `k8s.cluster.name`. Multi-select: aan (zodat je over clusters heen kunt rollupen).
4. De widgets van het dashboard verwijzen in hun filters naar deze variabelen.

Het resultaat: één dashboard, dekking voor de hele vloot, een paar dropdowns bovenaan.

## Waar verder lezen

- [Widgets](/docs/dashboards/widgets) — hoe elke widget een filter consumeert.
- [Delen en publieke dashboards](/docs/dashboards/sharing) — variabelen in URL's, inclusief hun waarden voor gedeelde links.
- [Een dashboard maken](/docs/dashboards/authoring) — de canvas-mechanica.

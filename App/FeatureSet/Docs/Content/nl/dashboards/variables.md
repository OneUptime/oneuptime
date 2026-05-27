# Variabelen en filters

Een variabele verandert één dashboard in een template. Voeg een `service`-variabele toe aan je dashboard en dezelfde charts rerenderen voor `checkout`, `payments` of `search` — kijkers kiezen uit een dropdown bovenaan in plaats van dat jij drie bijna identieke dashboards bouwt.

## Variabele-types

Voeg variabelen toe onder **Dashboard → Settings → Variables**. Elke variabele heeft een naam (gebruikt als `{{name}}` in je widgets), een optioneel label en een type.

### Custom List

Een statische dropdown. Je typt de opties zelf.

Gebruik dit wanneer: de keuzes klein en vast zijn. `environment` met waarden `prod, staging, dev`. `region` met waarden `us-east-1, eu-west-1, ap-south-1`.

### Query

De opties komen uit een query tegen je data.

Gebruik dit wanneer: de keuzes in de tijd veranderen en je wilt dat de dropdown bijblijft. "Elke klant-ID die in de afgelopen 24 uur is gezien." De query draait tegen de data van je project en de resultaten worden de dropdown.

### Text Input

Een vrij tekstveld. Wat de kijker typt wordt gebruikt.

Gebruik dit wanneer: je wilt dat het dashboard als zoekgereedschap fungeert. Filteren op IP-adres, request-ID of elke andere vrije waarde.

### Telemetry Attribute

De opties zijn de unieke waarden van een attribuut in je telemetry over het tijdsbereik van het dashboard.

Configureer de **attribute key** (bijvoorbeeld `service.name`, `host.name`, `k8s.cluster.name`). De dropdown vult zich met elke unieke waarde die in je logs, metrics en traces is gezien.

Gebruik dit wanneer: de keuzes overeenkomen met de tags die je al met je telemetry meestuurt. Dit is het meest voorkomende type omdat het automatisch bijwerkt — wanneer je een nieuwe service uitbrengt met tag `service.name = inventory`, verschijnt die naam in de dropdown zonder dat je het dashboard hoeft te bewerken.

## Multi-select

Elke variabele kan meerdere selecties toestaan. Wanneer aan, kan de kijker één of meer waarden kiezen; het dashboard filtert dan op elk daarvan.

Gebruik multi-select wanneer: je "checkout en payments samen" wilt vergelijken zonder het dashboard te verlaten. Vermijd het wanneer de berekening niet klopt over geselecteerde waarden heen (bijvoorbeeld gemiddelden middelen).

## Standaardwaarden

Elke variabele kan een standaardwaarde hebben. Het dashboard rendert met de standaard totdat de kijker hem verandert. Voor publieke dashboards is de standaard wat bezoekers als eerste zien.

## Hoe je een variabele in een widget gebruikt

Overal waar een widget een filter accepteert — een metric's `WHERE`, een lijstfilter, een attribuut-match van een log-stream — kun je `{{variable_name}}` gebruiken.

Bijvoorbeeld een chart gefilterd op service:

```
service.name = '{{service}}'
```

Wanneer de dropdown op `checkout` staat, filtert de chart op de checkout-service. Wanneer de kijker naar `payments` overschakelt, rerendert de chart voor payments.

Voor **Telemetry Attribute**-variabelen weet OneUptime welk attribuut de variabele matcht en past het filter toe op elke widget die hetzelfde attribuut gebruikt — je hoeft niet elke widget met de hand te bewerken.

## Tijdsbereik

De header van het dashboard heeft een globaal tijdsbereik. Elke metric-widget querydraait tegen dit venster. Opties:

- **Presets** — afgelopen uur, 24 uur, 7 dagen, 30 dagen, 90 dagen (afhankelijk van je dataretentie).
- **Aangepast** — kies een start- en eindtijd.

Het tijdsbereik is onderdeel van de URL van het dashboard — de URL delen deelt het venster. Handig tijdens een incident: pin het tijdsbereik op "10:00–10:30 UTC vandaag" en plak de link in het incident-kanaal.

## Refresh-interval

Naast het tijdsbereik kies je hoe vaak widgets opnieuw queryen:

- **Uit** — widgets queryen één keer wanneer de pagina laadt.
- **5s / 10s / 30s / 1m / 5m / 15m** — automatisch ververseren.

Auto-refresh is goed voor een muurscherm of een live incident-view. Laat het uit wanneer je aan het onderzoeken bent, zodat de view stil blijft terwijl je kijkt.

## Alles samenbrengen

Een service-getemplated dashboard heeft meestal:

1. Een `service`-variabele van type **Telemetry Attribute** voor `service.name`. Standaard: je meest bekeken service. Multi-select uit (zodat charts altijd één tegelijk tonen).
2. Een `environment`-variabele van type **Custom List**. Standaard: `prod`.
3. Een `cluster`-variabele van type **Telemetry Attribute** voor `k8s.cluster.name`. Multi-select aan (zodat je over clusters heen kunt vergelijken).
4. Widgets die naar deze variabelen verwijzen in hun filters.

Het resultaat: één dashboard, elke service gedekt, drie dropdowns bovenaan.

## Waar verder lezen

- [Widgets](/docs/dashboards/widgets) — hoe elke widget een filter gebruikt.
- [Delen en publieke dashboards](/docs/dashboards/sharing) — variabelen en gedeelde links.
- [Een dashboard maken](/docs/dashboards/authoring) — de canvas-mechanica.

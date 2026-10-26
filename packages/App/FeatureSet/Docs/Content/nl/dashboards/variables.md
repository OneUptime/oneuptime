# Dashboard-variabelen en filters

Een variabele is een kiezer in de werkbalk van het dashboard. Voeg een variabele `service` toe en dezelfde grafieken tonen `checkout`, `payments` of `search`: kijkers kiezen in de werkbalk, in plaats van dat jij drie bijna identieke dashboards bouwt.

:::cards
- [Een variabele toevoegen](#een-variabele-toevoegen): Geef haar een naam, kies waar de waarden vandaan komen, sla op.
- [Bronnen van variabelen](#bronnen-van-variabelen): Telemetry Attribute, Project Labels, Custom List en Text Input.
- [Hoe widgets een variabele gebruiken](#hoe-widgets-een-variabele-gebruiken): Welke widgets welke variabelen volgen.
- [Links die de selectie bewaren](#links-die-de-selectie-bewaren): Stuur een link die op dezelfde service opent.
:::

## Hoe een variabele werkt

Je definieert variabelen terwijl je het dashboard bewerkt, en ze worden ermee opgeslagen. In leesmodus is elke variabele een kiezer in de werkbalk. Als een kijker een waarde kiest, leest elke widget die de variabele volgt zijn gegevens opnieuw, en bewaart de link van de pagina de keuze.

```mermaid title="Van een variabele definiëren tot de keuze van een kijker"
flowchart TB
    A["Bewerken: Variabelen,<br/>dan Variabele<br/>toevoegen"] --> B["Variabelen opslaan,<br/>dan Wijzigingen<br/>opslaan"]
    B --> C["Lezen: een kiezer<br/>in de werkbalk"]
    C --> D["Een kijker kiest<br/>een waarde"]
    D --> E["De widgets die de<br/>variabele volgen,<br/>lezen opnieuw"]
    D --> F["De link van de pagina<br/>bewaart de keuze"]
```

## Een variabele toevoegen

:::steps
### Open het dialoogvenster voor variabelen

Open het dashboard, kies **⋯ → Dashboard bewerken** en klik op **Variabelen** in de werkbalk. Het dialoogvenster **Dashboardvariabelen** toont de variabelen van het dashboard; de knop in de werkbalk telt ze.

### Voeg er een toe

Klik op **Variabele toevoegen**. Een nieuwe variabele leest een telemetrie-attribuut; kies een andere **Bron** als je die nodig hebt.

### Vul haar in

Geef haar een **Naam**, die widgets en links gebruiken, zoals `service`: letters, cijfers en underscores, beginnend met een letter of een underscore, en anders dan de andere namen van het dashboard. Voeg desgewenst een **Label** voor de werkbalk toe, een **Standaard** om mee te beginnen, en vink **Meervoudige selectie toestaan** aan om kijkers meerdere waarden te laten kiezen.

### Sla haar op

Klik op **Variabelen opslaan** en daarna op **Wijzigingen opslaan** in de werkbalk. De kiezer van de variabele verschijnt in de werkbalk zodra het dashboard terug is in leesmodus.
:::

Om een variabele later te wijzigen of te verwijderen, open je het dialoogvenster opnieuw: wijzig haar velden, of klik op de prullenbak ernaast.

## Bronnen van variabelen

De **Bron** bepaalt waar de waarden van een variabele vandaan komen, en welke widgets haar volgen.

| Bron | Waar de waarden vandaan komen | Meervoudige selectie |
| --- | --- | --- |
| Telemetry Attribute | De waarden van één attribuutsleutel in je metrics, zoals `service.name` | Ja |
| Project Labels | De projectlabels die je toestaat, van 1 tot 1.000 | Ja |
| Custom List | Waarden die je typt, gescheiden door komma's, zoals `prod, staging` | Ja |
| Text Input | Wat de kijker ook typt | Nee |

### Telemetry Attribute

Stel de **Attribuutsleutel** in, zoals `service.name`, `host.name` of `k8s.namespace.name`; het veld stelt de sleutels voor die je telemetrie bevat. De kiezer biedt tot 100 waarden van die sleutel, gelezen uit je metrics van de afgelopen dag, zodat een nieuwe service erin verschijnt zonder dat je het dashboard bewerkt.

Dit is de meest gebruikte bron, omdat er geen eigen lijst voor nodig is: de waarden zijn degene die je al verstuurt.

### Project Labels

Kies bestaande projectlabels om als vervolgkeuzelijst op het dashboard aan te bieden. Maak bijvoorbeeld een variabele met de naam `UNIT`, zet de bron op **Projectlabels**, en kies de labels `0660` en `0661`.

Het dashboard slaat de ID's en weergavenamen van de gekozen labels op. Filteren gebruikt de ID's, dus het hernoemen van een projectlabel verbreekt de koppeling niet. Weergavenamen worden met het dashboard opgeslagen; selecteer een hernoemd label opnieuw in de variabele-editor om de weergavenaam bij te werken. Openbare dashboards tonen dezelfde opgeslagen keuzes.

Open in een widget **Monitorlijst** **Filters → Labelvariabele** en selecteer `UNIT`. Als je dan `0660` kiest, zie je de monitors met dat label. Andere widgets worden niet beïnvloed, tenzij ze de variabele uitdrukkelijk ondersteunen en koppelen: de **SLO-lijst** heeft dezelfde instelling **Labelvariabele**.

Vaste widgetfilters blijven gelden. Met een vast label `network` en `UNIT` ingesteld op `0660` moet een monitor bijvoorbeeld beide labels hebben. Meerdere geselecteerde eenheden komen overeen met elk van die eenheden. **Alle** kiezen verwijdert alleen de voorwaarde van de variabele, en behoudt de vaste filters op label, status en monitortype.

Een ontbrekende variabele of een selectie buiten de ingestelde keuzes toont een fout. Een gekozen label zonder overeenkomende monitors toont de lege lijst. Verwijder de koppeling van de widget uitdrukkelijk als die niet meer nodig is.

### Custom List en Text Input

Een Custom List biedt de waarden die je typt, gescheiden door komma's. Een Text Input laat de kijker elke waarde typen, zoals een IP-adres of een verzoek-ID. Geen van beide filtert op zichzelf een widget: hun waarden komen waar je `{{name}}` schrijft (zie hieronder).

Een Query-variabele uit een ouder dashboard blijft behouden en toont een tekstvak in de werkbalk: OneUptime laadt de waarden niet meer uit een query.

## Meervoudige selectie en standaardwaarden

Met **Meervoudige selectie toestaan** aangevinkt kiezen kijkers een of meer waarden, en tonen de widgets elk daarvan. Een lege selectie betekent **Alle**, en een variabele met meervoudige selectie begint altijd op **Alle**, dus haar **Standaard** is grijs.

Een variabele met enkelvoudige selectie begint op haar **Standaard**, of op **Alle** als ze er geen heeft. **Alle** verwijdert het filter van de variabele, zodat de widgets alles tonen.

Gebruik meervoudige selectie om "checkout en payments samen" te vergelijken zonder het dashboard te verlaten. Vermijd haar als de getallen niet optellen over waarden heen, zoals bij een gemiddelde van gemiddelden.

## Hoe widgets een variabele gebruiken

Elke bron bereikt de widgets op zijn eigen manier:

- **Telemetrie-attribuut**-variabelen filteren widgets zonder dat je er iets op hoeft in te stellen: elke metric-grafiek, waarde, meter en tabel; de **Logboekgrafiek**, de **Logstroom**, de **Tracegrafiek** en de **Tracetabel**; en de infrastructuurlijsten waarvan de resources het attribuut hebben, zoals `host.name` op hostlijsten en `k8s.namespace.name` op Kubernetes-lijsten. Een grafiek van een metric zonder het attribuut toont geen gegevens zolang er een waarde is gekozen: kies **Alle** om hem weer te zien. De **Tracelijst** en de incident- en waarschuwingslijsten volgen ze niet.
- **Projectlabels**-variabelen filteren een **Monitorlijst** of een **SLO-lijst** waarvan de **Labelvariabele** ze noemt.
- **Elke variabele** kan in tekst worden geschreven als `{{name}}`: in een [HTML-widget](/docs/dashboards/widgets#html), in de query van een [externe gegevensbron](/docs/dashboards/data-sources), en in de titel van een **Monitorlijst** of een **SLO-lijst**. Een titel zoals `{{UNIT}} NETWORK` toont `0660 NETWORK`, `0660, 0661 NETWORK` of `All NETWORK`. Een titel bepaalt alleen de getoonde tekst; stel **Labelvariabele** in om de monitorquery te filteren.

De [SLO-widget](/docs/dashboards/widgets#slo) kan een Telemetry Attribute-variabele volgen op de sleutel `sloName`, zodat kijkers kiezen welke SLO hij toont.

## Links die de selectie bewaren

De link van de pagina draagt de keuze van elke variabele als `?var-<name>=<value>`, meerdere waarden gescheiden door komma's, dus een link die je kopieert opent met dezelfde selectie, ook een expliciete **Alle**. Een link als deze opent op de service payments:

```text title="A dashboard link with a variable"
https://oneuptime.com/dashboard/<project-id>/dashboards/<dashboard-id>?var-service=payments
```

De link draagt ook het tijdsbereik en het automatisch vernieuwen die je hebt gekozen, als `range` en `refresh`, zodat de mensen naar wie je hem stuurt zien wat jij ziet. [Een link sturen](/docs/dashboards/sharing#een-link-sturen) noemt hun waarden.

## Een voorbeeld: één dashboard voor elke service

Een servicedashboard heeft meestal:

1. Een variabele `service`, bron Telemetry Attribute, attribuutsleutel `service.name`, met je drukste service als standaard. Laat meervoudige selectie uit, zodat de grafieken één service tegelijk tonen.
2. Een variabele `namespace`, bron Telemetry Attribute, attribuutsleutel `k8s.namespace.name`, met meervoudige selectie aan om naamruimten te vergelijken.
3. Een variabele `environment`, bron Custom List, waarden `prod, staging`, gebruikt als `{{environment}}` in een query van een gegevensbron.
4. Widgets die die attributen lezen: grafieken en waarden van de metrics van de service, een logstroom en een lijst met Kubernetes-pods.

Het resultaat: één dashboard voor elke service, met drie kiezers bovenaan.

## Volgende stappen

:::cards
- [Dashboard-widgets](/docs/dashboards/widgets): Welke widgets welke variabelen volgen.
- [Externe gegevensbronnen](/docs/dashboards/data-sources): Zet een variabele in een PromQL- of SQL-query.
- [Delen en publieke dashboards](/docs/dashboards/sharing): Variabelen op een openbaar dashboard.
- [Een dashboard maken](/docs/dashboards/authoring): Bewerkmodus, opslaan en het tijdsbereik.
:::

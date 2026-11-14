# Controles en reconciliaties

Tabelgezondheid zegt of een tabel verandert. Een **controle** zegt of wat ze bevat klopt, een **reconciliatie** zegt of twee kopieën van de gegevens overeenkomen, en de **tests van dbt** rapporteren over de tabellen die dbt bouwt. Elk daarvan draait waar de verzamelronde van de database draait, door OneUptime of door haar sonde, en alleen een getal verlaat de database, tenzij een project ervoor kiest een gemaskeerde steekproef van mislukte rijen te bewaren.

## Controles

Voeg een controle toe op het tabblad **Controles** van een tabel:

| Controle | Wat ze leest |
| --- | --- |
| **Percentage NULL** | Percentage rijen waarvan de kolom leeg is |
| **Percentage duplicaten** | Percentage waarden die de waarde van een andere rij herhalen |
| **Aantal unieke waarden** | Hoeveel verschillende waarden de kolom bevat |
| **Minimum**, **Maximum**, **Gemiddelde**, **Som** | Van een numerieke kolom (een Som over nul rijen is 0) |
| **Percentage ongeldige waarden** | Percentage waarden buiten een lijst die je opgeeft |
| **Percentage afwijkende opmaak** | Percentage waarden die niet in een door jou gekozen formaat staan, zoals Email, UUID of Country Code, of die niet overeenkomen met een reguliere expressie van jou (elke engine behalve SQL Server en Dataverse) |
| **Aantal verweesde rijen** | Rijen waarvan de waarde geen tegenhanger heeft in de kolom van een andere tabel |
| **Aantal rijen** | Rijen in de tabel, het nuttigst met **Segmenteren op** |
| **Aangepaste SQL** | Het getal dat een eigen alleen-lezen SELECT teruggeeft, met de naam `value` (bij MongoDB dat van een aggregatiepijplijn) |
| **Mislukte rijen** | Hoeveel rijen één alleen-lezen SELECT van jou teruggeeft: de rijen die niet zouden moeten bestaan. 0 is gezond (bij MongoDB de documenten waarmee een pipeline eindigt) |

Elke controle draait elke 15 minuten, elk uur, elke 6 uur of elke dag, als één aggregatiestatement in een alleen-lezen transactie met een statement-time-out. Haar waarde wordt geschreven als `oneuptime.data.check.value`, met `oneuptime.data.check.id`, `oneuptime.data.check.name` en `oneuptime.data.check.segment`.

## Voorgestelde controles

**Voorgestelde controles** op hetzelfde tabblad biedt de controles aan waar de kolommen van een tabel om vragen, alleen op basis van hun namen en typen: een id is uniek, een `customer_id` heeft een bijbehorende rij in `customers`, een e-mailadres ziet eruit als een e-mailadres, een bedrag is niet negatief, een status houdt zijn gebruikelijke waarden, en een tabel die per tenant is opgesplitst, wordt per tenant geteld. Een kolom waarvan Gegevensbeveiliging weet dat ze een e-mailadres, telefoonnummer of IP-adres bevat, moet in dat formaat staan, hoe ze ook heet. Voeg er een toe, voeg ze allemaal toe, of wijs er een voorgoed af.

## Een controle vanuit een zin

**Een controle schrijven vanuit een zin** maakt van een regel zoals "bestellingen hebben nooit een negatief totaal" een controle met aangepaste SQL die de rijen telt die de regel breken, in de eigen SQL van je engine, met een waarschuwing zodra er zo'n rij is. Je leest de query voordat **Controle toevoegen** hem toevoegt, en hij moet aan alles voldoen waaraan elke controle met aangepaste SQL moet voldoen. Hiervoor moet OneUptime AI voor het project aan staan. Bij MongoDB is het resultaat een aggregatiepijplijn.

## Segmenten

**Segmenteren op** voert een controle één keer per waarde van een kolom uit, zoals een tenant of een regio: één reeks en één waarschuwing per waarde, voor de 100 grootste segmenten. Een gesegmenteerd aantal rijen waarschuwt wanneer één tenant geen gegevens meer stuurt terwijl de andere gewoon doorgaan.

## Waarschuwingen op een controle

Stel **Waarschuwen wanneer** in om op een controle te waarschuwen:

- **Ongewoon hoog** of **Ongewoon laag** vergelijkt elke waarde met haar eigen geleerde basislijn voor dat uur van de week.
- **Boven** of **Onder** vergelijkt haar met een drempel.

Bij het opslaan van de controle wordt er een metrics-monitor voor gemaakt, op jouw naam en met jouw machtigingen. Als je de voorwaarde wist, wordt de monitor verwijderd.

De **Status** van een controle, op **Controles** en op het tabblad **Controles** van haar tabel, zegt hoe ze ervoor staat: **Mislukt** zolang haar waarschuwing openstaat, **Voldoet** zolang dat niet zo is, en **Kon niet uitvoeren** wanneer haar query mislukte. Een controle zonder waarschuwing toont alleen **Uitgevoerd**: haar query werkte. Een controle die mislukt, en een die niet kon draaien, staat ook op **Overzicht**.

## Wat een controle kost

Een controle concurreert met je applicatie om de database, en op een warehouse dat afrekent op wat een query leest, kost ze geld. Drie dingen houden dat in de hand:

- **Steekproefpercentage** leest een deel van de rijen in plaats van alle, voor een controle die een ratio leest: Percentage NULL, Gemiddelde, Percentage ongeldige waarden en Percentage afwijkende opmaak. De meeste engines slaan hele pagina's van de tabel over; MySQL, Redshift, ClickHouse en MongoDB lezen nog steeds elke rij, en worden het werk op de rest bespaard. Dataverse neemt geen steekproef: een controle daar leest elke rij. Een view kan het weigeren, en de controle meldt dat.
- **Maximaal te lezen door een controle (GB)**, onder **Instellingen**, stopt een controle op BigQuery of Athena voordat ze meer dan zoveel gigabyte leest. Het is 10 totdat je het wijzigt.
- **Wachten wanneer een database druk is**, onder **Instellingen**, laat verschuldigde controles tot de volgende verzamelronde liggen wanneer een PostgreSQL-, MySQL- of SQL Server-database druk lijkt. Het staat aan totdat je het uitzet, en de database meldt wanneer controles hebben gewacht.

## Mislukte rijen

Een getal zegt dat er iets mis is; een paar rijen zeggen wat. **Mislukte rijen bewaren** onder **Instellingen** bewaart maximaal 20 van de rijen die een controle Mislukte rijen, Percentage ongeldige waarden, Percentage afwijkende opmaak of Aantal verweesde rijen vond, en **Mislukte rijen** op de controle toont ze. Deze instelling staat uit tot je ze inschakelt. Gevoelige kolommen worden gemaskeerd op de plek waar de rij wordt gelezen, op basis van wat Gegevensbeveiliging erin vond of van hun namen, dus wat de database of een sonde verlaat, is al gemaskeerd. Een gevoelige kolom die geen scan heeft gevonden en waarvan de naam niets verraadt, wordt bewaard zoals ze is.

De rijen worden opgeslagen in OneUptime: op de servers van OneUptime bij OneUptime Cloud, en op je eigen servers bij een zelf gehoste installatie. Iedereen die de controles van het project mag lezen, kan ze zien. Een controle bewaart alleen de rijen van de laatste uitvoering, en als je **Mislukte rijen bewaren** uitschakelt, wordt verwijderd wat elke controle heeft bewaard.

## Controles in een bestand

Met de hand geschreven controles lopen uit de pas met de code die de tabellen wijzigt. Bewaar ze in je repository, beoordeeld in dezelfde pull request:

```yaml
checks:
  - name: Orders have a total
    table: public.orders
    type: Null Percent
    column: total
    every: 60
    alert: { when: Above, threshold: 1 }
  - name: Emails look right
    table: public.customers
    database: Orders database
    type: Format Mismatch Percent
    column: email
    format: Email
    sample_percent: 10
  - name: Orders have a customer
    table: public.orders
    type: Orphan Count
    column: customer_id
    references: public.customers.id
  - name: No negative totals
    table: public.orders
    type: Failing Rows
    query: SELECT id FROM orders WHERE total < 0
    alert: { when: Above, threshold: 0 }
```

Pas het toe vanuit CI met de [OneUptime CLI](/docs/cli/index) en een API-sleutel:

```bash
oneuptime data-checks apply checks.yaml --dry-run
oneuptime data-checks apply checks.yaml --prune
```

Een controle is dezelfde controle als ze dezelfde naam heeft op dezelfde tabel, dus een bestand twee keer toepassen verandert niets. Een fout ergens in het bestand past niets toe en eindigt met een foutmelding, dus draai `--dry-run` op de pull request en pas toe bij het mergen. Met `--prune` wordt een controle die een eerdere apply maakte en die het bestand niet meer noemt, verwijderd. Een controle die je met de hand hebt toegevoegd nooit. Een controle uit een bestand meldt dat op haar rij, en de volgende apply overschrijft wat met de hand is gewijzigd.

De sleutels zijn `name`, `table`, `database`, `type`, `column`, `segment`, `accepted_values`, `format`, `pattern`, `references`, `query`, `sample_percent`, `every`, `alert`, `description` en `enabled`.

## Reconciliaties

Kopieën lopen uit elkaar: het warehouse heeft minder bestellingen dan de database van de applicatie, of een migratie is rijen kwijtgeraakt. Een reconciliatie vergelijkt één meting van twee tabellen, in één database of in twee, onder **Reconciliaties**:

- **Aantal rijen**
- **Som** van een kolom
- **Aantal unieke waarden** van een kolom
- **Aangepaste SQL**: een alleen-lezen query die één getal teruggeeft, met de naam `value`

Ze heeft een tolerantie: **Absoluut**, een vast bedrag, of **Procent**, een percentage van de waarde van de bron. Elke kant wordt gelezen door een eigen controle, die de reconciliatie aanmaakt en bijhoudt, met de verzamelronde van haar database, zodat een reconciliatie een PostgreSQL-tabel in je netwerk kan vergelijken met haar kopie in Snowflake. De twee waarden worden vergeleken zodra beide binnen 15 minuten van elkaar zijn gelezen. Een reconciliatie schrijft:

- `oneuptime.data.reconciliation.drifted`: 1 wanneer de twee verder uit elkaar zijn gelopen dan de tolerantie, 0 wanneer ze overeenkomen. Haar monitor leest deze waarde.
- `oneuptime.data.reconciliation.difference`: de waarde van het doel min die van de bron.
- `oneuptime.data.reconciliation.difference_percent`: het verschil als percentage van de waarde van de bron.

Een kopie die volgens een planning wordt geladen, loopt achter op haar bron: vergelijk met aangepaste SQL een meting waarover beide al tot rust zijn gekomen, zoals rijen ouder dan een uur, of houd in de tolerantie rekening met de achterstand.

## dbt-tests

Na een dbt-build stuurt `oneuptime dbt upload` de artefacten van het project (zie [Lineage en pipelines](/docs/data-observability/lineage-and-pipelines)). Elke test van een bewaakte tabel verschijnt dan op het tabblad **Controles** ervan, met het laatste resultaat en de rijen die de test als falend vond. Kies **Waarschuwen bij mislukkingen** zodat een falende test een waarschuwing opent.

## Volgende stappen

:::cards
- [Lineage en pipelines](/docs/data-observability/lineage-and-pipelines): Stuur de artefacten van dbt, en zie de uitvoering achter een falende controle.
- [Dataproducten](/docs/data-observability/data-products): Beloof de mensen die de gegevens gebruiken dat ze actueel zijn.
:::

# Controles en reconciliaties

Tabelgezondheid zegt of een tabel verandert. Een **controle** zegt of wat ze bevat klopt, een **reconciliatie** zegt of twee kopieën van de gegevens overeenkomen, en de **tests van dbt** rapporteren over de tabellen die dbt bouwt. Elk daarvan draait waar de verzamelronde van de database draait, door OneUptime of door haar sonde, en alleen een getal verlaat ooit de database.

## Controles

Voeg een controle toe op het tabblad **Controles** van een tabel:

| Controle | Wat ze leest |
| --- | --- |
| **Null Percent** | Percentage rijen waarvan de kolom leeg is |
| **Duplicate Percent** | Percentage waarden die de waarde van een andere rij herhalen |
| **Distinct Count** | Hoeveel verschillende waarden de kolom bevat |
| **Minimum**, **Maximum**, **Gemiddelde**, **Som** | Van een numerieke kolom (een Som over nul rijen is 0) |
| **Invalid Percent** | Percentage waarden buiten een lijst die je opgeeft |
| **Format Mismatch Percent** | Percentage waarden die niet overeenkomen met een reguliere expressie (elke engine behalve SQL Server) |
| **Orphan Count** | Rijen waarvan de waarde geen tegenhanger heeft in de kolom van een andere tabel |
| **Row Count** | Rijen in de tabel, het nuttigst met **Segment By** |
| **Aangepaste SQL** | Het getal dat een eigen alleen-lezen SELECT teruggeeft, met de naam `value` (bij MongoDB dat van een aggregatiepijplijn) |

Elke controle draait elke 15 minuten, elk uur, elke 6 uur of elke dag, als één aggregatiestatement in een alleen-lezen transactie met een statement-time-out. Haar waarde wordt geschreven als `oneuptime.data.check.value`, met `oneuptime.data.check.id`, `oneuptime.data.check.name` en `oneuptime.data.check.segment`.

## Voorgestelde controles

**Suggested Checks** op hetzelfde tabblad biedt de controles aan waar de kolommen van een tabel om vragen, alleen op basis van hun namen en typen: een id is uniek, een `customer_id` heeft een bijbehorende rij in `customers`, een e-mailadres ziet eruit als een e-mailadres, een bedrag is niet negatief, een status houdt zijn gebruikelijke waarden, en een tabel die per tenant is opgesplitst, wordt per tenant geteld. Voeg er een toe, voeg ze allemaal toe, of wijs er een voorgoed af.

## Een controle vanuit een zin

**Een controle schrijven vanuit een zin** maakt van een regel zoals "bestellingen hebben nooit een negatief totaal" een controle met aangepaste SQL die de rijen telt die de regel breken, in de eigen SQL van je engine, met een waarschuwing zodra er zo'n rij is. Je leest de query voordat **Controle toevoegen** hem toevoegt, en hij moet aan alles voldoen waaraan elke controle met aangepaste SQL moet voldoen. Hiervoor moet OneUptime AI voor het project aan staan. Bij MongoDB is het resultaat een aggregatiepijplijn.

## Segmenten

**Segment By** voert een controle één keer per waarde van een kolom uit, zoals een tenant of een regio: één reeks en één waarschuwing per waarde, voor de 100 grootste segmenten. Een gesegmenteerde Row Count waarschuwt wanneer één tenant geen gegevens meer stuurt terwijl de andere gewoon doorgaan.

## Waarschuwingen op een controle

Stel **Alert When** in om op een controle te waarschuwen:

- **Unusually High** of **Unusually Low** vergelijkt elke waarde met haar eigen geleerde basislijn voor dat uur van de week.
- **Boven** of **Onder** vergelijkt haar met een drempel.

Bij het opslaan van de controle wordt er een metrics-monitor voor gemaakt, op jouw naam en met jouw machtigingen. Als je de voorwaarde wist, wordt de monitor verwijderd.

## Reconciliaties

Kopieën lopen uit elkaar: het warehouse heeft minder bestellingen dan de database van de applicatie, of een migratie is rijen kwijtgeraakt. Een reconciliatie vergelijkt één meting van twee tabellen, in één database of in twee, onder **Reconciliaties**:

- **Row Count**
- **Som** van een kolom
- **Distinct Count** van een kolom
- **Aangepaste SQL**: een alleen-lezen query die één getal teruggeeft, met de naam `value`

Ze heeft een tolerantie: **Absoluut**, een vast bedrag, of **Procent**, een percentage van de waarde van de bron. Elke kant wordt gelezen door een eigen controle, die de reconciliatie aanmaakt en bijhoudt, met de verzamelronde van haar database, zodat een reconciliatie een PostgreSQL-tabel in je netwerk kan vergelijken met haar kopie in Snowflake. De twee waarden worden vergeleken zodra beide binnen 15 minuten van elkaar zijn gelezen. Een reconciliatie schrijft:

- `oneuptime.data.reconciliation.drifted`: 1 wanneer de twee verder uit elkaar zijn gelopen dan de tolerantie, 0 wanneer ze overeenkomen. Haar monitor leest deze waarde.
- `oneuptime.data.reconciliation.difference`: de waarde van het doel min die van de bron.
- `oneuptime.data.reconciliation.difference_percent`: het verschil als percentage van de waarde van de bron.

Een kopie die volgens een planning wordt geladen, loopt achter op haar bron: vergelijk met aangepaste SQL een meting waarover beide al tot rust zijn gekomen, zoals rijen ouder dan een uur, of houd in de tolerantie rekening met de achterstand.

## dbt-tests

Na een dbt-build stuurt `oneuptime dbt upload` de artefacten van het project (zie [Lineage en pipelines](/docs/data-observability/lineage-and-pipelines)). Elke test van een bewaakte tabel verschijnt dan op het tabblad **Controles** ervan, met het laatste resultaat en de rijen die de test als falend vond. Kies **Alert on Failures** zodat een falende test een waarschuwing opent.

## Volgende stappen

:::cards
- [Lineage en pipelines](/docs/data-observability/lineage-and-pipelines): Stuur de artefacten van dbt, en zie de uitvoering achter een falende controle.
- [Dataproducten](/docs/data-observability/data-products): Beloof de mensen die de gegevens gebruiken dat ze actueel zijn.
:::

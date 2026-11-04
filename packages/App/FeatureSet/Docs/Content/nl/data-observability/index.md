# Data-observability

Data-observability bewaakt de tabellen waar je bedrijf op vertrouwt, in PostgreSQL, MySQL, SQL Server, Oracle, MongoDB, Redshift, Snowflake, BigQuery, ClickHouse, Databricks en Athena, en vertelt je wanneer hun gegevens te laat, onvolledig, onjuist of kapot zijn, nog voordat de mensen die ze gebruiken het merken. Het leert zelf het ritme van elke tabel, leest de catalogus van elke database zodat er geen waarde uit vertrekt, en koppelt elk gegevensprobleem aan de pipeline-uitvoering, de deploy of de stroomopwaartse tabel die erachter zit.

Het beantwoordt vier vragen:

:::cards
- [Zijn de gegevens actueel?](/docs/data-observability/table-health): De laatste wijziging, rijen, grootte en kolommen van elke tabel, elke vijf minuten gelezen, met waarschuwingen wanneer een tabel te laat is, krimpt of van vorm verandert.
- [Kloppen de gegevens?](/docs/data-observability/checks): Controles op wat een tabel bevat, reconciliaties tussen een tabel en haar kopie, en de tests van dbt, met waarschuwingen wanneer ze falen.
- [Waar komen ze vandaan, en wat voeden ze?](/docs/data-observability/lineage-and-pipelines): Herkomst uit je pipelines, dbt, Fivetran, Airbyte, views en de eigen querygeschiedenis van de databases, zodat één probleem één waarschuwing opent.
- [Kunnen de mensen die ze gebruiken erop vertrouwen?](/docs/data-observability/data-products): Dataproducten met een actualiteits-SLA, op statuspagina's en gevolgd als SLO, met een badge "data as of".
:::

## Hoe het werkt

```mermaid title="Van je databases naar een waarschuwing waar iemand iets mee doet"
flowchart TB
    db["Je databases<br/>en datawarehouses"] --> collect["Catalogus elke vijf minuten gelezen,<br/>door OneUptime of een sonde"]
    pipes["Airflow, dbt, Spark,<br/>Fivetran, Airbyte"] --> runs["Pipeline-uitvoeringen<br/>en herkomst"]
    collect --> health["Tabelgezondheid:<br/>actualiteit, volume, schema"]
    collect --> checks["Controles en<br/>reconciliaties"]
    health --> alerts["Waarschuwingen, met de uitvoering<br/>of deploy erachter"]
    checks --> alerts
    runs --> alerts
    alerts --> oncall["On-call, statuspagina's,<br/>SLO's en OneUptime AI"]
```

1. **Koppel een database** met een alleen-lezen login. Een database die Gegevensbeveiliging al kent, wordt bewaakt zonder dat je iets hoeft te doen, net als elke BigQuery-dataset die je Google Cloud-koppeling heeft gevonden. Een database in een privénetwerk wordt gelezen door een sonde die je daar draait.
2. **Elke vijf minuten** leest OneUptime de catalogus en statistieken van elke database: elke tabel en view, de kolommen, rijen en grootte ervan, en wanneer die voor het laatst is gewijzigd. Geen enkele tabel wordt gescand, en bij MongoDB worden alleen de veldnamen van de nieuwste documenten gelezen. Een pad in een bucket kan op dezelfde manier worden bewaakt.
3. **Het ritme van elke tabel wordt geleerd**: hoe vaak ze gewoonlijk verandert. Een tabel die haar ritme mist, is te laat; een tabel waarvan de rijen dalen of de kolommen veranderen, meldt dat ook.
4. **Aanbevolen waarschuwingen** maken van elk daarvan een monitor die je zelf kiest, en controles die je toevoegt, lezen wat een tabel bevat.
5. **Herkomst** (lineage) zegt welke tabellen welke andere voeden, zodat een waarschuwing op een tabel waarvan de bron eerst kapotging, een gevolg van die bron is: één probleem, geen tien.

## Wat het anders maakt

- **Het hoort bij de rest van OneUptime.** Een gegevenswaarschuwing is een gewone waarschuwing: ze roept de dienstdoende op via on-call, opent incidenten, verschijnt op statuspagina's en telt mee voor SLO's. De services die volgens je traces naar een tabel schrijven, en hun deploys, staan naast elke tabelwaarschuwing.
- **Niets in te stellen per tabel.** Ritmes, planningen en gebruikelijke looptijden worden geleerd uit wat elke tabel en pipeline doet, en een monitor die voor een database wordt aanbevolen, dekt elke tabel erin, ook tabellen die later worden aangemaakt.
- **Eén waarschuwing per oorzaak.** Een waarschuwing waarvan de stroomopwaartse tabel, pipeline of database al een openstaande waarschuwing heeft, sluit zich als gevolg bij die waarschuwing aan, al bevestigd, zodat een mislukt laadproces maar één keer iemand oproept.
- **Elke waarschuwing legt zichzelf uit.** Ze rangschikt de waarschijnlijke oorzaak, zegt wat van de tabel afhangt en wie ze beheert, en leert van wat je erover zegt: markeer er een als **Geen probleem** en hetzelfde blijft de volgende keer stil.
- **OneUptime AI kent je gegevens.** Onderzoeken van gegevenswaarschuwingen beginnen bij de schrijvers, uitvoeringen en stroomopwaartse tabellen van de tabel; via AI vragen, Slack, Microsoft Teams en AI-agents kun je vragen of een tabel actueel is; en een controle kan vanuit een zin worden geschreven. Zie [OneUptime AI en de API](/docs/data-observability/ai-and-api).

## Voordat je begint

- **Een rol die het kan instellen.** De rollen Projecteigenaar, Projectbeheerder en Telemetriebeheerder koppelen databases. Iedereen die data-assets mag bewerken, voegt controles, reconciliaties en dataproducten toe; de rol Kijker leest wat het vond. Zie [Machtigingsreferentie](/docs/permissions/reference).
- **Een alleen-lezen login op elke database.** [Een database koppelen](/docs/data-observability/connect) somt op wat elke engine minimaal nodig heeft. OneUptime stelt de databases voor die je traces, cloudaccounts en Database Monitoring al kennen.

## Snel aan de slag

:::steps
### Koppel een database

Open **Data Observability**, ga naar **Databases** en kies **Een database koppelen**. Kies de engine en geef een alleen-lezen verbindingsreeks op, of de naam van de omgevingsvariabele waaruit je sonde die leest. [Een database koppelen](/docs/data-observability/connect) toont de login van elke engine.

### Bekijk de tabellen

Binnen vijf minuten verschijnen de tabellen onder **Tabellen**, elk met haar rijen, grootte en het moment van de laatste wijziging. De actualiteit van een tabel is bekend zodra ze twee keer is gewijzigd: **Vers** zolang ze haar ritme houdt, **Te laat** zodra ze het mist.

### Voeg de aanbevolen waarschuwingen toe

Kies op **Databases** de optie **Aanbevolen waarschuwingen** voor de database, en voeg de waarschuwingen toe die je wilt: een tabel die te laat is, een tabel waarvan de rijen sterk dalen of ongewoon laag uitvallen, een tabel waarvan de kolommen veranderen, en een database die niet meer rapporteert. Elk is een gewone monitor: on-call, eigenaren, onderhoudsvensters en statuspagina's werken zoals bij elke andere.
:::

## Volgende stappen

:::cards
- [Een database koppelen](/docs/data-observability/connect): De login met minimale rechten per engine, en sondes voor privénetwerken.
- [Gezondheid van tabellen](/docs/data-observability/table-health): Actualiteit, volume, schemawijzigingen, ongebruikte tabellen en de metrieken die elke tabel schrijft.
- [Controles en reconciliaties](/docs/data-observability/checks): Regels voor de waarden van een tabel, een tabel vergelijken met haar kopie, en de tests van dbt.
- [Lineage en pipelines](/docs/data-observability/lineage-and-pipelines): OpenLineage, dbt, Fivetran en Airbyte, en één waarschuwing per oorzaak.
- [Dataproducten](/docs/data-observability/data-products): Actualiteits-SLA's voor de mensen die gegevens gebruiken, op statuspagina's en als SLO's.
- [OneUptime AI en de API](/docs/data-observability/ai-and-api): Onderzoeken, een controle vanuit een zin, actualiteit voor AI-agents, en elk endpoint.
:::

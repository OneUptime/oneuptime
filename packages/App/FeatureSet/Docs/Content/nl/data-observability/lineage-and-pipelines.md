# Lineage en pipelines

Herkomst (lineage) zegt uit welke tabellen elke tabel is opgebouwd, en welke pipelines ernaar schrijven. Data-observability verzamelt die op zes plaatsen tegelijk - OpenLineage-gebeurtenissen, dbt, synchronisaties van Fivetran en Airbyte, jobs in je traces, views, en de eigen querygeschiedenis van elke database - en gebruikt die om elke te late of kapotte tabel te koppelen aan de uitvoering erachter, zodat één probleem één waarschuwing opent.

## Waar de herkomst vandaan komt

| Bron | Wat het geeft |
| --- | --- |
| **OpenLineage** | Elke uitvoering van een Airflow-, Dagster-, Spark-, dbt- of Flink-job, en de tabellen die ze las en schreef |
| **dbt** | Waaruit elk model is opgebouwd, elke build als een uitvoering, en het resultaat van elke test |
| **Fivetran en Airbyte** | Elke synchronisatie als een uitvoering van de connector, en de ruwe tabellen die ze laadt |
| **Jobs in je traces** | Een Kubernetes CronJob of een geplande functie, hun uitvoeringen, en de tabellen die hun databaseaanroepen lazen en schreven |
| **Views** | Een view is opgebouwd uit de tabellen waarop ze is gedefinieerd (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, Snowflake, materialized views van ClickHouse, Databricks, MongoDB) |
| **Querygeschiedenis** | Een query die de ene tabel las en naar een andere schreef (de toegangsgeschiedenis van Snowflake, de jobs van BigQuery, het querylog van Redshift, het querylog van ClickHouse, de lineagetabel van Databricks) |

Het tabblad **Herkomst** van een tabel toont de tabellen waaruit ze is opgebouwd, de pipelines die ernaar schrijven met hun laatste uitvoering, en de tabellen die uit haar zijn opgebouwd. Elke verbinding zegt waar ze is gezien.

Bovenaan het tabblad tekent een diagram die herkomst een paar stappen in elke richting (drie, of kies 1, 2 of 5): links waaruit de tabel is opgebouwd, rechts de tabellen en dashboards die eruit zijn opgebouwd, en de pipelines die gegevens van buitenaf laden, op de plek waar die binnenkomen. Elke kaart zegt hoe het er nu voor staat - te laat, een open waarschuwing, een mislukte uitvoering - en een pijl wordt rood als de laatste uitvoering van zijn pipeline is mislukt, zodat je een te late tabel kunt volgen tot de uitvoering die haar ophield. Open een willekeurige tabel om het diagram erop te centreren.

Een kaart tekent in elke richting hoogstens tien tabellen en telt de rest, zoals **+14**. Selecteer het getal om er ter plekke nog tot tien bij te tekenen, problemen eerst, met elke pijl tussen hen en wat al getekend is. **Diagram opnieuw instellen** gaat terug naar het diagram zoals het eerst werd getekend. Bevat een kant zoveel tabellen als één diagram kan bevatten, open dan een tabel om het diagram erop te centreren.

Waar de bron kolommen noemt, zegt het tabblad **Kolommen** van een tabel waar elke kolom vandaan komt en wat ze voedt: de toegangsgeschiedenis van Snowflake (Enterprise edition, die `IMPORTED PRIVILEGES` op de database `SNOWFLAKE` nodig heeft), en de facet `columnLineage` van OpenLineage.

Kies op het tabblad **Herkomst** een kolom van de tabel in **Een kolom volgen** om te markeren waar ze vandaan komt en waar ze naartoe gaat: omhoog in het diagram naar de kolommen waaruit ze is opgebouwd, omlaag naar de kolommen die uit haar zijn opgebouwd, elk genoemd op haar tabel, ook waar de kolom onderweg een andere naam kreeg. Een pijl waarvan de bronnen geen kolommen noemen, kan haar verder dragen dan gemarkeerd is, en het diagram zegt dat.

Elke weergave van de herkomst - het tabblad **Herkomst** van een tabel, dat van een pipeline, dat van een waarschuwing, de **Herkomstkaart** en wat OneUptime AI en de API vertellen - toont alleen de tabellen en pipelines die uw rol mag lezen. Een rol die beperkt is tot wat de leden ervan bezitten, of tot enkele labels, ziet nooit een andere tabel of pipeline: die wordt niet getekend, op geen enkele pijl genoemd en niet meegeteld bij de tabellen verderop.

## Herkomstkaart

**Data Observability > Herkomstkaart** tekent elke gegevensstroom die uw project heeft gezien op één pagina, zodat u ziet wie welke data gebruikt en waar ze naartoe gaan, zonder eerst een tabel te kiezen. Ze toont:

- **Services** die tabellen schrijven en lezen, uit de databasespans in uw traces: een span die zijn tabel (`db.collection.name`, of het oudere `db.sql.table`) en zijn instructie (`db.operation.name`) noemt, zoals een `INSERT` of een `SELECT`.
- **Tabellen** die uit andere tabellen zijn opgebouwd, uit alle bronnen hierboven.
- **Pipelines** die een tabel laden uit data die OneUptime niet bewaakt, zoals een Fivetran-synchronisatie. Een pipeline die data tussen twee bewaakte tabellen verplaatst, wordt genoemd op de pijl ertussen.
- **Dashboards** en reverse-ETL-synchronisaties in uw BI-tools, die de tabellen lezen waarop ze zijn gebouwd, ook als niets anders die tabellen raakt. Een Power BI-rapport dat op geen enkele door OneUptime bewaakte tabel is gebouwd, wordt getekend met de datasets die het weergeeft en de gegevensbronnen waaruit ze laden; als geen van de dashboards van een BI-tool op een bewaakte tabel staat, zegt de kaart waarom ([Herkomst in Power BI](#herkomst-in-power-bi)).

Elke pijl is iets wat OneUptime heeft vastgelegd, nooit een gok. Kaarten staan van links naar rechts in de richting waarin data stromen en tonen hun toestand zoals op het diagram van een tabel: rood voor een late tabel, een openstaande melding of een mislukte uitvoering. Een pijl is turkoois waar de traces van een service hem hebben gezien.

Zoek naar een tabel, service, pipeline of dashboard om te behouden wat overeenkomt en alles stroomopwaarts en stroomafwaarts ervan. Selecteer een kaart om haar hele herkomst te markeren, te zien waar ze vandaan komt en waar ze naartoe gaat, en haar pagina te openen; **Alleen de herkomst ervan tonen** laat alleen dat op de kaart staan. Met de schakelaars naast de zoekbalk laat u services, pipelines of dashboards weg. **Lijst** toont elke pijl als een regel en is wat een telefoon opent.

Eén kaart tekent maximaal 400 kaarten, de meest recent geziene stromen eerst; heeft uw project er meer, dan zegt de kaart dat. Dezelfde kaart wordt geleverd door `POST /api/data-observability/lineage/map`, voor iedereen die data-assets mag lezen, en hun API-sleutels. Een kaart met meer vertelt hoeveel tabellen ze heeft weggelaten, elk één keer geteld, en kan ergens anders beginnen: kies een database om de stromen van haar tabellen en de kaarten die ze verbinden in kaart te brengen, of typ een naam en kies **Hele project doorzoeken** om de stromen van elke tabel, pipeline, service en elk dashboard met die naam in kaart te brengen, hoe oud ze ook zijn. **Hele kaart tonen** gaat terug. Laat de kaart van de API ergens anders beginnen door `{ "dataStoreId": "<database ID>" }` of `{ "search": "orders" }` te sturen.

## OpenLineage

Stuur OpenLineage-gebeurtenissen ongewijzigd naar OneUptime, met een [ingestiesleutel](/docs/telemetry/ingestion-keys) voor telemetrie:

- **URL:** `https://oneuptime.com/telemetry/openlineage` (bij een zelfgehoste OneUptime je eigen adres)
- **Endpoint:** `api/v1/lineage`, de standaard van OpenLineage
- **API-sleutel:** de ingestiesleutel, verstuurd als `Authorization: Bearer`, of stel `x-oneuptime-token` in

Voor de OpenLineage-provider van Airflow:

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

Stel voor elke andere OpenLineage-client `OPENLINEAGE_URL` en `OPENLINEAGE_API_KEY` in. Datasets worden aan tabellen gekoppeld volgens de naamgevingsspecificatie van OpenLineage, zoals `postgres://host:5432` met `database.schema.table`, `snowflake://account` met `database.schema.table`, `clickhouse://host:8443` met `database.table`, en `databricks://workspace-host` met `catalog.schema.table`.

## dbt

Stuur na `dbt build` (of run, test, seed of snapshot) de artefacten van het project met de [OneUptime-CLI](/docs/cli/index):

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

Voer in CI `oneuptime dbt upload` uit als de stap na de build, ook als de build mislukt, zodat mislukte tests worden vastgelegd. Elke tabel die dbt bouwt, krijgt een kaart **dbt** op haar Overzicht, de herkomst van haar modellen, en haar tests op het tabblad **Controles**; elke build is een uitvoering van de pipeline van het project.

## Fivetran en Airbyte

Hun webhooks zeggen wanneer elke synchronisatie begint en eindigt. **Pipelines > Fivetran of Airbyte koppelen** vult de URL's in met een van je ingestiesleutels:

- **Fivetran:** een webhook die met de REST API van Fivetran is aangemaakt, voor de gebeurtenissen `sync_start` en `sync_end`, naar `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`, met de ingestiesleutel als geheim. Fivetran ondertekent elke levering ermee, zodat de sleutel nooit in de URL meereist.
- **Airbyte:** de webhook van de werkruimte, ingesteld op `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`, aan voor mislukte en geslaagde synchronisaties. Geef Airbyte een eigen sleutel.

Een Fivetran-synchronisatie die bij de rate limit van een API opnieuw wordt gepland, eindigt als **Opnieuw gepland**: geen fout, dus ze roept niemand op.

## Jobs in je traces

Veel pipelines zijn een Kubernetes CronJob, of een functie op een timer, zonder scheduler die herkomst stuurt. Hun traces zeggen het toch, zonder dat je iets hoeft te installeren. Elke vijftien minuten worden spans met het resourcekenmerk `k8s.cronjob.name` of `k8s.job.name`, of `faas.name` met een `faas.trigger` van `timer` of `datasource`, een pipeline onder **Pipelines**:

- Een uitvoering van een CronJob is haar Kubernetes Job, en een uitvoering van een functie is haar `faas.invocation_id`.
- Een uitvoering is mislukt wanneer de span bovenaan haar trace dat was. Een aanroep die mislukte en daarbinnen opnieuw werd geprobeerd, laat haar niet mislukken.
- De tabellen die ze schreef en las komen uit haar databasespans.

Elke uitvoering verwijst naar haar trace, met haar logboeken. Dezelfde drie monitoren gelden, dus een CronJob die stopt met draaien, wordt gezien als te laat.

## Dashboards in BI-tools

De echte impact van slechte gegevens is het dashboard dat iemand opent. Voeg onder **BI-dashboards** je BI-tools toe met inloggegevens die hun dashboards mogen lezen. Elk uur leest Data-observability elk dashboard en de tabellen erachter, koppelt elke tabel aan een bewaakte tabel en toont de dashboards die op een tabel, en op de tabellen die eruit worden gebouwd, zijn gebouwd op het tabblad **Herkomst**, bij de waarschuwingen en in Production Review.

| Tool | Inloggegevens |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, een service principal die de alleen-lezen beheer-API's van Power BI mag gebruiken, met de twee tenantinstellingen voor metadata uit [Herkomst in Power BI](#herkomst-in-power-bi) aangezet voor de tabellen achter elk rapport. Zowel rapporten als dashboards worden gelezen, met hun weergaven en vernieuwingen (hieronder) |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (of `eu`) |

Hightouch en Census zijn reverse-ETL-tools: een synchronisatie die een tabel naar een CRM kopieert, hangt van die tabel af zoals een dashboard dat doet, dus ze wordt op dezelfde manier gelezen en genoemd bij de waarschuwingen van de tabel.

Alleen de namen en links van dashboards, de tabellen die ze opvragen en, voor Power BI, wie ze opent en hoe hun vernieuwingen verliepen, worden gelezen: nooit hun gegevens.

### Weergaven en vernieuwingen in Power BI

Voor elk Power BI-rapport en -dashboard toont **BI-dashboards** eerst hoe vaak het in de afgelopen 28 dagen is geopend, wanneer het voor het laatst is geopend en hoe de laatste vernieuwing van de gegevens verliep, met de fout van een mislukte vernieuwing. Hoeveel mensen het openden, wie het het vaakst opende en de laatste vernieuwingen zijn kolommen die u kunt inschakelen. Het tabblad **Herkomst** van een tabel zegt hetzelfde van elk dashboard dat erop is gebouwd, met de eigenaar en de kijkers onder **Meer**.

- **Weergaven** komen uit het activiteitenlogboek van Power BI, gelezen via de beheer-API voor activiteitsgebeurtenissen. Power BI bewaart er 28 dagen van, beantwoordt 200 aanvragen per uur en splitst elke aanvraag in uren, dus OneUptime leest het per uur: elke uurlijkse lezing voegt de uren sinds de vorige toe en gaat dan terug door de 28 dagen, de nieuwste eerst, met hoogstens 100 aanvragen. Een nieuwe Power BI-tool toont meteen de laatste dagen, en alle 28 dagen binnen een dag; tot dan zeggen de weergaven sinds wanneer ze worden geteld. Een gebeurtenis kan tot een uur nodig hebben om in het logboek te komen, dus weergaven lopen tot twee uur achter. Kijkers worden genoemd zoals Power BI ze noemt: met hun e-mailadres.
- **Vernieuwingen** van datasets op een capaciteit (Premium, Premium per gebruiker of Fabric) komen uit de beheerlijst van vernieuwbare items van Power BI: de laatste vernieuwing van elke dataset met de fout, en hoeveel vernieuwingen er liepen en mislukten in de zeven dagen die Power BI bewaart.
- **Vernieuwingen van datasets op gedeelde capaciteit** staan niet in die lijst. Power BI toont de vernieuwingsgeschiedenis van een dataset alleen aan wie de dataset mag wijzigen, dus voeg de service principal toe aan de werkruimte als **Inzender**, **Lid** of **Beheerder** en zet **Service principals can call Fabric public APIs** ervoor aan in de ontwikkelaarsinstellingen van de Fabric-beheerportal. OneUptime leest dan elke vernieuwing, met de fout. Tot dan zegt de BI-tool van hoeveel datasets het de vernieuwingen niet kon lezen.
- Een Power BI-dashboard waarvan de tegels uit meerdere datasets komen, toont de laatste mislukte vernieuwing, of de oudste als er geen mislukte: de gegevens zijn maar zo vers als die.

Weergaven, en vernieuwingen op capaciteiten, hebben niets nodig buiten de beheer-API-toegang hierboven: de service principal in een beveiligingsgroep die **Service principals can access read-only admin APIs** toestaat, zonder Power BI-machtigingen op de app die toestemming van een beheerder vereisen. Als weergaven of vernieuwingen niet gelezen kunnen worden, worden de dashboards toch gelezen en bewaard, zegt de BI-tool wat is overgeslagen en waarom, en probeert de volgende lezing het opnieuw.

### Waarschuwingen bij mislukte vernieuwingen

Zet **Alert on Failed Refreshes** aan wanneer je een Power BI-tool toevoegt of bewerkt (een nieuwe begint met deze optie aan), en OneUptime houdt voor de tool één monitor bij onder **Monitoren**, genoemd naar de tool. De monitor opent een waarschuwing voor elke dataset waarvan de laatste vernieuwing is mislukt of geannuleerd, met de dataset en de werkruimte in de titel van de waarschuwing, en lost die op zodra een latere vernieuwing is voltooid. Een dataset die later wordt gepubliceerd, wordt bewaakt zodra die gelezen is. Zet je de schakelaar uit of verwijder je de tool, dan wordt de monitor verwijderd; tot dan is het een gewone monitor, met zijn eigenaren, on-callbeleid en onderhoudsvensters.

Mislukte vernieuwingen gebruiken de pipelinemonitoren niet. Een dataset waarvan de vernieuwing is mislukt, blijft de gegevens van zijn laatste voltooide vernieuwing tonen tot een latere is voltooid, dus de waarschuwing blijft tot dan open, terwijl de waarschuwing van een mislukte uitvoering een uur na de uitvoering verdwijnt. En vernieuwingen worden eens per uur gelezen: een vernieuwing die tot een uur na het einde wordt gelezen, zou vaak buiten het uur vallen waar **Pipeline Run Failed** naar kijkt, een dataset die elk halfuur wordt vernieuwd, zou steeds **Pipeline Is Late** worden, en een vernieuwing die klaar is maar nog niet gelezen, zou eruitzien als **Pipeline Run Unusually Long**.

- Elke lezing per uur bewaart de datasets waarvan de laatste afgeronde vernieuwing is mislukt of geannuleerd. Elke vijf minuten schrijft elk daarvan `oneuptime.data.bi.refresh_failed`, 1 zolang die faalt en 0 in het uur nadat een latere vernieuwing is voltooid, en de monitor leest die, zodat één fout één waarschuwing opent, hoeveel lezingen per uur hem ook zien.
- Een fout wordt gezien bij de volgende lezing per uur: de waarschuwing gaat open tot een uur nadat de vernieuwing mislukte, en wordt opgelost tot een uur nadat een latere vernieuwing is voltooid.
- Een vernieuwing die nog loopt, verandert niets: de waarschuwing van een dataset waarvan de vernieuwing is mislukt, blijft open terwijl de volgende vernieuwing loopt, en wordt pas opgelost zodra een vernieuwing is voltooid.
- Op een capaciteit geeft de lijst van vernieuwbare items van Power BI alleen de laatste vernieuwing van elke dataset, dus een vernieuwing die mislukte en binnen hetzelfde uur werd gevolgd door een voltooide, wordt nooit gezien: dan zijn de gegevens alweer vers.
- Datasets op gedeelde capaciteit geven alleen waarschuwingen waar hun vernieuwingen gelezen kunnen worden (hierboven), en een dataset waarvan de vernieuwingen niet gelezen konden worden, houdt zijn waarschuwing zoals die was tot dat wel kan.

## Pipelines

Elke job, elk dbt-project en elke synchronisatie verschijnt onder **Pipelines**, met de uitvoeringen: wanneer elke uitvoering begon en eindigde, hoe lang ze duurde, welke poging het was waar de scheduler dat zegt (het try-nummer van Airflow), en de fout van een mislukte uitvoering. Na vijf uitvoeringen leert elke pipeline uit zijn eigen uitvoeringen hoe lang een uitvoering gewoonlijk duurt en hoeveel tijd er volgens zijn planning tussen twee uitvoeringen zit. De pagina van een pipeline beveelt vier monitoren aan:

- **Pipeline Run Failed**: een uitvoering is mislukt of afgebroken.
- **Pipeline Run Unusually Long**: een uitvoering heeft twee keer haar gebruikelijke tijd of langer geduurd, elke vijf minuten gecontroleerd zolang ze loopt, zodat een uitvoering die vastloopt al wordt opgemerkt voordat ze eindigt.
- **Pipeline Is Late**: er is langer geen uitvoering gestart dan de planning toestaat.
- **Pipeline Stopped by Circuit Breaker**: de circuit breaker antwoordde stop, en de stop duurt tot hij go antwoordt of een uitvoering start.

Het tabblad **Eigenaren** van een pipeline noemt de mensen en teams die ervoor zorgen, en de waarschuwingen ervan gaan naar hen. Het **Overzicht** en **Problemen** noemen de eigenaren van een mislukte of late pipeline, of tonen **Geen eigenaar**, met een manier om er een toe te voegen.

**Eigenaarsregels** kunnen de eigenaren van een pipeline voor je benoemen. Op hun tabblad **Pipelineregels** koppelt een regel een pipeline via een reguliere expressie aan zijn naam, zoals `orders_daily.load_orders`, of aan zijn naamruimte, waar hij draait, zoals `airflow://prod`, en voegt zijn mensen en teams toe als eigenaren van de pipeline wanneer OneUptime de pipeline voor het eerst ziet. Om ze toe te voegen aan de pipelines die je al hebt, open je de regel en kies je **Nu uitvoeren**.

De pagina van een pipeline tekent zijn **Herkomst**, de eerste plek om te kijken als een uitvoering mislukt of te laat is: links de tabellen die hij leest, rechts de tabellen die hij schrijft, de pipeline ertussen, en elke kaart zegt hoe het er nu voor staat. Kies meer stappen om te zien waaruit die tabellen zijn opgebouwd en wat eruit is opgebouwd, en open een willekeurige tabel om haar eigen tabblad **Herkomst** te zien. Een aantal niet-getekende tabellen, op de kaart van de pipeline of van een tabel, tekent er ook hier ter plekke meer bij. Kies een van de kolommen die ze schrijft om die over de pipeline heen te volgen: omhoog naar de kolom van elke gelezen tabel waaruit die is gebouwd, en omlaag naar elke tabel waarin ze die schrijft.

## Circuit breakers

Een mislukte controle of een te late tabel waarschuwt de eigenaren, maar de pipelines die de tabel lezen zouden toch draaien en de foute data stroomafwaarts kopiëren. Een circuit breaker houdt ze eerst tegen: de eerste stap van de pipeline vraagt OneUptime of de tabellen die hij leest in orde zijn, en de rest draait alleen wanneer het antwoord go is.

- Een mislukte controle van een tabel die de pipeline leest, stopt hem altijd: een controle waarvan de waarschuwing openstaat, of een mislukte dbt-test.
- Een te late tabel stopt hem ook zodra **Stoppen wanneer een tabel die hij leest te laat is** aanstaat, op de pagina **Circuit breaker** van de pipeline. Het staat voor elke pipeline uit, want een te late tabel kan ook gewoon een rustige dag betekenen.
- Een controle die niet kon draaien of nog niet heeft gedraaid, en een tabel zonder controles, stoppen niets.

De stap vraagt met een project-API-sleutel die Data Observability mag lezen, en noemt de pipeline als `namespace/name`, met alleen zijn naam of met zijn ID. De circuit breaker leest de tabellen die de pipeline leest uit zijn herkomst. Een verzoek kan ook `tables` noemen, of alleen die, elk als `schema.table`, met alleen zijn naam of met zijn ID; een naam die bij geen tabel past, komt terug in `notFound` en telt nooit als een tabel die slaagde. Alleen de tabellen die de API-sleutel mag lezen, worden beoordeeld.

```bash
curl -sSf https://oneuptime.com/api/data-observability/circuit-breaker \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pipeline": "airflow://prod/orders_daily.load_orders", "failWithStatusCode": true}'
```

Het `verdict` van het antwoord is `go` of `stop`. `reasons` noemt elke mislukte controle met haar tabel, en elke te late tabel met hoe laat hij is; `tables` noemt elke beoordeelde tabel; en `answer` zegt hetzelfde in een paar zinnen, voor het log van de stap. Met `failWithStatusCode` antwoordt een stop met HTTP 412, zodat `curl -f` de stap laat mislukken. Stuur `stopsOnLateTables` als `true` of `false` om voor één verzoek te beslissen, en `dryRun` als `true` om te vragen zonder dat het antwoord wordt bewaard.

Zet in Airflow een `ShortCircuitOperator` vóór de taken die de tabellen lezen: wanneer zijn functie false teruggeeft, wordt elke taak erna overgeslagen.

```python title="orders_daily.py"
import os

import requests
from airflow.operators.python import ShortCircuitOperator


def inputs_are_healthy() -> bool:
    response = requests.post(
        "https://oneuptime.com/api/data-observability/circuit-breaker",
        headers={"ApiKey": os.environ["ONEUPTIME_API_KEY"]},
        json={"pipeline": "airflow://prod/orders_daily.load_orders"},
        timeout=30,
    )
    response.raise_for_status()
    answer = response.json()
    print(answer["answer"])
    return answer["verdict"] == "go"


check_inputs = ShortCircuitOperator(
    task_id="check_inputs",
    python_callable=inputs_are_healthy,
)

check_inputs >> load_orders
```

De `on-run-start`-hooks van dbt voeren SQL uit in je warehouse, geen webverzoeken, dus vraag het in de stap die dbt start: een CI-job, een cronregel of de taak die het uitvoert. De pipeline van een dbt-project heet `dbt/` gevolgd door de naam van het project.

```bash
curl -sSf https://oneuptime.com/api/data-observability/circuit-breaker \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pipeline": "dbt/analytics", "failWithStatusCode": true}' \
  && dbt build
```

Een verzoek dat een pipeline noemt, wordt bij die pipeline bewaard, tenzij het een proefrun is. Zolang de circuit breaker een pipeline heeft gestopt, zegt zijn pagina **Circuit breaker** sinds wanneer en waarom, opent zijn **Overzicht** met de stop, en noemen **Aandacht nodig** en **Problemen** hem gestopt, in plaats van zijn mislukte of te late run. De stop eindigt wanneer de circuit breaker de volgende keer go antwoordt, of wanneer er een run na de stop begint. Dezelfde pagina heeft **Nu testen**, dat de circuit breaker vraagt zonder dat het antwoord wordt bewaard, en de stap voor curl, Airflow en dbt met de naam van de pipeline al ingevuld.

Om van een stop te horen, voegt u **Pipeline Stopped by Circuit Breaker** toe vanuit de **Aanbevelingen** van de pipeline. De waarschuwing ervan opent wanneer de circuit breaker stop antwoordt, gaat naar de eigenaren van de pipeline, blijft open zolang de stop bewaard wordt en wordt opgelost zodra de stop eindigt. Hij leest de metriek `oneuptime.data.pipeline.circuit_breaker_stopped` van de pipeline: 1 zolang de circuit breaker hem heeft gestopt en 0 zodra niet meer, geschreven wanneer de circuit breaker antwoordt en daarna elke vijf minuten.

Zolang Data Observability op de server uitgeschakeld is, antwoordt de circuit breaker go en bewaart hij niets: een product uitschakelen stopt nooit een pipeline.

## Eén waarschuwing per oorzaak

Wanneer een tabel verouderd raakt, raakt elke tabel die eruit is opgebouwd ook verouderd. Voordat een gegevenswaarschuwing opent, zoekt OneUptime in de herkomst naar een waarschuwing die al openstaat op datgene waaruit haar tabel of pipeline is opgebouwd: de tabellen stroomopwaarts, de pipelines die ernaar schrijven, en de databases waarin ze staan, tot vijf stappen omhoog. Vindt het er een, dan is de nieuwe waarschuwing een gevolg van die waarschuwing:

- Ze begint als **bevestigd**, zodat niemand twee keer wordt opgeroepen voor één probleem, en herstelt vanzelf zodra haar gegevens herstellen.
- Haar feed en haar kaart **Gegevens** zeggen welke waarschuwing haar veroorzaakte, en ze sluit zich aan bij de episode van de oorzaak.

De kaart **Gegevens** van de oorzaak toont haar **Impact stroomafwaarts**: elke waarschuwing die ze veroorzaakte. De kaart van een tabelwaarschuwing toont ook de services die naar de tabel schrijven, met hun mislukte schrijfacties, en hun deploys en andere wijzigingen in de dag vóór de waarschuwing.

Onder de kaart **Gegevens** tekent de pagina van een waarschuwing haar **Herkomst**: rond haar tabel, zoals het tabblad **Herkomst** van de tabel die tekent, of rond haar pipeline. De weg omhoog naar de waarschuwing die haar veroorzaakte en omlaag naar elke waarschuwing die ze veroorzaakte, is gemarkeerd - de tabel of pipeline van de oorzaak met **Oorzaak**, die van elke veroorzaakte waarschuwing met **Gevolg** - en de rest vervaagt, zodat wie haar opent ziet waar in de keten het probleem begon. Ligt de oorzaak bij een pipeline die op een pijl is getekend, dan staat op die pijl **Oorzaak** onder de naam van de pipeline. Gaat de oorzaak over een hele database, of ligt ze verder omhoog dan het diagram reikt, dan zegt de kaart dat in woorden. Een waarschuwing uit een controle op één kolom, zoals een controle Percentage NULL op `customer_id`, opent met die kolom gevolgd naast deze wegen, zoals op het tabblad **Herkomst** van de tabel: waar ze vandaan komt en waar ze naartoe gaat, genoemd op elke tabel. Kies daar een andere kolom van de tabel, of wis haar om alleen de wegen te zien. **Herkomst verkennen** opent het tabblad **Herkomst** van de tabel, of de pagina van de pipeline. Een veroorzaakte waarschuwing bij een pipeline die op een pijl is getekend, zegt daar op dezelfde manier **Gevolg**, en de kolomkiezer biedt eerst de kolom van de controle aan, daarna de andere kolommen van de tabel in haar eigen volgorde.

Wie de waarschuwing die haar veroorzaakte niet mag zien, krijgt geen kaart **Gegevens** en geen herkomst, en een veroorzaakte waarschuwing die diegene niet mag zien, wordt niet gemarkeerd en niet meegeteld.

## Herkomst in Power BI

**Gekoppelde tabellen** zegt bij elke BI-tool op hoeveel bewaakte tabellen de dashboards ervan zijn gebouwd, en daaronder het eerste wat de rest tegenhoudt om gekoppeld te worden. **See Why** somt op wat de laatste lezing vond en wat u kunt doen: databases die uw dashboards lezen en die niet met OneUptime zijn verbonden, elk maar één **Connect Database** verwijderd, met het soort en het adres al ingevuld; tabellen die een verbonden database niet bewaakt, die mogelijk buiten de scan ervan vallen of nog niet zijn verzameld; en bronnen die geen database zijn, zoals bestanden en webpagina's. Voor Power BI noemt het ook een tenantinstelling die uit staat, datasets die uit gegevensstromen lezen en datasets die Power BI niet kan beschrijven. **Gebaseerd op** zegt bij elk dashboard welke datasets het weergeeft en waar hun gegevens vandaan komen, zoals Power BI het zegt.

OneUptime leest elke Power BI-dataset uit de metadatascan van Power BI, met de Power Query achter elk van de tabellen ervan:

- **De database die een connector noemt**: SQL Server en Azure SQL (`Sql.Database`), PostgreSQL, MySQL, Oracle, Amazon Redshift, Snowflake, Google BigQuery, Databricks, Amazon Athena en Microsoft Dataverse, en het schema en de tabel die de navigatie ervan kiest.
- **SQL die een query uitvoert**: de optie **SQL statement** van een connector, `Value.NativeQuery` en `Odbc.Query`, en de tabellen na elke `FROM` en `JOIN`.
- **Parameters en gedeelde query's**: een parameter geldt overal waar hij wordt genoemd, en een tabel die een stagingquery leest, leest wat die query leest.
- **Samengestelde modellen** geven de tabellen weer van de datasets waarop ze zijn gebouwd.

Een rapport geeft de tabellen van zijn dataset weer, en een dashboard die van de datasets van zijn tegels. Waar de gegevens vandaan komen - de server en naam van een database, het pad van een bestand, een webadres - komt uit de gegevensbronnen van de scan, die niets nodig hebben buiten de beheer-API-toegang hierboven.

Power BI geeft de tabellen van een dataset pas terug zodra een Fabric-beheerder twee tenantinstellingen aanzet in de beheerportal, onder **Tenant settings > Admin API settings**, voor de beveiligingsgroep waarin de service principal zit:

- **Enhance admin APIs responses with detailed metadata**: de tabellen van elke dataset.
- **Enhance admin APIs responses with DAX and mashup expressions**: de query's die ze laden, die zeggen welke databasetabellen ze lezen.

Power BI beschrijft een dataset daarna zodra die is vernieuwd of opnieuw is gepubliceerd; een die alleen DirectQuery gebruikt, zodra iemand er een rapport op heeft geopend. Het beschrijft nooit realtime datasets, datasets met een liveverbinding met Analysis Services, Excel-werkmappen of datasets van meer dan 1 GB op gedeelde capaciteit.

Elke tabel wordt aan een bewaakte tabel gekoppeld op naam, schema en database, en een server op zijn korte of volledige naam. Een tabel van een andere engine wordt nooit gekoppeld, en een in een andere database evenmin: een rapport op `Sales.dbo.Orders` wordt niet verbonden met `Archive.dbo.Orders`, omdat alleen `Archive` wordt bewaakt.

[Vernieuwingen](#weergaven-en-vernieuwingen-in-power-bi) worden los van de tabellen gelezen: een melding dat de vernieuwingen van sommige datasets niet gelezen konden worden, zegt niets over hun tabellen.

## Voordat een wijziging wordt gemerged

Wanneer een pull request een bewaakte tabel wijzigt, zegt [Production Review](/docs/ai/ai-agent) op de pull request wat ervan afhangt: de services die haar lezen, de tabellen die eruit zijn opgebouwd, de dashboards erop en haar dataproducten. Een tabel met een kopie op een database die als Staging is gemarkeerd, zegt ook hoe de kopie verschilt: haar rijen, haar kolommen en wat de controles van de tabel daar lezen, ter plekke uitgevoerd. Op een database die alleen een sonde kan bereiken, worden de controles weggelaten, en dat wordt gemeld.

## Volgende stappen

:::cards
- [Dataproducten](/docs/data-observability/data-products): Actualiteits-SLA's over de tabellen die mensen gebruiken.
- [OneUptime AI en de API](/docs/data-observability/ai-and-api): Onderzoeken die beginnen bij de schrijvers en uitvoeringen van een tabel. Via AI vragen en AI-agents kun je vragen waaruit een tabel is opgebouwd.
:::

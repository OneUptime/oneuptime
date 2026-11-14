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
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, een service principal die de alleen-lezen beheer-API's van Power BI mag gebruiken. Zowel rapporten als dashboards worden gelezen, met hun weergaven en vernieuwingen (hieronder) |
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

Elke job, elk dbt-project en elke synchronisatie verschijnt onder **Pipelines**, met de uitvoeringen: wanneer elke uitvoering begon en eindigde, hoe lang ze duurde, welke poging het was waar de scheduler dat zegt (het try-nummer van Airflow), en de fout van een mislukte uitvoering. Na vijf uitvoeringen leert elke pipeline uit zijn eigen uitvoeringen hoe lang een uitvoering gewoonlijk duurt en hoeveel tijd er volgens zijn planning tussen twee uitvoeringen zit. De pagina van een pipeline beveelt drie monitoren aan:

- **Pipeline Run Failed**: een uitvoering is mislukt of afgebroken.
- **Pipeline Run Unusually Long**: een uitvoering heeft twee keer haar gebruikelijke tijd of langer geduurd, elke vijf minuten gecontroleerd zolang ze loopt, zodat een uitvoering die vastloopt al wordt opgemerkt voordat ze eindigt.
- **Pipeline Is Late**: er is langer geen uitvoering gestart dan de planning toestaat.

De pagina van een pipeline tekent zijn **Herkomst**, de eerste plek om te kijken als een uitvoering mislukt of te laat is: links de tabellen die hij leest, rechts de tabellen die hij schrijft, de pipeline ertussen, en elke kaart zegt hoe het er nu voor staat. Kies meer stappen om te zien waaruit die tabellen zijn opgebouwd en wat eruit is opgebouwd, en open een willekeurige tabel om haar eigen tabblad **Herkomst** te zien. Een aantal niet-getekende tabellen, op de kaart van de pipeline of van een tabel, tekent er ook hier ter plekke meer bij.

## Eén waarschuwing per oorzaak

Wanneer een tabel verouderd raakt, raakt elke tabel die eruit is opgebouwd ook verouderd. Voordat een gegevenswaarschuwing opent, zoekt OneUptime in de herkomst naar een waarschuwing die al openstaat op datgene waaruit haar tabel of pipeline is opgebouwd: de tabellen stroomopwaarts, de pipelines die ernaar schrijven, en de databases waarin ze staan, tot vijf stappen omhoog. Vindt het er een, dan is de nieuwe waarschuwing een gevolg van die waarschuwing:

- Ze begint als **bevestigd**, zodat niemand twee keer wordt opgeroepen voor één probleem, en herstelt vanzelf zodra haar gegevens herstellen.
- Haar feed en haar kaart **Gegevens** zeggen welke waarschuwing haar veroorzaakte, en ze sluit zich aan bij de episode van de oorzaak.

De kaart **Gegevens** van de oorzaak toont haar **Impact stroomafwaarts**: elke waarschuwing die ze veroorzaakte. De kaart van een tabelwaarschuwing toont ook de services die naar de tabel schrijven, met hun mislukte schrijfacties, en hun deploys en andere wijzigingen in de dag vóór de waarschuwing.

Onder de kaart **Gegevens** tekent de pagina van een waarschuwing haar **Herkomst**: rond haar tabel, zoals het tabblad **Herkomst** van de tabel die tekent, of rond haar pipeline. De weg omhoog naar de waarschuwing die haar veroorzaakte en omlaag naar elke waarschuwing die ze veroorzaakte, is gemarkeerd - de tabel of pipeline van de oorzaak met **Oorzaak**, die van elke veroorzaakte waarschuwing met **Gevolg** - en de rest vervaagt, zodat wie haar opent ziet waar in de keten het probleem begon. Ligt de oorzaak bij een pipeline die op een pijl is getekend, dan staat op die pijl **Oorzaak** onder de naam van de pipeline. Gaat de oorzaak over een hele database, of ligt ze verder omhoog dan het diagram reikt, dan zegt de kaart dat in woorden. Een waarschuwing uit een controle op één kolom, zoals een controle Percentage NULL op `customer_id`, opent met die kolom gevolgd naast deze wegen, zoals op het tabblad **Herkomst** van de tabel: waar ze vandaan komt en waar ze naartoe gaat, genoemd op elke tabel. Kies daar een andere kolom van de tabel, of wis haar om alleen de wegen te zien. **Herkomst verkennen** opent het tabblad **Herkomst** van de tabel, of de pagina van de pipeline.

Wie de waarschuwing die haar veroorzaakte niet mag zien, krijgt geen kaart **Gegevens** en geen herkomst, en een veroorzaakte waarschuwing die diegene niet mag zien, wordt niet gemarkeerd en niet meegeteld.

## Voordat een wijziging wordt gemerged

Wanneer een pull request een bewaakte tabel wijzigt, zegt [Production Review](/docs/ai/ai-agent) op de pull request wat ervan afhangt: de services die haar lezen, de tabellen die eruit zijn opgebouwd, de dashboards erop en haar dataproducten. Een tabel met een kopie op een database die als Staging is gemarkeerd, zegt ook hoe de kopie verschilt: haar rijen, haar kolommen en wat de controles van de tabel daar lezen, ter plekke uitgevoerd. Op een database die alleen een sonde kan bereiken, worden de controles weggelaten, en dat wordt gemeld.

## Volgende stappen

:::cards
- [Dataproducten](/docs/data-observability/data-products): Actualiteits-SLA's over de tabellen die mensen gebruiken.
- [OneUptime AI en de API](/docs/data-observability/ai-and-api): Onderzoeken die beginnen bij de schrijvers en uitvoeringen van een tabel. Via AI vragen en AI-agents kun je vragen waaruit een tabel is opgebouwd.
:::

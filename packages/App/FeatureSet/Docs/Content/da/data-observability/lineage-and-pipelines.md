# Afstamning og pipelines

Afstamning viser, hvilke tabeller hver tabel er bygget af, og hvilke pipelines der skriver til den. Dataobservabilitet samler den fra seks steder på én gang - OpenLineage-hændelser, dbt, synkroniseringer i Fivetran og Airbyte, jobs i dine spor, views og hver databases egen forespørgselshistorik - og bruger den til at knytte hver forsinket eller ødelagt tabel til kørslen bag den, så ét problem åbner én advarsel.

## Hvor afstamningen kommer fra

| Kilde | Hvad den giver |
| --- | --- |
| **OpenLineage** | Hver kørsel af et Airflow-, Dagster-, Spark-, dbt- eller Flink-job og de tabeller, det læste og skrev |
| **dbt** | Hvad hver model er bygget af, hvert build som en kørsel og hver tests resultat |
| **Fivetran og Airbyte** | Hver synkronisering som en kørsel af dens connector og de rå tabeller, den indlæser |
| **Jobs i dine spor** | Et Kubernetes CronJob eller en planlagt funktion, dens kørsler og de tabeller, dens databasekald læste og skrev |
| **Views** | Et view er bygget af de tabeller, det er defineret på (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, Snowflake, materialiserede views i ClickHouse, Databricks, MongoDB) |
| **Forespørgselshistorik** | En forespørgsel, der læste én tabel og skrev til en anden (Snowflakes adgangshistorik, BigQuerys jobs, Redshifts forespørgselslog, ClickHouses forespørgselslog, Databricks' afstamningstabel) |

En tabels fane **Afstamning** viser de tabeller, den er bygget af, de pipelines, der skriver til den, med deres seneste kørsel, og de tabeller, der er bygget af den. Hver kant viser, hvor den blev set.

Øverst på fanen tegner et diagram den afstamning nogle trin i hver retning (tre, eller vælg 1, 2 eller 5): til venstre det, tabellen er bygget af, til højre de tabeller og dashboards, der er bygget af den, og de pipelines, der indlæser data udefra, der hvor de kommer ind. Hvert kort viser, hvordan det står til nu - forsinket, en åben advarsel, en mislykket kørsel - og en pil bliver rød, når den seneste kørsel af dens pipeline mislykkedes, så en forsinket tabel kan følges op til den kørsel, der stoppede den. Åbn en hvilken som helst tabel for at centrere diagrammet på den.

Et kort tegner højst ti tabeller i hver retning og tæller resten, for eksempel **+14**. Vælg tallet for at tegne op til ti flere af dem, hvor de er, problemer først, med hver pil mellem dem og det, der allerede er tegnet. **Nulstil diagram** går tilbage til diagrammet, som det først blev tegnet. Når en side rummer så mange tabeller, som et diagram kan, så åbn en tabel for at centrere diagrammet på den.

Hvor kilden nævner kolonner, viser en tabels fane **Kolonner**, hvor hver kolonne kommer fra, og hvad den føder: Snowflakes adgangshistorik (Enterprise-udgaven, som kræver `IMPORTED PRIVILEGES` på databasen `SNOWFLAKE`) og OpenLineages facet `columnLineage`.

Vælg på fanen **Afstamning** en af tabellens kolonner i **Følg en kolonne** for at fremhæve, hvor den kommer fra, og hvor den går hen: op gennem diagrammet til de kolonner, den er bygget af, ned til de kolonner, der er bygget af den, hver navngivet på sin tabel, også hvor kolonnen blev omdøbt undervejs. En pil, hvis kilder ikke nævner kolonner, kan føre den længere end det fremhævede, og diagrammet siger det.

## OpenLineage

Send OpenLineage-hændelser til OneUptime, uændrede, med en [indtagelsesnøgle](/docs/telemetry/ingestion-keys) til telemetri:

- **URL:** `https://oneuptime.com/telemetry/openlineage` (på en selvhostet OneUptime din egen adresse)
- **Endpoint:** `api/v1/lineage`, OpenLineages standard
- **API-nøgle:** indtagelsesnøglen, sendt som `Authorization: Bearer`, eller angiv `x-oneuptime-token`

Til Airflows OpenLineage-provider:

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

For enhver anden OpenLineage-klient angiver du `OPENLINEAGE_URL` og `OPENLINEAGE_API_KEY`. Datasæt matches med tabeller efter OpenLineages navngivningsspecifikation, f.eks. `postgres://host:5432` med `database.schema.table`, `snowflake://account` med `database.schema.table`, `clickhouse://host:8443` med `database.table` og `databricks://workspace-host` med `catalog.schema.table`.

## dbt

Efter `dbt build` (eller run, test, seed eller snapshot) sender du projektets artefakter med [OneUptime-CLI'en](/docs/cli/index):

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

I CI kører du `oneuptime dbt upload` som trinnet efter buildet, også når buildet fejler, så fejlede tests bliver registreret. Hver tabel, dbt bygger, får et **dbt**-kort på sin Oversigt, sine modellers afstamning og sine tests på fanen **Tjek**; hvert build er en kørsel af projektets pipeline.

## Fivetran og Airbyte

Deres webhooks fortæller, hvornår hver synkronisering starter og slutter. **Pipelines > Forbind Fivetran eller Airbyte** udfylder URL'erne med en af dine indtagelsesnøgler:

- **Fivetran:** en webhook, der er oprettet med Fivetrans REST API, til hændelserne `sync_start` og `sync_end`, til `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`, med indtagelsesnøglen som hemmelighed. Fivetran signerer hver levering med den, så nøglen aldrig sendes i URL'en.
- **Airbyte:** arbejdsområdets webhook sat til `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`, slået til for mislykkede og vellykkede synkroniseringer. Giv Airbyte sin egen nøgle.

En Fivetran-synkronisering, der omplanlægges ved et API's hastighedsgrænse, ender som **Omplanlagt**: ikke en fejl, så den tilkalder ingen.

## Jobs i dine spor

Mange pipelines er et Kubernetes CronJob eller en funktion på en timer uden nogen planlægger, der sender afstamning. Deres spor siger det alligevel, uden noget at installere. Hvert femtende minut bliver spans med ressourceattributten `k8s.cronjob.name` eller `k8s.job.name`, eller `faas.name` med en `faas.trigger` på `timer` eller `datasource`, til en pipeline under **Pipelines**:

- En kørsel af et CronJob er dets Kubernetes Job, og en kørsel af en funktion er dens `faas.invocation_id`.
- En kørsel mislykkedes, når den span, der ligger øverst i dens spor, gjorde det. Et kald, der mislykkedes og blev forsøgt igen inde i den, får den ikke til at mislykkes.
- De tabeller, den skrev og læste, kommer fra dens databasespans.

Hver kørsel linker til sit spor, med dets logge. De samme tre monitorer gælder, så et CronJob, der holder op med at køre, ses som forsinket.

## Dashboards i BI-værktøjer

Den reelle følge af dårlige data er det dashboard, nogen åbner. Under **BI-dashboards** tilføjer du dine BI-værktøjer med legitimationsoplysninger, der må læse deres dashboards. Hver time læser Dataobservabilitet hvert dashboard og tabellerne bag det, matcher hver tabel med en overvåget tabel og viser de dashboards, der er bygget på en tabel og på de tabeller, der bygges af den, på dens fane **Afstamning**, på dens alarmer og i Production Review.

| Værktøj | Legitimationsoplysninger |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, en service principal, der må bruge Power BI's skrivebeskyttede administrator-API'er. Både rapporter og dashboards læses, med deres visninger og opdateringer (nedenfor) |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (eller `eu`) |

Hightouch og Census er reverse ETL-værktøjer: en synkronisering, der kopierer en tabel ind i et CRM, afhænger af den tabel, som et dashboard gør, så den læses på samme måde og nævnes på tabellens advarsler.

Kun dashboards' navne og links, de tabeller, de forespørger, og for Power BI hvem der åbner dem, og hvordan deres opdateringer gik, læses: aldrig deres data.

### Visninger og opdateringer i Power BI

For hver Power BI-rapport og hvert Power BI-dashboard viser **BI-dashboards** først, hvor mange gange det blev åbnet de seneste 28 dage, hvornår det sidst blev åbnet, og hvordan den seneste opdatering af dets data gik, med fejlen fra en mislykket opdatering. Hvor mange personer der åbnede det, hvem der åbnede det mest, og dets seneste opdateringer er kolonner, du kan slå til. En tabels fane **Afstamning** siger det samme om hvert dashboard, der bygger på den, med dets ejer og seere under **Mere**.

- **Visninger** kommer fra Power BI's aktivitetslog, læst gennem dens administrator-API til aktivitetshændelser. Power BI gemmer 28 dage af den, besvarer 200 anmodninger i timen og deler hver anmodning op i timer, så OneUptime læser den en time ad gangen: hver timelig læsning tilføjer timerne siden den forrige og går derefter tilbage gennem de 28 dage, nyeste først, med højst 100 anmodninger. Et nyt Power BI-værktøj viser de seneste dage med det samme og alle 28 dage inden for et døgn; indtil da siger visningerne, siden hvornår de tælles. En hændelse kan tage op til en time om at nå loggen, så visningerne er op til to timer bagud. Seere nævnes, som Power BI nævner dem: ved deres e-mailadresse.
- **Opdateringer** af datasæt på en kapacitet (Premium, Premium pr. bruger eller Fabric) kommer fra Power BI's administratorliste over elementer, der kan opdateres: hvert datasæts seneste opdatering med dens fejl, og hvor mange opdateringer der kørte og mislykkedes i de syv dage, Power BI gemmer.
- **Opdateringer af datasæt på delt kapacitet** er ikke på den liste. Power BI viser kun et datasæts opdateringshistorik til dem, der må ændre datasættet, så tilføj service principal'en til dets arbejdsområde som **Bidragyder**, **Medlem** eller **Administrator**, og slå **Service principals can call Fabric public APIs** til for den i udviklerindstillingerne i Fabric-administrationsportalen. OneUptime læser så hver opdatering med dens fejl. Indtil da siger BI-værktøjet, for hvor mange datasæt det ikke kunne læse opdateringerne.
- Et Power BI-dashboard, hvis felter kommer fra flere datasæt, viser den seneste opdatering, der mislykkedes, eller den ældste, hvis ingen mislykkedes: dets data er kun så friske som den.

Visninger og opdateringer på kapaciteter kræver intet ud over administrator-API-adgangen ovenfor: service principal'en i en sikkerhedsgruppe, som **Service principals can access read-only admin APIs** tillader, uden Power BI-tilladelser på appen, der kræver administratorsamtykke. Når visninger eller opdateringer ikke kan læses, bliver dashboards stadig læst og bevaret, BI-værktøjet siger, hvad der blev sprunget over og hvorfor, og den næste læsning prøver igen.

### Advarsler ved mislykkede opdateringer

Slå **Alert on Failed Refreshes** til, når du tilføjer eller redigerer et Power BI-værktøj (et nyt starter med den slået til), og OneUptime holder én monitor for værktøjet under **Monitorer**, opkaldt efter det. Monitoren åbner en advarsel for hvert datasæt, hvis seneste opdatering mislykkedes eller blev annulleret, med datasættet og dets arbejdsområde i advarslens titel, og løser den, så snart en senere opdatering er fuldført. Et datasæt, der udgives senere, overvåges, så snart det bliver læst. Slår du kontakten fra eller fjerner værktøjet, fjernes monitoren; indtil da er den en almindelig monitor med sine ejere, vagtpolitikker og vedligeholdelsesvinduer.

Mislykkede opdateringer bruger ikke pipeline-monitorerne. Et datasæt, hvis opdatering mislykkedes, bliver ved med at vise dataene fra sin seneste fuldførte opdatering, indtil en senere bliver fuldført, så dets advarsel forbliver åben indtil da, hvor en mislykket kørsels advarsel forsvinder en time efter kørslen. Og opdateringer læses én gang i timen: en opdatering, der læses op til en time efter, at den sluttede, ville ofte falde uden for den time, **Pipeline Run Failed** kigger på, et datasæt, der opdateres hver halve time, ville hele tiden blive **Pipeline Is Late**, og en opdatering, der var slut, men endnu ikke læst, ville ligne **Pipeline Run Unusually Long**.

- Ved hver timelig læsning bevares de datasæt, hvis seneste afsluttede opdatering mislykkedes eller blev annulleret. Hvert femte minut skriver hvert af dem `oneuptime.data.bi.refresh_failed`, 1 så længe det fejler og 0 i timen efter, at en senere opdatering er fuldført, og monitoren læser det, så én fejl åbner én advarsel, uanset hvor mange timelige læsninger der ser den.
- En fejl ses ved næste timelige læsning: dens advarsel åbner op til en time efter, at opdateringen mislykkedes, og løses op til en time efter, at en senere opdatering blev fuldført.
- En opdatering, der stadig kører, ændrer intet: advarslen for et datasæt, hvis opdatering mislykkedes, forbliver åben, mens dets næste opdatering kører, og løses først, når en opdatering er fuldført.
- På en kapacitet giver Power BI's liste over elementer, der kan opdateres, kun hvert datasæts seneste opdatering, så en opdatering, der mislykkedes og blev fulgt af en fuldført inden for samme time, ses aldrig: til den tid er dataene friske igen.
- Datasæt på delt kapacitet giver kun advarsler, hvor deres opdateringer kan læses (ovenfor), og et datasæt, hvis opdateringer ikke kunne læses, beholder sin advarsel, som den var, indtil de kan.

## Pipelines

Hvert job, dbt-projekt og hver synkronisering vises under **Pipelines**, med sine kørsler: hvornår hver startede og sluttede, hvor lang tid den tog, hvilket forsøg den var, hvor planlæggeren oplyser det (Airflows try number), og fejlen for en mislykket kørsel. Efter fem kørsler lærer hver pipeline af sine egne kørsler, hvor lang tid en kørsel plejer at tage, og hvor lang tid der går mellem kørslerne efter dens tidsplan. En pipelines side anbefaler tre monitorer:

- **Pipeline Run Failed**: en kørsel mislykkedes eller blev afbrudt.
- **Pipeline Run Unusually Long**: en kørsel har taget dobbelt så lang tid som normalt eller mere, tjekket hvert femte minut, mens den kører, så en kørsel, der hænger, opdages, før den slutter.
- **Pipeline Is Late**: ingen kørsel er startet i længere tid, end tidsplanen tillader.

En pipelines side tegner dens **Afstamning**, det første sted at kigge, når en kørsel mislykkes eller er forsinket: til venstre de tabeller, den læser, til højre de tabeller, den skriver, pipelinen imellem, og hvert kort viser, hvordan det står til nu. Vælg flere trin for at se, hvad tabellerne er bygget af, og hvad der er bygget af dem, og åbn en hvilken som helst tabel for at se dens egen fane **Afstamning**. Et tal for tabeller, der ikke er tegnet, på pipelinens kort eller på en tabels, tegner også her flere af dem på stedet.

## Én advarsel pr. årsag

Når en tabel bliver forældet, bliver hver tabel, der er bygget af den, også forældet. Før en dataadvarsel åbnes, slår OneUptime op i afstamningen efter en advarsel, der allerede er åben på det, dens tabel eller pipeline er bygget af: tabellerne opstrøms, de pipelines, der skriver til dem, og de databaser, de ligger i, op til fem trin op. Finder den en, er den nye advarsel en følge af den advarsel:

- Den starter som **bekræftet**, så ingen tilkaldes to gange for ét problem, og genopretter sig selv, når dens data gør det.
- Dens feed og dens **Data**-kort viser, hvilken advarsel der forårsagede den, og den slutter sig til årsagens episode.

Årsagens **Data**-kort viser dens **Nedstrøms påvirkning**: hver advarsel, den forårsagede. En tabeladvarsels kort viser også de tjenester, der skriver til tabellen, med deres mislykkede skrivninger og deres udrulninger og andre ændringer i døgnet før advarslen.

Under **Data**-kortet tegner en advarsels side dens **Afstamning**: omkring dens tabel, som tabellens fane **Afstamning** tegner den, eller omkring dens pipeline. Vejen op til den advarsel, der forårsagede den, og ned til hver advarsel, den forårsagede, er fremhævet - årsagens tabel eller pipeline markeret med **Årsag**, hver forårsaget advarsels med **Følge** - og resten tones ned, så den, der åbner den, kan se, hvor i kæden problemet begyndte. Ligger årsagen på en pipeline, der er tegnet på en pil, står der **Årsag** under pipelinens navn på pilen. Handler årsagen om en hel database, eller ligger den længere oppe, end diagrammet når, siger kortet det med ord. En advarsel fra en kontrol af én kolonne, som en kontrol af typen Andel NULL på `customer_id`, åbner med den kolonne fulgt ved siden af disse veje, som på tabellens fane **Afstamning**: hvor den kommer fra, og hvor den går hen, navngivet på hver tabel. Vælg en anden af tabellens kolonner dér, eller ryd den for kun at se vejene. **Udforsk afstamning** åbner tabellens fane **Afstamning** eller pipelinens side.

Den, der ikke må se den advarsel, der forårsagede den, får hverken **Data**-kortet eller afstamningen, og en forårsaget advarsel, som vedkommende ikke må se, bliver hverken fremhævet eller talt med.

## Før en ændring flettes

Når en pull request ændrer en overvåget tabel, siger [Production Review](/docs/ai/ai-agent) på pull requesten, hvad der afhænger af den: de tjenester, der læser den, de tabeller, der er bygget af den, de dashboards, der ligger på den, og dens dataprodukter. En tabel med en kopi på en database markeret som Staging siger også, hvordan kopien adskiller sig: dens rækker, dens kolonner og det, tabellens tjek læser dér, kørt på stedet. På en database, som kun en sonde kan nå, udelades tjekkene, og den siger det.

## Næste trin

:::cards
- [Dataprodukter](/docs/data-observability/data-products): Aktualitets-SLA'er over de tabeller, folk bruger.
- [OneUptime AI og API'et](/docs/data-observability/ai-and-api): Undersøgelser, der tager udgangspunkt i en tabels skrivere og kørsler. I Spørg AI og via AI-agenter kan du spørge, hvad en tabel er bygget af.
:::

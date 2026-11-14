# Avstamning og pipelines

Avstamning viser hvilke tabeller hver tabell er bygget fra, og hvilke pipelines som skriver til den. Dataobserverbarhet samler den inn fra seks steder samtidig – OpenLineage-hendelser, dbt, synkroniseringer fra Fivetran og Airbyte, jobber i sporene dine, visninger og hver databases egen spørringshistorikk – og bruker den til å knytte hver forsinkede eller ødelagte tabell til kjøringen bak, slik at ett problem åpner én sak.

## Hvor avstamningen kommer fra

| Kilde | Hva den gir |
| --- | --- |
| **OpenLineage** | Hver kjøring av en Airflow-, Dagster-, Spark-, dbt- eller Flink-jobb, og tabellene den leste og skrev til |
| **dbt** | Hva hver modell er bygget fra, hver bygging som en kjøring, og resultatet av hver test |
| **Fivetran og Airbyte** | Hver synkronisering som en kjøring av koblingen, og råtabellene den laster |
| **Jobber i sporene dine** | En Kubernetes CronJob eller en planlagt funksjon, kjøringene dens, og tabellene databasekallene dens leste og skrev |
| **Visninger** | En visning er bygget fra tabellene den er definert på (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, Snowflake, materialiserte visninger i ClickHouse, Databricks, MongoDB) |
| **Spørringshistorikk** | En spørring som leste én tabell og skrev til en annen (tilgangshistorikken i Snowflake, jobbene i BigQuery, spørringsloggen i Redshift, spørringsloggen i ClickHouse, avstamningstabellen i Databricks) |

Fanen **Opphav** for en tabell viser tabellene den er bygget fra, pipelinene som skriver til den med siste kjøring, og tabellene som er bygget fra den. Hver forbindelse viser hvor den ble sett.

Øverst i fanen tegner et diagram dette opphavet noen trinn i hver retning (tre, eller velg 1, 2 eller 5): til venstre det tabellen er bygget fra, til høyre tabellene og dashbordene som er bygget fra den, og pipelinene som laster inn data utenfra, der dataene kommer inn. Hvert kort viser hvordan det står til nå - forsinket, et åpent varsel, en mislykket kjøring - og en pil blir rød når siste kjøring av pipelinen feilet, slik at en forsinket tabell kan følges opp til kjøringen som stanset den. Åpne en hvilken som helst tabell for å sentrere diagrammet på den.

Et kort tegner høyst ti tabeller i hver retning og teller resten, for eksempel **+14**. Velg tallet for å tegne opptil ti til av dem der de er, problemer først, med hver pil mellom dem og det som allerede er tegnet. **Tilbakestill diagram** går tilbake til diagrammet slik det først ble tegnet. Når en side har så mange tabeller som ett diagram kan romme, åpner du en tabell for å sentrere diagrammet på den.

Der kilden oppgir kolonner, sier fanen **Kolonner** for en tabell hvor hver kolonne kommer fra og hva den mater: tilgangshistorikken i Snowflake (Enterprise-utgaven, som trenger `IMPORTED PRIVILEGES` på databasen `SNOWFLAKE`), og `columnLineage`-fasetten i OpenLineage.

Velg i fanen **Opphav** en av tabellens kolonner i **Følg en kolonne** for å utheve hvor den kommer fra og hvor den går: opp i diagrammet til kolonnene den er bygget fra, ned til kolonnene som er bygget fra den, hver navngitt på sin tabell, også der kolonnen fikk nytt navn underveis. En pil der kildene ikke oppgir kolonner, kan føre den lenger enn det som er uthevet, og diagrammet sier fra om det.

## OpenLineage

Send OpenLineage-hendelser til OneUptime, uendret, med en [inntaksnøkkel](/docs/telemetry/ingestion-keys) for telemetri:

- **URL:** `https://oneuptime.com/telemetry/openlineage` (på en selvhostet OneUptime, din egen adresse)
- **Endpoint:** `api/v1/lineage`, standarden i OpenLineage
- **API-nøkkel:** inntaksnøkkelen, sendt som `Authorization: Bearer`, eller angi `x-oneuptime-token`

For OpenLineage-provideren i Airflow:

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

For enhver annen OpenLineage-klient angir du `OPENLINEAGE_URL` og `OPENLINEAGE_API_KEY`. Datasett knyttes til tabeller etter navnespesifikasjonen i OpenLineage, for eksempel `postgres://host:5432` med `database.schema.table`, `snowflake://account` med `database.schema.table`, `clickhouse://host:8443` med `database.table`, og `databricks://workspace-host` med `catalog.schema.table`.

## dbt

Etter `dbt build` (eller run, test, seed eller snapshot) sender du prosjektets artefakter med [OneUptime CLI](/docs/cli/index):

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

I CI kjører du `oneuptime dbt upload` som steget etter byggingen, også når byggingen feiler, slik at mislykkede tester blir registrert. Hver tabell dbt bygger, får et **dbt**-kort på Oversikt-siden, avstamningen fra modellene, og testene sine i fanen **Sjekker**; hver bygging er en kjøring av prosjektets pipeline.

## Fivetran og Airbyte

Webhookene deres sier når hver synkronisering starter og slutter. **Pipelines > Koble til Fivetran eller Airbyte** fyller ut URL-ene med en av inntaksnøklene dine:

- **Fivetran:** en webhook opprettet med REST API-et til Fivetran, for hendelsene `sync_start` og `sync_end`, til `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`, med inntaksnøkkelen som hemmelighet. Fivetran signerer hver levering med den, så nøkkelen sendes aldri i URL-en.
- **Airbyte:** arbeidsområdets webhook satt til `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`, slått på for mislykkede og vellykkede synkroniseringer. Gi Airbyte en egen nøkkel.

En Fivetran-synkronisering som planlegges på nytt fordi et API har nådd frekvensgrensen sin, ender som **Omplanlagt**: ikke en feil, så den tilkaller ingen.

## Jobber i sporene dine

Mange pipelines er en Kubernetes CronJob, eller en funksjon på en timer, uten noen planlegger som sender avstamning. Sporene deres sier alt det samme, uten noe å installere. Hvert kvarter blir spans med ressursattributtet `k8s.cronjob.name` eller `k8s.job.name`, eller `faas.name` med en `faas.trigger` på `timer` eller `datasource`, til en pipeline under **Pipelines**:

- En kjøring av en CronJob er dens Kubernetes Job, og en kjøring av en funksjon er dens `faas.invocation_id`.
- En kjøring feilet når spanet øverst i sporet gjorde det. Et kall som feilet og ble prøvd på nytt inni den, lar den ikke feile.
- Tabellene den skrev til og leste kommer fra databasespanene dens.

Hver kjøring lenker til sporet sitt, med loggene. De samme tre monitorene gjelder, så en CronJob som slutter å kjøre, ses som forsinket.

## Dashbord i BI-verktøy

Den virkelige følgen av dårlige data er dashbordet noen åpner. Under **BI-dashbord** legger du til BI-verktøyene dine med legitimasjon som kan lese dashbordene deres. Hver time leser Dataobserverbarhet hvert dashbord og tabellene bak det, matcher hver tabell med en overvåket tabell og viser dashbordene som er bygget på en tabell, og på tabellene som bygges av den, på fanen **Opphav**, på varslene og i Production Review.

| Verktøy | Legitimasjon |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, en tjenestekontohaver (service principal) som kan bruke Power BIs skrivebeskyttede administrator-API-er. Både rapporter og dashbord leses, med visninger og oppdateringer (nedenfor) |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (eller `eu`) |

Hightouch og Census er reverse ETL-verktøy: en synkronisering som kopierer en tabell inn i et CRM, avhenger av den tabellen slik et dashbord gjør, så den leses på samme måte og nevnes på varslene til tabellen.

Bare dashbordenes navn og lenker, tabellene de spør mot, og for Power BI hvem som åpner dem og hvordan oppdateringene deres gikk, leses: aldri dataene deres.

### Visninger og oppdateringer i Power BI

For hver Power BI-rapport og hvert Power BI-dashbord viser **BI-dashbord** først hvor mange ganger det ble åpnet de siste 28 dagene, når det sist ble åpnet, og hvordan den siste oppdateringen av dataene gikk, med feilen fra en mislykket oppdatering. Hvor mange som åpnet det, hvem som åpnet det mest, og de siste oppdateringene er kolonner du kan slå på. Fanen **Opphav** for en tabell sier det samme om hvert dashbord som bygger på den, med eier og seere under **Mer**.

- **Visninger** kommer fra aktivitetsloggen i Power BI, lest gjennom administrator-API-et for aktivitetshendelser. Power BI tar vare på 28 dager av den, svarer på 200 forespørsler i timen og deler hver forespørsel opp i timer, så OneUptime leser den én time om gangen: hver lesing hver time legger til timene siden forrige og går så bakover gjennom de 28 dagene, nyeste først, med høyst 100 forespørsler. Et nytt Power BI-verktøy viser de siste dagene med en gang og alle 28 dagene innen et døgn; frem til da sier visningene fra når de telles. En hendelse kan bruke opptil en time på å komme inn i loggen, så visningene ligger opptil to timer etter. Seere navngis slik Power BI navngir dem: med e-postadressen.
- **Oppdateringer** av datasett på en kapasitet (Premium, Premium per bruker eller Fabric) kommer fra administratorlisten over oppdaterbare elementer i Power BI: den siste oppdateringen av hvert datasett med feilen, og hvor mange oppdateringer som kjørte og mislyktes i de sju dagene Power BI tar vare på.
- **Oppdateringer av datasett på delt kapasitet** er ikke med i den listen. Power BI viser oppdateringsloggen til et datasett bare til dem som kan endre datasettet, så legg til tjenestekontohaveren i arbeidsområdet som **Bidragsyter**, **Medlem** eller **Administrator**, og slå på **Service principals can call Fabric public APIs** for den i utviklerinnstillingene i Fabric-administrasjonsportalen. Da leser OneUptime hver oppdatering med feilen. Frem til da sier BI-verktøyet hvor mange datasett det ikke fikk lest oppdateringene til.
- Et Power BI-dashbord med fliser fra flere datasett viser den siste oppdateringen som mislyktes, eller den eldste hvis ingen mislyktes: dataene er bare så ferske som den.

Visninger, og oppdateringer på kapasiteter, trenger ikke noe mer enn administrator-API-tilgangen ovenfor: tjenestekontohaveren i en sikkerhetsgruppe som **Service principals can access read-only admin APIs** tillater, uten Power BI-tillatelser på appen som krever administratorsamtykke. Når visninger eller oppdateringer ikke kan leses, blir dashbordene likevel lest og beholdt, BI-verktøyet sier hva som ble hoppet over og hvorfor, og neste lesing prøver igjen.

### Varsler ved mislykkede oppdateringer

Slå på **Alert on Failed Refreshes** når du legger til eller redigerer et Power BI-verktøy (et nytt starter med det slått på), så holder OneUptime én monitor for verktøyet under **Monitorer**, oppkalt etter det. Monitoren åpner et varsel for hvert datasett der den siste oppdateringen mislyktes eller ble avbrutt, med datasettet og arbeidsområdet i tittelen på varselet, og løser det så snart en senere oppdatering er fullført. Et datasett som publiseres senere, overvåkes så snart det er lest. Slår du av bryteren eller fjerner verktøyet, fjernes monitoren; frem til da er den en vanlig monitor, med eiere, vaktpolicyer og vedlikeholdsvinduer.

Mislykkede oppdateringer bruker ikke pipelinemonitorene. Et datasett der oppdateringen mislyktes, fortsetter å vise dataene fra sin siste fullførte oppdatering til en senere blir fullført, så varselet blir stående åpent til da, mens varselet for en mislykket kjøring forsvinner en time etter kjøringen. Og oppdateringer leses én gang i timen: en oppdatering som leses opptil en time etter at den sluttet, ville ofte havne utenfor timen **Pipeline Run Failed** ser på, et datasett som oppdateres hver halvtime, ville stadig bli **Pipeline Is Late**, og en oppdatering som var ferdig, men ennå ikke lest, ville se ut som **Pipeline Run Unusually Long**.

- Hver timelige lesing beholder datasettene der den siste avsluttede oppdateringen mislyktes eller ble avbrutt. Hvert femte minutt skriver hvert av dem `oneuptime.data.bi.refresh_failed`, 1 så lenge det feiler og 0 i timen etter at en senere oppdatering er fullført, og monitoren leser det, så én feil åpner ett varsel uansett hvor mange timelige lesinger som ser den.
- En feil oppdages ved neste timelige lesing: varselet åpnes opptil en time etter at oppdateringen mislyktes, og løses opptil en time etter at en senere oppdatering ble fullført.
- En oppdatering som fortsatt kjører, endrer ingenting: varselet for et datasett der oppdateringen mislyktes, forblir åpent mens neste oppdatering kjører, og løses først når en oppdatering er fullført.
- På en kapasitet gir Power BIs liste over oppdaterbare elementer bare den siste oppdateringen av hvert datasett, så en oppdatering som mislyktes og ble fulgt av en fullført innen samme time, blir aldri sett: da er dataene ferske igjen.
- Datasett på delt kapasitet varsler bare der oppdateringene deres kan leses (ovenfor), og et datasett der oppdateringene ikke kunne leses, beholder varselet sitt slik det var til de kan det.

## Pipelines

Hver jobb, hvert dbt-prosjekt og hver synkronisering vises under **Pipelines**, med kjøringene sine: når hver startet og sluttet, hvor lang tid den tok, hvilket forsøk den var der planleggeren oppgir det (Airflows try number), og feilen fra en mislykket kjøring. Etter fem kjøringer har hver pipeline lært av sine egne kjøringer hvor lang tid en kjøring vanligvis tar, og hvor lenge det går mellom kjøringene etter tidsplanen. Siden for en pipeline anbefaler tre monitorer:

- **Pipeline Run Failed**: en kjøring feilet eller ble avbrutt.
- **Pipeline Run Unusually Long**: en kjøring har tatt dobbelt så lang tid som vanlig eller mer, sjekket hvert femte minutt mens den kjører, så en kjøring som henger, oppdages før den er ferdig.
- **Pipeline Is Late**: ingen kjøring har startet på lengre tid enn tidsplanen tillater.

Siden for en pipeline har kortet **Opphav**, det første stedet å se når en kjøring feiler eller er forsinket: til venstre tabellene den leser, til høyre tabellene den skriver, pipelinen imellom, og hvert kort viser hvordan det står til nå. Velg flere trinn for å se hva disse tabellene er bygget fra, og hva som er bygget fra dem, og åpne en hvilken som helst tabell for å se dens egen fane **Opphav**. Et tall for tabeller som ikke er tegnet, på pipelinens kort eller en tabells, tegner flere av dem på stedet her også.

## Én sak per årsak

Når en tabell blir utdatert, blir hver tabell som er bygget fra den, også utdatert. Før et datavarsel åpnes, slår OneUptime opp i avstamningen etter et varsel som allerede er åpent på det tabellen eller pipelinen er bygget fra: tabellene oppstrøms, pipelinene som skriver til dem, og databasene de ligger i, opptil fem trinn opp. Når den finner et, blir det nye varselet en følge av det varselet:

- Det starter som **bekreftet**, så ingen tilkalles to ganger for ett problem, og det løser seg av seg selv når dataene er i orden igjen.
- Feeden og **Data**-kortet sier hvilket varsel som forårsaket det, og det blir med i episoden til årsaken.

**Data**-kortet til årsaken viser **Påvirkning nedstrøms**: hvert varsel den forårsaket. Kortet for et tabellvarsel viser også tjenestene som skriver til tabellen, med de mislykkede skrivingene deres, og utrullingene og andre endringer deres i døgnet før varselet.

Under **Data**-kortet har siden for et varsel kortet **Opphav**: opphavet rundt tabellen, slik fanen **Opphav** for tabellen tegner det, eller rundt pipelinen. Veien opp til varselet som forårsaket det, og ned til hvert varsel det forårsaket, er uthevet - tabellen eller pipelinen til årsaken merket **Årsak**, den til hvert forårsaket varsel merket **Følge** - og resten tones ned, slik at den som åpner det, ser hvor i kjeden problemet startet. Ligger årsaken på en pipeline som er tegnet på en pil, står det **Årsak** under navnet på pipelinen på pilen. Gjelder årsaken en hel database, eller ligger den lenger opp enn diagrammet når, sier kortet det med ord. Et varsel fra en kontroll av én kolonne, som en kontroll av typen Andel NULL på `customer_id`, åpnes med den kolonnen fulgt ved siden av disse veiene, som i fanen **Opphav** for tabellen: hvor den kommer fra og hvor den går, navngitt på hver tabell. Velg en annen av tabellens kolonner der, eller fjern den for å se bare veiene. **Utforsk opphav** åpner fanen **Opphav** for tabellen, eller siden for pipelinen.

Den som ikke har tilgang til varselet som forårsaket det, får verken **Data**-kortet eller opphavet, og et forårsaket varsel vedkommende ikke har tilgang til, blir verken uthevet eller talt med.

## Før en endring slås sammen

Når en pull request endrer en overvåket tabell, sier [Production Review](/docs/ai/ai-agent) på pull requesten hva som avhenger av den: tjenestene som leser den, tabellene som er bygget fra den, dashbordene på den, og dataproduktene dens. En tabell med en kopi på en database merket Staging sier også hvordan kopien er forskjellig: radene, kolonnene, og hva sjekkene til tabellen leser der, kjørt på stedet. På en database bare en sonde kan nå, utelates sjekkene, og det sies fra om det.

## Neste steg

:::cards
- [Dataprodukter](/docs/data-observability/data-products): Aktualitets-SLA-er for tabellene folk bruker.
- [OneUptime AI og API-et](/docs/data-observability/ai-and-api): Undersøkelser som starter fra skriverne og kjøringene til en tabell. I Spør AI og via AI-agenter kan du spørre hva en tabell er bygget fra.
:::

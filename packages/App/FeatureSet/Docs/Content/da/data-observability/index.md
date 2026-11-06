# Dataobservabilitet

Dataobservabilitet holder øje med de tabeller, din virksomhed er afhængig af, i PostgreSQL, MySQL, SQL Server, Oracle, MongoDB, Redshift, Snowflake, BigQuery, ClickHouse, Databricks og Athena, og fortæller dig, når deres data er forsinkede, mangler, er forkerte eller ødelagte, før de mennesker, der bruger dem, opdager det. Den lærer selv hver tabels rytme, læser hver databases katalog, så ingen værdi forlader den, og knytter hvert dataproblem til den pipelinekørsel, den udrulning eller den opstrøms tabel, der ligger bag.

Den besvarer fire spørgsmål:

:::cards
- [Er dataene opdaterede?](/docs/data-observability/table-health): Hver tabels seneste ændring, rækker, størrelse og kolonner, læst hvert femte minut, med advarsler, når en tabel er forsinket, skrumper eller skifter form.
- [Er dataene korrekte?](/docs/data-observability/checks): Tjek af det, en tabel indeholder, afstemninger mellem en tabel og dens kopi og dbt's tests, med advarsler, når de fejler.
- [Hvor kommer de fra, og hvad føder de?](/docs/data-observability/lineage-and-pipelines): Afstamning fra dine pipelines, dbt, Fivetran, Airbyte, views og databasernes egen forespørgselshistorik, så ét problem åbner én advarsel.
- [Kan de mennesker, der bruger dem, stole på dem?](/docs/data-observability/data-products): Dataprodukter med en aktualitets-SLA, på statussider og fulgt som et SLO, med et "data as of"-badge.
:::

## Sådan virker det

```mermaid title="Fra dine databaser til en advarsel, som nogen handler på"
flowchart TB
    db["Dine databaser<br/>og datavarehuse"] --> collect["Kataloget læses hvert femte minut,<br/>af OneUptime eller en sonde"]
    pipes["Airflow, dbt, Spark,<br/>Fivetran, Airbyte"] --> runs["Pipelinekørsler<br/>og afstamning"]
    collect --> health["Tabellernes tilstand:<br/>aktualitet, volumen, skema"]
    collect --> checks["Tjek og<br/>afstemninger"]
    health --> alerts["Advarsler, med kørslen<br/>eller udrulningen bag dem"]
    checks --> alerts
    runs --> alerts
    alerts --> oncall["Vagt, statussider,<br/>SLO'er og OneUptime AI"]
```

1. **Forbind en database** med et skrivebeskyttet login. En database, som Datasikkerhed allerede kender, overvåges, uden at du skal gøre noget, og det samme gælder hvert BigQuery-datasæt, som din Google Cloud-forbindelse har fundet. En database i et privat netværk læses af en sonde, som du kører der.
2. **Hvert femte minut** læser OneUptime hver databases katalog og statistik: hver tabel og view, dens kolonner, rækker og størrelse, og hvornår den sidst blev ændret. Ingen tabel scannes, og i MongoDB læses kun feltnavnene på dens nyeste dokumenter. En sti i en bucket kan overvåges på samme måde.
3. **Hver tabels rytme læres**: hvor ofte den plejer at ændre sig. En tabel, der misser sin rytme, er forsinket; en tabel, hvis rækker falder, eller hvis kolonner ændrer sig, siger også til.
4. **Anbefalede advarsler** gør hvert af disse signaler til en monitor, som du vælger at have, og tjek, som du tilføjer, læser det, en tabel indeholder.
5. **Afstamning** fortæller, hvilke tabeller der føder hvilke, så en advarsel på en tabel, hvis kilde gik i stykker først, er en følge af den kilde: ét problem, ikke ti.

## Hvad der er anderledes

- **Den er en del af resten af OneUptime.** En dataadvarsel er en almindelig advarsel: den tilkalder den, der har vagt, åbner hændelser, vises på statussider og tæller med i SLO'er. De tjenester, som ifølge dine traces skriver til en tabel, og deres udrulninger, står ved siden af hver tabeladvarsel.
- **Intet at konfigurere pr. tabel.** Rytmer, tidsplaner og sædvanlige kørselstider læres ud fra det, hver tabel og pipeline gør, og en monitor, der anbefales for en database, dækker hver tabel i den, også dem, der oprettes senere.
- **Én advarsel pr. årsag.** En advarsel, hvis opstrøms tabel, pipeline eller database allerede har en åben advarsel, slutter sig til den advarsel som dens følge, allerede bekræftet, så en mislykket indlæsning kun tilkalder nogen én gang.
- **Hver advarsel forklarer sig selv.** Den rangerer den sandsynlige årsag, siger, hvad der afhænger af tabellen, og hvem der ejer den, og lærer af det, du siger om den: marker en som **Ikke et problem**, og det samme forbliver stille næste gang.
- **OneUptime AI kender dine data.** Undersøgelser af dataadvarsler tager udgangspunkt i tabellens skrivere, kørsler og opstrøms tabeller; i Spørg AI, Slack, Microsoft Teams og via AI-agenter kan du spørge, om en tabel er opdateret; og et tjek kan skrives ud fra en sætning. Se [OneUptime AI og API'et](/docs/data-observability/ai-and-api).

## Før du begynder

- **En rolle, der kan sætte det op.** Rollerne Projektejer, Projektadministrator og Telemetriadministrator forbinder databaser. Alle, der må redigere dataaktiver, tilføjer tjek, afstemninger og dataprodukter; rollen Seer læser, hvad den har fundet. Se [Tilladelsesreference](/docs/permissions/reference).
- **Et skrivebeskyttet login på hver database.** [Forbind en database](/docs/data-observability/connect) viser det mindste, hver motor har brug for. OneUptime foreslår de databaser, som dine spor, cloudkonti og Databaseovervågning allerede kender til.

## Kom hurtigt i gang

:::steps
### Forbind en database

Åbn **Dataobservabilitet**, gå til **Databaser**, og vælg **Forbind en database**. Vælg motoren, og angiv en skrivebeskyttet forbindelsesstreng eller navnet på den miljøvariabel, din sonde læser den fra. [Forbind en database](/docs/data-observability/connect) viser login for hver motor.

### Se dens tabeller

Inden for fem minutter vises dens tabeller under **Tabeller**, hver med sine rækker, sin størrelse og tidspunktet for den seneste ændring. En tabels aktualitet kendes, når den har ændret sig to gange: **Frisk**, så længe den holder sin rytme, **Forsinket**, når den misser den.

### Tilføj de anbefalede advarsler

Vælg **Anbefalede advarsler** for databasen under **Databaser**, og tilføj dem, du vil have: en tabel, der er forsinket, en, hvis rækker falder kraftigt eller er usædvanligt få, en, hvis kolonner ændrer sig, og en database, der holder op med at rapportere. Hver er en almindelig monitor: vagtordning, ejere, vedligeholdelsesvinduer og statussider fungerer som for enhver anden.
:::

## Hvad det koster

På OneUptime Cloud er de første 100 tabeller i et projekt gratis. Hver tabel derefter koster 1 $ om måneden og 0,25 $ over 1.000. Views er gratis, og det samme er tabellerne i en database, du holder op med at overvåge. En kontrol med en alarm faktureres som en aktiv monitor. **Databaser** og **Oversigt** viser, hvor mange tabeller dit projekt overvåger, og hvad de koster, og [Priser](https://oneuptime.com/pricing) har en beregner.

En selvhostet OneUptime betaler ikke for tabeller.

## Næste trin

:::cards
- [Forbind en database](/docs/data-observability/connect): Hver motors login med mindst mulige rettigheder og sonder til private netværk.
- [Tabellernes tilstand](/docs/data-observability/table-health): Aktualitet, volumen, skemaændringer, ubrugte tabeller og de metrikker, hver tabel skriver.
- [Kontroller og afstemninger](/docs/data-observability/checks): Regler for en tabels værdier, sammenligning af en tabel med dens kopi og dbt's tests.
- [Afstamning og pipelines](/docs/data-observability/lineage-and-pipelines): OpenLineage, dbt, Fivetran og Airbyte og én advarsel pr. årsag.
- [Dataprodukter](/docs/data-observability/data-products): Aktualitets-SLA'er for dem, der bruger data, på statussider og som SLO'er.
- [OneUptime AI og API'et](/docs/data-observability/ai-and-api): Undersøgelser, et tjek ud fra en sætning, aktualitet for AI-agenter og hvert endpoint.
:::

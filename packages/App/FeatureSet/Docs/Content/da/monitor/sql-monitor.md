# SQL-forespørgsel-monitor

SQL-forespørgsel-monitoren kører en skrivebeskyttet SQL-forespørgsel efter en tidsplan fra en sonde og advarer på resultatet — antallet af returnerede rækker, en skalarværdi, hvor længe forespørgslen tog, eller en forespørgselsfejl. Den er bygget til brugsscenariet "kør en forespørgsel, og åbn en hændelse", for eksempel en advarsel, når antallet af annullerede ordrer i de seneste fem minutter stiger kraftigt, når en køtabel bliver for stor, eller når en kritisk række forsvinder.

:::cards
- [Opret en skrivebeskyttet bruger](#opret-en-skrivebeskyttet-bruger): Det databaselogin, monitoren skal bruge.
- [Opret monitoren](#opret-en-sql-forespørgsel-monitor): Forbind en sonde, og angiv forespørgslen.
- [Skriv forespørgslen](#skriv-forespørgslen): Placér den værdi, du advarer på, i den første kolonne.
- [Opsæt kriterier](#opsæt-kriterier): Advar på et antal, en værdi, en langsom forespørgsel eller en fejl.
:::

## Sådan fungerer det

Ved hver kontrol forbinder sonden til din database, kører din forespørgsel i en skrivebeskyttet kontekst, læser højst et begrænset antal rækker tilbage og rapporterer en kompakt projektion til OneUptime. Monitorens kriterier evalueres derefter ud fra den projektion.

Fordi forespørgslen kører fra en sonde inde i dit netværk, har OneUptime aldrig brug for en direkte forbindelse til din database, og det fulde resultatsæt forlader aldrig sonden — kun en lille, begrænset projektion af resultatet rapporteres tilbage.

```mermaid title="Kun en lille projektion af resultatet forlader dit netværk"
sequenceDiagram
    participant O as OneUptime
    participant P as Sonde
    participant D as Din database
    O->>P: Monitorindstillinger, hemmeligheder løst op
    P->>D: Din forespørgsel, skrivebeskyttet
    D-->>P: Op til Max Rows + 1 rækker
    P->>O: Antal rækker, skalar, første række, tid, fejl
    O->>O: Evaluér kriterierne
```

Sonden rapporterer kun:

| Værdi | Hvad det er |
|---|---|
| **Row Count** | Antallet af rækker, forespørgslen returnerede (begrænset af grænsen Max Rows). |
| **Skalarværdi** | Den første kolonne i den første række. Det er den naturlige værdi for en forespørgsel i stil med `SELECT COUNT(*)`. |
| **First Row** | Den første række som par af kolonne og værdi, vist i kontrollens resumé som kontekst. |
| **Execution Time** | Hvor længe kontrollen tog, i millisekunder — inklusive forbindelsen, ikke kun forespørgslen. |
| **Forespørgselsfejl** | En renset fejlmeddelelse, hvis forespørgslen mislykkedes. |

Det fulde resultatsæt sendes aldrig til OneUptime, så kundedata kopieres ikke over i OneUptimes lager.

## Understøttede databaser

| Database | Standardport |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

MySQL- og PostgreSQL-kompatible motorer, der taler den samme wire-protokol og SQL-dialekt, virker som regel også, men kun de tre motorer ovenfor er officielt testet.

Når den vært og port, monitoren forbinder til, er et af endpointene for en database på siden [Databaser](/docs/telemetry/databases), vises dens advarsler og hændelser også på den databases side (se [Advarsler på en database](/docs/telemetry/databases#alerts-on-a-database)). En vært, der er angivet som en henvisning til en monitorhemmelighed, matches ikke.

## Sikkerhedsmodel

Det er følsomt at køre en forespørgsel, som kunden selv har leveret, mod en produktionsdatabase, så SQL-forespørgsel-monitoren er skrivebeskyttet fra starten og lægger flere kontroller oven på hinanden:

| Kontrol | Hvad den gør |
|---|---|
| **Databasebruger med færrest mulige rettigheder** (primær kontrol) | Forbind altid med en dedikeret, skrivebeskyttet databasebruger, der kun har adgang til de tabeller, forespørgslen har brug for. Det er den vigtigste kontrol — se [Opret en skrivebeskyttet bruger](#opret-en-skrivebeskyttet-bruger). |
| **Skrivebeskyttet udførelse** | På PostgreSQL og MySQL åbner sonden en `READ ONLY`-transaktion, som afviser enhver skrivning (også skrivende CTE'er) uanset forespørgslens tekst. På Microsoft SQL Server, som ikke har en skrivebeskyttet transaktion, kører sonden inde i en transaktion, der altid rulles tilbage. |
| **Én sætning, tilladte forespørgsler** | Forespørgslen skal være én sætning, der starter med `SELECT`, `WITH`, `VALUES` eller `TABLE`. Stablede sætninger (`SELECT 1; DROP TABLE …`) og skrive- eller DDL-nøgleord som `INSERT`, `UPDATE`, `DELETE`, `DROP`, `EXEC` og `INTO` afvises af sonden, før den forbinder. Denne kontrol er et sikkerhedsnet, ikke grænsen: det er den skrivebeskyttede bruger. |
| **Tidsgrænse for sætningen** | Hver forespørgsel har en hård tidsgrænse. En forespørgsel, der kører for længe, annulleres. |
| **Begrænsede rækker** | Der læses aldrig flere end Max Rows rækker tilbage (plus én, for at opdage afkortning), hvilket begrænser sondens hukommelse og mængden af data. |
| **Maskering af legitimationsoplysninger** | Databasefejl renses, før de gemmes — adgangskoden, værten, brugernavnet og databasenavnet og enhver forbindelsesstreng maskeres, så legitimationsoplysninger aldrig slipper ud i fejlmeddelelser. |

## Før du begynder

- En **sonde** med netværksadgang til din databases vært og port. Det kan være en sonde, som OneUptime hoster (hvis din database kan nås fra internettet), eller en [brugerdefineret sonde](/docs/probe/custom-probe), der kører inde i dit netværk.
- En **skrivebeskyttet databasebruger** og forbindelsesoplysningerne (vært, port, databasenavn, brugernavn, adgangskode) eller en skrivebeskyttet Windows- eller domæneidentitet, når du bruger integreret godkendelse i SQL Server.

## Opret en skrivebeskyttet bruger

Forbind altid med en dedikeret skrivebeskyttet bruger. Kør sætningerne for din motor som administrator, og erstat `orders` med din database:

:::tabs
@tab PostgreSQL
```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- Include tables created in the future:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO oneuptime_ro;
```
@tab MySQL
```sql
-- MySQL
CREATE USER 'oneuptime_ro'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON orders.* TO 'oneuptime_ro'@'%';
FLUSH PRIVILEGES;
```
@tab Microsoft SQL Server
```sql
-- Microsoft SQL Server
CREATE LOGIN oneuptime_ro WITH PASSWORD = 'a-strong-password';
USE orders;
CREATE USER oneuptime_ro FOR LOGIN oneuptime_ro;
ALTER ROLE db_datareader ADD MEMBER oneuptime_ro;
```
:::

Vil du give snævrere rettigheder, så giv brugeren `SELECT` på kun de tabeller, din forespørgsel læser.

## Opret en SQL-forespørgsel-monitor

:::steps
### Start en ny monitor

Gå til **Monitorer**, og klik på **Opret monitor**. Under **Monitortype** skal du klikke på **Flere monitortyper** og vælge **SQL Query** under **Database Monitoring** eller skrive `query` i søgefeltet. Angiv et **Navn**, og klik derefter på **Næste**.

### Angiv forbindelsesoplysningerne

Vælg **Database Type** — porten skifter til den motors standard — og udfyld derefter værten, databasenavnet og den skrivebeskyttede brugers legitimationsoplysninger. Henvis til adgangskoden som en [monitorhemmelighed](#brug-en-monitorhemmelighed-til-adgangskoden) i stedet for at skrive den. Hvert felt er beskrevet under [Konfiguration](#konfiguration).

### Angiv forespørgslen

Skriv én skrivebeskyttet sætning i **SQL Query** (se [Skriv forespørgslen](#skriv-forespørgslen)).

### Test den

Klik på **Test monitor** for at køre forespørgslen én gang fra en sonde, før du gemmer.

### Angiv kriterierne

Gennemgå de kriterier, monitoren starter med, og tilføj dine egne — se [Opsæt kriterier](#opsæt-kriterier). Klik derefter på **Næste**.

### Vælg sonder, og opret

Vælg de **Sonder**, der kan nå databasen, og et **Overvågningsinterval**, og klik derefter på **Opret monitor**.
:::

## Konfiguration

| Felt | Hvad du angiver |
|---|---|
| **Database Type** | PostgreSQL, MySQL eller Microsoft SQL Server. Når du vælger en type, sættes standardporten. |
| **Vært** | Den databasevært, sonden kan nå (for eksempel `db.internal`). |
| **Port** | Databasens port. |
| **Databasenavn** | Den database, forespørgslen køres mod. |
| **Use Windows Integrated Authentication** | Kun Microsoft SQL Server. Godkend med den konto, sonden kører som, i stedet for med et SQL-brugernavn og en adgangskode. Se [Integreret Windows-godkendelse](#integreret-windows-godkendelse). |
| **Brugernavn** | En skrivebeskyttet databasebruger med færrest mulige rettigheder. |
| **Adgangskode** | Databasens adgangskode. Vi anbefaler kraftigt at henvise til en [monitorhemmelighed](/docs/monitor/monitor-secrets) med `{{monitorSecrets.name}}` i stedet for at skrive adgangskoden som ren tekst (se [Brug en monitorhemmelighed til adgangskoden](#brug-en-monitorhemmelighed-til-adgangskoden)). |
| **SQL Query** | Den skrivebeskyttede forespørgsel, der skal køres (se [Skriv forespørgslen](#skriv-forespørgslen)). |
| **Use SSL/TLS** | Slå til for at forbinde over TLS. Når det er slået til, kan du slå **Verify server certificate** fra, hvis databasen bruger et selvsigneret certifikat. |

### Flere felter

| Felt | Standard | Maksimum | Hvad det begrænser |
|---|---|---|---|
| **Connection Timeout (ms)** | `10000` | `30000` | Hvor længe der ventes på at oprette en forbindelse. |
| **Statement Timeout (ms)** | `15000` | `60000` | Den hårde grænse for, hvor længe forespørgslen må køre. |
| **Max Rows** | `100` | `1000` | Den øvre grænse for, hvor mange rækker der læses tilbage fra databasen. |

En værdi over maksimum sænkes til maksimum.

### Integreret Windows-godkendelse

For Microsoft SQL Server skal du slå **Use Windows Integrated Authentication** til for at åbne en betroet forbindelse med sondeprocessens identitet. Felterne Brugernavn og Adgangskode ignoreres i denne tilstand og sendes ikke videre til driveren. Fordi sonden har brug for en identitet, som dit domæne har tillid til, skal du bruge en selvhostet sonde til denne godkendelsestilstand.

| Sonden kører på | Hvad du skal sætte op |
|---|---|
| **Windows** | Kør sondetjenesten som en domænekonto, der har et skrivebeskyttet SQL Server-login. |
| **Linux eller macOS** | Konfigurér Kerberos til SQL Server-domænet, og giv sondeprocessen en gyldig billet (for eksempel via en keytab). Det officielle Linux-image til sonden indeholder Microsoft ODBC Driver 18, unixODBC og Kerberos-klienten. Montér Kerberos-konfigurationen og billetcachen i containeren, gør dem læsbare for sondeprocessen, og sæt `KRB5_CONFIG` eller `KRB5CCNAME`, når de ikke ligger på standardplaceringen. |

Sonden har brug for en Microsoft ODBC Driver for SQL Server installeret på den vært, den kører på. Det officielle sonde-image indeholder **ODBC Driver 18**. Når du kører en selvhostet eller brugerdefineret sonde, finder og bruger sonden automatisk den nyeste `ODBC Driver N for SQL Server`, der er registreret på værten (for eksempel Driver 17, hvis det er den, der er installeret) — du behøver ikke have præcis Driver 18. For at låse en bestemt driver skal du sætte miljøvariablen `SQL_SERVER_ODBC_DRIVER` på sonden til driverens nøjagtige navn (for eksempel `ODBC Driver 17 for SQL Server`).

SQL Server skal have et passende service principal name `MSSQLSvc`, urene på sonden og domænecontrolleren skal være synkroniserede, og sonden skal kunne slå SQL Server op og nå den via det værtsnavn, som det service principal name dækker. Giv kun den betroede identitet de databaserettigheder, overvågningsforespørgslen har brug for.

## Skriv forespørgslen

Forespørgslen skal være **én skrivebeskyttet sætning**. Den skal starte med `SELECT`, `WITH`, `VALUES` eller `TABLE`. Et afsluttende semikolon er tilladt; flere sætninger er ikke. Skrive- og DDL-nøgleord afvises overalt i forespørgslen — også `INTO`, så `SELECT … INTO` afvises også.

Sonden tjekker forespørgslen ved hver kontrol, ikke når du gemmer. En forespørgsel, der bryder disse regler, bliver gemt, og derefter mislykkes hver kontrol med "Only read-only queries are allowed (must start with SELECT, WITH, VALUES, or TABLE)." — standardkriterierne sætter monitoren offline.

Hold forespørgslerne billige og afgrænsede — de kører ved hver kontrol, så foretræk indekserede kolonner og smalle tidsvinduer. Denne forespørgsel tæller de ordrer, der er annulleret i de seneste fem minutter:

:::tabs
@tab PostgreSQL
```sql
-- Count recent cancellations (PostgreSQL)
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```
@tab MySQL
```sql
-- The same idea on MySQL
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```
@tab Microsoft SQL Server
```sql
-- The same idea on Microsoft SQL Server
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```
:::

> [!TIP]
> For en forespørgsel i stil med `COUNT(*)` er antallet tilgængeligt både som **Row Count** (som er `1`, fordi der returneres én række) og som **Skalarværdi** (selve antallet, fra den første kolonne). Vil du advare på "hvor mange", så sammenlign med **Skalarværdi**.

## Brug en monitorhemmelighed til adgangskoden

For at databasens adgangskode aldrig gemmes som ren tekst på monitoren skal du oprette en [monitorhemmelighed](/docs/monitor/monitor-secrets) og henvise til den fra feltet Adgangskode:

:::steps
1. Gå til **Monitorer → Indstillinger → Hemmeligheder**, og opret en monitorhemmelighed.
2. Giv den et navn (for eksempel `dbPassword`), og giv denne monitor adgang til den.
3. Skriv `{{monitorSecrets.dbPassword}}` i monitorens felt **Adgangskode**.
:::

OneUptime løser hemmeligheden op på serveren, før konfigurationen gives videre til sonden. OneUptime opretter aldrig disse hemmeligheder for dig — det er dit valg at henvise til en. Felterne **Brugernavn**, **Vært**, **Databasenavn** og **SQL Query** accepterer også henvisninger til hemmeligheder; **Port** gør ikke.

## Opsæt kriterier

Tilføj kriterier for at afgøre, hvornår monitoren betragtes som online, forringet eller offline. Disse kontroller er tilgængelige for en SQL-forespørgsel-monitor:

| Filtertype | Hvad den tjekker |
|---|---|
| **SQL Is Online** | Om databasen kunne nås, og om forespørgslen lykkedes. |
| **SQL Query Row Count** | Antallet af returnerede rækker. Sammenlign med operatorer som større end, mindre end eller lig med. |
| **SQL Query Scalar Value** | Den første kolonne i den første række. Sammenlignes som et tal, når den værdi, du angiver, er et tal, og ellers som en streng. Det er den kontrol, du skal bruge til forespørgsler i stil med `COUNT(*)`. |
| **SQL Query Execution Time (in ms)** | Hvor længe forespørgslen tog. Nyttig til at fange en langsom database. |
| **SQL Query Error** | Forespørgslens fejlmeddelelse. Advar, når den er (eller ikke er) tom eller matcher en bestemt streng. |
| **JavaScript Expression** | Evaluér et brugerdefineret JavaScript-udtryk over `rowCount`, `scalarValue`, `firstRow`, `executionTimeInMs`, `queryError` og `isOnline`. Se [JavaScript-udtryk](/docs/monitor/javascript-expression#monitorer-for-sql-forespørgsler). |

Numeriske tærskler er hele tal: skriv `10`, ikke `10.5`. SQL Query-filtre kan ikke evalueres over en tidsperiode; hver kontrol står for sig selv.

En ny SQL-forespørgsel-monitor starter med to kriterier: **SQL Is Online** er falsk — monitoren går offline og erklærer en hændelse, der løser sig selv — og **SQL Is Online** er sand, hvilket markerer den som online. **Tilføj kriterier** tilføjer et nederst; træk det op over online-kriteriet, fordi kriterierne tjekkes oppefra, og det første, der matcher, afgør det.

### Eksempel: advar, når annulleringer stiger kraftigt

Med forespørgslen ovenfor:

| Kriterium | Filter |
|---|---|
| **Forringet** | `SQL Query Scalar Value` er større end `10`. |
| **Offline** | `SQL Query Scalar Value` er større end `50`, eller `SQL Is Online` er `false`. |

Knyt en vagtpolitik til kriteriet, så de rette personer bliver tilkaldt. En SQL-forespørgsel-monitor har ingen egne skabelonvariabler: en hændelses titel kan nævne monitoren med `{{monitorName}}`, men kan ikke citere forespørgslens resultat.

## Ting at overveje

- Forespørgslen kører ved hver kontrol, så hold den billig. Brug indekser og smalle tidsvinduer, og stol på Statement Timeout som sikkerhedsnet.
- Kun antallet af rækker, den første celle (skalar) og den første række rapporteres — design din forespørgsel, så den værdi, du vil advare på, er den første kolonne.
- Hvis resultatet afkortes, fordi det oversteg Max Rows, viser kontrollens resumé **Rows Truncated**: "Yes (result capped)". Hæv kun Max Rows, hvis du har brug for det; større resultatsæt koster mere hukommelse på sonden.
- Skrivninger og DDL afvises altid. Hvis du skal teste en skrivesti, er det ikke det, denne monitor er til.
- Foretræk en monitorhemmelighed frem for en adgangskode i ren tekst, så legitimationsoplysningerne forbliver krypteret, når de er gemt.
- En kontrol, hvis forespørgsel mislykkes, forsøges igen et sekund senere, op til tre gange mere, før den rapporterer fejlen, så et kort forbindelsestab ikke sætter monitoren offline. På en selvhostet sonde bestemmer `PROBE_MONITOR_RETRY_LIMIT`, hvor mange gange.

## Fejlfinding

:::details Hver kontrol mislykkes med "Only read-only queries are allowed"
Forespørgslen starter ikke med `SELECT`, `WITH`, `VALUES` eller `TABLE`. En kommentar foran er fin; en `SET` eller en `DECLARE` er ikke. Omskriv den som én skrivebeskyttet sætning.
:::

:::details En kontrol mislykkes med "Disallowed SQL keyword"
Et skrive-, DDL- eller udførelsesnøgleord optræder et sted i forespørgslen, selv inde i en `SELECT`, for eksempel `INTO` eller `EXEC`. Ord i strenge i anførselstegn og i kommentarer tæller ikke. Fjern nøgleordet, eller læg logikken i et view, som den skrivebeskyttede bruger kan læse.
:::

:::details Kontrollen får timeout
Sonden kunne ikke forbinde inden for **Connection Timeout (ms)**, eller forespørgslen kørte længere end **Statement Timeout (ms)**. Tjek, at sonden kan nå værten og porten, og gør derefter forespørgslen billigere: filtrér på indekserede kolonner over et kort tidsvindue.
:::

:::details Forbindelsen mislykkes med en certifikatfejl
Databasens certifikat er selvsigneret, eller sonden har ikke tillid til det. Slå **Verify server certificate** fra, som vises, når **Use SSL/TLS** er slået til, eller giv databasen et certifikat, som sonden har tillid til.
:::

:::details Integreret Windows-godkendelse mislykkes
Sonden har brug for en Microsoft ODBC Driver for SQL Server og en identitet, som dit domæne har tillid til. Kør det officielle sonde-image, eller installér driveren, og tjek derefter opsætningen under [Integreret Windows-godkendelse](#integreret-windows-godkendelse).
:::

## Næste trin

:::cards
- [Databasetilstands-monitor](/docs/monitor/database-health-monitor): Hold øje med forbindelser, låse og replikering uden at skrive SQL.
- [Monitorhemmeligheder](/docs/monitor/monitor-secrets): Hold databasens adgangskode krypteret.
- [JavaScript-udtryk](/docs/monitor/javascript-expression): Skriv kriterier, der kombinerer flere værdier.
- [Brugerdefinerede probes](/docs/probe/custom-probe): Kør kontroller inde fra dit netværk.
:::

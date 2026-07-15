# SQL-forespørgselsmonitor

SQL-forespørgselsmonitoren kører en skrivebeskyttet SQL-forespørgsel efter en tidsplan fra en probe og advarer på baggrund af resultatet — antallet af returnerede rækker, en skalarværdi, hvor lang tid forespørgslen tog, eller en forespørgselsfejl. Den er bygget til brugsscenariet "kør en forespørgsel og åbn en hændelse", for eksempel til at advare, når antallet af annullerede ordrer i de sidste fem minutter stiger kraftigt, når en kø-tabel vokser sig for stor, eller når en kritisk række forsvinder.

Fordi forespørgslen kører fra en probe inde i dit netværk, behøver OneUptime aldrig en direkte forbindelse til din database, og det fulde resultatsæt forlader aldrig proben — kun en lille, afgrænset projektion af resultatet rapporteres tilbage.

## Understøttede databaser

SQL-forespørgselsmonitoren understøtter følgende databasemotorer:

- **PostgreSQL** (standardport `5432`)
- **MySQL** (standardport `3306`)
- **Microsoft SQL Server** (standardport `1433`)

MySQL-kompatible og PostgreSQL-kompatible motorer, der taler den samme wire-protokol og SQL-dialekt, fungerer generelt også, men kun de tre motorer ovenfor er officielt testet.

## Sådan fungerer det

Ved hvert tjek forbinder proben til din database, kører din forespørgsel i en skrivebeskyttet kontekst, læser højst et afgrænset antal rækker tilbage og rapporterer en kompakt projektion til OneUptime. Din monitors kriterier evalueres derefter mod denne projektion.

Proben rapporterer kun:

- **Rækkeantal** — antallet af rækker, forespørgslen returnerede (afgrænset af grænsen Maks. rækker).
- **Skalarværdi** — den første kolonne i den første række. Dette er den naturlige værdi for en forespørgsel af typen `SELECT COUNT(*)`.
- **Første række** — den første række som et sæt kolonne/værdi-par, vist i tjek-oversigten som kontekst.
- **Eksekveringstid** — hvor lang tid forespørgslen tog, i millisekunder.
- **Forespørgselsfejl** — en saneret fejlmeddelelse, hvis forespørgslen mislykkedes.

Det fulde resultatsæt sendes aldrig til OneUptime, så kundedata replikeres ikke ind i OneUptimes lager.

## Sikkerhedsmodel

At køre en kundeleveret forespørgsel mod en produktionsdatabase er følsomt, så SQL-forespørgselsmonitoren er skrivebeskyttet by design og lægger flere sikkerhedskontroller oven på hinanden:

- **Databasebruger med færrest mulige rettigheder (primær kontrol).** Du bør altid forbinde med en dedikeret, skrivebeskyttet databasebruger, der kun har adgang til de tabeller, forespørgslen har brug for. Dette er den vigtigste kontrol — se Opret en skrivebeskyttet bruger nedenfor.
- **Skrivebeskyttet eksekvering.** På PostgreSQL og MySQL åbner proben en `READ ONLY`-transaktion, som afviser enhver skrivning (inklusive skrivbare CTE'er) uanset forespørgselsteksten. På Microsoft SQL Server, som ikke har nogen skrivebeskyttet transaktion, kører proben inde i en transaktion, der altid rulles tilbage.
- **Enkeltsætnings-forespørgsler på tilladelsesliste.** Forespørgslen skal være en enkelt sætning, der starter med `SELECT`, `WITH`, `VALUES` eller `TABLE`. Stablede sætninger (`SELECT 1; DROP TABLE …`) og skrivninger/DDL afvises, før proben forbinder. Kontrollen tager højde for kommentarer og strengliteraler, så et nøgleord skjult i en kommentar eller streng slipper ikke igennem.
- **Sætningstimeout.** Hver forespørgsel har en hård tidsgrænse. En forespørgsel, der kører for længe, annulleres.
- **Afgrænsede rækker.** Der læses aldrig mere end Maks. rækker (plus én, for at kunne registrere afkortning) rækker tilbage, hvilket begrænser probens hukommelsesforbrug og payload-størrelse.
- **Redigering af legitimationsoplysninger.** Databasefejl saneres, før de gemmes — adgangskoden og enhver forbindelsesstreng redigeres væk, så legitimationsoplysninger aldrig lækker ind i fejlmeddelelser.

## Forudsætninger

- En **probe** med netværksadgang til din databases host og port. Dette kan være en OneUptime-hostet probe (hvis din database er tilgængelig fra internettet) eller en selv-hostet probe, der kører inde i dit netværk. Se probe-dokumentationen for, hvordan du installerer en brugerdefineret probe.
- En **skrivebeskyttet databasebruger** og forbindelsesoplysningerne (host, port, databasenavn, brugernavn, adgangskode).

## Konfiguration

Opret en ny monitor og vælg **SQL Query** som monitortype, og udfyld derefter forbindelsesoplysningerne:

- **Databasetype** — PostgreSQL, MySQL eller Microsoft SQL Server. Valg af en type indstiller standardporten.
- **Host** — databasens host, der er tilgængelig fra proben (for eksempel `db.internal`).
- **Port** — databasens port.
- **Databasenavn** — den database, forespørgslen skal køres mod.
- **Brugernavn** — en skrivebeskyttet databasebruger med færrest mulige rettigheder.
- **Adgangskode** — databasens adgangskode. Vi anbefaler kraftigt at referere til en [Monitor Secret](/docs/monitor/monitor-secrets) med `{{monitorSecrets.name}}` i stedet for at indtaste adgangskoden i klartekst (se nedenfor).
- **SQL-forespørgsel** — den skrivebeskyttede forespørgsel, der skal køres (se Skrivning af forespørgslen).
- **Brug SSL/TLS** — aktivér for at forbinde over TLS. Når det er aktiveret, kan du slå **Verificer servercertifikat** fra, hvis databasen bruger et selvsigneret certifikat.

### Avancerede indstillinger

- **Forbindelsestimeout (ms)** — hvor længe der ventes på at etablere en forbindelse. Standard `10000`, maksimum `30000`.
- **Sætningstimeout (ms)** — den hårde grænse for, hvor længe forespørgslen må køre. Standard `15000`, maksimum `60000`.
- **Maks. rækker** — den øvre grænse for rækker, der læses tilbage fra databasen. Standard `100`, maksimum `1000`.

## Skrivning af forespørgslen

Forespørgslen skal være **en enkelt skrivebeskyttet sætning**. Den skal starte med en af `SELECT`, `WITH`, `VALUES` eller `TABLE`. Et enkelt afsluttende semikolon er tilladt; flere sætninger er ikke.

Hold forespørgsler billige og velafgrænsede — de kører ved hvert tjek, så foretræk indekserede kolonner og smalle tidsvinduer.

```sql
-- Tæl seneste annulleringer (PostgreSQL)
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```

```sql
-- Samme idé på MySQL
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```

```sql
-- Samme idé på Microsoft SQL Server
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```

For en forespørgsel af typen `COUNT(*)` er tællingen tilgængelig både som **Rækkeantal** (som er `1`, da der returneres én række) og som **Skalarværdi** (selve tællingen, fra den første kolonne). For at advare om "hvor mange" skal du sammenligne mod **Skalarværdi**.

## Brug af en Monitor Secret til adgangskoden

For at databasens adgangskode aldrig gemmes i klartekst på monitoren, skal du oprette en [Monitor Secret](/docs/monitor/monitor-secrets) og referere til den fra feltet Adgangskode:

1. Gå til OneUptime Dashboard → Projektindstillinger → Monitor Secrets → Opret Monitor Secret.
2. Opret en hemmelighed (for eksempel `dbPassword`) og giv denne monitor adgang til den.
3. I monitorens felt Adgangskode skal du indtaste `{{monitorSecrets.dbPassword}}`.

OneUptime opløser hemmeligheden på serversiden, før konfigurationen overdrages til proben. OneUptime opretter aldrig disse hemmeligheder for dig — det er dit eget valg at referere til en.

## Opsætning af kriterier

Tilføj kriterier for at afgøre, hvornår monitoren betragtes som online, forringet eller offline. Følgende kontroller er tilgængelige for en SQL-forespørgselsmonitor:

- **SQL er online** — hvorvidt databasen kunne nås, og forespørgslen lykkedes.
- **SQL-forespørgsel rækkeantal** — antallet af returnerede rækker. Sammenlign med operatorer som større end, mindre end eller lig med.
- **SQL-forespørgsel skalarværdi** — den første kolonne i den første række. Sammenlignes numerisk, når begge sider ser numeriske ud, ellers som strenge. Dette er den kontrol, du skal bruge til forespørgsler af typen `COUNT(*)`.
- **SQL-forespørgsel eksekveringstid (i ms)** — hvor lang tid forespørgslen tog. Nyttig til at fange en langsom database.
- **SQL-forespørgsel fejl** — forespørgslens fejlmeddelelse. Advar, når den er (eller ikke er) tom, eller matcher en bestemt streng.
- **JavaScript-udtryk** — evaluer et brugerdefineret JavaScript-udtryk for fuld kontrol. Se [JavaScript-udtryk](/docs/monitor/javascript-expression).

### Eksempel: advar, når annulleringer stiger kraftigt

Ved brug af forespørgslen ovenfor:

- **Kriterium: Forringet** — `SQL-forespørgsel skalarværdi` er større end `10`.
- **Kriterium: Offline** — `SQL-forespørgsel skalarværdi` er større end `50`, eller `SQL er online` er `false`.

Tilknyt en vagtplan til kriterierne, så de rette personer tilkaldes.

## Opret en skrivebeskyttet bruger

Forbind altid med en dedikeret skrivebeskyttet bruger. Eksempler:

```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- Inkludér tabeller, der oprettes i fremtiden:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO oneuptime_ro;
```

```sql
-- MySQL
CREATE USER 'oneuptime_ro'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON orders.* TO 'oneuptime_ro'@'%';
FLUSH PRIVILEGES;
```

```sql
-- Microsoft SQL Server
CREATE LOGIN oneuptime_ro WITH PASSWORD = 'a-strong-password';
USE orders;
CREATE USER oneuptime_ro FOR LOGIN oneuptime_ro;
ALTER ROLE db_datareader ADD MEMBER oneuptime_ro;
```

## Ting at overveje

- Forespørgslen kører ved hvert tjek, så hold den billig. Brug indekser og smalle tidsvinduer, og stol på Sætningstimeout som en sidste sikkerhed.
- Kun rækkeantallet, den første celle (skalar) og den første række rapporteres — udform din forespørgsel, så den værdi, du vil advare på, er den første kolonne.
- Hvis resultatet afkortes, fordi det overskred Maks. rækker, markerer tjek-oversigten det som begrænset. Forøg kun Maks. rækker, hvis du har brug for det; større resultatsæt koster mere hukommelse på proben.
- Skrivninger og DDL afvises altid. Hvis du har brug for at teste en skrivesti, er det ikke det, denne monitor er til.
- Foretræk en Monitor Secret frem for en adgangskode i klartekst, så legitimationsoplysningen forbliver krypteret i hvile.

# SQL-spørring-monitor

SQL-spørring-monitoren kjører en skrivebeskyttet SQL-spørring etter en tidsplan fra en probe og varsler basert på resultatet — antallet rader som returneres, en skalarverdi, hvor lang tid spørringen tok, eller en spørringsfeil. Den er bygget for bruksområdet «kjør en spørring og opprett en hendelse», for eksempel for å varsle når antallet kansellerte ordrer de siste fem minuttene stiger kraftig, når en kø-tabell vokser seg for stor, eller når en kritisk rad forsvinner.

Fordi spørringen kjøres fra en probe inne i nettverket ditt, trenger OneUptime aldri en direkte tilkobling til databasen din, og hele resultatsettet forlater aldri proben — bare en liten, avgrenset projeksjon av resultatet rapporteres tilbake.

## Støttede databaser

SQL-spørring-monitoren støtter følgende databasemotorer:

- **PostgreSQL** (standardport `5432`)
- **MySQL** (standardport `3306`)
- **Microsoft SQL Server** (standardport `1433`)

MySQL-kompatible og PostgreSQL-kompatible motorer som bruker samme wire-protokoll og SQL-dialekt fungerer vanligvis også, men bare de tre motorene ovenfor er offisielt testet.

## Slik fungerer det

Ved hver sjekk kobler proben seg til databasen din, kjører spørringen din i en skrivebeskyttet kontekst, leser tilbake maksimalt et avgrenset antall rader, og rapporterer en kompakt projeksjon til OneUptime. Monitorens kriterier evalueres deretter mot den projeksjonen.

Proben rapporterer kun:

- **Row Count** — antallet rader spørringen returnerte (avgrenset av Max Rows-grensen).
- **Scalar Value** — den første kolonnen i den første raden. Dette er den naturlige verdien for en spørring av typen `SELECT COUNT(*)`.
- **First Row** — den første raden som et sett med kolonne/verdi-par, vist i sjekksammendraget for kontekst.
- **Execution Time** — hvor lang tid spørringen tok, i millisekunder.
- **Query Error** — en renset feilmelding dersom spørringen mislyktes.

Hele resultatsettet sendes aldri til OneUptime, så kundedata replikeres ikke inn i OneUptime-lagring.

## Sikkerhetsmodell

Å kjøre en kundelevert spørring mot en produksjonsdatabase er sensitivt, så SQL-spørring-monitoren er skrivebeskyttet av design og legger flere kontroller i lag:

- **Databasebruker med minst mulige rettigheter (primær kontroll).** Du bør alltid koble til med en dedikert, skrivebeskyttet databasebruker som kun har tilgang til tabellene spørringen trenger. Dette er den viktigste kontrollen — se Opprett en skrivebeskyttet bruker nedenfor.
- **Skrivebeskyttet kjøring.** På PostgreSQL og MySQL åpner proben en `READ ONLY`-transaksjon, som avviser enhver skriving (inkludert skrivbare CTE-er) uavhengig av spørringsteksten. På Microsoft SQL Server, som ikke har noen skrivebeskyttet transaksjon, kjører proben inne i en transaksjon som alltid rulles tilbake.
- **Enkeltsetnings-spørringer på tillatelsesliste.** Spørringen må være en enkelt setning som starter med `SELECT`, `WITH`, `VALUES` eller `TABLE`. Stablede setninger (`SELECT 1; DROP TABLE …`) og skrivinger/DDL avvises før proben kobler til. Sjekken tar hensyn til kommentarer og strengliteraler, så et nøkkelord skjult i en kommentar eller streng slipper ikke gjennom.
- **Setningstidsavbrudd.** Hver spørring har en hard tidsgrense. En spørring som kjører for lenge, avbrytes.
- **Avgrensede rader.** Kun opptil Max Rows (pluss én, for å oppdage avkorting) rader leses noensinne tilbake, noe som begrenser probens minnebruk og nyttelaststørrelse.
- **Sladding av påloggingsinformasjon.** Databasefeil renses før de lagres — passordet og enhver tilkoblingsstreng sladdes, så påloggingsinformasjon lekker aldri ut i feilmeldinger.

## Forutsetninger

- En **probe** med nettverkstilgang til databasens vert og port. Dette kan være en OneUptime-vertsbasert probe (hvis databasen din er tilgjengelig fra internett) eller en selvhostet probe som kjører inne i nettverket ditt. Se probe-dokumentasjonen for hvordan du installerer en egendefinert probe.
- En **skrivebeskyttet databasebruker** og tilkoblingsdetaljene (vert, port, databasenavn, brukernavn, passord).

## Konfigurasjon

Opprett en ny monitor og velg **SQL Query** som monitortype, og fyll deretter inn tilkoblingsdetaljene:

- **Database Type** — PostgreSQL, MySQL eller Microsoft SQL Server. Å velge en type angir standardporten.
- **Host** — databaseverten som er tilgjengelig fra proben (for eksempel `db.internal`).
- **Port** — databaseporten.
- **Database Name** — databasen spørringen skal kjøres mot.
- **Username** — en skrivebeskyttet databasebruker med minst mulige rettigheter.
- **Password** — databasepassordet. Vi anbefaler på det sterkeste å referere til en [Monitor Secret](/docs/monitor/monitor-secrets) med `{{monitorSecrets.name}}` i stedet for å skrive passordet i klartekst (se nedenfor).
- **SQL Query** — den skrivebeskyttede spørringen som skal kjøres (se Skrive spørringen).
- **Use SSL/TLS** — aktiver for å koble til over TLS. Når dette er aktivert, kan du slå av **Verify server certificate** hvis databasen bruker et selvsignert sertifikat.

### Avanserte alternativer

- **Connection Timeout (ms)** — hvor lenge man skal vente på å etablere en tilkobling. Standard `10000`, maksimum `30000`.
- **Statement Timeout (ms)** — den harde grensen for hvor lenge spørringen kan kjøre. Standard `15000`, maksimum `60000`.
- **Max Rows** — den øvre grensen for rader som leses tilbake fra databasen. Standard `100`, maksimum `1000`.

## Skrive spørringen

Spørringen må være en **enkelt skrivebeskyttet setning**. Den må starte med en av `SELECT`, `WITH`, `VALUES` eller `TABLE`. Ett avsluttende semikolon er tillatt; flere setninger er det ikke.

Hold spørringene rimelige og godt avgrensede — de kjøres ved hver sjekk, så foretrekk indekserte kolonner og smale tidsvinduer.

```sql
-- Tell nylige kanselleringer (PostgreSQL)
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

For en spørring av typen `COUNT(*)` er antallet tilgjengelig både som **Row Count** (som er `1`, siden én rad returneres) og som **Scalar Value** (selve antallet, fra den første kolonnen). For å varsle på «hvor mange», sammenlign mot **Scalar Value**.

## Bruke en Monitor Secret for passordet

For at databasepassordet aldri skal lagres i klartekst på monitoren, opprett en [Monitor Secret](/docs/monitor/monitor-secrets) og referer til den fra Password-feltet:

1. Gå til OneUptime Dashboard → Project Settings → Monitor Secrets → Create Monitor Secret.
2. Opprett en hemmelighet (for eksempel `dbPassword`) og gi denne monitoren tilgang til den.
3. I Password-feltet på monitoren, skriv inn `{{monitorSecrets.dbPassword}}`.

OneUptime løser hemmeligheten på serversiden før konfigurasjonen sendes til proben. OneUptime oppretter aldri disse hemmelighetene for deg — å referere til en er ditt eget valg.

## Sette opp kriterier

Legg til kriterier for å bestemme når monitoren anses som tilgjengelig, degradert eller utilgjengelig. Følgende kontroller er tilgjengelige for en SQL-spørring-monitor:

- **SQL Is Online** — om databasen var tilgjengelig og spørringen lyktes.
- **SQL Query Row Count** — antallet rader som returneres. Sammenlign med operatorer som større enn, mindre enn eller lik.
- **SQL Query Scalar Value** — den første kolonnen i den første raden. Sammenlignes numerisk når begge sider ser numeriske ut, ellers som strenger. Dette er kontrollen du bør bruke for spørringer av typen `COUNT(*)`.
- **SQL Query Execution Time (in ms)** — hvor lang tid spørringen tok. Nyttig for å fange opp en treg database.
- **SQL Query Error** — feilmeldingen fra spørringen. Varsle når den er (eller ikke er) tom, eller samsvarer med en spesifikk streng.
- **JavaScript Expression** — evaluer et egendefinert JavaScript-uttrykk for full kontroll. Se [JavaScript-uttrykk](/docs/monitor/javascript-expression).

### Eksempel: varsle når kanselleringer stiger kraftig

Med spørringen ovenfor:

- **Kriterium: Degradert** — `SQL Query Scalar Value` er større enn `10`.
- **Kriterium: Utilgjengelig** — `SQL Query Scalar Value` er større enn `50`, eller `SQL Is Online` er `false`.

Knytt en on-call-policy til kriteriene slik at de riktige personene blir varslet.

## Opprett en skrivebeskyttet bruker

Koble alltid til med en dedikert skrivebeskyttet bruker. Eksempler:

```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- Inkluder tabeller som opprettes i fremtiden:
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

## Ting å vurdere

- Spørringen kjøres ved hver sjekk, så hold den rimelig. Bruk indekser og smale tidsvinduer, og stol på Statement Timeout som en sikkerhetsmekanisme.
- Kun antall rader, første celle (skalar) og første rad rapporteres — utform spørringen din slik at verdien du vil varsle på, er den første kolonnen.
- Hvis resultatet avkortes fordi det overskred Max Rows, markerer sjekksammendraget det som avkortet. Øk Max Rows kun hvis du trenger det; større resultatsett koster mer minne på proben.
- Skrivinger og DDL avvises alltid. Hvis du trenger å teste en skrivebane, er ikke det denne monitoren er ment for.
- Foretrekk en Monitor Secret fremfor et klartekst-passord slik at påloggingsinformasjonen forblir kryptert i hvile.

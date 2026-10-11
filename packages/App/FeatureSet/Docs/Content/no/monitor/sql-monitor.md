# SQL-spørring-overvåking

SQL-spørring-monitoren kjører en skrivebeskyttet SQL-spørring etter en tidsplan fra en sonde og varsler på resultatet — antall returnerte rader, en skalarverdi, hvor lang tid spørringen tok, eller en spørringsfeil. Den er laget for bruksområdet "kjør en spørring og åpne en hendelse", for eksempel å varsle når antall kansellerte bestillinger de siste fem minuttene skyter i været, når en kø-tabell blir for stor, eller når en kritisk rad forsvinner.

:::cards
- [Opprett en skrivebeskyttet bruker](#opprett-en-skrivebeskyttet-bruker): Databasepåloggingen monitoren skal bruke.
- [Opprett monitoren](#opprett-en-sql-spørring-monitor): Koble til en sonde, og skriv inn spørringen.
- [Skriv spørringen](#skriv-spørringen): Legg verdien du varsler på, i den første kolonnen.
- [Sett opp kriterier](#sett-opp-kriterier): Varsle på et antall, en verdi, en treg spørring eller en feil.
:::

## Slik fungerer det

Ved hver kontroll kobler sonden seg til databasen din, kjører spørringen din i en skrivebeskyttet kontekst, leser tilbake høyst et begrenset antall rader og rapporterer en kompakt projeksjon til OneUptime. Monitorens kriterier evalueres deretter mot den projeksjonen.

Fordi spørringen kjører fra en sonde inne i nettverket ditt, trenger OneUptime aldri en direkte tilkobling til databasen din, og hele resultatsettet forlater aldri sonden — bare en liten, begrenset projeksjon av resultatet rapporteres tilbake.

```mermaid title="Bare en liten projeksjon av resultatet forlater nettverket ditt"
sequenceDiagram
    participant O as OneUptime
    participant P as Sonde
    participant D as Databasen din
    O->>P: Monitorinnstillinger, hemmeligheter løst opp
    P->>D: Spørringen din, skrivebeskyttet
    D-->>P: Opptil Max Rows + 1 rader
    P->>O: Antall rader, skalar, første rad, tid, feil
    O->>O: Evaluer kriteriene
```

Sonden rapporterer bare:

| Verdi | Hva det er |
|---|---|
| **Row Count** | Antall rader spørringen returnerte (begrenset av grensen Max Rows). |
| **Skalarverdi** | Den første kolonnen i den første raden. Dette er den naturlige verdien for en spørring av typen `SELECT COUNT(*)`. |
| **First Row** | Den første raden som par av kolonne og verdi, vist i kontrollsammendraget som kontekst. |
| **Execution Time** | Hvor lang tid kontrollen tok, i millisekunder — tilkoblingen inkludert, ikke bare spørringen. |
| **Spørringsfeil** | En renset feilmelding hvis spørringen mislyktes. |

Hele resultatsettet sendes aldri til OneUptime, så kundedata kopieres ikke over i lagringen til OneUptime.

## Støttede databaser

| Database | Standardport |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

MySQL-kompatible og PostgreSQL-kompatible motorer som snakker samme wire-protokoll og SQL-dialekt, fungerer som regel også, men bare de tre motorene ovenfor er offisielt testet.

Når verten og porten monitoren kobler seg til, er ett av endepunktene til en database på siden [Databaser](/docs/telemetry/databases), vises varslene og hendelsene den gir, også på siden til den databasen (se [Varsler på en database](/docs/telemetry/databases#alerts-on-a-database)). En vert som er oppgitt som en henvisning til en overvåkingshemmelighet, blir ikke koblet.

## Sikkerhetsmodell

Det er sensitivt å kjøre en spørring som kunden har levert, mot en produksjonsdatabase, så SQL-spørring-monitoren er skrivebeskyttet fra grunnen av og legger flere kontroller oppå hverandre:

| Kontroll | Hva den gjør |
|---|---|
| **Databasebruker med minst mulig rettigheter** (primær kontroll) | Koble alltid til med en egen, skrivebeskyttet databasebruker som bare har tilgang til tabellene spørringen trenger. Dette er den viktigste kontrollen — se [Opprett en skrivebeskyttet bruker](#opprett-en-skrivebeskyttet-bruker). |
| **Skrivebeskyttet kjøring** | På PostgreSQL og MySQL åpner sonden en `READ ONLY`-transaksjon, som avviser all skriving (også skrivende CTE-er) uansett hva spørringen sier. På Microsoft SQL Server, som ikke har noen skrivebeskyttet transaksjon, kjører sonden inne i en transaksjon som alltid rulles tilbake. |
| **Én setning, tillatte spørringer** | Spørringen må være én setning som starter med `SELECT`, `WITH`, `VALUES` eller `TABLE`. Stablede setninger (`SELECT 1; DROP TABLE …`) og skrive- eller DDL-nøkkelord som `INSERT`, `UPDATE`, `DELETE`, `DROP`, `EXEC` og `INTO` avvises av sonden før den kobler til. Denne kontrollen er et sikkerhetsnett, ikke grensen: det er den skrivebeskyttede brukeren. |
| **Tidsavbrudd for setningen** | Hver spørring har en hard tidsgrense. En spørring som kjører for lenge, avbrytes. |
| **Begrensede rader** | Det leses aldri tilbake flere enn Max Rows rader (pluss én, for å oppdage avkorting), noe som begrenser sondens minne og datamengden. |
| **Maskering av påloggingsinformasjon** | Databasefeil renses før de lagres — passordet, verten, brukernavnet og databasenavnet og alle tilkoblingsstrenger maskeres, slik at påloggingsinformasjon aldri lekker ut i feilmeldinger. |

## Før du begynner

- En **sonde** med nettverkstilgang til verten og porten til databasen din. Det kan være en sonde som OneUptime drifter (hvis databasen din kan nås fra internett), eller en [egendefinert sonde](/docs/probe/custom-probe) som kjører inne i nettverket ditt.
- En **skrivebeskyttet databasebruker** og tilkoblingsdetaljene (vert, port, databasenavn, brukernavn, passord), eller en skrivebeskyttet Windows- eller domeneidentitet når du bruker integrert autentisering i SQL Server.

## Opprett en skrivebeskyttet bruker

Koble alltid til med en egen skrivebeskyttet bruker. Kjør setningene for motoren din som administrator, og erstatt `orders` med databasen din:

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

For strammere rettigheter kan du gi brukeren `SELECT` på bare tabellene spørringen din leser.

## Opprett en SQL-spørring-monitor

:::steps
### Start en ny monitor

Gå til **Monitorer**, og klikk på **Opprett monitor**. Under **Monitortype** klikker du på **Flere monitortyper** og velger **SQL Query** under **Database Monitoring**, eller skriver `query` i søkefeltet. Skriv inn et **Navn**, og klikk deretter på **Neste**.

### Skriv inn tilkoblingsdetaljene

Velg **Database Type** — porten endres til standarden for den motoren — og fyll deretter inn verten, databasenavnet og påloggingsinformasjonen til den skrivebeskyttede brukeren. Henvis til passordet som en [overvåkingshemmelighet](#bruk-en-overvåkingshemmelighet-for-passordet) i stedet for å skrive det inn. Hvert felt er beskrevet under [Konfigurasjon](#konfigurasjon).

### Skriv inn spørringen

Skriv én skrivebeskyttet setning i **SQL Query** (se [Skriv spørringen](#skriv-spørringen)).

### Test den

Klikk på **Test monitor** for å kjøre spørringen én gang fra en sonde før du lagrer.

### Angi kriteriene

Gå gjennom kriteriene monitoren starter med, og legg til dine egne — se [Sett opp kriterier](#sett-opp-kriterier). Klikk deretter på **Neste**.

### Velg sonder, og opprett

Velg **Sonder** som når databasen, og et **Overvåkingsintervall**, og klikk deretter på **Opprett monitor**.
:::

## Konfigurasjon

| Felt | Hva du skriver inn |
|---|---|
| **Database Type** | PostgreSQL, MySQL eller Microsoft SQL Server. Når du velger en type, settes standardporten. |
| **Vert** | Databaseverten sonden kan nå (for eksempel `db.internal`). |
| **Port** | Databaseporten. |
| **Databasenavn** | Databasen spørringen skal kjøres mot. |
| **Use Windows Integrated Authentication** | Bare Microsoft SQL Server. Autentiser med kontoen sonden kjører som, i stedet for med et SQL-brukernavn og -passord. Se [Integrert Windows-autentisering](#integrert-windows-autentisering). |
| **Brukernavn** | En skrivebeskyttet databasebruker med minst mulig rettigheter. |
| **Passord** | Databasepassordet. Vi anbefaler sterkt å henvise til en [overvåkingshemmelighet](/docs/monitor/monitor-secrets) med `{{monitorSecrets.name}}` i stedet for å skrive passordet inn som ren tekst (se [Bruk en overvåkingshemmelighet for passordet](#bruk-en-overvåkingshemmelighet-for-passordet)). |
| **SQL Query** | Den skrivebeskyttede spørringen som skal kjøres (se [Skriv spørringen](#skriv-spørringen)). |
| **Use SSL/TLS** | Slå på for å koble til over TLS. Når det er slått på, kan du slå av **Verify server certificate** hvis databasen bruker et selvsignert sertifikat. |

### Flere felt

| Felt | Standard | Maksimum | Hva det begrenser |
|---|---|---|---|
| **Connection Timeout (ms)** | `10000` | `30000` | Hvor lenge det ventes på å opprette en tilkobling. |
| **Statement Timeout (ms)** | `15000` | `60000` | Den harde grensen for hvor lenge spørringen kan kjøre. |
| **Max Rows** | `100` | `1000` | Den øvre grensen for hvor mange rader som leses tilbake fra databasen. |

En verdi over maksimum senkes til maksimum.

### Integrert Windows-autentisering

For Microsoft SQL Server slår du på **Use Windows Integrated Authentication** for å åpne en klarert tilkobling med identiteten til sondeprosessen. Feltene Brukernavn og Passord ignoreres i denne modusen og sendes ikke videre til driveren. Fordi sonden trenger en identitet som domenet ditt stoler på, bør du bruke en selvhostet sonde for denne autentiseringsmodusen.

| Sonden kjører på | Hva du må sette opp |
|---|---|
| **Windows** | Kjør sondetjenesten som en domenekonto som har en skrivebeskyttet SQL Server-pålogging. |
| **Linux eller macOS** | Konfigurer Kerberos for SQL Server-domenet, og gi sondeprosessen en gyldig billett (for eksempel via en keytab). Det offisielle Linux-bildet for sonden inneholder Microsoft ODBC Driver 18, unixODBC og Kerberos-klienten. Monter Kerberos-konfigurasjonen og billetthurtigbufferen inn i containeren, gjør dem lesbare for sondeprosessen, og sett `KRB5_CONFIG` eller `KRB5CCNAME` når de ikke ligger på standardplasseringen. |

Sonden trenger en Microsoft ODBC Driver for SQL Server installert på verten den kjører på. Det offisielle sondebildet inneholder **ODBC Driver 18**. Når du kjører en selvhostet eller egendefinert sonde, finner og bruker sonden automatisk den nyeste `ODBC Driver N for SQL Server` som er registrert på verten (for eksempel Driver 17 hvis det er den som er installert) — du trenger ikke akkurat Driver 18. For å låse en bestemt driver setter du miljøvariabelen `SQL_SERVER_ODBC_DRIVER` på sonden til det nøyaktige navnet på driveren (for eksempel `ODBC Driver 17 for SQL Server`).

SQL Server må ha et passende service principal name `MSSQLSvc`, klokkene på sonden og domenekontrolleren må være synkroniserte, og sonden må kunne slå opp og nå SQL Server via vertsnavnet som det service principal name-et dekker. Gi den klarerte identiteten bare de databaserettighetene overvåkingsspørringen trenger.

## Skriv spørringen

Spørringen må være **én skrivebeskyttet setning**. Den må starte med `SELECT`, `WITH`, `VALUES` eller `TABLE`. Et avsluttende semikolon er tillatt; flere setninger er ikke det. Skrive- og DDL-nøkkelord avvises hvor som helst i spørringen — også `INTO`, så `SELECT … INTO` avvises også.

Sonden sjekker spørringen ved hver kontroll, ikke når du lagrer. En spørring som bryter disse reglene, blir lagret, og deretter mislykkes hver kontroll med "Only read-only queries are allowed (must start with SELECT, WITH, VALUES, or TABLE)." — standardkriteriene setter monitoren som frakoblet.

Hold spørringene billige og avgrensede — de kjører ved hver kontroll, så foretrekk indekserte kolonner og smale tidsvinduer. Denne spørringen teller bestillingene som er kansellert de siste fem minuttene:

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
> For en spørring av typen `COUNT(*)` er antallet tilgjengelig både som **Row Count** (som er `1`, fordi én rad returneres) og som **Skalarverdi** (selve antallet, fra den første kolonnen). For å varsle på "hvor mange" sammenligner du med **Skalarverdi**.

## Bruk en overvåkingshemmelighet for passordet

For at databasepassordet aldri skal lagres som ren tekst på monitoren, oppretter du en [overvåkingshemmelighet](/docs/monitor/monitor-secrets) og henviser til den fra feltet Passord:

:::steps
1. Gå til **Monitorer → Innstillinger → Hemmeligheter**, og opprett en overvåkingshemmelighet.
2. Gi den et navn (for eksempel `dbPassword`), og gi denne monitoren tilgang til den.
3. Skriv `{{monitorSecrets.dbPassword}}` i monitorens felt **Passord**.
:::

OneUptime løser opp hemmeligheten på serveren før konfigurasjonen gis videre til sonden. OneUptime oppretter aldri disse hemmelighetene for deg — det er ditt valg å henvise til en. Feltene **Brukernavn**, **Vert**, **Databasenavn** og **SQL Query** godtar også henvisninger til hemmeligheter; **Port** gjør ikke det.

## Sett opp kriterier

Legg til kriterier for å avgjøre når monitoren regnes som online, redusert eller frakoblet. Disse kontrollene er tilgjengelige for en SQL-spørring-monitor:

| Filtertype | Hva den sjekker |
|---|---|
| **SQL Is Online** | Om databasen kunne nås og spørringen lyktes. |
| **SQL Query Row Count** | Antall returnerte rader. Sammenlign med operatorer som større enn, mindre enn eller lik. |
| **SQL Query Scalar Value** | Den første kolonnen i den første raden. Sammenlignes som et tall når verdien du skriver inn, er et tall, ellers som en streng. Dette er kontrollen du bruker for spørringer av typen `COUNT(*)`. |
| **SQL Query Execution Time (in ms)** | Hvor lang tid spørringen tok. Nyttig for å fange en treg database. |
| **SQL Query Error** | Feilmeldingen fra spørringen. Varsle når den er (eller ikke er) tom, eller samsvarer med en bestemt streng. |
| **JavaScript Expression** | Evaluer et egendefinert JavaScript-uttrykk over `rowCount`, `scalarValue`, `firstRow`, `executionTimeInMs`, `queryError` og `isOnline`. Se [JavaScript-uttrykk](/docs/monitor/javascript-expression#monitorer-for-sql-spørringer). |

Numeriske terskler er heltall: skriv `10`, ikke `10.5`. SQL Query-filtre kan ikke evalueres over en tidsperiode; hver kontroll står for seg selv.

En ny SQL-spørring-monitor starter med to kriterier: **SQL Is Online** er usann — monitoren blir frakoblet og erklærer en hendelse som løser seg selv — og **SQL Is Online** er sann, som markerer den som online. **Legg til kriterier** legger til ett nederst; dra det over online-kriteriet, fordi kriteriene sjekkes ovenfra, og det første som samsvarer, avgjør.

### Eksempel: varsle når kanselleringer skyter i været

Med spørringen ovenfor:

| Kriterium | Filter |
|---|---|
| **Redusert** | `SQL Query Scalar Value` er større enn `10`. |
| **Frakoblet** | `SQL Query Scalar Value` er større enn `50`, eller `SQL Is Online` er `false`. |

Knytt en vaktpolicy til kriteriet slik at de riktige personene blir tilkalt. En SQL-spørring-monitor har ingen egne malvariabler: tittelen på en hendelse kan nevne monitoren med `{{monitorName}}`, men kan ikke sitere resultatet av spørringen.

## Ting å tenke på

- Spørringen kjører ved hver kontroll, så hold den billig. Bruk indekser og smale tidsvinduer, og stol på Statement Timeout som sikkerhetsnett.
- Bare antall rader, den første cellen (skalar) og den første raden rapporteres — utform spørringen slik at verdien du vil varsle på, er den første kolonnen.
- Hvis resultatet avkortes fordi det overskred Max Rows, viser kontrollsammendraget **Rows Truncated**: "Yes (result capped)". Øk Max Rows bare hvis du trenger det; større resultatsett koster mer minne på sonden.
- Skriving og DDL avvises alltid. Hvis du må teste en skrivevei, er det ikke det denne monitoren er til.
- Foretrekk en overvåkingshemmelighet fremfor et passord i ren tekst, slik at påloggingsinformasjonen forblir kryptert når den er lagret.
- En kontroll der spørringen mislykkes, prøves igjen et sekund senere, opptil tre ganger til, før den rapporterer feilen, slik at et kort tilkoblingsbrudd ikke gjør monitoren frakoblet. På en selvhostet sonde bestemmer `PROBE_MONITOR_RETRY_LIMIT` hvor mange ganger.

## Feilsøking

:::details Hver kontroll mislykkes med "Only read-only queries are allowed"
Spørringen starter ikke med `SELECT`, `WITH`, `VALUES` eller `TABLE`. En kommentar foran går fint; en `SET` eller en `DECLARE` gjør ikke det. Skriv den om til én skrivebeskyttet setning.
:::

:::details En kontroll mislykkes med "Disallowed SQL keyword"
Et skrive-, DDL- eller kjøringsnøkkelord står et sted i spørringen, selv inne i en `SELECT`, for eksempel `INTO` eller `EXEC`. Ord inne i strenger i anførselstegn og i kommentarer teller ikke. Fjern nøkkelordet, eller legg logikken i et view som den skrivebeskyttede brukeren kan lese.
:::

:::details Kontrollen får tidsavbrudd
Sonden klarte ikke å koble til innen **Connection Timeout (ms)**, eller spørringen kjørte lenger enn **Statement Timeout (ms)**. Sjekk at sonden når verten og porten, og gjør deretter spørringen billigere: filtrer på indekserte kolonner over et kort tidsvindu.
:::

:::details Tilkoblingen mislykkes med en sertifikatfeil
Sertifikatet til databasen er selvsignert, eller sonden stoler ikke på det. Slå av **Verify server certificate**, som vises når **Use SSL/TLS** er slått på, eller gi databasen et sertifikat sonden stoler på.
:::

:::details Integrert Windows-autentisering mislykkes
Sonden trenger en Microsoft ODBC Driver for SQL Server og en identitet som domenet ditt stoler på. Kjør det offisielle sondebildet, eller installer driveren, og sjekk deretter oppsettet under [Integrert Windows-autentisering](#integrert-windows-autentisering).
:::

## Neste trinn

:::cards
- [Databasehelse-overvåking](/docs/monitor/database-health-monitor): Følg med på tilkoblinger, låser og replikering uten å skrive SQL.
- [Overvåkingshemmeligheter](/docs/monitor/monitor-secrets): Hold databasepassordet kryptert.
- [JavaScript-uttrykk](/docs/monitor/javascript-expression): Skriv kriterier som kombinerer flere verdier.
- [Egendefinerte probes](/docs/probe/custom-probe): Kjør kontroller fra innsiden av nettverket ditt.
:::

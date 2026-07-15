# SQL-frågemonitor

SQL-frågemonitorn kör en skrivskyddad SQL-fråga enligt ett schema från en sond och varnar utifrån resultatet – antalet returnerade rader, ett skalärt värde, hur lång tid frågan tog eller ett frågefel. Den är byggd för användningsfallet "kör en fråga och öppna en incident", till exempel för att varna när antalet annullerade beställningar under de senaste fem minuterna ökar kraftigt, när en kötabell växer sig för stor eller när en kritisk rad försvinner.

Eftersom frågan körs från en sond inuti ditt nätverk behöver OneUptime aldrig en direktanslutning till din databas, och den fullständiga resultatmängden lämnar aldrig sonden – endast en liten, avgränsad projektion av resultatet rapporteras tillbaka.

## Databaser som stöds

SQL-frågemonitorn stöder följande databasmotorer:

- **PostgreSQL** (standardport `5432`)
- **MySQL** (standardport `3306`)
- **Microsoft SQL Server** (standardport `1433`)

MySQL-kompatibla och PostgreSQL-kompatibla motorer som talar samma wire-protokoll och SQL-dialekt fungerar i allmänhet också, men endast de tre motorerna ovan är officiellt testade.

## Så fungerar det

Vid varje kontroll ansluter sonden till din databas, kör din fråga i en skrivskyddad kontext, läser tillbaka högst ett avgränsat antal rader och rapporterar en kompakt projektion till OneUptime. Din monitors kriterier utvärderas sedan mot den projektionen.

Sonden rapporterar endast:

- **Radantal** – antalet rader som frågan returnerade (begränsat av gränsen Max antal rader).
- **Skalärt värde** – den första kolumnen i den första raden. Detta är det naturliga värdet för en fråga av typen `SELECT COUNT(*)`.
- **Första raden** – den första raden som en uppsättning kolumn/värde-par, som visas i kontrollsammanfattningen för kontext.
- **Körtid** – hur lång tid frågan tog, i millisekunder.
- **Frågefel** – ett sanerat felmeddelande om frågan misslyckades.

Den fullständiga resultatmängden skickas aldrig till OneUptime, så kunddata replikeras inte till OneUptimes lagring.

## Säkerhetsmodell

Att köra en kundtillhandahållen fråga mot en produktionsdatabas är känsligt, så SQL-frågemonitorn är skrivskyddad genom design och lägger flera skyddsåtgärder i lager:

- **Databasanvändare med lägsta behörighet (primär kontroll).** Du bör alltid ansluta med en dedikerad, skrivskyddad databasanvändare som endast har åtkomst till de tabeller frågan behöver. Detta är den viktigaste skyddsåtgärden – se Skapa en skrivskyddad användare nedan.
- **Skrivskyddad körning.** På PostgreSQL och MySQL öppnar sonden en `READ ONLY`-transaktion, som avvisar all skrivning (inklusive skrivbara CTE:er) oavsett frågetexten. På Microsoft SQL Server, som saknar skrivskyddade transaktioner, körs sonden inuti en transaktion som alltid rullas tillbaka.
- **Enskilda, tillåtelselistade frågor.** Frågan måste vara en enda sats som börjar med `SELECT`, `WITH`, `VALUES` eller `TABLE`. Staplade satser (`SELECT 1; DROP TABLE …`) och skrivningar/DDL avvisas innan sonden ansluter. Kontrollen är medveten om kommentarer och stränglitteraler, så ett nyckelord som är dolt i en kommentar eller sträng slinker inte igenom.
- **Satstimeout.** Varje fråga har en hård tidsgräns. En fråga som körs för länge avbryts.
- **Avgränsade rader.** Endast upp till Max antal rader (plus en, för att upptäcka trunkering) läses någonsin tillbaka, vilket begränsar sondens minne och nyttolaststorlek.
- **Maskering av autentiseringsuppgifter.** Databasfel saneras innan de lagras – lösenordet och eventuella anslutningssträngar maskeras, så autentiseringsuppgifter läcker aldrig ut i felmeddelanden.

## Förutsättningar

- En **sond** med nätverksåtkomst till din databasvärd och -port. Detta kan vara en sond som hostas av OneUptime (om din databas är nåbar från internet) eller en självhostad sond som körs inuti ditt nätverk. Se sonddokumentationen för hur du installerar en anpassad sond.
- En **skrivskyddad databasanvändare** och anslutningsuppgifterna (värd, port, databasnamn, användarnamn, lösenord).

## Konfiguration

Skapa en ny monitor och välj **SQL-fråga** som monitortyp, fyll sedan i anslutningsuppgifterna:

- **Databastyp** – PostgreSQL, MySQL eller Microsoft SQL Server. Att välja en typ ställer in standardporten.
- **Värd** – databasvärden som är nåbar från sonden (till exempel `db.internal`).
- **Port** – databasporten.
- **Databasnamn** – databasen som frågan ska köras mot.
- **Användarnamn** – en skrivskyddad databasanvändare med lägsta behörighet.
- **Lösenord** – databaslösenordet. Vi rekommenderar starkt att du refererar till en [monitorhemlighet](/docs/monitor/monitor-secrets) med `{{monitorSecrets.name}}` istället för att skriva lösenordet i klartext (se nedan).
- **SQL-fråga** – den skrivskyddade frågan som ska köras (se Skriva frågan).
- **Använd SSL/TLS** – aktivera för att ansluta via TLS. När det är aktiverat kan du stänga av **Verifiera servercertifikat** om databasen använder ett självsignerat certifikat.

### Avancerade alternativ

- **Anslutningstimeout (ms)** – hur länge det ska väntas på att en anslutning upprättas. Standard `10000`, maximum `30000`.
- **Satstimeout (ms)** – den hårda gränsen för hur länge frågan får köras. Standard `15000`, maximum `60000`.
- **Max antal rader** – den övre gränsen för antalet rader som läses tillbaka från databasen. Standard `100`, maximum `1000`.

## Skriva frågan

Frågan måste vara en **enda skrivskyddad sats**. Den måste börja med något av `SELECT`, `WITH`, `VALUES` eller `TABLE`. Ett enda avslutande semikolon är tillåtet; flera satser är det inte.

Håll frågor billiga och väl avgränsade – de körs vid varje kontroll, så föredra indexerade kolumner och smala tidsfönster.

```sql
-- Räkna senaste annulleringarna (PostgreSQL)
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```

```sql
-- Samma idé på MySQL
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```

```sql
-- Samma idé på Microsoft SQL Server
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```

För en fråga av typen `COUNT(*)` är antalet tillgängligt både som **Radantal** (som är `1`, eftersom en rad returneras) och som **Skalärt värde** (själva antalet, från den första kolumnen). För att varna på "hur många", jämför mot **Skalärt värde**.

## Använda en monitorhemlighet för lösenordet

För att databaslösenordet aldrig ska lagras i klartext på monitorn skapar du en [monitorhemlighet](/docs/monitor/monitor-secrets) och refererar till den från lösenordsfältet:

1. Gå till OneUptime-instrumentpanelen → Projektinställningar → Monitorhemligheter → Skapa monitorhemlighet.
2. Skapa en hemlighet (till exempel `dbPassword`) och ge den här monitorn åtkomst till den.
3. I monitorns lösenordsfält anger du `{{monitorSecrets.dbPassword}}`.

OneUptime löser upp hemligheten på serversidan innan konfigurationen lämnas till sonden. OneUptime skapar aldrig dessa hemligheter åt dig – att referera till en är ditt eget val.

## Ställa in kriterier

Lägg till kriterier för att avgöra när monitorn anses vara online, degraderad eller offline. Följande kontroller är tillgängliga för en SQL-frågemonitor:

- **SQL är online** – om databasen var nåbar och frågan lyckades.
- **SQL-frågans radantal** – antalet returnerade rader. Jämför med operatorer som större än, mindre än eller lika med.
- **SQL-frågans skalära värde** – den första kolumnen i den första raden. Jämförs numeriskt när båda sidor ser numeriska ut, annars som strängar. Detta är kontrollen att använda för frågor av typen `COUNT(*)`.
- **SQL-frågans körtid (i ms)** – hur lång tid frågan tog. Användbart för att fånga en långsam databas.
- **SQL-frågefel** – frågans felmeddelande. Varna när det är (eller inte är) tomt, eller matchar en specifik sträng.
- **JavaScript-uttryck** – utvärdera ett anpassat JavaScript-uttryck för full kontroll. Se [JavaScript-uttryck](/docs/monitor/javascript-expression).

### Exempel: varna när annulleringar ökar kraftigt

Med hjälp av frågan ovan:

- **Kriterium: Degraderad** – `SQL-frågans skalära värde` är större än `10`.
- **Kriterium: Offline** – `SQL-frågans skalära värde` är större än `50`, eller `SQL är online` är `false`.

Koppla en jourpolicy till kriterierna så att rätt personer larmas.

## Skapa en skrivskyddad användare

Anslut alltid med en dedikerad skrivskyddad användare. Exempel:

```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- Inkludera tabeller som skapas i framtiden:
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

## Saker att tänka på

- Frågan körs vid varje kontroll, så håll den billig. Använd index och smala tidsfönster, och förlita dig på satstimeouten som en sista utväg.
- Endast radantalet, den första cellen (skalär) och den första raden rapporteras – utforma din fråga så att värdet du vill varna på är den första kolumnen.
- Om resultatet trunkeras för att det översteg Max antal rader flaggar kontrollsammanfattningen det som begränsat. Öka Max antal rader endast om du behöver det; större resultatmängder kostar mer minne på sonden.
- Skrivningar och DDL avvisas alltid. Om du behöver testa en skrivväg är det inte vad den här monitorn är till för.
- Föredra en monitorhemlighet framför ett lösenord i klartext så att autentiseringsuppgiften förblir krypterad i vila.

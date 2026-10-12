# SQL-frågeövervakning

SQL-frågemonitorn kör en skrivskyddad SQL-fråga enligt ett schema från en sond och larmar på resultatet — antalet returnerade rader, ett skalärvärde, hur lång tid frågan tog eller ett frågefel. Den är byggd för användningsfallet "kör en fråga och öppna en incident", till exempel för att larma när antalet avbrutna beställningar under de senaste fem minuterna rusar i höjden, när en kötabell växer sig för stor eller när en kritisk rad försvinner.

:::cards
- [Skapa en skrivskyddad användare](#skapa-en-skrivskyddad-användare): Databasinloggningen som monitorn ska använda.
- [Skapa monitorn](#skapa-en-sql-frågemonitor): Anslut en sond och ange frågan.
- [Skriv frågan](#skriv-frågan): Lägg värdet du larmar på i den första kolumnen.
- [Ställ in kriterier](#ställ-in-kriterier): Larma på ett antal, ett värde, en långsam fråga eller ett fel.
:::

## Så fungerar det

Vid varje kontroll ansluter sonden till din databas, kör din fråga i en skrivskyddad kontext, läser tillbaka högst ett begränsat antal rader och rapporterar en kompakt projektion till OneUptime. Monitorns kriterier utvärderas sedan mot den projektionen.

Eftersom frågan körs från en sond i ditt nätverk behöver OneUptime aldrig någon direkt anslutning till din databas, och hela resultatmängden lämnar aldrig sonden — bara en liten, begränsad projektion av resultatet rapporteras tillbaka.

```mermaid title="Bara en liten projektion av resultatet lämnar ditt nätverk"
sequenceDiagram
    participant O as OneUptime
    participant P as Sond
    participant D as Din databas
    O->>P: Monitorinställningar, hemligheter upplösta
    P->>D: Din fråga, skrivskyddad
    D-->>P: Upp till Max Rows + 1 rader
    P->>O: Antal rader, skalär, första raden, tid, fel
    O->>O: Utvärdera kriterierna
```

Sonden rapporterar bara:

| Värde | Vad det är |
|---|---|
| **Row Count** | Antalet rader som frågan returnerade (begränsat av gränsen Max Rows). |
| **Skalärvärde** | Den första kolumnen i den första raden. Det är det naturliga värdet för en fråga av typen `SELECT COUNT(*)`. |
| **First Row** | Den första raden som par av kolumn och värde, visad i kontrollens sammanfattning som sammanhang. |
| **Execution Time** | Hur lång tid kontrollen tog, i millisekunder — anslutningen inräknad, inte bara frågan. |
| **Frågefel** | Ett rensat felmeddelande om frågan misslyckades. |

Hela resultatmängden skickas aldrig till OneUptime, så kunddata kopieras inte till OneUptimes lagring.

## Databaser som stöds

| Databas | Standardport |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

MySQL-kompatibla och PostgreSQL-kompatibla motorer som talar samma trådprotokoll och SQL-dialekt fungerar i regel också, men bara de tre motorerna ovan är officiellt testade.

När värden och porten som monitorn ansluter till är en av slutpunkterna för en databas på sidan [Databaser](/docs/telemetry/databases), visas monitorns larm och incidenter också på den databasens sida (se [Larm för en databas](/docs/telemetry/databases#alerts-on-a-database)). En värd som anges som en hänvisning till en övervakningshemlighet matchas inte.

## Säkerhetsmodell

Att köra en fråga som kunden själv har skrivit mot en produktionsdatabas är känsligt, så SQL-frågemonitorn är skrivskyddad från grunden och lägger flera kontroller ovanpå varandra:

| Kontroll | Vad den gör |
|---|---|
| **Databasanvändare med minsta möjliga behörighet** (primär kontroll) | Anslut alltid med en egen, skrivskyddad databasanvändare som bara har åtkomst till de tabeller som frågan behöver. Det här är den viktigaste kontrollen — se [Skapa en skrivskyddad användare](#skapa-en-skrivskyddad-användare). |
| **Skrivskyddad körning** | På PostgreSQL och MySQL öppnar sonden en `READ ONLY`-transaktion, som avvisar alla skrivningar (även skrivande CTE:er) oavsett frågans text. På Microsoft SQL Server, som saknar skrivskyddade transaktioner, körs sonden i en transaktion som alltid rullas tillbaka. |
| **En sats, tillåtna frågor** | Frågan måste vara en enda sats som börjar med `SELECT`, `WITH`, `VALUES` eller `TABLE`. Staplade satser (`SELECT 1; DROP TABLE …`) och skriv- eller DDL-nyckelord som `INSERT`, `UPDATE`, `DELETE`, `DROP`, `EXEC` och `INTO` avvisas av sonden innan den ansluter. Den här kontrollen är ett skyddsnät, inte gränsen: det är den skrivskyddade användaren. |
| **Tidsgräns för satsen** | Varje fråga har en hård tidsgräns. En fråga som körs för länge avbryts. |
| **Begränsade rader** | Aldrig fler än Max Rows rader läses tillbaka (plus en, för att upptäcka avkortning), vilket begränsar sondens minne och datamängden. |
| **Maskering av inloggningsuppgifter** | Databasfel rensas innan de lagras — lösenordet, värden, användarnamnet och databasnamnet samt alla anslutningssträngar maskeras, så att inloggningsuppgifter aldrig läcker ut i felmeddelanden. |

## Innan du börjar

- En **sond** med nätverksåtkomst till din databas värd och port. Det kan vara en sond som OneUptime driftar (om din databas kan nås från internet) eller en [anpassad sond](/docs/probe/custom-probe) som körs i ditt nätverk.
- En **skrivskyddad databasanvändare** och anslutningsuppgifterna (värd, port, databasnamn, användarnamn, lösenord), eller en skrivskyddad Windows- eller domänidentitet när du använder integrerad autentisering i SQL Server.

## Skapa en skrivskyddad användare

Anslut alltid med en egen skrivskyddad användare. Kör satserna för din motor som administratör och ersätt `orders` med din databas:

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

För snävare behörigheter kan du ge användaren `SELECT` på bara de tabeller som din fråga läser.

## Skapa en SQL-frågemonitor

:::steps
### Starta en ny monitor

Gå till **Monitorer** och klicka på **Skapa monitor**. Under **Monitortyp** klickar du på **Fler monitortyper** och väljer **SQL Query** under **Database Monitoring**, eller skriver `query` i sökrutan. Ange ett **Namn** och klicka sedan på **Nästa**.

### Ange anslutningsuppgifterna

Välj **Database Type** — porten byts till den motorns standard — och fyll sedan i värden, databasnamnet och den skrivskyddade användarens inloggningsuppgifter. Hänvisa till lösenordet som en [övervakningshemlighet](#använd-en-övervakningshemlighet-för-lösenordet) i stället för att skriva in det. Varje fält beskrivs under [Konfiguration](#konfiguration).

### Ange frågan

Skriv en enda skrivskyddad sats i **SQL Query** (se [Skriv frågan](#skriv-frågan)).

### Testa den

Klicka på **Testa monitor** för att köra frågan en gång från en sond innan du sparar.

### Ange kriterierna

Gå igenom kriterierna som monitorn börjar med och lägg till egna — se [Ställ in kriterier](#ställ-in-kriterier). Klicka sedan på **Nästa**.

### Välj sonder och skapa

Välj de **Sonder** som når databasen och ett **Övervakningsintervall**, och klicka sedan på **Skapa monitor**.
:::

## Konfiguration

| Fält | Vad du anger |
|---|---|
| **Database Type** | PostgreSQL, MySQL eller Microsoft SQL Server. När du väljer en typ anges standardporten. |
| **Värd** | Databasvärden som sonden kan nå (till exempel `db.internal`). |
| **Port** | Databasens port. |
| **Databasnamn** | Databasen som frågan ska köras mot. |
| **Use Windows Integrated Authentication** | Bara Microsoft SQL Server. Autentisera med kontot som sonden körs som, i stället för med ett SQL-användarnamn och lösenord. Se [Integrerad Windows-autentisering](#integrerad-windows-autentisering). |
| **Användarnamn** | En skrivskyddad databasanvändare med minsta möjliga behörighet. |
| **Lösenord** | Databasens lösenord. Vi rekommenderar starkt att du hänvisar till en [övervakningshemlighet](/docs/monitor/monitor-secrets) med `{{monitorSecrets.name}}` i stället för att skriva lösenordet som vanlig text (se [Använd en övervakningshemlighet för lösenordet](#använd-en-övervakningshemlighet-för-lösenordet)). |
| **SQL Query** | Den skrivskyddade frågan som ska köras (se [Skriv frågan](#skriv-frågan)). |
| **Use SSL/TLS** | Aktivera för att ansluta över TLS. När det är aktiverat kan du stänga av **Verify server certificate** om databasen använder ett självsignerat certifikat. |

### Fler fält

| Fält | Standard | Maximum | Vad det begränsar |
|---|---|---|---|
| **Connection Timeout (ms)** | `10000` | `30000` | Hur länge det väntas på att en anslutning upprättas. |
| **Statement Timeout (ms)** | `15000` | `60000` | Den hårda gränsen för hur länge frågan får köras. |
| **Max Rows** | `100` | `1000` | Den övre gränsen för hur många rader som läses tillbaka från databasen. |

Ett värde över maximum sänks till maximum.

### Integrerad Windows-autentisering

För Microsoft SQL Server aktiverar du **Use Windows Integrated Authentication** för att öppna en betrodd anslutning med sondprocessens identitet. Fälten Användarnamn och Lösenord ignoreras i det här läget och skickas inte vidare till drivrutinen. Eftersom sonden behöver en identitet som din domän litar på bör du använda en självhostad sond för det här autentiseringsläget.

| Sonden körs på | Vad du ska ställa in |
|---|---|
| **Windows** | Kör sondtjänsten som ett domänkonto som har en skrivskyddad inloggning i SQL Server. |
| **Linux eller macOS** | Konfigurera Kerberos för SQL Server-domänen och ge sondprocessen en giltig biljett (till exempel via en keytab). Den officiella Linux-avbildningen för sonden innehåller Microsoft ODBC Driver 18, unixODBC och Kerberos-klienten. Montera Kerberos-konfigurationen och biljettcachen i containern, gör dem läsbara för sondprocessen och ange `KRB5_CONFIG` eller `KRB5CCNAME` när de inte ligger på standardplatsen. |

Sonden behöver en Microsoft ODBC Driver for SQL Server installerad på värden där den körs. Den officiella sondavbildningen innehåller **ODBC Driver 18**. När du kör en självhostad eller anpassad sond hittar och använder sonden automatiskt den nyaste `ODBC Driver N for SQL Server` som är registrerad på värden (till exempel Driver 17 om det är den som är installerad) — du behöver inte exakt Driver 18. För att låsa en viss drivrutin anger du miljövariabeln `SQL_SERVER_ODBC_DRIVER` på sonden till drivrutinens exakta namn (till exempel `ODBC Driver 17 for SQL Server`).

SQL Server måste ha ett lämpligt service principal name `MSSQLSvc`, klockorna på sonden och domänkontrollanten måste vara synkroniserade, och sonden måste kunna slå upp och nå SQL Server via det värdnamn som det service principal name täcker. Ge den betrodda identiteten bara de databasbehörigheter som övervakningsfrågan behöver.

## Skriv frågan

Frågan måste vara **en enda skrivskyddad sats**. Den måste börja med `SELECT`, `WITH`, `VALUES` eller `TABLE`. Ett avslutande semikolon är tillåtet; flera satser är det inte. Skriv- och DDL-nyckelord avvisas var som helst i frågan — även `INTO`, så `SELECT … INTO` avvisas också.

Sonden kontrollerar frågan vid varje kontroll, inte när du sparar. En fråga som bryter mot de här reglerna sparas, och sedan misslyckas varje kontroll med "Only read-only queries are allowed (must start with SELECT, WITH, VALUES, or TABLE)." — standardkriterierna gör monitorn offline.

Håll frågorna billiga och avgränsade — de körs vid varje kontroll, så föredra indexerade kolumner och smala tidsfönster. Den här frågan räknar beställningarna som avbrutits under de senaste fem minuterna:

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
> För en fråga av typen `COUNT(*)` finns antalet tillgängligt både som **Row Count** (som är `1`, eftersom en rad returneras) och som **Skalärvärde** (själva antalet, från den första kolumnen). För att larma på "hur många" jämför du med **Skalärvärde**.

## Använd en övervakningshemlighet för lösenordet

För att databasens lösenord aldrig ska lagras som vanlig text på monitorn skapar du en [övervakningshemlighet](/docs/monitor/monitor-secrets) och hänvisar till den från fältet Lösenord:

:::steps
1. Gå till **Monitorer → Inställningar → Hemligheter** och skapa en övervakningshemlighet.
2. Ge den ett namn (till exempel `dbPassword`) och ge den här monitorn åtkomst till den.
3. Skriv `{{monitorSecrets.dbPassword}}` i monitorns fält **Lösenord**.
:::

OneUptime löser upp hemligheten på servern innan konfigurationen lämnas över till sonden. OneUptime skapar aldrig de här hemligheterna åt dig — det är ditt val att hänvisa till en. Fälten **Användarnamn**, **Värd**, **Databasnamn** och **SQL Query** tar också emot hänvisningar till hemligheter; **Port** gör det inte.

## Ställ in kriterier

Lägg till kriterier för att avgöra när monitorn anses vara online, försämrad eller offline. De här kontrollerna finns för en SQL-frågemonitor:

| Filtertyp | Vad den kontrollerar |
|---|---|
| **SQL Is Online** | Om databasen kunde nås och frågan lyckades. |
| **SQL Query Row Count** | Antalet returnerade rader. Jämför med operatorer som större än, mindre än eller lika med. |
| **SQL Query Scalar Value** | Den första kolumnen i den första raden. Jämförs som ett tal när värdet du anger är ett tal, annars som en sträng. Det här är kontrollen att använda för frågor av typen `COUNT(*)`. |
| **SQL Query Execution Time (in ms)** | Hur lång tid frågan tog. Användbart för att fånga en långsam databas. |
| **SQL Query Error** | Frågans felmeddelande. Larma när det är (eller inte är) tomt, eller matchar en viss sträng. |
| **JavaScript Expression** | Utvärdera ett eget JavaScript-uttryck över `rowCount`, `scalarValue`, `firstRow`, `executionTimeInMs`, `queryError` och `isOnline`. Se [JavaScript-uttryck](/docs/monitor/javascript-expression#monitorer-för-sql-frågor). |

Numeriska tröskelvärden är heltal: skriv `10`, inte `10.5`. SQL Query-filter kan inte utvärderas över en tidsperiod; varje kontroll står för sig själv.

En ny SQL-frågemonitor börjar med två kriterier: **SQL Is Online** är falskt — monitorn blir offline och deklarerar en incident som löser sig själv — och **SQL Is Online** är sant, vilket markerar den som online. **Lägg till kriterier** lägger till ett längst ned; dra det ovanför online-kriteriet, eftersom kriterierna kontrolleras uppifrån och det första som matchar avgör.

### Exempel: larma när avbokningarna rusar

Med frågan ovan:

| Kriterium | Filter |
|---|---|
| **Försämrad** | `SQL Query Scalar Value` är större än `10`. |
| **Offline** | `SQL Query Scalar Value` är större än `50`, eller `SQL Is Online` är `false`. |

Koppla en jourpolicy till kriteriet så att rätt personer kallas in. En SQL-frågemonitor har inga egna mallvariabler: titeln på en incident kan nämna monitorn med `{{monitorName}}`, men kan inte citera frågans resultat.

## Saker att tänka på

- Frågan körs vid varje kontroll, så håll den billig. Använd index och smala tidsfönster, och lita på Statement Timeout som skyddsnät.
- Bara antalet rader, den första cellen (skalär) och den första raden rapporteras — utforma frågan så att värdet du vill larma på är den första kolumnen.
- Om resultatet kortas av för att det överskred Max Rows visar kontrollens sammanfattning **Rows Truncated**: "Yes (result capped)". Höj Max Rows bara om du behöver det; större resultatmängder kostar mer minne på sonden.
- Skrivningar och DDL avvisas alltid. Om du behöver testa en skrivväg är det inte det här monitorn är till för.
- Föredra en övervakningshemlighet framför ett lösenord i vanlig text, så att inloggningsuppgifterna förblir krypterade när de lagras.
- En kontroll vars fråga misslyckas försöks igen en sekund senare, upp till tre gånger till, innan den rapporterar felet, så att ett kort anslutningsavbrott inte gör monitorn offline. På en självhostad sond anger `PROBE_MONITOR_RETRY_LIMIT` hur många gånger.

## Felsökning

:::details Varje kontroll misslyckas med "Only read-only queries are allowed"
Frågan börjar inte med `SELECT`, `WITH`, `VALUES` eller `TABLE`. En kommentar före går bra; en `SET` eller en `DECLARE` gör det inte. Skriv om den som en enda skrivskyddad sats.
:::

:::details En kontroll misslyckas med "Disallowed SQL keyword"
Ett skriv-, DDL- eller körningsnyckelord finns någonstans i frågan, även inne i en `SELECT`, till exempel `INTO` eller `EXEC`. Ord inom citerade strängar och i kommentarer räknas inte. Ta bort nyckelordet, eller lägg logiken i en vy som den skrivskyddade användaren kan läsa.
:::

:::details Kontrollen når tidsgränsen
Sonden kunde inte ansluta inom **Connection Timeout (ms)**, eller så körde frågan längre än **Statement Timeout (ms)**. Kontrollera att sonden når värden och porten, och gör sedan frågan billigare: filtrera på indexerade kolumner över ett kort tidsfönster.
:::

:::details Anslutningen misslyckas med ett certifikatfel
Databasens certifikat är självsignerat, eller så litar sonden inte på det. Stäng av **Verify server certificate**, som visas när **Use SSL/TLS** är aktiverat, eller ge databasen ett certifikat som sonden litar på.
:::

:::details Integrerad Windows-autentisering misslyckas
Sonden behöver en Microsoft ODBC Driver for SQL Server och en identitet som din domän litar på. Kör den officiella sondavbildningen eller installera drivrutinen, och kontrollera sedan inställningarna under [Integrerad Windows-autentisering](#integrerad-windows-autentisering).
:::

## Nästa steg

:::cards
- [Övervakning av databashälsa](/docs/monitor/database-health-monitor): Håll koll på anslutningar, lås och replikering utan att skriva SQL.
- [Övervakningshemligheter](/docs/monitor/monitor-secrets): Håll databasens lösenord krypterat.
- [JavaScript-uttryck](/docs/monitor/javascript-expression): Skriv kriterier som kombinerar flera värden.
- [Anpassade probes](/docs/probe/custom-probe): Kör kontroller inifrån ditt nätverk.
:::

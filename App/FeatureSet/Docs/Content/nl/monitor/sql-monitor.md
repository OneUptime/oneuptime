# SQL-query-monitor

De SQL-query-monitor voert volgens een schema een alleen-lezen SQL-query uit vanaf een probe en waarschuwt op basis van het resultaat — het aantal geretourneerde rijen, een scalaire waarde, hoe lang de query duurde, of een queryfout. Hij is gebouwd voor het gebruiksscenario "voer een query uit en open een incident", bijvoorbeeld waarschuwen wanneer het aantal geannuleerde bestellingen in de afgelopen vijf minuten piekt, wanneer een wachtrijtabel te groot wordt, of wanneer een cruciale rij verdwijnt.

Omdat de query wordt uitgevoerd vanaf een probe binnen uw netwerk, heeft OneUptime nooit een directe verbinding met uw database nodig, en verlaat de volledige resultaatset de probe nooit — alleen een kleine, begrensde projectie van het resultaat wordt teruggerapporteerd.

## Ondersteunde databases

De SQL-query-monitor ondersteunt de volgende database-engines:

- **PostgreSQL** (standaardpoort `5432`)
- **MySQL** (standaardpoort `3306`)
- **Microsoft SQL Server** (standaardpoort `1433`)

MySQL-compatibele en PostgreSQL-compatibele engines die hetzelfde wire-protocol en SQL-dialect spreken, werken doorgaans ook, maar alleen de drie bovenstaande engines zijn officieel getest.

## Hoe het werkt

Bij elke controle maakt de probe verbinding met uw database, voert uw query uit in een alleen-lezen context, leest hooguit een begrensd aantal rijen terug en rapporteert een compacte projectie aan OneUptime. De criteria van uw monitor worden vervolgens geëvalueerd aan de hand van die projectie.

De probe rapporteert alleen:

- **Aantal rijen** — het aantal rijen dat de query heeft geretourneerd (begrensd door de limiet Max. rijen).
- **Scalaire waarde** — de eerste kolom van de eerste rij. Dit is de natuurlijke waarde voor een query in `SELECT COUNT(*)`-stijl.
- **Eerste rij** — de eerste rij als een set kolom/waarde-paren, weergegeven in de controlesamenvatting voor context.
- **Uitvoeringstijd** — hoe lang de query duurde, in milliseconden.
- **Queryfout** — een opgeschoond foutbericht als de query is mislukt.

De volledige resultaatset wordt nooit naar OneUptime verzonden, dus klantgegevens worden niet gerepliceerd naar de OneUptime-opslag.

## Beveiligingsmodel

Het uitvoeren van een door de klant aangeleverde query op een productiedatabase is gevoelig, dus is de SQL-query-monitor door zijn ontwerp alleen-lezen en stapelt hij verschillende maatregelen:

- **Database-gebruiker met minimale rechten (primaire maatregel).** U dient altijd verbinding te maken met een specifieke, alleen-lezen database-gebruiker die alleen toegang heeft tot de tabellen die de query nodig heeft. Dit is de belangrijkste maatregel — zie Een alleen-lezen gebruiker aanmaken hieronder.
- **Alleen-lezen uitvoering.** Op PostgreSQL en MySQL opent de probe een `READ ONLY`-transactie, die elke schrijfbewerking (inclusief schrijfbare CTE's) weigert, ongeacht de querytekst. Op Microsoft SQL Server, dat geen alleen-lezen transactie heeft, draait de probe binnen een transactie die altijd wordt teruggedraaid.
- **Query's met één instructie op een acceptatielijst.** De query moet één enkele instructie zijn die begint met `SELECT`, `WITH`, `VALUES` of `TABLE`. Gestapelde instructies (`SELECT 1; DROP TABLE …`) en schrijfbewerkingen/DDL worden geweigerd voordat de probe verbinding maakt. De controle houdt rekening met commentaar en tekenreeksliteralen, zodat een trefwoord dat verborgen is in een commentaar of tekenreeks er niet doorheen glipt.
- **Instructie-time-out.** Elke query heeft een harde tijdslimiet. Een query die te lang draait, wordt geannuleerd.
- **Begrensde rijen.** Er worden hooguit Max. rijen (plus één, om afkapping te detecteren) teruggelezen, wat het probe-geheugen en de payloadgrootte begrenst.
- **Redactie van referenties.** Databasefouten worden opgeschoond voordat ze worden opgeslagen — het wachtwoord en elke verbindingstekenreeks worden geredigeerd, zodat referenties nooit in foutberichten lekken.

## Vereisten

- Een **probe** met netwerktoegang tot uw databasehost en -poort. Dit kan een door OneUptime gehoste probe zijn (als uw database bereikbaar is vanaf het internet) of een zelf-gehoste probe die binnen uw netwerk draait. Zie de probe-documentatie voor het installeren van een aangepaste probe.
- Een **alleen-lezen database-gebruiker** en de verbindingsgegevens (host, poort, databasenaam, gebruikersnaam, wachtwoord).

## Configuratie

Maak een nieuwe monitor aan en kies **SQL Query** als het monitortype, en vul vervolgens de verbindingsgegevens in:

- **Databasetype** — PostgreSQL, MySQL of Microsoft SQL Server. Bij het kiezen van een type wordt de standaardpoort ingesteld.
- **Host** — de databasehost die bereikbaar is vanaf de probe (bijvoorbeeld `db.internal`).
- **Poort** — de databasepoort.
- **Databasenaam** — de database waarop de query moet worden uitgevoerd.
- **Gebruikersnaam** — een alleen-lezen database-gebruiker met minimale rechten.
- **Wachtwoord** — het databasewachtwoord. We raden ten zeerste aan om te verwijzen naar een [Monitor Secret](/docs/monitor/monitor-secrets) met `{{monitorSecrets.name}}` in plaats van het wachtwoord in platte tekst in te typen (zie hieronder).
- **SQL-query** — de alleen-lezen query die moet worden uitgevoerd (zie De query schrijven).
- **SSL/TLS gebruiken** — inschakelen om verbinding te maken via TLS. Wanneer ingeschakeld, kunt u **Servercertificaat verifiëren** uitschakelen als de database een zelfondertekend certificaat gebruikt.

### Geavanceerde opties

- **Verbindings-time-out (ms)** — hoe lang moet worden gewacht om een verbinding tot stand te brengen. Standaard `10000`, maximaal `30000`.
- **Instructie-time-out (ms)** — de harde limiet voor hoe lang de query mag draaien. Standaard `15000`, maximaal `60000`.
- **Max. rijen** — de bovengrens van het aantal rijen dat uit de database wordt teruggelezen. Standaard `100`, maximaal `1000`.

## De query schrijven

De query moet één enkele **alleen-lezen instructie** zijn. Hij moet beginnen met een van `SELECT`, `WITH`, `VALUES` of `TABLE`. Eén afsluitende puntkomma is toegestaan; meerdere instructies niet.

Houd query's goedkoop en goed afgebakend — ze draaien bij elke controle, dus geef de voorkeur aan geïndexeerde kolommen en smalle tijdvensters.

```sql
-- Recente annuleringen tellen (PostgreSQL)
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```

```sql
-- Hetzelfde idee in MySQL
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```

```sql
-- Hetzelfde idee in Microsoft SQL Server
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```

Voor een query in `COUNT(*)`-stijl is de telling beschikbaar zowel als **Aantal rijen** (dat `1` is, aangezien er één rij wordt geretourneerd) als als **Scalaire waarde** (de telling zelf, uit de eerste kolom). Om te waarschuwen op "hoeveel", vergelijkt u met de **Scalaire waarde**.

## Een Monitor Secret voor het wachtwoord gebruiken

Zodat het databasewachtwoord nooit in platte tekst op de monitor wordt opgeslagen, maakt u een [Monitor Secret](/docs/monitor/monitor-secrets) aan en verwijst u ernaar vanuit het veld Wachtwoord:

1. Ga naar OneUptime Dashboard → Projectinstellingen → Monitor Secrets → Monitor Secret aanmaken.
2. Maak een secret aan (bijvoorbeeld `dbPassword`) en verleen deze monitor er toegang toe.
3. Voer in het veld Wachtwoord van de monitor `{{monitorSecrets.dbPassword}}` in.

OneUptime lost het secret server-side op voordat de configuratie aan de probe wordt doorgegeven. OneUptime maakt deze secrets nooit voor u aan — ernaar verwijzen is uw eigen keuze.

## Criteria instellen

Voeg criteria toe om te bepalen wanneer de monitor als online, verminderd of offline wordt beschouwd. De volgende controles zijn beschikbaar voor een SQL-query-monitor:

- **SQL is online** — of de database bereikbaar was en de query is geslaagd.
- **SQL-query aantal rijen** — het aantal geretourneerde rijen. Vergelijk met operatoren zoals groter dan, kleiner dan of gelijk aan.
- **SQL-query scalaire waarde** — de eerste kolom van de eerste rij. Numeriek vergeleken wanneer beide zijden numeriek lijken, anders als tekenreeksen. Dit is de controle die u gebruikt voor query's in `COUNT(*)`-stijl.
- **SQL-query uitvoeringstijd (in ms)** — hoe lang de query duurde. Nuttig om een trage database te betrappen.
- **SQL-queryfout** — het queryfoutbericht. Waarschuw wanneer het (niet) leeg is, of overeenkomt met een specifieke tekenreeks.
- **JavaScript-expressie** — evalueer een aangepaste JavaScript-expressie voor volledige controle. Zie [JavaScript-expressies](/docs/monitor/javascript-expression).

### Voorbeeld: waarschuwen wanneer annuleringen pieken

Met de bovenstaande query:

- **Criteria: Verminderd** — `SQL-query scalaire waarde` is groter dan `10`.
- **Criteria: Offline** — `SQL-query scalaire waarde` is groter dan `50`, of `SQL is online` is `false`.

Koppel een on-callbeleid aan de criteria zodat de juiste mensen worden opgeroepen.

## Een alleen-lezen gebruiker aanmaken

Maak altijd verbinding met een specifieke alleen-lezen gebruiker. Voorbeelden:

```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- Ook tabellen die in de toekomst worden aangemaakt:
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

## Aandachtspunten

- De query draait bij elke controle, dus houd hem goedkoop. Gebruik indexen en smalle tijdvensters, en vertrouw op de Instructie-time-out als vangnet.
- Alleen het aantal rijen, de eerste cel (scalair) en de eerste rij worden gerapporteerd — ontwerp uw query zo dat de waarde waarop u wilt waarschuwen de eerste kolom is.
- Als het resultaat wordt afgekapt omdat het Max. rijen overschreed, markeert de controlesamenvatting dit als begrensd. Verhoog Max. rijen alleen als u het nodig heeft; grotere resultaatsets kosten meer geheugen op de probe.
- Schrijfbewerkingen en DDL worden altijd geweigerd. Als u een schrijfpad wilt testen, is deze monitor daar niet voor bedoeld.
- Geef de voorkeur aan een Monitor Secret boven een wachtwoord in platte tekst, zodat de referentie versleuteld blijft in rust.

# Konfigurera datasäkerhet

Data Security läser bara det du låter den läsa. Varje molnanslutning läses på en av tre nivåer, en databas som du driver läses med en anslutningssträng som du ger den, och telemetri behöver ingenting. Den här sidan beskriver vad varje val låter OneUptime läsa, exakt vilka behörigheter det ger och vad OneUptime sparar av det den läser.

:::cards
- [Välj en nivå](#choose-a-level-for-each-connection): Av, Configuration only eller Configuration and content samples.
- [Vad varje nivå ger](#what-each-level-grants): AWS-åtgärderna, och rollerna i Azure och Google Cloud.
- [Skanna en databas som du driver](#scan-a-database-you-run): En skrivskyddad anslutningssträng, eller en sond i ditt nätverk.
- [Vad OneUptime sparar](#what-oneuptime-keeps): Antal, platser och maskerade stickprov, aldrig ett värde.
:::

## Välj en nivå för varje anslutning

| Nivå | I formuläret | Vad OneUptime läser |
| --- | --- | --- |
| Av | **Av** | Inget datalagers konfiguration eller innehåll. Data Security listar ändå de datalager som ditt molninventarie känner till, med det som inventariet säger om dem: om en RDS-databas är krypterad, offentlig, skyddad mot borttagning och säkerhetskopierad, och om en DynamoDB-tabell kan återställas till en viss tidpunkt. |
| Konfiguration | **Configuration only** | Hur varje datalager är konfigurerat: vem som kan nå det, och hur det krypteras, säkerhetskopieras, versionshanteras, loggas, replikeras och taggas. Aldrig data, och aldrig en hemlighet. |
| Innehåll | **Configuration and content samples** | Det, och stickprov av det som S3-buckets, Azure-lagringskonton, Cloud Storage-buckets och BigQuery-dataset innehåller. |

Varje anslutning börjar på **Av**. [Anslut ett molnkonto](/docs/telemetry/cloud-accounts#data-security) visar kommandot som varje nivå kör i varje moln, ord för ord. Så ändrar du en anslutnings nivå:

:::steps
### Öppna anslutningen

Gå till **Moln → Anslut**. Välj **Redigera** på anslutningen, eller anslut ett nytt konto.

### Välj nivån

Under **Fler fält** sätter du **Data security** till den nivå du vill ha.

### Kör kommandot igen

Kommandot som formuläret visar ändras med nivån. Kör det i molnets skal, som när du anslöt: det ger det som den nya nivån behöver, och inget mer. Välj sedan **Spara ändringar**, eller **Anslut** för en ny anslutning.
:::

Läsningar på den nya nivån börjar inom en timme, och **Check Now** eller **Scan Now** på ett datalager startar en direkt. OneUptime läser bara det som anslutningens nivå anger, vad rollen än fortfarande tillåter: sänk nivån, så slutar läsningarna direkt. För att också ta bort åtkomsten kör du det nya kommandot: på AWS ersätter det policyn med den lägre. **Av** lägger inte till något, så det lämnar kvar det som ett tidigare kommando gav. Ta bort det själv: på AWS med `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity`, och på Azure och Google Cloud genom att ta bort rollerna som innehållsnivån lade till.

## Vad varje nivå ger

### Amazon Web Services

Konfigurationsnivån lägger en andra inline-policy, `OneUptimeDataSecurity`, på rollen, bredvid den skrivskyddade. Den innehåller exakt de läsåtgärder som läsaren för datasäkerhet anropar. Var och en läser en inställning; ingen läser data eller skriver något:

| Vad OneUptime använder dem till | Åtgärder |
| --- | --- |
| Lista bucketarna, och läsa vem som kan nå var och en och hur den krypteras, versionshanteras, loggas, kopieras och taggas | `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketPolicyStatus`, `s3:GetBucketPublicAccessBlock`, `s3:GetAccountPublicAccessBlock`, `s3:GetBucketAcl`, `s3:GetBucketPolicy`, `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning`, `s3:GetBucketLogging`, `s3:GetBucketOwnershipControls`, `s3:GetReplicationConfiguration`, `s3:GetBucketTagging` |
| Läsa hur databaserna nås, krypteras och säkerhetskopieras, och vilka deras manuella ögonblicksbilder delas med | `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeDBSnapshots`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshots`, `rds:DescribeDBClusterSnapshotAttributes`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `redshift:DescribeClusters`, `redshift:DescribeLoggingStatus` |
| Läsa hur sökdomänerna, cacharna och filsystemen är konfigurerade | `es:ListDomainNames`, `es:DescribeDomains`, `elasticache:DescribeReplicationGroups`, `elasticfilesystem:DescribeFileSystems` |
| Skilja AWS egna nycklar (alias/aws/...) från nycklarna som du hanterar | `kms:ListAliases` |

Innehållsnivån lägger till tre åtgärder i samma policy, var och en på sina egna resurser:

| Åtgärd | Tillåten på | Vad den är till för |
| --- | --- | --- |
| `s3:ListBucket` | `arn:aws:s3:::*` | Lista en buckets objektnamn |
| `s3:GetObject` | `arn:aws:s3:::*/*` | Läsa de första byten av ett objekt i stickprovet |
| `kms:Decrypt` | `*`, bara när `kms:ViaService` är `s3.*.amazonaws.com` | Läsa ett objekt som är krypterat med en KMS-nyckel, bara genom S3: aldrig en direkt dekryptering av något annat som nyckeln skyddar |

Med en **Åtkomstnyckel** i stället för en roll hamnar policyn på en grupp, `OneUptimeDataSecurity`, som nyckelns användare läggs till i: IAM begränsar en användares egna inline-policyer till 2 048 tecken totalt, och den skrivskyddade policyn tar de flesta av dem. En anslutning som läser en hel AWS Organization lägger samma policy i varje kontos roll.

:::details Hela policyn på innehållsnivån
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:GetBucketLocation",
        "s3:GetBucketPolicyStatus",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetAccountPublicAccessBlock",
        "s3:GetBucketAcl",
        "s3:GetBucketPolicy",
        "s3:GetEncryptionConfiguration",
        "s3:GetBucketVersioning",
        "s3:GetBucketLogging",
        "s3:GetBucketOwnershipControls",
        "s3:GetReplicationConfiguration",
        "s3:GetBucketTagging",
        "rds:DescribeDBInstances",
        "rds:DescribeDBClusters",
        "rds:DescribeDBSnapshots",
        "rds:DescribeDBSnapshotAttributes",
        "rds:DescribeDBClusterSnapshots",
        "rds:DescribeDBClusterSnapshotAttributes",
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        "redshift:DescribeClusters",
        "redshift:DescribeLoggingStatus",
        "es:ListDomainNames",
        "es:DescribeDomains",
        "elasticache:DescribeReplicationGroups",
        "elasticfilesystem:DescribeFileSystems",
        "kms:ListAliases"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::*/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "*",
      "Condition": {
        "StringLike": {
          "kms:ViaService": "s3.*.amazonaws.com"
        }
      }
    }
  ]
}
```
:::

### Microsoft Azure

Konfigurationsnivån lägger inte till något: anslutningens roll **Monitoring Reader** läser redan varje resurs konfiguration genom Azure Resource Manager. Innehållsnivån lägger till den inbyggda rollen **Storage Blob Data Reader**, med samma omfattning som anslutningen: prenumerationen, eller klientorganisationens rothanteringsgrupp.

### Google Cloud

Konfigurationsnivån lägger inte till något: anslutningens roll **Cloud Asset Viewer** läser redan varje resurs konfiguration och IAM-policy. Innehållsnivån lägger till två roller, `roles/storage.objectViewer` och `roles/bigquery.dataViewer`, i projektet eller organisationen, och slår på BigQuery API, `bigquery.googleapis.com`.

## Varför stickprov av innehåll är valfria

Konfigurationsnivån hittar det som är exponerat: en offentlig bucket, en databas som är öppen mot internet, kryptering, säkerhetskopior eller åtkomstloggar som saknas. Den kan inte avgöra vad ett datalager innehåller, så ett datalager där inget har hittats räknas som Public, den lägsta känsligheten, och dess problem är lika allvarliga som de skulle vara för offentliga data. En offentlig bucket med webbplatsbilder är ingen nödsituation; en offentlig bucket med kortnummer är det.

Stickprov av innehållet skiljer de två åt. De sätter varje datalagers känslighet utifrån det som det innehåller, så att samma brist är Kritisk för kortnummer och Låg för bilder. De hittar också det som bara innehållet visar: hemligheter, kortens säkerhetskoder, lösenord som sparats som de skrevs, och kopior av produktionsdata i ett testdatalager.

Så de flesta team går till väga i den här ordningen: konfigurationsnivån överallt, sedan stickprov av innehåll där du behöver veta vad ett datalager innehåller. Skanning av innehåll kan också stängas av för ett enskilt datalager, med **Scan Content** i datalagrets **Inställningar**, eller för hela projektet.

## Vad en innehållsskanning läser

En skanning läser lite av ett datalager, inom projektets gränser, och slutar efter 8 minuter oavsett vad som återstår. Nästa skanning fortsätter därifrån: den hoppar över ett objekt som inte har ändrats sedan det lästes, om det inte var för 7 dagar sedan eller mer.

- **Buckets och containrar** samplas efter slag, inte efter antal. Objektnamnen listas först, högst tio gånger så många som skanningen får läsa och aldrig fler än 200 000. Varje namn blir sitt mönster, där datum, UUID:er, långa hexsekvenser och tal ersätts med `*`, så att `exports/2026-10-27/users-0001.csv` blir `exports/*/users-*.csv`. De nyaste objekten för varje mönster läses, ett av varje innan ett andra av något, och högst 5 av ett mönster. Varje objekt läses från början: högst **Bytes Per Object** av det, och **Bytes Per Scan** totalt. En skanning samplar högst 10 containrar i ett Azure-lagringskonto.
- **Filer läses som det de är.** CSV och TSV per kolumn, JSON och JSON Lines per sökväg, `.env`, `.ini`, `.properties`, TOML och YAML per nyckel, XML och HTML som sin text, Word-, Excel- och PowerPoint-filer via sin text och sina celler, och allt annat som fritext. En gzip-fil packas upp först. Bilder, Parquet, Avro, PDF och andra binära format läses inte, och skanningen säger det.
- **Dataset och databaser** läses tabell för tabell: högst **Tables Per Scan** tabeller, och **Rows Per Table** rader i varje.

Varje skanning sparar en förteckning över vad den läste, efter namn: objekten, tabellerna eller tjänsterna, aldrig deras innehåll. Det som den inte kunde läsa - en förfrågan som molnet nekade, tidsgränsen, bytebudgeten - blir en varning på skanningen, och skanningen markeras **Partly succeeded**.

## Skanna en databas som du driver

Data Security tar stickprov av PostgreSQL- och MySQL-databaser, på ett av två sätt. En databas som produkten Databaser övervakar, eller en som dina tjänster pratar med på tjänstekartan, är redan ett datalager. En databas som ingen skanning hittar lägger du själv till som ett datalager.

- **Från OneUptimes workers.** I datalagrets **Inställningar** sätter du **Connection String** till en som bara kan läsa, som `postgresql://reader:password@db.internal:5432/app`. Den krypteras i vila och returneras aldrig av API:t. Ge den en databasanvändare som kan läsa och inget annat.
- **Från en sond i ditt nätverk.** Välj sonden under **Scan From Probe**, och ange i **Probe Connection Variable** namnet på den miljövariabel på sonden som innehåller anslutningssträngen. Sonden läser databasen inifrån ditt nätverk och skickar bara tillbaka det den hittade: anslutningssträngen når aldrig OneUptime. Se [Anpassade probes](/docs/probe/custom-probe) för att köra en sond.

## Vad OneUptime sparar

För varje datatyp som hittas på varje plats - en kolumn, ett fält, ett objektmönster, ett telemetriattribut - sparar ett fynd:

- hur många av värdena i stickprovet som innehöll den, av hur många, och hur många av dem som var välkända testvärden;
- hur många olika värden som matchade, uppskattat från hashar som stannar i skannerns minne och kastas med skanningen;
- konfidensen, och om platsens namn pekade på datatypen;
- högst tre maskerade stickprov, maskerade inne i skannern innan något lämnar den.

Det sparar aldrig ett råvärde. Varje slags värde maskeras så att en person kan känna igen det, men aldrig använda det:

| Värde | Maskerat stickprov |
| --- | --- |
| En e-postadress | `j***@e******.com`: den första bokstaven i namnet och i domänen, och toppdomänen |
| Ett kortnummer | `**** **** **** 4242`: de fyra sista siffrorna, som PCI DSS tillåter att ett kort visas |
| En hemlighet | Dess fyra första och fyra sista tecken när den är lång, dess två första när den är kort, och bara rubriken för en privat nyckel |
| En URL eller anslutningssträng | Allt utom lösenordet |
| En IP-adress | Dess första del, nätverket, med resten dolt |
| Ett värde som hittats via namnet | Dess första tecken, sedan `****` |
| En dokumentmärkning | Märkningen som den är skriven, till exempel "Confidential": den säger vad dokumentet är |
| Allt annat | Dess två till fyra sista tecken, med avgränsarna kvar, som `***-**-6789` |

Stäng av **Keep Masked Samples** i projektets inställningar för att bara spara antal: från nästa skanning av varje datalager sparar fynden den skriver inga stickprov.

Kopior av data mellan datalager hittas med fingeravtryck, inte värden: 128 tal på 16 bitar för varje datatyp, hashade med en nyckel som är projektets egen (se [Så förblir fingeravtrycken privata](/docs/data-security/flows-access-residency#how-fingerprints-stay-private)).

Ett fynd räknas för sitt datalager i 30 dagar efter att en skanning senast såg det, eftersom ett stickprov kan missa det som fortfarande finns där. Ett som inte har setts på 90 dagar tas bort. Ett datalager behåller högst 2 000 fynd.

## Inställningar

Inställningarna för Data Security är en uppsättning per projekt, i avsnittet **Inställningar** i menyn för Data Security. De börjar med de här standardvärdena:

| Inställning | Standard | Vad den gör |
| --- | --- | --- |
| **Check Configuration** | På | Kör kontrollerna på varje datalager. När den är av öppnas, ändras eller stängs inget problem. |
| **Scan Content** | På | Tar stickprov av datalagrens innehåll där behörigheten för innehåll har getts. |
| **Scan Telemetry** | På | Tar stickprov av projektets loggar, spår, undantag, uppspelningar och AI-konversationer. |
| **Keep Masked Samples** | På | Sparar upp till tre maskerade stickprov med varje fynd. Av sparar bara antal. |
| **Öppna säkerhetsärenden** | På | Öppnar ett säkerhetsärende, grupperat per datalager, när ett kritiskt problem öppnas. |
| **Raise Alerts** | Av | Skapar ett larm, som larmar den som har jour, när ett kritiskt problem öppnas. |
| **Larmallvar** | Tom | Allvarlighetsgraden för de larmen. Tom är projektets allvarligaste. |
| **Avisera ägare** | På | Mejlar ett datalagers ägare när ett problem öppnas på det. |
| **Objects Per Scan** | 2 000 | Det största antalet objekt som en skanning av en bucket läser, från 10 till 50 000. |
| **Bytes Per Object** | 65 536 (64 KB) | Det största antalet byte som läses från ett objekt, från 1 024 till 4 194 304. |
| **Bytes Per Scan** | 52 428 800 (50 MB) | Det största antalet byte som en innehållsskanning läser totalt, från 65 536 till 1 073 741 824. |
| **Rows Per Table** | 1 000 | Det största antalet rader som läses från en tabell, från 10 till 100 000. |
| **Tables Per Scan** | 200 | Det största antalet tabeller som en skanning läser, från 1 till 5 000. |
| **Telemetry Sample Size** | 500 | Hur många av de senaste posterna för varje tjänst och signal som en telemetriskanning läser, från 10 till 10 000. |
| **Scan Every (Hours)** | 24 | Hur ofta stickprov tas av ett datalagers innehåll igen, från 1 till 720. |
| **Never Sensitive** | Tom | Värden som aldrig är fynd, till exempel din egen supportadress. |
| **Data Types Turned Off** | Tom | Inbyggda datatyper som projektets skanningar inte letar efter: reglagen under **Built-in Data Types**. |

## Felsökning

:::details Ett datalager säger att dess innehåll inte skannades
Skanningen säger varför: "Content scanning needs the connection's content permission, or a connection string for a database." Sätt datalagrets anslutning till **Configuration and content samples** och kör dess kommando igen, eller ge databasen en anslutningssträng. Kontrollera också att **Scan Content** är på för datalagret och i projektets inställningar.
:::

:::details En kontroll säger att den inte kan avgöra
Ett faktum som läsaren inte kunde läsa - en behörighet som rollen inte har, ett API som inte är påslaget - är okänt, aldrig gissat. Dess kontroll rapporterar att den inte kan avgöra, och ett problem som den öppnade förblir öppet: ingen får dra slutsatsen att en brist är åtgärdad för att OneUptime inte kunde titta. Konfigurationsläsningens varningar säger vad den inte kunde läsa. Kör anslutningens kommando igen för att ge det som saknas.
:::

:::details Inga S3-buckets eller BigQuery-dataset visas
De kommer från konfigurationsläsningen, inte från molninventariet. Sätt anslutningen till **Configuration only** eller högre, och kör dess kommando igen.
:::

:::details En skanning är markerad Partly succeeded
Den nådde en gräns innan den läste allt: de 8 minuterna, **Bytes Per Scan** eller **Objects Per Scan**, eller en förfrågan som molnet nekade. Dess varningar säger vilken. Nästa skanning fortsätter och hoppar över det som inte har ändrats, eller så höjer du gränsen.
:::

## Nästa steg

:::cards
- [Känsliga datatyper](/docs/data-security/data-types): Vad skannern letar efter i det den läser.
- [Datasäkerhetskontroller och problem](/docs/data-security/checks-and-issues): Vad konfigurationsläsningen kontrolleras för.
- [Känsliga data i telemetri](/docs/data-security/telemetry): Dina loggar, spår och AI-konversationer, som inte behöver någon konfiguration.
- [Anslut ett molnkonto](/docs/telemetry/cloud-accounts): Anslut AWS, Azure eller Google Cloud från början.
:::

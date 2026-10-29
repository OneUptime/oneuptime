# Konfigurera Datasäkerhet

Datasäkerhet läser bara det du låter den läsa. Varje molnanslutning läses på en av tre nivåer, en databas som du driver läses med en anslutningssträng som du ger den, och telemetri behöver ingenting. Den här sidan beskriver vad varje val låter OneUptime läsa, exakt vilka behörigheter det beviljar och vad OneUptime sparar av det som läses.

:::cards
- [Välj en nivå](#välj-en-nivå-för-varje-anslutning): Av, Endast konfiguration eller Konfiguration och innehållsprover.
- [Vad varje nivå beviljar](#vad-varje-nivå-beviljar): AWS-åtgärderna, och rollerna i Azure och Google Cloud.
- [Skanna en databas som du driver](#skanna-en-databas-som-du-driver): En anslutningssträng med enbart läsbehörighet, eller en sond i ditt nätverk.
- [Vad OneUptime sparar](#vad-oneuptime-sparar): Antal, platser och maskerade prov, aldrig ett värde.
- [Låt Datasäkerhet stänga en exponering](#låt-datasäkerhet-stänga-en-exponering): Den enda skrivbehörighet som en anslutning kan få, avstängd tills du slår på den.
:::

## Välj en nivå för varje anslutning

| Nivå | I formuläret | Vad OneUptime läser |
| --- | --- | --- |
| Av | **Av** | Inget datalagers konfiguration eller innehåll. Datasäkerhet listar ändå de datalager som din molninventering känner till, med det som inventeringen säger om dem: om en RDS-databas är krypterad, offentlig, skyddad mot borttagning och säkerhetskopierad, och om en DynamoDB-tabell kan återställas till en tidpunkt. |
| Konfiguration | **Endast konfiguration** | Hur varje datalager är uppsatt: vem som kan nå det, och hur det krypteras, säkerhetskopieras, versionshanteras, loggas, replikeras och taggas. Aldrig data, och aldrig en hemlighet. |
| Innehåll | **Konfiguration och innehållsprover** | Det, plus prover av vad S3-buckets, Azure-lagringskonton, Cloud Storage-buckets och BigQuery-dataset innehåller. |

Varje anslutning börjar på **Av**. [Anslut ett molnkonto](/docs/telemetry/cloud-accounts#datasäkerhet) visar kommandot som varje nivå kör i varje moln, ord för ord. Så här ändrar du en anslutnings nivå:

:::steps
### Öppna anslutningen

Gå till **Moln → Anslut**. Välj **Redigera** på anslutningen, eller anslut ett nytt konto.

### Välj nivån

Under **Fler fält** ställer du in **Datasäkerhet** på den nivå du vill ha.

### Kör kommandot igen

Kommandot som formuläret visar ändras med nivån. Kör det i ditt molns skal, som du gjorde när du anslöt: det beviljar det som den nya nivån behöver, och inget mer. Välj sedan **Spara ändringar**, eller **Anslut** för en ny anslutning.
:::

Läsningar på den nya nivån börjar inom en timme, och **Kontrollera nu** eller **Skanna nu** på ett datalager startar en direkt. OneUptime läser bara det som anslutningens nivå anger, oavsett vad rollen fortfarande tillåter: sänk nivån så slutar läsningarna direkt. För att också ta bort åtkomsten kör du det nya kommandot: i AWS ersätter det policyn med den lägre. **Av** lägger inte till något, så den lämnar kvar det som ett tidigare kommando beviljade. Ta bort det själv: i AWS med `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity`, och i Azure och Google Cloud genom att ta bort rollerna som innehållsnivån lade till.

## Vad varje nivå beviljar

### Amazon Web Services

Konfigurationsnivån lägger en andra inline-policy, `OneUptimeDataSecurity`, på rollen, bredvid den skrivskyddade. Den innehåller exakt de läsåtgärder som datasäkerhetens läsare anropar. Var och en läser en inställning; ingen läser data eller skriver något:

| Vad OneUptime använder dem till | Åtgärder |
| --- | --- |
| Lista buckets, och läsa vem som kan nå var och en och hur den krypteras, versionshanteras, loggas, kopieras och taggas | `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketPolicyStatus`, `s3:GetBucketPublicAccessBlock`, `s3:GetAccountPublicAccessBlock`, `s3:GetBucketAcl`, `s3:GetBucketPolicy`, `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning`, `s3:GetBucketLogging`, `s3:GetBucketOwnershipControls`, `s3:GetReplicationConfiguration`, `s3:GetBucketTagging` |
| Läsa hur databaserna nås, krypteras och säkerhetskopieras, och vilka deras manuella ögonblicksbilder delas med | `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeDBSnapshots`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshots`, `rds:DescribeDBClusterSnapshotAttributes`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `redshift:DescribeClusters`, `redshift:DescribeLoggingStatus` |
| Läsa hur sökdomänerna, cacharna och filsystemen är uppsatta | `es:ListDomainNames`, `es:DescribeDomains`, `elasticache:DescribeReplicationGroups`, `elasticfilesystem:DescribeFileSystems` |
| Skilja AWS:s egna nycklar (alias/aws/...) från nycklarna som du hanterar | `kms:ListAliases` |

Innehållsnivån lägger till tre åtgärder i samma policy, var och en på sina egna resurser:

| Åtgärd | Tillåten på | Vad den är till för |
| --- | --- | --- |
| `s3:ListBucket` | `arn:aws:s3:::*` | Lista en buckets objektnamn |
| `s3:GetObject` | `arn:aws:s3:::*/*` | Läsa de första byten av ett objekt som provtas |
| `kms:Decrypt` | `*`, bara när `kms:ViaService` är `s3.*.amazonaws.com` | Läsa ett objekt som är krypterat med en KMS-nyckel, bara via S3: aldrig en direkt dekryptering av något annat som nyckeln skyddar |

Med en **Åtkomstnyckel** i stället för en roll läggs policyn på en grupp, `OneUptimeDataSecurity`, som nyckelns användare läggs till i: IAM begränsar en användares egna inline-policyer till 2 048 tecken totalt, och den skrivskyddade policyn tar upp det mesta av dem. En anslutning som läser en hel AWS Organization lägger samma policy i rollen i varje konto.

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

Konfigurationsnivån lägger inte till något: anslutningens roll **Monitoring Reader** läser redan varje resurs konfiguration via Azure Resource Manager. Innehållsnivån lägger till den inbyggda rollen **Storage Blob Data Reader**, med samma omfång som anslutningen: prenumerationen, eller klientorganisationens rothanteringsgrupp.

### Google Cloud

Konfigurationsnivån lägger inte till något: anslutningens roll **Cloud Asset Viewer** läser redan varje resurs konfiguration och IAM-policy. Innehållsnivån lägger till två roller, `roles/storage.objectViewer` och `roles/bigquery.dataViewer`, på projektet eller organisationen, och slår på BigQuery API, `bigquery.googleapis.com`.

## Låt Datasäkerhet stänga en exponering

Att läsa är allt en anslutning gör tills du väljer något annat. **Datasäkerhetsrespons**, under **Fler fält** bredvid **Datasäkerhet**, låter också Datasäkerhet blockera ett datalagers offentliga åtkomst och sluta dela dess ögonblicksbilder: från datalagrets problem, med **Åtgärda härifrån** (se [Kontroller och problem i Datasäkerhet](/docs/data-security/checks-and-issues#åtgärda-härifrån)), och från playbooks i Security Operations. Den är **Av** tills du väljer **Blockera offentlig åtkomst och delning**, och kommandot som formuläret då visar beviljar en enda smal skrivbehörighet, för sig:

| Moln | Vad kommandot lägger till | Vad den får göra |
| --- | --- | --- |
| AWS | En tredje inline-policy, `OneUptimeDataSecurityResponse` | `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshotAttributes`, `rds:ModifyDBSnapshotAttribute` och `rds:ModifyDBClusterSnapshotAttribute`: en buckets Block Public Access, och vilka en manuell ögonblicksbild delas med |
| Azure | En anpassad roll, `OneUptime Data Security Response`, med anslutningens omfång | `Microsoft.Storage/storageAccounts/read` och `Microsoft.Storage/storageAccounts/write`: ett lagringskontos inställningar, som anonym blobåtkomst, aldrig dess nycklar |
| Google Cloud | En anpassad roll, `oneuptimeDataSecurityResponse` | `storage.buckets.get` och `storage.buckets.update`: en buckets inställningar, som förhindrande av offentlig åtkomst |

Inget av det som den beviljar läser data, tar bort något eller ändrar vem som får logga in. Ställ tillbaka den på **Av** så slutar Datasäkerhet använda den direkt. För att också ta bort åtkomsten i AWS tar du bort policyn med `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurityResponse`.

## Varför innehållsprover är valfria

Konfigurationsnivån hittar det som är exponerat: en offentlig bucket, en databas som är öppen mot internet, saknad kryptering, saknade säkerhetskopior eller åtkomstloggar. Den kan inte avgöra vad ett datalager innehåller, så ett datalager där inget har hittats räknas som Offentlig, den lägsta känsligheten, och dess problem är lika allvarliga som de skulle vara för offentliga data. En offentlig bucket med bilder till en webbplats är ingen nödsituation; en offentlig bucket med kortnummer är det.

Innehållsprover skiljer de två åt. De sätter varje datalagers känslighet utifrån vad det innehåller, så att samma problem får allvarlighetsgraden Kritisk för kortnummer och Låg för bilder. De hittar också det som bara innehållet visar: hemligheter, kortens säkerhetskoder, lösenord som sparats så som de skrevs, och kopior av produktionsdata i ett testdatalager.

Så den ordning som de flesta team följer är: konfigurationsnivån överallt, och sedan innehållsprover där du behöver veta vad ett datalager innehåller. Innehållsskanning kan också stängas av för ett enskilt datalager, med **Skanna innehåll** i datalagrets **Inställningar**, eller för hela projektet.

## Vad en innehållsskanning läser

En skanning läser lite av ett datalager, inom projektets gränser, och slutar efter 8 minuter oavsett vad som återstår. Nästa skanning fortsätter därifrån: den hoppar över ett objekt som inte har ändrats sedan det lästes, om det inte var 7 eller fler dagar sedan.

- **Buckets och containrar** provtas efter sort, inte efter antal. Objektnamnen listas först, högst tio gånger så många som skanningen får läsa och aldrig fler än 200 000. Varje namn blir sitt mönster, där datum, UUID:n, långa hexsekvenser och tal blir `*`, så `exports/2026-10-27/users-0001.csv` blir `exports/*/users-*.csv`. De senaste objekten för varje mönster läses, ett av varje innan ett andra av något, och högst 5 av ett och samma mönster. Varje objekt läses från början: högst **Byte per objekt** av det, och **Byte per skanning** totalt. En skanning provtar högst 10 containrar i ett Azure-lagringskonto.
- **Filer läses som det de är.** CSV och TSV per kolumn, JSON och JSON lines per sökväg, `.env`, `.ini`, `.properties`, TOML och YAML per nyckel, XML och HTML som sin text, Word-, Excel- och PowerPoint-filer efter sin text och sina celler, och allt annat som fritext. En gzip-fil packas upp först. Bilder, Parquet, Avro, PDF och andra binära format läses inte, och skanningen säger det.
- **Dataset och databaser** läses tabell för tabell: högst **Tabeller per skanning** tabeller, och **Rader per tabell** rader från varje.

Varje skanning sparar en förteckning över vad den läste, efter namn: objekten, tabellerna eller tjänsterna, aldrig deras innehåll. Det den inte kunde läsa - en begäran som molnet nekade, tidsgränsen, bytebudgeten - blir en varning på skanningen, och skanningen markeras som **Delvis lyckad**.

## Skanna en databas som du driver

Datasäkerhet provtar PostgreSQL- och MySQL-databaser, på ett av två sätt. En databas som produkten Database övervakar, eller en som dina tjänster pratar med på tjänstekartan, är redan ett datalager. En databas som ingen skanning hittar lägger du själv till som ett datalager.

- **Från OneUptimes workers.** I datalagrets **Inställningar** sätter du **Anslutningssträng** till en som bara kan läsa, som `postgresql://reader:password@db.internal:5432/app`. Den krypteras i vila och returneras aldrig av API:t. Ge den en databasanvändare som kan läsa och inget annat.
- **Från en sond i ditt nätverk.** Välj sonden under **Skanna från sond**, och ange i **Anslutningsvariabel för sond** namnet på den miljövariabel på sonden som innehåller anslutningssträngen. Sonden läser databasen inifrån ditt nätverk och skickar bara tillbaka det den hittade: anslutningssträngen når aldrig OneUptime. Se [Anpassade sonder](/docs/probe/custom-probe) för att köra en sond.

## Vad OneUptime sparar

För varje datatyp som hittas på varje plats - en kolumn, ett fält, ett objektmönster, ett telemetriattribut - sparar ett fynd:

- hur många provtagna värden som innehöll den, av hur många, och hur många av dem som var välkända testvärden;
- hur många olika värden som matchade, uppskattat från hashar som stannar i skannerns minne och släpps med skanningen;
- konfidensen, och om platsens namn pekade på datatypen;
- högst tre maskerade prov, maskerade inuti skannern innan något lämnar den.

Det sparar aldrig ett råvärde. Varje sorts värde maskeras så att en person kan känna igen det, men aldrig använda det:

| Värde | Maskerat prov |
| --- | --- |
| En e-postadress | `j***@e******.com`: den första bokstaven i namnet och i domänen, och toppdomänen |
| Ett kortnummer | `**** **** **** 4242`: de fyra sista siffrorna, så som PCI DSS tillåter att ett kort visas |
| En hemlighet | Dess fyra första och fyra sista tecken när den är lång, dess två första när den är kort, och bara huvudet på en privat nyckel |
| En URL eller anslutningssträng | Allt utom lösenordet |
| En IP-adress | Dess första del, nätverket, med resten dolt |
| Ett värde som hittats via namnet | Dess första tecken, följt av `****` |
| En dokumentmärkning | Märkningen som den är skriven, som "Confidential": den säger vad dokumentet är |
| Allt annat | Dess två till fyra sista tecken, med avgränsarna kvar, som `***-**-6789` |

Stäng av **Spara maskerade prov** i projektets inställningar för att bara spara antal: från nästa skanning av varje datalager sparar fynden som den skriver inga prov.

Kopior av data mellan datalager hittas med fingeravtryck, inte med värden: 128 tal på 16 bitar för varje datatyp, hashade med en nyckel som är projektets egen (se [Så förblir fingeravtrycken privata](/docs/data-security/flows-access-residency#hur-fingeravtrycken-förblir-privata)).

Ett fynd räknas till sitt datalager i 30 dagar efter att en skanning senast såg det, eftersom ett prov kan missa det som fortfarande finns där. Ett fynd som inte har setts på 90 dagar tas bort. Ett datalager har högst 2 000 fynd.

## Inställningar

Inställningarna för Datasäkerhet är en uppsättning per projekt, i avsnittet **Inställningar** i menyn för Datasäkerhet. De börjar med de här standardvärdena:

| Inställning | Standard | Vad den gör |
| --- | --- | --- |
| **Kontrollera konfiguration** | På | Kör kontrollerna på varje datalager. När den är av öppnas, ändras eller stängs inga problem. |
| **Skanna innehåll** | På | Tar prover på datalagrens innehåll där innehållsbehörigheten har beviljats. |
| **Skanna telemetri** | På | Tar prover på projektets loggar, spår, undantag, uppspelningar och AI-konversationer. |
| **Spara maskerade prov** | På | Sparar upp till tre maskerade prov med varje fynd. När den är av sparas bara antal. |
| **Öppna säkerhetsärenden** | På | Öppnar ett säkerhetsärende, grupperat per datalager, när ett kritiskt problem öppnas. |
| **Skapa larm** | Av | Skapar ett larm, som når den som har jour, när ett kritiskt problem öppnas. |
| **Larmallvar** | Tom | Allvarlighetsgraden för de larmen. Tom betyder projektets allvarligaste. |
| **Avisera ägare** | På | Skickar e-post till ett datalagers ägare när ett problem öppnas på det. |
| **Objekt per skanning** | 2 000 | Det högsta antalet objekt som en skanning av en bucket läser, från 10 till 50 000. |
| **Byte per objekt** | 65 536 (64 KB) | Det högsta antalet byte som läses från ett objekt, från 1 024 till 4 194 304. |
| **Byte per skanning** | 52 428 800 (50 MB) | Det högsta antalet byte som en innehållsskanning läser totalt, från 65 536 till 1 073 741 824. |
| **Rader per tabell** | 1 000 | Det högsta antalet rader som läses från en tabell, från 10 till 100 000. |
| **Tabeller per skanning** | 200 | Det högsta antalet tabeller som en skanning läser, från 1 till 5 000. |
| **Provstorlek för telemetri** | 500 | Hur många nya poster för varje tjänst och signal som en telemetriskanning läser, från 10 till 10 000. |
| **Skanningsintervall (timmar)** | 24 | Hur ofta ett datalagers innehåll provtas igen, från 1 till 720. |
| **Aldrig känsligt** | Tom | Värden som aldrig blir fynd, som din egen supportadress. |
| **Avstängda datatyper** | Tom | Inbyggda datatyper som projektets skanningar inte letar efter: reglagen under **Inbyggda datatyper**. |

## Felsökning

:::details Ett datalager säger att dess innehåll inte skannades
Skanningen säger varför: "Innehållsskanning kräver anslutningens innehållsbehörighet, eller en anslutningssträng för en databas." Ställ in datalagrets anslutning på **Konfiguration och innehållsprover** och kör dess kommando igen, eller ge databasen en anslutningssträng. Kontrollera också att **Skanna innehåll** är på för datalagret och i projektets inställningar.
:::

:::details En kontroll säger att den inte kan avgöra
Ett faktum som läsaren inte kunde läsa - en behörighet som rollen inte har, ett API som inte är påslaget - är okänt, aldrig gissat. Dess kontroll rapporterar att den inte kan avgöra, och ett problem som den öppnade förblir öppet: ingen får dra slutsatsen att ett problem är åtgärdat för att OneUptime inte kunde titta. Konfigurationsläsningens varningar säger vad den inte kunde läsa. Kör anslutningens kommando igen för att bevilja det som saknas.
:::

:::details Inga S3-buckets eller BigQuery-dataset visas
De kommer från konfigurationsläsningen, inte från molninventeringen. Ställ in anslutningen på **Endast konfiguration** eller högre, och kör dess kommando igen.
:::

:::details En skanning är markerad som Delvis lyckad
Den nådde en gräns innan den hade läst allt: de 8 minuterna, **Byte per skanning** eller **Objekt per skanning**, eller en begäran som molnet nekade. Dess varningar säger vilken. Nästa skanning fortsätter och hoppar över det som inte har ändrats, eller så höjer du gränsen.
:::

## Nästa steg

:::cards
- [Känsliga datatyper](/docs/data-security/data-types): Vad skannern letar efter i det den läser.
- [Kontroller och problem i Datasäkerhet](/docs/data-security/checks-and-issues): Vad konfigurationsläsningen kontrolleras mot.
- [Känsliga data i telemetri](/docs/data-security/telemetry): Dina loggar, spår och AI-konversationer, som inte behöver någon konfiguration.
- [Anslut ett molnkonto](/docs/telemetry/cloud-accounts): Anslut AWS, Azure eller Google Cloud från början.
:::

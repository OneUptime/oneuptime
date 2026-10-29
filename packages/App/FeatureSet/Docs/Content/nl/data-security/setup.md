# Gegevensbeveiliging instellen

Gegevensbeveiliging leest alleen wat je toestaat. Elke cloudkoppeling wordt gelezen op een van drie niveaus, een database die je zelf beheert wordt gelezen met een verbindingsreeks die je opgeeft, en telemetrie heeft niets nodig. Deze pagina zegt wat elke keuze OneUptime laat lezen, welke machtigingen ze precies geeft, en wat OneUptime bewaart van wat het leest.

:::cards
- [Kies een niveau](#kies-een-niveau-voor-elke-koppeling): Uit, Alleen configuratie, of Configuratie en inhoudsvoorbeelden.
- [Wat elk niveau toestaat](#wat-elk-niveau-toestaat): De AWS-acties, en de rollen in Azure en Google Cloud.
- [Een database scannen die je zelf beheert](#een-database-scannen-die-je-zelf-beheert): Een alleen-lezen verbindingsreeks, of een sonde in je netwerk.
- [Wat OneUptime bewaart](#wat-oneuptime-bewaart): Tellingen, locaties en gemaskeerde voorbeelden, nooit een waarde.
- [Gegevensbeveiliging een blootstelling laten sluiten](#gegevensbeveiliging-een-blootstelling-laten-sluiten): Het enige schrijfrecht dat een koppeling kan krijgen, uit tot je het aanzet.
:::

## Kies een niveau voor elke koppeling

| Niveau | In het formulier | Wat OneUptime leest |
| --- | --- | --- |
| Uit | **Uit** | De configuratie of inhoud van geen enkele opslag. Gegevensbeveiliging vermeldt nog steeds de opslagen die je cloudinventaris kent, met wat de inventaris erover zegt: of een RDS-database versleuteld, openbaar, tegen verwijdering beschermd en geback-upt is, en of een DynamoDB-tabel naar een tijdstip kan worden hersteld. |
| Configuratie | **Alleen configuratie** | Hoe elke gegevensopslag is ingericht: wie erbij kan, en hoe hij is versleuteld, geback-upt, geversioneerd, gelogd, gerepliceerd en getagd. Nooit gegevens, en nooit een geheim. |
| Inhoud | **Configuratie en inhoudsvoorbeelden** | Dat, en voorbeelden van wat S3-buckets, Azure-opslagaccounts, Cloud Storage-buckets en BigQuery-datasets bevatten. |

Elke koppeling begint op **Uit**. [Een cloudaccount koppelen](/docs/telemetry/cloud-accounts#gegevensbeveiliging) toont woord voor woord de opdracht die elk niveau op elke cloud uitvoert. Zo wijzig je het niveau van een koppeling:

:::steps
### Open de koppeling

Ga naar **Cloud → Koppelen**. Kies **Bewerken** op de koppeling, of koppel een nieuw account.

### Kies het niveau

Zet onder **Meer velden** het veld **Gegevensbeveiliging** op het niveau dat je wilt.

### Voer de opdracht opnieuw uit

De opdracht die het formulier toont, verandert met het niveau. Voer die uit in de shell van je cloud, zoals je deed bij het koppelen: ze geeft wat het nieuwe niveau nodig heeft, en niets meer. Kies daarna **Wijzigingen opslaan**, of **Koppelen** voor een nieuwe koppeling.
:::

Uitlezingen op het nieuwe niveau starten binnen het uur, en **Nu controleren** of **Nu scannen** op een opslag start er meteen een. OneUptime leest alleen wat het niveau van de koppeling zegt, wat de rol ook nog toestaat: verlaag het niveau, en de uitlezingen stoppen meteen. Om de toegang ook in te trekken, voer je de nieuwe opdracht uit: op AWS vervangt die het beleid door het lagere. **Uit** voegt niets toe, dus het laat staan wat een eerdere opdracht gaf. Verwijder dat zelf: op AWS met `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity`, en op Azure en Google Cloud door de rollen te verwijderen die het inhoudsniveau toevoegde.

## Wat elk niveau toestaat

### Amazon Web Services

Het configuratieniveau zet een tweede inline-beleid, `OneUptimeDataSecurity`, op de rol, naast het alleen-lezen beleid. Het bevat precies de leesacties die de lezer van Gegevensbeveiliging aanroept. Elke actie leest een instelling; geen enkele leest gegevens of schrijft iets:

| Waarvoor OneUptime ze gebruikt | Acties |
| --- | --- |
| De buckets opsommen, en lezen wie bij elke bucket kan en hoe die is versleuteld, geversioneerd, gelogd, gekopieerd en getagd | `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketPolicyStatus`, `s3:GetBucketPublicAccessBlock`, `s3:GetAccountPublicAccessBlock`, `s3:GetBucketAcl`, `s3:GetBucketPolicy`, `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning`, `s3:GetBucketLogging`, `s3:GetBucketOwnershipControls`, `s3:GetReplicationConfiguration`, `s3:GetBucketTagging` |
| Lezen hoe de databases worden bereikt, versleuteld en geback-upt, en met wie hun handmatige snapshots worden gedeeld | `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeDBSnapshots`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshots`, `rds:DescribeDBClusterSnapshotAttributes`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `redshift:DescribeClusters`, `redshift:DescribeLoggingStatus` |
| Lezen hoe de zoekdomeinen, caches en bestandssystemen zijn ingericht | `es:ListDomainNames`, `es:DescribeDomains`, `elasticache:DescribeReplicationGroups`, `elasticfilesystem:DescribeFileSystems` |
| De eigen sleutels van AWS (alias/aws/...) onderscheiden van de sleutels die je zelf beheert | `kms:ListAliases` |

Het inhoudsniveau voegt drie acties toe aan hetzelfde beleid, elk op zijn eigen resources:

| Actie | Toegestaan op | Waarvoor het dient |
| --- | --- | --- |
| `s3:ListBucket` | `arn:aws:s3:::*` | De objectnamen van een bucket opsommen |
| `s3:GetObject` | `arn:aws:s3:::*/*` | De eerste bytes van een bemonsterd object lezen |
| `kms:Decrypt` | `*`, alleen als `kms:ViaService` gelijk is aan `s3.*.amazonaws.com` | Een object lezen dat met een KMS-sleutel is versleuteld, alleen via S3: nooit een directe ontsleuteling van iets anders dat de sleutel beschermt |

Met een **Toegangssleutel** in plaats van een rol gaat het beleid op een groep, `OneUptimeDataSecurity`, waaraan de gebruiker van de sleutel wordt toegevoegd: IAM beperkt de eigen inline-beleidsdocumenten van een gebruiker tot samen 2.048 tekens, en het alleen-lezen beleid neemt er het grootste deel van in. Een koppeling die een hele AWS Organization leest, zet hetzelfde beleid in de rol van elk account.

:::details Het hele beleid op het inhoudsniveau
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

Het configuratieniveau voegt niets toe: de rol **Monitoring Reader** van de koppeling leest al de configuratie van elke resource via Azure Resource Manager. Het inhoudsniveau voegt de ingebouwde rol **Storage Blob Data Reader** toe, op hetzelfde bereik als de koppeling: het abonnement, of de hoofdbeheergroep van de tenant.

### Google Cloud

Het configuratieniveau voegt niets toe: de rol **Cloud Asset Viewer** van de koppeling leest al de configuratie en het IAM-beleid van elke resource. Het inhoudsniveau voegt twee rollen toe, `roles/storage.objectViewer` en `roles/bigquery.dataViewer`, op het project of de organisatie, en zet de BigQuery API aan, `bigquery.googleapis.com`.

## Gegevensbeveiliging een blootstelling laten sluiten

Lezen is alles wat een koppeling doet, tot je anders kiest. **Gegevensbeveiligingsrespons**, onder **Meer velden** naast **Gegevensbeveiliging**, laat Gegevensbeveiliging ook de openbare toegang van een opslag blokkeren en het delen van zijn snapshots stoppen: vanuit het probleem van de opslag, met **Hier oplossen** (zie [Controles en problemen van Gegevensbeveiliging](/docs/data-security/checks-and-issues#hier-oplossen)), en vanuit playbooks van Security Operations. Het staat op **Uit** tot je **Openbare toegang en delen blokkeren** kiest, en de opdracht die het formulier dan toont, geeft één beperkt schrijfrecht, los van de rest:

| Cloud | Wat de opdracht toevoegt | Wat het mag doen |
| --- | --- | --- |
| AWS | Een derde inline-beleid, `OneUptimeDataSecurityResponse` | `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshotAttributes`, `rds:ModifyDBSnapshotAttribute` en `rds:ModifyDBClusterSnapshotAttribute`: de Block Public Access van een bucket, en met wie een handmatige snapshot wordt gedeeld |
| Azure | Een aangepaste rol, `OneUptime Data Security Response`, op het bereik van de koppeling | `Microsoft.Storage/storageAccounts/read` en `Microsoft.Storage/storageAccounts/write`: de instellingen van een opslagaccount, zoals anonieme blobtoegang, nooit zijn sleutels |
| Google Cloud | Een aangepaste rol, `oneuptimeDataSecurityResponse` | `storage.buckets.get` en `storage.buckets.update`: de instellingen van een bucket, zoals de preventie van openbare toegang |

Niets wat het geeft, leest gegevens, verwijdert iets of wijzigt wie mag inloggen. Zet het terug op **Uit** en Gegevensbeveiliging stopt meteen met het gebruik ervan. Om op AWS ook de toegang in te trekken, verwijder je het beleid met `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurityResponse`.

## Waarom inhoudsvoorbeelden optioneel zijn

Het configuratieniveau vindt wat blootgesteld is: een openbare bucket, een database die openstaat voor het internet, ontbrekende versleuteling, back-ups of toegangslogs. Het kan niet zien wat een opslag bevat, dus een opslag waarin niets is gevonden, telt als Openbaar, de laagste gevoeligheid, en zijn problemen zijn even ernstig als ze voor openbare gegevens zouden zijn. Een openbare bucket met websiteafbeeldingen is geen noodgeval; een openbare bucket met kaartnummers wel.

Inhoudsvoorbeelden maken het verschil tussen die twee. Ze bepalen de gevoeligheid van elke opslag op basis van wat hij bevat, zodat hetzelfde probleem Kritiek is bij kaartnummers en Laag bij afbeeldingen. Ze vinden ook wat alleen de inhoud laat zien: geheimen, beveiligingscodes van kaarten, wachtwoorden die zijn bewaard zoals ze werden getypt, en kopieën van productiegegevens in een testopslag.

Daarom gaan de meeste teams in deze volgorde: overal het configuratieniveau, en daarna inhoudsvoorbeelden waar je moet weten wat een opslag bevat. Het scannen van inhoud kan ook worden uitgezet voor één opslag, met **Inhoud scannen** in de **Instellingen** van de opslag, of voor het hele project.

## Wat een inhoudsscan leest

Een scan leest een klein deel van een opslag, binnen de limieten van het project, en stopt na 8 minuten, wat er ook overblijft. De volgende gaat daar verder: hij slaat een object over dat niet is gewijzigd sinds het werd gelezen, tenzij dat 7 of meer dagen geleden was.

- **Buckets en containers** worden bemonsterd op soort, niet op aantal. Eerst worden de objectnamen opgesomd, hoogstens tien keer zoveel als de scan mag lezen en nooit meer dan 200.000. Elke naam wordt zijn patroon, waarin datums, UUID's, lange hexreeksen en getallen `*` worden, zodat `exports/2026-10-27/users-0001.csv` het patroon `exports/*/users-*.csv` wordt. De nieuwste objecten van elk patroon worden gelezen, van elk patroon één voordat er van welk patroon ook een tweede wordt gelezen, en hoogstens 5 van één patroon. Elk object wordt vanaf het begin gelezen: hoogstens **Bytes per object** ervan, en **Bytes per scan** in totaal. Een scan bemonstert hoogstens 10 containers van een Azure-opslagaccount.
- **Bestanden worden gelezen als wat ze zijn.** CSV en TSV per kolom, JSON en JSON Lines per pad, `.env`, `.ini`, `.properties`, TOML en YAML per sleutel, XML en HTML als hun tekst, Word-, Excel- en PowerPoint-bestanden op hun tekst en cellen, en al het andere als vrije tekst. Een gzip-bestand wordt eerst uitgepakt. Afbeeldingen, Parquet, Avro, PDF en andere binaire formaten worden niet gelezen, en de scan zegt dat.
- **Datasets en databases** worden tabel voor tabel gelezen: hoogstens **Tabellen per scan** tabellen, en **Rijen per tabel** rijen van elke tabel.

Elke scan houdt bij wat hij las, op naam: de objecten, tabellen of services, nooit hun inhoud. Wat hij niet kon lezen - een verzoek dat de cloud weigerde, de deadline, het bytebudget - is een waarschuwing op de scan, en de scan wordt gemarkeerd als **Gedeeltelijk geslaagd**.

## Een database scannen die je zelf beheert

Gegevensbeveiliging bemonstert PostgreSQL- en MySQL-databases, op een van twee manieren. Een database die het product Database bewaakt, of een waarmee je services praten op de servicekaart, is al een opslag. Een database die geen enkele scan vindt, voeg je zelf toe als opslag.

- **Vanaf de workers van OneUptime.** Zet in de **Instellingen** van de opslag de **Verbindingsreeks** op een reeks die alleen kan lezen, zoals `postgresql://reader:password@db.internal:5432/app`. Die wordt versleuteld opgeslagen en nooit door de API teruggegeven. Geef hem een databasegebruiker die kan lezen en verder niets.
- **Vanaf een sonde in je netwerk.** Kies de sonde onder **Scannen vanaf sonde**, en vul in **Verbindingsvariabele van sonde** de naam in van de omgevingsvariabele op die sonde die de verbindingsreeks bevat. De sonde leest de database vanuit je netwerk en stuurt alleen terug wat ze vond: de verbindingsreeks bereikt OneUptime nooit. Zie [Aangepaste sondes](/docs/probe/custom-probe) om een sonde te draaien.

## Wat OneUptime bewaart

Voor elk gegevenstype dat op elke locatie wordt gevonden - een kolom, een veld, een objectpatroon, een telemetrieattribuut - bewaart een bevinding:

- hoeveel bemonsterde waarden het bevatten, van hoeveel, en hoeveel daarvan bekende testwaarden waren;
- hoeveel verschillende waarden overeenkwamen, geschat op basis van hashes die in het geheugen van de scanner blijven en met de scan worden weggegooid;
- de betrouwbaarheid, en of de naam van de locatie op het gegevenstype wees;
- hoogstens drie gemaskeerde voorbeelden, gemaskeerd in de scanner voordat er iets uit vertrekt.

Ze bewaart nooit een ruwe waarde. Elke soort waarde wordt zo gemaskeerd dat een mens haar kan herkennen, maar nooit gebruiken:

| Waarde | Gemaskeerd voorbeeld |
| --- | --- |
| Een e-mailadres | `j***@e******.com`: de eerste letter van de naam en van het domein, en het topniveaulabel |
| Een kaartnummer | `**** **** **** 4242`: de laatste vier cijfers, zoals PCI DSS een kaart laat tonen |
| Een geheim | De eerste vier en laatste vier tekens als het lang is, de eerste twee als het kort is, en alleen de header van een privésleutel |
| Een URL of verbindingsreeks | Alles behalve het wachtwoord |
| Een IP-adres | Het eerste deel, het netwerk, met de rest verborgen |
| Een waarde die op naam is gevonden | Het eerste teken, dan `****` |
| Een documentmarkering | De markering zoals ze is geschreven, zoals "Confidential": die zegt wat het document is |
| Al het andere | De laatste twee tot vier tekens, met behoud van scheidingstekens, zoals `***-**-6789` |

Zet **Gemaskeerde voorbeelden bewaren** uit in de instellingen van het project om alleen tellingen te bewaren: vanaf de volgende scan van elke opslag bewaren de bevindingen die hij schrijft geen voorbeelden.

Kopieën van gegevens tussen opslagen worden gevonden via vingerafdrukken, niet via waarden: 128 getallen van 16 bits voor elk gegevenstype, gehasht met een eigen sleutel van het project (zie [Hoe vingerafdrukken privé blijven](/docs/data-security/flows-access-residency#hoe-vingerafdrukken-privé-blijven)).

Een bevinding telt nog 30 dagen nadat een scan haar het laatst zag mee voor haar opslag, omdat een steekproef kan missen wat er nog steeds staat. Een bevinding die 90 dagen niet is gezien, wordt verwijderd. Een opslag bewaart hoogstens 2.000 bevindingen.

## Instellingen

De instellingen van Gegevensbeveiliging zijn één set per project, in de sectie **Instellingen** van het menu van Gegevensbeveiliging. Ze beginnen met deze standaardwaarden:

| Instelling | Standaard | Wat het doet |
| --- | --- | --- |
| **Configuratie controleren** | Aan | Voert de controles uit op elke opslag. Staat het uit, dan opent, wijzigt of sluit er geen probleem. |
| **Inhoud scannen** | Aan | Bemonstert de inhoud van opslagen waar de inhoudsmachtiging is gegeven. |
| **Telemetrie scannen** | Aan | Bemonstert de logs, traces, uitzonderingen, herhalingen en AI-gesprekken van het project. |
| **Gemaskeerde voorbeelden bewaren** | Aan | Bewaart tot drie gemaskeerde voorbeelden bij elke bevinding. Uit bewaart alleen tellingen. |
| **Beveiligingszaken openen** | Aan | Opent een beveiligingszaak, gegroepeerd per opslag, wanneer een kritiek probleem opent. |
| **Waarschuwingen aanmaken** | Uit | Maakt een waarschuwing aan, die de dienstdoende oproept, wanneer een kritiek probleem opent. |
| **Ernst van waarschuwing** | Leeg | De ernst van die waarschuwingen. Leeg is de zwaarste ernst van het project. |
| **Eigenaren op de hoogte stellen** | Aan | Mailt de eigenaren van een opslag wanneer er een probleem op opent. |
| **Objecten per scan** | 2.000 | Het maximale aantal objecten dat één scan van een bucket leest, van 10 tot 50.000. |
| **Bytes per object** | 65.536 (64 KB) | Het maximale aantal bytes dat uit één object wordt gelezen, van 1.024 tot 4.194.304. |
| **Bytes per scan** | 52.428.800 (50 MB) | Het maximale aantal bytes dat één inhoudsscan in totaal leest, van 65.536 tot 1.073.741.824. |
| **Rijen per tabel** | 1.000 | Het maximale aantal rijen dat uit één tabel wordt gelezen, van 10 tot 100.000. |
| **Tabellen per scan** | 200 | Het maximale aantal tabellen dat één scan leest, van 1 tot 5.000. |
| **Steekproefgrootte telemetrie** | 500 | Hoeveel recente records van elke service en elk signaal een telemetriescan leest, van 10 tot 10.000. |
| **Scannen elke (uur)** | 24 | Hoe vaak de inhoud van een opslag opnieuw wordt bemonsterd, van 1 tot 720. |
| **Nooit gevoelig** | Leeg | Waarden die nooit bevindingen zijn, zoals je eigen supportadres. |
| **Uitgeschakelde gegevenstypen** | Leeg | Ingebouwde gegevenstypen waarnaar de scans van het project niet zoeken: de schakelaars onder **Ingebouwde gegevenstypen**. |

## Probleemoplossing

:::details Een opslag zegt dat zijn inhoud niet is gescand
De scan zegt waarom: "Het scannen van inhoud vereist de inhoudsmachtiging van de koppeling, of een verbindingsreeks voor een database." Zet de koppeling van de opslag op **Configuratie en inhoudsvoorbeelden** en voer de opdracht opnieuw uit, of geef de database een verbindingsreeks. Controleer ook of **Inhoud scannen** aan staat voor de opslag en in de instellingen van het project.
:::

:::details Een controle zegt dat ze het niet kan bepalen
Een feit dat de lezer niet kon lezen - een machtiging die de rol niet heeft, een API die niet is aangezet - is onbekend, en wordt nooit geraden. De controle meldt dat ze het niet kan bepalen, en een probleem dat ze opende, blijft open: niemand mag concluderen dat een probleem is opgelost omdat OneUptime niet kon kijken. De waarschuwingen van het uitlezen van de configuratie zeggen wat niet kon worden gelezen. Voer de opdracht van de koppeling opnieuw uit om te geven wat ontbreekt.
:::

:::details Er verschijnen geen S3-buckets of BigQuery-datasets
Die komen uit het uitlezen van de configuratie, niet uit de cloudinventaris. Zet de koppeling op **Alleen configuratie** of hoger, en voer de opdracht opnieuw uit.
:::

:::details Een scan is gemarkeerd als Gedeeltelijk geslaagd
Hij bereikte een limiet voordat hij alles had gelezen: de 8 minuten, **Bytes per scan** of **Objecten per scan**, of een verzoek dat de cloud weigerde. Zijn waarschuwingen zeggen welke. De volgende scan gaat verder en slaat over wat niet is gewijzigd, of je verhoogt de limiet.
:::

## Volgende stappen

:::cards
- [Gevoelige gegevenstypen](/docs/data-security/data-types): Waar de scanner naar zoekt in wat hij leest.
- [Controles en problemen van Gegevensbeveiliging](/docs/data-security/checks-and-issues): Waarop het uitlezen van de configuratie wordt gecontroleerd.
- [Gevoelige gegevens in telemetrie](/docs/data-security/telemetry): Je logs, traces en AI-gesprekken, die geen instelling nodig hebben.
- [Een cloudaccount koppelen](/docs/telemetry/cloud-accounts): Koppel eerst AWS, Azure of Google Cloud.
:::

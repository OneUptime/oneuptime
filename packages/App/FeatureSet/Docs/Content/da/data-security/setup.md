# Konfigurer Datasikkerhed

Datasikkerhed læser kun det, du tillader. Hver cloudforbindelse læses på et af tre niveauer, en database, du selv driver, læses med en forbindelsesstreng, du giver den, og telemetri kræver intet. Denne side fortæller, hvad hvert valg lader OneUptime læse, præcis hvilke tilladelser det giver, og hvad OneUptime gemmer af det, den læser.

:::cards
- [Vælg et niveau](#vælg-et-niveau-for-hver-forbindelse): Fra, Kun konfiguration eller Konfiguration og indholdsprøver.
- [Hvad hvert niveau giver adgang til](#hvad-hvert-niveau-giver-adgang-til): AWS-handlingerne og rollerne i Azure og Google Cloud.
- [Scan en database, du selv driver](#scan-en-database-du-selv-driver): En skrivebeskyttet forbindelsesstreng eller en sonde i dit netværk.
- [Hvad OneUptime gemmer](#hvad-oneuptime-gemmer): Antal, placeringer og maskerede prøver, aldrig en værdi.
- [Lad Datasikkerhed lukke en eksponering](#lad-datasikkerhed-lukke-en-eksponering): Den ene skriveadgang, en forbindelse kan få, slået fra, indtil du slår den til.
:::

## Vælg et niveau for hver forbindelse

| Niveau | I formularen | Hvad OneUptime læser |
| --- | --- | --- |
| Fra | **Fra** | Intet datalagers konfiguration eller indhold. Datasikkerhed viser stadig de datalagre, dit cloud-inventar kender til, med det, inventaret siger om dem: om en RDS-database er krypteret, offentlig, beskyttet mod sletning og sikkerhedskopieret, og om en DynamoDB-tabel kan gendannes til et bestemt tidspunkt. |
| Konfiguration | **Kun konfiguration** | Hvordan hvert datalager er sat op: hvem der kan nå det, og hvordan det er krypteret, sikkerhedskopieret, versioneret, logget, replikeret og tagget. Aldrig data og aldrig en hemmelighed. |
| Indhold | **Konfiguration og indholdsprøver** | Det samme og prøver af det, S3-buckets, Azure-lagerkonti, Cloud Storage-buckets og BigQuery-datasæt indeholder. |

Hver forbindelse starter på **Fra**. [Forbind en cloud-konto](/docs/telemetry/cloud-accounts#datasikkerhed) viser ordret den kommando, hvert niveau kører i hver cloud. Sådan ændrer du en forbindelses niveau:

:::steps
### Åbn forbindelsen

Gå til **Cloud → Forbind**. Vælg **Rediger** på forbindelsen, eller forbind en ny konto.

### Vælg niveauet

Under **Flere felter** sætter du **Datasikkerhed** til det niveau, du ønsker.

### Kør kommandoen igen

Den kommando, formularen viser, ændrer sig med niveauet. Kør den i din clouds shell, som da du forbandt kontoen: den giver det, det nye niveau kræver, og intet andet. Vælg derefter **Gem ændringer**, eller **Forbind** for en ny forbindelse.
:::

Læsninger på det nye niveau starter inden for en time, og **Kontrollér nu** eller **Scan nu** på et datalager starter en med det samme. OneUptime læser kun det, forbindelsens niveau angiver, uanset hvad rollen stadig tillader: sænk niveauet, og læsningerne stopper med det samme. For også at fjerne adgangen kører du den nye kommando: i AWS erstatter den politikken med den lavere. **Fra** tilføjer intet, så det lader det, en tidligere kommando gav, blive. Det fjerner du selv: i AWS med `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity` og i Azure og Google Cloud ved at fjerne de roller, indholdsniveauet tilføjede.

## Hvad hvert niveau giver adgang til

### Amazon Web Services

Konfigurationsniveauet lægger en anden inline-politik, `OneUptimeDataSecurity`, på rollen ved siden af den skrivebeskyttede. Den indeholder præcis de læsehandlinger, datasikkerhedslæseren kalder. Hver af dem læser en indstilling; ingen læser data eller skriver noget:

| Hvad OneUptime bruger dem til | Handlinger |
| --- | --- |
| Vis alle buckets, og læs, hvem der kan nå hver enkelt, og hvordan den er krypteret, versioneret, logget, kopieret og tagget | `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketPolicyStatus`, `s3:GetBucketPublicAccessBlock`, `s3:GetAccountPublicAccessBlock`, `s3:GetBucketAcl`, `s3:GetBucketPolicy`, `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning`, `s3:GetBucketLogging`, `s3:GetBucketOwnershipControls`, `s3:GetReplicationConfiguration`, `s3:GetBucketTagging` |
| Læs, hvordan databaserne nås, krypteres og sikkerhedskopieres, og hvem deres manuelle snapshots er delt med | `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeDBSnapshots`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshots`, `rds:DescribeDBClusterSnapshotAttributes`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `redshift:DescribeClusters`, `redshift:DescribeLoggingStatus` |
| Læs, hvordan søgedomænerne, cachene og filsystemerne er sat op | `es:ListDomainNames`, `es:DescribeDomains`, `elasticache:DescribeReplicationGroups`, `elasticfilesystem:DescribeFileSystems` |
| Skeln AWS' egne nøgler (alias/aws/...) fra de nøgler, du selv administrerer | `kms:ListAliases` |

Indholdsniveauet føjer tre handlinger til den samme politik, hver på sine egne ressourcer:

| Handling | Tilladt på | Hvad den bruges til |
| --- | --- | --- |
| `s3:ListBucket` | `arn:aws:s3:::*` | Vis navnene på en buckets objekter |
| `s3:GetObject` | `arn:aws:s3:::*/*` | Læs de første byte af et objekt, der tages prøve af |
| `kms:Decrypt` | `*`, kun når `kms:ViaService` er `s3.*.amazonaws.com` | Læs et objekt, der er krypteret med en KMS-nøgle, kun via S3: aldrig en direkte dekryptering af andet, som nøglen beskytter |

Med en **Adgangsnøgle** i stedet for en rolle lægges politikken på en gruppe, `OneUptimeDataSecurity`, som nøglens bruger føjes til: IAM begrænser en brugers egne inline-politikker til 2.048 tegn i alt, og den skrivebeskyttede politik bruger de fleste af dem. En forbindelse, der læser en hel AWS Organization, lægger den samme politik i hver kontos rolle.

:::details Hele politikken på indholdsniveauet
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

Konfigurationsniveauet tilføjer intet: forbindelsens rolle **Monitoring Reader** læser allerede hver ressources konfiguration via Azure Resource Manager. Indholdsniveauet tilføjer den indbyggede rolle **Storage Blob Data Reader** på det samme scope som forbindelsen: abonnementet eller tenantens rodadministrationsgruppe.

### Google Cloud

Konfigurationsniveauet tilføjer intet: forbindelsens rolle **Cloud Asset Viewer** læser allerede hver ressources konfiguration og IAM-politik. Indholdsniveauet tilføjer to roller, `roles/storage.objectViewer` og `roles/bigquery.dataViewer`, på projektet eller organisationen og slår BigQuery API'et, `bigquery.googleapis.com`, til.

## Lad Datasikkerhed lukke en eksponering

Læsning er alt, hvad en forbindelse gør, indtil du vælger andet. **Datasikkerhedsrespons**, under **Flere felter** ved siden af **Datasikkerhed**, lader også Datasikkerhed blokere et datalagers offentlige adgang og stoppe delingen af dets snapshots: fra datalagerets problem med **Ret det herfra** (se [Datasikkerhedskontroller og problemer](/docs/data-security/checks-and-issues#ret-det-herfra)) og fra playbooks i Security Operations. Den står på **Fra**, indtil du vælger **Bloker offentlig adgang og deling**, og den kommando, formularen så viser, giver én snæver skriveadgang for sig:

| Cloud | Hvad kommandoen tilføjer | Hvad den må gøre |
| --- | --- | --- |
| AWS | En tredje inline-politik, `OneUptimeDataSecurityResponse` | `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshotAttributes`, `rds:ModifyDBSnapshotAttribute` og `rds:ModifyDBClusterSnapshotAttribute`: en buckets Block Public Access, og hvem et manuelt snapshot er delt med |
| Azure | En brugerdefineret rolle, `OneUptime Data Security Response`, på forbindelsens scope | `Microsoft.Storage/storageAccounts/read` og `Microsoft.Storage/storageAccounts/write`: en lagerkontos indstillinger, f.eks. anonym blobadgang, aldrig dens nøgler |
| Google Cloud | En brugerdefineret rolle, `oneuptimeDataSecurityResponse` | `storage.buckets.get` og `storage.buckets.update`: en buckets indstillinger, f.eks. forebyggelse af offentlig adgang |

Intet af det, den giver, læser data, sletter noget eller ændrer, hvem der må logge ind. Sæt den tilbage til **Fra**, så holder Datasikkerhed straks op med at bruge den. For også at fjerne adgangen i AWS sletter du politikken med `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurityResponse`.

## Hvorfor indholdsprøver er valgfrie

Konfigurationsniveauet finder det, der er eksponeret: en offentlig bucket, en database, der er åben mod internettet, manglende kryptering, backup eller adgangslogs. Det kan ikke se, hvad et datalager indeholder, så et datalager, hvor der intet er fundet, tæller som Offentlig, den laveste følsomhed, og dets problemer er lige så alvorlige, som de ville være for offentlige data. En offentlig bucket med billeder til et website er ingen nødsituation; en offentlig bucket med kortnumre er.

Indholdsprøver skelner mellem de to. De sætter hvert datalagers følsomhed ud fra det, det indeholder, så det samme problem er Kritisk for kortnumre og Lav for billeder. De finder også det, som kun indholdet viser: hemmeligheder, sikkerhedskoder til kort, adgangskoder gemt, som de blev indtastet, og kopier af produktionsdata i et testdatalager.

Derfor går de fleste teams frem i denne rækkefølge: konfigurationsniveauet overalt og derefter indholdsprøver, hvor du har brug for at vide, hvad et datalager indeholder. Indholdsscanning kan også slås fra for ét datalager med **Scan indhold** i datalagerets **Indstillinger** eller for hele projektet.

## Hvad en indholdsscanning læser

En scanning læser lidt af et datalager inden for projektets grænser og stopper efter 8 minutter, uanset hvad der er tilbage. Den næste fortsætter derfra: den springer et objekt over, der ikke er ændret, siden det blev læst, medmindre det var for 7 dage siden eller mere.

- **Buckets og containere** prøvetages efter slags, ikke efter antal. Objektnavnene oplistes først, højst ti gange så mange, som scanningen må læse, og aldrig flere end 200.000. Hvert navn bliver til sit mønster, hvor datoer, UUID'er, lange hex-sekvenser og tal gøres til `*`, så `exports/2026-10-27/users-0001.csv` bliver til `exports/*/users-*.csv`. De nyeste objekter for hvert mønster læses, ét af hvert mønster, før der læses et andet af noget mønster, og højst 5 af ét mønster. Hvert objekt læses fra begyndelsen: højst **Byte pr. objekt** af det og **Byte pr. scanning** i alt. En scanning tager prøver af højst 10 containere i en Azure-lagerkonto.
- **Filer læses som det, de er.** CSV og TSV efter kolonne, JSON og JSON Lines efter sti, `.env`, `.ini`, `.properties`, TOML og YAML efter nøgle, XML og HTML som deres tekst, Word-, Excel- og PowerPoint-filer efter deres tekst og celler og alt andet som fritekst. En gzip-fil pakkes først ud. Billeder, Parquet, Avro, PDF og andre binære formater læses ikke, og scanningen siger det.
- **Datasæt og databaser** læses tabel for tabel: højst **Tabeller pr. scanning** tabeller og **Rækker pr. tabel** rækker fra hver.

Hver scanning gemmer en oversigt over det, den læste, efter navn: objekterne, tabellerne eller tjenesterne, aldrig deres indhold. Det, den ikke kunne læse - en forespørgsel, som cloud-tjenesten afviste, tidsfristen, bytebudgettet - er en advarsel på scanningen, og scanningen markeres som **Delvist gennemført**.

## Scan en database, du selv driver

Datasikkerhed tager prøver af PostgreSQL- og MySQL-databaser på en af to måder. En database, som produktet Database overvåger, eller en, som dine tjenester taler med på tjenestekortet, er allerede et datalager. En database, som ingen scanning finder, tilføjer du selv som et datalager.

- **Fra OneUptimes workers.** Sæt **Forbindelsesstreng** i datalagerets **Indstillinger** til en, der kun kan læse, f.eks. `postgresql://reader:password@db.internal:5432/app`. Den krypteres i hvile og returneres aldrig af API'et. Giv den en databasebruger, der kan læse og intet andet.
- **Fra en sonde i dit netværk.** Vælg sonden under **Scan fra sonde**, og angiv i **Forbindelsesvariabel for sonde** navnet på den miljøvariabel på sonden, der indeholder forbindelsesstrengen. Sonden læser databasen inde fra dit netværk og sender kun det tilbage, den fandt: forbindelsesstrengen når aldrig OneUptime. Se [Brugerdefinerede sonder](/docs/probe/custom-probe) for at køre en sonde.

## Hvad OneUptime gemmer

For hver datatype, der er fundet på hver placering - en kolonne, et felt, et objektmønster, en telemetriattribut - gemmer et fund:

- hvor mange af de prøvetagne værdier der indeholdt den, ud af hvor mange, og hvor mange af dem der var velkendte testværdier;
- hvor mange forskellige værdier der matchede, anslået ud fra hashes, der bliver i scannerens hukommelse og kasseres sammen med scanningen;
- konfidensniveauet, og om placeringens navn pegede på datatypen;
- højst tre maskerede prøver, maskeret inde i scanneren, før noget forlader den.

Det gemmer aldrig en rå værdi. Hver slags værdi maskeres, så et menneske kan genkende den, men aldrig bruge den:

| Værdi | Maskeret prøve |
| --- | --- |
| En e-mailadresse | `j***@e******.com`: det første bogstav i navnet og i domænet samt topdomænet |
| Et kortnummer | `**** **** **** 4242`: de sidste fire cifre, sådan som PCI DSS tillader, at et kort vises |
| En hemmelighed | De første fire og sidste fire tegn, når den er lang, de første to, når den er kort, og kun headeren for en privat nøgle |
| En URL eller forbindelsesstreng | Det hele undtagen adgangskoden |
| En IP-adresse | Den første del, netværket, med resten skjult |
| En værdi fundet ud fra navnet | Det første tegn, derefter `****` |
| En dokumentmærkning | Mærkningen, som den er skrevet, f.eks. "Confidential": den siger, hvad dokumentet er |
| Alt andet | De sidste to til fire tegn, med separatorer bevaret, f.eks. `***-**-6789` |

Slå **Gem maskerede prøver** fra i projektets indstillinger for kun at gemme antal: fra den næste scanning af hvert datalager gemmer de fund, den skriver, ingen prøver.

Kopier af data mellem datalagre findes ud fra fingeraftryk, ikke værdier: 128 tal på 16 bit for hver datatype, hashet med en nøgle, der tilhører projektet (se [Sådan forbliver fingeraftryk private](/docs/data-security/flows-access-residency#sådan-forbliver-fingeraftryk-private)).

Et fund tæller med for sit datalager i 30 dage efter, at en scanning sidst så det, da en prøve kan overse noget, der stadig er der. Et fund, der ikke er set i 90 dage, slettes. Et datalager gemmer højst 2.000 fund.

## Indstillinger

Datasikkerheds indstillinger er ét sæt pr. projekt i sektionen **Indstillinger** i Datasikkerheds menu. De starter med disse standardværdier:

| Indstilling | Standard | Hvad den gør |
| --- | --- | --- |
| **Kontrollér konfiguration** | Til | Kører kontrollerne på hvert datalager. Slået fra åbnes, ændres eller lukkes intet problem. |
| **Scan indhold** | Til | Tager prøver af datalagres indhold, hvor indholdstilladelsen er givet. |
| **Scan telemetri** | Til | Tager prøver af projektets logs, traces, undtagelser, afspilninger og AI-samtaler. |
| **Gem maskerede prøver** | Til | Gemmer op til tre maskerede prøver med hvert fund. Slået fra gemmes kun antal. |
| **Åbn sikkerhedssager** | Til | Åbner en sikkerhedssag, grupperet efter datalager, når et kritisk problem åbnes. |
| **Udløs advarsler** | Fra | Udløser en advarsel, som tilkalder den, der har vagt, når et kritisk problem åbnes. |
| **Advarselsalvor** | Tom | Alvorligheden af disse advarsler. Tom betyder projektets mest alvorlige. |
| **Erklær hændelser** | Fra | Erklærer en hændelse, som din hændelsesproces håndterer, når et kritisk problem åbnes. |
| **Hændelsesalvor** | Tom | Alvorligheden af disse hændelser. Tom betyder projektets mest alvorlige. |
| **Underret ejere** | Til | Sender e-mail til et datalagers ejere, når et problem åbnes på det. |
| **Objekter pr. scanning** | 2.000 | Det højeste antal objekter, én scanning af en bucket læser, fra 10 til 50.000. |
| **Byte pr. objekt** | 65.536 (64 KB) | Det højeste antal byte, der læses fra ét objekt, fra 1.024 til 4.194.304. |
| **Byte pr. scanning** | 52.428.800 (50 MB) | Det højeste antal byte, én indholdsscanning læser i alt, fra 65.536 til 1.073.741.824. |
| **Rækker pr. tabel** | 1.000 | Det højeste antal rækker, der læses fra én tabel, fra 10 til 100.000. |
| **Tabeller pr. scanning** | 200 | Det højeste antal tabeller, én scanning læser, fra 1 til 5.000. |
| **Prøvestørrelse for telemetri** | 500 | Hvor mange nylige poster for hver tjeneste og hvert signal en telemetriscanning læser, fra 10 til 10.000. |
| **Scan hver (timer)** | 24 | Hvor ofte der igen tages prøver af et datalagers indhold, fra 1 til 720. |
| **Aldrig følsom** | Tom | Værdier, der aldrig er fund, f.eks. din egen supportadresse. |
| **Datatyper slået fra** | Tom | Indbyggede datatyper, som projektets scanninger ikke leder efter: kontakterne under **Indbyggede datatyper**. |

## Fejlfinding

:::details Et datalager siger, at dets indhold ikke blev scannet
Scanningen siger hvorfor: "Indholdsscanning kræver forbindelsens indholdstilladelse eller en forbindelsesstreng til en database." Sæt datalagerets forbindelse til **Konfiguration og indholdsprøver**, og kør dens kommando igen, eller giv databasen en forbindelsesstreng. Tjek også, at **Scan indhold** er slået til for datalageret og i projektets indstillinger.
:::

:::details En kontrol siger, at den ikke kan afgøre det
En oplysning, som læseren ikke kunne læse - en tilladelse, rollen ikke har, et API, der ikke er slået til - er ukendt og gættes aldrig. Dens kontrol rapporterer, at den ikke kan afgøre det, og et problem, den har åbnet, forbliver åbent: ingen må konkludere, at et problem er løst, fordi OneUptime ikke kunne se efter. Konfigurationslæsningens advarsler siger, hvad den ikke kunne læse. Kør forbindelsens kommando igen for at give det, der mangler.
:::

:::details Der vises ingen S3-buckets eller BigQuery-datasæt
De kommer fra konfigurationslæsningen, ikke fra cloud-inventaret. Sæt forbindelsen til **Kun konfiguration** eller højere, og kør dens kommando igen.
:::

:::details En scanning er markeret som Delvist gennemført
Den nåede en grænse, før den havde læst alt: de 8 minutter, **Byte pr. scanning** eller **Objekter pr. scanning** eller en forespørgsel, som cloud-tjenesten afviste. Dens advarsler siger hvilken. Den næste scanning fortsætter og springer det over, der ikke er ændret, eller du kan hæve grænsen.
:::

## Næste trin

:::cards
- [Følsomme datatyper](/docs/data-security/data-types): Det, scanneren leder efter i det, den læser.
- [Datasikkerhedskontroller og problemer](/docs/data-security/checks-and-issues): Det, konfigurationslæsningen kontrolleres for.
- [Følsomme data i telemetri](/docs/data-security/telemetry): Dine logs, traces og AI-samtaler, som ikke kræver nogen opsætning.
- [Forbind en cloud-konto](/docs/telemetry/cloud-accounts): Forbind AWS, Azure eller Google Cloud i første omgang.
:::

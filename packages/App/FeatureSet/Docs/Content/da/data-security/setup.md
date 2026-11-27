# Konfigurer Datasikkerhed

Datasikkerhed læser kun det, du tillader. Hver cloudforbindelse læses på et af tre niveauer, en database eller en søgeklynge, du selv driver, læses med en forbindelsesstreng, du giver den, og telemetri kræver intet. Denne side fortæller, hvad hvert valg lader OneUptime læse, præcis hvilke tilladelser det giver, og hvad OneUptime gemmer af det, den læser.

:::cards
- [Vælg et niveau](#vælg-et-niveau-for-hver-forbindelse): Fra, Kun konfiguration eller Konfiguration og indholdsprøver.
- [Hvad hvert niveau giver adgang til](#hvad-hvert-niveau-giver-adgang-til): AWS-handlingerne og rollerne i Azure og Google Cloud.
- [Scan et datalager, du selv driver](#scan-et-datalager-du-selv-driver): En skrivebeskyttet forbindelsesstreng eller en sonde i dit netværk.
- [Hvad OneUptime kontrollerer på et datalager, du selv driver](#hvad-oneuptime-kontrollerer-på-et-datalager-du-selv-driver): Om det svarer uden loginoplysninger, spurgt fra der, hvor dets scanning kører.
- [Hvad OneUptime gemmer](#hvad-oneuptime-gemmer): Antal, placeringer og maskerede prøver, aldrig en værdi.
- [Lad Datasikkerhed lukke en eksponering](#lad-datasikkerhed-lukke-en-eksponering): De eneste skriveadgange, en forbindelse kan få, slået fra, indtil du slår dem til.
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
| Læse, hvilke brugere og roller der når hver bucket og hver tabel gennem deres egne IAM-politikker, hvem der må påtage sig hver rolle, og hvornår hver blev brugt sidst | `iam:GetAccountAuthorizationDetails`, `iam:GenerateCredentialReport`, `iam:GetCredentialReport` |

IAM-handlingerne lader **Adgang** navngive hver rolle og hver bruger, der når et datalager gennem sine egne politikker, og hvornår hver blev brugt sidst. Den legitimationsrapport, IAM laver til dem, indeholder datoer og flag, aldrig en adgangskode eller en nøgle. En forbindelse, der blev sat op, før Datasikkerhed læste IAM, læser kun hvert datalagers egne politikker, indtil dens kommando køres igen.

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
        "kms:ListAliases",
        "iam:GetAccountAuthorizationDetails",
        "iam:GenerateCredentialReport",
        "iam:GetCredentialReport"
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

Læsning er alt, hvad en forbindelse gør, indtil du vælger andet. **Datasikkerhedsrespons**, under **Flere felter** ved siden af **Datasikkerhed**, lader også Datasikkerhed ændre et datalagers indstillinger gennem forbindelsen: blokere dets offentlige adgang og stoppe delingen af dets snapshots, fra datalagerets problem med **Ret det herfra** (se [Datasikkerhedskontroller og problemer](/docs/data-security/checks-and-issues#ret-det-herfra)) og fra playbooks i Security Operations, og slå en indstilling til, der beskytter det, f.eks. versionsstyring eller sikker overførsel, fra dets problem. Den står på **Fra**, indtil du vælger **Luk eksponeringer og ret indstillinger**, og den kommando, formularen så viser, giver disse snævre skriveadgange for sig:

| Cloud | Hvad kommandoen tilføjer | Hvad den må gøre |
| --- | --- | --- |
| AWS | En tredje inline-politik, `OneUptimeDataSecurityResponse` | `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `s3:GetBucketVersioning`, `s3:PutBucketVersioning`, `s3:GetBucketOwnershipControls`, `s3:PutBucketOwnershipControls`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshotAttributes`, `rds:ModifyDBSnapshotAttribute`, `rds:ModifyDBClusterSnapshotAttribute`, `dynamodb:DescribeContinuousBackups` og `dynamodb:UpdateContinuousBackups`: en buckets Block Public Access, versionsstyring og objektejerskab, hvem et manuelt snapshot er delt med, og en tabels gendannelse til et tidspunkt |
| Azure | En brugerdefineret rolle, `OneUptime Data Security Response`, på forbindelsens scope | `Microsoft.Storage/storageAccounts/read`, `Microsoft.Storage/storageAccounts/write`, `Microsoft.Storage/storageAccounts/blobServices/read` og `Microsoft.Storage/storageAccounts/blobServices/write`: en lagerkontos indstillinger, f.eks. anonym blobadgang og sikker overførsel, og dens blobs' bløde sletning, aldrig dens nøgler |
| Google Cloud | En brugerdefineret rolle, `oneuptimeDataSecurityResponse` | `storage.buckets.get` og `storage.buckets.update`: en buckets indstillinger, f.eks. forebyggelse af offentlig adgang, ensartet adgang og versionsstyring |

Intet af det, den giver, læser data, sletter noget eller ændrer, hvem der må logge ind. Sæt den tilbage til **Fra**, så holder Datasikkerhed straks op med at bruge den. For også at fjerne adgangen i AWS sletter du politikken med `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurityResponse`.

En forbindelse, der slog den til tidligere, skal køre sin kommando igen for disse indstillinger: indtil da afviser cloud'en ændringen, og panelet siger, hvilken tilladelse der mangler.

## Hvorfor indholdsprøver er valgfrie

Konfigurationsniveauet finder det, der er eksponeret: en offentlig bucket, en database, der er åben mod internettet, manglende kryptering, backup eller adgangslogs. Det kan ikke se, hvad et datalager indeholder, så et datalager, hvor der intet er fundet, tæller som Offentlig, den laveste følsomhed, og dets problemer er lige så alvorlige, som de ville være for offentlige data. En offentlig bucket med billeder til et website er ingen nødsituation; en offentlig bucket med kortnumre er.

Indholdsprøver skelner mellem de to. De sætter hvert datalagers følsomhed ud fra det, det indeholder, så det samme problem er Kritisk for kortnumre og Lav for billeder. De finder også det, som kun indholdet viser: hemmeligheder, sikkerhedskoder til kort, adgangskoder gemt, som de blev indtastet, og kopier af produktionsdata i et testdatalager.

Derfor går de fleste teams frem i denne rækkefølge: konfigurationsniveauet overalt og derefter indholdsprøver, hvor du har brug for at vide, hvad et datalager indeholder. Indholdsscanning kan også slås fra for ét datalager med **Scan indhold** i datalagerets **Indstillinger** eller for hele projektet.

## Hvad en indholdsscanning læser

En scanning læser lidt af et datalager inden for projektets grænser og stopper efter 8 minutter, uanset hvad der er tilbage. Den næste fortsætter derfra: den springer et objekt over, der ikke er ændret, siden det blev læst, medmindre det var for 7 dage siden eller mere.

- **Buckets og containere** prøvetages efter slags, ikke efter antal. Objektnavnene oplistes først, højst ti gange så mange, som scanningen må læse, og aldrig flere end 200.000. Hvert navn bliver til sit mønster, hvor datoer, UUID'er, lange hex-sekvenser og tal gøres til `*`, så `exports/2026-10-27/users-0001.csv` bliver til `exports/*/users-*.csv`. De nyeste objekter for hvert mønster læses, ét af hvert mønster, før der læses et andet af noget mønster, og højst 5 af ét mønster. Hvert objekt læses fra begyndelsen: højst **Byte pr. objekt** af det og **Byte pr. scanning** i alt. En scanning tager prøver af højst 10 containere i en Azure-lagerkonto.
- **Filer læses som det, de er.** CSV og TSV efter kolonne, JSON og JSON Lines efter sti, `.env`, `.ini`, `.properties`, TOML og YAML efter nøgle, XML og HTML som deres tekst, Word-, Excel- og PowerPoint-filer efter deres tekst og celler og alt andet som fritekst. En gzip-fil pakkes først ud. Billeder, Parquet, Avro, PDF og andre binære formater læses ikke, og scanningen siger det.
- **Datasæt og databaser** læses tabel for tabel: højst **Tabeller pr. scanning** tabeller og **Rækker pr. tabel** rækker fra hver.
- **Søgeklynger** læses indeks for indeks, som en database læses tabel for tabel: højst **Tabeller pr. scanning** indekser og **Rækker pr. tabel** dokumenter fra hvert, de nyeste først, hvor indekset har et `@timestamp`. En datastrøm læses som ét indeks, og indekser, hvis navne kun er forskellige i datoer eller tal, f.eks. `logs-2026.11.26` og `logs-2026.11.27`, som ét, ved det nyeste, der indeholder dokumenter. Klyngens egne indekser, hvis navne begynder med et punktum, læses ikke. Hver forespørgsel er en GET, så scanningen kan ikke skrive til klyngen, uanset hvad dens bruger må.

Hver scanning gemmer en oversigt over det, den læste, efter navn: objekterne, tabellerne eller tjenesterne, aldrig deres indhold. Det, den ikke kunne læse - en forespørgsel, som cloud-tjenesten afviste, tidsfristen, bytebudgettet - er en advarsel på scanningen, og scanningen markeres som **Delvist gennemført**.

Et datalagers **Oversigt** siger, hvornår dets indhold scannes næste gang. **Næste indholdsscanning** er tidspunktet, hvor noget scanner det, **Står for tur nu**, mens det venter på sin tur, og **Forsinket**, når det har stået for tur i en time. Ellers siger den, hvorfor intet vil scanne det: **Fra**, mens **Scan indhold** er slået fra for datalageret eller projektet, eller mens datalageret ikke længere findes; **Scannes ikke**, når OneUptime ikke kan tage prøver af denne slags datalager, eller dets sonde ikke kan scanne det; og **Venter**, mens dets sonde er afbrudt. En tjenestes telemetri scannes **Hver time** med projektets telemetriscanning. **Scan nu** er slået fra, med årsagen, for et datalager, som intet ville scanne. En scanning, der er i gang, når indholdsscanning slås fra, eller når projektet suspenderes, gemmer intet af det, den fandt.

## Scan et datalager, du selv driver

Datasikkerhed tager prøver af PostgreSQL-, MySQL- og SQL Server-databaser samt af Elasticsearch- og OpenSearch-klynger på en af to måder. En database, som produktet Database overvåger, eller en, som dine tjenester taler med på tjenestekortet, er allerede et datalager. Tilføj ethvert andet selv med **Tilføj et datalager, du selv driver** under **Datalagre**: Så snart du vælger dets **Type**, fortæller formularen, hvad OneUptime vil kontrollere på det, og hvad det ikke kan, og spørger kun om det, den type læser. En type, OneUptime ikke tager prøver af, f.eks. MongoDB eller Redis, tager ingen forbindelsesstreng: Den vises med sine ejere, etiketter og følsomhed, og dens eksponering viser **Kan ikke kontrolleres**.

- **Fra OneUptimes workers.** Sæt **Forbindelsesstreng** i datalagerets **Indstillinger** til en, der kun kan læse, f.eks. `postgresql://reader:password@db.internal:5432/app` eller `https://reader:password@search.internal:9200` for en søgeklynge. Den krypteres i hvile og returneres aldrig af API'et. Giv den en bruger, der kan læse og intet andet. I OneUptime Cloud når workerne kun adresser på internettet.
- **Fra en sonde i dit netværk.** Vælg sonden under **Scan fra sonde**, og angiv i **Forbindelsesvariabel for sonde** navnet på den miljøvariabel på sonden, der indeholder forbindelsesstrengen. Sonden læser datalageret inde fra dit netværk og sender kun det tilbage, den fandt: forbindelsesstrengen når aldrig OneUptime. Se [Brugerdefinerede sonder](/docs/probe/custom-probe) for at køre en sonde. En sonde fra en tidligere udgivelse får kun databaser: Opdater den, så den kan scanne en søgeklynge.

### En søgeklynges forbindelsesstreng

Elasticsearch og OpenSearch har ingen forbindelsesstreng af deres egen, så OneUptime tager klyngens adresse, som curl når den, med en skrivebeskyttet bruger i eller en Elasticsearch-API-nøgle efter, skrevet som `id:key` eller som den kodede værdi, Elasticsearch udleverer:

```text
https://reader:password@search.internal:9200
https://search.internal:9200?api_key=<id>:<key>
https://reader:password@search.internal:9200?verify_certificate=false
```

`verify_certificate=false` accepterer et certifikat, som ingen udsteder har signeret, f.eks. det, Elasticsearch laver, første gang den starter: Brug det kun på et netværk, du stoler på. Intet andet må følge efter adressen. For en klynge, hvis certifikat din egen udsteder har signeret, angives adressen som JSON med den udsteders certifikat:

```json
{
  "url": "https://search.internal:9200",
  "username": "reader",
  "password": "password",
  "caCertificate": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
}
```

`apiKey` træder i stedet for `username` og `password`, og `"verifyCertificate": false` i stedet for certifikatet.

Giv brugeren en rolle, der kan læse og intet andet. På Elasticsearch:

```bash
curl -u elastic -X PUT "https://search.internal:9200/_security/role/oneuptime_reader" \
  -H "Content-Type: application/json" \
  -d '{"cluster":["monitor"],"indices":[{"names":["*"],"privileges":["read","view_index_metadata","monitor"]}]}'
```

På OpenSearch, med dets sikkerhedsplugin:

```bash
curl -u admin -X PUT "https://search.internal:9200/_plugins/_security/api/roles/oneuptime_reader" \
  -H "Content-Type: application/json" \
  -d '{"cluster_permissions":["cluster_monitor"],"index_permissions":[{"index_patterns":["*"],"allowed_actions":["read","indices_monitor","indices:admin/mappings/get","indices:admin/data_stream/get"]}]}'
```

Giv derefter en bruger den rolle, og kun den rolle. Begræns `*` til de indekser, der skal scannes.

### Hvad OneUptime kontrollerer på et datalager, du selv driver

Et datalager i en cloud-konto kontrolleres ud fra de indstillinger, dets cloud gemmer. Et datalager, du selv driver, har ingen, som OneUptime kan læse, så en Elasticsearch- eller OpenSearch-klynge kontrolleres ud fra det, den svarer på sin egen adresse. Ved hver indholdsscanning bliver den spurgt uden loginoplysninger fra der, hvor scanningen kører:

| Spurgt | Hvad det viser |
| --- | --- |
| Hvem der spørger: `/_security/_authenticate` på Elasticsearch, `/_plugins/_security/authinfo` på OpenSearch | Om den overhovedet kræver loginoplysninger |
| En søgning, der ikke returnerer dokumenter, kun om der er nogen | Om alle, der når den, kan læse dens dokumenter |
| Dens adresse over almindelig HTTP, når dens forbindelsesstreng er HTTPS | Om den tager imod forbindelser uden TLS |

Der skrives intet til den, så en klynge med brugere og roller kan ikke spørges, om dens anonyme bruger må skrive: Den linje i dens **Konfiguration** viser **Kan ikke kontrolleres**. En klynge helt uden adgangskontrol tager imod enhver forespørgsel, også skrivninger. En klynge, der svarer alle, fejler [Alle, der kan nå det, kan læse det uden loginoplysninger](/docs/data-security/checks-and-issues#eksponering).

Hvor scanningen kører, afgør, hvad der ellers kan vides. Workerne i OneUptime Cloud når kun adresser på internettet, så en klynge, de scanner, kan nås fra internettet, og dens eksponering siger det. Fra en sonde, eller fra en OneUptime, du selv hoster, kører scanningen inde i et netværk, og om internettet når klyngen, kan ikke afgøres derfra: Dens eksponering viser **Ukendt**, og dens **Oversigt** siger hvorfor. Dens kryptering i hvile, backups og adgangslogning hører til dens servere, er ikke synlige fra dens adresse og kontrolleres ikke.

Der tages prøver af en database, du selv driver, den bliver ikke spurgt, og hvordan den kan nås, kontrolleres ikke: Dens eksponering viser **Kan ikke kontrolleres**, ligesom for en type, OneUptime ikke tager prøver af. Indtil et datalager kontrolleres første gang, viser dets eksponering **Ikke kontrolleret endnu**, så et datalager, der venter på sin første kontrol, aldrig forveksles med et, der ikke kan kontrolleres.

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
| **Scan telemetri** | Til | Tager prøver af projektets logs, traces, metrikker, undtagelser, afspilninger og AI-samtaler. |
| **Find navne og gadeadresser** | Til | Gennemsøger fritekst efter personers navne og gadeadresser med en lille model inde i scanneren. Modellen er ikke OneUptime AI, og teksten forlader aldrig scanneren. Se [Navne og gadeadresser i fritekst](/docs/data-security/data-types#navne-og-gadeadresser-i-fritekst). |
| **Find navne og gadeadresser i telemetri** | Fra | Den timevise telemetriscanning læser også logbrødtekster, undtagelsesbeskeder og AI-samtaler med modellen, op til ét minut hver time. Kun mens indstillingen ovenfor er slået til. |
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
Scanningen siger hvorfor: "Indholdsscanning kræver forbindelsens indholdstilladelse eller en forbindelsesstreng til et datalager, du selv driver." Sæt datalagerets forbindelse til **Konfiguration og indholdsprøver**, og kør dens kommando igen, eller giv datalageret, du selv driver, en forbindelsesstreng. Tjek også, at **Scan indhold** er slået til for datalageret og i projektets indstillinger.
:::

:::details En kontrol siger, at den ikke kan afgøre det
En oplysning, som læseren ikke kunne læse - en tilladelse, rollen ikke har, et API, der ikke er slået til - er ukendt og gættes aldrig. Dens kontrol rapporterer, at den ikke kan afgøre det, og et problem, den har åbnet, forbliver åbent: ingen må konkludere, at et problem er løst, fordi OneUptime ikke kunne se efter. Konfigurationslæsningens advarsler siger, hvad den ikke kunne læse. Kør forbindelsens kommando igen for at give det, der mangler.
:::

:::details Et datalagers eksponering viser Kan ikke kontrolleres
OneUptime har ingen måde at læse, hvordan et datalager af dets type kan nås: en database, du selv driver, eller en type, det ikke tager prøver af. Det er ikke en fejl, og der åbnes intet problem for det. Dets **Indstillinger** viser under **Hvad OneUptime kontrollerer**, hvad der kontrolleres på det. Et datalager, hvis eksponering viser **Ikke kontrolleret endnu**, er et, OneUptime kan kontrollere og endnu ikke har kontrolleret: en søgeklynge før dens første indholdsscanning eller et datalager i en cloud-konto før den første læsning af dets forbindelses konfiguration.
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

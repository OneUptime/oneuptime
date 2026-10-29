# Sett opp Datasikkerhet

Datasikkerhet leser bare det du tillater. Hver skytilkobling leses på ett av tre nivåer, en database du drifter selv leses med en tilkoblingsstreng du gir den, og telemetri trenger ingenting. Denne siden forteller hva hvert valg lar OneUptime lese, nøyaktig hvilke tillatelser det gir, og hva OneUptime tar vare på av det den leser.

:::cards
- [Velg et nivå](#velg-et-nivå-for-hver-tilkobling): Av, Bare konfigurasjon, eller Konfigurasjon og innholdsprøver.
- [Hva hvert nivå gir tilgang til](#hva-hvert-nivå-gir-tilgang-til): AWS-handlingene, og rollene i Azure og Google Cloud.
- [Skann en database du drifter selv](#skann-en-database-du-drifter-selv): En skrivebeskyttet tilkoblingsstreng, eller en sonde i nettverket ditt.
- [Hva OneUptime tar vare på](#hva-oneuptime-tar-vare-på): Tellinger, plasseringer og maskerte prøver, aldri en verdi.
- [La Datasikkerhet lukke en eksponering](#la-datasikkerhet-lukke-en-eksponering): Den ene skrivetilgangen en tilkobling kan få, av til du slår den på.
:::

## Velg et nivå for hver tilkobling

| Nivå | I skjemaet | Hva OneUptime leser |
| --- | --- | --- |
| Av | **Av** | Verken konfigurasjon eller innhold i noe datalager. Datasikkerhet viser likevel datalagrene skyinventaret ditt kjenner til, med det inventaret sier om dem: om en RDS-database er kryptert, offentlig, beskyttet mot sletting og sikkerhetskopiert, og om en DynamoDB-tabell kan gjenopprettes til et tidspunkt. |
| Konfigurasjon | **Bare konfigurasjon** | Hvordan hvert datalager er satt opp: hvem som kan nå det, og hvordan det er kryptert, sikkerhetskopiert, versjonert, logget, replikert og tagget. Aldri data, og aldri en hemmelighet. |
| Innhold | **Konfigurasjon og innholdsprøver** | Det samme, og prøver av det S3-bucketer, Azure-lagringskontoer, Cloud Storage-bucketer og BigQuery-datasett inneholder. |

Hver tilkobling starter på **Av**. [Koble til en skykonto](/docs/telemetry/cloud-accounts#datasikkerhet) viser kommandoen hvert nivå kjører i hver sky, ord for ord. Slik endrer du nivået til en tilkobling:

:::steps
### Åpne tilkoblingen

Gå til **Sky → Koble til**. Velg **Rediger** på tilkoblingen, eller koble til en ny konto.

### Velg nivået

Under **Flere felt** setter du **Datasikkerhet** til nivået du vil ha.

### Kjør kommandoen på nytt

Kommandoen skjemaet viser, endres med nivået. Kjør den i skyens shell, slik du gjorde da du koblet til: den gir tilgangen det nye nivået trenger, og ikke noe mer. Velg deretter **Lagre endringer**, eller **Koble til** for en ny tilkobling.
:::

Lesinger på det nye nivået starter innen en time, og **Kontroller nå** eller **Skann nå** på et datalager starter én med en gang. OneUptime leser bare det tilkoblingens nivå sier, uansett hva rollen fortsatt tillater: senker du nivået, stopper lesingene med en gang. For også å fjerne tilgangen kjører du den nye kommandoen: i AWS erstatter den policyen med den lavere. **Av** legger ikke til noe, så den lar det en tidligere kommando ga, stå. Det fjerner du selv: i AWS med `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity`, og i Azure og Google Cloud ved å fjerne rollene innholdsnivået la til.

## Hva hvert nivå gir tilgang til

### Amazon Web Services

Konfigurasjonsnivået legger en andre inline-policy, `OneUptimeDataSecurity`, på rollen, ved siden av den skrivebeskyttede. Den inneholder nøyaktig de lesehandlingene datasikkerhetsleseren kaller. Hver av dem leser en innstilling; ingen leser data eller skriver noe:

| Hva OneUptime bruker dem til | Handlinger |
| --- | --- |
| Liste bucketene, og lese hvem som kan nå hver av dem og hvordan den er kryptert, versjonert, logget, kopiert og tagget | `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketPolicyStatus`, `s3:GetBucketPublicAccessBlock`, `s3:GetAccountPublicAccessBlock`, `s3:GetBucketAcl`, `s3:GetBucketPolicy`, `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning`, `s3:GetBucketLogging`, `s3:GetBucketOwnershipControls`, `s3:GetReplicationConfiguration`, `s3:GetBucketTagging` |
| Lese hvordan databasene nås, krypteres og sikkerhetskopieres, og hvem de manuelle øyeblikksbildene deres er delt med | `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeDBSnapshots`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshots`, `rds:DescribeDBClusterSnapshotAttributes`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `redshift:DescribeClusters`, `redshift:DescribeLoggingStatus` |
| Lese hvordan søkedomenene, cachene og filsystemene er satt opp | `es:ListDomainNames`, `es:DescribeDomains`, `elasticache:DescribeReplicationGroups`, `elasticfilesystem:DescribeFileSystems` |
| Skille AWS' egne nøkler (alias/aws/...) fra nøklene du administrerer | `kms:ListAliases` |

Innholdsnivået legger tre handlinger til i den samme policyen, hver på sine egne ressurser:

| Handling | Tillatt på | Hva den er til |
| --- | --- | --- |
| `s3:ListBucket` | `arn:aws:s3:::*` | Liste objektnavnene i en bucket |
| `s3:GetObject` | `arn:aws:s3:::*/*` | Lese de første bytene av et objekt som prøvetas |
| `kms:Decrypt` | `*`, bare når `kms:ViaService` er `s3.*.amazonaws.com` | Lese et objekt kryptert med en KMS-nøkkel, bare gjennom S3: aldri en direkte dekryptering av noe annet nøkkelen beskytter |

Med en **Tilgangsnøkkel** i stedet for en rolle legges policyen på en gruppe, `OneUptimeDataSecurity`, som nøkkelens bruker legges til i: IAM begrenser en brukers egne inline-policyer til 2 048 tegn til sammen, og den skrivebeskyttede policyen tar de fleste av dem. En tilkobling som leser en hel AWS Organization, legger den samme policyen i rollen i hver konto.

:::details Hele policyen på innholdsnivå
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

Konfigurasjonsnivået legger ikke til noe: tilkoblingens rolle **Monitoring Reader** leser allerede konfigurasjonen til hver ressurs gjennom Azure Resource Manager. Innholdsnivået legger til den innebygde rollen **Storage Blob Data Reader**, på det samme omfanget som tilkoblingen: abonnementet, eller rotadministrasjonsgruppen til leietakeren.

### Google Cloud

Konfigurasjonsnivået legger ikke til noe: tilkoblingens rolle **Cloud Asset Viewer** leser allerede konfigurasjonen og IAM-policyen til hver ressurs. Innholdsnivået legger til to roller, `roles/storage.objectViewer` og `roles/bigquery.dataViewer`, på prosjektet eller organisasjonen, og slår på BigQuery API, `bigquery.googleapis.com`.

## La Datasikkerhet lukke en eksponering

Lesing er alt en tilkobling gjør til du velger noe annet. **Datasikkerhetsrespons**, under **Flere felt** ved siden av **Datasikkerhet**, lar også Datasikkerhet blokkere offentlig tilgang til et datalager og stoppe deling av øyeblikksbildene: fra problemet på datalageret, med **Fiks det herfra** (se [Kontroller og problemer i Datasikkerhet](/docs/data-security/checks-and-issues#fiks-det-herfra)), og fra playbooks i Security Operations. Den står på **Av** til du velger **Blokker offentlig tilgang og deling**, og kommandoen skjemaet da viser, gir én smal skrivetilgang, for seg selv:

| Sky | Hva kommandoen legger til | Hva den kan gjøre |
| --- | --- | --- |
| AWS | En tredje inline-policy, `OneUptimeDataSecurityResponse` | `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshotAttributes`, `rds:ModifyDBSnapshotAttribute` og `rds:ModifyDBClusterSnapshotAttribute`: Block Public Access for en bucket, og hvem et manuelt øyeblikksbilde er delt med |
| Azure | En egendefinert rolle, `OneUptime Data Security Response`, på tilkoblingens omfang | `Microsoft.Storage/storageAccounts/read` og `Microsoft.Storage/storageAccounts/write`: innstillingene til en lagringskonto, som anonym blob-tilgang, aldri nøklene |
| Google Cloud | En egendefinert rolle, `oneuptimeDataSecurityResponse` | `storage.buckets.get` og `storage.buckets.update`: innstillingene til en bucket, som forhindring av offentlig tilgang |

Ingenting den gir, leser data, sletter noe eller endrer hvem som kan logge på. Setter du den tilbake til **Av**, slutter Datasikkerhet å bruke den med en gang. For også å fjerne tilgangen i AWS sletter du policyen med `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurityResponse`.

## Hvorfor innholdsprøver er valgfrie

Konfigurasjonsnivået finner det som er eksponert: en offentlig bucket, en database som er åpen mot internett, manglende kryptering, sikkerhetskopier eller tilgangslogger. Det kan ikke se hva et datalager inneholder, så et datalager der ingenting er funnet, regnes som Offentlig, den laveste sensitiviteten, og problemene er like alvorlige som de ville vært for offentlige data. En offentlig bucket med bilder til et nettsted er ingen krise; en offentlig bucket med kortnumre er det.

Innholdsprøver skiller de to. De setter sensitiviteten til hvert datalager ut fra hva det inneholder, så det samme problemet er kritisk for kortnumre og lavt for bilder. De finner også det bare innholdet viser: hemmeligheter, kortsikkerhetskoder, passord lagret slik de ble skrevet inn, og kopier av produksjonsdata i et testlager.

Rekkefølgen de fleste team følger, er derfor: konfigurasjonsnivået overalt, deretter innholdsprøver der du må vite hva et datalager inneholder. Innholdsskanning kan også slås av for ett datalager, med **Skann innhold** i datalagerets **Innstillinger**, eller for hele prosjektet.

## Hva en innholdsskanning leser

En skanning leser litt av et datalager, innenfor prosjektets grenser, og stopper etter 8 minutter uansett hva som gjenstår. Den neste fortsetter derfra: den hopper over et objekt som ikke er endret siden det ble lest, med mindre det var for 7 dager siden eller mer.

- **Bucketer og containere** prøvetas etter type, ikke etter antall. Objektnavn listes først, høyst ti ganger så mange som skanningen kan lese og aldri mer enn 200 000. Hvert navn blir til mønsteret sitt, med datoer, UUID-er, lange heksadesimale rekker og tall gjort om til `*`, så `exports/2026-10-27/users-0001.csv` blir `exports/*/users-*.csv`. De nyeste objektene for hvert mønster leses, ett av hvert før et andre av noe mønster, og høyst 5 av ett mønster. Hvert objekt leses fra starten: høyst **Byte per objekt** av det, og **Byte per skanning** til sammen. En skanning prøvetar høyst 10 containere i en Azure-lagringskonto.
- **Filer leses som det de er.** CSV og TSV etter kolonne, JSON og JSON lines etter sti, `.env`, `.ini`, `.properties`, TOML og YAML etter nøkkel, XML og HTML som tekst, Word-, Excel- og PowerPoint-filer etter tekst og celler, og alt annet som fritekst. En gzip-fil pakkes ut først. Bilder, Parquet, Avro, PDF og andre binærformater leses ikke, og skanningen sier fra om det.
- **Datasett og databaser** leses tabell for tabell: høyst **Tabeller per skanning** tabeller, og **Rader per tabell** rader fra hver.

Hver skanning fører en oversikt over hva den leste, etter navn: objektene, tabellene eller tjenestene, aldri innholdet. Det den ikke kunne lese – en forespørsel skyen avviste, tidsfristen, bytebudsjettet – blir en advarsel på skanningen, og skanningen merkes **Delvis vellykket**.

## Skann en database du drifter selv

Datasikkerhet tar prøver av PostgreSQL- og MySQL-databaser, på én av to måter. En database som Database-produktet overvåker, eller som tjenestene dine snakker med på tjenestekartet, er allerede et datalager. En database ingen skanning finner, legger du selv til som et datalager.

- **Fra OneUptimes workers.** I datalagerets **Innstillinger** setter du **Tilkoblingsstreng** til en som bare kan lese, som `postgresql://reader:password@db.internal:5432/app`. Den krypteres ved lagring og returneres aldri av API-et. Gi den en databasebruker som kan lese og ikke noe annet.
- **Fra en sonde i nettverket ditt.** Velg sonden under **Skann fra sonde**, og skriv inn i **Tilkoblingsvariabel for sonde** navnet på miljøvariabelen på sonden som inneholder tilkoblingsstrengen. Sonden leser databasen fra innsiden av nettverket ditt og sender bare tilbake det den fant: tilkoblingsstrengen når aldri OneUptime. Se [Egendefinerte sonder](/docs/probe/custom-probe) for å kjøre en sonde.

## Hva OneUptime tar vare på

For hver datatype som er funnet på hver plassering – en kolonne, et felt, et objektmønster, et telemetriattributt – tar et funn vare på:

- hvor mange av verdiene i prøven som inneholdt den, av hvor mange, og hvor mange av dem som var velkjente testverdier;
- hvor mange ulike verdier som traff, anslått ut fra hasher som blir i skannerens minne og forkastes med skanningen;
- konfidensen, og om navnet på plasseringen pekte mot datatypen;
- høyst tre maskerte prøver, maskert inne i skanneren før noe forlater den.

Det tar aldri vare på en rå verdi. Hver type verdi maskeres slik at et menneske kan kjenne den igjen, men aldri bruke den:

| Verdi | Maskert prøve |
| --- | --- |
| En e-postadresse | `j***@e******.com`: den første bokstaven i navnet og i domenet, og toppnivådomenet |
| Et kortnummer | `**** **** **** 4242`: de fire siste sifrene, slik PCI DSS tillater at et kort vises |
| En hemmelighet | De fire første og fire siste tegnene når den er lang, de to første når den er kort, og bare hodet til en privat nøkkel |
| En URL eller tilkoblingsstreng | Alt unntatt passordet |
| En IP-adresse | Den første delen, nettverket, med resten skjult |
| En verdi funnet etter navn | Det første tegnet, deretter `****` |
| En dokumentmerking | Merkingen slik den er skrevet, som «Confidential»: den sier hva dokumentet er |
| Alt annet | De to til fire siste tegnene, med skilletegn beholdt, som `***-**-6789` |

Slå av **Behold maskerte prøver** i prosjektets innstillinger for å beholde bare tellinger: fra neste skanning av hvert datalager tar funnene den skriver, ikke vare på noen prøver.

Kopier av data mellom datalagre finnes ved hjelp av fingeravtrykk, ikke verdier: 128 tall på 16 biter for hver datatype, hashet med prosjektets egen nøkkel (se [Hvordan fingeravtrykk holdes private](/docs/data-security/flows-access-residency#slik-holdes-fingeravtrykk-private)).

Et funn teller for datalageret sitt i 30 dager etter at en skanning sist så det, siden en prøve kan gå glipp av noe som fortsatt er der. Et funn som ikke er sett på 90 dager, slettes. Et datalager har høyst 2 000 funn.

## Innstillinger

Innstillingene for Datasikkerhet er ett sett per prosjekt, i seksjonen **Innstillinger** i menyen til Datasikkerhet. De starter med disse standardverdiene:

| Innstilling | Standard | Hva den gjør |
| --- | --- | --- |
| **Kontrollkonfigurasjon** | På | Kjører kontrollene på hvert datalager. Når den er av, åpnes, endres eller lukkes ingen problemer. |
| **Skann innhold** | På | Tar prøver av innholdet i datalagre der innholdstillatelsen er gitt. |
| **Skann telemetri** | På | Tar prøver av prosjektets logger, traser, unntak, avspillinger og AI-samtaler. |
| **Behold maskerte prøver** | På | Beholder opptil tre maskerte prøver med hvert funn. Av beholder bare tellinger. |
| **Åpne sikkerhetssaker** | På | Åpner en sikkerhetssak, gruppert etter datalager, når et kritisk problem åpnes. |
| **Opprett varsler** | Av | Oppretter et varsel, som tilkaller den som har vakt, når et kritisk problem åpnes. |
| **Varselsalvor** | Tom | Alvorlighetsgraden til disse varslene. Tom betyr prosjektets mest alvorlige. |
| **Varsle eiere** | På | Sender e-post til eierne av et datalager når et problem åpnes på det. |
| **Objekter per skanning** | 2 000 | Det høyeste antallet objekter én skanning av en bucket leser, fra 10 til 50 000. |
| **Byte per objekt** | 65 536 (64 KB) | Det høyeste antallet byte som leses fra ett objekt, fra 1 024 til 4 194 304. |
| **Byte per skanning** | 52 428 800 (50 MB) | Det høyeste antallet byte én innholdsskanning leser til sammen, fra 65 536 til 1 073 741 824. |
| **Rader per tabell** | 1 000 | Det høyeste antallet rader som leses fra én tabell, fra 10 til 100 000. |
| **Tabeller per skanning** | 200 | Det høyeste antallet tabeller én skanning leser, fra 1 til 5 000. |
| **Utvalgsstørrelse for telemetri** | 500 | Hvor mange nylige poster for hver tjeneste og hvert signal en telemetriskanning leser, fra 10 til 10 000. |
| **Skanneintervall (timer)** | 24 | Hvor ofte innholdet i et datalager prøvetas på nytt, fra 1 til 720. |
| **Aldri sensitivt** | Tom | Verdier som aldri blir funn, som din egen støtteadresse. |
| **Avslåtte datatyper** | Tom | Innebygde datatyper prosjektets skanninger ikke ser etter: bryterne under **Innebygde datatyper**. |

## Feilsøking

:::details Et datalager sier at innholdet ikke ble skannet
Skanningen sier hvorfor: «Innholdsskanning krever tilkoblingens innholdstillatelse, eller en tilkoblingsstreng for en database.» Sett tilkoblingen til datalageret til **Konfigurasjon og innholdsprøver** og kjør kommandoen på nytt, eller gi databasen en tilkoblingsstreng. Sjekk også at **Skann innhold** er på for datalageret og i prosjektets innstillinger.
:::

:::details En kontroll sier at den ikke kan avgjøre det
En opplysning leseren ikke kunne lese – en tillatelse rollen ikke har, et API som ikke er slått på – er ukjent, aldri gjettet. Kontrollen rapporterer at den ikke kan avgjøre det, og et problem den har åpnet, forblir åpent: ingen kan slutte at et problem er løst fordi OneUptime ikke kunne se. Advarslene fra konfigurasjonslesingen sier hva den ikke kunne lese. Kjør tilkoblingens kommando på nytt for å gi det som mangler.
:::

:::details Ingen S3-bucketer eller BigQuery-datasett vises
De kommer fra konfigurasjonslesingen, ikke fra skyinventaret. Sett tilkoblingen til **Bare konfigurasjon** eller høyere, og kjør kommandoen på nytt.
:::

:::details En skanning er merket Delvis vellykket
Den nådde en grense før den hadde lest alt: de 8 minuttene, **Byte per skanning** eller **Objekter per skanning**, eller en forespørsel skyen avviste. Advarslene sier hvilken. Den neste skanningen fortsetter og hopper over det som ikke er endret, eller du kan heve grensen.
:::

## Neste steg

:::cards
- [Sensitive datatyper](/docs/data-security/data-types): Hva skanneren ser etter i det den leser.
- [Kontroller og problemer i Datasikkerhet](/docs/data-security/checks-and-issues): Hva konfigurasjonslesingen kontrolleres for.
- [Sensitive data i telemetri](/docs/data-security/telemetry): Loggene, trasene og AI-samtalene dine, som ikke trenger noe oppsett.
- [Koble til en skykonto](/docs/telemetry/cloud-accounts): Koble til AWS, Azure eller Google Cloud først.
:::

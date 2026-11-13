# Kontroller og afstemninger

Tabellernes tilstand viser, om en tabel ændrer sig. Et **tjek** viser, om det, den indeholder, er korrekt, en **afstemning** viser, om to kopier af dataene stemmer overens, og **dbt's tests** rapporterer om de tabeller, dbt bygger. Hver af dem kører, hvor databasens indsamling kører, af OneUptime eller af dens sonde, og kun et tal forlader databasen, medmindre et projekt vælger at gemme en maskeret stikprøve af fejlende rækker.

## Tjek

Tilføj et tjek på en tabels fane **Tjek**:

| Tjek | Hvad det læser |
| --- | --- |
| **Andel NULL** | Procentdel af rækker, hvis kolonne er tom |
| **Andel dubletter** | Procentdel af værdier, der gentager en anden rækkes værdi |
| **Antal unikke værdier** | Hvor mange forskellige værdier kolonnen indeholder |
| **Minimum**, **Maksimum**, **Gennemsnit**, **Sum** | Af en numerisk kolonne (en Sum af ingen rækker er 0) |
| **Andel ugyldige værdier** | Procentdel af værdier uden for en liste, du angiver |
| **Andel formatfejl** | Procentdel af værdier, der ikke har et format, du vælger, f.eks. Email, UUID eller Country Code, eller som ikke matcher et regulært udtryk af din egen (alle motorer undtagen SQL Server og Dataverse) |
| **Antal forældreløse rækker** | Rækker, hvis værdi ikke har noget match i en anden tabels kolonne |
| **Antal rækker** | Rækker i tabellen, mest nyttigt med **Opdel efter** |
| **Brugerdefineret SQL** | Det tal, som en skrivebeskyttet SELECT af din egen returnerer, med navnet `value` (i MongoDB en aggregeringspipelines) |
| **Fejlende rækker** | Hvor mange rækker én skrivebeskyttet SELECT af din egen returnerer: de rækker, der ikke burde findes. 0 er sundt (i MongoDB de dokumenter, en pipeline ender i) |

Hvert tjek kører hvert 15. minut, hver time, hver 6. time eller hver dag som én aggregerende sætning i en skrivebeskyttet transaktion med en tidsgrænse for sætningen. Dets værdi skrives som `oneuptime.data.check.value`, med `oneuptime.data.check.id`, `oneuptime.data.check.name` og `oneuptime.data.check.segment`.

## Foreslåede tjek

**Foreslåede kontroller** på samme fane tilbyder de tjek, som en tabels kolonner kalder på, alene ud fra deres navne og typer: et id er unikt, et `customer_id` har en matchende række i `customers`, en e-mailadresse ligner en e-mailadresse, et beløb er ikke negativt, en status beholder sine sædvanlige værdier, og en tabel, der er opdelt efter tenant, tælles pr. tenant. En kolonne, som Datasikkerhed ved indeholder en e-mailadresse, et telefonnummer eller en IP-adresse, holdes til det format, uanset hvad den hedder. Tilføj et, tilføj dem alle, eller afvis et for altid.

## Et tjek ud fra en sætning

**Skriv et tjek ud fra en sætning** gør en regel som "ordrer har aldrig en negativ total" til et tjek med brugerdefineret SQL, der tæller de rækker, der bryder den, i din motors egen SQL, med en advarsel, når der er nogen. Du læser forespørgslen, før **Tilføj tjek** tilføjer den, og den skal opfylde de samme krav som ethvert tjek med brugerdefineret SQL. Det kræver, at OneUptime AI er slået til for projektet. I MongoDB er resultatet en aggregeringspipeline.

## Segmenter

**Opdel efter** kører et tjek én gang pr. værdi i en kolonne, f.eks. en tenant eller en region: én serie og én advarsel for hver, for de 100 største segmenter. Et segmenteret antal rækker advarer, når én tenant holder op med at sende data, mens de andre fortsætter.

## Advarsler på et tjek

Indstil **Advar, når** for at advare på et tjek:

- **Usædvanligt høj** eller **Usædvanligt lav** sammenligner hver værdi med dens egen lærte basislinje for den time på ugen.
- **Over** eller **Under** sammenligner den med en tærskel.

Når du gemmer tjekket, oprettes en metrik-monitor for det, i dit navn og med dine tilladelser. Rydder du betingelsen, fjernes monitoren.

Et tjeks **Status**, under **Tjek** og på fanen **Tjek** for dets tabel, siger, hvordan det står: **Fejler**, mens dets advarsel er åben, **Bestås**, mens den ikke er, og **Kunne ikke køre**, når dets forespørgsel fejlede. Et tjek uden advarsel siger kun, at det **Kørte**. Et tjek, der fejler, og et, der ikke kunne køre, står også på **Oversigt**.

## Hvad et tjek koster

Et tjek konkurrerer med din applikation om databasen, og på et datavarehus, der afregner efter det, en forespørgsel læser, koster det penge. Tre ting holder det under kontrol:

- **Stikprøveprocent** læser en andel af rækkerne i stedet for alle, til et tjek, der læser en rate: Andel NULL, Gennemsnit, Andel ugyldige værdier og Andel formatfejl. De fleste motorer springer hele sider af tabellen over; MySQL, Redshift, ClickHouse og MongoDB læser stadig hver række og slipper for arbejdet på resten. Dataverse tager ingen stikprøve: et tjek dér læser hver række. En visning kan afvise det, og tjekket siger det.
- **Mest en kontrol må læse (GB)** under **Indstillinger** stopper et tjek på BigQuery eller Athena, før det læser mere end så mange gigabyte. Den er 10, indtil du ændrer den.
- **Vent, når en database er optaget** under **Indstillinger** lader forfaldne tjek vente til næste indsamling, når en PostgreSQL-, MySQL- eller SQL Server-database ser optaget ud. Den er slået til, indtil du slår den fra, og databasen siger, hvornår tjek ventede.

## Fejlende rækker

Et tal siger, at noget er galt; nogle få rækker siger hvad. **Gem fejlende rækker** under **Indstillinger** gemmer op til 20 af de rækker, som et tjek af typen Fejlende rækker, Andel ugyldige værdier, Andel formatfejl eller Antal forældreløse rækker fandt, og **Fejlende rækker** på tjekket viser dem. Indstillingen er slået fra, indtil du slår den til. Følsomme kolonner maskeres, hvor rækken læses, efter hvad Datasikkerhed fandt i dem eller efter deres navne, så det, der forlader databasen eller en sonde, allerede er maskeret. En følsom kolonne, som ingen scanning har fundet, og hvis navn ikke afslører den, gemmes, som den er.

Rækkerne gemmes i OneUptime: på OneUptimes servere med OneUptime Cloud og på dine egne med en selvhostet installation. Alle, der kan læse projektets tjek, kan se dem. Et tjek gemmer kun rækkerne fra sin seneste kørsel, og når du slår **Gem fejlende rækker** fra, slettes det, som hvert tjek har gemt.

## Tjek i en fil

Tjek skrevet i hånden glider fra den kode, der ændrer tabellerne. Opbevar dem i dit repository, gennemgået i samme pull request:

```yaml
checks:
  - name: Orders have a total
    table: public.orders
    type: Null Percent
    column: total
    every: 60
    alert: { when: Above, threshold: 1 }
  - name: Emails look right
    table: public.customers
    database: Orders database
    type: Format Mismatch Percent
    column: email
    format: Email
    sample_percent: 10
  - name: Orders have a customer
    table: public.orders
    type: Orphan Count
    column: customer_id
    references: public.customers.id
  - name: No negative totals
    table: public.orders
    type: Failing Rows
    query: SELECT id FROM orders WHERE total < 0
    alert: { when: Above, threshold: 0 }
```

Anvend den fra CI med [OneUptime CLI](/docs/cli/index) og en API-nøgle:

```bash
oneuptime data-checks apply checks.yaml --dry-run
oneuptime data-checks apply checks.yaml --prune
```

Et tjek er det samme tjek, hvis det har samme navn på samme tabel, så anvendes en fil to gange, ændres intet. En fejl et vilkårligt sted i filen anvender intet og afslutter med en fejl, så kør `--dry-run` på pull requesten og anvend ved merge. Med `--prune` slettes et tjek, som en tidligere apply har oprettet, og som filen ikke længere nævner. Et tjek, du har tilføjet i hånden, slettes aldrig. Et tjek fra en fil siger det på sin række, og dens næste apply overskriver det, der blev ændret i hånden.

Nøglerne er `name`, `table`, `database`, `type`, `column`, `segment`, `accepted_values`, `format`, `pattern`, `references`, `query`, `sample_percent`, `every`, `alert`, `description` og `enabled`.

## Afstemninger

Kopier glider fra hinanden: datavarehuset har færre ordrer end applikationens database, eller en migrering mistede rækker. En afstemning sammenligner én måling af to tabeller, i én database eller to, under **Afstemninger**:

- **Antal rækker**
- **Sum** af en kolonne
- **Antal unikke værdier** af en kolonne
- **Brugerdefineret SQL**: en skrivebeskyttet forespørgsel, der returnerer ét tal, med navnet `value`

Den har en tolerance: **Absolut**, et fast beløb, eller **Procent**, en procentdel af kildens værdi. Hver side læses af sit eget tjek, som afstemningen opretter og vedligeholder, med dens databases indsamling, så en afstemning kan sammenligne en PostgreSQL-tabel i dit netværk med dens kopi i Snowflake. De to værdier sammenlignes, når begge er læst inden for 15 minutter af hinanden. En afstemning skriver:

- `oneuptime.data.reconciliation.drifted`: 1, når de to er gledet længere fra hinanden end tolerancen, 0, når de stemmer overens. Dens monitor læser denne værdi.
- `oneuptime.data.reconciliation.difference`: målets værdi minus kildens.
- `oneuptime.data.reconciliation.difference_percent`: forskellen som en procentdel af kildens værdi.

En kopi, der indlæses efter en tidsplan, halter efter sin kilde: sammenlign med brugerdefineret SQL en måling, som begge har stabiliseret sig på, f.eks. rækker ældre end en time, eller tag højde for forsinkelsen i tolerancen.

## dbt-tests

Efter et dbt-build sender `oneuptime dbt upload` projektets artefakter (se [Afstamning og pipelines](/docs/data-observability/lineage-and-pipelines)). Hver test af en overvåget tabel vises derefter på dens fane **Tjek**, med dens seneste resultat og de rækker, den fandt fejlende. Vælg **Advar ved fejl** for at få en fejlende test til at åbne en advarsel.

## Næste trin

:::cards
- [Afstamning og pipelines](/docs/data-observability/lineage-and-pipelines): Send dbt's artefakter, og se kørslen bag et fejlende tjek.
- [Dataprodukter](/docs/data-observability/data-products): Lov dem, der bruger dataene, at de er opdaterede.
:::

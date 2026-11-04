# Kontroller og afstemninger

Tabellernes tilstand viser, om en tabel ændrer sig. Et **tjek** viser, om det, den indeholder, er korrekt, en **afstemning** viser, om to kopier af dataene stemmer overens, og **dbt's tests** rapporterer om de tabeller, dbt bygger. Hver af dem kører, hvor databasens indsamling kører, af OneUptime eller af dens sonde, og kun et tal forlader nogensinde databasen.

## Tjek

Tilføj et tjek på en tabels fane **Tjek**:

| Tjek | Hvad det læser |
| --- | --- |
| **Null Percent** | Procentdel af rækker, hvis kolonne er tom |
| **Duplicate Percent** | Procentdel af værdier, der gentager en anden rækkes værdi |
| **Distinct Count** | Hvor mange forskellige værdier kolonnen indeholder |
| **Minimum**, **Maksimum**, **Gennemsnit**, **Sum** | Af en numerisk kolonne (en Sum af ingen rækker er 0) |
| **Invalid Percent** | Procentdel af værdier uden for en liste, du angiver |
| **Format Mismatch Percent** | Procentdel af værdier, der ikke matcher et regulært udtryk (alle motorer undtagen SQL Server) |
| **Orphan Count** | Rækker, hvis værdi ikke har noget match i en anden tabels kolonne |
| **Row Count** | Rækker i tabellen, mest nyttigt med **Segment By** |
| **Brugerdefineret SQL** | Det tal, som en skrivebeskyttet SELECT af din egen returnerer, med navnet `value` (i MongoDB en aggregeringspipelines) |

Hvert tjek kører hvert 15. minut, hver time, hver 6. time eller hver dag som én aggregerende sætning i en skrivebeskyttet transaktion med en tidsgrænse for sætningen. Dets værdi skrives som `oneuptime.data.check.value`, med `oneuptime.data.check.id`, `oneuptime.data.check.name` og `oneuptime.data.check.segment`.

## Foreslåede tjek

**Suggested Checks** på samme fane tilbyder de tjek, som en tabels kolonner kalder på, alene ud fra deres navne og typer: et id er unikt, et `customer_id` har en matchende række i `customers`, en e-mailadresse ligner en e-mailadresse, et beløb er ikke negativt, en status beholder sine sædvanlige værdier, og en tabel, der er opdelt efter tenant, tælles pr. tenant. Tilføj et, tilføj dem alle, eller afvis et for altid.

## Et tjek ud fra en sætning

**Skriv et tjek ud fra en sætning** gør en regel som "ordrer har aldrig en negativ total" til et tjek med brugerdefineret SQL, der tæller de rækker, der bryder den, i din motors egen SQL, med en advarsel, når der er nogen. Du læser forespørgslen, før **Tilføj tjek** tilføjer den, og den skal opfylde de samme krav som ethvert tjek med brugerdefineret SQL. Det kræver, at OneUptime AI er slået til for projektet. I MongoDB er resultatet en aggregeringspipeline.

## Segmenter

**Segment By** kører et tjek én gang pr. værdi i en kolonne, f.eks. en tenant eller en region: én serie og én advarsel for hver, for de 100 største segmenter. En segmenteret Row Count advarer, når én tenant holder op med at sende data, mens de andre fortsætter.

## Advarsler på et tjek

Indstil **Alert When** for at advare på et tjek:

- **Unusually High** eller **Unusually Low** sammenligner hver værdi med dens egen lærte basislinje for den time på ugen.
- **Over** eller **Under** sammenligner den med en tærskel.

Når du gemmer tjekket, oprettes en metrik-monitor for det, i dit navn og med dine tilladelser. Rydder du betingelsen, fjernes monitoren.

## Afstemninger

Kopier glider fra hinanden: datavarehuset har færre ordrer end applikationens database, eller en migrering mistede rækker. En afstemning sammenligner én måling af to tabeller, i én database eller to, under **Afstemninger**:

- **Row Count**
- **Sum** af en kolonne
- **Distinct Count** af en kolonne
- **Brugerdefineret SQL**: en skrivebeskyttet forespørgsel, der returnerer ét tal, med navnet `value`

Den har en tolerance: **Absolut**, et fast beløb, eller **Procent**, en procentdel af kildens værdi. Hver side læses af sit eget tjek, som afstemningen opretter og vedligeholder, med dens databases indsamling, så en afstemning kan sammenligne en PostgreSQL-tabel i dit netværk med dens kopi i Snowflake. De to værdier sammenlignes, når begge er læst inden for 15 minutter af hinanden. En afstemning skriver:

- `oneuptime.data.reconciliation.drifted`: 1, når de to er gledet længere fra hinanden end tolerancen, 0, når de stemmer overens. Dens monitor læser denne værdi.
- `oneuptime.data.reconciliation.difference`: målets værdi minus kildens.
- `oneuptime.data.reconciliation.difference_percent`: forskellen som en procentdel af kildens værdi.

En kopi, der indlæses efter en tidsplan, halter efter sin kilde: sammenlign med brugerdefineret SQL en måling, som begge har stabiliseret sig på, f.eks. rækker ældre end en time, eller tag højde for forsinkelsen i tolerancen.

## dbt-tests

Efter et dbt-build sender `oneuptime dbt upload` projektets artefakter (se [Afstamning og pipelines](/docs/data-observability/lineage-and-pipelines)). Hver test af en overvåget tabel vises derefter på dens fane **Tjek**, med dens seneste resultat og de rækker, den fandt fejlende. Vælg **Alert on Failures** for at få en fejlende test til at åbne en advarsel.

## Næste trin

:::cards
- [Afstamning og pipelines](/docs/data-observability/lineage-and-pipelines): Send dbt's artefakter, og se kørslen bag et fejlende tjek.
- [Dataprodukter](/docs/data-observability/data-products): Lov dem, der bruger dataene, at de er opdaterede.
:::

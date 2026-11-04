# Kontroller og avstemminger

Tabellhelse sier om en tabell endres. En **sjekk** sier om det den inneholder, er riktig, en **avstemming** sier om to kopier av dataene stemmer overens, og **dbt-testene** rapporterer om tabellene dbt bygger. Hver av dem kjører der innsamlingen for databasen kjører, hos OneUptime eller på sonden, og bare et tall forlater noen gang databasen.

## Sjekker

Legg til en sjekk i fanen **Sjekker** for en tabell:

| Sjekk | Hva den leser |
| --- | --- |
| **Null Percent** | Prosentandelen rader der kolonnen er tom |
| **Duplicate Percent** | Prosentandelen verdier som gjentar verdien i en annen rad |
| **Distinct Count** | Hvor mange forskjellige verdier kolonnen inneholder |
| **Minimum**, **Maksimum**, **Gjennomsnitt**, **Sum** | Av en numerisk kolonne (en Sum av null rader er 0) |
| **Invalid Percent** | Prosentandelen verdier utenfor en liste du oppgir |
| **Format Mismatch Percent** | Prosentandelen verdier som ikke samsvarer med et regulært uttrykk (alle databasemotorer unntatt SQL Server) |
| **Orphan Count** | Rader der verdien ikke har noe samsvar i en kolonne i en annen tabell |
| **Row Count** | Rader i tabellen, mest nyttig med **Segment By** |
| **Egendefinert SQL** | Tallet som én skrivebeskyttet SELECT fra deg returnerer, kalt `value` |

Hver sjekk kjører hvert 15. minutt, hver time, hver 6. time eller hver dag, som én aggregeringssetning i en skrivebeskyttet transaksjon med tidsavbrudd for setninger. Verdien skrives som `oneuptime.data.check.value`, med `oneuptime.data.check.id`, `oneuptime.data.check.name` og `oneuptime.data.check.segment`.

## Foreslåtte sjekker

**Suggested Checks** i den samme fanen foreslår sjekkene kolonnene i en tabell tilsier, bare ut fra navnene og typene deres: en id er unik, en `customer_id` har en tilsvarende rad i `customers`, en e-postadresse ser ut som en e-postadresse, et beløp er ikke negativt, en status holder seg til de vanlige verdiene, og en tabell som er delt opp etter leietaker, telles per leietaker. Legg til én, legg til alle, eller avvis én for godt.

## En sjekk ut fra en setning

**Skriv en sjekk fra en setning** gjør en regel som «ordrer har aldri en negativ totalsum» om til en sjekk med egendefinert SQL som teller radene som bryter regelen, i databasemotorens egen SQL, med et varsel når noen gjør det. Du leser spørringen før **Legg til sjekk** legger den til, og den holdes til alt som gjelder for enhver sjekk med egendefinert SQL. Det krever at OneUptime AI er slått på for prosjektet.

## Segmenter

**Segment By** kjører en sjekk én gang per verdi i en kolonne, for eksempel en leietaker eller en region: én serie og ett varsel for hver, for de 100 største segmentene. En segmentert Row Count-sjekk varsler når én leietaker slutter å sende data mens de andre fortsetter.

## Varsler på en sjekk

Sett **Alert When** for å varsle på en sjekk:

- **Unusually High** eller **Unusually Low** sammenligner hver verdi med sin egen innlærte grunnlinje for den timen i uken.
- **Over** eller **Under** sammenligner den med en terskel.

Når du lagrer sjekken, opprettes en metrikkmonitor for den, som deg og med dine tillatelser. Fjerner du betingelsen, fjernes monitoren.

## Avstemminger

Kopier glir fra hverandre: datavarehuset har færre ordrer enn applikasjonens database, eller en migrering mistet rader. En avstemming sammenligner én måling av to tabeller, i én database eller to, under **Avstemminger**:

- **Row Count**
- **Sum** av en kolonne
- **Distinct Count** av en kolonne
- **Egendefinert SQL**: en skrivebeskyttet spørring som returnerer ett tall, kalt `value`

Den har en toleranse: et **Absolutt** beløp, eller en andel i **Prosent** av kildens verdi. Hver side leses av en egen sjekk, som avstemmingen oppretter og vedlikeholder, sammen med innsamlingen for databasen sin, så en avstemming kan sammenligne en PostgreSQL-tabell i nettverket ditt med kopien av den i Snowflake. De to verdiene sammenlignes når begge er lest innen 15 minutter fra hverandre. En avstemming skriver:

- `oneuptime.data.reconciliation.drifted`: 1 når de to har glidd fra hverandre utover toleransen, 0 når de stemmer overens. Monitoren leser denne.
- `oneuptime.data.reconciliation.difference`: målets verdi minus kildens.
- `oneuptime.data.reconciliation.difference_percent`: differansen som en prosentandel av kildens verdi.

En kopi som lastes etter en tidsplan, henger etter kilden sin: sammenlign en måling begge har kommet til ro på, for eksempel rader eldre enn en time, med egendefinert SQL, eller ta høyde for forsinkelsen i toleransen.

## dbt-tester

Etter en dbt-bygging sender `oneuptime dbt upload` prosjektets artefakter (se [Avstamning og pipelines](/docs/data-observability/lineage-and-pipelines)). Hver test av en overvåket tabell vises deretter i fanen **Sjekker**, med siste resultat og radene den fant som feilet. Velg **Alert on Failures** for at en test som feiler, skal åpne et varsel.

## Neste steg

:::cards
- [Avstamning og pipelines](/docs/data-observability/lineage-and-pipelines): Send dbt-artefaktene, og se kjøringen bak en sjekk som feiler.
- [Dataprodukter](/docs/data-observability/data-products): Lov dem som bruker dataene, at de er ferske.
:::

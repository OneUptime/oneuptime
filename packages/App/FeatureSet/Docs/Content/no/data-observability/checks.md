# Kontroller og avstemminger

Tabellhelse sier om en tabell endres. En **sjekk** sier om det den inneholder, er riktig, en **avstemming** sier om to kopier av dataene stemmer overens, og **dbt-testene** rapporterer om tabellene dbt bygger. Hver av dem kjører der innsamlingen for databasen kjører, hos OneUptime eller på sonden, og bare et tall forlater databasen, med mindre et prosjekt velger å beholde et maskert utvalg av radene som feiler.

## Sjekker

Legg til en sjekk i fanen **Sjekker** for en tabell:

| Sjekk | Hva den leser |
| --- | --- |
| **Andel NULL** | Prosentandelen rader der kolonnen er tom |
| **Andel duplikater** | Prosentandelen verdier som gjentar verdien i en annen rad |
| **Antall unike verdier** | Hvor mange forskjellige verdier kolonnen inneholder |
| **Minimum**, **Maksimum**, **Gjennomsnitt**, **Sum** | Av en numerisk kolonne (en Sum av null rader er 0) |
| **Andel ugyldige verdier** | Prosentandelen verdier utenfor en liste du oppgir |
| **Andel formatfeil** | Prosentandelen verdier som ikke har et format du velger, for eksempel Email, UUID eller Country Code, eller som ikke samsvarer med et regulært uttrykk fra deg (alle databasemotorer unntatt SQL Server og Dataverse) |
| **Antall foreldreløse rader** | Rader der verdien ikke har noe samsvar i en kolonne i en annen tabell |
| **Antall rader** | Rader i tabellen, mest nyttig med **Segmenter etter** |
| **Egendefinert SQL** | Tallet som én skrivebeskyttet SELECT fra deg returnerer, kalt `value` (i MongoDB en aggregeringspipelines) |
| **Rader som feiler** | Hvor mange rader én skrivebeskyttet SELECT fra deg returnerer: radene som ikke skal finnes. 0 er friskt (i MongoDB dokumentene en pipeline ender i) |

Hver sjekk kjører hvert 15. minutt, hver time, hver 6. time eller hver dag, som én aggregeringssetning i en skrivebeskyttet transaksjon med tidsavbrudd for setninger. Verdien skrives som `oneuptime.data.check.value`, med `oneuptime.data.check.id`, `oneuptime.data.check.name` og `oneuptime.data.check.segment`.

## Foreslåtte sjekker

**Foreslåtte sjekker** i den samme fanen foreslår sjekkene kolonnene i en tabell tilsier, bare ut fra navnene og typene deres: en id er unik, en `customer_id` har en tilsvarende rad i `customers`, en e-postadresse ser ut som en e-postadresse, et beløp er ikke negativt, en status holder seg til de vanlige verdiene, og en tabell som er delt opp etter leietaker, telles per leietaker. En kolonne Datasikkerhet vet inneholder en e-postadresse, et telefonnummer eller en IP-adresse, må ha det formatet, uansett hva den heter. Legg til én, legg til alle, eller avvis én for godt.

## En sjekk ut fra en setning

**Skriv en sjekk fra en setning** gjør en regel som «ordrer har aldri en negativ totalsum» om til en sjekk med egendefinert SQL som teller radene som bryter regelen, i databasemotorens egen SQL, med et varsel når noen gjør det. Du leser spørringen før **Legg til sjekk** legger den til, og den holdes til alt som gjelder for enhver sjekk med egendefinert SQL. Det krever at OneUptime AI er slått på for prosjektet. I MongoDB er resultatet en aggregeringspipeline.

## Segmenter

**Segmenter etter** kjører en sjekk én gang per verdi i en kolonne, for eksempel en leietaker eller en region: én serie og ett varsel for hver, for de 100 største segmentene. En segmentert sjekk av antall rader varsler når én leietaker slutter å sende data mens de andre fortsetter.

## Varsler på en sjekk

Sett **Varsle når** for å varsle på en sjekk:

- **Uvanlig høy** eller **Uvanlig lav** sammenligner hver verdi med sin egen innlærte grunnlinje for den timen i uken.
- **Over** eller **Under** sammenligner den med en terskel.

Når du lagrer sjekken, opprettes en metrikkmonitor for den, som deg og med dine tillatelser. Fjerner du betingelsen, fjernes monitoren.

**Status** for en sjekk, under **Sjekker** og på fanen **Sjekker** for tabellen, sier hvordan den står: **Feiler** mens varselet er åpent, **Består** mens det ikke er det, og **Kunne ikke kjøre** når spørringen feilet. En sjekk uten varsel viser bare **Kjørte**: spørringen virket. En sjekk som feiler, og en som ikke kunne kjøre, står også på **Oversikt**.

## Hva en sjekk koster

En sjekk konkurrerer med applikasjonen din om databasen, og på et datavarehus som fakturerer etter det en spørring leser, koster den penger. Tre ting holder det under kontroll:

- **Utvalgsprosent** leser en andel av radene i stedet for alle, for en sjekk som leser en rate: Andel NULL, Gjennomsnitt, Andel ugyldige verdier og Andel formatfeil. De fleste databasemotorer hopper over hele sider av tabellen; MySQL, Redshift, ClickHouse og MongoDB leser fortsatt hver rad, og sparer arbeidet på resten. Dataverse tar ikke noe utvalg: en sjekk der leser hver rad. En visning kan nekte det, og sjekken sier fra om det.
- **Mest en kontroll kan lese (GB)**, under **Innstillinger**, stopper en sjekk på BigQuery eller Athena før den leser mer enn så mange gigabyte. Den er 10 til du endrer den.
- **Vent når en database er opptatt**, under **Innstillinger**, lar sjekker som er på tur vente til neste innsamling når en PostgreSQL-, MySQL- eller SQL Server-database ser opptatt ut. Den er på til du slår den av, og databasen sier fra når sjekker ventet.

## Rader som feiler

Et tall sier at noe er galt; noen få rader sier hva. **Behold feilaktige rader** under **Innstillinger** beholder opptil 20 av radene en sjekk av typen Rader som feiler, Andel ugyldige verdier, Andel formatfeil eller Antall foreldreløse rader fant, og **Rader som feiler** på sjekken viser dem. Innstillingen er av til du slår den på. Sensitive kolonner maskeres der raden leses, ut fra det Datasikkerhet fant i dem eller ut fra navnene deres, så det som forlater databasen, eller en sonde, allerede er maskert. En sensitiv kolonne som ingen skanning har funnet, og som navnet ikke avslører, beholdes som den er.

Radene lagres i OneUptime: på OneUptimes servere med OneUptime Cloud og på dine egne med en selvdriftet installasjon. Alle som kan lese prosjektets sjekker, kan se dem. En sjekk beholder bare radene fra den siste kjøringen, og når du slår av **Behold feilaktige rader**, slettes det hver sjekk har beholdt.

## Sjekker i en fil

Sjekker skrevet for hånd glir fra koden som endrer tabellene. Ha dem i repositoriet ditt, gjennomgått i den samme pull requesten:

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

Bruk den fra CI med [OneUptime CLI](/docs/cli/index) og en API-nøkkel:

```bash
oneuptime data-checks apply checks.yaml --dry-run
oneuptime data-checks apply checks.yaml --prune
```

En sjekk er den samme sjekken hvis den har det samme navnet på den samme tabellen, så å bruke en fil to ganger endrer ingenting. En feil et sted i filen gjør at ingenting brukes, og kommandoen avsluttes med en feil, så kjør `--dry-run` på pull requesten og bruk filen ved sammenslåing. Med `--prune` slettes en sjekk en tidligere kjøring opprettet som filen ikke lenger nevner. En sjekk du la til for hånd, slettes aldri. En sjekk fra en fil sier det på raden sin, og neste kjøring overskriver det som ble endret for hånd.

Nøklene er `name`, `table`, `database`, `type`, `column`, `segment`, `accepted_values`, `format`, `pattern`, `references`, `query`, `sample_percent`, `every`, `alert`, `description` og `enabled`.

## Avstemminger

Kopier glir fra hverandre: datavarehuset har færre ordrer enn applikasjonens database, eller en migrering mistet rader. En avstemming sammenligner én måling av to tabeller, i én database eller to, under **Avstemminger**:

- **Antall rader**
- **Sum** av en kolonne
- **Antall unike verdier** av en kolonne
- **Egendefinert SQL**: en skrivebeskyttet spørring som returnerer ett tall, kalt `value`

Den har en toleranse: et **Absolutt** beløp, eller en andel i **Prosent** av kildens verdi. Hver side leses av en egen sjekk, som avstemmingen oppretter og vedlikeholder, sammen med innsamlingen for databasen sin, så en avstemming kan sammenligne en PostgreSQL-tabell i nettverket ditt med kopien av den i Snowflake. De to verdiene sammenlignes når begge er lest innen 15 minutter fra hverandre. En avstemming skriver:

- `oneuptime.data.reconciliation.drifted`: 1 når de to har glidd fra hverandre utover toleransen, 0 når de stemmer overens. Monitoren leser denne.
- `oneuptime.data.reconciliation.difference`: målets verdi minus kildens.
- `oneuptime.data.reconciliation.difference_percent`: differansen som en prosentandel av kildens verdi.

En kopi som lastes etter en tidsplan, henger etter kilden sin: sammenlign en måling begge har kommet til ro på, for eksempel rader eldre enn en time, med egendefinert SQL, eller ta høyde for forsinkelsen i toleransen.

## dbt-tester

Etter en dbt-bygging sender `oneuptime dbt upload` prosjektets artefakter (se [Avstamning og pipelines](/docs/data-observability/lineage-and-pipelines)). Hver test av en overvåket tabell vises deretter i fanen **Sjekker**, med siste resultat og radene den fant som feilet. Velg **Varsle ved feil** for at en test som feiler, skal åpne et varsel.

## Neste steg

:::cards
- [Avstamning og pipelines](/docs/data-observability/lineage-and-pipelines): Send dbt-artefaktene, og se kjøringen bak en sjekk som feiler.
- [Dataprodukter](/docs/data-observability/data-products): Lov dem som bruker dataene, at de er ferske.
:::

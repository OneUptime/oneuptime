# Kontroller och avstämningar

Tabellhälsa visar om en tabell ändras. En **kontroll** visar om det den innehåller är rätt, en **avstämning** visar om två kopior av data stämmer överens, och **dbt:s tester** rapporterar om de tabeller som dbt bygger. Var och en körs där databasens insamling körs, av OneUptime eller av dess sond, och bara ett tal lämnar databasen, om inte ett projekt väljer att spara ett maskerat urval av felaktiga rader.

## Kontroller

Lägg till en kontroll på en tabells flik **Kontroller**:

| Kontroll | Vad den läser |
| --- | --- |
| **Andel NULL** | Procentandel rader vars kolumn är tom |
| **Andel dubbletter** | Procentandel värden som upprepar en annan rads värde |
| **Antal unika värden** | Hur många olika värden kolumnen innehåller |
| **Minimum**, **Maximum**, **Genomsnitt**, **Summa** | Av en numerisk kolumn (en Summa av inga rader är 0) |
| **Andel ogiltiga värden** | Procentandel värden utanför en lista som du anger |
| **Andel formatfel** | Procentandel värden som inte har ett format som du väljer, till exempel Email, UUID eller Country Code, eller som inte matchar ett reguljärt uttryck som du anger (alla motorer utom SQL Server och Dataverse) |
| **Antal föräldralösa rader** | Rader vars värde saknar motsvarighet i en annan tabells kolumn |
| **Antal rader** | Rader i tabellen, mest användbart med **Segmentera efter** |
| **Anpassad SQL** | Talet som en egen SELECT med enbart läsbehörighet returnerar, med namnet `value` (i MongoDB en aggregeringspipelines) |
| **Rader som misslyckas** | Hur många rader en egen SELECT med enbart läsbehörighet returnerar: de rader som inte borde finnas. 0 är friskt (i MongoDB de dokument som en pipeline slutar i) |

Varje kontroll körs var 15:e minut, varje timme, var 6:e timme eller varje dag, som en enda aggregerande sats i en transaktion med enbart läsbehörighet och en tidsgräns för satsen. Dess värde skrivs som `oneuptime.data.check.value`, med `oneuptime.data.check.id`, `oneuptime.data.check.name` och `oneuptime.data.check.segment`.

## Föreslagna kontroller

**Föreslagna kontroller** på samma flik erbjuder de kontroller som en tabells kolumner kräver, utifrån enbart deras namn och typer: ett id är unikt, ett `customer_id` har en matchande rad i `customers`, en e-postadress ser ut som en, ett belopp är inte negativt, en status behåller sina vanliga värden, och en tabell som är uppdelad per tenant räknas per tenant. En kolumn som Datasäkerhet vet innehåller en e-postadress, ett telefonnummer eller en IP-adress hålls till det formatet, oavsett vad den heter. Lägg till en, lägg till alla, eller avfärda en för gott.

## En kontroll utifrån en mening

**Skriv en kontroll utifrån en mening** gör en regel som "order har aldrig ett negativt totalbelopp" till en kontroll med anpassad SQL som räknar de rader som bryter mot den, i din motors egen SQL, med ett larm när någon rad gör det. Du läser frågan innan **Lägg till kontroll** lägger till den, och den måste uppfylla samma krav som varje kontroll med anpassad SQL. Det kräver att OneUptime AI är påslaget för projektet. I MongoDB blir resultatet en aggregeringspipeline.

## Segment

**Segmentera efter** kör en kontroll en gång per värde i en kolumn, till exempel en tenant eller en region: en serie och ett larm för vart och ett, för de 100 största segmenten. Ett segmenterat antal rader larmar när en tenant slutar skicka data medan de andra fortsätter.

## Larm på en kontroll

Ställ in **Larma när** för att larma på en kontroll:

- **Ovanligt hög** eller **Ovanligt låg** jämför varje värde med dess egen inlärda baslinje för den timmen i veckan.
- **Över** eller **Under** jämför det med ett tröskelvärde.

När du sparar kontrollen skapas en metrikövervakning för den, i ditt namn och med dina behörigheter. Om du rensar villkoret tas monitorn bort.

En kontrolls **Status**, under **Kontroller** och på fliken **Kontroller** för dess tabell, säger hur den står till: **Misslyckas** medan dess larm är öppet, **Godkänns** medan det inte är det, och **Kunde inte köra** när dess fråga misslyckades. En kontroll utan larm visar bara **Kördes**: dess fråga fungerade. En kontroll som misslyckas, och en som inte kunde köras, finns också på **Översikt**.

## Vad en kontroll kostar

En kontroll konkurrerar med din applikation om databasen, och i ett datavaruhus som debiterar efter vad en fråga läser kostar den pengar. Tre saker håller det under kontroll:

- **Stickprovsprocent** läser en andel av raderna i stället för alla, för en kontroll som läser en andel: Andel NULL, Genomsnitt, Andel ogiltiga värden och Andel formatfel. De flesta motorer hoppar över hela sidor av tabellen; MySQL, Redshift, ClickHouse och MongoDB läser fortfarande varje rad, och slipper arbetet med resten. Dataverse tar inget stickprov: en kontroll där läser varje rad. En vy kan vägra det, och kontrollen säger det.
- **Mest en kontroll får läsa (GB)**, under **Inställningar**, stoppar en kontroll i BigQuery eller Athena innan den läser fler gigabyte än så. Den är 10 tills du ändrar den.
- **Vänta när en databas är upptagen**, under **Inställningar**, lämnar kontroller som ska köras till nästa insamling när en PostgreSQL-, MySQL- eller SQL Server-databas ser upptagen ut. Den är påslagen tills du stänger av den, och databasen säger när kontroller väntade.

## Felaktiga rader

Ett tal säger att något är fel; några rader säger vad. **Spara felaktiga rader** under **Inställningar** sparar upp till 20 av de rader som en kontroll av typen Rader som misslyckas, Andel ogiltiga värden, Andel formatfel eller Antal föräldralösa rader hittade, och **Rader som misslyckas** på kontrollen visar dem. Inställningen är av tills du slår på den. Känsliga kolumner maskeras där raden läses, utifrån vad Datasäkerhet hittade i dem eller deras namn, så det som lämnar databasen, eller en sond, är redan maskerat. En känslig kolumn som ingen skanning har hittat och vars namn inte avslöjar den sparas som den är.

Raderna lagras i OneUptime: på OneUptimes servrar med OneUptime Cloud och på dina egna med en egenhostad installation. Alla som kan läsa projektets kontroller kan se dem. En kontroll sparar bara raderna från sin senaste körning, och när du stänger av **Spara felaktiga rader** raderas det som varje kontroll har sparat.

## Kontroller i en fil

Kontroller som skrivs för hand glider ifrån koden som ändrar tabellerna. Förvara dem i ditt repository, granskade i samma pull request:

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

Tillämpa den från CI med [OneUptime CLI](/docs/cli/index) och en API-nyckel:

```bash
oneuptime data-checks apply checks.yaml --dry-run
oneuptime data-checks apply checks.yaml --prune
```

En kontroll är samma kontroll om den har samma namn på samma tabell, så att tillämpa en fil två gånger ändrar ingenting. Ett fel var som helst i filen gör att ingenting tillämpas och kommandot avslutas med ett fel, så kör `--dry-run` på pull requesten och tillämpa vid sammanslagning. Med `--prune` tas en kontroll som en tidigare apply skapade och som filen inte längre nämner bort. En kontroll som du lade till för hand tas aldrig bort. En kontroll från en fil säger det på sin rad, och nästa apply skriver över det som ändrades för hand.

Nycklarna är `name`, `table`, `database`, `type`, `column`, `segment`, `accepted_values`, `format`, `pattern`, `references`, `query`, `sample_percent`, `every`, `alert`, `description` och `enabled`.

## Avstämningar

Kopior glider isär: datavaruhuset har färre order än applikationens databas, eller en migrering tappade rader. En avstämning jämför ett mått i två tabeller, i en databas eller två, under **Avstämningar**:

- **Antal rader**
- **Summa** av en kolumn
- **Antal unika värden** av en kolumn
- **Anpassad SQL**: en fråga med enbart läsbehörighet som returnerar ett tal, med namnet `value`

Den har en tolerans: **Absolut**, ett fast belopp, eller **Procent**, en procentandel av källans värde. Varje sida läses av en egen kontroll, som avstämningen skapar och underhåller, med sin databas insamling, så att en avstämning kan jämföra en PostgreSQL-tabell i ditt nätverk med dess kopia i Snowflake. De två värdena jämförs när båda har lästs inom 15 minuter från varandra. En avstämning skriver:

- `oneuptime.data.reconciliation.drifted`: 1 när de två har glidit isär mer än toleransen, 0 när de stämmer överens. Dess monitor läser detta värde.
- `oneuptime.data.reconciliation.difference`: målets värde minus källans.
- `oneuptime.data.reconciliation.difference_percent`: skillnaden som en procentandel av källans värde.

En kopia som laddas enligt ett schema ligger efter sin källa: jämför med anpassad SQL ett mått som båda har stabiliserats på, till exempel rader äldre än en timme, eller ta höjd för fördröjningen i toleransen.

## dbt-tester

Efter en dbt-build skickar `oneuptime dbt upload` projektets artefakter (se [Härkomst och pipelines](/docs/data-observability/lineage-and-pipelines)). Varje test av en övervakad tabell visas sedan på dess flik **Kontroller**, med det senaste resultatet och de rader som testet fann felaktiga. Välj **Larma vid fel** för att ett test som inte går igenom ska öppna ett larm.

## Nästa steg

:::cards
- [Härkomst och pipelines](/docs/data-observability/lineage-and-pipelines): Skicka dbt:s artefakter, och se körningen bakom en kontroll som inte går igenom.
- [Dataprodukter](/docs/data-observability/data-products): Lova dem som använder data att de är aktuella.
:::

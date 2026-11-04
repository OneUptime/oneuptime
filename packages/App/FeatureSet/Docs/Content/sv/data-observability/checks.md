# Kontroller och avstämningar

Tabellhälsa visar om en tabell ändras. En **kontroll** visar om det den innehåller är rätt, en **avstämning** visar om två kopior av data stämmer överens, och **dbt:s tester** rapporterar om de tabeller som dbt bygger. Var och en körs där databasens insamling körs, av OneUptime eller av dess sond, och bara ett tal lämnar någonsin databasen.

## Kontroller

Lägg till en kontroll på en tabells flik **Kontroller**:

| Kontroll | Vad den läser |
| --- | --- |
| **Null Percent** | Procentandel rader vars kolumn är tom |
| **Duplicate Percent** | Procentandel värden som upprepar en annan rads värde |
| **Distinct Count** | Hur många olika värden kolumnen innehåller |
| **Minimum**, **Maximum**, **Genomsnitt**, **Summa** | Av en numerisk kolumn (en Summa av inga rader är 0) |
| **Invalid Percent** | Procentandel värden utanför en lista som du anger |
| **Format Mismatch Percent** | Procentandel värden som inte matchar ett reguljärt uttryck (alla motorer utom SQL Server) |
| **Orphan Count** | Rader vars värde saknar motsvarighet i en annan tabells kolumn |
| **Row Count** | Rader i tabellen, mest användbart med **Segment By** |
| **Anpassad SQL** | Talet som en egen SELECT med enbart läsbehörighet returnerar, med namnet `value` (i MongoDB en aggregeringspipelines) |

Varje kontroll körs var 15:e minut, varje timme, var 6:e timme eller varje dag, som en enda aggregerande sats i en transaktion med enbart läsbehörighet och en tidsgräns för satsen. Dess värde skrivs som `oneuptime.data.check.value`, med `oneuptime.data.check.id`, `oneuptime.data.check.name` och `oneuptime.data.check.segment`.

## Föreslagna kontroller

**Suggested Checks** på samma flik erbjuder de kontroller som en tabells kolumner kräver, utifrån enbart deras namn och typer: ett id är unikt, ett `customer_id` har en matchande rad i `customers`, en e-postadress ser ut som en, ett belopp är inte negativt, en status behåller sina vanliga värden, och en tabell som är uppdelad per tenant räknas per tenant. Lägg till en, lägg till alla, eller avfärda en för gott.

## En kontroll utifrån en mening

**Skriv en kontroll utifrån en mening** gör en regel som "order har aldrig ett negativt totalbelopp" till en kontroll med anpassad SQL som räknar de rader som bryter mot den, i din motors egen SQL, med ett larm när någon rad gör det. Du läser frågan innan **Lägg till kontroll** lägger till den, och den måste uppfylla samma krav som varje kontroll med anpassad SQL. Det kräver att OneUptime AI är påslaget för projektet. I MongoDB blir resultatet en aggregeringspipeline.

## Segment

**Segment By** kör en kontroll en gång per värde i en kolumn, till exempel en tenant eller en region: en serie och ett larm för vart och ett, för de 100 största segmenten. En segmenterad Row Count larmar när en tenant slutar skicka data medan de andra fortsätter.

## Larm på en kontroll

Ställ in **Alert When** för att larma på en kontroll:

- **Unusually High** eller **Unusually Low** jämför varje värde med dess egen inlärda baslinje för den timmen i veckan.
- **Över** eller **Under** jämför det med ett tröskelvärde.

När du sparar kontrollen skapas en metrikövervakning för den, i ditt namn och med dina behörigheter. Om du rensar villkoret tas monitorn bort.

## Avstämningar

Kopior glider isär: datavaruhuset har färre order än applikationens databas, eller en migrering tappade rader. En avstämning jämför ett mått i två tabeller, i en databas eller två, under **Avstämningar**:

- **Row Count**
- **Summa** av en kolumn
- **Distinct Count** av en kolumn
- **Anpassad SQL**: en fråga med enbart läsbehörighet som returnerar ett tal, med namnet `value`

Den har en tolerans: **Absolut**, ett fast belopp, eller **Procent**, en procentandel av källans värde. Varje sida läses av en egen kontroll, som avstämningen skapar och underhåller, med sin databas insamling, så att en avstämning kan jämföra en PostgreSQL-tabell i ditt nätverk med dess kopia i Snowflake. De två värdena jämförs när båda har lästs inom 15 minuter från varandra. En avstämning skriver:

- `oneuptime.data.reconciliation.drifted`: 1 när de två har glidit isär mer än toleransen, 0 när de stämmer överens. Dess monitor läser detta värde.
- `oneuptime.data.reconciliation.difference`: målets värde minus källans.
- `oneuptime.data.reconciliation.difference_percent`: skillnaden som en procentandel av källans värde.

En kopia som laddas enligt ett schema ligger efter sin källa: jämför med anpassad SQL ett mått som båda har stabiliserats på, till exempel rader äldre än en timme, eller ta höjd för fördröjningen i toleransen.

## dbt-tester

Efter en dbt-build skickar `oneuptime dbt upload` projektets artefakter (se [Härkomst och pipelines](/docs/data-observability/lineage-and-pipelines)). Varje test av en övervakad tabell visas sedan på dess flik **Kontroller**, med det senaste resultatet och de rader som testet fann felaktiga. Välj **Alert on Failures** för att ett test som inte går igenom ska öppna ett larm.

## Nästa steg

:::cards
- [Härkomst och pipelines](/docs/data-observability/lineage-and-pipelines): Skicka dbt:s artefakter, och se körningen bakom en kontroll som inte går igenom.
- [Dataprodukter](/docs/data-observability/data-products): Lova dem som använder data att de är aktuella.
:::

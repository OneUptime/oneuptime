# Tabellernes tilstand

Hvert femte minut fortæller kataloget i hver forbundet database, hvordan hver tabel har det: hvornår den sidst blev ændret, hvor mange rækker den indeholder, hvor stor den er, og hvilke kolonner den har. Ud fra det lærer Dataobservabilitet hver tabels rytme og siger til, når en tabel er forsinket, skrumper eller skifter form, uden nogen tærskel at indstille.

## Hvad der læses

For hver tabel og view:

- **Antal rækker og størrelse**, fra motorens egen statistik.
- **Hvornår den sidst blev ændret**: motorens eget tidspunkt, hvor den gemmer et, eller det øjeblik, hvor dens skrivetællere, rækker eller bytes flyttede sig mellem to indsamlinger.
- **Dens kolonner**, med deres typer, og om de må være tomme.
- **Hvornår den sidst blev læst**, hvor motoren tæller læsninger.

Kun kataloget læses, og i MongoDB feltnavnene på en samlings nyeste dokumenter. Ingen værdi forlader databasen.

## Aktualitet

En tabels **rytme** er, hvor ofte den plejer at ændre sig, lært ud fra tiden mellem dens ændringer. En tabel, der går et godt stykke forbi sin rytme, vises som **Forsinket**, på sin side og under **Tabeller**, og skriver, hvor langt forbi den er. Dens aktualitet kendes, når den har ændret sig to gange: en tabel, der indlæses hver time, læres inden for få timer, en, der indlæses hver nat, inden for få dage.

Et view har ingen egne rækker, så dets aktualitet er dets kilders aktualitet: se [Afstamning og pipelines](/docs/data-observability/lineage-and-pipelines).

Et katalog kan sige, at en tabel er ændret, når kun dens vedligeholdelse er det, eller slet ikke sige noget. Angiv på en tabels **Indstillinger** en **Friskhedskolonne** som `updated_at`, og dens seneste ændring bliver den kolonnes nyeste værdi. Login skal kunne læse kolonnen, og den læses ved hver indsamling, så den bør være indekseret; på BigQuery og Athena, som afregner efter det, en forespørgsel læser, læses den én gang i timen. Tidspunkter uden tidszone antages at være UTC.

## Volumen- og skemaændringer

- **Rækker** sammenlignes mellem indsamlinger: en tabel, der mister halvdelen af sine rækker eller indeholder langt færre end normalt for den time på ugen, siger til.
- **Kolonner** sammenlignes også. En kolonne, der tilføjes, fjernes, omdøbes, får ny type eller gøres nullable, kommer på tabellens **Tidslinje** og på **Skemaændringer**, som viser hver ændring i hver database, nyeste først. En kolonne, der fjernes, omdøbes eller får ny type, ødelægger det, der læser den, og kan give en advarsel. En, der tilføjes, ødelægger intet og bliver på tidslinjen.
- **Slettede tabeller** gemmes under **Slettede tabeller**, med hvornår de sidst blev set, og vender tilbage med deres historik, hvis tabellen kommer igen.

## Anbefalede advarsler

Vælg **Anbefalede advarsler** for en database under **Databaser**. Hver anbefaling er én metrik-monitor for hele databasen, der advarer én gang pr. tabel, så en tabel, der oprettes senere, også overvåges:

| Advarsel | Udløses, når |
| --- | --- |
| **Table Is Late** | En tabel forbliver i femten minutter efter det tidspunkt, hvor den plejer at være ændret |
| **Row Count Fell Sharply** | En tabel mister halvdelen af sine rækker eller mere mellem to indsamlinger |
| **Row Count Unusually Low** | En tabel indeholder langt færre rækker end normalt for den time på ugen (lært over to uger) |
| **Schema Changed** | En tabels kolonner fjernes, omdøbes eller får ny type |
| **Table Health Stopped Reporting** | Ingen tabel i databasen er blevet læst i femten minutter |

Vælg alvorligheder, vagtpolitikker, ejere og etiketter, når du opretter dem. Derefter er de almindelige monitorer: rediger dem, slå dem på lydløs, eller sæt dem på en statusside som enhver anden.

En backfill eller en migrering bør alarmere ingen. Angiv databasen under **Data Observability Databaser** på en [vedligeholdelseshændelse](/docs/scheduled-maintenance/index), eller sæt dens databaseserver i en, og dens dataadvarsler forbliver stille, mens begivenheden står på.

## Metrikker, hver tabel skriver

Hver indsamling skriver disse for hver tabel, så du kan vise dem i grafer, sætte dem på dashboards og advare på dem som på enhver anden metrik:

| Metrik | Hvad den er |
| --- | --- |
| `oneuptime.data.table.row_count` | Rækker i tabellen |
| `oneuptime.data.table.size` | Bytes, som tabellen og dens indeks fylder |
| `oneuptime.data.table.seconds_since_change` | Sekunder siden tabellen sidst blev ændret |
| `oneuptime.data.table.overdue_seconds` | Sekunder, tabellen er forbi det tidspunkt, hvor den plejer at være ændret; 0, så længe den er til tiden |
| `oneuptime.data.table.row_count_change_percent` | Hvor meget antallet af rækker har flyttet sig siden den forrige indsamling, i procent |
| `oneuptime.data.table.schema_changes` | Kolonner, der er ændret siden den forrige indsamling |
| `oneuptime.data.table.breaking_schema_changes` | Kolonner, der er fjernet, omdøbt eller fået ny type siden den forrige indsamling |

Hver række bærer `oneuptime.data.store.id`, `oneuptime.data.store.name`, `oneuptime.data.table.id`, `oneuptime.data.table.schema`, `oneuptime.data.table.name` og `oneuptime.data.table.key` (`schema.table`). En [metrik-monitor](/docs/monitor/metrics-monitor), grupperet efter `oneuptime.data.table.key`, advarer én gang pr. tabel, og dens filtre **Unormalt høj** og **Unormalt lav** sammenligner hver tabel med dens egen sædvanlige værdi for den time på ugen. Disse metrikker er OneUptimes egne driftsdata og faktureres ikke som telemetri.

## Ubrugte tabeller

Hver motor, der tæller læsninger, viser, hvornår hver tabel sidst blev læst: PostgreSQL's scanninger, MySQL's performance_schema, SQL Servers seeks, scans og lookups og forespørgselshistorikken i Redshift, ClickHouse og Databricks. En læsning, der ses i dine tjenesters databasespans, tæller også.

**Ubrugte tabeller** viser de tabeller, ingen har læst i 90 dage, de største først, med hvornår der sidst blev skrevet til hver: en tabel, der stadig skrives til, men aldrig læses, koster sine skrivninger og sin lagerplads. En tæller på 0 ved en tabels første indsamling betyder, at den ikke er blevet læst, siden motorens statistik startede, så en ubrugt tabel vises som ubrugt fra starten.

## Lagerforbrug

En gang i timen læser Dataobservabilitet, hvad hvert Snowflake- og BigQuery-lager har brugt det seneste døgn, job for job: Snowflakes compute-credits fra `QUERY_ATTRIBUTION_HISTORY` og BigQuerys fakturerede bytes fra dens jobvisning, som kræver **BigQuery Resource Viewer**. Et job er én forespørgsel, der køres igen og igen, navngivet efter dens query tag eller label eller efter, hvad den gør, og den tabel, den skriver: aldrig efter forespørgslens tekst.

**Lagerforbrug** viser totalerne efter team (`team` i et jobs query tag eller label, ellers den, der kører det), de tabeller, hvis skrivninger koster mest, de job, der fejlede, og hvad der bruges på job, der kun skriver tabeller, som ingen har læst i 90 dage.

## Tjenester, der bruger hver tabel

En tabels fane **Tjenester** viser de tjenester, der er set skrive til og læse fra den, med de sætninger, hver kørte, dens kald og fejl i den seneste time, og hvornår den sidst blev set. Den bygger på de databasespans, dine tjenester allerede sender med OpenTelemetry: et klientspan med `db.system.name`, `db.namespace` og `db.collection.name`. Intet ekstra at installere.

Et span knyttes kun til en tabel, når dets database er en, som en indsamling har læst, og når to databaser deler navn, kun når dets `server.address` er en af deres.

Hver tjeneste viser også de endpoints, der foretager dens kald, ud fra serverspannet i samme spor, og markeres som **AI-app**, når den også kalder en model. **Fejl, der nævner denne tabel** viser de åbne undtagelser og det seneste døgns fejllogge fra de tjenester, der skriver til tabellen, når de nævner den ved navn.

## Ejere og etiketter

En tabels fane **Ejere** nævner de personer og teams, den tilhører, og en tabels advarsel går til dem; uden nogen til ejerne af dens database. Giv den på en tabels **Indstillinger** dine egne **Etiketter**.

Du bør ikke skulle gøre det hundredvis af gange. **Ejerregler** og **Etiketregler** gælder for hver tabel, når den første gang vises, matchet efter dens etiketter eller efter et regulært udtryk på dens navn, skema eller database: alt i `finance` går til finansteamet, og alt med navnet `*_pii` får en etiket.

En tilladelse begrænset til `Owned` når kun de tabeller, som dens indehaver eller dennes teams ejer, med deres tjek, aktivitet og rapporterede problemer. At eje en database gør dig ikke til ejer af dens tabeller: brug en ejerregel til at give et team en hel database.

## Når en advarsel åbnes

En tabels advarsel har et **Data**-kort, der siger, hvorfor det mest sandsynligt skete, rangeret: en advarsel opstrøms, en mislykket kørsel, en udrulning af en tjeneste, der skriver til den, dens mislykkede skrivninger, en kolonne, der er ændret, databasen selv eller den server, den kører på. Under det står, hvad der afhænger af den: tabeller nedstrøms i dens afstamning, dashboards, tjenester og de personer, der ejer dem.

Sig, hvad du udledte af den:

- **Useful**: den havde ret.
- **Expected**: en planlagt begivenhed. Intet ændres, og den næste rejses også.
- **Ikke et problem**: tabellen får mere spillerum, så det samme forbliver stille næste gang. En forsinket tabels sædvanlige interval vokser, og et rækkeantals tolerance udvides.

Hvis en person finder et problem først, registrerer **Rapportér et problem** på tabellen det. **Oversigt** viser derefter, hvordan Dataobservabilitet klarer sig for dit projekt: nyttige problemer om ugen, hvor mange der ikke var støj, hvor mange tabeller der læses, hvor ofte den rejste et problem, før nogen rapporterede det, hvor hurtigt, og hvor ofte dens sandsynlige årsag var den rigtige.

## Næste trin

:::cards
- [Kontroller og afstemninger](/docs/data-observability/checks): Regler for det, en tabel indeholder, ud over om den ændrer sig.
- [Afstamning og pipelines](/docs/data-observability/lineage-and-pipelines): Hvor en forsinket tabels data kommer fra, og den kørsel, der skulle have indlæst den.
:::

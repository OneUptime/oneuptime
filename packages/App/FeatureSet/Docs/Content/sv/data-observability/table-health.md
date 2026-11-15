# Tabellhälsa

Var femte minut berättar katalogen i varje ansluten databas hur varje tabell mår: när den senast ändrades, hur många rader den innehåller, hur stor den är och vilka kolumner den har. Utifrån det lär sig Dataobserverbarhet varje tabells rytm, och säger till när en tabell är försenad, krymper eller byter form, utan något tröskelvärde att ställa in.

## Vad som läses

För varje tabell och vy:

- **Antal rader och storlek**, från motorns egen statistik.
- **När den senast ändrades**: motorns egen tidpunkt där den sparar en, annars det ögonblick då dess skrivräknare, rader eller byte rörde sig mellan två insamlingar.
- **Dess kolumner**, med deras typer och om de får vara tomma.
- **När den senast lästes**, där motorn räknar läsningar.

Bara katalogen läses, och i MongoDB fältnamnen i en samlings nyaste dokument. Inget värde lämnar databasen.

## Aktualitet

En tabells **rytm** är hur ofta den brukar ändras, inlärd från tiden mellan dess ändringar. En tabell som går en bra bit förbi sin rytm visas som **Sen**, på sin sida och under **Tabeller**, och skriver hur långt förbi den är. Dess aktualitet är känd när den har ändrats två gånger: en tabell som laddas varje timme lärs in inom några timmar, en som laddas varje natt inom några dagar.

En vy har inga egna rader, så dess aktualitet är dess källors aktualitet: se [Härkomst och pipelines](/docs/data-observability/lineage-and-pipelines).

En katalog kan säga att en tabell ändrades när bara dess underhåll gjorde det, eller inte säga något alls. Ange under en tabells **Inställningar** en **Aktualitetskolumn** som `updated_at`, så blir dess senaste ändring den kolumnens nyaste värde. Inloggningen måste få läsa kolumnen, och den läses vid varje insamling, så den bör vara indexerad; i BigQuery och Athena, som debiterar efter vad en fråga läser, läses den en gång i timmen. Tider utan zon tolkas som UTC.

## Volym- och schemaändringar

- **Rader** jämförs mellan insamlingar: en tabell som förlorar hälften av sina rader, eller innehåller mycket färre än vanligt för den timmen i veckan, säger till.
- **Kolumner** jämförs också. En kolumn som läggs till, tas bort, byter namn, byter typ eller blir nullbar hamnar på tabellens **Tidslinje** och under **Schemaändringar**, som listar varje ändring i varje databas, de senaste först. En kolumn som tas bort, byter namn eller byter typ bryter det som läser den, och kan ge larm. En som läggs till bryter ingenting och blir kvar på tidslinjen.
- **Borttagna tabeller** sparas under **Borttagna tabeller**, med när de senast sågs, och kommer tillbaka med sin historik om tabellen återkommer.

## Rekommenderade larm

Välj **Rekommenderade larm** för en databas under **Databaser**. Varje rekommendation är en metrikövervakning för hela databasen som larmar en gång per tabell, så att även en tabell som skapas senare övervakas:

| Larm | Utlöses när |
| --- | --- |
| **Table Is Late** | En tabell ligger i femton minuter efter den tidpunkt då den brukar ha ändrats |
| **Row Count Fell Sharply** | En tabell förlorar hälften av sina rader eller fler mellan två insamlingar |
| **Row Count Unusually Low** | En tabell innehåller mycket färre rader än vanligt för den timmen i veckan (inlärt under två veckor) |
| **Schema Changed** | En tabells kolumner tas bort, byter namn eller byter typ |
| **Table Health Stopped Reporting** | Ingen tabell i databasen har lästs på femton minuter |

Välj allvarlighetsgrader, jourpolicyer, ägare och etiketter när du skapar dem. Därefter är de vanliga monitorer: redigera dem, tysta dem eller lägg dem på en statussida som vilken annan som helst.

En ifyllnad eller en migrering ska inte larma någon. Ange databasen under **Dataobserverbarhet Databaser** på en [underhållshändelse](/docs/scheduled-maintenance/index), eller lägg dess databasserver i en, så är dess datalarm tysta medan händelsen pågår.

## Mätvärden som varje tabell skriver

Varje insamling skriver dessa för varje tabell, så att du kan visa dem i diagram, lägga dem på instrumentpaneler och larma på dem som på vilket annat mätvärde som helst:

| Mätvärde | Vad det är |
| --- | --- |
| `oneuptime.data.table.row_count` | Rader i tabellen |
| `oneuptime.data.table.size` | Byte som tabellen och dess index tar upp |
| `oneuptime.data.table.seconds_since_change` | Sekunder sedan tabellen senast ändrades |
| `oneuptime.data.table.overdue_seconds` | Sekunder som tabellen ligger efter den tidpunkt då den brukar ha ändrats; 0 så länge den är i tid |
| `oneuptime.data.table.row_count_change_percent` | Hur mycket antalet rader har ändrats sedan föregående insamling, i procent |
| `oneuptime.data.table.schema_changes` | Kolumner som har ändrats sedan föregående insamling |
| `oneuptime.data.table.breaking_schema_changes` | Kolumner som har tagits bort, bytt namn eller bytt typ sedan föregående insamling |

Varje rad bär `oneuptime.data.store.id`, `oneuptime.data.store.name`, `oneuptime.data.table.id`, `oneuptime.data.table.schema`, `oneuptime.data.table.name` och `oneuptime.data.table.key` (`schema.table`). En [metrikövervakning](/docs/monitor/metrics-monitor) grupperad efter `oneuptime.data.table.key` larmar en gång per tabell, och dess filter **Onormalt hög** och **Onormalt låg** jämför varje tabell med dess eget vanliga värde för den timmen i veckan. Dessa mätvärden är OneUptimes egna driftdata och debiteras inte som telemetri.

## Oanvända tabeller

Varje motor som räknar läsningar visar när varje tabell senast lästes: PostgreSQL:s skanningar, MySQL:s performance_schema, SQL Servers seeks, scans och lookups, och frågehistoriken i Redshift, ClickHouse och Databricks. En läsning som syns i dina tjänsters databasspans räknas också.

**Oanvända tabeller** listar de tabeller som ingen har läst på 90 dagar, de största först, med när var och en senast skrevs till: en tabell som fortfarande skrivs till men aldrig läses kostar sina skrivningar och sin lagring. En räknare på 0 vid en tabells första insamling betyder att den inte har lästs sedan motorns statistik startade, så en oanvänd tabell visas som oanvänd från början.

## Lagerkostnad

En gång i timmen läser Dataobserverbarhet vad varje Snowflake- och BigQuery-lager har spenderat det senaste dygnet, jobb för jobb: Snowflakes beräkningskrediter från `QUERY_ATTRIBUTION_HISTORY` och BigQuerys fakturerade byte från dess jobbvy, som kräver **BigQuery Resource Viewer**. Ett jobb är en fråga som körs om och om igen, namngiven efter sin frågetagg eller label, eller efter vad den gör och tabellen den skriver: aldrig efter frågans text.

**Lagerkostnad** visar summorna per team (`team` i ett jobbs frågetagg eller label, annars den som kör det), tabellerna vars skrivningar kostar mest, jobben som misslyckades och vad som går till jobb som bara skriver tabeller som ingen har läst på 90 dagar.

## Tjänster som använder varje tabell

En tabells flik **Tjänster** listar de tjänster som har setts skriva till och läsa från den, med de satser var och en körde, dess anrop och fel under den senaste timmen, och när den senast sågs. Den bygger på de databasspans som dina tjänster redan skickar med OpenTelemetry: ett klientspan med `db.system.name`, `db.namespace` och `db.collection.name`. Inget extra att installera.

Ett span kopplas till en tabell bara när dess databas är en som en insamling har läst, och när två databaser har samma namn, bara när dess `server.address` är en av deras.

Varje tjänst visar också de endpoints som gör dess anrop, från serverspanet i samma spår, och markeras som **AI-app** när den anropar en modell också. **Fel som nämner den här tabellen** listar de öppna undantagen och det senaste dygnets felloggar från tjänsterna som skriver till tabellen, när de nämner den vid namn.

## Ägare och etiketter

En tabells flik **Ägare** namnger de personer och team den tillhör, och en tabells larm går till dem; saknas de, till ägarna av dess databas. Ge den egna **Etiketter** under tabellens **Inställningar**.

Du ska inte behöva göra det hundratals gånger. **Ägarregler** och **Etikettregler** gäller för varje tabell när den först dyker upp, matchade på dess etiketter, eller på ett reguljärt uttryck för dess namn, schema eller databas: allt i `finance` går till ekonomiteamet, och allt som heter `*_pii` får en etikett.

En behörighet begränsad till `Owned` når bara de tabeller som dess innehavare eller innehavarens team äger, med deras kontroller, aktivitet och rapporterade problem. Att äga en databas gör dig inte till ägare av dess tabeller: använd en ägarregel för att ge ett team en hel databas.

## När ett larm öppnas

Ett tabellarm har ett kort **Data** som säger varför det troligast hände, rangordnat: ett larm uppströms, en misslyckad körning, en driftsättning av en tjänst som skriver till den, dess misslyckade skrivningar, en kolumn som ändrades, databasen själv eller servern den körs på. Under det står vad som beror på den: tabeller nedåt i dess härkomst, instrumentpaneler, tjänster och de personer som äger dem.

Säg vad du drog för slutsats:

- **Useful**: det hade rätt.
- **Expected**: en planerad händelse. Ingenting ändras, och nästa larmas också.
- **Inte ett problem**: tabellen får mer utrymme, så att samma sak är tyst nästa gång. En sen tabells vanliga intervall växer, och en radantalstolerans vidgas.

Om en person hittar ett problem först registrerar **Rapportera ett problem** på tabellen det. **Översikt** visar sedan hur Dataobserverbarhet klarar sig för ditt projekt: användbara problem i veckan, hur många som inte var brus, hur många tabeller som läses, hur ofta det larmade om ett problem innan någon rapporterade det, hur snabbt, och hur ofta dess troliga orsak var den verkliga.

## Nästa steg

:::cards
- [Kontroller och avstämningar](/docs/data-observability/checks): Regler för vad en tabell innehåller, utöver om den ändras.
- [Härkomst och pipelines](/docs/data-observability/lineage-and-pipelines): Var en försenad tabells data kommer ifrån, och den körning som borde ha laddat den.
:::

# Tabellernes tilstand

Hvert femte minut fortæller kataloget i hver forbundet database, hvordan hver tabel har det: hvornår den sidst blev ændret, hvor mange rækker den indeholder, hvor stor den er, og hvilke kolonner den har. Ud fra det lærer Dataobservabilitet hver tabels rytme og siger til, når en tabel er forsinket, skrumper eller skifter form, uden nogen tærskel at indstille.

## Hvad der læses

For hver tabel og view:

- **Antal rækker og størrelse**, fra motorens egen statistik.
- **Hvornår den sidst blev ændret**: motorens eget tidspunkt, hvor den gemmer et, eller det øjeblik, hvor dens skrivetællere, rækker eller bytes flyttede sig mellem to indsamlinger.
- **Dens kolonner**, med deres typer, og om de må være tomme.
- **Hvornår den sidst blev læst**, hvor motoren tæller læsninger.

Kun kataloget læses. Ingen række læses, og ingen værdi forlader databasen.

## Aktualitet

En tabels **rytme** er, hvor ofte den plejer at ændre sig, lært ud fra tiden mellem dens ændringer. En tabel, der går et godt stykke forbi sin rytme, vises som **Late**, på sin side og under **Tabeller**, og skriver, hvor langt forbi den er. Dens aktualitet kendes, når den har ændret sig to gange: en tabel, der indlæses hver time, læres inden for få timer, en, der indlæses hver nat, inden for få dage.

Et view har ingen egne rækker, så dets aktualitet er dets kilders aktualitet: se [Afstamning og pipelines](/docs/data-observability/lineage-and-pipelines).

## Volumen- og skemaændringer

- **Rækker** sammenlignes mellem indsamlinger: en tabel, der mister halvdelen af sine rækker eller indeholder langt færre end normalt for den time på ugen, siger til.
- **Kolonner** sammenlignes også. En kolonne, der tilføjes, fjernes, omdøbes, får ny type eller gøres nullable, kommer på tabellens **Tidslinje** og på **Skemaændringer**, som viser hver ændring i hver database, nyeste først.
- **Slettede tabeller** gemmes under **Slettede tabeller**, med hvornår de sidst blev set, og vender tilbage med deres historik, hvis tabellen kommer igen.

## Anbefalede advarsler

Vælg **Recommended Alerts** for en database under **Databaser**. Hver anbefaling er én metrik-monitor for hele databasen, der advarer én gang pr. tabel, så en tabel, der oprettes senere, også overvåges:

| Advarsel | Udløses, når |
| --- | --- |
| **Table Is Late** | En tabel forbliver i femten minutter efter det tidspunkt, hvor den plejer at være ændret |
| **Row Count Fell Sharply** | En tabel mister halvdelen af sine rækker eller mere mellem to indsamlinger |
| **Row Count Unusually Low** | En tabel indeholder langt færre rækker end normalt for den time på ugen (lært over to uger) |
| **Schema Changed** | En tabels kolonner tilføjes, fjernes, omdøbes eller får ny type |
| **Table Health Stopped Reporting** | Ingen tabel i databasen er blevet læst i femten minutter |

Vælg alvorligheder, vagtpolitikker, ejere og etiketter, når du opretter dem. Derefter er de almindelige monitorer: rediger dem, slå dem på lydløs, eller sæt dem på en statusside som enhver anden.

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

Hver række bærer `oneuptime.data.store.id`, `oneuptime.data.store.name`, `oneuptime.data.table.id`, `oneuptime.data.table.schema`, `oneuptime.data.table.name` og `oneuptime.data.table.key` (`schema.table`). En [metrik-monitor](/docs/monitor/metrics-monitor), grupperet efter `oneuptime.data.table.key`, advarer én gang pr. tabel, og dens filtre **Anomalously High** og **Anomalously Low** sammenligner hver tabel med dens egen sædvanlige værdi for den time på ugen. Disse metrikker er OneUptimes egne driftsdata og faktureres ikke som telemetri.

## Ubrugte tabeller

Hver motor, der tæller læsninger, viser, hvornår hver tabel sidst blev læst: PostgreSQL's scanninger, MySQL's performance_schema, SQL Servers seeks, scans og lookups og forespørgselshistorikken i Redshift, ClickHouse og Databricks. En læsning, der ses i dine tjenesters databasespans, tæller også.

**Ubrugte tabeller** viser de tabeller, ingen har læst i 90 dage, de største først, med hvornår der sidst blev skrevet til hver: en tabel, der stadig skrives til, men aldrig læses, koster sine skrivninger og sin lagerplads. En tæller på 0 ved en tabels første indsamling betyder, at den ikke er blevet læst, siden motorens statistik startede, så en ubrugt tabel vises som ubrugt fra starten.

## Tjenester, der bruger hver tabel

En tabels fane **Tjenester** viser de tjenester, der er set skrive til og læse fra den, med de sætninger, hver kørte, dens kald og fejl i den seneste time, og hvornår den sidst blev set. Den bygger på de databasespans, dine tjenester allerede sender med OpenTelemetry: et klientspan med `db.system.name`, `db.namespace` og `db.collection.name`. Intet ekstra at installere.

Et span knyttes kun til en tabel, når dets database er en, som en indsamling har læst, og når to databaser deler navn, kun når dets `server.address` er en af deres.

## Næste trin

:::cards
- [Kontroller og afstemninger](/docs/data-observability/checks): Regler for det, en tabel indeholder, ud over om den ændrer sig.
- [Afstamning og pipelines](/docs/data-observability/lineage-and-pipelines): Hvor en forsinket tabels data kommer fra, og den kørsel, der skulle have indlæst den.
:::

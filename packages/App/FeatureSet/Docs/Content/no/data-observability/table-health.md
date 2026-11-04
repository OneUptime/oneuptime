# Tabellhelse

Hvert femte minutt forteller katalogen til hver tilkoblede database hvordan det står til med hver tabell: når den sist ble endret, hvor mange rader den inneholder, hvor stor den er, og hvilke kolonner den har. Dataobserverbarhet lærer seg rytmen til hver tabell ut fra dette, og sier fra når en tabell er forsinket, krymper eller endrer form, uten noen terskel å stille inn.

## Hva som leses

For hver tabell og visning:

- **Antall rader og størrelse**, fra databasemotorens egen statistikk.
- **Når den sist ble endret**: databasemotorens eget tidspunkt der den fører et, eller øyeblikket da skrivetellerne, radene eller bytene flyttet seg mellom to innsamlinger.
- **Kolonnene**, med typene sine og om de kan være tomme.
- **Når den sist ble lest**, der databasemotoren teller lesinger.

Bare katalogen leses. Ingen rad leses, og ingen verdi forlater databasen.

## Aktualitet

**Rytmen** til en tabell er hvor ofte den vanligvis endres, lært ut fra tiden mellom endringene. En tabell som går godt over rytmen sin, vises som **Late**, på siden sin og under **Tabeller**, og skriver hvor langt over den er. Aktualiteten er kjent når tabellen har endret seg to ganger: en tabell som lastes hver time, læres i løpet av noen timer, en som lastes hver natt, i løpet av noen dager.

En visning har ingen egne rader, så aktualiteten dens er aktualiteten til kildene: se [Avstamning og pipelines](/docs/data-observability/lineage-and-pipelines).

## Volum- og skjemaendringer

- **Rader** sammenlignes mellom innsamlinger: en tabell som mister halvparten av radene sine, eller har langt færre enn vanlig for den timen i uken, sier fra om det.
- **Kolonner** sammenlignes også. En kolonne som legges til, fjernes, får nytt navn, ny type eller blir nullbar, havner på tabellens **Tidslinje** og under **Skjemaendringer**, som viser hver endring i hver database, nyeste først.
- **Tabeller som er slettet**, tas vare på under **Slettede tabeller**, med når de sist ble sett, og kommer tilbake med historikken sin hvis tabellen dukker opp igjen.

## Anbefalte varsler

Under **Databaser** velger du **Recommended Alerts** for en database. Hver anbefaling er én metrikkmonitor for hele databasen som varsler én gang per tabell, så en tabell som opprettes senere, overvåkes også:

| Varsel | Utløses når |
| --- | --- |
| **Table Is Late** | En tabell har i femten minutter vært over tiden den vanligvis endres innen |
| **Row Count Fell Sharply** | En tabell mister halvparten av radene sine eller mer mellom to innsamlinger |
| **Row Count Unusually Low** | En tabell har langt færre rader enn vanlig for den timen i uken (lært over to uker) |
| **Schema Changed** | Kolonner i en tabell legges til, fjernes, får nytt navn eller ny type |
| **Table Health Stopped Reporting** | Ingen tabell i databasen er lest på femten minutter |

Velg alvorlighetsgrader, vaktordninger, eiere og etiketter når du oppretter dem. Deretter er de vanlige monitorer: rediger dem, demp dem eller legg dem på en statusside som alle andre.

## Metrikker hver tabell skriver

Hver innsamling skriver disse for hver tabell, så du kan lage grafer av dem, legge dem på dashbord og varsle på dem som på enhver annen metrikk:

| Metrikk | Hva den er |
| --- | --- |
| `oneuptime.data.table.row_count` | Rader i tabellen |
| `oneuptime.data.table.size` | Byte som tabellen og indeksene dens tar |
| `oneuptime.data.table.seconds_since_change` | Sekunder siden tabellen sist ble endret |
| `oneuptime.data.table.overdue_seconds` | Sekunder tabellen er over tiden den vanligvis endres innen; 0 så lenge den er i rute |
| `oneuptime.data.table.row_count_change_percent` | Hvor mye antall rader har endret seg siden forrige innsamling, i prosent |
| `oneuptime.data.table.schema_changes` | Kolonner som er endret siden forrige innsamling |

Hver rad har med seg `oneuptime.data.store.id`, `oneuptime.data.store.name`, `oneuptime.data.table.id`, `oneuptime.data.table.schema`, `oneuptime.data.table.name` og `oneuptime.data.table.key` (`schema.table`). En [metrikkmonitor](/docs/monitor/metrics-monitor) gruppert etter `oneuptime.data.table.key` varsler én gang per tabell, og filtrene **Anomalously High** og **Anomalously Low** sammenligner hver tabell med dens egen vanlige verdi for den timen i uken. Disse metrikkene er OneUptimes egne driftsdata og faktureres ikke som telemetri.

## Ubrukte tabeller

Hver databasemotor som teller lesinger, viser når hver tabell sist ble lest: skanningene i PostgreSQL, performance_schema i MySQL, seeks, scans og lookups i SQL Server, og spørringshistorikken i Redshift, ClickHouse og Databricks. En lesing som er sett i databasespanene til tjenestene dine, teller også.

**Ubrukte tabeller** viser tabellene ingen har lest på 90 dager, de største først, med når hver av dem sist ble skrevet til: en tabell som fortsatt skrives til, men aldri leses, koster skrivingene og lagringen sin. En teller på 0 ved en tabells første innsamling betyr at den ikke er lest siden databasemotorens statistikk startet, så en ubrukt tabell vises som ubrukt fra starten av.

## Lagerforbruk

En gang i timen leser Dataobserverbarhet hva hvert Snowflake- og BigQuery-lager brukte det siste døgnet, jobb for jobb: Snowflakes compute-kreditter fra `QUERY_ATTRIBUTION_HISTORY` og BigQuerys fakturerte byte fra jobbvisningen, som krever **BigQuery Resource Viewer**. En jobb er én spørring som kjøres igjen og igjen, navngitt etter query-taggen eller label, eller etter hva den gjør og tabellen den skriver: aldri etter teksten i spørringen.

**Lagerforbruk** viser totalene etter team (`team` i en jobbs query-tag eller label, ellers den som kjører den), tabellene der skrivingen koster mest, jobbene som feilet, og hva som går til jobber som bare skriver tabeller ingen har lest på 90 dager.

## Tjenester som bruker hver tabell

Fanen **Tjenester** for en tabell viser tjenestene som er sett skrive til og lese fra den, med setningene hver av dem kjørte, kallene og feilene den siste timen, og når den sist ble sett. Dette kommer fra databasespanene tjenestene dine allerede sender med OpenTelemetry: et klient-span med `db.system.name`, `db.namespace` og `db.collection.name`. Ingenting ekstra å installere.

Et span knyttes til en tabell bare når databasen er en som en innsamling har lest, og når to databaser har samme navn, bare når `server.address` er en av deres.

## Neste steg

:::cards
- [Kontroller og avstemminger](/docs/data-observability/checks): Regler for hva en tabell inneholder, utover om den endres.
- [Avstamning og pipelines](/docs/data-observability/lineage-and-pipelines): Hvor dataene til en forsinket tabell kommer fra, og kjøringen som skulle ha lastet dem.
:::

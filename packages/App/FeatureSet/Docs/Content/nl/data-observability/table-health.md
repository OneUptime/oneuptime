# Gezondheid van tabellen

Elke vijf minuten zegt de catalogus van elke gekoppelde database hoe elke tabel ervoor staat: wanneer ze voor het laatst is gewijzigd, hoeveel rijen ze bevat, hoe groot ze is en wat haar kolommen zijn. Data-observability leert daaruit het ritme van elke tabel, en zegt wanneer een tabel te laat is, krimpt of van vorm verandert, zonder dat je een drempel hoeft in te stellen.

## Wat wordt gelezen

Voor elke tabel en view:

- **Aantal rijen en grootte**, uit de eigen statistieken van de engine.
- **Wanneer ze voor het laatst is gewijzigd**: het tijdstip dat de engine zelf bijhoudt, als ze dat doet, of het moment waarop haar schrijftellers, rijen of bytes tussen twee verzamelrondes bewogen.
- **Haar kolommen**, met hun typen en of ze leeg mogen zijn.
- **Wanneer ze voor het laatst is gelezen**, waar de engine leesacties telt.

Alleen de catalogus wordt gelezen, en bij MongoDB de veldnamen van de nieuwste documenten van een collectie. Geen enkele waarde verlaat de database.

## Actualiteit

Het **ritme** van een tabel is hoe vaak ze gewoonlijk verandert, geleerd uit de tijd tussen haar wijzigingen. Een tabel die ruim voorbij haar ritme gaat, wordt getoond als **Te laat**, op haar pagina en in **Tabellen**, en schrijft hoe ver ze erover is. Haar actualiteit is bekend zodra ze twee keer is gewijzigd: een tabel die elk uur wordt geladen, is binnen enkele uren geleerd, een tabel die elke nacht wordt geladen, binnen enkele dagen.

Een view heeft geen eigen rijen, dus haar actualiteit is die van haar bronnen: zie [Lineage en pipelines](/docs/data-observability/lineage-and-pipelines).

Een catalogus kan zeggen dat een tabel is gewijzigd terwijl alleen het huishoudelijke werk is gedaan, of helemaal niets zeggen. Geef op de **Instellingen** van een tabel een **Freshness-kolom** op, zoals `updated_at`, en haar laatste wijziging wordt de nieuwste waarde van die kolom. De login moet de kolom kunnen lezen, en ze wordt bij elke verzamelronde gelezen, dus ze hoort geïndexeerd te zijn; op BigQuery en Athena, die afrekenen op wat een query leest, wordt ze eens per uur gelezen. Tijden zonder zone worden als UTC beschouwd.

## Volume- en schemawijzigingen

- **Rijen** worden tussen verzamelrondes vergeleken: een tabel die de helft van haar rijen verliest, of veel minder bevat dan gebruikelijk voor dat uur van de week, meldt dat.
- **Kolommen** worden ook vergeleken. Een kolom die wordt toegevoegd, verwijderd, hernoemd, van type veranderd of nullable gemaakt, komt op de **Tijdlijn** van de tabel en op **Schemawijzigingen**, dat elke wijziging van elke database toont, de nieuwste eerst. Een kolom die wordt verwijderd, hernoemd of van type veranderd, breekt wat eruit leest, en kan een waarschuwing geven. Een toegevoegde kolom breekt niets en blijft op de tijdlijn.
- **Verwijderde tabellen** worden bewaard onder **Verwijderde tabellen**, met wanneer ze voor het laatst zijn gezien, en komen met hun geschiedenis terug als de tabel terugkeert.

## Aanbevolen waarschuwingen

Kies op **Databases** de optie **Aanbevolen waarschuwingen** voor een database. Elke aanbeveling is één metrics-monitor voor de hele database die één keer per tabel waarschuwt, zodat ook een tabel die later wordt aangemaakt, wordt bewaakt:

| Waarschuwing | Gaat af wanneer |
| --- | --- |
| **Table Is Late** | Een tabel blijft vijftien minuten voorbij het tijdstip waarop ze gewoonlijk is gewijzigd |
| **Row Count Fell Sharply** | Een tabel verliest tussen twee verzamelrondes de helft van haar rijen of meer |
| **Row Count Unusually Low** | Een tabel bevat veel minder rijen dan gebruikelijk voor dat uur van de week (geleerd over twee weken) |
| **Schema Changed** | Kolommen van een tabel worden verwijderd, hernoemd of van type veranderd |
| **Table Health Stopped Reporting** | Geen enkele tabel van de database is in vijftien minuten gelezen |

Kies ernst, on-call-beleid, eigenaren en labels wanneer je ze aanmaakt. Daarna zijn het gewone monitoren: bewerk ze, demp ze, of zet ze op een statuspagina zoals elke andere.

Een backfill of een migratie hoort niemand op te roepen. Noem de database onder **Databases van Data Observability** op een [onderhoudsgebeurtenis](/docs/scheduled-maintenance/index), of zet haar databaseserver erin, en haar gegevenswaarschuwingen blijven stil zolang het onderhoud loopt.

## Metrieken die elke tabel schrijft

Elke verzamelronde schrijft deze voor elke tabel, zodat je ze in grafieken kunt zetten, op dashboards kunt plaatsen en erop kunt waarschuwen zoals op elke andere metriek:

| Metriek | Wat het is |
| --- | --- |
| `oneuptime.data.table.row_count` | Rijen in de tabel |
| `oneuptime.data.table.size` | Bytes die de tabel en haar indexen innemen |
| `oneuptime.data.table.seconds_since_change` | Seconden sinds de tabel voor het laatst is gewijzigd |
| `oneuptime.data.table.overdue_seconds` | Seconden dat de tabel voorbij het tijdstip is waarop ze gewoonlijk is gewijzigd; 0 zolang ze op tijd is |
| `oneuptime.data.table.row_count_change_percent` | Hoeveel het aantal rijen sinds de vorige verzamelronde is veranderd, in procenten |
| `oneuptime.data.table.schema_changes` | Kolommen die sinds de vorige verzamelronde zijn gewijzigd |
| `oneuptime.data.table.breaking_schema_changes` | Kolommen die sinds de vorige verzamelronde zijn verwijderd, hernoemd of van type veranderd |

Elke rij heeft `oneuptime.data.store.id`, `oneuptime.data.store.name`, `oneuptime.data.table.id`, `oneuptime.data.table.schema`, `oneuptime.data.table.name` en `oneuptime.data.table.key` (`schema.table`). Een [metrics-monitor](/docs/monitor/metrics-monitor) gegroepeerd op `oneuptime.data.table.key` waarschuwt één keer per tabel, en zijn filters **Afwijkend hoog** en **Afwijkend laag** vergelijken elke tabel met haar eigen gebruikelijke waarde voor dat uur van de week. Deze metrieken zijn de eigen operationele gegevens van OneUptime en worden niet als telemetrie gefactureerd.

## Ongebruikte tabellen

Elke engine die leesacties telt, zegt wanneer elke tabel voor het laatst is gelezen: de scans van PostgreSQL, het performance_schema van MySQL, de seeks, scans en lookups van SQL Server, en de querygeschiedenis van Redshift, ClickHouse en Databricks. Een leesactie die in de databasespans van je services is gezien, telt ook mee.

**Ongebruikte tabellen** toont de tabellen die 90 dagen door niemand zijn gelezen, de grootste eerst, met wanneer er voor het laatst naar elke tabel is geschreven: een tabel waarnaar nog wordt geschreven maar die nooit wordt gelezen, kost haar schrijfacties en haar opslag. Een teller van 0 bij de eerste verzamelronde van een tabel betekent dat ze niet is gelezen sinds de statistieken van de engine begonnen, dus een ongebruikte tabel wordt vanaf het begin als ongebruikt getoond.

## Warehouse-uitgaven

Elk uur leest Data-observability wat elke Snowflake- en BigQuery-warehouse de afgelopen dag heeft uitgegeven, job voor job: de compute-credits van Snowflake, uit `QUERY_ATTRIBUTION_HISTORY`, en de gefactureerde bytes van BigQuery, uit de jobsweergave, waarvoor **BigQuery Resource Viewer** nodig is. Een job is één query die steeds opnieuw draait, genoemd naar zijn query-tag of label, of naar wat hij doet en de tabel die hij schrijft: nooit naar de tekst van de query.

**Warehouse-uitgaven** toont de totalen per team (het `team` in de query-tag of het label van een job, anders wie hem uitvoert), de tabellen waarvan het schrijven het meest kost, de mislukte jobs en wat er gaat naar jobs die alleen tabellen schrijven die al 90 dagen niemand heeft gelezen.

## Services die elke tabel gebruiken

Het tabblad **Services** van een tabel toont de services waarvan is gezien dat ze naar de tabel schrijven of eruit lezen, met de statements die elke service uitvoerde, haar aanroepen en fouten in het laatste uur, en wanneer ze voor het laatst is gezien. Het komt uit de databasespans die je services al met OpenTelemetry versturen: een clientspan met `db.system.name`, `db.namespace` en `db.collection.name`. Er hoeft niets extra te worden geïnstalleerd.

Een span wordt alleen aan een tabel gekoppeld wanneer zijn database er een is die een verzamelronde heeft gelezen, en wanneer twee databases dezelfde naam hebben, alleen wanneer zijn `server.address` een van de hunne is.

Elke service toont ook de endpoints die haar aanroepen doen, uit de serverspan in dezelfde trace, en is gemarkeerd als **AI-app** wanneer ze ook een model aanroept. **Fouten die deze tabel noemen** toont de openstaande excepties en de foutlogboeken van de laatste dag van de services die naar de tabel schrijven, wanneer ze die bij naam noemen.

## Eigenaren en labels

Het tabblad **Eigenaren** van een tabel noemt de mensen en teams waartoe ze behoort, en de waarschuwing van een tabel gaat naar hen; zonder eigenaren naar de eigenaren van haar database. Geef een tabel op haar **Instellingen** eigen **Labels**.

Je zou dit niet honderden keren moeten hoeven doen. **Eigenaarsregels** en **Labelregels** gelden voor elke tabel zodra ze voor het eerst verschijnt, gekoppeld op haar labels, of op een reguliere expressie op haar naam, schema of database: alles in `finance` gaat naar het financeteam, en alles met de naam `*_pii` krijgt een label.

Een machtiging beperkt tot `Owned` bereikt alleen de tabellen waarvan de houder of diens teams eigenaar zijn, met hun controles, activiteit en gemelde problemen. Eigenaar zijn van een database maakt je geen eigenaar van de tabellen: gebruik een eigenaarsregel om een hele database aan een team te geven.

## Wanneer een waarschuwing opent

De waarschuwing van een tabel heeft een kaart **Gegevens** die zegt waarom het waarschijnlijk is gebeurd, gerangschikt: een waarschuwing stroomopwaarts, een mislukte uitvoering, een deploy van een service die ernaar schrijft, haar mislukte schrijfacties, een kolom die is gewijzigd, de database zelf of de server waarop ze draait. Daaronder staat wat ervan afhangt: tabellen verderop in haar herkomst, dashboards, services en de mensen die ze beheren.

Zeg wat je ervan vond:

- **Useful**: het klopte.
- **Expected**: een gepland evenement. Er verandert niets, en de volgende wordt ook gemeld.
- **Geen probleem**: de tabel krijgt meer ruimte, zodat hetzelfde de volgende keer stil blijft. Het gebruikelijke interval van een te late tabel groeit, en de tolerantie van een aantal rijen wordt ruimer.

Als een persoon eerder een probleem vindt, legt **Een probleem melden** op de tabel het vast. **Overzicht** toont dan hoe Data-observability het voor je project doet: nuttige problemen per week, hoeveel er geen ruis waren, hoeveel tabellen worden gelezen, hoe vaak het een probleem meldde voordat iemand het meldde, hoe snel, en hoe vaak de waarschijnlijke oorzaak de echte was.

## Volgende stappen

:::cards
- [Controles en reconciliaties](/docs/data-observability/checks): Regels voor wat een tabel bevat, verder dan of ze verandert.
- [Lineage en pipelines](/docs/data-observability/lineage-and-pipelines): Waar de gegevens van een te late tabel vandaan komen, en de uitvoering die haar had moeten laden.
:::

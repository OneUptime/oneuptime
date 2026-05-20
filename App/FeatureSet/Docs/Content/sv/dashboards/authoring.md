# Skapa en instrumentpanel

Skapa en instrumentpanel under **Dashboards → Create Dashboard**, ge den ett namn och öppna den. Arbetsytan öppnas i **Edit**-läge, redo för widgetar.

## Arbetsytan

En instrumentpanel är ett rutnät. Standardarbetsytan är **12 dashboard-enheter bred** gånger **60 enheter hög** — du kan utöka höjden genom att lägga till rader förbi botten. Varje enhet är en kvadrat som skalas med visningsporten: på en stationär dator är den bredare än på en telefon, men varje widget behåller sina proportioner.

Widgetar upptar en rektangel av enheter. Du bestämmer både positionen (övre vänstra hörnet, mätt i enheter från arbetsytans övre vänstra hörn) och storleken (bredd och höjd i enheter). Minsta dimensioner upprätthåller att en liten widget fortfarande är läsbar.

## Edit vs. View

Växeln i sidhuvudet växlar mellan de två lägena:

- **Edit** — widget-paletten är öppen, widgetar är dragbara och storleksändringsbara, varje widget har ett inställningskugghjul. Använd det här medan du bygger.
- **View** — instrumentpanelen renderas skrivskyddad, exakt som någon med endast-läs-åtkomst (eller en offentlig besökare) ser den. Använd det här för att kontrollera resultatet innan du delar.

Samma instrumentpanel visas i båda lägena — det finns inget separat "publicera"-steg. Att spara en redigering träder i kraft omedelbart för varje tittare.

## Lägga till en widget

1. Öppna widget-paletten (knappen **+** i Edit-läge).
2. Välj widget-typen. Se [Widgetar](/docs/dashboards/widgets) för katalogen.
3. Widgeten landar på arbetsytan vid nästa lediga position med en standardstorlek.
4. Klicka på widgetens kugghjul för att öppna dess inställningspanel.
5. Konfigurera datakällan (metric-fråga, listfilter, textkropp, etc.) och eventuella visningsalternativ (trösklar, enheter, axlar, kolumner).
6. Dra widgeten för att positionera den. Dra ett hörn för att ändra storlek.

Upprepa. Rutnätet fäster widgetar mot helenhetsgränser.

## Konfigurera datakällor

De flesta widgetar läser från en av tre platser:

- **Mätvärden** — en ClickHouse-uppbackad metric-fråga. Widgeten bygger en `metricQueryConfig` (en enskild serie) eller `metricQueryConfigs` (flera serier staplade eller överlagrade). Valfri `transformAsRate` konverterar en kumulativ OpenTelemetry-räknare till en förändringstakt. Valfri `formula` låter dig kombinera två frågor (t.ex. felantal / totalt antal).
- **Live-resurslistor** — incidenter, larm, monitorer, Kubernetes-resurser, Docker-resurser, värdar. Varje listwidget tar ett filter (t.ex. etiketter, status, namespace) och visar de matchande raderna live.
- **Statiskt innehåll** — **Text**-widgeten tar en Markdown-kropp. Använd den för rubriker, avdelare, runbook-länkar och "vad är denna instrumentpanel?"-annotationer.

För metric-widgetar speglar konfigurationen den inbäddade frågebyggaren du ser på andra ställen i OneUptime — välj ett mätvärde, välj en aggregering, lägg till `WHERE`-filter, välj en tidsgruppering. Frågan körs mot ditt projekts telemetridata.

## Trösklar och formatering

Widgetar som visar ett enskilt nummer (**Value**, **Gauge**) tar valfria trösklar:

- **Varningströskel** — rendera värdet i gult när det överskrider denna.
- **Kritisk tröskel** — rendera värdet i rött när det överskrider denna.

Diagram låter dig sätta Y-axelns enhet, legendpositionen och om serier ska staplas. Tabeller låter dig välja vilka kolumner som ska visas och radgränsen.

## Tidsintervall och uppdatering

Instrumentpanelens sidhuvud bär två globala kontroller som påverkar varje metric-widget:

- **Tidsintervall** — välj en förinställning (Senaste 1 timme, 24 timmar, 7 dagar, 30 dagar) eller ett anpassat intervall. Varje metric-widget frågar mot detta fönster.
- **Uppdateringsintervall** — Av, 5s, 10s, 30s, 1m, 5m, 15m. Kör om varje widgets fråga i den valda takten. Listwidgetar som inbyggt stöder websockets uppdateras vid push oavsett valt intervall.

För widgetar som ignorerar det globala tidsintervallet (t.ex. ett textblock) är kontrollen en no-op.

## Spara

Arbetsytan autosparar medan du redigerar. En liten indikator i sidhuvudet talar om när den senaste ändringen är sparad. Det finns ingen "publicera" — varje redigering är live i samma stund som den sparas. Om du gör en riskabel ändring, duplicera instrumentpanelen först.

## Mönster som fungerar bra

- **Ett ämne per instrumentpanel.** Motstå frestelsen att lägga "allt vi övervakar" på en sida. Tre instrumentpaneler etiketterade `oncall-checkout`, `oncall-payments`, `oncall-search` åldras bättre än en mega-instrumentpanel.
- **Förankra sidans topp med den viktigaste widgeten.** Folk skannar uppifrån — se till att det första de ser är svaret på "är det här systemet hälsosamt?"
- **Använd Text-widgetar för att etikettera sektioner.** En kort rubrik var några rader ("Latens" / "Fel" / "Kapacitet") gör instrumentpanelen scanbar från andra sidan rummet.
- **Använd variabler istället för att duplicera.** Om du märker att du bygger samma instrumentpanel två gånger för två tjänster vill du ha en `service`-variabel. Se [Variabler & filter](/docs/dashboards/variables).

## Var läsa vidare

- [Widgetar](/docs/dashboards/widgets) — katalogen och konfiguration per widget.
- [Variabler & filter](/docs/dashboards/variables) — mallning med variabler, attributfilter och tidsintervall.
- [Delning & offentliga instrumentpaneler](/docs/dashboards/sharing) — göra en instrumentpanel nåbar utanför teamet.
- [Konfiguration & behörigheter](/docs/dashboards/configuration) — ägarskap och åtkomstkontroll.

# Skapa en instrumentpanel

För att skapa en instrumentpanel, öppna **Dashboards → Create Dashboard**, ge den ett namn och öppna den. Arbetsytan öppnas i **Edit**-läge, redo för dig att börja lägga till widgetar.

## Arbetsytan

En instrumentpanel är ett rutnät. Widgetar fäster på plats — du bestämmer var var och en sitter och hur stor den är. Du kan utöka sidan nedåt allteftersom du lägger till fler rader. Varje widget behåller sina proportioner på större eller mindre skärmar.

## Edit och View

Växeln i sidhuvudet växlar mellan två lägen:

- **Edit** — widget-paletten är öppen, du kan dra runt widgetar, ändra storlek på dem och klicka på vilken widget som helst för att ändra dess inställningar.
- **View** — instrumentpanelen är skrivskyddad, exakt så som besökare och andra teammedlemmar ser den. Använd det här för att kontrollera resultatet innan du delar.

Det är samma instrumentpanel i båda lägena. Det finns inget separat "publicera"-steg — varje redigering är live i samma stund den sparas.

## Lägga till en widget

1. Klicka på **+**-knappen för att öppna widget-paletten.
2. Välj widget-typ. Se [Widgetar](/docs/dashboards/widgets) för katalogen.
3. Widgeten dyker upp på arbetsytan.
4. Klicka på kugghjulsikonen på widgeten för att öppna dess inställningar.
5. Välj datakällan (ett mätvärde, ett listfilter, ett textstycke osv.) och eventuella visningsalternativ.
6. Dra widgeten för att flytta den. Dra ett hörn för att ändra storlek.

## Var data kommer ifrån

De flesta widgetar läser från en av tre platser:

- **Mätvärden** — välj ett mätvärde och en aggregering (medel, max, antal, percentil). Lägg till filter. Välj hur resultatet ska grupperas. Det är samma frågebyggare som du ser på andra ställen i OneUptime.
- **Liveslistor** — incidenter, larm, monitorer, Kubernetes-poddar, Docker-containers, värdar. Varje listwidget tar ett filter och visar matchande objekt, uppdaterade live.
- **Statiskt innehåll** — **Text**-widgeten tar ett block med Markdown. Använd det för rubriker, sammanhang, länkar till runbooks eller tillfälliga anteckningar under en incident.

## Tröskelvärden och formatering

Widgetar med enskilda värden (**Value**, **Gauge**) låter dig ställa in:

- Ett **varningströskelvärde** — färgen blir gul när värdet passerar det.
- Ett **kritiskt tröskelvärde** — färgen blir röd när värdet passerar det.

Diagram låter dig ställa in Y-axelns enhet, välja var teckenförklaringen ska placeras och välja om serierna ska staplas på varandra eller överlagras. Tabeller låter dig välja vilka kolumner som ska visas och hur många rader.

## Tidsintervall och uppdatering

Högst upp på instrumentpanelen påverkar två kontroller varje mätvärdeswidget:

- **Tidsintervall** — en förinställning (senaste timmen, 24 timmar, 7 dagar, 30 dagar) eller ett anpassat intervall. Varje diagram och siffra använder detta fönster.
- **Uppdatering** — hur ofta widgetar frågar om data. Av, 5s, 10s, 30s, 1m, 5m, 15m. Liveslistor uppdateras på egen hand oavsett denna inställning.

Widgetar som inte använder tidsintervallet (som en Text-widget) ignorerar båda kontrollerna.

## Spara

Arbetsytan sparar på egen hand medan du arbetar. En liten indikator i sidhuvudet talar om för dig när den senaste ändringen är sparad. Om du gör en stor ändring, duplicera instrumentpanelen först så att du har en säker kopia.

## Tips för instrumentpaneler som åldras väl

- **Ett ämne per instrumentpanel.** Motstå frestelsen att lägga "allt vi övervakar" på en sida. Några fokuserade instrumentpaneler slår en gigantisk sida.
- **Sätt den viktigaste widgeten högst upp.** Folk skannar uppifrån och ner — gör det första de ser till svaret på "är det här systemet friskt?"
- **Märk sektioner med Text-widgetar.** En kort rubrik var några rader ("Latens," "Fel," "Kapacitet") gör sidan skanbar från andra sidan rummet.
- **Använd variabler istället för att duplicera.** Om du ska bygga samma instrumentpanel för en andra tjänst, bygg en instrumentpanel med en `service`-variabel istället. Se [Variabler & filter](/docs/dashboards/variables).

## Läs vidare

- [Widgetar](/docs/dashboards/widgets) — katalogen.
- [Variabler & filter](/docs/dashboards/variables) — variabler, filter och tidsintervallet.
- [Delning & offentliga instrumentpaneler](/docs/dashboards/sharing) — dela utanför ditt team.
- [Konfiguration & behörigheter](/docs/dashboards/configuration) — ägare och åtkomstkontroll.

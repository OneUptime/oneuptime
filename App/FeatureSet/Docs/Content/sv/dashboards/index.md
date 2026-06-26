# Översikt över instrumentpaneler

Instrumentpaneler förvandlar den data som OneUptime redan samlar in — mätvärden, loggar, traces, incidenter, monitorer, Kubernetes-resurser, värdar — till en enda sida som någon kan kasta en blick på och förstå vad som händer.

Placera ett diagram för request-latens bredvid en lista över öppna incidenter, bredvid en mätare för CPU, bredvid ett textstycke med sammanhang. Spara. Dela länken.

## Vad instrumentpaneler är bra för

- **En "är allt OK?"-sida** — för jouren, en team-standup eller en vägghängd TV.
- **Upptäcka samband** — en CPU-topp samtidigt som en latensökning och en öppen incident är mycket lättare att se på en sida än över tre flikar.
- **Felsökning** — när du felsöker slår en instrumentpanel som du bygger på direkten tio frågor som körs en i taget.
- **Dela externt** — en kundvänd prestandasida, en partnerstatussida, en offentlig instrumentpanel för ett öppen källkod-projekt.

## Vad du kan lägga på en instrumentpanel

- **Diagram** för trender över tid — latens, fel, genomflöde.
- **Enskilda värdesrutor och mätare** — aktuell felfrekvens, CPU, öppna incidenter.
- **Tabeller** för uppdelningar — topp 10 mest pratiga värdar, antal fel per tjänst.
- **Textblock** för rubriker, sammanhang och länkar till runbooks.
- **Liveslistor** över incidenter, larm, monitorer, loggar, traces, Kubernetes-resurser, Docker-resurser och värdar.

Se [Widgetar](/docs/dashboards/widgets) för hela listan och vad var och en visar.

## Nyckelbegrepp

| Term                | Betydelse                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| **Instrumentpanel** | Hela sidan — ett namn, ett rutnät av widgetar, kontroller för tidsintervall och en lista med variabler. |
| **Widget**          | En ruta på sidan — ett diagram, en siffra, en lista, ett stycke.                                        |
| **Variabel**        | En rullgardinsmeny högst upp som filtrerar varje widget på en gång (kluster, tjänst, kund, miljö).      |
| **Tidsintervall**   | Tidsfönstret som varje diagram och siffra använder. Ställs in en gång högst upp på sidan.               |
| **Uppdatering**     | Hur ofta widgetar frågar om data. Av, var några sekund, var några minut.                                |
| **Läge**            | Antingen **Edit** (dra runt widgetar) eller **View** (skrivskyddat, så som besökare ser det).           |

## Var hittar du instrumentpaneler

Öppna **Dashboards** i den vänstra navigeringen.

| Sida                     | Vad du gör där                                                                 |
| ------------------------ | ------------------------------------------------------------------------------ |
| **Dashboards**           | Din lista över instrumentpaneler. Skapa en ny, sök, eller filtrera på etikett. |
| **Dashboard → View**     | Arbetsytan. Växla mellan **Edit** och **View** i sidhuvudet.                   |
| **Dashboard → Overview** | Beskrivning, ägare och etiketter.                                              |
| **Dashboard → Settings** | Offentlig delning, lösenord, IP-tillåtslista, anpassad domän, varumärke.       |
| **Dashboard → Owners**   | Användare och team med explicit åtkomst.                                       |
| **Dashboard → Delete**   | Ta bort instrumentpanelen.                                                     |

## Bygga en instrumentpanel

1. **Skapa** — välj ett namn. Arbetsytan öppnas tom.
2. **Lägg till widgetar** — välj en widget-typ, konfigurera dess data, dra den dit du vill.
3. **(Valfritt) Lägg till variabler** — till exempel en `service`-rullgardinsmeny så att samma instrumentpanel fungerar för varje tjänst.
4. **Ställ in tidsintervallet** — standardvärden är bra; finjustera senare.
5. **(Valfritt) Dela offentligt** — slå på växeln i Settings, lägg till ett lösenord eller IP-tillåtslista om det behövs.
6. **(Valfritt) Anpassad domän** — hosta instrumentpanelen på `status.your-domain.com`.

## Ett snabbt exempel

Mål: en jour-sida för checkout-tjänsten med latens, felfrekvens, öppna incidenter och en livelogg.

1. Skapa en instrumentpanel som heter "Checkout on-call."
2. Lägg till en `service`-variabel. Sätt standardvärdet till `checkout`.
3. Lägg till en **Chart**-widget med P95-latens, filtrerad efter `service`-variabeln.
4. Bredvid den, lägg till en **Value**-widget för felfrekvens, med varning vid 1 % och kritisk vid 5 %.
5. Nedanför, lägg till en **Incident List**-widget för incidenter taggade med `checkout`.
6. Under det, en **Log Stream**-widget som visar loggar från samma tjänst.
7. Spara. Byt rullgardinsmenyn till `payments` — samma instrumentpanel visar nu payments-tjänsten.

## Hur instrumentpaneler passar in med resten av OneUptime

- **Monitorer och telemetri** är datakällorna. Varje mätvärde, logg och trace du samlar in kan frågas av en widget.
- **Incidenter och larm** visas i widgetarna **Incident List** och **Alert List**. Instrumentpaneler är skrivskyddade för dessa — skapa och uppdatera dem på annat håll.
- **Statussidor** är kundvänd kommunikation ("är systemet uppe?"). Instrumentpaneler är till för att titta på i detalj hur systemet beter sig. De två fungerar tillsammans, de ersätter inte varandra.
- **Arbetsflöden** är hur OneUptime vidtar åtgärder. Instrumentpaneler är hur du läser av vad som händer.

## Läs vidare

- [Skapa en instrumentpanel](/docs/dashboards/authoring) — använda arbetsytan, redigera widgetar.
- [Widgetar](/docs/dashboards/widgets) — hela listan med widgetar.
- [Variabler & filter](/docs/dashboards/variables) — få en instrumentpanel att fungera för många tjänster eller kunder.
- [Delning & offentliga instrumentpaneler](/docs/dashboards/sharing) — offentliga URL:er, lösenord, IP-tillåtslista, anpassade domäner.
- [Konfiguration & behörigheter](/docs/dashboards/configuration) — ägare, etiketter, åtkomstkontroll.

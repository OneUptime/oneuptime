# Översikt över instrumentpaneler

Instrumentpaneler är hur du förvandlar den telemetri som OneUptime redan samlar in — mätvärden, loggar, traces, incidenter, monitorer, Kubernetes- och Docker-resurser — till en enda sida som någon kan kasta en blick på och förstå hälsan i ett system.

Släpp ett diagram för request-latens bredvid en lista med öppna incidenter bredvid en mätare för CPU-utnyttjande bredvid en statusmening på vanlig svenska. Spara. Dela länken.

## I korthet

- **Toppnivåfunktion** i OneUptime-dashboarden under **Dashboards**.
- **Rutnätsbaserad arbetsyta** — 12 enheter brett gånger 60 enheter högt som standard. Dra in widgetar, ändra storlek på dem, fäst dem mot rutnätet.
- **20+ widget-typer** — diagram, enskilda värden, mätare, tabeller, textblock, loggströmmar, trace-listor och live-resurslistor för incidenter, larm, monitorer, Kubernetes (poddar, noder, deploys, …), Docker och värdar.
- **Variabler och filter** — förvandla en enskild instrumentpanel till en mallad vy som återanvänds för varje kluster, tjänst, kund eller miljö.
- **Offentlig delning** — slå på en växel och instrumentpanelen är nåbar på en offentlig URL, med valfritt lösenordsskydd och IP-tillåtslistning.
- **Anpassade domäner** — hosta en offentlig instrumentpanel på `status.your-domain.com` istället för OneUptimes.

## Varför använda instrumentpaneler?

Instrumentpaneler förtjänar sin plats när något av detta stämmer:

- **Du behöver en "är allt OK?"-sida** för en jourrotation, en team-standup eller en VD som går förbi vägg-TV:n.
- **Du behöver korrelera signaler** — en CPU-topp samma minut som en trace-latensökning och en öppen incident är mycket mer uppenbart på en instrumentpanel än över tre flikar.
- **Du undersöker** — en frilagd instrumentpanel du bygger under en felsökningssession är snabbare än att köra tio frågor för hand.
- **Du publicerar externt** — en kundvänd prestandainstrumentpanel, en partnervänd sammanställning, en offentlig hälsotavla för en öppen källkodstjänst.

## Nyckelbegrepp

| Term | Betydelse |
| --- | --- |
| **Instrumentpanel** | Arbetsytan. En namngiven, återanvändbar vy som innehåller en lista med widgetar, en tidsintervallskontroll och en uppsättning variabler. |
| **Widget** | En komponent på arbetsytan — ett diagram, ett värde, en tabell, ett textblock, en lista. Var och en har en typ och en JSON-stilskonfiguration. |
| **Dashboard-enhet** | Rutans ruta. Widgetar storlekssätts i dashboard-enheter (t.ex. "4 bred × 6 hög"). Enheter konverteras till pixlar baserat på visningsporten. |
| **Variabel** | Ett namngivet värde som tittaren väljer från en rullgardinsmeny (eller skriver) och som instrumentpanelen injicerar i varje widgets fråga. Kluster, tjänst, kund, miljö — vad som helst du skulle filtrera på. |
| **Tidsintervall** | Tidsfönstret som varje widget frågar mot. Välj en förinställning ("senaste 24 timmarna") eller ett anpassat intervall. |
| **Uppdateringsintervall** | Hur ofta widgetar omfrågas i **View**-läge. Av, 5s, 10s, 30s, 1m, 5m, 15m. |
| **Läge** | `Edit` (dra, ändra storlek, konfigurera) eller `View` (skrivskyddad). De två delar samma arbetsyta. |

## Widget-katalogen

En icke uttömmande karta över vad du kan lägga på en instrumentpanel:

| Kategori | Widgetar |
| --- | --- |
| **Tidsserier** | Chart |
| **Enskilt nummer** | Value, Gauge |
| **Tabellformat** | Table |
| **Annotation** | Text |
| **Loggar & traces** | LogStream, TraceList |
| **Driftslistor** | IncidentList, AlertList, MonitorList |
| **Kubernetes** | KubernetesPodList, KubernetesNodeList, KubernetesNamespaceList, KubernetesDeploymentList, KubernetesStatefulSetList, KubernetesDaemonSetList, KubernetesJobList, KubernetesCronJobList |
| **Docker** | DockerHostList, DockerContainerList, DockerImageList, DockerNetworkList, DockerVolumeList |
| **Infrastruktur** | HostList |

För argumenten för var och en och när du ska gripa efter den, se [Widgetar](/docs/dashboards/widgets).

## Var instrumentpaneler bor i dashboarden

| Sida | Vad du gör där |
| --- | --- |
| **Dashboards** | Bläddra, skapa, sök, etikettera instrumentpaneler. |
| **En instrumentpanel → View** | Arbetsytan — Edit-läge för författare, View-läge för alla andra. Växla mellan dem i sidhuvudet. |
| **En instrumentpanel → Overview** | Beskrivning, ägarskap, etiketter. |
| **En instrumentpanel → Settings** | Offentlig delning, masterlösenord, IP-tillåtslista, anpassade domäner, varumärkning (sidtitel, beskrivning, logotyp, favicon). |
| **En instrumentpanel → Owners** | Användare och team med explicit ägarskap. |
| **En instrumentpanel → Delete** | Ta bort instrumentpanelen (oåterkalleligt). |

## En instrumentpanels livscykel

1. **Skapa** — Under **Dashboards → Create Dashboard**, ge den ett namn. Arbetsytan öppnas tom.
2. **Släpp in widgetar** — Från widget-paletten, välj en typ, konfigurera dess källa (en metric-fråga, ett listfilter, en fritextkropp). Positionera och ändra storlek.
3. **(Valfritt) Lägg till variabler** — Definiera en rullgardinsmeny som `cluster` eller `service` så att samma instrumentpanel renderas för varje värde.
4. **Sätt tidsintervall och uppdateringsintervall** — Standardvärdena fungerar bra; finjustera dem senare.
5. **(Valfritt) Dela offentligt** — Under **Settings**, slå på **Public Dashboard**. Lägg till ett masterlösenord om du vill ha en grind, eller begränsa efter IP.
6. **(Valfritt) Anpassad domän** — Lägg till en `dashboard.your-domain.com`-post och verifiera DNS, och servera sedan instrumentpanelen på din egen URL.

## Ett genomarbetat exempel

Mål: en jour-sida för checkout-tjänsten med latens, felfrekvens, öppna incidenter och en nyligen loggsvans.

1. Skapa en instrumentpanel "Checkout oncall."
2. Lägg till en `service`-variabel av typen **Telemetry Attribute** bunden till attributnyckeln `service.name`. Standardvärde `checkout`.
3. Lägg till en **Chart**-widget: P95-latens från ditt APM-mätvärde, filtrerad efter `service.name = {{service}}`. Tidsintervall följer instrumentpanelen.
4. Bredvid den, lägg till en **Value**-widget: felfrekvens i procent med en varningströskel på 1% och en kritisk tröskel på 5%.
5. Nedanför, lägg till en **IncidentList**-widget filtrerad efter etiketter som inkluderar `checkout`.
6. Under det, en **LogStream**-widget filtrerad efter `service.name = {{service}}`.
7. Spara. Ändra variabel-rullgardinsmenyn till `payments` — hela instrumentpanelen renderas om för payments-tjänsten. Samma mall, annat filter.

## Hur instrumentpaneler passar in med resten av OneUptime

- **Monitorer och telemetri** matar instrumentpaneler med rådata — varje mätvärde du har konfigurerat, varje loggrad du har tagit in, varje trace-span är frågbar på en widget.
- **Incidenter och larm** dyker upp i **IncidentList**- och **AlertList**-widgetar — instrumentpaneler är skrivskyddade vyer över dem; skapa/redigera dessa entiteter på annat håll.
- **Statussidor** är ett kundvänt kommunikationsverktyg ("är systemet uppe just nu?"). Instrumentpaneler är ett analytiskt verktyg ("hur beter sig systemet i detalj?"). De två kompletterar varandra, inte ersätter.
- **Arbetsflöden** är skrivsidan av OneUptime — instrumentpaneler är läs-sidan.

## Var läsa vidare

- [Skapa en instrumentpanel](/docs/dashboards/authoring) — använd arbetsytan, rutnätet, edit-läge vs. view-läge.
- [Widgetar](/docs/dashboards/widgets) — katalogen och konfiguration per widget.
- [Variabler & filter](/docs/dashboards/variables) — malla en instrumentpanel så att den fungerar för många tjänster / kunder / kluster.
- [Delning & offentliga instrumentpaneler](/docs/dashboards/sharing) — offentliga URL:er, masterlösenord, IP-tillåtslista, anpassade domäner.
- [Konfiguration & behörigheter](/docs/dashboards/configuration) — ägarskap, etiketter, retention, rollbaserad åtkomst.

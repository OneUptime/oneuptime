# Widgetar

En widget är en ruta på en instrumentpanel. Den här sidan listar varje widget du kan lägga till, vad den visar och när du ska gripa efter den.

För hur du drar runt widgetar på arbetsytan, se [Skapa en instrumentpanel](/docs/dashboards/authoring).

## Diagram och siffror

### Chart

Ett linje-, stapel- eller areadiagram över en eller flera mätvärdesserier över instrumentpanelens tidsintervall.

**Inställningar**:

- En eller flera mätvärdesfrågor.
- En valfri formel som kombinerar två frågor (till exempel `errors / total * 100` för att få en felfrekvens).
- Ett "visa som hastighet"-alternativ för kumulativa räknare som växer utan att nollställas.
- Visningsalternativ: staplat eller överlagrat, Y-axelns enhet, teckenförklaringens position, diagramtyp.

Använd den när: trender spelar roll. Latens över tid, antal fel, ködjup, allt där linjens form berättar historien.

### Value

En enda stor siffra med valfria färgade tröskelvärden.

**Inställningar**:

- En mätvärdesfråga som ger tillbaka ett tal (senaste värdet, medel eller max över tidsintervallet).
- Ett valfritt **varningströskelvärde** (gul över).
- Ett valfritt **kritiskt tröskelvärde** (röd över).
- Talformat och enhet.

Använd den när: en siffra besvarar frågan. Aktuell felfrekvens, P95-latens just nu, antal öppna incidenter.

### Gauge

En cirkulär mätare med ett minimum, maximum, varningsband och kritiskt band.

**Inställningar**: en mätvärdesfråga och de fyra gränserna.

Använd den när: värdet ryms inom ett känt intervall. CPU-procent (0–100 %), diskanvändning, kökapacitet.

### Table

En tabell över mätvärdesresultat, en rad per grupp.

**Inställningar**: en mätvärdesfråga (vanligtvis grupperad efter en etikett som värd eller tjänst), kolumnerna som ska visas och en radgräns.

Använd den när: du vill ha en uppdelning istället för en trend. Topp 10 mest pratiga värdar, antal fel per tjänst, förfrågningar per endpoint.

## Text

Ett statiskt block med Markdown.

**Inställningar**: Markdown-bodyn. Rubriker, listor, länkar, betoning och kodblock renderas alla.

Använd den när: du vill ha en sektionsrubrik, ett stycke sammanhang, en lista med länkar till runbooks eller en tillfällig banner under en incident.

## HTML

Din egen HTML, CSS och JavaScript, renderad som en widget.

**Inställningar**: HTML-bodyn, en valfri stilmall, ett valfritt skript och tre behörighetsreglage.

Använd den när: du behöver något som ingen inbyggd widget täcker — en inbäddad badge från tredje part, en tabell hämtad från ett internt API, en egen teckenförklaring, en uppsättning stilsatta länkar in i dina egna verktyg.

### Vad den kan och inte kan göra

Widgeten renderas i en sandlådeisolerad ram på ett eget isolerat ursprung (origin). Inne i den ramen kan din kod göra i stort sett vad som helst: bygga DOM, köra timers, hämta från vilken URL som helst, rita på en canvas.

Vad den inte kan göra är att nå OneUptime-sidan runt omkring. Den har ingen åtkomst till instrumentpanelens DOM, cookies, lokal lagring eller API-session, och den kan inte navigera bort webbläsarfliken. Det gäller oavsett om instrumentpanelen är privat eller delas offentligt.

Två konsekvenser värda att känna till innan du klistrar in något:

- En `fetch` från widgeten är en cross-origin-förfrågan från ett opakt ursprung, så servern du anropar måste tillåta den med CORS. Att anropa OneUptimes API härifrån stöds inte.
- Widgeten börjar transparent. Sätt en bakgrund på `body` i din CSS om du vill att den ska fylla kortet.

### Använda instrumentpanelsvariabler

Skriv `{{variableName}}` var som helst i HTML, CSS eller JavaScript så ersätts det med variabelns aktuella värde innan widgeten renderas. Att välja ett nytt värde renderar om widgeten. En platshållare som namnger en variabel som inte finns lämnas som den är.

Skript får samma värden, plus instrumentpanelens tidsintervall, på `window.ONEUPTIME`:

```javascript
window.ONEUPTIME.variables.environment; // aktuellt värde, eller "" om det inte är satt
window.ONEUPTIME.startDate; // ISO 8601-sträng, början på instrumentpanelens tidsintervall
window.ONEUPTIME.endDate; // ISO 8601-sträng, slutet på det
```

Widgeten laddas om varje gång instrumentpanelen uppdateras, så en widget som hämtar sina egna data håller jämna steg med uppdateringsintervallet.

### Behörigheter

**Run JavaScript** (kör JavaScript, på som standard) kör ditt skript. Stäng av den för att bara rendera markup och stilar — skriptet utelämnas då helt från widgeten snarare än att bara blockeras.

**Open links in a new tab** (öppna länkar i en ny flik, på som standard) låter länkar och `window.open` öppna en webbläsarflik. Länkar öppnas alltid i en ny flik; widgeten kan aldrig navigera instrumentpanelen själv.

**Allow forms to submit** (tillåt formulär att skickas, av som standard) låter ett `<form>` inuti widgeten skickas.

Alla som kan redigera instrumentpanelen bestämmer vad den här widgeten kör, och alla som visar instrumentpanelen kör den — på en offentlig instrumentpanel inkluderar det anonyma besökare. Behandla redigeringsåtkomst till en instrumentpanel som bär på en HTML-widget på samma sätt som du skulle behandla åtkomst till vilken annan kod du levererar som helst.

## Loggar och traces

### Log Chart

Ett tidsseriediagram över loggvolymen under instrumentpanelens tidsintervall. Varje serie står för en allvarlighetsgrad, så feltoppar sticker ut från normal trafik.

**Inställningar**:

- Visualisering som stapel-, linje- eller ytdiagram. Stapel- och ytdiagram staplar allvarlighetsserierna.
- Valfria filter på allvarlighetsgrad.
- Valfri textsökning i loggtexten.
- Exakta OpenTelemetry-attributfilter via sökbara nyckel/värde-rader. Attributnamn och kända värden föreslås medan du skriver, och egna värden stöds fortfarande.
- En valfri titel.

Instrumentpanelens kontroller för tidsintervall och uppdatering kör om frågan för diagrammet automatiskt. Instrumentpanelens telemetriattribut-variabler gäller också för det, inklusive variabler med flerval.

Log Chart kräver för närvarande en inloggad instrumentpanel. Offentliga instrumentpaneler visar widgeten som otillgänglig i stället för att anonymt exponera projektets loggaggregat.

Använd den när: du vill upptäcka förändringar i loggvolymen eller jämföra fel, varningar och informationsloggar utan att lämna instrumentpanelen.

### Log Stream

Ett liveflöde av loggrader som matchar ett filter.

**Inställningar**: loggfilter (tjänst, allvarlighetsgrad, attribut) och kolumnerna som ska visas.

Använd den när: du vill se vad applikationen säger just nu, utan att lämna instrumentpanelen.

### Trace List

En lista över senaste traces som matchar ett filter, med tidsåtgång, status och tjänst.

**Inställningar**: trace-filter (tjänst, status, attribut).

Använd den när: du vill ha en lista över senaste aktivitet snarare än ett diagram. Ett vanligt mönster är ett latensdiagram högst upp med en lista över långsamma traces nedanför.

## Liveslistor

### Incident List

En liveslista över incidenter som matchar ett filter.

**Inställningar**: filter efter tillstånd, allvarlighetsgrad, etiketter, monitor eller team.

Använd den när: instrumentpanelen besvarar "vad är trasigt just nu?"

### Alert List

En liveslista över larm som matchar ett filter.

**Inställningar**: filter efter tillstånd, allvarlighetsgrad, etiketter.

Använd den när: en teaminstrumentpanel följer larm på sina tjänster.

### Monitor List

En liveslista över monitorer och deras aktuella status.

**Inställningar**: filter efter monitortyp, etiketter eller aktuellt tillstånd.

Använd den när: du vill ha en flottöversikt — "är alla sidor uppe?"

## Servicenivåmål

### SLO

Ett servicenivåmål, ritat antingen som en enda siffra eller som en linje över tid.

**Inställningar**: vilket SLO, vilken av dess tre siffror (SLI, Error Budget Remaining eller Burn Rate), visning som Tile eller Chart, och en valfri titel.

- **Tile** visar den aktuella siffran, plus en andra rad där det finns en — målet under SLI:n, återstående minuter under felbudgeten. En statusetikett färgar hela widgeten.
- **Chart** ritar samma siffra över instrumentpanelens tidsintervall, med målet markerat som en streckad linje på SLI-serien. Historiken skrivs med några minuters mellanrum av utvärderingsjobbet, så ett helt nytt SLO ritas som tomt tills det har utvärderats första gången.

Använd den när: instrumentpanelen svarar på "håller vi det vi lovat?" snarare än "vad händer just nu?"

SLO-widgeten fungerar på [offentliga instrumentpaneler](/docs/dashboards/sharing). Det som publiceras är SLO:ns nyckelsiffror — namn, mål, aktuell SLI, återstående felbudget, burn rate och status — oavsett vilken av dem widgeten råkar rita. Definitionen förblir privat: monitorerna den bevakar, dess etiketter, dess beskrivning, dess fråga och dess utvärderingsschema skickas aldrig till en offentlig besökare. En Tile-widget publicerar bara de aktuella siffrorna; en Chart-widget publicerar dessutom historiken för den enda serie den ritar, och inget mer.

## Listor över Kubernetes-resurser

För projekt med en [Kubernetes-agent](/docs/monitor/kubernetes-agent) installerad. Var och en tar valfria filter för kluster, namespace och etiketter.

- **Kubernetes Pod List** — poddar med sin fas, omstarter och nod.
- **Kubernetes Node List** — noder med sina förhållanden och kapacitet.
- **Kubernetes Namespace List** — namespaces och arbetsbelastningsantal.
- **Kubernetes Deployment List** — deployments med önskade vs. klara repliker.
- **Kubernetes StatefulSet List** — stateful sets med klara repliker.
- **Kubernetes DaemonSet List** — daemon sets med önskade vs. klara.
- **Kubernetes Job List** — jobb och deras genomförandestatus.
- **Kubernetes CronJob List** — cron-jobb med schema och senaste körning.

Använd dessa när: du vill ha en enda instrumentpanel som blandar Kubernetes-tillstånd med telemetri från de arbetsbelastningarna.

## Listor över Docker-resurser

För projekt med Docker-övervakning konfigurerad.

- **Docker Host List** — värdar som kör Docker, med containerantal.
- **Docker Container List** — containers med tillstånd, image, värd, drifttid.
- **Docker Image List** — images och deras storlekar.
- **Docker Network List** — Docker-nätverk och anslutna containers.
- **Docker Volume List** — Docker-volymer och deras användning.

## Infrastruktur

### Host List

Värdar som övervakas av OneUptimes servermonitor, med status, CPU, minne och drifttid.

**Inställningar**: filter efter etiketter eller aktuellt tillstånd.

## Nätverk

### Network Map

Dina nätverksplatser ritade på världskartan, var och en nålad på sin egen latitud och longitud och färgad efter den monitorstatus som summerats upp på den. Platser som ligger nära varandra delar en markör med antalet skrivet inuti; en markör som står för exakt en plats öppnar den platsen när du klickar på den.

Kartan ramar in sig själv efter de platser den ritade — ett bestånd inom ett land fyller ramen med det landet, ett spritt över kontinenter öppnas på världen. Det finns inga kontroller för zoom eller panorering: en instrumentpanelsruta är en bild, och sidan Network Map under Network är där du vandrar genom hierarkin.

Ovanför kartan skrivs hur många platser som är nere, eftersom en två pixlar stor röd punkt bland tvåhundra gröna inte är något någon läser på instrumentpanelsavstånd. Under den säger en täckningsrad vad kartan _inte_ visar — platser utan koordinater, och om radgränsen nåddes.

**Inställningar**: titel, kart- eller listvy, högsta antal ritade platser, om platsnamn ska skrivas ut, och filter efter platstyp och status. Platsnamn försvinner automatiskt när kartan blir för tätt packad för att de ska gå att läsa; verktygstipset namnger fortfarande varje markör.

En plats visas bara om den har koordinater. Lägg till latitud och longitud på platsen (eller importera dem från CSV) för att nåla fast den.

## Vilken widget ska jag använda?

Några snabba regler:

- **Trend över tid?** Chart.
- **Loggvolym eller feltoppar över tid?** Log Chart.
- **En siffra som spelar roll just nu?** Value (eller Gauge om den har ett tydligt min/max).
- **Uppdelning över många saker?** Table.
- **Vad händer i systemet just nu?** Log Stream, Trace List, Incident List.
- **Tillståndet för en specifik grupp av resurser?** Den matchande listwidgeten.
- **Håller vi den tillförlitlighet vi lovat?** SLO.
- **Var i världen ditt nätverk finns, och vad som är rött?** Network Map.
- **En rubrik, ett stycke eller en länk?** Text.
- **Något som inget av ovanstående täcker?** HTML — men bara efter att du kontrollerat att en inbyggd widget verkligen inte klarar det.

De flesta instrumentpaneler blandar några — ett diagram högst upp, ett värde eller två bredvid, en text-avgränsare och en lista eller två nedanför.

## Läs vidare

- [Variabler & filter](/docs/dashboards/variables) — göra widgetar återanvändbara för många tjänster eller kunder.
- [Skapa en instrumentpanel](/docs/dashboards/authoring) — arbetsytans mekanik.
- [Delning & offentliga instrumentpaneler](/docs/dashboards/sharing) — dela utanför ditt team.

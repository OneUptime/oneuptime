# Måttutforskare

Mätvärden är siffrorna som dina tjänster och din infrastruktur rapporterar över tid: antal förfrågningar, latenser, CPU, ködjup. Måttutforskaren visar varje mätvärde som ditt projekt tar emot, visar vilket som helst av dem i ett diagram, kombinerar dem med formler och gör om ett diagram till en monitor eller en widget på en instrumentpanel.

:::cards
- [Hitta ett mätvärde](#hitta-ett-mätvärde): Sök i listan över namn på mätvärden.
- [Visa ett mätvärde i ett diagram](#visa-ett-mätvärde-i-ett-diagram): Aggregera, filtrera och gruppera en fråga.
- [Kombinera frågor med en formel](#kombinera-frågor-med-en-formel): Felfrekvenser och andra kvoter.
- [Använd det du har visat i diagrammet](#använd-det-du-har-visat-i-diagrammet): En monitor, en widget på en instrumentpanel eller en länk.
- [Förbättra mätvärden och lägg till de som saknas med AI](#förbättra-mätvärden-och-lägg-till-de-som-saknas-med-ai): Pull requests som åtgärdar dina mätvärden och lägger till dem en tjänst saknar.
:::

## Så fungerar utforskaren

Utforskaren har två nivåer. Fliken **Tittare** visar mätvärdena som ditt projekt tar emot. Klicka på ett, så öppnas utforskaren med en fråga för det: ett mätvärde, hur det aggregeras, och hur det filtreras och grupperas. Varje fråga är en variabel, `a`, `b` och så vidare, som en formel kan använda.

```mermaid title="Från frågor om mätvärden till ett diagram, en monitor eller en instrumentpanel"
flowchart TB
    a["Fråga a: förfrågningar,<br/>aggregerad med Sum"] --> f["Formel:<br/>$b / $a * 100"]
    b["Fråga b: fel,<br/>aggregerad med Sum"] --> f
    f --> chart["Diagram: felfrekvens<br/>i procent"]
    chart --> monitor["En monitor för<br/>mätvärden"]
    chart --> dash["En widget på en<br/>instrumentpanel"]
```

Utforskaren har fem flikar:

| Flik | Vad den är till för |
| --- | --- |
| **Tittare** | Listan över mätvärden, vart och ett med ett litet diagram och sitt senaste värde. Den öppnas på den senaste timmen. |
| **Insikter** | Vilka tjänster som rapporterar mätvärden, och hur många. |
| **AI** | Problemen som OneUptime hittar i dina mätvärden (för många värden, histogram-buckets som inte passar, saknade mätvärden), och vad OneUptime AI gjorde åt dem. Se [Förbättra mätvärden och lägg till de som saknas med AI](#förbättra-mätvärden-och-lägg-till-de-som-saknas-med-ai). |
| **Installationsguide** | Hur du skickar mätvärden med OpenTelemetry med en av dina inmatningsnycklar. |
| **Inställningar** | **Pipelineregler** och **Inspelningsregler**: vad som händer med mätvärden när de kommer in. |

## Innan du börjar

- **Mätvärden som kommer in.** Skicka dem med [OpenTelemetry](/docs/telemetry/open-telemetry), eller från en agent som [OpenTelemetry Collector för värdar](/docs/telemetry/host-otel-collector) eller [Kubernetes-agenten](/docs/telemetry/kubernetes-agent).
- **En roll som får läsa telemetri.** Project Owner, Project Admin, Project Member, Viewer, Telemetry Admin, Telemetry Member eller Telemetry Viewer, eller en anpassad roll med behörigheten Read Telemetry Service Metrics. Se [Telemetri](/docs/permissions/index#telemetri) för vilka mätvärden den läser.

## Hitta ett mätvärde

Gå till **Produkter → Observerbarhet → Mått**. **Tittare** visar varje mätvärde som ditt projekt har tagit emot, efter namn, vart och ett med ett litet diagram över tidsintervallet och sitt senaste värde.

- Sök i namnen med lösa ord eller `name:`, till exempel hittar `name:http.server` mätvärdet `http.server.request.duration`. Se [Söksyntax](/docs/telemetry/search-syntax#mätvärden).
- Filtrera på **Tjänst** i sidopanelen för att bara se de mätvärden som en tjänst rapporterar.
- Klicka på ett mätvärde för att visa det i ett diagram i utforskaren.

## Visa ett mätvärde i ett diagram

:::steps
### Öppna mätvärdet

Klicka på mätvärdet i **Tittare**. Utforskaren öppnas med en fråga, `a`, för listans tidsintervall och filter.

### Välj hur det ska aggregeras

Under **Aggregate by** väljer du hur värdena i varje punkt i diagrammet kombineras: Avg, som är standard, Sum, Min, Max, Count, eller en percentil, P50, P75, P90, P95 eller P99. En percentil av ett histogram, till exempel varaktigheten för en förfrågan, räknas ut från dess hinkar.

### Filtrera och gruppera det

Öppna **Filters & grouping**. **Filter by attributes** behåller de datapunkter vars attribut matchar, till exempel en viss `http.route`, och **Gruppera efter** ritar en linje per värde av de attribut du väljer, till exempel en linje per värd.

### Justera diagrammet

Öppna **Display Settings** för att välja **Chart type** (linje, yta eller stapel), rita en **Warning Threshold** och en **Critical Threshold** i diagrammet, eller slå på **Convert to per-second rate**.
:::

> [!TIP]
> En räknare som bara ökar, som `system.disk.io`, läses bäst som en takt. Slå på **Convert to per-second rate** för att visa hur snabbt den ändras i stället för dess löpande summa; utforskaren föreslår det när den känner igen en sådan räknare.

Varje fråga ritar sitt eget diagram. För att rita en fråga i samma diagram som den före den slår du på **Overlay with previous query** i dess **Display Settings**.

## Kombinera frågor med en formel

:::steps
### Lägg till frågorna

Klicka på **Lägg till mätvärde** för varje mätvärde du behöver. De nya frågorna heter `b`, `c` och så vidare.

### Lägg till en formel

Klicka på **Lägg till formel** och skriv **Formel** med frågornas variabler, operatorerna `+`, `-`, `*`, `/`, `%` och `^`, och parenteser. För en felfrekvens i procent skriver du `$b / $a * 100`.
:::

En variabel kan skrivas med eller utan sitt `$`, med stora eller små bokstäver. En formel som nämner en fråga som du inte har definierat säger det i stället för att rita.

## Utforska runt ett diagram

Knapparna ovanför diagrammen arbetar med tidsintervallet du tittar på:

| Knapp | Vad den gör |
| --- | --- |
| **Loggar** | Öppnar [Loggutforskare](/docs/telemetry/logs-explorer) för det här tidsintervallet och dina filter. |
| **Spår** | Öppnar [Spårutforskare](/docs/telemetry/traces-explorer) för det här tidsintervallet och dina filter. |
| **Utreda** | Öppnar en sidopanel med loggarna, spåren och undantagen från det här tidsintervallet. |
| **Händelser** | Markerar incidenterna och larmen från det här tidsintervallet i diagrammen. |
| **Compare** | Ritar den föregående perioden i varje diagram som en streckad linje, så att du ser vad som har ändrats. |

Dra över ett diagram för att zooma in på ett ögonblick, och dubbelklicka för att zooma ut igen: se [Zooma in på ett tidsintervall](/docs/telemetry/charts-and-time-ranges).

## Använd det du har visat i diagrammet

- **Åtgärder → Skapa monitor från den här vyn** öppnar en ny monitor för mätvärden med de här frågorna och formlerna ifyllda. Se [Metrikövervakning](/docs/monitor/metrics-monitor).
- **Åtgärder → Add to dashboard** lägger till diagrammet på en instrumentpanel som du väljer. Du behöver behörighet att redigera den instrumentpanelen.
- **Kopiera länk** kopierar en länk till exakt den här vyn: frågor, formler och tidsintervall.
- **Sparade vyer** behåller vyn under ett namn för alla i projektet. **Tittare** har egna sparade vyer för sin sökning och sina filter. Sparade vyer fungerar som i [Loggutforskare](/docs/telemetry/logs-explorer#spara-en-vy).

## Insikter i mätvärden

Fliken **Insikter** räknar mätvärdena i ett tidsintervall: **Aktiva mått**, **Rapporteringstjänster** och genomsnittet per tjänst. Den delar in mätvärdena i kategorier och visar tjänsterna som rapporterar dem.

## Förbättra mätvärden och lägg till de som saknas med AI

Varje timme går OneUptime igenom mätvärdena som dina tjänster skickade under den senaste timmen efter sådana som registrerar för många värden, histogram vars buckets inte passar och hårt belastade tjänster som inte skickar några mätvärden. Det den hittar registrerar den som AI-insikter, med bevisen. Sedan undersöker OneUptime AI varje fynd och öppnar en pull request som åtgärdar det. Inget slås någonsin ihop: ditt team granskar varje pull request.

OneUptime läser noga de 10 mätvärden som dina tjänster skickade flest datapunkter för under timmen, vart och ett med minst 1 000 av dem, och registrerar tre sorters fynd:

| Fynd | När OneUptime registrerar det | Pull requesten |
| --- | --- | --- |
| **Hög kardinalitet** | Ett attribut som koden sätter på ett av de mätvärdena fick 1 000 eller fler värden under timmen, till exempel användar-ID:n eller fullständiga URL:er, så att varje värde blir en egen serie. Eller så är 50 eller fler av en tjänsts mätvärdesnamn ett och samma namn med ett annat ID i. | Slutar registrera värdet på mätvärdet, eller tar bort ID:na ur dess namn. |
| **Fel histogram-buckets** | Ett av de mätvärdena är ett histogram som registrerade 1 000 eller fler värden, och 90 % eller fler av dem hamnade i dess minsta bucket eller över dess största, eller så har det inga buckets, så att dess percentiler inte går att skilja åt. | Ger histogrammet buckets som passar dess värden, eller rättar dess enhet. |
| **Saknade mätvärden** | En tjänst skickade 1 000 eller fler spans under timmen och har aldrig skickat ett mätvärde. | Lägger till antalet förfrågningar, felen och varaktigheten för dess mest belastade operationer som mätvärden. |

Ett fynd lagrar aldrig ett attributs värden: bara attributets namn, hur många värden det fick och hur de ser ut.

### Slå på det

**Mått → AI → Inställningar** har reglaget **Förbättra mätvärden och lägg till de som saknas**, som är på för nya projekt. När **Aktivera AI** är av hittas problem i dina mätvärden fortfarande, men OneUptime AI gör ingenting med dem. För att öppna pull requests behöver OneUptime AI ett repository anslutet i [Kod](/docs/ai/ai-agent): sidan säger först vad som saknas. Koden i varje repository ändras på den Runner som repositoryt väljer i Kod.

OneUptime AI öppnar själv högst 5 pull requests per dag (UTC), en för varje fynd, och aldrig fler än ett repositorys gräns för öppna AI-pull requests.

### AI-regler

Utan regler undersöker OneUptime AI direkt varje problem den hittar i dina mätvärden och öppnar en pull request för vart och ett den kan åtgärda. **AI-regler** under **Fler inställningar** begränsar det, i tre steg:

| Steg | Vad det avgör |
| --- | --- |
| **Matcha** | Vilka tjänster: de valda, de med vissa etiketter eller de vars namn matchar ett mönster. |
| **Utreda** | **Direkt**, eller **Bara om fortfarande hittad efter en väntetid**: ett problem som försvinner under väntetiden undersöks inte. |
| **Åtgärd** | **Åtgärda inte**, **Fråga innan något åtgärdas** eller **Åtgärda utan att fråga**. Att fråga först lämnar pull requesten till en person: fyndet erbjuder **Åtgärda med AI**. |

Under **Fler fält** väljer en regel de kodrepositorier, MCP-servrar och den LLM-leverantör som OneUptime AI får använda för den. Är inget valt får den använda alla, och projektets standard-LLM-leverantör.

### Se vad den gjorde

- **Mått → AI → Insikter** visar vad OneUptime hittade, varje fynd med sina bevis och **Öppna i Mått**, som öppnar dess mätvärde för dess tjänst, från timmen då det hittades. En tjänst utan mätvärden erbjuder i stället **Öppna i Spår**: de spans som dess mätvärden skulle mäta.
- **Mått → AI → Loggar** visar varje utredning och varje pull request, nyast först, med hur var och en står och vad varje utredning hittade.
- I Kod säger uppgiften att OneUptime startade den, med en länk till dess fynd, och pull requesten säger varför den öppnades.

## Vad som händer med mätvärden när de kommer in

**Mått → Inställningar → Pipelineregler** ändrar mätvärden när de kommer in, innan de lagras. Reglerna körs i listans ordning, som du ändrar genom att dra; en regel för en tjänst körs före reglerna för alla tjänster.

| Regeltyp | Vad den gör |
| --- | --- |
| Filter (tillåtelselista) | Behåller bara de datapunkter som matchar och kastar resten. |
| Kassera | Kastar de datapunkter som matchar. |
| Byt namn på mått | Byter namn på mätvärdet. |
| Byt namn på attribut | Byter namn på ett attributs nyckel i matchande datapunkter. |
| Lägg till attribut | Lägger till ett attribut i matchande datapunkter. |
| Ta bort attribut | Tar bort ett attribut, till exempel ett med för många värden för att vara användbart. |
| Maskera attribut | Ersätter ett attributs värde med en platshållare. |
| Stickprov | Behåller en procentandel av de matchande datapunkterna. |

**Mått → Inställningar → Inspelningsregler** räknar ut nya mätvärden från andra mätvärden, varje minut. Se [Inspelningsregler för loggar](/docs/telemetry/log-recording-rules) för hur inspelningsregler fungerar.

## Felsökning

:::details En räknares diagram går bara uppåt
Det är en kumulativ räknare. Slå på **Convert to per-second rate** i frågans **Display Settings**.
:::

:::details Listan säger att inga mätvärden hittades
Rensa först din sökning och dina filterchips. Om listan fortfarande är tom har inga mätvärden nått OneUptime ännu: jämför din konfiguration med **Installationsguide**.
:::

:::details En tjänsts mätvärden saknas
Filtrera **Tittare** på den **Tjänst** och vidga tidsintervallet. Om de fortfarande saknas kan din rolls omfång utesluta den tjänsten: se [Telemetri](/docs/permissions/index#telemetri).
:::

## Nästa steg

:::cards
- [Metrikövervakning](/docs/monitor/metrics-monitor): Få ett larm när ett mätvärde passerar en tröskel.
- [Skapa en instrumentpanel](/docs/dashboards/authoring): Ställ dina diagram bredvid varandra.
- [Söksyntax](/docs/telemetry/search-syntax): Varje filter som sökrutan förstår.
:::

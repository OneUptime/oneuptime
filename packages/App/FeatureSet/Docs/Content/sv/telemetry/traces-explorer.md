# Spårutforskare

Spårutforskaren hittar förfrågningarna som har gått genom dina tjänster: de långsamma, de misslyckade, de som rörde en viss kunds konto. Sök i och filtrera de spans som dina tjänster skickar, och öppna sedan ett spår för att se varje steg i förfrågan som ett vattenfall, ett flamdiagram eller en tjänstekarta.

:::cards
- [Hitta en förfrågan](#hitta-en-förfrågan): Sök i spans och filtrera sedan på tjänst, status eller typ.
- [Läs ett spår](#läs-ett-spår): Vart tiden tog vägen, och vilket steg som misslyckades.
- [Visa dina spans i diagram](#visa-dina-spans-i-diagram): Antal förfrågningar och svarstider, grupperade som du vill.
- [Insikter i spår](#insikter-i-spår): Felfrekvenser, latens och de långsammaste förfrågningarna.
:::

## Spår och spans

Ett spår är en förfrågan på väg genom ditt system. Varje steg den tar, som en HTTP-hanterare, en databasfråga eller ett anrop till en annan tjänst, är ett span, och spans ligger inuti de spans som startade dem. Det första spannet i ett spår, utan förälder, är dess rotspan: förfrågans ingångspunkt.

```mermaid title="En förfrågan är ett spår av nästlade spans"
flowchart TB
    root["Rotspan:<br/>POST /checkout"] --> auth["Span: verifiera<br/>sessionen"]
    root --> pay["Span: debitera<br/>kortet"]
    pay --> sql["Span: INSERT<br/>INTO orders"]
    pay --> call["Span: anropa<br/>betalningsleverantören"]
```

Varje rad i utforskaren är ett span, så en upptagen tjänst fyller listan med sina databasfrågor och interna anrop. För att visa en rad per förfrågan väljer du **Root spans** under **Span-kategori** i sidopanelen.

Utforskaren har fyra flikar:

| Flik | Vad den är till för |
| --- | --- |
| **Tittare** | Sök i och filtrera spans, och öppna deras spår. Den öppnas på den senaste timmen, nyaste först, 50 spans per sida. |
| **Insikter** | Antal förfrågningar, felfrekvenser och latens per tjänst, och de förfrågningar som är värda en titt. |
| **Installationsguide** | Hur du skickar spår med OpenTelemetry med en av dina [inmatningsnycklar](/docs/telemetry/ingestion-keys). |
| **Inställningar** | Vad som händer med spans när de kommer in: **Pipelines**, **Drop-filter**, **Scrub-regler** och **Inspelningsregler**. |

## Innan du börjar

- **Spår som kommer in.** Instrumentera dina tjänster med [OpenTelemetry](/docs/telemetry/open-telemetry). Fliken **Installationsguide** visar koden för ditt språk.
- **En roll som får läsa telemetri.** Project Owner, Project Admin, Project Member, Viewer, Telemetry Admin, Telemetry Member eller Telemetry Viewer, eller en anpassad roll med behörigheten Read Telemetry Service Traces. Dess omfång avgör vems spans du ser: se [Telemetri](/docs/permissions/index#telemetri).

## Hitta en förfrågan

:::steps
### Öppna Tittare

Gå till **Produkter → Observerbarhet → Spår**. **Tittare** visar spans från den senaste timmen, nyaste först, vart och ett med status, tjänst, namn och varaktighet.

### Välj tidsintervallet

Välj ett intervall i tidsväljaren, eller dra över diagrammet ovanför listan för att zooma in på en topp. Dubbelklicka på diagrammet för att zooma ut igen. Se [Zooma in på ett tidsintervall](/docs/telemetry/charts-and-time-ranges).

### Sök

Skriv en fråga och tryck på Enter, till exempel `service:checkout status:error duration:>500`. Lösa ord söker i span-namn, och `@key:value` söker i ett attribut som `@http.route:/orders`. Se [Söksyntax](/docs/telemetry/search-syntax#spår).

### Avgränsa med filter

Klicka på ett värde i sidopanelen **Filter** för att lägga till det som ett chip. Sidopanelen filtrerar på **Tjänst**, på värden, klustret eller den andra resursen som skickade spannet, på **Status**, **Span-kategori**, **Har undantag**, **Span-typ**, **Span-namn**, **Service Instance** och **Värdens namn**.

### Öppna ett span

Klicka på en rad för att fälla ut den: dess attribut, och loggarna och undantagen som den registrerade. Klicka på **See full trace** för att öppna hela spåret.
:::

Din sökning, dina chips och tidsintervallet sparas i sidans adress, så att en omladdning, ett bokmärke eller en delad länk öppnar samma spans.

## Läs ett spår

Ett spårs sida börjar med förfrågans siffror:

| Siffra | Vad den är |
| --- | --- |
| Varaktighet | Hur lång tid hela förfrågan tog. |
| Spans | Hur många spans spåret har. |
| Tjänster | Hur många tjänster förfrågan gick genom. |
| Fel | Hur många spans som slutade med en felstatus. Klicka på den för att bara visa dem. |
| Djup | Den djupaste kedjan av nästlade spans. |

Under dem väljer du en av fyra vyer:

| Vy | Vad den visar |
| --- | --- |
| **Waterfall** | Varje span på en tidslinje, nästlat under det span som startade det. Slå på **Critical path** för att markera kedjan av spans som avgjorde hur lång tid förfrågan tog. |
| **Flamdiagram** | Samma träd som staplade staplar, där de bredaste staplarna tog längst tid. |
| **Service map** | Tjänsterna som förfrågan gick genom, och anropen mellan dem. |
| **Operations** | En rad per tjänst och span-namn, med anrop, fel, egen tid och total tid. En operation som anropas 10 gånger eller mer från ett och samma föräldraspan markeras: ofta en N+1-fråga eller en loop som kunde ha samlats ihop. |

Klicka på ett span i valfri vy för att öppna dess panel, med flikar för attribut, händelser, loggar, undantag och länkar, och för dess profil eller LLM-anrop när det har ett. Sök bland spårets spans på namn, ID eller tjänst med sökrutan bredvid vyerna (tryck på `/`), och slå på **Errors only** för att bara behålla de spans som misslyckades.

Ett stort spår läser in 500 spans åt gången. Klicka på knappen längst ned i spåret för att läsa in fler, eller alla.

> [!TIP]
> **Fix performance with AI** visas bara på ett spår som är värt att åtgärda: ett med en N+1-fråga, anrop efter varandra som kunde köras parallellt, eller ett anrop som tar största delen av begäran, när det kostar verklig tid (100 ms eller mer för anropen tillsammans, 500 ms eller mer för ett enskilt anrop och minst en tiondel av begäran). Den talar om vad den hittade, till exempel "Samma databasfråga kördes 40 gånger i ReportService.build", och startar en AI-uppgift som öppnar en pull request som åtgärdar det. Se [Kod](/docs/ai/ai-agent).

## Visa dina spans i diagram

Diagrammet ovanför listan visar antalet spans över tid, uppdelat på status. Välj ett annat mått i diagrammets rubrik för att i stället visa deras genomsnittliga svarstid, median (P50) eller P95.

För mer byter du listan från **Spans** till **Analytics**. Välj en tidsserie, en topplista eller en tabell; mät antal förfrågningar, antal fel eller svarstider (genomsnitt, P50, P90, P95, P99, minimum eller maximum); och gruppera på span-namn, tjänst, status, span-typ eller valfritt attribut, och sedan på ett andra fält. En topplista eller en tabell visar de 5 till 100 största grupperna.

## Följ, spara och dela

- Klicka på **Pausad** ovanför listan för att slå på liveuppdateringar. Knappen visar då **Live**, och listan letar efter nya spans var tionde sekund. Klicka igen för att pausa.
- **Saved Views** behåller en sökning, dess filter och tidsintervallet under ett namn, för alla i projektet. Sparade vyer fungerar som i [Loggutforskare](/docs/telemetry/logs-explorer#spara-en-vy).
- Knapparna **Loggar** och **Mätvärden** öppnar de utforskarna för samma tidsfönster, med så mycket av din filtrering som de kan använda. Peka på en knapp för att se vad den inte kan ta med sig.

## Insikter i spår

Fliken **Insikter** sammanfattar förfrågningarna i ett tidsintervall:

- antalet förfrågningar, felfrekvensen och latensen för P50, P95 och P99;
- en hälsotabell över dina tjänster, sorterad på felfrekvens, så att de tjänster som behöver uppmärksamhet kommer först;
- de senaste misslyckade förfrågningarna, och de långsammaste.

Begränsa den till vissa tjänster med listrutan bredvid tidsväljaren.

## Vad som händer med spans när de kommer in

Fliken **Inställningar** innehåller reglerna som OneUptime tillämpar på spans när de kommer in, som för loggar. De gäller de spans som kommer in efteråt, inte de som redan är lagrade. Hur länge varje span sparas avgörs också när den kommer in: se [Datalagring](/docs/telemetry/data-retention).

| Regel | Vad den gör |
| --- | --- |
| **Drop-filter** | Kasta spans som du inte vill behålla, eller behåll ett stickprov av dem. Se [Kassera poster eller ta stickprov](/docs/telemetry/drop-filters-and-scrub-rules#kassera-poster-eller-ta-stickprov). |
| **Scrub-regler** | Maskera känsliga data i span-attribut. Se [Rensa känsliga data](/docs/telemetry/drop-filters-and-scrub-rules#rensa-känsliga-data). |
| **Pipelines** | Ändra och berika spans: varje pipeline väljer ut spans med ett filter och kör sedan sina processorer i ordning. |
| **Inspelningsregler** | Gör om antal spans, antal fel och varaktigheter till nya mätvärden, varje minut. Se [Inspelningsregler för loggar](/docs/telemetry/log-recording-rules). |

## Felsökning

:::details Ett spår säger att inga spans hittades
Spans kommer oftast in inom en minut efter att förfrågan är klar. Klicka på **Uppdatera** på spårets sida för att kontrollera igen.
:::

:::details Vissa spans ligger på översta nivån i vattenfallet
De pekar på ett föräldraspan som OneUptime inte har tagit emot, ofta för att tjänsten som skrev föräldern ännu inte skickar spår till OneUptime. Instrumentera den tjänsten också.
:::

:::details Listan visar betydligt fler rader än förfrågningar
Varje rad är ett span, inte en förfrågan. Välj **Root spans** under **Span-kategori** i sidopanelen för att visa en rad per förfrågan.
:::

## Nästa steg

:::cards
- [Söksyntax](/docs/telemetry/search-syntax): Varje filter som sökrutan förstår.
- [Spårningsövervakning](/docs/monitor/traces-monitor): Få varningar om misslyckade eller långsamma förfrågningar.
- [Undantagsspårning](/docs/telemetry/exceptions): Gå igenom felen som dina spans registrerar.
- [Loggutforskare](/docs/telemetry/logs-explorer): Läs loggraderna som en förfrågan skrev.
:::

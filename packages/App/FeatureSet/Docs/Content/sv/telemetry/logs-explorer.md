# Loggutforskare

Loggutforskaren är där du söker i och läser loggarna som dina tjänster, värdar och agenter skickar till OneUptime. Minska miljontals rader till de få som spelar roll, följ nya när de kommer in, visa dem i diagram och spara de vyer som ditt team återkommer till.

:::cards
- [Hitta en loggrad](#hitta-en-loggrad): Ett tidsintervall, en sökning och några filter.
- [Läs en logg](#läs-en-logg): Dess attribut, dess spår och raderna runt den.
- [Följ loggar live](#följ-loggar-live): Nya rader var tionde sekund.
- [Spara en vy](#spara-en-vy): Behåll en sökning, dess filter och dess kolumner för alla.
- [Insikter i loggar](#insikter-i-loggar): De vanligaste felen, allvarlighetsgrader och vem som loggar vad.
- [Hitta och åtgärda felloggar, saknade och brusiga loggar med AI](#hitta-och-åtgärda-felloggar-saknade-och-brusiga-loggar-med-ai): Pull requests som åtgärdar fel, loggar det som inte loggas och dämpar brusiga rader.
:::

## Så avgränsar utforskaren dina loggar

Allt på fliken **Tittare** arbetar med en uppsättning loggar: de i tidsintervallet som matchar din sökning och varje filterchip. Ändra något av dem så ändras listan, volymdiagrammet och siffrorna i sidopanelen tillsammans.

```mermaid title="Så avgränsar Tittare dina loggar"
flowchart TB
    all["Varje logg i<br/>tidsintervallet"] --> search["Din sökning, t.ex.<br/>severity:error"]
    search --> chips["Dina filterchips,<br/>t.ex. en tjänst"]
    chips --> list["Lista: nyaste först,<br/>100 per sida"]
    chips --> chart["Analytics: antal<br/>och toppvärden"]
    list --> details["En logg: detaljer<br/>och kontext"]
```

Utforskaren har fem flikar:

| Flik | Vad den är till för |
| --- | --- |
| **Tittare** | Sök i, filtrera och läs loggar. Den öppnas på den senaste timmen, nyaste först, 100 loggar per sida. |
| **Insikter** | Vad dina tjänster har loggat i ett tidsintervall, och vad som gick fel. |
| **AI** | De felloggar, den saknade loggning och de brusiga loggar som OneUptime hittar i dina loggar, och vad OneUptime AI gjorde åt dem. Se [Hitta och åtgärda felloggar, saknade och brusiga loggar med AI](#hitta-och-åtgärda-felloggar-saknade-och-brusiga-loggar-med-ai). |
| **Installationsguide** | Hur du skickar loggar med OpenTelemetry, Fluent Bit eller Fluentd med en av dina [inmatningsnycklar](/docs/telemetry/ingestion-keys). |
| **Inställningar** | Vad som händer med loggar när de kommer in: **Pipelines**, **Drop-filter**, **Scrub-regler** och **Inspelningsregler**. |

## Innan du börjar

- **Loggar som kommer in.** Skicka dem med [OpenTelemetry](/docs/telemetry/open-telemetry), [Fluent Bit](/docs/telemetry/fluentbit), [Fluentd](/docs/telemetry/fluentd) eller [Syslog](/docs/telemetry/syslog). Fliken **Installationsguide** visar konfigurationen för ditt språk eller din collector.
- **En roll som får läsa telemetri.** Project Owner, Project Admin, Project Member, Viewer, Telemetry Admin, Telemetry Member eller Telemetry Viewer, eller en anpassad roll med behörigheten Read Telemetry Service Log. Dess omfång avgör vems loggar du ser: se [Telemetri](/docs/permissions/index#telemetri).

## Hitta en loggrad

:::steps
### Öppna Tittare

Gå till **Produkter → Observerbarhet → Loggar**. **Tittare** visar loggarna från den senaste timmen, nyaste först, med **Tid**, **Tjänst**, **Allvarlighetsgrad** och **Meddelande**.

### Välj tidsintervallet

Välj ett intervall i tidsväljaren, eller dra över volymdiagrammet ovanför listan för att zooma in på en topp. Dubbelklicka på diagrammet för att zooma ut igen. Se [Zooma in på ett tidsintervall](/docs/telemetry/charts-and-time-ranges).

### Sök

Skriv en fråga i sökrutan och tryck på Enter, till exempel `severity:error service:checkout timeout`. Lösa ord söker i meddelandet, och `@key:value` söker i ett attribut. Se [Söksyntax](/docs/telemetry/search-syntax#loggar).

### Avgränsa med filter

Klicka på ett värde i sidopanelen **Filter** för att lägga till det som ett chip: en allvarlighetsgrad, en tjänst, eller en värd, ett kluster eller en annan resurs som har skickat loggar. Varje värde visar hur många loggar som har det. På en telefon trycker du på **Filter** för att öppna sidopanelen.

### Öppna en logg

Klicka på en rad. Dess detaljer öppnas bredvid listan.
:::

Din sökning, dina chips och tidsintervallet sparas i sidans adress, så en omladdning, ett bokmärke eller en delad länk öppnar samma loggar.

## Läs en logg

Detaljpanelen har två flikar:

| Flik | Vad den visar |
| --- | --- |
| **Detaljer** | **Loggkropp**, dess **Spår-ID**, **Span-ID** och **Session** när den har dem, och dess **Attribut**, som lista eller som JSON. |
| **Context** | Loggen bland sina grannar. **Nearby (service + time)** visar de fem raderna före och efter den från samma tjänst, och **This trace** visar upp till 100 loggar från dess spår. |

- Klicka på spår-ID:t för att öppna hela förfrågan i [Spårutforskare](/docs/telemetry/traces-explorer).
- Peka på ett attribut och klicka på dess filterikon för att söka efter det värdet, eller kopiera det. Du kan kopiera alla attribut på en gång som JSON.
- **This trace** visas bara för en logg som skrevs inuti ett spår.

## Följ loggar live

Klicka på **Live** ovanför listan. Utforskaren hoppar till första sidan, sorterad med de nyaste först, och letar efter nya loggar var tionde sekund, så att raderna dyker upp medan dina tjänster skriver dem.

Live-läget stänger av sig självt när du ändrar sökningen, ett filter eller tidsintervallet, eller går till en annan resultatsida: det visar bara de nyaste loggarna. Klicka på **Live** igen för att fortsätta.

## Välj kolumner och exportera

- **Kolumner** väljer vad listan visar. **Tid**, **Tjänst**, **Allvarlighetsgrad** och **Meddelande** kommer först; lägg till **Spår-ID**, **Span-ID** eller valfritt attribut, flytta kolumner upp och ned, eller återgå till standard med **Återställ**.
- **Export** laddar ned loggarna på sidan du tittar på. **Exportera som CSV** skriver de kolumner du visar; **Exportera som JSON** skriver varje fält i varje logg med alla dess attribut.
- Peka på rubrikraden och dra strecket i slutet av ett kolumnnamn för att göra kolumnen bredare eller smalare, eller dubbelklicka på strecket för att anpassa kolumnen till innehållet. Listan kommer ihåg dina bredder i den här webbläsaren; **Återställ kolumnbredd** i slutet av rubrikraden ger varje kolumn dess egen bredd igen.

## Spara en vy

En sparad vy behåller en sökning, dess filterchips, tidsintervallet, kolumnerna, sorteringen och sidstorleken under ett namn.

:::steps
### Ställ in vyn

Sök, filtrera och välj de kolumner du vill behålla.

### Spara den

Öppna **Sparade vyer** och klicka på **+ Spara aktuell vy**. Ange ett **Namn**, markera **Ange som standard** om vyn ska öppnas varje gång någon öppnar loggarna, och klicka på **Spara vy**.

### Använd den

Välj vyn i **Sparade vyer** för att använda den, och **Rensa vy** för att gå tillbaka till den senaste timmen utan filter. Peka på en vy i listan för att **Redigera** eller **Ta bort** den, eller, medan den används, för att **Uppdatera** den med dina ändringar.
:::

Sparade vyer hör till projektet, så alla i det ser samma lista. Ett rullande intervall som den senaste timmen fortsätter att rulla: vyn visar timmen innan du öppnar den, inte timmen då du sparade den. Så länge projektet saknar en standardvy blir nästa sparade vy standard, och ett projekt har en standard i taget.

## Visa dina loggar i diagram

Växla listan till **Analytics** för att räkna loggar i stället för att läsa dem. Välj en tidsserie, en topplista eller en tabell; räkna varje logg, eller de unika värdena i ett fält; och gruppera efter allvarlighetsgrad, tjänst, spår, span eller valfritt attribut, och sedan efter ett andra fält. En topplista eller en tabell visar de översta 5, 10, 25 eller 50 grupperna.

Klicka på **Lista** för att gå tillbaka till själva raderna.

## Öppna tillhörande spår och mätvärden

Knapparna **Spår** och **Mätvärden** bredvid **Sparade vyer** öppnar [Spårutforskare](/docs/telemetry/traces-explorer) eller [Måttutforskare](/docs/telemetry/metrics-explorer) för samma tidsfönster, med så mycket av din filtrering som den utforskaren kan använda. Peka på en knapp för att se vad den inte kan ta med sig.

## Insikter i loggar

Fliken **Insikter** visar vad dina tjänster har loggat i ett tidsintervall, och vad som gick fel. Begränsa den till vissa tjänster, värdar eller kluster med listrutan bredvid tidsväljaren.

| Panel | Vad den visar |
| --- | --- |
| Översiktskort | **Totalt antal loggar**, **Fel**, **Distinct errors** och **Reporting sources**. |
| **Severity distribution** | Hur loggarna fördelar sig på allvarlighetsgrad. |
| **Top errors** | De olika meddelanden som loggats med allvarlighetsgraden Error eller Fatal, de vanligaste först. |
| **Sources reporting logs** | Volymen och felsignalen för varje tjänst, värd eller annan källa. |

Välj ett av de vanligaste felen för att se vad som hände runt det: när det inträffade, vad dess förekomster har gemensamt, var det inträffar, spåren som bär det och dess senaste rader. **Open matching logs** öppnar dem i **Tittare**, och **Explain with AI** öppnar [Fråga AI](/docs/ai/ask-ai) med felet och dess bevis som en prompt du kan redigera.

## Hitta och åtgärda felloggar, saknade och brusiga loggar med AI

Varje timme går OneUptime igenom varje tjänsts loggar från den senaste timmen efter fel som den loggar om och om igen, misslyckanden som den inte loggar och rader som översvämmar dess loggar, och registrerar det den hittar som AI-insikter, med bevisen. Sedan undersöker OneUptime AI varje fynd och öppnar en pull request som åtgärdar det. Inget slås någonsin ihop: ditt team granskar varje pull request.

OneUptime registrerar tre sorters fynd:

| Fynd | När OneUptime registrerar det | Pull requesten |
| --- | --- | --- |
| **Fellogg** | En tjänst loggade samma meddelande med Error eller Fatal 20 gånger eller fler under timmen, ett meddelande med egna ord och utan undantag. Ett meddelande som loggas med ett undantag, eller med en stackspårning i sig, följs i stället i [Undantagsspårning](/docs/telemetry/exceptions). | Åtgärdar orsaken till att felet loggas, eller loggar det på den nivå det förtjänar. |
| **Saknad loggning** | Minst 20 av en operations spans misslyckades under timmen, 5 % eller fler av dem, medan minst 100 av tjänstens loggar bär ett spår-id, och ingen av operationens 20 senaste misslyckade förfrågningar skrev en loggrad. Eller en tjänst skickade 500 loggar eller fler och 100 spans eller fler under timmen, och färre än 1 % av dess loggar bär ett spår-id. | Loggar misslyckandet där det sker, eller får tjänstens loggar att bära spår-id:t. |
| **Brusig logg** | Ett meddelande som loggas under Error utgör 25 % eller mer av en tjänsts rader under timmen, omkring 10 000 rader eller fler. | Loggar raden mindre: med Debug, en gång per omgång eller inte alls. |

Ett fynd sparar ett meddelande som dess mönster: de delar som ändras från rad till rad, till exempel tal och id:n, maskeras. Pull requesten begärs med det mönstret, aldrig med en rad som den loggades, och OneUptime AI uppmanas att aldrig logga hemligheter eller personuppgifter, eller kopiera loggrader till pull requesten.

OneUptime AI öppnar bara själv pull requesten för en fellogg när den hittar den skyldiga koden. Ett fel som kommer från något annat håll, till exempel ett beroende som ligger nere, får ingen pull request om inte någon ber om en med **Åtgärda med AI**.

### Slå på det

**Loggar → AI → Inställningar** har reglaget **Hitta och åtgärda felloggar, saknade och brusiga loggar**, som är på för nya projekt. När **Aktivera AI** är av hittas felloggar, saknade och brusiga loggar fortfarande, men OneUptime AI gör ingenting med dem. För att öppna pull requests behöver OneUptime AI ett repository anslutet i [Kod](/docs/ai/ai-agent): sidan säger först vad som saknas. Koden i varje repository ändras på den Runner som repositoryt väljer i Kod.

OneUptime AI öppnar själv högst 5 pull requests per dag (UTC), för all telemetri den åtgärdar tillsammans, en för varje fynd, och aldrig fler än ett repositorys gräns för öppna AI-pull requests.

### AI-regler

Utan regler undersöker OneUptime AI direkt varje problem den hittar i dina loggar och öppnar en pull request för vart och ett den kan åtgärda. **AI-regler** under **Fler inställningar** begränsar det, i tre steg:

| Steg | Vad det avgör |
| --- | --- |
| **Matcha** | Vilka tjänster: de valda, de med vissa etiketter eller de vars namn matchar ett mönster. |
| **Utreda** | **Direkt**, eller **Bara om fortfarande hittad efter en väntetid**: ett problem som försvinner under väntetiden undersöks inte. |
| **Åtgärd** | **Åtgärda inte**, **Fråga innan något åtgärdas** eller **Åtgärda utan att fråga**. Att fråga först lämnar pull requesten till en person: fyndet erbjuder **Åtgärda med AI**. |

Under **Fler fält** väljer en regel de kodrepositorier, MCP-servrar och den LLM-leverantör som OneUptime AI får använda för den. Är inget valt får den använda alla, och projektets standard-LLM-leverantör.

### Se vad den gjorde

- **Loggar → AI → Insikter** visar vad OneUptime hittade, varje fynd med sina bevis och **Öppna i Loggar**, som öppnar de rader det gäller, från timmen då det hittades, i **Tittare**. Ett misslyckande som inte skriver någon loggrad har inga rader att öppna: **Öppna i Spår** öppnar i stället dess misslyckade spans. För en fellogg skapar **Skapa monitor** en loggmonitor som räknar meddelandets rader.
- **Loggar → AI → Aktivitet** visar varje utredning och varje pull request, nyast först, med hur var och en står. En avslutad utredning säger också vad OneUptime AI hittade, till exempel orsaken till ett fel utanför koden, och därför fick den felloggen ingen pull request av sig själv.
- I Kod säger uppgiften att OneUptime startade den, med en länk till dess fynd, och pull requesten säger varför den öppnades.

## Vad som händer med loggar när de kommer in

Fliken **Inställningar** innehåller reglerna som OneUptime tillämpar på varje logg innan den lagras. De verkar på loggarna som kommer in efteråt, inte på lagrade. Hur länge varje logg sparas avgörs också när den kommer in: se [Datalagring](/docs/telemetry/data-retention).

| Regel | Vad den gör |
| --- | --- |
| **Drop-filter** | Kassera loggar du inte vill behålla, eller behåll bara ett stickprov av dem. Se [Kassera poster eller ta stickprov](/docs/telemetry/drop-filters-and-scrub-rules#kassera-poster-eller-ta-stickprov). |
| **Scrub-regler** | Maskera känsliga data, som e-postadresser och kortnummer. Se [Rensa känsliga data](/docs/telemetry/drop-filters-and-scrub-rules#rensa-känsliga-data). |
| **Pipelines** | Plocka ut fält ur meddelandet, rätta allvarlighetsgraden, byt namn på attribut. Se [Loggpipelines](/docs/telemetry/log-pipelines). |
| **Inspelningsregler** | Gör matchande loggar till mätvärden. Se [Inspelningsregler för loggar](/docs/telemetry/log-recording-rules). |

## Kortkommandon

Tryck på `?` i Tittare för att se dem.

| Tangent | Vad den gör |
| --- | --- |
| `j` / `k` | Gå till nästa eller föregående logg. |
| Enter | Öppna eller stäng den valda loggen. |
| Esc | Stäng detaljpanelen. |
| `/` | Hoppa till sökrutan. |
| ⌘ + Enter eller Ctrl + Enter | Tillämpa sökningen. |
| `?` | Visa eller dölj kortkommandona. |

## Felsökning

:::details Inga loggar visas
Vidga först tidsintervallet: Tittare öppnas på den senaste timmen. Är listan fortfarande tom jämför du din konfiguration med **Installationsguide** och kontrollerar att din rolls omfång täcker tjänsten som skickar loggarna.
:::

:::details Sökningen säger att tiden tog slut
En sökning som pågår längre än 45 sekunder avbryts. Välj ett kortare tidsintervall, eller lägg till ett exakt värde som en tjänst, så att OneUptime kan använda sitt index. Se [Söksyntax](/docs/telemetry/search-syntax#bra-att-veta).
:::

:::details Live stänger av sig hela tiden
Live-läget följer bara de nyaste loggarna, så en ändring av sökningen, ett filter, tidsintervallet eller sidan stänger av det. Klicka på **Live** igen när dina filter är på plats.
:::

## Nästa steg

:::cards
- [Söksyntax](/docs/telemetry/search-syntax): Varje filter som sökrutan förstår.
- [Loggövervakning](/docs/monitor/logs-monitor): Få en avisering när loggarna du söker efter dyker upp.
- [Loggpipelines](/docs/telemetry/log-pipelines): Gör delar av en loggrad till attribut du kan filtrera på.
- [Spårutforskare](/docs/telemetry/traces-explorer): Följ en loggs förfrågan genom dina tjänster.
:::

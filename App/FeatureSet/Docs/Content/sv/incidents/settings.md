# Inställningar och automatisering

Incidentkonfiguration bor inte i Projektinställningar. Den bor inne i produktområdet Incidenter självt, under **Incidenter → Inställningar** och **Incidenter → Regler**, på vägar som börjar med `/dashboard/{projectId}/incidents/settings/`. Om du har letat igenom **Projektinställningar** efter incidentmallar eller anpassade fält är det därför du inte hittade dem.

Både sektionen **Regler** och sektionen **Inställningar** i incidenternas sidomeny är ihopfällda som standard, så du måste fälla ut dem innan posterna nedan dyker upp. Allt här är projektbundet: mallar, roller, anpassade fält och regler tillhör ett projekt och gäller varje incident som deklareras i det.

Den här sidan är referensen för den konfigurationen — vad varje sida rymmer, och vilken del av den som körs automatiskt i samma stund som en incident skapas.

## Var incidentinställningarna bor

Öppna **Incidenter** i den vänstra navigeringen och fäll sedan ut **Inställningar** längst ner i sidomenyn.

| Sida                     | Vad du gör där                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| **Incidentstatus**       | Lägg till, byt namn, byt färg och ändra ordning på tillstånden en incident rör sig igenom.        |
| **Incidentallvar**       | Lägg till, byt namn, byt färg och ändra ordning på allvarlighetsnivåer.                           |
| **Incidentmallar**       | Förifyll en hel incident — titel, beskrivning, resurser, jourpolicyer, ägare, etiketter.          |
| **Anteckningsmallar**    | Återanvändbar text för offentliga och privata anteckningar.                                       |
| **Postmortem-mallar**    | Återanvändbara strukturer för efteranalys.                                                        |
| **Anpassade fält**       | Definiera extra fält som visas på varje incident.                                                 |
| **Incidentroller**       | Definiera rollerna du tilldelar de som svarar, som Incident Commander.                            |
| **Fler inställningar**   | Nummerprefixen för incidenter och incidentepisoder.                                               |

**Incidentstatus** och **Incidentallvar** täcks på djupet i [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — resten av den här sidan tar vid från **Incidentmallar**.

Fäll ut **Regler** så får du åtta sidor till: **Grupperingsregler**, **Jourregler**, **Ägarregler**, **Runbook-regler**, **Sekretessregler**, **Etikettregler**, **SLA-regler** och **Reminder Rules**. De täcks längre ner.

## Incidentmallar

En incidentmall är ett sparat skelett av en incident. I stället för att skriva om samma titel, samma monitorlista och samma jourpolicy varje gång betalningsklustret vacklar sparar du det en gång och deklarerar utifrån det.

Gå till **Incidenter → Inställningar → Incidentmallar** (`/dashboard/{projectId}/incidents/settings/templates`). Kortet har rubriken **Incidentmallar**. Att skapa en tar dig genom en sexstegsguide:

- **Mallinformation** — **Mallnamn** och **Mallbeskrivning**. De namnger själva mallen; de dyker aldrig upp på incidenten.
- **Incidentdetaljer** — **Titel**, **Beskrivning** (Markdown), **Incidentallvar** och **Inledande incidenttillstånd**. **Inledande incidenttillstånd** är valfritt och börjar tomt; dess alternativ listas i tillståndsordning. Lämna det tomt så hamnar incidenter från den här mallen i projektets skapade tillstånd.
- **Berörda resurser** — de monitorer, värdar, kluster och tjänster incidenten ska kopplas till, plus **Change Monitor Status to**.
- **Jour** — **Jourpolicy**, policyerna som ska köras när en incident skapad från den här mallen deklareras.
- **Ägare** — **Ägare – Team** och **Ägare – Användare**.
- **Etiketter** — **Etiketter**.

Några snabba regler:

- Mallistan visar bara **Namn** och **Beskrivning**. Rader kan inte redigeras eller raderas från listan — öppna en mall (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) för att ändra den.
- Mallar stöder JSON-import och -export, så du kan flytta en mellan projekt.
- Tomtillståndet lyder "Inga incidentmallar hittades."

### Hur en mall tillämpas

Det finns två vägar, och de beter sig likadant.

- **Från instrumentpanelen** — knappen **Skapa från mall** i incidentlistan öppnar väljaren **Välj incidentmall**, och deklarationssidan läser mallen från frågesträngsparametern `incidentTemplateId` och förifyller sedan formuläret med mallen plus dess ägarteam och ägaranvändare.
- **Från API:et** — skicka `createdIncidentTemplateId` på `POST /api/incident` så fyller servern incidenten från mallen.

Det viktiga är sammanfogningsregeln: **en mall fyller bara ett fält du lämnat odefinierat**. Titel, beskrivning, incidentallvar, inledande incidenttillstånd, monitorstatusen bakom **Change Monitor Status to**, monitorer, värdar, Kubernetes-kluster, Docker-värdar, Podman-värdar, tjänster, jourpolicyer och etiketter kopieras från mallen bara när anroparen eller formuläret inte angav något. Allt du sätter uttryckligen vinner alltid.

**Dialogen för tomtillståndet pekar åt fel håll.** Om du inte har några mallar ännu visar knappen **Skapa från mall** en dialog **No Incident Templates**. Dess text pekar mot Projektinställningar, men knappen leder till **Incidenter → Inställningar → Incidentmallar** — det är den riktiga platsen.

## Anteckningsmallar

Anteckningsmallar ger de som svarar färdig text för incidentuppdateringar, så att en statussideuppdatering klockan tre på natten inte skrivs från grunden av någon som är halvvaken.

Gå till **Incidenter → Inställningar → Anteckningsmallar** (`/dashboard/{projectId}/incidents/settings/note-templates`). Kortet har rubriken **Mallar för offentliga eller privata anteckningar för incidenter** — ett bibliotek betjänar båda anteckningstyperna. Skapandeformuläret har två steg:

- **Mallinformation** — **Mallnamn** och **Mallbeskrivning**, båda obligatoriska.
- **Anteckningsdetaljer** — själva anteckningstexten, i Markdown, obligatorisk.

Precis som incidentmallar skapas och visas rader snarare än redigeras direkt i listan; öppna en mall för att ändra den.

Anteckningsmallar dyker upp där du faktiskt behöver dem: bekräftelsedialogerna **Acknowledge Incident** och **Resolve Incident** erbjuder båda **Välj anteckningsmall** bredvid fältet **Offentlig anteckning**. Se [Incidentanteckningar, ägare och flöde](/docs/incidents/notes-owners-and-feed) för hur offentliga och privata anteckningar skiljer sig.

## Postmortem-mallar

En mall för efteranalys är skelettet till den sammanställning du producerar efter en incident — dina rubriker, dina ledtexter, dina stående frågor — så att varje genomgång i projektet följer samma form.

Gå till **Incidenter → Inställningar → Postmortem-mallar** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). Kortet har rubriken **Postmortem-mallar**. Skapandeformuläret har två steg:

- **Mallinformation** — **Mallnamn** och **Mallbeskrivning**, båda obligatoriska.
- **Detaljer för efteranalys** — **Mall för efteranalys**, själva brödtexten, i Markdown, obligatorisk.

Du tillämpar en från incidenten, inte från inställningarna. Öppna en incident, välj **Efteranalys** i dess sidomeny (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`) och använd **Tillämpa mall**. Det öppnar en dialog **Tillämpa mall för efteranalys** med en rullgardinsmeny **Välj mall**; att välja en läser in mallens brödtext i redigeraren **Anteckning för efteranalys**, där du redigerar den innan du sparar. Incidentepisoder har samma sida **Efteranalys** och hämtar från samma mallbibliotek.

## Anpassade fält

Anpassade fält låter dig bära egen metadata på varje incident — ett internt tjänstenamn, en referens till ett ändringsärende, en kundnivå.

Gå till **Incidenter → Inställningar → Anpassade fält** (`/dashboard/{projectId}/incidents/settings/custom-fields`). Sidan har rubriken **Anpassade incidentfält**. Varje definition har:

- **Fältnamn** — obligatoriskt, minst två tecken. Platshållaren föreslår ett slug-liknande namn som `internal-service`.
- **Fältbeskrivning** — valfri.
- **Fälttyp** — obligatorisk. Den väljer hur data matas in. Rullgardinstyper behöver även sina alternativ listade.
- **Alternativ för rullgardinsmeny** — värdena som visas i rullgardinsmenyn, vart och ett med en valfri färg.

Definitionerna bor i sin egen modell; värdena bor på själva incidenten i kolumnen `customFields`. På en enskild incident fyller du i dem från **Anpassade fält** i incidentens sidomeny (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**En lucka värd att känna till.** Definitioner av anpassade incidentfält är den enda delen av incidentfamiljen utan arbetsflödesutlösare — se arbetsflödesavsnittet nedan.

## Incidentroller

Incidentroller är de namngivna jobb du tilldelar personer under ett arbete. Definiera dem under **Incidenter → Inställningar → Incidentroller** (`/dashboard/{projectId}/incidents/settings/roles`); kortets beskrivning ger Incident Commander och Responder som exempel.

Roller är enbart definitioner. Du tilldelar personer till dem per incident — deklarationsguiden har ett steg **Incidentroller** med ett fält **Tilldela incidentroller**, och varje incident har en sida **Roller** i sin sidomeny.

## Nummerprefix

Varje incident får ett nummer. Som standard renderas det som `#42`. Om ditt team säger "INC-42" högt, få produkten att säga det också.

Gå till **Incidenter → Inställningar → Fler inställningar** (`/dashboard/{projectId}/incidents/settings/more`). Kortet är **Nummerprefix** och rymmer två fält på projektet:

- **Prefix för incidentnummer** — upp till 20 tecken, platshållare `INC-`. Sätt det så visas incident `#42` som `INC-42`.
- **Nummerprefix för incidentepisoder** — samma idé för nummer på incidentepisoder, platshållare `IE-`.

Lämna endera tomt för att behålla standardprefixet `#`; det osatta fältet visar `# (default)`. Spara med **Uppdatera**. Det prefixade värdet lagras på incidenten som `incidentNumberWithPrefix`, vilket är det som incidentlistan och incidentens sidhuvud renderar.

## Regler som körs när en incident skapas

**Incidenter → Regler** rymmer åtta regelmotorer. De gör alla samma jobb — titta på en incident i samma stund den skapas och agera om den matchar — men de skiljer sig i vad de gör och i hur flera matchande regler löses upp.

- **Grupperingsregler** — gruppera relaterade incidenter till episoder. Regler utvärderas i prioritetsordning; lägre prioritetsnummer går först.
- **Jourregler** — kör jourpolicyer för matchande incidenter. Täcks i detalj nedan.
- **Ägarregler** — tilldela ägare automatiskt.
- **Runbook-regler** — starta ett [runbook](/docs/runbooks/index) när en incident matchar.
- **Sekretessregler** — avgör om en matchande incident är privat.
- **Etikettregler** — tillämpa etiketter automatiskt.
- **SLA-regler** — följ upp svars- och lösningstider. Regler utvärderas i ordning; lägre ordningsnummer går först.
- **Reminder Rules** — påminn incidentens ägare periodiskt medan en incident fortfarande är öppen. Regler utvärderas i ordning och den första matchande regeln vinner.

**Ordningssemantiken är inte enhetlig.** Grupperingsregler, SLA-regler och Reminder Rules utvärderas i ordning. Jourregler gör det inte — varje matchande regel utlöses. Anta inte att en modell gäller för alla åtta.

Sidorna **Jourregler**, **Ägarregler**, **Etikettregler** och **Sekretessregler** har flikar — en flik **Incident Rules** och en flik **Episode Rules**, var och en med sin egen tabell. Konfigurera fliken **Incident Rules** om du inte uttryckligen menar episoder. **Grupperingsregler**, **Runbook-regler**, **SLA-regler** och **Reminder Rules** är enskilda tabeller.

## Jourregler för incidenter

**Incidenter → Regler → Jourregler** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) är där du gör larmningen automatisk. Kortet, **Incidentjourregler**, beskriver regler som automatiskt kör jourpolicyer när matchande incidenter skapas. Sidan har två flikar: **Incident Rules** och **Episode Rules**.

Skapandeformuläret har tre steg:

- **Grundläggande information** — **Namn** (platshållaren föreslår något i stil med att larma databasteamet för varje DB-incident), **Beskrivning** och en växel **Aktiverad**. Listan renderar ett grönt **Aktiverad** eller rött **Inaktiverad** piller per regel.
- **Matchningskriterier** — **Monitorer**, **Incident Allvarligheter**, **Incidentetiketter**, **Övervakningsetiketter**, plus skiftlägesokänsliga fält för reguljära uttryck för incidenttitel, incidentbeskrivning, monitornamn och monitorbeskrivning.
- **Jourpolicyer** — policyerna den här regeln kör.

### Hur matchningen löses upp

Reglerna som sidan själv levereras med är värda att lägga på minnet:

- En regel matchar bara när **alla** kriterier du fyllt i går igenom. Kriterier du lämnat tomma hoppas över, de underkänns inte.
- Inom ett enskilt listkriterium — **Monitorer**, **Incident Allvarligheter**, **Incidentetiketter**, **Övervakningsetiketter** — är matchningen någon-av.
- Mönsterfälten är skiftlägesokänsliga reguljära uttryck.
- **Alla matchande regler utlöses.** Det finns ingen prioritet och ingen kortslutning.
- Mängden policyer som faktiskt körs är unionen av varje matchande regels policyer plus alla policyer som kopplats till incidenten manuellt eller av en mall, dubblettfritt så att varje policy körs högst en gång.

Allvarlighetsgrad är ett matchningskriterium här och ingen annanstans. Det finns inget jourfält på en incidentallvarlighet — att välja "Critical Incident" larmar inte någon av sig själv. Om du vill att allvarlighetsgrad ska driva larmning, skriv en jourregel som matchar på den.

## Koppla jourpolicyer direkt

Regler är inte den enda vägen. Varje incident bär en egen lista över jourpolicyer, som visas som fältet **Jourpolicy** i steget **Jour** i deklarationsguiden och i steget **Jour** i en incidentmall. Fältets beskrivning säger det rakt ut: det här är de jourpolicyer som ska köras när den här incidenten skapas.

När en incident skapas kör OneUptime etikettregler, sedan jourregler (som flätar in sina matchande policyer i incidentens lista), sedan runbook-regler — och om den resulterande listan inte är tom körs varje policy i den. Körningar sker parallellt och avgörs oberoende, så att en policy misslyckas stoppar inte de andra. Varje körning taggas med incidenten som utlöste den och med aviseringshändelsetypen för skapad incident.

För att se vad som hände, öppna incidenten och välj **Jourexekveringar** i dess sidomeny (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Driva incidenter från arbetsflöden

Arbetsflödesutlösare för incidenter är inte handskrivna — OneUptime genererar dem från datamodellerna, så varje modell i incidentfamiljen får komponenterna **On Create X**, **On Update X** och **On Delete X**, namngivna efter modellens singularnamn. De tre viktigaste är **On Create Incident**, **On Update Incident** och **On Delete Incident**, och de bor i kategorin **Incident** i panelen **Lägg till komponent** på `/dashboard/{projectId}/workflows`.

Samma generering ger dig utlösare för själva konfigurationen: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** med flera. Varje modell får också matchande åtgärdskomponenter — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** och deras flerradsmotsvarigheter — så att en utlösare och en åtgärd med liknande namn ligger sida vid sida i samma kategori. **On Create Incident** startar ett arbetsflöde; **Create One Incident** öppnar en incident.

Några detaljer som spelar roll när du kopplar ihop dessa:

- **On Update X** tar ett valfritt argument **Listen on** som begränsar utlösaren till uppdateringar som rör specifika fält. Lämna det tomt för att utlösa vid varje ändring. Om en uppdatering kommer in utan uppgift om vilka fält som ändrades hoppas filtret över och arbetsflödet körs ändå.
- **On Create X** och **On Update X** tar båda ett obligatoriskt argument **Select Fields**; **On Delete X** tar inga argument.
- Alla tre exponerar en enda utgångsport **Framgång**, och var och en tar emot ett ID-argument så att du kan köra arbetsflödet för hand mot en post.
- Namnen kommer från modellens singularnamn, inte dess tabellnamn — vilket är varför du ser **On Create Incident Team Owner** och **On Create Incident User Owner** i stället för tabellformade namn.
- Det finns inga utlösare för definitioner av anpassade incidentfält. Den modellen är den enda medlemmen i incidentfamiljen med arbetsflöden avstängda.

För att bygga resten av arbetsflödet, se [Skapa ett arbetsflöde](/docs/workflows/authoring) och [Arbetsflödesvariabler](/docs/workflows/variables).

## Läs vidare

- [Incidenter – Översikt](/docs/incidents/index) — hur incidentfunktionen hänger ihop.
- [Deklarera en incident](/docs/incidents/declaring-incidents) — deklarationsguiden, mallar och API:et.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — inställningssidorna för tillstånd och allvarlighetsgrad och vad flaggorna gör.
- [Incidentanteckningar, ägare och flöde](/docs/incidents/notes-owners-and-feed) — var anteckningsmallar används.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers) — vem som får höra om en incident utanför ditt team.
- [Översikt över arbetsflöden](/docs/workflows/index) — automatisera ovanpå incidentutlösare.
- [Runbooks – Översikt](/docs/runbooks/index) — procedurerna som runbook-regler kopplar på.

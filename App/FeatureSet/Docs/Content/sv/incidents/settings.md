# Inställningar och automatisering

Incidentkonfigurationen bor inte i **Projektinställningar**. Den bor inne i produktområdet Incidenter, under **Incidenter → Inställningar** och **Incidenter → Regler**, på rutter som börjar med `/dashboard/{projectId}/incidents/settings/`. Har du letat igenom **Projektinställningar** efter incidentmallar eller anpassade fält är det därför du inte hittade dem.

Både **Regler** och **Inställningar** i incidenternas sidomeny är ihopfällda som standard, så du måste fälla ut dem innan posterna nedan dyker upp. Allt här hör till projektet: mallar, roller, anpassade fält och regler tillhör ett projekt och gäller varje incident som deklareras i det.

Den här sidan är referensen för den konfigurationen — vad varje sida innehåller, och vad av det som körs automatiskt i samma stund som en incident skapas.

## Var incidentinställningarna finns

Öppna **Incidenter** i vänsternavigeringen och fäll sedan ut **Inställningar** längst ned i sidomenyn.

| Sida                     | Vad du gör där                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Incidentstatus**       | Lägg till, byt namn, byt färg på och ordna om de tillstånd en incident rör sig genom.                       |
| **Incidentallvar**       | Lägg till, byt namn, byt färg på och ordna om allvarlighetsgrader.                                          |
| **Incidentmallar**       | Förifyll en hel incident — titel, beskrivning, resurser, jourpolicyer, ägare, etiketter.                    |
| **Anteckningsmallar**    | Återanvändbar text för offentliga och privata anteckningar.                                                 |
| **Postmortem-mallar**    | Återanvändbara strukturer för efteranalyser.                                                                |
| **Anpassade fält**       | Definiera extrafält som visas på varje incident.                                                            |
| **Incidentroller**       | Definiera de roller du tilldelar svarspersoner, till exempel Incident Commander.                            |
| **Fler inställningar**   | Nummerprefixen för incidenter och incidentepisoder.                                                         |

**Incidentstatus** och **Incidentallvar** behandlas på djupet i [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — resten av den här sidan tar vid från **Incidentmallar**.

Fäll ut **Regler** så får du åtta sidor till: **Grupperingsregler**, **Jourregler**, **Ägarregler**, **Runbook-regler**, **Sekretessregler**, **Etikettregler**, **SLA-regler** och **Reminder Rules**. De behandlas längre ned.

## Incidentmallar

En incidentmall är ett sparat skelett av en incident. I stället för att skriva in samma titel, samma monitorlista och samma jourpolicy på nytt varje gång betalningsklustret vacklar sparar du det en gång och deklarerar utifrån det.

Gå till **Incidenter → Inställningar → Incidentmallar** (`/dashboard/{projectId}/incidents/settings/templates`). Kortet heter **Incidentmallar**. Att skapa en mall tar dig genom en guide i sex steg:

- **Mallinformation** — **Mallnamn** och **Mallbeskrivning**. De namnger mallen i sig; de syns aldrig på incidenten.
- **Incidentdetaljer** — **Titel**, **Beskrivning** (Markdown), **Incidentallvar** och **Inledande incidenttillstånd**. **Inledande incidenttillstånd** är valfritt och börjar tomt; alternativen listas i tillståndsordning. Lämnar du det tomt hamnar incidenter från mallen i projektets skapade tillstånd.
- **Berörda resurser** — de monitorer, värdar, kluster och tjänster incidenten ska kopplas till, plus **Ändra övervakningsstatus till**.
- **Jour** — **Jourpolicy**, alltså de policyer som ska köras när en incident skapad från den här mallen deklareras.
- **Ägare** — **Ägare – Team** och **Ägare – Användare**.
- **Etiketter** — **Etiketter**.

Några snabba regler:

- Mallistan visar bara **Namn** och **Beskrivning**. Rader går varken att redigera eller radera från listan — öppna en mall (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) för att ändra den.
- Mallar stöder import och export som JSON, så du kan flytta en mellan projekt.
- Det tomma tillståndet lyder "Inga incidentmallar hittades."

### Så tillämpas en mall

Det finns två vägar, och de beter sig likadant.

- **Från instrumentpanelen** — knappen **Skapa från mall** i incidentlistan öppnar väljaren **Välj incidentmall**, och deklarationssidan läser mallen från frågesträngsparametern `incidentTemplateId` och förifyller sedan formuläret med mallen plus dess ägarteam och ägaranvändare.
- **Från API:et** — skicka med `createdIncidentTemplateId` på `POST /api/incident` så fyller servern incidenten från mallen.

Det viktiga är sammanslagningsregeln: **en mall fyller bara i ett fält som du lämnat odefinierat**. Titel, beskrivning, incidentallvar, inledande incidenttillstånd, monitorstatusen bakom **Ändra övervakningsstatus till**, monitorer, värdar, Kubernetes-kluster, Docker-värdar, Podman-värdar, tjänster, jourpolicyer och etiketter kopieras från mallen bara när anroparen eller formuläret inte angav något. Det du sätter uttryckligen vinner alltid.

**Dialogen för tomt tillstånd pekar på fel ställe.** Har du inga mallar ännu visar knappen **Skapa från mall** dialogen **No Incident Templates**. Texten i den pekar mot Projektinställningar, men knappen leder till **Incidenter → Inställningar → Incidentmallar** — det är den riktiga platsen.

## Anteckningsmallar

Anteckningsmallar ger svarspersoner färdig text för incidentuppdateringar, så att en statussideuppdatering klockan tre på natten inte behöver skrivas från grunden av någon halvvaken.

Gå till **Incidenter → Inställningar → Anteckningsmallar** (`/dashboard/{projectId}/incidents/settings/note-templates`). Kortet heter **Mallar för offentliga eller privata anteckningar för incidenter** — ett och samma bibliotek betjänar båda anteckningstyperna. Formuläret har två steg:

- **Mallinformation** — **Mallnamn** och **Mallbeskrivning**, båda obligatoriska.
- **Anteckningsdetaljer** — själva anteckningstexten, i Markdown, obligatorisk.

Precis som incidentmallar skapas och visas rader snarare än redigeras direkt i listan; öppna en mall för att ändra den.

Anteckningsmallarna dyker upp där du faktiskt behöver dem: bekräftelsedialogerna **Acknowledge Incident** och **Resolve Incident** erbjuder båda **Välj anteckningsmall** bredvid fältet **Offentlig anteckning**. Se [Incidentanteckningar, ägare och flöde](/docs/incidents/notes-owners-and-feed) för hur offentliga och privata anteckningar skiljer sig åt.

## Postmortem-mallar

En postmortem-mall är skelettet till den genomgång du skriver efter en incident — dina rubriker, dina frågeställningar, era stående frågor — så att varje genomgång i projektet följer samma form.

Gå till **Incidenter → Inställningar → Postmortem-mallar** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). Kortet heter **Postmortem-mallar**. Formuläret har två steg:

- **Mallinformation** — **Mallnamn** och **Mallbeskrivning**, båda obligatoriska.
- **Detaljer för efteranalys** — **Mall för efteranalys**, alltså själva texten, i Markdown, obligatorisk.

Du tillämpar en mall från incidenten, inte från inställningarna. Öppna en incident, välj **Efteranalys** i dess sidomeny (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`) och använd **Tillämpa mall**. Det öppnar dialogen **Tillämpa mall för efteranalys** med rullgardinsmenyn **Välj mall**; väljer du en laddas malltexten in i redigeraren **Anteckning för efteranalys**, där du redigerar den innan du sparar. Incidentepisoder har samma sida **Efteranalys** och hämtar ur samma mallbibliotek.

## Anpassade fält

Med anpassade fält bär du med dig egna metadata på varje incident — ett internt tjänstenamn, en referens till ett ändringsärende, en kundnivå.

Gå till **Incidenter → Inställningar → Anpassade fält** (`/dashboard/{projectId}/incidents/settings/custom-fields`). Sidan heter **Anpassade incidentfält**. Varje definition har:

- **Fältnamn** — obligatoriskt, minst två tecken. Platshållaren föreslår ett sluglikt namn i stil med `internal-service`.
- **Fältbeskrivning** — valfri.
- **Fälttyp** — obligatorisk. Den avgör hur data matas in. Rullgardinstyper behöver dessutom sina alternativ listade.
- **Alternativ för rullgardinsmeny** — de värden som visas i menyn, vart och ett med en valfri färg.

Definitionerna bor i en egen modell; värdena bor på själva incidenten i kolumnen `customFields`. På en enskild incident fyller du i dem från **Anpassade fält** i incidentens sidomeny (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**En lucka värd att känna till.** Definitioner av anpassade incidentfält är den enda delen av incidentfamiljen utan arbetsflödesutlösare — se avsnittet om arbetsflöden nedan.

## Incidentroller

Incidentroller är de namngivna uppdrag du tilldelar personer under ett arbete. Definiera dem under **Incidenter → Inställningar → Incidentroller** (`/dashboard/{projectId}/incidents/settings/roles`); kortets beskrivning ger Incident Commander och Responder som exempel.

Rollerna är bara definitioner. Du tilldelar personer till dem per incident — deklarationsguiden har ett steg **Incidentroller** med fältet **Tilldela incidentroller**, och varje incident har en sida **Roller** i sin sidomeny.

## Nummerprefix

Varje incident får ett nummer. Som standard renderas det som `#42`. Säger ert team "INC-42" högt är det värt att få produkten att säga det också.

Gå till **Incidenter → Inställningar → Fler inställningar** (`/dashboard/{projectId}/incidents/settings/more`). Kortet heter **Nummerprefix** och rymmer två fält på projektet:

- **Prefix för incidentnummer** — upp till 20 tecken, platshållare `INC-`. Sätt det så visas incident `#42` som `INC-42`.
- **Nummerprefix för incidentepisoder** — samma sak för nummer på incidentepisoder, platshållare `IE-`.

Lämna endera tomt för att behålla standardprefixet `#`; det osatta fältet visas som `# (default)`. Spara med **Uppdatera**. Det prefixade värdet lagras på incidenten som `incidentNumberWithPrefix`, och det är det som incidentlistan och incidentens rubrik renderar.

## Regler som körs när en incident skapas

**Incidenter → Regler** rymmer åtta regelmotorer. De gör alla samma sak — tittar på en incident i samma stund som den skapas och agerar om den matchar — men de skiljer sig i vad de gör och i hur flera matchande regler löses upp.

- **Grupperingsregler** — grupperar besläktade incidenter till episoder. Regler utvärderas i prioritetsordning; lägre prioritetsnummer går först.
- **Jourregler** — kör jourpolicyer för matchande incidenter. Behandlas i detalj nedan.
- **Ägarregler** — tilldelar ägare automatiskt.
- **Runbook-regler** — startar ett [runbook](/docs/runbooks/index) när en incident matchar.
- **Sekretessregler** — avgör om en matchande incident är privat.
- **Etikettregler** — sätter etiketter automatiskt.
- **SLA-regler** — följer upp svars- och lösningstider. Regler utvärderas i ordning; lägre ordningsnummer går först.
- **Reminder Rules** — påminner incidentägare med jämna mellanrum så länge en incident är öppen. Regler utvärderas i ordning och första matchande regel vinner.

**Ordningssemantiken är inte enhetlig.** Grupperingsregler, SLA-regler och Reminder Rules utvärderas i ordning. Jourregler gör det inte — varje matchande regel avfyras. Utgå inte från att en och samma modell gäller alla åtta.

Sidorna **Jourregler**, **Ägarregler**, **Etikettregler** och **Sekretessregler** har flikar — en flik **Incident Rules** och en flik **Episode Rules**, var och en med sin egen tabell. Konfigurera fliken **Incident Rules** om du inte uttryckligen menar episoder. **Grupperingsregler**, **Runbook-regler**, **SLA-regler** och **Reminder Rules** är enkla tabeller.

## Jourregler för incidenter

**Incidenter → Regler → Jourregler** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) är där du gör larmningen automatisk. Kortet **Incidentjourregler** beskriver regler som automatiskt kör jourpolicyer när matchande incidenter skapas. Sidan har två flikar: **Incident Rules** och **Episode Rules**.

Formuläret har tre steg:

- **Grundläggande information** — **Namn** (platshållaren föreslår något i stil med att larma databasteamet vid varje DB-incident), **Beskrivning** och en växel **Aktiverad**. Listan renderar en grön **Aktiverad** eller röd **Inaktiverad** etikett per regel.
- **Matchningskriterier** — **Monitorer**, **Incident Allvarligheter**, **Incidentetiketter**, **Övervakningsetiketter**, plus reguljära uttryck utan skiftlägeskänslighet för incidentens titel, incidentens beskrivning, monitorns namn och monitorns beskrivning.
- **Jourpolicyer** — de policyer den här regeln kör.

### Så avgörs matchningen

Reglerna som sidan själv levereras med är värda att lära sig utantill:

- En regel matchar bara när **alla** kriterier du fyllt i går igenom. Kriterier du lämnat tomma hoppas över, de underkänns inte.
- Inom ett enskilt listkriterium — **Monitorer**, **Incident Allvarligheter**, **Incidentetiketter**, **Övervakningsetiketter** — räcker det att något värde matchar.
- Mönsterfälten är reguljära uttryck utan skiftlägeskänslighet.
- **Alla matchande regler avfyras.** Det finns ingen prioritet och ingen kortslutning.
- Den uppsättning policyer som faktiskt körs är unionen av varje matchande regels policyer plus eventuella policyer som kopplats till incidenten manuellt eller av en mall, avdubblerad så att varje policy körs högst en gång.

Allvarlighetsgrad är ett matchningskriterium här och ingen annanstans. Det finns inget jourfält på en incidentallvarlighet — att välja "Kritisk incident" larmar inte någon i sig. Vill du att allvarlighetsgrad ska styra larmningen skriver du en jourregel som matchar på den.

## Koppla jourpolicyer direkt

Regler är inte enda vägen. Varje incident bär en egen lista med jourpolicyer, som visas som fältet **Jourpolicy** i steget **Jour** i deklarationsguiden och i steget **Jour** i en incidentmall. Fältbeskrivningen säger det rakt ut: det här är de jourpolicyer som ska köras när incidenten skapas.

När en incident skapas kör OneUptime etikettregler, sedan jourregler (som slår ihop sina matchande policyer med incidentens lista) och sedan runbook-regler — och är den resulterande listan inte tom körs varje policy i den. Körningarna sker parallellt och avgörs var för sig, så att en policy som misslyckas inte stoppar de andra. Varje körning märks med incidenten som utlöste den och med aviseringshändelsetypen för skapad incident.

För att se vad som hände öppnar du incidenten och väljer **Jourexekveringar** i dess sidomeny (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Styra incidenter från arbetsflöden

Arbetsflödesutlösare för incidenter är inte handskrivna — OneUptime genererar dem från datamodellerna, så varje modell i incidentfamiljen får komponenterna **On Create X**, **On Update X** och **On Delete X**, namngivna efter modellens singularnamn. De tre viktigaste är **On Create Incident**, **On Update Incident** och **On Delete Incident**, och du hittar dem under kategorin **Incident** i panelen **Lägg till komponent** på `/dashboard/{projectId}/workflows`.

Samma generering ger dig utlösare för själva konfigurationen: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** med flera. Varje modell får dessutom motsvarande åtgärdskomponenter — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** och deras flerradsvarianter — så att en utlösare och en åtgärd med snarlika namn ligger sida vid sida i samma kategori. **On Create Incident** startar ett arbetsflöde; **Create One Incident** öppnar en incident.

Några detaljer som spelar roll när du kopplar ihop dem:

- **On Update X** tar ett valfritt argument **Listen on** som smalnar av utlösaren till uppdateringar som rör vissa fält. Lämna det tomt för att avfyra vid varje ändring. Kommer en uppdatering in utan uppgift om vilka fält som ändrats hoppas filtret över och arbetsflödet körs ändå.
- **On Create X** och **On Update X** tar båda ett obligatoriskt argument **Select Fields**; **On Delete X** tar inga argument.
- Alla tre exponerar en enda utport **Framgång**, och var och en tar emot ett ID-argument så att du kan köra arbetsflödet för hand mot en enskild post.
- Namnen kommer från modellens singularnamn, inte från dess tabellnamn — det är därför du ser **On Create Incident Team Owner** och **On Create Incident User Owner** i stället för tabellformade namn.
- Det finns inga utlösare för definitioner av anpassade incidentfält. Den modellen är den enda i incidentfamiljen med arbetsflöden avstängda.

För att bygga resten av arbetsflödet, se [Skapa ett arbetsflöde](/docs/workflows/authoring) och [Arbetsflödesvariabler](/docs/workflows/variables).

## Läs vidare

- [Incidenter – Översikt](/docs/incidents/index) — hur incidentfunktionen hänger ihop.
- [Deklarera en incident](/docs/incidents/declaring-incidents) — deklarationsguiden, mallarna och API:et.
- [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities) — inställningssidorna för tillstånd och allvarlighetsgrad, och vad flaggorna gör.
- [Incidentanteckningar, ägare och flöde](/docs/incidents/notes-owners-and-feed) — där anteckningsmallarna kommer till användning.
- [Prenumeranter och meddelanden](/docs/status-pages/subscribers) — vilka som får veta om en incident utanför ert team.
- [Översikt över arbetsflöden](/docs/workflows/index) — att automatisera ovanpå incidentutlösarna.
- [Runbooks – Översikt](/docs/runbooks/index) — de rutiner som runbook-regler kopplar in.

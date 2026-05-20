# Skapa ett arbetsflöde

Skapa ett arbetsflöde under **Workflows → Create Workflow**, ge det ett namn och en valfri beskrivning, och öppna sedan **Builder**-fliken för att börja släppa noder på arbetsytan.

## Arbetsytan

Builder är en zoom- och panorerbar graf. Du lägger till noder från en komponentpalett, kopplar ihop dem med kanter och konfigurerar varje nods argument i en sidopanel. En sparindikator i sidhuvudet talar om för dig om din senaste redigering har sparats.

Ett arbetsflöde börjar alltid med exakt en **utlösar**-nod. Utlösare har ingen ingångsport — det är där exekveringen börjar. Allt nedströms är en **komponent**.

## En nods anatomi

Varje nod har:

| Fält | Syfte |
| --- | --- |
| **Titel** | Etiketten som visas på arbetsytan. Standard är komponentens namn; skriv över det för att göra komplexa arbetsflöden enklare att läsa. |
| **Argument** | Den konfiguration som komponenten behöver för att göra sitt jobb — en URL, en Slack-kanal, en JavaScript-snutt, etc. Obligatoriska argument är markerade med en asterisk. |
| **Ingångsportar** | Kontakter på vänster sida av noden där inkommande kanter landar. Komponenter har en ingångsport som heter `in`; utlösare har inga. |
| **Utgångsportar** | Kontakter på höger sida där utgående kanter börjar. Komponenter definierar portar som `success`, `error`, `yes`, `no`. |
| **Returvärden** | Data som noden producerar — utdatan från dess utgångsportar. Nedströmsnoder refererar till dessa som `{{NodeId.fieldName}}`. |

## Koppla noder

Dra från en utgångsport till en nedströmsnods ingångsport för att skapa en kant. En kant från `success` kör den grenen endast när uppströmsnoden lyckades; en kant från `error` körs endast när den misslyckades. Om du inte kopplar en port slutar den grenen helt enkelt.

Du kan fördela ut: en utgångsport kan mata flera nedströmsnoder, och de körs alla parallellt från den punkten.

## Konfigurera argument

Klicka på en nod för att öppna dess sidopanel. Varje argument har en typad redigerare:

- **Text / URL / E-post / Nummer / Lösenord** — en enrads-inmatning.
- **JSON** — en JSON-redigerare med syntaxmarkering och en valideringsindikator.
- **JavaScript** — en kodredigerare för snuttar som används av **Custom Code**-komponenten.
- **Markdown / HTML** — rich-text-kroppar för e-post- och meddelandekomponenter.
- **CronTab** — ett schema-uttryck (används av Schedule-utlösaren).
- **Boolean** — en växel.
- **Select / Query** — rullgardinsmenyer för fält som tar en fast uppsättning värden eller en modellliknande fråga.

Alla textfält accepterar variabelinterpolation — se [Variabler](/docs/workflows/variables) för reglerna.

## Ett minimalistiskt första arbetsflöde

Det snabbaste sättet att få känsla för arbetsytan:

1. Släpp en **Manual**-utlösare.
2. Släpp en **Log**-komponent (under **Utils**). Koppla utlösarens utgångsport till Log-komponentens ingångsport.
3. I Log-komponentens argument, skriv `Hello from {{Manual.JSON.name}}`.
4. Spara och aktivera arbetsflödet.
5. Klicka på **Run Manually**, klistra in `{ "name": "Ada" }` som indata och skicka.
6. Öppna **Logs**-fliken. Den senaste körningen visar Log-nodens fångade utdata: `Hello from Ada`.

Den rundresan — dra, koppla, konfigurera, kör, granska — är rytmen för att skapa varje arbetsflöde.

## Spara, aktivera och testa i produktion

Arbetsflöden lagras som en JSON-graf i kolumnen `Workflow.graph`. Builder sparar medan du redigerar; sparindikatorn i sidhuvudet visar när den senaste ändringen har nått servern. Det finns inget separat "publicera"-steg.

Men: ett arbetsflöde triggar bara sin utlösare när **isEnabled** är på. Nya arbetsflöden levereras inaktiverade. Behandla den flaggan som din "redo för produktion"-omkopplare — bygg, klicka på **Run Manually** för att torrköra med en exempel-payload, titta på **Logs**, och slå först därefter på Enable.

Om du behöver pausa ett arbetsflöde utan att ta bort det (t.ex. under en orelaterad incident), slå av **isEnabled** i **Settings**. Befintliga pågående körningar fortsätter; inga nya startar.

## Omordna och omorganisera

- Dra en nod för att flytta den. Positionen sparas i grafen så att nästa person som öppnar arbetsytan ser samma layout.
- Högerklicka på en kant för att ta bort den; högerklicka på en nod för borttagnings- och dupliceringsalternativ.
- För breda arbetsflöden, lägg ut dem från vänster till höger så att exekveringsriktningen matchar din läsriktning.

## Var läsa vidare

- [Utlösare](/docs/workflows/triggers) — de fyra utlösarfamiljerna och vad var och en exponerar som returvärden.
- [Komponenter](/docs/workflows/components) — den fullständiga katalogen och deras argument.
- [Variabler](/docs/workflows/variables) — hur du refererar till data mellan noder och från globala variabler.
- [Körningar & loggar](/docs/workflows/runs-and-logs) — hur du felsöker ett arbetsflöde som missköter sig.

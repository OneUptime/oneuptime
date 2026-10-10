# AI- / LLM-observerbarhet med OneUptime

Läs varje konversation som din AI har haft, spela upp den igen som den hände och få veta när den svarar dåligt. Allt bygger på standard-OpenTelemetry, utan proprietärt SDK: om din app skickar spans enligt OpenTelemetrys **GenAI-semantiska konventioner** (`gen_ai.*`) gör OneUptime om dem till konversationer, varningar, användning och kostnad.

## Det här får du

Öppna **AI / LLM** i navigeringsfältet, under Observerbarhet:

- **Konversationer** — varje konversation som din AI har haft: vad folk frågade, vad AI:n svarade, vilka verktyg den använde och vad som gick fel. Ovanför listan står fem siffror: konversationer, AI-svar, hur många som behöver uppmärksamhet, kostnad och hur lång tid ett svar brukar ta. Öppna en konversation för att läsa den eller spela upp den igen.
- **Anrop** — varje LLM-, embedding-, agent- och verktygsanrop, filtrerbart på tjänst, leverantör, modell, operation, person och team. Klicka på ett anrop för att öppna det i trace-visningen.
- **Användning** — anropen, tokens och kostnaden under en tidsperiod, och vem som spenderar vad: anställda, team, modeller, leverantörer och appar rangordnade efter kostnad.
- **Varningar** — färdiga varningar för när AI:n svarar dåligt, och dina AI- / LLM-monitorer.
- **Budgetar** — dagliga kostnadsgränser, publicerade som mätvärden att varna på.
- **Priser** — dina egna priser per modell, för modeller som den inbyggda katalogen inte känner till.
- **Inställning** — de fem stegen nedan, med ditt projekts endpoint.

I trace-visningen har spannet för varje AI-anrop också en **AI / LLM**-panel med modell, antal tokens, kostnad, förfrågningsparametrar samt prompt och completion.

## Steg 1 — Skicka dina AI-anrop

Skapa en intagningsnyckel för telemetri: öppna **Projektinställningar → Telemetri och APM → Intagningsnycklar** och klicka på **Skapa ingestion-nyckel**. Din app skickar nyckeln som en OTLP-header. (Se [OpenTelemetry-guiden](/docs/telemetry/open-telemetry) för skärmbilder.)

Instrumentera sedan appen med valfritt OpenTelemetry-GenAI-bibliotek:

- **OpenLLMetry** (Traceloop) — OpenAI, Anthropic, Cohere, Bedrock, LangChain, LlamaIndex, CrewAI med flera.
- **OpenInference** (Arize) — OpenAI, LangChain, LlamaIndex, DSPy med flera.
- **Vercel AI SDK**, eller **OpenTelemetry-instrumenteringarna** för OpenAI, Anthropic och Gemini.

Skickar du din LLM-trafik genom en gateway som **LiteLLM** eller **Portkey**? Exportera traces från gatewayen i stället för att instrumentera varje app — se [Observera AI-gatewayer](/docs/telemetry/ai-gateways). Letar du efter kodassistenterna som dina utvecklare använder — Claude Code, Cursor, Codex, Gemini CLI, Copilot? De exporterar sin egen OpenTelemetry och behöver inget från dig: se [Observerbarhet för AI-kodassistenter](/docs/telemetry/ai-coding-assistants).

### Python (OpenLLMetry)

```bash
pip install traceloop-sdk opentelemetry-exporter-otlp
```

```python
from traceloop.sdk import Traceloop

Traceloop.init(
    app_name="my-ai-agent",
    api_endpoint="https://oneuptime.com/otlp",   # or your self-hosted host + /otlp
    headers={"x-oneuptime-token": "YOUR_INGESTION_TOKEN"},
)

# Your normal OpenAI / Anthropic / LangChain calls are now traced automatically.
```

### Node.js / TypeScript (OpenLLMetry)

```bash
npm install @traceloop/node-server-sdk
```

```ts
import * as traceloop from "@traceloop/node-server-sdk";

traceloop.initialize({
  appName: "my-ai-agent",
  baseUrl: "https://oneuptime.com/otlp", // or your self-hosted host + /otlp
  headers: { "x-oneuptime-token": "YOUR_INGESTION_TOKEN" },
});
```

### Vanliga OpenTelemetry-miljövariabler

Om du instrumenterar med ett inbyggt OpenTelemetry-SDK pekar du OTLP-exportören mot OneUptime:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
export OTEL_SERVICE_NAME="my-ai-agent"
```

Driver du OneUptime själv? Ersätt `https://oneuptime.com/otlp` med `https://YOUR-ONEUPTIME-HOST/otlp`.

## Steg 2 — Spela in det som sades

En konversation visar vad folk frågade och vad AI:n svarade när din instrumentering spelar in det. OpenLLMetry spelar in prompts och completions om du inte stänger av det (`TRACELOOP_TRACE_CONTENT=false`). OpenTelemetry-instrumenteringarna spelar bara in dem när du ber om det:

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

Utan dem visar en konversation ändå sina tider, sin kostnad och sina problem, och anger att innehållet inte spelades in. Prompts kan innehålla känsliga data: se [Integritet och maskering](#integritet-och-maskering) för att dölja dem innan de lagras.

## Steg 3 — Gruppera anrop i konversationer

En chattapp gör ett modellanrop per tur. Sätt `gen_ai.conversation.id` — eller `session.id` — till chattens id på varje AI-anrop, så visas varje chatt som en enda konversation, hur många anrop och traces den än krävde. Med OpenLLMetry sätter du det en gång per förfrågan som en association property:

```python
from traceloop.sdk import Traceloop

Traceloop.set_association_properties({
    "session_id": chat.id,
    "user_email": user.email,
})
```

Anrop utan konversations-id visas ändå, en förfrågan (ett trace) i taget.

## Steg 4 — Ange vem som frågade

Sätt `user.id` eller `user.email` — association propertyn ovan sätter e-postadressen — för att se vem varje konversation var med, söka i listan efter person och rangordna kostnaden per anställd på fliken Användning. [Tillskrivning till anställda och team](#tillskrivning-till-anställda-och-team) listar alla nycklar som OneUptime läser.

## Steg 5 — Flagga dåliga svar

OneUptime kontrollerar varje svar när det kommer in och markerar vad som gick fel med det:

| Problem       | Vad det betyder                                                   | Hittas utifrån                                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Misslyckades  | Anropet slutade med ett fel, så inget svar kom fram               | Span-status Error, `error.type` eller en finish reason `error`                                                                                                                       |
| Nekad         | AI:n avböjde, eller ett säkerhetsfilter blockerade den            | En finish reason för nekande eller säkerhet (`content_filter`, `refusal`, `SAFETY` och liknande), ett nekande i svaret, eller ett svar som börjar med ett typiskt engelskt nekande |
| Avkortad      | Svaret stannade vid tokengränsen                                  | En finish reason `length`, `max_tokens` eller `MAX_TOKENS`                                                                                                                           |
| Tom           | AI:n svarade utan text och utan verktygsanrop                     | Inspelat innehåll som inte innehåller något, eller 0 utdatatokens                                                                                                                    |
| Flaggad       | En utvärdering som din app skickade sa att svaret var dåligt      | En `gen_ai.evaluation.result`-händelse                                                                                                                                               |

De fyra första kräver inget av dig. För att flagga resten — ett svar som ditt guardrail, din eval eller din egen LLM-domare avvisar — lägger du till en `gen_ai.evaluation.result`-händelse på svarets span, med `gen_ai.evaluation.score.label` satt till `fail`:

```python
from opentelemetry import trace

trace.get_current_span().add_event(
    "gen_ai.evaluation.result",
    {
        "gen_ai.evaluation.name": "relevance",
        "gen_ai.evaluation.score.label": "fail",
        "gen_ai.evaluation.explanation": "The answer is about another product.",
    },
)
```

Etiketter som `incorrect`, `wrong`, `unhelpful`, `toxic`, `unsafe` och `hallucination` räknas också som underkända. Händelsen måste ligga på spannet för svaret den bedömer, medan det spannet är öppet.

OneUptime skickar aldrig dina konversationer till en annan AI för bedömning: varje kontroll läser bara det som anropet självt bär.

## Läs och spela upp en konversation igen

En konversation öppnas i sin helhet, så som en chattapp visar sin historik: det personen sa till höger, AI:ns svar till vänster med modell, tid, tokens och kostnad, verktygsanrop mellan dem, och det som gick fel markerat där det hände. **Detaljer** under ett svar visar dess finish reason och utvärderingar, med en länk till anropet i Spår.

Fältet längst ned spelar upp konversationen så som personen upplevde den:

- **Spela upp igen** spelar den från det första meddelandet i den takt den hände, med ”AI:n svarar…” som räknar upp medan ett svar är på väg. Klicka på tiden för valfritt meddelande för att spela upp därifrån.
- **Hoppa över väntan**, som är på som standard, kortar tystnader längre än 3 sekunder. Hastighetsknappen spelar upp i 1×, 2×, 4× eller 8×.
- **K** spelar upp eller pausar, **J** eller **←** går tillbaka ett meddelande, och **L** eller **→** går framåt ett.
- Adressen sparar meddelandet där en uppspelning stannade (`?step=`), så att en länk öppnas på just det ögonblicket.

## Få veta när AI:n svarar dåligt

Fliken **Varningar** erbjuder de varningar som de flesta AI-appar vill ha. När du väljer en öppnas Skapa monitor redan ifyllt, och du kan ändra vad som helst innan du sparar:

| Varning                  | När den säger till                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Svar blir fel            | Mer än 5 % av svaren under 15 minuter misslyckas, nekas, avkortas, är tomma eller flaggas          |
| AI-anrop misslyckas      | Mer än 10 % av anropen till modellen under 5 minuter slutar med ett fel                            |
| AI:n vägrar svara        | Mer än 5 % av svaren under 30 minuter är nekanden                                                  |
| Svar avkortas            | 3 eller fler svar under 30 minuter stannar vid tokengränsen                                        |
| Svar flaggas             | En utvärdering markerar ett svar som dåligt                                                        |
| Svar är långsamma        | Mer än 10 % av svaren under 15 minuter tar längre tid än 30 sekunder                               |
| AI:n slutar svara        | AI:n ger inga svar på 30 minuter                                                                   |

Varningarna på en andel väntar också på minst 3 dåliga svar, så att ett dåligt svar av två inte väcker någon.

Varje varning är en **AI / LLM**-monitor. Dess inställningar anger vad som räknas som ett dåligt svar — problemen ovan, ett svar som är långsammare än en gräns du sätter, eller båda —, vilka appar och vilken modell den bevakar, och hur långt bakåt varje kontroll tittar. Under dem visar en förhandsvisning vad monitorn skulle räkna just nu. Dess kriterier jämför tre tal: **andelen dåliga svar** (i %), **antalet dåliga svar** och **antalet svar**. En färdig varning utlöser en varning som löser sig själv och visar monitorn som Försämrad så länge svaren är dåliga; slå i stället på dess incident för att larma någon.

Kostnaden bevakas av de [dagliga kostnadsbudgetarna](#dagliga-kostnadsbudgetar).

## Attribut som OneUptime känner igen

OneUptime läser OpenTelemetrys GenAI-konventioner först och faller tillbaka på varianterna från OpenLLMetry och OpenInference, så att populära bibliotek fungerar direkt.

| Vad                                  | Primärt attribut             | Accepteras också                                                                                                                                                                                                                                                          |
| ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leverantör / system                  | `gen_ai.provider.name`       | `gen_ai.system` (föråldrat i konventionerna, men skickas fortfarande ofta), `llm.system`, `llm.provider`                                                                                                                                                                 |
| Operation                            | `gen_ai.operation.name`      | `llm.request.type`, `openinference.span.kind`                                                                                                                                                                                                                             |
| Begärd modell                        | `gen_ai.request.model`       | `llm.model_name`, `llm.request.model`                                                                                                                                                                                                                                     |
| Svarsmodell                          | `gen_ai.response.model`      | `llm.response.model`                                                                                                                                                                                                                                                      |
| Indatatokens                         | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`, `llm.token_count.prompt`, `llm.usage.prompt_tokens`                                                                                                                                                                                         |
| Utdatatokens                         | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.token_count.completion`, `llm.usage.completion_tokens`                                                                                                                                                                             |
| Tokens totalt                        | `gen_ai.usage.total_tokens`  | `llm.token_count.total`, `llm.usage.total_tokens`; härleds från indata + utdata när inget av dem rapporteras                                                                                                                                                              |
| Kostnad (USD)                        | `gen_ai.usage.cost`          | `gen_ai.usage.cost_usd`, `gen_ai.usage.total_cost`, `llm.usage.total_cost`, `gen_ai.cost.total_cost` (LiteLLM), `litellm.cost.total`                                                                                                                                      |
| Agentnamn                            | `gen_ai.agent.name`          | `agent.name`                                                                                                                                                                                                                                                              |
| Verktygsnamn                         | `gen_ai.tool.name`           | `tool.name`                                                                                                                                                                                                                                                               |
| Konversations- / sessions-id         | `gen_ai.conversation.id`     | `session.id`, `langfuse.session.id`, `traceloop.association.properties.session_id`                                                                                                                                                                                        |
| Anställd (som gjorde anropet)        | `user.id`                    | `enduser.id`, `litellm.metadata.user_api_key_user_id` och `metadata.user_api_key_user_id` (stavningarna i LiteLLM OTel v2 och v1 — båda läses), `traceloop.association.properties.user_id`, `langfuse.user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id` |
| Den anställdes e-post                | `user.email`                 | `traceloop.association.properties.user_email`, `enduser.email`                                                                                                                                                                                                            |
| Team / kostnadsställe                | `team.id`                    | `team`, `cost_center`, `department`, `litellm.metadata.user_api_key_team_id` och `litellm.team.id` (LiteLLM OTel v2), `metadata.user_api_key_team_id` (LiteLLM OTel v1), `cursor.team.id`                                                                                 |

Undernycklarna under `traceloop.association.properties.*` **tillhandahålls av anroparen**: Traceloop definierar prefixet och din kod tillhandahåller det som står under det. `gen_ai.usage.total_tokens` och `gen_ai.usage.cost` är **de facto**-nycklar, inte GenAI-semantiska konventioner — konventionerna definierar varken ett attribut för totala tokens eller ett för kostnad —, och OneUptime läser dem eftersom de vanliga instrumenteringarna skickar dem. `gen_ai.system` är konventionernas egen föråldrade föregångare till `gen_ai.provider.name`; båda läses.

**De tre identitetsraderna matchas också med ett `resource.`-prefix.** OTLP-intag plattar ut varje _resurs_-attribut i spannets attributkarta under ett `resource.`-prefix, så `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` kommer in som `resource.team.id`. OneUptime söker först igenom hela listan utan prefix och sedan hela `resource.`-listan, så att ett span-attribut (som beskriver ett anrop) vinner över ett resursattribut (som beskriver hela processen). De övriga raderna matchas bara på nyckeln utan prefix: de är värden per anrop.

**Innehåll från prompts och completions** läses från händelsen `gen_ai.client.inference.operation.details`; från span-attributen `gen_ai.input.messages`, `gen_ai.output.messages` och `gen_ai.system_instructions`; från de **föråldrade** händelserna per roll som äldre instrumenteringar fortfarande skickar (`gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.tool.message`, `gen_ai.assistant.message`, `gen_ai.choice`); från de indexerade attributen (`gen_ai.prompt.N.content` och `gen_ai.completion.N.content`, och i OpenInference `llm.input_messages.N.message.content` och `llm.output_messages.N.message.content`); och från JSON-meddelandearrayerna (`gen_ai.prompt`, `gen_ai.completion`, `input.value`, `output.value`).

### Hur kostnaden beräknas

Om din instrumentering rapporterar en kostnad (`gen_ai.usage.cost`) använder OneUptime den som den är: det rapporterade värdet vinner alltid. När ingen kostnad rapporteras beräknar OneUptime en **uppskattad kostnad vid intag** utifrån spannets antal tokens och en inbyggd listpriskatalog över vanliga modeller från OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, xAI, Cohere, Amazon Nova och Meta Llama. Modeller matchas på namnprefix, så daterade ögonblicksbilder som `gpt-4o-2024-08-06` och id:n med leverantörstillägg som `us.anthropic.claude-3-5-sonnet-20241022-v2:0` slås upp korrekt. Okända eller egna modeller gissas aldrig — deras kostnad förblir `0` tills du ger dem ett pris på fliken **Priser**. Uppskattningarna använder listpriser och tar inte hänsyn till cache- eller batchrabatter.

Driver du OneUptime själv? Katalogen finns i `packages/Common/Types/Telemetry/LlmCostCatalog.ts`.

## Tillskrivning till anställda och team

”Vem av våra utvecklare spenderade 4 000 $ på Opus förra månaden?” är en fråga om en person, och inget LLM-span besvarar den om inte något på spannet nämner någon. OneUptime kopierar den mänskliga aktören till sökbara kolumner vid intag, så att du grupperar och filtrerar på en kolumn i stället för att skriva attributuppslag.

De tre identitetsraderna i tabellen ovan är hela mekanismen; den första nyckeln som finns vinner, i den angivna ordningen. `user.id` står först eftersom det är OpenTelemetrys kanoniska nyckel för en mänsklig aktör och den du bör standardisera på om du sätter identiteten själv. **Ett undantag: Claude Code** skickar `user.id` som en slumpmässig anonym identifierare som sparas i `~/.claude.json`, inte som en person. Det är ofarligt på dess mätvärdesdatapunkter, vars lista börjar med e-postadressen, men om du slår på Claude Codes traces-beta rankas det anonyma `user.id` före `user.email` på spannen: ta bort eller mappa om `user.id` i en collector-processor för den flottan. `enduser.id` är fortfarande ett aktivt attribut i de semantiska konventionerna och accepteras som ett likvärdigt alias. `cursor.user.id` kommer sist eftersom det är ett ogenomskinligt, teambegränsat heltal som kräver Cursors administrations-API för att kopplas till en person.

Identitet läses bara på spans som redan har känts igen som LLM-anrop: `user.id`, `user.email` och `team.id` är generiska nycklar som även webbläsar- och vanliga backend-spans bär. **Mätvärdesdatapunkter** bär en kortare lista som börjar med e-postadressen — `user.email`, `user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id`, med team från `team.id`, `team`, `cost_center`, `department` och `cursor.team.id`, var och en också matchad med `resource.`-prefixet —, eftersom de kodagent-CLI:er som skickar mätvärden utan spans skickar `user.email` direkt. Inget läser identitet från **loggposter** i dag.

### Ange team och kostnadsställe

Ingen instrumentering skickar `team.id`, `team`, `cost_center` eller `department`: din organisation sätter dem, vanligtvis via `OTEL_RESOURCE_ATTRIBUTES` på processen:

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

De når OneUptime som `resource.team.id`, `resource.team`, `resource.cost_center` och `resource.department`, och båda nivåerna känns igen på spans och på mätvärdesdatapunkter, oavsett om din exportör lämnar nycklarna i OTLP-resursblocket eller kopierar dem till varje span (Claude Code gör det senare). Ett `team.id` utan prefix som sätts direkt på ett span vinner fortfarande.

Gatewayernas stavningar kommer in utan någon konfiguration från din sida. LiteLLM namnger sina attribut olika i sina två OpenTelemetry-lägen — standard-v1-callbacken `otel` använder ett rent `metadata.`-prefix (`metadata.user_api_key_user_id`, `metadata.user_api_key_user_email`, `metadata.user_api_key_team_id`), det valfria v2-läget (`LITELLM_OTEL_V2=true`) namnrymden `litellm.` —, och **OneUptime läser båda**.

### Kundnycklarna är uteslutna med avsikt

Ett LLM-span kan bära **två** olika personer: den anställda som gjorde anropet och **kunden** längre ned i kedjan som det gjordes för. De här nycklarna bär kunden, och OneUptime läser medvetet **ingen** av dem till en identitetskolumn:

- `gen_ai.user` och `llm.user` — så som instrumenteringar återger OpenAIs förfrågningsparameter `user`, som OpenAI dokumenterar som ”a stable identifier for your end-users” (nu föråldrad till förmån för `safety_identifier` och `prompt_cache_key`).
- `litellm.metadata.user_api_key_end_user_id`, `metadata.user_api_key_end_user_id` och `litellm.end_user.id` — LiteLLMs uttryckliga slutanvändar-id i alla tre stavningar, skilt från nyckelägarens id, som **är** den anställda och **läses**.

Skälet är korrekt internfakturering: läser man ett kund-id in i kolumnen för anställda skapar en supportbot som betjänar 40 000 kunder 40 000 fantom-”anställda”, medan utvecklaren som äger kostnaden verkar inte ha spenderat något. De här attributen ligger kvar i den råa attributkartan, där du kan fråga efter dem direkt.

### Identitetskolumner rensas

Kolumnen med den anställdas e-post innehåller riktiga personuppgifter. Dina telemetri-**Scrub-regler** inom omfånget **Attribut** täcker den precis som de täcker attributet den lästes från, så en regel som maskerar e-postadresser gäller också för kolumnen. Konfigurera scrub-regler och drop-filter under **Spår → Inställningar**.

## Spans och mätvärden är en reserv, inte en summa

**GenAI-spans är auktoritativa. Mätvärdesflödet används bara när span-flödet inte har rapporterat något, och de två läggs aldrig ihop.** Ett span bär modell, tokens och kostnad på en rad, så där det finns spans besvarar de varje fråga. Där det inte finns några — kodagent-CLI:erna publicerar _mätvärden_ för tokens och kostnad och inga GenAI-spans — träder mätvärdesflödet in. De summeras inte eftersom många instrumenteringar skickar båda signalerna för samma anrop (OpenLLMetry är det vanliga fallet), och att lägga ihop dem skulle räkna varje dollar två gånger.

Konsekvensen att planera för: **så snart dina GenAI-spans rapporterar en siffra som inte är noll syns inte bidraget från en källa med bara mätvärden i den siffran.** Reserven gäller per siffra och per uppdelning, inte per avsändare:

| Var                                            | Vad som faller tillbaka på mätvärden                             | När                                           |
| ---------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| Användning → Indatatokens / Utdatatokens       | Summor av indata- och utdatatokens                               | Båda token-summorna från spans är 0           |
| Användning → Kostnad (USD)                     | Kostnad, i USD och mikro-USD, skalad och sammanlagd              | Kostnadssumman från spans är 0                |
| Användning → LLM-anrop                         | Inget — bara spans                                               | —                                             |
| Användning → Anställd, Team, Modell            | Bara kostnad. Kolumnerna för anrop och tokens visar `—`          | Den uppdelningen returnerade inga span-rader  |
| Användning → Leverantör, Applikation / Tjänst  | Inget — bara spans                                               | —                                             |
| Konversationer                                 | Inget — konversationer byggs från spans                          | —                                             |

Leverantör och Applikation / Tjänst har ingen mätvärdesreserv eftersom kodagenternas räknare inte bär något GenAI-leverantörsattribut och inte är kopplade till någon telemetritjänst i OneUptime. Överallt där en siffra kom från mätvärden märker sidan den **från GenAI-mätvärden**, eftersom en siffra från mätvärden inte har några motsvarande rader i listan Anrop.

**Om kostnaden för ett verktyg med bara mätvärden ska synas för sig, ge det ett eget projekt**, så att dess span-flöde verkligen är tomt och reserven slår till. Detsamma gäller budgetar: avgränsa en budget per tjänst i stället för att blanda tjänster som skickar spans med tjänster som bara skickar mätvärden.

## Dashboards och mätvärdesvarningar

GenAI-mätvärden kommer in som vanliga OpenTelemetry-mätvärden, så du kan bygga **dashboards** som visar `gen_ai.client.token.usage`, `gen_ai.client.operation.duration` och resten i diagram, och skapa **mätvärdesmonitorer** för dem — till exempel när p95 för `gen_ai.client.operation.duration` passerar ett tröskelvärde, grupperat per modell. Se [Metrikövervakning](/docs/monitor/metrics-monitor).

## Dagliga kostnadsbudgetar

Fliken **Budgetar** sätter dagliga gränser i USD, utvärderade över UTC-dygnet. Var 15:e minut summerar en bakgrundsarbetare dagens LLM-span-kostnad (rapporterad eller beräknad), registrerar den på budgeten och publicerar två gauge-mätvärden:

| Mätvärde                            | Betydelse                                       |
| ----------------------------------- | ----------------------------------------------- |
| `oneuptime.llm.budget.spend.usd`    | Dagens kostnad hittills, i USD                  |
| `oneuptime.llm.budget.percent.used` | Kostnaden i procent av den dagliga gränsen      |

Båda bär attributen `oneuptime.llm.budget.id` och `oneuptime.llm.budget.name`, plus budgetens avgränsning till tjänst, leverantör och modell när den är satt. Filtrera monitorer på **`oneuptime.llm.budget.id`**, som är stabilt; namnet ändras när du byter namn på budgeten.

**Varningar görs med en [Metrikövervakning](/docs/monitor/metrics-monitor) på de mätvärdena.** För det klassiska mönstret 80 % / 100 % skapar du en monitor på `oneuptime.llm.budget.percent.used`, filtrerar den på `oneuptime.llm.budget.id` och lägger till två kriterier: `>= 80` som skapar en vanlig varning och `>= 100` som skapar en kritisk. **Sätt monitorns rullande tid till 30 minuter**: en budget publicerar en punkt var 15:e minut, så standardfönstret på 1 minut skulle hitta en tom serie mellan två genomgångar.

Budgetar kan avgränsas till en telemetritjänst, en LLM-leverantör eller en exakt modell, eller gälla hela projektet, och flera kan finnas samtidigt. En budgetmonitor kan också anropa ett Workflow som stoppar en skenande agent — se [Circuit breakers för skenande AI-agenter](/docs/telemetry/ai-agent-circuit-breaker).

## Integritet och maskering

Prompts och completions kan innehålla känsliga data. OneUptime tillämpar dina telemetri-**Scrub-regler** och **Drop-filter** på LLM-spans som på vilket annat trace som helst, så att du kan maskera attribut eller kasta spans innan de lagras; konfigurera dem under **Spår → Inställningar**. Kolumnen med den anställdas e-post omfattas av samma regler — se [Identitetskolumner rensas](#identitetskolumner-rensas).

Konversationer läses med samma behörighet som traces: den som kan läsa projektets traces kan läsa dess konversationer, och ingen annan.

## Relaterat

- [Observerbarhet för AI-kodassistenter](/docs/telemetry/ai-coding-assistants) — stödmatrisen för Claude Code, Cursor, Codex, Gemini CLI, Copilot, Cline och de andra, och hur kostnad per anställd fungerar mellan dem.
- [Övervaka Claude Code](/docs/telemetry/claude-code)
- [Övervaka Cursor](/docs/telemetry/cursor)
- [Övervaka OpenAI Codex CLI](/docs/telemetry/openai-codex)
- [Övervaka Gemini CLI och GitHub Copilot](/docs/telemetry/gemini-cli-and-copilot)
- [Observera AI-gatewayer (LiteLLM och Portkey)](/docs/telemetry/ai-gateways)
- [Circuit breakers för skenande AI-agenter](/docs/telemetry/ai-agent-circuit-breaker)

# AI- / LLM-observability med OneUptime

Læs hver samtale, din AI har haft, afspil den, som den skete, og få besked, når den svarer dårligt. Det hele kører på standard-OpenTelemetry uden proprietært SDK: Hvis din app udsender spans med OpenTelemetrys **GenAI-semantiske konventioner** (`gen_ai.*`), gør OneUptime dem til samtaler, advarsler, forbrug og omkostninger.

## Det får du

Åbn **AI / LLM** i navigationslinjen under Observabilitet:

- **Samtaler** — hver samtale, din AI har haft: hvad folk spurgte om, hvad AI'en svarede, hvilke værktøjer den brugte, og hvad der gik galt. Over listen står fem tal: samtaler, AI-svar, hvor mange der kræver opmærksomhed, omkostning, og hvor lang tid et svar typisk tager. Åbn en samtale for at læse den eller afspille den igen.
- **Kald** — hvert LLM-, embedding-, agent- og værktøjskald, som kan filtreres efter tjeneste, udbyder, model, operation, person og team. Klik på et kald for at åbne det i trace-fremviseren.
- **Forbrug** — kald, tokens og omkostning i et tidsrum, og hvem der bruger hvad: medarbejdere, teams, modeller, udbydere og apps rangeret efter forbrug.
- **Advarsler** — færdige advarsler til, når AI'en svarer dårligt, og dine AI- / LLM-monitorer.
- **Budgetter** — daglige omkostningsgrænser, udgivet som metrikker, du kan sætte advarsler på.
- **Priser** — dine egne priser pr. model, til modeller, som det indbyggede katalog ikke kender.
- **Opsætning** — de fem trin nedenfor med dit projekts endpoint.

I trace-fremviseren har spannet for hvert AI-kald også et **AI / LLM**-panel med model, antal tokens, omkostning, forespørgselsparametre samt prompt og completion.

## Trin 1 — Send dine AI-kald

Opret en telemetri-indtagelsesnøgle: Åbn **Projektindstillinger → Telemetri og APM → Indtagelsesnøgler**, og klik på **Opret ingestion-nøgle**. Din app sender nøglen som en OTLP-header. (Se [OpenTelemetry-vejledningen](/docs/telemetry/open-telemetry) for skærmbilleder.)

Instrumentér derefter din app med et hvilket som helst OpenTelemetry-GenAI-bibliotek:

- **OpenLLMetry** (Traceloop) — OpenAI, Anthropic, Cohere, Bedrock, LangChain, LlamaIndex, CrewAI og flere.
- **OpenInference** (Arize) — OpenAI, LangChain, LlamaIndex, DSPy og flere.
- **Vercel AI SDK** eller **OpenTelemetry-instrumenteringerne** til OpenAI, Anthropic og Gemini.

Sender du din LLM-trafik gennem en gateway som **LiteLLM** eller **Portkey**? Eksportér traces fra gatewayen i stedet for at instrumentere hver app — se [Observering af AI-gateways](/docs/telemetry/ai-gateways). Leder du efter de kodeassistenter, dine udviklere bruger — Claude Code, Cursor, Codex, Gemini CLI, Copilot? De eksporterer deres eget OpenTelemetry og behøver intet fra dig: se [Observability for AI-kodeassistenter](/docs/telemetry/ai-coding-assistants).

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

### Almindelige OpenTelemetry-miljøvariabler

Hvis du instrumenterer med et native OpenTelemetry-SDK, så peg OTLP-eksportøren mod OneUptime:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
export OTEL_SERVICE_NAME="my-ai-agent"
```

Hoster du selv OneUptime? Erstat `https://oneuptime.com/otlp` med `https://YOUR-ONEUPTIME-HOST/otlp`.

## Trin 2 — Registrér, hvad der blev sagt

En samtale viser, hvad folk spurgte om, og hvad AI'en svarede, når din instrumentering registrerer det. OpenLLMetry registrerer prompts og completions, medmindre du slår det fra (`TRACELOOP_TRACE_CONTENT=false`). OpenTelemetry-instrumenteringerne registrerer dem kun, når du beder om det:

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

Uden dem viser en samtale stadig sin timing, sin omkostning og sine problemer og fortæller, at indholdet ikke blev registreret. Prompts kan indeholde følsomme data: Se [Privatliv og redigering](#privatliv-og-redigering) for at maskere dem, før de gemmes.

## Trin 3 — Saml kald i samtaler

En chat-app laver ét modelkald pr. tur. Sæt `gen_ai.conversation.id` — eller `session.id` — til din chats id på hvert AI-kald, så vises hver chat som én samtale, uanset hvor mange kald og traces den tog. Med OpenLLMetry sætter du det én gang pr. forespørgsel som en association property:

```python
from traceloop.sdk import Traceloop

Traceloop.set_association_properties({
    "session_id": chat.id,
    "user_email": user.email,
})
```

Kald uden samtale-id vises stadig, én forespørgsel (ét trace) ad gangen.

## Trin 4 — Angiv, hvem der spurgte

Sæt `user.id` eller `user.email` — association property'en ovenfor sætter e-mailen — for at se, hvem hver samtale var med, søge i listen efter person og rangere forbruget efter medarbejder på fanen Forbrug. [Tilskrivning til medarbejdere og teams](#tilskrivning-til-medarbejdere-og-teams) viser alle de nøgler, OneUptime læser.

## Trin 5 — Markér dårlige svar

OneUptime tjekker hvert svar, når det ankommer, og markerer, hvad der gik galt med det:

| Problem      | Hvad det betyder                                                | Fundet ud fra                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mislykkedes  | Kaldet endte med en fejl, så der kom intet svar                 | Span-status Error, `error.type` eller en finish reason på `error`                                                                                                                 |
| Afvist       | AI'en sagde nej, eller et sikkerhedsfilter blokerede den        | En finish reason for afvisning eller sikkerhed (`content_filter`, `refusal`, `SAFETY` og lignende), en afvisning i svaret eller et svar, der begynder med en typisk engelsk afvisning |
| Afkortet     | Svaret stoppede ved token-grænsen                               | En finish reason på `length`, `max_tokens` eller `MAX_TOKENS`                                                                                                                     |
| Tom          | AI'en svarede uden tekst og uden værktøjskald                   | Registreret indhold, der ikke indeholder noget, eller 0 output-tokens                                                                                                             |
| Markeret     | En evaluering, som din app sendte, sagde, at svaret var dårligt | En `gen_ai.evaluation.result`-event                                                                                                                                               |

De første fire kræver intet af dig. For at markere resten — et svar, som dit guardrail, din eval eller din egen LLM-dommer afviser — tilføjer du en `gen_ai.evaluation.result`-event til svarets span med `gen_ai.evaluation.score.label` sat til `fail`:

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

Labels som `incorrect`, `wrong`, `unhelpful`, `toxic`, `unsafe` og `hallucination` tæller også som ikke bestået. Eventen skal ligge på spannet for det svar, den bedømmer, mens det span er åbent.

OneUptime sender aldrig dine samtaler til en anden AI for at få dem bedømt: Hvert tjek læser kun det, kaldet selv bærer.

## Læs og afspil en samtale igen

En samtale åbner i sin helhed, sådan som en chat-app viser sin historik: Det, personen sagde, til højre, AI'ens svar til venstre med model, tid, tokens og omkostning, værktøjskald imellem dem, og det, der gik galt, markeret der, hvor det skete. **Detaljer** under et svar viser dets finish reason og evalueringer med et link til kaldet i Spor.

Bjælken i bunden afspiller samtalen, som personen oplevede den:

- **Afspil igen** afspiller den fra den første besked i det tempo, den skete, mens „AI'en svarer…“ tæller op, så længe et svar er på vej. Klik på tidspunktet for en vilkårlig besked for at afspille derfra.
- **Spring ventetid over**, som er slået til som standard, forkorter pauser på mere end 3 sekunder. Hastighedsknappen afspiller med 1×, 2×, 4× eller 8×.
- **K** afspiller eller sætter på pause, **J** eller **←** går én besked tilbage, og **L** eller **→** går én frem.
- Adressen husker den besked, en afspilning stoppede ved (`?step=`), så et link åbner på netop det tidspunkt.

## Få besked, når AI'en svarer dårligt

Fanen **Advarsler** tilbyder de advarsler, de fleste AI-apps har brug for. Når du vælger en, åbner Opret monitor allerede udfyldt, og du kan ændre alt, før du gemmer:

| Advarsel                       | Hvornår den giver besked                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Svar går galt                  | Mere end 5 % af svarene inden for 15 minutter mislykkes, afvises, afkortes, er tomme eller markeres |
| AI-kald mislykkes              | Mere end 10 % af kaldene til modellen inden for 5 minutter ender med en fejl                    |
| AI'en nægter at svare          | Mere end 5 % af svarene inden for 30 minutter er afvisninger                                    |
| Svar bliver afkortet           | 3 eller flere svar inden for 30 minutter stopper ved token-grænsen                              |
| Svar bliver markeret           | En evaluering markerer et svar som dårligt                                                      |
| Svar er langsomme              | Mere end 10 % af svarene inden for 15 minutter tager længere end 30 sekunder                    |
| AI'en holder op med at svare   | AI'en giver ingen svar i 30 minutter                                                            |

Advarslerne på en andel venter også på mindst 3 dårlige svar, så ét dårligt svar ud af to ikke vækker nogen.

Hver advarsel er en **AI / LLM**-monitor. Dens indstillinger angiver, hvad der tæller som et dårligt svar — problemerne ovenfor, et svar, der er langsommere end en grænse, du sætter, eller begge dele —, hvilke apps og hvilken model den overvåger, og hvor langt hvert tjek kigger tilbage. Under dem viser en forhåndsvisning, hvad monitoren ville tælle lige nu. Dens kriterier sammenligner tre tal: **andelen af dårlige svar** (i %), **antallet af dårlige svar** og **antallet af svar**. En færdig advarsel udløser en advarsel, der løser sig selv, og viser monitoren som Forringet, så længe svarene er dårlige; slå i stedet dens hændelse til for at tilkalde nogen.

Forbruget overvåges af de [daglige omkostningsbudgetter](#daglige-omkostningsbudgetter).

## Attributter, som OneUptime genkender

OneUptime læser først OpenTelemetrys GenAI-konventioner og falder tilbage på OpenLLMetry- og OpenInference-varianterne, så populære biblioteker virker med det samme.

| Hvad                                 | Primær attribut              | Accepteres også                                                                                                                                                                                                                                                           |
| ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Udbyder / system                     | `gen_ai.provider.name`       | `gen_ai.system` (forældet i konventionerne, men stadig meget udsendt), `llm.system`, `llm.provider`                                                                                                                                                                      |
| Operation                            | `gen_ai.operation.name`      | `llm.request.type`, `openinference.span.kind`                                                                                                                                                                                                                             |
| Anmodet model                        | `gen_ai.request.model`       | `llm.model_name`, `llm.request.model`                                                                                                                                                                                                                                     |
| Svarmodel                            | `gen_ai.response.model`      | `llm.response.model`                                                                                                                                                                                                                                                      |
| Input-tokens                         | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`, `llm.token_count.prompt`, `llm.usage.prompt_tokens`                                                                                                                                                                                         |
| Output-tokens                        | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.token_count.completion`, `llm.usage.completion_tokens`                                                                                                                                                                             |
| Tokens i alt                         | `gen_ai.usage.total_tokens`  | `llm.token_count.total`, `llm.usage.total_tokens`; udledt af input + output, når ingen af dem rapporteres                                                                                                                                                                |
| Omkostning (USD)                     | `gen_ai.usage.cost`          | `gen_ai.usage.cost_usd`, `gen_ai.usage.total_cost`, `llm.usage.total_cost`, `gen_ai.cost.total_cost` (LiteLLM), `litellm.cost.total`                                                                                                                                      |
| Agentnavn                            | `gen_ai.agent.name`          | `agent.name`                                                                                                                                                                                                                                                              |
| Værktøjsnavn                         | `gen_ai.tool.name`           | `tool.name`                                                                                                                                                                                                                                                               |
| Samtale- / session-id                | `gen_ai.conversation.id`     | `session.id`, `langfuse.session.id`, `traceloop.association.properties.session_id`                                                                                                                                                                                        |
| Medarbejder (som foretog kaldet)     | `user.id`                    | `enduser.id`, `litellm.metadata.user_api_key_user_id` og `metadata.user_api_key_user_id` (stavemåderne fra LiteLLM OTel v2 og v1 — begge læses), `traceloop.association.properties.user_id`, `langfuse.user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id` |
| Medarbejderens e-mail                | `user.email`                 | `traceloop.association.properties.user_email`, `enduser.email`                                                                                                                                                                                                            |
| Team / omkostningssted               | `team.id`                    | `team`, `cost_center`, `department`, `litellm.metadata.user_api_key_team_id` og `litellm.team.id` (LiteLLM OTel v2), `metadata.user_api_key_team_id` (LiteLLM OTel v1), `cursor.team.id`                                                                                  |

Undernøglerne under `traceloop.association.properties.*` **leveres af den, der kalder**: Traceloop definerer præfikset, og din kode leverer det, der står under det. `gen_ai.usage.total_tokens` og `gen_ai.usage.cost` er **de facto**-nøgler, ikke GenAI-semantiske konventioner — konventionerne definerer hverken en attribut for samlede tokens eller en for omkostning —, og OneUptime læser dem, fordi de almindelige instrumenteringer udsender dem. `gen_ai.system` er konventionernes egen forældede forgænger for `gen_ai.provider.name`; begge læses.

**De tre identitetsrækker matches også med et `resource.`-præfiks.** OTLP-indtagelse flader hver _ressource_-attribut ud i spannets attributkort under et `resource.`-præfiks, så `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` ankommer som `resource.team.id`. OneUptime gennemsøger først hele listen uden præfiks og derefter hele `resource.`-listen, så en span-attribut (som beskriver ét kald) slår en ressource-attribut (som beskriver hele processen). De øvrige rækker matches kun på nøglen uden præfiks: De er værdier pr. kald.

**Indhold fra prompts og completions** læses fra eventen `gen_ai.client.inference.operation.details`; fra span-attributterne `gen_ai.input.messages`, `gen_ai.output.messages` og `gen_ai.system_instructions`; fra de **forældede** events pr. rolle, som ældre instrumenteringer stadig udsender (`gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.tool.message`, `gen_ai.assistant.message`, `gen_ai.choice`); fra de indekserede attributter (`gen_ai.prompt.N.content` og `gen_ai.completion.N.content`, og i OpenInference `llm.input_messages.N.message.content` og `llm.output_messages.N.message.content`); og fra JSON-beskedarrays (`gen_ai.prompt`, `gen_ai.completion`, `input.value`, `output.value`).

### Sådan beregnes omkostningen

Hvis din instrumentering rapporterer en omkostning (`gen_ai.usage.cost`), bruger OneUptime den uændret: Den rapporterede værdi vinder altid. Når der ikke rapporteres nogen omkostning, beregner OneUptime en **anslået omkostning ved indtagelse** ud fra spannets antal tokens og et indbygget listeprisskatalog over almindelige modeller fra OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, xAI, Cohere, Amazon Nova og Meta Llama. Modeller matches på navnepræfiks, så daterede snapshots som `gpt-4o-2024-08-06` og id'er med leverandørpræfiks som `us.anthropic.claude-3-5-sonnet-20241022-v2:0` slås korrekt op. Ukendte eller brugerdefinerede modeller gættes aldrig — deres omkostning forbliver `0`, indtil du giver dem en pris på fanen **Priser**. Overslag bruger listepriser og tager ikke højde for cache- eller batchrabatter.

Hoster du selv OneUptime? Kataloget ligger i `packages/Common/Types/Telemetry/LlmCostCatalog.ts`.

## Tilskrivning til medarbejdere og teams

„Hvem af vores udviklere brugte 4.000 $ på Opus sidste måned?“ er et spørgsmål om en person, og intet LLM-span besvarer det, medmindre noget på spannet nævner en. OneUptime kopierer den menneskelige aktør til forespørgbare kolonner ved indtagelse, så du grupperer og filtrerer på en kolonne i stedet for at skrive attributopslag.

De tre identitetsrækker i tabellen ovenfor er hele mekanismen; den første nøgle, der findes, vinder, i den angivne rækkefølge. `user.id` står først, fordi det er OpenTelemetrys kanoniske nøgle for en menneskelig aktør og den, du bør standardisere på, hvis du selv sætter identiteten. **Én undtagelse: Claude Code** udsender `user.id` som en tilfældig anonym identifikator gemt i `~/.claude.json`, ikke som en person. Det er harmløst på dens metrik-datapunkter, hvis liste begynder med e-mailen, men hvis du slår Claude Codes traces-beta til, rangerer det anonyme `user.id` over `user.email` på spannene: Fjern eller omdøb `user.id` i en collector-processor for den flåde. `enduser.id` er stadig en aktiv attribut i de semantiske konventioner og accepteres som et ligeværdigt alias. `cursor.user.id` kommer sidst, fordi det er et uigennemsigtigt, teamafgrænset heltal, der kræver Cursors administrations-API for at blive omsat til en person.

Identitet læses kun på spans, der allerede er genkendt som LLM-kald: `user.id`, `user.email` og `team.id` er generiske nøgler, som browser- og almindelige backend-spans også bærer. **Metrik-datapunkter** bærer en kortere liste, der begynder med e-mailen — `user.email`, `user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id`, med teams fra `team.id`, `team`, `cost_center`, `department` og `cursor.team.id`, hver også matchet med `resource.`-præfikset —, fordi de kodeagent-CLI'er, der udsender metrikker uden spans, udsender `user.email` indbygget. Intet læser i dag identitet fra **logposter**.

### Angiv team og omkostningssted

Ingen instrumentering udsender `team.id`, `team`, `cost_center` eller `department`: Din organisation sætter dem, sædvanligvis via `OTEL_RESOURCE_ATTRIBUTES` på processen:

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

De når OneUptime som `resource.team.id`, `resource.team`, `resource.cost_center` og `resource.department`, og begge niveauer genkendes på spans og på metrik-datapunkter, uanset om din eksportør lader nøglerne blive i OTLP-ressourceblokken eller kopierer dem over på hvert span (Claude Code gør det sidste). Et `team.id` uden præfiks sat direkte på et span vinder stadig.

Gatewayenes stavemåder ankommer uden nogen konfiguration fra din side. LiteLLM navngiver sine attributter forskelligt i sine to OpenTelemetry-tilstande — standard-v1-callbacken `otel` bruger et rent `metadata.`-præfiks (`metadata.user_api_key_user_id`, `metadata.user_api_key_user_email`, `metadata.user_api_key_team_id`), den valgfrie v2-tilstand (`LITELLM_OTEL_V2=true`) navnerummet `litellm.` —, og **OneUptime læser begge**.

### Kundenøglerne er udeladt med vilje

Et LLM-span kan bære **to** forskellige personer: den medarbejder, der foretog kaldet, og den **kunde** længere nede i kæden, som det blev foretaget for. Disse nøgler bærer kunden, og OneUptime læser bevidst **ingen** af dem ind i en identitetskolonne:

- `gen_ai.user` og `llm.user` — sådan gengiver instrumenteringer OpenAIs forespørgselsparameter `user`, som OpenAI dokumenterer som „a stable identifier for your end-users“ (nu forældet til fordel for `safety_identifier` og `prompt_cache_key`).
- `litellm.metadata.user_api_key_end_user_id`, `metadata.user_api_key_end_user_id` og `litellm.end_user.id` — LiteLLMs eksplicitte slutbruger-id i alle tre stavemåder, adskilt fra nøgleejerens id, som **er** medarbejderen og **bliver** læst.

Grunden er korrekt intern omkostningsfordeling: Læser man et kunde-id ind i medarbejderkolonnen, skaber en supportbot, der betjener 40.000 kunder, 40.000 fantom-„medarbejdere“, mens den udvikler, der ejer forbruget, ser ud til ikke at have brugt noget. Disse attributter bliver i det rå attributkort, hvor du kan forespørge dem direkte.

### Identitetskolonner bliver renset

Kolonnen med medarbejderens e-mail indeholder rigtige persondata. Dine telemetri-**Scrub-regler** under omfanget **Attributter** dækker den præcis, som de dækker den attribut, den blev læst fra, så en regel, der redigerer e-mails væk, også gælder for kolonnen. Konfigurér scrub-regler og drop-filtre under **Spor → Indstillinger**.

## Spans og metrikker er en reserve, ikke en sum

**GenAI-spans er autoritative. Metrikstrømmen bruges kun, når spanstrømmen ikke har rapporteret noget, og de to lægges aldrig sammen.** Et span bærer model, tokens og omkostning i én række, så hvor der findes spans, besvarer de ethvert spørgsmål. Hvor der ikke gør — kodeagent-CLI'erne udgiver _metrikker_ for tokens og omkostning og ingen GenAI-spans —, træder metrikstrømmen til. De summeres ikke, fordi mange instrumenteringer udsender begge signaler for det samme kald (OpenLLMetry er det almindelige tilfælde), og at lægge dem sammen ville tælle hver dollar to gange.

Konsekvensen, du skal planlægge efter: **Så snart dine GenAI-spans rapporterer et tal, der ikke er nul, vises bidraget fra en kilde, der kun har metrikker, ikke i det tal.** Reserven gælder pr. tal og pr. opdeling, ikke pr. udsender:

| Hvor                                         | Hvad der falder tilbage på metrikker                             | Hvornår                                    |
| -------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| Forbrug → Input-tokens / Output-tokens       | Summer af input- og output-tokens                                | Begge spannenes token-summer er 0          |
| Forbrug → Omkostning (USD)                   | Omkostning i USD og mikro-USD, skaleret og lagt sammen           | Spannenes omkostningssum er 0              |
| Forbrug → LLM-kald                           | Intet — kun spans                                                | —                                          |
| Forbrug → Medarbejder, Team, Model           | Kun omkostning. Kolonnerne for kald og tokens viser `—`          | Den opdeling returnerede ingen span-rækker |
| Forbrug → Udbyder, Applikation / Tjeneste    | Intet — kun spans                                                | —                                          |
| Samtaler                                     | Intet — samtaler bygges ud fra spans                             | —                                          |

Udbyder og Applikation / Tjeneste har ingen metrik-reserve, fordi kodeagenternes tællere ikke bærer nogen GenAI-udbyderattribut og ikke er knyttet til nogen OneUptime-telemetritjeneste. Overalt hvor et tal kom fra metrikker, mærker siden det **fra GenAI-metrikker**, fordi et tal fra metrikker ikke har nogen tilsvarende rækker i listen Kald.

**Hvis forbruget fra et værktøj med kun metrikker skal kunne ses for sig, så giv det sit eget projekt**, så dets spanstrøm reelt er tom, og reserven træder i kraft. Det samme gælder budgetter: Afgræns ét budget pr. tjeneste i stedet for at blande tjenester med spans og tjenester med kun metrikker.

## Dashboards og metrik-advarsler

GenAI-metrikker ankommer som almindelige OpenTelemetry-metrikker, så du kan bygge **dashboards**, der viser `gen_ai.client.token.usage`, `gen_ai.client.operation.duration` og resten som grafer, og oprette **metrik-monitorer** på dem — for eksempel når p95 for `gen_ai.client.operation.duration` overskrider en tærskel, grupperet efter model. Se [Metrik-monitor](/docs/monitor/metrics-monitor).

## Daglige omkostningsbudgetter

Fanen **Budgetter** sætter daglige grænser i USD, evalueret over UTC-døgnet. Hvert 15. minut summerer en baggrunds-worker dagens LLM-span-omkostning (rapporteret eller beregnet), registrerer den på budgettet og udgiver to gauge-metrikker:

| Metrik                              | Betydning                                       |
| ----------------------------------- | ----------------------------------------------- |
| `oneuptime.llm.budget.spend.usd`    | Dagens forbrug indtil nu, i USD                 |
| `oneuptime.llm.budget.percent.used` | Forbruget i procent af den daglige grænse       |

Begge bærer attributterne `oneuptime.llm.budget.id` og `oneuptime.llm.budget.name` plus budgettets afgrænsning til tjeneste, udbyder og model, når den er sat. Filtrér monitorer efter **`oneuptime.llm.budget.id`**, som er stabil; navnet ændrer sig, når du omdøber budgettet.

**Advarsler laves med en [Metrik-monitor](/docs/monitor/metrics-monitor) på de metrikker.** Til det klassiske mønster 80 % / 100 % opretter du en monitor på `oneuptime.llm.budget.percent.used`, filtrerer den efter `oneuptime.llm.budget.id` og tilføjer to kriterier: `>= 80`, der opretter en almindelig advarsel, og `>= 100`, der opretter en kritisk. **Sæt monitorens rullende tid til 30 minutter**: Et budget udgiver ét punkt hvert 15. minut, så standardvinduet på 1 minut ville finde en tom serie mellem to gennemløb.

Budgetter kan afgrænses til en telemetritjeneste, en LLM-udbyder eller en præcis model eller gælde hele projektet, og flere kan eksistere side om side. En budgetmonitor kan også kalde et Workflow, der stopper en løbsk agent — se [Circuit breakers til løbske AI-agenter](/docs/telemetry/ai-agent-circuit-breaker).

## Privatliv og redigering

Prompts og completions kan indeholde følsomme data. OneUptime anvender dine telemetri-**Scrub-regler** og **Drop-filtre** på LLM-spans som på ethvert andet trace, så du kan maskere attributter eller droppe spans, før de gemmes; konfigurér dem under **Spor → Indstillinger**. Kolonnen med medarbejderens e-mail er dækket af de samme regler — se [Identitetskolonner bliver renset](#identitetskolonner-bliver-renset).

Samtaler læses med den samme tilladelse som traces: Den, der kan læse projektets traces, kan læse dets samtaler, og ingen andre.

## Relateret

- [Observability for AI-kodeassistenter](/docs/telemetry/ai-coding-assistants) — understøttelsesmatrixen for Claude Code, Cursor, Codex, Gemini CLI, Copilot, Cline og resten, og hvordan forbrug pr. medarbejder fungerer på tværs af dem.
- [Overvågning af Claude Code](/docs/telemetry/claude-code)
- [Overvågning af Cursor](/docs/telemetry/cursor)
- [Overvågning af OpenAI Codex CLI](/docs/telemetry/openai-codex)
- [Overvågning af Gemini CLI og GitHub Copilot](/docs/telemetry/gemini-cli-and-copilot)
- [Observering af AI-gateways (LiteLLM og Portkey)](/docs/telemetry/ai-gateways)
- [Circuit breakers til løbske AI-agenter](/docs/telemetry/ai-agent-circuit-breaker)

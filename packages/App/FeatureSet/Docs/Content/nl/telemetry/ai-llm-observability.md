# AI- / LLM-observability met OneUptime

Lees elk gesprek dat uw AI heeft gevoerd, speel het af zoals het is gebeurd en krijg een melding wanneer de AI slecht antwoordt. Alles draait op standaard OpenTelemetry, zonder eigen SDK: als uw app spans uitstuurt volgens de OpenTelemetry-**GenAI-semantische conventies** (`gen_ai.*`), maakt OneUptime er gesprekken, waarschuwingen, gebruik en kosten van.

## Wat u krijgt

Open **AI / LLM** in de navigatiebalk, onder Observability:

- **Gesprekken** — elk gesprek dat uw AI heeft gevoerd: wat mensen vroegen, wat de AI antwoordde, welke tools hij gebruikte en wat er misging. Boven de lijst staan vijf getallen: gesprekken, AI-antwoorden, hoeveel aandacht nodig hebben, kosten en hoe lang een antwoord doorgaans duurt. Open een gesprek om het te lezen of opnieuw af te spelen.
- **Aanroepen** — elke LLM-, embedding-, agent- en tool-aanroep, te filteren op service, provider, model, operatie, persoon en team. Klik op een aanroep om hem in de trace-viewer te openen.
- **Gebruik** — de aanroepen, tokens en kosten van een periode, en wie wat uitgeeft: medewerkers, teams, modellen, providers en apps gerangschikt op uitgaven.
- **Waarschuwingen** — kant-en-klare waarschuwingen voor wanneer de AI slecht antwoordt, en uw AI- / LLM-monitors.
- **Budgetten** — dagelijkse kostenlimieten, gepubliceerd als metrieken om op te waarschuwen.
- **Prijzen** — uw eigen prijzen per model, voor modellen die de ingebouwde catalogus niet kent.
- **Instellen** — de vijf stappen hieronder, met het endpoint van uw project.

In de trace-viewer heeft de span van elke AI-aanroep ook een paneel **AI / LLM** met het model, het aantal tokens, de kosten, de aanvraagparameters, en de prompt en de completion.

## Stap 1 — Stuur uw AI-aanroepen

Maak een telemetrie-ingestiesleutel aan: open **Projectinstellingen → Telemetrie & APM → Ingestiesleutels** en klik op **Inname-sleutel aanmaken**. Uw app geeft de sleutel mee als OTLP-header. (Zie de [OpenTelemetry-handleiding](/docs/telemetry/open-telemetry) voor schermafbeeldingen.)

Instrumenteer uw app vervolgens met een willekeurige OpenTelemetry-GenAI-bibliotheek:

- **OpenLLMetry** (Traceloop) — OpenAI, Anthropic, Cohere, Bedrock, LangChain, LlamaIndex, CrewAI en meer.
- **OpenInference** (Arize) — OpenAI, LangChain, LlamaIndex, DSPy en meer.
- De **Vercel AI SDK**, of de **OpenTelemetry-instrumentaties** voor OpenAI, Anthropic en Gemini.

Leidt u uw LLM-verkeer via een gateway zoals **LiteLLM** of **Portkey**? Exporteer traces vanuit de gateway in plaats van elke app te instrumenteren — zie [AI-gateways observeren](/docs/telemetry/ai-gateways). Zoekt u de codeerassistenten die uw engineers gebruiken — Claude Code, Cursor, Codex, Gemini CLI, Copilot? Die exporteren hun eigen OpenTelemetry en hebben niets van u nodig: zie [Observability voor AI-codeerassistenten](/docs/telemetry/ai-coding-assistants).

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

### Gewone OpenTelemetry-omgevingsvariabelen

Als u instrumenteert met een native OpenTelemetry-SDK, richt u de OTLP-exporter op OneUptime:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
export OTEL_SERVICE_NAME="my-ai-agent"
```

Host u OneUptime zelf? Vervang `https://oneuptime.com/otlp` door `https://YOUR-ONEUPTIME-HOST/otlp`.

## Stap 2 — Leg vast wat er gezegd is

Een gesprek laat zien wat mensen vroegen en wat de AI antwoordde wanneer uw instrumentatie dat vastlegt. OpenLLMetry legt prompts en completions vast, tenzij u het uitzet (`TRACELOOP_TRACE_CONTENT=false`). De OpenTelemetry-instrumentaties leggen ze alleen vast als u daarom vraagt:

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

Zonder die gegevens toont een gesprek nog steeds zijn timing, kosten en problemen, en meldt het dat de inhoud niet is vastgelegd. Prompts kunnen gevoelige gegevens bevatten: zie [Privacy en redactie](#privacy-en-redactie) om ze te maskeren voordat ze worden opgeslagen.

## Stap 3 — Groepeer aanroepen in gesprekken

Een chat-app doet één modelaanroep per beurt. Zet `gen_ai.conversation.id` — of `session.id` — op de id van uw chat bij elke AI-aanroep, en elke chat verschijnt als één gesprek, hoeveel aanroepen en traces het ook kostte. Met OpenLLMetry zet u het één keer per aanvraag als association property:

```python
from traceloop.sdk import Traceloop

Traceloop.set_association_properties({
    "session_id": chat.id,
    "user_email": user.email,
})
```

Aanroepen zonder gespreks-id worden ook getoond, één aanvraag (één trace) tegelijk.

## Stap 4 — Geef aan wie het vroeg

Zet `user.id` of `user.email` — de association property hierboven zet het e-mailadres — om te zien met wie elk gesprek was, de lijst op persoon te doorzoeken en de uitgaven per medewerker te rangschikken op het tabblad Gebruik. [Toewijzing aan medewerkers en teams](#toewijzing-aan-medewerkers-en-teams) somt elke sleutel op die OneUptime leest.

## Stap 5 — Markeer slechte antwoorden

OneUptime controleert elk antwoord zodra het binnenkomt en markeert wat ermee misging:

| Probleem   | Wat het betekent                                                  | Herkend aan                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mislukt    | De aanroep eindigde in een fout, dus er kwam geen antwoord        | Spanstatus Error, `error.type`, of een finish reason `error`                                                                                                                  |
| Geweigerd  | De AI weigerde, of een veiligheidsfilter blokkeerde het           | Een finish reason voor weigering of veiligheid (`content_filter`, `refusal`, `SAFETY` en dergelijke), een weigering in het antwoord, of een antwoord dat opent met een standaard Engelse weigering |
| Afgekapt   | Het antwoord stopte bij de tokenlimiet                            | Een finish reason `length`, `max_tokens` of `MAX_TOKENS`                                                                                                                      |
| Leeg       | De AI antwoordde zonder tekst en zonder tool-aanroep              | Vastgelegde inhoud die niets bevat, of 0 uitvoertokens                                                                                                                        |
| Gemarkeerd | Een beoordeling die uw app stuurde, noemde het antwoord slecht    | Een `gen_ai.evaluation.result`-event                                                                                                                                          |

De eerste vier vragen niets van u. Om de rest te markeren — een antwoord dat uw guardrail, uw eval of uw eigen LLM-judge afwijst — voegt u een `gen_ai.evaluation.result`-event toe aan de span van het antwoord, met `gen_ai.evaluation.score.label` op `fail`:

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

Labels zoals `incorrect`, `wrong`, `unhelpful`, `toxic`, `unsafe` en `hallucination` tellen ook als niet geslaagd. Het event moet op de span staan van het antwoord dat het beoordeelt, terwijl die span open is.

OneUptime stuurt uw gesprekken nooit naar een andere AI om ze te beoordelen: elke controle leest alleen wat de aanroep zelf meedraagt.

## Een gesprek lezen en opnieuw afspelen

Een gesprek opent in zijn geheel, zoals een chat-app zijn geschiedenis toont: wat de persoon zei rechts, de antwoorden van de AI links met hun model, tijd, tokens en kosten, tool-aanroepen ertussen, en wat er misging gemarkeerd waar het gebeurde. **Details** onder een antwoord toont de finish reason en de beoordelingen, met een link naar de aanroep in Traces.

De balk onderaan speelt het gesprek af zoals de persoon het beleefde:

- **Opnieuw afspelen** speelt het af vanaf het eerste bericht in het tempo waarin het gebeurde, met „De AI antwoordt…” dat optelt terwijl er een antwoord onderweg is. Klik op de tijd van een bericht om vanaf daar af te spelen.
- **Wachten overslaan**, standaard aan, verkort stiltes die langer zijn dan 3 seconden. De snelheidsknop speelt af op 1×, 2×, 4× of 8×.
- **K** speelt af of pauzeert, **J** of **←** gaat een bericht terug, en **L** of **→** gaat een bericht vooruit.
- Het adres onthoudt het bericht waar een weergave stopte (`?step=`), zodat een link op dat moment opent.

## Een melding krijgen wanneer de AI slecht antwoordt

Het tabblad **Waarschuwingen** biedt de waarschuwingen die de meeste AI-apps willen. Kiest u er een, dan opent Monitor maken al ingevuld, en kunt u alles wijzigen voordat u opslaat:

| Waarschuwing                 | Wanneer u een melding krijgt                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| Antwoorden gaan mis          | Meer dan 5% van de antwoorden in 15 minuten mislukt, wordt geweigerd, afgekapt, is leeg of gemarkeerd |
| AI-aanroepen mislukken       | Meer dan 10% van de aanroepen naar het model in 5 minuten eindigt in een fout                      |
| De AI weigert te antwoorden  | Meer dan 5% van de antwoorden in 30 minuten zijn weigeringen                                       |
| Antwoorden worden afgekapt   | 3 of meer antwoorden in 30 minuten stoppen bij de tokenlimiet                                      |
| Antwoorden worden gemarkeerd | Een beoordeling markeert een antwoord als slecht                                                   |
| Antwoorden zijn traag        | Meer dan 10% van de antwoorden in 15 minuten duurt langer dan 30 seconden                          |
| De AI stopt met antwoorden   | De AI geeft 30 minuten lang geen antwoorden                                                        |

De waarschuwingen op een aandeel wachten ook op minstens 3 slechte antwoorden, zodat één slecht antwoord op twee niemand wakker maakt.

Elke waarschuwing is een **AI / LLM**-monitor. De instellingen bepalen wat als slecht antwoord telt — de problemen hierboven, een antwoord dat trager is dan een limiet die u instelt, of beide —, welke apps en welk model hij bewaakt, en hoe ver elke controle terugkijkt. Daaronder toont een voorbeeld wat de monitor op dit moment zou tellen. De criteria vergelijken drie getallen: het **aandeel slechte antwoorden** (in %), het **aantal slechte antwoorden** en het **aantal antwoorden**. Een kant-en-klare waarschuwing geeft een waarschuwing die zichzelf oplost en toont de monitor als Verminderd zolang de antwoorden slecht zijn; zet het incident ervan aan om in plaats daarvan iemand op te roepen.

Uitgaven worden bewaakt door de [dagelijkse kostenbudgetten](#dagelijkse-kostenbudgetten).

## Attributen die OneUptime herkent

OneUptime leest eerst de OpenTelemetry-GenAI-conventies en valt terug op de varianten van OpenLLMetry en OpenInference, zodat populaire bibliotheken direct werken.

| Wat                                | Primair attribuut            | Ook geaccepteerd                                                                                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider / systeem                 | `gen_ai.provider.name`       | `gen_ai.system` (verouderd in de conventies, nog veel uitgestuurd), `llm.system`, `llm.provider`                                                                                                                                                                         |
| Operatie                           | `gen_ai.operation.name`      | `llm.request.type`, `openinference.span.kind`                                                                                                                                                                                                                             |
| Aangevraagd model                  | `gen_ai.request.model`       | `llm.model_name`, `llm.request.model`                                                                                                                                                                                                                                     |
| Antwoordmodel                      | `gen_ai.response.model`      | `llm.response.model`                                                                                                                                                                                                                                                      |
| Invoertokens                       | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`, `llm.token_count.prompt`, `llm.usage.prompt_tokens`                                                                                                                                                                                         |
| Uitvoertokens                      | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.token_count.completion`, `llm.usage.completion_tokens`                                                                                                                                                                             |
| Totaal aantal tokens               | `gen_ai.usage.total_tokens`  | `llm.token_count.total`, `llm.usage.total_tokens`; afgeleid uit invoer + uitvoer als geen van beide wordt gemeld                                                                                                                                                          |
| Kosten (USD)                       | `gen_ai.usage.cost`          | `gen_ai.usage.cost_usd`, `gen_ai.usage.total_cost`, `llm.usage.total_cost`, `gen_ai.cost.total_cost` (LiteLLM), `litellm.cost.total`                                                                                                                                      |
| Agentnaam                          | `gen_ai.agent.name`          | `agent.name`                                                                                                                                                                                                                                                              |
| Toolnaam                           | `gen_ai.tool.name`           | `tool.name`                                                                                                                                                                                                                                                               |
| Gespreks- / sessie-id              | `gen_ai.conversation.id`     | `session.id`, `langfuse.session.id`, `traceloop.association.properties.session_id`                                                                                                                                                                                        |
| Medewerker (die de aanroep deed)   | `user.id`                    | `enduser.id`, `litellm.metadata.user_api_key_user_id` en `metadata.user_api_key_user_id` (spellingen van LiteLLM OTel v2 en v1 — beide worden gelezen), `traceloop.association.properties.user_id`, `langfuse.user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id` |
| E-mailadres van de medewerker      | `user.email`                 | `traceloop.association.properties.user_email`, `enduser.email`                                                                                                                                                                                                            |
| Team / kostenplaats                | `team.id`                    | `team`, `cost_center`, `department`, `litellm.metadata.user_api_key_team_id` en `litellm.team.id` (LiteLLM OTel v2), `metadata.user_api_key_team_id` (LiteLLM OTel v1), `cursor.team.id`                                                                                  |

De subsleutels van `traceloop.association.properties.*` worden **door de aanroeper geleverd**: Traceloop definieert het voorvoegsel en uw code levert wat eronder komt. `gen_ai.usage.total_tokens` en `gen_ai.usage.cost` zijn **de-facto**-sleutels, geen GenAI-semantische conventies — de conventies definiëren geen attribuut voor het totaal aantal tokens en geen kostenattribuut —, en OneUptime leest ze omdat de gangbare instrumentaties ze uitsturen. `gen_ai.system` is de eigen, verouderde voorganger van `gen_ai.provider.name` in de conventies; beide worden gelezen.

**De drie identiteitsrijen worden ook gezocht met een voorvoegsel `resource.`.** OTLP-ingestie vlakt elk _resource_-attribuut af in de attributenmap van de span onder een voorvoegsel `resource.`, zodat `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` binnenkomt als `resource.team.id`. OneUptime doorzoekt eerst de hele lijst zonder voorvoegsel en daarna de hele `resource.`-lijst, zodat een span-attribuut (dat één aanroep beschrijft) wint van een resource-attribuut (dat het hele proces beschrijft). De andere rijen worden alleen op de sleutel zonder voorvoegsel gezocht: het zijn waarden per aanroep.

**De inhoud van prompts en completions** wordt gelezen uit het event `gen_ai.client.inference.operation.details`; uit de span-attributen `gen_ai.input.messages`, `gen_ai.output.messages` en `gen_ai.system_instructions`; uit de **verouderde** events per rol die oudere instrumentaties nog uitsturen (`gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.tool.message`, `gen_ai.assistant.message`, `gen_ai.choice`); uit de geïndexeerde attributen (`gen_ai.prompt.N.content` en `gen_ai.completion.N.content`, en bij OpenInference `llm.input_messages.N.message.content` en `llm.output_messages.N.message.content`); en uit de JSON-berichtarrays (`gen_ai.prompt`, `gen_ai.completion`, `input.value`, `output.value`).

### Hoe de kosten worden berekend

Als uw instrumentatie kosten meldt (`gen_ai.usage.cost`), gebruikt OneUptime die ongewijzigd: de gemelde waarde wint altijd. Als er geen kosten worden gemeld, berekent OneUptime **geschatte kosten bij ingestie** uit het aantal tokens van de span en een ingebouwde catalogus met catalogusprijzen van gangbare modellen van OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, xAI, Cohere, Amazon Nova en Meta Llama. Modellen worden herkend aan het voorvoegsel van de naam, zodat gedateerde snapshots zoals `gpt-4o-2024-08-06` en door de leverancier aangevulde id's zoals `us.anthropic.claude-3-5-sonnet-20241022-v2:0` correct worden herleid. Onbekende of eigen modellen worden nooit geraden — hun kosten blijven `0` totdat u ze een prijs geeft op het tabblad **Prijzen**. Schattingen gebruiken catalogusprijzen en houden geen rekening met cache- of batchkortingen.

Host u OneUptime zelf? De catalogus staat in `packages/Common/Types/Telemetry/LlmCostCatalog.ts`.

## Toewijzing aan medewerkers en teams

„Welke van onze engineers heeft vorige maand $ 4.000 aan Opus uitgegeven?” is een vraag over een persoon, en geen enkele LLM-span beantwoordt die tenzij iets op de span iemand noemt. OneUptime kopieert de menselijke actor bij ingestie naar doorzoekbare kolommen, zodat u op een kolom groepeert en filtert in plaats van attribuut-lookups te schrijven.

De drie identiteitsrijen in de tabel hierboven vormen het hele mechanisme; de eerste aanwezige sleutel wint, in de vermelde volgorde. `user.id` staat voorop omdat het de canonieke OpenTelemetry-sleutel voor een menselijke actor is, en de sleutel om op te standaardiseren als u de identiteit zelf zet. **Eén uitzondering: Claude Code** stuurt `user.id` uit als een willekeurige anonieme identificatie die in `~/.claude.json` wordt bewaard, niet als een persoon. Op zijn metriekdatapunten, waarvan de lijst met het e-mailadres begint, is dat onschuldig, maar als u de traces-bèta van Claude Code inschakelt, gaat de anonieme `user.id` op de spans voor `user.email`: verwijder of herschrijf `user.id` in een collector-processor voor die vloot. `enduser.id` is nog steeds een actief attribuut van de semantische conventies en wordt als gelijkwaardige alias geaccepteerd. `cursor.user.id` komt als laatste omdat het een ondoorzichtig, teamgebonden geheel getal is dat de beheer-API van Cursor nodig heeft om naar een persoon te herleiden.

Identiteit wordt alleen gelezen op spans die al als LLM-aanroepen zijn herkend: `user.id`, `user.email` en `team.id` zijn generieke sleutels die ook browser- en gewone backend-spans dragen. **Metriekdatapunten** dragen een kortere lijst die met het e-mailadres begint — `user.email`, `user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id`, met teams uit `team.id`, `team`, `cost_center`, `department` en `cursor.team.id`, elk ook gezocht met het voorvoegsel `resource.` —, omdat de CLI's van codeeragents die metrieken zonder spans uitsturen `user.email` van zichzelf uitsturen. Niets leest vandaag identiteit uit **logrecords**.

### Het team en de kostenplaats instellen

Geen enkele instrumentatie stuurt `team.id`, `team`, `cost_center` of `department` uit: uw organisatie zet ze, gewoonlijk via `OTEL_RESOURCE_ATTRIBUTES` op het proces:

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

Ze komen bij OneUptime binnen als `resource.team.id`, `resource.team`, `resource.cost_center` en `resource.department`, en beide niveaus worden herkend op spans en op metriekdatapunten, of uw exporter de sleutels nu in het OTLP-resourceblok laat of ze naar elke span kopieert (Claude Code doet het laatste). Een `team.id` zonder voorvoegsel die direct op een span is gezet, wint nog steeds.

De spellingen van gateways komen binnen zonder enige configuratie van uw kant. LiteLLM noemt zijn attributen anders in zijn twee OpenTelemetry-modi — de standaard v1-callback `otel` gebruikt een kaal voorvoegsel `metadata.` (`metadata.user_api_key_user_id`, `metadata.user_api_key_user_email`, `metadata.user_api_key_team_id`), de optionele v2-modus (`LITELLM_OTEL_V2=true`) de naamruimte `litellm.` —, en **OneUptime leest ze allebei**.

### De klantsleutels zijn bewust uitgesloten

Een LLM-span kan **twee** verschillende personen dragen: de medewerker die de aanroep deed, en de **klant** verderop voor wie hij werd gedaan. Deze sleutels dragen de klant, en OneUptime leest er bewust **geen enkele** van in een identiteitskolom:

- `gen_ai.user` en `llm.user` — zo geven instrumentaties de aanvraagparameter `user` van OpenAI door, die OpenAI documenteert als „a stable identifier for your end-users” (inmiddels verouderd ten gunste van `safety_identifier` en `prompt_cache_key`).
- `litellm.metadata.user_api_key_end_user_id`, `metadata.user_api_key_end_user_id` en `litellm.end_user.id` — de expliciete eindgebruikers-id van LiteLLM in alle drie de spellingen, los van de id van de sleuteleigenaar, die **wel** de medewerker is en **wel** wordt gelezen.

De reden is een correcte doorbelasting: lees een klant-id in de medewerkerskolom en een supportbot die 40.000 klanten bedient, maakt 40.000 spook-„medewerkers” aan, terwijl de engineer van wie de uitgaven zijn niets lijkt te hebben uitgegeven. Deze attributen blijven in de ruwe attributenmap, waar u ze rechtstreeks kunt opvragen.

### Identiteitskolommen worden opgeschoond

De kolom met het e-mailadres van de medewerker bevat echte persoonsgegevens. Uw telemetrie-**Scrub-regels** in het bereik **Attributen** dekken haar precies zoals ze het attribuut dekken waaruit ze is gelezen, zodat een regel die e-mailadressen afschermt ook voor de kolom geldt. Configureer Scrub-regels en Drop-filters onder **Traces → Instellingen**.

## Spans en metrieken zijn een terugval, geen som

**GenAI-spans zijn leidend. De metriekstroom wordt alleen geraadpleegd als de spanstroom niets heeft gemeld, en de twee worden nooit opgeteld.** Een span draagt model, tokens en kosten op één rij, dus waar spans bestaan, beantwoorden ze elke vraag. Waar ze niet bestaan — de CLI's van codeeragents publiceren _metrieken_ voor tokens en kosten en geen GenAI-spans —, springt de metriekstroom in. Ze worden niet opgeteld omdat veel instrumentaties beide signalen voor dezelfde aanroep uitsturen (OpenLLMetry is het gangbare geval), en optellen zou elke dollar dubbel tellen.

Het gevolg om rekening mee te houden: **zodra uw GenAI-spans een waarde ongelijk aan nul melden, verschijnt de bijdrage van een bron met alleen metrieken aan die waarde niet.** De terugval geldt per waarde en per uitsplitsing, niet per afzender:

| Waar                                       | Wat terugvalt op metrieken                                       | Wanneer                                      |
| ------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------- |
| Gebruik → Invoertokens / Uitvoertokens     | Totalen van invoer- en uitvoertokens                             | Beide tokensommen van de spans zijn 0        |
| Gebruik → Kosten (USD)                     | Kosten, in USD en micro-USD, geschaald en opgeteld               | De kostensom van de spans is 0               |
| Gebruik → LLM-aanroepen                    | Niets — alleen spans                                             | —                                            |
| Gebruik → Medewerker, Team, Model          | Alleen kosten. De kolommen voor aanroepen en tokens tonen `—`    | Die uitsplitsing leverde geen spanrijen op   |
| Gebruik → Provider, Applicatie / Service   | Niets — alleen spans                                             | —                                            |
| Gesprekken                                 | Niets — gesprekken worden uit spans opgebouwd                    | —                                            |

Provider en Applicatie / Service hebben geen terugval op metrieken omdat de tellers van codeeragents geen GenAI-providerattribuut dragen en niet aan een OneUptime-telemetrieservice gekoppeld zijn. Overal waar een waarde uit metrieken komt, labelt de pagina die **uit GenAI-metrieken**, omdat een waarde uit metrieken geen bijbehorende rijen heeft in de lijst Aanroepen.

**Moeten de uitgaven van een tool met alleen metrieken apart zichtbaar zijn, geef die tool dan een eigen project**, zodat de spanstroom echt leeg is en de terugval in werking treedt. Hetzelfde geldt voor budgetten: stel één budget per service in, in plaats van services met spans en services met alleen metrieken te mengen.

## Dashboards en metriekwaarschuwingen

GenAI-metrieken komen binnen als gewone OpenTelemetry-metrieken, dus u kunt **dashboards** bouwen die `gen_ai.client.token.usage`, `gen_ai.client.operation.duration` en de rest in grafieken tonen, en er **metriekmonitors** op maken — bijvoorbeeld wanneer de p95 van `gen_ai.client.operation.duration` een drempel overschrijdt, gegroepeerd per model. Zie [Metrics-monitor](/docs/monitor/metrics-monitor).

## Dagelijkse kostenbudgetten

Het tabblad **Budgetten** stelt dagelijkse limieten in USD in, geëvalueerd over de UTC-dag. Elke 15 minuten telt een achtergrondworker de LLM-spankosten van de dag op (gemeld of berekend), legt ze vast op het budget en publiceert twee gauge-metrieken:

| Metriek                             | Betekenis                                       |
| ----------------------------------- | ----------------------------------------------- |
| `oneuptime.llm.budget.spend.usd`    | De uitgaven van de dag tot nu toe, in USD       |
| `oneuptime.llm.budget.percent.used` | Uitgaven als percentage van de daglimiet        |

Beide dragen de attributen `oneuptime.llm.budget.id` en `oneuptime.llm.budget.name`, plus het service-, provider- en modelbereik van het budget als dat is ingesteld. Filter monitors op **`oneuptime.llm.budget.id`**, dat stabiel is; de naam verandert als u het budget hernoemt.

**Waarschuwen gebeurt met een [Metrics-monitor](/docs/monitor/metrics-monitor) op die metrieken.** Voor het klassieke patroon 80% / 100% maakt u een monitor op `oneuptime.llm.budget.percent.used`, filtert u die op `oneuptime.llm.budget.id` en voegt u twee criteria toe: `>= 80` voor een gewone waarschuwing en `>= 100` voor een kritieke. **Zet de rollende tijd van de monitor op 30 minuten**: een budget publiceert elke 15 minuten één punt, dus het standaardvenster van 1 minuut zou tussen twee rondes een lege reeks vinden.

Budgetten kunnen worden beperkt tot een telemetrieservice, een LLM-provider of een exact model, of projectbreed blijven, en er kunnen er meerdere naast elkaar bestaan. Een budgetmonitor kan ook een Workflow aanroepen die een op hol geslagen agent stopt — zie [Circuit breakers voor op hol geslagen AI-agents](/docs/telemetry/ai-agent-circuit-breaker).

## Privacy en redactie

Prompts en completions kunnen gevoelige gegevens bevatten. OneUptime past uw telemetrie-**Scrub-regels** en **Drop-filters** toe op LLM-spans zoals op elke andere trace, zodat u attributen kunt maskeren of spans kunt verwerpen voordat ze worden opgeslagen; configureer ze onder **Traces → Instellingen**. De kolom met het e-mailadres van de medewerker valt onder dezelfde regels — zie [Identiteitskolommen worden opgeschoond](#identiteitskolommen-worden-opgeschoond).

Gesprekken worden gelezen met dezelfde machtiging als traces: wie de traces van het project kan lezen, kan de gesprekken ervan lezen, en verder niemand.

## Gerelateerd

- [Observability voor AI-codeerassistenten](/docs/telemetry/ai-coding-assistants) — de ondersteuningsmatrix voor Claude Code, Cursor, Codex, Gemini CLI, Copilot, Cline en de rest, en hoe uitgaven per medewerker over die tools heen werken.
- [Claude Code monitoren](/docs/telemetry/claude-code)
- [Cursor monitoren](/docs/telemetry/cursor)
- [OpenAI Codex CLI monitoren](/docs/telemetry/openai-codex)
- [Gemini CLI en GitHub Copilot monitoren](/docs/telemetry/gemini-cli-and-copilot)
- [AI-gateways observeren (LiteLLM & Portkey)](/docs/telemetry/ai-gateways)
- [Circuit breakers voor op hol geslagen AI-agents](/docs/telemetry/ai-agent-circuit-breaker)

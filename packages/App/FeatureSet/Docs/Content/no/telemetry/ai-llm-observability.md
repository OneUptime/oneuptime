# AI- / LLM-observerbarhet med OneUptime

Les hver samtale AI-en din har hatt, spill den av slik den skjedde, og få beskjed når den svarer dårlig. Alt kjører på standard OpenTelemetry, uten proprietært SDK: Hvis appen din sender spans med OpenTelemetrys **GenAI-semantiske konvensjoner** (`gen_ai.*`), gjør OneUptime dem om til samtaler, varsler, forbruk og kostnad.

## Dette får du

Åpne **AI / LLM** i navigasjonslinjen, under Observerbarhet:

- **Samtaler** — hver samtale AI-en din har hatt: hva folk spurte om, hva AI-en svarte, hvilke verktøy den brukte og hva som gikk galt. Over listen står fem tall: samtaler, AI-svar, hvor mange som trenger oppmerksomhet, kostnad og hvor lang tid et svar vanligvis tar. Åpne en samtale for å lese den eller spille den av på nytt.
- **Kall** — hvert LLM-, embedding-, agent- og verktøykall, som kan filtreres på tjeneste, leverandør, modell, operasjon, person og team. Klikk på et kall for å åpne det i trace-visningen.
- **Forbruk** — kallene, tokenene og kostnaden i et tidsrom, og hvem som bruker hva: ansatte, team, modeller, leverandører og apper rangert etter forbruk.
- **Varsler** — ferdige varsler for når AI-en svarer dårlig, og AI- / LLM-monitorene dine.
- **Budsjetter** — daglige kostnadsgrenser, publisert som målinger du kan varsle på.
- **Priser** — dine egne priser per modell, for modeller som den innebygde katalogen ikke kjenner.
- **Oppsett** — de fem trinnene nedenfor, med prosjektets endepunkt.

I trace-visningen har spannet til hvert AI-kall også et **AI / LLM**-panel med modell, antall tokens, kostnad, forespørselsparametere og prompt og completion.

## Trinn 1 — Send AI-kallene dine

Opprett en inntaksnøkkel for telemetri: Åpne **Prosjektinnstillinger → Telemetri og APM → Inntaksnøkler** og klikk på **Opprett ingestion-nøkkel**. Appen din sender nøkkelen som en OTLP-header. (Se [OpenTelemetry-veiledningen](/docs/telemetry/open-telemetry) for skjermbilder.)

Instrumenter deretter appen med et hvilket som helst OpenTelemetry-GenAI-bibliotek:

- **OpenLLMetry** (Traceloop) — OpenAI, Anthropic, Cohere, Bedrock, LangChain, LlamaIndex, CrewAI og flere.
- **OpenInference** (Arize) — OpenAI, LangChain, LlamaIndex, DSPy og flere.
- **Vercel AI SDK**, eller **OpenTelemetry-instrumenteringene** for OpenAI, Anthropic og Gemini.

Sender du LLM-trafikken gjennom en gateway som **LiteLLM** eller **Portkey**? Eksporter traces fra gatewayen i stedet for å instrumentere hver app — se [Observere AI-gatewayer](/docs/telemetry/ai-gateways). Ser du etter kodeassistentene utviklerne dine bruker — Claude Code, Cursor, Codex, Gemini CLI, Copilot? De eksporterer sin egen OpenTelemetry og trenger ingenting fra deg: se [Observerbarhet for AI-kodeassistenter](/docs/telemetry/ai-coding-assistants).

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

### Rene OpenTelemetry-miljøvariabler

Hvis du instrumenterer med et native OpenTelemetry-SDK, peker du OTLP-eksportøren mot OneUptime:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
export OTEL_SERVICE_NAME="my-ai-agent"
```

Drifter du OneUptime selv? Erstatt `https://oneuptime.com/otlp` med `https://YOUR-ONEUPTIME-HOST/otlp`.

## Trinn 2 — Ta opp det som ble sagt

En samtale viser hva folk spurte om og hva AI-en svarte når instrumenteringen din tar det opp. OpenLLMetry tar opp prompts og completions med mindre du slår det av (`TRACELOOP_TRACE_CONTENT=false`). OpenTelemetry-instrumenteringene tar dem bare opp når du ber om det:

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

Uten dem viser en samtale likevel tidsbruk, kostnad og problemer, og sier at innholdet ikke ble tatt opp. Prompts kan inneholde sensitive data: se [Personvern og sladding](#personvern-og-sladding) for å maskere dem før de lagres.

## Trinn 3 — Grupper kall i samtaler

En chat-app gjør ett modellkall per tur. Sett `gen_ai.conversation.id` — eller `session.id` — til chattens id på hvert AI-kall, så vises hver chat som én samtale, uansett hvor mange kall og traces den tok. Med OpenLLMetry setter du den én gang per forespørsel som en association property:

```python
from traceloop.sdk import Traceloop

Traceloop.set_association_properties({
    "session_id": chat.id,
    "user_email": user.email,
})
```

Kall uten samtale-id vises likevel, én forespørsel (ett trace) om gangen.

## Trinn 4 — Si hvem som spurte

Sett `user.id` eller `user.email` — association property-en ovenfor setter e-posten — for å se hvem hver samtale var med, søke i listen etter person og rangere forbruk etter ansatt på fanen Forbruk. [Tilordning til ansatte og team](#tilordning-til-ansatte-og-team) viser alle nøklene OneUptime leser.

## Trinn 5 — Merk dårlige svar

OneUptime sjekker hvert svar idet det kommer inn, og merker hva som gikk galt med det:

| Problem    | Hva det betyr                                                  | Funnet ut fra                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mislyktes  | Kallet endte med en feil, så det kom ikke noe svar             | Span-status Error, `error.type` eller en finish reason på `error`                                                                                                               |
| Avvist     | AI-en avslo, eller et sikkerhetsfilter blokkerte den           | En finish reason for avslag eller sikkerhet (`content_filter`, `refusal`, `SAFETY` og lignende), et avslag i svaret, eller et svar som begynner med et typisk engelsk avslag |
| Avkortet   | Svaret stoppet ved token-grensen                               | En finish reason på `length`, `max_tokens` eller `MAX_TOKENS`                                                                                                                   |
| Tom        | AI-en svarte uten tekst og uten verktøykall                    | Registrert innhold som ikke inneholder noe, eller 0 output-tokens                                                                                                               |
| Markert    | En evaluering appen din sendte, sa at svaret var dårlig        | En `gen_ai.evaluation.result`-hendelse                                                                                                                                          |

De fire første krever ingenting av deg. For å merke resten — et svar som guardrailen din, evalen din eller din egen LLM-dommer avviser — legger du til en `gen_ai.evaluation.result`-hendelse på svarets span, med `gen_ai.evaluation.score.label` satt til `fail`:

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

Etiketter som `incorrect`, `wrong`, `unhelpful`, `toxic`, `unsafe` og `hallucination` teller også som ikke bestått. Hendelsen må ligge på spannet til svaret den vurderer, mens det spannet er åpent.

OneUptime sender aldri samtalene dine til en annen AI for å få dem vurdert: Hver sjekk leser bare det kallet selv bærer.

## Les og spill av en samtale på nytt

En samtale åpnes i sin helhet, slik en chat-app viser historikken sin: det personen sa til høyre, AI-ens svar til venstre med modell, tid, tokens og kostnad, verktøykall mellom dem, og det som gikk galt merket der det skjedde. **Detaljer** under et svar viser finish reason og evalueringer, med en lenke til kallet i Spor.

Linjen nederst spiller av samtalen slik personen opplevde den:

- **Spill av på nytt** spiller den fra den første meldingen i det tempoet den skjedde, med «AI-en svarer…» som teller opp mens et svar er på vei. Klikk på tidspunktet til en hvilken som helst melding for å spille av derfra.
- **Hopp over ventetid**, som er på som standard, korter ned pauser lengre enn 3 sekunder. Hastighetsknappen spiller av i 1×, 2×, 4× eller 8×.
- **K** spiller av eller setter på pause, **J** eller **←** går én melding tilbake, og **L** eller **→** går én fram.
- Adressen husker meldingen en avspilling stoppet ved (`?step=`), så en lenke åpnes på akkurat det øyeblikket.

## Få beskjed når AI-en svarer dårlig

Fanen **Varsler** tilbyr varslene de fleste AI-apper trenger. Når du velger ett, åpnes Opprett monitor ferdig utfylt, og du kan endre alt før du lagrer:

| Varsel                        | Når det gir deg beskjed                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Svar går galt                 | Mer enn 5 % av svarene i løpet av 15 minutter mislykkes, avvises, avkortes, er tomme eller markeres |
| AI-kall mislykkes             | Mer enn 10 % av kallene til modellen i løpet av 5 minutter ender med en feil                   |
| AI-en nekter å svare          | Mer enn 5 % av svarene i løpet av 30 minutter er avslag                                        |
| Svar blir avkortet            | 3 eller flere svar i løpet av 30 minutter stopper ved token-grensen                            |
| Svar blir markert             | En evaluering merker et svar som dårlig                                                        |
| Svar er trege                 | Mer enn 10 % av svarene i løpet av 15 minutter tar lengre tid enn 30 sekunder                  |
| AI-en slutter å svare         | AI-en gir ingen svar på 30 minutter                                                            |

Varslene på en andel venter også på minst 3 dårlige svar, så ett dårlig svar av to ikke vekker noen.

Hvert varsel er en **AI / LLM**-monitor. Innstillingene sier hva som regnes som et dårlig svar — problemene ovenfor, et svar som er tregere enn en grense du setter, eller begge deler —, hvilke apper og hvilken modell den overvåker, og hvor langt tilbake hver sjekk ser. Under dem viser en forhåndsvisning hva monitoren ville telt akkurat nå. Kriteriene sammenligner tre tall: **andelen dårlige svar** (i %), **antallet dårlige svar** og **antallet svar**. Et ferdig varsel utløser et varsel som løser seg selv og viser monitoren som Redusert så lenge svarene er dårlige; slå heller på hendelsen for å tilkalle noen.

Forbruket overvåkes av de [daglige kostnadsbudsjettene](#daglige-kostnadsbudsjetter).

## Attributter OneUptime gjenkjenner

OneUptime leser OpenTelemetrys GenAI-konvensjoner først, og faller tilbake på OpenLLMetry- og OpenInference-variantene slik at populære biblioteker fungerer med en gang.

| Hva                                  | Primærattributt              | Godtas også                                                                                                                                                                                                                                                               |
| ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leverandør / system                  | `gen_ai.provider.name`       | `gen_ai.system` (foreldet i konvensjonene, men fortsatt mye sendt), `llm.system`, `llm.provider`                                                                                                                                                                         |
| Operasjon                            | `gen_ai.operation.name`      | `llm.request.type`, `openinference.span.kind`                                                                                                                                                                                                                             |
| Forespurt modell                     | `gen_ai.request.model`       | `llm.model_name`, `llm.request.model`                                                                                                                                                                                                                                     |
| Svarmodell                           | `gen_ai.response.model`      | `llm.response.model`                                                                                                                                                                                                                                                      |
| Input-tokens                         | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`, `llm.token_count.prompt`, `llm.usage.prompt_tokens`                                                                                                                                                                                         |
| Output-tokens                        | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.token_count.completion`, `llm.usage.completion_tokens`                                                                                                                                                                             |
| Tokens totalt                        | `gen_ai.usage.total_tokens`  | `llm.token_count.total`, `llm.usage.total_tokens`; utledet fra input + output når ingen av dem rapporteres                                                                                                                                                               |
| Kostnad (USD)                        | `gen_ai.usage.cost`          | `gen_ai.usage.cost_usd`, `gen_ai.usage.total_cost`, `llm.usage.total_cost`, `gen_ai.cost.total_cost` (LiteLLM), `litellm.cost.total`                                                                                                                                      |
| Agentnavn                            | `gen_ai.agent.name`          | `agent.name`                                                                                                                                                                                                                                                              |
| Verktøynavn                          | `gen_ai.tool.name`           | `tool.name`                                                                                                                                                                                                                                                               |
| Samtale- / økt-id                    | `gen_ai.conversation.id`     | `session.id`, `langfuse.session.id`, `traceloop.association.properties.session_id`                                                                                                                                                                                        |
| Ansatt (som gjorde kallet)           | `user.id`                    | `enduser.id`, `litellm.metadata.user_api_key_user_id` og `metadata.user_api_key_user_id` (skrivemåtene i LiteLLM OTel v2 og v1 — begge leses), `traceloop.association.properties.user_id`, `langfuse.user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id` |
| Den ansattes e-post                  | `user.email`                 | `traceloop.association.properties.user_email`, `enduser.email`                                                                                                                                                                                                            |
| Team / kostnadssted                  | `team.id`                    | `team`, `cost_center`, `department`, `litellm.metadata.user_api_key_team_id` og `litellm.team.id` (LiteLLM OTel v2), `metadata.user_api_key_team_id` (LiteLLM OTel v1), `cursor.team.id`                                                                                  |

Undernøklene under `traceloop.association.properties.*` **leveres av den som kaller**: Traceloop definerer prefikset, og koden din leverer det som står under det. `gen_ai.usage.total_tokens` og `gen_ai.usage.cost` er **de facto**-nøkler, ikke GenAI-semantiske konvensjoner — konvensjonene definerer verken et attributt for totale tokens eller et for kostnad —, og OneUptime leser dem fordi de vanlige instrumenteringene sender dem. `gen_ai.system` er konvensjonenes egen foreldede forgjenger til `gen_ai.provider.name`; begge leses.

**De tre identitetsradene matches også med et `resource.`-prefiks.** OTLP-inntak flater ut hvert _ressurs_-attributt i spannets attributtkart under et `resource.`-prefiks, så `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` kommer inn som `resource.team.id`. OneUptime ser først gjennom hele listen uten prefiks, deretter hele `resource.`-listen, slik at et span-attributt (som beskriver ett kall) slår et ressursattributt (som beskriver hele prosessen). De andre radene matches bare på nøkkelen uten prefiks: De er verdier per kall.

**Innhold fra prompts og completions** leses fra hendelsen `gen_ai.client.inference.operation.details`; fra span-attributtene `gen_ai.input.messages`, `gen_ai.output.messages` og `gen_ai.system_instructions`; fra de **foreldede** hendelsene per rolle som eldre instrumenteringer fortsatt sender (`gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.tool.message`, `gen_ai.assistant.message`, `gen_ai.choice`); fra de indekserte attributtene (`gen_ai.prompt.N.content` og `gen_ai.completion.N.content`, og i OpenInference `llm.input_messages.N.message.content` og `llm.output_messages.N.message.content`); og fra JSON-meldingslistene (`gen_ai.prompt`, `gen_ai.completion`, `input.value`, `output.value`).

### Slik beregnes kostnaden

Hvis instrumenteringen din rapporterer en kostnad (`gen_ai.usage.cost`), bruker OneUptime den som den er: Den rapporterte verdien vinner alltid. Når ingen kostnad rapporteres, beregner OneUptime en **estimert kostnad ved inntak** ut fra spannets antall tokens og en innebygd listeprisskatalog over vanlige modeller fra OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, xAI, Cohere, Amazon Nova og Meta Llama. Modeller matches på navneprefiks, så daterte snapshots som `gpt-4o-2024-08-06` og id-er med leverandørtillegg som `us.anthropic.claude-3-5-sonnet-20241022-v2:0` slås riktig opp. Ukjente eller egendefinerte modeller gjettes aldri — kostnaden deres forblir `0` til du gir dem en pris på fanen **Priser**. Estimatene bruker listepriser og tar ikke hensyn til cache- eller batchrabatter.

Drifter du OneUptime selv? Katalogen ligger i `packages/Common/Types/Telemetry/LlmCostCatalog.ts`.

## Tilordning til ansatte og team

«Hvem av utviklerne våre brukte 4000 $ på Opus forrige måned?» er et spørsmål om en person, og ingen LLM-span svarer på det med mindre noe på spannet navngir en. OneUptime kopierer den menneskelige aktøren til spørrbare kolonner ved inntak, så du grupperer og filtrerer på en kolonne i stedet for å skrive attributtoppslag.

De tre identitetsradene i tabellen ovenfor er hele mekanismen; den første nøkkelen som finnes, vinner, i rekkefølgen som er oppgitt. `user.id` står først fordi den er OpenTelemetrys kanoniske nøkkel for en menneskelig aktør og den du bør standardisere på hvis du setter identiteten selv. **Ett unntak: Claude Code** sender `user.id` som en tilfeldig anonym identifikator lagret i `~/.claude.json`, ikke en person. Det er harmløst på målingsdatapunktene, der listen begynner med e-posten, men hvis du slår på traces-betaen i Claude Code, rangerer den anonyme `user.id` foran `user.email` på spannene: Fjern eller tilordne `user.id` på nytt i en collector-prosessor for den flåten. `enduser.id` er fortsatt et aktivt attributt i de semantiske konvensjonene og godtas som et likeverdig alias. `cursor.user.id` kommer sist fordi det er et ugjennomsiktig, teambegrenset heltall som trenger administrasjons-API-et til Cursor for å kobles til en person.

Identitet leses bare på spans som allerede er gjenkjent som LLM-kall: `user.id`, `user.email` og `team.id` er generiske nøkler som nettleser- og vanlige backend-spans også bærer. **Målingsdatapunkter** bærer en kortere liste som begynner med e-posten — `user.email`, `user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id`, med team fra `team.id`, `team`, `cost_center`, `department` og `cursor.team.id`, hver også matchet med `resource.`-prefikset —, fordi kodeagent-CLI-ene som sender målinger uten spans, sender `user.email` direkte. Ingenting leser identitet fra **loggposter** i dag.

### Angi team og kostnadssted

Ingen instrumentering sender `team.id`, `team`, `cost_center` eller `department`: Organisasjonen din setter dem, vanligvis via `OTEL_RESOURCE_ATTRIBUTES` på prosessen:

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

De når OneUptime som `resource.team.id`, `resource.team`, `resource.cost_center` og `resource.department`, og begge nivåene gjenkjennes på spans og på målingsdatapunkter, enten eksportøren din lar nøklene ligge i OTLP-ressursblokken eller kopierer dem over på hvert span (Claude Code gjør det siste). En `team.id` uten prefiks satt direkte på et span vinner fortsatt.

Skrivemåtene fra gatewayer kommer inn uten noen konfigurasjon fra deg. LiteLLM navngir attributtene sine ulikt i sine to OpenTelemetry-moduser — standard-v1-callbacken `otel` bruker et rent `metadata.`-prefiks (`metadata.user_api_key_user_id`, `metadata.user_api_key_user_email`, `metadata.user_api_key_team_id`), den valgfrie v2-modusen (`LITELLM_OTEL_V2=true`) navnerommet `litellm.` —, og **OneUptime leser begge**.

### Kundenøklene er utelatt med vilje

En LLM-span kan bære **to** ulike personer: den ansatte som gjorde kallet, og **kunden** lenger ned i kjeden som det ble gjort for. Disse nøklene bærer kunden, og OneUptime leser bevisst **ingen** av dem inn i en identitetskolonne:

- `gen_ai.user` og `llm.user` — slik instrumenteringer gjengir OpenAIs forespørselsparameter `user`, som OpenAI dokumenterer som «a stable identifier for your end-users» (nå foreldet til fordel for `safety_identifier` og `prompt_cache_key`).
- `litellm.metadata.user_api_key_end_user_id`, `metadata.user_api_key_end_user_id` og `litellm.end_user.id` — LiteLLMs eksplisitte sluttbruker-id i alle tre skrivemåter, atskilt fra id-en til nøkkeleieren, som **er** den ansatte og **blir** lest.

Grunnen er riktig internfakturering: Leser man en kunde-id inn i ansattkolonnen, lager en supportbot som betjener 40 000 kunder 40 000 fantom-«ansatte», mens utvikleren som eier forbruket ser ut til ikke å ha brukt noe. Disse attributtene blir værende i det rå attributtkartet, der du kan spørre etter dem direkte.

### Identitetskolonner blir renset

Kolonnen med den ansattes e-post inneholder ekte personopplysninger. Telemetri-**Scrub-reglene** dine under omfanget **Attributter** dekker den akkurat slik de dekker attributtet den ble lest fra, så en regel som sladder e-poster, gjelder også for kolonnen. Konfigurer scrub-regler og drop-filtre under **Spor → Innstillinger**.

## Spans og målinger er en reserve, ikke en sum

**GenAI-spans er autoritative. Målingsstrømmen brukes bare når span-strømmen ikke har rapportert noe, og de to legges aldri sammen.** Et span bærer modell, tokens og kostnad på én rad, så der det finnes spans, svarer de på alle spørsmål. Der de ikke finnes — kodeagent-CLI-ene publiserer _målinger_ for tokens og kostnad og ingen GenAI-spans —, trer målingsstrømmen inn. De summeres ikke fordi mange instrumenteringer sender begge signalene for det samme kallet (OpenLLMetry er det vanlige tilfellet), og å legge dem sammen ville telle hver dollar to ganger.

Konsekvensen du må planlegge for: **Så snart GenAI-spannene dine rapporterer et tall som ikke er null, vises ikke bidraget fra en kilde med bare målinger i det tallet.** Reserven gjelder per tall og per oppdeling, ikke per avsender:

| Hvor                                         | Hva som faller tilbake på målinger                               | Når                                        |
| -------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| Forbruk → Input-tokens / Output-tokens       | Summer av input- og output-tokens                                | Begge token-summene fra spans er 0         |
| Forbruk → Kostnad (USD)                      | Kostnad, i USD og mikro-USD, skalert og lagt sammen              | Kostnadssummen fra spans er 0              |
| Forbruk → LLM-kall                           | Ingenting — bare spans                                           | —                                          |
| Forbruk → Ansatt, Team, Modell               | Bare kostnad. Kolonnene for kall og tokens viser `—`             | Den oppdelingen returnerte ingen span-rader |
| Forbruk → Leverandør, Applikasjon / Tjeneste | Ingenting — bare spans                                           | —                                          |
| Samtaler                                     | Ingenting — samtaler bygges fra spans                            | —                                          |

Leverandør og Applikasjon / Tjeneste har ingen målingsreserve fordi tellerne til kodeagentene ikke bærer noe GenAI-leverandørattributt og ikke er knyttet til noen OneUptime-telemetritjeneste. Der et tall kom fra målinger, merker siden det **fra GenAI-målinger**, fordi et tall fra målinger ikke har noen tilsvarende rader i listen Kall.

**Hvis forbruket til et verktøy med bare målinger skal kunne ses for seg, så gi det sitt eget prosjekt**, slik at span-strømmen er helt tom og reserven slår inn. Det samme gjelder budsjetter: Avgrens ett budsjett per tjeneste i stedet for å blande tjenester som sender spans med tjenester som bare sender målinger.

## Dashbord og målingsvarsler

GenAI-målinger kommer inn som vanlige OpenTelemetry-målinger, så du kan bygge **dashbord** som viser `gen_ai.client.token.usage`, `gen_ai.client.operation.duration` og resten i grafer, og opprette **målingsmonitorer** på dem — for eksempel når p95 for `gen_ai.client.operation.duration` krysser en terskel, gruppert etter modell. Se [Metrikk-overvåking](/docs/monitor/metrics-monitor).

## Daglige kostnadsbudsjetter

Fanen **Budsjetter** setter daglige grenser i USD, evaluert over UTC-døgnet. Hvert 15. minutt summerer en bakgrunnsarbeider dagens LLM-span-kostnad (rapportert eller beregnet), registrerer den på budsjettet og publiserer to gauge-målinger:

| Måling                              | Betydning                                       |
| ----------------------------------- | ----------------------------------------------- |
| `oneuptime.llm.budget.spend.usd`    | Dagens forbruk så langt, i USD                  |
| `oneuptime.llm.budget.percent.used` | Forbruket i prosent av den daglige grensen      |

Begge bærer attributtene `oneuptime.llm.budget.id` og `oneuptime.llm.budget.name`, i tillegg til budsjettets avgrensning til tjeneste, leverandør og modell når den er satt. Filtrer monitorer på **`oneuptime.llm.budget.id`**, som er stabil; navnet endres når du gir budsjettet nytt navn.

**Varsling gjøres med en [Metrikk-overvåking](/docs/monitor/metrics-monitor) på de målingene.** For det klassiske mønsteret 80 % / 100 % oppretter du en monitor på `oneuptime.llm.budget.percent.used`, filtrerer den på `oneuptime.llm.budget.id` og legger til to kriterier: `>= 80` som oppretter et vanlig varsel og `>= 100` som oppretter et kritisk. **Sett monitorens rullerende tid til 30 minutter**: Et budsjett publiserer ett punkt hvert 15. minutt, så standardvinduet på 1 minutt ville funnet en tom serie mellom to gjennomganger.

Budsjetter kan avgrenses til en telemetritjeneste, en LLM-leverandør eller en eksakt modell, eller gjelde hele prosjektet, og flere kan eksistere side om side. En budsjettmonitor kan også kalle en Workflow som stopper en agent som har løpt løpsk — se [Circuit breakers for AI-agenter som løper løpsk](/docs/telemetry/ai-agent-circuit-breaker).

## Personvern og sladding

Prompts og completions kan inneholde sensitive data. OneUptime bruker telemetri-**Scrub-reglene** og **Drop-filtrene** dine på LLM-spans som på ethvert annet trace, så du kan maskere attributter eller droppe spans før de lagres; konfigurer dem under **Spor → Innstillinger**. Kolonnen med den ansattes e-post dekkes av de samme reglene — se [Identitetskolonner blir renset](#identitetskolonner-blir-renset).

Samtaler leses med samme tillatelse som traces: Den som kan lese prosjektets traces, kan lese samtalene, og ingen andre.

## Relatert

- [Observerbarhet for AI-kodeassistenter](/docs/telemetry/ai-coding-assistants) — støttematrisen for Claude Code, Cursor, Codex, Gemini CLI, Copilot, Cline og resten, og hvordan forbruk per ansatt fungerer på tvers av dem.
- [Overvåking av Claude Code](/docs/telemetry/claude-code)
- [Overvåking av Cursor](/docs/telemetry/cursor)
- [Overvåking av OpenAI Codex CLI](/docs/telemetry/openai-codex)
- [Overvåking av Gemini CLI og GitHub Copilot](/docs/telemetry/gemini-cli-and-copilot)
- [Observere AI-gatewayer (LiteLLM og Portkey)](/docs/telemetry/ai-gateways)
- [Circuit breakers for AI-agenter som løper løpsk](/docs/telemetry/ai-agent-circuit-breaker)

# AI / LLM Observability with OneUptime

Read every conversation your AI had, replay it the way it happened, and get told when it answers badly. It all runs on standard OpenTelemetry, with no proprietary SDK: if your app emits spans with the OpenTelemetry **GenAI semantic conventions** (`gen_ai.*`), OneUptime turns them into conversations, alerts, usage and cost.

## What you get

Open **AI / LLM** in the navigation bar, under Observability:

- **Conversations** — every conversation your AI had: what people asked, what the AI answered, the tools it used and what went wrong. Five numbers sit above the list: conversations, AI answers, how many need attention, cost, and how long an answer typically takes. Open a conversation to read it or replay it.
- **Calls** — every LLM, embedding, agent and tool call, filterable by service, provider, model, operation, person and team. Click a call to open it in the trace viewer.
- **Usage** — the calls, tokens and cost of a time range, and who spends what: employees, teams, models, providers and apps ranked by spend.
- **Alerts** — ready-made alerts for when the AI answers badly, and your AI / LLM monitors.
- **Budgets** — daily cost limits, published as metrics to alert on.
- **Pricing** — your own per-model prices, for models the built-in catalog does not know.
- **Setup** — the five steps below, with your project's endpoint.

In the trace viewer, each AI call's span also has an **AI / LLM** panel with the model, token counts, cost, request parameters, and the prompt and completion.

## Step 1 — Send your AI calls

Create a telemetry ingestion key: open **Project Settings → Telemetry & APM → Ingestion Keys** and click **Create Ingestion Key**. Your app passes the key as an OTLP header. (See the [OpenTelemetry guide](/docs/telemetry/open-telemetry) for screenshots.)

Then instrument your app with any OpenTelemetry GenAI library:

- **OpenLLMetry** (Traceloop) — OpenAI, Anthropic, Cohere, Bedrock, LangChain, LlamaIndex, CrewAI and more.
- **OpenInference** (Arize) — OpenAI, LangChain, LlamaIndex, DSPy and more.
- The **Vercel AI SDK**, or the **OpenTelemetry instrumentations** for OpenAI, Anthropic and Gemini.

Routing your LLM traffic through a gateway like **LiteLLM** or **Portkey**? Export traces from the gateway instead of instrumenting every app — see [Observing AI Gateways](/docs/telemetry/ai-gateways). Looking for the coding assistants your engineers run — Claude Code, Cursor, Codex, Gemini CLI, Copilot? They export their own OpenTelemetry and need nothing from you: see [AI Coding Assistant Observability](/docs/telemetry/ai-coding-assistants).

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

### Plain OpenTelemetry environment variables

If you instrument with a native OpenTelemetry SDK, point the OTLP exporter at OneUptime:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
export OTEL_SERVICE_NAME="my-ai-agent"
```

Self-hosting OneUptime? Replace `https://oneuptime.com/otlp` with `https://YOUR-ONEUPTIME-HOST/otlp`.

## Step 2 — Record what was said

A conversation shows what people asked and what the AI answered when your instrumentation records them. OpenLLMetry records prompts and completions unless you turn it off (`TRACELOOP_TRACE_CONTENT=false`). The OpenTelemetry instrumentations record them only when you ask:

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

Without them, a conversation still shows its timing, cost and problems, and says that its content was not recorded. Prompts can carry sensitive data: see [Privacy and redaction](#privacy-and-redaction) to mask it before it is stored.

## Step 3 — Group calls into conversations

A chat app makes one model call per turn. Set `gen_ai.conversation.id` — or `session.id` — to your chat's id on every AI call, and each chat shows as one conversation, however many calls and traces it took. With OpenLLMetry, set it once per request as an association property:

```python
from traceloop.sdk import Traceloop

Traceloop.set_association_properties({
    "session_id": chat.id,
    "user_email": user.email,
})
```

Calls without a conversation id still show, one request (one trace) at a time.

## Step 4 — Say who asked

Set `user.id` or `user.email` — the association property above sets the email — to see who each conversation was with, to search the list by person, and to rank spend by employee on the Usage tab. [Employee and team attribution](#employee-and-team-attribution) lists every key OneUptime reads.

## Step 5 — Flag bad answers

OneUptime checks every answer as it arrives and marks what went wrong with it:

| Problem | What it means                                         | Found from                                                                                                                                                         |
| ------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Failed  | The call ended in an error, so no answer arrived      | Span status Error, `error.type`, or a finish reason of `error`                                                                                                     |
| Refused | The AI declined, or a safety filter blocked it        | A refusal or safety finish reason (`content_filter`, `refusal`, `SAFETY` and the like), a refusal in the answer, or an answer that opens with a stock English refusal |
| Cut off | The answer stopped at the token limit                 | A finish reason of `length`, `max_tokens` or `MAX_TOKENS`                                                                                                          |
| Empty   | The AI answered with no text and no tool call         | Recorded content that holds nothing, or 0 output tokens                                                                                                            |
| Flagged | An evaluation your app sent said the answer was bad   | A `gen_ai.evaluation.result` event                                                                                                                                 |

The first four need nothing from you. To flag the rest — an answer your guardrail, your eval or your own LLM judge rejects — add a `gen_ai.evaluation.result` event to the answer's span, with `gen_ai.evaluation.score.label` set to `fail`:

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

Labels such as `incorrect`, `wrong`, `unhelpful`, `toxic`, `unsafe` and `hallucination` count as failing too. The event has to be on the span of the answer it judges, while that span is open.

OneUptime never sends your conversations to another AI to judge them: every check reads only what the call itself carries.

## Read and replay a conversation

A conversation opens whole, the way a chat app shows its history: what the person said on the right, the AI's answers on the left with their model, time, tokens and cost, tool calls between them, and what went wrong marked where it happened. **Details** under an answer shows its finish reason and evaluations, with a link to the call in Traces.

The bar at the bottom replays the conversation the way the person lived it:

- **Replay** plays it from the first message at the pace it happened, with "AI is answering…" counting up while an answer is on its way. Click the time of any message to replay from there.
- **Skip waiting**, on by default, shortens silences longer than 3 seconds. The speed button plays at 1×, 2×, 4× or 8×.
- **K** plays or pauses, **J** or **←** goes back a message, and **L** or **→** goes forward.
- The address keeps the message a replay stopped at (`?step=`), so a link opens on that moment.

## Get told when the AI answers badly

The **Alerts** tab offers the alerts most AI apps want. Picking one opens Create Monitor filled in, where you can change anything before you save:

| Alert                    | When it tells you                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| Answers go wrong         | More than 5% of answers in 15 minutes fail, are refused, cut off, empty or flagged          |
| AI calls fail            | More than 10% of the calls to the model in 5 minutes end in an error                        |
| The AI refuses to answer | More than 5% of answers in 30 minutes are refusals                                          |
| Answers are cut off      | 3 or more answers in 30 minutes stop at the token limit                                     |
| Answers are flagged      | An evaluation marks an answer as bad                                                        |
| Answers are slow         | More than 10% of answers in 15 minutes take longer than 30 seconds                          |
| The AI stops answering   | The AI gives no answers for 30 minutes                                                      |

The alerts on a share also wait for at least 3 bad answers, so one bad answer out of two pages nobody.

Each alert is an **AI / LLM monitor**. Its settings say what counts as a bad answer — the problems above, an answer slower than a limit you set, or both — which apps and which model it watches, and how far back each check looks. Under them, a preview shows what the monitor would count right now. Its criteria compare three numbers: the **share of bad answers** (in %), the **number of bad answers** and the **number of answers**. A ready-made alert raises an alert that resolves itself and shows the monitor as Degraded while answers are bad; switch its incident on to page someone instead.

Spend is watched by [daily cost budgets](#daily-cost-budgets).

## Attributes OneUptime recognizes

OneUptime reads the OpenTelemetry GenAI conventions first, and falls back to the OpenLLMetry and OpenInference variants so popular libraries work out of the box.

| What                        | Primary attribute            | Also accepted                                                                                                                                                                                                                                                      |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider / system           | `gen_ai.provider.name`       | `gen_ai.system` (deprecated in the conventions, still widely emitted), `llm.system`, `llm.provider`                                                                                                                                                                |
| Operation                   | `gen_ai.operation.name`      | `llm.request.type`, `openinference.span.kind`                                                                                                                                                                                                                      |
| Requested model             | `gen_ai.request.model`       | `llm.model_name`, `llm.request.model`                                                                                                                                                                                                                              |
| Response model              | `gen_ai.response.model`      | `llm.response.model`                                                                                                                                                                                                                                               |
| Input tokens                | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`, `llm.token_count.prompt`, `llm.usage.prompt_tokens`                                                                                                                                                                                  |
| Output tokens               | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.token_count.completion`, `llm.usage.completion_tokens`                                                                                                                                                                      |
| Total tokens                | `gen_ai.usage.total_tokens`  | `llm.token_count.total`, `llm.usage.total_tokens`; derived from input + output when none is reported                                                                                                                                                               |
| Cost (USD)                  | `gen_ai.usage.cost`          | `gen_ai.usage.cost_usd`, `gen_ai.usage.total_cost`, `llm.usage.total_cost`, `gen_ai.cost.total_cost` (LiteLLM), `litellm.cost.total`                                                                                                                               |
| Agent name                  | `gen_ai.agent.name`          | `agent.name`                                                                                                                                                                                                                                                       |
| Tool name                   | `gen_ai.tool.name`           | `tool.name`                                                                                                                                                                                                                                                        |
| Conversation / session id   | `gen_ai.conversation.id`     | `session.id`, `langfuse.session.id`, `traceloop.association.properties.session_id`                                                                                                                                                                                 |
| Employee (who ran the call) | `user.id`                    | `enduser.id`, `litellm.metadata.user_api_key_user_id` and `metadata.user_api_key_user_id` (LiteLLM OTel v2 and v1 spellings — both read), `traceloop.association.properties.user_id`, `langfuse.user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id` |
| Employee email              | `user.email`                 | `traceloop.association.properties.user_email`, `enduser.email`                                                                                                                                                                                                     |
| Team / cost centre          | `team.id`                    | `team`, `cost_center`, `department`, `litellm.metadata.user_api_key_team_id` and `litellm.team.id` (LiteLLM OTel v2), `metadata.user_api_key_team_id` (LiteLLM OTel v1), `cursor.team.id`                                                                          |

The `traceloop.association.properties.*` sub-keys are **caller-supplied**: Traceloop defines the prefix, and your code supplies what goes under it. `gen_ai.usage.total_tokens` and `gen_ai.usage.cost` are **de-facto** keys, not GenAI semantic conventions — the conventions define no total-token attribute and no cost attribute — and OneUptime reads them because the common instrumentations emit them. `gen_ai.system` is the conventions' own deprecated predecessor to `gen_ai.provider.name`; both are read.

**The three identity rows are also matched with a `resource.` prefix.** OTLP ingest flattens every _resource_ attribute into the span's attribute map under a `resource.` prefix, so `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` arrives as `resource.team.id`. OneUptime looks for the whole bare list first, then the whole `resource.` list, so a span attribute (which describes one call) beats a resource attribute (which describes the whole process). The other rows are matched on the bare key only: they are per-call values.

**Prompt and completion content** is read from the `gen_ai.client.inference.operation.details` event; from the `gen_ai.input.messages`, `gen_ai.output.messages` and `gen_ai.system_instructions` span attributes; from the **deprecated** per-role events older instrumentations still emit (`gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.tool.message`, `gen_ai.assistant.message`, `gen_ai.choice`); from the indexed attributes (`gen_ai.prompt.N.content` and `gen_ai.completion.N.content`, OpenInference's `llm.input_messages.N.message.content` and `llm.output_messages.N.message.content`); and from the JSON message arrays (`gen_ai.prompt`, `gen_ai.completion`, `input.value`, `output.value`).

### How cost is calculated

If your instrumentation reports a cost (`gen_ai.usage.cost`), OneUptime uses it as-is: the reported value always wins. When no cost is reported, OneUptime computes an **estimated cost at ingest** from the span's token counts and a built-in list-price catalog of common models from OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, xAI, Cohere, Amazon Nova and Meta Llama. Models are matched by name prefix, so dated snapshots like `gpt-4o-2024-08-06` and vendor-decorated ids like `us.anthropic.claude-3-5-sonnet-20241022-v2:0` resolve correctly. Unknown or custom models are never guessed — their cost stays `0` until you give them a price on the **Pricing** tab. Estimates use list prices and do not account for cache or batch discounts.

Self-hosting OneUptime? The catalog lives in `packages/Common/Types/Telemetry/LlmCostCatalog.ts`.

## Employee and team attribution

"Which of our engineers spent $4k on Opus last month" is a question about a person, and no LLM span answers it unless something on the span names one. OneUptime copies the human actor into queryable columns at ingest, so you group and filter on a column instead of writing attribute lookups.

The three identity rows in the table above are the whole mechanism; the first key present wins, in the order listed. `user.id` leads because it is the canonical OpenTelemetry key for a human actor and the one to standardize on if you set identity yourself. **One exception: Claude Code** emits `user.id` as a random anonymous identifier kept in `~/.claude.json`, not a person. That is harmless on its metric datapoints, whose list is email-first, but if you enable Claude Code's traces beta, the anonymous `user.id` outranks `user.email` on the spans: drop or remap `user.id` in a collector processor for that fleet. `enduser.id` is still an active semantic-convention attribute and is accepted as an equal alias. `cursor.user.id` sorts last because it is an opaque, team-scoped integer that needs Cursor's admin API to resolve to a person.

Identity is read only on spans already recognized as LLM calls: `user.id`, `user.email` and `team.id` are generic keys that browser and ordinary backend spans carry too. **Metric datapoints** carry a shorter, email-first list — `user.email`, `user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id`, with teams from `team.id`, `team`, `cost_center`, `department` and `cursor.team.id`, each also matched with the `resource.` prefix — because the coding-agent CLIs that emit metrics without spans emit `user.email` natively. Nothing reads identity off **log records** today.

### Setting the team and cost centre

No instrumentation emits `team.id`, `team`, `cost_center` or `department`: your organization sets them, conventionally through `OTEL_RESOURCE_ATTRIBUTES` on the process:

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

They reach OneUptime as `resource.team.id`, `resource.team`, `resource.cost_center` and `resource.department`, and both tiers are recognized on spans and on metric datapoints, whether your exporter leaves the keys in the OTLP resource block or copies them onto each span (Claude Code does the latter). A bare `team.id` set directly on a span still wins.

The gateway spellings arrive with no configuration from you. LiteLLM names its attributes differently in its two OpenTelemetry modes — the default v1 `otel` callback uses a bare `metadata.` prefix (`metadata.user_api_key_user_id`, `metadata.user_api_key_user_email`, `metadata.user_api_key_team_id`), the opt-in v2 mode (`LITELLM_OTEL_V2=true`) the `litellm.` namespace — and **OneUptime reads both**.

### The customer keys are excluded on purpose

An LLM span can carry **two** different people: the employee who made the call, and the downstream **customer** it was made for. These keys carry the customer, and OneUptime deliberately reads **none** of them into an identity column:

- `gen_ai.user` and `llm.user` — how instrumentations echo OpenAI's `user` request parameter, which OpenAI documents as "a stable identifier for your end-users" (now deprecated in favour of `safety_identifier` and `prompt_cache_key`).
- `litellm.metadata.user_api_key_end_user_id`, `metadata.user_api_key_end_user_id` and `litellm.end_user.id` — LiteLLM's explicit end-user id in all three spellings, distinct from the key-owner id, which **is** the employee and **is** read.

The reason is chargeback correctness: read a customer id into the employee column and a support bot serving 40,000 customers creates 40,000 phantom "employees", while the engineer who owns the spend appears to have spent nothing. These attributes stay in the raw attributes map, where you can query them directly.

### Identity columns are scrubbed

The employee email column holds real personal data. Your telemetry **scrub rules** under the **Attributes** scope cover it exactly as they cover the attribute it was read from, so an email-redaction rule applies to the column too. Configure scrub rules and drop filters under **Traces → Settings**.

## Spans and metrics are a fallback, not a sum

**GenAI spans are authoritative. The metric stream is consulted only when the span stream reported nothing, and the two are never added together.** A span carries model, tokens and cost on one row, so where spans exist they answer every question. Where they do not — the coding-agent CLIs publish token and cost _metrics_ and no GenAI spans — the metric stream stands in. They are not summed because many instrumentations emit both signals for the same call (OpenLLMetry is the common case), and adding them would count every dollar twice.

The consequence to plan around: **once your GenAI spans report a non-zero figure, a metrics-only source's contribution to that figure does not appear.** The fallback is per figure and per breakdown, not per emitter:

| Where                                   | What falls back to metrics                       | When                                 |
| --------------------------------------- | ------------------------------------------------ | ------------------------------------ |
| Usage → Input / Output tokens           | Input and output token totals                    | Both span token sums are 0           |
| Usage → Cost (USD)                      | Cost, in USD and micro-USD, scaled and added     | The span cost sum is 0               |
| Usage → LLM calls                       | Nothing — span-only                              | —                                    |
| Usage → Employee, Team, Model           | Cost only. Calls and token columns render as `—` | That breakdown returned no span rows |
| Usage → Provider, Application / Service | Nothing — span-only                              | —                                    |
| Conversations                           | Nothing — conversations are built from spans     | —                                    |

Provider and Application / Service have no metric fallback because the coding-agent counters carry no GenAI provider attribute and are not attached to a OneUptime telemetry service. Wherever a figure came from metrics, the page labels it **from GenAI metrics**, because a metric-sourced figure has no matching rows in the Calls list.

**If you need a metrics-only tool's spend to stand on its own, give it its own project**, so its span stream is genuinely empty and the fallback engages. The same applies to budgets: scope one budget per service rather than mixing span-emitting and metrics-only services.

## Dashboards and metric alerts

GenAI metrics arrive as ordinary OpenTelemetry metrics, so you can build **dashboards** charting `gen_ai.client.token.usage`, `gen_ai.client.operation.duration` and the rest, and create **metric monitors** on them — for example when the p95 of `gen_ai.client.operation.duration` crosses a threshold, grouped by model. See [Metrics Monitor](/docs/monitor/metrics-monitor).

## Daily cost budgets

The **Budgets** tab sets daily USD limits, evaluated over the UTC day. Every 15 minutes a background worker sums the day's LLM span cost (reported or computed), records it on the budget, and publishes two gauge metrics:

| Metric                              | Meaning                               |
| ----------------------------------- | ------------------------------------- |
| `oneuptime.llm.budget.spend.usd`    | The day's spend so far, in USD        |
| `oneuptime.llm.budget.percent.used` | Spend as a percent of the daily limit |

Both carry `oneuptime.llm.budget.id` and `oneuptime.llm.budget.name` attributes, plus the budget's service, provider and model scope when set. Filter monitors by **`oneuptime.llm.budget.id`**, which is stable; the name changes when you rename the budget.

**Alerting is a [Metrics Monitor](/docs/monitor/metrics-monitor) on those metrics.** For the classic 80% / 100% pattern, create a monitor on `oneuptime.llm.budget.percent.used`, filter it by `oneuptime.llm.budget.id`, and add two criteria: `>= 80` creating a warning alert and `>= 100` creating a critical one. **Set the monitor's rolling time to 30 minutes**: a budget publishes one point every 15 minutes, so the 1-minute default window would find an empty series between sweeps.

Budgets can be scoped to a telemetry service, an LLM provider or an exact model, or left project-wide, and several can coexist. A budget monitor can also call a Workflow that stops a runaway agent — see [Circuit-Breaking Runaway AI Agents](/docs/telemetry/ai-agent-circuit-breaker).

## Privacy and redaction

Prompts and completions can contain sensitive data. OneUptime applies your telemetry **scrub rules** and **drop filters** to LLM spans like any other trace, so you can mask attributes or drop spans before they are stored; configure them under **Traces → Settings**. The employee-email column is covered by the same rules — see [Identity columns are scrubbed](#identity-columns-are-scrubbed).

Conversations are read with the same permission as traces: whoever can read the project's traces can read its conversations, and no one else.

## Related

- [AI Coding Assistant Observability](/docs/telemetry/ai-coding-assistants) — the support matrix for Claude Code, Cursor, Codex, Gemini CLI, Copilot, Cline and the rest, and how per-employee spend works across them.
- [Monitoring Claude Code](/docs/telemetry/claude-code)
- [Monitoring Cursor](/docs/telemetry/cursor)
- [Monitoring OpenAI Codex CLI](/docs/telemetry/openai-codex)
- [Monitoring Gemini CLI and GitHub Copilot](/docs/telemetry/gemini-cli-and-copilot)
- [Observing AI Gateways (LiteLLM & Portkey)](/docs/telemetry/ai-gateways)
- [Circuit-Breaking Runaway AI Agents](/docs/telemetry/ai-agent-circuit-breaker)

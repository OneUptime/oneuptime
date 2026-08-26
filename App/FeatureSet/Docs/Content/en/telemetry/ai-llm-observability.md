# AI / LLM Observability with OneUptime

Observe your LLM and AI-agent applications in OneUptime: per-call traces, token usage, cost, latency, errors, and the actual prompts and completions — all over standard OpenTelemetry. There is no proprietary SDK. If your app emits spans using the OpenTelemetry **GenAI semantic conventions** (`gen_ai.*`), OneUptime turns them into a first-class AI observability experience.

## How it works

OneUptime ingests OpenTelemetry traces at the OTLP endpoint. When a span carries GenAI attributes, OneUptime automatically:

- Tags it as an **LLM call** and denormalizes the model, operation, provider, token counts and cost for fast querying.
- Surfaces it in the dedicated **AI / LLM** section (an LLM calls list plus a token / cost / latency overview).
- Renders a first-class **AI / LLM panel** on the span showing provider, model, tokens, cost, request parameters, and the prompt & completion content.

Because everything is OpenTelemetry, the same data also powers dashboards and metric alerts.

## Step 1 — Create a Telemetry Ingestion Token

In OneUptime, open **Project Settings → Telemetry & APM → Ingestion Keys** and click **Create Ingestion Key**. Copy the key — you will pass it to your app as an OTLP header. (See the [OpenTelemetry guide](/docs/telemetry/open-telemetry) for screenshots.)

## Step 2 — Instrument your app

Use any OpenTelemetry GenAI instrumentation. Popular choices:

- **OpenLLMetry** (Traceloop) — auto-instruments OpenAI, Anthropic, Cohere, Bedrock, LangChain, LlamaIndex, CrewAI and more.
- **OpenInference** (Arize) — instrumentors for OpenAI, LangChain, LlamaIndex, DSPy, etc.
- **Native OpenTelemetry** GenAI instrumentations.

Routing your LLM traffic through a gateway like **LiteLLM** or **Portkey**? You can export traces from the gateway itself instead of instrumenting every app — see [Observing AI Gateways](/docs/telemetry/ai-gateways).

Looking for the coding assistants your engineers run — Claude Code, Cursor, Codex, Gemini CLI, Copilot — rather than your own applications? Those export their own OpenTelemetry and need no instrumentation from you. See [AI Coding Assistant Observability](/docs/telemetry/ai-coding-assistants) for the support matrix and the per-tool guides.

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

## Attributes OneUptime recognizes

OneUptime reads the OpenTelemetry GenAI conventions first, and falls back to the OpenLLMetry and OpenInference variants so popular libraries work out of the box.

| What                        | Primary attribute            | Also accepted                                                                                                                                                                   |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider / system           | `gen_ai.system`              | `gen_ai.provider.name`, `llm.system`, `llm.provider`                                                                                                                            |
| Operation                   | `gen_ai.operation.name`      | `llm.request.type`, `openinference.span.kind`                                                                                                                                   |
| Requested model             | `gen_ai.request.model`       | `llm.model_name`, `llm.request.model`                                                                                                                                           |
| Response model              | `gen_ai.response.model`      | `llm.response.model`                                                                                                                                                            |
| Input tokens                | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`, `llm.token_count.prompt`, `llm.usage.prompt_tokens`                                                                                               |
| Output tokens               | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.token_count.completion`, `llm.usage.completion_tokens`                                                                                   |
| Total tokens                | `gen_ai.usage.total_tokens`  | `llm.token_count.total`, `llm.usage.total_tokens`; derived from input + output when none is reported                                                                            |
| Cost (USD)                  | `gen_ai.usage.cost`          | `gen_ai.usage.cost_usd`, `gen_ai.usage.total_cost`, `llm.usage.total_cost`, `gen_ai.cost.total_cost` (LiteLLM), `litellm.cost.total`                                            |
| Agent name                  | `gen_ai.agent.name`          | `agent.name`                                                                                                                                                                    |
| Tool name                   | `gen_ai.tool.name`           | `tool.name`                                                                                                                                                                     |
| Conversation / session id   | `gen_ai.conversation.id`     | `session.id`, `langfuse.session.id`, `traceloop.association.properties.session_id`                                                                                              |
| Employee (who ran the call) | `user.id`                    | `enduser.id`, `litellm.metadata.user_api_key_user_id`, `traceloop.association.properties.user_id`, `langfuse.user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id` |
| Employee email              | `user.email`                 | `traceloop.association.properties.user_email`, `enduser.email`                                                                                                                  |
| Team / cost centre          | `team.id`                    | `team`, `cost_center`, `department`, `litellm.metadata.user_api_key_team_id`, `litellm.team.id`, `cursor.team.id`                                                               |

**The three identity rows are also matched with a `resource.` prefix.** OTLP ingest flattens every _resource_ attribute into the span's attribute map under a `resource.` prefix, so `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` arrives as `resource.team.id`, not `team.id`. OneUptime looks for both spellings on the employee id, employee email and team rows — the whole bare list first, then the whole `resource.`-prefixed list, so a span attribute (which describes one call) beats a resource attribute (which describes the whole process). The other rows in the table are matched on the bare key only: they are per-call values, and a resource-scoped `gen_ai.request.model` would be a misconfiguration rather than a convention to support.

**Prompt & completion content** is read from the standard content events (`gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.tool.message`, `gen_ai.assistant.message`, `gen_ai.choice`), the indexed attributes (`gen_ai.prompt.N.content` / `gen_ai.completion.N.content`, and OpenInference's `llm.input_messages.N.message.content` / `llm.output_messages.N.message.content`), or the JSON message arrays (`gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.prompt`, `gen_ai.completion`, `input.value`, `output.value`) — and rendered in the AI / LLM panel.

**Conversation grouping:** OneUptime extracts a conversation/session id from `gen_ai.conversation.id` (OTel semantic conventions), `session.id` (OpenInference / Langfuse-compatible SDKs), `langfuse.session.id`, or `traceloop.association.properties.session_id` (OpenLLMetry) and stores it as a first-class queryable column (`llmConversationId`) on the span. This lets you filter all LLM calls belonging to one user interaction, even when they span multiple traces.

### How cost is calculated

If your instrumentation reports a cost (`gen_ai.usage.cost`), OneUptime uses it as-is — the reported value always wins. When no cost is reported, OneUptime computes an **estimated cost at ingest** from the span's token counts and a built-in list-price catalog of common models from OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, xAI, Cohere, Amazon Nova and Meta Llama. Models are matched by name prefix, so dated snapshots like `gpt-4o-2024-08-06` and vendor-decorated ids like `us.anthropic.claude-3-5-sonnet-20241022-v2:0` resolve correctly. Unknown or custom models are never guessed — their cost stays `0`. Estimates use list prices and do not account for cache or batch discounts.

Self-hosting OneUptime? The catalog lives in `Common/Types/Telemetry/LlmCostCatalog.ts` if you want to extend it.

## Employee and team attribution

"Which of our engineers burned $4k on Opus last month" is a question about a person, and no LLM span answers it unless something on the span names one. OneUptime denormalizes the human actor into queryable columns at ingest, so you group and filter on a column rather than writing attribute lookups by hand.

The three identity rows in the table above are the whole mechanism. The first key present wins, in the order listed. `user.id` leads because it is the canonical OpenTelemetry key for a human actor and the one to standardize on if you are stamping identity yourself. `enduser.id` is still an active semantic-convention attribute — the 1.25 deprecation removed `enduser.role` and `enduser.scope`, not `enduser.id` — so it is accepted as an equal alias. `cursor.user.id` sorts last because it is an opaque, team-scoped integer that needs Cursor's admin API to resolve to a person.

Identity on a span is only read when the span is already recognized as an LLM call. `user.id`, `user.email` and `team.id` are generic OpenTelemetry keys that browser and ordinary backend spans carry too; stamping the identity columns onto those would copy the value across the highest-volume span classes there are to serve a question only LLM spans answer.

**Metric datapoints** carry a shorter, email-first list: `user.email`, `user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id`, with teams from `team.id`, `team`, `cost_center`, `department` and `cursor.team.id` — each also matched with the `resource.` prefix, for the same reason as on spans. Email leads there because the coding-agent CLIs that emit metrics without spans emit `user.email` natively.

Nothing reads identity off **log records** today.

### Setting the team and cost centre

None of `team.id`, `team`, `cost_center` or `department` is emitted by any instrumentation — they are what your organization sets, conventionally through `OTEL_RESOURCE_ATTRIBUTES` on the process:

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform Engineering,cost_center=eng-123,department=engineering"
```

That variable sets _resource_ attributes, which reach OneUptime as `resource.team.id`, `resource.team`, `resource.cost_center` and `resource.department`. Both tiers are recognized on spans and on metric datapoints, so this works whether your exporter leaves the keys in the OTLP resource block or copies them onto each span and datapoint (Claude Code does the latter by default). A bare `team.id` set directly on a span still wins over the resource-level one.

The gateway spellings (`litellm.metadata.user_api_key_team_id`, `litellm.team.id`, `cursor.team.id`) arrive without any configuration from you.

### The customer keys are excluded on purpose

An LLM span can carry **two** different humans: the employee who made the call, and the downstream **customer** on whose behalf it was made. These three keys carry the second one, and OneUptime deliberately does **not** read any of them into an identity column:

- `gen_ai.user` and `llm.user` — how instrumentations echo back OpenAI's `user` request parameter, which the API documents as the caller's own end user, sent for abuse monitoring.
- `litellm.metadata.user_api_key_end_user_id` — LiteLLM's explicit end-user id, distinct from the `litellm.metadata.user_api_key_user_id` key-owner id, which **is** the employee and **is** recognized.

The reason is chargeback correctness. Read a downstream customer id into the employee column and a support bot serving 40,000 customers manufactures 40,000 phantom "employees", while the engineer who actually owns that spend appears to have spent nothing. Wrong attribution is worse than missing attribution, because it looks like an answer.

These attributes are still in the raw attributes map and you can query them directly. If you want downstream-customer analytics, it belongs in its own column, never by folding a customer key into the employee list.

### Identity columns are scrubbed

The employee email column holds real PII. It is covered by your telemetry **scrub rules** under the **Attributes** scope exactly as the attribute it was derived from is, so an email-redaction rule applies to the denormalized column too rather than silently missing the one column most likely to hold an email. Configure scrub rules and drop filters under **Traces → Settings**.

## View your LLM calls

Open **AI / LLM** in the navigation bar (under Observability):

- **Overview** — total calls, input/output tokens, cost, and error rate for the last 7 days, plus the most recent calls.
- **LLM Calls** — a filterable list of every LLM, embedding, agent and tool call. Filter by provider, model, operation or service. Click a call to open it in the trace viewer.
- **Usage** — employees, teams, models, providers and services ranked by spend, built on the identity columns above. See [Spans and metrics are a fallback, not a sum](#spans-and-metrics-are-a-fallback-not-a-sum) for how a metrics-only source such as a coding-agent CLI appears here.
- **Budgets** — daily cost budgets published as metrics for monitors to alert on (see [Daily cost budgets](#daily-cost-budgets) below).
- Each span has an **AI / LLM** tab/panel with the model, token counts, cost, request parameters, and the rendered prompt & completion.

### Spans and metrics are a fallback, not a sum

This is the rule that decides what a mixed fleet sees, so it is worth stating plainly rather than in a footnote.

**GenAI spans are authoritative. The metric stream is consulted only when the span stream reported nothing, and the two are never added together.** A span carries model, tokens and cost on one row, so where spans exist they answer every question. Where they do not — the coding-agent CLIs publish token and cost _metrics_ and no GenAI spans — the metric stream stands in.

They are not summed because plenty of instrumentations emit both signals for the same call (OpenLLMetry is the common case). Adding them would count every one of those dollars twice, and an inflated figure that gates a budget alert is worse than a missing one: it fires on spend that never happened.

The consequence to plan around: **once your GenAI spans report a non-zero figure, a metrics-only source's contribution to that figure does not appear.** If you have an instrumented Python service emitting `gen_ai.*` spans _and_ a Claude Code fleet emitting `claude_code.*` metrics into the same project, the Overview tiles and the Usage table read the spans and stop there — the Claude Code spend is not added on top. The fallback is per figure and per breakdown, not per emitter, so it turns on exactly when a figure would otherwise be zero:

| Where                                   | What falls back to metrics                       | When                                 |
| --------------------------------------- | ------------------------------------------------ | ------------------------------------ |
| Overview → Input / Output tokens        | Input and output token totals                    | Both span token sums are 0           |
| Overview → Cost (USD)                   | Cost, in USD and micro-USD, scaled and added     | The span cost sum is 0               |
| Overview → LLM calls, Errored calls     | Nothing — span-only                              | —                                    |
| Usage → Employee, Team, Model           | Cost only. Calls and token columns render as `—` | That breakdown returned no span rows |
| Usage → Provider, Application / Service | Nothing — span-only                              | —                                    |

Provider and Application/Service have no metric fallback because the signal does not exist: the coding-agent counters carry no `gen_ai.system`, and they are not attached to a OneUptime telemetry service. The Usage tab says so in place of an empty table rather than leaving you to guess.

Wherever a figure came from metrics, the page labels it **from GenAI metrics**, because a metric-sourced cost has no matching rows in the LLM Calls list and an unlabelled number would read as a contradiction.

**If you need a metrics-only tool's spend to stand on its own, give it its own project** (or its own ingestion key and project), so its span stream is genuinely empty and the fallback engages. The same applies to budgets: a budget whose scope mixes span-emitting and metrics-only services resolves to spans and under-counts the metrics-only ones — scope one budget per service instead.

## Dashboards and alerts

Because GenAI metrics arrive as ordinary OpenTelemetry metrics, you can:

- Build **dashboards** charting `gen_ai.client.token.usage`, `gen_ai.client.operation.duration`, etc. (Dashboards → add a chart on the metric).
- Create **metric monitors** to alert on token spend, latency or error rate — for example alert when `gen_ai.client.operation.duration` p95 crosses a threshold, grouped by model. See [Metrics Monitor](/docs/monitor/metrics-monitor).

## Daily cost budgets

The **AI / LLM** section has a **Budgets** tab. Each budget sets a daily USD limit, evaluated over the UTC day. Every 15 minutes a background worker sums the day's LLM span cost (SDK-reported or computed), records the current spend on the budget, and publishes two gauge metrics:

| Metric                              | Meaning                               |
| ----------------------------------- | ------------------------------------- |
| `oneuptime.llm.budget.spend.usd`    | The day's spend so far, in USD        |
| `oneuptime.llm.budget.percent.used` | Spend as a percent of the daily limit |

Both carry `oneuptime.llm.budget.id` and `oneuptime.llm.budget.name` attributes (plus the budget's service/provider/model scope when set), so one metric series cleanly separates into one line per budget. Filter monitors by **`oneuptime.llm.budget.id`** — it is stable; the name attribute is convenient for chart labels but changes if you rename the budget, which would silently detach a name-filtered monitor.

**Alerting is a [Metrics Monitor](/docs/monitor/metrics-monitor) on those metrics.** For the classic 80%/100% pattern, create a monitor on `oneuptime.llm.budget.percent.used`, filter by `oneuptime.llm.budget.id`, and add two criteria — value `>= 80` creating a warning-severity alert, and value `>= 100` creating a critical one, attached to your on-call policy. **Set the monitor's rolling time to 30 minutes**: each budget publishes one point every 15 minutes, so the 1-minute default window would find an empty series between sweeps and flap the alert. Because it's an ordinary metric, everything monitors can do applies: formulas, anomaly detection against learned baselines, dashboards charting spend across budgets.

Budgets can be scoped to a telemetry service, an LLM provider (the `gen_ai` provider name), or an exact model — or left project-wide. Multiple budgets can coexist, for example a project-wide budget plus a stricter one for an expensive model.

Budget monitors can do more than notify: chain one to a Workflow that calls a webhook in your infrastructure to stop a runaway agent — see [Circuit-Breaking Runaway AI Agents](/docs/telemetry/ai-agent-circuit-breaker).

## Privacy & redaction

Prompt and completion content can contain sensitive data. OneUptime applies your existing telemetry **scrub rules** and **drop filters** to LLM spans just like any other trace, so you can redact or drop attributes before they are stored. Configure these under **Traces → Settings**. The denormalized employee-email column is covered by the same rules — see [Identity columns are scrubbed](#identity-columns-are-scrubbed).

## Related

- [AI Coding Assistant Observability](/docs/telemetry/ai-coding-assistants) — the support matrix for Claude Code, Cursor, Codex, Gemini CLI, Copilot, Cline and the rest, and how per-employee spend works across them.
- [Monitoring Claude Code](/docs/telemetry/claude-code)
- [Monitoring Cursor](/docs/telemetry/cursor)
- [Monitoring OpenAI Codex CLI](/docs/telemetry/openai-codex)
- [Monitoring Gemini CLI and GitHub Copilot](/docs/telemetry/gemini-cli-and-copilot)
- [Observing AI Gateways (LiteLLM & Portkey)](/docs/telemetry/ai-gateways)
- [Circuit-Breaking Runaway AI Agents](/docs/telemetry/ai-agent-circuit-breaker)

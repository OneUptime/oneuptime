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

| What                      | Primary attribute            | Also accepted                                                                                               |
| ------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Provider / system         | `gen_ai.system`              | `gen_ai.provider.name`, `llm.system`                                                                        |
| Operation                 | `gen_ai.operation.name`      | `llm.request.type`, `openinference.span.kind`                                                               |
| Requested model           | `gen_ai.request.model`       | `llm.model_name`                                                                                            |
| Response model            | `gen_ai.response.model`      | —                                                                                                           |
| Input tokens              | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`, `llm.token_count.prompt`                                                      |
| Output tokens             | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.token_count.completion`                                              |
| Total tokens              | `gen_ai.usage.total_tokens`  | derived from input + output                                                                                 |
| Cost (USD)                | `gen_ai.usage.cost`          | `gen_ai.usage.total_cost`, `llm.usage.total_cost`, `gen_ai.cost.total_cost` (LiteLLM), `litellm.cost.total` |
| Agent name                | `gen_ai.agent.name`          | —                                                                                                           |
| Tool name                 | `gen_ai.tool.name`           | —                                                                                                           |
| Conversation / session id | `gen_ai.conversation.id`     | `session.id`, `langfuse.session.id`, `traceloop.association.properties.session_id`                          |

**Prompt & completion content** is read from the standard content events (`gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.assistant.message`, `gen_ai.choice`) or the indexed attributes (`gen_ai.prompt.N.content`, `gen_ai.completion.N.content`) and rendered in the AI / LLM panel.

**Conversation grouping:** OneUptime extracts a conversation/session id from `gen_ai.conversation.id` (OTel semantic conventions), `session.id` (OpenInference / Langfuse-compatible SDKs), `langfuse.session.id`, or `traceloop.association.properties.session_id` (OpenLLMetry) and stores it as a first-class queryable column (`llmConversationId`) on the span. This lets you filter all LLM calls belonging to one user interaction, even when they span multiple traces.

### How cost is calculated

If your instrumentation reports a cost (`gen_ai.usage.cost`), OneUptime uses it as-is — the reported value always wins. When no cost is reported, OneUptime computes an **estimated cost at ingest** from the span's token counts and a built-in list-price catalog of common models from OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, xAI, Cohere, Amazon Nova and Meta Llama. Models are matched by name prefix, so dated snapshots like `gpt-4o-2024-08-06` and vendor-decorated ids like `us.anthropic.claude-3-5-sonnet-20241022-v2:0` resolve correctly. Unknown or custom models are never guessed — their cost stays `0`. Estimates use list prices and do not account for cache or batch discounts.

Self-hosting OneUptime? The catalog lives in `Common/Types/Telemetry/LlmCostCatalog.ts` if you want to extend it.

## View your LLM calls

Open **AI / LLM** in the navigation bar (under Observability):

- **Overview** — total calls, input/output tokens, cost, and error rate for the last 7 days, plus the most recent calls.
- **LLM Calls** — a filterable list of every LLM, embedding, agent and tool call. Filter by provider, model, operation or service. Click a call to open it in the trace viewer.
- **Budgets** — daily cost budgets published as metrics for monitors to alert on (see [Daily cost budgets](#daily-cost-budgets) below).
- Each span has an **AI / LLM** tab/panel with the model, token counts, cost, request parameters, and the rendered prompt & completion.

## Dashboards and alerts

Because GenAI metrics arrive as ordinary OpenTelemetry metrics, you can:

- Build **dashboards** charting `gen_ai.client.token.usage`, `gen_ai.client.operation.duration`, etc. (Dashboards → add a chart on the metric).
- Create **metric monitors** to alert on token spend, latency or error rate — for example alert when `gen_ai.client.operation.duration` p95 crosses a threshold, grouped by model. See [Metrics Monitor](/docs/monitor/metrics-monitor).

## Daily cost budgets

The **AI / LLM** section has a **Budgets** tab. Each budget sets a daily USD limit, evaluated over the UTC day. Every 15 minutes a background worker sums the day's LLM span cost (SDK-reported or computed), records the current spend on the budget, and publishes two gauge metrics:

| Metric | Meaning |
| --- | --- |
| `oneuptime.llm.budget.spend.usd` | The day's spend so far, in USD |
| `oneuptime.llm.budget.percent.used` | Spend as a percent of the daily limit |

Both carry `oneuptime.llm.budget.id` and `oneuptime.llm.budget.name` attributes (plus the budget's service/provider/model scope when set), so one metric series cleanly separates into one line per budget. Filter monitors by **`oneuptime.llm.budget.id`** — it is stable; the name attribute is convenient for chart labels but changes if you rename the budget, which would silently detach a name-filtered monitor.

**Alerting is a [Metrics Monitor](/docs/monitor/metrics-monitor) on those metrics.** For the classic 80%/100% pattern, create a monitor on `oneuptime.llm.budget.percent.used`, filter by `oneuptime.llm.budget.id`, and add two criteria — value `>= 80` creating a warning-severity alert, and value `>= 100` creating a critical one, attached to your on-call policy. **Set the monitor's rolling time to 30 minutes**: each budget publishes one point every 15 minutes, so the 1-minute default window would find an empty series between sweeps and flap the alert. Because it's an ordinary metric, everything monitors can do applies: formulas, anomaly detection against learned baselines, dashboards charting spend across budgets.

Budgets can be scoped to a telemetry service, an LLM provider (the `gen_ai` provider name), or an exact model — or left project-wide. Multiple budgets can coexist, for example a project-wide budget plus a stricter one for an expensive model.

Budget monitors can do more than notify: chain one to a Workflow that calls a webhook in your infrastructure to stop a runaway agent — see [Circuit-Breaking Runaway AI Agents](/docs/telemetry/ai-agent-circuit-breaker).

## Privacy & redaction

Prompt and completion content can contain sensitive data. OneUptime applies your existing telemetry **scrub rules** and **drop filters** to LLM spans just like any other trace, so you can redact or drop attributes before they are stored. Configure these under **Traces → Settings**.

# AI / LLM Observability with OneUptime

Observe your LLM and AI-agent applications in OneUptime: per-call traces, token usage, cost, latency, errors, and the actual prompts and completions — all over standard OpenTelemetry. There is no proprietary SDK. If your app emits spans using the OpenTelemetry **GenAI semantic conventions** (`gen_ai.*`), OneUptime turns them into a first-class AI observability experience.

## How it works

OneUptime ingests OpenTelemetry traces at the OTLP endpoint. When a span carries GenAI attributes, OneUptime automatically:

- Tags it as an **LLM call** and denormalizes the model, operation, provider, token counts and cost for fast querying.
- Surfaces it in the dedicated **AI / LLM** section (an LLM calls list plus a token / cost / latency overview).
- Renders a first-class **AI / LLM panel** on the span showing provider, model, tokens, cost, request parameters, and the prompt & completion content.

Because everything is OpenTelemetry, the same data also powers dashboards and metric alerts.

## Step 1 — Create a Telemetry Ingestion Token

In OneUptime, open **Project Settings → Telemetry Ingestion Keys** and click **Create Ingestion Key**. Copy the key — you will pass it to your app as an OTLP header. (See the [OpenTelemetry guide](/docs/telemetry/open-telemetry) for screenshots.)

## Step 2 — Instrument your app

Use any OpenTelemetry GenAI instrumentation. Popular choices:

- **OpenLLMetry** (Traceloop) — auto-instruments OpenAI, Anthropic, Cohere, Bedrock, LangChain, LlamaIndex, CrewAI and more.
- **OpenInference** (Arize) — instrumentors for OpenAI, LangChain, LlamaIndex, DSPy, etc.
- **Native OpenTelemetry** GenAI instrumentations.

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

| What | Primary attribute | Also accepted |
|------|-------------------|---------------|
| Provider / system | `gen_ai.system` | `gen_ai.provider.name`, `llm.system` |
| Operation | `gen_ai.operation.name` | `llm.request.type`, `openinference.span.kind` |
| Requested model | `gen_ai.request.model` | `llm.model_name` |
| Response model | `gen_ai.response.model` | — |
| Input tokens | `gen_ai.usage.input_tokens` | `gen_ai.usage.prompt_tokens`, `llm.token_count.prompt` |
| Output tokens | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.token_count.completion` |
| Total tokens | `gen_ai.usage.total_tokens` | derived from input + output |
| Cost (USD) | `gen_ai.usage.cost` | `llm.usage.total_cost` |
| Agent name | `gen_ai.agent.name` | — |
| Tool name | `gen_ai.tool.name` | — |

**Prompt & completion content** is read from the standard content events (`gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.assistant.message`, `gen_ai.choice`) or the indexed attributes (`gen_ai.prompt.N.content`, `gen_ai.completion.N.content`) and rendered in the AI / LLM panel.

> **Cost note:** OneUptime does not maintain a model price list. Cost is shown only when your instrumentation reports it (e.g. OpenLLMetry can emit `gen_ai.usage.cost`).

## View your LLM calls

Open **AI / LLM** in the navigation bar (under Observability):

- **Overview** — total calls, input/output tokens, cost, and error rate for the last 7 days, plus the most recent calls.
- **LLM Calls** — a filterable list of every LLM, embedding, agent and tool call. Filter by provider, model, operation or service. Click a call to open it in the trace viewer.
- Each span has an **AI / LLM** tab/panel with the model, token counts, cost, request parameters, and the rendered prompt & completion.

## Dashboards and alerts

Because GenAI metrics arrive as ordinary OpenTelemetry metrics, you can:

- Build **dashboards** charting `gen_ai.client.token.usage`, `gen_ai.client.operation.duration`, etc. (Dashboards → add a chart on the metric).
- Create **metric monitors** to alert on token spend, latency or error rate — for example alert when `gen_ai.client.operation.duration` p95 crosses a threshold, grouped by model. See [Monitors](/docs/monitor/monitor).

## Privacy & redaction

Prompt and completion content can contain sensitive data. OneUptime applies your existing telemetry **scrub rules** and **drop filters** to LLM spans just like any other trace, so you can redact or drop attributes before they are stored. Configure these under **Traces → Settings**.

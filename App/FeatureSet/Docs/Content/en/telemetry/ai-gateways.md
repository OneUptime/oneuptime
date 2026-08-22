# Observing AI Gateways (LiteLLM & Portkey)

An AI gateway is a natural observability choke point: every LLM call from every app flows through it. Point the gateway's OpenTelemetry export at OneUptime once, and you get [AI / LLM observability](/docs/telemetry/ai-llm-observability) — traces, token usage, cost, prompts and completions — for everything behind it, without instrumenting each application.

This guide covers the two most common gateways:

- **[LiteLLM Proxy](#litellm-proxy)** — built-in OTel export in the open-source proxy.
- **[Portkey](#portkey)** — built-in export on self-hosted/enterprise deployments; a client-side pattern for the open-source and hosted gateway.

## Before you start

1. Create a telemetry ingestion token in OneUptime: **Project Settings → Telemetry & APM → Ingestion Keys → Create Ingestion Key**.
2. Note your OTLP endpoint: `https://oneuptime.com/otlp` — or `https://YOUR-ONEUPTIME-HOST/otlp` if you self-host. Traces are accepted at `/otlp/v1/traces` over OTLP HTTP, in both protobuf and JSON encoding.
3. The token travels as the `x-oneuptime-token` header on every export request.

## LiteLLM Proxy

LiteLLM's OpenTelemetry callback ships in the open-source proxy. The official Docker image (`ghcr.io/berriai/litellm`) bundles the OpenTelemetry packages, so export is purely a matter of configuration. (Installing via pip instead? `pip install litellm[proxy]` does **not** include them — add `pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp`.)

### 1. Enable the OTel callback

In your LiteLLM `config.yaml`:

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

litellm_settings:
  callbacks: ["otel"]
```

### 2. Point the exporter at OneUptime

Set three environment variables on the proxy:

```bash
export OTEL_EXPORTER="otlp_http"
export OTEL_ENDPOINT="https://oneuptime.com/otlp/v1/traces"
export OTEL_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
```

Notes on the exact values:

- Use the **full `/v1/traces` path** in `OTEL_ENDPOINT`. LiteLLM v1.79+ normalizes a base URL like `https://oneuptime.com/otlp` to the right per-signal path automatically, but older versions pass the endpoint through verbatim — the full path works on every version.
- `OTEL_HEADERS` takes comma-separated `key=value` pairs, so multiple headers are `key1=val1,key2=val2`.
- The standard OpenTelemetry names (`OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`) also work and take precedence over LiteLLM's short names.
- `OTEL_SERVICE_NAME` sets the service the spans appear under in OneUptime (default: `litellm`).

### 3. Run it

Docker example, all together:

```bash
docker run \
  -v $(pwd)/config.yaml:/app/config.yaml \
  -e OPENAI_API_KEY="sk-..." \
  -e OTEL_EXPORTER="otlp_http" \
  -e OTEL_ENDPOINT="https://oneuptime.com/otlp/v1/traces" \
  -e OTEL_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN" \
  -e OTEL_SERVICE_NAME="litellm-gateway" \
  -p 4000:4000 \
  ghcr.io/berriai/litellm:main-stable \
  --config /app/config.yaml
```

Every request through the proxy now produces a span named `litellm_request` carrying `gen_ai.system` (provider), `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`, request parameters, and the prompt and completion content — all attributes OneUptime [recognizes natively](/docs/telemetry/ai-llm-observability).

**Cost:** LiteLLM prices each call itself and reports it on the span (`gen_ai.cost.total_cost`, or `litellm.cost.total` in v2 mode). OneUptime reads that as the span's reported cost, so LiteLLM's own pricing — including any custom per-model rates you configured on the proxy — wins over OneUptime's catalog estimate. When LiteLLM can't price a call (a custom model with no pricing configured), OneUptime falls back to [computing an estimate](/docs/telemetry/ai-llm-observability) from the token counts.

### Prompt content and privacy

The `otel` callback captures **full prompt and completion content by default**. Three ways to turn that off, if your gateway fronts sensitive traffic:

```yaml
# Option 1: global kill-switch for all logging callbacks
litellm_settings:
  callbacks: ["otel"]
  turn_off_message_logging: true
```

```yaml
# Option 2: just the otel callback (callback_settings is a TOP-LEVEL key)
litellm_settings:
  callbacks: ["otel"]

callback_settings:
  otel:
    message_logging: False
```

```bash
# Option 3: environment variable
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT="NO_CONTENT"
```

You can also keep content flowing and redact selectively with OneUptime's telemetry scrub rules under **Traces → Settings**.

### Optional: unified traces with OTel v2

Newer LiteLLM versions ship an opt-in "OpenTelemetry v2" mode (`LITELLM_OTEL_V2=true`, no `config.yaml` change needed) that emits one unified trace per request — HTTP handling, auth, guardrails, and the LLM call as canonical GenAI-semantic-convention spans named like `chat gpt-4o`. In v2 mode, prompt content is **off** by default and opted in via `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`. Pick one mode or the other, not both.

### Troubleshooting

- Set `OTEL_EXPORTER="console"` temporarily — if spans print to the proxy's stdout, LiteLLM is instrumenting fine and the problem is the endpoint or token.
- Set `DEBUG_OTEL="true"` for verbose exporter logging.
- Only traces are exported by default; LiteLLM's OTel metrics/events are separate opt-ins and aren't needed for OneUptime's AI / LLM features.

## Portkey

Portkey's story depends on how you run it — check your deployment against these three rows first:

| Deployment                                 | OTel trace export to OneUptime                                      |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Self-hosted / enterprise gateway           | **Built-in** (experimental) — configure with env vars below         |
| Open-source gateway (`portkey-ai/gateway`) | Not available — use client-side instrumentation                     |
| Hosted (portkey.ai)                        | Not available on the gateway side — use client-side instrumentation |

Don't confuse this with Portkey's own OpenTelemetry **ingestion** endpoint (`api.portkey.ai/v1/otel`) — that receives traces _into_ Portkey and is the opposite direction from what this guide sets up.

### Self-hosted / enterprise gateway: built-in export

Portkey's enterprise and self-hosted gateway can push every LLM request/response as an OTLP trace span, following GenAI semantic conventions (1.40.0). Set these environment variables on the gateway container:

```yaml
EXPERIMENTAL_GEN_AI_OTEL_TRACES_ENABLED: "true"
EXPERIMENTAL_GEN_AI_OTEL_EXPORTER_OTLP_ENDPOINT: "https://oneuptime.com/otlp"
EXPERIMENTAL_GEN_AI_OTEL_EXPORTER_OTLP_HEADERS: "x-oneuptime-token=YOUR_INGESTION_TOKEN"
```

Details worth knowing:

- Give the **base** OTLP URL — Portkey appends `/v1/traces` itself.
- Headers are comma-separated `key=value` pairs.
- The export is OTLP over **HTTP/JSON** (no gRPC). OneUptime's OTLP endpoint accepts JSON, so no collector is needed in between.
- Spans are named `{operation} {model}` (for example `chat gpt-4o`) and arrive under the service name `portkey`, carrying `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`, `gen_ai.conversation.id`, and structured `gen_ai.input.messages` / `gen_ai.output.messages`.
- Exports happen asynchronously after the response (no request latency), but there is **no batching and no retry** — a failed export is dropped, so treat this as observability, not an audit log.
- **Full prompt and completion content is included.** Apply OneUptime scrub rules (**Traces → Settings**) if you need redaction.
- If Portkey reuses your `x-portkey-trace-id` as the trace id (it does when the id is a valid 32-hex string), gateway spans correlate with your app's own traces.

Portkey marks the feature experimental; if the variables have no effect, check their current docs and your gateway image version — older Helm charts documented earlier variable names.

### Open-source and hosted gateway: instrument the client

The open-source `portkey-ai/gateway` has no OTel exporter, and on the hosted gateway you can't set server env vars. The supported pattern for both: **instrument the application that calls through Portkey**, and export those spans to OneUptime.

Portkey is OpenAI-API-compatible, so the same GenAI instrumentations from the [AI / LLM Observability guide](/docs/telemetry/ai-llm-observability) — OpenLLMetry, OpenInference, OpenLIT — wrap your OpenAI/Anthropic SDK calls normally even when the base URL points at Portkey:

```python
from traceloop.sdk import Traceloop
from openai import OpenAI

Traceloop.init(
    app_name="my-ai-agent",
    api_endpoint="https://oneuptime.com/otlp",
    headers={"x-oneuptime-token": "YOUR_INGESTION_TOKEN"},
)

client = OpenAI(
    base_url="https://api.portkey.ai/v1",   # or your gateway's URL
    default_headers={"x-portkey-api-key": "PORTKEY_API_KEY"},
)
# Calls through Portkey are now traced to OneUptime.
```

One honest caveat: client-side spans describe the call _as your app made it_ — requested model, latency as observed, tokens as returned. Gateway-internal decisions (fallback routing, retries, cache hits) stay visible only inside Portkey. If you need those in OneUptime, that's what the enterprise export above is for.

## Verify the spans landed

Send a test request through the gateway, wait a few seconds, then open **AI / LLM** in OneUptime's navigation (under Observability):

1. **LLM Calls** should list the call — provider, model, and token counts filled in. LiteLLM spans are named `litellm_request`; Portkey's enterprise export names them `chat <model>`.
2. Click the call to open the trace, and check the span's **AI / LLM panel**: model, input/output tokens, request parameters, and (unless you disabled content capture) the prompt and completion.
3. **Overview** should show the call in the totals; cost appears too — reported by the gateway where available, otherwise [computed at ingest](/docs/telemetry/ai-llm-observability) from token counts for known models.

Nothing showing up?

- Re-check the token — a wrong `x-oneuptime-token` is rejected at ingest.
- Re-check the endpoint spelling for your setup: LiteLLM wants the full `/otlp/v1/traces` path; Portkey wants the base `/otlp`.
- Use each gateway's debug switch (`OTEL_EXPORTER=console` for LiteLLM; gateway logs for Portkey) to confirm spans are being produced at all.
- Filter the **Traces** page by the gateway's service name (`litellm`, `portkey`, or your `OTEL_SERVICE_NAME`) to see raw spans even if they aren't classified as LLM calls.

## What this unlocks

Once gateway spans land as `gen_ai.*` traces, everything in OneUptime's AI observability works on them:

- **[Daily cost budgets](/docs/telemetry/ai-llm-observability)** across every app behind the gateway — published as metrics your monitors alert on.
- **[Traces monitors](/docs/monitor/traces-monitor)** on span patterns, like a runaway agent calling the same tool in a loop.
- **[Async circuit breaking](/docs/telemetry/ai-agent-circuit-breaker)** — chain those alerts to a Workflow that calls your infrastructure to stop a runaway agent, without putting anything new in the request path.

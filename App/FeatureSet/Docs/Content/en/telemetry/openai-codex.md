# Monitoring OpenAI Codex CLI with OneUptime

Codex emits OpenTelemetry natively. There is no wrapper, no proxy and no extra process — it has three independent signal exporters built in, and pointing them at OneUptime gives you [AI / LLM observability](/docs/telemetry/ai-llm-observability) for every Codex turn: spans with token counts, metrics for tokens and cost, and a log stream that carries the identity of the developer who ran it.

Two things to know before you start:

- Telemetry is **opt-in and off by default** for traces and logs. It is configured in `~/.codex/config.toml` under `[otel]` — not with environment variables.
- **`metrics_exporter` defaults to `"statsig"`.** See the warning below; read it before you decide this page does not apply to you.

## Warning: Codex ships metrics to OpenAI unless you change this

In a release build of Codex, `metrics_exporter` defaults to `"statsig"`. With **no `[otel]` block at all**, Codex exports its metrics to OpenAI at `https://ab.chatgpt.com/otlp/v1/metrics` with a hardcoded `statsig-api-key` header.

Setting `metrics_exporter` to `otlp-http` (as below) or to `none` stops it — as does turning analytics off entirely with an `[analytics]` block and `enabled = false`, which forces the metrics exporter to `none` no matter what `metrics_exporter` says. Traces and logs are not affected — their exporters default to `none`, so nothing leaves the machine until you configure them.

## Before you start

1. Create a telemetry ingestion token in OneUptime: **Project Settings → Telemetry & APM → Ingestion Keys → Create Ingestion Key**.
2. Your OTLP endpoint is `https://oneuptime.com/otlp` — or `https://YOUR-ONEUPTIME-HOST/otlp` if you self-host.
3. The token travels as the `x-oneuptime-token` header on every export request.

## Configure Codex

Put this in `~/.codex/config.toml`. It enables all three signals and, on the way, replaces the Statsig metrics default.

```toml
[otel]
environment = "prod"
log_user_prompt = false

[otel.exporter.otlp-http]
endpoint = "https://oneuptime.com/otlp/v1/logs"
protocol = "binary"
headers = { "x-oneuptime-token" = "YOUR_INGESTION_TOKEN" }

[otel.trace_exporter.otlp-http]
endpoint = "https://oneuptime.com/otlp/v1/traces"
protocol = "binary"
headers = { "x-oneuptime-token" = "YOUR_INGESTION_TOKEN" }

[otel.metrics_exporter.otlp-http]
endpoint = "https://oneuptime.com/otlp/v1/metrics"
protocol = "binary"
headers = { "x-oneuptime-token" = "YOUR_INGESTION_TOKEN" }

[otel.span_attributes]
"user.id" = "dev@example.com"
"user.email" = "dev@example.com"
"team" = "platform"
```

### The endpoints are full, signal-specific URLs

This is the detail that breaks most first attempts. Codex passes the `endpoint` value to the OTLP exporter **verbatim** — it does not append a per-signal path the way most SDKs do. Each of the three exporters needs its own complete URL, with `/v1/logs`, `/v1/traces` or `/v1/metrics` written out by you.

Giving all three the base `https://oneuptime.com/otlp` will not work. Nothing will arrive, and the failure is silent.

### `[otel]` keys

| Key                | Type                            | Default                | What it does                                                                            |
| ------------------ | ------------------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `environment`      | string                          | `"dev"`                | Becomes the resource attribute `env`                                                    |
| `log_user_prompt`  | bool                            | `false`                | When `false`, `codex.user_prompt` carries `prompt="[REDACTED]"`                         |
| `exporter`         | exporter                        | `none`                 | The **logs** exporter                                                                   |
| `trace_exporter`   | exporter                        | `none`                 | The **traces** exporter                                                                 |
| `metrics_exporter` | exporter                        | `"statsig"`            | The **metrics** exporter — override it                                                  |
| `span_attributes`  | map<string,string>              | —                      | Added to every exported span                                                            |
| `tracestate`       | map<string, map<string,string>> | —                      | W3C `tracestate` members                                                                |
| `tool_result`      | table `{ max_bytes = int }`     | `{ max_bytes = 2048 }` | Caps the tool-result payload on log records, in UTF-8 bytes, before a truncation notice |

Exporter variants are `none`, `statsig`, `otlp-http` and `otlp-grpc`. `otlp-http` takes `endpoint`, `headers`, `protocol` (`"binary"` or `"json"`) and `tls { ca-certificate, client-certificate, client-private-key }`. `otlp-grpc` takes `endpoint`, `headers` and `tls`. OneUptime accepts both protobuf (`"binary"`) and JSON over OTLP/HTTP.

`tool_result` is written as a sub-table — `[otel.tool_result]` with `max_bytes = 8192` — not as a bare integer.

**Unknown keys under `[otel]` are silently ignored.** Only the generated `config.schema.json` marks this table as closed (`#[schemars(deny_unknown_fields)]`); serde itself drops keys it does not recognize, so a misspelling produces no error, no warning and no telemetry. Double-check spelling, because there is nothing to catch you.

Two naming conventions are in play, which makes that easy to get wrong: the `[otel]` keys themselves are **snake_case** (`log_user_prompt`, `trace_exporter`, `metrics_exporter`, `span_attributes`, `tool_result`), while the exporter variant names and the TLS fields are **kebab-case** (`otlp-http`, `otlp-grpc`, `ca-certificate`, `client-certificate`, `client-private-key`). Writing `trace-exporter` disables traces with no error at all.

## Attributing Codex usage to a person

Codex's identity handling has a structural quirk you have to design around:

- **Log records carry identity.** Every Codex log event gets `user.account_id` and `user.email` attached.
- **Spans deliberately do not.** The trace path omits both, by design — the code calls it "trace-safe".
- **Metrics do not either.** Every Codex metric carries the session tags `auth_mode`, `session_source`, `originator`, `service_name`, `model` and `app.version`, plus per-metric tags — `codex.turn.cost_microusd` also carries `turn.id`, `conversation.id`, `turn.interrupted` and, when known, `speed` and `reasoning_effort`; `codex.turn.token_usage` also carries `token_type` and `tmp_mem_enabled`. None of them is a user identity.

So on the Codex side, the log stream is the only signal that knows who ran the turn. That is why the config above enables the logs exporter.

**On the OneUptime side, employee attribution is read off spans and metric datapoints — never off log records.** On spans OneUptime denormalizes the human actor into queryable columns from `user.id` (the OpenTelemetry canonical key), `enduser.id`, LiteLLM's key-owner ids (`litellm.metadata.user_api_key_user_id`, `metadata.user_api_key_user_id`), `traceloop.association.properties.user_id`, `langfuse.user.id`, `user.account_uuid`, `user.account_id` and `cursor.user.id`, plus the email from `user.email`; each is also matched in its `resource.`-prefixed form, for tools that stamp identity once on the process. None of those appear on a Codex span unless you put them there, and Codex has no resource-attribute mechanism to put them there for you — hence the span-attributes block. Codex's metric tag set carries no identity either, so the log stream really is the only place Codex itself names the developer, and that is the signal OneUptime does not yet read.

The practical recommendation is therefore the `[otel.span_attributes]` block above: stamp a per-developer identity onto every Codex span yourself.

```toml
[otel.span_attributes]
"user.id" = "dev@example.com"
"user.email" = "dev@example.com"
"team" = "platform"
"cost_center" = "eng-123"
```

`user.id` is the key OneUptime prefers; `user.email` fills the email column. Team and cost-centre rollups come from `team.id`, `team`, `cost_center` and `department` — on other tools those are usually set through `OTEL_RESOURCE_ATTRIBUTES`, but `span_attributes` is Codex's documented mechanism, so set them there.

Because this block lives in each developer's own `~/.codex/config.toml`, it needs to be provisioned — by your dotfiles repo, an MDM profile, or whatever already manages developer machine config. A shared config file with one hardcoded identity attributes everyone's spend to one person.

### What works today, and what does not

|                                                          | Status                                                                                                                                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-employee spend from `[otel.span_attributes]`         | **Works today.** The identity lands on the span, OneUptime denormalizes it, and the **Usage** tab ranks it.                                                                                                      |
| Tokens and cost from Codex metrics                       | **Recognized today** — `codex.turn.token_usage` and `codex.turn.cost_microusd` — but read only when the span stream is empty. See [Spans win over metrics](#spans-win-over-metrics-they-are-not-added-together). |
| Per-employee spend from Codex's own `user.email` on logs | **Not yet.** Codex's logs land in OneUptime's log explorer, but OneUptime does not yet read employee identity off log records and join it to spend. That is the log-ingest follow-up.                            |

Enable the logs exporter regardless. The `codex.turn_cost` record is the most accurate per-turn cost Codex produces and it is log-only; once log-side attribution ships, the history is already there.

## Cost and tokens

**From metrics** (recognized by OneUptime today):

| Metric                     | Notes                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `codex.turn.cost_microusd` | Counter, in **millionths of a USD**. OneUptime divides by 1,000,000 on read — do not scale it yourself.                        |
| `codex.turn.token_usage`   | Histogram, tagged `token_type` with values `total`, `input`, `cached_input`, `cache_write_input`, `output`, `reasoning_output` |

Codex tags this metric `token_type`, not the OTel-standard `gen_ai.token.type`. OneUptime accepts both spellings.

**From logs:** the `codex.turn_cost` event carries `turn.id`, `usage.estimated_usd`, `turn.interrupted`, `speed` and `reasoning_effort` — and, being a log record, `user.email` too. This is the per-turn spend record with the person attached.

**From spans:** Codex spans carry the standard GenAI usage attributes, so everything on the [AI / LLM Observability](/docs/telemetry/ai-llm-observability) page applies to them unchanged: `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_write.input_tokens`, plus the Codex-specific `codex.usage.reasoning_output_tokens` and `codex.usage.total_tokens`.

Once the spans land, the **AI / LLM** section's **Usage** tab ranks employees, teams, models, providers and services by spend, and [daily cost budgets](/docs/telemetry/ai-llm-observability) work on Codex spend like any other LLM spend.

### Spans win over metrics; they are not added together

Codex is the one tool on this page that can emit all three signals at once, so this rule decides which of them you are actually reading.

**GenAI spans are authoritative. The metric stream is consulted only for a figure the spans reported nothing for, and the two are never summed.** If they were, a tool emitting both signals for the same turn would have every token and every dollar counted twice.

So with the config at the top of this page — traces _and_ metrics both exporting — Codex's tokens come off its spans, and `codex.turn.token_usage` is not added on top. `codex.turn.cost_microusd` fills in only where the span-sourced cost is zero, which for Codex is the realistic case: the spans carry token counts but no cost attribute, so cost is computed at ingest from the built-in price catalog, and a model the catalog does not know stays at `0` and lets the micro-USD counter answer instead.

The micro-USD unit is handled for you. `codex.turn.cost_microusd` is queried separately from the dollar-denominated cost metrics and scaled by 1/1,000,000 before the two are added — a $3 turn folded into a dollar sum would read as $3,000,000 and breach every budget in the project. Do not pre-scale it yourself.

Three smaller consequences of the same rule, for the case where the spans are absent and the metric fallback does engage:

- **Codex's metrics name nobody.** The session tags are `auth_mode`, `session_source`, `originator`, `service_name`, `model` and `app.version`, and the per-metric tags are turn, conversation and token-type keys — no user attribute of any kind, and no resource-attribute mechanism to add one. So metric-sourced Codex spend lands in the Usage tab's single **Unattributed** row. Per-employee Codex attribution comes from `[otel.span_attributes]` and the span path, which is exactly why that block is the recommendation on this page.
- The **Model** breakdown does work off the metrics — Codex tags its counters with a bare `model`, which OneUptime reads. **Provider** and **Application / Service** do not: those counters carry no `gen_ai.system` and are not attached to a OneUptime telemetry service.
- Metric-sourced rows carry **cost only** — the Calls and token columns render as `—`. Rows sourced from spans do not have this limitation.

## Coverage is uniform across entry points

All three entry points build the same OpenTelemetry provider from your `[otel]` block and install all three exporters:

| Entry point           | Traces | Logs | Metrics |
| --------------------- | ------ | ---- | ------- |
| `codex` (interactive) | Yes    | Yes  | Yes     |
| `codex exec`          | Yes    | Yes  | Yes     |
| `codex mcp-server`    | Yes    | Yes  | Yes     |

`codex exec` records its process start under the originator tag `codex_exec`, and `codex mcp-server` exports under the service name `codex_mcp_server` — so you can tell CI runs and MCP-server runs apart from interactive sessions by filtering on those, not by which signals are missing. A cost dashboard built on `codex.turn.cost_microusd` sees CI spend from `codex exec` like any other spend.

## Privacy

`log_user_prompt` defaults to `false`. **Leave it that way.** When it is `false`, the `codex.user_prompt` event carries `prompt="[REDACTED]"` instead of the developer's actual prompt text — you still get the event, the turn, the tokens and the cost, without shipping prompt bodies off the machine.

If you do turn it on for a debugging session, OneUptime's telemetry **scrub rules** and **drop filters** apply to Codex data like any other telemetry (**Traces → Settings**).

Separately, note that identity (`user.email`, `user.account_id`) is on log records whether or not you set `log_user_prompt` — that switch controls prompt content only.

## Verify it landed

Run an interactive `codex` session, ask it something small, and let the turn finish. Then in OneUptime:

1. **AI / LLM → LLM Calls** should list the turn's model calls with token counts filled in.
2. Open one and check the span's **AI / LLM** panel, plus the attributes you set in `[otel.span_attributes]`.
3. **AI / LLM → Usage** should show your identity with tokens and spend against it.
4. **Logs** should contain the Codex events — `codex.conversation_starts`, `codex.api_request`, `codex.turn_cost` and the rest.

Nothing showing up?

- Check the endpoints first. All three must be full URLs ending in `/v1/logs`, `/v1/traces` and `/v1/metrics`. This is the most common mistake.
- Check the token — a wrong `x-oneuptime-token` is rejected at ingest.
- Check your key spelling. Unknown keys under `[otel]` are **silently ignored** — a typo'd `trace-exporter` (instead of `trace_exporter`) produces no error and no traces. See [`[otel]` keys](#otel-keys).

## Using the OpenAI platform API instead of Codex

If you call OpenAI through the SDK rather than through Codex, none of the above applies — **OpenAI's platform API emits no OpenTelemetry**. OpenAI's API reference defines no `traceparent` request header and no trace or span id on any response, and nothing is pushed to your collector. The correlation headers it does document are proprietary (`x-request-id`, `openai-processing-ms`, `x-ratelimit-*`). Every span you get comes from instrumenting your own client.

Three instrumentation families work with OneUptime:

- **Official OpenTelemetry** — `opentelemetry-instrumentation-genai-openai` (Python). It supersedes `opentelemetry-instrumentation-openai-v2`. Instrument with `from opentelemetry.instrumentation.genai.openai import OpenAIInstrumentor; OpenAIInstrumentor().instrument()`. Message capture is controlled by `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` (`span_only`, `event_only`, `span_and_event`, `no_content`). Covers `chat`, the Responses API, `embeddings` and `fetch_response`, and emits `gen_ai.client.token.usage` and `gen_ai.client.operation.duration`.
- **OpenLLMetry** (Traceloop) — `opentelemetry-instrumentation-openai`. Emits `gen_ai.*` plus indexed message attributes in the `gen_ai.prompt.{i}.content` / `gen_ai.completion.{i}.content` shape, all of which OneUptime reads. Check Traceloop's own docs for the exact attribute names your version emits.
- **OpenInference** (Arize) — `openinference-instrumentation-openai`. Uses its own `llm.*` namespace, and OneUptime reads `user.id` from it as an employee key. The GenAI semantic conventions define no user identity at all, so with the official instrumentation you must stamp `user.id` yourself; check OpenInference's semantic-conventions spec for how your version populates it.

Point any of them at `https://oneuptime.com/otlp` with the `x-oneuptime-token` header — see [AI / LLM Observability](/docs/telemetry/ai-llm-observability) for the exporter setup.

Using the **OpenAI Agents SDK**? Its built-in tracing is proprietary and posts to `https://api.openai.com/v1/traces/ingest`, not OTLP. Bridge it by registering a `TracingProcessor` that converts SDK spans to OpenTelemetry spans and hands them to a normal `OTLPSpanExporter`; `opentelemetry-instrumentation-openai-agents-v2` and `openinference-instrumentation-openai-agents` both do this.

**Admin usage and cost API:** OpenAI exposes org-wide usage and cost at `https://api.openai.com/v1/organization/usage/*` and `/v1/organization/costs`, authenticated with an admin key. A OneUptime connector that polls these is planned, but **it is not implemented today** — there is nothing to enable in the product yet. Note also that when it does ship it will not close every gap: `/v1/organization/costs` cannot be grouped by user at all, and `user_id` is only populated on the usage endpoints when you pass `group_by=user_id` — OpenAI's schema allows it to be null, and does not say which calls it is null for. Client-side instrumentation remains the way to attribute OpenAI SDK spend to a person.

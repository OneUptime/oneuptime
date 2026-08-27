# Monitoring Gemini CLI and GitHub Copilot with OneUptime

Both tools emit OpenTelemetry natively, so neither needs a proxy or a wrapper — point their exporters at OneUptime's OTLP endpoint and their token usage, cost, latency and tool calls land in the [AI / LLM](/docs/telemetry/ai-llm-observability) section alongside your application's own LLM spans.

They differ on the thing that decides whether the data is useful for chargeback:

- **[Gemini CLI](#gemini-cli)** puts `user.email` on every record it emits, so per-employee attribution needs no stitching and no configuration. Turn its `traces` setting on as well: it is off by default, and with it off the spans Gemini CLI exports carry no model name and no token counts, so there is nothing for OneUptime to price — and Gemini CLI publishes no cost metric either.
- **[GitHub Copilot](#github-copilot)** emits **no user attribute at all**. You have to inject one yourself, per machine, or Copilot's spend is unattributable.

## Before you start

1. Create a telemetry ingestion token: **Project Settings → Telemetry & APM → Ingestion Keys → Create Ingestion Key**.
2. Your OTLP endpoint is `https://oneuptime.com/otlp` — or `https://YOUR-ONEUPTIME-HOST/otlp` if you self-host.
3. The token travels as the `x-oneuptime-token` header on every export request.

OneUptime's endpoint speaks **OTLP over HTTP** (protobuf and JSON). Neither tool below needs gRPC to reach it, but Gemini CLI defaults to gRPC, so the protocol setting matters — see the section below.

## Gemini CLI

Gemini CLI is the most complete OpenTelemetry emitter of any coding CLI, and the one to start with if you are evaluating per-employee AI spend. It ships traces, metrics and structured log events, and — uniquely among the coding CLIs — every record carries **`user.email`** when the user is authenticated. OneUptime reads `user.email` directly as the employee identity, so attribution works with zero identity mapping, no join table, and no per-machine configuration. Turn `traces` on (it is off by default). Spans are exported whenever telemetry is enabled, but with `traces` off they carry only `gen_ai.operation.name`, `gen_ai.agent.name`, `gen_ai.agent.description` and `gen_ai.conversation.id` — no model, no token counts, nothing priceable. Gemini CLI emits no cost metric either, so `traces: true` is what lets OneUptime price the calls at ingest.

### Turn telemetry on

Telemetry is configured under a `telemetry` object in `.gemini/settings.json` (project-level in the repo, or your user-level Gemini settings for a whole machine):

```json
{
  "telemetry": {
    "enabled": true,
    "target": "local",
    "otlpEndpoint": "http://localhost:4317",
    "otlpProtocol": "grpc",
    "traces": true,
    "logPrompts": false
  }
}
```

That points Gemini CLI at a local OpenTelemetry Collector, which is the path we recommend — see [Getting the token in](#getting-the-token-in) for why.

Every key in the block, with its environment-variable override:

| Key            | Env override                      | Default                 | What it does                                                                                                                                                                                                                                                                                                           |
| -------------- | --------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`      | `GEMINI_TELEMETRY_ENABLED`        | `false`                 | Master switch. Nothing is emitted until this is true.                                                                                                                                                                                                                                                                  |
| `target`       | `GEMINI_TELEMETRY_TARGET`         | `"local"`               | `"local"` or `"gcp"`. Use `"local"` for OneUptime — it means "my own OTLP endpoint", not "write to disk".                                                                                                                                                                                                              |
| `otlpEndpoint` | `GEMINI_TELEMETRY_OTLP_ENDPOINT`  | `http://localhost:4317` | Where telemetry is exported.                                                                                                                                                                                                                                                                                           |
| `otlpProtocol` | `GEMINI_TELEMETRY_OTLP_PROTOCOL`  | `grpc`                  | `"grpc"` or `"http"`. **Exporting straight to OneUptime requires `"http"`** — the default gRPC will not connect.                                                                                                                                                                                                       |
| `traces`       | `GEMINI_TELEMETRY_TRACES_ENABLED` | `false`                 | Detailed span attributes, off by default. Spans are exported whenever telemetry is enabled; with this off they carry only `gen_ai.operation.name`, `gen_ai.agent.name`, `gen_ai.agent.description` and `gen_ai.conversation.id`. Turn it on to get the model name, token counts and prompt/tool payloads on the spans. |
| `logPrompts`   | `GEMINI_TELEMETRY_LOG_PROMPTS`    | **`true`**              | Whether prompt text is included in log events. See the warning below.                                                                                                                                                                                                                                                  |
| `outfile`      | `GEMINI_TELEMETRY_OUTFILE`        | —                       | Write telemetry to a file instead. Useful for inspecting exactly what would be shipped before you ship it.                                                                                                                                                                                                             |
| `useCollector` | `GEMINI_TELEMETRY_USE_COLLECTOR`  | `false`                 | Use an external OTLP collector (advanced). Not needed with `target: "local"` — it only switches the `gcp` target away from direct GCP export.                                                                                                                                                                          |
| `useCliAuth`   | `GEMINI_TELEMETRY_USE_CLI_AUTH`   | `false`                 | Use the CLI's own credentials for telemetry. GCP target only — irrelevant to an OTLP export to OneUptime.                                                                                                                                                                                                              |

`OTLP_GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_PROJECT` apply only when `target` is `"gcp"`. `GEMINI_CLI_SURFACE` tags which surface the CLI is running as.

**Precedence: CLI flags > environment variables > `settings.json`.** If you push configuration through MDM rather than dotfiles, set the `GEMINI_TELEMETRY_*` variables and they will override whatever a repo's checked-in `.gemini/settings.json` says — which is what you want for a fleet policy.

### `logPrompts` defaults to TRUE — prompt text ships unless you turn it off

This is the single most important line on this page. Unlike almost every other tool in this space, **Gemini CLI captures prompt content by default**. Turn telemetry on without touching `logPrompts` and the text your engineers type — which routinely includes source code, customer data and credentials pasted into a terminal — is exported to your observability backend and stored there.

Set it explicitly, in the same change that enables telemetry:

```json
{
  "telemetry": {
    "enabled": true,
    "logPrompts": false
  }
}
```

Or, for a fleet:

```bash
export GEMINI_TELEMETRY_LOG_PROMPTS=false
```

If you deliberately want prompt content — for debugging agent behaviour, say — that is a decision to make on purpose, not to inherit from a default. OneUptime's telemetry **scrub rules** and **drop filters** (**Traces → Settings**) apply to this data like any other, so you can redact selectively rather than choosing all-or-nothing. But redaction at ingest is a second line of defence, not a substitute for `logPrompts: false`.

### Getting the token in

Gemini CLI's documented `telemetry` settings include an endpoint and a protocol, but **no key for custom export headers** — and OneUptime authenticates with the `x-oneuptime-token` header. So run a collector in between and let it attach the header:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_INGESTION_TOKEN"

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp]
    metrics:
      receivers: [otlp]
      exporters: [otlphttp]
    logs:
      receivers: [otlp]
      exporters: [otlphttp]
```

With that running, the `settings.json` block at the top of this section works unchanged — Gemini CLI's default `http://localhost:4317` and `grpc` line up with the collector's gRPC receiver. See the [OpenTelemetry guide](/docs/telemetry/open-telemetry) for running the collector as a sidecar, a DaemonSet, or a per-developer local process.

If you want to skip the collector, set `otlpEndpoint` to `https://oneuptime.com/otlp` and `otlpProtocol` to `"http"`, and try passing the token through the standard OpenTelemetry variable:

```bash
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
```

**Unverified:** `OTEL_EXPORTER_OTLP_HEADERS` is not part of Gemini CLI's documented telemetry settings, and whether a given version honours it is not something we have confirmed. Test it on one machine and check that data arrives before rolling it out to a fleet — a silently dropped export looks exactly like an idle developer.

### What Gemini CLI emits

**Metrics.** Gemini CLI is unusual in emitting both a vendor token metric and the semantic-convention one for the same tokens. OneUptime rolls up the **semantic-convention** series, `gen_ai.client.token.usage`, and deliberately ignores `gemini_cli.token.usage` — recognizing both would sum the same tokens twice and report double the real figure, silently. Input and output tokens are fully covered: `gen_ai.client.token.usage` carries exactly those two types. But Gemini CLI's `thought`, `cache` and `tool` token types are recorded only under `gemini_cli.token.usage`, so chart that series directly if you need them — they are not part of OneUptime's token roll-up.

| Metric                                                                                | What it carries                                                                                                |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `gen_ai.client.token.usage`                                                           | The GenAI-convention token histogram — **the series OneUptime's token and cost views read**                    |
| `gemini_cli.token.usage`                                                              | The same tokens under Gemini CLI's own name. Chartable on a dashboard; not rolled up, to avoid double-counting |
| `gen_ai.client.operation.duration`                                                    | The GenAI-convention latency histogram                                                                         |
| `gemini_cli.api.request.count` / `gemini_cli.api.request.latency`                     | Model API calls and their latency                                                                              |
| `gemini_cli.tool.call.count` / `gemini_cli.tool.call.latency`                         | Tool invocations                                                                                               |
| `gemini_cli.session.count`                                                            | Sessions started                                                                                               |
| `gemini_cli.file.operation.count` / `gemini_cli.lines.changed`                        | What the agent actually did to the codebase                                                                    |
| `gemini_cli.agent.run.count` / `gemini_cli.agent.duration` / `gemini_cli.agent.turns` | Sub-agent activity                                                                                             |

There are more — `gemini_cli.chat_compression`, `gemini_cli.model_routing.latency`, `gemini_cli.model_routing.failure.count`, `gemini_cli.slash_command.model.call_count`, `gemini_cli.plan.execution.count`, `gemini_cli.startup.duration`, `gemini_cli.memory.usage`, `gemini_cli.cpu.usage`, `gemini_cli.tool.queue.depth`, `gemini_cli.tool.execution.breakdown`, `gemini_cli.ui.flicker.count`, `gemini_cli.onboarding.start`, `gemini_cli.onboarding.success` — all queryable as ordinary OpenTelemetry metrics on dashboards and [metric monitors](/docs/monitor/metrics-monitor).

**Log events.** The ones worth building on:

| Event                                                                         | Meaning                                                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `gemini_cli.user_prompt`                                                      | A prompt was submitted (carries the text unless `logPrompts` is false) |
| `gemini_cli.api_request` / `gemini_cli.api_response` / `gemini_cli.api_error` | The model call, its result, and failures                               |
| `gen_ai.client.inference.operation.details`                                   | The GenAI-convention inference record                                  |
| `gemini_cli.tool_call`                                                        | A tool was invoked                                                     |
| `gemini_cli.file_operation`                                                   | A file was read or written                                             |
| `gemini_cli.conversation_finished`                                            | End of a conversation                                                  |
| `gemini_cli.model_routing` / `gemini_cli.flash_fallback`                      | Which model was chosen, and when it fell back                          |
| `gemini_cli.chat_compression`                                                 | Context was compacted                                                  |
| `gemini_cli.slash_command`                                                    | A slash command was run                                                |
| `gemini_cli.config`                                                           | Configuration at startup                                               |

Others include `gemini_cli.tool_output_truncated`, `gemini_cli.tool_output_masking`, `gemini_cli.edit_strategy`, `gemini_cli.edit_correction`, `gemini_cli.malformed_json_response`, `gemini_cli.chat.invalid_chunk`, `gemini_cli.chat.content_retry`, `gemini_cli.chat.content_retry_failure`, `gemini_cli.agent.start`, `gemini_cli.agent.finish`, `gemini_cli.agent.recovery_attempt`, `gemini_cli.ide_connection`, `gemini_cli.rewind`, `gemini_cli.hook_call`, `gemini_cli.ripgrep_fallback`, `gemini_cli.web_fetch_fallback_attempt`, `gemini_cli.keychain.availability`, `gemini_cli.startup_stats`, `gemini_cli.extension_install`, `gemini_cli.extension_uninstall`, `gemini_cli.extension_enable`, `gemini_cli.extension_disable`.

**Attributes on everything:** `session.id`, `installation.id`, `active_approval_mode`, and `user.email` when authenticated. OneUptime also treats `session.id` as a conversation id, so a whole Gemini CLI session groups together in the LLM calls list even when it spans several traces.

### Employees and teams

`user.email` is read as the employee identity on both the span stream and the metric stream, so nothing else is required for per-person spend. To get team and cost-centre rollups, add resource attributes — this is the one piece Gemini CLI cannot know:

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-tools,department=Engineering"
```

`OTEL_RESOURCE_ATTRIBUTES` sets _resource_ attributes, which reach OneUptime prefixed — `resource.team.id`, `resource.cost_center` and so on. OneUptime recognizes `team.id`, `team`, `cost_center` and `department` in both the bare and the `resource.`-prefixed spelling, on spans and on metric datapoints alike, so the Team / cost centre breakdown in the **Usage** tab works whichever way your exporter carries them.

Two things decide what the Usage tab can actually show for Gemini CLI:

- **With `traces` off (the default), Gemini CLI still exports spans, but they carry no model or token attributes** — so OneUptime cannot price them, and in practice the project sees Gemini CLI as a metrics-only source for spend. GenAI spans are authoritative and metrics are a fallback consulted only when the span stream reported nothing — the two are never summed. So if this project already has GenAI spans reporting the same figure, Gemini CLI's metric contribution will not appear; give the fleet its own project if you need them to stand alone. Turning `traces` on removes the problem entirely, because then Gemini CLI's spans carry the model and token counts that make them priceable GenAI spans.
- **On the metrics-only path, the Employee, Team and Model breakdowns work; Provider and Application / Service do not**, and a metric-sourced row carries cost only — its Calls and token columns render as `—`. Full detail in [AI / LLM Observability](/docs/telemetry/ai-llm-observability). Note that Gemini CLI emits no cost metric at all, so on the metrics-only path the Usage table has no spend to rank; its tokens still reach the Overview page's token tiles. Running `traces` is what gets you costed Gemini CLI calls, priced at ingest from the model and token counts.

## GitHub Copilot

### What emits telemetry, and what does not

GitHub documents Copilot's OpenTelemetry support **for the agent surfaces only** — the concept page is titled "OpenTelemetry for agent monitoring" and the VS Code guide covers agent interactions. It never states outright that the other surfaces emit nothing; what follows is our reading of which surfaces are covered:

| Surface                                    | Emits OTel                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| VS Code Copilot Chat / agent mode          | Yes                                                                                   |
| The agent host process behind Copilot CLI  | Yes                                                                                   |
| Copilot SDK                                | Yes                                                                                   |
| JetBrains Copilot plugin (agent workflows) | Yes — configured under **Settings → Tools → GitHub Copilot → Chat**                   |
| Copilot cloud (coding) agent               | Not supported — GitHub's managed-settings matrix marks `telemetry` unsupported for it |
| Inline code completions                    | Not documented as emitting                                                            |
| Copilot on github.com                      | Not documented as emitting                                                            |
| Copilot code review                        | Not documented as emitting                                                            |

Set expectations inside your org accordingly. A team that lives in inline completions will look idle in OneUptime no matter how the export is configured, because GitHub documents no OTel for that surface. Copilot's coverage of those surfaces lives in the REST APIs instead — see [Seats and billing are API-only](#seats-and-billing-are-api-only).

The JetBrains plugin's OTel settings exist, but GitHub's changelog does not publish the setting key names, so **we cannot confirm they match the VS Code keys**. Configure it from the plugin UI and verify data arrives rather than assuming the keys below transfer. The managed-settings route is confirmed to work there — GitHub's support matrix marks `telemetry` as supported for JetBrains IDEs — even though the local key names are not published.

### VS Code settings

User-level `settings.json` keys for the Copilot Chat extension:

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.otlpEndpoint": "https://oneuptime.com/otlp",
  "github.copilot.chat.otel.captureContent": false,
  "github.copilot.chat.otel.maxAttributeSizeChars": 8192
}
```

`exporterType` accepts `"otlp-http"`, `"otlp-grpc"`, `"console"` or `"file"`, and defaults to `"otlp-http"` — which is what you want, since OneUptime's endpoint is HTTP. There is also `github.copilot.chat.otel.dbSpanExporter.enabled` for local span storage.

The agent host behind Copilot CLI has its own equivalents: `chat.agentHost.otel.enabled`, `chat.agentHost.otel.otlpEndpoint`, `chat.agentHost.otel.exporterType`, `chat.agentHost.otel.captureContent`, `chat.agentHost.otel.serviceName`, `chat.agentHost.otel.resourceAttributes` and `chat.agentHost.otel.headers`.

Note what is missing from the user-level Chat keys: **there is no headers key**, so those settings alone cannot carry `x-oneuptime-token`. Four ways out, simplest first:

```bash
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
```

...or use enterprise managed settings below, use the agent-host `headers` key, or point `otlpEndpoint` at a local OpenTelemetry Collector that attaches the header (the same collector config as in the [Gemini CLI section](#getting-the-token-in) works).

Environment variables Copilot reads include `COPILOT_OTEL_ENABLED`, `COPILOT_OTEL_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL` / `COPILOT_OTEL_PROTOCOL`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_EXPORTER_OTLP_HEADERS`, `COPILOT_OTEL_MAX_ATTRIBUTE_SIZE_CHARS`, `COPILOT_OTEL_LOG_LEVEL`, `COPILOT_OTEL_FILE_EXPORTER_PATH` and `COPILOT_OTEL_HTTP_INSTRUMENTATION` — plus, for content capture, `COPILOT_OTEL_CAPTURE_CONTENT` in VS Code or `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` in the Copilot CLI.

### Enterprise managed settings

For a fleet, push a `telemetry` block through Copilot's enterprise managed settings. This is the only place you can both authenticate the export and lock content capture off:

```json
{
  "telemetry": {
    "enabled": true,
    "endpoint": "https://oneuptime.com/otlp",
    "protocol": "http/protobuf",
    "serviceName": "github-copilot",
    "captureContent": false,
    "lockCaptureContent": true,
    "headers": {
      "x-oneuptime-token": "YOUR_INGESTION_TOKEN"
    },
    "resourceAttributes": {
      "enduser.id": "alice@example.com",
      "user.email": "alice@example.com",
      "team.id": "platform",
      "cost_center": "eng-tools"
    }
  }
}
```

`headers` and `resourceAttributes` are JSON objects. `protocol` here is the OTLP **wire encoding**, not an exporter name: GitHub's managed-settings reference accepts `"http/json"` and `"http/protobuf"`, and its own example uses `"http/protobuf"`. (VS Code's enterprise docs describe the same managed key as mapping onto the `chat.agentHost.otel.exporterType` setting, whose vocabulary is `otlp-http` / `otlp-grpc` — but GitHub's managed-settings reference is the authority for what the managed block accepts, so write `http/protobuf`.) `captureContent` with `lockCaptureContent: true` turns prompt and completion capture off and prevents an individual developer from turning it back on locally.

One behaviour to plan around: managed `telemetry.headers` apply to the Copilot Chat extension's OTLP exporter only, and are never passed through environment variables — deliberately, so that a header value such as an auth token cannot leak into the tool subprocesses the agent host spawns. So a mixed setup — env vars for the endpoint, managed settings for the token — will not work the way you expect. Configure the export in one place.

**And the consequence you have to handle:** in this release, managed headers are **not delivered to the agent host process** at all. The agent host behind Copilot CLI will therefore export without `x-oneuptime-token`, and OneUptime will reject its data. Set `chat.agentHost.otel.headers` directly, set `OTEL_EXPORTER_OTLP_HEADERS` in the agent host's environment, or point the agent host at a local collector that attaches the header.

The rest of the managed-settings block — `enabled`, `endpoint`, `protocol`, `captureContent`, `serviceName`, `resourceAttributes` — does apply to the VS Code Chat extension, the Copilot CLI agent host, and the JetBrains plugin.

### Attribution: Copilot names no user, so you must

**Copilot emits no usable human identity.** There is no `user.email`, no `user.id` and no `enduser.id`. The Copilot CLI agent host does put `enduser.pseudo.id` on its `invoke_agent` spans — a pseudonymous identifier derived from `analytics_tracking_id` — but it is not an email, it is not emitted by the VS Code extension, and OneUptime cannot map it to an employee. Otherwise spans arrive with a model, token counts and a service name and nothing that says who ran them. Without intervention, every Copilot dollar in OneUptime lands in one anonymous bucket.

The fix is to inject the identity yourself as a resource attribute, per machine. In managed settings, that is the `resourceAttributes` object shown above. Where you provision developer machines through a shell profile or an MDM script instead:

```bash
export OTEL_RESOURCE_ATTRIBUTES="enduser.id=${USER_EMAIL},user.email=${USER_EMAIL},team.id=platform,cost_center=eng-tools,department=Engineering"
```

Set both `enduser.id` and `user.email`: OneUptime reads `enduser.id` as the employee identifier and `user.email` as the employee's email, and having both makes the Usage tab render a name you recognize rather than an opaque id. `team.id`, `team`, `cost_center` and `department` drive the team and cost-centre rollups.

These are _resource_ attributes, so they reach OneUptime as `resource.enduser.id`, `resource.user.email` and `resource.team.id`. That is the spelling that matters here, and OneUptime matches it: every identity and team key is recognized in both the bare and the `resource.`-prefixed form. Copilot's spans carry the GenAI attributes that mark them as LLM calls, so the identity lands on the columns the Usage tab groups by.

Do this at provisioning time. Retrofitting attribution is impossible — spans that already landed without an identity cannot be re-attributed later.

One trap worth naming: do **not** reach for `gen_ai.user` or `llm.user` to carry the employee. OneUptime deliberately does not treat those as the employee, because in an application that serves customers they carry the _caller's own downstream customer_, and mapping that to an employee produces wrong internal chargeback. `enduser.id` and `user.email` are the attributes to set.

### What Copilot's spans look like

Copilot follows the OpenTelemetry GenAI semantic conventions, which means it flows into OneUptime's existing LLM span handling with no extra configuration — the same LLM calls list, the same AI / LLM panel, the same [cost budgets](/docs/telemetry/ai-llm-observability) as your own instrumented applications.

Span names:

| Span           | Emitted                       |
| -------------- | ----------------------------- |
| `invoke_agent` | Root span, one per agent turn |
| `chat`         | One per LLM API call          |
| `execute_tool` | One per tool call             |
| `execute_hook` | One per hook execution        |

Attributes include `gen_ai.agent.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.conversation.id`, `gen_ai.response.finish_reasons`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, plus `copilot_chat.time_to_first_token`.

Metrics from both surfaces: `gen_ai.client.operation.duration` and `gen_ai.client.token.usage`, both histograms. The vendor metrics differ by surface — the VS Code extension emits the legacy `copilot_chat.*` namespace (`copilot_chat.tool.call.count`, `copilot_chat.tool.call.duration`, `copilot_chat.agent.invocation.duration`), while the Copilot CLI agent host emits the canonical `github.copilot.*` namespace (`github.copilot.tool.call.count`, `github.copilot.tool.call.duration`, `github.copilot.agent.turn.count`, `github.copilot.code.lines_added` / `lines_removed`). GitHub says `github.copilot.*` is the namespace to build new dashboards on.

Copilot emits traces, metrics and **events** — delivered on the OTLP logs signal, so keep a `logs` pipeline in any collector you put in front of OneUptime. VS Code Copilot Chat events include `gen_ai.client.inference.operation.details`, `copilot_chat.session.start`, `copilot_chat.tool.call`, `copilot_chat.agent.turn`, `copilot_chat.edit.feedback` and `copilot_chat.user.feedback`. The Copilot CLI agent host records its lifecycle as span events instead (`github.copilot.hook.start`, `github.copilot.session.truncation`, `github.copilot.session.shutdown`, and so on).

Because `gen_ai.conversation.id` is present, OneUptime groups a whole Copilot agent turn as one conversation in the LLM calls list. And because token counts use the standard attribute names, cost is [computed at ingest](/docs/telemetry/ai-llm-observability) from the model and token counts for models in the catalog.

Copilot's own agent host also reports spend directly: `github.copilot.cost` (monetary cost) and `github.copilot.aiu` (AI units) sit on both the `invoke_agent` and `chat` spans. OneUptime prices calls at ingest from the model and token counts rather than reading those attributes, so a OneUptime figure and GitHub's own `github.copilot.cost` can differ — query the attribute directly if you need GitHub's number.

### Copilot SDK

If you embed the Copilot SDK, its `TelemetryConfig` carries its own keys: `otlpEndpoint` (also accepted as `otlp_endpoint` / `OTLPEndpoint` depending on language), `otlpProtocol` (`"http/json"` or `"http/protobuf"`), `exporterType` (`"otlp-http"` or `"file"`), `filePath`, `sourceName` and `captureContent`. It propagates W3C `traceparent` and `tracestate` over JSON-RPC, so SDK spans join your application's traces rather than floating on their own, and it exposes an `assistant.usage` streaming event you can subscribe to, whose `apiEndpoint` field supports cost attribution — GitHub documents this as an SDK event subscription, not as something exported over OTLP.

### Seats and billing are API-only

Copilot's seat assignments, seat activity and premium-request billing are **not available over OpenTelemetry at all**. OTel gives you what the agent surfaces did; it does not give you who holds a seat, whether that seat is idle, or what GitHub billed. For flat-rate seats, idle-seat reclamation is the actual cost lever, and it lives entirely in the REST API.

Two things to know before you build anything against those APIs yourself:

- The legacy aggregate endpoint `GET /orgs/{org}/copilot/metrics` (and its team and enterprise siblings) has been **retired**. Anything written against its `total_active_users` / `total_engaged_users` / `copilot_ide_code_completions` shape now fails. The exact shutdown date is reported in a community discussion rather than a first-party changelog, so check GitHub's current documentation rather than trusting a date from a blog post.
- The replacement is a set of **report endpoints** — `.../copilot/metrics/reports/users-1-day?day=YYYY-MM-DD`, `.../reports/users-28-day/latest`, and organization, enterprise, repos and user-teams variants — which return a small JSON body of **signed download links** (`download_links`, `report_day`) rather than inline rows. You fetch the links to get the data. There is a genuine gain here: the per-user reports carry one record per person (`user_login`, `ai_credits_used`, `user_initiated_interaction_count`, `code_generation_activity_count`, `loc_added_sum`, `used_agent` / `used_chat` / `used_cli` flags), which the old aggregate API never did.

**OneUptime does not poll these APIs today.** A scheduled connector that pulls seats, the per-user report endpoints and premium-request billing, and turns them into per-employee metrics next to the OTel data, is a planned future connector — not something you can enable now. Until it exists, treat OneUptime's Copilot view as covering agent-surface usage, and pull seat and billing numbers from GitHub separately.

## Verify it landed

Run a prompt through each tool, wait a few seconds, then open **AI / LLM** in the navigation (under Observability):

- **LLM Calls** should list the calls. Copilot's arrive as `invoke_agent` / `chat` / `execute_tool` spans; Gemini CLI's arrive under the service name you configured — and only if you turned its `traces` signal on.
- The **Usage** tab ranks employees, teams, models, providers and services by spend. Both tools appear here through their spans, so both are ranked by a cost computed at ingest from the model and token counts. Gemini CLI users should appear by email immediately. If Copilot rows show no employee, the resource attributes did not reach the exporter — check that the identity is set in the same place as the rest of the export configuration.
- Nothing at all? A wrong `x-oneuptime-token` is rejected at ingest, and for Gemini CLI the most common cause is `otlpProtocol` left at its `grpc` default while exporting straight to OneUptime.

## Related

- [AI / LLM Observability with OneUptime](/docs/telemetry/ai-llm-observability) — the attributes OneUptime recognizes, how cost is computed, and daily cost budgets.

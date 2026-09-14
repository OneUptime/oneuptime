# Monitoring Claude Code with OneUptime

Claude Code is a first-class OTLP client. It speaks `http/protobuf`, `http/json` and `grpc`, supports per-signal endpoints, and sends arbitrary headers — so it exports straight to OneUptime with no collector, no gateway and no connector in between. Setup is a block of environment variables.

## What you get

Once the export is on, every developer's Claude Code usage lands in OneUptime as ordinary OpenTelemetry metrics and logs:

- **Cost and tokens per developer** — `claude_code.cost.usage` (USD) and `claude_code.token.usage` (tokens), broken down by model, by `query_source` (main agent vs. subagent), and by the agent/skill/plugin/MCP server that ran the call.
- **Sessions** — `claude_code.session.count`, split by how the session started.
- **Output** — `claude_code.commit.count`, `claude_code.pull_request.count`, and `claude_code.lines_of_code.count` split into `added` / `removed`.
- **Tool acceptance rate** — `claude_code.code_edit_tool.decision` carries `decision=accept|reject`, so acceptance rate is `accept / (accept + reject)`, sliceable by language and by which tool was used.
- **Active time** — `claude_code.active_time.total`, split into `user` (keyboard interaction) and `cli` (tool execution and model responses).
- **Events** — prompts, tool results, API requests, API errors, permission-mode changes and MCP server connections, as OTLP log records.

Claude Code puts `user.email` on every metric datapoint and every event record, and OneUptime reads it as the employee on the metric datapoints — which is where the cost and token figures live. (Identity on log records is not read for attribution today, so the event stream is searchable but not yet joined to spend.) See [Attributing usage to employees and teams](#attributing-usage-to-employees-and-teams) for the caveats.

## Before you start

1. Create a telemetry ingestion token in OneUptime: **Project Settings → Telemetry & APM → Ingestion Keys → Create Ingestion Key**.
2. Note your OTLP endpoint: `https://oneuptime.com/otlp`, or `https://YOUR-ONEUPTIME-HOST/otlp` if you self-host.
3. The token travels as the `x-oneuptime-token` header on every export.

Use one ingestion key for the whole Claude Code fleet. It ends up on every developer machine, so treat it as a shared write-only credential and rotate it the way you would any other.

## Quick start for one developer

Export these in your shell (or your `.zshrc` / `.bashrc`) and restart Claude Code:

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
```

What each one does:

- `CLAUDE_CODE_ENABLE_TELEMETRY=1` is the master switch. Nothing is exported without it.
- `OTEL_METRICS_EXPORTER` and `OTEL_LOGS_EXPORTER` accept `console`, `otlp`, `none` (metrics also accept `prometheus`), and take a comma-separated list — `otlp,console` exports and prints at the same time, which is handy while you are setting this up.
- `OTEL_EXPORTER_OTLP_ENDPOINT` is the **base** URL — Anthropic's examples use a bare origin here and full per-signal paths on the per-signal variables, matching the OpenTelemetry exporter spec, where the base URL has `/v1/metrics` and `/v1/logs` appended. Only use `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` / `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` if you need to split signals, and give those the full path (`https://oneuptime.com/otlp/v1/metrics`, `.../v1/logs`).
- `OTEL_EXPORTER_OTLP_HEADERS` takes comma-separated `key=value` pairs, so extra headers are `key1=val1,key2=val2`.

Metrics flush every 60 seconds by default and logs every 5 seconds, so give it a minute before you go looking.

## Fleet rollout with managed settings

For an organization, ship the same variables as a managed settings file. Managed settings use the same JSON shape as `settings.json`, with the variables under an `env` block:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://oneuptime.com/otlp",
    "OTEL_EXPORTER_OTLP_HEADERS": "x-oneuptime-token=YOUR_INGESTION_TOKEN",
    "OTEL_RESOURCE_ATTRIBUTES": "team.id=platform,cost_center=eng-123,department=engineering"
  }
}
```

Drop it at the managed-settings path for the platform:

| Platform      | Path                                                            |
| ------------- | --------------------------------------------------------------- |
| macOS         | `/Library/Application Support/ClaudeCode/managed-settings.json` |
| Linux and WSL | `/etc/claude-code/managed-settings.json`                        |
| Windows       | `C:\Program Files\ClaudeCode\managed-settings.json`             |

On Windows, the legacy `C:\ProgramData\ClaudeCode\managed-settings.json` path is **not** read any more. Do not put the file there.

**Use a drop-in instead of the main file if you already have a policy.** A `managed-settings.d/` directory next to the main file merges `*.json` in alphabetical order, so a telemetry-only `10-telemetry.json` ships cleanly without touching an existing security policy file. Since v2.1.223 the `env` block is merged **per variable** across admin sources — but the telemetry variables are the exception you have to plan around. The `OTEL_EXPORTER_OTLP_*` exporter keys, the `OTEL_LOG_*` content-capture toggles, `OTEL_LOGS_EXPORTER` and the beta tracing variables move as a **single unit**: they all come from the highest-ranked admin source that sets any one of them, so an exporter endpoint from one source can never pair with credentials from another. A telemetry drop-in in `managed-settings.d/` therefore contributes nothing at all if a higher-ranked source (server-managed settings, or an MDM/registry policy) already sets any `OTEL_EXPORTER_OTLP_*`, `OTEL_LOG_*` or `OTEL_LOGS_EXPORTER` variable — or delivers `otelHeadersHelper`. `OTEL_METRICS_EXPORTER` and `OTEL_TRACES_EXPORTER` do merge per key. Drop-in files inside the file source still merge key by key with each other.

Other delivery mechanisms for the same JSON, if your fleet is managed that way:

- Server-managed settings from the claude.ai admin console — fetched at startup and polled hourly.
- A macOS configuration profile in the `com.anthropic.claudecode` managed-preferences domain.
- Windows registry: a `Settings` `REG_SZ` value under `HKLM\SOFTWARE\Policies\ClaudeCode`, with an `HKCU` fallback.

Precedence, highest first: server-managed → MDM/OS policy → managed-settings files (`managed-settings.json` plus `managed-settings.d/*.json`) → `HKCU`. These sources do **not** merge with each other: Claude Code uses the first one that delivers at least one policy key and ignores the rest entirely, with no warning. `env` is one of the few keys read across sources — subject to the telemetry-unit caveat above.

One gotcha worth planning around: when a **server-managed** change touches certain `env` variables, the developer has to accept a security-approval dialog in an interactive session before it takes effect. Not every variable triggers it — Anthropic applies feature toggles, model settings, UI options and numeric limits without a prompt — but a non-empty `OTEL_EXPORTER_OTLP_ENDPOINT` always does, so a server-managed telemetry rollout always needs the dialog. File-based managed settings and MDM policies do not have that step.

**Verify on a developer machine.** Run `/status` in Claude Code and look at the `Setting sources` line — it should read `Enterprise managed settings` followed by the source in parentheses: `(file)` for `managed-settings.json`, `(drop-ins)` or `(file + drop-ins)` if you used `managed-settings.d/`, `(remote)` for server-managed, `(plist)` / `(HKLM)` for an MDM or OS policy, `(HKCU)` for the registry fallback. That confirms the file was found and parsed, before you go hunting for missing data in OneUptime. If the line names a source other than the one you deployed, a higher-priority source won and yours was ignored.

**Rotating credentials.** If you cannot bake a long-lived token into the file, set `"otelHeadersHelper": "/path/to/generate-otel-headers.sh"` in `.claude/settings.json`. The script must print a flat JSON object of string key/values, for example `{"x-oneuptime-token":"..."}`. It runs at startup and then every `CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS` milliseconds (default `1740000`, 29 minutes). Failures show up in `/status`, in the `--debug` log, and on stderr under `-p`.

## Attributing usage to employees and teams

OneUptime denormalizes the human actor out of the telemetry into queryable columns, so you can rank people and teams by spend without writing attribute filters by hand.

**The employee key is `user.email`.** Claude Code documents it as "user email address (when authenticated via OAuth)" and "always included when available", and there is no environment variable to suppress it — unlike `session.id`, `app.version`, `app.entrypoint` and the account ids, which all have toggles. So under claude.ai / Console SSO login it arrives by default on both metric datapoints and event records, and OneUptime picks it up with no configuration.

**Be aware of the auth caveat.** The wording "when authenticated via OAuth" implies `user.email` is **absent** when the CLI authenticates with a raw `ANTHROPIC_API_KEY`, or through Amazon Bedrock or Google Vertex. Anthropic's documentation does not state this outright, so verify it against your own fleet rather than assuming. If your developers use API-key, Bedrock or Vertex auth and the email is missing, your options are:

- Fall back to `user.account_uuid` (and `user.account_id`), which are gated by `OTEL_METRICS_INCLUDE_ACCOUNT_UUID` — default `true`. These are stable per account but are opaque UUIDs, so you will need your own mapping from UUID to person.
- Set the identity yourself in `OTEL_RESOURCE_ATTRIBUTES` on each machine, if your provisioning already knows who is at the keyboard.

**Do not use `user.id` as the employee key on a normal install.** By default it is a random anonymous identifier persisted in `~/.claude.json`: per-install, not per-person, and it resets if the file is cleared. (OneUptime reads `user.id` as an employee id for general OpenTelemetry GenAI traffic, where it is the canonical actor attribute — Claude Code is the exception, which is why `user.email` takes priority.)

**There is one exception: a Claude apps gateway.** When Claude Code is signed in to a self-hosted Claude apps gateway, the CLI stamps exports with the authenticated identity from the gateway session — `user.id` is the IdP subject rather than an anonymous installation identifier, `user.email` is the signed-in email, `user.groups` carries IdP group membership as a comma-separated string, and every export also carries `identity.source=gateway-oidc`. That makes a gateway the supported way to get a real `user.email` onto a Bedrock, Vertex or API-key fleet. Note that on gateway sessions the gateway identity is applied last, so `user.*` and `identity.*` keys you set through `OTEL_RESOURCE_ATTRIBUTES` are ignored.

**Teams and cost centres** come from resource attributes. Set them per machine, per team, or per managed-settings profile:

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

**`OTEL_RESOURCE_ATTRIBUTES` values cannot contain spaces.** Anthropic documents this as a hard formatting rule: `team=Platform Engineering` is invalid. Use underscores, camelCase, or percent-encoding (`team=John%27s%20Team`) instead. Quoting does not escape a space — `org.name="My Company"` produces the literal value `"My Company"`, quotes included.

OneUptime rolls up on `team.id`, `team`, `cost_center` and `department`, and recognizes each of them in both spellings — the bare key, and the `resource.`-prefixed key that OTLP ingest produces for a resource attribute. That matters here because Claude Code gives you both: it copies every `OTEL_RESOURCE_ATTRIBUTES` key onto every metric datapoint and event record by default (`OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES`, default `true`), and the keys are in the OTLP resource block regardless. Setting the toggle to `false` still leaves the team rollup working, through the resource-block spelling. Custom keys can never override the built-ins — on a collision, the built-in value wins.

`organization.id` is included when available and is a useful tenant key if you ingest more than one Anthropic organization into the same project.

## Metrics reference

Every metric is a counter. All of them carry the standard attributes below **in addition** to the per-metric ones.

| Metric                                | Unit   | Key attributes                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude_code.session.count`           | none   | `start_type` = `fresh` \| `resume` \| `continue` \| `agents_view`                                                                                                                                                                                                                              |
| `claude_code.lines_of_code.count`     | none   | `type` = `added` \| `removed`; `model`                                                                                                                                                                                                                                                         |
| `claude_code.commit.count`            | none   | standard attributes only                                                                                                                                                                                                                                                                       |
| `claude_code.pull_request.count`      | none   | standard attributes only                                                                                                                                                                                                                                                                       |
| `claude_code.cost.usage`              | USD    | `model`; `query_source` = `main` \| `subagent` \| `auxiliary`; `speed` = `fast` (absent otherwise); `effort` = `low` \| `medium` \| `high` \| `xhigh` \| `max`; `agent.name`, `skill.name`, `plugin.name`, `marketplace.name`, `mcp_server.name`, `mcp_tool.name` (absent when not applicable) |
| `claude_code.token.usage`             | tokens | `type` = `input` \| `output` \| `cacheRead` \| `cacheCreation`; plus `model`, `query_source`, `speed`, `effort` and the same agent/skill/plugin/MCP attribution keys                                                                                                                           |
| `claude_code.code_edit_tool.decision` | none   | `tool_name` = `Edit` \| `Write` \| `NotebookEdit`; `decision` = `accept` \| `reject`; `source` = `config` \| `hook` \| `user_permanent` \| `user_temporary` \| `user_abort` \| `user_reject`; `language` (for example `TypeScript`, `Python`, `Markdown`, `unknown`)                           |
| `claude_code.active_time.total`       | s      | `type` = `user` (keyboard interaction) \| `cli` (tool execution and model responses)                                                                                                                                                                                                           |

Two details that bite:

- The cache token types are **camelCase**: the literal strings are `cacheRead` and `cacheCreation`, not `cache_read` / `cache_creation`. Do not snake_case-normalize them in a dashboard filter, and do not assume they match the vocabulary Anthropic's Admin API uses.
- `claude_code.active_time.total` is documented with unit `s`. Whether the value is fractional seconds is not documented — check a sample of your own data before you report it as a precise figure.
- Only three metrics carry an OpenTelemetry unit string at all: `claude_code.cost.usage` (`USD`), `claude_code.token.usage` (`tokens`) and `claude_code.active_time.total` (`s`). The five count metrics carry none. And when `prometheus` is the only exporter listed in `OTEL_METRICS_EXPORTER`, Claude Code omits even those three units.

**Standard attributes on every metric and event:** `session.id`, `app.version`, `app.entrypoint`, `organization.id`, `user.account_uuid`, `user.account_id`, `user.id`, `user.email`, `terminal.type`, plus your `OTEL_RESOURCE_ATTRIBUTES` keys. Several of those are gated — see [Cardinality and cost control](#cardinality-and-cost-control).

On `claude_code.cost.usage` and `claude_code.token.usage`, third-party and user-defined agent, skill, plugin, MCP server and MCP tool names are **redacted** to generic values like `custom` / `third-party` — unconditionally. `OTEL_LOG_TOOL_DETAILS` is documented as affecting tool events, `user_prompt` command names and trace span attributes, not these metric attribution attributes, so turning it on does not un-redact a cost breakdown. Built-in, bundled, user-defined (for skills) and official-marketplace names appear verbatim; `marketplace.name` is only emitted at all for official-marketplace plugins.

## Events (OTLP logs) reference

Events arrive as OTLP log records. Every record also carries `event.name` (the bare name without the `claude_code.` prefix), `event.timestamp` (ISO 8601) and `event.sequence` (a monotonic counter). Records additionally carry `prompt.id`, `message.uuid`, `workspace.host_paths`, `workflow.run_id`, `workflow.name` and `client_request_id` for correlation, and — **in Agent SDK and non-interactive `-p` sessions only** — pick up `trace_id` / `span_id` from an inbound `TRACEPARENT` even when no traces exporter is configured. Interactive sessions deliberately ignore an inbound `TRACEPARENT`, to avoid inheriting ambient values from CI or container environments, so records from a developer's terminal session carry no inherited trace context.

| Event                                 | What it records                                                                                                                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude_code.user_prompt`             | `prompt_length`, `command_name`, `command_source`; `prompt` text is redacted unless you opt in                                                                                                                 |
| `claude_code.assistant_response`      | `response_length`, `model`, `request_id`, `query_source`; `response` text is redacted unless you opt in                                                                                                        |
| `claude_code.tool_result`             | `tool_name`, `tool_use_id`, `success`, `duration_ms`, `error_type`, `decision_type`, `decision_source`, input/result sizes                                                                                     |
| `claude_code.api_request`             | `model`, `cost_usd`, `cost_usd_micros`, `duration_ms`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `request_id`, `speed`, `effort`                                          |
| `claude_code.api_error`               | `model`, `error`, `status_code`, `duration_ms`, `attempt`, `request_id`                                                                                                                                        |
| `claude_code.api_refusal`             | `model`, `request_id`, `query_source`, `attempt`, `server_fallback_hop`, `has_category`, `has_explanation`                                                                                                     |
| `claude_code.api_request_body`        | Raw request body — only emitted when you turn raw bodies on                                                                                                                                                    |
| `claude_code.api_response_body`       | Raw response body — only emitted when you turn raw bodies on                                                                                                                                                   |
| `claude_code.tool_decision`           | `tool_name`, `tool_use_id`, `decision`, `tool_source`, `source`                                                                                                                                                |
| `claude_code.permission_mode_changed` | `from_mode`, `to_mode` (`default`, `plan`, `acceptEdits`, `auto`, `bypassPermissions`), `trigger`                                                                                                              |
| `claude_code.auth`                    | `action` (`login` / `logout`), `success`, `auth_method`, `error_category`, `status_code`                                                                                                                       |
| `claude_code.mcp_server_connection`   | `status`, `transport_type` (`stdio` / `sse` / `http`), `server_scope`, `duration_ms`, `error_code`, `is_plugin`, `plugin.name`; `server_name` and the full `error` message only when `OTEL_LOG_TOOL_DETAILS=1` |
| `claude_code.internal_error`          | `error_name`, `error_code`                                                                                                                                                                                     |
| `claude_code.plugin_installed`        | `plugin.name`, `plugin.version`, `marketplace.name`, `install.trigger`                                                                                                                                         |
| `claude_code.plugin_loaded`           | `plugin.name`, `marketplace.name`, `marketplace.is_official`, `plugin_id_hash` — `plugin.version` is on `plugin_installed`, not here                                                                           |

`claude_code.api_request` carries both `cost_usd` and `cost_usd_micros`. Anthropic documents `cost_usd` only as "estimated cost in USD" without typing it, and types `cost_usd_micros` explicitly as an integer in millionths of a USD. Use the integer when you need per-request cost you can add up without rounding drift.

## Cardinality and cost control

Claude Code puts `session.id` on every metric datapoint by default, and session ids are unbounded. On a fleet of any size that single attribute is the biggest driver of metric storage cost — a hundred developers running ten sessions a day is a thousand new series per day, per metric, forever.

**Turn it off for fleet-wide rollouts.** You lose nothing for cost and usage reporting. The variable is named and documented as a _metrics_ cardinality control, but Anthropic's attribute table covers metrics and events together and does not say outright whether event records keep `session.id` when it is off — check a sample of your own events before you rely on per-session correlation in the event stream.

```bash
export OTEL_METRICS_INCLUDE_SESSION_ID=false
```

The full set of identity toggles, with their defaults:

| Variable                                   | Default | Effect                                                                        |
| ------------------------------------------ | ------- | ----------------------------------------------------------------------------- |
| `OTEL_METRICS_INCLUDE_SESSION_ID`          | `true`  | Adds `session.id` — unbounded cardinality                                     |
| `OTEL_METRICS_INCLUDE_VERSION`             | `false` | Adds `app.version`                                                            |
| `OTEL_METRICS_INCLUDE_ACCOUNT_UUID`        | `true`  | Adds both `user.account_uuid` and `user.account_id`                           |
| `OTEL_METRICS_INCLUDE_ENTRYPOINT`          | `false` | Adds `app.entrypoint` (`cli`, `sdk-cli`, `sdk-ts`, `sdk-py`, `claude-vscode`) |
| `OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES` | `true`  | Copies `OTEL_RESOURCE_ATTRIBUTES` keys onto every datapoint                   |

There is no toggle for `user.email`, `user.id`, `organization.id` or `terminal.type` — they are always included when available.

**Export intervals** default to 60000 ms for metrics (`OTEL_METRIC_EXPORT_INTERVAL`), 5000 ms for logs (`OTEL_LOGS_EXPORT_INTERVAL`) and 5000 ms for traces (`OTEL_TRACES_EXPORT_INTERVAL`). Logs are the noisy signal: a 5-second flush per active developer seat is what you should size ingest for. Raising `OTEL_LOGS_EXPORT_INTERVAL` batches more per request and reduces request volume, at the cost of a longer delay before events show up.

If you only want cost and usage reporting and not the event stream, set `OTEL_LOGS_EXPORTER=none` and keep metrics on. Cost, tokens, sessions, commits, PRs, lines of code, tool decisions and active time all live in metrics.

## Privacy: prompt and tool content are off by default

Claude Code does **not** export prompt text, assistant responses, tool arguments or tool output unless you explicitly turn each one on. Everything in this table is off by default:

| Variable                       | Default | What `1` turns on                                                                                                            |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `OTEL_LOG_USER_PROMPTS`        | off     | Raw prompt text on `claude_code.user_prompt`                                                                                 |
| `OTEL_LOG_ASSISTANT_RESPONSES` | off     | Raw response text; falls back to `OTEL_LOG_USER_PROMPTS` when unset, and `0` keeps it redacted                               |
| `OTEL_LOG_TOOL_DETAILS`        | off     | Tool parameters and arguments, and un-redacts third-party plugin/skill/MCP names                                             |
| `OTEL_LOG_TOOL_CONTENT`        | off     | Tool input and output content in span events — requires the traces beta, so it does nothing on a metrics-and-logs-only setup |
| `OTEL_LOG_RAW_API_BODIES`      | off     | Full request/response bodies inline, or `file:<dir>` to write them to disk                                                   |

**OneUptime does not recommend turning these on.** The metrics and the redacted events already answer the questions this page is about — who spent what, on which model, with what acceptance rate. Turning on content capture moves your developers' prompts, your source code and your tool output into a telemetry store, where they are subject to a different set of access controls than your repository. `CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH` (default `61440`, 60 KB in UTF-16 code units) caps how much of it travels per record, which limits volume but does not limit sensitivity.

If you do enable content capture for a specific investigation, apply OneUptime's telemetry **scrub rules** and **drop filters** under **Traces → Settings** to redact or drop attributes before they are stored, and turn it back off when the investigation ends.

## Metrics arrive as delta sums

Claude Code sets `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` to `delta` by default, not `cumulative`. Each datapoint is the increment since the previous export, not a running total.

This matters when you build charts and monitors: **sum the datapoints over the window**. Do not apply a rate-of-change or counter-reset function as you would to a cumulative monotonic counter — the numbers come out wrong rather than obviously broken, which is the worst kind of wrong.

If your organization has standardized on cumulative temporality across every exporter, you can pin it:

```bash
export OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative
```

Delta is the default and most fleets should leave it alone. Just be consistent — do not mix the two across the same fleet, or your rollups will double-count.

## What OneUptime shows you

Open **AI / LLM** in the navigation bar (under Observability). The **Usage** tab ranks employees, teams, models, providers and services by spend, and Claude Code's `claude_code.cost.usage` feeds the employee, team and model breakdowns directly — no mapping step, no separate coding-agent section. `claude_code.token.usage` feeds the Overview page's token tiles the same way.

Read the next two paragraphs before you build a report on this, because both are load-bearing.

**Metrics are a fallback for spans, never an addition.** GenAI spans are authoritative, and the metric stream is consulted only when the span stream reported nothing — the two are never summed, because an emitter producing both signals would otherwise have every dollar counted twice. So in a project where your own instrumented applications already produce GenAI spans with cost on them, **Claude Code's metric-sourced spend does not appear**. If you want the fleet's spend visible on its own, export it into its own OneUptime project with its own ingestion key, so the span stream there is empty and the fallback engages. (Turning on the [traces beta](#optional-traces-beta) changes the picture too: those spans are real GenAI spans, and once they exist they are what the page reads.)

**A metric-sourced row carries cost only.** In the Usage table, the Calls and token columns render as `—` for metric-sourced rows — the spend counter has no per-call detail, and an em dash is honest where a `0` would claim the developer made no calls. Figures sourced from metrics are labelled **from GenAI metrics** on screen. The Provider and Application / Service breakdowns have no metric fallback at all: `claude_code.*` counters carry no `gen_ai.system` and are not attached to a OneUptime telemetry service.

From there:

- Sort by employee to see per-developer spend, and by team or cost centre for chargeback, using the `team.id` / `cost_center` resource attributes you set during rollout. Both breakdowns work off metrics; the employee grouping matches `user.email` first and falls back through `user.account_uuid` / `user.account_id`, so an API-key-auth fleet with no email still lands on its own rows rather than collapsing into one Unattributed bucket.
- Break spend down by model — the `model` attribute on `claude_code.cost.usage` is read for the Model breakdown. `query_source` (main agent versus subagents) is not one of the Usage tab's dimensions; chart it on a dashboard instead.
- Build **dashboards** on any of the eight metrics — acceptance rate, lines of code, commits and PRs per developer, active time.
- Create **metric monitors** to alert on a spend or token threshold. See [Metrics Monitor](/docs/monitor/metrics-monitor).

For the wider picture — LLM calls from your own applications, prompts and completions, daily cost budgets — see [AI / LLM Observability](/docs/telemetry/ai-llm-observability).

## Optional: traces beta

Everything above is metrics and logs, which is the supported path and the one to roll out. Claude Code also has a **beta** traces exporter that produces real waterfalls for an agent run. It is optional, it is marked beta by Anthropic, and it can change.

```bash
export CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1
export OTEL_TRACES_EXPORTER=otlp
```

(`ENABLE_ENHANCED_TELEMETRY_BETA` is an accepted alias for the first variable.)

Span names are `claude_code.interaction` at the top, with `claude_code.llm_request` and `claude_code.tool` beneath it, and `claude_code.tool.blocked_on_user` / `claude_code.tool.execution` under the tool span. `claude_code.hook` is **not** emitted by the two variables above: it needs _detailed_ beta tracing (`ENABLE_BETA_TRACING_DETAILED=1` plus `BETA_TRACING_ENDPOINT`), and in interactive CLI sessions your organization must be allowlisted for it — Agent SDK and non-interactive `-p` sessions are not gated. The LLM spans carry GenAI semantic convention keys — `gen_ai.system` (always `anthropic`), `gen_ai.request.model`, `gen_ai.response.id`, `gen_ai.response.finish_reasons` — alongside `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `ttft_ms`, `duration_ms`, `stop_reason` and `llm_request.context`. (`gen_ai.tool.call.id` sits on the `claude_code.tool` and `claude_code.tool.execution` spans, mirroring `tool_use_id` — not on the LLM span.) Because they use the standard GenAI keys, OneUptime classifies them as LLM calls the same way it classifies spans from any other [GenAI instrumentation](/docs/telemetry/ai-llm-observability).

By default the W3C `traceparent` header is sent on model and HTTP MCP requests only when `ANTHROPIC_BASE_URL` is unset or points at the Anthropic API, since some proxies reject unrecognized headers. `CLAUDE_CODE_PROPAGATE_TRACEPARENT=1` forwards it through a custom `ANTHROPIC_BASE_URL` proxy. Bash and PowerShell subprocesses inherit `TRACEPARENT` automatically, so a build script that is itself instrumented joins the same trace — but that inheritance is governed by the same switch, so behind a custom proxy the subprocesses only get `TRACEPARENT` once you set `CLAUDE_CODE_PROPAGATE_TRACEPARENT=1` too.

## Troubleshooting

**Nothing arrives at all.** Confirm the master switch: `CLAUDE_CODE_ENABLE_TELEMETRY=1`. Without it, none of the other variables do anything.

**Confirm Claude Code is producing data before you blame the network.** Add `console` to the exporter list and watch stdout:

```bash
export OTEL_METRICS_EXPORTER=otlp,console
export OTEL_LOGS_EXPORTER=otlp,console
```

If datapoints print, the instrumentation is fine and the problem is the endpoint, the token, or something between you and OneUptime.

**Check what settings Claude Code actually loaded.** Run `/status`. The `Setting sources` line tells you which managed source was picked up — `Enterprise managed settings (file)`, `(drop-ins)`, `(file + drop-ins)`, `(remote)`, `(plist)`, `(HKLM)` or `(HKCU)`. If nothing is listed, the file is at the wrong path, is not valid JSON, or is not readable by the developer's user account. If a different source is named, that source won outright and yours was ignored.

**Managed settings look right but the env block is ignored.** If the change came from **server-managed** settings rather than a file, the developer has to accept a security-approval dialog in an interactive session first — a non-empty `OTEL_EXPORTER_OTLP_ENDPOINT` always triggers it. Ask them to open Claude Code interactively once. If the settings came from a file, check that no higher-priority managed source (server-managed, MDM/OS policy) is winning outright — see [Fleet rollout with managed settings](#fleet-rollout-with-managed-settings).

**Data is there but shows as unattributed.** `user.email` is only documented as present under OAuth authentication. Check whether those developers authenticate with `ANTHROPIC_API_KEY`, Bedrock or Vertex — see [Attributing usage to employees and teams](#attributing-usage-to-employees-and-teams).

**Team or cost centre is missing.** Confirm `OTEL_RESOURCE_ATTRIBUTES` is set on the machine, and that `OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES` has not been set to `false` — at `false`, your keys stay in the OTLP resource block and are not copied onto the datapoints. Also check for a collision with a built-in key: built-ins always win.

**Metrics land but the numbers look too small or too large.** Check that your chart sums the datapoints rather than treating them as a cumulative counter — see [Metrics arrive as delta sums](#metrics-arrive-as-delta-sums).

**Wait a full interval before you conclude anything.** Metrics flush every 60 seconds by default. A test that runs for 10 seconds and then checks OneUptime will find nothing.

**Endpoint spelling.** `OTEL_EXPORTER_OTLP_ENDPOINT` takes the base URL (`https://oneuptime.com/otlp`) and Claude Code appends `/v1/metrics` and `/v1/logs` itself. The per-signal variables (`OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`) want the full path instead, and they override the general one.

**Token rejected.** A wrong `x-oneuptime-token` is rejected at ingest. Re-copy it from **Project Settings → Telemetry & APM → Ingestion Keys**, and check the header string is `x-oneuptime-token=YOUR_INGESTION_TOKEN` with no spaces around the `=`.

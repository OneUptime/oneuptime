# AI Coding Assistant Observability

Your engineers are running Claude Code, Cursor, Codex, Gemini CLI and Copilot, and the invoices are going up. The questions a manager actually has are: **who is using which tool, on which models, what did each person and each team spend, and which applications is that spend going into.**

OneUptime answers those from OpenTelemetry. Most coding assistants now export OTLP natively, so there is nothing to install on developer machines beyond configuration — point the exporter at OneUptime's OTLP endpoint and the tokens, cost and tool calls land next to your application's own LLM spans. Start with the [support matrix](#support-matrix) to find out what your fleet can actually produce, then read [employee and team attribution](#employee-and-team-attribution), which is the part that decides whether the numbers have names on them.

Everything on this page is OpenTelemetry ingest. **OneUptime does not poll any vendor's admin or billing API today** — see [what OneUptime does not do yet](#what-oneuptime-does-not-do-yet).

## Before you start

1. Create a telemetry ingestion token: **Project Settings → Telemetry & APM → Ingestion Keys → Create Ingestion Key**.
2. Your OTLP endpoint is `https://oneuptime.com/otlp` — or `https://YOUR-ONEUPTIME-HOST/otlp` if you self-host.
3. The token travels as the `x-oneuptime-token` header on every export request.

One ingestion key for the whole fleet is fine. It ends up on every developer machine, so treat it as a shared write-only credential and rotate it like any other.

## Support matrix

Three things decide what you get from a tool: whether it emits OpenTelemetry at all, how that telemetry reaches OneUptime, and whether anything in it names a person.

| Tool                                                                 | OpenTelemetry support                                                                                                                                                                                                          | How it reaches OneUptime                                                                                                            | Per-employee attribution                                                                                                                                                                         | Guide                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **Claude Code**                                                      | Native — metrics and logs, traces in beta                                                                                                                                                                                      | Direct OTLP from each developer machine; environment variables or a managed-settings file                                           | **Yes** — `user.email`, emitted natively on every metric datapoint and event. Falls back to `user.account_uuid` / `user.account_id`                                                              | [Claude Code](/docs/telemetry/claude-code)                            |
| **Cursor**                                                           | Native — metrics and logs. No traces, no prompt content                                                                                                                                                                        | Cursor's own servers push to your endpoint; configured once in the Cursor dashboard. **Enterprise plan only**                       | **Partial** — `cursor.user.id`, an opaque team-scoped integer that Cursor documents as optional. No email on the wire                                                                            | [Cursor](/docs/telemetry/cursor)                                      |
| **OpenAI Codex CLI**                                                 | Native — traces, metrics and logs, opt-in per machine                                                                                                                                                                          | Direct OTLP, configured in `~/.codex/config.toml`; each signal needs its own full URL                                               | **You set it** — stamp `user.id` and `user.email` in `[otel.span_attributes]`. Codex's own `user.email` is on log records only                                                                   | [OpenAI Codex](/docs/telemetry/openai-codex)                          |
| **Gemini CLI**                                                       | Native — traces, metrics and logs                                                                                                                                                                                              | Direct OTLP, usually through a local collector that attaches the token header                                                       | **Yes** — `user.email` on every record when authenticated. Nothing to configure                                                                                                                  | [Gemini CLI & GitHub Copilot](/docs/telemetry/gemini-cli-and-copilot) |
| **GitHub Copilot**                                                   | Native on **agent surfaces only** — VS Code Chat and agent mode, the agent host behind Copilot CLI, the Copilot SDK, JetBrains agent workflows. Inline completions, Copilot on github.com and Copilot code review emit nothing | Direct OTLP from the editor or agent host; enterprise managed settings for a fleet                                                  | **No** — Copilot emits no user attribute of any kind. Inject `enduser.id` and `user.email` per machine via `resourceAttributes` or `OTEL_RESOURCE_ATTRIBUTES`                                    | [Gemini CLI & GitHub Copilot](/docs/telemetry/gemini-cli-and-copilot) |
| **Cline**                                                            | Native — metrics and logs, no traces                                                                                                                                                                                           | Direct OTLP, but configured centrally: an admin sets the endpoint and protocol in the Cline organization dashboard, not per machine | **No** — Cline's `user_id` is an anonymized token, resolvable to a person only inside Cline's own dashboard                                                                                      | —                                                                     |
| **LiteLLM / Portkey gateways**                                       | Native trace export — LiteLLM's `otel` callback; Portkey's self-hosted and enterprise export, which Portkey marks experimental                                                                                                 | Direct OTLP from the gateway process. One configuration covers every application behind it                                          | **Yes, with LiteLLM** — `litellm.metadata.user_api_key_user_id` carries the employee who owns the virtual key, when you issue one key per person                                                 | [AI Gateways](/docs/telemetry/ai-gateways)                            |
| **Your own apps** — OpenAI SDK, Anthropic SDK, LangChain, LlamaIndex | Native via instrumentation — OpenLLMetry, OpenInference, or the official OpenTelemetry GenAI instrumentations                                                                                                                  | Direct OTLP from the application                                                                                                    | **You set it** — the GenAI conventions define no user attribute at all. Stamp `user.id` from a span processor. OpenInference is the exception: it defines `user.id` and `session.id` first-class | [AI / LLM Observability](/docs/telemetry/ai-llm-observability)        |
| **Windsurf**                                                         | **None.** No OpenTelemetry export is documented                                                                                                                                                                                | Only through a gateway you put in front of it                                                                                       | Not over telemetry. Per-user data lives in Windsurf's Enterprise HTTP API, which OneUptime does not poll                                                                                         | —                                                                     |
| **JetBrains AI Assistant / Junie**                                   | **None.** JetBrains' own "OpenTelemetry plugin" is an in-IDE OTLP _receiver_ for debugging your own instrumented app — it exports no AI Assistant usage                                                                        | Only through a gateway                                                                                                              | Not over telemetry. Per-user adoption and acceptance data lives in the IDE Services AI Analytics API — no tokens, no cost                                                                        | —                                                                     |
| **Amazon Bedrock**                                                   | **None from the service.** Bedrock emits no OpenTelemetry                                                                                                                                                                      | Instrument the calling application, or front Bedrock with a gateway that emits OTLP                                                 | Whatever your app or gateway stamps. AWS's own path is `identity.arn` in model invocation logs plus `iamPrincipal/` cost allocation tags — neither reaches OneUptime                             | —                                                                     |
| **Azure OpenAI**                                                     | **None from the service.** Azure Monitor's `Microsoft.CognitiveServices/accounts` metrics have no user dimension at all                                                                                                        | Instrument the client, or front it with API Management or another gateway                                                           | Not native. The `user` request-body parameter is for abuse monitoring and is not exposed as a metric dimension                                                                                   | —                                                                     |

A dash in the Guide column means there is no OneUptime page for that tool yet, not that the row is unsupported. Where the row says telemetry arrives, it arrives — OneUptime ingests it as ordinary OpenTelemetry whether or not a guide exists.

The JetBrains row is about JetBrains' _own_ AI features. The **GitHub Copilot plugin for JetBrains** is a different product and does emit OpenTelemetry for agent workflows; it sits in the Copilot row.

## Employee and team attribution

This is the mechanism behind "rank my engineers by spend". OneUptime denormalizes the human actor out of the telemetry into queryable columns at ingest, so you filter and group on a column rather than writing attribute lookups by hand.

### Attributes read as the employee

On spans, in preference order — the first key present wins:

| Column             | Attribute keys, preferred first                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Employee id        | `user.id`, `enduser.id`, `litellm.metadata.user_api_key_user_id`, `traceloop.association.properties.user_id`, `langfuse.user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id` |
| Employee email     | `user.email`, `traceloop.association.properties.user_email`, `enduser.email`                                                                                                               |
| Team / cost centre | `team.id`, `team`, `cost_center`, `department`, `litellm.metadata.user_api_key_team_id`, `litellm.team.id`, `cursor.team.id`                                                               |

`user.id` leads because it is the canonical OpenTelemetry key for a human actor — the one the semantic-conventions maintainers point people at, and the one to standardize on if you are stamping identity yourself. `enduser.id` is still an active attribute (the 1.25 deprecation removed `enduser.role` and `enduser.scope`, not `enduser.id`), so it is accepted as an equal alias. `cursor.user.id` sorts last because it is an opaque integer that needs Cursor's admin API to resolve to a person.

**Every key in those three rows is also matched with a `resource.` prefix.** OTLP ingest flattens resource attributes into the attribute map under a `resource.` prefix, so a fleet that stamps identity once on the process — which is what `OTEL_RESOURCE_ATTRIBUTES` does, and the normal way to do it — delivers `resource.user.email` and `resource.team.id`, not the bare keys. Both spellings are read. The whole bare list is tried first and the whole `resource.` list after it, so a per-span value beats a process-wide one. Only the three identity rows get this treatment: model, tokens and cost describe one call and are matched on the bare key alone.

Identity is only read off a span that already looks like an LLM call. `user.id`, `user.email` and `team.id` are generic OpenTelemetry keys that browser and ordinary backend spans carry too, and those are the highest-volume span classes there are — so the identity columns are populated on the rows the question actually reads.

**On metric datapoints** the identity list is shorter and email-first: `user.email`, `user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id`, with teams from `team.id`, `team`, `cost_center`, `department`, `cursor.team.id` — each, again, in both the bare and the `resource.`-prefixed spelling. Email leads there because the coding-agent CLIs that dominate the metric-only population emit `user.email` natively, and it is the one value a manager reads without a lookup table.

**Identity on log records is not read for attribution today.** That matters for Codex specifically, which puts `user.email` on logs and deliberately keeps it off spans — see the [Codex guide](/docs/telemetry/openai-codex) for the workaround.

### Teams and cost centres

None of `team.id`, `team`, `cost_center` or `department` is emitted by any instrumentation. They are what your organization sets, and for a coding-agent CLI the conventional place is `OTEL_RESOURCE_ATTRIBUTES` on the agent process:

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform Engineering,cost_center=eng-123,department=engineering"
```

Set it wherever you already provision developer machines — MDM, a managed-settings file, a shell profile shipped by your dotfiles repo. Codex is the exception: it has no resource-attribute mechanism, so set the same keys in `[otel.span_attributes]` instead.

Those keys arrive at OneUptime as `resource.team.id`, `resource.cost_center` and so on, and are recognized in that spelling on both spans and metric datapoints — so it does not matter whether your exporter leaves them in the OTLP resource block or copies them onto every record the way Claude Code does by default.

To separate spend by **application**, use the service name (`OTEL_SERVICE_NAME`, or the tool's own service-name setting). The Usage tab ranks services alongside people and teams — for GenAI spans. A vendor cost counter has no notion of which of your applications it belongs to, so the Application / Service breakdown covers span-emitting sources only; see [The Usage tab](#the-usage-tab).

### What is deliberately not treated as the employee

Three keys look like identity and are **excluded on purpose**:

- `gen_ai.user`
- `llm.user`
- `litellm.metadata.user_api_key_end_user_id`

All three carry the **caller's own downstream customer**, not the employee. `gen_ai.user` and `llm.user` are how instrumentations echo back OpenAI's `user` request parameter, which the API documents as the caller's end user, sent for abuse monitoring. LiteLLM's `user_api_key_end_user_id` is its explicit end-user id, distinct from the `user_api_key_user_id` key-owner id above.

The reason to exclude them is chargeback correctness, not tidiness. An LLM span can carry two different humans. If a support bot serving 40,000 customers had its customer ids read into the employee column, you would get 40,000 phantom "employees" in the Usage tab, and the engineer who actually owns that spend would appear to have spent nothing. Wrong attribution is worse than missing attribution, because it looks like an answer.

These keys are still in the raw attributes map and you can query them directly. They are just never read into an identity column.

### Privacy

The employee email column holds real PII, so it is covered by your telemetry **scrub rules** under the **Attributes** scope — exactly as the attribute it was derived from is. A denormalized column that skipped the scrub pass would make an email-redaction rule silently ineffective on the one column most likely to hold an email. Configure scrub rules and drop filters under **Traces → Settings**.

## Coding-agent metrics OneUptime rolls up

The coding-agent CLIs namespace their metrics under their own vendor prefix rather than `gen_ai.*`, so OneUptime recognizes each name explicitly. These feed the token and cost rollups directly:

| Metric                     | Tool         | Notes                                                                             |
| -------------------------- | ------------ | --------------------------------------------------------------------------------- |
| `claude_code.token.usage`  | Claude Code  | Tokens                                                                            |
| `claude_code.cost.usage`   | Claude Code  | USD                                                                               |
| `cursor.token.usage`       | Cursor       | Tokens                                                                            |
| `cursor.cost.usage`        | Cursor       | USD, and documented by Cursor as a best-effort estimate, not an invoice           |
| `codex.turn.token_usage`   | OpenAI Codex | Tokens                                                                            |
| `codex.turn.cost_microusd` | OpenAI Codex | **Millionths of a USD.** OneUptime scales it on read — do not convert it yourself |

Alongside these, the standard `gen_ai.client.token.usage` and the pre-convention spellings (`gen_ai.client.token.count`, `llm.token.usage`, `llm.usage.tokens`) are read for anything emitting the GenAI conventions, plus `gen_ai.client.cost` / `gen_ai.client.cost.usd` / `gen_ai.usage.cost` for cost, and LiteLLM's `litellm_spend_metric` / `litellm.cost.total` for gateway spend.

**`gemini_cli.token.usage` is deliberately not in that list.** Gemini CLI emits both its own vendor metric and the semantic-convention `gen_ai.client.token.usage` for the _same_ tokens. The token query matches every recognized name at once and groups by token type, never by metric name, so recognizing both spellings would sum both emissions and report exactly twice the real token count — with no error and no gap in the chart to give it away. Gemini CLI's tokens are counted through `gen_ai.client.token.usage`, once. The same test applies to any vendor token metric: if the process also emits `gen_ai.client.token.usage`, its vendor name stays out. Claude Code, Cursor and Codex each publish vendor metrics only and no `gen_ai.*` metric, which is why theirs are listed.

Two things to know before you read the numbers:

- **Gemini CLI has no cost metric.** It reports tokens, not dollars. Price them against your own rate card, or run its traces so the calls arrive as spans OneUptime can cost at ingest.
- **Metric-sourced token totals count `input` and `output` only** (plus the pre-1.27 semantic-convention spellings `prompt` and `completion`, matched case-insensitively). The coding agents emit a richer vocabulary — Claude Code's `cacheRead` / `cacheCreation` (camelCase), Cursor's `cache_read` / `cache_creation`, Codex's `cached_input` / `cache_write_input` / `reasoning_output` / `total`. Cache tokens are real but are neither input nor output in the sense the columns use; `total` is a superset of its siblings and `reasoning_output` a subset of `output`, so counting either would double-count. They are dropped rather than guessed at, which means a metric-sourced token total is smaller than the raw sum of every datapoint the tool emitted. That is deliberate.

The token-type attribute is read from `gen_ai.token.type`, `llm.token.type`, the bare `type` (Claude Code), `cursor.token.type` or `token_type` (Codex).

## The Usage tab

Open **AI / LLM** in the navigation bar (under Observability). The **Usage** tab ranks **employees, teams, models, providers and services** by spend.

From there:

- Sort by employee for per-developer spend; by team or cost centre for chargeback, using the resource attributes you set at rollout.
- Break down by model to see where the money actually goes, and by service to see which application it went into.
- Set [daily cost budgets](/docs/telemetry/ai-llm-observability) and alert on them with a [Metrics Monitor](/docs/monitor/metrics-monitor).
- Chain a budget alert to a Workflow that stops a runaway agent — see [Circuit-Breaking Runaway AI Agents](/docs/telemetry/ai-agent-circuit-breaker).

Rows with no identity show up as unattributed rather than being dropped. An unattributed bucket that you can see is the signal that a tool needs its identity configured; silently discarding those rows would hide the spend entirely.

### Coding-agent metrics are a fallback, not an addition

The single most important thing to understand about this page in practice: **GenAI spans are authoritative, and the coding-agent metric stream is consulted only when the span stream reported nothing. The two are never added together.**

That is deliberate. Many instrumentations emit both a span and a metric for the same call, and summing them would count every one of those dollars twice — which, for a figure that gates a budget alert, is worse than a missing number.

The practical consequence: **once a breakdown has span rows to show, coding-agent spend does not appear in it.** If your Python service emits `gen_ai.*` spans into the same project as your Claude Code fleet, the Usage table reads the spans and stops there; the `claude_code.*` metrics are not added on top. If you want coding-agent spend to stand on its own, give the fleet its own OneUptime project (its own ingestion key), so the span stream there is genuinely empty and the fallback engages.

What the fallback can and cannot answer, per breakdown:

| Breakdown             | Metrics-only sources                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Employee              | **Yes** — grouped on every recognized identity spelling, bare and `resource.`-prefixed, first non-empty wins. So an email-emitting fleet and an id-only one both land on their own rows |
| Team / cost centre    | **Yes** — same, on the team list                                                                                                                                                        |
| Model                 | **Yes** — the vendor counters do carry a model: Claude Code stamps a bare `model`, Cursor `cursor.model.name`                                                                           |
| Provider              | **No.** The coding-agent counters carry no `gen_ai.system` — Cursor and Claude Code route to several providers behind one subscription and never say which                              |
| Application / Service | **No.** A vendor cost counter is not attached to a OneUptime telemetry service                                                                                                          |

Provider and Application / Service say this on screen instead of showing an empty table.

One more limit worth knowing before you build a chargeback report on it: **a metric-sourced row carries cost only.** The Calls, Input tokens, Output tokens and Total tokens cells render as `—`, because the spend counter carries no per-call detail — an em dash is honest where a `0` would claim the person made no calls. Metric-sourced figures are labelled **from GenAI metrics** wherever they appear.

## No native OpenTelemetry? Put a gateway in front

For Windsurf, JetBrains AI, Amazon Bedrock, Azure OpenAI and anything else in the matrix with no native export, the clean architecture is an AI gateway. Every call flows through one process, that process emits OpenTelemetry, and you configure the export once instead of on every machine.

**Use LiteLLM with one virtual key per employee.** That single decision is what makes the whole thing attributable:

- LiteLLM stamps `litellm.metadata.user_api_key_user_id` on the span — the internal user who owns the key the request authenticated with. OneUptime reads it as the employee id.
- `litellm.metadata.user_api_key_team_id` and `litellm.team.id` become the team column, so cost-centre rollups work without touching resource attributes.
- LiteLLM prices each call itself and reports the cost on the span, including any custom per-model rates you configured on the proxy. That reported cost wins over OneUptime's catalog estimate.

Do **not** reach for `litellm.metadata.user_api_key_end_user_id` for this. It is the downstream customer, and it is excluded for the reason above.

Setup, including the exact `config.yaml` and environment variables, is in [Observing AI Gateways](/docs/telemetry/ai-gateways).

Two honest caveats before you plan a migration around this:

- **A gateway only sees traffic that routes through it.** For applications you write, that is enforceable. For an IDE it usually is not: Cursor's base-URL override is per-user IDE configuration with no org-wide admin setting to force it, it covers chat models only (Tab completion keeps using Cursor's built-in models), and Cursor Enterprise admins can disable BYOK outright. Expect partial coverage there, and prefer Cursor's native export.
- **A gateway sees the call, not the agent.** You get the model request with prompts and completions; you do not get the tool calls, file edits or acceptance decisions the tool's own telemetry reports. Where a tool has native OpenTelemetry, use it — a gateway is the answer for tools that have none.

## Prompt content: the defaults differ per tool

Prompt and completion text is the highest-risk data in this whole pipeline — it routinely contains source code, customer data and credentials pasted into a terminal. The defaults are not consistent, so check each tool rather than assuming:

| Tool                      | Prompt content by default                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code               | **Off.** Five separate opt-in variables, all off                                                                                                                 |
| Cursor                    | **Never sent.** Cursor's export excludes prompt content entirely                                                                                                 |
| OpenAI Codex              | **Off** — `log_user_prompt` defaults to `false`                                                                                                                  |
| Gemini CLI                | **ON** — `logPrompts` defaults to `true`. Set it to `false` in the same change that enables telemetry                                                            |
| GitHub Copilot            | Off — `captureContent`; enterprise managed settings can pin it with `lockCaptureContent`                                                                         |
| LiteLLM (`otel` callback) | **ON** by default. Turn it off with `turn_off_message_logging`, the `otel` callback's `message_logging`, or `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` |

One more default worth knowing: **Codex ships its metrics to OpenAI unless you change `metrics_exporter`**, which defaults to `"statsig"` in a release build. Setting it to `otlp-http` or `none` is what stops that. Details in the [Codex guide](/docs/telemetry/openai-codex).

Where you do capture content deliberately, OneUptime's scrub rules and drop filters apply to it like any other telemetry.

## What OneUptime does not do yet

Being explicit about this saves you an afternoon of looking for a settings screen that does not exist.

- **No vendor admin or billing connectors.** OneUptime does not poll Anthropic's Admin API, Cursor's Admin API, OpenAI's `/v1/organization/usage` and `/v1/organization/costs`, GitHub's Copilot seats and premium-request billing, Windsurf's Enterprise API, or JetBrains IDE Services. Everything on this page arrives over OTLP. Where you need invoice-grade dollars or seat-idleness data, pull it from the vendor yourself.
- **Cost from telemetry is an estimate unless the tool reports one.** When an instrumentation reports a cost, OneUptime uses it as-is. Otherwise it computes one at ingest from token counts and a built-in list-price catalog — list prices, no cache or batch discounts, and unknown models stay at zero rather than being guessed. Cursor's `cursor.cost.usage` is a vendor estimate too, by Cursor's own documentation.
- **Employee identity is read from spans and metric datapoints, not from log records.** Codex's log-borne `user.email` is not yet joined to spend.
- **Negative rows in the matrix age quickly.** GitHub replaced Copilot's entire metrics API inside a year and Copilot's OTel support only appeared in 2026. If a tool you use is listed as having no export, check its current documentation before you build around a gateway.

## Where to start

If you are evaluating this for the first time, roll out in this order — each step is independently useful. Do it in a project that does not already receive GenAI spans from your own applications, or the [fallback rule](#coding-agent-metrics-are-a-fallback-not-an-addition) will keep the coding-agent numbers off the page.

1. **Gemini CLI**, if anyone uses it. It emits `user.email` natively and needs no identity configuration, so it is the fastest way to see attribution work end to end. Turn its `traces` signal on as well — it publishes no cost metric, so spans are what put a dollar figure next to each engineer.
2. **Claude Code.** One managed-settings file for the fleet, `user.email` again for free, a real cost metric, and the richest metric set of any of them — acceptance rate, commits, PRs and lines of code per developer alongside cost.
3. **Cursor**, if you are on Enterprise. One dashboard screen, no developer machines touched, though the identities arrive as integers.
4. **Copilot and Codex**, both of which need identity injected per machine. Do that at provisioning time — spans that already landed without an identity cannot be re-attributed later.
5. **A LiteLLM gateway** for everything else, with one virtual key per employee.

## Related

- [AI / LLM Observability with OneUptime](/docs/telemetry/ai-llm-observability) — the attributes OneUptime recognizes, how cost is computed, and daily cost budgets.
- [Observing AI Gateways (LiteLLM & Portkey)](/docs/telemetry/ai-gateways) — gateway setup, including per-employee virtual keys.
- [Circuit-Breaking Runaway AI Agents](/docs/telemetry/ai-agent-circuit-breaker) — turning a budget alert into an action.
- [OpenTelemetry](/docs/telemetry/open-telemetry) — running a collector, and the OTLP endpoint in general.

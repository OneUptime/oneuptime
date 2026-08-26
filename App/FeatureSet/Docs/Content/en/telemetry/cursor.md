# Monitoring Cursor with OneUptime

Cursor's OpenTelemetry export is **server-side**. You do not install anything on developer machines, you do not set `CURSOR_*` or `OTEL_EXPORTER_OTLP_*` environment variables, and developers do not opt in individually. An admin registers OneUptime as a destination in the Cursor web dashboard, and Cursor's servers push telemetry to your OTLP endpoint for the whole team.

Two prerequisites before you read further:

- **Cursor Enterprise plan only.** The OpenTelemetry Export screen does not exist on other plans.
- **Your OneUptime OTLP endpoint must be reachable from the public internet.** Cursor connects inbound to you. If you self-host behind a firewall, see [Allow Cursor's egress IPs](#step-3-allow-cursors-egress-ips-self-hosted-only).

## What you get, and what you don't

Read this before you go looking for a trace waterfall. Cursor's export sends **metrics and logs only**. Cursor's own documentation states it plainly: no prompt content, no traces, and no historical backfill.

| Signal                                                              | Status                                              |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| Metrics (tokens, cost, tool calls)                                  | Yes — delta sums                                    |
| Log events (per-request usage, errors, skills, hooks, cloud agents) | Yes                                                 |
| Traces / spans                                                      | **No** — Cursor exports none                        |
| Prompt and completion content                                       | **No** — never leaves Cursor over this pipeline     |
| Historical backfill before you enable the destination               | **No** — data starts flowing from activation onward |

Practical consequences in OneUptime:

- Cursor usage will **not** appear in the span-based **LLM Calls** list, and there is no per-call trace to open. That list is built from `gen_ai.*` spans; Cursor emits none.
- Cursor **does** appear in the **Usage** tab of the **AI / LLM** section, because OneUptime recognizes `cursor.token.usage` and `cursor.cost.usage`. Because Cursor is a metrics-only source, two limits apply — read [Where Cursor shows up in the Usage tab](#where-cursor-shows-up-in-the-usage-tab) before you build a chargeback report on it.
- The per-request grain lives in the **Logs** explorer, on the `cursor.api.request` log event — that is the only place per-request token totals exist.

If you need prompt-level traces from Cursor, this pipeline cannot give them to you. Cursor's own recommendation for that is client-side [hooks](https://cursor.com/docs/hooks), which run arbitrary commands on the developer's machine and can POST wherever you like — a separate build-it-yourself path, not covered here.

## Step 1 — Create a OneUptime ingestion key

In OneUptime, open **Project Settings → Telemetry & APM → Ingestion Keys** and click **Create Ingestion Key**. Copy the key.

Your OTLP base URL is `https://oneuptime.com/otlp`, or `https://YOUR-ONEUPTIME-HOST/otlp` if you self-host.

## Step 2 — Create the destination in Cursor

In the Cursor web dashboard, open **Team Settings → OpenTelemetry Export** as a team admin, then:

1. **Create destination.** Enter the base HTTPS URL and the auth header.

   | Field               | Value                        |
   | ------------------- | ---------------------------- |
   | Endpoint (base URL) | `https://oneuptime.com/otlp` |
   | Header name         | `x-oneuptime-token`          |
   | Header value        | `YOUR_INGESTION_TOKEN`       |

   **Enter the base URL without a `/v1` suffix.** Cursor appends `/v1/metrics` and `/v1/logs` itself. Entering `https://oneuptime.com/otlp/v1` produces `.../otlp/v1/v1/metrics` and nothing arrives.

2. **Test connection.** Cursor probes the destination and shows the result.

3. **Enable.** Export starts within about a minute. Later edits to headers or credentials take effect in about 30 seconds.

Headers are stored encrypted by Cursor. Only **one** team-managed destination is supported — you cannot fan out to OneUptime and another backend from Cursor itself. If you need that, put a collector in front.

### Protocol constraint

Cursor speaks **OTLP/HTTP with binary protobuf only** (`Content-Type: application/x-protobuf`, HTTP POST). **gRPC is not supported. OTLP/JSON is not supported.** OneUptime's OTLP endpoint accepts binary protobuf over HTTP, so no collector is needed in between — but if you were planning to point Cursor at a gRPC ingest of your own, it will not connect.

The instrumentation scope on everything Cursor sends is `cursor.telemetry` version `0.1.0`.

### Signal and family toggles

Cursor lets you toggle per signal and per **family**. All four families default to on:

| Family                 | Covers                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `model_usage`          | `cursor.token.usage`, `cursor.cost.usage`, and the `cursor.api.request` / `cursor.api.error` / `cursor.api.correction` log events |
| `tool_calls`           | `cursor.tool.calls`                                                                                                               |
| `skills_hooks_plugins` | `cursor.skill.activated`, `cursor.hook.execution_complete`, `cursor.plugin.installed`                                             |
| `cloud_agents`         | `cursor.cloud_agent.*` log events                                                                                                 |

There is also an admin toggle, `auto_enable_new_families`, controlling whether telemetry families Cursor adds later turn on automatically. Leave it on if you want new data without revisiting the screen; turn it off if you want to review each addition first.

## Step 3 — Allow Cursor's egress IPs (self-hosted only)

Cursor exports from a fixed set of source addresses. If your self-hosted OneUptime ingest sits behind a firewall or WAF, allow these six `/32` addresses inbound:

```text
3.218.161.44
3.231.18.206
35.174.159.35
184.73.225.134
3.209.66.12
52.44.113.131
```

On OneUptime Cloud (`https://oneuptime.com/otlp`) there is nothing to do here.

## Metrics Cursor sends

All three are monotonic **delta** sums. Metric datapoints carry **no** conversation, request or usage-event id — Cursor omits them for cardinality control — so per-session tool attribution and per-session cost are not available from metrics.

| Metric               | Unit                                       | Attributes                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cursor.token.usage` | `{token}`                                  | `cursor.token.type` (always; `input`, `output`, `cache_read`, `cache_creation`), `cursor.model.name` (optional), `cursor.api.status` (optional; `success`, `errored`, `aborted`), `cursor.api.billable` (optional bool)                                |
| `cursor.cost.usage`  | `USD` (double)                             | `cursor.model.name` (optional)                                                                                                                                                                                                                         |
| `cursor.tool.calls`  | `{call}` — value 1 per completed tool call | `cursor.tool.kind` (`builtin`, `mcp`), `cursor.tool.name` (builtin id such as `read` or `shell`, or your MCP tool name), `cursor.tool.status` (`success`, `failure`, `aborted`; MCP calls never report `aborted`), `cursor.mcp.server.name` (MCP only) |

`cursor.tool.calls` and `cursor.cost.usage` are metric-only — there is no log event carrying the same data.

Because these are ordinary OpenTelemetry metrics, you can chart them on **Dashboards** and alert on them with a [Metrics Monitor](/docs/monitor/metrics-monitor) — for example, tool failure rate grouped by `cursor.tool.name`, or daily token burn grouped by `cursor.model.name`.

## Log events Cursor sends

Severities are INFO (9), WARN (13) and ERROR (17).

| Event                                                  | Severity                             | Attributes                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cursor.api.request` (body `api_request`)              | INFO                                 | `cursor.api.request.input_tokens`, `cursor.api.request.output_tokens`, `cursor.api.request.cache_read_tokens`, `cursor.api.request.cache_creation_tokens` (all int, always present), `cursor.model.name`, `cursor.api.billable`                                                                                   |
| `cursor.api.error` (body `api_error`)                  | ERROR                                | `cursor.model.name`, `cursor.api.billable`. Carries **no raw error message**                                                                                                                                                                                                                                      |
| `cursor.api.correction` (body `api_correction_<kind>`) | WARN                                 | `cursor.api.correction.kind` (`not_billed_errored`, `not_billed_aborted_before_timeout`). Deliberately carries no `cursor.model.name`                                                                                                                                                                             |
| `cursor.skill.activated`                               | INFO                                 | `cursor.skill.name`, `cursor.skill.trigger` (`agent_read`, `manually_attached`, `skill_name_in_prompt`), `cursor.skill.source` (`unspecified`, `workspace`, `user`, `builtin`, `plugin`, `claude`), `cursor.plugin.name` (optional)                                                                               |
| `cursor.hook.execution_complete`                       | INFO; ERROR when failed or timed out | `cursor.hook.name`, `cursor.hook.type` (`pre_tool_use`, `post_tool_use`, `post_tool_use_failure`, `before_submit_prompt`, `after_agent_response`, `after_agent_thought`, `stop`, `subagent_start`, `subagent_stop`), `cursor.hook.outcome` (`success`, `blocked`, `failed`, `timeout`), `cursor.hook.duration_ms` |
| `cursor.plugin.installed`                              | INFO                                 | `cursor.plugin.name`, `cursor.plugin.scope` (`unspecified`, `public`, `private_marketplace`). No conversation id                                                                                                                                                                                                  |
| `cursor.cloud_agent.setup`                             | Not documented                       | `cursor.cloud_agent.setup.kind` (`started`, `completed`, `failed`), `cursor.cloud_agent.setup.duration_ms`, `cursor.cloud_agent.setup.reason` (failures only; open vocabulary, e.g. `install_command_failed`)                                                                                                     |
| `cursor.cloud_agent.artifact`                          | Not documented                       | `cursor.cloud_agent.artifact.file_name`, `cursor.cloud_agent.artifact.content_type`                                                                                                                                                                                                                               |
| `cursor.cloud_agent.pull_request`                      | Not documented                       | `cursor.cloud_agent.pull_request.kind` (`opened`, `creation_failed`), `cursor.cloud_agent.pull_request.number`, `cursor.cloud_agent.pull_request.draft`. Cursor notes `opened` may be sparse while the producer rolls out                                                                                         |
| `cursor.cloud_agent.mcp_auth_error`                    | ERROR                                | `cursor.mcp.server.name`                                                                                                                                                                                                                                                                                          |

`cursor.api.request` is the per-request grain, and the only place per-conversation token totals exist.

### Resource attributes

One resource per team / user / surface / entrypoint / surface-version grouping:

| Attribute           | Notes                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `service.name`      | Always the constant `cursor` — filter the Logs and Metrics explorers on this                                           |
| `service.version`   | Optional; client version for desktop and CLI, usually absent for cloud agents and Bugbot                               |
| `cursor.team.id`    | Int, always present                                                                                                    |
| `cursor.surface`    | Always present: `unspecified`, `desktop`, `cli`, `cloud_agent`, `bugbot`                                               |
| `cursor.entrypoint` | Always present: `unspecified`, `desktop`, `cli`, `web`, `mobile`, `sdk_ts`, `sdk_py`, `api`, `automation`, `github_pr` |
| `cursor.user.id`    | Int, **optional** — see [Employee attribution](#employee-attribution)                                                  |

### Join keys on log records

| Key                      | Meaning                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cursor.event.id`        | Always present. **Dedupe key only** — opaque, deterministic across retries and replay (prefixed `customer-telemetry:v1:`). Not a cross-event join key                |
| `cursor.source_event.id` | Always present. Opaque internal source identity; several signals may share one value                                                                                 |
| `cursor.conversation.id` | Optional. The session join key — a composer chat UUID in the IDE and CLI, a customer-visible `bc-...` id for cloud agents                                            |
| `cursor.usage_event.id`  | Optional; only on `cursor.api.request`, `cursor.api.error` and `cursor.api.correction`. Request-grain key that reconciles against Cursor's usage and billing exports |
| `cursor.request.id`      | Optional. Never present on `cursor.api.correction` or any `cursor.cloud_agent.*` event                                                                               |

Subagents get their own `cursor.conversation.id` with no parent rollup, so a subagent's activity does not group under the session that spawned it.

## Employee attribution

Be clear-eyed about the limitation here. **The only identity on Cursor's OpenTelemetry wire is `cursor.user.id` — an opaque, team-scoped integer that Cursor documents as optional.** There is no email, no name and no SSO subject. Cursor's own guidance is that it is often absent on cloud agents and that you should not require its presence.

What OneUptime does with what it gets:

- `cursor.user.id` is a recognized **employee** identity key, so per-user spend rollups in the **Usage** tab work — but they identify people as integers.
- `cursor.team.id` is a recognized **team** key, so team and cost-centre rollups work without any extra configuration.
- Both arrive as resource attributes, which reach OneUptime as `resource.cursor.user.id` and `resource.cursor.team.id`. Both spellings are recognized, which is what makes this work at all — a bare-key-only match would never see a single Cursor row.
- The **employee email** column stays empty for Cursor data. OneUptime reads it from `user.email` and equivalents, and Cursor sends none.

OneUptime deliberately does **not** treat `gen_ai.user`, `llm.user` or `litellm.metadata.user_api_key_end_user_id` as the employee. Those carry the caller's own downstream _customer_, and mapping them to an employee would produce wrong internal chargeback. This is a general rule across [AI / LLM observability](/docs/telemetry/ai-llm-observability), not Cursor-specific.

### Where Cursor shows up in the Usage tab

Cursor emits metrics and no spans, and that decides exactly what the Usage tab can show for it.

**GenAI spans are authoritative; the metric stream is a fallback, never an addition.** OneUptime consults metrics only for a figure the span stream reported nothing for, and never sums the two — an emitter producing both signals would otherwise be counted twice. The consequence for a mixed project is blunt: **if the same OneUptime project already has GenAI spans carrying cost, Cursor's spend will not appear.** Point Cursor's destination at its own project (its own ingestion key) if you want its numbers to stand alone.

When the fallback does engage:

| Breakdown             | Cursor                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Employee              | **Yes** — grouped on `cursor.user.id` (in its `resource.`-prefixed spelling), as integers        |
| Team / cost centre    | **Yes** — grouped on `cursor.team.id`                                                            |
| Model                 | **Yes** — `cursor.cost.usage` carries `cursor.model.name`                                        |
| Provider              | **No.** Cursor routes to several model providers behind one subscription and never reports which |
| Application / Service | **No.** A Cursor cost counter is not attached to a OneUptime telemetry service                   |

And one limit that catches people out: **a metric-sourced row carries cost only.** The Calls, Input tokens, Output tokens and Total tokens cells render as `—` for Cursor rows, because `cursor.cost.usage` has no per-call detail and a `0` there would read as "this developer made no calls". `cursor.token.usage` still feeds the Overview page's input/output token tiles, and it is still chartable on a dashboard grouped by `cursor.token.type` — the per-employee token _column_ in the Usage table is what is unavailable. Note also that only the `input` and `output` token types are counted in those totals; `cache_read` and `cache_creation` are real tokens but are neither, so they are left out rather than folded in.

### Resolving a user id to a person

Turning `cursor.user.id` into a name — and getting billing-grade per-user spend rather than an estimate — requires Cursor's **Admin API**. **OneUptime does not poll it today**, so this is something you run yourself if you need it.

The API lives at `https://api.cursor.com`, is Enterprise-only, and authenticates with HTTP Basic using your API key as the _username_ and an empty password:

```bash
curl -u YOUR_API_KEY: https://api.cursor.com/teams/members
```

Create the key at **cursor.com/dashboard → API Keys → New API Key**; it is shown once, looks like `crsr_...`, and needs the `admin:*` scope.

Two endpoints matter:

- **`GET /teams/members`** — the roster. Each member has `id`, `email`, `name`, `role` (`member` or `owner`) and `isRemoved`. Note that `id` here is an **encoded string** like `user_PDSPmvukpYgZEDXsoNirw3CFhy`, not an integer.
- **`POST /teams/filtered-usage-events`** — the money view. Every event carries `userEmail`, `model`, `chargedCents`, `tokenUsage` (`inputTokens`, `outputTokens`, `cacheWriteTokens`, `cacheReadTokens`, `totalCents`), `conversationId`, `isChargeable`, `isHeadless` and a millisecond `timestamp`. Sum `chargedCents` for spend — it is the field Cursor documents as reconciling to invoices. Body takes `startDate` and `endDate` as epoch milliseconds (both bounds inclusive), plus optional `userId` (number), `email`, `page` and `pageSize` (default 100, max 1000). Rate limit 60 requests/minute; the data is aggregated hourly, so poll at most once an hour.

The reliable join back to your OneUptime data is **`conversationId`**: it is the same id space as `cursor.conversation.id` on the OTel wire, which lets you attach an email and a real dollar figure to a session you already have log events for.

> **Not verified:** Cursor does not document whether the integer `cursor.user.id` on the OTel wire is the same namespace as the numeric `userId` filter on `/teams/filtered-usage-events`. It is plausible, and Cursor uses at least three distinct user-id namespaces (encoded `user_...` strings, numeric ids, and the OTel integer). Do not build chargeback on that assumption without confirming it against your own tenant, and fail soft to an "unattributed" bucket rather than billing the wrong person.

## Delivery semantics

These are not footnotes — they change what you see in charts, so know them before you file a bug against OneUptime.

- **Metrics are at-most-once.** A failed metric export is never retried or replayed. Brief gaps in the delta sums are expected after a failure. **Do not create incident-generating alerts on metric gaps for Cursor data.**
- **Logs are at-least-once**, deduplicated on `cursor.event.id`. Transient failures auto-recover for about 7 days. Terminal rejections (persistent 4xx, malformed payloads) are not replayed.
- **All metrics are delta temporality.** Consume them as sums of deltas. A strict delta-to-cumulative processor may drop end-time-inverted points, and flush windows for the same series can overlap.
- **There is no ordering guarantee.** `cursor.api.correction` arrives _after_ the request it amends. Order by record timestamp, never by arrival time.
- **OTLP partial success is honored.** Rejected items inside an accepted batch are not re-sent.
- **No backfill.** Nothing before you activated the destination will ever arrive, and Cursor's upstream source retention is about 7 days — so a destination left broken for a week loses that week permanently.
- **Disabling or deleting a destination drops in-flight data.** To rotate the OneUptime ingestion key, **edit** the existing destination's header rather than deleting and re-adding it. The edit takes effect in about 30 seconds.

### Reading corrections

A `cursor.api.correction` log event is a billing finalization: it means a usage event was retroactively **not** billed. Join it on `cursor.usage_event.id` to the matching `cursor.api.request` or `cursor.api.error` and treat the whole group as unbilled. Because corrections arrive late and out of order, any spend figure you compute from recent Cursor data is provisional until its correction window has passed.

## Cost is an estimate, not an invoice

`cursor.cost.usage` is documented by Cursor as an explicit **best-effort estimate**. Treat it as a trend line, not as a bill:

- One series covers both included-quota drawdown and on-demand usage — it does not separate them.
- For BYOK setups it reflects only the Cursor Token Rate, not what your model provider actually charges you.
- Corrections (above) can retroactively unbill usage the metric already counted.

For a figure you can reconcile against an invoice, sum `chargedCents` from `POST /teams/filtered-usage-events` on the Admin API. Everything OneUptime shows for Cursor spend comes from `cursor.cost.usage` and inherits its caveats.

## Verify it landed

After enabling the destination, use Cursor for a minute or two, then in OneUptime:

1. Open **Logs** and filter on service name `cursor`. You should see `cursor.api.request` records with token counts. This is the fastest confirmation that both auth and endpoint are right.
2. Open **Metrics** (or add a Dashboard chart) on `cursor.token.usage`, grouped by `cursor.token.type`. Remember it is a delta sum.
3. Open **AI / LLM → Usage**. Cursor's estimated cost should appear in the Employee, Team and Model breakdowns, attributed by `cursor.user.id`, `cursor.team.id` and `cursor.model.name`, with the table labelled **from GenAI metrics**. If it is empty, check whether this project also receives GenAI spans — see [Where Cursor shows up in the Usage tab](#where-cursor-shows-up-in-the-usage-tab).

Nothing arriving?

- Re-run **Test connection** in Cursor. It reports the transport-level result directly.
- Check the URL for a doubled path segment — the base URL must not end in `/v1`.
- Re-check the header: name `x-oneuptime-token`, value the ingestion key exactly. A wrong token is rejected at ingest.
- If you self-host, confirm the six [egress IPs](#step-3-allow-cursors-egress-ips-self-hosted-only) reach your ingest and that the endpoint is publicly resolvable.
- Confirm the relevant family toggle is on — `model_usage` for tokens and cost, `tool_calls` for tool metrics.
- Give it a minute. Export begins about a minute after enabling, and credential edits take about 30 seconds.

## Related

- [AI / LLM Observability with OneUptime](/docs/telemetry/ai-llm-observability) — how OneUptime models tokens, cost, employees and teams across every AI source.
- [Observing AI Gateways (LiteLLM & Portkey)](/docs/telemetry/ai-gateways) — if you also route application LLM traffic through a gateway, that path _does_ give you full traces and prompt content.
- [Metrics Monitor](/docs/monitor/metrics-monitor) — alerting on `cursor.token.usage`, `cursor.cost.usage` and `cursor.tool.calls`.

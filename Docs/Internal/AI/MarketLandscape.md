# AI Observability & SRE Agents — Market Landscape

> Internal doc. Research snapshot: June 2026. Companion to [Roadmap.md](./Roadmap.md) and [CurrentState.md](./CurrentState.md).
>
> Compiled from a multi-agent web research sweep (vendor docs, pricing pages, G2, HN/Reddit threads, independent benchmarks). Treat numbers as directionally correct; re-verify before quoting externally.

## The one-paragraph read

By mid-2026 every serious observability vendor ships a three-layer AI stack: a deterministic anomaly/RCA layer (Watchdog, Davis), a chat assistant, and a newly-GA agentic layer that investigates incidents — and in Datadog's and Sentry's case, writes code fixes. The market has validated OneUptime's exact thesis (telemetry → root cause → fix PR) but **nobody ships it open-source, self-hostable, or for the full incident loop**. Sentry Seer is cloud-only and explicitly denied to self-hosted users; Datadog Bits AI Dev Agent is closed and credit-metered; the AI-SRE startups (Resolve $1.5B, Traversal, Cleric) are sales-gated with six-week onboarding. Meanwhile trust in AI output is *falling* (Stack Overflow 2025: 84% use AI, only 29% trust it), so the products that win lead with evidence citation, staged autonomy, and transparent pricing — not chatbots and sparkle icons.

## Competitor snapshots

### Sentry Seer — the closest analog for our auto-fix story
- Three-phase Issue Fix (formerly Autofix): root cause (greps the actual codebase, multi-repo) → editable fix plan → diff/PR. Live-streamed, interruptible reasoning. Claims 94.5% RCA accuracy.
- **Fixability score** + eligibility gates (10+ events in 14 days) decide which issues get auto-analyzed in the background — answers are pre-computed and waiting when a human opens the issue.
- Configurable **stopping points**: root-cause-only / plan / drafted PR / hand off to Cursor Cloud Agent or Claude Code.
- AI Code Review: anti-style-nit, grounded in production error patterns; independent benchmark found 0% false positives at the "critical" tier (and ~1-in-7 wrong at "high").
- Pricing pivoted Jan 2026 to **$40/active contributor/month** — the #1 complaint ($800/mo for a 20-dev team). Cloud-only, GitHub-cloud-only. Self-hosted Sentry users are explicitly denied Seer (issue closed as not-planned) — a ready-made audience for us.
- Notably: none of Seer's launches got organic HN traction. Press push ≠ developer love.

### Datadog — Watchdog + Bits AI SRE + Bits AI Dev Agent
- Watchdog: zero-config anomaly/faulty-deploy detection since 2018 — the credibility floor for "proactive."
- Bits AI SRE (GA Dec 2025, tested in 2,000+ customer environments): auto-investigates alerts in 3–4 min, Hypothesis Tree + Agent Trace View (every query/tool call visible), posts conclusions to Slack before the on-call opens a laptop. Claims teams restore 90% faster.
- **Bits AI Dev Agent** — the closest shipped product to our vision: watches telemetry, picks high-impact issues, opens draft PRs with unit-tested fixes, **iterates against CI logs until checks pass, then flips to ready-for-review**. GA for error-tracking issues only.
- Pricing: AI credits ($500/500/mo annual; investigation ≈ 6.5 credits, code fix ≈ 5). Real bills of $500–5,000/mo reported; costs spike exactly during incident storms. Loudest complaint in the category.

### AI-SRE startups
- **Resolve.ai** ($190M raised, $1.5B valuation; Coinbase, DoorDash): on-call agents in triage rotations, RCA, rollbacks, guided code changes. 87% faster investigations claimed. Infamous complaint: auto-remediation cascaded into three downstream services and "nobody knows what it did or why." Six-week sales-gated onboarding.
- **Traversal** (Sequoia/Kleiner, Amex strategic): "Production World Model" + causal search; Amex 82% RCA accuracy, DigitalOcean 38% MTTR reduction. **Demo wow: replays the prospect's own historical incidents and root-causes them in under a minute.**
- **Cleric** (Gartner Cool Vendor): read-only by default, evidence-linked findings with confidence scores, "Operational Memory" — every resolution compounds. Verification: tests fixes against live environments. 5-min time-to-root-cause claimed.
- **incident.io AI SRE**: investigation auto-starts on alert; hypothesis report with citations in Slack in 1–2 min; "**Code it up**" button drafts a fix PR from the Slack thread. Design rule: every claim verifiable in under 30 seconds.
- **Better Stack**: Claude-Code-style AI SRE included in $29/responder plans, token-metered chat, MCP server — the pricing wedge play.
- Others: Rootly (visible reasoning chains, `/rootly catchup`, Apache-2.0 prototypes), PagerDuty SRE Agent (harsh reviews), Parity (K8s wedge; published SREBench), RunWhen, Beeps ($70/relay: page an AI agent in parallel with humans).

### Coding agents (the fix-execution layer we can orchestrate)
- **GitHub Copilot coding agent**: Agent tasks REST API (start task → poll states → get PR), ephemeral Actions sandboxes with egress firewall, draft-PRs-only, can't approve its own PRs. Best public data: dotnet/runtime, 878 PRs, **67.9% merged; bug fixes 69.4%; merge rate jumped 38%→69% after writing a thorough instructions file** — context files, not model upgrades, were the lever. 65.7% of added lines were tests. 0.6% revert rate.
- **OpenAI Codex**: containers with network-off-by-default during agent phase; `codex exec` + TypeScript SDK with structured output; cites terminal/test logs in PR descriptions ("verification receipts").
- **Claude Code / Agent SDK**: the "bring your own harness" option — headless `-p` mode, GitHub Action, TS/Python SDK with subagents/hooks/MCP/sessions; open-source `@anthropic-ai/sandbox-runtime` (bubblewrap/Seatbelt, proxy-gated egress).
- **Devin** (~78% on bug fixes with clear repro vs ~55% vague; $2.25/ACU≈15min), **Cursor cloud agents** (webhook Automations explicitly marketed for monitoring-tool triggers; $0.30–5/task), **Jules** (cheapest, worst sentiment: slow, bloated diffs).
- Cautionary data: a 2026 study of "AI slop" complaints found reviewer burden dominant — one team got 30 agent PRs/day for six reviewers; agents rewriting tests so broken code passes. **Volume governors and verification rigor are the trust currency.**

### Open-source peers
- **Grafana**: Assistant GA ($20/active user/mo, 40M tokens incl.); Investigations preview; **free for OSS/on-prem since Apr 2026** (LLM routed through Grafana Cloud; raw data stays local — community called it "huge"). Skills/playbooks with auto-approve graduating into auto-remediation pipelines. Reachable from Slack, CLI, API, hosted MCP.
- **SigNoz**: "agent-native observability" — Noz assistant beta + MCP server + SKILL.md files so Claude Code/Cursor debug production with telemetry *and* codebase in one context.
- **Coroot**: AI RCA with explicit privacy contract ("only minimal context is sent to the LLM, never raw telemetry"); published a reproducible RCA benchmark on the OpenTelemetry Demo with fault injection. RCA is enterprise-gated, which draws criticism.
- **PostHog**: killed its "Max" mascot chatbot (Clippy comparisons) and rebuilt AI as invisible platform capability. Published the definitive build playbook: single agent loop > subagent graphs, stream everything, weekly production-trace reviews > synthetic evals. Pricing: LLM cost + 20%, $20/mo free allowance, default $150 cap.
- **GlitchTip / OpenStatus / ClickStack**: MCP with "no data sharing required"; "diagnose first, write later" staged keys; "Open in Claude" escape-hatch buttons.

## Wow patterns that actually work (cross-cutting)

1. **Instant artifact on connect, zero config** — DeepWiki (swap URL, get architecture wiki), CodeRabbit (first PR reviewed minutes after install), Metaplane/Watchdog (auto-baselines, unprompted findings). The first session must produce a concrete, verifiable deliverable from *the user's own data*, before they ask.
2. **Investigation done before you open your laptop** — alert fires → cited hypothesis report in Slack in 1–2 min (incident.io, Bits AI, Grafana Investigations). This is the wow benchmark for SREs.
3. **Stack trace → root cause → draft PR**, with the answer pre-computed for high-fixability issues (Seer).
4. **PR drives itself to green** — draft PR iterates against CI until checks pass; ready-for-review is the quality signal (Bits Dev Agent). "Never ask a human to review a red PR."
5. **Live-streamed reasoning + click-to-verify evidence** — hypothesis trees, agent trace views, every claim linked to the log line/trace/commit behind it (Datadog, Cleric, Rootly, incident.io's 30-second-verification rule).
6. **Replay-the-customer's-own-incident demos** (Traversal) — the strongest enterprise-closing move in the category.
7. **Staged autonomy ladders** — stopping points (Seer), read-only-by-default (Cleric), plan-approval modes (Devin/Jules, +83% success-rate lift claimed), auto-approve graduating per alert class (Grafana).
8. **Verification receipts in the PR body** — tests run, terminal logs, telemetry evidence (Codex, Bits).
9. **Instructions/skills files in the customer repo** — bits.md, SKILL.md, copilot-instructions.md (the 38%→69% merge-rate lever).
10. **Agent-native surfaces** — MCP servers + Slack/Teams/CLI presence are table stakes; practitioners already prefer "Claude + Grafana MCP" over dashboards.
11. **Trust-aligned pricing** — inconclusive investigations free (Datadog), transparent cost-plus (Vercel $0.30+tokens, PostHog cost+20%), included-in-plan (Better Stack). Pricing *is* a trust feature.
12. **Public reproducible benchmarks** — Coroot's OTel-Demo fault-injection benchmark, Parity's SREBench, Grafana's o11y-bench. "Prove it" beats "trust us."

## Failure patterns to avoid

- **Mascot chatbots** (PostHog's Max → Clippy). Embed AI in the pages where work happens; chat is a secondary surface.
- **Sparkle-icon AI badging** — reads as slop-signal in 2026 ("slop" was the 2025 word of the year).
- **Confident-wrong output** — the Cursor support-bot incident (hallucinated policy → public cancellations); Dynatrace CoPilot's brutal G2 reviews ("constantly contradicted by the information it sources"). 45% of devs cite "almost right but not quite" as the #1 frustration.
- **PR spam / reviewer burnout** — 30 agent PRs/day documented failure mode. Gate by fixability + impact, cap open PRs.
- **Silent/black-box auto-remediation** — Resolve's cascading-fix horror story. "AI proposes, human approves" is the 2026 consensus.
- **Surprise billing** — costs spiking during incident storms (Datadog), mid-cycle lockouts (Sentry legacy), per-seat AI metering ($800/mo resentment).
- **Cloud-gating AI away from self-hosters** — Sentry's sorest community wound; Grafana Assistant cloud-only until forced. Our opening.
- **Generic-agent bypass** — "why not send everything straight to Claude?" If our AI is just a worse wrapper, users will MCP around us. The answer: own the deterministic evidence chain (telemetry ↔ deploys ↔ code) that generic agents can't reconstruct, and *also* serve those agents via MCP.

## The open lane for OneUptime

1. **"The open-source AI SRE that fixes your code, not just your dashboards."** No one can copy this claim: Seer (closed, cloud-only), Bits (closed, Datadog-only data), startups (sales-gated). We own monitors, alerts, on-call, incidents, status pages, *and* telemetry, *and* the repo connection — nobody owns the full detect → investigate → fix → verify → learn loop end to end.
2. **Self-serve for teams under 100 engineers** — 10-minute setup vs. six-week enterprise onboarding. This segment is explicitly unserved.
3. **Post-deploy verification** — Sentry and Datadog stop at CI. We own the telemetry, so we can verify in production that the exception stopped recurring and attach that proof to the PR. No competitor closes this loop.
4. **BYO-everything** — BYO LLM key (already built), BYO coding agent (orchestrate Claude Code/Copilot/Codex rather than compete), self-hosted including local models. Plus hosted credits (already built) for those who want zero setup.
5. **Pricing as a weapon** — transparent cost-plus on hosted credits, flat/included tiers, hard caps, "inconclusive investigations free." Attack $40/contributor and $25–30/investigation by name.
6. **Public benchmark on the OpenTelemetry Demo** with fault injection — fits the open-source brand, earns the HN credibility Sentry never got.

Window check: Grafana shipped free-for-OSS Assistant + auto-remediation pipelines in April 2026; SigNoz Noz is rolling out; Better Stack is bundling AI SRE at $29. The lane is open but closing — the differentiated claim we can still own in 2026 is the **verified code fix from telemetry, open source**.

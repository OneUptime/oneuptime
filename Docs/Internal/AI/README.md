# Internal Docs: AI Agent & Code Repository Overhaul

> This folder holds internal product/engineering docs (not customer-facing — customer docs live in `App/FeatureSet/Docs`). Created June 2026 for the AI features overhaul.

## The vision

OneUptime continuously improves customer software using the telemetry it collects — logs, traces, exceptions, metrics, profiles, monitors, incidents, and alerts. It automatically identifies issues in the customer's codebase and opens pull requests that fix bugs, improve reliability, and prevent future incidents. The AI must be **proactive** and must **wow developers and SREs from Day 1**.

## The one-line strategy

**The open-source AI SRE that owns the whole loop — it investigates before you wake up, fixes with evidence, and proves the fix worked in production.**

The loop: **detect → investigate → fix → verify → learn.** The step nobody else closes — post-merge verification in production telemetry ("0 occurrences since deploy, was 1,247/week", commented on the PR) — is ours because we *are* the observability system.

## Documents

| Doc | What it covers |
|---|---|
| [Roadmap.md](./Roadmap.md) | **The roadmap.** Thesis, key decisions, the dual-lane Day-1 wow (Incident Replay + First Fifteen Minutes), six product pillars, Phases 0–3 with verified codebase citations, autonomy ladder & trust model, differentiation, metrics, risks, and the spec backlog (design docs to write before each phase). |
| [CurrentState.md](./CurrentState.md) | Honest inventory of today's AI agent + code repository features: what exists (exception→OpenCode→GitHub PR pipeline, LLM billing, GitHub App, telemetry layer), what's broken, what's missing. Keep/fix/replace verdicts. |
| [MarketLandscape.md](./MarketLandscape.md) | Competitive research, June 2026: Sentry Seer, Datadog Bits AI, SRE-agent startups, coding agents, open-source peers. Wow patterns that work, failure patterns to avoid, and the open lane. |

## TL;DR of the roadmap

- **Phase 0 (weeks 0–6) — Wire what exists, make it safe.** Enforce the stored-but-ignored safety flags, draft-only PRs, PR-state sync via webhooks, sandboxed agent execution, deploy markers, incident↔telemetry linkage, auto-postmortems on resolve, one consolidated AI settings hub.
- **Phase 1 (weeks 6–16) — Investigation engine + the Day-1 wow.** Auto-investigation on every alert/incident (cited hypothesis in Slack in ~2 min), Incident Replay onboarding ("here's what I would have told you at 3:12 AM"), First Look unprompted findings, Fix Engine v1.5 (evidence briefs, Claude Agent SDK backend, failing-test reproduction, receipts), live Run view, internal benchmark.
- **Phase 2 (months 4–8) — Close the loop, then launch.** CI-watch-until-green, **post-merge production verification** (the differentiator), fixability-gated auto-triggering, incident→fix pipeline, GitLab, MCP v2 + handoff to Claude Code/Copilot/Cursor, project memory — then the "Show HN" launch with a published reproducible benchmark.
- **Phase 3 (months 8–14) — Compound.** Prevention PRs for recurring incident classes, AI as a schedulable on-call responder, approval-gated runbook remediation, status-comms agent, weekly reliability report, earned autonomy graduation.

## Non-negotiables (trust)

- No auto-merge, ever, at any autonomy level. Draft PRs; never ask a human to review a red PR.
- Every AI claim cites evidence verifiable in under 30 seconds.
- No fabricated confidence percentages; honest "inconclusive" states.
- BYO-LLM-key in OSS forever (written covenant); per-run data-egress manifest; hard spend caps; no mid-cycle lockouts.
- No mascot chatbot, no sparkle-icon branding — capabilities, not characters.

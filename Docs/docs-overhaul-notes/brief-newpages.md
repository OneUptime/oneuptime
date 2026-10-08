You are a senior technical writer adding MISSING pages to the OneUptime documentation, as part of a complete documentation overhaul. The maintainers' complaint about the old docs: "a wall of text" — no steps, no graphics, hard to understand and use. Your new pages must be the opposite: accurate, scannable, visual, task-oriented and developer-friendly.

Repository (a git worktree): /Users/nawazdhandala/Projects/OneUptime/oneuptime/.claude/worktrees/quirky-jackson-a83917 — all paths below are relative to it. Test dependencies are installed in packages/App/node_modules.

## Your pages

{{PAGES}}

Each page is already listed in the sidebar (`packages/App/FeatureSet/Docs/Utils/Nav.ts`) with the title shown above; create the file at `packages/App/FeatureSet/Docs/Content/en/<category>/<page>.md`. Line 1 must be `# <the nav title>`.

## Read first

1. `packages/App/FeatureSet/Docs/README.md` — the authoring guide: page template, components (`:::steps`, `:::tabs` + `@tab`, `:::cards`, `:::details`, `> [!NOTE]`-style callouts, Mermaid diagrams with `title="..."`, code titles), style and checks. Follow it exactly.
2. The research notes for your pages in `/private/tmp/claude-501/-Users-nawazdhandala-Projects-OneUptime-oneuptime--claude-worktrees-quirky-jackson-a83917/861e4e3b-8701-4680-aca1-e7a8d8e9e4fe/scratchpad/gap-audit.md` (the sections named in your task). They list what the feature is, where it lives in the dashboard, its exact UI labels, defaults, states and limits, with the source file for each fact.
3. The source files those notes cite. Verify every fact before you write it, and read further in the code for anything the notes do not cover. The notes are a starting point, not a substitute for reading the code.
4. Two or three existing pages in the same area, to match tone and link to them (e.g. `Content/en/incidents/index.md`, `Content/en/incidents/states-and-severities.md`, `Content/en/on-call/escalation-rules.md`). Other writers are rewriting existing pages right now, so they may change while you read them; link to them by URL only.

## What a page must have

- A short lead: what this is, what it is for, who it is for.
- A Mermaid diagram wherever it helps (a lifecycle, a flow, how parts relate) — every overview page needs at least one meaningful diagram. Captions via ```mermaid title="...". The article column is narrow (~46rem): use `flowchart TB` for anything longer than a chain of 4–5 nodes (side-by-side parts in a `subgraph` with `direction LR`); keep labels short; quote labels with punctuation (`A["Probe (US East)"]`); simple ASCII node ids.
- "Before you begin" when there are prerequisites (role/permission, plan on OneUptime Cloud, a feature flag, an agent).
- Procedures as `:::steps` — one action per step, the step heading names the action, exact UI labels in **bold** (`**Alerts → Rules → Reminder Rules**`), and what the reader sees afterwards.
- Reference material (fields, defaults, states, limits, columns) in tables.
- `> [!NOTE]` / `> [!TIP]` / `> [!IMPORTANT]` / `> [!WARNING]` / `> [!CAUTION]` for what readers must not miss (e.g. a default that surprises people, something irreversible).
- Troubleshooting / FAQ as `:::details` blocks.
- `## Next steps` with a `:::cards` block of 2–4 related pages.
- Short paragraphs; second person; present tense; active voice.
- Use the product's exact words for every screen, menu, tab, field and button (English UI strings: `packages/App/FeatureSet/Dashboard/src/Locales/en.json` and the component sources). Products open from the **Products** menu in the top bar — never say "left navigation". Collapsed side-menu sections must be expanded first; say so.
- Plans: say "on OneUptime Cloud this requires the X plan" where the code gates it; do not rank plans against each other.
- Never invent features, settings, defaults, limits or labels. If something cannot be verified in the code, leave it out.

## Rules that keep the docs valid

- Code blocks always declare their language (`bash`, `yaml`, `json`, `text`, `http`, …).
- Exactly one H1 (line 1); no skipped heading levels (the first heading after the title is `##`); no two headings with the same text on a page; no headings inside `:::tabs`.
- Link to docs pages as `/docs/<category>/<page>` or `/docs/<category>/<page>#anchor` — never `./x.md`, a language prefix or `https://oneuptime.com/docs/...`. Only link to anchors that exist (anchors are made from heading text by `packages/Common/Server/Types/MarkdownSlugify.ts`: lower case, punctuation removed, spaces → `-`).
- Link to pages that exist, plus the other new pages listed in your task. Pages being written by other writers right now (do NOT create them): introduction/quickstart, introduction/core-concepts, introduction/home, introduction/your-account, monitor/criteria-and-statuses, monitor/monitor-groups, incidents/postmortems, on-call/index, on-call/policies, on-call/user-overrides, on-call/readiness, alerts/index, alerts/states-and-severities, alerts/episodes, alerts/settings, notifications/index, notifications/notification-methods, notifications/on-call-rules, notifications/notification-settings, scheduled-maintenance/index, scheduled-maintenance/creating-events, scheduled-maintenance/states, scheduled-maintenance/templates, scheduled-maintenance/settings, telemetry/ingestion-keys, telemetry/data-retention, telemetry/services, telemetry/logs-explorer, telemetry/traces-explorer, telemetry/metrics-explorer, telemetry/exceptions, telemetry/topology, telemetry/drop-filters-and-scrub-rules, permissions/inviting-people, configuration/project-settings, configuration/billing, configuration/audit-logs. You may link to these by URL without anchors.

## Constraints

- Create/edit ONLY your pages. Do not edit existing pages, translations, Nav.ts, locale files, tests or code — other agents are working on those at the same time.
- Do not run git commands that change state.
- Do not run the whole test suite.

## Checks — run them and fix until green for YOUR pages

From `packages/App`:
1. `NODE_OPTIONS=--max-old-space-size=8192 npx jest Tests/FeatureSet/Docs/DocsContentIntegrity Tests/FeatureSet/Docs/DocsDiagrams --forceExit 2>&1 | grep -E "<category>/<page>"` — these check ALL pages; only lines that name your pages matter (other pages are still being written).
2. From the repository root: `npm run docs:check-anchors 2>&1 | grep "en/<category>"` — fix anything in your pages.

## Report

Finish with: per page, a two-line summary and the diagrams it has; every fact you could NOT verify (left out); and any check that is not green, with the reason.

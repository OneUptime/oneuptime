You are rewriting part of the OneUptime documentation as part of a complete documentation overhaul. The maintainers' complaint: the docs "read like a wall of text" — no steps, no graphics, hard to understand and use. Your job is to make your pages excellent: accurate, scannable, visual, task-oriented and developer-friendly.

Repository (a git worktree): /Users/nawazdhandala/Projects/OneUptime/oneuptime/.claude/worktrees/quirky-jackson-a83917 — all paths below are relative to it. Dependencies for tests are installed in packages/App/node_modules.

## Your pages

{{PAGES}}

## Read first

1. `packages/App/FeatureSet/Docs/README.md` — the docs authoring guide: the page template, the components (`:::steps`, `:::tabs` with `@tab`, `:::cards`, `:::details`, `> [!NOTE]` callouts, Mermaid diagrams with `title="..."`, code titles), style rules and checks. Follow it exactly. Look at `packages/Common/Server/Types/MarkdownDocsExtensions.ts` if you need to know precisely how a component parses.
2. Each of your pages, in full.
3. For each page, every test that reads it. Find them with, e.g.: `grep -rln -e "<category>/<page>" -e "<page>.md" packages/App/Tests/FeatureSet/Docs packages/Common/Tests Scripts` (also try the page's URL `/docs/<category>/<page>`). Read those tests carefully. They pin headings, section order, exact sentences, tables and facts — many are checked against the product's own source code. Your rewrite must keep every one of them passing. NEVER edit a test file. If a pinned sentence reads awkwardly, keep it verbatim anyway (you can restructure around it).

## What to do on each page

1. **Audit for accuracy.** Check every factual claim against the product code: the dashboard (`packages/App/FeatureSet/Dashboard/src`), the models (`packages/Common/Models`), server code (`packages/Common/Server`, `packages/App/FeatureSet/*`), agents and charts (`HelmChart`, `docker-compose*.yml`, `config.example.env`, `packages/Probe`, `packages/CLI`, etc.). Fix what is wrong or outdated. Never invent features, settings, defaults, limits, menu paths or UI labels: use the exact labels the product shows (English UI strings are in `packages/App/FeatureSet/Dashboard/src/Locales/en.json`). If you cannot verify a claim, keep it only if it is clearly correct; otherwise remove it. Fix typos and grammar.
2. **Restructure to the page template** (README.md, "What a page looks like"):
   - A short lead: what this is, what it is for, who it is for (1–3 sentences). For longer pages, follow it with a `:::cards` block or a short list pointing to the main sections.
   - **Diagrams.** Add a Mermaid diagram wherever it helps the reader understand: how data flows (agent → collector → OneUptime), a lifecycle (states of an incident, a monitor, an alert), an architecture, a decision (which criteria matches), a sequence between systems (OAuth, webhooks, SSO, SCIM). Overview and concept pages, and any page describing a flow, should have at least one meaningful diagram. Do not add decorative diagrams. Give each a caption with ```mermaid title="...". The article column is narrow (~46rem): use `flowchart TB` for anything longer than a chain of 4–5 nodes (group side-by-side parts in a `subgraph` with `direction LR`); a wide `flowchart LR` scrolls sideways. Keep labels short (2–5 words). Quote node labels that contain punctuation: `A["Probe (US East)"]`; keep node ids simple ASCII; avoid characters Mermaid treats specially in unquoted labels (`()[]{}<>:;|#&` and quotes).
   - "Before you begin" / prerequisites when there are any (roles, plans, agents, API keys).
   - **Procedures as `:::steps`**: one action per step, the step's heading says the action ("### Create an API key"), exact UI labels in **bold** (e.g. **Monitors → Create Monitor**), and say what the reader should see afterwards.
   - **Alternatives as `:::tabs`** (install methods, languages, operating systems, cloud providers) with consistent labels (`Docker Compose`, `Kubernetes`, `Helm`, `Node.js`, `Python`, `Go`, `Java`, `.NET`, `Linux`, `macOS`, `Windows`, ...). No headings inside tabs.
   - **Reference material in tables**: fields, options, defaults, limits, environment variables, permissions, API parameters.
   - **Callouts** with `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]` (one marker line, then the body lines, each prefixed with `>`). Convert old `> **Note:** ...`/`> **Warning:**` callouts to this syntax.
   - **Troubleshooting and FAQ entries as `:::details`** blocks, one per question.
   - End with `## Next steps` containing a `:::cards` block of 2–4 related pages (`- [Title](/docs/<category>/<page>): one-line reason to go there.`).
   - Short paragraphs (2–4 sentences). Break up walls of text with headings, lists, tables, steps and diagrams. Second person, present tense, active voice.
3. **Code.** Every fenced code block declares its language (`bash`, `shell`, `yaml`, `json`, `typescript`, `javascript`, `python`, `go`, `java`, `csharp`, `hcl`, `sql`, `text`, `http`, `ini`, `dockerfile`, ...); use `text` for output or plain samples. Add `title="file-name"` when a block is a file. Check commands and config against the product and fix wrong ones.
4. **Keep stable:**
   - Line 1 is the page title `# Title` — keep its meaning; it should match the page's nav title in `packages/App/FeatureSet/Docs/Utils/Nav.ts` (fix it if it is clearly a different thing, e.g. it is not an H1).
   - **Headings other pages link to.** Run `grep -rn "<category>/<page>#" packages/App/FeatureSet/Docs/Content/en` and keep the text of every heading those links name (anchors are made from heading text by `packages/Common/Server/Types/MarkdownSlugify.ts`). Also keep in-page `](#anchor)` links pointing at existing headings.
   - URLs. Link to docs pages as `/docs/<category>/<page>` or `/docs/<category>/<page>#anchor` — never `./file.md`, never a language prefix, never `https://oneuptime.com/docs/...`.
   - `{{PLACEHOLDER}}` tokens (e.g. `{{IP_WHITELIST}}`, the permission table tokens) — keep them exactly; they are filled in at render time.
   - Images (`/docs/static/images/...`) — keep them; you may move them.
5. **Headings:** exactly one H1 (line 1). No skipped levels (`##` then `###`, never `##` then `####`; the first heading after the title is `##`). No two headings on a page with the same text (their anchors would collide — make them specific, e.g. "Okta: prerequisites"). Steps headings inside `:::steps` are normal headings at the next level.

## Constraints

- Edit ONLY your pages listed above. Do not edit other pages, translations (`Content/<other language>/...`), `Nav.ts`, locale JSON files, tests, or any code. If a change to your page would break a link from another page, keep the heading instead. Other agents are editing other pages at the same time.
- Do not run any git command that changes state (no commit, checkout, stash, reset).
- Do not run the whole test suite; run only the checks below.

## Checks — run them all, fix until green for YOUR pages

From `packages/App`:

1. Every test file that reads your pages: `NODE_OPTIONS=--max-old-space-size=8192 npx jest <test files> --forceExit`
2. `NODE_OPTIONS=--max-old-space-size=8192 npx jest Tests/FeatureSet/Docs/DocsContentIntegrity Tests/FeatureSet/Docs/DocsDiagrams --forceExit` — these check ALL pages in ALL languages. Many failures belong to other pages that are not rewritten yet, or to translations; only failures that name YOUR English pages (the "en pages" and "English pages" groups, and diagram failures in `en/<your page>`) must be fixed. Use `2>&1 | grep -E "<category>/<page>"` to find yours.
3. From the repository root: `npm run docs:check-anchors 2>&1 | grep "^  en/"` — fix any line for your pages.

Some page tests also check the TRANSLATED copies of your pages (other languages). Those translations are regenerated from your English in the next phase, so if such a test fails only because a translation no longer matches your new English structure, note it in your report instead of touching the translation. Every assertion about the English page must pass.

## Report

Finish with a concise report:
- per page: what you changed (1–2 lines), diagrams added (what they show), and every factual correction with the evidence (file path and what it says);
- anything you could not verify;
- every test that is not green, with the reason (for example "translation-only: <test name>").

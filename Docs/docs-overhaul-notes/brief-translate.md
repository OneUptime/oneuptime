You are a professional technical translator working on the OneUptime documentation overhaul. The English pages listed in your task were just rewritten; your job is to produce complete, natural, accurate translations of them in your languages, replacing whatever translation exists today (most existing translations are stale or missing).

Repository (a git worktree): /Users/nawazdhandala/Projects/OneUptime/oneuptime/.claude/worktrees/quirky-jackson-a83917 — all paths below are relative to it. Test dependencies are installed in packages/App/node_modules.

Source pages: `packages/App/FeatureSet/Docs/Content/en/<category>/<page>.md`
Your output: `packages/App/FeatureSet/Docs/Content/<lang>/<category>/<page>.md` for each of your languages (create the folder if needed; overwrite an existing file completely).

## Read first

1. `packages/App/FeatureSet/Docs/README.md` — especially "Translating" and the component syntax.
2. The English page, in full.
3. The existing translation of the page in your language, if there is one: reuse its established terminology where it is good, but translate from the NEW English — do not keep stale content.
4. Every test that reads the page in other languages: `grep -rln -e "<category>/<page>" -e "<page>.md" packages/App/Tests/FeatureSet/Docs`. Many tests check every language's copy, for example that it names dashboard screens and buttons exactly as that language's dashboard shows them. Read what they expect of translated copies and satisfy it. Never edit a test.

## Rules

**Translate**: prose, headings, table text, list items, image alt text, link text, callout bodies, `:::details` summaries and `:::warning <Title>` titles, `@tab` labels that are ordinary words ("Manually" → "Manuell"; keep product/technology names like `Docker Compose`, `Kubernetes`, `Helm`, `Python`, `Node.js`, `Linux`, `macOS`, `Windows`), card titles and descriptions, and the labels inside Mermaid diagrams. Write the way a native technical writer would — natural, concise, idiomatic, consistent terminology across pages; not word-for-word.

**Keep exactly as written**: the structure; fenced code blocks (you may translate comments inside code, nothing else); inline code; commands, file names, paths, URLs, environment variables, API fields, CLI flags, JSON/YAML keys; `{{PLACEHOLDER}}` tokens and `{{variable}}` syntax; component syntax (`:::steps`, `:::tabs`, `@tab`, `:::cards`, `:::details`, `:::note` … and the closing `:::` lines); callout markers (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`); Mermaid keywords, node ids, arrows and the ```mermaid title="..."``` info string's structure (translate the title text); brand and product names (OneUptime, Slack, Microsoft Teams, Kubernetes, OpenTelemetry, …); image paths.

**Structure must match the English page exactly** — the tests compare them:
- the same headings, at the same levels, in the same order (translate their text);
- the same code blocks with the same languages, in the same order;
- the same components in the same order, the same number of tabs in each tab set and the same number of steps (headings) in each `:::steps`;
- the same callouts in the same order;
- the same `{{PLACEHOLDER}}` tokens, the same images, and links to the same docs pages.
Line 1 is the translated title: `# <title>`.

**UI labels**: when the English names a dashboard screen, menu, tab, field or button (usually in **bold**), use the exact text that language's dashboard shows. Find it: search `packages/App/FeatureSet/Dashboard/src/Locales/en.json` for the English label to get its key, then read that key in `packages/App/FeatureSet/Dashboard/src/Locales/<lang>.json` (these files are large — use grep, e.g. `grep -n '"Create Monitor"' .../en.json`, then grep the key in the other file). If the dashboard has no translation for it (the value is English or missing), keep the English label. Use the docs sidebar titles in `packages/App/FeatureSet/Docs/Locales/<lang>.json` (navLinks/navGroups) when the text names another docs page or section.

**Links**: keep every link target as in English (`/docs/<category>/<page>` and `#anchor`s). Do not translate anchors yourself — after writing the page, run the anchor localizer (below), which rewrites English anchors to the translated headings.

**Mermaid**: put translated labels in double quotes (`A["Überprüfung fehlgeschlagen"]`, `-->|"bei Übereinstimmung"|`), never use double quotes inside a label, and keep the diagram the same shape. Every diagram must still parse.

**Persian (fa)** is right to left: write natural Persian; keep code, commands and Latin product names as they are.

**Chinese**: zh-CN is Simplified (mainland terminology), zh-TW is Traditional (Taiwan terminology). **Japanese/Korean**: use the terminology the dashboard locale uses.

## Checks — run them all and fix until green

From the repository root, after writing each page or at the end:

1. Localize anchors for your files only:
   `npm run docs:localize-anchors -- --apply --lang <lang> --page <category/page>` (repeat `--lang`/`--page` as needed). If it reports an anchor it cannot match, your headings do not line up with the English page — fix the page. (An unmatched link INTO another page that has not been re-translated yet is expected; ignore those.)

From `packages/App`:

2. Structure and completeness: `NODE_OPTIONS=--max-old-space-size=8192 npx jest Tests/FeatureSet/Docs/DocsTranslations --forceExit 2>&1 | grep -E "<category>/<page>"` — no "drifted" line may name your pages in your languages.
3. Page rules and links: `NODE_OPTIONS=--max-old-space-size=8192 npx jest Tests/FeatureSet/Docs/DocsContentIntegrity --forceExit 2>&1 | grep -E "<category>/<page>"` — fix every failure that names your pages in your languages (failures in the "<lang> pages" groups). A broken anchor into a page that has not been re-translated yet is expected; ignore it.
4. Diagrams: `NODE_OPTIONS=--max-old-space-size=8192 npx jest Tests/FeatureSet/Docs/DocsDiagrams --forceExit 2>&1 | grep -E "<lang>/<category>/<page>"` — every diagram in your pages must parse.
5. Every test file that reads your pages (found in "Read first" step 4): `NODE_OPTIONS=--max-old-space-size=8192 npx jest <test files> --forceExit` — every assertion about your languages must pass.

## Constraints

- Write ONLY your pages in your languages. Do not edit English pages, other languages, tests, locale JSON files or code. Other translators are working on other languages and pages at the same time.
- Do not run git commands that change state (no commit, checkout, stash, reset).
- Do not run the whole test suite.

## Report

Finish with: the pages written per language, any terminology decisions worth reviewing, and any check that is not green with the reason.

# Diagrams fixture

An offline harness for mermaid diagrams, drawn the three ways OneUptime draws
them, in a real browser:

| Page         | What it draws                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/dashboard` | The production `MarkdownViewer` (`Common/UI/Components/Markdown.tsx`), bundled with the frontends' esbuild config, so with mermaid built from its source (`Common/UI/esbuild-mermaid.js`). |
| `/docs`      | The docs' real `<head>` (`App/FeatureSet/Docs/Views/Partials/Head.ejs`, rendered with ejs) above diagrams written the way the docs' Markdown renderer writes them.                         |
| `/blog`      | A post body with no h2 heading under the blog's real scripts, taken out of `Home/Views/Blog/Post.ejs`: the highlight.js loader, the page script and the diagrams module.                   |

`?diagrams=` picks the diagrams: a flowchart with a `$$...$$` label and a
sequence diagram by default, `none` for none; the Dashboard page also takes
`plain` (no KaTeX needed) and `broken` (one that does not parse), and
`?theme=dark`.

`Fixture/server.js` runs `Common/Scripts/build-mermaid-browser.js` the way the
App and Home images do, and serves what it writes at `/oneuptime-assets/mermaid/`,
the vendored files under the rest of `/oneuptime-assets/`, and the docs' static
files under `/docs/static/`, on `127.0.0.1:4271` (`DIAGRAMS_FIXTURE_PORT`). No
Docker, no database, no API.

## Running it

```bash
cd packages/E2E
npm run test-diagrams-ui
```

It runs in Chromium and Firefox. jsdom lays nothing out and mermaid measures
every label with the browser's layout, so this is where a drawn diagram is
checked: each surface draws every diagram, the docs and the blog set a
`$$...$$` label with KaTeX's MathML, KaTeX is fetched once, as its own chunk,
only for a page that needs it, and holds the version npm installed for Common,
none of mermaid's prebuilt bundles is ever requested, and the dark themes
apply. What the build may contain is pinned in
`packages/Common/Tests/UI/MermaidFromSource.test.ts`, and what the server
answers in `packages/Common/Tests/Server/Utils/VendorAssets*.test.ts`.

CI's Dashboard Offline UI job lists the suites it runs in
`.github/workflows/test.app.yaml`; `test-diagrams-ui` is in group 3.

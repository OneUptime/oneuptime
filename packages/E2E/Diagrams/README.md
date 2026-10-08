# Diagrams fixture

An offline harness for mermaid diagrams, drawn the three ways OneUptime draws
them, in a real browser:

| Page         | What it draws                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/dashboard` | The production `MarkdownViewer` (`Common/UI/Components/Markdown.tsx`), bundled with the frontends' esbuild config, so with mermaid built from its source (`Common/UI/esbuild-mermaid.js`). |
| `/docs`      | The docs' real `<head>` (`App/FeatureSet/Docs/Views/Partials/Head.ejs`, rendered with ejs) above diagrams written the way the docs' Markdown renderer writes them.                         |
| `/blog`      | A post body with no h2 heading under the blog's real scripts and stylesheet, taken out of `Home/Views/Blog/Post.ejs`: the highlight.js loader, the page script and the diagrams module.    |

`?diagrams=` picks the diagrams: a flowchart with a `$$...$$` label and a
sequence diagram by default, `none` for none, and `broken` for one that does
not parse (on the docs and the blog, ahead of the other two); the docs and the
blog also take `interactive` (a click that calls a page function, a
`javascript:` link and HTML labels), and the Dashboard page `plain` (no KaTeX
needed), `mixed` (the broken one, then the other two) and `?theme=dark`. The
docs page takes `?lang=fa` (Persian, right to left), and the blog post
`?html=broken`, a diagram that does not parse written as HTML rather than as a
fenced block.

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
checked: each surface draws every diagram and sets a `$$...$$` label with
KaTeX's MathML (the Dashboard keeps only KaTeX's MathML and no HTML), KaTeX is
fetched once, as its own chunk, only for a page that needs it, and holds the
version npm installed for Common, none of mermaid's prebuilt bundles is ever
requested, and the dark themes apply and redraw.

A diagram that cannot be drawn fails softly: the others are drawn, and mermaid
leaves nothing anywhere else on the page (it used to leave its "Syntax error"
graphic at the end of the body). The Dashboard says so in the diagram's
place; the docs show its source, as written, under a short note in the page's
language; the blog puts the diagram's code block back - its label and copy
button included - under the same note. Both do that for every diagram when
the mermaid build cannot be loaded, with one console error and no unhandled
rejection. The blog draws in mermaid's strict mode (no click callback runs, no
`javascript:` link survives, HTML labels stay), and its page script runs past
the missing table of contents of a post with no h2 heading.

What the build may contain is pinned in
`packages/Common/Tests/UI/MermaidFromSource.test.ts`, what the server answers
in `packages/Common/Tests/Server/Utils/VendorAssets*.test.ts`, the Dashboard's
sanitizer in `packages/Common/Tests/UI/Components/DiagramSanitizer.test.ts`,
the docs' diagram script in `packages/Common/Tests/App/Docs/DocsDiagramScript.test.ts`,
and the blog page script and diagram module in
`packages/Home/Tests/BlogPostPage.test.ts` - those two in jsdom, against a
stand-in for mermaid.

CI's Dashboard Offline UI job lists the suites it runs in
`.github/workflows/test.app.yaml`; `test-diagrams-ui` is in group 3.

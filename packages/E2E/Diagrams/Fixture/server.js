/*
 * Diagrams in a real browser, drawn the three ways OneUptime draws them, with
 * no backend:
 *
 *   /dashboard  the production MarkdownViewer (Common/UI), bundled with the
 *               frontends' own esbuild config - and so with mermaid built
 *               from its ES module source (Common/UI/esbuild-mermaid.js).
 *   /docs       the docs' real <head> (App/FeatureSet/Docs/Views/Partials/
 *               Head.ejs, rendered with ejs) above diagrams written the way
 *               the docs' Markdown renderer writes them.
 *   /blog       a post body under the blog's real scripts, taken out of
 *               Home/Views/Blog/Post.ejs.
 *
 * /oneuptime-assets/mermaid/ serves what Common/Scripts/
 * build-mermaid-browser.js writes - run here exactly as the App and Home
 * images run it - and the rest of /oneuptime-assets the vendored files.
 */
const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

// The frontends' production build: minified, no sourcemap.
process.env.NODE_ENV = "production";

const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const ejs = require("../../../Common/node_modules/ejs");

const repository = path.resolve(__dirname, "../../../..");
const output = path.join(repository, "output/playwright/diagrams-ui/fixture");
const mermaidDirectory = path.join(
  repository,
  "output/playwright/diagrams-ui/mermaid-browser",
);
const mermaidBuildScript = path.join(
  repository,
  "packages/Common/Scripts/build-mermaid-browser.js",
);
const port = Number(process.env["DIAGRAMS_FIXTURE_PORT"] || 4271);

const vendorDirectory = path.join(
  repository,
  "packages/Common/Server/Static/Vendor",
);
const docsStaticDirectory = path.join(
  repository,
  "packages/App/FeatureSet/Docs/Static",
);
const docsHead = path.join(
  repository,
  "packages/App/FeatureSet/Docs/Views/Partials/Head.ejs",
);
const blogPost = path.join(repository, "packages/Home/Views/Blog/Post.ejs");

const config = createConfig({
  serviceName: "diagrams-fixture",
  publicPath: "/dist/",
  entryPoint: path.join(__dirname, "Fixture.js"),
  outdir: output,
  additionalAlias: {
    Common: path.join(repository, "packages/Common"),
    react: path.join(repository, "packages/Common/node_modules/react"),
    "react-dom": path.join(
      repository,
      "packages/Common/node_modules/react-dom",
    ),
  },
});
config.loader[".js"] = "jsx";
config.logLevel = "warning";

const FLOWCHART = 'graph LR\n  A["$$x^2 + y^2 = z^2$$"] --> B[Plain label]';
const SEQUENCE =
  "sequenceDiagram\n  Alice->>Bob: Hello Bob\n  Bob-->>Alice: Hello Alice";

// The same five characters the docs' and the blog's renderers escape.
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function diagramsFor(url) {
  return url.searchParams.get("diagrams") === "none"
    ? []
    : [FLOWCHART, SEQUENCE];
}

/*
 * What Common/Server/Types/Markdown.ts writes for a ```mermaid fence on a
 * docs page.
 */
function docsPage(url) {
  const head = ejs.render(
    fs.readFileSync(docsHead, "utf8"),
    {
      t: (key) => {
        return key;
      },
      lang: "en",
      enableGoogleTagManager: false,
    },
    { filename: docsHead },
  );
  const diagrams = diagramsFor(url)
    .map((code) => {
      return `<div class="docs-diagram"><div class="mermaid">${escapeHtml(code)}</div></div>`;
    })
    .join("\n");

  return `<!doctype html><html lang="en" class="h-full antialiased"><head>${head}</head><body class="docs-body min-h-full"><article class="docs-article"><div class="docs-content"><h1>Diagrams</h1><p>Text before the diagrams.</p>${diagrams}<p>Text after them.</p></div></article></body></html>`;
}

/*
 * The blog's scripts, taken out of Post.ejs rather than copied, so a change
 * there is what this tests: the highlight.js loader in its head (it strips
 * the language-mermaid class at DOMContentLoaded), the page script (copy
 * buttons, table of contents...) and the diagrams module.
 */
function blogScripts() {
  const source = fs.readFileSync(blogPost, "utf8");
  const scripts = source.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) || [];

  const pick = (label, predicate) => {
    const found = scripts.filter(predicate);

    if (found.length !== 1) {
      throw new Error(
        `Post.ejs has ${found.length} ${label} script blocks, expected one`,
      );
    }

    if (found[0].includes("<%")) {
      throw new Error(`Post.ejs's ${label} script block now holds EJS tags`);
    }

    return found[0];
  };

  return {
    highlightCore: pick("highlight.js", (script) => {
      return script.includes(
        'src="/oneuptime-assets/highlight/highlight.min.js"',
      );
    }),
    highlightLoader: pick("highlight.js loader", (script) => {
      return script.includes("langMap");
    }),
    page: pick("page", (script) => {
      return script.includes("Language name mapping for display");
    }),
    diagrams: pick("diagrams", (script) => {
      return (
        script.includes('type="module"') &&
        script.includes("/oneuptime-assets/mermaid/")
      );
    }),
  };
}

/*
 * A post with no h2 heading: the page script returns from its table of
 * contents section on one, and the diagrams must not care.
 */
function blogPage(url) {
  const scripts = blogScripts();
  const blocks = diagramsFor(url)
    .map((code) => {
      return `<pre><code class="language-mermaid">${escapeHtml(code)}</code></pre>`;
    })
    .join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blog fixture</title><link rel="stylesheet" href="/oneuptime-assets/highlight/styles/vs2015.min.css">${scripts.highlightCore}${scripts.highlightLoader}</head><body><article class="blog-body"><p>A post with a diagram in it.</p>${blocks}<pre><code class="language-javascript">const answer = 42;</code></pre><p>The end.</p></article>${scripts.page}${scripts.diagrams}</body></html>`;
}

const tailwind = path.join(vendorDirectory, "tailwind/tailwind-3.4.5.js");

/*
 * Every frontend's index.ejs gives every element Inter with a universal `*`
 * rule; the fixture carries the real rule.
 */
const dashboardIndex = fs.readFileSync(
  path.join(repository, "packages/App/FeatureSet/Dashboard/views/index.ejs"),
  "utf8",
);
const universalRule = dashboardIndex.match(/^\s*\*\s*\{[^}]*\}/m);

if (!universalRule) {
  throw new Error(
    "Dashboard index.ejs no longer has its universal `*` font rule",
  );
}

const dashboardPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Diagrams fixture</title><script>window.process={env:{HOST:"localhost",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"production"}};window.global=window;</script><script src="/oneuptime-assets/tailwind/tailwind-3.4.5.js"></script><style>@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url("/oneuptime-assets/fonts/InterVariable.woff2") format("woff2");}${universalRule[0]}</style></head><body class="bg-gray-50"><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;

const CONTENT_TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

function serveFile(response, root, relative) {
  const file = path.resolve(root, relative);

  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
    response.writeHead(404).end();
    return;
  }

  if (fs.statSync(file).isDirectory()) {
    response.writeHead(404).end();
    return;
  }

  response.setHeader(
    "Content-Type",
    CONTENT_TYPES[path.extname(file)] || "application/octet-stream",
  );
  fs.createReadStream(file).pipe(response);
}

async function main() {
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  await esbuild.build(config);

  childProcess.execFileSync(
    process.execPath,
    [mermaidBuildScript, mermaidDirectory],
    { stdio: "inherit" },
  );

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader("Cache-Control", "no-store");

    if (url.pathname.startsWith("/oneuptime-assets/mermaid/")) {
      serveFile(
        response,
        mermaidDirectory,
        url.pathname.slice("/oneuptime-assets/mermaid/".length),
      );
      return;
    }

    if (url.pathname.startsWith("/oneuptime-assets/")) {
      serveFile(
        response,
        vendorDirectory,
        url.pathname.slice("/oneuptime-assets/".length),
      );
      return;
    }

    if (url.pathname.startsWith("/docs/static/")) {
      serveFile(
        response,
        docsStaticDirectory,
        url.pathname.slice("/docs/static/".length),
      );
      return;
    }

    if (url.pathname.startsWith("/dist/")) {
      serveFile(response, output, url.pathname.slice("/dist/".length));
      return;
    }

    response.setHeader("Content-Type", "text/html; charset=utf-8");

    if (url.pathname === "/docs") {
      response.end(docsPage(url));
      return;
    }

    if (url.pathname === "/blog") {
      response.end(blogPage(url));
      return;
    }

    if (url.pathname === "/dashboard" || url.pathname === "/") {
      response.end(dashboardPage);
      return;
    }

    response.writeHead(404).end();
  });

  // Unused, but keeps tailwind's path checked at startup.
  if (!fs.existsSync(tailwind)) {
    throw new Error(`Tailwind is missing at ${tailwind}`);
  }

  server.listen(port, "127.0.0.1");
  process.on("SIGTERM", () => {
    return server.close();
  });
  process.on("SIGINT", () => {
    return server.close();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

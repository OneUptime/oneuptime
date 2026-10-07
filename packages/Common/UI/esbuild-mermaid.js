/**
 * Mermaid, bundled from its ES module source.
 *
 * The mermaid package ships its library in two kinds of build:
 *
 *   dist/mermaid.core.mjs - what its package.json "exports" names. It
 *   imports each dependency by package name, so the bundler that builds it
 *   resolves katex, DOMPurify, d3 and the rest out of node_modules: the
 *   versions npm installed, with the overrides in Common's package.json
 *   applied, and the versions npm audit reports on.
 *
 *   dist/mermaid.min.js, mermaid.js, mermaid.esm.mjs, mermaid.esm.min.mjs
 *   and their chunks - bundled when mermaid was released, each carrying its
 *   own copy of those dependencies. An override does not reach a copy, and
 *   npm audit cannot see one.
 *
 * Every diagram OneUptime draws comes from the first kind:
 *
 *   - The frontends bundle MarkdownViewer's import("mermaid") through
 *     esbuild-config.js, whose plugins start with createMermaidSourcePlugin()
 *     below. esbuild splits it into chunks: mermaid's core, one per diagram
 *     type, and katex, which loads only for a label written as $$...$$.
 *   - The docs and the blog import /oneuptime-assets/mermaid/mermaid.mjs.
 *     Common/Server/Utils/MermaidBrowserBuild.ts produces it by running this
 *     file as a script, which prints buildMermaidBrowserBundle()'s output.
 *
 * The plugin makes loading any prebuilt bundle a build error, so no import
 * path - a deep import, a future exports map, a shim like the one this
 * replaced - can bring an embedded copy back without failing the build.
 *
 * CommonJS, like esbuild-config.js. esbuild is required only when a build
 * runs, so tests can load this module under jsdom. Types for TypeScript
 * callers are in esbuild-mermaid.d.ts.
 */

const path = require("path");

const MERMAID_SOURCE_PLUGIN_NAME = "mermaid-from-source";

/*
 * mermaid's prebuilt bundles, by path. dist/mermaid.core.mjs and its
 * chunks/mermaid.core/ directory are the source build and do not match.
 * Written for esbuild's Go regular expressions too: no lookaround.
 */
const PREBUILT_MERMAID_BUNDLE =
  /[\\/]mermaid[\\/]dist[\\/](?:mermaid(?:\.esm)?(?:\.min)?\.m?js$|chunks[\\/]mermaid\.esm(?:\.min)?[\\/])/;

/* The module the docs and the blog import, and where its chunks go. */
const MERMAID_BROWSER_ENTRY = "mermaid.mjs";
const MERMAID_BROWSER_CHUNK_DIRECTORY = "chunks";

const COMMON_ROOT = path.resolve(__dirname, "..");

/**
 * Whether a file is one of mermaid's prebuilt bundles.
 * @param {string} filePath
 * @returns {boolean}
 */
function isPrebuiltMermaidBundle(filePath) {
  return PREBUILT_MERMAID_BUNDLE.test(filePath);
}

/**
 * Refuses to load mermaid's prebuilt bundles. A bare `import("mermaid")`
 * already resolves to the source build through mermaid's exports map; this
 * keeps it that way.
 */
function createMermaidSourcePlugin() {
  return {
    name: MERMAID_SOURCE_PLUGIN_NAME,
    setup(build) {
      build.onLoad({ filter: PREBUILT_MERMAID_BUNDLE }, (args) => {
        return {
          errors: [
            {
              text:
                `${args.path} is one of mermaid's prebuilt bundles, which carry ` +
                "their own copies of mermaid's dependencies. Import " +
                '"mermaid" instead: it resolves to dist/mermaid.core.mjs, ' +
                "which takes each dependency from node_modules.",
            },
          ],
        };
      });
    },
  };
}

/**
 * Builds mermaid for a page that imports it as an ES module: the docs and
 * the blog. Same source and the same guard as the frontends' bundles;
 * written to memory, not to disk.
 *
 * @param {{ esbuild?: object }} [options] - an esbuild module to use instead
 *   of requiring one (tests).
 * @returns {Promise<{ entry: string, files: Array<{ path: string, text: string }>, inputs: Array<string> }>}
 *   Paths relative to the directory the entry is served from, with forward
 *   slashes; inputs relative to Common.
 */
async function buildMermaidBrowserBundle(options) {
  const esbuild = (options && options.esbuild) || require("esbuild");

  // Never written (write: false), but esbuild names outputs relative to it.
  const outdir = path.join(COMMON_ROOT, "build", "mermaid-browser");

  const result = await esbuild.build({
    absWorkingDir: COMMON_ROOT,
    entryPoints: {
      [path.basename(MERMAID_BROWSER_ENTRY, ".mjs")]: "mermaid",
    },
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    // The frontends' target (esbuild-config.js).
    target: "es2017",
    minify: true,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    write: false,
    outdir,
    entryNames: "[name]",
    // Content-hashed, so VendorAssets can let browsers keep them for a year.
    chunkNames: `${MERMAID_BROWSER_CHUNK_DIRECTORY}/[name]-[hash]`,
    outExtension: { ".js": ".mjs" },
    plugins: [createMermaidSourcePlugin()],
    metafile: true,
    logLevel: "silent",
  });

  return {
    entry: MERMAID_BROWSER_ENTRY,
    files: result.outputFiles.map((file) => {
      return {
        path: path.relative(outdir, file.path).split(path.sep).join("/"),
        text: file.text,
      };
    }),
    inputs: Object.keys(result.metafile.inputs),
  };
}

module.exports = {
  MERMAID_SOURCE_PLUGIN_NAME,
  MERMAID_BROWSER_ENTRY,
  MERMAID_BROWSER_CHUNK_DIRECTORY,
  isPrebuiltMermaidBundle,
  createMermaidSourcePlugin,
  buildMermaidBrowserBundle,
};

/*
 * `node esbuild-mermaid.js` prints the browser bundle as JSON on stdout:
 * { "entry": "mermaid.mjs", "files": [{ "path", "text" }] }. That is how
 * MermaidBrowserBuild.ts runs it - in a child process, so esbuild never
 * loads into a server process.
 */
if (require.main === module) {
  buildMermaidBrowserBundle()
    .then((bundle) => {
      process.stdout.write(
        JSON.stringify({ entry: bundle.entry, files: bundle.files }),
      );
    })
    .catch((error) => {
      process.stderr.write(
        `${error && error.message ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}

/**
 * Mermaid, bundled from its ES module source.
 *
 * The mermaid package ships its library in two kinds of build:
 *
 *   dist/mermaid.core.mjs - what its package.json "exports" names. It
 *   imports each dependency by package name, so the bundler that builds it
 *   resolves katex, DOMPurify, d3 and the rest out of node_modules: the
 *   versions npm installed, with the overrides in Common's package.json
 *   applied.
 *
 *   dist/mermaid.min.js, mermaid.js, mermaid.esm.mjs, mermaid.esm.min.mjs
 *   and their chunks - bundled when mermaid was released, each carrying its
 *   own copy of those dependencies, which an override does not reach.
 *
 * Every diagram OneUptime draws comes from the first kind:
 *
 *   - The frontends bundle MarkdownViewer's import("mermaid") through
 *     esbuild-config.js, whose plugins start with createMermaidSourcePlugin()
 *     below. esbuild splits it into chunks: mermaid's core, one per diagram
 *     type, and katex, which loads only for a label written as $$...$$.
 *   - The docs and the blog import /oneuptime-assets/mermaid/mermaid.mjs.
 *     Common/Scripts/build-mermaid-browser.js writes it, with
 *     buildMermaidBrowserBundle() below, to MERMAID_BROWSER_BUILD_DIRECTORY
 *     when the App and Home images are built, and
 *     Common/Server/Utils/VendorAssets.ts serves that directory.
 *
 * The plugin makes loading any prebuilt bundle a build error, so no import
 * path - a deep import, a future exports map, a shim like the one this
 * replaced - can bring an embedded copy back without failing the build.
 *
 * CommonJS, like esbuild-config.js. It does not load esbuild itself: callers
 * pass theirs to buildMermaidBrowserBundle(), so tests can load this module
 * under jsdom. Types for TypeScript callers are in esbuild-mermaid.d.ts.
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

/*
 * Where the docs' and the blog's build is written, and served from: inside
 * Common, so every image that copies Common in can build it, and outside the
 * source directories the development containers mount over the image's.
 */
const MERMAID_BROWSER_BUILD_DIRECTORY = path.join(
  COMMON_ROOT,
  "build",
  "mermaid-browser",
);

/*
 * Every file a browser build may hold, as a path relative to its directory:
 * the entry, or a chunk one directory down, named with letters, digits, dots,
 * dashes and underscores (never a leading dot), ending in .mjs. VendorAssets
 * serves nothing else, and buildMermaidBrowserBundle() refuses to write
 * anything else, so every module the entry imports is one the server serves.
 */
const MERMAID_BROWSER_FILE = new RegExp(
  `^(?:${MERMAID_BROWSER_CHUNK_DIRECTORY}/)?[A-Za-z0-9_-][A-Za-z0-9._-]*\\.mjs$`,
);

/**
 * Whether a file is one of mermaid's prebuilt bundles.
 * @param {string} filePath
 * @returns {boolean}
 */
function isPrebuiltMermaidBundle(filePath) {
  return PREBUILT_MERMAID_BUNDLE.test(filePath);
}

/**
 * Whether a path, relative to a browser build's directory with forward
 * slashes, is one a browser build may hold (and VendorAssets serves).
 * @param {string} relativePath
 * @returns {boolean}
 */
function isMermaidBrowserFile(relativePath) {
  return MERMAID_BROWSER_FILE.test(relativePath);
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
 * the blog. Same source, the same guard and the same target, minification
 * and kept names as the frontends' production bundles. Built in memory;
 * Common/Scripts/build-mermaid-browser.js writes it out.
 *
 * @param {object} esbuild - the esbuild module.
 * @returns {Promise<{ entry: string, files: Array<{ path: string, text: string }>, inputs: Array<string> }>}
 *   File paths relative to the directory the entry is served from, with
 *   forward slashes; inputs relative to Common.
 */
async function buildMermaidBrowserBundle(esbuild) {
  // Never written to (write: false); esbuild names the outputs against it.
  const outdir = MERMAID_BROWSER_BUILD_DIRECTORY;

  const result = await esbuild.build({
    absWorkingDir: COMMON_ROOT,
    entryPoints: {
      [path.basename(MERMAID_BROWSER_ENTRY, ".mjs")]: "mermaid",
    },
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    // The frontends' production settings (esbuild-config.js).
    target: "es2017",
    minify: true,
    keepNames: true,
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

  const files = result.outputFiles.map((file) => {
    return {
      path: path.relative(outdir, file.path).split(path.sep).join("/"),
      text: file.text,
    };
  });

  /*
   * esbuild names a chunk after the module it starts with. A name the server
   * would not serve fails the build here, not a diagram in a reader's browser.
   */
  const unservable = files
    .filter((file) => {
      return !isMermaidBrowserFile(file.path);
    })
    .map((file) => {
      return file.path;
    });

  if (unservable.length > 0) {
    throw new Error(
      `mermaid's browser build names files /oneuptime-assets/mermaid/ does not serve: ${unservable.join(", ")}. ` +
        "Their names may hold only letters, digits, dots, dashes and underscores.",
    );
  }

  if (
    !files.some((file) => {
      return file.path === MERMAID_BROWSER_ENTRY;
    })
  ) {
    throw new Error(
      `mermaid's browser build has no ${MERMAID_BROWSER_ENTRY} for the docs and the blog to import.`,
    );
  }

  return {
    entry: MERMAID_BROWSER_ENTRY,
    files,
    inputs: Object.keys(result.metafile.inputs),
  };
}

module.exports = {
  MERMAID_SOURCE_PLUGIN_NAME,
  MERMAID_BROWSER_ENTRY,
  MERMAID_BROWSER_CHUNK_DIRECTORY,
  MERMAID_BROWSER_BUILD_DIRECTORY,
  isPrebuiltMermaidBundle,
  isMermaidBrowserFile,
  createMermaidSourcePlugin,
  buildMermaidBrowserBundle,
};

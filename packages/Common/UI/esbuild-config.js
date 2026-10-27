/**
 * Shared esbuild configuration factory for OneUptime frontend services
 * This creates consistent build configurations across all services
 */

const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const dotenv = require("dotenv");
const { createMermaidSourcePlugin } = require("./esbuild-mermaid");

function createRefractorCompatibilityPlugin() {
  const candidateRoots = [
    path.resolve(__dirname, "../node_modules/refractor"),
    path.resolve(__dirname, "../../../node_modules/refractor"),
  ];

  const refractorRoot = candidateRoots.find((packagePath) =>
    fs.existsSync(packagePath),
  );

  if (!refractorRoot) {
    throw new Error(
      "Unable to locate refractor package for esbuild compatibility plugin.",
    );
  }

  return {
    name: "refractor-compatibility",
    setup(build) {
      build.onResolve({ filter: /^refractor\/lib\// }, (args) => {
        const relativePath = args.path.replace(/^refractor\/lib\//, "");
        const candidatePath = path.join(
          refractorRoot,
          "lib",
          `${relativePath}.js`,
        );
        return { path: candidatePath };
      });

      build.onResolve({ filter: /^refractor\/lang\// }, (args) => {
        const relativePath = args.path.replace(/^refractor\/lang\//, "");
        const filename = relativePath.endsWith(".js")
          ? relativePath
          : `${relativePath}.js`;
        const candidatePath = path.join(refractorRoot, "lang", filename);
        return { path: candidatePath };
      });
    },
  };
}

// CSS Plugin to handle CSS/SCSS files
function createCSSPlugin() {
  return {
    name: "css",
    setup(build) {
      build.onLoad({ filter: /\.s?css$/ }, async (args) => {
        const sass = require("sass");
        const fs = require("fs");

        let contents = fs.readFileSync(args.path, "utf8");

        // Compile SCSS to CSS if it's a SCSS file
        if (args.path.endsWith(".scss") || args.path.endsWith(".sass")) {
          try {
            const result = sass.compile(args.path);
            contents = result.css;
          } catch (error) {
            console.error(`SCSS compilation error in ${args.path}:`, error);
            throw error;
          }
        }

        // Return CSS as a string that will be injected into the page
        return {
          contents: `
            const style = document.createElement('style');
            style.textContent = ${JSON.stringify(contents)};
            document.head.appendChild(style);
          `,
          loader: "js",
        };
      });
    },
  };
}

// File loader plugin for assets
function createFileLoaderPlugin() {
  return {
    name: "file-loader",
    setup(build) {
      build.onLoad(
        { filter: /\.(png|jpe?g|gif|svg|woff|woff2|eot|ttf|otf)$/ },
        async (args) => {
          const fs = require("fs");
          const path = require("path");

          const contents = fs.readFileSync(args.path);
          const filename = path.basename(args.path);
          const ext = path.extname(filename);

          // For development, we'll use data URLs for simplicity
          // In production, you might want to copy files to the output directory
          const mimeTypes = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
            ".woff": "font/woff",
            ".woff2": "font/woff2",
            ".eot": "application/vnd.ms-fontobject",
            ".ttf": "font/ttf",
            ".otf": "font/otf",
          };

          const mimeType =
            mimeTypes[ext.toLowerCase()] || "application/octet-stream";
          const dataUrl = `data:${mimeType};base64,${contents.toString("base64")}`;

          return {
            contents: `export default ${JSON.stringify(dataUrl)};`,
            loader: "js",
          };
        },
      );
    },
  };
}

// Tailwind's Play CDN build, copied out of Common next to the bundle.
//
// It used to be committed once per frontend - five byte-identical copies of a
// 684 KB minified file, each one its own set of code-scanning alerts to
// triage. The server-rendered pages (docs, the API reference, the on-call and
// SSO message views) needed a copy too, and adding a sixth is not a thing
// worth doing. Common/Server/Static/Vendor is now the only copy in the tree:
// the services mount it at /oneuptime-assets, and the frontends get it copied
// in here, at the path their index.ejs already asks for.
//
// The filename carries the version, so it stays in the URL - changing it would
// mean editing five index.ejs files to match, and getting one wrong is an
// unstyled page.
const TAILWIND_FILENAME = "tailwind-3.4.5.js";

// Left and right follow the reading direction (Styles/TailwindReadingDirection.js):
// every index.ejs loads it right after the runtime and hands it its config.
const TAILWIND_READING_DIRECTION_FILENAME = "tailwind-reading-direction.js";

function copyTailwindAsset(outdir) {
  const source = path.resolve(
    __dirname,
    "..",
    "Server",
    "Static",
    "Vendor",
    "tailwind",
    TAILWIND_FILENAME,
  );

  const destination = path.resolve(
    path.dirname(outdir),
    "assets/js",
    TAILWIND_FILENAME,
  );

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);

  fs.copyFileSync(
    path.resolve(__dirname, "Styles", "TailwindReadingDirection.js"),
    path.resolve(
      path.dirname(outdir),
      "assets/js",
      TAILWIND_READING_DIRECTION_FILENAME,
    ),
  );
}

// Which build a browser tab runs, and which one the server serves now.
//
// A tab keeps running the build it loaded, and every deploy replaces the
// content-hashed chunks it fetches pages from, so a tab opened before a
// deploy asks for chunks the server no longer has. To notice the new
// version before that happens, the tab has to know which build it runs and
// ask the server which build it serves (Common/UI/Utils/NewVersion).
//
// build() and watch() below give every build an id, write it into the bundle
// (the __ONEUPTIME_BUILD_ID__ define) and into build.json next to the
// bundle, which is served as a static file from the same place as the
// chunks. The id is new for every build, so two builds of one commit - the
// Community and the Enterprise image's Dashboard - never pass for each
// other; one image's pods all serve the same file.
//
// createConfig() adds neither, so a bundle built from it some other way (the
// offline E2E fixtures call esbuild.build directly) has no id, and its page
// never asks for build.json.
const BUILD_MANIFEST_FILENAME = "build.json";
const BUILD_ID_DEFINE = "__ONEUPTIME_BUILD_ID__";
const BUILD_MANIFEST_URL_DEFINE = "__ONEUPTIME_BUILD_MANIFEST_URL__";
const BUILD_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

// ONEUPTIME_FRONTEND_BUILD_ID names the build instead (tests and fixtures).
function createBuildId(environment) {
  const env = environment || process.env;
  const requested = (env.ONEUPTIME_FRONTEND_BUILD_ID || "").trim();

  if (requested) {
    if (!BUILD_ID_PATTERN.test(requested)) {
      throw new Error(
        `ONEUPTIME_FRONTEND_BUILD_ID must be 1-128 letters, digits, dots, dashes or underscores, not ${JSON.stringify(requested)}.`,
      );
    }

    return requested;
  }

  const version = (env.APP_VERSION || "").trim().replace(/[^A-Za-z0-9.]/g, "");
  const gitSha = (env.GIT_SHA || "").trim().replace(/[^A-Za-z0-9]/g, "");

  return [
    version || "dev",
    gitSha.slice(0, 12) || "local",
    crypto.randomBytes(6).toString("hex"),
  ].join("-");
}

// Writes the build's id into the bundle and says where build.json is.
function applyBuildIdentity(config, buildId) {
  config.define = {
    ...(config.define || {}),
    [BUILD_ID_DEFINE]: JSON.stringify(buildId),
    [BUILD_MANIFEST_URL_DEFINE]: JSON.stringify(
      `${config.publicPath || "/dist/"}${BUILD_MANIFEST_FILENAME}`,
    ),
  };

  return config;
}

function writeBuildManifest(outdir, buildId, environment) {
  const env = environment || process.env;

  fs.mkdirSync(outdir, { recursive: true });
  fs.writeFileSync(
    path.join(outdir, BUILD_MANIFEST_FILENAME),
    `${JSON.stringify(
      {
        buildId: buildId,
        version: env.APP_VERSION || "",
        gitSha: env.GIT_SHA || "",
      },
      null,
      2,
    )}\n`,
  );
}

// Read environment variables from .env file
function readEnvFile(pathToFile) {
  if (!fs.existsSync(pathToFile)) {
    console.warn(`Environment file not found: ${pathToFile}`);
    return {};
  }

  const parsed = dotenv.config({ path: pathToFile }).parsed || {};
  const env = {};

  for (const key in parsed) {
    env[`process.env.${key}`] = JSON.stringify(parsed[key]);
  }

  return env;
}

function resolvePackageRoot(packageName) {
  const resolutionPaths = [
    process.cwd(),
    __dirname,
    path.resolve(__dirname, ".."),
    path.resolve(__dirname, "../../.."),
  ];

  for (const resolutionPath of resolutionPaths) {
    try {
      const packageJsonPath = require.resolve(`${packageName}/package.json`, {
        paths: [resolutionPath],
      });

      return path.dirname(packageJsonPath);
    } catch (error) {
      continue;
    }
  }

  throw new Error(
    `Unable to locate ${packageName} package for esbuild alias resolution.`,
  );
}

/**
 * Resolve a package SUBPATH (e.g. "react-router/dom") to the file its exports
 * map publishes, or null when the installed version publishes no such subpath.
 *
 * Needed because esbuild's `alias` matches path prefixes: an entry for
 * "react-router" also rewrites "react-router/dom" to "<root>/dom", a directory
 * that does not exist on disk because the subpath only exists in the package's
 * exports map. Aliasing the subpath explicitly, to the file it really resolves
 * to, is what keeps the prefix alias from swallowing it.
 *
 * Returns null rather than throwing: the subpath is only present from
 * react-router 7 onward, and a version without it needs no alias at all
 * because nothing imports it.
 */
function resolvePackageSubpath(packageName, subpath) {
  const specifier = `${packageName}/${subpath}`;

  const resolutionPaths = [
    process.cwd(),
    __dirname,
    path.resolve(__dirname, ".."),
    path.resolve(__dirname, "../../.."),
  ];

  for (const resolutionPath of resolutionPaths) {
    try {
      return require.resolve(specifier, { paths: [resolutionPath] });
    } catch (error) {
      continue;
    }
  }

  return null;
}

/**
 * Create esbuild configuration for a service
 * @param {Object} options - Configuration options
 * @param {string} options.serviceName - Name of the service (dashboard, accounts, admin, status-page)
 * @param {string} options.publicPath - Public path for assets
 * @param {string} [options.entryPoint] - Entry point file (defaults to './src/Index.tsx')
 * @param {string} [options.outdir] - Output directory (defaults to './public/dist')
 * @param {Object} [options.additionalDefines] - Additional define variables
 * @param {Array} [options.additionalExternal] - Additional external modules
 * @param {Object} [options.additionalAlias] - Additional aliases
 * @param {Array} [options.additionalPlugins] - Additional esbuild plugins, run after the shared ones
 */
function createConfig(options) {
  const {
    serviceName,
    publicPath,
    entryPoint = "./src/Index.tsx",
    outdir = "./public/dist",
    additionalDefines = {},
    additionalExternal = [],
    additionalAlias = {},
    additionalPlugins = [],
  } = options;

  const isDev = process.env.NODE_ENV !== "production";
  const isAnalyze = process.env.analyze === "true";
  const reactRoot = resolvePackageRoot("react");
  const reactDomRoot = resolvePackageRoot("react-dom");
  const reactRouterRoot = resolvePackageRoot("react-router");
  const reactRouterDomSubpath = resolvePackageSubpath("react-router", "dom");
  const reactRouterDomRoot = resolvePackageRoot("react-router-dom");
  const reactI18nextRoot = resolvePackageRoot("react-i18next");
  const i18nextRoot = resolvePackageRoot("i18next");

  return {
    entryPoints: [entryPoint],
    bundle: true,
    outdir,
    format: "esm",
    platform: "browser",
    target: "es2017",
    sourcemap: isDev ? "inline" : false,
    /*
     * Production bundles ship minified; development builds do not. The five
     * frontends were shipping unminified ESM - measured at 4,842,357 bytes for
     * one service's bundle, 2,636,716 after minification (-46% raw, -30%
     * gzipped). That is bandwidth on every cold page load, per user, plus the
     * bytes sitting in the image and in the registry.
     *
     * Dev stays unminified deliberately: the inline sourcemap above is only
     * half the story - readable output is what makes a stack trace in the
     * browser console point at something, and minifying would cost watch-mode
     * rebuild time for no benefit nobody is measuring locally.
     */
    minify: !isDev,
    /*
     * Insurance for the minified build. esbuild renames functions and classes
     * when minifying, which breaks anything reading `fn.name` or
     * `instance.constructor.name` at runtime - error classes that switch on
     * their own name, component displayName inference, decorator metadata.
     * Keeping names costs a few KB and removes an entire category of
     * production-only failure that no test would catch.
     */
    keepNames: true,
    treeShaking: true,
    splitting: true,
    publicPath,
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        isDev ? "development" : "production",
      ),
      ...additionalDefines,
    },
    external: ["react-native-sqlite-storage", ...additionalExternal],
    alias: {
      react: reactRoot,
      // Shared controls use portals while the entry point uses react-dom/client.
      // Resolve both to one renderer even when each package installs its own copy.
      "react-dom": reactDomRoot,
      "react/jsx-runtime": path.join(reactRoot, "jsx-runtime.js"),
      "react/jsx-dev-runtime": path.join(reactRoot, "jsx-dev-runtime.js"),
      // Public dashboards reuse widgets from the private dashboard package.
      // Their links must share the router context installed by the entry app.
      "react-router": reactRouterRoot,
      /*
       * react-router-dom 7 re-exports from "react-router/dom". The prefix
       * alias above would rewrite that to "<reactRouterRoot>/dom", which is
       * not a path on disk, and the bundle fails to build entirely. Point the
       * subpath at the file its exports map names - the same shape as the
       * react/jsx-runtime entries above.
       */
      ...(reactRouterDomSubpath
        ? { "react-router/dom": reactRouterDomSubpath }
        : {}),
      "react-router-dom": reactRouterDomRoot,
      // Force a single instance of i18next/react-i18next so that translations
      // initialized in the service entry are visible to Common UI components.
      // Without this, Common's own node_modules copy gets a separate, never-
      // initialized i18n singleton and useTranslation() returns the raw key.
      "react-i18next": reactI18nextRoot,
      i18next: i18nextRoot,
      ...additionalAlias,
    },
    plugins: [
      /*
       * mermaid from its ES module source, so katex and its other
       * dependencies come from node_modules (see esbuild-mermaid.js).
       */
      createMermaidSourcePlugin(),
      createRefractorCompatibilityPlugin(),
      createCSSPlugin(),
      createFileLoaderPlugin(),
      ...additionalPlugins,
    ],
    loader: {
      ".tsx": "tsx",
      ".ts": "ts",
      ".jsx": "jsx",
      ".js": "js",
      ".json": "json",
    },
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".json", ".css", ".scss"],
    metafile: isAnalyze,
  };
}

/**
 * Build function that handles the build process
 * @param {Object} config - esbuild configuration
 * @param {string} serviceName - Name of the service for logging
 */
async function build(config, serviceName) {
  const isAnalyze = process.env.analyze === "true";
  let buildId;

  try {
    buildId = createBuildId();
    applyBuildIdentity(config, buildId);
  } catch (error) {
    console.error(`❌ ${serviceName} build failed:`, error);
    process.exit(1);
  }

  // Clean the output directory before building to remove stale content-hashed chunks.
  if (config.outdir && fs.existsSync(config.outdir)) {
    fs.rmSync(config.outdir, { recursive: true, force: true });
    fs.mkdirSync(config.outdir, { recursive: true });
    console.log(`🧹 Cleaned output directory: ${config.outdir}`);
  }

  try {
    const result = await esbuild.build(config);

    copyTailwindAsset(config.outdir);
    console.log(`📦 Copied Tailwind for ${serviceName}`);

    // Last, so a server never names a build whose files are not all there.
    writeBuildManifest(config.outdir, buildId);
    console.log(`🏷️  ${serviceName} build ${buildId}`);

    if (isAnalyze && result.metafile) {
      const analyzeText = await esbuild.analyzeMetafile(result.metafile);
      console.log(`\n📊 Bundle analysis for ${serviceName}:`);
      console.log(analyzeText);

      // Write metafile for external analysis tools
      const metafilePath = path.join(config.outdir, "metafile.json");
      fs.writeFileSync(metafilePath, JSON.stringify(result.metafile, null, 2));
      console.log(`📝 Metafile written to: ${metafilePath}`);
    }

    console.log(`✅ ${serviceName} build completed successfully`);
  } catch (error) {
    console.error(`❌ ${serviceName} build failed:`, error);
    process.exit(1);
  }
}

/**
 * Watch function that handles the watch process
 * @param {Object} config - esbuild configuration
 * @param {string} serviceName - Name of the service for logging
 */
async function watch(config, serviceName) {
  try {
    // One id for the whole watch: a rebuild on save is not a new version.
    const buildId = createBuildId();

    applyBuildIdentity(config, buildId);
    writeBuildManifest(config.outdir, buildId);

    const context = await esbuild.context(config);

    // The copy does not read the built output, so it can run before the
    // first build instead of forcing an extra one just to have something to
    // inspect. context.watch() does the initial build on its own.
    copyTailwindAsset(config.outdir);
    console.log(`📦 Copied Tailwind for ${serviceName}`);

    await context.watch();
    console.log(`👀 Watching ${serviceName} for changes...`);
  } catch (error) {
    console.error(`❌ ${serviceName} watch failed:`, error);
    process.exit(1);
  }
}

module.exports = {
  createConfig,
  build,
  watch,
  createCSSPlugin,
  createFileLoaderPlugin,
  readEnvFile,
  // Exported so Common/Tests can run it, rather than assert on its source.
  copyTailwindAsset,
  TAILWIND_FILENAME,
  TAILWIND_READING_DIRECTION_FILENAME,
  createBuildId,
  applyBuildIdentity,
  writeBuildManifest,
  BUILD_MANIFEST_FILENAME,
  BUILD_ID_DEFINE,
  BUILD_MANIFEST_URL_DEFINE,
};

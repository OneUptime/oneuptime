/**
 * esbuild configuration for the OneUptime session-replay browser recorder.
 *
 * This deliberately does NOT call createConfig() from
 * Common/UI/esbuild-config.js. That factory hardcodes format: "esm",
 * splitting: true and a React/i18next/mermaid/CSS plugin chain — an
 * ESM + code-split bundle cannot be loaded by a plain <script src> on a
 * customer's site, and none of those plugins have anything to do with a
 * recorder that must stay ~50 KB gzip.
 *
 * Two artifacts come out of here:
 *
 *   loader.js    served at /telemetry/session-replay/v1/recorder.js with a
 *                short max-age. Fetches config, honours enabled/consent/
 *                DNT/GPC, then loads the pinned artifact. Kept tiny and
 *                rrweb-free so a bad recorder release is recoverable by
 *                changing one config field instead of waiting out a
 *                year-long immutable cache.
 *
 *   recorder.js  served at /telemetry/session-replay/v<semver>/recorder.js,
 *                immutable, SRI-pinned. Contains rrweb.
 */

const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const packageJson = require("./package.json");

const OUT_DIR = path.resolve(__dirname, "./public/dist");

const COMMON_ROOT = path.resolve(__dirname, "../../../Common");

/*
 * The ONLY Common paths this bundle may reach. Everything else in Common
 * transitively drags in express / typeorm / stripe / monaco, or reads
 * window.process.env (Common/UI/Config.ts) which only exists inside the
 * OneUptime Dashboard. The modules below are deliberately dependency-free
 * so they can be inlined here and unit-tested once for both sides of the
 * wire.
 */
const ALLOWED_COMMON_PREFIXES = ["Common/Utils/Rum/", "Common/Types/Rum/"];

/*
 * Substrings that must never appear in a shipped artifact. Checked with
 * word boundaries so "expression" does not trip the "express" rule.
 */
const FORBIDDEN_IN_BUNDLE = [
  /process\.env/,
  /\bexpress\b/,
  /\btypeorm\b/,
  /\bstripe\b/i,
];

/*
 * Size budgets. Not vanity numbers: the loader is on the critical path of
 * every page view on a customer's site, and the artifact is a RUM vendor's
 * own contribution to its customer's Core Web Vitals.
 */
const LOADER_MAX_BYTES = 6 * 1024;
const RECORDER_MAX_BYTES = 320 * 1024;

function createCommonRumInlinePlugin() {
  return {
    name: "common-rum-inline",
    setup(build) {
      build.onResolve({ filter: /^Common\// }, (args) => {
        const isAllowed = ALLOWED_COMMON_PREFIXES.some((prefix) => {
          return args.path.startsWith(prefix);
        });

        if (!isAllowed) {
          return {
            errors: [
              {
                text:
                  `The browser recorder may not import "${args.path}". ` +
                  `Only ${ALLOWED_COMMON_PREFIXES.join(", ")} are inlined; ` +
                  `everything else in Common pulls server dependencies or ` +
                  `reads window.process.env.`,
              },
            ],
          };
        }

        const relativePath = args.path.replace(/^Common\//, "");
        const resolved = path.join(COMMON_ROOT, `${relativePath}.ts`);

        if (!fs.existsSync(resolved)) {
          return {
            errors: [{ text: `Cannot resolve "${args.path}" to ${resolved}.` }],
          };
        }

        return { path: resolved };
      });
    },
  };
}

function createBaseConfig(isDev) {
  return {
    bundle: true,
    platform: "browser",

    /*
     * IIFE with a single global, because this is loaded by a plain
     * <script src> from arbitrary customer pages. ESM would require
     * type="module" (which customers cannot always add) and splitting
     * would require the page to fetch chunks we cannot name in advance.
     */
    format: "iife",
    splitting: false,

    /*
     * es2019 is the floor. Lower than the rest of the repo on purpose:
     * we do not get to pick the end user's browser.
     */
    target: "es2019",

    /*
     * Minified in every mode. The artifact ships to third parties in both
     * modes, and a dev build that is 4x the size hides bundle-weight
     * regressions until release day.
     */
    minify: true,
    sourcemap: isDev ? "inline" : false,
    treeShaking: true,
    legalComments: "none",

    /*
     * rrweb's published bundle carries the Replayer's xstate dependency,
     * which branches on process.env.NODE_ENV / process.env.LANG. We import
     * only { record }, so tree shaking normally drops it — these defines
     * make that guarantee unconditional rather than dependent on rrweb's
     * internal module graph staying side-effect-free.
     */
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.LANG": '""',

      /*
       * Stamped onto every chunk envelope as recorderVersion, so a bad
       * masking release can be identified in ClickHouse after the fact.
       * Read through a typeof guard in src/Config.ts so unit tests, which
       * run without this define, still have a value.
       */
      __ONEUPTIME_RECORDER_VERSION__: JSON.stringify(packageJson.version),
    },

    plugins: [createCommonRumInlinePlugin()],
    loader: { ".ts": "ts" },
    resolveExtensions: [".ts", ".js", ".json"],
    metafile: true,
  };
}

function assertBundleHygiene(filePath, maxBytes) {
  const contents = fs.readFileSync(filePath, "utf8");

  /*
   * A dev build carries an inline sourcemap, which is both far larger than the
   * code and a base64 copy of the original TypeScript - including the comments
   * that discuss express and process.env. Both checks below are about the
   * SHIPPED code, so the map is separated out first.
   *
   * Matched on the full data-URI annotation at the start of the final line:
   * rrweb's own CSS handling contains several "# sourceMappingURL=" string
   * literals, and truncating at the first of those would silently skip the
   * hygiene scan over most of the bundle.
   */
  const MAP_ANNOTATION = "\n//# sourceMappingURL=data:";
  const mapIndex = contents.lastIndexOf(MAP_ANNOTATION);
  const source = mapIndex === -1 ? contents : contents.slice(0, mapIndex);

  for (const forbidden of FORBIDDEN_IN_BUNDLE) {
    if (forbidden.test(source)) {
      throw new Error(
        `${path.basename(filePath)} contains forbidden pattern ${forbidden}. ` +
          `The recorder runs on customer pages and must not carry server code.`,
      );
    }
  }

  const bytes = Buffer.byteLength(source);

  if (bytes > maxBytes) {
    throw new Error(
      `${path.basename(filePath)} is ${bytes} bytes, over its ${maxBytes} byte budget.`,
    );
  }

  /* The whole file is what a browser downloads; the budget is code only. */
  return { codeBytes: bytes, fileBytes: fs.statSync(filePath).size };
}

function getSriHash(filePath) {
  const digest = crypto
    .createHash("sha384")
    .update(fs.readFileSync(filePath))
    .digest("base64");

  return `sha384-${digest}`;
}

async function buildAll() {
  const isDev = process.env.NODE_ENV !== "production";
  const isAnalyze = process.env.analyze === "true";
  const base = createBaseConfig(isDev);

  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const recorderResult = await esbuild.build({
    ...base,
    entryPoints: [path.resolve(__dirname, "./src/Index.ts")],
    outfile: path.join(OUT_DIR, "recorder.js"),
    globalName: "OneUptimeReplay",
  });

  /*
   * The loader gets no globalName: it is pure side effect, and giving it
   * the same global as the artifact would let the stub overwrite the real
   * API object depending on load order.
   */
  const loaderResult = await esbuild.build({
    ...base,
    entryPoints: [path.resolve(__dirname, "./src/Loader.ts")],
    outfile: path.join(OUT_DIR, "loader.js"),
  });

  const recorderPath = path.join(OUT_DIR, "recorder.js");
  const loaderPath = path.join(OUT_DIR, "loader.js");

  const recorderSizes = assertBundleHygiene(recorderPath, RECORDER_MAX_BYTES);
  const loaderSizes = assertBundleHygiene(loaderPath, LOADER_MAX_BYTES);

  /*
   * The manifest is what the config endpoint reads to tell a live recorder
   * which pinned artifact to load, and what integrity attribute to put on
   * the injected script tag.
   */
  const manifest = {
    recorderVersion: packageJson.version,
    rrwebVersion: packageJson.dependencies.rrweb,
    files: {
      "recorder.js": {
        bytes: recorderSizes.fileBytes,
        integrity: getSriHash(recorderPath),
      },
      "loader.js": {
        bytes: loaderSizes.fileBytes,
        integrity: getSriHash(loaderPath),
      },
    },
  };

  fs.writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  if (isAnalyze) {
    console.log(
      await esbuild.analyzeMetafile(recorderResult.metafile, {
        verbose: false,
      }),
    );
    fs.writeFileSync(
      path.join(OUT_DIR, "metafile.json"),
      JSON.stringify(recorderResult.metafile, null, 2),
    );
  }

  void loaderResult;

  console.log(
    `✅ BrowserRecorder build complete — recorder.js ${recorderSizes.codeBytes} bytes of code, loader.js ${loaderSizes.codeBytes} bytes of code`,
  );
}

buildAll().catch((error) => {
  console.error("❌ BrowserRecorder build failed:", error);
  process.exit(1);
});

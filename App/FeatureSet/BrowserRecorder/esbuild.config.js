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
const zlib = require("zlib");

const packageJson = require("./package.json");

/*
 * Must stay identical to RECORDER_VERSION_PATTERN in src/Config.ts and
 * Manifest.ts. The version is interpolated into the artifact's URL path and
 * validated by the loader before it will build that URL, so a package.json
 * version this does not match would produce an artifact no loader will ever
 * request. Failing the build is the only place that can be caught.
 */
const RECORDER_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

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
 * The same allow-list expressed as absolute directories, for the RELATIVE
 * import check below. Files inside Common reach each other with relative
 * specifiers ("../../Types/Rum/SessionReplay"), which never match the
 * ^Common/ filter and so resolved natively and unchecked - meaning a future
 * `import Dictionary from "../../Types/Dictionary"` added inside a Rum module
 * would have been inlined silently into a bundle served to third-party
 * origins.
 */
const ALLOWED_COMMON_DIRECTORIES = [
  path.join(COMMON_ROOT, "Utils", "Rum"),
  path.join(COMMON_ROOT, "Types", "Rum"),
];

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
/*
 * Raised from 6 KB after three deliberate feature sets landed in the stub:
 * the pre-load early-error buffer, the host-defaulting + misconfiguration
 * warning from the end-to-end fixes, and the /telemetry-prefixed paths.
 * Measured 6345 bytes at the time of the raise; the gzip budget below is
 * unchanged and is the number a customer's browser actually pays.
 */
const LOADER_MAX_BYTES = 7 * 1024;
const RECORDER_MAX_BYTES = 320 * 1024;

/*
 * Gzip budgets, which are the numbers a customer's browser actually pays.
 * The raw budgets above were the only guard, and raw size is a poor proxy:
 * minified JavaScript compresses 3-4x, and by very different ratios
 * depending on what changed.
 *
 * Measured at the time of writing: recorder.js 227 KB raw / 70.7 KB gzip,
 * loader.js 4.7 KB raw / 1.9 KB gzip. Of the recorder's 70.7 KB, rrweb's
 * record entry point alone is 57.8 KB gzip (182 KB raw) with the Replayer,
 * xstate, the fflate packer and the canvas-webgl path all already tree-shaken
 * out; this package's own 15 modules are the remaining ~12.8 KB. The design
 * doc's ~52 KB estimate is therefore below rrweb's own floor and cannot be
 * met without forking rrweb - see README.md, "Bundle weight".
 *
 * The budgets are set just above the measured values so a regression fails
 * the build rather than being discovered in a customer's Core Web Vitals.
 */
const LOADER_MAX_GZIP_BYTES = 3 * 1024;
const RECORDER_MAX_GZIP_BYTES = 76 * 1024;

function isInside(directory, candidate) {
  const withSeparator = directory.endsWith(path.sep)
    ? directory
    : `${directory}${path.sep}`;

  return candidate === directory || candidate.startsWith(withSeparator);
}

function isAllowedCommonFile(absolutePath) {
  return ALLOWED_COMMON_DIRECTORIES.some((directory) => {
    return isInside(directory, absolutePath);
  });
}

/*
 * The catch-all resolver. Runs for EVERY specifier the first handler did not
 * claim, and only ever returns an error or nothing at all, so esbuild's own
 * resolution is unchanged for everything legitimate.
 *
 * Two escapes are closed here:
 *
 *   - a relative import from inside Common that lands outside the two Rum
 *     directories, and
 *   - a bare (package) specifier imported BY a Common module, since the
 *     inlined Rum modules are required to be dependency-free.
 *
 * The FORBIDDEN_IN_BUNDLE grep is a backstop for this, not a substitute: a
 * Common module carrying no express/typeorm/process.env token passes it.
 */
function resolveCommonEscape(args) {
  const importer = args.importer || "";
  const importerIsCommon = isInside(COMMON_ROOT, importer);
  const isRelative = args.path.startsWith(".");

  if (!isRelative) {
    if (!importerIsCommon || args.path.startsWith("Common/")) {
      return undefined;
    }

    return {
      errors: [
        {
          text:
            `${path.relative(COMMON_ROOT, importer)} imports the package ` +
            `"${args.path}". Common modules inlined into the browser ` +
            `recorder must be dependency-free.`,
        },
      ],
    };
  }

  const resolved = path.resolve(args.resolveDir, args.path);

  if (!isInside(COMMON_ROOT, resolved)) {
    return undefined;
  }

  if (isAllowedCommonFile(resolved)) {
    return undefined;
  }

  return {
    errors: [
      {
        text:
          `The browser recorder may not reach ` +
          `"Common/${path.relative(COMMON_ROOT, resolved)}" (imported as ` +
          `"${args.path}" from ${importer || "an entry point"}). Only ` +
          `${ALLOWED_COMMON_PREFIXES.join(", ")} are inlined; everything ` +
          `else in Common pulls server dependencies or reads ` +
          `window.process.env.`,
      },
    ],
  };
}

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

      build.onResolve({ filter: /.*/ }, resolveCommonEscape);
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

function assertBundleHygiene(filePath, maxBytes, maxGzipBytes) {
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

  /*
   * Gzip is measured over the SHIPPED code, not the file: a dev build's
   * inline sourcemap would otherwise blow the budget for a reason no
   * customer ever pays for.
   */
  const gzipBytes = zlib.gzipSync(Buffer.from(source, "utf8"), {
    level: 9,
  }).length;

  if (gzipBytes > maxGzipBytes) {
    throw new Error(
      `${path.basename(filePath)} is ${gzipBytes} bytes gzipped, over its ` +
        `${maxGzipBytes} byte budget. Gzip is what the customer's browser ` +
        `downloads.`,
    );
  }

  /* The whole file is what a browser downloads; the budget is code only. */
  return {
    codeBytes: bytes,
    gzipBytes: gzipBytes,
    fileBytes: fs.statSync(filePath).size,
  };
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

  /*
   * Asserted before anything is emitted. The version names the artifact's URL
   * path and the loader refuses to build that URL from anything that is not
   * this shape, so an unpublishable version must fail here rather than
   * produce an artifact nothing will ever fetch.
   */
  if (!RECORDER_VERSION_PATTERN.test(packageJson.version)) {
    throw new Error(
      `package.json version "${packageJson.version}" is not a semver the ` +
        `loader will accept. src/Config.ts validates recorderVersion against ` +
        `${RECORDER_VERSION_PATTERN} before it will build an artifact URL.`,
    );
  }

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

  const recorderSizes = assertBundleHygiene(
    recorderPath,
    RECORDER_MAX_BYTES,
    RECORDER_MAX_GZIP_BYTES,
  );
  const loaderSizes = assertBundleHygiene(
    loaderPath,
    LOADER_MAX_BYTES,
    LOADER_MAX_GZIP_BYTES,
  );

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
        gzipBytes: recorderSizes.gzipBytes,
        integrity: getSriHash(recorderPath),
      },
      "loader.js": {
        bytes: loaderSizes.fileBytes,
        gzipBytes: loaderSizes.gzipBytes,
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
    `✅ BrowserRecorder build complete — recorder.js ${recorderSizes.codeBytes} bytes ` +
      `(${recorderSizes.gzipBytes} gzip), loader.js ${loaderSizes.codeBytes} bytes ` +
      `(${loaderSizes.gzipBytes} gzip)`,
  );
}

/*
 * Only build when run as a script. Requiring this file (which
 * Tests/BundleHygiene.test.ts does, to unit-test the Common allow-list plugin
 * without paying for a full build) must not kick off a build as a side
 * effect. The Dockerfile and package.json still invoke it as a script, so the
 * exact file under test is the exact file that ships.
 */
if (require.main === module) {
  buildAll().catch((error) => {
    console.error("❌ BrowserRecorder build failed:", error);
    process.exit(1);
  });
}

module.exports = {
  ALLOWED_COMMON_PREFIXES,
  COMMON_ROOT,
  RECORDER_VERSION_PATTERN,
  RECORDER_MAX_GZIP_BYTES,
  LOADER_MAX_GZIP_BYTES,
  buildAll,
  createCommonRumInlinePlugin,
  resolveCommonEscape,
};

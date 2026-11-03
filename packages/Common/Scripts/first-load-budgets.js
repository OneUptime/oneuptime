/*
 * What a visitor downloads before a public page can draw, held to a budget.
 *
 *   node packages/Common/Scripts/first-load-budgets.js
 *
 * For each public page below - the sign-in and sign-up pages, a status page
 * and a public dashboard - it builds the page's frontend as its image does
 * (npm run analyze: NODE_ENV=production, which also writes esbuild's
 * metafile), follows the frontend's entry and the page's own chunk through
 * every chunk they import statically (a lazily loaded chunk waits for a
 * visit), and gzips each file as Nginx serves it (gzip_comp_level 5,
 * packages/Nginx/default.conf.template). A page over its ceiling fails the
 * run, naming the packages and folders that weigh the most in it.
 *
 * The Compile workflow's compile-frontends job runs it once the three
 * frontends' dependencies are installed (issue #5608). It measures bytes,
 * which a build gives the same every time, where a Lighthouse performance
 * score would move with the speed of the runner.
 *
 * Raising a ceiling is a decision: say beside it when and why, as
 * packages/App/FeatureSet/BrowserRecorder/Tests/BundleHygiene.test.ts does
 * for the browser recorder.
 */
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const FEATURE_SETS = path.resolve(__dirname, "..", "..", "App", "FeatureSet");

// Where the shared esbuild config writes a build, and its entry point.
const DIST = path.join("public", "dist");
const ENTRY = "src/Index.tsx";

// As Nginx compresses what it sends.
const GZIP_LEVEL = 5;

// How many of a page's heaviest packages and folders a failure names.
const HEAVIEST_NAMED = 8;

const KIB = 1024;

/*
 * The pages, each with its frontend, the chunk its route loads and its
 * ceiling in gzip bytes. Each ceiling was set about 2% above the page's size
 * on the date beside it, built as the Compile workflow builds it: a fresh
 * `npm install` of Common and of each frontend. A checkout whose installs
 * differ - older ones, or packages linked from one frontend into another's
 * node_modules for development - can measure tens of KiB either way, so
 * measure in fresh installs before moving a ceiling.
 */
const PAGES = [
  {
    frontend: "Accounts",
    page: "sign-in (/accounts/login)",
    route: "src/Pages/Login.tsx",
    // 2026-11-03: 1,264,535 bytes.
    ceiling: 1260 * KIB,
  },
  {
    frontend: "Accounts",
    page: "sign-up (/accounts/register)",
    route: "src/Pages/Register.tsx",
    // 2026-11-03: 1,260,250 bytes.
    ceiling: 1260 * KIB,
  },
  {
    frontend: "StatusPage",
    page: "a status page",
    route: "src/Pages/AllPages.tsx",
    // 2026-11-03: 1,362,136 bytes.
    ceiling: 1360 * KIB,
  },
  {
    frontend: "PublicDashboard",
    page: "a public dashboard",
    route: "src/Pages/AllPages.tsx",
    // 2026-11-03: 1,961,449 bytes.
    ceiling: 1960 * KIB,
  },
];

// The output file esbuild built from an entry point (the entry, or a route).
function outputFor(metafile, entryPoint) {
  const found = Object.entries(metafile.outputs).find(([, output]) => {
    return output.entryPoint === entryPoint;
  });

  if (!found) {
    throw new Error(
      `No output was built from ${entryPoint}: has it moved? Update PAGES in ${path.basename(__filename)}.`,
    );
  }

  return found[0];
}

/*
 * Every output the browser fetches before the page draws: the starting
 * outputs and everything they import statically, transitively. A dynamic
 * import is fetched when the code asks for it, so it is left out.
 */
function firstLoadOutputs(metafile, starts) {
  const seen = new Set();
  const waiting = [...starts];

  while (waiting.length > 0) {
    const file = waiting.pop();

    if (seen.has(file)) {
      continue;
    }

    seen.add(file);

    for (const imported of metafile.outputs[file].imports) {
      if (
        imported.kind === "import-statement" &&
        !imported.external &&
        metafile.outputs[imported.path]
      ) {
        waiting.push(imported.path);
      }
    }
  }

  return Array.from(seen).sort();
}

function gzipBytes(contents) {
  return zlib.gzipSync(contents, { level: GZIP_LEVEL }).length;
}

/*
 * What an input is part of: its package when it comes from node_modules (the
 * innermost, for a package installed inside another), else its folder, so a
 * failure names "moment-timezone" or "../../../Common/UI" rather than a
 * thousand files.
 */
function weightKey(input) {
  const packages = Array.from(
    input.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/g),
  );

  if (packages.length > 0) {
    return packages[packages.length - 1][1];
  }

  const parts = input.split("/");
  const upward = parts.filter((part) => {
    return part === "..";
  }).length;
  const folder = parts
    .slice(0, Math.min(parts.length - 1, upward + 2))
    .join("/");

  // A file at the top, or esbuild's own "<runtime>", is its own key.
  return folder || input;
}

// The packages and folders that weigh the most in some outputs, heaviest first.
function heaviest(metafile, outputs, count = HEAVIEST_NAMED) {
  const weights = new Map();

  for (const file of outputs) {
    for (const [input, { bytesInOutput }] of Object.entries(
      metafile.outputs[file].inputs,
    )) {
      const key = weightKey(input);
      weights.set(key, (weights.get(key) || 0) + bytesInOutput);
    }
  }

  return Array.from(weights.entries())
    .sort((first, second) => {
      return second[1] - first[1] || first[0].localeCompare(second[0]);
    })
    .slice(0, count)
    .map(([name, bytes]) => {
      return { name, bytes };
    });
}

/*
 * One page's first load: its outputs, their gzip bytes, and the ceiling's
 * verdict. readOutput reads a built file by its metafile path.
 */
function measurePage(metafile, page, readOutput) {
  const outputs = firstLoadOutputs(metafile, [
    outputFor(metafile, ENTRY),
    outputFor(metafile, page.route),
  ]);
  const bytes = outputs.reduce((sum, file) => {
    return sum + gzipBytes(readOutput(file));
  }, 0);

  return {
    ...page,
    outputs,
    bytes,
    over: bytes > page.ceiling,
    heaviest: bytes > page.ceiling ? heaviest(metafile, outputs) : [],
  };
}

function kib(bytes) {
  return `${(bytes / KIB).toFixed(1)} KiB`;
}

function describe(result) {
  const line = `${result.frontend} ${result.page}: ${kib(result.bytes)} gzipped in ${result.outputs.length} files, ceiling ${kib(result.ceiling)}`;

  if (!result.over) {
    return line;
  }

  return [
    `${line} - OVER by ${kib(result.bytes - result.ceiling)}.`,
    "  The heaviest packages and folders in it (before gzip):",
    ...result.heaviest.map(({ name, bytes }) => {
      return `    ${kib(bytes).padStart(12)}  ${name}`;
    }),
    "  Keep what this page does not need out of its static imports (import() it where it is used), or raise the ceiling in packages/Common/Scripts/first-load-budgets.js, saying when and why.",
  ].join("\n");
}

// Builds a frontend as its image does, with esbuild's metafile.
function buildFrontend(frontend) {
  const folder = path.join(FEATURE_SETS, frontend);
  const result = childProcess.spawnSync(
    process.execPath,
    ["esbuild.config.js"],
    {
      cwd: folder,
      env: { ...process.env, NODE_ENV: "production", analyze: "true" },
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`The ${frontend} build failed (exit ${result.status}).`);
  }

  return JSON.parse(
    fs.readFileSync(path.join(folder, DIST, "metafile.json"), "utf8"),
  );
}

function main() {
  const metafiles = new Map();
  const results = [];

  for (const page of PAGES) {
    if (!metafiles.has(page.frontend)) {
      metafiles.set(page.frontend, buildFrontend(page.frontend));
    }

    const folder = path.join(FEATURE_SETS, page.frontend);

    results.push(
      measurePage(metafiles.get(page.frontend), page, (file) => {
        return fs.readFileSync(path.join(folder, file));
      }),
    );
  }

  for (const result of results) {
    console.log(describe(result));
  }

  if (
    results.some((result) => {
      return result.over;
    })
  ) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  GZIP_LEVEL,
  PAGES,
  describe,
  firstLoadOutputs,
  heaviest,
  measurePage,
  outputFor,
  weightKey,
};

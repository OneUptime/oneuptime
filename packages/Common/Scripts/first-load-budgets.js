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
 * packages/Nginx/default.conf.template). Each page's line says how much is
 * left under its ceiling. A page over its ceiling fails the run, naming the
 * packages and folders that weigh the most in it, and one with less than 1%
 * of it left warns (WARNING_HEADROOM_SHARE).
 *
 * It builds every other frontend of the shared esbuild config too - the
 * Dashboard and the Admin Dashboard - and reads each build for a package it
 * bundles twice, from two installs (Common's and the frontend's own, say).
 * Common/UI/esbuild-single-copy.js gives each frontend Common's copy of a
 * package both install; a package OneUptime's own code still imports from
 * two installs fails the run, naming them and their versions (issue
 * #9335: a public dashboard carried two copies of recharts, one for
 * Common's charts and one for the Dashboard's widgets). A second copy that
 * only a package of the frontend's own install brings in is listed, and
 * does not fail it.
 *
 * The Compile workflow's compile-frontends job runs it once the
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
const { packagesFromSeveralInstalls } = require("../UI/esbuild-single-copy.js");

const FEATURE_SETS = path.resolve(__dirname, "..", "..", "App", "FeatureSet");

/*
 * Every frontend built from the shared esbuild config
 * (Common/UI/esbuild-config.js), each checked for a package it bundles from
 * two installs. The pages below are in three of them.
 */
const FRONTENDS = [
  "Accounts",
  "Dashboard",
  "AdminDashboard",
  "StatusPage",
  "PublicDashboard",
];

// Where the shared esbuild config writes a build, and its entry point.
const DIST = path.join("public", "dist");
const ENTRY = "src/Index.tsx";

// As Nginx compresses what it sends.
const GZIP_LEVEL = 5;

// How many of a page's heaviest packages and folders a failure names.
const HEAVIEST_NAMED = 8;

/*
 * A page with less than this share of its ceiling left still passes, and
 * warns (a GitHub annotation, on the run and on the pull request): the
 * pages crept up to their ceilings through merges no one of which failed,
 * until the next small change to the sign-up page would have (issue
 * #7615). Warned, the creep shows before a pull request fails on it.
 */
const WARNING_HEADROOM_SHARE = 0.01;

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
    // 2026-11-03: 1,119,050 bytes, loading the reader's language only (#5614).
    // 2026-11-03: 923,776 bytes, loading what it does not draw with where it is used (#5619).
    // 2026-11-04: 883,196 bytes, loading browser telemetry only where it is configured (#5619).
    // 2026-11-04: 786,737 bytes, loading code, Markdown and file fields only for a form that has one (#5619).
    // 2026-11-11: 773,606 bytes, hashing with crypto-js's SHA-256 alone, and loading the rules that set code apart in Arabic and Persian sentences only for those languages.
    // 2026-11-16: 727,932 bytes (783,588 on main that day, 4.8 KiB under 770 KiB), reading JSON and the Monitor model without every monitor type (#8821), and loading a rule's condition builder only for a rule's form (#7615).
    // 2026-11-23: 751,547 bytes, and the ceiling raised to about 2% above it. Since 17.1.0 (740,372 bytes) the form it draws asks the User model's lists which fields to draw and whether anybody may send it, and every model's lists are read with the product levels (#10289), with the product tables those read (5.4 KiB); the permissions they name, the levels' own among them (2.9 KiB); every date is written from OneUptime's time zone data, in the reader's language (1.6 KiB); any request may meet the refusal that waits for "confirm it's you" (#10155, 1.1 KiB); and the form's API client adds or takes off a list's single entries (0.9 KiB) and reads through a relation only what its reader may (0.5 KiB). The captcha loads only while the server asks for one (6.8 KiB), and the tables of no product not at all (1 KiB).
    ceiling: 750 * KIB,
  },
  {
    frontend: "Accounts",
    page: "sign-up (/accounts/register)",
    route: "src/Pages/Register.tsx",
    // 2026-11-03: 1,260,250 bytes.
    // 2026-11-03: 1,114,772 bytes, loading the reader's language only (#5614).
    // 2026-11-03: 929,191 bytes, loading what it does not draw with where it is used (#5619).
    // 2026-11-04: 887,494 bytes, loading browser telemetry only where it is configured (#5619).
    // 2026-11-04: 791,036 bytes, loading code, Markdown and file fields only for a form that has one (#5619).
    // 2026-11-11: 775,116 bytes, hashing with crypto-js's SHA-256 alone, and loading the rules that set code apart in Arabic and Persian sentences only for those languages.
    // 2026-11-16: 725,918 bytes (787,368 on main that day, 1.1 KiB under 770 KiB), reading JSON without every monitor type (#8821), loading a rule's condition builder only for a rule's form, and reading billing and the daily check-in from the page's configuration rather than the server's (#7615).
    ceiling: 725 * KIB,
  },
  {
    frontend: "StatusPage",
    page: "a status page",
    route: "src/Pages/AllPages.tsx",
    // 2026-11-03: 1,362,136 bytes.
    // 2026-11-03: 1,271,934 bytes, loading the reader's language only (#5614).
    // 2026-11-03: 1,101,030 bytes, loading what it does not draw with where it is used (#5619).
    // 2026-11-04: 1,059,516 bytes, loading browser telemetry only where it is configured (#5619).
    // 2026-11-04: 967,395 bytes, loading code, Markdown and file fields only for a form that has one (#5619).
    // 2026-11-16: 927,460 bytes (982,809 on main that day, 0.2 KiB under 960 KiB), reading JSON and the Monitor model without every monitor type (#8821), and loading a rule's condition builder only for a rule's form (#7615).
    // 2026-11-20: 952,251 bytes, and the ceiling raised to about 2% above it. Since 17.0.0 (946,666 bytes) the page loads tzdata 2026f (moment-timezone 0.6.6, #9999), which every time it shows is converted with - 1.1 KiB, enough alone to take it over 925 KiB; the models its pages read, and those they name, grown with the features since (a Kubernetes node's disk, new settings of monitors, projects and teams, and their permissions: 2.6 KiB); and the layer every tooltip is drawn on (#9769), the words for a name a project already has (#9674) and the Android mark (1.8 KiB).
    ceiling: 950 * KIB,
  },
  {
    frontend: "PublicDashboard",
    page: "a public dashboard",
    route: "src/Pages/AllPages.tsx",
    // 2026-11-03: 1,961,449 bytes.
    // 2026-11-03: 1,839,798 bytes, loading what it does not draw with where it is used (#5619).
    // 2026-11-04: 1,807,182 bytes, loading browser telemetry only where it is configured (#5619).
    // 2026-11-04: 1,720,563 bytes, loading code, Markdown and file fields only for a form that has one (#5619).
    // 2026-11-10: 1,535,455 bytes, loading the investigation drawer only when a chart opens it - a public dashboard never does - and the people picker only for a form that has one.
    // 2026-11-15: 1,497,302 bytes, loading a widget's settings only when they open - a public dashboard, which has no edit mode, never does - and the API client and a form's default names without the probe's and the lists' code.
    // 2026-11-16: 1,455,800 bytes (1,503,403 on main that day), reading JSON and the Monitor model without every monitor type (#8821), and loading a rule's condition builder only for a rule's form (#7615).
    // 2026-11-18: 1,315,342 bytes (1,443,146 on main that day), bundling one copy of recharts where Common's charts and the Dashboard's widgets each brought their own (#9335).
    // 2026-11-23: 1,377,224 bytes, and the ceiling raised to about 2% above it. Since 17.1.0 (1,329,669 bytes) its widgets draw more of their charts: a value axis stepped so no two ticks read alike, a PromQL query read as written (#6796), a retired cloud metric's query moved onto its successor, a Data Source widget's queries read in one place (about 12 KiB); the models they read have the product levels their lists are read with (#10289, 4.8 KiB), the permissions those name (2.8 KiB) and their resources' new fields (about 3 KiB); a dashboard that asks its visitors to sign in (#10250) words its sign-in pages in each of the 18 languages the page has every word of from its first render (Common/UI/Utils/VisitorLanguage: 6.4 KiB); every date is written from OneUptime's time zone data; and any request may meet the "confirm it's you" refusal (#10155, 1.1 KiB). The sign-in pages themselves load only when one is drawn (1.6 KiB), and the tables of no product not at all (1 KiB).
    ceiling: 1375 * KIB,
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

  const over = bytes > page.ceiling;

  return {
    ...page,
    outputs,
    bytes,
    over,
    // What is left under the ceiling: below zero when over it.
    headroom: page.ceiling - bytes,
    nearCeiling:
      !over && page.ceiling - bytes < page.ceiling * WARNING_HEADROOM_SHARE,
    heaviest: over ? heaviest(metafile, outputs) : [],
  };
}

function kib(bytes) {
  return `${(bytes / KIB).toFixed(1)} KiB`;
}

function describe(result) {
  const line = `${result.frontend} ${result.page}: ${kib(result.bytes)} gzipped in ${result.outputs.length} files, ceiling ${kib(result.ceiling)}`;

  if (!result.over) {
    return `${line}, ${kib(result.headroom)} under it`;
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

/*
 * A GitHub Actions workflow command's message, as the runner reads it: a
 * per cent sign and a line break are escaped, or "1%" would be read as an
 * escape of its own.
 */
function escapeAnnotation(message) {
  return message
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

// The warning a page close to its ceiling gives (WARNING_HEADROOM_SHARE).
function warnNearCeiling(result) {
  const share = `${Math.round(WARNING_HEADROOM_SHARE * 100)}%`;

  return `::warning title=First-load budget::${escapeAnnotation(
    `${result.frontend} ${result.page} is ${kib(result.headroom)} under its ceiling of ${kib(result.ceiling)}, less than ${share} of it: the next change that adds to what it loads first fails the Compile workflow. Keep what the page does not draw out of its static imports (import() it where it is used), as packages/Common/Scripts/first-load-budgets.js says beside its ceiling.`,
  )}`;
}

/*
 * A frontend's packages bundled from more than one install, read from its
 * metafile (packagesFromSeveralInstalls, Common/UI/esbuild-single-copy.js):
 * `twice`, those OneUptime's own code imports from more than one install,
 * which fail the run, and `alsoTwice`, those only packages of the
 * frontend's own install bring a second copy of, which do not.
 * versionOf(install, name) reads a copy's version (null when it cannot).
 */
function singleCopies(frontend, metafile, versionOf = () => null) {
  const found = packagesFromSeveralInstalls(metafile).map((bundled) => {
    return {
      ...bundled,
      installs: bundled.installs.map((copy) => {
        return { ...copy, version: versionOf(copy.install, bundled.name) };
      }),
    };
  });

  const importedFromSeveral = (bundled) => {
    return (
      bundled.installs.filter((copy) => {
        return copy.importedByOwnCode;
      }).length > 1
    );
  };

  return {
    frontend,
    twice: found.filter(importedFromSeveral),
    alsoTwice: found.filter((bundled) => {
      return !importedFromSeveral(bundled);
    }),
  };
}

// "3.8.1 (285.1 KiB) from <install> and 3.9.0 (284.6 KiB) from <install>"
function describeCopies(bundled) {
  return bundled.installs
    .map((copy) => {
      return `${copy.version ? `${copy.version} ` : ""}(${kib(copy.bytes)}) from ${copy.install}`;
    })
    .join(" and ");
}

function times(count) {
  return count === 2 ? "twice" : `${count} times`;
}

/*
 * What the run prints for one frontend's copies: a line that says it bundles
 * one copy of each package its code imports, or a failure for each package
 * it does not, saying what to do; and the second copies packages of its own
 * install bring, when there are any.
 */
function describeSingleCopies(result) {
  const lines =
    result.twice.length === 0
      ? [
          `${result.frontend} bundles one copy of each package its code imports.`,
        ]
      : result.twice.map((bundled) => {
          return [
            `${result.frontend} bundles ${bundled.name} ${times(bundled.installs.length)}, and its own code imports it from more than one install: ${describeCopies(bundled)}, before gzip.`,
            `  Common's copy stands in for another install's when Common installs the package and its copy has the same major version and is no older (packages/Common/UI/esbuild-single-copy.js). Run npm update ${bundled.name} where the copy is older, so one version serves both; a different major version needs the code on the older one moved to the newer.`,
          ].join("\n");
        });

  if (result.alsoTwice.length > 0) {
    lines.push(
      `  Packages of its own install also bring a second copy of ${result.alsoTwice
        .map((bundled) => {
          return `${bundled.name}: ${describeCopies(bundled)}`;
        })
        .join("; ")}.`,
    );
  }

  return lines;
}

/*
 * What the run prints for the pages it measured, and whether it fails: a
 * line for each page, and a warning for each that is close to its ceiling;
 * then, for each frontend checked for its copies (singleCopies), what
 * describeSingleCopies says of it. A page over its ceiling fails the run,
 * as does a package a frontend's code imports from two installs.
 */
function report(results, copies = []) {
  return {
    lines: [
      ...results.map(describe),
      ...results
        .filter((result) => {
          return result.nearCeiling;
        })
        .map(warnNearCeiling),
      ...copies.flatMap(describeSingleCopies),
    ],
    failed:
      results.some((result) => {
        return result.over;
      }) ||
      copies.some((result) => {
        return result.twice.length > 0;
      }),
  };
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

// The version of the copy of a package in an install, as a build names it.
function installedVersion(folder, install, name) {
  try {
    return (
      JSON.parse(
        fs.readFileSync(
          path.join(folder, install, name, "package.json"),
          "utf8",
        ),
      ).version || null
    );
  } catch (error) {
    return null;
  }
}

function main() {
  const results = [];
  const copies = [];

  // One frontend at a time: the Dashboard's metafile alone is some 28 MB.
  for (const frontend of FRONTENDS) {
    const metafile = buildFrontend(frontend);
    const folder = path.join(FEATURE_SETS, frontend);

    for (const page of PAGES) {
      if (page.frontend === frontend) {
        results.push(
          measurePage(metafile, page, (file) => {
            return fs.readFileSync(path.join(folder, file));
          }),
        );
      }
    }

    copies.push(
      singleCopies(frontend, metafile, (install, name) => {
        return installedVersion(folder, install, name);
      }),
    );
  }

  const { lines, failed } = report(results, copies);

  for (const line of lines) {
    console.log(line);
  }

  if (failed) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  FRONTENDS,
  GZIP_LEVEL,
  PAGES,
  WARNING_HEADROOM_SHARE,
  describe,
  describeSingleCopies,
  escapeAnnotation,
  firstLoadOutputs,
  heaviest,
  measurePage,
  outputFor,
  report,
  singleCopies,
  warnNearCeiling,
  weightKey,
};

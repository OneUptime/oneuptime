#!/usr/bin/env node

/*
 * `npm run compile-tests`, and the second half of `npm run compile`:
 * type-check every App test file - the program ../tsconfig.tests.json
 * describes - in parts, one tsc process per part, one after another. The
 * first half of `npm run compile` is tsc with ../tsconfig.json, which builds
 * the App's sources and leaves Tests out.
 *
 * Why parts. One tsc program keeps every file it has parsed, and every type
 * it has built, until it exits. The App's sources and tests were one program
 * until 2026-11-15, when it outgrew the compile's 8 GiB heap on main (#8503):
 * 16,441 files, about 9.7 GB, so the Compile workflow's Compile App step and
 * the image build's `RUN npm run compile` (Dockerfile.tpl) both ran out of
 * memory. A heap large enough for it does not fit the 16 GB GitHub runner
 * beside everything else a job runs, and the program grows by the day. Each
 * part holds only the sources its own tests reach. Measured that day, with a
 * heap large enough that nothing is collected early (tsc
 * --extendedDiagnostics, "Memory used"):
 *   - ../tsconfig.json (the sources, 11,067 files): 5.38 GB;
 *   - ../tsconfig.tests.dashboard.json (Tests/Dashboard, 11,201 files):
 *     4.95 GB;
 *   - Tests/FeatureSet and every other test together (13,747 files): 6.63 GB,
 *     too near the heap to leave as one, so they are two parts:
 *     ../tsconfig.tests.featureset.json and ../tsconfig.tests.rest.json.
 * When a part nears its heap, split it the same way, by directory, or by
 * name as packages/Common/Scripts/compile-tests.js does for a directory too
 * big for one part: add a tsconfig.tests.<name>.json, list it in PARTS, take
 * its files out of the part that had them, and give its directory a
 * tsconfig.json that extends it, for editors and ESLint.
 *
 * Nothing goes unchecked:
 *   - every part extends tsconfig.tests.json and changes only which files it
 *     holds, so a test is held to the same rules in whichever part it is;
 *   - before any part runs, this checks that the parts between them hold
 *     every root file of tsconfig.tests.json, so a part edited, renamed or
 *     dropped from PARTS cannot quietly stop a test from being checked (a
 *     file in two parts costs time, never correctness);
 *   - every part runs even when an earlier one fails, so one run reports
 *     every error, and the exit code is non-zero if any part failed.
 *
 * Arguments are passed on to every tsc run, e.g.
 * `npm run compile-tests -- --extendedDiagnostics`.
 */

const path = require("path");
const { spawnSync } = require("child_process");
const ts = require("typescript");

const APP_DIRECTORY = path.resolve(__dirname, "..");
const WHOLE_PROGRAM = "tsconfig.tests.json";
const PARTS = [
  "tsconfig.tests.dashboard.json",
  "tsconfig.tests.featureset.json",
  "tsconfig.tests.rest.json",
];
// Per part, as the sources' own compile has (package.json).
const HEAP_MB = 8192;
const TSC = path.join(
  APP_DIRECTORY,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

const formatHost = {
  getCanonicalFileName: (fileName) => {
    return fileName;
  },
  getCurrentDirectory: () => {
    return APP_DIRECTORY;
  },
  getNewLine: () => {
    return "\n";
  },
};

// The root files of a tsconfig, as tsc would read them: what "include" matches.
const readRootFiles = (configName) => {
  const diagnostics = [];
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(APP_DIRECTORY, configName),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    },
  );

  if (parsed) {
    diagnostics.push(...parsed.errors);
  }

  if (!parsed || diagnostics.length > 0) {
    console.error(
      `compile-tests: could not read ${configName}:\n` +
        ts.formatDiagnostics(diagnostics, formatHost),
    );
    process.exit(1);
  }

  return parsed.fileNames.map((fileName) => {
    return path.resolve(APP_DIRECTORY, fileName);
  });
};

const coveredFiles = new Set();

for (const part of PARTS) {
  for (const fileName of readRootFiles(part)) {
    coveredFiles.add(fileName);
  }
}

const uncheckedFiles = readRootFiles(WHOLE_PROGRAM).filter((fileName) => {
  return !coveredFiles.has(fileName);
});

if (uncheckedFiles.length > 0) {
  const shown = uncheckedFiles.slice(0, 20).map((fileName) => {
    return `  ${path.relative(APP_DIRECTORY, fileName)}`;
  });

  if (uncheckedFiles.length > shown.length) {
    shown.push(`  ... and ${uncheckedFiles.length - shown.length} more`);
  }

  console.error(
    `compile-tests: ${uncheckedFiles.length} file(s) of ${WHOLE_PROGRAM} are in none of its parts (${PARTS.join(", ")}), so nothing would type-check them:\n` +
      shown.join("\n") +
      `\nInclude them in one of the parts (see scripts/compile-tests.js).`,
  );
  process.exit(1);
}

const failedParts = [];

for (const part of PARTS) {
  console.log(`compile-tests: type-checking ${part}`);

  const result = spawnSync(
    process.execPath,
    [
      `--max-old-space-size=${HEAP_MB}`,
      TSC,
      "-p",
      part,
      ...process.argv.slice(2),
    ],
    { cwd: APP_DIRECTORY, stdio: "inherit" },
  );

  if (result.error) {
    failedParts.push(`${part} (${result.error.message})`);
  } else if (result.status !== 0) {
    failedParts.push(
      `${part} (${result.signal ? `killed by ${result.signal}` : `exit code ${result.status}`})`,
    );
  }
}

if (failedParts.length > 0) {
  console.error(`compile-tests: failed: ${failedParts.join(", ")}`);
  process.exit(1);
}

console.log(`compile-tests: every part of ${WHOLE_PROGRAM} type-checks`);

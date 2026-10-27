#!/usr/bin/env node

/*
 * `npm run compile-tests`: type-check every Common test file - the program
 * ../tsconfig.tests.json describes - in parts, one tsc process per part, one
 * after another. Run by the compile-common job of the Compile workflow.
 *
 * Why parts. One tsc program keeps every file it has parsed, and every type
 * it has built, until it exits, so its heap grows with the program, and this
 * program grows by the day: on 2026-10-05 (018fce020f) it was 14,863 files
 * and 4.9 million lines of TypeScript, 2.7 million of them the 4,554 test
 * files themselves. Checked as one program it needed 8.57 GB of live heap at
 * the end of the check - 99.8% of the 8 GiB heap it was given - and ran out
 * of memory there ("Reached heap limit"). On 2026-09-30, 3,697 test
 * files earlier, it had needed 7.26 GB. No file was to blame: the costliest
 * one built 1.5% of the program's types, and parsing and binding alone held
 * 4.76 GB. Raising the heap only moves that wall, and not far: the GitHub
 * runner has 16 GB, and the program was gaining close to 0.3 GB a day.
 *
 * Split, each part holds only the sources its own tests reach. On the same
 * commit, at the end of their checks:
 *   - ../tsconfig.tests.app.json (Tests/App, 10,364 files): 4.62 GB live;
 *   - ../tsconfig.tests.ui.json (Tests/UI, 7,864 files): 3.07 GB live;
 *   - ../tsconfig.tests.rest.json (everything else, 9,771 files): 5.07 GB.
 * Tests/App and Tests/UI are parts of their own because that is where the
 * growth is: checked together, the two went from 4.36 GB to 5.45 GB between
 * 2026-09-30 and 2026-10-05, the rest from 4.69 GB to 5.07 GB. The parts take
 * longer than the single program did - about 5 minutes against 3m20s on a
 * developer machine - because each checks the Common sources its tests share
 * with the others'. When a part nears its heap again, split it the same way:
 * add a tsconfig.tests.<name>.json, list it in PARTS, and exclude its
 * directory from tsconfig.tests.rest.json.
 *
 * On 2026-10-27 the rest did: 13,818 files needed 10.6 GB, and its check
 * ran out of its 8 GiB heap on master. Most of its tests were Tests/Server's,
 * which became two parts of its own. Memory used, with a heap large enough
 * that nothing is collected early:
 *   - ../tsconfig.tests.server.json (Tests/Server but its Utils, 10,040
 *     files): 5.38 GB;
 *   - ../tsconfig.tests.server-utils.json (Tests/Server/Utils, 8,804 files):
 *     4.71 GB;
 *   - ../tsconfig.tests.rest.json (what was left, 9,613 files): 4.26 GB.
 * Tests/App, at 8.84 GB the same way (13,990 files), was split the same day,
 * by name, because nearly all of it is one directory (Tests/App/Dashboard,
 * some 1,650 tests): ../tsconfig.tests.app-dashboard-a-m.json (Dashboard
 * tests A to M, 12,069 files): 5.67 GB; ../tsconfig.tests.app-rest.json
 * (every other App test, 12,053 files): 7.19 GB. The two share most of the
 * Dashboard sources, which is why halving the tests did not halve the
 * memory. tsconfig.tests.app.json stays the whole of Tests/App, the program
 * editors and ESLint use for it.
 *
 * Nothing goes unchecked:
 *   - every part extends tsconfig.tests.json and changes only which files it
 *     includes, so a test is held to the same rules in whichever part it is;
 *   - before any part runs, this checks that the parts between them hold
 *     every root file of tsconfig.tests.json, so a part edited, renamed or
 *     dropped from PARTS cannot quietly stop a test from being checked (a
 *     file in two parts costs time, never correctness);
 *   - every part runs even when an earlier one fails, so one run reports
 *     every error, as the single program did, and the exit code is non-zero
 *     if any part failed.
 *
 * tsconfig.tests.json itself stays the whole program, which the parts must
 * cover. Editors and ESLint's typed linting use the parts too, since
 * 2026-10-27: the tsconfig.json in Tests/App, Tests/UI, Tests/Server,
 * Tests/Server/Utils and Tests (the rest) each extend one, because ESLint
 * linting the whole program in one process ran out of its 12 GB heap. A part
 * added here gets a tsconfig.json of its own in its directory, the same way
 * (Tests/Scripts/LintTestPrograms.test.ts checks it).
 *
 * Arguments are passed on to every tsc run, e.g.
 * `npm run compile-tests -- --extendedDiagnostics`.
 */

const path = require("path");
const { spawnSync } = require("child_process");
const ts = require("typescript");

const COMMON_DIRECTORY = path.resolve(__dirname, "..");
const WHOLE_PROGRAM = "tsconfig.tests.json";
const PARTS = [
  "tsconfig.tests.app-dashboard-a-m.json",
  "tsconfig.tests.app-rest.json",
  "tsconfig.tests.ui.json",
  "tsconfig.tests.server.json",
  "tsconfig.tests.server-utils.json",
  "tsconfig.tests.rest.json",
];
/*
 * Per part. Node's default heap (about 4 GB) is too small for the larger
 * parts. On 2026-10-27 Tests/App as one part (13,990 files) used 7.64 GB of
 * these 8 GiB, so it is two (see above).
 */
const HEAP_MB = 8192;
const TSC = path.join(
  COMMON_DIRECTORY,
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
    return COMMON_DIRECTORY;
  },
  getNewLine: () => {
    return "\n";
  },
};

// The root files of a tsconfig, as tsc would read them: what "include" matches.
const readRootFiles = (configName) => {
  const diagnostics = [];
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(COMMON_DIRECTORY, configName),
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
    return path.resolve(COMMON_DIRECTORY, fileName);
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
    return `  ${path.relative(COMMON_DIRECTORY, fileName)}`;
  });

  if (uncheckedFiles.length > shown.length) {
    shown.push(`  ... and ${uncheckedFiles.length - shown.length} more`);
  }

  console.error(
    `compile-tests: ${uncheckedFiles.length} file(s) of ${WHOLE_PROGRAM} are in none of its parts (${PARTS.join(", ")}), so nothing would type-check them:\n` +
      shown.join("\n") +
      `\nInclude them in one of the parts (see Scripts/compile-tests.js).`,
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
    { cwd: COMMON_DIRECTORY, stdio: "inherit" },
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

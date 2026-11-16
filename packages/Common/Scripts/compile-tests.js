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
 * On 2026-11-15 the server part used 6.94 GiB of its 8 GiB heap (87%), and
 * its services' tests left it (#8631). As one part they used 6.09 GiB
 * (76%), so they are two by name, as the Dashboard tests are, and
 * ../tsconfig.tests.server-services.json is the whole folder, for editors
 * and ESLint. Measured as above (tsc --extendedDiagnostics, "Memory used"):
 *   - ../tsconfig.tests.server.json (Tests/Server but its Utils and
 *     Services, 11,044 files): 5.09 GiB;
 *   - ../tsconfig.tests.server-services-a-m.json (9,720 files): 4.59 GiB;
 *   - ../tsconfig.tests.server-services-n-z.json (9,984 files): 4.71 GiB.
 * Later that day server-utils (Tests/Server/Utils, 12,474 files) used 6.79
 * GiB (85%) (#8664). Its AI folder, the largest, left the rest at 6.30 GiB
 * (79%), so the AI tests are a part of their own and the rest is two by
 * name; ../tsconfig.tests.server-utils.json is the whole folder, for
 * editors and ESLint. Measured the same way:
 *   - ../tsconfig.tests.server-utils-ai.json (Tests/Server/Utils/AI, 9,433
 *     files): 4.62 GiB;
 *   - ../tsconfig.tests.server-utils-a-o.json (10,404 files): 4.84 GiB;
 *   - ../tsconfig.tests.server-utils-p-z.json (10,311 files): 5.23 GiB.
 * Tests/App, at 8.84 GB the same way (13,990 files), was split the same day,
 * by name, because nearly all of it is one directory (Tests/App/Dashboard,
 * some 1,650 tests): tsconfig.tests.app-dashboard-a-m.json (Dashboard
 * tests A to M, 12,069 files): 5.67 GB; ../tsconfig.tests.app-rest.json
 * (every other App test, 12,053 files): 7.19 GB. The two share most of the
 * Dashboard sources, which is why halving the tests did not halve the
 * memory. tsconfig.tests.app.json stays the whole of Tests/App, the program
 * editors and ESLint use for it.
 *
 * On 2026-11-15 (Tests/App/Dashboard at 2,573 tests) the App rest ran out of
 * its 8 GiB heap, with only Common installed as in the compile-common job,
 * and the A-to-M part used 7.49 GiB of it. Halving the rest was not enough
 * either: its Dashboard tests N to Z alone used 7.81 GiB. So the Dashboard
 * tests are five parts by name, and the App rest is every other App test:
 *   - ../tsconfig.tests.app-dashboard-a-d.json (13,526 files): 6.16 GiB;
 *   - ../tsconfig.tests.app-dashboard-e-l.json (12,586 files): 5.44 GiB;
 *   - ../tsconfig.tests.app-dashboard-m-o.json (12,517 files): 5.52 GiB;
 *   - ../tsconfig.tests.app-dashboard-p-r.json (12,031 files): 5.97 GiB;
 *   - ../tsconfig.tests.app-dashboard-s-z.json (13,142 files): 5.91 GiB;
 *   - ../tsconfig.tests.app-rest.json (10,317 files): 4.65 GiB.
 * Each takes about two minutes here. When one nears its heap, draw its
 * letters across two parts the same way.
 *
 * Later on 2026-11-15 (#8760) the A-to-D part used 6.45 GiB (81%) and the
 * S-to-Z one 6.34 GiB (79%), measured as the server parts are. A to C as
 * one part still used 6.27 GiB (78%): most of a part is the Dashboard
 * sources its tests share, so A is a part of its own. Now:
 *   - ../tsconfig.tests.app-dashboard-a.json (12,516 files): 5.03 GiB;
 *   - ../tsconfig.tests.app-dashboard-b-c.json (11,408 files): 4.94 GiB;
 *   - ../tsconfig.tests.app-dashboard-d.json (11,498 files): 4.93 GiB;
 *   - ../tsconfig.tests.app-dashboard-s.json (11,958 files): 5.25 GiB;
 *   - ../tsconfig.tests.app-dashboard-t-z.json (12,207 files): 5.14 GiB.
 * The next day (#8776) the other three followed: E to L used 5.68 GiB
 * (71%), M to O 5.87 GiB (73%) and P to R 6.39 GiB (80%). Now:
 *   - ../tsconfig.tests.app-dashboard-e-h.json (11,512 files): 5.10 GiB;
 *   - ../tsconfig.tests.app-dashboard-i-l.json (12,196 files): 4.95 GiB;
 *   - ../tsconfig.tests.app-dashboard-m.json (11,672 files): 4.80 GiB;
 *   - ../tsconfig.tests.app-dashboard-n-o.json (11,358 files): 5.16 GiB;
 *   - ../tsconfig.tests.app-dashboard-p.json (11,115 files): 5.50 GiB, the
 *     most of any Dashboard part for its 130 tests: the next to split;
 *   - ../tsconfig.tests.app-dashboard-q-r.json (11,382 files): 4.94 GiB.
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
 * How close each part is to its heap. The first sign of a part outgrowing
 * its heap used to be a red Compile job with an out-of-memory trace and no
 * type errors, and finding which part, and how close the others were, took
 * a 25-minute run (#8404). So every part runs with tsc's --diagnostics, and
 * after it this prints the "Memory used" tsc reports - its heap at the end
 * of the check, which is when a tsc program is largest - next to the
 * part's result, and a table of every part at the end:
 *   - a part past WARN_AT (85%) of HEAP_MB gets a warning (a GitHub
 *     ::warning:: annotation in CI) naming it and saying to split it, the
 *     way the paragraphs above did, before it runs out;
 *   - a part killed by a signal is reported as having run out of memory
 *     (SIGABRT is V8 reaching its heap limit, SIGKILL most likely the
 *     runner's kernel out of memory), not as type errors, and by name (a
 *     ::error:: annotation in CI).
 * Tests/Scripts/CompileTestsReport.test.ts runs it with a stub tsc.
 *
 * Arguments are passed on to every tsc run, e.g.
 * `npm run compile-tests -- --extendedDiagnostics` (which reports "Memory
 * used" too, so --diagnostics is then not added).
 */

const path = require("path");
const { spawn } = require("child_process");
const ts = require("typescript");

const COMMON_DIRECTORY = path.resolve(__dirname, "..");
const WHOLE_PROGRAM = "tsconfig.tests.json";
const PARTS = [
  "tsconfig.tests.app-dashboard-a.json",
  "tsconfig.tests.app-dashboard-b-c.json",
  "tsconfig.tests.app-dashboard-d.json",
  "tsconfig.tests.app-dashboard-e-h.json",
  "tsconfig.tests.app-dashboard-i-l.json",
  "tsconfig.tests.app-dashboard-m.json",
  "tsconfig.tests.app-dashboard-n-o.json",
  "tsconfig.tests.app-dashboard-p.json",
  "tsconfig.tests.app-dashboard-q-r.json",
  "tsconfig.tests.app-dashboard-s.json",
  "tsconfig.tests.app-dashboard-t-z.json",
  "tsconfig.tests.app-rest.json",
  "tsconfig.tests.ui.json",
  "tsconfig.tests.server.json",
  "tsconfig.tests.server-services-a-m.json",
  "tsconfig.tests.server-services-n-z.json",
  "tsconfig.tests.server-utils-a-o.json",
  "tsconfig.tests.server-utils-p-z.json",
  "tsconfig.tests.server-utils-ai.json",
  "tsconfig.tests.rest.json",
];
/*
 * Per part. Node's default heap (about 4 GB) is too small for the larger
 * parts. On 2026-10-27 Tests/App as one part (13,990 files) used 7.64 GB of
 * these 8 GiB, so it is two (see above).
 */
const HEAP_MB = 8192;
// The share of HEAP_MB past which a part is warned about: time to split it.
const WARN_AT = 0.85;
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

// Every root file of the whole program must be in one of the parts.
const checkPartsCoverTheProgram = () => {
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
};

/*
 * ---------------------------------------------------------------------------
 * Each part's memory, read from tsc and reported.
 * ---------------------------------------------------------------------------
 */

/*
 * tsc's --diagnostics line "Memory used:  6123456K": its heap in use when the
 * check ended, in thousands of bytes (statisticValue in tsc).
 */
const MEMORY_USED_LINE = /^Memory used:\s+(\d+)K\s*$/;
const BYTES_PER_MIB = 1024 * 1024;
const BYTES_PER_GIB = 1024 * BYTES_PER_MIB;

// The bytes a line of tsc's output says were used, or null when it is not that line.
const memoryUsedOf = (line) => {
  const match = MEMORY_USED_LINE.exec(line);

  return match ? Number(match[1]) * 1000 : null;
};

const gibibytes = (bytes) => {
  return `${(bytes / BYTES_PER_GIB).toFixed(2)} GiB`;
};

const heapOf = (heapMb) => {
  return `${Number((heapMb / 1024).toFixed(2))} GiB`;
};

const percentOf = (bytes, heapMb) => {
  return Math.round((bytes / (heapMb * BYTES_PER_MIB)) * 100);
};

// Whether the arguments given already have tsc report its statistics.
const reportsStatistics = (args) => {
  return args.some((arg) => {
    return /^--(?:extended)?diagnostics$/i.test(arg);
  });
};

/*
 * Type-checks one part: tsc with the part's heap, its output passed on as
 * it comes and read for "Memory used". Resolves to what happened.
 */
const runPart = ({ part, tsc, heapMb, args, cwd, env, stdout }) => {
  return new Promise((resolve) => {
    let memoryUsed = null;
    let partialLine = "";
    const readLine = (line) => {
      const bytes = memoryUsedOf(line.replace(/\r$/, ""));

      if (bytes !== null) {
        memoryUsed = bytes;
      }
    };
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${heapMb}`,
        tsc,
        "-p",
        part,
        ...(reportsStatistics(args) ? [] : ["--diagnostics"]),
        ...args,
      ],
      { cwd: cwd, env: env, stdio: ["ignore", "pipe", "inherit"] },
    );

    child.stdout.on("data", (chunk) => {
      stdout.write(chunk);

      const lines = (partialLine + chunk.toString("utf8")).split("\n");

      partialLine = lines.pop();
      lines.forEach(readLine);
    });

    child.on("error", (error) => {
      resolve({ part, status: null, signal: null, error, memoryUsed });
    });

    child.on("close", (status, signal) => {
      readLine(partialLine);
      resolve({ part, status, signal, error: null, memoryUsed });
    });
  });
};

/*
 * What to say about a part that ran: its result and its memory on one line,
 * and a warning or an error of its own when it is near its heap or ran out
 * of it - as GitHub annotations when `annotate`, so the job's summary names
 * the part. Returns the lines and whether the part failed.
 */
const reportPart = (result, { heapMb, warnAt, annotate }) => {
  const { part, status, signal, error, memoryUsed } = result;
  const heap = heapOf(heapMb);
  const lines = [];
  const say = (level, title, message) => {
    lines.push(
      annotate
        ? `::${level} title=${title}::${message}`
        : `compile-tests: ${level}: ${message}`,
    );
  };
  const used =
    memoryUsed === null
      ? "tsc did not say how much memory it used"
      : `it used ${gibibytes(memoryUsed)} of its ${heap} heap (${percentOf(memoryUsed, heapMb)}%)`;
  const splitIt =
    "split it the way Scripts/compile-tests.js explains: a tsconfig.tests.<name>.json of its own for some of its tests, listed in PARTS";
  /*
   * V8 aborts (SIGABRT, or 134 through a shell) when it reaches its heap
   * limit; the kernel kills (SIGKILL) a process when the runner runs out.
   */
  const outOfMemory =
    signal === "SIGABRT" || signal === "SIGKILL" || status === 134;

  if (error) {
    lines.push(`compile-tests: ${part} did not run: ${error.message}`);

    return { failed: true, lines };
  }

  if (outOfMemory) {
    const how =
      signal === "SIGKILL"
        ? "was killed (SIGKILL), most likely because the machine ran out of memory,"
        : `ran out of its ${heap} heap (${signal ? `killed by ${signal}` : `exit code ${status}`})`;

    lines.push(
      `compile-tests: ${part} ${how} before it finished type-checking: that is not a type error in its tests`,
    );
    say(
      "error",
      `${part} ran out of memory`,
      `${part} ${how} before it finished type-checking, so its tests were not checked: ${splitIt}.`,
    );

    return { failed: true, lines };
  }

  let failed = true;

  if (signal) {
    lines.push(
      `compile-tests: ${part} was stopped by ${signal} before it finished type-checking`,
    );
  } else if (status !== 0) {
    lines.push(
      `compile-tests: ${part} does not type-check (exit code ${status}; tsc says why above); ${used}`,
    );
  } else {
    failed = false;
    lines.push(`compile-tests: ${part} type-checks; ${used}`);
  }

  if (memoryUsed !== null && memoryUsed > warnAt * heapMb * BYTES_PER_MIB) {
    say(
      "warning",
      `${part} is near its heap`,
      `${part} used ${gibibytes(memoryUsed)} of its ${heap} heap (${percentOf(memoryUsed, heapMb)}%, past ${Math.round(warnAt * 100)}%): ${splitIt}, before it runs out.`,
    );
  }

  return { failed, lines };
};

// The table after every part has run: each one's memory, and its share of the heap.
const memoryTable = (results, { heapMb }) => {
  const width = Math.max(
    0,
    ...results.map((result) => {
      return result.part.length;
    }),
  );

  return [
    `compile-tests: memory each part used, of its ${heapOf(heapMb)} heap:`,
    ...results.map((result) => {
      const memory =
        result.memoryUsed === null
          ? "not reported"
          : `${gibibytes(result.memoryUsed).padStart(9)} ${`${percentOf(result.memoryUsed, heapMb)}%`.padStart(4)}`;

      return `  ${result.part.padEnd(width)}  ${memory}`;
    }),
  ];
};

/*
 * Runs every part, one after another, even after one fails, so one run
 * reports every error, and says what each did. Resolves to whether any
 * failed, and each part's result.
 */
const runParts = async ({
  parts,
  tsc = TSC,
  heapMb = HEAP_MB,
  warnAt = WARN_AT,
  args = [],
  cwd = COMMON_DIRECTORY,
  env = process.env,
  stdout = process.stdout,
  log = console.log,
}) => {
  const annotate = env.GITHUB_ACTIONS === "true";
  const results = [];
  const failedParts = [];

  for (const part of parts) {
    log(`compile-tests: type-checking ${part}`);

    const result = await runPart({
      part,
      tsc,
      heapMb,
      args,
      cwd,
      env,
      stdout,
    });
    const report = reportPart(result, { heapMb, warnAt, annotate });

    results.push(result);
    report.lines.forEach((line) => {
      log(line);
    });

    if (report.failed) {
      failedParts.push(part);
    }
  }

  memoryTable(results, { heapMb }).forEach((line) => {
    log(line);
  });

  if (failedParts.length > 0) {
    log(`compile-tests: failed: ${failedParts.join(", ")}`);
  }

  return { failed: failedParts.length > 0, results };
};

const main = async () => {
  checkPartsCoverTheProgram();

  const { failed } = await runParts({
    parts: PARTS,
    args: process.argv.slice(2),
  });

  if (failed) {
    process.exit(1);
  }

  console.log(`compile-tests: every part of ${WHOLE_PROGRAM} type-checks`);
};

module.exports = {
  HEAP_MB,
  PARTS,
  WARN_AT,
  memoryTable,
  memoryUsedOf,
  reportPart,
  runParts,
};

if (require.main === module) {
  main();
}

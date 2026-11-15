import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * Scripts/compile-tests.js type-checks Common's tests in parts, each in a
 * tsc with an 8 GiB heap, and says how much of it each part used (#8404):
 * the first sign of a part outgrowing its heap used to be a red Compile job
 * with an out-of-memory trace and no type errors. These run its runParts
 * with a stub tsc - a node script that prints a given "Memory used" and
 * exits with a given code or signal, by the part it is handed - the way
 * the script runs tsc: a node subprocess with the part's heap.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");
const SCRIPT: string = path.join(COMMON_ROOT, "Scripts", "compile-tests.js");
const REAL_TSC: string = path.join(
  COMMON_ROOT,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

/*
 * A heap of 1,000 MiB in the runs below: 85% of it is 891,289,600 bytes, so
 * 500000K is 48%, 850000K is 81% (under), 950000K is 91% (over).
 */
const HEAP_MB: number = 1000;

/*
 * The stub tsc. What it does is named by the part it is handed (-p):
 * "<memory>K-exit<code>", "abort", "kill", "silent", or "split" (its
 * "Memory used" line written in two pieces, as a pipe may hand it over).
 * It records the arguments it was run with in calls.jsonl.
 */
const STUB_TSC: string = `
const fs = require("fs");
const path = require("path");
const part = process.argv[process.argv.indexOf("-p") + 1];
fs.appendFileSync(
  path.join(__dirname, "calls.jsonl"),
  JSON.stringify({ part, argv: process.argv.slice(2), execArgv: process.execArgv }) + "\\n",
);
const printed = /^(\\d+)K-exit(\\d+)$/.exec(part);
if (printed) {
  if (printed[2] !== "0") {
    process.stdout.write("Tests/App/Some.test.ts(1,7): error TS2322: Type 'number' is not assignable to type 'string'.\\n");
  }
  process.stdout.write("Files:                       12\\nLines of TypeScript:        345\\n");
  process.stdout.write("Memory used:            " + printed[1] + "K\\nCheck time:                1.23s\\n");
  process.exit(Number(printed[2]));
}
if (part === "abort") {
  process.stdout.write("Memory used so far is not reported when V8 aborts\\n");
  process.kill(process.pid, "SIGABRT");
}
if (part === "kill") {
  process.kill(process.pid, "SIGKILL");
}
if (part === "silent") {
  process.exit(0);
}
if (part === "split") {
  process.stdout.write("Files: 3\\nMemory us");
  setTimeout(() => {
    process.stdout.write("ed:   700000K");
    setTimeout(() => process.exit(0), 50);
  }, 50);
}
`;

let directory: string = "";
let stubTsc: string = "";

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "compile-tests-report-"));
  stubTsc = path.join(directory, "stub-tsc.js");
  fs.writeFileSync(stubTsc, STUB_TSC);
});

afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

interface PartsRun {
  status: number;
  // What tsc wrote to its stderr, which the script leaves to it.
  stderr: string;
  // What runParts logged, one entry a line.
  log: Array<string>;
  // What tsc printed, passed through.
  passedThrough: string;
  failed: boolean;
  memoryUsed: Array<number | null>;
  calls: Array<{ part: string; argv: Array<string>; execArgv: Array<string> }>;
}

/*
 * Runs runParts in a node subprocess (the script runs nothing when it is
 * required rather than run) over `parts`, with the stub tsc unless another
 * is given.
 */
function runParts(
  parts: Array<string>,
  options: {
    githubActions?: boolean;
    args?: Array<string>;
    tsc?: string;
    cwd?: string;
  } = {},
): PartsRun {
  fs.rmSync(path.join(directory, "calls.jsonl"), { force: true });

  const program: string = [
    `const { runParts } = require(${JSON.stringify(SCRIPT)});`,
    "const log = [];",
    "let passedThrough = '';",
    "runParts({",
    `  parts: ${JSON.stringify(parts)},`,
    `  tsc: ${JSON.stringify(options.tsc || stubTsc)},`,
    `  heapMb: ${HEAP_MB},`,
    `  args: ${JSON.stringify(options.args || [])},`,
    `  cwd: ${JSON.stringify(options.cwd || directory)},`,
    `  env: { ...process.env, GITHUB_ACTIONS: ${JSON.stringify(options.githubActions ? "true" : "")} },`,
    "  stdout: { write: (chunk) => { passedThrough += chunk.toString(); } },",
    "  log: (line) => { log.push(line); },",
    "}).then(({ failed, results }) => {",
    "  process.stdout.write(JSON.stringify({ log, passedThrough, failed, memoryUsed: results.map((r) => r.memoryUsed) }));",
    "});",
  ].join("\n");
  const result: childProcess.SpawnSyncReturns<string> = childProcess.spawnSync(
    process.execPath,
    ["-e", program],
    { cwd: directory, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );

  const output: Omit<PartsRun, "status" | "stderr" | "calls"> = JSON.parse(
    result.stdout,
  );
  const callsFile: string = path.join(directory, "calls.jsonl");

  return {
    status: result.status === null ? -1 : result.status,
    stderr: result.stderr,
    ...output,
    calls: fs.existsSync(callsFile)
      ? fs
          .readFileSync(callsFile, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line: string) => {
            return JSON.parse(line);
          })
      : [],
  };
}

describe("a part under 85% of its heap", () => {
  test("prints its memory next to its result, and warns of nothing", () => {
    const run: PartsRun = runParts(["500000K-exit0"]);

    expect(run.failed).toBe(false);
    expect(run.stderr).toBe("");
    expect(run.memoryUsed).toEqual([500000000]);
    expect(run.log).toEqual([
      "compile-tests: type-checking 500000K-exit0",
      "compile-tests: 500000K-exit0 type-checks; it used 0.47 GiB of its 0.98 GiB heap (48%)",
      "compile-tests: memory each part used, of its 0.98 GiB heap:",
      "  500000K-exit0   0.47 GiB  48%",
    ]);
  });

  test("up to the line, and not past it, is still under it", () => {
    // 891,289,600 bytes is 85% exactly; 891289K is just under.
    const run: PartsRun = runParts(["891289K-exit0", "850000K-exit0"], {
      githubActions: true,
    });

    expect(run.failed).toBe(false);
    expect(
      run.log.filter((line: string) => {
        return line.startsWith("::");
      }),
    ).toEqual([]);
  });

  test("its tsc runs with the part's heap, -p and --diagnostics, and its output passes through", () => {
    const run: PartsRun = runParts(["500000K-exit0"], {
      args: ["--pretty", "false"],
    });

    expect(run.calls).toEqual([
      {
        part: "500000K-exit0",
        argv: ["-p", "500000K-exit0", "--diagnostics", "--pretty", "false"],
        execArgv: [`--max-old-space-size=${HEAP_MB}`],
      },
    ]);
    expect(run.passedThrough).toContain(
      "Memory used:            500000K\nCheck time:",
    );
  });

  test("--diagnostics is not added again when the arguments ask for --extendedDiagnostics or --diagnostics", () => {
    for (const flag of ["--extendedDiagnostics", "--diagnostics"]) {
      const run: PartsRun = runParts(["500000K-exit0"], { args: [flag] });

      expect(run.calls[0]!.argv).toEqual(["-p", "500000K-exit0", flag]);
      expect(run.memoryUsed).toEqual([500000000]);
    }
  });

  test("a Memory used line handed over in two pieces is still read", () => {
    const run: PartsRun = runParts(["split"]);

    expect(run.memoryUsed).toEqual([700000000]);
    expect(run.log).toContain(
      "compile-tests: split type-checks; it used 0.65 GiB of its 0.98 GiB heap (67%)",
    );
  });

  test("a tsc that says nothing of its memory is reported as such, not as a failure", () => {
    const run: PartsRun = runParts(["silent"], { githubActions: true });

    expect(run.failed).toBe(false);
    expect(run.log).toEqual([
      "compile-tests: type-checking silent",
      "compile-tests: silent type-checks; tsc did not say how much memory it used",
      "compile-tests: memory each part used, of its 0.98 GiB heap:",
      "  silent  not reported",
    ]);
  });
});

describe("a part over 85% of its heap", () => {
  test("warns with a GitHub annotation in CI, naming the part and saying to split it", () => {
    const run: PartsRun = runParts(["500000K-exit0", "950000K-exit0"], {
      githubActions: true,
    });

    expect(run.failed).toBe(false);
    expect(run.log).toEqual([
      "compile-tests: type-checking 500000K-exit0",
      "compile-tests: 500000K-exit0 type-checks; it used 0.47 GiB of its 0.98 GiB heap (48%)",
      "compile-tests: type-checking 950000K-exit0",
      "compile-tests: 950000K-exit0 type-checks; it used 0.88 GiB of its 0.98 GiB heap (91%)",
      "::warning title=950000K-exit0 is near its heap::950000K-exit0 used 0.88 GiB of its 0.98 GiB heap (91%, past 85%): split it the way Scripts/compile-tests.js explains: a tsconfig.tests.<name>.json of its own for some of its tests, listed in PARTS, before it runs out.",
      "compile-tests: memory each part used, of its 0.98 GiB heap:",
      "  500000K-exit0   0.47 GiB  48%",
      "  950000K-exit0   0.88 GiB  91%",
    ]);
  });

  test("warns in plain words outside CI", () => {
    const run: PartsRun = runParts(["950000K-exit0"]);

    expect(run.log).toContain(
      "compile-tests: warning: 950000K-exit0 used 0.88 GiB of its 0.98 GiB heap (91%, past 85%): split it the way Scripts/compile-tests.js explains: a tsconfig.tests.<name>.json of its own for some of its tests, listed in PARTS, before it runs out.",
    );
    expect(
      run.log.filter((line: string) => {
        return line.startsWith("::");
      }),
    ).toEqual([]);
  });

  test("with type errors too, says both, and the part fails", () => {
    const run: PartsRun = runParts(["950000K-exit2"], { githubActions: true });

    expect(run.failed).toBe(true);
    expect(run.passedThrough).toContain("error TS2322");
    expect(run.log).toContain(
      "compile-tests: 950000K-exit2 does not type-check (exit code 2; tsc says why above); it used 0.88 GiB of its 0.98 GiB heap (91%)",
    );
    expect(run.log).toContain(
      "::warning title=950000K-exit2 is near its heap::950000K-exit2 used 0.88 GiB of its 0.98 GiB heap (91%, past 85%): split it the way Scripts/compile-tests.js explains: a tsconfig.tests.<name>.json of its own for some of its tests, listed in PARTS, before it runs out.",
    );
    expect(run.log).toContain("compile-tests: failed: 950000K-exit2");
  });
});

describe("a part killed by a signal", () => {
  test("SIGABRT, V8 at its heap limit: it ran out of memory, by name, and not a type error", () => {
    const run: PartsRun = runParts(
      ["500000K-exit0", "abort", "600000K-exit0"],
      {
        githubActions: true,
      },
    );

    expect(run.failed).toBe(true);
    expect(run.log).toEqual([
      "compile-tests: type-checking 500000K-exit0",
      "compile-tests: 500000K-exit0 type-checks; it used 0.47 GiB of its 0.98 GiB heap (48%)",
      "compile-tests: type-checking abort",
      "compile-tests: abort ran out of its 0.98 GiB heap (killed by SIGABRT) before it finished type-checking: that is not a type error in its tests",
      "::error title=abort ran out of memory::abort ran out of its 0.98 GiB heap (killed by SIGABRT) before it finished type-checking, so its tests were not checked: split it the way Scripts/compile-tests.js explains: a tsconfig.tests.<name>.json of its own for some of its tests, listed in PARTS.",
      // The parts after it still run, so one run reports every error.
      "compile-tests: type-checking 600000K-exit0",
      "compile-tests: 600000K-exit0 type-checks; it used 0.56 GiB of its 0.98 GiB heap (57%)",
      "compile-tests: memory each part used, of its 0.98 GiB heap:",
      "  500000K-exit0   0.47 GiB  48%",
      "  abort          not reported",
      "  600000K-exit0   0.56 GiB  57%",
      "compile-tests: failed: abort",
    ]);
  });

  test("SIGKILL, most likely the machine out of memory: said so, by name", () => {
    const run: PartsRun = runParts(["kill"], { githubActions: true });

    expect(run.failed).toBe(true);
    expect(run.log).toContain(
      "compile-tests: kill was killed (SIGKILL), most likely because the machine ran out of memory, before it finished type-checking: that is not a type error in its tests",
    );
    expect(run.log).toContain(
      "::error title=kill ran out of memory::kill was killed (SIGKILL), most likely because the machine ran out of memory, before it finished type-checking, so its tests were not checked: split it the way Scripts/compile-tests.js explains: a tsconfig.tests.<name>.json of its own for some of its tests, listed in PARTS.",
    );
  });

  test("outside CI, the out-of-memory error is said in plain words", () => {
    const run: PartsRun = runParts(["abort"]);

    expect(run.log).toContain(
      "compile-tests: error: abort ran out of its 0.98 GiB heap (killed by SIGABRT) before it finished type-checking, so its tests were not checked: split it the way Scripts/compile-tests.js explains: a tsconfig.tests.<name>.json of its own for some of its tests, listed in PARTS.",
    );
  });
});

describe("a part that cannot be run", () => {
  test("a missing tsc fails the part, and says so", () => {
    const run: PartsRun = runParts(["500000K-exit0"], {
      tsc: path.join(directory, "no-such-tsc.js"),
    });

    expect(run.failed).toBe(true);
    expect(run.stderr).toContain("Cannot find module");
    expect(run.log).toContain(
      "compile-tests: 500000K-exit0 does not type-check (exit code 1; tsc says why above); tsc did not say how much memory it used",
    );
  });
});

describe("the real tsc", () => {
  test("prints the Memory used line the script reads, under --diagnostics", () => {
    const project: string = path.join(directory, "project");

    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      path.join(project, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { noEmit: true, strict: true, types: [] },
        files: ["index.ts"],
      }),
    );
    fs.writeFileSync(
      path.join(project, "index.ts"),
      "export const answer: number = 42;\n",
    );

    const run: PartsRun = runParts(["tsconfig.json"], {
      tsc: REAL_TSC,
      cwd: project,
    });

    expect(run.failed).toBe(false);
    expect(run.passedThrough).toMatch(/^Memory used:\s+\d+K$/m);
    expect(run.memoryUsed).toHaveLength(1);
    expect(run.memoryUsed[0]).toBeGreaterThan(1000000);
    expect(run.log[1]).toMatch(
      /^compile-tests: tsconfig\.json type-checks; it used \d+\.\d\d GiB of its 0\.98 GiB heap \(\d+%\)$/,
    );
  });
});

describe("the script's own settings", () => {
  test("each part has an 8 GiB heap, warned about past 85%, and is a part of the whole program", () => {
    const run: childProcess.SpawnSyncReturns<string> = childProcess.spawnSync(
      process.execPath,
      [
        "-e",
        `const m = require(${JSON.stringify(SCRIPT)}); process.stdout.write(JSON.stringify({ heap: m.HEAP_MB, warnAt: m.WARN_AT, parts: m.PARTS }));`,
      ],
      { cwd: COMMON_ROOT, encoding: "utf8" },
    );
    const settings: { heap: number; warnAt: number; parts: Array<string> } =
      JSON.parse(run.stdout);

    expect(settings.heap).toBe(8192);
    expect(settings.warnAt).toBe(0.85);
    expect(settings.parts.length).toBeGreaterThan(1);

    for (const part of settings.parts) {
      expect(fs.existsSync(path.join(COMMON_ROOT, part))).toBe(true);
    }
  });

  test("the Compile workflow runs it, and nothing else type-checks Common's tests in its place", () => {
    const workflow: string = fs.readFileSync(
      path.join(COMMON_ROOT, "..", "..", ".github", "workflows", "compile.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      "run: cd packages/Common && npm run compile-tests",
    );
  });
});

"use strict";

/**
 * No jest run CI starts passes --detectOpenHandles.
 *
 * The flag is jest's tool for finding the handle that keeps a run from
 * exiting. Jest's documentation says it "has a significant performance
 * penalty and should only be used for debugging", and it never turns a pass
 * into a fail. To do its job it installs an async hook for the whole run that
 * keeps an error with a 100-frame stack (about 22 KB of text) for every async
 * resource a test file's code creates, until that resource is destroyed.
 *
 * Home's `npm run test` passed it, and from #5402 (2026-10-29) every Tests
 * run on master died in test-home with "JavaScript heap out of memory". On a
 * runner jest's transform cache starts empty, so each module a test file
 * imports is compiled and written to the cache, and jest writes each file
 * with write-file-atomic, which loads signal-exit for the write: about 18
 * process.on(signal) listeners, each a new SIGNALWRAP handle, removed again
 * after the write. A removed handle is only destroyed once the event loop
 * turns, and a test file's imports load synchronously. DemoPage.test.ts
 * imports Home's sitemap, and through it all of Common's server code: about
 * 3,150 modules, 6,300 cache files, and 114,343 SIGNALWRAP stacks held at
 * once - 2.5 GB of the 3.9 GB heap the snapshot taken at the limit showed.
 * With a warm cache nothing is written, which is why it passed on a laptop.
 *
 * The flag also made jest run in band, one process for every test file.
 * Without it Home's suite runs on jest's worker pool, as App's and Common's
 * do (see test.common.yaml): in band, a test file that loads Common's server
 * code stays in memory after it ends, and on an empty cache the live heap
 * stepped up about 900 MB with each such file, to 3.4 GB of the 4 GB limit;
 * on three workers, as on a 4-vCPU runner, the most a worker held was
 * 2.3 GB. Probe's and Runner's suites keep running in band, now through
 * --runInBand. Debug scripts may keep the flag for chasing a leak.
 *
 * This suite holds every jest run a workflow starts - the npm scripts it
 * runs, in the directory it runs them in, the scripts those run, and jest
 * commands written out in a step - to leaving the flag out, and pins that it
 * finds the test runs CI depends on, so it cannot pass by reading nothing.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { stepCommand, stepWorkingDirectory } = require("./Utils/WorkflowStep");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");
const FLAG = "--detectOpenHandles";

// Test runs CI depends on: "<package directory> <script>".
const KNOWN_CI_TEST_RUNS = [
  "packages/App test",
  "packages/Common test",
  "packages/Home test",
  "packages/Probe test",
  "packages/Runner test",
];

/*
 * A shell command's simple commands, in order: split on newlines (and the
 * backslash line continuations joined first), ;, &&, || and |, outside
 * quotes. Parentheses around a subshell are dropped, and runs of whitespace
 * read as one space.
 */
function simpleCommands(command) {
  const text = command.replace(/\\\r?\n/g, " ");
  const parts = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      current += c;
      if (c === quote) {
        quote = null;
      }
    } else if (c === "'" || c === '"') {
      quote = c;
      current += c;
    } else if (c === "\n" || c === ";") {
      parts.push(current);
      current = "";
    } else if ((c === "&" || c === "|") && text[i + 1] === c) {
      parts.push(current);
      current = "";
      i++;
    } else if (c === "|") {
      parts.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  parts.push(current);

  return parts
    .map((part) => {
      return part
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\(+/, "")
        .replace(/\)+$/, "")
        .trim();
    })
    .filter(Boolean);
}

// A simple command's words, with the quotes around a word removed.
function wordsOf(simple) {
  return (simple.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((word) => {
    return word.replace(/^(["'])([\s\S]*)\1$/, "$2");
  });
}

// The npm script a command runs: `npm test`, `npm run <name>`; null otherwise.
function npmScriptOf(words) {
  if (words[0] !== "npm") {
    return null;
  }
  const rest = words.slice(1).filter((word) => {
    return !/^-/.test(word);
  });
  if (["test", "t", "tst"].includes(rest[0])) {
    return "test";
  }
  if (["run", "run-script", "rum", "urn"].includes(rest[0])) {
    return rest[1] || null;
  }
  return null;
}

// Whether a command runs jest: `jest`, `npx jest`, `node .../.bin/jest`, ...
function runsJest(words) {
  return words.some((word) => {
    return /(^|\/)jest(\.js)?$/.test(word);
  });
}

/*
 * What a shell command run in `directory` (relative to the root, "" for the
 * root) starts: each npm script with the directory it runs in, and each jest
 * command line. `cd` moves the directory of the commands after it, as in the
 * shell; after a `cd` this cannot follow (an absolute path or a variable),
 * scripts are listed as unresolved instead.
 */
function runsOf(command, directory) {
  const runs = { scripts: [], jest: [], unresolved: [] };
  let current = directory;

  for (const simple of simpleCommands(command)) {
    const words = wordsOf(simple);
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
      words.shift();
    }
    if (words.length === 0) {
      continue;
    }

    if (words[0] === "cd") {
      const target = words[1] || "";
      current =
        current === null ||
        target === "" ||
        /^[/~$-]/.test(target) ||
        target.includes("$")
          ? null
          : path.posix.normalize(path.posix.join(current || ".", target));
      if (current === ".") {
        current = "";
      }
      continue;
    }

    const script = npmScriptOf(words);
    if (script) {
      if (current === null || script.includes("$")) {
        runs.unresolved.push(simple);
      } else {
        runs.scripts.push({ directory: current, script, command: simple });
      }
    } else if (runsJest(words)) {
      runs.jest.push({ directory: current, command: simple });
    }
  }

  return runs;
}

// The scripts of the package.json in `directory`, or null if it has none.
function readScripts(directory) {
  const file = path.join(REPO_ROOT, directory, "package.json");
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8")).scripts || {};
}

/*
 * Every script and jest command line an npm script run reaches: the script,
 * its pre- and post- scripts, and what each of them runs in turn.
 */
function reachedFrom(run, scriptsOf, seen = new Set()) {
  const key = `${run.directory} ${run.script}`;
  if (seen.has(key)) {
    return [];
  }
  seen.add(key);

  const scripts = scriptsOf(run.directory);
  if (!scripts) {
    return [];
  }

  const reached = [];
  for (const name of [`pre${run.script}`, run.script, `post${run.script}`]) {
    const text = scripts[name];
    if (typeof text !== "string") {
      continue;
    }
    reached.push({ directory: run.directory, script: name, text });
    for (const nested of runsOf(text, run.directory).scripts) {
      reached.push(...reachedFrom(nested, scriptsOf, seen));
    }
  }
  return reached;
}

// The directory a step's shell starts in: its own, else its job's or its workflow's `defaults.run`.
function startDirectoryOf(workflow, job, step) {
  const own = stepWorkingDirectory(step);
  if (own || typeof step.run !== "string") {
    return own;
  }
  const written =
    ((job.defaults || {}).run || {})["working-directory"] ||
    ((workflow.defaults || {}).run || {})["working-directory"] ||
    "";
  const directory = String(written).replace(/\/+$/, "");
  return directory === "." ? "" : directory;
}

/*
 * Every jest run the workflows start, each with where it comes from: the
 * npm scripts steps run (and what those reach), and jest command lines
 * written in steps.
 */
function ciJestRuns(scriptsOf = readScripts) {
  const scriptRuns = [];
  const commandRuns = [];

  for (const file of fs.readdirSync(WORKFLOWS_DIR).sort()) {
    if (!/\.ya?ml$/.test(file)) {
      continue;
    }
    const workflow =
      yaml.load(fs.readFileSync(path.join(WORKFLOWS_DIR, file), "utf8")) || {};
    for (const [jobName, job] of Object.entries(workflow.jobs || {})) {
      for (const [index, step] of (job.steps || []).entries()) {
        const where = `${file} > ${jobName} > ${step.name || `step ${index + 1}`}`;
        const runs = runsOf(
          stepCommand(step),
          startDirectoryOf(workflow, job, step),
        );
        for (const run of runs.scripts) {
          scriptRuns.push({ where, run, reached: reachedFrom(run, scriptsOf) });
        }
        for (const jest of runs.jest) {
          commandRuns.push({ where, ...jest });
        }
      }
    }
  }

  return { scriptRuns, commandRuns };
}

describe("reading what a workflow step runs", () => {
  test("a cd before npm moves the script into that package", () => {
    expect(runsOf("cd packages/Home && npm run test", "").scripts).toEqual([
      { directory: "packages/Home", script: "test", command: "npm run test" },
    ]);
  });

  test("a step's directory, extra arguments after --, and npm test", () => {
    expect(
      runsOf("rm -rf build && npm run test -- --shard=1/2", "packages/Common")
        .scripts,
    ).toEqual([
      {
        directory: "packages/Common",
        script: "test",
        command: "npm run test -- --shard=1/2",
      },
    ]);
    expect(runsOf("npm test", "packages/MobileApp").scripts[0].script).toBe(
      "test",
    );
  });

  test("cd after cd, and a cd back up, as the shell would", () => {
    expect(
      runsOf(
        "cd packages && cd App && npm run x\ncd ../.. && npm run y",
        "",
      ).scripts.map((run) => {
        return `${run.directory || "."} ${run.script}`;
      }),
    ).toEqual(["packages/App x", ". y"]);
  });

  test("a script after a cd it cannot follow is unresolved, not guessed", () => {
    const runs = runsOf('cd "$RUNNER_TEMP" && npm run test', "packages/App");
    expect(runs.scripts).toEqual([]);
    expect(runs.unresolved).toEqual(["npm run test"]);
    expect(runsOf('npm run "$suite"', "packages/E2E").unresolved).toEqual([
      'npm run "$suite"',
    ]);
  });

  test("jest written out in a step, folded or continued, with env and a fallback", () => {
    expect(
      runsOf(
        "node --max-old-space-size=4096 node_modules/.bin/jest --runInBand \\\n  Tests/X.test.ts --forceExit",
        "packages/App",
      ).jest,
    ).toEqual([
      {
        directory: "packages/App",
        command:
          "node --max-old-space-size=4096 node_modules/.bin/jest --runInBand Tests/X.test.ts --forceExit",
      },
    ]);
    expect(
      runsOf("CI=true npx jest Tests || (bash dump.sh; exit 1)", "").jest,
    ).toHaveLength(1);
    expect(runsOf("docker compose run --rm e2e npm run x", "").scripts).toEqual(
      [],
    );
  });

  test("a script's pre- and post- scripts and the scripts it runs are reached", () => {
    const packages = {
      "packages/A": {
        pretest: "rm -rf build",
        test: "npm run unit && cd ../B && npm run b",
        unit: `jest ${FLAG}`,
      },
      "packages/B": { b: "node node_modules/.bin/jest --forceExit" },
    };
    const reached = reachedFrom(
      { directory: "packages/A", script: "test" },
      (directory) => {
        return packages[directory] || null;
      },
    );
    expect(
      reached.map((entry) => {
        return `${entry.directory} ${entry.script}: ${entry.text}`;
      }),
    ).toEqual([
      "packages/A pretest: rm -rf build",
      "packages/A test: npm run unit && cd ../B && npm run b",
      `packages/A unit: jest ${FLAG}`,
      "packages/B b: node node_modules/.bin/jest --forceExit",
    ]);
  });
});

describe("the jest runs CI starts", () => {
  const { scriptRuns, commandRuns } = ciJestRuns();

  test("include the test runs CI depends on", () => {
    const found = new Set(
      scriptRuns.map(({ run }) => {
        return `${run.directory} ${run.script}`;
      }),
    );
    expect(
      KNOWN_CI_TEST_RUNS.filter((run) => {
        return !found.has(run);
      }),
    ).toEqual([]);
    expect(commandRuns.length).toBeGreaterThan(0);
  });

  test(`none passes ${FLAG}`, () => {
    const offending = [];
    for (const { where, run, reached } of scriptRuns) {
      if (run.command.includes(FLAG)) {
        offending.push(`${where}: ${run.command}`);
      }
      for (const entry of reached) {
        if (entry.text.includes(FLAG)) {
          offending.push(
            `${where}: ${entry.directory}/package.json "${entry.script}": ${entry.text}`,
          );
        }
      }
    }
    for (const { where, command } of commandRuns) {
      if (command.includes(FLAG)) {
        offending.push(`${where}: ${command}`);
      }
    }
    expect([...new Set(offending)]).toEqual([]);
  });
});

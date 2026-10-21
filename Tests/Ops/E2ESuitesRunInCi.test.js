"use strict";

/**
 * Every Playwright suite packages/E2E defines is run by a workflow.
 *
 * A suite is a `test-*` script in packages/E2E/package.json with a config of
 * its own, and nothing runs it until a workflow is told to. Two sat there
 * unrun: test-navigation-search-ui, an offline fixture suite of the kind App
 * Test runs, and test-label-rule-transfer, the live label rule import/export
 * suite, which needs a booted stack with billing off. A suite that never runs
 * never fails, so nothing noticed. This fails the next one.
 *
 * A workflow runs a suite when a step that runs in packages/E2E - by its
 * working-directory, a `cd packages/E2E`, or the e2e container, whose working
 * directory is the package - runs `npm run <script>`, or loops `npm run
 * "$suite"` over a matrix value that names it, as App Test's
 * dashboard-offline-ui groups do.
 *
 * The rest of this file pins what the two suites above needed to be useful
 * once they ran:
 *
 *   - App Test uploads each suite's Playwright outputDir, so a failure arrives
 *     with its trace;
 *   - test-release.yaml's self-hosted job runs the live label rule suite once
 *     per run, in one shard, through the e2e container, against that job's
 *     billing-off stack once it is up, and keeps its traces where the job's
 *     failure upload finds them.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = ".github/workflows";
const APP_TEST = `${WORKFLOWS_DIR}/test.app.yaml`;
const TEST_RELEASE = `${WORKFLOWS_DIR}/test-release.yaml`;
const E2E_DIR = "packages/E2E";
const E2E_OVERLAY = `${E2E_DIR}/docker-compose.e2e.yml`;
const LIVE_LABEL_RULE_SUITE = "test-label-rule-transfer";

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readYaml(relativePath) {
  return yaml.load(read(relativePath));
}

const e2eScripts = JSON.parse(read(`${E2E_DIR}/package.json`)).scripts;

// `test` itself is the default suite: the e2e image's CMD.
const SUITES = Object.keys(e2eScripts)
  .filter((name) => {
    return /^test-/.test(name);
  })
  .sort();

// What a step runs as shell: `run`, or the `command` of a retry step.
function commandOf(step) {
  if (typeof step.run === "string") {
    return step.run;
  }
  return step.with && typeof step.with.command === "string"
    ? step.with.command
    : "";
}

function workingDirectoryOf(workflow, job, step) {
  const directory =
    step["working-directory"] ||
    ((job.defaults || {}).run || {})["working-directory"] ||
    ((workflow.defaults || {}).run || {})["working-directory"] ||
    ".";

  return path.posix.normalize(directory).replace(/(.)\/+$/, "$1");
}

// Whether the `npm run`s in this step run packages/E2E's scripts.
function runsInE2e(workflow, job, step) {
  const command = commandOf(step);

  return (
    workingDirectoryOf(workflow, job, step) === E2E_DIR ||
    /\bcd (?:\.\/)?packages\/E2E\b/.test(command) ||
    /-f packages\/E2E\/docker-compose\.e2e\.yml (?:up|run)\b[^\n]*\se2e\b/.test(
      command,
    )
  );
}

function scriptsNamedIn(command) {
  return [...command.matchAll(/\bnpm run ([\w:-]+)/g)].map((match) => {
    return match[1];
  });
}

/*
 * `npm run "$suite"` over a matrix value: every whitespace-separated name in
 * the matrix key that one of the step's env entries is set from.
 */
function matrixScriptsRunBy(job, step) {
  if (!/\bnpm run "\$\{?\w+\}?"/.test(commandOf(step))) {
    return [];
  }

  const matrix = (job.strategy || {}).matrix || {};
  const entries = [...(matrix.include || []), matrix];

  return Object.values(step.env || {}).flatMap((value) => {
    const key = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/.exec(String(value));

    if (!key) {
      return [];
    }

    return entries.flatMap((entry) => {
      const names = entry[key[1]];

      if (typeof names === "string") {
        return names.split(/\s+/).filter(Boolean);
      }
      return Array.isArray(names) ? names.map(String) : [];
    });
  });
}

function scriptsRunBy(workflow, job) {
  return [
    ...new Set(
      (job.steps || [])
        .filter((step) => {
          return runsInE2e(workflow, job, step);
        })
        .flatMap((step) => {
          return [
            ...scriptsNamedIn(commandOf(step)),
            ...matrixScriptsRunBy(job, step),
          ];
        }),
    ),
  ].sort();
}

const workflowFiles = fs
  .readdirSync(path.join(REPO_ROOT, WORKFLOWS_DIR))
  .filter((file) => {
    return /\.ya?ml$/.test(file);
  })
  .sort()
  .map((file) => {
    return `${WORKFLOWS_DIR}/${file}`;
  });

// script -> the "workflow: job"s that run it in packages/E2E.
const runners = new Map();

for (const file of workflowFiles) {
  const workflow = readYaml(file);

  for (const [name, job] of Object.entries(workflow.jobs || {})) {
    for (const script of scriptsRunBy(workflow, job)) {
      runners.set(script, [...(runners.get(script) || []), `${file}: ${name}`]);
    }
  }
}

/**
 * Where a suite's Playwright config writes its traces and screenshots, as a
 * repository-relative path: its outputDir, resolved against packages/E2E,
 * where every config lives.
 * @param {string} suite
 * @returns {string}
 */
function outputDirOf(suite) {
  const config = /--config (\S+)/.exec(e2eScripts[suite] || "");

  if (!config) {
    throw new Error(`${suite} does not run a Playwright config of its own`);
  }

  const outputDir = /\boutputDir:\s*(["'])([^"']+)\1/.exec(
    read(`${E2E_DIR}/${config[1]}`),
  );

  if (!outputDir) {
    throw new Error(`${E2E_DIR}/${config[1]} sets no outputDir`);
  }

  return path.posix.join(E2E_DIR, outputDir[2]);
}

describe("the helpers this suite reads the workflows with", () => {
  test("find the suites, and steps that run them (the checks below are not vacuous)", () => {
    expect(SUITES.length).toBeGreaterThan(20);
    expect(runners.size).toBeGreaterThan(20);
  });

  test("see each way a workflow runs an e2e script", () => {
    // working-directory: packages/E2E
    expect(runners.get("test-session-replay-ui")).toContain(
      `${APP_TEST}: session-replay-ui`,
    );
    // `npm run "$suite"` over the groups' `suites`
    expect(runners.get("test-event-overview-ui")).toContain(
      `${APP_TEST}: dashboard-offline-ui`,
    );
    // `docker compose ... run --rm e2e npm run ...`
    expect(runners.get("test-enterprise-licensed")).toContain(
      `${TEST_RELEASE}: test-e2e-test-enterprise`,
    );
  });

  test("ignore `npm run` in steps that run in another package", () => {
    const workflow = { jobs: {} };
    const job = {
      steps: [
        {
          "working-directory": "packages/Common",
          run: "npm run test-navigation-search-ui",
        },
        { run: "cd packages/App && npm run test-navigation-search-ui" },
      ],
    };

    expect(scriptsRunBy(workflow, job)).toEqual([]);
    expect(
      scriptsRunBy(workflow, {
        steps: [
          {
            "working-directory": "./packages/E2E/",
            run: "npm run test-navigation-search-ui",
          },
        ],
      }),
    ).toEqual(["test-navigation-search-ui"]);
  });

  test("resolve a suite's outputDir to a repository path", () => {
    expect(outputDirOf("test-navigation-search-ui")).toBe(
      "output/playwright/navigation-search/test-results",
    );
    expect(outputDirOf("test-enterprise-licensed")).toBe(
      "packages/E2E/test-results/enterprise-licensed",
    );
  });
});

describe("every Playwright suite in packages/E2E is run by a workflow", () => {
  test.each(SUITES)("%s", (suite) => {
    expect({ suite, runInCi: runners.has(suite) }).toEqual({
      suite,
      runInCi: true,
    });
  });

  test("and every script a workflow runs in packages/E2E is one of its scripts", () => {
    const unknown = [...runners.keys()].filter((script) => {
      return !(script in e2eScripts);
    });

    expect(unknown).toEqual([]);
  });
});

describe(`${APP_TEST}: every browser suite's traces are uploaded, pass or fail`, () => {
  const workflow = readYaml(APP_TEST);
  const jobs = Object.entries(workflow.jobs)
    .map(([name, job]) => {
      return [name, job, scriptsRunBy(workflow, job)];
    })
    .filter(([, , suites]) => {
      return suites.length > 0;
    });

  test("the jobs that run them are found", () => {
    expect(
      jobs.map(([name]) => {
        return name;
      }),
    ).toEqual(
      expect.arrayContaining(["session-replay-ui", "dashboard-offline-ui"]),
    );
  });

  test.each(jobs)(
    "%s uploads the outputDir of every suite it runs",
    (_name, job, suites) => {
      const uploads = job.steps.filter((step) => {
        return /^actions\/upload-artifact@/.test(step.uses || "");
      });

      expect(uploads).toHaveLength(1);
      expect(uploads[0].if).toBe("always()");

      const paths = String(uploads[0].with.path)
        .split("\n")
        .map((line) => {
          return line.trim();
        })
        .filter(Boolean);

      for (const suite of suites) {
        const outputDir = outputDirOf(suite);

        expect({
          suite,
          outputDir,
          uploaded: paths.includes(outputDir),
        }).toEqual({ suite, outputDir, uploaded: true });
      }
    },
  );
});

describe(`${TEST_RELEASE} test-e2e-test-self-hosted: the live label rule suite`, () => {
  const job = readYaml(TEST_RELEASE).jobs["test-e2e-test-self-hosted"];
  const steps = job.steps;
  const runsLiveSuite = (step) => {
    return scriptsNamedIn(commandOf(step)).includes(LIVE_LABEL_RULE_SUITE);
  };
  const index = steps.findIndex(runsLiveSuite);
  const step = steps[index] || {};

  test("runs it in one step, through the e2e image's container", () => {
    expect(steps.filter(runsLiveSuite)).toHaveLength(1);
    // `run --rm` overrides the image's CMD; `up` would run the default suite.
    expect(commandOf(step)).toContain(
      `-f ${E2E_OVERLAY} run --rm e2e npm run ${LIVE_LABEL_RULE_SUITE}`,
    );
  });

  test("runs it once per run - in shard 1, which every shard count has - whatever the shard's own suite did", () => {
    expect(job.strategy.matrix.shard).toContain(1);
    expect(step.if).toMatch(/\bmatrix\.shard == 1\b/);
    expect(step.if).toContain("!cancelled()");
  });

  test("runs it only once the stack is up", () => {
    const start = steps.findIndex((candidate) => {
      return /docker compose [^\n]*\bup\b[^\n]*\s-d\b/.test(
        commandOf(candidate),
      );
    });
    const ready = /\bsteps\.([\w-]+)\.outcome == 'success'/.exec(step.if || "");

    expect(ready).not.toBeNull();

    const readyIndex = steps.findIndex((candidate) => {
      return candidate.id === ready[1];
    });

    expect(commandOf(steps[readyIndex])).toContain(
      "Tests/Scripts/status-check.sh",
    );
    expect({ order: start < readyIndex && readyIndex < index }).toEqual({
      order: true,
    });
  });

  test("runs it against a stack with billing off, which the suite needs", () => {
    const commands = steps.map(commandOf).join("\n");

    expect(commands).toMatch(/docker compose [^\n]*\bup\b[^\n]*\s-d\b/);
    expect(commands).not.toContain("docker-compose.billing.yml");
    expect(commands).not.toContain("enable-billing-env-var.sh");
  });

  test("keeps its traces in the test-results the container mounts, where the failure upload finds them", () => {
    const outputDir = outputDirOf(LIVE_LABEL_RULE_SUITE);

    expect(outputDir.startsWith(`${E2E_DIR}/test-results/`)).toBe(true);
    expect(readYaml(E2E_OVERLAY).services.e2e.volumes).toContain(
      `./${E2E_DIR}/test-results:/usr/src/app/test-results`,
    );

    const upload = steps.findIndex((candidate) => {
      return (
        /^actions\/upload-artifact@/.test(candidate.uses || "") &&
        candidate.if === "failure()"
      );
    });

    expect(upload).toBeGreaterThan(index);
    expect(String(steps[upload].with.path)).toContain(`./${E2E_DIR}`);
  });
});

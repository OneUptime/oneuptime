"use strict";

/**
 * Every real-ClickHouse suite is run by a workflow, against a server.
 *
 * A Common or App test that runs its SQL against a real ClickHouse reads
 * TEST_CLICKHOUSE_URL and skips itself without it, so a job with no server
 * never runs it by accident. Only a workflow step that sets the URL - in its
 * own `env`, its job's or its workflow's - runs one: the App Test shards run
 * App's whole test script beside a ClickHouse service, and since #10985
 * Common's `test-clickhouse` script beside it, which runs Common's suites of
 * the kind (*ClickhouseIntegration.test.ts). Those had run nowhere: Common
 * Test has no ClickHouse, so all of them skipped, among them the suite that
 * judges each step of a monitor on its own checks (#10944). A suite that
 * never runs never fails, so nothing noticed. This fails the next one.
 *
 * A suite is a test file that reads TEST_CLICKHOUSE_URL as a quoted string
 * (a comment naming it does not make a suite, nor a template literal). It
 * runs when a step that sets TEST_CLICKHOUSE_URL runs its package's whole
 * test script - from the package's folder, by `working-directory` or a
 * leading `cd` - or, for one of Common's, Common's `test-clickhouse` script,
 * whose path pattern its file matches.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = ".github/workflows";
const TEST_ROOTS = ["packages/Common/Tests", "packages/App/Tests", "ee/Tests"];
const TEST_FILE = /\.test\.[jt]sx?$/;
const URL_READ = /["']TEST_CLICKHOUSE_URL["']/;
// Template literals, emptied before the variable is looked for: they quote code.
const TEMPLATE_LITERAL = /`(?:\\[\s\S]|[^`\\])*`/g;
const PACKAGE_TEST_SCRIPT = /\bnpm (?:run )?test(?:\s|$)/;
const COMMON_CLICKHOUSE_SCRIPT = /\bnpm run test-clickhouse\b/;
const LEADING_CD = /^\s*cd\s+(\S+)\s*&&/;
const COMMON = "packages/Common";

function testFilesUnder(relativeDirectory) {
  const directory = path.join(REPO_ROOT, relativeDirectory);

  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : testFilesUnder(relative);
    }

    return TEST_FILE.test(entry.name) ? [relative] : [];
  });
}

const SUITES = TEST_ROOTS.flatMap(testFilesUnder)
  .filter((file) => {
    return URL_READ.test(
      fs
        .readFileSync(path.join(REPO_ROOT, file), "utf8")
        .replace(TEMPLATE_LITERAL, "``"),
    );
  })
  .sort();

// Common's test-clickhouse script, and the jest path pattern it runs.
const COMMON_SCRIPTS = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, COMMON, "package.json"), "utf8"),
).scripts;
const CLICKHOUSE_SCRIPT = COMMON_SCRIPTS["test-clickhouse"] || "";
const CLICKHOUSE_PATTERN = (/node_modules\/\.bin\/jest\s+(\S+)/.exec(
  CLICKHOUSE_SCRIPT,
) || [])[1];

function workingDirectoryOf(workflow, job, step) {
  const directory =
    step["working-directory"] ||
    ((job.defaults || {}).run || {})["working-directory"] ||
    ((workflow.defaults || {}).run || {})["working-directory"] ||
    ".";

  return path.posix.normalize(directory).replace(/(.)\/+$/, "$1");
}

/*
 * Every step that runs shell: where it runs - its working directory, then a
 * leading `cd` - what it sets, and what it runs. A step sees its workflow's
 * env, then its job's, then its own.
 */
const STEPS = fs
  .readdirSync(path.join(REPO_ROOT, WORKFLOWS_DIR))
  .filter((file) => {
    return /\.ya?ml$/.test(file);
  })
  .sort()
  .flatMap((file) => {
    const workflow = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, WORKFLOWS_DIR, file), "utf8"),
    );

    return Object.entries(workflow.jobs || {}).flatMap(([name, job]) => {
      return (job.steps || [])
        .filter((step) => {
          return typeof step.run === "string";
        })
        .map((step) => {
          const cd = LEADING_CD.exec(step.run);
          const directory = workingDirectoryOf(workflow, job, step);

          return {
            where: `${WORKFLOWS_DIR}/${file}: ${name}: ${step.name || step.run}`,
            directory: cd
              ? path.posix.normalize(path.posix.join(directory, cd[1]))
              : directory,
            env: {
              ...(workflow.env || {}),
              ...(job.env || {}),
              ...(step.env || {}),
            },
            services: job.services || {},
            run: step.run,
          };
        });
    });
  });

function packageOf(file) {
  return TEST_ROOTS.map((root) => {
    return path.posix.dirname(root);
  }).find((directory) => {
    return file.startsWith(`${directory}/`);
  });
}

// The steps that run a suite, against the server the URL names.
function stepsRunning(file) {
  const directory = packageOf(file);

  return STEPS.filter((step) => {
    if (!step.env.TEST_CLICKHOUSE_URL || step.directory !== directory) {
      return false;
    }

    if (directory === COMMON) {
      return (
        COMMON_CLICKHOUSE_SCRIPT.test(step.run) &&
        Boolean(CLICKHOUSE_PATTERN) &&
        new RegExp(CLICKHOUSE_PATTERN).test(file)
      );
    }

    return PACKAGE_TEST_SCRIPT.test(step.run);
  });
}

describe("the helpers this suite reads the tests and workflows with", () => {
  test("find the ClickHouse suites of Common and App, and the steps that run shell (the checks below are not vacuous)", () => {
    expect(
      SUITES.filter((file) => {
        return file.startsWith(`${COMMON}/`);
      }).length,
    ).toBeGreaterThanOrEqual(10);
    expect(
      SUITES.filter((file) => {
        return file.startsWith("packages/App/");
      }).length,
    ).toBeGreaterThanOrEqual(15);
    expect(STEPS.length).toBeGreaterThan(100);
  });

  test("read a suite from the URL it reads, not from a comment naming it", () => {
    expect(SUITES).toContain(
      "packages/Common/Tests/Server/Utils/Monitor/MonitorStepWindowsClickhouseIntegration.test.ts",
    );
    // Names TEST_CLICKHOUSE_URL in its comments only, and reads a URL of its own.
    expect(SUITES).not.toContain(
      "packages/Common/Tests/Server/Utils/SecurityEvent/GoogleSecOpsSeverityRepairClickhouseIntegration.test.ts",
    );
  });

  test("see a leading cd as where a step runs", () => {
    expect(
      STEPS.filter((step) => {
        return step.directory === "packages/App" && step.env.TEST_CLICKHOUSE_URL;
      }).length,
    ).toBeGreaterThan(0);
  });

  test("do not count a step that runs Common's whole test script: it has no server there", () => {
    expect(
      STEPS.filter((step) => {
        return (
          step.directory === COMMON &&
          PACKAGE_TEST_SCRIPT.test(step.run) &&
          step.env.TEST_CLICKHOUSE_URL
        );
      }),
    ).toEqual([]);
  });
});

describe("Common's test-clickhouse script", () => {
  test("runs every Common suite named for a real ClickHouse, with the exported config.env the other scripts read", () => {
    expect(CLICKHOUSE_PATTERN).toBe("ClickhouseIntegration.test.ts");
    expect(CLICKHOUSE_SCRIPT).toContain("export $(grep -v '^#' config.env | xargs)");
    expect(CLICKHOUSE_SCRIPT).toContain("--maxWorkers=2");
    expect(CLICKHOUSE_SCRIPT).toContain("--passWithNoTests");
  });

  test("every Common suite that reads the URL is named so the script runs it", () => {
    for (const file of SUITES.filter((suite) => {
      return suite.startsWith(`${COMMON}/`);
    })) {
      expect({ file, named: /ClickhouseIntegration\.test\.ts$/.test(file) }).toEqual({
        file,
        named: true,
      });
    }
  });

  test("runs where a ClickHouse service runs, on every shard", () => {
    const steps = STEPS.filter((step) => {
      return COMMON_CLICKHOUSE_SCRIPT.test(step.run);
    });

    expect(steps.length).toBeGreaterThan(0);

    for (const step of steps) {
      expect(step.directory).toBe(COMMON);
      expect(step.env.TEST_CLICKHOUSE_URL).toMatch(/^http:\/\/[^@]+@localhost:\d+$/);
      expect(
        Object.values(step.services).some((service) => {
          return /clickhouse-server/.test(String(service.image || ""));
        }),
      ).toBe(true);
      expect(step.run).toContain("--shard=${{ matrix.shard }}/${{ strategy.job-total }}");
    }
  });
});

describe("every ClickHouse suite runs in a workflow", () => {
  test.each(
    SUITES.map((file) => {
      return [file];
    }),
  )("%s", (file) => {
    expect({
      suite: file,
      isRun: stepsRunning(file).length > 0,
    }).toEqual({ suite: file, isRun: true });
  });
});

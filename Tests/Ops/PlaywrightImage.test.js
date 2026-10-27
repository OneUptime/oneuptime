"use strict";

/**
 * Browser jobs run in the Playwright image, at the Playwright the lockfiles
 * pin.
 *
 * `npx playwright install --with-deps` fetched every browser job's system
 * packages and fonts from the runner's Ubuntu mirror: about 26 MB for
 * Chromium, 54 MB with Firefox. Usually 25 seconds, but some runners were
 * served at a few dozen kB/s: 20 minutes in a Dashboard Offline UI group
 * (2026-10-22), 11.7 in another the next day, past the Backups job's
 * 10-minute limit twice on 2026-10-26, and on 14.0.93's release gate an
 * apt-get update that hung for over three hours. Limits
 * (Tests/Ops/BrowserInstallLimits) turned a hung install into a failed job,
 * not a working one.
 *
 * So the browser jobs run in mcr.microsoft.com/playwright, the image
 * Playwright publishes for each version: its Chromium, Firefox and WebKit,
 * and the system packages and fonts they need, are in the image, and the
 * runner pulls it from Microsoft's registry before the first step (about
 * 1 GB, about a minute). Caching apt's packages instead was the other way:
 * a cache per runner image and browser set, restored, installed with dpkg
 * and saved again whenever the runner image changes - more to go wrong for
 * the same minute.
 *
 * This suite holds:
 *   - every job that runs a browser to running in the image, or to
 *     installing browsers under BrowserInstallLimits' limits (the Probe's
 *     job, whose suite needs strace and gcc from apt as well);
 *   - the image's version to the one Playwright every lockfile pins: the
 *     image's browsers are the builds of its own version, and any other
 *     Playwright would look for builds the image does not have;
 *   - a job in the image to installing no browser and nothing with apt, to
 *     running as the runner's user (the workspace and HOME are its, and
 *     Firefox will not start as root in a home another user owns) with the
 *     host's IPC namespace, as the image asks;
 *   - its limits: every step after its npm installs has one of its own, and
 *     the job's holds them, 7 minutes for checkout, Node and the installs,
 *     and 5 for the pull.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { isNpmInstallStep, stepCommand } = require("./Utils/WorkflowStep");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");
const IMAGE = /^mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble$/;
const SET_UP_MINUTES = 7;
const PULL_MINUTES = 5;
// nick-fields/retry's default wait between tries.
const RETRY_WAIT_SECONDS = 10;

/*
 * Every job that runs a browser, "<workflow file> <job>": the Playwright
 * suites of packages/E2E and MobileApp, and the jest suites that drive a
 * real Chromium (BrowserRecorder's vitals, the Probe's synthetic monitors).
 */
const BROWSER_JOBS = [
  "test.app.yaml dashboard-offline-ui",
  "test.app.yaml session-replay-ui",
  "test.browser-recorder.yaml test",
  "test.ee.yaml enterprise-ui",
  "test.mobile-app.yaml expo-web-export",
  "test.probe.yaml test",
];

// The jobs that install their browsers, and why they do not use the image.
const INSTALLING_JOBS = {
  // Its suite also runs Chromium and Firefox under strace and compiles a
  // shim with gcc, both from apt; as the runner's user in the image it
  // could not install them.
  "test.probe.yaml test": "strace and gcc from apt",
};

// The lockfiles that pin Playwright, and the package each one names it by.
const LOCKFILES = {
  "packages/E2E/package-lock.json": "node_modules/@playwright/test",
  "packages/MobileApp/package-lock.json": "node_modules/@playwright/test",
  "packages/Probe/package-lock.json": "node_modules/playwright",
};

function readWorkflows() {
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((file) => {
      return /\.ya?ml$/.test(file);
    })
    .sort()
    .map((file) => {
      return {
        file,
        workflow:
          yaml.load(fs.readFileSync(path.join(WORKFLOWS_DIR, file), "utf8")) ||
          {},
      };
    });
}

function allJobs() {
  const jobs = [];
  for (const { file, workflow } of readWorkflows()) {
    for (const [id, job] of Object.entries(workflow.jobs || {})) {
      jobs.push({ key: `${file} ${id}`, job, steps: job.steps || [] });
    }
  }
  return jobs;
}

function imageOf(job) {
  const container = job.container;
  if (!container) {
    return "";
  }
  return String(typeof container === "string" ? container : container.image);
}

function optionsOf(job) {
  const container = job.container;
  return container && typeof container === "object"
    ? String(container.options || "")
    : "";
}

function isBrowserInstall(step) {
  return /\bplaywright(@[^\s]+)?\s+install\b/.test(stepCommand(step));
}

function isApt(step) {
  return /\b(apt-get|apt)\s+(update|install)\b/.test(stepCommand(step));
}

function isRetry(step) {
  return /^nick-fields\/retry@/.test(String(step.uses || ""));
}

function runsSomething(step) {
  return step.run !== undefined || isRetry(step);
}

// The minutes a step may take, or undefined when nothing limits it.
function limitOf(step) {
  if (step["timeout-minutes"] !== undefined) {
    return Number(step["timeout-minutes"]);
  }
  if (!isRetry(step)) {
    return undefined;
  }
  const options = step.with || {};
  const tries = Number(options.max_attempts);
  const perTry =
    options.timeout_minutes !== undefined
      ? Number(options.timeout_minutes)
      : Number(options.timeout_seconds) / 60;
  const wait =
    Number(
      options.retry_wait_seconds !== undefined
        ? options.retry_wait_seconds
        : RETRY_WAIT_SECONDS,
    ) / 60;
  const minutes = perTry * tries + wait * (tries - 1);
  return Number.isFinite(minutes) ? minutes : undefined;
}

function nameOf(step) {
  return step.name || step.uses || String(step.run).split("\n")[0];
}

// The steps after the job's last npm install: the ones that run the tests.
function stepsAfterInstalls(steps) {
  let last = -1;
  steps.forEach((step, index) => {
    if (isNpmInstallStep(step)) {
      last = index;
    }
  });
  return steps.slice(last + 1);
}

/*
 * packages/E2E's scripts that run no browser: test-sharding only lists the
 * specs each release shard picks up (Compile's compile-services runs it).
 */
const LISTING_SCRIPTS = ["test-sharding"];

// A step that runs packages/E2E's Playwright suites on the runner itself.
function runsE2eSuites(step) {
  const command = stepCommand(step);
  const inE2e =
    String(step["working-directory"] || "").replace(/\/+$/, "") ===
      "packages/E2E" || /\bcd (?:\.\/)?packages\/E2E\b/.test(command);
  const scripts = [...command.matchAll(/\bnpm run (test-[\w-]+)/g)].map(
    (match) => {
      return match[1];
    },
  );
  const runsSuite =
    /\bnpm run "\$\{?\w+\}?"|\bplaywright test\b/.test(command) ||
    scripts.some((script) => {
      return !LISTING_SCRIPTS.includes(script);
    });
  return inE2e && runsSuite && !/\bdocker\b/.test(command);
}

function lockedVersions() {
  const versions = {};
  for (const [lockfile, entry] of Object.entries(LOCKFILES)) {
    const lock = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, lockfile), "utf8"),
    );
    versions[lockfile] = (lock.packages[entry] || {}).version;
  }
  return versions;
}

const jobs = allJobs();
const imageJobs = jobs.filter(({ job }) => {
  return IMAGE.test(imageOf(job));
});

describe("browser jobs run in the Playwright image", () => {
  test("finds the browser jobs, and the jobs in the image (the checks below are not vacuous)", () => {
    const keys = jobs.map(({ key }) => {
      return key;
    });
    expect(keys).toEqual(expect.arrayContaining(BROWSER_JOBS));
    expect(
      imageJobs
        .map(({ key }) => {
          return key;
        })
        .sort(),
    ).toEqual(
      BROWSER_JOBS.filter((key) => {
        return !INSTALLING_JOBS[key];
      }).sort(),
    );
  });

  test("every browser job runs in the image or installs its browsers, never neither", () => {
    for (const key of BROWSER_JOBS) {
      const { job, steps } = jobs.find((entry) => {
        return entry.key === key;
      });
      expect({
        job: key,
        inTheImage: IMAGE.test(imageOf(job)),
        installs: steps.some(isBrowserInstall),
      }).toEqual({
        job: key,
        inTheImage: !INSTALLING_JOBS[key],
        installs: Boolean(INSTALLING_JOBS[key]),
      });
    }
  });

  test("every job that runs packages/E2E's suites on the runner is a browser job", () => {
    const running = jobs
      .filter(({ steps }) => {
        return steps.some(runsE2eSuites);
      })
      .map(({ key }) => {
        return key;
      })
      .sort();

    expect(running.length).toBeGreaterThan(0);
    expect(
      running.filter((key) => {
        return !BROWSER_JOBS.includes(key);
      }),
    ).toEqual([]);
  });

  test("every lockfile pins one Playwright, and every image is that version", () => {
    const versions = lockedVersions();
    const distinct = [...new Set(Object.values(versions))];

    expect(distinct).toHaveLength(1);
    expect(distinct[0]).toMatch(/^\d+\.\d+\.\d+$/);

    for (const { key, job } of imageJobs) {
      expect({ job: key, version: IMAGE.exec(imageOf(job))[1] }).toEqual({
        job: key,
        version: distinct[0],
      });
    }
  });

  test.each(imageJobs.map((entry) => [entry.key, entry]))(
    "%s installs no browser and nothing with apt",
    (_key, { steps }) => {
      expect(
        steps
          .filter((step) => {
            return isBrowserInstall(step) || isApt(step);
          })
          .map(nameOf),
      ).toEqual([]);
    },
  );

  test.each(imageJobs.map((entry) => [entry.key, entry]))(
    "%s runs as the runner's user, with the host's IPC namespace",
    (_key, { job }) => {
      const options = optionsOf(job).split(/\s+/);
      expect(options).toEqual(expect.arrayContaining(["--user", "1001"]));
      expect(options[options.indexOf("--user") + 1]).toBe("1001");
      expect(options).toContain("--ipc=host");
    },
  );

  test.each(imageJobs.map((entry) => [entry.key, entry]))(
    "%s: every step after the npm installs that runs something has a limit, and the job's holds them, the setup and the pull",
    (_key, { job, steps }) => {
      const testing = stepsAfterInstalls(steps);

      expect(
        testing
          .filter((step) => {
            return runsSomething(step) && limitOf(step) === undefined;
          })
          .map(nameOf),
      ).toEqual([]);

      const minutes = testing.reduce((sum, step) => {
        return sum + (limitOf(step) || 0);
      }, 0);

      expect(minutes).toBeGreaterThan(0);
      expect(Number(job["timeout-minutes"])).toBeGreaterThanOrEqual(
        minutes + SET_UP_MINUTES + PULL_MINUTES,
      );
    },
  );
});

describe("the helpers this suite reads the workflows with", () => {
  test("see a browser install, pinned or not, and apt", () => {
    expect(
      isBrowserInstall({ run: "npx playwright install --with-deps chromium" }),
    ).toBe(true);
    expect(
      isBrowserInstall({ run: "npx --yes playwright@1.63.0 install chromium" }),
    ).toBe(true);
    expect(isBrowserInstall({ run: "npx playwright test" })).toBe(false);
    expect(
      isApt({ run: "sudo apt-get update && sudo apt-get install -y strace" }),
    ).toBe(true);
    expect(isApt({ run: "npm run test-apt-ui" })).toBe(false);
  });

  test("see a step that runs packages/E2E's suites on the runner, and not one that runs them in a container", () => {
    expect(
      runsE2eSuites({
        "working-directory": "packages/E2E",
        run: 'npm run "$suite"',
      }),
    ).toBe(true);
    expect(
      runsE2eSuites({ run: "cd packages/E2E && npm run test-backups-ui" }),
    ).toBe(true);
    expect(
      runsE2eSuites({
        run: "docker compose -f packages/E2E/docker-compose.e2e.yml run e2e npm run test-x",
      }),
    ).toBe(false);
    expect(
      runsE2eSuites({ "working-directory": "packages/E2E", run: "npm ci" }),
    ).toBe(false);
    // Listing the release shards' specs needs no browser.
    expect(
      runsE2eSuites({
        "working-directory": "packages/E2E",
        run: "npm run test-sharding",
      }),
    ).toBe(false);
  });

  test("read a retry step's limit as its tries and the waits between", () => {
    expect(
      limitOf({
        uses: "nick-fields/retry@v3",
        with: { timeout_minutes: 30, max_attempts: 3 },
      }),
    ).toBeCloseTo(90 + 20 / 60);
    expect(limitOf({ run: "npm test" })).toBeUndefined();
    expect(limitOf({ run: "npm test", "timeout-minutes": 12 })).toBe(12);
  });

  test("take the steps after the last npm install", () => {
    const steps = [
      { uses: "actions/checkout@v4" },
      {
        uses: "./.github/actions/npm-install",
        with: { "working-directory": "a" },
      },
      { run: "rm -rf x" },
      {
        uses: "./.github/actions/npm-install",
        with: { "working-directory": "b" },
      },
      { run: "npm test", "timeout-minutes": 10 },
    ];
    expect(stepsAfterInstalls(steps).map(nameOf)).toEqual(["npm test"]);
  });
});

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
 *     and 5 for the pull;
 *   - the runner's fonts: the image lacks DejaVu, which an ubuntu runner has
 *     and fontconfig answers for sans-serif, serif and monospace there, so a
 *     page with no web font of its own drew its words in WenQuanYi Zen Hei
 *     and four tests that measure words failed in the image (2026-10-27).
 *     Every job in the image installs the runner's eight DejaVu faces
 *     (.github/actions/runner-fonts) after its checkout and before its
 *     tests, the folder holds exactly those faces and their licence, and
 *     the install script copies them, builds the cache and fails unless
 *     fontconfig answers DejaVu.
 */

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
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

const RUNNER_FONTS_ACTION = "./.github/actions/runner-fonts";
const RUNNER_FONTS_DIR = path.join(
  REPO_ROOT,
  ".github",
  "actions",
  "runner-fonts",
);

/*
 * The faces of Ubuntu 24.04's fonts-dejavu-core and fonts-dejavu-mono
 * (2.37-8): the fonts an ubuntu runner has that the image does not.
 */
const RUNNER_FACES = [
  "DejaVuSans-Bold.ttf",
  "DejaVuSans.ttf",
  "DejaVuSansMono-Bold.ttf",
  "DejaVuSansMono-BoldOblique.ttf",
  "DejaVuSansMono-Oblique.ttf",
  "DejaVuSansMono.ttf",
  "DejaVuSerif-Bold.ttf",
  "DejaVuSerif.ttf",
];

function isCheckout(step) {
  return /^actions\/checkout@/.test(String(step.uses || ""));
}

function isRunnerFonts(step) {
  return step.uses === RUNNER_FONTS_ACTION;
}

/*
 * Runs the runner-fonts install script with stand-ins for fontconfig's
 * fc-cache and fc-match on PATH: fc-cache records what it was asked to
 * cache, and fc-match answers `answers[generic]`.
 */
function runFontInstall({ answers, env = {} }) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "runner-fonts-"));
  const bin = path.join(scratch, "bin");
  const cached = path.join(scratch, "cached.txt");
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, "fc-cache"),
    `#!/bin/bash\necho "$@" >> "${cached}"\n`,
    { mode: 0o755 },
  );
  const cases = Object.entries(answers)
    .map(([generic, family]) => {
      return `  ${generic}) echo -n "${family}" ;;`;
    })
    .join("\n");
  fs.writeFileSync(
    path.join(bin, "fc-match"),
    `#!/bin/bash\ncase "\${@: -1}" in\n${cases}\n  *) echo -n "Unknown" ;;\nesac\n`,
    { mode: 0o755 },
  );
  const home = path.join(scratch, "home");
  fs.mkdirSync(home);
  const result = childProcess.spawnSync(
    "bash",
    [path.join(RUNNER_FONTS_DIR, "install.sh")],
    {
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: home,
        ...env,
      },
    },
  );
  return {
    scratch,
    home,
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    cached: fs.existsSync(cached) ? fs.readFileSync(cached, "utf8") : "",
  };
}

const RUNNER_ANSWERS = {
  "sans-serif": "DejaVu Sans",
  serif: "DejaVu Serif",
  monospace: "DejaVu Sans Mono",
};

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

  /*
   * A run step with no shell of its own gets `bash -e {0}` on a runner but
   * `sh -e {0}` in a container. The Dashboard Offline UI groups' step is a
   * bash script (`set -uo pipefail`, `read -ra`, an array, a here-string),
   * and in the image every group died on its first line before running a
   * suite (14.0.95's gate). Every job in the image runs its steps in bash.
   */
  test.each(imageJobs.map((entry) => [entry.key, entry]))(
    "%s runs its steps in bash, as a runner does, not the container's sh",
    (_key, { job, steps }) => {
      const jobShell = ((job.defaults || {}).run || {}).shell;

      expect(
        steps
          .filter((step) => {
            const shell = step.shell || jobShell || "";
            return step.run !== undefined && !/^bash\b/.test(shell);
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

describe("every job in the image has the runner's fonts", () => {
  test.each(imageJobs.map((entry) => [entry.key, entry]))(
    "%s installs them after its checkout and before its tests",
    (_key, { steps }) => {
      const checkout = steps.findIndex(isCheckout);
      const fonts = steps.findIndex(isRunnerFonts);
      const testing = stepsAfterInstalls(steps).filter(runsSomething);
      const firstTest = steps.indexOf(testing[0]);

      expect(checkout).toBeGreaterThan(-1);
      expect(fonts).toBeGreaterThan(checkout);
      expect(firstTest).toBeGreaterThan(fonts);
      expect(steps.filter(isRunnerFonts)).toHaveLength(1);
    },
  );

  test("the action holds the runner's eight DejaVu faces and their licence, and nothing else", () => {
    expect(fs.readdirSync(path.join(RUNNER_FONTS_DIR, "fonts")).sort()).toEqual(
      [...RUNNER_FACES, "copyright"].sort(),
    );
    const licence = fs.readFileSync(
      path.join(RUNNER_FONTS_DIR, "fonts", "copyright"),
      "utf8",
    );
    expect(licence).toContain("Upstream-Name: DejaVu fonts");
    expect(licence).toContain("License: bitstream-vera");
    for (const face of RUNNER_FACES) {
      // TrueType: the sfnt version 1.0 every one of these files starts with.
      const header = fs
        .readFileSync(path.join(RUNNER_FONTS_DIR, "fonts", face))
        .subarray(0, 4);
      expect({ face, header: header.toString("hex") }).toEqual({
        face,
        header: "00010000",
      });
    }
  });

  test("the action runs the install script from the workspace, where a container job finds it", () => {
    const action = yaml.load(
      fs.readFileSync(path.join(RUNNER_FONTS_DIR, "action.yml"), "utf8"),
    );
    expect(action.runs.using).toBe("composite");
    expect(action.runs.steps).toHaveLength(1);
    expect(action.runs.steps[0].shell).toBe("bash");
    // Not github.action_path: in a container job it is the runner's path.
    expect(action.runs.steps[0].run).toBe(
      'bash "${GITHUB_WORKSPACE}/.github/actions/runner-fonts/install.sh"',
    );
  });

  test("the install script copies every face into the user's fonts, builds their cache and passes when fontconfig answers DejaVu", () => {
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), "runner-fonts-xdg-"));
    const run = runFontInstall({
      answers: RUNNER_ANSWERS,
      env: { XDG_DATA_HOME: xdg },
    });
    const target = path.join(xdg, "fonts", "oneuptime-runner-fonts");

    expect({ status: run.status, output: run.output }).toEqual({
      status: 0,
      output:
        "sans-serif: DejaVu Sans\nserif: DejaVu Serif\nmonospace: DejaVu Sans Mono\n",
    });
    expect(fs.readdirSync(target).sort()).toEqual([...RUNNER_FACES].sort());
    expect(run.cached.trim()).toBe(`-f ${target}`);
  });

  test("without XDG_DATA_HOME the fonts go to ~/.local/share/fonts, which fontconfig reads", () => {
    const run = runFontInstall({ answers: RUNNER_ANSWERS });
    const target = path.join(
      run.home,
      ".local",
      "share",
      "fonts",
      "oneuptime-runner-fonts",
    );

    expect(run.status).toBe(0);
    expect(fs.readdirSync(target).sort()).toEqual([...RUNNER_FACES].sort());
  });

  test("the install script fails, naming the family, when fontconfig still answers another font", () => {
    const run = runFontInstall({
      answers: {
        ...RUNNER_ANSWERS,
        "sans-serif": "WenQuanYi Zen Hei,文泉驛正黑,文泉驿正黑",
      },
    });

    expect(run.status).toBe(1);
    expect(run.output).toContain(
      "fontconfig answers WenQuanYi Zen Hei,文泉驛正黑,文泉驿正黑 for sans-serif, not DejaVu Sans",
    );
    // The families it does answer right are still reported.
    expect(run.output).toContain("serif: DejaVu Serif");
  });

  test("a family whose name lists others after it still counts", () => {
    const run = runFontInstall({
      answers: { ...RUNNER_ANSWERS, serif: "DejaVu Serif,DejaVu Serif Book" },
    });

    expect(run.status).toBe(0);
  });
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

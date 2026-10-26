"use strict";

/**
 * Browser jobs survive a slow Ubuntu mirror.
 *
 * `npx playwright install --with-deps` fetches the browsers' system packages
 * and fonts from the runner's Ubuntu mirror: about 26 MB for Chromium, 54 MB
 * for Chromium and Firefox. It takes about 25 seconds, but some runners are
 * served at a few dozen kB/s: the install took 20 minutes in a Dashboard
 * Offline UI group (2026-10-22), and it ran past the Backups job's 10-minute
 * install limit twice on master on 2026-10-26, failing the job with nothing
 * tested. It can also hang: on 14.0.93's release gate that day, MobileApp's
 * apt-get update stopped after its third index and sat for over three hours,
 * in a job with no limit, until it was cancelled.
 *
 * So every job that installs a browser's system packages:
 *   - sets a time limit;
 *   - gives the install a limit of its own, of at least 25 minutes;
 *   - gives every step after it that runs something a limit of its own (a
 *     nick-fields/retry step's is its tries' limits and the waits between);
 *   - holds all of those in the job's limit, plus 7 minutes for checkout,
 *     Node and the npm installs before them.
 * Then a slow mirror costs time, not a red job, and a hung install or suite
 * stops at its own limit rather than GitHub's six hours.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github", "workflows");
const INSTALL_MINUTES = 25;
const SET_UP_MINUTES = 7;
// nick-fields/retry's default wait between tries.
const RETRY_WAIT_SECONDS = 10;

function isBrowserInstall(step) {
  const command = String(step.run || "");

  return (
    /\bplaywright install\b/.test(command) && command.includes("--with-deps")
  );
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

const browserJobs = [];

for (const file of fs.readdirSync(WORKFLOWS).sort()) {
  if (!/\.ya?ml$/.test(file)) {
    continue;
  }
  const workflow = yaml.load(
    fs.readFileSync(path.join(WORKFLOWS, file), "utf8"),
  );

  for (const [id, job] of Object.entries((workflow && workflow.jobs) || {})) {
    const steps = job.steps || [];
    const installAt = steps.findIndex(isBrowserInstall);

    if (installAt !== -1) {
      browserJobs.push({ where: `${file} ${id}`, job, steps, installAt });
    }
  }
}

describe("browser jobs and a slow Ubuntu mirror", () => {
  test("finds the jobs that install a browser", () => {
    // If these go missing, the checks below would pass by checking nothing.
    expect(
      browserJobs.map(({ where }) => {
        return where;
      }),
    ).toEqual(
      expect.arrayContaining([
        "test.app.yaml session-replay-ui",
        "test.app.yaml dashboard-offline-ui",
        "test.ee.yaml backups-ui",
        "test.mobile-app.yaml expo-web-export",
        "test.probe.yaml test",
      ]),
    );
  });

  test("every job that installs a browser sets a time limit", () => {
    const unlimited = browserJobs
      .filter(({ job }) => {
        return job["timeout-minutes"] === undefined;
      })
      .map(({ where }) => {
        return where;
      });

    expect(unlimited).toEqual([]);
  });

  test.each(browserJobs.map((entry) => [entry.where, entry]))(
    "%s: the browser install has at least 25 minutes of its own",
    (_where, { steps, installAt }) => {
      expect(steps[installAt]["timeout-minutes"]).toBeGreaterThanOrEqual(
        INSTALL_MINUTES,
      );
    },
  );

  test.each(browserJobs.map((entry) => [entry.where, entry]))(
    "%s: every step after the install that runs something has a limit of its own",
    (_where, { steps, installAt }) => {
      const unlimited = steps
        .slice(installAt + 1)
        .filter((step) => {
          return runsSomething(step) && limitOf(step) === undefined;
        })
        .map(nameOf);

      expect(unlimited).toEqual([]);
    },
  );

  test.each(browserJobs.map((entry) => [entry.where, entry]))(
    "%s: the job's limit holds the install's, every later step's, and the set-up before them",
    (_where, { job, steps, installAt }) => {
      const later = steps.slice(installAt).reduce((sum, step) => {
        return sum + (limitOf(step) || 0);
      }, 0);

      expect(Number(job["timeout-minutes"])).toBeGreaterThanOrEqual(
        later + SET_UP_MINUTES,
      );
    },
  );

  test("a retry step's limit is its tries' limits and the waits between", () => {
    expect(
      limitOf({
        uses: "nick-fields/retry@v3",
        with: { timeout_minutes: 30, max_attempts: 3 },
      }),
    ).toBeCloseTo(90 + 20 / 60);
    expect(
      limitOf({
        uses: "nick-fields/retry@v3",
        with: { timeout_seconds: 90, max_attempts: 2, retry_wait_seconds: 30 },
      }),
    ).toBeCloseTo(3.5);
    // A step's own limit stops the retries too, so it wins.
    expect(
      limitOf({
        uses: "nick-fields/retry@v3",
        "timeout-minutes": 12,
        with: { timeout_minutes: 30, max_attempts: 3 },
      }),
    ).toBe(12);
    expect(
      limitOf({ uses: "nick-fields/retry@v3", with: { max_attempts: 3 } }),
    ).toBeUndefined();
    expect(limitOf({ run: "npm test" })).toBeUndefined();
    expect(limitOf({ uses: "actions/upload-artifact@v4" })).toBeUndefined();
  });
});

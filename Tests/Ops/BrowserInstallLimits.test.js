"use strict";

/**
 * Browser jobs survive a slow Ubuntu mirror.
 *
 * `npx playwright install --with-deps` fetches about 25 MB of system packages
 * and fonts from the runner's Ubuntu mirror. It takes about 25 seconds, but
 * some runners are served at a few dozen kB/s: the install took 20 minutes in
 * a Dashboard Offline UI group (2026-10-22), and it ran past the Backups
 * job's 10-minute install limit twice on master on 2026-10-26, failing the
 * job with nothing tested.
 *
 * So in every job that sets a time limit and installs a browser's system
 * packages:
 *   - the install step has a limit of its own, of at least 25 minutes;
 *   - every step after it that runs something has a limit of its own;
 *   - the job's limit holds all of those, plus 7 minutes for checkout,
 *     Node and the npm installs before them.
 * Then a slow mirror costs time, not a red job, and a hung suite still stops
 * at its own limit.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github", "workflows");
const INSTALL_MINUTES = 25;
const SET_UP_MINUTES = 7;

function isBrowserInstall(step) {
  const command = String(step.run || "");

  return (
    /\bplaywright install\b/.test(command) && command.includes("--with-deps")
  );
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

const limitedJobs = browserJobs.filter(({ job }) => {
  return job["timeout-minutes"] !== undefined;
});

describe("browser jobs and a slow Ubuntu mirror", () => {
  test("finds the browser jobs that set a time limit", () => {
    // If these go missing, the checks below would pass by checking nothing.
    expect(
      limitedJobs.map(({ where }) => {
        return where;
      }),
    ).toEqual(
      expect.arrayContaining([
        "test.app.yaml session-replay-ui",
        "test.app.yaml dashboard-offline-ui",
        "test.ee.yaml backups-ui",
      ]),
    );
  });

  test.each(limitedJobs.map((entry) => [entry.where, entry]))(
    "%s: the browser install has at least 25 minutes of its own",
    (_where, { steps, installAt }) => {
      expect(steps[installAt]["timeout-minutes"]).toBeGreaterThanOrEqual(
        INSTALL_MINUTES,
      );
    },
  );

  test.each(limitedJobs.map((entry) => [entry.where, entry]))(
    "%s: every step after the install that runs something has a limit of its own",
    (_where, { steps, installAt }) => {
      const unlimited = steps
        .slice(installAt + 1)
        .filter((step) => {
          return (
            step.run !== undefined && step["timeout-minutes"] === undefined
          );
        })
        .map(nameOf);

      expect(unlimited).toEqual([]);
    },
  );

  test.each(limitedJobs.map((entry) => [entry.where, entry]))(
    "%s: the job's limit holds the install's, every later step's, and the set-up before them",
    (_where, { job, steps, installAt }) => {
      const later = steps.slice(installAt).reduce((sum, step) => {
        return sum + (Number(step["timeout-minutes"]) || 0);
      }, 0);

      expect(Number(job["timeout-minutes"])).toBeGreaterThanOrEqual(
        later + SET_UP_MINUTES,
      );
    },
  );
});

"use strict";

/**
 * Every Dashboard Offline UI group fits its run step, with room for a slow
 * runner.
 *
 * App Test runs the offline browser suites in the groups of
 * dashboard-offline-ui's matrix (test.app.yaml), each group a job of its own
 * whose run step stops at its timeout-minutes (35). A runner can take up to
 * 1.45 times the minutes of another, suite for suite (14.0.100's second gate
 * run, 2026-11-01), so a group is planned at about 22 minutes on a runner of
 * median speed: about 32 on the slowest seen. Groups were planned by hand,
 * from each group's comment, and drifted as suites grew and joined them: on
 * 2026-11-02's six finished runs, group 14's suites took 30.5 minutes at a
 * median runner's speed (32.3 on its slowest run, 3 from its step's limit),
 * group 13's 26.1, and groups 2, 3, 12 and 15's 23.4 to 25.
 *
 * DashboardOfflineUiMinutes.json holds each suite's minutes in its group's
 * job - a suite run in halves, each half's ("<suite> 1/2") - the median over
 * the App Test runs it names (a new suite's from a local run until then).
 * This holds:
 *   - every suite, or half of one, a group runs has its minutes there, and
 *     there is nothing there no group runs;
 *   - each group's suites sum to at most GROUP_BUDGET_MINUTES (22), and a
 *     group past it is named with its sum, its suites and the groups with
 *     the most room;
 *   - the run step's limit holds a group at the budget on the slowest runner
 *     seen (22 x 1.45 = 31.9 <= 35).
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_TEST = ".github/workflows/test.app.yaml";
const MINUTES_FILE = "Tests/Ops/DashboardOfflineUiMinutes.json";

// A group's suites, at a median runner's speed, sum to at most this.
const GROUP_BUDGET_MINUTES = 22;
// The most minutes one runner took for what another took in one (2026-11-01).
const SLOWEST_RUNNER_FACTOR = 1.45;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const job = yaml.load(read(APP_TEST)).jobs["dashboard-offline-ui"];
const groups = job.strategy.matrix.include;
const measured = JSON.parse(read(MINUTES_FILE));
const minutes = measured.minutes;

/*
 * What a group runs, as DashboardOfflineUiMinutes.json names it: each suite,
 * or "<suite> <i>/<n>" for a suite the group runs one half of (its
 * <name>_shard key, which DashboardOfflineUiShards holds to the suite).
 */
function entriesOf(group) {
  const halves = Object.entries(group)
    .filter(([key]) => {
      return key.endsWith("_shard");
    })
    .map(([key, value]) => {
      return {
        suite: `test-${key.replace(/_shard$/, "").replace(/_/g, "-")}-ui`,
        half: value,
      };
    });

  return String(group.suites || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((suite) => {
      const half = halves.find((candidate) => {
        return candidate.suite === suite;
      });
      return half ? `${suite} ${half.half}` : suite;
    });
}

function sumOf(entries) {
  return entries.reduce((sum, entry) => {
    return sum + (minutes[entry] || 0);
  }, 0);
}

// Each group of `list` with what its suites sum to, the lightest first.
function groupsByRoom(list) {
  return list
    .map((group) => {
      return { group: group.group, sum: sumOf(entriesOf(group)) };
    })
    .sort((a, b) => {
      return a.sum - b.sum;
    });
}

/*
 * One line per group of `list` whose suites sum past the budget: its sum,
 * its suites and the three groups with the most room.
 */
function overBudget(list) {
  const roomiest = groupsByRoom(list)
    .slice(0, 3)
    .map(({ group, sum }) => {
      return `group ${group} (${sum.toFixed(1)})`;
    })
    .join(", ");

  return list
    .map((group) => {
      const entries = entriesOf(group);
      return { group: group.group, entries, sum: sumOf(entries) };
    })
    .filter(({ sum }) => {
      return sum > GROUP_BUDGET_MINUTES + 1e-9;
    })
    .map(({ group, entries, sum }) => {
      const listed = entries
        .map((entry) => {
          return `${entry} ${minutes[entry]}`;
        })
        .join(", ");
      return `group ${group} sums to ${sum.toFixed(1)} minutes (${listed}): move a suite to a group with room - ${roomiest} - or add a group`;
    });
}

describe("the Dashboard Offline UI groups' minutes", () => {
  test("are read from the workflow and the measurements (the checks below are not vacuous)", () => {
    expect(groups.length).toBeGreaterThan(10);
    expect(Object.keys(minutes).length).toBeGreaterThan(80);
    expect(measured.runs.length).toBeGreaterThan(0);
    // The halves are read as halves: Event Overview runs in two groups.
    expect(
      groups.flatMap(entriesOf).filter((entry) => {
        return entry.startsWith("test-event-overview-ui ");
      }),
    ).toEqual(["test-event-overview-ui 1/2", "test-event-overview-ui 2/2"]);
    // Every entry names a script packages/E2E has.
    const scripts = JSON.parse(read("packages/E2E/package.json")).scripts;
    for (const entry of groups.flatMap(entriesOf)) {
      const script = entry.split(" ")[0];
      expect({ entry, script: Boolean(scripts[script]) }).toEqual({
        entry,
        script: true,
      });
    }
  });

  test("every suite a group runs has its minutes measured, and every measurement is of a suite a group runs", () => {
    const run = groups.flatMap(entriesOf);
    const unmeasured = run.filter((entry) => {
      return typeof minutes[entry] !== "number" || !(minutes[entry] > 0);
    });
    const unrun = Object.keys(minutes).filter((entry) => {
      return !run.includes(entry);
    });

    expect({
      unmeasured,
      fix: unmeasured.length
        ? `add each one's minutes to ${MINUTES_FILE} (a new suite's from a local run: CI=1, its bundle built, nothing else running)`
        : "",
    }).toEqual({ unmeasured: [], fix: "" });
    expect({
      unrun,
      fix: unrun.length
        ? `remove them from ${MINUTES_FILE}, or give each a group`
        : "",
    }).toEqual({ unrun: [], fix: "" });
  });

  test(`each group's suites sum to at most ${GROUP_BUDGET_MINUTES} minutes on a runner of median speed`, () => {
    expect(overBudget(groups)).toEqual([]);
  });

  test("the run step's limit holds a group at the budget on the slowest runner seen", () => {
    const step = job.steps.find((candidate) => {
      return candidate.name === "Run this group's UI regressions";
    });

    expect(step).toBeDefined();
    expect(GROUP_BUDGET_MINUTES * SLOWEST_RUNNER_FACTOR).toBeLessThanOrEqual(
      Number(step["timeout-minutes"]),
    );
    // And the job's own limit leaves room for its setup after the step's.
    expect(Number(job["timeout-minutes"])).toBeGreaterThan(
      Number(step["timeout-minutes"]),
    );
  });

  test("a group past the budget is named, with its sum, its suites and the groups with the most room", () => {
    // Code and Chart Time Zoom in one group: past the budget.
    const heavy = {
      group: 99,
      suites: "test-code-ui test-chart-time-zoom-ui",
    };
    const light = { group: 98, suites: "test-alerts-ui" };
    const half = {
      group: 97,
      event_overview_shard: "2/2",
      suites: "test-event-overview-ui test-alerts-ui",
    };
    const code = minutes["test-code-ui"];
    const chart = minutes["test-chart-time-zoom-ui"];
    const alerts = minutes["test-alerts-ui"];
    const secondHalf = minutes["test-event-overview-ui 2/2"];

    expect(code + chart).toBeGreaterThan(GROUP_BUDGET_MINUTES);
    expect(overBudget([heavy, light, half])).toEqual([
      `group 99 sums to ${(code + chart).toFixed(1)} minutes (test-code-ui ${code}, test-chart-time-zoom-ui ${chart}): move a suite to a group with room - group 98 (${alerts.toFixed(1)}), group 97 (${(secondHalf + alerts).toFixed(1)}), group 99 (${(code + chart).toFixed(1)}) - or add a group`,
    ]);
    expect(overBudget([light, half])).toEqual([]);
  });
});

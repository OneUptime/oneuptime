"use strict";

/**
 * Every Dashboard Offline UI group fits its run step, with room for a slow
 * runner.
 *
 * App Test runs the offline browser suites in the groups of
 * dashboard-offline-ui's matrix (test.app.yaml), each group a job of its own
 * whose run step stops at its timeout-minutes (35). The step runs a group's
 * suites two at a time (packages/E2E/Scripts/RunUiSuites.js, UI_SUITE_LANES):
 * the slowest first, each lane starting the next suite as soon as it is free,
 * but never one that shares a port, a fixture server or an output directory
 * with a suite running. A runner can take up to 1.45 times the minutes of
 * another, suite for suite (14.0.100's second gate run, 2026-11-01), so a
 * group is planned at about 22 minutes on a runner of median speed: about 32
 * on the slowest seen.
 *
 * DashboardOfflineUiMinutes.json holds each suite's minutes in its group's
 * job, beside another suite - a suite run in parts, each part's
 * ("<suite> 1/3") - measured from App Test's runs (its `about` says how; a
 * new suite's from a local run until then). This holds:
 *   - every suite, or part of one, a group runs has its minutes there, and
 *     there is nothing there no group runs;
 *   - each group's suites, started as RunUiSuites.js starts them (its own
 *     slowestFirst and nextToStart, with what each suite's config holds read
 *     by its resourcesBySuite), end within GROUP_BUDGET_MINUTES (22) on the
 *     run step's lanes, and a group past it is named with its minutes, its
 *     suites and the groups with the most room;
 *   - the run step's limit holds a group at the budget on the slowest runner
 *     seen (22 x 1.45 = 31.9 <= 35).
 *
 * The minutes are each suite's beside another, so a suite that ends a group
 * alone is counted slower than it runs: a group ends a little before its
 * minutes here, never after.
 *
 * Groups were planned by hand, from each group's comment, and drifted as
 * suites grew and joined them: on 2026-11-02's six finished runs, group 14's
 * suites took 30.5 minutes at a median runner's speed (32.3 on its slowest
 * run, 3 from its step's limit). Until 2026-11-17, when two at a time had
 * been measured, a group's budget was the sum of its suites' minutes one at
 * a time, and there were 22 groups.
 */

const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const yaml = require("js-yaml");

const {
  minutesKeyOf,
  nextToStart,
  resourcesBySuite,
  slowestFirst,
} = require("../../packages/E2E/Scripts/RunUiSuites");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_TEST = ".github/workflows/test.app.yaml";
const MINUTES_FILE = "Tests/Ops/DashboardOfflineUiMinutes.json";
const RUN_STEP = "Run this group's UI regressions";

// A group's suites, on its run step's lanes at a median runner's speed, end
// within this.
const GROUP_BUDGET_MINUTES = 22;
// The most minutes one runner took for what another took in one (2026-11-01).
const SLOWEST_RUNNER_FACTOR = 1.45;

// What the configs import from @playwright/test, for reading them where it is
// not installed (this suite's own job installs Tests/Ops alone).
const PLAYWRIGHT_STUB = {
  defineConfig: (config) => {
    return config;
  },
  devices: new Proxy(
    {},
    {
      get: () => {
        return {};
      },
    },
  ),
};

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const job = yaml.load(read(APP_TEST)).jobs["dashboard-offline-ui"];
const groups = job.strategy.matrix.include;
const runStep = job.steps.find((step) => {
  return step.name === RUN_STEP;
});
const LANES = Number(runStep && runStep.env && runStep.env.UI_SUITE_LANES);
const measured = JSON.parse(read(MINUTES_FILE));
const minutes = measured.minutes;

function suitesOf(group) {
  return String(group.suites || "")
    .split(/\s+/)
    .filter(Boolean);
}

/*
 * The variables the job's env hands a group's suites: each <name>_shard key
 * as <NAME>_SHARD (DashboardOfflineUiShards holds the env to it), which
 * RunUiSuites.js reads to find a part's minutes.
 */
function envOf(group) {
  const env = {};
  for (const [key, value] of Object.entries(group)) {
    if (key.endsWith("_shard")) {
      env[key.toUpperCase()] = String(value);
    }
  }
  return env;
}

/*
 * What a group runs, as DashboardOfflineUiMinutes.json names it: each suite,
 * or "<suite> <i>/<n>" for a suite the group runs one part of.
 */
function entriesOf(group) {
  const env = envOf(group);
  return suitesOf(group).map((suite) => {
    return minutesKeyOf(suite, env);
  });
}

const allSuites = [...new Set(groups.flatMap(suitesOf))].sort();
const resources = resourcesBySuite(
  allSuites,
  JSON.parse(read("packages/E2E/package.json")).scripts,
  path.join(REPO_ROOT, "packages/E2E"),
  esbuild,
  () => {
    // A config that cannot be read runs alone, and is planned so;
    // RunUiSuites.test.js fails on it.
  },
  { "@playwright/test": PLAYWRIGHT_STUB },
);

/*
 * When the last of `suites` ends, starting them as RunUiSuites.js does on
 * `lanes` lanes: the slowest first, each lane taking the first waiting suite
 * that shares nothing with those running, every suite taking its minutes.
 */
function minutesOnLanes(
  suites,
  env,
  minutesByKey,
  resourcesBySuiteName,
  lanes,
) {
  const waiting = slowestFirst(suites, minutesByKey, env);
  const running = new Map();
  let now = 0;

  while (waiting.length > 0 || running.size > 0) {
    while (running.size < lanes) {
      const next = nextToStart(
        waiting,
        [...running.keys()],
        resourcesBySuiteName,
      );
      if (!next) {
        break;
      }
      waiting.splice(waiting.indexOf(next), 1);
      running.set(next, now + (minutesByKey[minutesKeyOf(next, env)] || 0));
    }

    const [first] = [...running.entries()].sort((a, b) => {
      return a[1] - b[1];
    });
    running.delete(first[0]);
    now = first[1];
  }

  return now;
}

function minutesOf(group) {
  return minutesOnLanes(
    suitesOf(group),
    envOf(group),
    minutes,
    resources,
    LANES,
  );
}

// Each group of `list` with its minutes, the lightest first.
function groupsByRoom(list) {
  return list
    .map((group) => {
      return { group: group.group, minutes: minutesOf(group) };
    })
    .sort((a, b) => {
      return a.minutes - b.minutes;
    });
}

/*
 * One line per group of `list` whose suites end past the budget: its
 * minutes, its suites and the three groups with the most room.
 */
function overBudget(list) {
  const roomiest = groupsByRoom(list)
    .slice(0, 3)
    .map(({ group, minutes: taken }) => {
      return `group ${group} (${taken.toFixed(1)})`;
    })
    .join(", ");

  return list
    .map((group) => {
      return {
        group: group.group,
        entries: entriesOf(group),
        taken: minutesOf(group),
      };
    })
    .filter(({ taken }) => {
      return taken > GROUP_BUDGET_MINUTES + 1e-9;
    })
    .map(({ group, entries, taken }) => {
      const listed = entries
        .map((entry) => {
          return `${entry} ${minutes[entry]}`;
        })
        .join(", ");
      return `group ${group} takes ${taken.toFixed(1)} minutes on ${LANES} lanes (${listed}): move a suite to a group with room - ${roomiest} - or add a group`;
    });
}

describe("the Dashboard Offline UI groups' minutes", () => {
  test("are read from the workflow and the measurements (the checks below are not vacuous)", () => {
    expect(groups.length).toBeGreaterThan(5);
    expect(Object.keys(minutes).length).toBeGreaterThan(80);
    expect(measured.runs.length).toBeGreaterThan(0);
    // The run step's lanes, which RunUiSuites.test.js holds to 2.
    expect(LANES).toBe(2);
    // The parts are read as parts: Event Overview runs in three groups.
    expect(
      groups.flatMap(entriesOf).filter((entry) => {
        return entry.startsWith("test-event-overview-ui");
      }),
    ).toEqual([
      "test-event-overview-ui 1/3",
      "test-event-overview-ui 2/3",
      "test-event-overview-ui 3/3",
    ]);
    // Every suite's config was read for what it holds.
    expect(resources.size).toBe(allSuites.length);
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
        ? `add each one's minutes to ${MINUTES_FILE} (a new suite's from a local run: CI=1, its bundle built, nothing else running, times the slowdown its about gives for a suite beside another)`
        : "",
    }).toEqual({ unmeasured: [], fix: "" });
    expect({
      unrun,
      fix: unrun.length
        ? `remove them from ${MINUTES_FILE}, or give each a group`
        : "",
    }).toEqual({ unrun: [], fix: "" });
  });

  test(`each group's suites end within ${GROUP_BUDGET_MINUTES} minutes on the run step's lanes, at a median runner's speed`, () => {
    expect(overBudget(groups)).toEqual([]);
  });

  test("the run step's limit holds a group at the budget on the slowest runner seen", () => {
    expect(runStep).toBeDefined();
    expect(GROUP_BUDGET_MINUTES * SLOWEST_RUNNER_FACTOR).toBeLessThanOrEqual(
      Number(runStep["timeout-minutes"]),
    );
    // And the job's own limit leaves room for its setup after the step's.
    expect(Number(job["timeout-minutes"])).toBeGreaterThan(
      Number(runStep["timeout-minutes"]),
    );
  });

  test("a group's minutes are when its last suite ends, started as the script starts them", () => {
    const stubMinutes = {
      "test-a-ui": 10,
      "test-b-ui": 6,
      "test-c-ui": 5,
      "test-d-ui 2/3": 4,
    };
    const apart = new Map([
      ["test-a-ui", ["port:1"]],
      ["test-b-ui", ["port:2"]],
      ["test-c-ui", ["port:3"]],
      ["test-d-ui", ["port:4"]],
    ]);
    const suites = ["test-c-ui", "test-a-ui", "test-b-ui"];

    // a and b start; c takes b's lane at 6 and ends at 11, after a.
    expect(minutesOnLanes(suites, {}, stubMinutes, apart, 2)).toBe(11);
    // One lane: their sum.
    expect(minutesOnLanes(suites, {}, stubMinutes, apart, 1)).toBe(21);
    // c shares a's port: it waits for a, at 10, though b's lane is free at 6.
    const sharing = new Map(apart).set("test-c-ui", ["port:1"]);
    expect(minutesOnLanes(suites, {}, stubMinutes, sharing, 2)).toBe(15);
    // A part's minutes are its own: d's 2/3, which starts beside a.
    expect(
      minutesOnLanes(
        ["test-a-ui", "test-d-ui"],
        { D_SHARD: "2/3" },
        stubMinutes,
        apart,
        2,
      ),
    ).toBe(10);
  });

  test("a group past the budget is named, with its minutes, its suites and the groups with the most room", () => {
    // The Security Operations suites share their fixture server and port, so
    // in one group they run one after another: past the budget.
    const heavy = {
      group: 99,
      security_operations_shard: "1/2",
      suites:
        "test-security-operations-ui test-security-cases-detections-ui test-security-hunts-ui",
    };
    const light = { group: 98, suites: "test-alerts-ui" };
    const part = {
      group: 97,
      event_overview_shard: "3/3",
      suites: "test-event-overview-ui test-alerts-ui",
    };
    const operations = minutes["test-security-operations-ui 1/2"];
    const cases = minutes["test-security-cases-detections-ui"];
    const hunts = minutes["test-security-hunts-ui"];
    const alerts = minutes["test-alerts-ui"];
    const thirdPart = minutes["test-event-overview-ui 3/3"];
    const serial = operations + cases + hunts;

    expect(serial).toBeGreaterThan(GROUP_BUDGET_MINUTES);
    expect(thirdPart).toBeGreaterThan(alerts);
    expect(overBudget([heavy, light, part])).toEqual([
      `group 99 takes ${serial.toFixed(1)} minutes on 2 lanes (test-security-operations-ui 1/2 ${operations}, test-security-cases-detections-ui ${cases}, test-security-hunts-ui ${hunts}): move a suite to a group with room - group 98 (${alerts.toFixed(1)}), group 97 (${thirdPart.toFixed(1)}), group 99 (${serial.toFixed(1)}) - or add a group`,
    ]);
    expect(overBudget([light, part])).toEqual([]);
  });
});

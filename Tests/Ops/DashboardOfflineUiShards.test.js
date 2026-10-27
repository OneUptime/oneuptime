"use strict";

/**
 * A suite App Test runs in halves runs every half, once.
 *
 * Event Overview (since 2026-10-22) and the Workflow Builder suite (since
 * 2026-10-27) each took a Dashboard Offline UI group past the minutes a
 * group is kept to on its own, so each runs in halves: a group's matrix sets
 * <suite>_shard ("1/2" or "2/2"), the job's env hands it to the suite's
 * Playwright config as a variable of its own (EVENT_OVERVIEW_SHARD,
 * WORKFLOW_BUILDER_SHARD), and the config passes it to Playwright's shard.
 * A half that no group runs never fails; a half two groups run costs a
 * group's minutes twice; a group that sets the key but runs another suite,
 * or a config that reads another variable, runs the whole suite there - or
 * nothing.
 *
 * This holds, for every <name>_shard key of the groups:
 *   - the groups that set it say 1/N .. N/N, each once, all with one N;
 *   - each of them runs the suite the key is for, and no other group does;
 *   - the job's env sets the config's variable from the key, empty where a
 *     group does not set it, and the config reads that variable into its
 *     shard - so an unset variable runs the whole suite, as it always has.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_TEST = ".github/workflows/test.app.yaml";
const E2E_DIR = "packages/E2E";

// Each shard key, the suite it splits, and the variable its config reads.
const SPLIT_SUITES = {
  event_overview_shard: {
    suite: "test-event-overview-ui",
    variable: "EVENT_OVERVIEW_SHARD",
  },
  workflow_builder_shard: {
    suite: "test-workflow-builder-ui",
    variable: "WORKFLOW_BUILDER_SHARD",
  },
};

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const job = yaml.load(read(APP_TEST)).jobs["dashboard-offline-ui"];
const groups = job.strategy.matrix.include;
const scripts = JSON.parse(read(`${E2E_DIR}/package.json`)).scripts;

function suitesOf(group) {
  return String(group.suites || "")
    .split(/\s+/)
    .filter(Boolean);
}

function configOf(suite) {
  const config = /--config (\S+)/.exec(scripts[suite] || "");
  if (!config) {
    throw new Error(`${suite} runs no Playwright config of its own`);
  }
  return `${E2E_DIR}/${config[1]}`;
}

const shardKeys = [
  ...new Set(
    groups.flatMap((group) => {
      return Object.keys(group).filter((key) => {
        return /_shard$/.test(key);
      });
    }),
  ),
].sort();

describe(`${APP_TEST}: a suite run in halves runs every half, once`, () => {
  test("finds the suites run in halves (the checks below are not vacuous)", () => {
    expect(shardKeys).toEqual(Object.keys(SPLIT_SUITES).sort());
  });

  test.each(Object.keys(SPLIT_SUITES))(
    "%s: every half, once, with one count of halves",
    (key) => {
      const values = groups
        .filter((group) => {
          return group[key] !== undefined;
        })
        .map((group) => {
          return String(group[key]);
        })
        .sort();
      const counts = new Set(
        values.map((value) => {
          return value.split("/")[1];
        }),
      );

      expect(counts.size).toBe(1);
      const total = Number([...counts][0]);
      expect(total).toBeGreaterThanOrEqual(2);
      expect(values).toEqual(
        Array.from({ length: total }, (_unused, index) => {
          return `${index + 1}/${total}`;
        }),
      );
    },
  );

  test.each(Object.entries(SPLIT_SUITES))(
    "%s: the groups that set it run its suite, and no other group does",
    (key, { suite }) => {
      for (const group of groups) {
        expect({
          group: group.group,
          setsTheKey: group[key] !== undefined,
          runsTheSuite: suitesOf(group).includes(suite),
        }).toEqual({
          group: group.group,
          setsTheKey: group[key] !== undefined,
          runsTheSuite: group[key] !== undefined,
        });
      }
    },
  );

  test.each(Object.entries(SPLIT_SUITES))(
    "%s: the job hands it to the config's own variable, and the config shards by it",
    (key, { suite, variable }) => {
      expect(job.env[variable]).toBe(`\${{ matrix.${key} || '' }}`);

      const config = read(configOf(suite));
      expect(config).toContain(`process.env["${variable}"]`);
      // Playwright's shard, from the variable; null (the whole suite) unset.
      expect(config).toMatch(/\bshard: shard,/);
      expect(config).toMatch(/: null;/);
    },
  );

  test("the halves of every split suite add up to the suite: each config splits by Playwright's shard, never its own lists", () => {
    for (const { suite } of Object.values(SPLIT_SUITES)) {
      const config = read(configOf(suite));
      expect(config).not.toMatch(/testIgnore|grepInvert/);
    }
  });
});

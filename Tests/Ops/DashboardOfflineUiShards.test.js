"use strict";

/**
 * A suite App Test runs in parts runs every part, once.
 *
 * Event Overview (since 2026-10-22), the Workflow Builder suite (since
 * 2026-10-27), Model Tables and Monitor Overview (both since 2026-11-01)
 * each took a Dashboard Offline UI group past the minutes a group is kept to
 * on its own, so each runs in halves - the OpenStack pages (since
 * 2026-11-05) in thirds since 2026-11-10, when they outgrew two groups. Since
 * 2026-11-17 a group runs two suites at a time, each slower beside the other,
 * so Event Overview runs in thirds and Security Operations in halves: a
 * group's matrix sets <suite>_shard ("1/2" or "2/2", or "1/3" to "3/3"), the
 * job's env hands it to the suite's Playwright config as a variable of its
 * own (EVENT_OVERVIEW_SHARD, WORKFLOW_BUILDER_SHARD, MODEL_TABLES_SHARD,
 * MONITOR_OVERVIEW_SHARD, OPENSTACK_PAGES_SHARD, SECURITY_OPERATIONS_SHARD),
 * and the config passes it to Playwright's shard.
 * A part that no group runs never fails; a part two groups run costs a
 * group's minutes twice; a group that sets the key but runs another suite,
 * or a config that reads another variable, runs the whole suite there - or
 * nothing.
 *
 * This holds, for every <name>_shard key of the groups:
 *   - the groups that set it say 1/N .. N/N, each once, all with one N;
 *   - each of them runs the suite the key is for, and no other group does;
 *   - the job's env sets the config's variable from the key, empty where a
 *     group does not set it, and the config reads that variable into its
 *     shard - so an unset variable runs the whole suite, as it always has;
 *   - each part's config, read as Playwright reads it with the group's
 *     value, is the whole suite's but for Playwright's shard (and
 *     fullyParallel, which splits a suite by test rather than by file): a
 *     config never picks a part's tests by lists of its own, so the parts add
 *     up to the suite.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
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
  model_tables_shard: {
    suite: "test-model-tables-ui",
    variable: "MODEL_TABLES_SHARD",
  },
  monitor_overview_shard: {
    suite: "test-monitor-overview-ui",
    variable: "MONITOR_OVERVIEW_SHARD",
  },
  openstack_pages_shard: {
    suite: "test-openstack-pages-ui",
    variable: "OPENSTACK_PAGES_SHARD",
  },
  security_operations_shard: {
    suite: "test-security-operations-ui",
    variable: "SECURITY_OPERATIONS_SHARD",
  },
};

/*
 * Prints the config file given as its argument as Playwright reads it -
 * bundled, by packages/E2E/Scripts/RunUiSuites.js's loadConfig, with what it
 * imports from @playwright/test stubbed (this suite's own job installs
 * Tests/Ops alone) - as JSON, a RegExp as its source. It runs in a process of
 * its own, so the config reads the environment it is given: a config reads
 * process.env when it is loaded, and jest's process.env is a copy.
 */
const READ_CONFIG = `
const { loadConfig } = require(${JSON.stringify(
  require.resolve("../../packages/E2E/Scripts/RunUiSuites"),
)});
const esbuild = require(${JSON.stringify(require.resolve("esbuild"))});
const stub = {
  defineConfig: (config) => config,
  devices: new Proxy({}, { get: () => ({}) }),
};
const config = loadConfig(process.argv[1], esbuild, { "@playwright/test": stub });
process.stdout.write(
  JSON.stringify(config, (key, value) => (value instanceof RegExp ? String(value) : value)),
);
`;

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

describe(`${APP_TEST}: a suite run in parts runs every part, once`, () => {
  test("finds the suites run in halves (the checks below are not vacuous)", () => {
    expect(shardKeys).toEqual(Object.keys(SPLIT_SUITES).sort());
  });

  test.each(Object.keys(SPLIT_SUITES))(
    "%s: every part, once, with one count of parts",
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

  test.each(Object.entries(SPLIT_SUITES))(
    "%s: each part's config is the whole suite's but for Playwright's shard, so the parts add up to the suite",
    (key, { suite, variable }) => {
      // The config as Playwright reads it with the variable at `value`
      // (unset when null).
      const configWith = (value) => {
        const env = { ...process.env };
        delete env[variable];
        if (value !== null) {
          env[variable] = value;
        }
        const result = spawnSync(
          process.execPath,
          ["-e", READ_CONFIG, path.join(REPO_ROOT, configOf(suite))],
          { env, encoding: "utf8" },
        );
        if (result.status !== 0) {
          throw new Error(
            `${configOf(suite)} could not be read: ${result.stderr}`,
          );
        }
        return JSON.parse(result.stdout);
      };
      // All but what may differ between the parts and the whole.
      const rest = (config) => {
        const copy = { ...config };
        delete copy.shard;
        delete copy.fullyParallel;
        return copy;
      };

      const whole = configWith(null);
      expect(whole.shard).toBeNull();

      const parts = groups
        .filter((group) => {
          return group[key] !== undefined;
        })
        .map((group) => {
          return String(group[key]);
        });
      expect(parts.length).toBeGreaterThanOrEqual(2);

      for (const part of parts) {
        const config = configWith(part);
        const [current, total] = part.split("/").map(Number);
        expect({ part, shard: config.shard }).toEqual({
          part,
          shard: { current, total },
        });
        expect({ part, config: rest(config) }).toEqual({
          part,
          config: rest(whole),
        });
      }
    },
  );
});

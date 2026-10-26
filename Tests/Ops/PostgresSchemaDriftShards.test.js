"use strict";

/**
 * Postgres Schema Drift runs its real-Postgres suites in shards.
 *
 * One job ran the drift check and then every opt-in Postgres suite in a row:
 * a step each, each starting jest again. It had grown to 29 minutes of its
 * 30 and started running out of time with nothing failing (2026-10-26), so
 * the job became a matrix of shards. Every shard sets up, migrates and checks
 * its database - the steps up to the drift check - and then runs only the
 * suite steps marked `if: matrix.shard == N` for it.
 *
 * What would quietly undo that: a suite step with no shard (it would run in
 * every shard, three times the time), one naming a shard the matrix does not
 * have (it would run nowhere), a set-up step given a shard (the other shards
 * would test an empty database), or a suite separated from the install it
 * needs (App's and ee's installs, and the PostgreSQL client tools, are run
 * only by the shard whose suites need them).
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = path.join(
  REPO_ROOT,
  ".github/workflows/postgres-schema-drift.yaml",
);
const JOB = "postgres-schema-drift";
const DRIFT_STEP = "Check for Postgres schema drift";
const SHARD_CONDITION = /^matrix\.shard == (\d+)$/;

const workflow = yaml.load(fs.readFileSync(WORKFLOW, "utf8"));
const job = workflow.jobs[JOB];
const steps = job.steps;
const driftAt = steps.findIndex((step) => {
  return step.name === DRIFT_STEP;
});
const setUp = steps.slice(0, driftAt + 1);
const suites = steps.slice(driftAt + 1);

function shardOf(step) {
  const match = SHARD_CONDITION.exec(String(step.if || "").trim());

  return match ? Number(match[1]) : null;
}

function nameOf(step) {
  return step.name || step.uses || step.run;
}

// Where an install step installs: the working directory its suites run in.
function installDirectory(step) {
  return ((step.with || {})["working-directory"] || ".").replace(/\/+$/, "");
}

describe("Postgres Schema Drift's shards", () => {
  test("the job is a matrix of shards numbered from 1", () => {
    const shards = job.strategy.matrix.shard;

    expect(shards.length).toBeGreaterThan(1);
    expect(shards).toEqual(
      shards.map((_shard, index) => {
        return index + 1;
      }),
    );
    // One shard's failure does not cancel the others.
    expect(job.strategy["fail-fast"]).toBe(false);
  });

  test("every shard sets up, migrates and checks the database first", () => {
    expect(driftAt).toBeGreaterThan(0);

    expect(
      setUp
        .filter((step) => {
          return step.if !== undefined;
        })
        .map(nameOf),
    ).toEqual([]);
  });

  test("every step after the drift check runs in exactly one shard the matrix has", () => {
    const shards = job.strategy.matrix.shard;

    expect(suites.length).toBeGreaterThan(100);
    expect(
      suites
        .filter((step) => {
          return !shards.includes(shardOf(step));
        })
        .map((step) => {
          return `${nameOf(step)}: ${step.if}`;
        }),
    ).toEqual([]);
  });

  test("a suite runs in the shard that installed what it needs", () => {
    const stray = [];
    // Directory -> the shard whose install step installed it.
    const installedIn = new Map();

    for (const step of suites) {
      const shard = shardOf(step);

      if (String(step.uses || "").endsWith("/npm-install")) {
        installedIn.set(installDirectory(step), shard);
        continue;
      }

      const directory = (step["working-directory"] || ".").replace(/\/+$/, "");

      if (
        (directory === "packages/App" || directory === "ee") &&
        installedIn.get(directory) !== shard
      ) {
        stray.push(
          `${nameOf(step)} (shard ${shard}) runs in ${directory}, installed ${
            installedIn.has(directory)
              ? `in shard ${installedIn.get(directory)}`
              : "nowhere before it"
          }`,
        );
      }
    }

    expect(stray).toEqual([]);
  });

  test("the PostgreSQL client tools are there for the backup suite", () => {
    const toolsAt = suites.findIndex((step) => {
      return (
        /pg_dump/.test(String(step.run || "")) && !step["working-directory"]
      );
    });
    const backup = suites.find((step) => {
      return /PostgresBackupEnginePostgres/.test(String(step.run || ""));
    });

    expect(toolsAt).toBeGreaterThan(-1);
    expect(backup).toBeDefined();
    expect(suites.indexOf(backup)).toBeGreaterThan(toolsAt);
    expect(shardOf(suites[toolsAt])).toBe(shardOf(backup));
  });
});

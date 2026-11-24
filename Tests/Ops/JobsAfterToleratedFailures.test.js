"use strict";

/**
 * NO JOB IS SKIPPED BY A FAILURE ANOTHER JOB RUNS PAST.
 *
 * Actions reads a job's `if` that calls no status function (success(),
 * failure(), cancelled(), always()) as `success() && if`, and for a job,
 * success() is false once any job before it has failed or been cancelled -
 * a job it needs, or a job before one of those. So when a job runs past a
 * failure (its `if` calls a status function and does not ask for that
 * need's success), each job after it with a plain `if` is still skipped by
 * that failure, even when every job it needs succeeded.
 *
 * release.yml's finalize-github-release publishes the release whether or
 * not the Android agent's APK, the two apps and the SBOM scan succeeded. The
 * jobs after it - the MCP Registry, the coding agent plugin, the
 * infrastructure agent's apt and yum, Homebrew and winget packages, and the
 * Android agent on Google Play - had plain `if`s, and android-agent-build
 * fails while the APK's signing key is not set: 17.1.0 (run 44800183941)
 * and 17.2.0 (run 45424081923) published none of them.
 *
 * This reads every workflow in .github/workflows and, for each job that
 * may fail, fails on each job with a plain `if` that the failure would skip
 * although every job it needs ran. Such a job reads each need's result by
 * name after !cancelled(), as afterEveryNeedSucceeded (Utils/ReleaseWorkflow)
 * writes it for release.yml. The publishers' conditions are then evaluated
 * the way Actions does, success() over every job before them.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const {
  needsOf,
  ancestorsOf,
  afterEveryNeedSucceeded,
} = require("./Utils/ReleaseWorkflow");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS = ".github/workflows";
const RELEASE = "release.yml";

const STATUS_FUNCTION = /\b(success|failure|cancelled|always)\(\)/;

// The jobs after finalize-github-release, each of which publishes elsewhere.
const PUBLISHERS_AFTER_THE_RELEASE = [
  "publish-mcp-registry",
  "publish-coding-agent-plugin",
  "publish-infrastructure-agent-apt-yum",
  "publish-infrastructure-agent-homebrew",
  "publish-infrastructure-agent-winget",
  "publish-android-agent-to-google-play",
];

// What finalize-github-release publishes without, when they fail.
const RUN_PAST_BY_THE_PUBLISH = [
  "android-agent-build",
  "mobile-app-android-build",
  "mobile-app-ios-build",
  "scan-sbom-vulnerabilities",
];

function readWorkflow(file) {
  const parsed = yaml.load(
    fs.readFileSync(path.join(REPO_ROOT, WORKFLOWS, file), "utf8"),
  );
  return (parsed && parsed.jobs) || {};
}

const workflowFiles = fs
  .readdirSync(path.join(REPO_ROOT, WORKFLOWS))
  .filter((file) => {
    return /\.ya?ml$/.test(file);
  })
  .sort();

function conditionOf(job) {
  return String((job && job.if) || "");
}

function callsAStatusFunction(job) {
  return STATUS_FUNCTION.test(conditionOf(job));
}

// Whether a job's `if` asks for `need` to have succeeded.
function requiresSuccessOf(job, need) {
  return conditionOf(job).includes(`needs.${need}.result == 'success'`);
}

/**
 * The jobs some job runs past - it needs them, its `if` calls a status
 * function, and it does not ask for their success - each with the jobs that
 * run past it.
 * @param {Object<string, Object>} jobs
 * @returns {Map<string, Array<string>>}
 */
function runPast(jobs) {
  const runPastBy = new Map();
  for (const [name, job] of Object.entries(jobs)) {
    if (!callsAStatusFunction(job)) {
      continue;
    }
    for (const need of needsOf(job)) {
      if (requiresSuccessOf(job, need)) {
        continue;
      }
      if (!runPastBy.has(need)) {
        runPastBy.set(need, []);
      }
      runPastBy.get(need).push(name);
    }
  }
  return runPastBy;
}

/**
 * The jobs a failure of `failed` keeps from running, itself included, as
 * Actions reads their `if`s: each job after it whose `if` calls no status
 * function (success() is false), and each one whose `if` calls one and asks
 * for the success of a job the failure kept from running. Any other term of
 * an `if` is taken to hold.
 * @param {Object<string, Object>} jobs
 * @param {Map<string, Set<string>>} before - each job's ancestorsOf
 * @param {string} failed
 * @returns {Set<string>}
 */
function keptFromRunningBy(jobs, before, failed) {
  const kept = new Set([failed]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, job] of Object.entries(jobs)) {
      if (kept.has(name) || !before.get(name).has(failed)) {
        continue;
      }
      const stopped =
        !callsAStatusFunction(job) ||
        needsOf(job).some((need) => {
          return kept.has(need) && requiresSuccessOf(job, need);
        });
      if (stopped) {
        kept.add(name);
        grew = true;
      }
    }
  }
  return kept;
}

/**
 * Each job a failure keeps from running although every job it needs ran,
 * as "job, when <failed job> fails": its `if` calls no status function, so
 * it is skipped by a failure some job before it ran past.
 * @param {Object<string, Object>} jobs
 * @returns {Array<string>}
 */
function skippedThoughEveryNeedRan(jobs) {
  const before = new Map(
    Object.keys(jobs).map((name) => {
      return [name, ancestorsOf(jobs, name)];
    }),
  );
  const skipped = [];
  for (const failed of Object.keys(jobs)) {
    const kept = keptFromRunningBy(jobs, before, failed);
    for (const [name, job] of Object.entries(jobs)) {
      if (name === failed || !kept.has(name) || callsAStatusFunction(job)) {
        continue;
      }
      const everyNeedRan = needsOf(job).every((need) => {
        return !kept.has(need);
      });
      if (everyNeedRan) {
        skipped.push(`${name}, when ${failed} fails`);
      }
    }
  }
  return skipped.sort();
}

/**
 * Whether Actions runs `name`, given how each job before it ended (anything
 * not named succeeded): its `if` read as `&&` terms, every one evaluated,
 * and a plain `if` read as `success() && if`, where success() is false
 * once any job before it - needed or not - has not succeeded. A term this
 * does not know fails the test rather than being guessed at.
 * @param {Object<string, Object>} jobs
 * @param {string} name
 * @param {{results?: Object, ref?: string, cancelled?: boolean}} run
 * @returns {boolean}
 */
function runs(
  jobs,
  name,
  { results = {}, ref = "refs/heads/release", cancelled = false },
) {
  const job = jobs[name];
  const needs = needsOf(job);
  const resultOf = (other) => {
    return results[other] || "success";
  };
  const succeeded = () => {
    return (
      !cancelled &&
      [...ancestorsOf(jobs, name)].every((other) => {
        return resultOf(other) === "success";
      })
    );
  };
  const condition = conditionOf(job)
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")
    .trim();
  const valueOf = (term) => {
    if (term === "!cancelled()") {
      return !cancelled;
    }
    if (term === "success()") {
      return succeeded();
    }
    const branch = /^github\.ref == '([^']*)'$/.exec(term);
    if (branch) {
      return ref === branch[1];
    }
    const result = /^needs\.([\w-]+)\.result == '(\w+)'$/.exec(term);
    if (result) {
      if (!needs.includes(result[1])) {
        throw new Error(
          `${name} reads needs.${result[1]}, a job it does not need`,
        );
      }
      return resultOf(result[1]) === result[2];
    }
    throw new Error(`${name}'s if: no way to read "${term}"`);
  };
  const values = (condition || "success()").split("&&").map((term) => {
    return valueOf(term.trim());
  });
  return (
    values.every(Boolean) && (STATUS_FUNCTION.test(condition) || succeeded())
  );
}

describe("every workflow: no job is skipped by a failure another job runs past", () => {
  test("reads every workflow (the check below is not vacuous)", () => {
    expect(workflowFiles).toEqual(expect.arrayContaining([RELEASE]));
    expect([...runPast(readWorkflow(RELEASE)).keys()].sort()).toEqual(
      [...RUN_PAST_BY_THE_PUBLISH].sort(),
    );
  });

  test.each(workflowFiles)("%s", (file) => {
    expect(skippedThoughEveryNeedRan(readWorkflow(file))).toEqual([]);
  });

  test("finds a job after a run-past failure, and not one a failed need skips", () => {
    const jobs = {
      build: {},
      optional: { needs: ["build"] },
      publish: { needs: ["build", "optional"], if: "${{ !cancelled() }}" },
      after: { needs: ["publish"], if: "github.ref == 'refs/heads/release'" },
      afterByName: {
        needs: ["publish"],
        if: "${{ !cancelled() && needs.publish.result == 'success' }}",
      },
      withTheOptional: { needs: ["optional", "publish"] },
    };
    expect(skippedThoughEveryNeedRan(jobs)).toEqual([
      "after, when build fails",
      "after, when optional fails",
    ]);
  });
});

describe(`${RELEASE}: the jobs after the release is published`, () => {
  const jobs = readWorkflow(RELEASE);

  test("are the six that publish elsewhere, each after the publish (the checks below are not vacuous)", () => {
    const after = Object.keys(jobs).filter((name) => {
      return ancestorsOf(jobs, name).has("finalize-github-release");
    });
    expect(after.sort()).toEqual([...PUBLISHERS_AFTER_THE_RELEASE].sort());
    for (const name of PUBLISHERS_AFTER_THE_RELEASE) {
      for (const optional of RUN_PAST_BY_THE_PUBLISH) {
        expect({
          name,
          optional,
          before: ancestorsOf(jobs, name).has(optional),
        }).toEqual({
          name,
          optional,
          before: true,
        });
      }
    }
  });

  test.each(PUBLISHERS_AFTER_THE_RELEASE)(
    "%s reads each need's result by name after !cancelled(), for `release`",
    (name) => {
      expect(jobs[name].if).toBe(afterEveryNeedSucceeded(jobs[name]));
    },
  );

  test.each(PUBLISHERS_AFTER_THE_RELEASE)(
    "%s runs once the release is published, whichever optional job failed",
    (name) => {
      expect(runs(jobs, name, {})).toBe(true);
      for (const optional of RUN_PAST_BY_THE_PUBLISH) {
        expect({
          optional,
          runs: runs(jobs, name, { results: { [optional]: "failure" } }),
        }).toEqual({ optional, runs: true });
      }
      expect(
        runs(jobs, name, {
          results: Object.fromEntries(
            RUN_PAST_BY_THE_PUBLISH.map((optional) => {
              return [optional, "failure"];
            }),
          ),
        }),
      ).toBe(true);
    },
  );

  test.each(PUBLISHERS_AFTER_THE_RELEASE)(
    "%s does not run when a job it needs did not succeed, the run was cancelled or the branch is not `release`",
    (name) => {
      for (const need of needsOf(jobs[name])) {
        for (const result of ["failure", "skipped", "cancelled"]) {
          expect({
            need,
            result,
            runs: runs(jobs, name, { results: { [need]: result } }),
          }).toEqual({ need, result, runs: false });
        }
      }
      expect(runs(jobs, name, { cancelled: true })).toBe(false);
      expect(runs(jobs, name, { ref: "refs/heads/main" })).toBe(false);
    },
  );

  test("a plain `if` after the publish would be skipped by the Android agent's APK failing (what 17.1.0 and 17.2.0 did)", () => {
    const planted = {
      ...jobs,
      "planted-publisher": {
        needs: ["read-version", "finalize-github-release"],
        if: "github.ref == 'refs/heads/release'",
      },
    };
    expect(runs(planted, "planted-publisher", {})).toBe(true);
    expect(
      runs(planted, "planted-publisher", {
        results: { "android-agent-build": "failure" },
      }),
    ).toBe(false);
    expect(skippedThoughEveryNeedRan(planted)).toEqual(
      RUN_PAST_BY_THE_PUBLISH.map((optional) => {
        return `planted-publisher, when ${optional} fails`;
      }).sort(),
    );
  });
});

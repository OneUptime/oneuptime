"use strict";

/**
 * A workflow that checks every pull request does not run again on every push
 * to main.
 *
 * A pull request's checks run on its merge with main, so running the same
 * workflows again on the merge commit's push tested what had just been
 * tested. And those runs never finished: main takes a merge every few
 * minutes on a working day, the organization runs at most 20 jobs at once,
 * and a push's run was cancelled by the next merge's (cancel-in-progress) or
 * by Scripts/Release/PrioritizeReleaseRuns.sh while a release was in flight.
 * None of the last 100 push runs of Compile, App Test or Common Test since
 * 2026-11-09 finished, and on 2026-11-16 the cancelled push runs took about a
 * fifth of every runner-minute the organization spent (1,304 of 6,416 between
 * 17:07 and 20:42 UTC), on runners that pull requests and the release's gate
 * were queued for.
 *
 * So a workflow that runs on every pull request (no `paths` or `paths-ignore`
 * on its pull_request trigger) runs on main nightly and when started by hand
 * (`schedule` and `workflow_dispatch`), never on `push`. A workflow that runs
 * only on pull requests touching certain paths may also run on pushes that
 * touch them, filtered the same way: those runs are rare and small.
 * test-release.yaml, which builds and publishes main's test images, does not
 * run on pull requests, so it keeps its push.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const WORKFLOWS = path.resolve(__dirname, "..", "..", ".github", "workflows");

// Every pull request runs it, and main need not: each with the reason.
const NOT_ON_MAIN = {
  // Every push to main builds the same images in test-release.yaml, from
  // the same Dockerfiles (build.yml's header says so).
  "build.yml": "test-release.yaml builds these images on every push to main",
};

const workflows = fs
  .readdirSync(WORKFLOWS)
  .filter((file) => {
    return /\.ya?ml$/.test(file);
  })
  .sort()
  .map((file) => {
    return {
      file,
      workflow:
        yaml.load(fs.readFileSync(path.join(WORKFLOWS, file), "utf8")) || {},
    };
  });

/**
 * A workflow's triggers as a map. `on:` can be an event name, a list of them,
 * or a map of event to its filters.
 * @param {object} workflow - The parsed workflow
 * @returns {object} event name -> filters (null when it has none)
 */
function triggers(workflow) {
  // js-yaml reads `on` as a string; a YAML 1.1 reader would make it `true`.
  const on = workflow.on === undefined ? workflow[true] : workflow.on;
  if (typeof on === "string") {
    return { [on]: null };
  }
  if (Array.isArray(on)) {
    return Object.fromEntries(
      on.map((event) => {
        return [event, null];
      }),
    );
  }
  return on || {};
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function filtersPaths(filters) {
  return (
    Boolean(filters) && (has(filters, "paths") || has(filters, "paths-ignore"))
  );
}

// The workflows every pull request runs, by file.
const everyPullRequest = workflows.filter(({ workflow }) => {
  const on = triggers(workflow);
  return has(on, "pull_request") && !filtersPaths(on.pull_request);
});

describe("workflows that check every pull request", () => {
  test("are read (the checks below are not vacuous)", () => {
    expect(
      everyPullRequest.map(({ file }) => {
        return file;
      }),
    ).toEqual(
      expect.arrayContaining([
        "compile.yml",
        "common-jobs.yaml",
        "test.app.yaml",
        "test.common.yaml",
        "postgres-schema-drift.yaml",
      ]),
    );
  });

  test("do not run again on a push", () => {
    const onPush = everyPullRequest
      .filter(({ workflow }) => {
        return has(triggers(workflow), "push");
      })
      .map(({ file }) => {
        return `${file}: drop its push trigger; main runs it on its schedule and on workflow_dispatch`;
      });

    expect(onPush).toEqual([]);
  });

  test("run on main nightly and when started by hand", () => {
    const untested = everyPullRequest
      .filter(({ file }) => {
        return !has(NOT_ON_MAIN, file);
      })
      .filter(({ workflow }) => {
        const on = triggers(workflow);
        const schedules = has(on, "schedule") ? on.schedule || [] : [];
        return schedules.length === 0 || !has(on, "workflow_dispatch");
      })
      .map(({ file }) => {
        return `${file}: give it a daily schedule and workflow_dispatch, or a reason in NOT_ON_MAIN`;
      });

    expect(untested).toEqual([]);
  });

  test("leave out of main only what still runs on every pull request", () => {
    for (const file of Object.keys(NOT_ON_MAIN)) {
      expect({
        file,
        everyPullRequest: everyPullRequest.some((entry) => {
          return entry.file === file;
        }),
      }).toEqual({ file, everyPullRequest: true });
    }
  });
});

describe("workflows that check only the pull requests touching certain paths", () => {
  test("filter their pushes by paths as well", () => {
    const unfiltered = workflows
      .filter(({ workflow }) => {
        const on = triggers(workflow);
        return (
          has(on, "pull_request") &&
          filtersPaths(on.pull_request) &&
          has(on, "push")
        );
      })
      .filter(({ workflow }) => {
        return !filtersPaths(triggers(workflow).push);
      })
      .map(({ file }) => {
        return file;
      });

    expect(unfiltered).toEqual([]);
  });
});

describe("the reader of a workflow's triggers", () => {
  test("reads an event name, a list of them, and a map of filters", () => {
    expect(triggers({ on: "push" })).toEqual({ push: null });
    expect(triggers({ on: ["push", "pull_request"] })).toEqual({
      push: null,
      pull_request: null,
    });
    expect(
      triggers({ on: { pull_request: { paths: ["a/**"] }, push: null } }),
    ).toEqual({ pull_request: { paths: ["a/**"] }, push: null });
    expect(filtersPaths({ paths: ["a/**"] })).toBe(true);
    expect(filtersPaths({ "paths-ignore": ["a/**"] })).toBe(true);
    expect(filtersPaths({ branches: ["main"] })).toBe(false);
    expect(filtersPaths(null)).toBe(false);
  });
});

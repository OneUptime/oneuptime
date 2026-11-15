"use strict";

/**
 * Every workflow limits its GITHUB_TOKEN.
 *
 * A job with no permissions of its own, in a workflow with none at the top,
 * runs with the repository's default token, which may write. CodeQL flags
 * each such job (actions/missing-workflow-permissions): twelve workflows had
 * one or more until 2026-10-27, 17 alerts. An alert follows the job's lines,
 * too: when such a job grows, CodeQL files it again under a new number, so a
 * change that only lengthened MobileApp's expo-web-export showed up on
 * 14.0.93's release gate as a new alert (#2411, filed before as #1616).
 *
 * So every workflow sets permissions at its top, or every one of its jobs
 * sets its own; and the twelve that had none read the repository, nothing
 * more.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const WORKFLOWS = path.resolve(__dirname, "..", "..", ".github", "workflows");

// Their jobs check out the code and test it, or generate from it and upload
// the result as an artifact.
const READ_ONLY_SINCE_2026_10_27 = [
  "common-jobs.yaml",
  "openapi-spec-generation.yml",
  "terraform-provider-generation.yml",
  "test.app.yaml",
  "test.infrastructure-agent.yaml",
  "test.kubernetes-ai-agent.yaml",
  "test.kubernetes-log-tailer.yaml",
  "test.mobile-app.yaml",
  "test.nginx.yaml",
  "test.probe.yaml",
  "test.runner.yaml",
  "test.yaml",
];

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

function workflowNamed(file) {
  return workflows.find((entry) => {
    return entry.file === file;
  }).workflow;
}

describe("every workflow limits its GITHUB_TOKEN", () => {
  test("reads the workflows", () => {
    // If none were read, the checks below would pass by checking nothing.
    expect(
      workflows.map(({ file }) => {
        return file;
      }),
    ).toEqual(
      expect.arrayContaining(["release.yml", ...READ_ONLY_SINCE_2026_10_27]),
    );
  });

  test("every job's token is limited at the top of its workflow or by the job", () => {
    const unlimited = workflows.flatMap(({ file, workflow }) => {
      if (workflow.permissions !== undefined) {
        return [];
      }

      return Object.entries(workflow.jobs || {})
        .filter(([, job]) => {
          return job.permissions === undefined;
        })
        .map(([id]) => {
          return `${file} ${id}`;
        });
    });

    expect(unlimited).toEqual([]);
  });

  test.each(READ_ONLY_SINCE_2026_10_27)(
    "%s reads the repository, nothing more",
    (file) => {
      const workflow = workflowNamed(file);

      expect(workflow.permissions).toEqual({ contents: "read" });

      // No job widens it for itself.
      const widened = Object.entries(workflow.jobs || {})
        .filter(([, job]) => {
          return job.permissions !== undefined;
        })
        .filter(([, job]) => {
          // A job may also say read-all or write-all.
          if (typeof job.permissions === "string") {
            return job.permissions !== "read-all";
          }

          return Object.values(job.permissions || {}).some((access) => {
            return access === "write";
          });
        })
        .map(([id]) => {
          return id;
        });

      expect(widened).toEqual([]);
    },
  );
});

/*
 * A called workflow's token is its caller's, cut down, never widened: a job
 * of a workflow called with `uses: ./.github/workflows/...` may ask for no
 * more than the calling job grants (its own permissions, else its
 * workflow's). GitHub checks every job of the called workflow when the run
 * starts, even one its `if` would skip, and refuses the whole run otherwise
 * ("The nested job 'report' is requesting 'issues: write', but is only
 * allowed 'issues: none'"). For release.yml that would be a release run
 * that never starts (#7510: docs-screens.yml's report job writes issues).
 */
describe("a called workflow asks for no more than its caller grants", () => {
  const LEVELS = { none: 0, read: 1, write: 2 };

  // Every permission a token can be given, for read-all and write-all.
  const SCOPES = [
    "actions",
    "attestations",
    "checks",
    "contents",
    "deployments",
    "discussions",
    "id-token",
    "issues",
    "models",
    "packages",
    "pages",
    "pull-requests",
    "repository-projects",
    "security-events",
    "statuses",
  ];

  // A permissions block as scope -> level: unnamed scopes are none.
  function levelsOf(permissions) {
    if (permissions === "read-all" || permissions === "write-all") {
      const level = permissions === "read-all" ? "read" : "write";
      return Object.fromEntries(
        SCOPES.map((scope) => {
          return [scope, LEVELS[level]];
        }),
      );
    }
    return Object.fromEntries(
      Object.entries(permissions || {}).map(([scope, level]) => {
        return [scope, LEVELS[level]];
      }),
    );
  }

  // What a job asks for: its own permissions, else its workflow's.
  function asked(workflow, job) {
    return job.permissions !== undefined
      ? job.permissions
      : workflow.permissions;
  }

  // Each `uses: ./.github/workflows/...` job, with the grant it calls with.
  const calls = workflows.flatMap(({ file, workflow }) => {
    return Object.entries(workflow.jobs || {})
      .filter(([, job]) => {
        return (
          typeof job.uses === "string" &&
          job.uses.startsWith("./.github/workflows/")
        );
      })
      .map(([id, job]) => {
        return {
          caller: `${file} ${id}`,
          called: path.basename(job.uses),
          grant: asked(workflow, job),
        };
      });
  });

  test("finds the release run's calls (the checks below are not vacuous)", () => {
    expect(
      calls.map(({ caller }) => {
        return caller;
      }),
    ).toEqual(
      expect.arrayContaining([
        "release.yml terraform-provider-e2e",
        "release.yml crossplane-provider-e2e",
        "release.yml docs-screens",
      ]),
    );
  });

  test.each(calls.map((call) => [call.caller, call]))(
    "%s grants every job of the workflow it calls what that job asks for",
    (_caller, { called, grant }) => {
      // Every workflow limits its token (above), so there is a grant to compare.
      expect(grant).toBeDefined();
      const granted = levelsOf(grant);
      const calledWorkflow = workflowNamed(called);
      const problems = Object.entries(calledWorkflow.jobs || {}).flatMap(
        ([id, job]) => {
          const asks = asked(calledWorkflow, job);
          if (asks === undefined) {
            // It gets the caller's grant as it is.
            return [];
          }
          return Object.entries(levelsOf(asks))
            .filter(([scope, level]) => {
              return level > (granted[scope] || 0);
            })
            .map(([scope]) => {
              return `${called} ${id} asks for ${scope}: ${
                Object.keys(LEVELS)[levelsOf(asks)[scope]]
              }, but is only allowed ${
                Object.keys(LEVELS)[granted[scope] || 0]
              }`;
            });
        },
      );

      expect(problems).toEqual([]);
    },
  );

  test("reads a grant the way GitHub does", () => {
    expect(levelsOf({ contents: "read", issues: "write" })).toEqual({
      contents: 1,
      issues: 2,
    });
    expect(levelsOf("read-all").issues).toBe(1);
    expect(levelsOf("write-all").packages).toBe(2);
    expect(levelsOf({}).contents).toBeUndefined();
  });
});

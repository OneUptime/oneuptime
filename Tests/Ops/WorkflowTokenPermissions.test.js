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

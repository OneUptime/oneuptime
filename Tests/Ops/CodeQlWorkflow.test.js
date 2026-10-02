"use strict";

/**
 * .github/workflows/codeql.yml is CodeQL's advanced setup, written to replace
 * the default setup configured in the repository's settings (see its header
 * for why, and for the two settings that switch it on).
 *
 * It is a like-for-like replacement except for when it runs, and both halves
 * matter: the same languages, build modes and categories as default setup, or
 * the alerts default setup raised would not carry over to it; and never on a
 * push to master, which is the scan it exists to drop. It must also stay
 * inert until default setup is off, because GitHub refuses an advanced
 * setup's results while default setup is on - after the analysis has run.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = ".github/workflows/codeql.yml";

const workflow = yaml.load(
  fs.readFileSync(path.join(REPO_ROOT, WORKFLOW), "utf8"),
);
// js-yaml reads `on` as a string key.
const triggers = workflow.on;
const analyze = workflow.jobs.analyze;

describe(WORKFLOW, () => {
  test("scans pull requests, nightly, and on demand - not pushes", () => {
    expect(Object.keys(triggers).sort()).toEqual(
      ["pull_request", "schedule", "workflow_dispatch"].sort(),
    );
    expect(triggers.schedule).toHaveLength(1);
  });

  test("analyses what default setup did, the way it did", () => {
    // From the repository's default setup analyses (build-mode per language).
    expect(analyze.strategy.matrix.include).toEqual([
      { language: "actions", "build-mode": "none" },
      { language: "go", "build-mode": "autobuild" },
      { language: "javascript-typescript", "build-mode": "none" },
    ]);
  });

  test("uploads under default setup's categories, so its alerts carry over", () => {
    const upload = analyze.steps.find((step) => {
      return /^github\/codeql-action\/analyze@/.test(step.uses || "");
    });

    expect(upload.with.category).toBe("/language:${{ matrix.language }}");
  });

  test("initializes each language with its build mode and the default query suite", () => {
    const init = analyze.steps.find((step) => {
      return /^github\/codeql-action\/init@/.test(step.uses || "");
    });

    expect(init.with).toEqual({
      languages: "${{ matrix.language }}",
      "build-mode": "${{ matrix.build-mode }}",
    });
  });

  test("runs nothing until the repository variable says default setup is off", () => {
    expect(analyze.if).toBe("vars.CODEQL_ADVANCED_SETUP == 'true'");
  });

  test("may write security events, and nothing else beyond reading", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(analyze.permissions).toEqual({
      actions: "read",
      contents: "read",
      "security-events": "write",
    });
  });
});

"use strict";

/**
 * The one issue that lists stale docs screenshots (#6823), kept by
 * packages/E2E/DocsScreens/ReportStale.js after the Docs Screenshots
 * workflow has drawn every shot again:
 *
 *   - a stale shot, or one that could not be drawn, opens the issue, or
 *     rewrites it when it is open;
 *   - every shot current closes the open issue, saying so, and does nothing
 *     when none is open;
 *   - only an issue with exactly its title counts.
 *
 * And the workflow around it: never on a pull request, the check in the
 * Playwright image, failing for a stale shot (#7510) while the issue still
 * lists it, only the reporting job allowed to write issues, and the check a
 * gate of every release run, in a concurrency group of that run's own.
 */

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const {
  STALE_ISSUE_TITLE,
  findOpenIssue,
  reportStale,
  staleIssueAction,
} = require("../../packages/E2E/DocsScreens/ReportStale.js");
const { ancestorsOf, needsOf } = require("./Utils/ReleaseWorkflow");
const { evaluateExpressions } = require("./Utils/WorkflowExpression");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "docs-screens.yml",
);
const RELEASE = path.join(REPO_ROOT, ".github", "workflows", "release.yml");

const CURRENT = { checked: 323, stale: [], failed: [] };
const STALE = {
  checked: 323,
  stale: [{ name: "website-down-who", lang: "de", reasons: ["x"] }],
  failed: [],
};
const BROKEN = {
  checked: 322,
  stale: [],
  failed: [{ name: "paging-test", lang: "ja", reasons: ["y"] }],
};

// A fake gh: answers `issue list` with `issues`, records every call.
function fakeGh(issues) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "list") {
      return JSON.stringify(issues);
    }
    return "";
  };
  return { gh, calls };
}

describe("what the job does with the issue", () => {
  test.each([
    [null, CURRENT, "nothing"],
    [7, CURRENT, "close"],
    [null, STALE, "create"],
    [7, STALE, "update"],
    [null, BROKEN, "create"],
    [7, BROKEN, "update"],
  ])("open issue %s, check %j: %s", (openIssue, check, action) => {
    expect(staleIssueAction(openIssue, check)).toBe(action);
  });

  test("reads a check with nothing listed as current", () => {
    expect(staleIssueAction(null, { checked: 0 })).toBe("nothing");
  });
});

describe("finding the issue", () => {
  test("asks for open issues by the title, and takes only the one with exactly that title", () => {
    const { gh, calls } = fakeGh([
      { number: 3, title: `${STALE_ISSUE_TITLE} (old)` },
      { number: 9, title: STALE_ISSUE_TITLE },
    ]);

    expect(findOpenIssue(gh)).toBe(9);
    expect(calls[0].slice(0, 4)).toEqual(["issue", "list", "--state", "open"]);
    expect(calls[0]).toContain(`"${STALE_ISSUE_TITLE}" in:title`);
  });

  test("finds none when no open issue has the title", () => {
    expect(findOpenIssue(fakeGh([{ number: 3, title: "Something else" }]).gh)).toBeNull();
    expect(findOpenIssue(() => "")).toBeNull();
  });
});

describe("keeping the issue", () => {
  test("opens it, with this run's text, when a shot is stale and none is open", () => {
    const { gh, calls } = fakeGh([]);
    const result = reportStale({
      check: STALE,
      body: "body",
      bodyFile: "/tmp/stale-issue.md",
      gh,
    });

    expect(result.action).toBe("create");
    expect(calls[1]).toEqual([
      "issue",
      "create",
      "--title",
      STALE_ISSUE_TITLE,
      "--body-file",
      "/tmp/stale-issue.md",
    ]);
  });

  test("rewrites the open one when a shot is stale or could not be drawn", () => {
    const { gh, calls } = fakeGh([{ number: 41, title: STALE_ISSUE_TITLE }]);

    expect(
      reportStale({ check: BROKEN, body: "b", bodyFile: "/tmp/b.md", gh }).action,
    ).toBe("update");
    expect(calls[1]).toEqual(["issue", "edit", "41", "--body-file", "/tmp/b.md"]);
  });

  test("closes the open one, saying every shot is current", () => {
    const { gh, calls } = fakeGh([{ number: 41, title: STALE_ISSUE_TITLE }]);

    expect(
      reportStale({ check: CURRENT, body: "b", bodyFile: "/tmp/b.md", gh }).action,
    ).toBe("close");
    expect(calls[1].slice(0, 3)).toEqual(["issue", "close", "41"]);
    expect(calls[1][4]).toContain("323 drawn, none stale");
  });

  test("does nothing more than look when every shot is current and none is open", () => {
    const { gh, calls } = fakeGh([]);

    expect(
      reportStale({ check: CURRENT, body: "b", bodyFile: "/tmp/b.md", gh }).action,
    ).toBe("nothing");
    expect(calls).toHaveLength(1);
  });
});

describe("the Docs Screenshots workflow", () => {
  const workflow = yaml.load(fs.readFileSync(WORKFLOW, "utf8"));
  // js-yaml reads the key `on` as true.
  const triggers = workflow.on || workflow[true];
  const check = workflow.jobs.check;
  const report = workflow.jobs.report;

  function stepNamed(name) {
    return check.steps.find((step) => {
      return step.name === name;
    });
  }

  const draw = stepNamed("Draw and compare every shot");
  const found = stepNamed("Say whether the check got as far as a verdict");
  const keep = stepNamed("Keep what the check found");

  test("runs on main, every night, by hand and when release.yml calls it, never on a pull request", () => {
    expect(Object.keys(triggers).sort()).toEqual(
      ["push", "schedule", "workflow_call", "workflow_dispatch"].sort(),
    );
    expect(triggers.push.branches).toEqual(["main"]);
    expect(triggers.push.paths).toEqual(
      expect.arrayContaining([
        "packages/E2E/DocsScreens/**",
        ".github/workflows/docs-screens.yml",
      ]),
    );
    expect(triggers.schedule).toHaveLength(1);
    expect(triggers.pull_request).toBeUndefined();
    expect(Object.keys(triggers.workflow_call.inputs)).toEqual([
      "release_run_id",
    ]);
    expect(triggers.workflow_call.inputs.release_run_id.required).toBe(false);
  });

  test("checks every shot in the Playwright image, with the script that fails for a stale one", () => {
    expect(check.container.image).toMatch(/^mcr\.microsoft\.com\/playwright:v/);
    expect(draw["working-directory"]).toBe("packages/E2E");
    expect(draw.run).toBe("npm run docs-screens:check");
    // No continue-on-error: a stale shot fails the step, so the job (#7510).
    expect(draw["continue-on-error"]).toBeUndefined();
    expect(check["continue-on-error"]).toBeUndefined();
    // The check's own script writes nothing in the repository.
    const scripts = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "packages/E2E/package.json"),
        "utf8",
      ),
    ).scripts;
    expect(scripts["docs-screens:check"]).toContain("DOCS_SCREENS_MODE=check");
    expect(scripts["docs-screens"]).not.toContain("DOCS_SCREENS_MODE");
  });

  test("still says what it found, and keeps it, after the check failed for a stale shot", () => {
    const index = (step) => {
      return check.steps.indexOf(step);
    };

    expect(index(draw)).toBeGreaterThan(-1);
    expect(index(found)).toBe(index(draw) + 1);
    expect(index(keep)).toBe(index(found) + 1);
    expect(found.if).toBe("${{ !cancelled() }}");
    expect(keep.if).toBe("${{ !cancelled() }}");
    expect(found.id).toBe("found");
    expect(check.outputs).toEqual({
      checked: "${{ steps.found.outputs.checked }}",
    });
    // What the report job reads is what the check writes, and is kept.
    expect(keep.with.path).toContain(
      "output/playwright/docs-screens/check.json",
    );
    expect(keep.with.path).toContain(
      "output/playwright/docs-screens/stale-issue.md",
    );
  });

  /*
   * The step's script, run as the job runs it (`bash -e`, from the
   * repository's root), in a folder that has a check, or none.
   */
  function runFound({ withCheck }) {
    const workDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docs-screens-found-"),
    );
    try {
      const output = path.join(workDir, "github-output");
      fs.writeFileSync(output, "");
      if (withCheck) {
        fs.mkdirSync(path.join(workDir, "output/playwright/docs-screens"), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(workDir, "output/playwright/docs-screens/check.json"),
          JSON.stringify(STALE),
        );
      }
      const script = path.join(workDir, "step.sh");
      fs.writeFileSync(script, found.run);
      const result = childProcess.spawnSync("bash", ["-e", script], {
        cwd: workDir,
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: output },
      });
      return {
        status: result.status,
        output: fs.readFileSync(output, "utf8"),
      };
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  test("says the check got as far as a verdict once it has written one, and not before", () => {
    expect(check.defaults.run.shell).toBe("bash -e {0}");
    expect(runFound({ withCheck: true })).toEqual({
      status: 0,
      output: "checked=true\n",
    });
    expect(runFound({ withCheck: false })).toEqual({ status: 0, output: "" });
  });

  /*
   * Whether the report job runs, as GitHub reads its `if`: the `&&` of its
   * terms, and, when it calls no status function, only once every job it
   * needs succeeded.
   */
  function reportRuns({
    ref = "refs/heads/main",
    checkResult = "success",
    checked = "true",
    cancelled = false,
  }) {
    const condition = String(report.if)
      .trim()
      .replace(/^\$\{\{([\s\S]*)\}\}$/, "$1");
    const valueOf = (term) => {
      if (term === "!cancelled()") {
        return !cancelled;
      }
      const branch = /^github\.ref == '([^']*)'$/.exec(term);
      if (branch) {
        return ref === branch[1];
      }
      if (term === "needs.check.outputs.checked == 'true'") {
        return checked === "true";
      }
      throw new Error(`the report job's if: no way to read "${term}"`);
    };
    const callsAStatusFunction =
      /\b(success|failure|cancelled|always)\(\)/.test(condition);

    return (
      condition.split("&&").every((term) => {
        return valueOf(term.trim());
      }) &&
      !cancelled &&
      (callsAStatusFunction || checkResult === "success")
    );
  }

  test("keeps the issue on main whether the check passed or failed for a stale shot (#7510)", () => {
    expect(reportRuns({ checkResult: "success" })).toBe(true);
    expect(reportRuns({ checkResult: "failure" })).toBe(true);
  });

  test("leaves the issue alone when the check got no verdict, the run was cancelled, or it is not main's", () => {
    expect(reportRuns({ checkResult: "failure", checked: "" })).toBe(false);
    expect(reportRuns({ cancelled: true })).toBe(false);
    // A release run's check is a gate, not the report; nor is a branch's.
    expect(reportRuns({ ref: "refs/heads/release" })).toBe(false);
    expect(
      reportRuns({ ref: "refs/heads/release", checkResult: "failure" }),
    ).toBe(false);
    expect(reportRuns({ ref: "refs/heads/release-14.2.1" })).toBe(false);
  });

  test("lets only the reporting job write, and only issues, on main", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(check.permissions).toBeUndefined();
    expect(report.permissions).toEqual({
      contents: "read",
      issues: "write",
    });
    expect(report.needs).toBe("check");
    expect(report.if).toContain("refs/heads/main");
    expect(report.steps[report.steps.length - 1].run).toBe(
      "node packages/E2E/DocsScreens/ReportStale.js",
    );
  });

  /*
   * The workflow's group, for one of its own runs or for the call of a
   * release run, which passes its run id. A called workflow reads its
   * caller's github context.
   */
  function groupOf({ ref, runId, inputs = {}, workflowName = workflow.name }) {
    return evaluateExpressions(workflow.concurrency.group, {
      github: { workflow: workflowName, ref, run_id: runId, event: {} },
      inputs,
    });
  }

  test("a newer run of main replaces an older one", () => {
    expect(workflow.concurrency["cancel-in-progress"]).toBe(true);
    expect(groupOf({ ref: "refs/heads/main", runId: "1" })).toEqual(
      groupOf({ ref: "refs/heads/main", runId: "2" }),
    );
  });

  test("a release run's check is in a group of its own, which no run of main and no other release run cancels", () => {
    const release = yaml.load(fs.readFileSync(RELEASE, "utf8"));
    const inRelease = (runId) => {
      return groupOf({
        ref: "refs/heads/release",
        runId,
        workflowName: release.name,
        inputs: { release_run_id: runId },
      });
    };

    expect(inRelease("43706120443")).not.toEqual(inRelease("43537389521"));
    expect(inRelease("43706120443")).not.toEqual(
      groupOf({ ref: "refs/heads/main", runId: "43706120443" }),
    );
  });
});

/*
 * release.yml calls the workflow as a gate (#7510): nothing of a release is
 * published while a docs screenshot is stale. push-release-tags needs it,
 * and the draft, the charts, the GitHub release and the signatures wait for
 * that job.
 */
describe("the release run waits for the docs screenshots", () => {
  const release = yaml.load(fs.readFileSync(RELEASE, "utf8"));
  const callers = Object.entries(release.jobs).filter(([, job]) => {
    return job.uses === "./.github/workflows/docs-screens.yml";
  });

  test("calls the workflow once, in every release run, passing what it declares", () => {
    expect(
      callers.map(([name]) => {
        return name;
      }),
    ).toEqual(["docs-screens"]);
    const [, job] = callers[0];
    expect(job.if).toBeUndefined();
    expect(job.with).toEqual({ release_run_id: "${{ github.run_id }}" });
    // Nothing it does needs a secret.
    expect(job.secrets).toBeUndefined();
  });

  test("grants the workflow what its jobs ask for, and no more: the check reads, the report (skipped here) writes issues", () => {
    expect(release.jobs["docs-screens"].permissions).toEqual({
      contents: "read",
      issues: "write",
    });
  });

  test("publishes nothing of the release before the check has passed", () => {
    expect(needsOf(release.jobs["push-release-tags"])).toContain(
      "docs-screens",
    );
    for (const name of [
      "draft-github-release",
      "helm-chart-deploy",
      "finalize-github-release",
      "sign-images",
    ]) {
      expect({
        name,
        waits: ancestorsOf(release.jobs, name).has("docs-screens"),
      }).toEqual({ name, waits: true });
    }
    // push-release-tags calls no status function: a failed check skips it.
    expect(String(release.jobs["push-release-tags"].if || "")).not.toMatch(
      /\b(success|failure|cancelled|always)\(\)/,
    );
  });
});

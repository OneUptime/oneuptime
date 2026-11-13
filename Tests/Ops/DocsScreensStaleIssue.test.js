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
 * And the workflow around it: never on a pull request, never failing for a
 * stale shot, the check in the Playwright image, and only the reporting job
 * allowed to write issues.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const {
  STALE_ISSUE_TITLE,
  findOpenIssue,
  reportStale,
  staleIssueAction,
} = require("../../packages/E2E/DocsScreens/ReportStale.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "docs-screens.yml");

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

  test("runs on main, every night and by hand, never on a pull request", () => {
    expect(Object.keys(triggers).sort()).toEqual(
      ["push", "schedule", "workflow_dispatch"].sort(),
    );
    expect(triggers.push.branches).toEqual(["main"]);
    expect(triggers.schedule).toHaveLength(1);
    expect(triggers.pull_request).toBeUndefined();
  });

  test("checks every shot in the Playwright image, without failing for a stale one", () => {
    const check = workflow.jobs.check;
    const draw = check.steps.find((step) => {
      return step.name === "Draw and compare every shot";
    });

    expect(check.container.image).toMatch(/^mcr\.microsoft\.com\/playwright:v/);
    expect(draw["working-directory"]).toBe("packages/E2E");
    expect(draw.run).toBe("npm run docs-screens:check");
    // The check's own script writes nothing in the repository.
    const scripts = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "packages/E2E/package.json"), "utf8"),
    ).scripts;
    expect(scripts["docs-screens:check"]).toContain("DOCS_SCREENS_MODE=check");
    expect(scripts["docs-screens"]).not.toContain("DOCS_SCREENS_MODE");
  });

  test("lets only the reporting job write, and only issues, on main", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.check.permissions).toBeUndefined();
    expect(workflow.jobs.report.permissions).toEqual({
      contents: "read",
      issues: "write",
    });
    expect(workflow.jobs.report.needs).toBe("check");
    expect(workflow.jobs.report.if).toContain("refs/heads/main");
    expect(
      workflow.jobs.report.steps[workflow.jobs.report.steps.length - 1].run,
    ).toBe("node packages/E2E/DocsScreens/ReportStale.js");
  });
});

/*
 * Keeps the one issue that lists stale docs screenshots (#6823), after the
 * job on main has checked every shot (`npm run docs-screens:check`, which
 * writes output/playwright/docs-screens/check.json and stale-issue.md):
 *
 *   - a shot stale or not drawable, and no issue open: it opens one;
 *   - an issue open: it rewrites its text with this run's list;
 *   - every shot current, and an issue open: it closes it, saying so;
 *   - every shot current, and no issue: nothing.
 *
 * Plain CommonJS with `gh` handed in, so Tests/Ops/DocsScreensStaleIssue
 * runs it with a fake. Run by .github/workflows/docs-screens.yml:
 *
 *   node packages/E2E/DocsScreens/ReportStale.js
 *
 * It never fails the job for stale shots: the issue is the report.
 */
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const STALE_ISSUE_TITLE = "Docs screenshots are out of date";

const REPOSITORY = path.resolve(__dirname, "..", "..", "..");
const OUTPUT = path.join(REPOSITORY, "output", "playwright", "docs-screens");

// What the job does with the issue, from what the check found.
function staleIssueAction(openIssue, check) {
  const hasProblems =
    (check.stale || []).length > 0 || (check.failed || []).length > 0;

  if (hasProblems) {
    return openIssue === null ? "create" : "update";
  }

  return openIssue === null ? "nothing" : "close";
}

/*
 * The open issue with exactly this title, or null. `gh` is
 * (args: string[]) => string, its standard output.
 */
function findOpenIssue(gh) {
  const listed = JSON.parse(
    gh([
      "issue",
      "list",
      "--state",
      "open",
      "--search",
      `"${STALE_ISSUE_TITLE}" in:title`,
      "--json",
      "number,title",
      "--limit",
      "20",
    ]) || "[]",
  );
  const issue = listed.find((candidate) => {
    return candidate.title === STALE_ISSUE_TITLE;
  });

  return issue ? issue.number : null;
}

function reportStale({ check, body, gh, bodyFile }) {
  const openIssue = findOpenIssue(gh);
  const action = staleIssueAction(openIssue, check);

  if (action === "create") {
    gh([
      "issue",
      "create",
      "--title",
      STALE_ISSUE_TITLE,
      "--body-file",
      bodyFile,
    ]);
  } else if (action === "update") {
    gh(["issue", "edit", String(openIssue), "--body-file", bodyFile]);
  } else if (action === "close") {
    gh([
      "issue",
      "close",
      String(openIssue),
      "--comment",
      `Every docs screenshot is current again: ${check.checked} drawn, none stale.`,
    ]);
  }

  return { action, openIssue, body };
}

module.exports = {
  STALE_ISSUE_TITLE,
  findOpenIssue,
  reportStale,
  staleIssueAction,
};

if (require.main === module) {
  const checkFile = path.join(OUTPUT, "check.json");
  const bodyFile = path.join(OUTPUT, "stale-issue.md");

  if (!fs.existsSync(checkFile) || !fs.existsSync(bodyFile)) {
    console.error(
      `No check to report: run npm run docs-screens:check first (${checkFile}).`,
    );
    process.exit(1);
  }

  const result = reportStale({
    check: JSON.parse(fs.readFileSync(checkFile, "utf8")),
    body: fs.readFileSync(bodyFile, "utf8"),
    bodyFile,
    gh: (args) => {
      return childProcess.execFileSync("gh", args, { encoding: "utf8" });
    },
  });

  console.log(
    `Docs screenshots issue: ${result.action}${result.openIssue ? ` (#${result.openIssue})` : ""}.`,
  );
}

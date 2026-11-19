/*
 * Keeps the one issue that says OneUptime's time zone data is behind IANA's
 * latest release, after CheckTimeZoneData.js has written check.json and
 * issue.md:
 *
 *   - a copy behind (or one that could not be read), and no issue open: it
 *     opens one;
 *   - an issue open: it rewrites its text with this run's table;
 *   - every copy current, and an issue open: it closes it, saying so;
 *   - every copy current, and no issue: nothing.
 *
 * Plain CommonJS with `gh` handed in, so Tests/Ops/TimeZoneData.test.js
 * runs it with a fake. Run by .github/workflows/time-zone-data.yml:
 *
 *   node Scripts/TimeZoneData/ReportTimeZoneData.js [--output <directory>]
 *
 * It does not fail itself: the check has already failed the run when a copy
 * has been behind for too long.
 */
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const ISSUE_TITLE = "Time zone data is behind IANA's latest release";

// The labels the issue is filed with: the repository's own follow-up labels.
const ISSUE_LABELS = ["follow-up", "bug"];

const REPOSITORY = path.resolve(__dirname, "..", "..");

// What to do with the issue, from what the check found.
function issueAction(openIssue, check) {
  const needsAttention = check.sources.some((source) => {
    return source.status !== "current";
  });

  if (needsAttention) {
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
      `"${ISSUE_TITLE}" in:title`,
      "--json",
      "number,title",
      "--limit",
      "20",
    ]) || "[]",
  );
  const issue = listed.find((candidate) => {
    return candidate.title === ISSUE_TITLE;
  });

  return issue ? issue.number : null;
}

function reportTimeZoneData({ check, gh, bodyFile }) {
  const openIssue = findOpenIssue(gh);
  const action = issueAction(openIssue, check);

  if (action === "create") {
    gh([
      "issue",
      "create",
      "--title",
      ISSUE_TITLE,
      "--body-file",
      bodyFile,
      ...ISSUE_LABELS.flatMap((label) => {
        return ["--label", label];
      }),
    ]);
  } else if (action === "update") {
    gh(["issue", "edit", String(openIssue), "--body-file", bodyFile]);
  } else if (action === "close") {
    gh([
      "issue",
      "close",
      String(openIssue),
      "--comment",
      `Every copy of the tz database OneUptime computes and shows times with carries ${check.latest.version}, IANA's latest release, again.`,
    ]);
  }

  return { action, openIssue };
}

module.exports = {
  ISSUE_LABELS,
  ISSUE_TITLE,
  findOpenIssue,
  issueAction,
  reportTimeZoneData,
};

if (require.main === module) {
  const outputIndex = process.argv.indexOf("--output");
  const output =
    outputIndex !== -1 && process.argv[outputIndex + 1]
      ? path.resolve(process.argv[outputIndex + 1])
      : path.join(REPOSITORY, "output", "time-zone-data");
  const checkFile = path.join(output, "check.json");
  const bodyFile = path.join(output, "issue.md");

  if (!fs.existsSync(checkFile) || !fs.existsSync(bodyFile)) {
    console.error(
      `No check to report: run Scripts/TimeZoneData/CheckTimeZoneData.js first (${checkFile}).`,
    );
    process.exit(1);
  }

  const result = reportTimeZoneData({
    check: JSON.parse(fs.readFileSync(checkFile, "utf8")),
    bodyFile,
    gh: (args) => {
      return childProcess.execFileSync("gh", args, { encoding: "utf8" });
    },
  });

  console.log(
    `Time zone data issue: ${result.action}${result.openIssue ? ` (#${result.openIssue})` : ""}.`,
  );
}

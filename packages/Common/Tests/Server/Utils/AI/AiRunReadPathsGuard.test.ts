import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY PATH THAT READS AI RUNS OR THEIR PULL REQUESTS AROUND THE SERVICES
 * HOLDS THE RULE, OR SAYS WHY IT NEEDS NONE (#9165).
 *
 * An AI run about a private incident or alert - the fix pull request of its
 * investigation, a Code task asked from one of its fixes, a reply in such a
 * task - and that run's pull request are read only by those who see the
 * record (AIRunOutputReadFilter). The services hold every read made with a
 * person's props to it (AiRunOutputReadRules). These are the reads that go
 * around them, where a new path would forget it:
 *
 *   1. SQL of its own naming the AIRun or AIAgentTaskPullRequest table: the
 *      Code pages' lists, counts and totals were exactly that, and every
 *      reader of the repository read a private incident's fix through them;
 *   2. an API route that reads runs or pull requests as OneUptime - the
 *      task page, its Log - and answers a person with what it read.
 *
 * Each is listed here with what it is. A file that starts doing either and
 * is not listed fails "is listed": put it in the list with the rule it
 * follows - and, if it reads for a person, have it ask the rule. A listed
 * file that no longer does either fails too, so the list only shrinks.
 */

// packages/Common/Tests/Server/Utils/AI -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

type Classification =
  // Writes the rule itself.
  | { kind: "isTheRule" }
  /*
   * Reads for a person and asks the rule for them: each `mustContain` is in
   * its source.
   */
  | { kind: "asksTheRule"; mustContain: Array<string> }
  /*
   * Reads only the rows of tasks or runs its caller already held to the
   * rule, by their ids.
   */
  | { kind: "readsRowsAlreadyKept"; why: string }
  // OneUptime's own work: no person reads what it reads.
  | { kind: "oneUptimesOwn"; why: string }
  // Reads for a person runs that are about no private record.
  | { kind: "aboutNoPrivateRecord"; why: string }
  /*
   * Reads for a person, after reading the incident or alert the runs are
   * about under their own props.
   */
  | { kind: "afterTheRecord"; why: string };

// 1. Source files with SQL of their own naming AIRun or AIAgentTaskPullRequest.
const RAW_SQL_READERS: Record<string, Classification> = {
  "packages/Common/Server/Utils/AI/AIRunOutputReadFilter.ts": {
    kind: "isTheRule",
  },
  "packages/Common/Server/Utils/AI/CodeTask/CodeTaskListQuery.ts": {
    kind: "asksTheRule",
    mustContain: [
      "AIRunOutputReadFilter.getRunAboutSql({",
      "reader: DatabaseCommonInteractionProps;",
      "props: facts.reader,",
    ],
  },
  "packages/Common/Server/Utils/AI/CodeTask/CodeTaskStats.ts": {
    kind: "asksTheRule",
    mustContain: [
      "AIRunOutputReadFilter.getRunAboutSql({",
      "AIRunOutputReadFilter.getReadableRunsSql({",
      // A pull request a chat opened: what it carries (#9186).
      "AIRunOutputReadFilter.getCarriedRecordsSql({",
      // Each statement's own condition, written into it.
      "const runsReadable: string = readableRuns(runParameters);",
      "const waitingReadable: string = readableRuns(waitingParameters);",
      "<> ALL($5::text[]))$" + "{runsReadable}",
      "<> ALL($5::text[]))$" + "{waitingReadable}",
      "ANY($2::uuid[])$" + "{ pullRequestReadable ? ",
      "AIRunOutputReadFilter.applyToRunRow(",
    ],
  },
  "packages/Common/Server/Utils/AI/CodeTask/CodeTaskListRows.ts": {
    kind: "readsRowsAlreadyKept",
    why: "A list's rows, read per task for the task ids its caller kept to the reader: CodeTaskAPI's page (CodeTaskListQuery or the rule's own read) and a fix's tasks (DeclaredCodeChanges.list, after the person read the fix, and so its record: of a task a reply carried another record into, only its state and its pull request's link).",
  },
  "packages/Common/Server/Utils/AI/CodeTask/CodeTaskThread.ts": {
    kind: "readsRowsAlreadyKept",
    why: "One task's turns and pull requests, once findTask - with the reader - or the Code API decided the person may read the task.",
  },
  "packages/Common/Server/Utils/AI/CodeFix/CodeFixClaimQuery.ts": {
    kind: "oneUptimesOwn",
    why: "Which queued run a Runner claims next, and how many it may: read for the Runner's key, never answered to a person.",
  },
  "packages/Common/Server/Utils/AI/CodeFix/CodeFixAutoRetry.ts": {
    kind: "oneUptimesOwn",
    why: "Whether a task opened a pull request, for retrying its turn by itself: a yes or no OneUptime acts on.",
  },
  "packages/Common/Server/Services/LlmLogService.ts": {
    kind: "oneUptimesOwn",
    why: "The tokens a project used, summed for its daily AI budget: a number OneUptime holds the project to.",
  },
};

// 2. API files that read AI runs or pull requests as OneUptime.
const API_READERS: Record<string, Classification> = {
  "packages/Common/Server/API/CodeFixRunAPI.ts": {
    kind: "asksTheRule",
    mustContain: [
      "AIRunOutputReadFilter.applyToRunRow(",
      "const run: AIRun | null = await this.findReadableRun(props, runId);",
    ],
  },
  "packages/Common/Server/API/CodeTaskAPI.ts": {
    kind: "asksTheRule",
    mustContain: [
      // Code's first page and a repository's: their totals.
      "CodeTaskStats.getRepositoryStats({ projectId, repositoryIds, reader: props, })",
      "CodeTaskStats.countTasksWithoutRepository({ projectId, reader: props, })",
      "repositoryIds: [repositoryId], reader: props,",
      // A list: its SQL, and its own read.
      "reader: props, repositoryIds: scopeRepositoryIds,",
      "const query: JSONObject = AIRunOutputReadFilter.applyToRunRow(",
      // Several tasks at a glance.
      "query: AIRunOutputReadFilter.applyToRunRow( { _id: QueryHelper.any(ids),",
      // A task, and every route reached through it.
      "taskId, readableBy: props, });",
    ],
  },
  "packages/Common/Server/API/AIAgentTaskPullRequestAPI.ts": {
    kind: "asksTheRule",
    // Its list, item, count and outcome stats read with the caller's props.
    mustContain: ["await this.service.getOutcomeStats(props);"],
  },
  "packages/Common/Server/API/AIAgentDataAPI.ts": {
    kind: "oneUptimesOwn",
    why: "The Runner's protocol: a task's details for the Runner whose key asks, which hands a private record's fix only to a Runner that keeps it out of the pull request.",
  },
  "packages/Common/Server/API/AIAgentTaskAPI.ts": {
    kind: "oneUptimesOwn",
    why: "The Runner's protocol: claiming runs and reporting how they end.",
  },
  "packages/Common/Server/API/AIAgentTaskLogAPI.ts": {
    kind: "oneUptimesOwn",
    why: "The Runner's protocol: a run's log lines, written for the Runner holding it.",
  },
  "packages/Common/Server/API/AIAgentCodeTaskAPI.ts": {
    kind: "oneUptimesOwn",
    why: "The Runner's protocol: what a Code task's turn is to work on, for the Runner holding it.",
  },
  ["packages/Common/Server/API/AIAgent" + "GitHubAPI.ts"]: {
    kind: "oneUptimesOwn",
    why: "The GitHub App's protocol: the runs a GitHub comment started, answered to GitHub.",
  },
  "packages/Common/Server/API/AIChatAPI.ts": {
    kind: "aboutNoPrivateRecord",
    why: "A person's own Ask AI chat, which names no incident or alert: read only by whoever asked.",
  },
  "packages/Common/Server/API/TelemetryExceptionAPI.ts": {
    kind: "aboutNoPrivateRecord",
    why: "An exception's fix runs and their pull requests: about a telemetry exception, never an incident or alert. Of a task a reply carried one into, it shows only the run's state and its pull request's link and production verdict.",
  },
  "packages/Common/Server/API/SecurityCaseAPI.ts": {
    kind: "aboutNoPrivateRecord",
    why: "A security case's triage run, read for whoever may read the case.",
  },
  "packages/Common/Server/API/AIInvestigationAPI.ts": {
    kind: "afterTheRecord",
    why: "An incident's or alert's investigations and the fix in the code they recommend, read once the person read that record under their own props: a private one's owners. Of a fix a reply carried another record into, only the fix's state and its link.",
  },
  "packages/Common/Server/API/KubernetesClusterAiAccessAPI.ts": {
    kind: "afterTheRecord",
    why: "A cluster's AI Logs: each investigation shown only beside an incident or alert the person read under their own props; its commands through RunnerJobService.",
  },
  "packages/Common/Server/API/ResourceAiAccessAPI.ts": {
    kind: "afterTheRecord",
    why: "A resource's AI Logs: each investigation shown only beside an incident or alert the person read under their own props; its commands through RunnerJobService.",
  },
};

// SQL of a file's own that names the AIRun or AIAgentTaskPullRequest table.
const RAW_SQL: RegExp = /\b(?:FROM|JOIN)\s+"(?:AIRun|AIAgentTaskPullRequest)"/;

// An API file that reads AI runs or pull requests, or the Code tasks' readers.
const API_READ: RegExp =
  /\b(?:AIRunService|AIAgentTaskPullRequestService|CodeTaskThread|CodeTaskListRows|CodeTaskPresenter|CodeTaskStats|CodeTaskListQuery)\b/;

function listSourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name !== "node_modules" &&
        entry.name !== "Tests" &&
        entry.name !== "SchemaMigrations" &&
        entry.name !== "build" &&
        entry.name !== "dist"
      ) {
        found.push(...listSourceFiles(full));
      }

      continue;
    }

    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      found.push(full);
    }
  }

  return found;
}

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function read(file: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
}

// The server's code: Common's, and every App feature set's.
const SERVER_FILES: Array<string> = [
  ...listSourceFiles(path.join(REPOSITORY_ROOT, "packages/Common/Server")),
  ...listSourceFiles(path.join(REPOSITORY_ROOT, "packages/App/FeatureSet")),
].map(relative);

const RAW_SQL_FILES: Array<string> = SERVER_FILES.filter(
  (file: string): boolean => {
    return RAW_SQL.test(read(file));
  },
).sort();

// A feature set's own route files.
const FEATURE_SET_API: RegExp = /^packages\/App\/FeatureSet\/[^/]+\/API\//;

// Route files: Common's API and every feature set's API folder.
const API_FILES: Array<string> = SERVER_FILES.filter(
  (file: string): boolean => {
    return (
      (file.startsWith("packages/Common/Server/API/") ||
        FEATURE_SET_API.test(file)) &&
      API_READ.test(read(file))
    );
  },
).sort();

function check(
  file: string,
  classification: Classification,
): Array<string> | null {
  if (classification.kind !== "asksTheRule") {
    return null;
  }

  // Read with every run of white space as one, as the code is formatted.
  const code: string = read(file).replace(/\s+/g, " ");

  return classification.mustContain.filter((snippet: string): boolean => {
    return !code.includes(snippet.replace(/\s+/g, " "));
  });
}

describe("SQL of a file's own that reads AI runs or their pull requests", () => {
  test("the sweep finds the Code pages' and the rule's", () => {
    expect(RAW_SQL_FILES).toEqual(
      expect.arrayContaining([
        "packages/Common/Server/Utils/AI/AIRunOutputReadFilter.ts",
        "packages/Common/Server/Utils/AI/CodeTask/CodeTaskListQuery.ts",
        "packages/Common/Server/Utils/AI/CodeTask/CodeTaskStats.ts",
      ]),
    );
  });

  test.each(RAW_SQL_FILES)("%s is listed with what it is", (file: string) => {
    expect({ file, isListed: Boolean(RAW_SQL_READERS[file]) }).toEqual({
      file,
      isListed: true,
    });
  });

  test("lists no file that has none", () => {
    expect(
      Object.keys(RAW_SQL_READERS).filter((file: string): boolean => {
        return !RAW_SQL_FILES.includes(file);
      }),
    ).toEqual([]);
  });

  test.each(Object.entries(RAW_SQL_READERS))(
    "%s holds what it is listed as",
    (file: string, classification: Classification) => {
      expect({ file, missing: check(file, classification) || [] }).toEqual({
        file,
        missing: [],
      });

      if ("why" in classification) {
        expect(classification.why.length).toBeGreaterThan(40);
      }
    },
  );
});

describe("API routes that read AI runs or their pull requests as OneUptime", () => {
  test("the sweep finds the task page's and its Log's", () => {
    expect(API_FILES).toEqual(
      expect.arrayContaining([
        "packages/Common/Server/API/CodeFixRunAPI.ts",
        "packages/Common/Server/API/CodeTaskAPI.ts",
      ]),
    );
  });

  test.each(API_FILES)("%s is listed with what it is", (file: string) => {
    expect({ file, isListed: Boolean(API_READERS[file]) }).toEqual({
      file,
      isListed: true,
    });
  });

  test("lists no file that reads none", () => {
    expect(
      Object.keys(API_READERS).filter((file: string): boolean => {
        return !API_FILES.includes(file);
      }),
    ).toEqual([]);
  });

  test.each(Object.entries(API_READERS))(
    "%s holds what it is listed as",
    (file: string, classification: Classification) => {
      expect({ file, missing: check(file, classification) || [] }).toEqual({
        file,
        missing: [],
      });

      if ("why" in classification) {
        expect(classification.why.length).toBeGreaterThan(40);
      }
    },
  );

  /*
   * The task page and its Log read the run as OneUptime: every read of a
   * run there goes through the rule, so none can be added beside it.
   */
  test("the fix run's page and Log read the run only through the rule", () => {
    const code: string = read("packages/Common/Server/API/CodeFixRunAPI.ts");

    expect(code.split("AIRunService.findOneBy(").length - 1).toBe(1);
    expect(code.split("AIRunService.findBy(").length - 1).toBe(0);
    expect(code.split("this.findReadableRun(props, runId)").length - 1).toBe(2);
  });
});

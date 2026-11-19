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
 *      task page, its Log - and answers a person with what it read;
 *   3. code that works out how a Code task stands - its state, from its
 *      latest turn, and its pull request, or that it is still on its way -
 *      for a page that shows a task beside something else: an exception's
 *      fix panel, the fix line of an investigation, the pull request to the
 *      code under a fix's step, a trace's performance fix, the Fix with AI
 *      of a finding or of a profile's function. Each showed a task's state
 *      and a link to it after a reply carried a private record into it,
 *      which the task's own page and the Code lists already hid.
 *
 * Each is listed here with what it is. A file that starts doing any of them
 * and is not listed fails "is listed": put it in the list with the rule it
 * follows - and, if it reads for a person, have it ask the rule. A listed
 * file that no longer does any fails too, so the list only shrinks.
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
  | { kind: "afterTheRecord"; why: string }
  /*
   * The same, and asks the rule of the tasks it shows how they stand: each
   * `mustContain` is in its source.
   */
  | {
      kind: "afterTheRecordAndTheRule";
      why: string;
      mustContain: Array<string>;
    }
  /*
   * Works out how a task stands for what OneUptime does with it - starts,
   * continues or refuses work - and tells no one how it stands.
   */
  | { kind: "actsOnIt"; why: string };

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
    why: "A list's rows, read per task for the task ids its caller kept to the reader: CodeTaskAPI's page (CodeTaskListQuery or the rule's own read) and a fix's tasks (DeclaredCodeChanges.list, after the person read the fix, of the tasks the rule lets them read: CodeTaskThread.findTasksHiddenFrom).",
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
    kind: "asksTheRule",
    mustContain: [
      // An exception's fix tasks, each read as its own page reads it.
      "const hiddenRunIds: Set<string> = await CodeTaskThread.findTasksHiddenFrom({ projectId: telemetryException.projectId,",
      // Asked of the task - a fix asked again from Code is a later turn of it.
      "taskIds: runs.map(taskIdOf), reader: props, });",
      "return hiddenRunIds.has(taskIdOf(run).toString().toLowerCase());",
      // A hidden one: its type alone - no state, verdict or link.
      "if (isHidden(run)) { return {",
      "isHidden: true,",
      // Nothing more is read of a hidden one: its turns nor its verdict.
      "const visibleRuns: Array<AIRun> = runs.filter((run: AIRun): boolean => { return !isHidden(run); });",
      "taskIds: visibleRuns.map(taskIdOf),",
      "for (const turn of [...visibleRuns, ...visibleRuns.map(latestOf)]) {",
      "!isHidden(latestRunOverall) &&",
    ],
  },
  "packages/Common/Server/API/SecurityCaseAPI.ts": {
    kind: "aboutNoPrivateRecord",
    why: "A security case's triage run, read for whoever may read the case.",
  },
  "packages/Common/Server/API/AIInvestigationAPI.ts": {
    kind: "afterTheRecordAndTheRule",
    why: "An incident's or alert's investigations and the fix in the code they recommend, read once the person read that record under their own props: a private one's owners. The fix itself, and a trace's performance fix, are read as their task's own page reads them, for that person.",
    mustContain: [
      // The investigation's fix line, for the person, in their project.
      "FixFromIncidentTaskTrigger.getSuggestionForSubject({ projectId: tenantId,",
      "reader: viewerProps, });",
      // A trace's performance fix, for the person.
      "// The fix as its task's page reads it, for this reader. reader: props, });",
    ],
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

/*
 * 3. Code that works out how a Code task stands - its state from its latest
 * turn, its pull request - outside the Code API's own pages.
 */
const TASK_STATE_READERS: Record<string, Classification> = {
  "packages/Common/Server/Utils/AI/CodeTask/CodeTaskPresenter.ts": {
    kind: "readsRowsAlreadyKept",
    why: "Code's own pages: a list's rows and a task's conversation, for tasks CodeTaskAPI already held to the reader (findTask with the reader, or the rule's own read of a list).",
  },
  "packages/Common/Server/Utils/AI/CodeTask/CodeTaskRuns.ts": {
    kind: "actsOnIt",
    why: "Whether a task accepts a reply or a retry, and the turn it builds on: what OneUptime does next, for a task the Code API already let the person continue.",
  },
  "packages/Common/Server/Utils/Incident/PostmortemActionItemCodeTasks.ts": {
    kind: "actsOnIt",
    why: "Whether an action item's task still works, to refuse asking a second one: asked only of someone who may edit the action item, on a private incident only through its owners.",
  },
  "packages/Common/Server/Services/AIRunService.ts": {
    kind: "actsOnIt",
    why: "getLatestCodeFixRunPerTaskType, as OneUptime: the exception's latest task of each kind, which TelemetryExceptionAPI holds to the person (CodeTaskThread.findTasksHiddenFrom) before it answers.",
  },
  "packages/Common/Server/API/TelemetryExceptionAPI.ts": {
    kind: "asksTheRule",
    mustContain: ["CodeTaskThread.findTasksHiddenFrom(", "reader: props,"],
  },
  "packages/Common/Server/Utils/AI/SRE/FixFromIncidentTaskTrigger.ts": {
    kind: "asksTheRule",
    mustContain: [
      "reader: DatabaseCommonInteractionProps;",
      "const fixRun: AIRun | null = activeRun || finishedRun;",
      // Asked of the task - a fix asked again from Code is a later turn of it.
      "const fixTaskId: ObjectID | null = SubjectCodeFixRun.taskIdOf(fixRun);",
      "await CodeTaskThread.findTasksHiddenFrom({ projectId: data.projectId, taskIds: [fixTaskId], reader: data.reader, })",
      "return HIDDEN_INVESTIGATION_CODE_FIX_SUGGESTION;",
    ],
  },
  "packages/Common/Server/Utils/AI/SRE/FixPerformanceTaskTrigger.ts": {
    kind: "asksTheRule",
    mustContain: [
      "reader: DatabaseCommonInteractionProps;",
      // Asked of the task - a fix asked again from Code is a later turn of it.
      "SubjectCodeFixRun.taskIdOf(activeRun)?.toString() || null;",
      "activeTaskId || finishedFix?.aiRunId || null;",
      "await CodeTaskThread.findTasksHiddenFrom({ projectId: data.projectId, taskIds: [fixTaskId], reader: data.reader, })",
      "finishedFix: FinishedFixOutcome.Hidden,",
    ],
  },
  "packages/Common/Server/Utils/AutoRemediation/DeclaredCodeChanges.ts": {
    kind: "asksTheRule",
    mustContain: [
      "const hiddenTaskIds: Set<string> = await CodeTaskThread.findTasksHiddenFrom(",
      "reader: data.props,",
      "state: DeclaredCodeChangeState.Hidden,",
      // Nothing more is read of a hidden task: its turns nor its pull request.
      ".filter((task: AIRun): boolean => { return !isHidden(task); })",
    ],
  },
  // A finding's Fix with AI: the task already on its way, for the person.
  "packages/Common/Server/Utils/AI/TelemetryAi/TelemetryAiFix.ts": {
    kind: "asksTheRule",
    mustContain: [
      "reader: DatabaseCommonInteractionProps;",
      "await CodeTaskThread.findTasksHiddenFrom({ projectId: data.projectId, taskIds: [data.taskId], reader: data.reader, });",
      "return HIDDEN_TELEMETRY_AI_FIX_SUGGESTION;",
    ],
  },
  "packages/Common/Server/Utils/AI/TelemetryAi/TraceInsightFix.ts": {
    kind: "asksTheRule",
    mustContain: [
      "return await TelemetryAiFix.getInProgressSuggestion({ projectId: data.projectId, taskId: activeTaskId, reader: data.props, });",
    ],
  },
  "packages/Common/Server/Utils/AI/TelemetryAi/ExceptionInsightFix.ts": {
    kind: "asksTheRule",
    mustContain: [
      "return await TelemetryAiFix.getInProgressSuggestion({ projectId: data.projectId, taskId: activeTaskId, reader: data.props, });",
    ],
  },
  "packages/Common/Server/Utils/AI/TelemetryAi/LogInsightFix.ts": {
    kind: "asksTheRule",
    mustContain: [
      "return await TelemetryAiFix.getInProgressSuggestion({ projectId: data.projectId, taskId: activeTaskId, reader: data.props, });",
    ],
  },
  "packages/Common/Server/Utils/AI/TelemetryAi/MetricInsightFix.ts": {
    kind: "asksTheRule",
    mustContain: [
      "return await TelemetryAiFix.getInProgressSuggestion({ projectId: data.projectId, taskId: activeTaskId, reader: data.props, });",
    ],
  },
  // A profile function's Fix with AI: the task already on its way, for the person.
  "packages/Common/Server/Utils/AI/SRE/ProfileFixTaskTrigger.ts": {
    kind: "asksTheRule",
    mustContain: [
      "await CodeTaskThread.findTasksHiddenFrom({ projectId: request.projectId, taskIds: [activeTaskId], reader: request.props, })",
      "taskId: isHidden ? null : activeTaskId,",
    ],
  },
  "packages/Common/Server/Utils/AI/TelemetryAi/ProfileInsightFix.ts": {
    kind: "actsOnIt",
    why: "Whether a person's fix of the same function, from the Profiler, is already on its way, so OneUptime starts no second one of its own: what OneUptime does next, told to no one.",
  },
  /*
   * The AI activity pages state a fix task by its newest turn, which may be
   * a reply (#9812): each reads its tasks through the rule, for the person.
   */
  "packages/Common/Server/Utils/AI/TelemetryAi/TelemetryAiActivityReader.ts": {
    kind: "asksTheRule",
    mustContain: [
      // A telemetry lane's AI Logs, page and count alike.
      "const query: Record<string, unknown> = AIRunOutputReadFilter.applyToRunRow( {",
      "} as Record<string, unknown>, data.props, );",
      "AIRunService.countBy({ query, props: { isRoot: true } })",
    ],
  },
  "packages/Common/Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiLogsReader.ts":
    {
      kind: "afterTheRecordAndTheRule",
      why: "The incidents' and alerts' AI Logs: each fix pull request shown only beside an incident or alert the person read under their own props, and read through the rule for them, so a task a reply carried a private record into is left out.",
      mustContain: [
        ": AIRunOutputReadFilter.applyToRunRow(query, options.props)) as never,",
      ],
    },
  "packages/Common/Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiInsightsReader.ts":
    {
      kind: "afterTheRecordAndTheRule",
      why: "The incidents' and alerts' AI Insights: fix pull requests counted only beside an incident or alert the person read under their own props, and read through the rule for them, so a task a reply carried a private record into counts for none of theirs.",
      mustContain: [
        "? AIRunOutputReadFilter.applyToRunRow( { ...query, codeTaskId: QueryHelper.isNull() }, options.props, )",
      ],
    },
};

// SQL of a file's own that names the AIRun or AIAgentTaskPullRequest table.
const RAW_SQL: RegExp = /\b(?:FROM|JOIN)\s+"(?:AIRun|AIAgentTaskPullRequest)"/;

/*
 * Working out how a Code task stands: its state, its latest turn, its pull
 * request - or the task still on its way about something a page shows.
 */
const TASK_STATE: RegExp =
  /\b(?:CodeTaskStateUtil\.fromRun|getFinishedFixOutcome|CodeTaskRuns\.getLatestTurn|getLatestCodeFixRunPerTaskType|CodeTaskListRows\.(?:readReplies|readPullRequests|readOutcomes)|findActiveTaskIdForInsight|findActiveExceptionTaskId|findActiveTaskId)\(/;

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

// Every server file that works out how a Code task stands.
const TASK_STATE_FILES: Array<string> = SERVER_FILES.filter(
  (file: string): boolean => {
    return TASK_STATE.test(read(file));
  },
).sort();

function check(
  file: string,
  classification: Classification,
): Array<string> | null {
  if (!("mustContain" in classification)) {
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

describe("code that tells a person how a Code task stands, beside something else", () => {
  test("the sweep finds the fix panels' and Code's own", () => {
    expect(TASK_STATE_FILES).toEqual(
      expect.arrayContaining([
        "packages/Common/Server/API/TelemetryExceptionAPI.ts",
        "packages/Common/Server/Utils/AI/CodeTask/CodeTaskPresenter.ts",
        "packages/Common/Server/Utils/AI/SRE/FixFromIncidentTaskTrigger.ts",
        "packages/Common/Server/Utils/AutoRemediation/DeclaredCodeChanges.ts",
        // A finding's Fix with AI, and a profile function's.
        "packages/Common/Server/Utils/AI/TelemetryAi/TelemetryAiFix.ts",
        "packages/Common/Server/Utils/AI/TelemetryAi/TraceInsightFix.ts",
        "packages/Common/Server/Utils/AI/SRE/ProfileFixTaskTrigger.ts",
      ]),
    );
  });

  test.each(TASK_STATE_FILES)(
    "%s is listed with what it is",
    (file: string) => {
      expect({ file, isListed: Boolean(TASK_STATE_READERS[file]) }).toEqual({
        file,
        isListed: true,
      });
    },
  );

  test("lists no file that works out none", () => {
    expect(
      Object.keys(TASK_STATE_READERS).filter((file: string): boolean => {
        return !TASK_STATE_FILES.includes(file);
      }),
    ).toEqual([]);
  });

  test.each(Object.entries(TASK_STATE_READERS))(
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
   * The helper every such page asks: the rule the task's own page reads it
   * by, for the person - never a read of runs as OneUptime that skips it.
   */
  test("the panels' helper reads tasks only through the task page's rule", () => {
    const code: string = read(
      "packages/Common/Server/Utils/AI/CodeTask/CodeTaskThread.ts",
    ).replace(/\s+/g, " ");
    const helper: string = code.slice(
      code.indexOf("public static async findTasksHiddenFrom("),
      code.indexOf("public static async getTurns("),
    );

    expect(helper).toContain(
      "if (ids.length === 0 || shouldBypassRecordPrivacy(data.reader)) {",
    );
    expect(helper).toContain(
      "query: AIRunOutputReadFilter.applyToRunRow( { _id: QueryHelper.any(ids), projectId: data.projectId, }, data.reader, ),",
    );
    expect(helper.split("AIRunService.findBy(").length - 1).toBe(1);
  });
});

import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY PATH THAT WRITES CODE WORK SAYS WHAT IT CARRIES (#9186).
 *
 * A Code task, its replies and its pull request are read only by those who
 * may read every incident and alert the work carries (AIRunOutputReadFilter),
 * so a path that writes such work without the link leaves a private
 * record's work to every reader of the repository - the gap #9186 closed for
 * a postmortem action item's task, context added by hand, and a pull request
 * opened from a chat. Each path that writes a Code task's turn or a pull
 * request record is listed here with how what it carries reaches the row:
 *
 *   - through the request's context, which AIRunService reads for every
 *     turn it creates (a reply adds it to its task too);
 *   - named by the path itself, beside its context;
 *   - by the key a fix names its record by (#9165), when the work is a fix;
 *   - none: it carries no incident or alert, and says why;
 *   - for a pull request record, the run that opened it, or - the chat that
 *     did - its subject, what it opened one by one and what the pull request
 *     quotes of its lists (#9242).
 *
 * A file that starts writing such work and is not listed fails "is listed":
 * list it with how it carries what it holds. A listed file that no longer
 * writes any fails too, so the list stays true. And no file writes either
 * table with SQL of its own: an INSERT would skip AIRunService, and so the
 * link.
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
  // Writes every turn of a Code task; mustContain is in its source.
  | { kind: "writesTheTurns"; mustContain: Array<string> }
  // Asks for a task whose context names what it carries: AIRunService reads it.
  | { kind: "carriesItsContext"; why: string }
  // Names what its task carries beside its context.
  | { kind: "namesWhatItCarries"; mustContain: Array<string> }
  // A fix of a record, named by the key a fix names its record by (#9165).
  | { kind: "isAFixOfItsRecord"; mustContain: Array<string> }
  // Carries no incident or alert.
  | { kind: "carriesNoRecord"; why: string }
  // A pull request record of a run, read through that run.
  | { kind: "namesItsRun"; mustContain: Array<string> }
  /*
   * A pull request record a chat opened: it carries the chat's subject,
   * what the chat opened one by one, and what the pull request quotes of
   * its lists (ChatCarriedRecords.ofPullRequest, #9242).
   */
  | { kind: "carriesWhatItsChatRead"; mustContain: Array<string> };

const WRITERS: Record<string, Classification> = {
  "packages/Common/Server/Utils/AI/CodeTask/CodeTaskRuns.ts": {
    kind: "writesTheTurns",
    mustContain: [
      "run.taskContext = { request: data.request };",
      "carries?: CarriedRecordIds | undefined;",
      "if (data.carries) { CarriedRecords.writeTo(run, data.carries); }",
      "return await AIRunService.create({",
    ],
  },
  "packages/Common/Server/API/CodeTaskAPI.ts": {
    kind: "carriesItsContext",
    why: "A request or a reply asked in Code, and a turn asked again: the incidents and alerts a person added to it are its context, read under their permissions (CodeTaskContextBuilder).",
  },
  "packages/Common/Server/Utils/Incident/PostmortemActionItemCodeTasks.ts": {
    kind: "namesWhatItCarries",
    mustContain: [
      "carries: CarriedRecords.of({ incidentIds: [actionItem.incidentId] }),",
      "incidentIsPrivate: incident.isPrivate === true,",
    ],
  },
  "packages/Common/Server/Utils/AutoRemediation/DeclaredCodeChanges.ts": {
    kind: "isAFixOfItsRecord",
    // The fix's key (CodeTaskRuns.start writes it), and a public record's context.
    mustContain: [
      "declaredCodeChange: { suggestionId: suggestionId.toString(),",
      "type: CodeTaskContextType.Incident,",
      "type: CodeTaskContextType.Alert,",
    ],
  },
  "packages/Common/Server/Utils/AI/SRE/SubjectCodeFixRun.ts": {
    kind: "isAFixOfItsRecord",
    mustContain: [
      "run.triggeredByIncidentId = data.incidentId;",
      "run.triggeredByAlertId = data.alertId;",
    ],
  },
  /*
   * A fix OneUptime started, asked again as a new turn (#6509): the keys
   * its fix names its record by, and every record its turn carried.
   */
  "packages/Common/Server/Utils/AI/CodeTask/CodeTaskFixRetry.ts": {
    kind: "isAFixOfItsRecord",
    mustContain: [
      "run.triggeredByIncidentId = data.turn.triggeredByIncidentId;",
      "run.triggeredByAlertId = data.turn.triggeredByAlertId;",
      "CarriedRecords.writeTo(run, CarriedRecords.ofRow(data.turn));",
    ],
  },
  "packages/Common/Server/Utils/AI/DataSecurity/DataSecurityCodeTask.ts": {
    kind: "carriesNoRecord",
    why: "A Data Security issue's fix: its request describes the issue and its findings, with no context, never the incident declared for the issue.",
  },
  "packages/Common/Server/Utils/AI/SRE/ProfileFixTaskTrigger.ts": {
    kind: "carriesNoRecord",
    why: "A slow function the Profiler found: its context is the service's profile, never an incident or alert.",
  },
  "packages/Common/Server/Utils/AI/TelemetryAi/ExceptionInsightFix.ts": {
    kind: "carriesNoRecord",
    why: "An exception insight's fix: its request and context are what OneUptime found in telemetry, never an incident or alert.",
  },
  "packages/Common/Server/Utils/AI/TelemetryAi/LogInsightFix.ts": {
    kind: "carriesNoRecord",
    why: "A log insight's fix: its request and context are what OneUptime found in telemetry, never an incident or alert.",
  },
  "packages/Common/Server/Utils/AI/TelemetryAi/MetricInsightFix.ts": {
    kind: "carriesNoRecord",
    why: "A metric insight's fix: its request and context are what OneUptime found in telemetry, never an incident or alert.",
  },
  "packages/Common/Server/Utils/AI/TelemetryAi/TraceInsightFix.ts": {
    kind: "carriesNoRecord",
    why: "A trace insight's fix: its request and context are what OneUptime found in telemetry, never an incident or alert.",
  },
  "packages/Common/Server/Utils/AI/TelemetryAi/ProfileInsightFix.ts": {
    kind: "carriesNoRecord",
    why: "A profile insight's fix: its request and context are what OneUptime found in telemetry, never an incident or alert.",
  },
  "packages/Common/Server/Utils/CodeRepository/ProductionReview/ProductionReviewQueue.ts":
    {
      kind: "carriesNoRecord",
      why: "A pull request's production review: its report never holds a private incident (ProductionReviewFindings reads none), and of the rest only labels and counts.",
    },
  "packages/Common/Server/Utils/CodeRepository/GitHub/GitHubAgentTaskTrigger.ts":
    {
      kind: "carriesNoRecord",
      why: "A command in a GitHub comment: the conversation on GitHub, never a OneUptime incident or alert.",
    },
  "packages/Common/Server/Services/TelemetryExceptionService.ts": {
    kind: "carriesNoRecord",
    why: "An exception's fix and its regression test: about a telemetry exception, never an incident or alert.",
  },
  "packages/Common/Server/Utils/AI/CodeFix/CodeFixPullRequestRecord.ts": {
    kind: "namesItsRun",
    mustContain: ["pullRequest.aiRunId = data.aiRunId;"],
  },
  "packages/Common/Server/Utils/AI/Toolbox/CodeWriteTools.ts": {
    kind: "carriesWhatItsChatRead",
    mustContain: [
      "const carried: CarriedRecordIds = await ChatCarriedRecords.ofPullRequest({ conversationId: ctx.conversationId, pageContext: ctx.pageContext, title, description, });",
      "CarriedRecords.writeTo(record, carried);",
    ],
  },
};

// A write of a Code task's turn, or of a pull request record.
const WRITES_CODE_WORK: RegExp =
  /\.runType\s*=\s*AIRunType\.CodeFix\b|\bCodeTaskRuns\.(?:start|startForOneUptime|reply|retry)\(|new AIAgentTaskPullRequest\(\)|\bAIAgentTaskPullRequestService\.(?:create|createMany|insert)\(/;

// A row of either table written with SQL of a file's own.
const INSERTS_CODE_WORK: RegExp =
  /\bINSERT\s+INTO\s+"(?:AIRun|AIAgentTaskPullRequest)"/i;

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

// Read with every run of white space as one, as the code is formatted.
function flat(file: string): string {
  return read(file).replace(/\s+/g, " ");
}

// The server's code: Common's, every App feature set's, and ee's when it is there.
const SERVER_FILES: Array<string> = [
  ...listSourceFiles(path.join(REPOSITORY_ROOT, "packages/Common/Server")),
  ...listSourceFiles(path.join(REPOSITORY_ROOT, "packages/App/FeatureSet")),
  ...listSourceFiles(path.join(REPOSITORY_ROOT, "ee/Server")),
].map(relative);

const WRITER_FILES: Array<string> = SERVER_FILES.filter(
  (file: string): boolean => {
    return WRITES_CODE_WORK.test(read(file));
  },
).sort();

function missingFrom(file: string, snippets: Array<string>): Array<string> {
  const code: string = flat(file);

  return snippets.filter((snippet: string): boolean => {
    return !code.includes(snippet.replace(/\s+/g, " "));
  });
}

describe("every path that writes Code work says what it carries", () => {
  test("the sweep finds the turns' writer, the action item's task and the chat's pull request", () => {
    expect(WRITER_FILES).toEqual(
      expect.arrayContaining([
        "packages/Common/Server/Utils/AI/CodeTask/CodeTaskRuns.ts",
        "packages/Common/Server/Utils/Incident/PostmortemActionItemCodeTasks.ts",
        "packages/Common/Server/Utils/AI/Toolbox/CodeWriteTools.ts",
        "packages/Common/Server/API/CodeTaskAPI.ts",
      ]),
    );
  });

  test.each(WRITER_FILES)(
    "%s is listed with how it carries what it holds",
    (file: string) => {
      expect({ file, isListed: Boolean(WRITERS[file]) }).toEqual({
        file,
        isListed: true,
      });
    },
  );

  test("lists no file that writes none", () => {
    expect(
      Object.keys(WRITERS).filter((file: string): boolean => {
        return !WRITER_FILES.includes(file);
      }),
    ).toEqual([]);
  });

  test.each(Object.entries(WRITERS))(
    "%s holds what it is listed as",
    (file: string, classification: Classification) => {
      if ("mustContain" in classification) {
        expect({
          file,
          missing: missingFrom(file, classification.mustContain),
        }).toEqual({ file, missing: [] });
      }

      if ("why" in classification) {
        expect(classification.why.length).toBeGreaterThan(40);
      }
    },
  );

  test("no file writes an AI run or a pull request record with SQL of its own", () => {
    expect(
      SERVER_FILES.filter((file: string): boolean => {
        return INSERTS_CODE_WORK.test(read(file));
      }),
    ).toEqual([]);
  });
});

/*
 * Where the link is written for every path at once: the service every turn
 * is created through, and the chat runner that tells the tools which chat
 * they run in.
 */
describe("the link is written where every path passes", () => {
  test("AIRunService carries what each turn's request names, and adds a reply's to its task, before the turn is written", () => {
    expect(
      missingFrom("packages/Common/Server/Services/AIRunService.ts", [
        "protected override async onBeforeCreate( createBy: CreateBy<Model>, ): Promise<OnCreate<Model>> { const projectId: ObjectID | undefined = createBy.data.projectId || createBy.props.tenantId || undefined;",
        /*
         * In that same method, before the turn is written: a turn about a
         * product switched off on the server is refused first, then what it
         * carries is written on it.
         */
        "await this.assertProductsAreOn(createBy.data); await this.carryWhatTheTurnCarries(createBy.data); if ( createBy.data.runType === AIRunType.CodeFix &&",
        "CarriedRecords.ofTaskContext(run.taskContext),",
        "CarriedRecords.writeTo(run, carried);",
        "await this.addCarriedRecords({ runId: run.codeTaskId, records: CarriedRecords.without(carried, CarriedRecords.ofRow(task)), });",
      ]),
    ).toEqual([]);
  });

  test("the chat runner tells the tools which chat they run in", () => {
    expect(
      missingFrom("packages/Common/Server/Utils/AI/Chat/ChatAgentRunner.ts", [
        "conversationId: request.conversationId,",
      ]),
    ).toEqual([]);
  });
});

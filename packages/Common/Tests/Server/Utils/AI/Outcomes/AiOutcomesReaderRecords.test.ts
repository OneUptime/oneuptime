import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AlertService from "../../../../../Server/Services/AlertService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import AutoRemediationSuggestionService from "../../../../../Server/Services/AutoRemediationSuggestionService";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import DataSecurityAiDecisionService from "../../../../../Server/Services/DataSecurityAiDecisionService";
import DataSecurityAiProposalService from "../../../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import LlmLogService from "../../../../../Server/Services/LlmLogService";
import OnCallDutyPolicyExecutionLogService from "../../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import AiOutcomesReader from "../../../../../Server/Utils/AI/Outcomes/AiOutcomesReader";
import InvestigationReportSummary from "../../../../../Server/Utils/AI/SRE/InvestigationReportSummary";
import AIRunAutoGrade from "../../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import {
  AI_OUTCOMES_PART_OUTCOMES,
  AI_OUTCOMES_PARTS,
  AI_OUTCOMES_RECORDS_PAGE_SIZE,
  AI_OUTCOMES_RECORDS_TEXT_MAX_LENGTH,
  AI_OUTCOMES_UNKNOWN_MODEL,
  AiOutcomes,
  AiOutcomesPart,
  AiOutcomesRecord,
  AiOutcomesRecords,
} from "../../../../../Types/AI/AiOutcomes";
import FixProductionStatus from "../../../../../Types/AI/FixProductionStatus";
import AutoRemediationSuggestionType from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DataSecurityIssueStatus from "../../../../../Types/DataSecurity/DataSecurityIssueStatus";
import { DataSecurityAiVerdict } from "../../../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import URL from "../../../../../Types/API/URL";
import ObjectID from "../../../../../Types/ObjectID";
import { OnCallPolicyAiHoldOutcome } from "../../../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import {
  FakeRow,
  matchesFilter,
  uuid,
} from "../IncidentAlertActivity/FakeAiActivityStore";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE RECORDS BEHIND AN AI RESULTS NUMBER (issue #7768), and the numbers by
 * model (#7762), from AiOutcomesReader against an in-memory copy of the
 * tables behind the services' findBy.
 *
 * A number opens exactly what it counts: readRecords reads the same rows,
 * under the same props, through the same filters, so for every part and
 * outcome its total is the number on the card, and it lists only incidents
 * and alerts the reader may read, private ones included. That is why the
 * numbers now leave out what they could not open: a held page about an
 * incident the reader may not read, and a fix pull request about one.
 */

const PROJECT_ID: ObjectID = new ObjectID(uuid(1, 1));
const OTHER_PROJECT_ID: ObjectID = new ObjectID(uuid(1, 2));

const NOW: Date = new Date("2026-11-13T15:00:00.000Z");
const WINDOW_START: Date = new Date("2026-08-22T00:00:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID(uuid(2, 1)),
  isMultiTenantRequest: false,
};

type TableName =
  | "pageLogs"
  | "suggestions"
  | "pullRequests"
  | "runs"
  | "incidents"
  | "alerts"
  | "llmLogs"
  // Data Security's proposals, its records of analyses, and its issues (#10364).
  | "dataSecurityProposals"
  | "dataSecurityDecisions"
  | "dataSecurityIssues"
  | "dataStores"
  // The repositories whose production reviews caught leaks (#10376).
  | "codeRepositories";

type Tables = Record<TableName, Array<FakeRow>>;

type Access = "read" | "notAuthorized" | "paymentRequired";

interface Call {
  table: TableName;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
  skip: number | undefined;
  props: DatabaseCommonInteractionProps;
}

interface Store {
  tables: Tables;
  access: Record<TableName, Access>;
  readableIncidentIds?: Set<string> | undefined;
  readableAlertIds?: Set<string> | undefined;
  calls: Array<Call>;
}

let store: Store;

function install(
  tables: Partial<Tables>,
  access: Partial<Record<TableName, Access>> = {},
  readable: { incidentIds?: Array<string>; alertIds?: Array<string> } = {},
): Store {
  store = {
    tables: {
      pageLogs: [],
      suggestions: [],
      pullRequests: [],
      runs: [],
      incidents: [],
      alerts: [],
      llmLogs: [],
      dataSecurityProposals: [],
      dataSecurityDecisions: [],
      dataSecurityIssues: [],
      dataStores: [],
      codeRepositories: [],
      ...tables,
    },
    access: {
      pageLogs: "read",
      suggestions: "read",
      pullRequests: "read",
      runs: "read",
      incidents: "read",
      alerts: "read",
      llmLogs: "read",
      dataSecurityProposals: "read",
      dataSecurityDecisions: "read",
      dataSecurityIssues: "read",
      dataStores: "read",
      codeRepositories: "read",
      ...access,
    },
    readableIncidentIds: readable.incidentIds
      ? new Set(readable.incidentIds)
      : undefined,
    readableAlertIds: readable.alertIds
      ? new Set(readable.alertIds)
      : undefined,
    calls: [],
  };

  const find: (
    table: TableName,
  ) => (args: unknown) => Promise<Array<unknown>> = (table: TableName) => {
    return async (args: unknown): Promise<Array<unknown>> => {
      const findBy: Omit<Call, "table"> = args as Omit<Call, "table">;

      store.calls.push({ table, ...findBy });

      let rows: Array<FakeRow> = store.tables[table];

      if (!findBy.props?.isRoot) {
        if (table === "runs") {
          throw new NotAuthorizedException("Runs are read as root.");
        }

        if (store.access[table] === "notAuthorized") {
          throw new NotAuthorizedException(`You may not read ${table}.`);
        }

        if (store.access[table] === "paymentRequired") {
          throw new PaymentRequiredException(`No ${table} on your plan.`);
        }

        const ids: Set<string> | undefined =
          table === "incidents"
            ? store.readableIncidentIds
            : table === "alerts"
              ? store.readableAlertIds
              : undefined;

        rows = rows.filter((row: FakeRow): boolean => {
          return !ids || ids.has(row._id);
        });
      }

      return rows
        .filter((row: FakeRow): boolean => {
          return Object.keys(findBy.query).every((key: string): boolean => {
            return matchesFilter(row[key], findBy.query[key]);
          });
        })
        .sort((a: FakeRow, b: FakeRow): number => {
          return b.createdAt.getTime() - a.createdAt.getTime();
        })
        .slice(0, findBy.limit)
        .map((row: FakeRow): Record<string, unknown> => {
          return { ...row, id: new ObjectID(row._id) };
        });
    };
  };

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
    .mockImplementation(find("pageLogs") as never);
  jest
    .spyOn(AutoRemediationSuggestionService, "findBy")
    .mockImplementation(find("suggestions") as never);
  jest
    .spyOn(AIAgentTaskPullRequestService, "findBy")
    .mockImplementation(find("pullRequests") as never);
  jest.spyOn(AIRunService, "findBy").mockImplementation(find("runs") as never);
  jest
    .spyOn(IncidentService, "findBy")
    .mockImplementation(find("incidents") as never);
  jest
    .spyOn(AlertService, "findBy")
    .mockImplementation(find("alerts") as never);
  jest
    .spyOn(LlmLogService, "findBy")
    .mockImplementation(find("llmLogs") as never);
  jest
    .spyOn(DataSecurityAiProposalService, "findBy")
    .mockImplementation(find("dataSecurityProposals") as never);
  jest
    .spyOn(DataSecurityAiDecisionService, "findBy")
    .mockImplementation(find("dataSecurityDecisions") as never);
  jest
    .spyOn(DataSecurityIssueService, "findBy")
    .mockImplementation(find("dataSecurityIssues") as never);
  jest
    .spyOn(DataStoreService, "findBy")
    .mockImplementation(find("dataStores") as never);
  jest
    .spyOn(CodeRepositoryService, "findBy")
    .mockImplementation(find("codeRepositories") as never);
  jest
    .spyOn(InvestigationReportSummary, "getForRuns")
    .mockResolvedValue(new Map<string, string>());

  return store;
}

function callsTo(table: TableName): Array<Call> {
  return store.calls.filter((call: Call): boolean => {
    return call.table === table;
  });
}

function readOutcomes(): Promise<AiOutcomes> {
  return AiOutcomesReader.read({
    projectId: PROJECT_ID,
    props: CALLER,
    now: NOW,
  });
}

function readRecords(
  part: AiOutcomesPart,
  outcome: string,
  options: { windowEnd?: Date; skip?: number; pageSize?: number } = {},
): Promise<AiOutcomesRecords> {
  return AiOutcomesReader.readRecords({
    projectId: PROJECT_ID,
    props: CALLER,
    now: NOW,
    part,
    outcome,
    ...options,
  });
}

// Rows -----------------------------------------------------------------------

let rowCount: number = 0;

function nextId(group: number): string {
  rowCount++;
  return uuid(group, rowCount);
}

function incident(index: number, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: uuid(10, index),
    projectId: PROJECT_ID,
    createdAt: daysAgo(20),
    title: `Checkout is down ${index}`,
    incidentNumber: index,
    incidentNumberWithPrefix: `INC-${index}`,
    ...overrides,
  };
}

function alert(index: number, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: uuid(20, index),
    projectId: PROJECT_ID,
    createdAt: daysAgo(20),
    title: `Disk is full ${index}`,
    alertNumber: index,
    ...overrides,
  };
}

const INCIDENT_A: FakeRow = incident(1);
const INCIDENT_PRIVATE: FakeRow = incident(2);
const ALERT_A: FakeRow = alert(1);
const ALERT_HIDDEN: FakeRow = alert(2);

function aboutIncident(row: FakeRow): Partial<FakeRow> {
  return { triggeredByIncidentId: new ObjectID(row._id) };
}

function aboutAlert(row: FakeRow): Partial<FakeRow> {
  return { triggeredByAlertId: new ObjectID(row._id) };
}

function pageLog(
  outcome: OnCallPolicyAiHoldOutcome,
  subject: Partial<FakeRow>,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  return {
    _id: nextId(30),
    projectId: PROJECT_ID,
    createdAt: daysAgo(3),
    aiHoldOutcome: outcome,
    ...subject,
    ...overrides,
  };
}

function fix(
  status: AutoRemediationVerificationStatus,
  subject: Partial<FakeRow>,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  return {
    _id: nextId(40),
    projectId: PROJECT_ID,
    createdAt: daysAgo(3),
    verificationStatus: status,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    rationaleMarkdown: "Restart the payments worker.",
    ...subject,
    ...overrides,
  };
}

function fixTask(
  subject: Partial<FakeRow>,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  return {
    _id: nextId(70),
    projectId: PROJECT_ID,
    createdAt: daysAgo(4),
    runType: AIRunType.CodeFix,
    status: AIRunStatus.Completed,
    ...subject,
    ...overrides,
  };
}

function pullRequest(
  status: FixProductionStatus,
  task: FakeRow | null,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  return {
    _id: nextId(50),
    projectId: PROJECT_ID,
    createdAt: daysAgo(3),
    productionStatus: status,
    ...(task ? { aiRunId: new ObjectID(task._id) } : {}),
    title: "Raise the checkout timeout",
    pullRequestNumber: 42,
    pullRequestUrl: URL.fromString("https://github.com/acme/shop/pull/42"),
    ...overrides,
  };
}

function investigation(
  subject: Partial<FakeRow>,
  judged: Partial<FakeRow> = {},
  overrides: Partial<FakeRow> = {},
): FakeRow {
  return {
    _id: nextId(60),
    projectId: PROJECT_ID,
    createdAt: daysAgo(5),
    runType: AIRunType.Investigation,
    status: AIRunStatus.Completed,
    analysisTldr: "The database ran out of connections.",
    ...subject,
    ...judged,
    ...overrides,
  };
}

const CONFIRMED: Partial<FakeRow> = {
  humanVerdict: AIRunHumanVerdict.Confirmed,
};
const MATCH: Partial<FakeRow> = { autoGrade: AIRunAutoGrade.Match };
const PARTIAL: Partial<FakeRow> = { autoGrade: AIRunAutoGrade.Partial };
const MISMATCH: Partial<FakeRow> = { autoGrade: AIRunAutoGrade.Mismatch };

function ids(records: AiOutcomesRecords): Array<string> {
  return records.records.map((record: AiOutcomesRecord): string => {
    return record.id;
  });
}

beforeEach(() => {
  rowCount = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
});

const STORE_PUBLIC_BY_DESIGN: FakeRow = {
  _id: uuid(91, 1),
  projectId: PROJECT_ID,
  createdAt: daysAgo(200),
  isPublicByDesign: true,
};
const STORE_FIXED: FakeRow = {
  _id: uuid(91, 2),
  projectId: PROJECT_ID,
  createdAt: daysAgo(200),
  isPublicByDesign: false,
};

// An issue OneUptime AI analyzed (#10369): its verdict, and what people decided.
function analyzedIssue(
  verdict: DataSecurityAiVerdict,
  status: DataSecurityIssueStatus,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  const analyzedAt: Date = (overrides["aiAnalyzedAt"] as Date) || daysAgo(2);

  return {
    _id: nextId(90),
    projectId: PROJECT_ID,
    createdAt: analyzedAt,
    aiAnalyzedAt: analyzedAt,
    title: `A bucket anyone can read ${rowCount}`,
    aiVerdict: verdict,
    status: status,
    dataStoreId: new ObjectID(STORE_FIXED._id),
    ...overrides,
  };
}

function analyzedIssues(): Array<FakeRow> {
  return [
    analyzedIssue(DataSecurityAiVerdict.Real, DataSecurityIssueStatus.Resolved),
    analyzedIssue(
      DataSecurityAiVerdict.Real,
      DataSecurityIssueStatus.NotAnIssue,
    ),
    analyzedIssue(
      DataSecurityAiVerdict.LikelyByDesign,
      DataSecurityIssueStatus.Resolved,
      { dataStoreId: new ObjectID(STORE_PUBLIC_BY_DESIGN._id) },
    ),
    analyzedIssue(
      DataSecurityAiVerdict.LikelyByDesign,
      DataSecurityIssueStatus.Resolved,
    ),
    analyzedIssue(
      DataSecurityAiVerdict.LikelyWrongFinding,
      DataSecurityIssueStatus.NotAnIssue,
    ),
    analyzedIssue(
      DataSecurityAiVerdict.CannotTell,
      DataSecurityIssueStatus.Open,
    ),
    analyzedIssue(DataSecurityAiVerdict.Real, DataSecurityIssueStatus.Open),
    // Analyzed before the window, and in another project: neither counts.
    analyzedIssue(
      DataSecurityAiVerdict.Real,
      DataSecurityIssueStatus.Resolved,
      { aiAnalyzedAt: daysAgo(120) },
    ),
    analyzedIssue(
      DataSecurityAiVerdict.Real,
      DataSecurityIssueStatus.Resolved,
      { projectId: OTHER_PROJECT_ID },
    ),
  ];
}

// A busy project: every kind, every outcome, some about what the caller may not read.
function busyProject(): Partial<Tables> {
  const taskA: FakeRow = fixTask(aboutIncident(INCIDENT_A));
  const taskPrivate: FakeRow = fixTask(aboutIncident(INCIDENT_PRIVATE));
  const taskAlert: FakeRow = fixTask(aboutAlert(ALERT_A));
  // An exception's fix task: about no incident or alert.
  const taskException: FakeRow = fixTask({
    triggeredByTelemetryExceptionId: new ObjectID(uuid(80, 1)),
  });
  // A chat's run: what it carries is no fix of it.
  const chatRun: FakeRow = fixTask(aboutIncident(INCIDENT_PRIVATE), {
    runType: AIRunType.Chat,
  });

  return {
    incidents: [INCIDENT_A, INCIDENT_PRIVATE],
    alerts: [ALERT_A, ALERT_HIDDEN],
    dataSecurityIssues: analyzedIssues(),
    dataStores: [STORE_PUBLIC_BY_DESIGN, STORE_FIXED],
    pageLogs: [
      pageLog(
        OnCallPolicyAiHoldOutcome.ResolvedByAI,
        aboutIncident(INCIDENT_A),
      ),
      pageLog(OnCallPolicyAiHoldOutcome.ResolvedByAI, aboutAlert(ALERT_A)),
      pageLog(
        OnCallPolicyAiHoldOutcome.ResolvedByAI,
        aboutIncident(INCIDENT_PRIVATE),
      ),
      pageLog(OnCallPolicyAiHoldOutcome.HoldTimeRanOut, aboutAlert(ALERT_A)),
      pageLog(
        OnCallPolicyAiHoldOutcome.HoldTimeRanOut,
        aboutAlert(ALERT_HIDDEN),
      ),
      pageLog(OnCallPolicyAiHoldOutcome.HandedOff, aboutIncident(INCIDENT_A)),
      pageLog(OnCallPolicyAiHoldOutcome.Holding, aboutIncident(INCIDENT_A)),
      pageLog(OnCallPolicyAiHoldOutcome.PageNowPressed, {}),
    ],
    suggestions: [
      fix(AutoRemediationVerificationStatus.Verified, {
        incidentId: new ObjectID(INCIDENT_A._id),
      }),
      fix(AutoRemediationVerificationStatus.Failed, {
        alertId: new ObjectID(ALERT_A._id),
      }),
      fix(AutoRemediationVerificationStatus.Failed, {
        incidentId: new ObjectID(INCIDENT_PRIVATE._id),
      }),
      fix(AutoRemediationVerificationStatus.Pending, {
        alertId: new ObjectID(ALERT_A._id),
      }),
    ],
    pullRequests: [
      pullRequest(FixProductionStatus.Verified, taskA),
      pullRequest(FixProductionStatus.Regressed, taskPrivate),
      pullRequest(FixProductionStatus.Regressed, taskAlert),
      pullRequest(FixProductionStatus.Regressed, taskException),
      pullRequest(FixProductionStatus.Watching, chatRun),
      pullRequest(FixProductionStatus.Unverifiable, null),
    ],
    runs: [
      taskA,
      taskPrivate,
      taskAlert,
      taskException,
      chatRun,
      investigation(aboutIncident(INCIDENT_A), CONFIRMED),
      investigation(aboutIncident(INCIDENT_A), MISMATCH),
      investigation(aboutAlert(ALERT_A), PARTIAL),
      investigation(aboutIncident(INCIDENT_PRIVATE), MISMATCH),
      investigation(aboutAlert(ALERT_HIDDEN), MATCH),
      investigation(aboutAlert(ALERT_A)),
    ],
  };
}

const READABLE: { incidentIds: Array<string>; alertIds: Array<string> } = {
  incidentIds: [INCIDENT_A._id],
  alertIds: [ALERT_A._id],
};

describe("a number opens exactly what it counts", () => {
  test("for every part and outcome, the records' total is the card's number", async () => {
    install(busyProject(), {}, READABLE);

    const outcomes: AiOutcomes = await readOutcomes();
    const counts: Record<AiOutcomesPart, Record<string, number>> = {
      [AiOutcomesPart.Pages]: outcomes.pages as unknown as Record<
        string,
        number
      >,
      [AiOutcomesPart.RemediationFixes]:
        outcomes.remediationFixes as unknown as Record<string, number>,
      [AiOutcomesPart.PullRequestFixes]:
        outcomes.pullRequestFixes as unknown as Record<string, number>,
      [AiOutcomesPart.RootCauses]: outcomes.rootCauses as unknown as Record<
        string,
        number
      >,
      [AiOutcomesPart.DataSecurityAnalyses]: {
        analyzed: outcomes.dataSecurity!.issuesAnalyzed!,
      },
      [AiOutcomesPart.DataSecurityChanges]: outcomes.dataSecurity!
        .changes as unknown as Record<string, number>,
      [AiOutcomesPart.DataSecurityProposals]: outcomes.dataSecurity!
        .proposals as unknown as Record<string, number>,
      [AiOutcomesPart.IssueVerdicts]:
        outcomes.issueVerdicts as unknown as Record<string, number>,
      [AiOutcomesPart.Leaks]: outcomes.leaks as unknown as Record<
        string,
        number
      >,
    };

    let opened: number = 0;

    for (const part of AI_OUTCOMES_PARTS) {
      for (const outcome of AI_OUTCOMES_PART_OUTCOMES[part]) {
        const records: AiOutcomesRecords = await readRecords(part, outcome);

        expect({ part, outcome, total: records.total }).toEqual({
          part,
          outcome,
          total: counts[part][outcome],
        });
        expect({ part, outcome, listed: records.records.length }).toEqual({
          part,
          outcome,
          listed: counts[part][outcome],
        });
        expect(records.part).toBe(part);
        expect(records.outcome).toBe(outcome);
        expect(records.nextSkip).toBeNull();
        opened += records.total;
      }
    }

    // The project's numbers are not all zeros: the check above means something.
    expect(opened).toBeGreaterThan(10);
  });

  test("held pages: only those about an incident or alert the caller may read - a private incident's and a hidden alert's are neither counted nor listed", async () => {
    install(busyProject(), {}, READABLE);

    const outcomes: AiOutcomes = await readOutcomes();

    expect(outcomes.pages).toEqual({
      resolvedByAi: 2,
      recoveredOnItsOwn: 0,
      handledByPerson: 0,
      handedOff: 1,
      holdTimeRanOut: 1,
      // A run about neither an incident nor an alert opens nothing.
      pageNowPressed: 0,
      holding: 1,
    });

    const resolved: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.Pages,
      "resolvedByAi",
    );

    expect(
      resolved.records
        .map((record: AiOutcomesRecord): string => {
          return `${record.subject!.kind}:${record.subject!.id}`;
        })
        .sort(),
    ).toEqual([`alert:${ALERT_A._id}`, `incident:${INCIDENT_A._id}`].sort());
  });

  test("fix pull requests: one about an incident or alert the caller may not read is neither counted nor listed; one about neither still is", async () => {
    install(busyProject(), {}, READABLE);

    const outcomes: AiOutcomes = await readOutcomes();

    expect(outcomes.pullRequestFixes).toEqual({
      verified: 1,
      // The alert's and the exception's, not the private incident's.
      regressed: 2,
      // A chat's pull request carries its incident, but is no fix of it.
      watching: 1,
      awaitingDeploy: 0,
      unverifiable: 1,
    });

    const regressed: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.PullRequestFixes,
      "regressed",
    );

    expect(regressed.total).toBe(2);
    expect(
      regressed.records
        .map((record: AiOutcomesRecord): string => {
          return record.subject ? record.subject.kind : "none";
        })
        .sort(),
    ).toEqual(["alert", "none"]);
  });

  test("everything about a private incident or a hidden alert stays out of the lists, in every part", async () => {
    install(busyProject(), {}, READABLE);

    const hidden: Array<string> = [INCIDENT_PRIVATE._id, ALERT_HIDDEN._id];

    for (const part of AI_OUTCOMES_PARTS) {
      for (const outcome of AI_OUTCOMES_PART_OUTCOMES[part]) {
        const records: AiOutcomesRecords = await readRecords(part, outcome);

        for (const record of records.records) {
          expect(hidden).not.toContain(record.subject?.id);
        }

        expect(JSON.stringify(records)).not.toContain("Checkout is down 2");
        expect(JSON.stringify(records)).not.toContain("Disk is full 2");
      }
    }
  });

  test("a caller who may read every incident and alert sees all of them", async () => {
    install(busyProject());

    const outcomes: AiOutcomes = await readOutcomes();

    expect(outcomes.pages!.resolvedByAi).toBe(3);
    expect(outcomes.pages!.holdTimeRanOut).toBe(2);
    expect(outcomes.pullRequestFixes!.regressed).toBe(3);
    expect(
      (await readRecords(AiOutcomesPart.Pages, "holdTimeRanOut")).total,
    ).toBe(2);
    expect(
      (await readRecords(AiOutcomesPart.PullRequestFixes, "regressed")).total,
    ).toBe(3);
  });
});

describe("what each record says", () => {
  test("its incident or alert, as the caller may read it, newest first", async () => {
    install({
      incidents: [INCIDENT_A],
      alerts: [ALERT_A],
      pageLogs: [
        pageLog(
          OnCallPolicyAiHoldOutcome.HoldTimeRanOut,
          aboutIncident(INCIDENT_A),
          { createdAt: daysAgo(9) },
        ),
        pageLog(OnCallPolicyAiHoldOutcome.HoldTimeRanOut, aboutAlert(ALERT_A), {
          createdAt: daysAgo(2),
        }),
      ],
    });

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.Pages,
      "holdTimeRanOut",
    );

    expect(records.records).toEqual([
      {
        id: store.tables.pageLogs[1]!._id,
        at: daysAgo(2).toISOString(),
        subject: {
          kind: "alert",
          id: ALERT_A._id,
          title: "Disk is full 1",
          number: 1,
        },
      },
      {
        id: store.tables.pageLogs[0]!._id,
        at: daysAgo(9).toISOString(),
        subject: {
          kind: "incident",
          id: INCIDENT_A._id,
          title: "Checkout is down 1",
          number: 1,
          numberWithPrefix: "INC-1",
        },
      },
    ]);
  });

  test("a fix: its runbook, or what kind of fix it was - never its rationale or its plan", async () => {
    install({
      incidents: [INCIDENT_A],
      suggestions: [
        fix(
          AutoRemediationVerificationStatus.Failed,
          { incidentId: new ObjectID(INCIDENT_A._id) },
          {
            suggestionType: AutoRemediationSuggestionType.Runbook,
            runbookNameSnapshot: "Restart checkout",
          },
        ),
        fix(
          AutoRemediationVerificationStatus.Failed,
          { incidentId: new ObjectID(INCIDENT_A._id) },
          { createdAt: daysAgo(4), commandPlan: { steps: ["kubectl delete"] } },
        ),
      ],
    });

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.RemediationFixes,
      "failed",
    );

    expect(
      records.records.map((record: AiOutcomesRecord) => {
        return [record.runbookName, record.suggestionType];
      }),
    ).toEqual([
      ["Restart checkout", AutoRemediationSuggestionType.Runbook],
      [undefined, AutoRemediationSuggestionType.CommandPlan],
    ]);

    const text: string = JSON.stringify(records);
    expect(text).not.toContain("Restart the payments worker.");
    expect(text).not.toContain("kubectl delete");

    // Read under the caller's props, as the fixes were counted.
    for (const call of callsTo("suggestions")) {
      expect(call.props).toBe(CALLER);
    }
  });

  test("a fix pull request: its number, title and link - a link only to a web address", async () => {
    const task: FakeRow = fixTask(aboutIncident(INCIDENT_A));

    install({
      incidents: [INCIDENT_A],
      runs: [task],
      pullRequests: [
        pullRequest(FixProductionStatus.Regressed, task),
        pullRequest(FixProductionStatus.Regressed, null, {
          createdAt: daysAgo(6),
          pullRequestNumber: 7,
          title: `  ${"a".repeat(AI_OUTCOMES_RECORDS_TEXT_MAX_LENGTH + 50)}  `,
          pullRequestUrl: "javascript:alert(1)",
        }),
      ],
    });

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.PullRequestFixes,
      "regressed",
    );

    expect(records.records[0]).toMatchObject({
      subject: { kind: "incident", id: INCIDENT_A._id },
      pullRequestNumber: 42,
      pullRequestTitle: "Raise the checkout timeout",
      pullRequestUrl: "https://github.com/acme/shop/pull/42",
    });
    expect(records.records[1]!.subject).toBeUndefined();
    expect(records.records[1]!.pullRequestNumber).toBe(7);
    expect(records.records[1]!.pullRequestUrl).toBeUndefined();
    expect(records.records[1]!.pullRequestTitle!.length).toBe(
      AI_OUTCOMES_RECORDS_TEXT_MAX_LENGTH,
    );
    expect(records.records[1]!.pullRequestTitle!.endsWith("…")).toBe(true);
  });

  test("an investigation: its one-line finding and how it was judged", async () => {
    install({
      incidents: [INCIDENT_A],
      runs: [
        investigation(aboutIncident(INCIDENT_A), {
          ...CONFIRMED,
          ...MISMATCH,
        }),
      ],
    });

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.RootCauses,
      "confirmed",
    );

    expect(records.records).toHaveLength(1);
    expect(records.records[0]).toMatchObject({
      summary: "The database ran out of connections.",
      humanVerdict: AIRunHumanVerdict.Confirmed,
      autoGrade: AIRunAutoGrade.Mismatch,
      subject: { kind: "incident", id: INCIDENT_A._id },
    });
  });

  test("an investigation without a one-line finding has its report's own summary", async () => {
    const run: FakeRow = investigation(aboutIncident(INCIDENT_A), MISMATCH, {
      analysisTldr: undefined,
    });

    install({ incidents: [INCIDENT_A], runs: [run] });

    const summaries: SpyInstance<typeof InvestigationReportSummary.getForRuns> =
      jest
        .spyOn(InvestigationReportSummary, "getForRuns")
        .mockResolvedValue(new Map([[run._id, "The pool was too small."]]));

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.RootCauses,
      "wrong",
    );

    expect(records.records[0]!.summary).toBe("The pool was too small.");
    expect(summaries).toHaveBeenCalledTimes(1);
    expect(
      summaries.mock.calls[0]![0].runs.map((entry: { aiRunId: ObjectID }) => {
        return entry.aiRunId.toString();
      }),
    ).toEqual([run._id]);
  });

  test("investigations and fix tasks are read as root; everything else under the caller's props", async () => {
    install(busyProject(), {}, READABLE);

    for (const part of AI_OUTCOMES_PARTS) {
      await readRecords(part, AI_OUTCOMES_PART_OUTCOMES[part][0]!);
    }

    for (const call of store.calls) {
      // A store's public-by-design flag is counted, never shown: read as OneUptime.
      expect({ table: call.table, isRoot: Boolean(call.props.isRoot) }).toEqual(
        {
          table: call.table,
          isRoot: call.table === "runs" || call.table === "dataStores",
        },
      );
    }
  });

  test("a record whose incident the caller can no longer read when it is listed is left out", async () => {
    install({
      incidents: [INCIDENT_A],
      pageLogs: [
        pageLog(OnCallPolicyAiHoldOutcome.HandedOff, aboutIncident(INCIDENT_A)),
      ],
    });

    const find: SpyInstance<typeof IncidentService.findBy> =
      IncidentService.findBy as unknown as SpyInstance<
        typeof IncidentService.findBy
      >;
    const original: (...args: Array<unknown>) => unknown =
      find.getMockImplementation() as never;

    // The incident is read as readable, then gone by the time it is named.
    find.mockImplementation((async (args: {
      select: Record<string, unknown>;
    }) => {
      if (args.select["title"]) {
        return [];
      }

      return original(args);
    }) as never);

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.Pages,
      "handedOff",
    );

    expect(records.total).toBe(1);
    expect(records.records).toEqual([]);
  });
});

describe("a page at a time", () => {
  test("newest first, the page size at most, and where the next page starts", async () => {
    const count: number = AI_OUTCOMES_RECORDS_PAGE_SIZE * 2 + 7;

    install({
      incidents: [INCIDENT_A],
      pageLogs: Array.from(
        { length: count },
        (_value: unknown, index: number): FakeRow => {
          return pageLog(
            OnCallPolicyAiHoldOutcome.HandedOff,
            aboutIncident(INCIDENT_A),
            { createdAt: new Date(NOW.getTime() - (index + 1) * 60 * 1000) },
          );
        },
      ),
    });

    const first: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.Pages,
      "handedOff",
    );
    const second: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.Pages,
      "handedOff",
      { skip: first.nextSkip! },
    );
    const third: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.Pages,
      "handedOff",
      { skip: second.nextSkip! },
    );

    expect([first.total, second.total, third.total]).toEqual([
      count,
      count,
      count,
    ]);
    expect([
      first.records.length,
      second.records.length,
      third.records.length,
    ]).toEqual([
      AI_OUTCOMES_RECORDS_PAGE_SIZE,
      AI_OUTCOMES_RECORDS_PAGE_SIZE,
      7,
    ]);
    expect([first.nextSkip, second.nextSkip, third.nextSkip]).toEqual([
      AI_OUTCOMES_RECORDS_PAGE_SIZE,
      AI_OUTCOMES_RECORDS_PAGE_SIZE * 2,
      null,
    ]);

    const all: Array<string> = [...ids(first), ...ids(second), ...ids(third)];

    // Every one once, newest first.
    expect(new Set(all).size).toBe(count);
    expect(all).toEqual(
      [...store.tables.pageLogs]
        .sort((a: FakeRow, b: FakeRow): number => {
          return b.createdAt.getTime() - a.createdAt.getTime();
        })
        .map((row: FakeRow): string => {
          return row._id;
        }),
    );
  });

  test("past the last one: nothing, and no next page", async () => {
    install({
      incidents: [INCIDENT_A],
      pageLogs: [
        pageLog(OnCallPolicyAiHoldOutcome.HandedOff, aboutIncident(INCIDENT_A)),
      ],
    });

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.Pages,
      "handedOff",
      { skip: 5 },
    );

    expect(records.total).toBe(1);
    expect(records.records).toEqual([]);
    expect(records.nextSkip).toBeNull();
  });
});

describe("the window the number was counted in", () => {
  test("work started after the number was counted is not among its records", async () => {
    const countedAt: Date = daysAgo(2);

    install({
      incidents: [INCIDENT_A],
      pageLogs: [
        pageLog(
          OnCallPolicyAiHoldOutcome.HandedOff,
          aboutIncident(INCIDENT_A),
          {
            createdAt: daysAgo(3),
          },
        ),
        pageLog(
          OnCallPolicyAiHoldOutcome.HandedOff,
          aboutIncident(INCIDENT_A),
          {
            createdAt: daysAgo(1),
          },
        ),
      ],
    });

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.Pages,
      "handedOff",
      { windowEnd: countedAt },
    );

    expect(records.total).toBe(1);
    expect(records.records[0]!.at).toBe(daysAgo(3).toISOString());

    // The read itself stops at the moment: the scan limit counts the same rows.
    const createdAt: unknown = callsTo("pageLogs")[0]!.query["createdAt"];
    expect(matchesFilter(countedAt, createdAt)).toBe(true);
    expect(matchesFilter(new Date(countedAt.getTime() + 1), createdAt)).toBe(
      false,
    );
    expect(matchesFilter(AiOutcomesWindowStart(countedAt), createdAt)).toBe(
      true,
    );
  });

  test("a moment later than now is now", async () => {
    install({
      incidents: [INCIDENT_A],
      pageLogs: [
        pageLog(
          OnCallPolicyAiHoldOutcome.HandedOff,
          aboutIncident(INCIDENT_A),
          {
            createdAt: new Date(NOW.getTime() - 1000),
          },
        ),
      ],
    });

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.Pages,
      "handedOff",
      { windowEnd: new Date(NOW.getTime() + 30 * DAY) },
    );

    expect(records.total).toBe(1);
    expect(
      matchesFilter(
        new Date(NOW.getTime() + 1),
        callsTo("pageLogs")[0]!.query["createdAt"],
      ),
    ).toBe(false);
  });

  test("only this project's rows, from the window's start", async () => {
    install({
      incidents: [INCIDENT_A],
      pageLogs: [
        pageLog(
          OnCallPolicyAiHoldOutcome.HandedOff,
          aboutIncident(INCIDENT_A),
          {
            createdAt: new Date(WINDOW_START.getTime() - 1),
          },
        ),
        pageLog(
          OnCallPolicyAiHoldOutcome.HandedOff,
          aboutIncident(INCIDENT_A),
          {
            projectId: OTHER_PROJECT_ID,
          },
        ),
        pageLog(
          OnCallPolicyAiHoldOutcome.HandedOff,
          aboutIncident(INCIDENT_A),
          {
            createdAt: WINDOW_START,
          },
        ),
      ],
    });

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.Pages,
      "handedOff",
    );

    expect(records.total).toBe(1);
    expect(records.records[0]!.at).toBe(WINDOW_START.toISOString());
  });
});

// The window's first moment for a window ending at `end`, as the builder counts it.
function AiOutcomesWindowStart(end: Date): Date {
  const startOfToday: number = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
  );

  return new Date(startOfToday + DAY - 12 * 7 * DAY);
}

describe("what is refused", () => {
  test("an outcome its part does not count", async () => {
    install({});

    await expect(
      readRecords(AiOutcomesPart.Pages, "verified"),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(
      readRecords(AiOutcomesPart.RootCauses, "completed"),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(
      readRecords("everything" as AiOutcomesPart, "verified"),
    ).rejects.toBeInstanceOf(BadDataException);
    // Refused before anything is read.
    expect(store.calls).toEqual([]);
  });

  test.each([
    [AiOutcomesPart.Pages, "pageLogs", "notAuthorized"],
    [AiOutcomesPart.Pages, "pageLogs", "paymentRequired"],
    [AiOutcomesPart.RemediationFixes, "suggestions", "notAuthorized"],
    [AiOutcomesPart.PullRequestFixes, "pullRequests", "paymentRequired"],
  ] as Array<[AiOutcomesPart, TableName, Access]>)(
    "%s, for a caller who may not read %s (%s)",
    async (part: AiOutcomesPart, table: TableName, access: Access) => {
      install(busyProject(), { [table]: access }, READABLE);

      await expect(
        readRecords(part, AI_OUTCOMES_PART_OUTCOMES[part][0]!),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test.each([
    AiOutcomesPart.Pages,
    AiOutcomesPart.RemediationFixes,
    AiOutcomesPart.RootCauses,
  ])(
    "%s, for a caller who may read neither incidents nor alerts",
    async (part: AiOutcomesPart) => {
      install(busyProject(), {
        incidents: "notAuthorized",
        alerts: "paymentRequired",
      });

      await expect(
        readRecords(part, AI_OUTCOMES_PART_OUTCOMES[part][0]!),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );
});

describe("by model (#7762)", () => {
  test("investigations by the model that wrote them, fixes by their investigation's", async () => {
    const task: FakeRow = fixTask(aboutIncident(INCIDENT_A), {
      createdAt: daysAgo(4),
    });

    install({
      incidents: [INCIDENT_A],
      alerts: [ALERT_A],
      runs: [
        task,
        investigation(aboutIncident(INCIDENT_A), MATCH, {
          modelName: "chat-large",
          createdAt: daysAgo(6),
        }),
        investigation(aboutAlert(ALERT_A), MISMATCH, {
          modelName: "chat-medium",
          createdAt: daysAgo(6),
        }),
        investigation(aboutAlert(ALERT_A), MATCH, { createdAt: daysAgo(30) }),
      ],
      suggestions: [
        fix(
          AutoRemediationVerificationStatus.Failed,
          { alertId: new ObjectID(ALERT_A._id) },
          { createdAt: daysAgo(5) },
        ),
      ],
      pullRequests: [
        pullRequest(FixProductionStatus.Verified, task, {
          createdAt: daysAgo(3),
        }),
      ],
    });

    const outcomes: AiOutcomes = await readOutcomes();

    expect(outcomes.models).toEqual({
      rootCauses: [
        { modelName: "chat-large", value: 1, total: 1 },
        { modelName: "chat-medium", value: 0, total: 1 },
        { modelName: AI_OUTCOMES_UNKNOWN_MODEL, value: 1, total: 1 },
      ],
      fixes: [
        { modelName: "chat-large", value: 1, total: 1 },
        { modelName: "chat-medium", value: 0, total: 1 },
      ],
      changes: [],
    });
  });

  test.each(["notAuthorized", "paymentRequired"] as Array<Access>)(
    "no model is named to a caller who may not read the AI Logs (%s)",
    async (access: Access) => {
      install(
        {
          incidents: [INCIDENT_A],
          runs: [
            investigation(aboutIncident(INCIDENT_A), MATCH, {
              modelName: "chat-large",
            }),
          ],
        },
        { llmLogs: access },
      );

      const outcomes: AiOutcomes = await readOutcomes();

      expect(outcomes.models).toBeNull();
      expect(JSON.stringify(outcomes)).not.toContain("chat-large");
      // The rest is counted as ever.
      expect(outcomes.rootCauses!.confirmed).toBe(1);
    },
  );

  test("whether the caller may read the AI Logs is asked once, under their props, of this project", async () => {
    install({});

    await readOutcomes();

    const calls: Array<Call> = callsTo("llmLogs");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.props).toBe(CALLER);
    expect(calls[0]!.query).toEqual({ projectId: PROJECT_ID });
    expect(calls[0]!.select).toEqual({ _id: true });
    expect(calls[0]!.limit).toBe(1);
  });

  test("a fix task is read once, by its run id, for when it started and what it was a fix of", async () => {
    const task: FakeRow = fixTask(aboutIncident(INCIDENT_A));

    install({
      incidents: [INCIDENT_A],
      runs: [task],
      pullRequests: [
        pullRequest(FixProductionStatus.Verified, task),
        pullRequest(FixProductionStatus.Regressed, task),
      ],
    });

    await readOutcomes();

    const taskReads: Array<Call> = callsTo("runs").filter(
      (call: Call): boolean => {
        return call.query["runType"] === undefined;
      },
    );

    expect(taskReads).toHaveLength(1);
    expect(taskReads[0]!.props).toEqual({ isRoot: true });
    expect(taskReads[0]!.select).toEqual({
      _id: true,
      createdAt: true,
      runType: true,
      triggeredByIncidentId: true,
      triggeredByAlertId: true,
      // Whether it is a later turn of a Code task, whose first turn is the fix's.
      codeTaskId: true,
    });
    expect(matchesFilter(task._id, taskReads[0]!.query["_id"])).toBe(true);
    expect(taskReads[0]!.limit).toBe(1);
  });
});

/*
 * A PULL REQUEST A LATER TURN OF ITS TASK OPENED (#9812).
 *
 * Try again asks a fix again as a later turn of the same Code task, and a
 * reply someone sends in Code is one too; either can open the task's pull
 * request. The pull request is the task's: what it was a fix of and when
 * the fix started are its first turn's - a reply carries no incident or
 * alert, and a turn asked again started after the investigation the fix
 * was written from.
 */
describe("a pull request a later turn of its task opened (#9812)", () => {
  // A reply someone sent in Code: a request of the task, about nothing.
  function replyTo(task: FakeRow, overrides: Partial<FakeRow> = {}): FakeRow {
    return fixTask(
      {},
      {
        codeFixTaskType: CodeFixTaskType.CodeRequest,
        codeTaskId: new ObjectID(task._id),
        createdAt: daysAgo(3),
        ...overrides,
      },
    );
  }

  // The fix asked again with Try again: it carries its task's incident or alert.
  function askedAgain(
    task: FakeRow,
    overrides: Partial<FakeRow> = {},
  ): FakeRow {
    return fixTask(
      {
        triggeredByIncidentId: task["triggeredByIncidentId"],
        triggeredByAlertId: task["triggeredByAlertId"],
      },
      {
        codeTaskId: new ObjectID(task._id),
        createdAt: daysAgo(3),
        ...overrides,
      },
    );
  }

  test("a reply's pull request of a fix of an incident the caller may not read is neither counted nor listed", async () => {
    const task: FakeRow = fixTask(aboutIncident(INCIDENT_PRIVATE), {
      status: AIRunStatus.Error,
    });
    const reply: FakeRow = replyTo(task);

    install(
      {
        incidents: [INCIDENT_A, INCIDENT_PRIVATE],
        alerts: [ALERT_A],
        runs: [task, reply],
        pullRequests: [pullRequest(FixProductionStatus.Regressed, reply)],
      },
      {},
      READABLE,
    );

    const outcomes: AiOutcomes = await readOutcomes();

    expect(outcomes.pullRequestFixes!.regressed).toBe(0);

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.PullRequestFixes,
      "regressed",
    );

    expect(records.total).toBe(0);
    expect(JSON.stringify(records)).not.toContain("Raise the checkout timeout");
  });

  test("a reply's pull request of a fix of an incident the caller may read is listed under that incident", async () => {
    const task: FakeRow = fixTask(aboutIncident(INCIDENT_A), {
      status: AIRunStatus.Error,
    });
    const reply: FakeRow = replyTo(task);

    install(
      {
        incidents: [INCIDENT_A, INCIDENT_PRIVATE],
        alerts: [ALERT_A],
        runs: [task, reply],
        pullRequests: [pullRequest(FixProductionStatus.Verified, reply)],
      },
      {},
      READABLE,
    );

    const outcomes: AiOutcomes = await readOutcomes();

    expect(outcomes.pullRequestFixes!.verified).toBe(1);

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.PullRequestFixes,
      "verified",
    );

    expect(records.records).toHaveLength(1);
    expect(records.records[0]).toMatchObject({
      subject: { kind: "incident", id: INCIDENT_A._id },
      pullRequestNumber: 42,
    });
  });

  test("a fix asked again is matched by when its task started, not when it was asked again", async () => {
    const task: FakeRow = fixTask(aboutIncident(INCIDENT_A), {
      status: AIRunStatus.Error,
      createdAt: daysAgo(10),
    });
    const again: FakeRow = askedAgain(task, { createdAt: daysAgo(4) });

    install({
      incidents: [INCIDENT_A],
      runs: [
        task,
        again,
        // The investigation the fix was written from, before its task started.
        investigation(aboutIncident(INCIDENT_A), MATCH, {
          modelName: "chat-large",
          createdAt: daysAgo(12),
        }),
        // A later one of the same incident, between the task and Try again.
        investigation(aboutIncident(INCIDENT_A), MISMATCH, {
          modelName: "chat-medium",
          createdAt: daysAgo(6),
        }),
      ],
      pullRequests: [
        pullRequest(FixProductionStatus.Verified, again, {
          createdAt: daysAgo(3),
        }),
      ],
    });

    const outcomes: AiOutcomes = await readOutcomes();

    expect(outcomes.pullRequestFixes!.verified).toBe(1);
    expect(outcomes.models!.fixes).toEqual([
      { modelName: "chat-large", value: 1, total: 1 },
    ]);
  });

  test("the first turns are read once, as root, by their ids - and only when a later turn opened a pull request", async () => {
    const task: FakeRow = fixTask(aboutIncident(INCIDENT_A), {
      status: AIRunStatus.Error,
      createdAt: daysAgo(10),
    });
    const again: FakeRow = askedAgain(task, { createdAt: daysAgo(5) });
    const reply: FakeRow = replyTo(task, { createdAt: daysAgo(4) });

    install({
      incidents: [INCIDENT_A],
      runs: [task, again, reply],
      pullRequests: [
        pullRequest(FixProductionStatus.Regressed, again),
        pullRequest(FixProductionStatus.Verified, reply),
      ],
    });

    await readOutcomes();

    const taskReads: Array<Call> = callsTo("runs").filter(
      (call: Call): boolean => {
        return call.query["runType"] === undefined;
      },
    );

    // The turns that opened the pull requests, then their task's first turn.
    expect(taskReads).toHaveLength(2);
    expect(matchesFilter(again._id, taskReads[0]!.query["_id"])).toBe(true);
    expect(matchesFilter(reply._id, taskReads[0]!.query["_id"])).toBe(true);
    expect(matchesFilter(task._id, taskReads[1]!.query["_id"])).toBe(true);
    expect(matchesFilter(again._id, taskReads[1]!.query["_id"])).toBe(false);
    expect(taskReads[1]!.limit).toBe(1);

    for (const call of taskReads) {
      expect(call.props).toEqual({ isRoot: true });
      expect(call.query["projectId"]).toEqual(PROJECT_ID);
    }
  });

  test("a later turn whose first turn is gone is read as itself", async () => {
    const task: FakeRow = fixTask(aboutIncident(INCIDENT_A));
    const reply: FakeRow = replyTo(task);

    install(
      {
        incidents: [INCIDENT_A],
        // The task's first turn is not there to read.
        runs: [reply],
        pullRequests: [pullRequest(FixProductionStatus.Verified, reply)],
      },
      {},
      READABLE,
    );

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.PullRequestFixes,
      "verified",
    );

    // A reply is no fix of anything: counted, about nothing, as before.
    expect(records.total).toBe(1);
    expect(records.records[0]!.subject).toBeUndefined();
  });
});

describe("OneUptime AI's verdicts on Data Security issues (#10369)", () => {
  test("counted from the issues it analyzed in the window, of this project, by what people decided", async () => {
    install(busyProject(), {}, READABLE);

    const outcomes: AiOutcomes = await readOutcomes();

    expect(outcomes.issueVerdicts).toEqual({
      agreed: 3,
      disagreed: 2,
      waiting: 1,
      cannotTell: 1,
      real: 3,
      likelyByDesign: 2,
      likelyWrongFinding: 1,
    });

    // Read under the caller's props, newest first, by when it was analyzed.
    const call: Call = callsTo("dataSecurityIssues")[0]!;

    expect(call.props).toBe(CALLER);
    expect(Object.keys(call.select).sort()).toEqual(
      [
        "_id",
        "aiAnalyzedAt",
        "aiVerdict",
        "dataStoreId",
        "status",
        "title",
      ].sort(),
    );
  });

  test("a verdict's number opens the issues it counts, by their titles, with the verdict and what people decided", async () => {
    install(busyProject(), {}, READABLE);

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.IssueVerdicts,
      "disagreed",
    );

    expect(records.total).toBe(2);
    expect(
      records.records.map((record: AiOutcomesRecord) => {
        return {
          // As every Data Security number's record names its issue (#10364).
          subject: record.subject,
          issueId: record.dataSecurityIssue?.id === record.id,
          verdict: record.issueVerdict,
          status: record.issueStatus,
        };
      }),
    ).toEqual(
      expect.arrayContaining([
        {
          subject: undefined,
          issueId: true,
          verdict: DataSecurityAiVerdict.Real,
          status: DataSecurityIssueStatus.NotAnIssue,
        },
        {
          subject: undefined,
          issueId: true,
          verdict: DataSecurityAiVerdict.LikelyByDesign,
          status: DataSecurityIssueStatus.Resolved,
        },
      ]),
    );
    expect(records.records[0]!.dataSecurityIssue?.title).toMatch(
      /^A bucket anyone can read/,
    );
  });

  test.each(["notAuthorized", "paymentRequired"] as Array<Access>)(
    "a caller whose role may not read Data Security issues (%s) gets no verdict numbers, not zeros, and opens none",
    async (access: Access) => {
      install(busyProject(), { dataSecurityIssues: access }, READABLE);

      const outcomes: AiOutcomes = await readOutcomes();

      expect(outcomes.issueVerdicts).toBeNull();
      // The rest of the page is counted as before.
      expect(outcomes.pages).not.toBeNull();
      await expect(
        readRecords(AiOutcomesPart.IssueVerdicts, "agreed"),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );
});

describe("leaks caught before they merged, against those found after (#10376)", () => {
  // A pull request's production review task, with the leaks it posted.
  function review(
    caughtLeaks: Array<Record<string, unknown>>,
    overrides: Partial<FakeRow> = {},
  ): FakeRow {
    return {
      _id: nextId(95),
      projectId: PROJECT_ID,
      createdAt: daysAgo(10),
      updatedAt: daysAgo(1),
      runType: AIRunType.CodeFix,
      codeFixTaskType: CodeFixTaskType.GitHubPullRequestProductionReview,
      status: AIRunStatus.Completed,
      title: "Log signups",
      taskContext: {
        github: {
          codeRepositoryId: uuid(96, 1),
          installationId: "4242",
          organizationName: "acme",
          repositoryName: "checkout",
          commandType: "ProductionReview",
          instruction: "",
          pullRequestNumber: 42,
        },
        productionReview: {
          requestNumber: 2,
          requestedAt: daysAgo(1).toISOString(),
          headSha: "0f1e2d3c4b5a",
          caughtLeaks,
        },
      },
      ...overrides,
    };
  }

  function leak(
    key: string,
    checkId: string,
    at: Date,
    fixedAt?: Date,
  ): Record<string, unknown> {
    return {
      key,
      kind: "Telemetry",
      checkId,
      isBlocking: false,
      at: at.toISOString(),
      ...(fixedAt ? { fixedAt: fixedAt.toISOString() } : {}),
    };
  }

  function foundIssue(
    checkId: string,
    firstDetectedAt: Date,
    overrides: Partial<FakeRow> = {},
  ): FakeRow {
    return {
      _id: nextId(97),
      projectId: PROJECT_ID,
      createdAt: firstDetectedAt,
      firstDetectedAt,
      checkId,
      title: "Sensitive data is reaching your telemetry",
      status: DataSecurityIssueStatus.Open,
      ...overrides,
    };
  }

  function leakyProject(): Partial<Tables> {
    return {
      codeRepositories: [
        { _id: uuid(96, 1), projectId: PROJECT_ID, createdAt: daysAgo(200) },
      ],
      runs: [
        review([
          leak("a1", "sensitive-data-in-telemetry", daysAgo(5), daysAgo(4)),
          leak("a2", "secrets-in-telemetry", daysAgo(5)),
          // Caught before the window: not counted.
          leak("a3", "public-read", daysAgo(120)),
        ]),
        review([], {
          title: "Add a password column",
          taskContext: {
            codeHostPullRequest: {
              codeRepositoryId: uuid(96, 2),
              provider: "GitLab",
              pullRequestNumber: 7,
              pullRequestUrl:
                "https://gitlab.com/acme/checkout/-/merge_requests/7",
            },
            productionReview: {
              requestNumber: 1,
              requestedAt: daysAgo(3).toISOString(),
              headSha: "9a8b7c",
              caughtLeaks: [
                leak("b1", "plaintext-passwords", daysAgo(3), daysAgo(2)),
              ],
            },
          },
        }),
        // Another project's review: not counted.
        review([leak("c1", "secrets-in-telemetry", daysAgo(2))], {
          projectId: OTHER_PROJECT_ID,
        }),
      ],
      dataSecurityIssues: [
        foundIssue("sensitive-data-in-telemetry", daysAgo(6)),
        foundIssue("public-read", daysAgo(20)),
        // A check no pull request's rules catch early: not a leak here.
        foundIssue("mfa-not-enforced", daysAgo(6)),
        // Found before the window: not counted.
        foundIssue("public-read", daysAgo(120)),
      ],
    };
  }

  test("counted from the reviews' caught leaks and the scans' issues of the window: fixed, open, found after", async () => {
    install(leakyProject(), {}, READABLE);

    const outcomes: AiOutcomes = await readOutcomes();

    expect(outcomes.leaks).toEqual({ fixed: 2, open: 1, foundAfter: 2 });
  });

  test("each part opens what it counts: a caught leak its pull request and check, a found one its issue", async () => {
    install(leakyProject(), {}, READABLE);

    const fixed: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.Leaks,
      "fixed",
    );

    expect(fixed.total).toBe(2);
    expect(
      fixed.records.map((record: AiOutcomesRecord) => {
        return {
          checkId: record.checkId,
          number: record.pullRequestNumber,
          title: record.pullRequestTitle,
          url: record.pullRequestUrl,
        };
      }),
    ).toEqual([
      {
        checkId: "plaintext-passwords",
        number: 7,
        title: "Add a password column",
        url: "https://gitlab.com/acme/checkout/-/merge_requests/7",
      },
      {
        checkId: "sensitive-data-in-telemetry",
        number: 42,
        title: "Log signups",
        url: undefined,
      },
    ]);

    const found: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.Leaks,
      "foundAfter",
    );

    expect(found.total).toBe(2);
    expect(
      found.records.map((record: AiOutcomesRecord) => {
        return {
          checkId: record.checkId,
          isItsIssue: record.dataSecurityIssue?.id === record.id,
          title: record.dataSecurityIssue?.title,
        };
      }),
    ).toEqual([
      {
        checkId: "sensitive-data-in-telemetry",
        isItsIssue: true,
        title: "Sensitive data is reaching your telemetry",
      },
      {
        checkId: "public-read",
        isItsIssue: true,
        title: "Sensitive data is reaching your telemetry",
      },
    ]);
  });

  test("the reviews are read as OneUptime; the repositories and the issues under the caller's props", async () => {
    install(leakyProject(), {}, READABLE);

    await readOutcomes();

    expect(
      callsTo("codeRepositories").map((call: Call): boolean => {
        return call.props === CALLER;
      }),
    ).toEqual([true]);
    expect(
      callsTo("dataSecurityIssues").every((call: Call): boolean => {
        return call.props === CALLER;
      }),
    ).toBe(true);
    expect(
      callsTo("runs").every((call: Call): boolean => {
        return Boolean(call.props.isRoot);
      }),
    ).toBe(true);
  });

  test.each([
    ["codeRepositories", "notAuthorized"],
    ["codeRepositories", "paymentRequired"],
    ["dataSecurityIssues", "notAuthorized"],
  ] as Array<[TableName, Access]>)(
    "a caller who may not read %s (%s) gets no leak numbers, not zeros, and opens none",
    async (table: TableName, access: Access) => {
      install(leakyProject(), { [table]: access }, READABLE);

      const outcomes: AiOutcomes = await readOutcomes();

      expect(outcomes.leaks).toBeNull();
      await expect(readRecords(AiOutcomesPart.Leaks, "fixed")).rejects.toThrow(
        NotAuthorizedException,
      );
    },
  );
});

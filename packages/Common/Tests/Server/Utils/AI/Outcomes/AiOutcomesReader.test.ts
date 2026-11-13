import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AlertService from "../../../../../Server/Services/AlertService";
import AutoRemediationSuggestionService from "../../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import OnCallDutyPolicyExecutionLogService from "../../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import AiOutcomesReader from "../../../../../Server/Utils/AI/Outcomes/AiOutcomesReader";
import AIRunAutoGrade from "../../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import {
  AI_OUTCOMES_SCAN_LIMIT,
  AiOutcomes,
  AiOutcomesWeek,
} from "../../../../../Types/AI/AiOutcomes";
import FixProductionStatus from "../../../../../Types/AI/FixProductionStatus";
import AutoRemediationVerificationStatus from "../../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
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

/*
 * AiOutcomesReader (issue #6800) against an in-memory copy of the six
 * tables behind the real services' findBy: what it reads, under whose
 * props, in which window - and that a kind the caller may not read is left
 * out (null), never zeros, and that work about an incident or alert the
 * caller may not read is never counted.
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
  | "alerts";

type Tables = Record<TableName, Array<FakeRow>>;

// How a caller's read of a table goes: it reads, or the permission layer or the plan stops it.
type Access = "read" | "notAuthorized" | "paymentRequired" | Error;

interface Call {
  table: TableName;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown> | undefined;
  limit: number;
  skip: number | undefined;
  props: DatabaseCommonInteractionProps;
}

interface Store {
  tables: Tables;
  access: Record<TableName, Access>;
  // The incidents and alerts the caller may read; every one when left out.
  readableIncidentIds?: Set<string> | undefined;
  readableAlertIds?: Set<string> | undefined;
  calls: Array<Call>;
}

function emptyTables(): Tables {
  return {
    pageLogs: [],
    suggestions: [],
    pullRequests: [],
    runs: [],
    incidents: [],
    alerts: [],
  };
}

function readsAll(): Record<TableName, Access> {
  return {
    pageLogs: "read",
    suggestions: "read",
    pullRequests: "read",
    runs: "read",
    incidents: "read",
    alerts: "read",
  };
}

let store: Store;

function install(
  tables: Partial<Tables>,
  access: Partial<Record<TableName, Access>> = {},
  readable: {
    incidentIds?: Array<string>;
    alertIds?: Array<string>;
  } = {},
): Store {
  store = {
    tables: { ...emptyTables(), ...tables },
    access: { ...readsAll(), ...access },
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
        const access: Access = store.access[table];

        if (table === "runs") {
          // An AI run is private to its author: the reader reads them as root.
          throw new NotAuthorizedException("Runs are read as root.");
        }

        if (access === "notAuthorized") {
          throw new NotAuthorizedException(
            `You do not have permission to read ${table}.`,
          );
        }

        if (access === "paymentRequired") {
          throw new PaymentRequiredException(
            `Your plan does not include ${table}.`,
          );
        }

        if (access instanceof Error) {
          throw access;
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
      } else if (store.access[table] instanceof Error) {
        throw store.access[table] as Error;
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

  return store;
}

function callsTo(table: TableName): Array<Call> {
  return store.calls.filter((call: Call): boolean => {
    return call.table === table;
  });
}

function onlyCallTo(table: TableName): Call {
  const calls: Array<Call> = callsTo(table);
  expect({ table, calls: calls.length }).toEqual({ table, calls: 1 });
  return calls[0]!;
}

function read(): Promise<AiOutcomes> {
  return AiOutcomesReader.read({
    projectId: PROJECT_ID,
    props: CALLER,
    now: NOW,
  });
}

// Rows -----------------------------------------------------------------

function incident(index: number, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: uuid(10, index),
    projectId: PROJECT_ID,
    createdAt: daysAgo(20),
    title: `Incident ${index}`,
    ...overrides,
  };
}

function alert(index: number, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: uuid(20, index),
    projectId: PROJECT_ID,
    createdAt: daysAgo(20),
    title: `Alert ${index}`,
    ...overrides,
  };
}

let rowCount: number = 0;

function nextId(group: number): string {
  rowCount++;
  return uuid(group, rowCount);
}

function pageLog(
  outcome: OnCallPolicyAiHoldOutcome | string | undefined,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  return {
    _id: nextId(30),
    projectId: PROJECT_ID,
    createdAt: daysAgo(3),
    aiHoldOutcome: outcome,
    ...overrides,
  };
}

function fix(
  status: AutoRemediationVerificationStatus | string | undefined,
  subject: Partial<FakeRow>,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  return {
    _id: nextId(40),
    projectId: PROJECT_ID,
    createdAt: daysAgo(3),
    verificationStatus: status,
    rationale: "Restart the payments worker.",
    ...subject,
    ...overrides,
  };
}

function pullRequest(
  status: FixProductionStatus | string | undefined,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  return {
    _id: nextId(50),
    projectId: PROJECT_ID,
    createdAt: daysAgo(3),
    productionStatus: status,
    title: "Fix the checkout timeout",
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
    createdAt: daysAgo(3),
    runType: AIRunType.Investigation,
    status: AIRunStatus.Completed,
    analysisTldr: "The database ran out of connections.",
    ...subject,
    ...judged,
    ...overrides,
  };
}

function onIncident(row: FakeRow): Partial<FakeRow> {
  return { incidentId: new ObjectID(row._id) };
}

function onAlert(row: FakeRow): Partial<FakeRow> {
  return { alertId: new ObjectID(row._id) };
}

function runOnIncident(row: FakeRow): Partial<FakeRow> {
  return { triggeredByIncidentId: new ObjectID(row._id) };
}

function runOnAlert(row: FakeRow): Partial<FakeRow> {
  return { triggeredByAlertId: new ObjectID(row._id) };
}

const CONFIRMED: Partial<FakeRow> = {
  humanVerdict: AIRunHumanVerdict.Confirmed,
};
const MATCH: Partial<FakeRow> = { autoGrade: AIRunAutoGrade.Match };
const MISMATCH: Partial<FakeRow> = { autoGrade: AIRunAutoGrade.Mismatch };

function weekly(
  outcomes: AiOutcomes,
  count: keyof Omit<AiOutcomesWeek, "weekStart">,
): number {
  return outcomes.weeks.reduce((sum: number, week: AiOutcomesWeek) => {
    return sum + week[count];
  }, 0);
}

beforeEach(() => {
  rowCount = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const INCIDENT_A: FakeRow = incident(1);
const INCIDENT_PRIVATE: FakeRow = incident(2);
const ALERT_A: FakeRow = alert(1);
const ALERT_PRIVATE: FakeRow = alert(2);

describe("what it reads, for whom, in which window", () => {
  beforeEach(() => {
    install({
      incidents: [INCIDENT_A],
      alerts: [ALERT_A],
      runs: [investigation(runOnIncident(INCIDENT_A), MATCH)],
      suggestions: [
        fix(AutoRemediationVerificationStatus.Verified, onAlert(ALERT_A)),
      ],
    });
  });

  test("held pages: the window's on-call runs with an AI hold, newest first, under the caller's props", async () => {
    await read();

    const call: Call = onlyCallTo("pageLogs");

    expect(call.props).toBe(CALLER);
    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(matchesFilter(WINDOW_START, call.query["createdAt"])).toBe(true);
    expect(
      matchesFilter(
        new Date(WINDOW_START.getTime() - 1),
        call.query["createdAt"],
      ),
    ).toBe(false);
    // Only runs with an AI hold: a run with none has no outcome.
    expect(matchesFilter(undefined, call.query["aiHoldOutcome"])).toBe(false);
    expect(
      matchesFilter(
        OnCallPolicyAiHoldOutcome.Holding,
        call.query["aiHoldOutcome"],
      ),
    ).toBe(true);
    expect(Object.keys(call.query).sort()).toEqual([
      "aiHoldOutcome",
      "createdAt",
      "projectId",
    ]);
    expect(call.select).toEqual({
      _id: true,
      createdAt: true,
      aiHoldOutcome: true,
    });
    expect(call.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(call.limit).toBe(AI_OUTCOMES_SCAN_LIMIT);
    expect(call.skip).toBe(0);
  });

  test("fixes AI ran: statuses, dates and what they were for - never a rationale or a command plan", async () => {
    await read();

    const call: Call = onlyCallTo("suggestions");

    expect(call.props).toBe(CALLER);
    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(matchesFilter(WINDOW_START, call.query["createdAt"])).toBe(true);
    expect(matchesFilter(undefined, call.query["verificationStatus"])).toBe(
      false,
    );
    expect(Object.keys(call.query).sort()).toEqual([
      "createdAt",
      "projectId",
      "verificationStatus",
    ]);
    expect(call.select).toEqual({
      _id: true,
      createdAt: true,
      verificationStatus: true,
      incidentId: true,
      alertId: true,
    });
    expect(call.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(call.limit).toBe(AI_OUTCOMES_SCAN_LIMIT);
  });

  test("fix pull requests: production statuses and dates, never a title or a summary", async () => {
    await read();

    const call: Call = onlyCallTo("pullRequests");

    expect(call.props).toBe(CALLER);
    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(matchesFilter(WINDOW_START, call.query["createdAt"])).toBe(true);
    expect(matchesFilter(undefined, call.query["productionStatus"])).toBe(
      false,
    );
    expect(Object.keys(call.query).sort()).toEqual([
      "createdAt",
      "productionStatus",
      "projectId",
    ]);
    expect(call.select).toEqual({
      _id: true,
      createdAt: true,
      productionStatus: true,
    });
    expect(call.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(call.limit).toBe(AI_OUTCOMES_SCAN_LIMIT);
  });

  test("investigations: read as root, completed ones of this project's window, grades and verdicts only", async () => {
    await read();

    const call: Call = onlyCallTo("runs");

    expect(call.props).toEqual({ isRoot: true });
    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(call.query["runType"]).toBe(AIRunType.Investigation);
    expect(call.query["status"]).toBe(AIRunStatus.Completed);
    expect(matchesFilter(WINDOW_START, call.query["createdAt"])).toBe(true);
    expect(Object.keys(call.query).sort()).toEqual([
      "createdAt",
      "projectId",
      "runType",
      "status",
    ]);
    expect(call.select).toEqual({
      _id: true,
      createdAt: true,
      autoGrade: true,
      humanVerdict: true,
      triggeredByIncidentId: true,
      triggeredByAlertId: true,
    });
    expect(call.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(call.limit).toBe(AI_OUTCOMES_SCAN_LIMIT);
  });

  test("incidents and alerts: only the ones the counted work was about, ids only, under the caller's props", async () => {
    await read();

    const incidents: Call = onlyCallTo("incidents");
    const alerts: Call = onlyCallTo("alerts");

    for (const [call, subject] of [
      [incidents, INCIDENT_A],
      [alerts, ALERT_A],
    ] as Array<[Call, FakeRow]>) {
      expect(call.props).toBe(CALLER);
      expect(call.query["projectId"]).toBe(PROJECT_ID);
      expect(matchesFilter(subject._id, call.query["_id"])).toBe(true);
      expect(matchesFilter(uuid(99, 1), call.query["_id"])).toBe(false);
      expect(call.select).toEqual({ _id: true });
      expect(call.limit).toBe(1);
      expect(call.skip).toBe(0);
    }
  });

  test("the caller's props are never root, whatever it reads under them", async () => {
    await read();

    for (const call of store.calls) {
      expect({ table: call.table, isRoot: Boolean(call.props.isRoot) }).toEqual(
        {
          table: call.table,
          isRoot: call.table === "runs",
        },
      );
    }
  });

  test("now, when left out, is the current time", async () => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ["nextTick", "queueMicrotask", "setImmediate"],
    });

    const outcomes: AiOutcomes = await AiOutcomesReader.read({
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(outcomes.windowStart).toBe(WINDOW_START.toISOString());
    expect(outcomes.windowEnd).toBe(NOW.toISOString());
    expect(
      matchesFilter(WINDOW_START, onlyCallTo("pageLogs").query["createdAt"]),
    ).toBe(true);
  });
});

describe("what it counts", () => {
  test("every kind, in the window, of this project only", async () => {
    install({
      incidents: [INCIDENT_A],
      alerts: [ALERT_A],
      pageLogs: [
        pageLog(OnCallPolicyAiHoldOutcome.ResolvedByAI),
        pageLog(OnCallPolicyAiHoldOutcome.ResolvedByAI, {
          createdAt: WINDOW_START,
        }),
        pageLog(OnCallPolicyAiHoldOutcome.HandedOff),
        pageLog(OnCallPolicyAiHoldOutcome.Holding),
        // A run with no AI hold.
        pageLog(undefined),
        // Before the window.
        pageLog(OnCallPolicyAiHoldOutcome.ResolvedByAI, {
          createdAt: new Date(WINDOW_START.getTime() - 1),
        }),
        // Another project's.
        pageLog(OnCallPolicyAiHoldOutcome.ResolvedByAI, {
          projectId: OTHER_PROJECT_ID,
        }),
      ],
      suggestions: [
        fix(AutoRemediationVerificationStatus.Verified, onIncident(INCIDENT_A)),
        fix(AutoRemediationVerificationStatus.Failed, onAlert(ALERT_A)),
        fix(AutoRemediationVerificationStatus.Pending, onAlert(ALERT_A)),
        // Never checked: no verification status at all.
        fix(undefined, onAlert(ALERT_A)),
        fix(AutoRemediationVerificationStatus.Verified, onAlert(ALERT_A), {
          projectId: OTHER_PROJECT_ID,
        }),
      ],
      pullRequests: [
        pullRequest(FixProductionStatus.Verified),
        pullRequest(FixProductionStatus.Regressed),
        pullRequest(FixProductionStatus.Watching),
        pullRequest(undefined),
        pullRequest(FixProductionStatus.Verified, { createdAt: daysAgo(90) }),
      ],
      runs: [
        investigation(runOnIncident(INCIDENT_A), CONFIRMED),
        investigation(runOnAlert(ALERT_A), MISMATCH),
        investigation(runOnAlert(ALERT_A)),
        // Not finished.
        investigation(runOnAlert(ALERT_A), MATCH, {
          status: AIRunStatus.Running,
        }),
        // Not an investigation.
        investigation(runOnAlert(ALERT_A), MATCH, { runType: "Chat" }),
        investigation(runOnIncident(INCIDENT_A), MATCH, {
          projectId: OTHER_PROJECT_ID,
        }),
      ],
    });

    const outcomes: AiOutcomes = await read();

    expect(outcomes.pages).toEqual({
      resolvedByAi: 2,
      recoveredOnItsOwn: 0,
      handledByPerson: 0,
      handedOff: 1,
      holdTimeRanOut: 0,
      pageNowPressed: 0,
      holding: 1,
    });
    expect(outcomes.remediationFixes).toEqual({
      verified: 1,
      failed: 1,
      pending: 1,
      skipped: 0,
    });
    expect(outcomes.pullRequestFixes).toEqual({
      verified: 1,
      regressed: 1,
      watching: 1,
      awaitingDeploy: 0,
      unverifiable: 0,
    });
    expect(outcomes.rootCauses).toEqual({
      confirmed: 1,
      partial: 0,
      wrong: 1,
      judgedByPeople: 1,
      completed: 3,
    });
    expect(outcomes.isPartial).toBe(false);
    expect(outcomes.windowStart).toBe(WINDOW_START.toISOString());
    expect(outcomes.windowEnd).toBe(NOW.toISOString());
    // The weeks count the same work.
    expect(weekly(outcomes, "pagesAvoided")).toBe(2);
    expect(weekly(outcomes, "pagesHeld")).toBe(3);
    expect(weekly(outcomes, "fixesVerified")).toBe(2);
    expect(weekly(outcomes, "fixesChecked")).toBe(4);
    expect(weekly(outcomes, "rootCausesConfirmed")).toBe(1);
    expect(weekly(outcomes, "rootCausesJudged")).toBe(2);
  });

  test("only counts leave it: no id, title, rationale or finding", async () => {
    install({
      incidents: [INCIDENT_A],
      alerts: [ALERT_A],
      pageLogs: [pageLog(OnCallPolicyAiHoldOutcome.ResolvedByAI)],
      suggestions: [
        fix(AutoRemediationVerificationStatus.Verified, onIncident(INCIDENT_A)),
      ],
      pullRequests: [pullRequest(FixProductionStatus.Verified)],
      runs: [investigation(runOnAlert(ALERT_A), CONFIRMED)],
    });

    const text: string = JSON.stringify(await read());

    for (const secret of [
      INCIDENT_A._id,
      ALERT_A._id,
      PROJECT_ID.toString(),
      "Incident 1",
      "Restart the payments worker.",
      "Fix the checkout timeout",
      "The database ran out of connections.",
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("a kind the caller may not read is left out, not zeros", () => {
  test.each([
    ["pageLogs", "notAuthorized", "pages"],
    ["pageLogs", "paymentRequired", "pages"],
    ["suggestions", "notAuthorized", "remediationFixes"],
    ["suggestions", "paymentRequired", "remediationFixes"],
    ["pullRequests", "notAuthorized", "pullRequestFixes"],
    ["pullRequests", "paymentRequired", "pullRequestFixes"],
  ] as Array<[TableName, Access, keyof AiOutcomes]>)(
    "%s stopped (%s): %s null, the rest counted",
    async (table: TableName, access: Access, part: keyof AiOutcomes) => {
      install(
        {
          incidents: [INCIDENT_A],
          alerts: [ALERT_A],
          pageLogs: [pageLog(OnCallPolicyAiHoldOutcome.ResolvedByAI)],
          suggestions: [
            fix(
              AutoRemediationVerificationStatus.Verified,
              onIncident(INCIDENT_A),
            ),
          ],
          pullRequests: [pullRequest(FixProductionStatus.Verified)],
          runs: [investigation(runOnAlert(ALERT_A), CONFIRMED)],
        },
        { [table]: access },
      );

      const outcomes: AiOutcomes = await read();

      for (const other of [
        "pages",
        "remediationFixes",
        "pullRequestFixes",
        "rootCauses",
      ] as Array<keyof AiOutcomes>) {
        expect({ other, isNull: outcomes[other] === null }).toEqual({
          other,
          isNull: other === part,
        });
      }

      // Nothing of the stopped kind reaches the weeks either.
      if (part === "pages") {
        expect(weekly(outcomes, "pagesHeld")).toBe(0);
      } else {
        expect(weekly(outcomes, "fixesVerified")).toBe(1);
      }
    },
  );

  test("every kind stopped: every part null, twelve empty weeks", async () => {
    install(
      {
        incidents: [INCIDENT_A],
        alerts: [ALERT_A],
        pageLogs: [pageLog(OnCallPolicyAiHoldOutcome.ResolvedByAI)],
        suggestions: [
          fix(
            AutoRemediationVerificationStatus.Verified,
            onIncident(INCIDENT_A),
          ),
        ],
        pullRequests: [pullRequest(FixProductionStatus.Verified)],
        runs: [investigation(runOnIncident(INCIDENT_A), CONFIRMED)],
      },
      {
        pageLogs: "notAuthorized",
        suggestions: "paymentRequired",
        pullRequests: "paymentRequired",
        incidents: "notAuthorized",
        alerts: "notAuthorized",
      },
    );

    const outcomes: AiOutcomes = await read();

    expect(outcomes.pages).toBeNull();
    expect(outcomes.remediationFixes).toBeNull();
    expect(outcomes.pullRequestFixes).toBeNull();
    expect(outcomes.rootCauses).toBeNull();
    expect(outcomes.weeks).toHaveLength(12);
    expect(weekly(outcomes, "rootCausesJudged")).toBe(0);
    expect(weekly(outcomes, "fixesChecked")).toBe(0);
  });

  test("neither incidents nor alerts readable: no root causes and no fixes AI ran, though the fixes were readable", async () => {
    install(
      {
        incidents: [INCIDENT_A],
        alerts: [ALERT_A],
        pageLogs: [pageLog(OnCallPolicyAiHoldOutcome.ResolvedByAI)],
        suggestions: [
          fix(
            AutoRemediationVerificationStatus.Verified,
            onIncident(INCIDENT_A),
          ),
          fix(AutoRemediationVerificationStatus.Verified, onAlert(ALERT_A)),
        ],
        pullRequests: [pullRequest(FixProductionStatus.Verified)],
        runs: [
          investigation(runOnIncident(INCIDENT_A), CONFIRMED),
          investigation(runOnAlert(ALERT_A), MATCH),
        ],
      },
      { incidents: "notAuthorized", alerts: "paymentRequired" },
    );

    const outcomes: AiOutcomes = await read();

    expect(outcomes.rootCauses).toBeNull();
    expect(outcomes.remediationFixes).toBeNull();
    // Held pages and fix pull requests are about neither.
    expect(outcomes.pages!.resolvedByAi).toBe(1);
    expect(outcomes.pullRequestFixes!.verified).toBe(1);
    expect(weekly(outcomes, "fixesVerified")).toBe(1);
    expect(weekly(outcomes, "rootCausesJudged")).toBe(0);
  });

  test("incidents readable, alerts not: the work about incidents counts, the work about alerts does not", async () => {
    install(
      {
        incidents: [INCIDENT_A],
        alerts: [ALERT_A],
        suggestions: [
          fix(
            AutoRemediationVerificationStatus.Verified,
            onIncident(INCIDENT_A),
          ),
          fix(AutoRemediationVerificationStatus.Failed, onAlert(ALERT_A)),
        ],
        runs: [
          investigation(runOnIncident(INCIDENT_A), CONFIRMED),
          investigation(runOnAlert(ALERT_A), MATCH),
          investigation(runOnAlert(ALERT_A)),
        ],
      },
      { alerts: "notAuthorized" },
    );

    const outcomes: AiOutcomes = await read();

    expect(outcomes.remediationFixes).toEqual({
      verified: 1,
      failed: 0,
      pending: 0,
      skipped: 0,
    });
    expect(outcomes.rootCauses).toEqual({
      confirmed: 1,
      partial: 0,
      wrong: 0,
      judgedByPeople: 1,
      completed: 1,
    });
  });

  test("alerts readable, incidents not: the work about alerts counts, the work about incidents does not", async () => {
    install(
      {
        incidents: [INCIDENT_A],
        alerts: [ALERT_A],
        suggestions: [
          fix(
            AutoRemediationVerificationStatus.Verified,
            onIncident(INCIDENT_A),
          ),
          fix(AutoRemediationVerificationStatus.Failed, onAlert(ALERT_A)),
        ],
        runs: [
          investigation(runOnIncident(INCIDENT_A), CONFIRMED),
          investigation(runOnAlert(ALERT_A), MISMATCH),
        ],
      },
      { incidents: "paymentRequired" },
    );

    const outcomes: AiOutcomes = await read();

    expect(outcomes.remediationFixes).toEqual({
      verified: 0,
      failed: 1,
      pending: 0,
      skipped: 0,
    });
    expect(outcomes.rootCauses).toEqual({
      confirmed: 0,
      partial: 0,
      wrong: 1,
      judgedByPeople: 0,
      completed: 1,
    });
  });
});

describe("any other failure is not swallowed", () => {
  test.each([
    "pageLogs",
    "suggestions",
    "pullRequests",
    "incidents",
    "alerts",
  ] as Array<TableName>)(
    "a failed read of %s fails the whole read",
    async (table: TableName) => {
      install(
        {
          incidents: [INCIDENT_A],
          alerts: [ALERT_A],
          runs: [investigation(runOnIncident(INCIDENT_A), CONFIRMED)],
        },
        { [table]: new Error(`The ${table} table is gone.`) },
      );

      await expect(read()).rejects.toThrow(`The ${table} table is gone.`);
    },
  );

  test("a failed read of the investigations fails the whole read: there is no permission to be stopped by", async () => {
    install({}, { runs: new Error("The runs table is gone.") });

    await expect(read()).rejects.toThrow("The runs table is gone.");
  });

  test("even a permission error from the investigations' root read is not taken for a missing permission", async () => {
    install({});
    jest
      .spyOn(AIRunService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("Not root after all."));

    await expect(read()).rejects.toThrow("Not root after all.");
  });
});

describe("work about an incident or alert the caller may not read is never counted", () => {
  test("a fix or an investigation about a private incident or a hidden alert is dropped", async () => {
    install(
      {
        incidents: [INCIDENT_A, INCIDENT_PRIVATE],
        alerts: [ALERT_A, ALERT_PRIVATE],
        suggestions: [
          fix(
            AutoRemediationVerificationStatus.Verified,
            onIncident(INCIDENT_A),
          ),
          fix(
            AutoRemediationVerificationStatus.Verified,
            onIncident(INCIDENT_PRIVATE),
          ),
          fix(AutoRemediationVerificationStatus.Failed, onAlert(ALERT_A)),
          fix(AutoRemediationVerificationStatus.Failed, onAlert(ALERT_PRIVATE)),
        ],
        runs: [
          investigation(runOnIncident(INCIDENT_A), CONFIRMED),
          investigation(runOnIncident(INCIDENT_PRIVATE), CONFIRMED),
          investigation(runOnAlert(ALERT_A), MISMATCH),
          investigation(runOnAlert(ALERT_PRIVATE), MISMATCH),
          investigation(runOnAlert(ALERT_PRIVATE)),
        ],
      },
      {},
      { incidentIds: [INCIDENT_A._id], alertIds: [ALERT_A._id] },
    );

    const outcomes: AiOutcomes = await read();

    expect(outcomes.remediationFixes).toEqual({
      verified: 1,
      failed: 1,
      pending: 0,
      skipped: 0,
    });
    expect(outcomes.rootCauses).toEqual({
      confirmed: 1,
      partial: 0,
      wrong: 1,
      judgedByPeople: 1,
      completed: 2,
    });
    expect(weekly(outcomes, "fixesChecked")).toBe(2);
    expect(weekly(outcomes, "rootCausesJudged")).toBe(2);
  });

  test("a fix or an investigation about neither an incident nor an alert is dropped", async () => {
    install({
      incidents: [INCIDENT_A],
      alerts: [ALERT_A],
      suggestions: [fix(AutoRemediationVerificationStatus.Verified, {})],
      runs: [investigation({}, CONFIRMED)],
    });

    const outcomes: AiOutcomes = await read();

    expect(outcomes.remediationFixes!.verified).toBe(0);
    expect(outcomes.rootCauses!.completed).toBe(0);
  });

  test("an incident or alert the caller may read that the work was not about counts nothing", async () => {
    install(
      {
        incidents: [INCIDENT_A, INCIDENT_PRIVATE],
        alerts: [ALERT_A],
        runs: [investigation(runOnIncident(INCIDENT_PRIVATE), CONFIRMED)],
      },
      {},
      { incidentIds: [INCIDENT_A._id] },
    );

    const outcomes: AiOutcomes = await read();

    expect(outcomes.rootCauses!.completed).toBe(0);
    // It asked about the private one only, and was told nothing.
    expect(
      matchesFilter(INCIDENT_PRIVATE._id, onlyCallTo("incidents").query["_id"]),
    ).toBe(true);
    expect(
      matchesFilter(INCIDENT_A._id, onlyCallTo("incidents").query["_id"]),
    ).toBe(false);
  });

  test.each([
    ["the incident readable, the alert not", [INCIDENT_A._id], [], 1],
    ["the alert readable, the incident not", [], [ALERT_A._id], 0],
    ["both readable", [INCIDENT_A._id], [ALERT_A._id], 1],
  ] as Array<[string, Array<string>, Array<string>, number]>)(
    "work that names an incident and an alert is about the incident: %s",
    async (
      _name: string,
      incidentIds: Array<string>,
      alertIds: Array<string>,
      counted: number,
    ) => {
      install(
        {
          incidents: [INCIDENT_A],
          alerts: [ALERT_A],
          suggestions: [
            fix(AutoRemediationVerificationStatus.Verified, {
              ...onIncident(INCIDENT_A),
              ...onAlert(ALERT_A),
            }),
          ],
          runs: [
            investigation(
              { ...runOnIncident(INCIDENT_A), ...runOnAlert(ALERT_A) },
              CONFIRMED,
            ),
          ],
        },
        {},
        { incidentIds, alertIds },
      );

      const outcomes: AiOutcomes = await read();

      expect(outcomes.remediationFixes!.verified).toBe(counted);
      expect(outcomes.rootCauses!.confirmed).toBe(counted);
      expect(outcomes.rootCauses!.completed).toBe(counted);
      // It never looked the alert up: the incident decides.
      expect(onlyCallTo("alerts").query["_id"]).toBeUndefined();
    },
  );

  test("each incident and alert is looked up once, however much work was about it", async () => {
    const incidents: Array<FakeRow> = [1, 2, 3].map((index: number) => {
      return incident(10 + index);
    });

    install({
      incidents,
      alerts: [ALERT_A],
      suggestions: [
        fix(
          AutoRemediationVerificationStatus.Verified,
          onIncident(incidents[0]!),
        ),
        fix(
          AutoRemediationVerificationStatus.Failed,
          onIncident(incidents[0]!),
        ),
        fix(
          AutoRemediationVerificationStatus.Pending,
          onIncident(incidents[1]!),
        ),
      ],
      runs: [
        investigation(runOnIncident(incidents[1]!), MATCH),
        investigation(runOnIncident(incidents[2]!), MATCH),
        investigation(runOnIncident(incidents[2]!), MISMATCH),
      ],
    });

    const outcomes: AiOutcomes = await read();
    const lookup: Call = onlyCallTo("incidents");

    expect(lookup.limit).toBe(3);
    for (const row of incidents) {
      expect(matchesFilter(row._id, lookup.query["_id"])).toBe(true);
    }
    // No work was about an alert: one row tells whether alerts are readable at all.
    expect(onlyCallTo("alerts").query["_id"]).toBeUndefined();
    expect(onlyCallTo("alerts").limit).toBe(1);
    expect(outcomes.remediationFixes).toEqual({
      verified: 1,
      failed: 1,
      pending: 1,
      skipped: 0,
    });
    expect(outcomes.rootCauses!.completed).toBe(3);
  });

  test("with no work about incidents or alerts, each kind is still asked about once, so the parts are zeros rather than left out", async () => {
    install({ incidents: [INCIDENT_A], alerts: [] });

    const outcomes: AiOutcomes = await read();

    for (const table of ["incidents", "alerts"] as Array<TableName>) {
      const call: Call = onlyCallTo(table);
      expect(call.query).toEqual({ projectId: PROJECT_ID });
      expect(call.limit).toBe(1);
      expect(call.props).toBe(CALLER);
    }
    expect(outcomes.remediationFixes).toEqual({
      verified: 0,
      failed: 0,
      pending: 0,
      skipped: 0,
    });
    expect(outcomes.rootCauses).toEqual({
      confirmed: 0,
      partial: 0,
      wrong: 0,
      judgedByPeople: 0,
      completed: 0,
    });
  });

  test("a fix with no verification status is never asked about: the read skips it", async () => {
    install({
      incidents: [INCIDENT_A],
      alerts: [ALERT_A],
      suggestions: [fix(undefined, onIncident(INCIDENT_A))],
    });

    await read();

    // The fix read only returns checked fixes, so the incident was not looked up.
    expect(onlyCallTo("incidents").query["_id"]).toBeUndefined();
  });
});

describe("the newest rows of each kind, up to the scan limit", () => {
  function many(
    make: (index: number) => FakeRow,
    count: number,
  ): Array<FakeRow> {
    return Array.from({ length: count }, (_value: unknown, index: number) => {
      return make(index);
    });
  }

  test.each([
    [
      "held pages",
      (count: number): Partial<Tables> => {
        return {
          pageLogs: many((index: number) => {
            return pageLog(OnCallPolicyAiHoldOutcome.HandedOff, {
              createdAt: new Date(NOW.getTime() - index * 1000),
            });
          }, count),
        };
      },
      AI_OUTCOMES_SCAN_LIMIT,
    ],
    [
      "fixes AI ran",
      (count: number): Partial<Tables> => {
        return {
          suggestions: many((index: number) => {
            return fix(
              AutoRemediationVerificationStatus.Failed,
              onIncident(INCIDENT_A),
              { createdAt: new Date(NOW.getTime() - index * 1000) },
            );
          }, count),
        };
      },
      AI_OUTCOMES_SCAN_LIMIT,
    ],
    [
      "fix pull requests",
      (count: number): Partial<Tables> => {
        return {
          pullRequests: many((index: number) => {
            return pullRequest(FixProductionStatus.Regressed, {
              createdAt: new Date(NOW.getTime() - index * 1000),
            });
          }, count),
        };
      },
      AI_OUTCOMES_SCAN_LIMIT,
    ],
    [
      // Read as root: partial on what was read, before any is dropped.
      "investigations, though none is about anything the caller may read",
      (count: number): Partial<Tables> => {
        return {
          runs: many((index: number) => {
            return investigation(runOnIncident(INCIDENT_PRIVATE), MATCH, {
              createdAt: new Date(NOW.getTime() - index * 1000),
            });
          }, count),
        };
      },
      0,
    ],
  ] as Array<[string, (count: number) => Partial<Tables>, number]>)(
    "%s: partial at the limit, whole one row short of it",
    async (
      _name: string,
      rows: (count: number) => Partial<Tables>,
      counted: number,
    ) => {
      const installRows: (count: number) => void = (count: number): void => {
        install(
          { incidents: [INCIDENT_A, INCIDENT_PRIVATE], ...rows(count) },
          {},
          { incidentIds: [INCIDENT_A._id] },
        );
      };

      installRows(AI_OUTCOMES_SCAN_LIMIT - 1);
      expect((await read()).isPartial).toBe(false);

      jest.restoreAllMocks();
      installRows(AI_OUTCOMES_SCAN_LIMIT + 3);
      const outcomes: AiOutcomes = await read();

      expect(outcomes.isPartial).toBe(true);
      // The limit's worth were counted, never more.
      expect(
        weekly(outcomes, "pagesHeld") + weekly(outcomes, "fixesChecked"),
      ).toBe(counted);
    },
  );

  test("the limit's newest rows are the ones counted", async () => {
    install({
      pullRequests: [
        ...Array.from(
          { length: AI_OUTCOMES_SCAN_LIMIT },
          (_value: unknown, index: number) => {
            return pullRequest(FixProductionStatus.Verified, {
              createdAt: new Date(NOW.getTime() - (index + 1) * 1000),
            });
          },
        ),
        // Older than all of them: past the limit.
        pullRequest(FixProductionStatus.Regressed, { createdAt: daysAgo(30) }),
      ],
    });

    const outcomes: AiOutcomes = await read();

    expect(outcomes.isPartial).toBe(true);
    expect(outcomes.pullRequestFixes!.verified).toBe(AI_OUTCOMES_SCAN_LIMIT);
    expect(outcomes.pullRequestFixes!.regressed).toBe(0);
  });

  test("a kind the caller may not read is never what makes it partial", async () => {
    install(
      {
        pageLogs: Array.from(
          { length: AI_OUTCOMES_SCAN_LIMIT },
          (_value: unknown, index: number) => {
            return pageLog(OnCallPolicyAiHoldOutcome.HandedOff, {
              createdAt: new Date(NOW.getTime() - (index + 1) * 1000),
            });
          },
        ),
      },
      { pageLogs: "notAuthorized" },
    );

    const outcomes: AiOutcomes = await read();

    expect(outcomes.pages).toBeNull();
    expect(outcomes.isPartial).toBe(false);
  });
});

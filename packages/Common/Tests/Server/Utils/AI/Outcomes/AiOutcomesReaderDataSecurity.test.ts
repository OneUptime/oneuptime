import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AlertService from "../../../../../Server/Services/AlertService";
import AutoRemediationSuggestionService from "../../../../../Server/Services/AutoRemediationSuggestionService";
import DataSecurityAiDecisionService from "../../../../../Server/Services/DataSecurityAiDecisionService";
import DataSecurityAiProposalService from "../../../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import LlmLogService from "../../../../../Server/Services/LlmLogService";
import OnCallDutyPolicyExecutionLogService from "../../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import AiOutcomesReader from "../../../../../Server/Utils/AI/Outcomes/AiOutcomesReader";
import {
  AI_OUTCOMES_DATA_SECURITY_PARTS,
  AI_OUTCOMES_PART_OUTCOMES,
  AI_OUTCOMES_SCAN_LIMIT,
  AiOutcomes,
  AiOutcomesPart,
  AiOutcomesRecord,
  AiOutcomesRecords,
  AiOutcomesWeek,
} from "../../../../../Types/AI/AiOutcomes";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import {
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../../Types/ObjectID";
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
 * AiOutcomesReader's Data Security part (#10364), against an in-memory copy
 * of the tables behind the services' findBy: OneUptime AI's proposals, the
 * records of each time it worked on an issue, and the issues themselves.
 *
 * They are read under the caller's own props, which the permission layer
 * narrows to the issues the caller may read (stood in for here by the
 * readable issues); a proposal counts in the week it settled, each by its
 * own date; a caller who may not read the proposals gets no Data Security
 * numbers (null), never zeros; and every number opens exactly what it
 * counts, each record the issue it was about.
 */

const PROJECT_ID: ObjectID = new ObjectID(uuid(1, 1));
const OTHER_PROJECT_ID: ObjectID = new ObjectID(uuid(1, 2));

const NOW: Date = new Date("2026-11-13T15:00:00.000Z");
const WINDOW_START: Date = new Date("2026-08-22T00:00:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;
const MINUTE: number = 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID(uuid(2, 1)),
  isMultiTenantRequest: false,
};

const APPROVER_ID: ObjectID = new ObjectID(uuid(2, 2));

type TableName =
  | "pageLogs"
  | "suggestions"
  | "pullRequests"
  | "runs"
  | "incidents"
  | "alerts"
  | "llmLogs"
  | "proposals"
  | "decisions"
  | "issues";

type Tables = Record<TableName, Array<FakeRow>>;

type Access = "read" | "notAuthorized" | "paymentRequired";

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
  /*
   * The Data Security issues the caller may read (its labels, its store):
   * the permission layer reads their proposals and records only. Every one
   * when left out.
   */
  readableIssueIds?: Set<string> | undefined;
  calls: Array<Call>;
}

let store: Store;

function install(
  tables: Partial<Tables>,
  access: Partial<Record<TableName, Access>> = {},
  readableIssueIds?: Array<string> | undefined,
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
      proposals: [],
      decisions: [],
      issues: [],
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
      proposals: "read",
      decisions: "read",
      issues: "read",
      ...access,
    },
    readableIssueIds: readableIssueIds ? new Set(readableIssueIds) : undefined,
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

        // The issues the caller may read, and what is read through them.
        const readable: Set<string> | undefined = store.readableIssueIds;

        if (readable && table === "issues") {
          rows = rows.filter((row: FakeRow): boolean => {
            return readable.has(row._id);
          });
        }

        if (readable && (table === "proposals" || table === "decisions")) {
          rows = rows.filter((row: FakeRow): boolean => {
            return readable.has(String(row["dataSecurityIssueId"]));
          });
        }
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
    .mockImplementation(find("proposals") as never);
  jest
    .spyOn(DataSecurityAiDecisionService, "findBy")
    .mockImplementation(find("decisions") as never);
  jest
    .spyOn(DataSecurityIssueService, "findBy")
    .mockImplementation(find("issues") as never);

  return store;
}

function callsTo(table: TableName): Array<Call> {
  return store.calls.filter((call: Call): boolean => {
    return call.table === table;
  });
}

/*
 * The reads of the issues a change was proven for. OneUptime AI's verdicts
 * (#10369) read the issues it analyzed on their own, with their verdicts:
 * AiOutcomesReaderRecords.test's.
 */
function provenIssueReads(): Array<Call> {
  return callsTo("issues").filter((call: Call): boolean => {
    return !("aiVerdict" in call.select);
  });
}

function read(): Promise<AiOutcomes> {
  return AiOutcomesReader.read({
    projectId: PROJECT_ID,
    props: CALLER,
    now: NOW,
  });
}

function readRecords(
  part: AiOutcomesPart,
  outcome: string,
  options: { windowEnd?: Date; skip?: number } = {},
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

// Rows -----------------------------------------------------------------

let rowCount: number = 0;

function nextId(group: number): string {
  rowCount++;
  return uuid(group, rowCount);
}

function issue(index: number, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: uuid(70, index),
    projectId: PROJECT_ID,
    createdAt: daysAgo(60),
    title: `Secrets in telemetry ${index}`,
    firstDetectedAt: daysAgo(10),
    ...overrides,
  };
}

const ISSUE_A: FakeRow = issue(1);
const ISSUE_B: FakeRow = issue(2, { firstDetectedAt: daysAgo(6) });
const ISSUE_HIDDEN: FakeRow = issue(3, { title: "Customer emails in logs" });

function onIssue(row: FakeRow): Partial<FakeRow> {
  return { dataSecurityIssueId: new ObjectID(row._id) };
}

/*
 * A proposal of OneUptime AI's for ISSUE_A unless it says otherwise,
 * proposed a few days before it settled.
 */
function proposal(
  status: DataSecurityAiProposalStatus | string,
  settled: Partial<FakeRow>,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  return {
    _id: nextId(80),
    projectId: PROJECT_ID,
    createdAt: daysAgo(30),
    status,
    kind: DataSecurityAiProposalKind.ScrubTelemetry,
    title: "Scrub Email Address in body of checkout-logs",
    ...onIssue(ISSUE_A),
    ...settled,
    ...overrides,
  };
}

function made(at: Date, verifiedAt?: Date): Partial<FakeRow> {
  return { appliedAt: at, ...(verifiedAt ? { verifiedAt } : {}) };
}

function decision(at: Date, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: nextId(90),
    projectId: PROJECT_ID,
    createdAt: at,
    didAnalyze: true,
    ...onIssue(ISSUE_A),
    ...overrides,
  };
}

function weekly(
  outcomes: AiOutcomes,
  count: "dataSecurityChangesProven" | "dataSecurityChangesMade",
): number {
  return outcomes.weeks.reduce((sum: number, week: AiOutcomesWeek) => {
    return sum + week[count];
  }, 0);
}

/*
 * A busy project: on ISSUE_A a change made without asking and proven 4
 * hours after the issue opened... (from its firstDetectedAt, 10 days ago),
 * one approved and still waiting for the check, one undone and one that
 * could not be made; on ISSUE_B one approved and proven; a dismissal; and
 * what is not counted - a proposal still waiting, one no longer needed,
 * another project's and one made before the window.
 */
function busyProject(): Partial<Tables> {
  return {
    issues: [ISSUE_A, ISSUE_B, ISSUE_HIDDEN],
    proposals: [
      proposal(
        DataSecurityAiProposalStatus.AppliedWithoutAsking,
        made(daysAgo(10), new Date(daysAgo(10).getTime() + 4 * 60 * MINUTE)),
        { createdAt: daysAgo(10) },
      ),
      proposal(DataSecurityAiProposalStatus.Applied, made(daysAgo(8)), {
        approvedByUserId: APPROVER_ID,
      }),
      proposal(DataSecurityAiProposalStatus.Undone, made(daysAgo(7)), {
        undoneAt: daysAgo(6),
      }),
      proposal(DataSecurityAiProposalStatus.Failed, { failedAt: daysAgo(5) }),
      proposal(
        DataSecurityAiProposalStatus.Applied,
        made(daysAgo(5), new Date(daysAgo(6).getTime() + 6 * 60 * MINUTE)),
        { approvedByUserId: APPROVER_ID, ...onIssue(ISSUE_B) },
      ),
      proposal(DataSecurityAiProposalStatus.Dismissed, {
        dismissedAt: daysAgo(4),
        dismissReason: "We fix it in code.",
      }),
      proposal(DataSecurityAiProposalStatus.Dismissed, {
        dismissedAt: daysAgo(3),
        ...onIssue(ISSUE_HIDDEN),
      }),
      // Not counted: waiting for a person, no longer needed.
      proposal(DataSecurityAiProposalStatus.Proposed, {}),
      proposal(DataSecurityAiProposalStatus.Expired, {
        expiredAt: daysAgo(2),
      }),
      // Not counted: another project's, and one made before the window.
      proposal(
        DataSecurityAiProposalStatus.AppliedWithoutAsking,
        made(daysAgo(2)),
        {
          projectId: OTHER_PROJECT_ID,
        },
      ),
      proposal(
        DataSecurityAiProposalStatus.AppliedWithoutAsking,
        made(new Date(WINDOW_START.getTime() - 1)),
      ),
    ],
    decisions: [
      decision(daysAgo(10)),
      // Analyzed again after it reopened: still one issue.
      decision(daysAgo(3)),
      decision(daysAgo(6), onIssue(ISSUE_B)),
      decision(daysAgo(3), onIssue(ISSUE_HIDDEN)),
      // An evaluation that did not analyze, and one before the window.
      decision(daysAgo(2), { didAnalyze: false, ...onIssue(ISSUE_HIDDEN) }),
      decision(new Date(WINDOW_START.getTime() - 1), onIssue(ISSUE_B)),
    ],
  };
}

const READABLE: Array<string> = [ISSUE_A._id, ISSUE_B._id];

beforeEach(() => {
  rowCount = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what it reads, for whom, in which window", () => {
  test("proposals: one read for each way a proposal settles, by its own date in the window, under the caller's props - states and dates only", async () => {
    install(busyProject());

    await read();

    const calls: Array<Call> = callsTo("proposals");

    expect(
      calls.map((call: Call): Array<string> => {
        return Object.keys(call.query).sort();
      }),
    ).toEqual([
      ["appliedAt", "projectId"],
      ["failedAt", "projectId"],
      ["dismissedAt", "projectId"],
    ]);

    for (const call of calls) {
      const column: string = Object.keys(call.query).find(
        (key: string): boolean => {
          return key !== "projectId";
        },
      )!;

      expect(call.props).toBe(CALLER);
      expect(call.query["projectId"]).toBe(PROJECT_ID);
      expect(matchesFilter(WINDOW_START, call.query[column])).toBe(true);
      expect(matchesFilter(NOW, call.query[column])).toBe(true);
      expect(
        matchesFilter(new Date(WINDOW_START.getTime() - 1), call.query[column]),
      ).toBe(false);
      expect(matchesFilter(undefined, call.query[column])).toBe(false);
      // Never what it changes, why, or how it is proven.
      expect(call.select).toEqual({
        _id: true,
        status: true,
        kind: true,
        appliedAt: true,
        failedAt: true,
        dismissedAt: true,
        verifiedAt: true,
        approvedByUserId: true,
        dataSecurityIssueId: true,
      });
      expect(call.sort).toEqual({ [column]: SortOrder.Descending });
      expect(call.limit).toBe(AI_OUTCOMES_SCAN_LIMIT);
      expect(call.skip).toBe(0);
    }
  });

  test("analyses: the times OneUptime AI analyzed an issue, in the window, under the caller's props - dates and issues only", async () => {
    install(busyProject());

    await read();

    const calls: Array<Call> = callsTo("decisions");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.props).toBe(CALLER);
    expect(Object.keys(calls[0]!.query).sort()).toEqual([
      "createdAt",
      "didAnalyze",
      "projectId",
    ]);
    expect(calls[0]!.query["didAnalyze"]).toBe(true);
    expect(matchesFilter(WINDOW_START, calls[0]!.query["createdAt"])).toBe(
      true,
    );
    expect(
      matchesFilter(
        new Date(WINDOW_START.getTime() - 1),
        calls[0]!.query["createdAt"],
      ),
    ).toBe(false);
    expect(calls[0]!.select).toEqual({
      _id: true,
      createdAt: true,
      dataSecurityIssueId: true,
    });
    expect(calls[0]!.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(calls[0]!.limit).toBe(AI_OUTCOMES_SCAN_LIMIT);
  });

  test("issues: only those a change was proven for, when each opened, under the caller's props", async () => {
    install(busyProject());

    await read();

    const calls: Array<Call> = provenIssueReads();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.props).toBe(CALLER);
    expect(calls[0]!.select).toEqual({ _id: true, firstDetectedAt: true });
    expect(calls[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(matchesFilter(ISSUE_A._id, calls[0]!.query["_id"])).toBe(true);
    expect(matchesFilter(ISSUE_B._id, calls[0]!.query["_id"])).toBe(true);
    // Dismissed only: nothing to time.
    expect(matchesFilter(ISSUE_HIDDEN._id, calls[0]!.query["_id"])).toBe(false);
    expect(calls[0]!.limit).toBe(2);
  });

  test("with no change proven, no issue is read", async () => {
    install({
      issues: [ISSUE_A],
      proposals: [
        proposal(DataSecurityAiProposalStatus.Applied, made(daysAgo(3))),
      ],
    });

    await read();

    expect(provenIssueReads()).toEqual([]);
  });

  test("the caller's props are never root, whatever Data Security it reads", async () => {
    install(busyProject());

    await read();

    for (const call of [
      ...callsTo("proposals"),
      ...callsTo("decisions"),
      ...callsTo("issues"),
    ]) {
      expect(call.props).toBe(CALLER);
    }
  });
});

describe("what it counts", () => {
  test("every way a proposal settled in the window, of this project only", async () => {
    install(busyProject());

    const outcomes: AiOutcomes = await read();

    expect(outcomes.dataSecurity).toEqual({
      issuesAnalyzed: 3,
      changes: { proven: 2, waiting: 1, undone: 1, failed: 1 },
      proposals: { approved: 2, dismissed: 2 },
      kinds: [
        {
          kind: DataSecurityAiProposalKind.ScrubTelemetry,
          proven: 2,
          waiting: 1,
          undone: 1,
          failed: 1,
          approved: 2,
          dismissed: 2,
        },
      ],
      /*
       * ISSUE_A opened 10 days ago and passed 4 hours later; ISSUE_B opened
       * 6 days ago and passed 6 hours later: 5 hours in the middle.
       */
      medianMinutesToCheckPassed: 300,
      issuesCheckPassed: 2,
    });

    // The weeks count the changes made, and the ones that worked.
    expect(weekly(outcomes, "dataSecurityChangesMade")).toBe(4);
    expect(weekly(outcomes, "dataSecurityChangesProven")).toBe(2);
    expect(outcomes.isPartial).toBe(false);
  });

  test("only the issues the caller may read: the proposals and records of another are never read", async () => {
    install(busyProject(), {}, READABLE);

    const outcomes: AiOutcomes = await read();

    // ISSUE_HIDDEN's dismissal and its analysis are not counted.
    expect(outcomes.dataSecurity!.proposals.dismissed).toBe(1);
    expect(outcomes.dataSecurity!.issuesAnalyzed).toBe(2);
    expect(JSON.stringify(outcomes)).not.toContain(ISSUE_HIDDEN._id);
  });

  test("a proposal read by two of its dates counts once", async () => {
    install({
      issues: [ISSUE_A],
      proposals: [
        proposal(DataSecurityAiProposalStatus.Applied, made(daysAgo(3)), {
          // A row with a second date, as no build writes it, still counts once.
          dismissedAt: daysAgo(2),
        }),
      ],
    });

    const outcomes: AiOutcomes = await read();

    expect(outcomes.dataSecurity!.changes).toEqual({
      proven: 0,
      waiting: 1,
      undone: 0,
      failed: 0,
    });
    expect(weekly(outcomes, "dataSecurityChangesMade")).toBe(1);
  });

  test("a change approved weeks after OneUptime AI proposed it counts when it was made", async () => {
    install({
      issues: [ISSUE_A],
      proposals: [
        // Proposed before the window, approved and made last week.
        proposal(DataSecurityAiProposalStatus.Applied, made(daysAgo(5)), {
          createdAt: new Date(WINDOW_START.getTime() - 20 * DAY),
          approvedByUserId: APPROVER_ID,
        }),
      ],
    });

    const outcomes: AiOutcomes = await read();

    expect(outcomes.dataSecurity!.changes.waiting).toBe(1);
    expect(outcomes.dataSecurity!.proposals.approved).toBe(1);
    expect(outcomes.weeks[11]!.dataSecurityChangesMade).toBe(1);
  });
});

describe("a caller who may not read", () => {
  test.each(["notAuthorized", "paymentRequired"] as Array<Access>)(
    "the proposals (%s): no Data Security numbers at all, and the other parts as ever",
    async (access: Access) => {
      install(busyProject(), { proposals: access });

      const outcomes: AiOutcomes = await read();

      expect(outcomes.dataSecurity).toBeNull();
      expect(outcomes.pages).not.toBeNull();
    },
  );

  test("the records of its work: no count of the issues it analyzed, the rest counted", async () => {
    install(busyProject(), { decisions: "notAuthorized" });

    const outcomes: AiOutcomes = await read();

    expect(outcomes.dataSecurity!.issuesAnalyzed).toBeNull();
    expect(outcomes.dataSecurity!.changes.proven).toBe(2);
  });

  test("the issues: no time to their check passing, the rest counted", async () => {
    install(busyProject(), { issues: "notAuthorized" });

    const outcomes: AiOutcomes = await read();

    expect(outcomes.dataSecurity!.medianMinutesToCheckPassed).toBeNull();
    expect(outcomes.dataSecurity!.issuesCheckPassed).toBe(0);
    expect(outcomes.dataSecurity!.changes.proven).toBe(2);
  });
});

describe("the newest rows, up to the scan limit", () => {
  test.each(["dismissedAt", "failedAt"])(
    "proposals settled by %s reaching the limit mark the outcomes partial",
    async (column: string) => {
      install({
        proposals: Array.from(
          { length: AI_OUTCOMES_SCAN_LIMIT },
          (_value: unknown, index: number): FakeRow => {
            return proposal(
              column === "dismissedAt"
                ? DataSecurityAiProposalStatus.Dismissed
                : DataSecurityAiProposalStatus.Failed,
              { [column]: daysAgo(1 + (index % 30)) },
            );
          },
        ),
      });

      const outcomes: AiOutcomes = await read();

      expect(outcomes.isPartial).toBe(true);
    },
  );

  test("analyses reaching the limit mark the outcomes partial", async () => {
    install({
      decisions: Array.from(
        { length: AI_OUTCOMES_SCAN_LIMIT },
        (_value: unknown, index: number): FakeRow => {
          return decision(daysAgo(1 + (index % 30)));
        },
      ),
    });

    expect((await read()).isPartial).toBe(true);
  });
});

describe("the records behind each Data Security number", () => {
  test("for every part and outcome, the records' total is the card's number", async () => {
    install(busyProject(), {}, READABLE);

    const outcomes: AiOutcomes = await read();
    const counts: Record<string, Record<string, number>> = {
      [AiOutcomesPart.DataSecurityAnalyses]: {
        analyzed: outcomes.dataSecurity!.issuesAnalyzed!,
      },
      [AiOutcomesPart.DataSecurityChanges]: outcomes.dataSecurity!
        .changes as unknown as Record<string, number>,
      [AiOutcomesPart.DataSecurityProposals]: outcomes.dataSecurity!
        .proposals as unknown as Record<string, number>,
    };

    let opened: number = 0;

    for (const part of AI_OUTCOMES_DATA_SECURITY_PARTS) {
      for (const outcome of AI_OUTCOMES_PART_OUTCOMES[part]) {
        const records: AiOutcomesRecords = await readRecords(part, outcome);

        expect({ part, outcome, total: records.total }).toEqual({
          part,
          outcome,
          total: counts[part]![outcome],
        });
        expect({ part, outcome, listed: records.records.length }).toEqual({
          part,
          outcome,
          listed: counts[part]![outcome],
        });
        expect(records.nextSkip).toBeNull();

        for (const record of records.records) {
          // Each one names the issue it was about, one the caller may read.
          expect(READABLE).toContain(record.dataSecurityIssue!.id);
          expect(record.subject).toBeUndefined();
        }

        opened += records.total;
      }
    }

    expect(opened).toBeGreaterThan(8);
  });

  test("a change: its issue with its title, what OneUptime AI proposed in a line and its kind, when it was made", async () => {
    install(busyProject(), {}, READABLE);

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.DataSecurityChanges,
      "proven",
    );

    expect(records.records).toEqual([
      {
        id: expect.any(String),
        at: daysAgo(5).toISOString(),
        dataSecurityIssue: { id: ISSUE_B._id, title: ISSUE_B["title"] },
        proposalTitle: "Scrub Email Address in body of checkout-logs",
        proposalKind: DataSecurityAiProposalKind.ScrubTelemetry,
      },
      {
        id: expect.any(String),
        at: daysAgo(10).toISOString(),
        dataSecurityIssue: { id: ISSUE_A._id, title: ISSUE_A["title"] },
        proposalTitle: "Scrub Email Address in body of checkout-logs",
        proposalKind: DataSecurityAiProposalKind.ScrubTelemetry,
      },
    ]);
    // Never why it was proposed or dismissed.
    expect(JSON.stringify(records)).not.toContain("We fix it in code.");
  });

  test("a change that could not be made, and a dismissal, at the moment each settled", async () => {
    install(busyProject(), {}, READABLE);

    const failed: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.DataSecurityChanges,
      "failed",
    );
    const dismissed: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.DataSecurityProposals,
      "dismissed",
    );

    expect(
      failed.records.map((record: AiOutcomesRecord): string => {
        return record.at;
      }),
    ).toEqual([daysAgo(5).toISOString()]);
    expect(
      dismissed.records.map((record: AiOutcomesRecord): string => {
        return record.at;
      }),
    ).toEqual([daysAgo(4).toISOString()]);
  });

  test("an issue OneUptime AI analyzed: once, at its first analysis in the window", async () => {
    install(busyProject(), {}, READABLE);

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.DataSecurityAnalyses,
      "analyzed",
    );

    expect(
      records.records.map((record: AiOutcomesRecord): [string, string] => {
        return [record.dataSecurityIssue!.id, record.at];
      }),
    ).toEqual([
      [ISSUE_B._id, daysAgo(6).toISOString()],
      [ISSUE_A._id, daysAgo(10).toISOString()],
    ]);
    expect(records.records[0]!.proposalTitle).toBeUndefined();
  });

  test("details are read under the caller's props: the issues' titles, and the proposals' lines", async () => {
    install(busyProject(), {}, READABLE);

    await readRecords(AiOutcomesPart.DataSecurityProposals, "approved");

    const titleReads: Array<Call> = callsTo("issues");
    const lineReads: Array<Call> = callsTo("proposals").filter(
      (call: Call): boolean => {
        return Boolean(call.select["title"]);
      },
    );

    expect(titleReads).toHaveLength(1);
    expect(titleReads[0]!.select).toEqual({ _id: true, title: true });
    expect(lineReads).toHaveLength(1);
    expect(lineReads[0]!.select).toEqual({
      _id: true,
      title: true,
      kind: true,
    });

    for (const call of store.calls) {
      expect({ table: call.table, isRoot: Boolean(call.props.isRoot) }).toEqual(
        { table: call.table, isRoot: false },
      );
    }
  });

  test("a record whose issue the caller can no longer read when it is listed is left out", async () => {
    install(busyProject(), {}, READABLE);

    const find: SpyInstance<typeof DataSecurityIssueService.findBy> =
      DataSecurityIssueService.findBy as unknown as SpyInstance<
        typeof DataSecurityIssueService.findBy
      >;

    // The issue was read as readable, then gone by the time it is named.
    find.mockImplementation((async () => {
      return [];
    }) as never);

    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.DataSecurityChanges,
      "proven",
    );

    expect(records.total).toBe(2);
    expect(records.records).toEqual([]);
  });

  test("work done after the number was counted is not among its records", async () => {
    install(busyProject(), {}, READABLE);

    // Counted 7 days ago: ISSUE_B's change was made since.
    const records: AiOutcomesRecords = await readRecords(
      AiOutcomesPart.DataSecurityChanges,
      "proven",
      { windowEnd: daysAgo(7) },
    );

    expect(
      records.records.map((record: AiOutcomesRecord): string => {
        return record.dataSecurityIssue!.id;
      }),
    ).toEqual([ISSUE_A._id]);
  });

  test.each([
    [AiOutcomesPart.DataSecurityChanges, "proposals", "notAuthorized"],
    [AiOutcomesPart.DataSecurityProposals, "proposals", "paymentRequired"],
    [AiOutcomesPart.DataSecurityAnalyses, "decisions", "notAuthorized"],
  ] as Array<[AiOutcomesPart, TableName, Access]>)(
    "%s, for a caller who may not read the %s (%s): refused",
    async (part: AiOutcomesPart, table: TableName, access: Access) => {
      install(busyProject(), { [table]: access });

      await expect(
        readRecords(part, AI_OUTCOMES_PART_OUTCOMES[part][0]!),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("an outcome of another Data Security part is refused before anything is read", async () => {
    install(busyProject());

    await expect(
      readRecords(AiOutcomesPart.DataSecurityChanges, "approved"),
    ).rejects.toThrow("That outcome is not one the page counts");
    await expect(
      readRecords(AiOutcomesPart.DataSecurityAnalyses, "proven"),
    ).rejects.toThrow("That outcome is not one the page counts");
    expect(store.calls).toEqual([]);
  });
});

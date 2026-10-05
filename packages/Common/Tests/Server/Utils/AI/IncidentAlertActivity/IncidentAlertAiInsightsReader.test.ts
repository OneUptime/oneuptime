import IncidentAlertAiInsightsReader from "../../../../../Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiInsightsReader";
import { IncidentAlertAiSubjectInput } from "../../../../../Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiInsightsBuilder";
import { AlertFeedEventType } from "../../../../../Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "../../../../../Models/DatabaseModels/IncidentFeed";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import { AiActivityAttentionKind } from "../../../../../Types/AI/AiActivityInsights";
import { IncidentAlertAiInsights } from "../../../../../Types/AI/IncidentAlertAiInsights";
import {
  INCIDENT_ALERT_AI_SUBJECT_KINDS,
  IncidentAlertAiSubjectKind,
} from "../../../../../Types/AI/IncidentAlertAiLogs";
import AutoRemediationSuggestionStatus from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "../../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import RunnerJobStatus from "../../../../../Types/Runbook/RunnerJobStatus";
import {
  FakeCall,
  FakeRow,
  FakeStore,
  FakeTables,
  emptyTables,
  installFakeStore,
  matchesFilter,
  related,
  uuid,
} from "./FakeAiActivityStore";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * IncidentAlertAiInsightsReader against an in-memory copy of the tables
 * behind the real services: what it reads, under whose props, for which
 * product - and that nothing about an incident, alert, monitor or service
 * the caller may not read ever reaches the insights.
 */

const PROJECT_ID: ObjectID = new ObjectID(uuid(1, 1));
const OTHER_PROJECT_ID: ObjectID = new ObjectID(uuid(1, 2));

const NOW: Date = new Date("2026-10-05T15:00:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID(uuid(2, 1)),
  isMultiTenantRequest: false,
};

const MONITOR_DB: string = uuid(60, 1);
const MONITOR_SECRET: string = uuid(60, 2);
const SERVICE_CHECKOUT: string = uuid(70, 1);

function incident(index: number, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: uuid(10, index),
    projectId: PROJECT_ID,
    createdAt: daysAgo(5),
    title: `Incident ${index}`,
    incidentNumber: index,
    incidentNumberWithPrefix: `INC-${index}`,
    monitors: [],
    services: [],
    ...overrides,
  };
}

function alert(index: number, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: uuid(20, index),
    projectId: PROJECT_ID,
    createdAt: daysAgo(5),
    title: `Alert ${index}`,
    alertNumber: index,
    alertNumberWithPrefix: `ALT-${index}`,
    services: [],
    ...overrides,
  };
}

let runCount: number = 0;

function run(
  subject: Partial<FakeRow>,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  runCount++;
  return {
    _id: uuid(30, runCount),
    projectId: PROJECT_ID,
    createdAt: daysAgo(1),
    runType: AIRunType.Investigation,
    status: AIRunStatus.Completed,
    analysisTldr: `Finding ${runCount}`,
    ...subject,
    ...overrides,
  };
}

let fixCount: number = 0;

function suggestion(
  subject: Partial<FakeRow>,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  fixCount++;
  return {
    _id: uuid(40, fixCount),
    projectId: PROJECT_ID,
    createdAt: daysAgo(1),
    status: AutoRemediationSuggestionStatus.Suggested,
    ...subject,
    ...overrides,
  };
}

function onIncident(row: FakeRow): Partial<FakeRow> {
  return { triggeredByIncidentId: new ObjectID(row._id) };
}

function onAlert(row: FakeRow): Partial<FakeRow> {
  return { triggeredByAlertId: new ObjectID(row._id) };
}

async function readInsights(
  subjectKind: IncidentAlertAiSubjectKind,
  props: DatabaseCommonInteractionProps = CALLER,
): Promise<IncidentAlertAiInsights> {
  return IncidentAlertAiInsightsReader.read({
    subjectKind,
    projectId: PROJECT_ID,
    props,
    now: NOW,
  });
}

let tables: FakeTables;
let store: FakeStore;

beforeEach(() => {
  tables = emptyTables();
  store = installFakeStore(tables);
  tables.monitors.push(
    {
      _id: MONITOR_DB,
      projectId: PROJECT_ID,
      createdAt: daysAgo(100),
      name: "Database disk",
    },
    {
      _id: MONITOR_SECRET,
      projectId: PROJECT_ID,
      createdAt: daysAgo(100),
      name: "Secret monitor",
    },
  );
  tables.services.push({
    _id: SERVICE_CHECKOUT,
    projectId: PROJECT_ID,
    createdAt: daysAgo(100),
    name: "checkout",
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The report an investigation posts on its incident or alert.
function report(
  subjectKind: IncidentAlertAiSubjectKind,
  runRow: FakeRow,
  subjectRow: FakeRow,
  summary: string,
): FakeRow {
  return {
    _id: uuid(80, Number(String(runRow._id).slice(-4))),
    projectId: PROJECT_ID,
    createdAt: daysAgo(1),
    aiRunId: new ObjectID(runRow._id),
    ...(subjectKind === "incident"
      ? {
          incidentId: new ObjectID(subjectRow._id),
          incidentFeedEventType: IncidentFeedEventType.RootCause,
        }
      : {
          alertId: new ObjectID(subjectRow._id),
          alertFeedEventType: AlertFeedEventType.RootCause,
        }),
    feedInfoInMarkdown: [
      "## 🧠 AI — Automated Root Cause Analysis",
      "",
      `**Summary** — ${summary}`,
      "",
      "**Most likely root cause** — The data volume filled up [C1].",
    ].join("\n"),
  };
}

describe("a finding without a TL;DR", () => {
  test.each(INCIDENT_ALERT_AI_SUBJECT_KINDS)(
    "is the Summary the %s's report opens with, read as root for that run only",
    async (subjectKind: IncidentAlertAiSubjectKind) => {
      const subjectRow: FakeRow =
        subjectKind === "incident" ? incident(1) : alert(1);
      const on: Partial<FakeRow> =
        subjectKind === "incident"
          ? onIncident(subjectRow)
          : onAlert(subjectRow);
      const withoutTldr: FakeRow = run(on, { analysisTldr: undefined });
      const older: FakeRow = run(on, {
        createdAt: daysAgo(3),
        analysisTldr: undefined,
      });

      (subjectKind === "incident" ? tables.incidents : tables.alerts).push(
        subjectRow,
      );
      tables.runs.push(withoutTldr, older);
      (subjectKind === "incident"
        ? tables.incidentFeeds
        : tables.alertFeeds
      ).push(
        report(
          subjectKind,
          withoutTldr,
          subjectRow,
          "The data volume on db-1 filled up with application logs.",
        ),
        report(subjectKind, older, subjectRow, "An older summary."),
      );

      const insights: IncidentAlertAiInsights = await readInsights(subjectKind);

      expect(insights.problems[0]!.latestFinding).toEqual({
        aiRunId: withoutTldr._id,
        text: "The data volume on db-1 filled up with application logs.",
        source: "report",
        at: expect.any(String),
      });

      const reads: Array<FakeCall> = store.callsTo(
        subjectKind === "incident" ? "incidentFeeds" : "alertFeeds",
      );

      expect(reads).toHaveLength(1);
      expect(reads[0]!.props).toEqual({ isRoot: true });
      // Only the problem's newest completed run: the older one is not read.
      expect(matchesFilter(withoutTldr._id, reads[0]!.query["aiRunId"])).toBe(
        true,
      );
      expect(matchesFilter(older._id, reads[0]!.query["aiRunId"])).toBe(false);
    },
  );

  test("a TL;DR needs no report: none is read", async () => {
    const one: FakeRow = incident(1);
    tables.incidents.push(one);
    tables.runs.push(run(onIncident(one)));

    const insights: IncidentAlertAiInsights = await readInsights("incident");

    expect(insights.problems[0]!.latestFinding?.source).toBe("tldr");
    expect(store.callsTo("incidentFeeds")).toEqual([]);
    expect(store.callsTo("alertFeeds")).toEqual([]);
  });

  test("an incident the caller may not read never has its report read", async () => {
    const mine: FakeRow = incident(1);
    const hidden: FakeRow = incident(2);
    const hiddenRun: FakeRow = run(onIncident(hidden), {
      analysisTldr: undefined,
    });
    tables.incidents.push(mine, hidden);
    tables.runs.push(run(onIncident(mine)), hiddenRun);
    tables.incidentFeeds.push(
      report(
        "incident",
        hiddenRun,
        hidden,
        "A summary of an incident the caller may not read.",
      ),
    );
    store.access.readableIncidentIds = new Set<string>([mine._id]);

    const insights: IncidentAlertAiInsights = await readInsights("incident");

    expect(store.callsTo("incidentFeeds")).toEqual([]);
    expect(JSON.stringify(insights)).not.toContain(
      "A summary of an incident the caller may not read.",
    );
  });

  test("a report from another run, or on another incident, is not this run's", async () => {
    const one: FakeRow = incident(1);
    const other: FakeRow = incident(2);
    const withoutTldr: FakeRow = run(onIncident(one), {
      analysisTldr: undefined,
    });
    const otherRun: FakeRow = run(onIncident(other), {
      createdAt: daysAgo(4),
    });
    tables.incidents.push(one, other);
    tables.runs.push(withoutTldr, otherRun);
    tables.incidentFeeds.push(
      // The right run, posted on the wrong incident.
      report(
        "incident",
        withoutTldr,
        other,
        "This report was posted on another incident entirely.",
      ),
      // Another run's report on this incident.
      report(
        "incident",
        otherRun,
        one,
        "This summary belongs to another investigation run.",
      ),
    );

    const insights: IncidentAlertAiInsights = await readInsights("incident");

    const problem: { latestFinding?: unknown } | undefined =
      insights.problems.find(
        (candidate: { latestSubject: { id: string } }): boolean => {
          return candidate.latestSubject.id === one._id;
        },
      );

    expect(problem?.latestFinding).toBeUndefined();
  });
});

describe("who may read the insights", () => {
  test.each(INCIDENT_ALERT_AI_SUBJECT_KINDS)(
    "a caller who may not read %ss at all is refused before anything else is read",
    async (subjectKind: IncidentAlertAiSubjectKind) => {
      store.access.canReadIncidents = subjectKind !== "incident";
      store.access.canReadAlerts = subjectKind !== "alert";

      await expect(readInsights(subjectKind)).rejects.toBeInstanceOf(
        NotAuthorizedException,
      );
      expect(store.callsTo("runs")).toEqual([]);
    },
  );

  test("everything about an incident the caller may not read is left out, totals included", async () => {
    const mine: FakeRow = incident(1);
    const hidden: FakeRow = incident(2, { title: "Hidden incident" });
    tables.incidents.push(mine, hidden);
    tables.runs.push(
      run(onIncident(mine)),
      run(onIncident(hidden), { analysisTldr: "A hidden finding" }),
      run(onIncident(hidden), {
        runType: AIRunType.CodeFix,
        analysisTldr: undefined,
      }),
    );
    tables.suggestions.push(
      suggestion({ incidentId: new ObjectID(hidden._id) }),
    );
    store.access.readableIncidentIds = new Set<string>([mine._id]);

    const insights: IncidentAlertAiInsights = await readInsights("incident");

    expect(insights.totals).toMatchObject({
      investigations: 1,
      fixes: 0,
      fixTasks: 0,
    });
    expect(JSON.stringify(insights)).not.toContain("Hidden incident");
    expect(JSON.stringify(insights)).not.toContain("A hidden finding");
  });

  test("a caller who may not read fixes gets none, and the insights say they are hidden", async () => {
    const one: FakeRow = incident(1);
    tables.incidents.push(one);
    tables.runs.push(run(onIncident(one)));
    tables.suggestions.push(
      suggestion({
        incidentId: new ObjectID(one._id),
        status: AutoRemediationSuggestionStatus.AutoExecuted,
        verificationStatus: AutoRemediationVerificationStatus.Failed,
      }),
    );
    store.access.canReadSuggestions = false;

    const insights: IncidentAlertAiInsights = await readInsights("incident");

    expect(insights.fixesHidden).toBe(true);
    expect(insights.totals.fixes).toBe(0);
    expect(insights.fixOutcomes.total).toBe(0);
    expect(insights.totals.investigations).toBe(1);
    // Not even the failed fix's attention item.
    expect(
      insights.attention.map((item: { kind: string }): string => {
        return item.kind;
      }),
    ).not.toContain(AiActivityAttentionKind.FixesFailed);
  });

  test("a caller who may read fixes is not told they are hidden", async () => {
    const one: FakeRow = incident(1);
    tables.incidents.push(one);
    tables.runs.push(run(onIncident(one)));

    const insights: IncidentAlertAiInsights = await readInsights("incident");

    expect(insights.fixesHidden).toBe(false);
  });

  test("never names a monitor or service the caller may not read", async () => {
    const first: FakeRow = incident(1, {
      monitors: [related(MONITOR_SECRET)],
      services: [related(SERVICE_CHECKOUT)],
    });
    const second: FakeRow = incident(2, {
      monitors: [related(MONITOR_SECRET)],
      services: [related(SERVICE_CHECKOUT)],
    });
    tables.incidents.push(first, second);
    tables.runs.push(run(onIncident(first)), run(onIncident(second)));
    store.access.readableMonitorIds = new Set<string>([MONITOR_DB]);
    store.access.canReadServices = false;

    const insights: IncidentAlertAiInsights = await readInsights("incident");

    expect(insights.monitors).toEqual([]);
    expect(insights.services).toEqual([]);
    expect(insights.problems[0]!.monitors).toEqual([]);
    expect(JSON.stringify(insights)).not.toContain("Secret monitor");
    // Still one problem: they group by the monitor all the same.
    expect(insights.problems).toHaveLength(1);
  });
});

describe("what it reads", () => {
  test("the window's investigations and fix pull requests as root, in the tenant, without prompts", async () => {
    await readInsights("incident");

    const runReads: Array<FakeCall> = store.callsTo("runs");

    expect(runReads).toHaveLength(2);

    for (const read of runReads) {
      expect(read.props).toEqual({ isRoot: true });
      expect(String(read.query["projectId"])).toBe(PROJECT_ID.toString());
      // Within the window: not 31 days ago, yes 29.
      expect(matchesFilter(daysAgo(31), read.query["createdAt"])).toBe(false);
      expect(matchesFilter(daysAgo(29), read.query["createdAt"])).toBe(true);
      expect(read.select["conversationId"]).toBeUndefined();
    }

    expect(
      runReads.map((read: FakeCall): unknown => {
        return read.query["runType"];
      }),
    ).toEqual([AIRunType.Investigation, AIRunType.CodeFix]);
  });

  test("fixes under the caller's props, statuses only", async () => {
    await readInsights("incident");

    const read: FakeCall = store.callsTo("suggestions")[0]!;

    expect(read.props).toBe(CALLER);
    expect(Object.keys(read.select).sort()).toEqual(
      [
        "_id",
        "alertId",
        "createdAt",
        "incidentId",
        "status",
        "verificationStatus",
      ].sort(),
    );
  });

  test("the incidents under the caller's props; their monitors and services as root, for the readable ones only", async () => {
    const mine: FakeRow = incident(1, { monitors: [related(MONITOR_DB)] });
    const hidden: FakeRow = incident(2);
    tables.incidents.push(mine, hidden);
    tables.runs.push(run(onIncident(mine)), run(onIncident(hidden)));
    store.access.readableIncidentIds = new Set<string>([mine._id]);

    await readInsights("incident");

    const relationRead: FakeCall = store
      .callsTo("incidents")
      .find((call: FakeCall): boolean => {
        return Boolean(call.select["monitors"]);
      })!;

    expect(relationRead.props).toEqual({ isRoot: true });
    expect(matchesFilter(mine._id, relationRead.query["_id"])).toBe(true);
    expect(matchesFilter(hidden._id, relationRead.query["_id"])).toBe(false);
  });

  test("an alert's monitor is its own column", async () => {
    const first: FakeRow = alert(1, { monitorId: new ObjectID(MONITOR_DB) });
    const second: FakeRow = alert(2, { monitorId: new ObjectID(MONITOR_DB) });
    tables.alerts.push(first, second);
    tables.runs.push(run(onAlert(first)), run(onAlert(second)));

    const insights: IncidentAlertAiInsights = await readInsights("alert");

    expect(insights.monitors).toEqual([
      expect.objectContaining({
        id: MONITOR_DB,
        name: "Database disk",
        subjectCount: 2,
      }),
    ]);
    expect(store.callsTo("incidents")).toEqual([]);
  });

  test("counts the window's incidents the caller may read", async () => {
    tables.incidents.push(
      incident(1),
      incident(2),
      incident(3, { createdAt: daysAgo(40) }),
      incident(4, { projectId: OTHER_PROJECT_ID }),
    );
    store.access.readableIncidentIds = new Set<string>([
      uuid(10, 1),
      uuid(10, 3),
      uuid(10, 4),
    ]);

    const insights: IncidentAlertAiInsights = await readInsights("incident");

    expect(insights.coverage.subjects).toBe(1);
    expect(store.callsTo("incidents", "countBy")[0]!.props).toBe(CALLER);
  });

  test("why the skipped ones were not investigated, for the ones the caller may read", async () => {
    const decision: (code: string) => Record<string, unknown> = (
      code: string,
    ) => {
      return {
        code,
        title: "Not investigated",
        description: "",
        nextStep: "",
        source: "recorded",
        evaluatedAt: daysAgo(1).toISOString(),
      };
    };
    tables.incidents.push(
      incident(1, { aiInvestigationDecision: decision("provider_missing") }),
      incident(2, { aiInvestigationDecision: decision("provider_missing") }),
      incident(3, {
        aiInvestigationDecision: decision("severity_below_threshold"),
      }),
      incident(4, {
        aiInvestigationDecision: decision("provider_missing"),
        createdAt: daysAgo(45),
      }),
      incident(5, { aiInvestigationDecision: decision("provider_missing") }),
    );
    store.access.readableIncidentIds = new Set<string>([
      uuid(10, 1),
      uuid(10, 2),
      uuid(10, 3),
      uuid(10, 4),
    ]);

    const insights: IncidentAlertAiInsights = await readInsights("incident");

    expect(insights.coverage.notInvestigated).toEqual([
      { code: "provider_missing", count: 2 },
      { code: "severity_below_threshold", count: 1 },
    ]);
    expect(insights.attention).toEqual([
      expect.objectContaining({
        kind: AiActivityAttentionKind.InvestigationsNotStarted,
        reason: "provider_missing",
        count: 2,
      }),
    ]);

    // The decision column is the server's own: read as root.
    const decisionRead: FakeCall = store
      .callsTo("incidents")
      .find((call: FakeCall): boolean => {
        return Boolean(call.select["aiInvestigationDecision"]);
      })!;

    expect(decisionRead.props).toEqual({ isRoot: true });
  });

  test("counts the commands of the readable investigations and fixes, as root", async () => {
    const one: FakeRow = incident(1);
    const hidden: FakeRow = incident(2);
    tables.incidents.push(one, hidden);
    const readableRun: FakeRow = run(onIncident(one));
    const hiddenRun: FakeRow = run(onIncident(hidden));
    const fix: FakeRow = suggestion({ incidentId: new ObjectID(one._id) });
    tables.runs.push(readableRun, hiddenRun);
    tables.suggestions.push(fix);
    tables.jobs.push(
      {
        _id: uuid(50, 1),
        projectId: PROJECT_ID,
        createdAt: daysAgo(1),
        aiRunId: new ObjectID(readableRun._id),
        status: RunnerJobStatus.Succeeded,
      },
      {
        _id: uuid(50, 2),
        projectId: PROJECT_ID,
        createdAt: daysAgo(1),
        aiRunId: new ObjectID(readableRun._id),
        status: RunnerJobStatus.TimedOut,
      },
      {
        _id: uuid(50, 3),
        projectId: PROJECT_ID,
        createdAt: daysAgo(1),
        autoRemediationSuggestionId: new ObjectID(fix._id),
        status: RunnerJobStatus.Failed,
      },
      {
        _id: uuid(50, 4),
        projectId: PROJECT_ID,
        createdAt: daysAgo(1),
        aiRunId: new ObjectID(hiddenRun._id),
        status: RunnerJobStatus.Failed,
      },
    );
    store.access.readableIncidentIds = new Set<string>([one._id]);

    const insights: IncidentAlertAiInsights = await readInsights("incident");

    expect(insights.totals).toMatchObject({
      commands: 3,
      failedCommands: 1,
      timedOutCommands: 1,
    });

    for (const read of store.callsTo("jobs")) {
      expect(read.props).toEqual({ isRoot: true });
      expect(Object.keys(read.select).sort()).toEqual(["_id", "status"]);
    }
  });
});

describe("the whole picture, for each product", () => {
  test.each(INCIDENT_ALERT_AI_SUBJECT_KINDS)(
    "%s: recurring problems, findings, hotspots, fixes and the trend come from the rows",
    async (subjectKind: IncidentAlertAiSubjectKind) => {
      const make: (index: number) => FakeRow =
        subjectKind === "incident"
          ? (index: number): FakeRow => {
              return incident(index, {
                monitors: [related(MONITOR_DB)],
                services: [related(SERVICE_CHECKOUT)],
                title: "Disk full",
              });
            }
          : (index: number): FakeRow => {
              return alert(index, {
                monitorId: new ObjectID(MONITOR_DB),
                services: [related(SERVICE_CHECKOUT)],
                title: "Disk full",
              });
            };
      const subjectsTable: Array<FakeRow> =
        subjectKind === "incident" ? tables.incidents : tables.alerts;
      const on: (row: FakeRow) => Partial<FakeRow> =
        subjectKind === "incident" ? onIncident : onAlert;
      const fixSubject: (row: FakeRow) => Partial<FakeRow> = (
        row: FakeRow,
      ): Partial<FakeRow> => {
        return subjectKind === "incident"
          ? { incidentId: new ObjectID(row._id) }
          : { alertId: new ObjectID(row._id) };
      };

      const first: FakeRow = make(1);
      const second: FakeRow = make(2);
      const third: FakeRow = make(3);
      subjectsTable.push(first, second, third);
      tables.runs.push(
        run(on(first), {
          createdAt: daysAgo(3),
          analysisTldr: "Logs filled the disk.",
        }),
        run(on(second), {
          createdAt: daysAgo(2),
          analysisTldr: "A cron job filled the disk.",
        }),
        run(on(third), {
          createdAt: daysAgo(1),
          status: AIRunStatus.Error,
          analysisTldr: undefined,
        }),
      );
      tables.suggestions.push(
        suggestion(fixSubject(second), {
          status: AutoRemediationSuggestionStatus.AutoExecuted,
          verificationStatus: AutoRemediationVerificationStatus.Verified,
        }),
      );

      const insights: IncidentAlertAiInsights = await readInsights(subjectKind);

      expect(insights.subjectKind).toBe(subjectKind);
      expect(insights.problems).toHaveLength(1);
      expect(insights.problems[0]).toMatchObject({
        title: "Disk full",
        investigationCount: 3,
        subjectCount: 3,
        isRecurring: true,
        monitors: [{ id: MONITOR_DB, name: "Database disk" }],
        latestFinding: expect.objectContaining({
          text: "A cron job filled the disk.",
        }),
        latestSubject: expect.objectContaining({
          kind: subjectKind,
          id: third._id,
        }),
        fixes: expect.objectContaining({
          proposed: 1,
          applied: 1,
          verified: 1,
        }),
      });
      expect(insights.monitors[0]).toMatchObject({
        id: MONITOR_DB,
        subjectCount: 3,
      });
      expect(insights.services[0]).toMatchObject({
        id: SERVICE_CHECKOUT,
        name: "checkout",
        subjectCount: 3,
      });
      expect(insights.fixOutcomes).toMatchObject({
        total: 1,
        appliedAutomatically: 1,
        verified: 1,
      });
      expect(insights.totals.failedInvestigations).toBe(1);
      expect(
        insights.trend.reduce(
          (sum: number, day: { investigations: number }) => {
            return sum + day.investigations;
          },
          0,
        ),
      ).toBe(3);
      expect(insights.coverage).toMatchObject({
        subjects: 3,
        investigatedSubjects: 3,
      });
    },
  );
});

describe("getMostCommonIds", () => {
  test("names the most common first, each incident counted once", () => {
    const subjects: Map<string, IncidentAlertAiSubjectInput> = new Map<
      string,
      IncidentAlertAiSubjectInput
    >([
      ["a", { id: "a", monitorIds: ["m1", "m1", "m2"], serviceIds: [] }],
      ["b", { id: "b", monitorIds: ["m2"], serviceIds: [] }],
      ["c", { id: "c", monitorIds: ["m3"], serviceIds: ["s1"] }],
    ]);

    expect(
      IncidentAlertAiInsightsReader.getMostCommonIds(subjects, "monitorIds"),
    ).toEqual(["m2", "m1", "m3"]);
    expect(
      IncidentAlertAiInsightsReader.getMostCommonIds(subjects, "serviceIds"),
    ).toEqual(["s1"]);
  });
});

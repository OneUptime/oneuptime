import IncidentAlertAiLogsReader, {
  INCIDENT_ALERT_AI_LOGS_MAX_ROUNDS,
  clipText,
  getJobCommand,
} from "../../../../../Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiLogsReader";
import AIRunAutoGrade from "../../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import {
  INCIDENT_ALERT_AI_LOGS_COMMAND_MAX_LENGTH,
  INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH,
  INCIDENT_ALERT_AI_SUBJECT_KINDS,
  IncidentAlertAiLogEntry,
  IncidentAlertAiLogKind,
  IncidentAlertAiLogs,
  IncidentAlertAiSubjectKind,
} from "../../../../../Types/AI/IncidentAlertAiLogs";
import AutoRemediationExecutionMode from "../../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import RunnerJobOrigin from "../../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../../Types/Runbook/RunnerJobStatus";
import {
  FakeCall,
  FakeRow,
  FakeStore,
  FakeTables,
  emptyTables,
  installFakeStore,
  matchesFilter,
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
 * IncidentAlertAiLogsReader: one page of everything OneUptime AI did for a
 * project's incidents or alerts - investigations, fixes, fix pull requests
 * and commands - read against an in-memory copy of the five tables behind
 * the real services' findBy.
 *
 * What it must get right: every entry is about an incident or alert the
 * caller may read; investigation runs (private to their author in the AI run
 * table) are read as root only to be shown next to such a subject; fixes and
 * commands follow their own tables' read access and are hidden, not empty,
 * without it; nothing outside the tenant is ever asked for; and the incident
 * page never shows an alert's work, nor the alert page an incident's.
 */

const PROJECT_ID: ObjectID = new ObjectID(uuid(1, 1));
const OTHER_PROJECT_ID: ObjectID = new ObjectID(uuid(1, 2));

const T: number = Date.parse("2026-10-05T10:00:00.000Z");

function ago(minutes: number): Date {
  return new Date(T - minutes * 60 * 1000);
}

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID(uuid(2, 1)),
  isMultiTenantRequest: false,
};

function incident(index: number, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: uuid(10, index),
    projectId: PROJECT_ID,
    createdAt: ago(1000 + index),
    title: `Incident ${index}`,
    incidentNumber: index,
    incidentNumberWithPrefix: `INC-${index}`,
    ...overrides,
  };
}

function alert(index: number, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: uuid(20, index),
    projectId: PROJECT_ID,
    createdAt: ago(1000 + index),
    title: `Alert ${index}`,
    alertNumber: index,
    alertNumberWithPrefix: `ALT-${index}`,
    ...overrides,
  };
}

function run(
  index: number,
  minutesAgo: number,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  return {
    _id: uuid(30, index),
    projectId: PROJECT_ID,
    createdAt: ago(minutesAgo),
    runType: AIRunType.Investigation,
    status: AIRunStatus.Completed,
    completedAt: ago(minutesAgo - 1),
    analysisTldr: `Finding ${index}`,
    ...overrides,
  };
}

function suggestion(
  index: number,
  minutesAgo: number,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  return {
    _id: uuid(40, index),
    projectId: PROJECT_ID,
    createdAt: ago(minutesAgo),
    status: AutoRemediationSuggestionStatus.Suggested,
    executionMode: AutoRemediationExecutionMode.Suggest,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    rationaleMarkdown: `Restart it (${index})`,
    verificationStatus: undefined,
    ...overrides,
  };
}

function job(
  index: number,
  minutesAgo: number,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  return {
    _id: uuid(50, index),
    projectId: PROJECT_ID,
    createdAt: ago(minutesAgo),
    origin: RunnerJobOrigin.AiInvestigation,
    status: RunnerJobStatus.Succeeded,
    payload: { displayCommand: `kubectl get pods # ${index}` },
    exitCode: 0,
    ...overrides,
  };
}

function idOf(row: FakeRow): ObjectID {
  return new ObjectID(row._id);
}

async function readLogs(
  subjectKind: IncidentAlertAiSubjectKind,
  overrides: Partial<{
    props: DatabaseCommonInteractionProps;
    before: Date;
    kinds: Array<IncidentAlertAiLogKind>;
    pageSize: number;
    scanLimit: number;
  }> = {},
): Promise<IncidentAlertAiLogs> {
  return IncidentAlertAiLogsReader.read({
    subjectKind,
    projectId: PROJECT_ID,
    props: overrides.props || CALLER,
    before: overrides.before,
    kinds: overrides.kinds,
    pageSize: overrides.pageSize,
    scanLimit: overrides.scanLimit,
  });
}

function entryIds(logs: IncidentAlertAiLogs): Array<string> {
  return logs.entries.map((entry: IncidentAlertAiLogEntry): string => {
    return `${entry.kind}:${entry.id}`;
  });
}

let tables: FakeTables;
let store: FakeStore;

beforeEach(() => {
  tables = emptyTables();
  store = installFakeStore(tables);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may read the record", () => {
  test.each(INCIDENT_ALERT_AI_SUBJECT_KINDS)(
    "a caller who may not read %ss at all is refused before anything else is read",
    async (subjectKind: IncidentAlertAiSubjectKind) => {
      store.access.canReadIncidents = subjectKind !== "incident";
      store.access.canReadAlerts = subjectKind !== "alert";

      await expect(readLogs(subjectKind)).rejects.toBeInstanceOf(
        NotAuthorizedException,
      );

      expect(store.callsTo("runs")).toEqual([]);
      expect(store.callsTo("suggestions")).toEqual([]);
      expect(store.callsTo("jobs")).toEqual([]);
    },
  );

  test("the gate is a read of the caller's own subjects, in the tenant, under the caller's props", async () => {
    await readLogs("incident");

    const gate: FakeCall = store.callsTo("incidents")[0]!;

    expect(gate.props).toBe(CALLER);
    expect(String(gate.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(gate.limit).toBe(1);
  });

  test("a caller who may read incidents but none of these has an empty record, not an error", async () => {
    tables.incidents.push(incident(1));
    tables.runs.push(
      run(1, 10, { triggeredByIncidentId: idOf(tables.incidents[0]!) }),
    );
    store.access.readableIncidentIds = new Set<string>();

    const logs: IncidentAlertAiLogs = await readLogs("incident");

    expect(logs.entries).toEqual([]);
    expect(logs.nextBefore).toBeNull();
  });
});

describe("investigations", () => {
  test("lists each investigation of a readable incident with its finding, verdicts and link", async () => {
    tables.incidents.push(incident(1));
    tables.runs.push(
      run(1, 10, {
        triggeredByIncidentId: idOf(tables.incidents[0]!),
        humanVerdict: AIRunHumanVerdict.Confirmed,
        autoGrade: AIRunAutoGrade.Match,
      }),
    );

    const logs: IncidentAlertAiLogs = await readLogs("incident");

    expect(logs.entries).toEqual([
      {
        kind: IncidentAlertAiLogKind.Investigation,
        id: tables.runs[0]!._id,
        at: ago(10).toISOString(),
        subject: {
          kind: "incident",
          id: tables.incidents[0]!._id,
          title: "Incident 1",
          number: 1,
          numberWithPrefix: "INC-1",
        },
        status: AIRunStatus.Completed,
        completedAt: ago(9).toISOString(),
        summary: "Finding 1",
        humanVerdict: AIRunHumanVerdict.Confirmed,
        autoGrade: AIRunAutoGrade.Match,
      },
    ]);
    expect(logs.hiddenKinds).toEqual([]);
    expect(logs.nextBefore).toBeNull();
  });

  test("reads runs as root - an investigation run is private to its author - but only investigation runs of the tenant", async () => {
    await readLogs("incident", {
      kinds: [IncidentAlertAiLogKind.Investigation],
    });

    const read: FakeCall = store.callsTo("runs")[0]!;

    expect(read.props).toEqual({ isRoot: true });
    expect(String(read.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(read.query["runType"]).toBe(AIRunType.Investigation);
    // Never the prompt trail or anything but what the page shows.
    expect(Object.keys(read.select).sort()).toEqual(
      [
        "_id",
        "analysisTldr",
        "autoGrade",
        "completedAt",
        "createdAt",
        "humanVerdict",
        "status",
        "triggeredByAlertId",
        "triggeredByIncidentId",
      ].sort(),
    );
  });

  test("leaves out an investigation of an incident the caller may not read, finding and all", async () => {
    tables.incidents.push(incident(1), incident(2, { isPrivate: true }));
    tables.runs.push(
      run(1, 10, { triggeredByIncidentId: idOf(tables.incidents[0]!) }),
      run(2, 5, { triggeredByIncidentId: idOf(tables.incidents[1]!) }),
    );
    store.access.readableIncidentIds = new Set<string>([
      tables.incidents[0]!._id,
    ]);

    const logs: IncidentAlertAiLogs = await readLogs("incident");

    expect(entryIds(logs)).toEqual([`Investigation:${tables.runs[0]!._id}`]);
    expect(JSON.stringify(logs)).not.toContain("Finding 2");
    expect(JSON.stringify(logs)).not.toContain("Incident 2");
  });

  test("reads the subjects under the caller's props, only the ones the page needs, in the tenant", async () => {
    tables.incidents.push(incident(1), incident(2));
    tables.runs.push(
      run(1, 10, { triggeredByIncidentId: idOf(tables.incidents[0]!) }),
    );

    await readLogs("incident");

    const subjectRead: FakeCall = store
      .callsTo("incidents")
      .find((call: FakeCall): boolean => {
        return Boolean(call.query["_id"]);
      })!;

    expect(subjectRead.props).toBe(CALLER);
    expect(String(subjectRead.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(
      tables.incidents.map((row: FakeRow): boolean => {
        return matchesFilter(row._id, subjectRead.query["_id"]);
      }),
    ).toEqual([true, false]);
  });

  test("a long finding is cut to the page's length", async () => {
    tables.incidents.push(incident(1));
    tables.runs.push(
      run(1, 10, {
        triggeredByIncidentId: idOf(tables.incidents[0]!),
        analysisTldr: "x".repeat(INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH * 2),
      }),
    );

    const logs: IncidentAlertAiLogs = await readLogs("incident");

    expect(logs.entries[0]!.summary!.length).toBe(
      INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH,
    );
    expect(logs.entries[0]!.summary!.endsWith("…")).toBe(true);
  });

  test("an investigation still running has no finding yet", async () => {
    tables.incidents.push(incident(1));
    tables.runs.push(
      run(1, 10, {
        triggeredByIncidentId: idOf(tables.incidents[0]!),
        status: AIRunStatus.Running,
        analysisTldr: undefined,
        completedAt: undefined,
      }),
    );

    const logs: IncidentAlertAiLogs = await readLogs("incident");

    expect(logs.entries[0]).toMatchObject({
      status: AIRunStatus.Running,
      summary: undefined,
      completedAt: undefined,
    });
  });
});

describe("the incident page and the alert page keep to their own", () => {
  beforeEach(() => {
    tables.incidents.push(incident(1));
    tables.alerts.push(alert(1));
    tables.runs.push(
      run(1, 10, { triggeredByIncidentId: idOf(tables.incidents[0]!) }),
      run(2, 20, { triggeredByAlertId: idOf(tables.alerts[0]!) }),
      // About both: the incident's.
      run(3, 30, {
        triggeredByIncidentId: idOf(tables.incidents[0]!),
        triggeredByAlertId: idOf(tables.alerts[0]!),
      }),
      // About neither (an insight's triage, a chat): nobody's.
      run(4, 40, {}),
    );
    tables.suggestions.push(
      suggestion(1, 11, { incidentId: idOf(tables.incidents[0]!) }),
      suggestion(2, 21, { alertId: idOf(tables.alerts[0]!) }),
    );
  });

  test("incidents: their investigations and fixes, the run about both included", async () => {
    const logs: IncidentAlertAiLogs = await readLogs("incident");

    expect(entryIds(logs)).toEqual([
      `Investigation:${tables.runs[0]!._id}`,
      `Fix:${tables.suggestions[0]!._id}`,
      `Investigation:${tables.runs[2]!._id}`,
    ]);
    expect(
      logs.entries.every((entry: IncidentAlertAiLogEntry): boolean => {
        return entry.subject.kind === "incident";
      }),
    ).toBe(true);
  });

  test("alerts: their investigations and fixes, never the run about an incident too", async () => {
    const logs: IncidentAlertAiLogs = await readLogs("alert");

    expect(entryIds(logs)).toEqual([
      `Investigation:${tables.runs[1]!._id}`,
      `Fix:${tables.suggestions[1]!._id}`,
    ]);
    expect(logs.entries[0]!.subject).toEqual({
      kind: "alert",
      id: tables.alerts[0]!._id,
      title: "Alert 1",
      number: 1,
      numberWithPrefix: "ALT-1",
    });
  });

  test("the alert page reads alerts, and never incidents, for its subjects", async () => {
    await readLogs("alert");

    expect(store.callsTo("incidents")).toEqual([]);
    expect(store.callsTo("alerts").length).toBeGreaterThan(0);
  });

  test.each([
    ["incident", "triggeredByIncidentId"],
    ["alert", "triggeredByAlertId"],
  ])(
    "the %s page asks for runs that name one",
    async (subjectKind: string, column: string) => {
      await readLogs(subjectKind as IncidentAlertAiSubjectKind, {
        kinds: [IncidentAlertAiLogKind.Investigation],
      });

      const query: Record<string, unknown> = store.callsTo("runs")[0]!.query;

      expect(matchesFilter(undefined, query[column])).toBe(false);
      expect(matchesFilter(new ObjectID(uuid(9, 9)), query[column])).toBe(true);
    },
  );
});

describe("fixes", () => {
  test("lists each fix with how it ran and how it turned out", async () => {
    tables.incidents.push(incident(1));
    tables.suggestions.push(
      suggestion(1, 10, {
        incidentId: idOf(tables.incidents[0]!),
        status: AutoRemediationSuggestionStatus.AutoExecuted,
        executionMode: AutoRemediationExecutionMode.FullAuto,
        suggestionType: AutoRemediationSuggestionType.Runbook,
        verificationStatus: AutoRemediationVerificationStatus.Verified,
        runbookNameSnapshot: "Restart web",
        ruleNameSnapshot: "Web down",
        commandPlan: { secret: "never sent" },
      }),
    );

    const logs: IncidentAlertAiLogs = await readLogs("incident");

    expect(logs.entries).toEqual([
      {
        kind: IncidentAlertAiLogKind.Fix,
        id: tables.suggestions[0]!._id,
        at: ago(10).toISOString(),
        subject: {
          kind: "incident",
          id: tables.incidents[0]!._id,
          title: "Incident 1",
          number: 1,
          numberWithPrefix: "INC-1",
        },
        status: AutoRemediationSuggestionStatus.AutoExecuted,
        suggestionType: AutoRemediationSuggestionType.Runbook,
        executionMode: AutoRemediationExecutionMode.FullAuto,
        rationale: "Restart it (1)",
        verificationStatus: AutoRemediationVerificationStatus.Verified,
        runbookName: "Restart web",
        ruleName: "Web down",
      },
    ]);
    expect(JSON.stringify(logs)).not.toContain("never sent");
  });

  test("are read under the caller's props, never the command plan", async () => {
    await readLogs("incident", { kinds: [IncidentAlertAiLogKind.Fix] });

    const read: FakeCall = store.callsTo("suggestions")[0]!;

    expect(read.props).toBe(CALLER);
    expect(String(read.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(read.select["commandPlan"]).toBeUndefined();
  });

  test("are hidden, not empty, for a role that may not read suggestions (a Viewer)", async () => {
    tables.incidents.push(incident(1));
    tables.suggestions.push(
      suggestion(1, 10, { incidentId: idOf(tables.incidents[0]!) }),
    );
    tables.runs.push(
      run(1, 20, { triggeredByIncidentId: idOf(tables.incidents[0]!) }),
    );
    store.access.canReadSuggestions = false;

    const logs: IncidentAlertAiLogs = await readLogs("incident");

    expect(logs.hiddenKinds).toEqual([IncidentAlertAiLogKind.Fix]);
    expect(entryIds(logs)).toEqual([`Investigation:${tables.runs[0]!._id}`]);
  });

  test("a failure that is not a refusal is not mistaken for one", async () => {
    store.access.canReadSuggestions = true;
    const { default: AutoRemediationSuggestionService } = await import(
      "../../../../../Server/Services/AutoRemediationSuggestionService"
    );
    jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockRejectedValue(new BadDataException("database down") as never);

    await expect(
      readLogs("incident", { kinds: [IncidentAlertAiLogKind.Fix] }),
    ).rejects.toBeInstanceOf(BadDataException);
  });
});

describe("fix pull requests", () => {
  test("lists each code fix task with its number and recipe", async () => {
    tables.incidents.push(incident(1));
    tables.runs.push(
      run(1, 10, {
        runType: AIRunType.CodeFix,
        triggeredByIncidentId: idOf(tables.incidents[0]!),
        codeFixTaskType: CodeFixTaskType.FixFromIncident,
        taskNumber: 12,
        analysisTldr: undefined,
      }),
      // An investigation is not a fix task.
      run(2, 11, { triggeredByIncidentId: idOf(tables.incidents[0]!) }),
    );

    const logs: IncidentAlertAiLogs = await readLogs("incident", {
      kinds: [IncidentAlertAiLogKind.FixTask],
    });

    expect(logs.entries).toEqual([
      {
        kind: IncidentAlertAiLogKind.FixTask,
        id: tables.runs[0]!._id,
        at: ago(10).toISOString(),
        subject: expect.objectContaining({ id: tables.incidents[0]!._id }),
        status: AIRunStatus.Completed,
        completedAt: ago(9).toISOString(),
        taskNumber: 12,
        codeFixTaskType: CodeFixTaskType.FixFromIncident,
      },
    ]);
    expect(store.callsTo("runs")[0]!.query["runType"]).toBe(AIRunType.CodeFix);
  });
});

describe("commands", () => {
  beforeEach(() => {
    tables.incidents.push(incident(1));
    tables.alerts.push(alert(1));
    tables.runs.push(
      run(1, 100, { triggeredByIncidentId: idOf(tables.incidents[0]!) }),
      run(2, 100, { triggeredByAlertId: idOf(tables.alerts[0]!) }),
      // A chat's run: about nothing.
      run(3, 100, { runType: AIRunType.Chat }),
      // A remediation run, about its suggestion's incident.
      run(4, 100, {
        runType: AIRunType.RemediationExecution,
        triggeredByAutoRemediationSuggestionId: new ObjectID(uuid(40, 9)),
      }),
    );
    tables.suggestions.push(
      suggestion(1, 100, { incidentId: idOf(tables.incidents[0]!) }),
      suggestion(9, 100, { incidentId: idOf(tables.incidents[0]!) }),
    );
  });

  test("lists the commands of an incident's investigations and fixes, and only those", async () => {
    tables.jobs.push(
      job(1, 1, { aiRunId: idOf(tables.runs[0]!) }),
      job(2, 2, { aiRunId: idOf(tables.runs[1]!) }),
      job(3, 3, { aiRunId: idOf(tables.runs[2]!) }),
      // A connection test: no run, no suggestion.
      job(4, 4, {}),
      job(5, 5, {
        origin: RunnerJobOrigin.AiRemediation,
        autoRemediationSuggestionId: idOf(tables.suggestions[0]!),
        aiRunId: idOf(tables.runs[3]!),
        payload: { command: "systemctl restart web" },
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "permission denied",
      }),
      // Its run is a remediation run: the suggestion it names decides.
      job(6, 6, {
        origin: RunnerJobOrigin.AiRemediation,
        aiRunId: idOf(tables.runs[3]!),
      }),
    );

    const logs: IncidentAlertAiLogs = await readLogs("incident", {
      kinds: [IncidentAlertAiLogKind.Command],
    });

    expect(entryIds(logs)).toEqual([
      `Command:${tables.jobs[0]!._id}`,
      `Command:${tables.jobs[4]!._id}`,
      `Command:${tables.jobs[5]!._id}`,
    ]);
    expect(logs.entries[1]).toEqual({
      kind: IncidentAlertAiLogKind.Command,
      id: tables.jobs[4]!._id,
      at: ago(5).toISOString(),
      subject: expect.objectContaining({ id: tables.incidents[0]!._id }),
      status: RunnerJobStatus.Failed,
      command: "systemctl restart web",
      commandOrigin: RunnerJobOrigin.AiRemediation,
      exitCode: 1,
      errorMessage: "permission denied",
    });
  });

  test("the alert page lists the commands of an alert's investigation", async () => {
    tables.jobs.push(
      job(1, 1, { aiRunId: idOf(tables.runs[0]!) }),
      job(2, 2, { aiRunId: idOf(tables.runs[1]!) }),
    );

    const logs: IncidentAlertAiLogs = await readLogs("alert", {
      kinds: [IncidentAlertAiLogKind.Command],
    });

    expect(entryIds(logs)).toEqual([`Command:${tables.jobs[1]!._id}`]);
  });

  test("reads jobs under the caller's props, only AI's, in the tenant; never their output", async () => {
    await readLogs("incident", { kinds: [IncidentAlertAiLogKind.Command] });

    const read: FakeCall = store.callsTo("jobs")[0]!;

    expect(read.props).toBe(CALLER);
    expect(String(read.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(matchesFilter(RunnerJobOrigin.Runbook, read.query["origin"])).toBe(
      false,
    );
    expect(
      matchesFilter(RunnerJobOrigin.AiInvestigation, read.query["origin"]),
    ).toBe(true);
    expect(
      matchesFilter(RunnerJobOrigin.AiRemediation, read.query["origin"]),
    ).toBe(true);
    expect(read.select["output"]).toBeUndefined();
  });

  test("looks up which incident a command was for as root, in the tenant", async () => {
    tables.jobs.push(job(1, 1, { aiRunId: idOf(tables.runs[0]!) }));

    await readLogs("incident", { kinds: [IncidentAlertAiLogKind.Command] });

    const lookup: FakeCall = store.callsTo("runs")[0]!;

    expect(lookup.props).toEqual({ isRoot: true });
    expect(String(lookup.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(Object.keys(lookup.select).sort()).toEqual(
      [
        "_id",
        "triggeredByAlertId",
        "triggeredByAutoRemediationSuggestionId",
        "triggeredByIncidentId",
      ].sort(),
    );
  });

  test("are hidden, not empty, for a role that may not read Runner jobs", async () => {
    store.access.canReadJobs = false;

    const logs: IncidentAlertAiLogs = await readLogs("incident");

    expect(logs.hiddenKinds).toEqual([IncidentAlertAiLogKind.Command]);
  });

  test("a command for an incident the caller may not read is left out", async () => {
    tables.jobs.push(job(1, 1, { aiRunId: idOf(tables.runs[0]!) }));
    store.access.readableIncidentIds = new Set<string>();

    const logs: IncidentAlertAiLogs = await readLogs("incident", {
      kinds: [IncidentAlertAiLogKind.Command],
    });

    expect(logs.entries).toEqual([]);
  });
});

describe("kinds", () => {
  test("only the kinds asked for are read", async () => {
    await readLogs("incident", { kinds: [IncidentAlertAiLogKind.Fix] });

    expect(store.callsTo("runs")).toEqual([]);
    expect(store.callsTo("jobs")).toEqual([]);
    expect(store.callsTo("suggestions")).toHaveLength(1);
  });

  test("every kind is read when none is named", async () => {
    await readLogs("incident");

    // Investigations and fix tasks are two run reads.
    expect(store.callsTo("runs")).toHaveLength(2);
    expect(store.callsTo("suggestions")).toHaveLength(1);
    expect(store.callsTo("jobs")).toHaveLength(1);
  });

  test("getKinds keeps the record's order and drops nothing it knows", () => {
    expect(
      IncidentAlertAiLogsReader.getKinds([
        IncidentAlertAiLogKind.Command,
        IncidentAlertAiLogKind.Investigation,
      ]),
    ).toEqual([
      IncidentAlertAiLogKind.Investigation,
      IncidentAlertAiLogKind.Command,
    ]);
    expect(IncidentAlertAiLogsReader.getKinds([])).toHaveLength(4);
    expect(IncidentAlertAiLogsReader.getKinds(undefined)).toHaveLength(4);
  });
});

describe("pages", () => {
  test("reads before the given moment, and says where the next page starts", async () => {
    tables.incidents.push(incident(1));
    for (let index: number = 1; index <= 5; index++) {
      tables.runs.push(
        run(index, index * 10, {
          triggeredByIncidentId: idOf(tables.incidents[0]!),
        }),
      );
    }

    const first: IncidentAlertAiLogs = await readLogs("incident", {
      kinds: [IncidentAlertAiLogKind.Investigation],
      pageSize: 2,
    });

    expect(entryIds(first)).toEqual([
      `Investigation:${tables.runs[0]!._id}`,
      `Investigation:${tables.runs[1]!._id}`,
    ]);
    expect(first.nextBefore).toBe(ago(20).toISOString());

    const second: IncidentAlertAiLogs = await readLogs("incident", {
      kinds: [IncidentAlertAiLogKind.Investigation],
      pageSize: 2,
      before: new Date(first.nextBefore!),
    });

    expect(entryIds(second)).toEqual([
      `Investigation:${tables.runs[2]!._id}`,
      `Investigation:${tables.runs[3]!._id}`,
    ]);

    const third: IncidentAlertAiLogs = await readLogs("incident", {
      kinds: [IncidentAlertAiLogKind.Investigation],
      pageSize: 2,
      before: new Date(second.nextBefore!),
    });

    expect(entryIds(third)).toEqual([`Investigation:${tables.runs[4]!._id}`]);
    expect(third.nextBefore).toBeNull();
  });

  test("reads further when a round's rows were about incidents the caller may not read", async () => {
    tables.incidents.push(incident(1), incident(2));
    // The newest five are about an unreadable incident.
    for (let index: number = 1; index <= 5; index++) {
      tables.runs.push(
        run(index, index, {
          triggeredByIncidentId: idOf(tables.incidents[1]!),
        }),
      );
    }
    tables.runs.push(
      run(6, 60, { triggeredByIncidentId: idOf(tables.incidents[0]!) }),
    );
    store.access.readableIncidentIds = new Set<string>([
      tables.incidents[0]!._id,
    ]);

    const logs: IncidentAlertAiLogs = await readLogs("incident", {
      kinds: [IncidentAlertAiLogKind.Investigation],
      scanLimit: 5,
    });

    expect(entryIds(logs)).toEqual([`Investigation:${tables.runs[5]!._id}`]);
  });

  test("stops after a few rounds, and says where to go on from", async () => {
    tables.incidents.push(incident(1), incident(2));
    for (let index: number = 1; index <= 40; index++) {
      tables.runs.push(
        run(index, index, {
          triggeredByIncidentId: idOf(tables.incidents[1]!),
        }),
      );
    }
    store.access.readableIncidentIds = new Set<string>([
      tables.incidents[0]!._id,
    ]);

    const logs: IncidentAlertAiLogs = await readLogs("incident", {
      kinds: [IncidentAlertAiLogKind.Investigation],
      scanLimit: 5,
    });

    expect(logs.entries).toEqual([]);
    expect(store.callsTo("runs")).toHaveLength(
      INCIDENT_ALERT_AI_LOGS_MAX_ROUNDS,
    );
    /*
     * Three rounds of five. Each round leaves the millisecond of its oldest
     * row to the next one, which reads it again: the rounds reach the 5th,
     * 9th and 13th run, and the next page goes on from the 13th.
     */
    expect(logs.nextBefore).toBe(new Date(ago(13).getTime() + 1).toISOString());
  });
});

describe("tenant isolation", () => {
  test("a row of another project is never read, whatever the caller may read", async () => {
    tables.incidents.push(incident(1, { projectId: OTHER_PROJECT_ID }));
    tables.runs.push(
      run(1, 10, {
        projectId: OTHER_PROJECT_ID,
        triggeredByIncidentId: idOf(tables.incidents[0]!),
      }),
    );
    tables.suggestions.push(
      suggestion(1, 10, {
        projectId: OTHER_PROJECT_ID,
        incidentId: idOf(tables.incidents[0]!),
      }),
    );
    tables.jobs.push(
      job(1, 10, {
        projectId: OTHER_PROJECT_ID,
        aiRunId: idOf(tables.runs[0]!),
      }),
    );

    const logs: IncidentAlertAiLogs = await readLogs("incident");

    expect(logs.entries).toEqual([]);

    for (const call of store.calls) {
      expect(String(call.query["projectId"])).toBe(PROJECT_ID.toString());
    }
  });
});

describe("clipText", () => {
  test("trims, and leaves short text as it is", () => {
    expect(clipText("  ok  ", 10)).toBe("ok");
  });

  test("cuts long text to the length, ending with an ellipsis", () => {
    expect(clipText("abcdefghij", 5)).toBe("abcd…");
  });

  test("is undefined for nothing", () => {
    expect(clipText("   ", 5)).toBeUndefined();
    expect(clipText(undefined, 5)).toBeUndefined();
    expect(clipText(null, 5)).toBeUndefined();
  });
});

describe("getJobCommand", () => {
  test("prefers the displayed command, then an SSH command, then a Bash script", () => {
    expect(
      getJobCommand({
        payload: { displayCommand: "kubectl get pods", command: "x" },
        script: "y",
      }),
    ).toBe("kubectl get pods");
    expect(getJobCommand({ payload: { command: "uptime" }, script: "" })).toBe(
      "uptime",
    );
    expect(getJobCommand({ payload: null, script: "df -h" })).toBe("df -h");
  });

  test("has nothing to show for a job without a command", () => {
    expect(getJobCommand({ payload: {}, script: "" })).toBeUndefined();
    expect(getJobCommand({ payload: { displayCommand: 5 } })).toBeUndefined();
  });

  test("cuts a long command", () => {
    expect(getJobCommand({ script: "a".repeat(5000) })!.length).toBe(
      INCIDENT_ALERT_AI_LOGS_COMMAND_MAX_LENGTH,
    );
  });
});

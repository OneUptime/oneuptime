import ReplayCorpus, {
  DEFAULT_REPLAY_LIMIT,
  ReplayCase,
} from "../../../../../Server/Utils/AI/Eval/ReplayCorpus";
import PostedRootCause from "../../../../../Server/Utils/AI/SRE/PostedRootCause";
import AIRunRecordingService from "../../../../../Server/Services/AIRunRecordingService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AlertService from "../../../../../Server/Services/AlertService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunRecording from "../../../../../Models/DatabaseModels/AIRunRecording";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import AIRunAutoGrade from "../../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import {
  INVESTIGATION_RECORDING_VERSION,
  InvestigationRecording,
} from "../../../../../Types/AI/InvestigationRecording";
import AIAgentRunLimitsHelper from "../../../../../Types/AI/AIAgentRunLimits";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../../../Types/Database/LimitMax";
import ObjectID from "../../../../../Types/ObjectID";
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
 * THE RUNS A REPLAY CAN RUN AGAIN (issue #6800): completed incident and
 * alert investigations that kept a recording, newest recording first, with
 * the root cause people wrote for the incident or alert and how the
 * original run was graded. Read as the system, from the command line.
 *
 * Under test, with the services' reads replaced: which recordings it takes
 * (newest first, the limit, one project or all), that only completed
 * Investigation runs become cases (a recording of a run that is not, or of
 * a run with no incident or alert, is left out), what a case carries, the
 * root cause read from the incident or the alert, and how a case's
 * recording and original analysis are read.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "99999999-9999-4999-8999-999999999999";
const RUN_A: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_B: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN_C: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const INCIDENT_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ALERT_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const COMPLETED_AT: Date = new Date("2026-11-10T08:41:12.000Z");

function recordingRow(
  runId: string,
  projectId: string = PROJECT_ID,
): AIRunRecording {
  const row: AIRunRecording = new AIRunRecording();
  row.aiRunId = new ObjectID(runId);
  row.projectId = new ObjectID(projectId);
  return row;
}

function run(
  runId: string,
  fields: {
    incidentId?: string | undefined;
    alertId?: string | undefined;
    // Null: a run whose project cannot be read.
    projectId?: string | null | undefined;
    completedAt?: Date | undefined;
    autoGrade?: AIRunAutoGrade | undefined;
    humanVerdict?: AIRunHumanVerdict | undefined;
  } = {},
): AIRun {
  const row: AIRun = new AIRun(new ObjectID(runId));

  if (fields.projectId !== null) {
    row.projectId = new ObjectID(fields.projectId || PROJECT_ID);
  }

  if (fields.incidentId) {
    row.triggeredByIncidentId = new ObjectID(fields.incidentId);
  }

  if (fields.alertId) {
    row.triggeredByAlertId = new ObjectID(fields.alertId);
  }

  if (fields.completedAt) {
    row.completedAt = fields.completedAt;
  }

  if (fields.autoGrade) {
    row.autoGrade = fields.autoGrade;
  }

  if (fields.humanVerdict) {
    row.humanVerdict = fields.humanVerdict;
  }

  row.llmCallCount = 7;
  row.toolCallCount = 12;
  row.totalTokens = 48_000;
  return row;
}

function incident(rootCause: string | undefined): Incident {
  const row: Incident = new Incident(new ObjectID(INCIDENT_ID));

  if (rootCause !== undefined) {
    row.rootCause = rootCause;
  }

  return row;
}

function alert(rootCause: string | undefined): Alert {
  const row: Alert = new Alert(new ObjectID(ALERT_ID));

  if (rootCause !== undefined) {
    row.rootCause = rootCause;
  }

  return row;
}

// The run ids a QueryHelper.any(...) filter holds.
function idsIn(operator: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (operator as { objectLiteralParameters?: Record<string, unknown> })
      .objectLiteralParameters || {};

  return (Object.values(parameters)[0] as Array<string>) || [];
}

describe("ReplayCorpus.listCases", () => {
  let findRecordings: SpyInstance<typeof AIRunRecordingService.findBy>;
  let findRuns: SpyInstance<typeof AIRunService.findBy>;
  let findIncident: SpyInstance<typeof IncidentService.findOneById>;
  let findAlert: SpyInstance<typeof AlertService.findOneById>;

  beforeEach(() => {
    findRecordings = jest
      .spyOn(AIRunRecordingService, "findBy")
      .mockResolvedValue([]);
    findRuns = jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    findIncident = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident("The pool was cut from 40 to 10."));
    findAlert = jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(alert("A bad deploy of checkout-api."));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("takes the newest recordings first, as the system, the default number of them", async () => {
    await ReplayCorpus.listCases({});

    expect(findRecordings).toHaveBeenCalledTimes(1);
    expect(findRecordings.mock.calls[0]![0]).toEqual({
      query: {},
      select: { aiRunId: true, projectId: true },
      sort: { createdAt: SortOrder.Descending },
      limit: DEFAULT_REPLAY_LIMIT,
      skip: 0,
      props: { isRoot: true },
    });
    expect(DEFAULT_REPLAY_LIMIT).toBe(20);
  });

  test("one project's, when one is named", async () => {
    const projectId: ObjectID = new ObjectID(PROJECT_ID);

    await ReplayCorpus.listCases({ projectId });

    expect(findRecordings.mock.calls[0]![0].query).toEqual({ projectId });
  });

  test.each([
    [5, 5],
    [0, DEFAULT_REPLAY_LIMIT],
    [-4, 1],
    [LIMIT_MAX + 1, LIMIT_MAX],
  ])(
    "a limit of %p reads %p: at least one, never past the read limit",
    async (limit: number, taken: number) => {
      await ReplayCorpus.listCases({ limit });

      expect(findRecordings.mock.calls[0]![0].limit).toBe(taken);
    },
  );

  test("no recordings, no runs read and no cases", async () => {
    expect(await ReplayCorpus.listCases({})).toEqual([]);
    expect(findRuns).not.toHaveBeenCalled();
  });

  test("reads only the recorded runs, and only completed Investigation runs among them, newest completed first", async () => {
    findRecordings.mockResolvedValue([
      recordingRow(RUN_B),
      recordingRow(RUN_A),
      // A run that kept two recordings is one case.
      recordingRow(RUN_B),
      // A recording whose run id cannot be read is none.
      new AIRunRecording(),
    ]);

    await ReplayCorpus.listCases({});

    expect(findRuns).toHaveBeenCalledTimes(1);

    const sent: Parameters<typeof AIRunService.findBy>[0] =
      findRuns.mock.calls[0]![0];
    const query: Record<string, unknown> = sent.query as Record<
      string,
      unknown
    >;

    expect(idsIn(query["_id"])).toEqual([RUN_B, RUN_A]);
    expect(query["runType"]).toBe(AIRunType.Investigation);
    expect(query["status"]).toBe(AIRunStatus.Completed);
    expect(sent.sort).toEqual({ completedAt: SortOrder.Descending });
    expect(sent.limit).toBe(2);
    expect(sent.props).toEqual({ isRoot: true });
    expect(sent.select).toEqual(
      expect.objectContaining({
        _id: true,
        projectId: true,
        completedAt: true,
        humanVerdict: true,
        autoGrade: true,
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
        llmCallCount: true,
        toolCallCount: true,
        totalTokens: true,
      }),
    );
  });

  test("an incident's run: its root cause, its grades, its counts, in the order the runs were read", async () => {
    findRecordings.mockResolvedValue([
      recordingRow(RUN_A),
      recordingRow(RUN_B),
    ]);
    findRuns.mockResolvedValue([
      run(RUN_A, {
        incidentId: INCIDENT_ID,
        completedAt: COMPLETED_AT,
        autoGrade: AIRunAutoGrade.Partial,
        humanVerdict: AIRunHumanVerdict.Confirmed,
      }),
      run(RUN_B, { alertId: ALERT_ID }),
    ]);

    const cases: Array<ReplayCase> = await ReplayCorpus.listCases({});

    expect(cases).toEqual([
      {
        runId: RUN_A,
        projectId: PROJECT_ID,
        subjectType: "Incident",
        subjectId: INCIDENT_ID,
        completedAt: "2026-11-10T08:41:12.000Z",
        rootCause: "The pool was cut from 40 to 10.",
        original: {
          autoGrade: AIRunAutoGrade.Partial,
          humanVerdict: AIRunHumanVerdict.Confirmed,
          llmCallCount: 7,
          toolCallCount: 12,
          totalTokens: 48_000,
        },
      },
      {
        runId: RUN_B,
        projectId: PROJECT_ID,
        subjectType: "Alert",
        subjectId: ALERT_ID,
        rootCause: "A bad deploy of checkout-api.",
        original: {
          autoGrade: undefined,
          humanVerdict: undefined,
          llmCallCount: 7,
          toolCallCount: 12,
          totalTokens: 48_000,
        },
      },
    ]);
    // A run with no completion time names none.
    expect(Object.keys(cases[1]!)).not.toContain("completedAt");
  });

  test("the root cause is read from the incident or the alert, as the system", async () => {
    findRecordings.mockResolvedValue([
      recordingRow(RUN_A),
      recordingRow(RUN_B),
    ]);
    findRuns.mockResolvedValue([
      run(RUN_A, { incidentId: INCIDENT_ID }),
      run(RUN_B, { alertId: ALERT_ID }),
    ]);

    await ReplayCorpus.listCases({});

    expect(findIncident).toHaveBeenCalledWith({
      id: new ObjectID(INCIDENT_ID),
      select: { rootCause: true },
      props: { isRoot: true },
    });
    expect(findAlert).toHaveBeenCalledWith({
      id: new ObjectID(ALERT_ID),
      select: { rootCause: true },
      props: { isRoot: true },
    });
  });

  test("a root cause is trimmed; none written, blank, or the record gone reads as null", async () => {
    findRecordings.mockResolvedValue([recordingRow(RUN_A)]);
    findRuns.mockResolvedValue([run(RUN_A, { incidentId: INCIDENT_ID })]);

    for (const [found, rootCause] of [
      [incident("  The pool was cut.\n"), "The pool was cut."],
      [incident(undefined), null],
      [incident("   "), null],
      [null, null],
    ] as Array<[Incident | null, string | null]>) {
      findIncident.mockResolvedValueOnce(found);

      expect((await ReplayCorpus.listCases({}))[0]!.rootCause).toBe(rootCause);
    }
  });

  test("a run that names an incident is an incident's, even when it names an alert too", async () => {
    findRecordings.mockResolvedValue([recordingRow(RUN_A)]);
    findRuns.mockResolvedValue([
      run(RUN_A, { incidentId: INCIDENT_ID, alertId: ALERT_ID }),
    ]);

    const cases: Array<ReplayCase> = await ReplayCorpus.listCases({});

    expect(cases[0]!.subjectType).toBe("Incident");
    expect(cases[0]!.subjectId).toBe(INCIDENT_ID);
    expect(findAlert).not.toHaveBeenCalled();
  });

  test("a run with no incident or alert, or no id or project, is no case", async () => {
    const noId: AIRun = new AIRun();
    noId.projectId = new ObjectID(PROJECT_ID);
    noId.triggeredByIncidentId = new ObjectID(INCIDENT_ID);

    findRecordings.mockResolvedValue([
      recordingRow(RUN_A),
      recordingRow(RUN_B),
      recordingRow(RUN_C),
    ]);
    findRuns.mockResolvedValue([
      run(RUN_A),
      run(RUN_B, { alertId: ALERT_ID, projectId: OTHER_PROJECT_ID }),
      run(RUN_C, { incidentId: INCIDENT_ID, projectId: null }),
      noId,
    ]);

    const cases: Array<ReplayCase> = await ReplayCorpus.listCases({});

    expect(
      cases.map((replayCase: ReplayCase): string => {
        return `${replayCase.runId} ${replayCase.projectId}`;
      }),
    ).toEqual([`${RUN_B} ${OTHER_PROJECT_ID}`]);
  });

  test("a recorded run that is not a completed investigation is not read back: no case", async () => {
    findRecordings.mockResolvedValue([
      recordingRow(RUN_A),
      recordingRow(RUN_B),
    ]);
    // The database leaves out the runs the query does not match.
    findRuns.mockResolvedValue([run(RUN_B, { incidentId: INCIDENT_ID })]);

    const cases: Array<ReplayCase> = await ReplayCorpus.listCases({});

    expect(
      cases.map((replayCase: ReplayCase): string => {
        return replayCase.runId;
      }),
    ).toEqual([RUN_B]);
  });
});

describe("ReplayCorpus.getRecording and getOriginalAnalysis", () => {
  const INCIDENT_CASE: ReplayCase = {
    runId: RUN_A,
    projectId: PROJECT_ID,
    subjectType: "Incident",
    subjectId: INCIDENT_ID,
    completedAt: "2026-11-10T08:41:12.000Z",
    rootCause: "The pool was cut from 40 to 10.",
    original: {},
  };

  const ALERT_CASE: ReplayCase = {
    runId: RUN_B,
    projectId: PROJECT_ID,
    subjectType: "Alert",
    subjectId: ALERT_ID,
    rootCause: null,
    original: {},
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a case's recording is its run's, in its project", async () => {
    const recording: InvestigationRecording = {
      version: INVESTIGATION_RECORDING_VERSION,
      inputs: {
        contextText: "# Incident",
        aiContext: null,
        promptTime: "2026-11-10T08:30:00.000Z",
        runLimits: AIAgentRunLimitsHelper.getDefault(),
        maxOutputTokens: 4096,
        excludedToolNames: [],
        extraTools: [],
      },
      toolCalls: [],
      toolCallsNotKept: 0,
    };
    const getForRun: SpyInstance<typeof AIRunRecordingService.getForRun> = jest
      .spyOn(AIRunRecordingService, "getForRun")
      .mockResolvedValue(recording);

    expect(await ReplayCorpus.getRecording(INCIDENT_CASE)).toBe(recording);
    expect(getForRun).toHaveBeenCalledWith({
      projectId: new ObjectID(PROJECT_ID),
      aiRunId: new ObjectID(RUN_A),
    });
  });

  test("the original analysis is the one that run posted on its incident", async () => {
    const getForInvestigation: SpyInstance<
      typeof PostedRootCause.getForInvestigation
    > = jest
      .spyOn(PostedRootCause, "getForInvestigation")
      .mockResolvedValue("## Analysis");

    expect(await ReplayCorpus.getOriginalAnalysis(INCIDENT_CASE)).toBe(
      "## Analysis",
    );
    expect(getForInvestigation).toHaveBeenCalledWith({
      incidentId: new ObjectID(INCIDENT_ID),
      aiRunId: new ObjectID(RUN_A),
      runCompletedAt: new Date("2026-11-10T08:41:12.000Z"),
    });
  });

  test("on its alert, for an alert's run; no completion time, none sent", async () => {
    const getForInvestigation: SpyInstance<
      typeof PostedRootCause.getForInvestigation
    > = jest
      .spyOn(PostedRootCause, "getForInvestigation")
      .mockResolvedValue(null);

    expect(await ReplayCorpus.getOriginalAnalysis(ALERT_CASE)).toBeNull();
    expect(getForInvestigation).toHaveBeenCalledWith({
      alertId: new ObjectID(ALERT_ID),
      aiRunId: new ObjectID(RUN_B),
      runCompletedAt: undefined,
    });

    const sent: Record<string, unknown> = getForInvestigation.mock
      .calls[0]![0] as unknown as Record<string, unknown>;

    expect(Object.keys(sent)).not.toContain("incidentId");
  });
});

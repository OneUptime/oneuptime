import { mockRouter } from "./Helpers";
import {
  ANALYSIS_COMPLETION_CLOCK_SKEW_MS,
  ANALYSIS_FINALIZATION_TIMEOUT_MS,
  isAnalysisPendingForRun,
} from "../../../Server/API/AIInvestigationAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIRunService from "../../../Server/Services/AIRunService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import PostedRootCause from "../../../Server/Utils/AI/SRE/PostedRootCause";
import FixFromIncidentTaskTrigger from "../../../Server/Utils/AI/SRE/FixFromIncidentTaskTrigger";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunHumanVerdict from "../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
  };
});

const INCIDENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const ALERT_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const USER_ID: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const PROJECT_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);

const props: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

function investigationRun(data: {
  status: AIRunStatus;
  createdAt?: Date | undefined;
  completedAt?: Date | undefined;
  analysisTldr?: string | undefined;
}): AIRun {
  const run: AIRun = new AIRun(
    new ObjectID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
  );
  run.status = data.status;
  if (data.createdAt) {
    run.createdAt = data.createdAt;
  }
  if (data.completedAt) {
    run.completedAt = data.completedAt;
  }
  if (data.analysisTldr !== undefined) {
    run.analysisTldr = data.analysisTldr;
  }
  return run;
}

function investigationEvent(eventType: AIRunEventType): AIRunEvent {
  const event: AIRunEvent = new AIRunEvent();
  event.eventType = eventType;
  return event;
}

function requestFor(body: JSONObject): ExpressRequest {
  return {
    body,
  } as unknown as ExpressRequest;
}

function response(): ExpressResponse {
  return {} as ExpressResponse;
}

function sentPayload(): JSONObject {
  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  return send.mock.calls[0]![2] as JSONObject;
}

async function callIncidentRoute(data?: {
  run?: AIRun | undefined;
  events?: Array<AIRunEvent> | undefined;
  analysisMarkdown?: string | null | undefined;
}): Promise<void> {
  const run: AIRun | undefined = data?.run;
  jest.spyOn(AIRunService, "findBy").mockResolvedValue(run ? [run] : []);
  jest
    .spyOn(PostedRootCause, "getForInvestigation")
    .mockResolvedValue(data?.analysisMarkdown ?? null);
  jest.spyOn(AIRunEventService, "findBy").mockResolvedValue(data?.events || []);

  const req: ExpressRequest = requestFor({
    incidentId: INCIDENT_ID.toString(),
  });
  const res: ExpressResponse = response();
  const next: ReturnType<typeof jest.fn> = jest.fn();

  await mockRouter
    .match("post", "/ai-investigation/incident")
    .handlerFunction(req, res, next as unknown as NextFunction);
}

describe("AIInvestigationAPI latest-investigation payload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(new Incident(INCIDENT_ID));
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(new Alert(ALERT_ID));
    jest.spyOn(AIRunEventService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns an explicit empty analysis state when no investigation exists", async () => {
    await callIncidentRoute();

    expect(sentPayload()).toEqual({
      run: null,
      events: [],
      analysisMarkdown: null,
      analysisTldr: null,
      isAnalysisPending: false,
    });
    expect(PostedRootCause.getForInvestigation).not.toHaveBeenCalled();
  });

  it.each([
    AIRunStatus.Queued,
    AIRunStatus.Running,
    AIRunStatus.Error,
    AIRunStatus.Cancelled,
    AIRunStatus.Stale,
  ])(
    "does not read or report a final analysis for a %s run",
    async (status: AIRunStatus) => {
      await callIncidentRoute({
        run: investigationRun({
          status,
          createdAt: new Date("2026-08-07T10:00:00.000Z"),
          completedAt: new Date(),
        }),
      });

      expect(PostedRootCause.getForInvestigation).not.toHaveBeenCalled();
      expect(sentPayload()).toEqual(
        expect.objectContaining({
          analysisMarkdown: null,
          isAnalysisPending: false,
        }),
      );
    },
  );

  it("returns the completed run's exactly associated analysis", async () => {
    const run: AIRun = investigationRun({
      status: AIRunStatus.Completed,
      createdAt: new Date("2026-08-07T09:55:00.000Z"),
      completedAt: new Date("2026-08-07T10:00:00.000Z"),
    });
    await callIncidentRoute({
      run,
      analysisMarkdown:
        "## Current investigation\nDatabase connections are exhausted.",
    });

    expect(PostedRootCause.getForInvestigation).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      aiRunId: run.id,
      runCompletedAt: run.completedAt,
    });
    expect(sentPayload()).toEqual(
      expect.objectContaining({
        analysisMarkdown:
          "## Current investigation\nDatabase connections are exhausted.",
        isAnalysisPending: false,
      }),
    );
  });

  /*
   * The TL;DR summarizes the report, so the payload must never carry one
   * without the report it describes — a reader would otherwise see a claim
   * with nothing to check it against.
   */
  it("returns the stored TL;DR alongside a published report", async () => {
    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-08-07T09:55:00.000Z"),
        completedAt: new Date("2026-08-07T10:00:00.000Z"),
        analysisTldr: "The checkout API is failing on an exhausted pool.",
      }),
      analysisMarkdown: "## Current investigation\nPool exhausted.",
    });

    expect(sentPayload()).toEqual(
      expect.objectContaining({
        analysisTldr: "The checkout API is failing on an exhausted pool.",
      }),
    );
  });

  /*
   * The column is selected, so it also travels inside the serialized run.
   * Both copies must obey the same gate — otherwise a client reading
   * run.analysisTldr shows a summary of a report the payload does not carry.
   */
  it("applies the report gate to the serialized run as well as the top-level field", async () => {
    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-08-07T10:00:00.000Z"),
        completedAt: new Date(Date.now() - 1000),
        analysisTldr: "The checkout API is failing on an exhausted pool.",
      }),
    });

    const payload: JSONObject = sentPayload();
    expect(payload["analysisTldr"]).toBeNull();
    expect((payload["run"] as JSONObject)["analysisTldr"]).toBeNull();
  });

  it("carries the same TL;DR in the run and at the top level once the report exists", async () => {
    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-08-07T09:55:00.000Z"),
        completedAt: new Date("2026-08-07T10:00:00.000Z"),
        analysisTldr: "The checkout API is failing on an exhausted pool.",
      }),
      analysisMarkdown: "## Current investigation\nPool exhausted.",
    });

    const payload: JSONObject = sentPayload();
    expect(payload["analysisTldr"]).toBe(
      "The checkout API is failing on an exhausted pool.",
    );
    expect((payload["run"] as JSONObject)["analysisTldr"]).toBe(
      payload["analysisTldr"],
    );
  });

  it("normalizes the run's blank TL;DR to null too", async () => {
    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-08-07T09:55:00.000Z"),
        completedAt: new Date("2026-08-07T10:00:00.000Z"),
        analysisTldr: "   ",
      }),
      analysisMarkdown: "## Current investigation\nPool exhausted.",
    });

    expect((sentPayload()["run"] as JSONObject)["analysisTldr"]).toBeNull();
  });

  /*
   * The route always returns the LATEST run, while the report is bound to
   * that run's id. A re-investigation therefore replaces both — and must not
   * leave the previous run's summary on screen describing an analysis the
   * payload no longer carries.
   */
  it("never shows a previous run's summary once a new run supersedes it", async () => {
    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Running,
        createdAt: new Date("2026-08-07T11:00:00.000Z"),
      }),
    });

    const payload: JSONObject = sentPayload();
    expect(payload["analysisMarkdown"]).toBeNull();
    expect(payload["analysisTldr"]).toBeNull();
    expect((payload["run"] as JSONObject)["analysisTldr"]).toBeNull();
  });

  it("selects the TL;DR column so a live panel can render it", async () => {
    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-08-07T09:55:00.000Z"),
        completedAt: new Date("2026-08-07T10:00:00.000Z"),
      }),
      analysisMarkdown: "## Current investigation\nPool exhausted.",
    });

    expect(AIRunService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ analysisTldr: true }),
      }),
    );
  });

  it("withholds the TL;DR while the report is still being published", async () => {
    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-08-07T10:00:00.000Z"),
        completedAt: new Date(Date.now() - 1000),
        analysisTldr: "The checkout API is failing on an exhausted pool.",
      }),
    });

    expect(sentPayload()).toEqual(
      expect.objectContaining({
        analysisMarkdown: null,
        analysisTldr: null,
        isAnalysisPending: true,
      }),
    );
  });

  it("normalizes a blank stored TL;DR to null so the panel has one empty shape", async () => {
    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-08-07T09:55:00.000Z"),
        completedAt: new Date("2026-08-07T10:00:00.000Z"),
        analysisTldr: "   \n  ",
      }),
      analysisMarkdown: "## Current investigation\nPool exhausted.",
    });

    expect(sentPayload()).toEqual(
      expect.objectContaining({ analysisTldr: null }),
    );
  });

  it("reports no TL;DR for a legacy run that predates the column", async () => {
    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-08-07T09:55:00.000Z"),
        completedAt: new Date("2026-08-07T10:00:00.000Z"),
      }),
      analysisMarkdown: "## Current investigation\nPool exhausted.",
    });

    expect(sentPayload()).toEqual(
      expect.objectContaining({ analysisTldr: null }),
    );
  });

  it.each([AIRunStatus.Running, AIRunStatus.Error])(
    "never reports a TL;DR for a %s run",
    async (status: AIRunStatus) => {
      await callIncidentRoute({
        run: investigationRun({
          status,
          createdAt: new Date("2026-08-07T09:55:00.000Z"),
          completedAt: new Date("2026-08-07T10:00:00.000Z"),
          analysisTldr: "The checkout API is failing on an exhausted pool.",
        }),
      });

      expect(sentPayload()).toEqual(
        expect.objectContaining({ analysisTldr: null }),
      );
    },
  );

  it("returns a branded pre-migration report through the null-associated legacy path", async () => {
    const run: AIRun = investigationRun({
      status: AIRunStatus.Completed,
      createdAt: new Date("2026-08-08T09:55:00.000Z"),
      completedAt: new Date("2026-08-08T10:00:00.000Z"),
    });
    const legacyReport: string =
      "## AI — Automated Root Cause Analysis\n\nLegacy database evidence.";

    await callIncidentRoute({
      run,
      events: [investigationEvent(AIRunEventType.RunCompleted)],
      analysisMarkdown: legacyReport,
    });

    expect(PostedRootCause.getForInvestigation).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      aiRunId: run.id,
      runCompletedAt: run.completedAt,
    });
    expect(sentPayload()).toEqual(
      expect.objectContaining({
        analysisMarkdown: legacyReport,
        isAnalysisPending: false,
      }),
    );
  });

  it("reports a recent completed run as pending while its feed item is being posted", async () => {
    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-08-07T10:00:00.000Z"),
        completedAt: new Date(Date.now() - 1000),
      }),
    });

    expect(sentPayload()).toEqual(
      expect.objectContaining({
        analysisMarkdown: null,
        isAnalysisPending: true,
      }),
    );
  });

  it("stops reporting pending after the finalization crash failsafe", async () => {
    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-08-07T10:00:00.000Z"),
        completedAt: new Date(
          Date.now() - ANALYSIS_FINALIZATION_TIMEOUT_MS - 1000,
        ),
      }),
    });

    expect(sentPayload()).toEqual(
      expect.objectContaining({
        analysisMarkdown: null,
        isAnalysisPending: false,
      }),
    );
  });

  it("never falls back to an unscoped feed lookup when completedAt is absent", async () => {
    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-08-07T10:00:00.000Z"),
      }),
    });

    expect(PostedRootCause.getForInvestigation).not.toHaveBeenCalled();
    expect(sentPayload()).toEqual(
      expect.objectContaining({
        analysisMarkdown: null,
        isAnalysisPending: false,
      }),
    );
  });

  it("uses the exact run association on the alert route", async () => {
    const runCreatedAt: Date = new Date("2026-08-07T10:55:00.000Z");
    const runCompletedAt: Date = new Date("2026-08-07T11:00:00.000Z");
    const run: AIRun = investigationRun({
      status: AIRunStatus.Completed,
      createdAt: runCreatedAt,
      completedAt: runCompletedAt,
    });
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([run]);
    jest
      .spyOn(PostedRootCause, "getForInvestigation")
      .mockResolvedValue("Alert investigation result");

    const req: ExpressRequest = requestFor({ alertId: ALERT_ID.toString() });
    const res: ExpressResponse = response();
    const next: ReturnType<typeof jest.fn> = jest.fn();

    await mockRouter
      .match("post", "/ai-investigation/alert")
      .handlerFunction(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(PostedRootCause.getForInvestigation).toHaveBeenCalledWith({
      alertId: ALERT_ID,
      aiRunId: run.id,
      runCompletedAt: run.completedAt,
    });
    expect(sentPayload()).toEqual(
      expect.objectContaining({
        analysisMarkdown: "Alert investigation result",
        isAnalysisPending: false,
      }),
    );
  });

  it("preserves the subject access check before reading a run or analysis", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null);
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    jest.spyOn(PostedRootCause, "getForInvestigation").mockResolvedValue(null);

    const req: ExpressRequest = requestFor({
      incidentId: INCIDENT_ID.toString(),
    });
    const res: ExpressResponse = response();
    const next: ReturnType<typeof jest.fn> = jest.fn();

    await mockRouter
      .match("post", "/ai-investigation/incident")
      .handlerFunction(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledWith(
      new BadDataException(
        "Incident not found (or you do not have access to it).",
      ),
    );
    expect(AIRunService.findBy).not.toHaveBeenCalled();
    expect(PostedRootCause.getForInvestigation).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("AIInvestigationAPI run-scoped actions", () => {
  const investigationRunId: ObjectID = new ObjectID(
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  );
  const fixRunId: ObjectID = new ObjectID(
    "ffffffff-ffff-4fff-8fff-ffffffffffff",
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);

    const incident: Incident = new Incident(INCIDENT_ID);
    incident.projectId = PROJECT_ID;
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);

    const alert: Alert = new Alert(ALERT_ID);
    alert.projectId = PROJECT_ID;
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert);
    jest
      .spyOn(AIRunService, "applyHumanVerdictToInvestigation")
      .mockResolvedValue({
        runId: investigationRunId,
        verdict: AIRunHumanVerdict.Confirmed,
      });
    jest
      .spyOn(FixFromIncidentTaskTrigger, "createFixTaskFromInvestigation")
      .mockResolvedValue(new AIRun(fixRunId));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(["/ai-investigation/verdict", "/ai-investigation/create-fix-task"])(
    "rejects a malformed aiRunId on %s before any subject read",
    async (path: string) => {
      const req: ExpressRequest = requestFor({
        subjectType: "incident",
        subjectId: INCIDENT_ID.toString(),
        aiRunId: "not-a-uuid",
        verdict: AIRunHumanVerdict.Confirmed,
      });
      const next: ReturnType<typeof jest.fn> = jest.fn();

      await mockRouter
        .match("post", path)
        .handlerFunction(req, response(), next as unknown as NextFunction);

      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
      expect(IncidentService.findOneById).not.toHaveBeenCalled();
      expect(
        AIRunService.applyHumanVerdictToInvestigation,
      ).not.toHaveBeenCalled();
      expect(
        FixFromIncidentTaskTrigger.createFixTaskFromInvestigation,
      ).not.toHaveBeenCalled();
    },
  );

  it("records a verdict only against the displayed run and ACL-scoped project", async () => {
    const req: ExpressRequest = requestFor({
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
      aiRunId: investigationRunId.toString(),
      verdict: AIRunHumanVerdict.Confirmed,
    });
    const next: ReturnType<typeof jest.fn> = jest.fn();

    await mockRouter
      .match("post", "/ai-investigation/verdict")
      .handlerFunction(req, response(), next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(AIRunService.applyHumanVerdictToInvestigation).toHaveBeenCalledWith({
      aiRunId: investigationRunId,
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      verdict: AIRunHumanVerdict.Confirmed,
      verdictByUserId: USER_ID,
    });
    expect(sentPayload()).toEqual({
      runId: investigationRunId.toString(),
      verdict: AIRunHumanVerdict.Confirmed,
    });
  });

  it("creates an alert fix task from the displayed investigation run", async () => {
    const req: ExpressRequest = requestFor({
      subjectType: "alert",
      subjectId: ALERT_ID.toString(),
      aiRunId: investigationRunId.toString(),
    });
    const next: ReturnType<typeof jest.fn> = jest.fn();

    await mockRouter
      .match("post", "/ai-investigation/create-fix-task")
      .handlerFunction(req, response(), next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(
      FixFromIncidentTaskTrigger.createFixTaskFromInvestigation,
    ).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      investigationRunId,
      userId: USER_ID,
    });
    expect(sentPayload()).toEqual({ aiRunId: fixRunId.toString() });
  });
});

describe("isAnalysisPendingForRun", () => {
  const now: Date = new Date("2026-08-07T12:00:00.000Z");

  it("is pending while a result-less completed run has no settlement event", () => {
    expect(
      isAnalysisPendingForRun({
        run: investigationRun({
          status: AIRunStatus.Completed,
          completedAt: new Date(
            now.getTime() - ANALYSIS_FINALIZATION_TIMEOUT_MS + 1,
          ),
        }),
        events: [],
        analysisMarkdown: null,
        currentDate: now,
      }),
    ).toBe(true);
  });

  it("is no longer pending at the exact crash-failsafe boundary", () => {
    expect(
      isAnalysisPendingForRun({
        run: investigationRun({
          status: AIRunStatus.Completed,
          completedAt: new Date(
            now.getTime() - ANALYSIS_FINALIZATION_TIMEOUT_MS,
          ),
        }),
        events: [],
        analysisMarkdown: null,
        currentDate: now,
      }),
    ).toBe(false);
  });

  it("is not pending once analysis exists", () => {
    expect(
      isAnalysisPendingForRun({
        run: investigationRun({
          status: AIRunStatus.Completed,
          completedAt: now,
        }),
        events: [],
        analysisMarkdown: "posted",
        currentDate: now,
      }),
    ).toBe(false);
  });

  it("is not pending without a completion timestamp", () => {
    expect(
      isAnalysisPendingForRun({
        run: investigationRun({ status: AIRunStatus.Completed }),
        events: [],
        analysisMarkdown: null,
        currentDate: now,
      }),
    ).toBe(false);
  });

  it("ignores a RunFailed event from an earlier retried attempt", () => {
    expect(
      isAnalysisPendingForRun({
        run: investigationRun({
          status: AIRunStatus.Completed,
          completedAt: new Date(now.getTime() - 1000),
        }),
        events: [
          investigationEvent(AIRunEventType.RunFailed),
          investigationEvent(AIRunEventType.RunStarted),
        ],
        analysisMarkdown: null,
        currentDate: now,
      }),
    ).toBe(true);
  });

  it.each([AIRunEventType.RunCompleted, AIRunEventType.RunFailed])(
    "is not pending once %s proves finalization settled",
    (eventType: AIRunEventType) => {
      expect(
        isAnalysisPendingForRun({
          run: investigationRun({
            status: AIRunStatus.Completed,
            completedAt: new Date(now.getTime() - 1000),
          }),
          events: [investigationEvent(eventType)],
          analysisMarkdown: null,
          currentDate: now,
        }),
      ).toBe(false);
    },
  );

  it("tolerates bounded future clock skew while report publication is pending", () => {
    expect(
      isAnalysisPendingForRun({
        run: investigationRun({
          status: AIRunStatus.Completed,
          completedAt: new Date(now.getTime() + 1),
        }),
        events: [],
        analysisMarkdown: null,
        currentDate: now,
      }),
    ).toBe(true);
  });

  it("does not poll indefinitely for a completion timestamp beyond the skew bound", () => {
    expect(
      isAnalysisPendingForRun({
        run: investigationRun({
          status: AIRunStatus.Completed,
          completedAt: new Date(
            now.getTime() + ANALYSIS_COMPLETION_CLOCK_SKEW_MS + 1,
          ),
        }),
        events: [],
        analysisMarkdown: null,
        currentDate: now,
      }),
    ).toBe(false);
  });
});

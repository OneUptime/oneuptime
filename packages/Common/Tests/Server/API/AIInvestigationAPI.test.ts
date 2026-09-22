import { mockRouter } from "./Helpers";
import {
  ANALYSIS_COMPLETION_CLOCK_SKEW_MS,
  ANALYSIS_FINALIZATION_TIMEOUT_MS,
  canViewerReadCredentialNames,
  isAnalysisPendingForRun,
  RESTRICTED_CREDENTIAL_GAP_DESCRIPTION,
  RESTRICTED_GAP_DESCRIPTION,
} from "../../../Server/API/AIInvestigationAPI";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Permission, { UserPermission } from "../../../Types/Permission";
import CommonAPI from "../../../Server/API/CommonAPI";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIRunService from "../../../Server/Services/AIRunService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import PostedRootCause from "../../../Server/Utils/AI/SRE/PostedRootCause";
import InvestigationEligibility from "../../../Server/Utils/AI/SRE/InvestigationEligibility";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import InvestigationNotStartedReason from "../../../Types/AI/InvestigationNotStartedReason";
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
import { AIChatCitationTargetType } from "../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunHumanVerdict from "../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
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
import { SpyInstance } from "jest-mock";

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

// A second project the same viewer belongs to.
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4121-8121-121212121212",
);

const props: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

/*
 * What the subject lookup and the reference lookups must receive: the
 * viewer's own props pinned to the request tenant, never multi-tenant.
 */
const pinnedProps: DatabaseCommonInteractionProps = {
  ...props,
  isMultiTenantRequest: false,
};

function incidentInProject(projectId: ObjectID): Incident {
  const incident: Incident = new Incident(INCIDENT_ID);
  incident.projectId = projectId;
  return incident;
}

function alertInProject(projectId: ObjectID): Alert {
  const alert: Alert = new Alert(ALERT_ID);
  alert.projectId = projectId;
  return alert;
}

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

const CLUSTER_ID: string = "56565656-5656-4565-8565-565656565656";
const RUNNER_ID: string = "67676767-6767-4676-8676-676767676767";
const CREDENTIAL_ID: string = "78787878-7878-4787-8787-787878787878";
const RUNNER_KEY: string = "runner-secret-key-89898989";

/*
 * What the access service answers with — including the credential id the
 * jobs name and, defensively, a runner key a future summary might carry.
 * Neither may reach the panel.
 */
function clusterAccessStatus(): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID,
    clusterName: "prod-us",
    clusterIdentifier: "prod-us",
    runner: {
      id: RUNNER_ID,
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      lastAliveAt: "2026-09-14T18:00:00.000Z",
      canRunAiCommands: true,
      posture: { inCluster: false, allowWrites: false },
      key: RUNNER_KEY,
    } as KubernetesClusterAiAccessStatus["runner"],
    accessMethod: "credential",
    credentialId: CREDENTIAL_ID,
    credentialName: "prod-sa-token",
    kubectlAllowlist: ["kubectl rollout restart deployment/*"],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: true,
    gaps: [
      {
        code: "remediation_disabled",
        title: "AI remediation is turned off for this cluster",
        description: "x",
        nextStep: "y",
        blocks: "remediation",
      },
    ],
    lastVerifiedAt: "2026-09-14T17:59:00.000Z",
    lastError: undefined,
    evaluatedAt: "2026-09-14T18:00:00.000Z",
  };
}

/*
 * A signed-in viewer of the tenant holding exactly these permissions (and
 * these block rows). What they may read of a cluster is decided by the
 * model layer, which the tests stand in for with KubernetesClusterService's
 * findBy; the permissions decide whether credential names are theirs.
 */
function viewerWithPermissions(
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = [
    ...permissions.map((permission: Permission): UserPermission => {
      return { _type: "UserPermission", permission, labelIds: [] };
    }),
    ...blocked.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: true,
      };
    }),
  ];

  return {
    ...props,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
  } as DatabaseCommonInteractionProps;
}

function readableCluster(clusterId: string): KubernetesCluster {
  return new KubernetesCluster(new ObjectID(clusterId));
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
      .mockResolvedValue(incidentInProject(PROJECT_ID));
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(alertInProject(PROJECT_ID));
    jest.spyOn(AIRunEventService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns an explicit empty analysis state when no investigation exists", async () => {
    const reason: InvestigationNotStartedReason = {
      ...InvestigationEligibility.reason("no_run_recorded", {
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
      source: "unknown",
    };
    jest
      .spyOn(InvestigationEligibility, "getNotStartedReason")
      .mockResolvedValue(reason);
    await callIncidentRoute();

    expect(sentPayload()).toEqual({
      run: null,
      notInvestigatedReason: reason,
      events: [],
      analysisMarkdown: null,
      analysisTldr: null,
      isAnalysisPending: false,
      evidence: [],
      references: [],
      clusterAccess: [],
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

describe("AIInvestigationAPI latest-investigation evidence and references", () => {
  const completedRun: () => AIRun = (): AIRun => {
    return investigationRun({
      status: AIRunStatus.Completed,
      createdAt: new Date("2026-09-14T18:00:00.000Z"),
      completedAt: new Date("2026-09-14T18:04:00.000Z"),
    });
  };

  const REPORT: string = [
    "## 🧠 AI — Automated Root Cause Analysis",
    "",
    "**Summary** — a recurrence of #6954 [C1].",
    "",
    "**Evidence checked**",
    "- **[C1]** Active incidents (7 total) — 7 row(s)",
  ].join("\n");

  function trailEvents(): Array<AIRunEvent> {
    const runStarted: AIRunEvent = investigationEvent(
      AIRunEventType.RunStarted,
    );

    const toolStarted: AIRunEvent = investigationEvent(
      AIRunEventType.ToolCallStarted,
    );
    toolStarted.toolName = "query_incidents";
    toolStarted.toolArguments = { state: "active", secretish: "raw-llm-arg" };
    toolStarted.createdAt = new Date("2026-09-14T18:01:00.000Z");

    const toolCompleted: AIRunEvent = investigationEvent(
      AIRunEventType.ToolCallCompleted,
    );
    toolCompleted.toolName = "query_incidents";
    toolCompleted.citationId = "C1";
    toolCompleted.toolArguments = {
      state: "active",
      secretish: "raw-llm-arg",
    };
    toolCompleted.resultSummary = {
      rowCount: 7,
      durationInMs: 300,
      citationLabel: "Active incidents (7 total)",
      citationTarget: { type: AIChatCitationTargetType.Incidents },
    };
    toolCompleted.createdAt = new Date("2026-09-14T18:01:01.000Z");

    return [
      runStarted,
      toolStarted,
      toolCompleted,
      investigationEvent(AIRunEventType.RunCompleted),
    ];
  }

  let incidentFindBy: SpyInstance<typeof IncidentService.findBy>;
  let alertFindBy: SpyInstance<typeof AlertService.findBy>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incidentInProject(PROJECT_ID));
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(alertInProject(PROJECT_ID));
    incidentFindBy = jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([]);
    alertFindBy = jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("adds structured evidence next to a published report", async () => {
    await callIncidentRoute({
      run: completedRun(),
      events: trailEvents(),
      analysisMarkdown: REPORT,
    });

    expect(sentPayload()["evidence"]).toEqual([
      {
        citationId: "C1",
        toolName: "query_incidents",
        label: "Active incidents (7 total)",
        rowCount: 7,
        durationInMs: 300,
        queryArguments: { state: "active", secretish: "raw-llm-arg" },
        target: { type: AIChatCitationTargetType.Incidents },
        executedAt: "2026-09-14T18:01:00.000Z",
        canLoadRows: true,
      },
    ]);
  });

  it.each([AIRunStatus.Running, AIRunStatus.Error, AIRunStatus.Queued])(
    "sends no evidence or references for a %s run",
    async (status: AIRunStatus) => {
      await callIncidentRoute({
        run: investigationRun({
          status,
          createdAt: new Date("2026-09-14T18:00:00.000Z"),
        }),
        events: trailEvents(),
      });

      const payload: JSONObject = sentPayload();
      expect(payload["evidence"]).toEqual([]);
      expect(payload["references"]).toEqual([]);
      expect(incidentFindBy).not.toHaveBeenCalled();
      expect(alertFindBy).not.toHaveBeenCalled();
    },
  );

  it("sends no evidence while a completed run's report is still being published", async () => {
    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-09-14T18:00:00.000Z"),
        completedAt: new Date(Date.now() - 1000),
      }),
      events: trailEvents().slice(0, 3),
    });

    const payload: JSONObject = sentPayload();
    expect(payload["isAnalysisPending"]).toBe(true);
    expect(payload["evidence"]).toEqual([]);
    expect(payload["references"]).toEqual([]);
  });

  it("never ships tool arguments, citation ids or citation metadata in the events JSON", async () => {
    const events: Array<AIRunEvent> = trailEvents();

    await callIncidentRoute({
      run: completedRun(),
      events,
      analysisMarkdown: REPORT,
    });

    const eventsJson: Array<JSONObject> = sentPayload()[
      "events"
    ] as Array<JSONObject>;

    expect(eventsJson).toHaveLength(4);

    for (const eventJson of eventsJson) {
      expect(eventJson).not.toHaveProperty("toolArguments");
      expect(eventJson).not.toHaveProperty("citationId");
    }

    const completedJson: JSONObject = eventsJson[2]!;
    expect(completedJson["toolName"]).toBe("query_incidents");
    expect(completedJson["resultSummary"]).toEqual({
      rowCount: 7,
      durationInMs: 300,
    });
    expect(JSON.stringify(eventsJson)).not.toContain("raw-llm-arg");
    expect(JSON.stringify(eventsJson)).not.toContain("citationLabel");

    // The models themselves are untouched — only the client copy is stripped.
    expect(events[2]!.toolArguments).toEqual({
      state: "active",
      secretish: "raw-llm-arg",
    });
    expect(events[2]!.resultSummary?.citationLabel).toBe(
      "Active incidents (7 total)",
    );
  });

  it("selects citation ids and tool arguments to build evidence", async () => {
    await callIncidentRoute({
      run: completedRun(),
      events: trailEvents(),
      analysisMarkdown: REPORT,
    });

    expect(AIRunEventService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          _id: true,
          sequence: true,
          eventType: true,
          toolName: true,
          resultSummary: true,
          createdAt: true,
          citationId: true,
          toolArguments: true,
        },
        props: { isRoot: true },
      }),
    );
  });

  /*
   * The panel polls every few seconds while a run is active, and evidence is
   * only ever built for a Completed run's report — so an active run's poll
   * must not pay to read (potentially large) raw tool arguments.
   */
  it.each([
    AIRunStatus.Queued,
    AIRunStatus.Running,
    AIRunStatus.WaitingForApproval,
    AIRunStatus.Error,
    AIRunStatus.Cancelled,
    AIRunStatus.Stale,
  ])(
    "does not select citation ids or tool arguments for a %s run",
    async (status: AIRunStatus) => {
      await callIncidentRoute({
        run: investigationRun({
          status,
          createdAt: new Date("2026-09-14T18:00:00.000Z"),
        }),
        events: trailEvents(),
      });

      expect(AIRunEventService.findBy).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            _id: true,
            sequence: true,
            eventType: true,
            toolName: true,
            resultSummary: true,
            createdAt: true,
          },
          props: { isRoot: true },
        }),
      );
    },
  );

  it("still selects them for a completed run whose report is not yet published", async () => {
    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-09-14T18:00:00.000Z"),
        completedAt: new Date(Date.now() - 1000),
      }),
      events: trailEvents(),
    });

    expect(AIRunEventService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          citationId: true,
          toolArguments: true,
        }),
      }),
    );
  });

  it("resolves the report's references under the viewer's tenant-pinned props inside the tenant", async () => {
    const prior: Incident = new Incident(
      new ObjectID("34343434-3434-4343-8343-343434343434"),
    );
    prior.incidentNumber = 6954;
    prior.incidentNumberWithPrefix = "INC-6954";
    prior.title = "Checkout pool exhausted";
    incidentFindBy.mockResolvedValue([prior]);

    await callIncidentRoute({
      run: completedRun(),
      events: trailEvents(),
      analysisMarkdown: REPORT,
    });

    expect(IncidentService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { _id: true, projectId: true },
        props: pinnedProps,
      }),
    );
    expect(sentPayload()["references"]).toEqual([
      {
        kind: "incident",
        number: 6954,
        id: "34343434-3434-4343-8343-343434343434",
        displayNumber: "INC-6954",
        title: "Checkout pool exhausted",
      },
    ]);
    expect(incidentFindBy).toHaveBeenCalledTimes(1);

    const lookup: JSONObject = incidentFindBy.mock
      .calls[0]![0] as unknown as JSONObject;
    expect(lookup["props"]).toEqual(pinnedProps);
    expect((lookup["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);
  });

  it("treats a subject row without a project as not found and reads nothing else", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(new Incident(INCIDENT_ID));
    const runFindBy: SpyInstance<typeof AIRunService.findBy> = jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([completedRun()]);

    const next: ReturnType<typeof jest.fn> = jest.fn();

    await mockRouter
      .match("post", "/ai-investigation/incident")
      .handlerFunction(
        requestFor({ incidentId: INCIDENT_ID.toString() }),
        response(),
        next as unknown as NextFunction,
      );

    expect(next).toHaveBeenCalledWith(
      new BadDataException(
        "Incident not found (or you do not have access to it).",
      ),
    );
    expect(runFindBy).not.toHaveBeenCalled();
    expect(incidentFindBy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  it("resolves unqualified numbers as alerts on the alert route", async () => {
    const run: AIRun = completedRun();
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([run]);
    jest
      .spyOn(PostedRootCause, "getForInvestigation")
      .mockResolvedValue("**Summary** — same as #12 last week.");
    jest.spyOn(AIRunEventService, "findBy").mockResolvedValue([]);

    const next: ReturnType<typeof jest.fn> = jest.fn();

    await mockRouter
      .match("post", "/ai-investigation/alert")
      .handlerFunction(
        requestFor({ alertId: ALERT_ID.toString() }),
        response(),
        next as unknown as NextFunction,
      );

    expect(next).not.toHaveBeenCalled();
    expect(alertFindBy).toHaveBeenCalledTimes(1);
    expect(incidentFindBy).not.toHaveBeenCalled();
    expect(
      (alertFindBy.mock.calls[0]![0] as unknown as JSONObject)["props"],
    ).toEqual(pinnedProps);
    expect(sentPayload()["evidence"]).toEqual([]);
  });

  it("still sends the report when reference resolution fails", async () => {
    incidentFindBy.mockRejectedValue(new Error("database unavailable"));

    await callIncidentRoute({
      run: completedRun(),
      events: trailEvents(),
      analysisMarkdown: REPORT,
    });

    const payload: JSONObject = sentPayload();
    expect(payload["analysisMarkdown"]).toBe(REPORT);
    expect(payload["references"]).toEqual([]);
    expect(payload["evidence"]).toHaveLength(1);
  });

  it("a report without a structured trail still gets an (empty) evidence list", async () => {
    await callIncidentRoute({
      run: completedRun(),
      events: [investigationEvent(AIRunEventType.RunCompleted)],
      analysisMarkdown: "## Current investigation\nPool exhausted.",
    });

    const payload: JSONObject = sentPayload();
    expect(payload["evidence"]).toEqual([]);
    expect(payload["references"]).toEqual([]);
    expect(incidentFindBy).not.toHaveBeenCalled();
  });
});

describe("AIInvestigationAPI latest-investigation tenant pinning", () => {
  const REPORT: string = "**Summary** — a recurrence of #6954.";

  let incidentFindOne: SpyInstance<typeof IncidentService.findOneById>;
  let alertFindOne: SpyInstance<typeof AlertService.findOneById>;
  let runFindBy: SpyInstance<typeof AIRunService.findBy>;
  let eventFindBy: SpyInstance<typeof AIRunEventService.findBy>;
  let incidentFindBy: SpyInstance<typeof IncidentService.findBy>;
  let alertFindBy: SpyInstance<typeof AlertService.findBy>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);
    incidentFindOne = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incidentInProject(PROJECT_ID));
    alertFindOne = jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(alertInProject(PROJECT_ID));
    runFindBy = jest.spyOn(AIRunService, "findBy").mockResolvedValue([
      investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-09-14T18:00:00.000Z"),
        completedAt: new Date("2026-09-14T18:04:00.000Z"),
      }),
    ]);
    eventFindBy = jest.spyOn(AIRunEventService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(PostedRootCause, "getForInvestigation")
      .mockResolvedValue(REPORT);
    incidentFindBy = jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([]);
    alertFindBy = jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function callRoute(
    subjectType: "incident" | "alert",
  ): Promise<ReturnType<typeof jest.fn>> {
    const next: ReturnType<typeof jest.fn> = jest.fn();

    await mockRouter
      .match("post", `/ai-investigation/${subjectType}`)
      .handlerFunction(
        requestFor(
          subjectType === "incident"
            ? { incidentId: INCIDENT_ID.toString() }
            : { alertId: ALERT_ID.toString() },
        ),
        response(),
        next as unknown as NextFunction,
      );

    return next;
  }

  function expectNothingRead(): void {
    expect(runFindBy).not.toHaveBeenCalled();
    expect(eventFindBy).not.toHaveBeenCalled();
    expect(PostedRootCause.getForInvestigation).not.toHaveBeenCalled();
    expect(incidentFindBy).not.toHaveBeenCalled();
    expect(alertFindBy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  /*
   * With the multi-tenant header the model layer can return a subject from
   * any project the viewer belongs to, and the reference lookups then lose
   * their project filter. The panel always sends its own tenant, so a
   * subject outside it is refused before the run is read.
   */
  it.each(["incident", "alert"] as const)(
    "refuses a multi-tenant request for an %s in another project",
    async (subjectType: "incident" | "alert") => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue({ ...props, isMultiTenantRequest: true });
      incidentFindOne.mockResolvedValue(incidentInProject(OTHER_PROJECT_ID));
      alertFindOne.mockResolvedValue(alertInProject(OTHER_PROJECT_ID));

      const next: ReturnType<typeof jest.fn> = await callRoute(subjectType);

      expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
      expectNothingRead();
    },
  );

  it.each(["incident", "alert"] as const)(
    "looks up the %s and its references with the multi-tenant flag cleared",
    async (subjectType: "incident" | "alert") => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue({ ...props, isMultiTenantRequest: true });

      const next: ReturnType<typeof jest.fn> = await callRoute(subjectType);

      expect(next).not.toHaveBeenCalled();

      const subjectCalls: Array<Array<unknown>> =
        subjectType === "incident"
          ? incidentFindOne.mock.calls
          : alertFindOne.mock.calls;
      const referenceCalls: Array<Array<unknown>> =
        subjectType === "incident"
          ? incidentFindBy.mock.calls
          : alertFindBy.mock.calls;

      expect(subjectCalls).toHaveLength(1);
      const lookupProps: DatabaseCommonInteractionProps = (
        subjectCalls[0]![0] as {
          props: DatabaseCommonInteractionProps;
        }
      ).props;
      expect(lookupProps.isMultiTenantRequest).toBe(false);
      expect(lookupProps.tenantId).toBe(PROJECT_ID);

      expect(referenceCalls).toHaveLength(1);
      const referenceCall: JSONObject = referenceCalls[0]![0] as JSONObject;
      expect(
        (referenceCall["props"] as DatabaseCommonInteractionProps)
          .isMultiTenantRequest,
      ).toBe(false);
      expect((referenceCall["query"] as JSONObject)["projectId"]).toBe(
        PROJECT_ID,
      );
    },
  );

  it.each(["incident", "alert"] as const)(
    "reads the %s's run and events inside the tenant",
    async (subjectType: "incident" | "alert") => {
      await callRoute(subjectType);

      expect(
        (runFindBy.mock.calls[0]![0] as unknown as { query: JSONObject }).query,
      ).toEqual(
        subjectType === "incident"
          ? {
              projectId: PROJECT_ID,
              triggeredByIncidentId: INCIDENT_ID,
              runType: AIRunType.Investigation,
            }
          : {
              projectId: PROJECT_ID,
              triggeredByAlertId: ALERT_ID,
              runType: AIRunType.Investigation,
            },
      );
      expect(
        (eventFindBy.mock.calls[0]![0] as unknown as { query: JSONObject })
          .query["projectId"],
      ).toBe(PROJECT_ID);
    },
  );

  it.each(["incident", "alert"] as const)(
    "rejects a %s request without a tenant before any read",
    async (subjectType: "incident" | "alert") => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue({
          userId: USER_ID,
        } as DatabaseCommonInteractionProps);

      const next: ReturnType<typeof jest.fn> = await callRoute(subjectType);

      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
      expect(incidentFindOne).not.toHaveBeenCalled();
      expect(alertFindOne).not.toHaveBeenCalled();
      expectNothingRead();
    },
  );

  it("keeps the legacy payload keys for a request inside the tenant", async () => {
    const next: ReturnType<typeof jest.fn> = await callRoute("incident");

    expect(next).not.toHaveBeenCalled();
    expect(Object.keys(sentPayload()).sort()).toEqual(
      [
        "analysisMarkdown",
        "analysisTldr",
        "clusterAccess",
        "events",
        "evidence",
        "isAnalysisPending",
        "notInvestigatedReason",
        "references",
        "run",
      ].sort(),
    );
  });
});

/*
 * The panel's cluster access rows: which clusters the signal is about and
 * whether OneUptime AI can reach them, from CURRENT configuration. The rows
 * exist in every response shape, are read inside the tenant only, and never
 * carry the credential or Runner secrets the jobs behind them use.
 */
describe("AIInvestigationAPI latest-investigation cluster access", () => {
  let getStatuses: SpyInstance<
    typeof KubernetesClusterAiAccessService.getStatusesForSubject
  >;
  let clusterFindBy: SpyInstance<typeof KubernetesClusterService.findBy>;

  beforeEach(() => {
    jest.clearAllMocks();
    /*
     * By default the viewer can read the cluster and Runner credentials:
     * the full row. The viewer-permission cases below narrow this.
     */
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(
        viewerWithPermissions([
          Permission.ReadKubernetesCluster,
          Permission.ReadRunbookCredential,
        ]),
      );
    clusterFindBy = jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([readableCluster(CLUSTER_ID)]);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incidentInProject(PROJECT_ID));
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(alertInProject(PROJECT_ID));
    jest.spyOn(AIRunEventService, "findBy").mockResolvedValue([]);
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);
    jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
    // No run by default; callIncidentRoute overrides these per case.
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    jest.spyOn(PostedRootCause, "getForInvestigation").mockResolvedValue(null);
    jest
      .spyOn(InvestigationEligibility, "getNotStartedReason")
      .mockResolvedValue({
        ...InvestigationEligibility.reason("no_run_recorded", {
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
        }),
        source: "unknown",
      });
    getStatuses = jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([clusterAccessStatus()]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function sentClusterAccess(): Array<JSONObject> {
    return sentPayload()["clusterAccess"] as Array<JSONObject>;
  }

  it("never carries credential ids or Runner keys to the panel", async () => {
    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-09-14T18:00:00.000Z"),
        completedAt: new Date("2026-09-14T18:04:00.000Z"),
      }),
      analysisMarkdown: "## Current investigation\nPool exhausted.",
    });

    const rows: Array<JSONObject> = sentClusterAccess();
    expect(rows).toHaveLength(1);

    const row: JSONObject = rows[0]!;
    expect(row).not.toHaveProperty("credentialId");
    expect(row["runner"]).not.toHaveProperty("key");

    const serialized: string = JSON.stringify(rows);
    expect(serialized).not.toContain(CREDENTIAL_ID);
    expect(serialized).not.toContain(RUNNER_KEY);

    /*
     * A viewer who can read the cluster and Runner credentials gets the
     * row the cluster's AI page would show them — nothing more.
     */
    expect(row).toEqual({
      clusterId: CLUSTER_ID,
      clusterName: "prod-us",
      clusterIdentifier: "prod-us",
      runner: {
        id: RUNNER_ID,
        name: "kubernetes-agent/prod-us",
        isOnline: true,
        lastAliveAt: "2026-09-14T18:00:00.000Z",
        canRunAiCommands: true,
        posture: { inCluster: false, allowWrites: false },
      },
      accessMethod: "credential",
      credentialName: "prod-sa-token",
      kubectlAllowlist: ["kubectl rollout restart deployment/*"],
      isInvestigationEnabled: true,
      isInvestigationReady: true,
      remediationMode: KubernetesAiRemediationMode.RequireApproval,
      isRemediationReady: true,
      gaps: [
        {
          code: "remediation_disabled",
          title: "AI remediation is turned off for this cluster",
          description: "x",
          nextStep: "y",
          blocks: "remediation",
        },
      ],
      lastVerifiedAt: "2026-09-14T17:59:00.000Z",
      evaluatedAt: "2026-09-14T18:00:00.000Z",
    });
  });

  it("drops unknown fields on the status and the runner summary rather than forwarding them", async () => {
    const status: KubernetesClusterAiAccessStatus = clusterAccessStatus();
    (status as unknown as JSONObject)["runnerKey"] = RUNNER_KEY;
    (status as unknown as JSONObject)["kubeconfig"] = "apiVersion: v1";
    getStatuses.mockResolvedValue([status]);

    await callIncidentRoute();

    const serialized: string = JSON.stringify(sentClusterAccess());
    expect(serialized).not.toContain("runnerKey");
    expect(serialized).not.toContain("kubeconfig");
    expect(serialized).not.toContain(RUNNER_KEY);
    expect(serialized).not.toContain(CREDENTIAL_ID);
  });

  it("keeps a cluster with no Runner bound as an explicit null runner", async () => {
    getStatuses.mockResolvedValue([
      {
        ...clusterAccessStatus(),
        runner: null,
        accessMethod: "none",
        credentialId: undefined,
        credentialName: undefined,
        isInvestigationReady: false,
        isRemediationReady: false,
        gaps: [
          {
            code: "no_runner_bound",
            title: "No Runner is bound to this cluster",
            description: "x",
            nextStep: "y",
            blocks: "both",
          },
        ],
      },
    ]);

    await callIncidentRoute();

    const row: JSONObject = sentClusterAccess()[0]!;
    expect(row["runner"]).toBeNull();
    expect(row["isInvestigationReady"]).toBe(false);
    expect((row["gaps"] as Array<JSONObject>)[0]!["code"]).toBe(
      "no_runner_bound",
    );
  });

  it("is present in the no-investigation shape too", async () => {
    await callIncidentRoute();

    const payload: JSONObject = sentPayload();
    expect(payload["run"]).toBeNull();
    expect(sentClusterAccess()).toHaveLength(1);
    expect(sentClusterAccess()[0]!["clusterId"]).toBe(CLUSTER_ID);
    expect(sentClusterAccess()[0]).not.toHaveProperty("credentialId");
  });

  it.each([
    AIRunStatus.Queued,
    AIRunStatus.Running,
    AIRunStatus.Error,
    AIRunStatus.Completed,
  ])(
    "is present, sanitized, alongside a %s run",
    async (status: AIRunStatus) => {
      await callIncidentRoute({
        run: investigationRun({
          status,
          createdAt: new Date("2026-09-14T18:00:00.000Z"),
          completedAt: new Date(Date.now() - 1000),
        }),
      });

      expect(sentClusterAccess()).toHaveLength(1);
      expect(JSON.stringify(sentClusterAccess())).not.toContain(CREDENTIAL_ID);
    },
  );

  it("is an empty array when the signal is about no cluster", async () => {
    getStatuses.mockResolvedValue([]);

    await callIncidentRoute();

    expect(sentPayload()["clusterAccess"]).toEqual([]);
  });

  it("is an empty array, and the payload still sends, when the lookup fails", async () => {
    getStatuses.mockRejectedValue(new Error("database unavailable"));

    await callIncidentRoute({
      run: investigationRun({
        status: AIRunStatus.Completed,
        createdAt: new Date("2026-09-14T18:00:00.000Z"),
        completedAt: new Date("2026-09-14T18:04:00.000Z"),
      }),
      analysisMarkdown: "## Current investigation\nPool exhausted.",
    });

    const payload: JSONObject = sentPayload();
    expect(payload["clusterAccess"]).toEqual([]);
    expect(payload["analysisMarkdown"]).toBe(
      "## Current investigation\nPool exhausted.",
    );
  });

  it.each(["incident", "alert"] as const)(
    "looks the %s's clusters up inside the tenant for that subject only",
    async (subjectType: "incident" | "alert") => {
      const next: ReturnType<typeof jest.fn> = jest.fn();

      await mockRouter
        .match("post", `/ai-investigation/${subjectType}`)
        .handlerFunction(
          requestFor(
            subjectType === "incident"
              ? { incidentId: INCIDENT_ID.toString() }
              : { alertId: ALERT_ID.toString() },
          ),
          response(),
          next as unknown as NextFunction,
        );

      expect(next).not.toHaveBeenCalled();
      expect(getStatuses).toHaveBeenCalledTimes(1);
      expect(getStatuses).toHaveBeenCalledWith(
        subjectType === "incident"
          ? { projectId: PROJECT_ID, incidentId: INCIDENT_ID }
          : { projectId: PROJECT_ID, alertId: ALERT_ID },
      );
      expect(sentClusterAccess()).toHaveLength(1);
    },
  );

  it("is not looked up when the subject is not readable", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null);

    const next: ReturnType<typeof jest.fn> = jest.fn();

    await mockRouter
      .match("post", "/ai-investigation/incident")
      .handlerFunction(
        requestFor({ incidentId: INCIDENT_ID.toString() }),
        response(),
        next as unknown as NextFunction,
      );

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(getStatuses).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  /*
   * The statuses are computed as root. What reaches the panel follows the
   * VIEWER's own read access to each cluster (and to credentials), not
   * their access to the incident: a responder who may read the incident
   * but not the cluster learns whether AI could reach it and what to do,
   * never the Runner, credential, allowlist, posture or last error.
   */
  describe("under the viewer's own permissions", () => {
    const OTHER_CLUSTER_ID: string = "90909090-9090-4909-8909-909090909090";
    const LAST_ERROR: string =
      'forbidden: User "system:serviceaccount:oneuptime:ai-runner" cannot list pods';

    // A cluster whose status carries every detail a reader could leak.
    function detailedStatus(
      overrides: Partial<KubernetesClusterAiAccessStatus> = {},
    ): KubernetesClusterAiAccessStatus {
      return {
        ...clusterAccessStatus(),
        lastError: LAST_ERROR,
        runner: {
          id: RUNNER_ID,
          name: "kubernetes-agent/prod-us",
          isOnline: true,
          lastAliveAt: "2026-09-14T18:00:00.000Z",
          canRunAiCommands: true,
          posture: {
            inCluster: true,
            allowWrites: true,
            kubectlVersion: "v1.31.2",
            agentChartVersion: "0.7.0",
          },
        },
        isInvestigationReady: false,
        gaps: [
          {
            code: "credential_missing",
            title: "The Kubernetes credential is not usable by the Runner",
            description:
              '"prod-sa-token" is not assigned to Runner "kubernetes-agent/prod-us".',
            nextStep:
              "Create a Kubernetes credential, assign it to the Runner, and select it on this cluster's AI page.",
            blocks: "both",
          },
          {
            code: "runner_cluster_mismatch",
            title:
              "The bound Runner is the in-cluster Runner of a different cluster",
            description:
              'Runner "kubernetes-agent/prod-us" runs inside cluster "staging-eu", not "prod-us".',
            nextStep: "Install the in-cluster Runner on THIS cluster.",
            blocks: "both",
          },
        ],
        ...overrides,
      };
    }

    function expectNoClusterDetails(row: JSONObject): void {
      const serialized: string = JSON.stringify(row);
      for (const secretish of [
        "prod-sa-token",
        "kubernetes-agent/prod-us",
        "rollout restart",
        LAST_ERROR,
        "staging-eu",
        "v1.31.2",
        CREDENTIAL_ID,
        RUNNER_ID,
      ]) {
        expect(serialized).not.toContain(secretish);
      }
      for (const key of [
        "runner",
        "credentialName",
        "credentialId",
        "kubectlAllowlist",
        "lastError",
        "lastVerifiedAt",
        "accessMethod",
        "isInvestigationEnabled",
        "clusterIdentifier",
      ]) {
        expect(row).not.toHaveProperty(key);
      }
    }

    it("gives an incident-only viewer the summary the notice needs and nothing else", async () => {
      const viewer: DatabaseCommonInteractionProps = viewerWithPermissions([
        Permission.IncidentViewer,
      ]);
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue(viewer);
      // The model layer refuses a viewer with no read on the cluster table.
      clusterFindBy.mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permissions to read Kubernetes Cluster.",
        ),
      );
      getStatuses.mockResolvedValue([detailedStatus()]);

      await callIncidentRoute();

      const row: JSONObject = sentClusterAccess()[0]!;
      expectNoClusterDetails(row);
      expect(row).toEqual({
        clusterId: CLUSTER_ID,
        clusterName: "prod-us",
        isInvestigationReady: false,
        remediationMode: KubernetesAiRemediationMode.RequireApproval,
        isRemediationReady: true,
        evaluatedAt: "2026-09-14T18:00:00.000Z",
        gaps: [
          {
            code: "credential_missing",
            title: "The Kubernetes credential is not usable by the Runner",
            description: RESTRICTED_GAP_DESCRIPTION,
            nextStep:
              "Create a Kubernetes credential, assign it to the Runner, and select it on this cluster's AI page.",
            blocks: "both",
          },
          {
            code: "runner_cluster_mismatch",
            title:
              "The bound Runner is the in-cluster Runner of a different cluster",
            description: RESTRICTED_GAP_DESCRIPTION,
            nextStep: "Install the in-cluster Runner on THIS cluster.",
            blocks: "both",
          },
        ],
      });
    });

    it("checks readability with the viewer's own tenant-pinned props, never as root", async () => {
      const viewer: DatabaseCommonInteractionProps = viewerWithPermissions([
        Permission.IncidentViewer,
      ]);
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue(viewer);
      getStatuses.mockResolvedValue([
        detailedStatus(),
        detailedStatus({ clusterId: OTHER_CLUSTER_ID }),
      ]);

      await callIncidentRoute();

      expect(clusterFindBy).toHaveBeenCalledTimes(1);
      const request: {
        query: JSONObject;
        select: JSONObject;
        props: DatabaseCommonInteractionProps;
        limit: number;
      } = clusterFindBy.mock.calls[0]![0] as unknown as {
        query: JSONObject;
        select: JSONObject;
        props: DatabaseCommonInteractionProps;
        limit: number;
      };
      expect(request.props).toEqual({
        ...viewer,
        isMultiTenantRequest: false,
      });
      expect(request.props.isRoot).toBeFalsy();
      expect(request.query["projectId"]).toBe(PROJECT_ID);
      expect(request.select).toEqual({ _id: true });
      expect(request.limit).toBe(2);
    });

    it("decides per cluster: a readable cluster keeps its details, an unreadable one gets the summary", async () => {
      getStatuses.mockResolvedValue([
        detailedStatus(),
        detailedStatus({ clusterId: OTHER_CLUSTER_ID, clusterName: "prod-eu" }),
      ]);
      clusterFindBy.mockResolvedValue([readableCluster(CLUSTER_ID)]);

      await callIncidentRoute();

      const rows: Array<JSONObject> = sentClusterAccess();
      const readable: JSONObject = rows[0]!;
      const unreadable: JSONObject = rows[1]!;
      expect(readable["clusterId"]).toBe(CLUSTER_ID);
      expect(readable["lastError"]).toBe(LAST_ERROR);
      expect((readable["runner"] as JSONObject)["name"]).toBe(
        "kubernetes-agent/prod-us",
      );
      expect(readable["kubectlAllowlist"]).toEqual([
        "kubectl rollout restart deployment/*",
      ]);

      expect(unreadable["clusterId"]).toBe(OTHER_CLUSTER_ID);
      expect(unreadable["clusterName"]).toBe("prod-eu");
      expectNoClusterDetails(unreadable);
    });

    it("keeps the credential name from a cluster reader who cannot read credentials", async () => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue(
          viewerWithPermissions([Permission.ReadKubernetesCluster]),
        );
      getStatuses.mockResolvedValue([
        clusterAccessStatus(),
        detailedStatus({ clusterId: OTHER_CLUSTER_ID }),
      ]);
      clusterFindBy.mockResolvedValue([
        readableCluster(CLUSTER_ID),
        readableCluster(OTHER_CLUSTER_ID),
      ]);

      await callIncidentRoute();

      const rows: Array<JSONObject> = sentClusterAccess();
      const usable: JSONObject = rows[0]!;
      const broken: JSONObject = rows[1]!;
      // The cluster itself is theirs to read...
      expect((usable["runner"] as JSONObject)["name"]).toBe(
        "kubernetes-agent/prod-us",
      );
      expect(usable["kubectlAllowlist"]).toEqual([
        "kubectl rollout restart deployment/*",
      ]);
      // ...the credential's name is not.
      expect(usable).not.toHaveProperty("credentialName");
      expect(JSON.stringify(sentClusterAccess())).not.toContain(
        "prod-sa-token",
      );

      const gaps: Array<JSONObject> = broken["gaps"] as Array<JSONObject>;
      expect(gaps[0]!["description"]).toBe(
        RESTRICTED_CREDENTIAL_GAP_DESCRIPTION,
      );
      // Gaps that do not name the credential keep their description.
      expect(gaps[1]!["description"]).toContain("staging-eu");
    });

    it("treats a block row on credentials as a denial, not a grant", async () => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue(
          viewerWithPermissions(
            [Permission.ProjectAdmin],
            [Permission.ReadRunbookCredential],
          ),
        );

      await callIncidentRoute();

      expect(sentClusterAccess()[0]).not.toHaveProperty("credentialName");
    });

    it("falls back to the summary, and still sends, when the readability check fails", async () => {
      clusterFindBy.mockRejectedValue(new Error("database unavailable"));
      getStatuses.mockResolvedValue([detailedStatus()]);

      await callIncidentRoute({
        run: investigationRun({
          status: AIRunStatus.Completed,
          createdAt: new Date("2026-09-14T18:00:00.000Z"),
          completedAt: new Date("2026-09-14T18:04:00.000Z"),
        }),
        analysisMarkdown: "## Current investigation\nPool exhausted.",
      });

      const rows: Array<JSONObject> = sentClusterAccess();
      expect(rows).toHaveLength(1);
      expectNoClusterDetails(rows[0]!);
      expect(sentPayload()["analysisMarkdown"]).toBe(
        "## Current investigation\nPool exhausted.",
      );
    });

    it("does not check readability when the signal is about no cluster", async () => {
      getStatuses.mockResolvedValue([]);

      await callIncidentRoute();

      expect(clusterFindBy).not.toHaveBeenCalled();
      expect(sentClusterAccess()).toEqual([]);
    });

    it.each(["incident", "alert"] as const)(
      "applies the same viewer check on the %s route",
      async (subjectType: "incident" | "alert") => {
        const viewer: DatabaseCommonInteractionProps = viewerWithPermissions([
          Permission.IncidentViewer,
          Permission.AlertViewer,
        ]);
        jest
          .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
          .mockResolvedValue(viewer);
        clusterFindBy.mockResolvedValue([]);
        getStatuses.mockResolvedValue([detailedStatus()]);

        const next: ReturnType<typeof jest.fn> = jest.fn();
        await mockRouter
          .match("post", `/ai-investigation/${subjectType}`)
          .handlerFunction(
            requestFor(
              subjectType === "incident"
                ? { incidentId: INCIDENT_ID.toString() }
                : { alertId: ALERT_ID.toString() },
            ),
            response(),
            next as unknown as NextFunction,
          );

        expect(next).not.toHaveBeenCalled();
        expect(
          (
            clusterFindBy.mock.calls[0]![0] as unknown as {
              props: DatabaseCommonInteractionProps;
            }
          ).props,
        ).toEqual({ ...viewer, isMultiTenantRequest: false });
        expectNoClusterDetails(sentClusterAccess()[0]!);
      },
    );
  });
});

describe("canViewerReadCredentialNames", () => {
  it.each<[string, DatabaseCommonInteractionProps, boolean]>([
    ["root", { isRoot: true } as DatabaseCommonInteractionProps, true],
    [
      "a master admin",
      { isMasterAdmin: true } as DatabaseCommonInteractionProps,
      true,
    ],
    ["a project owner", viewerWithPermissions([Permission.ProjectOwner]), true],
    ["a project admin", viewerWithPermissions([Permission.ProjectAdmin]), true],
    [
      "a viewer granted credential read",
      viewerWithPermissions([Permission.ReadRunbookCredential]),
      true,
    ],
    [
      "an incident viewer",
      viewerWithPermissions([Permission.IncidentViewer]),
      false,
    ],
    [
      "a project member (cluster read, no credential read)",
      viewerWithPermissions([Permission.ProjectMember]),
      false,
    ],
    [
      "an admin with credential read blocked",
      viewerWithPermissions(
        [Permission.ProjectAdmin],
        [Permission.ReadRunbookCredential],
      ),
      false,
    ],
    ["a viewer with no tenant permissions", props, false],
  ])(
    "%s",
    (
      _label: string,
      viewer: DatabaseCommonInteractionProps,
      expected: boolean,
    ) => {
      expect(canViewerReadCredentialNames(viewer, PROJECT_ID)).toBe(expected);
    },
  );

  it("only counts the grants of the project asked about", () => {
    const viewer: DatabaseCommonInteractionProps = viewerWithPermissions([
      Permission.ProjectOwner,
    ]);
    expect(canViewerReadCredentialNames(viewer, OTHER_PROJECT_ID)).toBe(false);
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

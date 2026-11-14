import { mockRouter } from "./Helpers";
import "../../../Server/API/AIInvestigationAPI";
import "../../../Server/API/AIInsightAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import AIInsightService from "../../../Server/Services/AIInsightService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIRunService from "../../../Server/Services/AIRunService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import InvestigationRuleWait from "../../../Server/Utils/AI/SRE/InvestigationRuleWait";
import InvestigationTryAgain from "../../../Server/Utils/AI/SRE/InvestigationTryAgain";
import InsightTriage from "../../../Server/Utils/AI/SRE/Insights/Triage";
import PostedRootCause from "../../../Server/Utils/AI/SRE/PostedRootCause";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import AiRunRefusalException from "../../../Types/Exception/AiRunRefusalException";
import { AiRunRefusalCode } from "../../../Types/AI/AiRunRefusal";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * TRY AGAIN, FOR AN AI RUN THAT DID NOT FINISH (issue #6438).
 *
 * - POST /ai-investigation/try-again starts an incident's or alert's
 *   investigation again, for a member of the tenant who may read AND change
 *   the record - the rule Investigate now and Ask AI's start_investigation
 *   follow. What stopped it is the server's own sentence.
 * - POST /ai-insight/triage-try-again triages an AI insight again, for
 *   whoever may act on the insight (its read access).
 * - The cards' payloads say whether the reader may: mayTryAgain.
 */

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
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4121-8121-121212121212",
);
const RUN_ID: ObjectID = new ObjectID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
const NEW_RUN_ID: ObjectID = new ObjectID(
  "ffffffff-ffff-4fff-8fff-ffffffffffff",
);
const INSIGHT_ID: ObjectID = new ObjectID(
  "13131313-1313-4131-8131-131313131313",
);

// A signed-in member of the tenant.
const member: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
        } as UserPermission,
      ],
    },
  },
} as unknown as DatabaseCommonInteractionProps;

function incidentIn(projectId: ObjectID): Incident {
  const incident: Incident = new Incident(INCIDENT_ID);
  incident.projectId = projectId;
  return incident;
}

function alertIn(projectId: ObjectID): Alert {
  const alert: Alert = new Alert(ALERT_ID);
  alert.projectId = projectId;
  return alert;
}

function runThatIs(status: AIRunStatus): AIRun {
  const run: AIRun = new AIRun(RUN_ID);
  run.status = status;
  run.createdAt = new Date("2026-11-09T13:00:00.000Z");
  return run;
}

function sentPayload(): JSONObject {
  return (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
    .calls[0]![2] as JSONObject;
}

// The route's next(): a mock from @jest/globals, as the API suites type it.
type NextMock = ReturnType<typeof jest.fn>;

async function call(uri: string, body: JSONObject): Promise<NextMock> {
  const next: NextMock = jest.fn();

  await mockRouter
    .match("post", uri)
    .handlerFunction(
      { body } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return next;
}

let updatableIncident: SpyInstance<typeof IncidentService.findOneUpdatableById>;
let updatableAlert: SpyInstance<typeof AlertService.findOneUpdatableById>;

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(member);
  jest
    .spyOn(IncidentService, "findOneById")
    .mockResolvedValue(incidentIn(PROJECT_ID));
  jest
    .spyOn(AlertService, "findOneById")
    .mockResolvedValue(alertIn(PROJECT_ID));
  jest.spyOn(AIRunEventService, "findBy").mockResolvedValue([]);
  jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
  jest.spyOn(PostedRootCause, "getForInvestigation").mockResolvedValue(null);
  jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
    .mockResolvedValue([]);
  jest.spyOn(InvestigationRuleWait, "getWaiting").mockResolvedValue(null);
  updatableIncident = jest
    .spyOn(IncidentService, "findOneUpdatableById")
    .mockResolvedValue(incidentIn(PROJECT_ID));
  updatableAlert = jest
    .spyOn(AlertService, "findOneUpdatableById")
    .mockResolvedValue(alertIn(PROJECT_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /ai-investigation/try-again", () => {
  let tryAgain: SpyInstance<typeof InvestigationTryAgain.tryAgain>;

  beforeEach(() => {
    tryAgain = jest
      .spyOn(InvestigationTryAgain, "tryAgain")
      .mockResolvedValue(NEW_RUN_ID);
  });

  it("starts the incident's investigation again, and answers with the new run", async () => {
    const next: NextMock = await call("/ai-investigation/try-again", {
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(next).not.toHaveBeenCalled();
    expect(tryAgain).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      subjectType: "incident",
      subjectId: INCIDENT_ID,
    });
    expect(sentPayload()).toEqual({ runId: NEW_RUN_ID.toString() });
    // Whether they may change it is asked under their own props, in the tenant.
    expect(updatableIncident.mock.calls[0]![0]).toEqual({
      id: INCIDENT_ID,
      select: { _id: true },
      props: { ...member, isMultiTenantRequest: false },
    });
  });

  it("an alert's starts again as the alert's", async () => {
    await call("/ai-investigation/try-again", {
      subjectType: "alert",
      subjectId: ALERT_ID.toString(),
    });

    expect(updatableAlert).toHaveBeenCalled();
    expect(tryAgain).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      subjectType: "alert",
      subjectId: ALERT_ID,
    });
  });

  it("someone who may read the incident but not change it is refused, and nothing starts", async () => {
    updatableIncident.mockRejectedValue(
      new NotAuthorizedException("You do not have permission to edit"),
    );

    const next: NextMock = await call("/ai-investigation/try-again", {
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
    expect((next.mock.calls[0]![0] as Error).message).toBe(
      "You do not have permission to change this incident, so you cannot start its investigation again.",
    );
    expect(tryAgain).not.toHaveBeenCalled();
  });

  it("a record held from the viewer's updates is refused too", async () => {
    updatableAlert.mockResolvedValue(null);

    const next: NextMock = await call("/ai-investigation/try-again", {
      subjectType: "alert",
      subjectId: ALERT_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
    expect(tryAgain).not.toHaveBeenCalled();
  });

  it("a record the viewer cannot read is not found, and nothing starts", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null);

    const next: NextMock = await call("/ai-investigation/try-again", {
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    // Its code beside it, for the card to word (#7359).
    expect(next.mock.calls[0]![0]).toMatchObject({
      message: "Incident not found (or you do not have access to it).",
      details: { refusalCode: AiRunRefusalCode.IncidentNotFound },
    });
    expect(tryAgain).not.toHaveBeenCalled();
  });

  it("a record of another project is refused, whatever the viewer may do there", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incidentIn(OTHER_PROJECT_ID));

    const next: NextMock = await call("/ai-investigation/try-again", {
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(next).toHaveBeenCalled();
    expect(tryAgain).not.toHaveBeenCalled();
  });

  it("someone who is not a member of the project is refused before anything is read", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({
        userId: USER_ID,
        tenantId: PROJECT_ID,
      } as DatabaseCommonInteractionProps);
    const read: SpyInstance<typeof IncidentService.findOneById> = jest.spyOn(
      IncidentService,
      "findOneById",
    );

    const next: NextMock = await call("/ai-investigation/try-again", {
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
    expect(read).not.toHaveBeenCalled();
    expect(tryAgain).not.toHaveBeenCalled();
  });

  it("a caller with no user session is refused before anything is read", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({} as DatabaseCommonInteractionProps);
    const read: SpyInstance<typeof IncidentService.findOneById> = jest.spyOn(
      IncidentService,
      "findOneById",
    );

    const next: NextMock = await call("/ai-investigation/try-again", {
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(NotAuthenticatedException));
    expect(read).not.toHaveBeenCalled();
    expect(tryAgain).not.toHaveBeenCalled();
  });

  it.each([
    [{ subjectType: "monitor", subjectId: INCIDENT_ID.toString() }],
    [{ subjectType: "incident" }],
    [{ subjectType: "incident", subjectId: "   " }],
    [{ subjectType: "incident", subjectId: "not-a-uuid" }],
    [{ subjectType: "incident", subjectId: 42 }],
  ])(
    "a malformed request %j is refused, and nothing starts",
    async (body: JSONObject) => {
      const next: NextMock = await call("/ai-investigation/try-again", body);

      expect(next).toHaveBeenCalled();
      expect(tryAgain).not.toHaveBeenCalled();
    },
  );

  it("what stopped it is told in the server's own words, with its code beside them", async () => {
    tryAgain.mockRejectedValue(
      new AiRunRefusalException(AiRunRefusalCode.IncidentInvestigationRunning),
    );

    const next: NextMock = await call("/ai-investigation/try-again", {
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect((next.mock.calls[0]![0] as Error).message).toBe(
      "This incident's investigation is queued or running already.",
    );
    expect(next.mock.calls[0]![0]).toMatchObject({
      details: { refusalCode: "incident_investigation_running" },
    });
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("the AI investigation card says whether the reader may try again", () => {
  it.each([AIRunStatus.Error, AIRunStatus.Stale, AIRunStatus.Cancelled])(
    "an investigation that is %s: yes, for who may change the incident",
    async (status: AIRunStatus) => {
      jest.spyOn(AIRunService, "findBy").mockResolvedValue([runThatIs(status)]);

      const next: NextMock = await call("/ai-investigation/incident", {
        incidentId: INCIDENT_ID.toString(),
      });

      expect(next).not.toHaveBeenCalled();
      expect(sentPayload()["mayTryAgain"]).toBe(true);
    },
  );

  it("not for who may only read the incident", async () => {
    jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([runThatIs(AIRunStatus.Error)]);
    updatableIncident.mockRejectedValue(
      new NotAuthorizedException("You do not have permission to edit"),
    );

    await call("/ai-investigation/incident", {
      incidentId: INCIDENT_ID.toString(),
    });

    expect(sentPayload()["mayTryAgain"]).toBe(false);
  });

  it.each([
    AIRunStatus.Queued,
    AIRunStatus.Running,
    AIRunStatus.WaitingForApproval,
  ])(
    "an investigation that is %s: no, and whether they may change it is not even asked",
    async (status: AIRunStatus) => {
      jest.spyOn(AIRunService, "findBy").mockResolvedValue([runThatIs(status)]);

      await call("/ai-investigation/incident", {
        incidentId: INCIDENT_ID.toString(),
      });

      expect(sentPayload()["mayTryAgain"]).toBe(false);
      expect(updatableIncident).not.toHaveBeenCalled();
    },
  );

  it("an alert's card asks on the alert", async () => {
    jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([runThatIs(AIRunStatus.Stale)]);

    await call("/ai-investigation/alert", { alertId: ALERT_ID.toString() });

    expect(updatableAlert).toHaveBeenCalled();
    expect(sentPayload()["mayTryAgain"]).toBe(true);
  });

  it("the run's next attempt time is read for the card", async () => {
    jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([runThatIs(AIRunStatus.Queued)]);

    await call("/ai-investigation/incident", {
      incidentId: INCIDENT_ID.toString(),
    });

    expect(AIRunService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ retryAt: true }),
      }),
    );
  });
});

describe("POST /ai-insight/triage-try-again", () => {
  let tryAgain: SpyInstance<typeof InsightTriage.tryAgain>;
  let findInsight: SpyInstance<typeof AIInsightService.findOneById>;

  beforeEach(() => {
    tryAgain = jest
      .spyOn(InsightTriage, "tryAgain")
      .mockResolvedValue(NEW_RUN_ID);
    findInsight = jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(new AIInsight(INSIGHT_ID));
  });

  it("triages the insight again, and answers with the new run", async () => {
    const next: NextMock = await call("/ai-insight/triage-try-again", {
      insightId: INSIGHT_ID.toString(),
    });

    expect(next).not.toHaveBeenCalled();
    expect(tryAgain).toHaveBeenCalledWith({ insightId: INSIGHT_ID });
    expect(sentPayload()).toEqual({ runId: NEW_RUN_ID.toString() });
    // The insight is read under the person's own props: their access decides.
    expect(findInsight.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ id: INSIGHT_ID, props: member }),
    );
  });

  it("an insight the person cannot read is not found, and nothing starts", async () => {
    findInsight.mockResolvedValue(null);

    const next: NextMock = await call("/ai-insight/triage-try-again", {
      insightId: INSIGHT_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect((next.mock.calls[0]![0] as Error).message).toBe(
      "AI insight not found (or you do not have access to it).",
    );
    expect(tryAgain).not.toHaveBeenCalled();
  });

  it("no insight named: refused, and nothing starts", async () => {
    const next: NextMock = await call("/ai-insight/triage-try-again", {});

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(findInsight).not.toHaveBeenCalled();
    expect(tryAgain).not.toHaveBeenCalled();
  });

  it("a caller with no user session is refused before the insight is read", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({} as DatabaseCommonInteractionProps);

    const next: NextMock = await call("/ai-insight/triage-try-again", {
      insightId: INSIGHT_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(NotAuthenticatedException));
    expect(findInsight).not.toHaveBeenCalled();
    expect(tryAgain).not.toHaveBeenCalled();
  });

  it("what stopped it is told in the server's own words", async () => {
    tryAgain.mockRejectedValue(
      new BadDataException("This insight is being triaged already."),
    );

    const next: NextMock = await call("/ai-insight/triage-try-again", {
      insightId: INSIGHT_ID.toString(),
    });

    expect((next.mock.calls[0]![0] as Error).message).toBe(
      "This insight is being triaged already.",
    );
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("the AI insight's triage card says whether the reader may try again", () => {
  beforeEach(() => {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(new AIInsight(INSIGHT_ID));
  });

  function triageRunThatIs(status: AIRunStatus | null): void {
    jest
      .spyOn(AIInsightService, "getLatestTriageRunWithEvents")
      .mockResolvedValue({
        run: status ? runThatIs(status) : null,
        events: [] as Array<AIRunEvent>,
      });
  }

  it.each([AIRunStatus.Error, AIRunStatus.Stale, AIRunStatus.Cancelled])(
    "a triage that is %s: yes",
    async (status: AIRunStatus) => {
      triageRunThatIs(status);

      const next: NextMock = await call("/ai-insight/triage-run", {
        insightId: INSIGHT_ID.toString(),
      });

      expect(next).not.toHaveBeenCalled();
      expect(sentPayload()["mayTryAgain"]).toBe(true);
    },
  );

  it.each([AIRunStatus.Completed, AIRunStatus.Queued, AIRunStatus.Running])(
    "a triage that is %s: no",
    async (status: AIRunStatus) => {
      triageRunThatIs(status);

      await call("/ai-insight/triage-run", {
        insightId: INSIGHT_ID.toString(),
      });

      expect(sentPayload()["mayTryAgain"]).toBe(false);
    },
  );

  it("no triage at all: no", async () => {
    triageRunThatIs(null);

    await call("/ai-insight/triage-run", {
      insightId: INSIGHT_ID.toString(),
    });

    expect(sentPayload()).toEqual({
      run: null,
      events: [],
      mayTryAgain: false,
    });
  });
});

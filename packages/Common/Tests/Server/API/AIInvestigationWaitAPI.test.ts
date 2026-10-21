import { mockRouter } from "./Helpers";
import "../../../Server/API/AIInvestigationAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIRunService from "../../../Server/Services/AIRunService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import InvestigationEligibility from "../../../Server/Utils/AI/SRE/InvestigationEligibility";
import InvestigationRuleWait, {
  StartNowResult,
} from "../../../Server/Utils/AI/SRE/InvestigationRuleWait";
import PostedRootCause from "../../../Server/Utils/AI/SRE/PostedRootCause";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
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
 * THE AI INVESTIGATION CARD WHILE A RULE WAITS (issue #5074).
 *
 * - The panel's payload says when a waiting investigation starts, the wait,
 *   and whether the viewer may start it now - and gives no "not
 *   investigated" reason, since nothing was decided against it. A run, once
 *   there, is what the card shows.
 * - POST /ai-investigation/investigate-now starts it at once for a member of
 *   the tenant who may read AND change the record (the rule Ask AI's
 *   start_investigation follows); it is refused otherwise, saying why, and
 *   whatever stopped it is the server's own sentence.
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
const WAIT_UNTIL: Date = new Date("2026-10-20T10:40:00.000Z");

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

let getWaiting: SpyInstance<typeof InvestigationRuleWait.getWaiting>;
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
  getWaiting = jest
    .spyOn(InvestigationRuleWait, "getWaiting")
    .mockResolvedValue({ waitUntil: WAIT_UNTIL, waitMinutes: 10 });
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

describe("the panel's payload while an investigation waits", () => {
  it("says until when and the wait, gives no reason, and lets who may change the incident start it now", async () => {
    const reason: SpyInstance<
      typeof InvestigationEligibility.getNotStartedReason
    > = jest.spyOn(InvestigationEligibility, "getNotStartedReason");

    const next: NextMock = await call("/ai-investigation/incident", {
      incidentId: INCIDENT_ID.toString(),
    });

    expect(next).not.toHaveBeenCalled();
    expect(sentPayload()).toMatchObject({
      run: null,
      notInvestigatedReason: null,
      waitingInvestigation: {
        waitUntil: WAIT_UNTIL.toISOString(),
        waitMinutes: 10,
        canStartNow: true,
      },
    });
    expect(reason).not.toHaveBeenCalled();
    expect(getWaiting).toHaveBeenCalledWith({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });
    // Whether they may change it is asked under their own props, pinned to the tenant.
    expect(updatableIncident.mock.calls[0]![0]).toEqual({
      id: INCIDENT_ID,
      select: { _id: true },
      props: { ...member, isMultiTenantRequest: false },
    });
  });

  it("a viewer who may not change the incident is not offered Investigate now", async () => {
    updatableIncident.mockRejectedValue(
      new NotAuthorizedException("You do not have permission to edit"),
    );

    await call("/ai-investigation/incident", {
      incidentId: INCIDENT_ID.toString(),
    });

    expect(
      (sentPayload()["waitingInvestigation"] as JSONObject)["canStartNow"],
    ).toBe(false);
  });

  it("a record held from the viewer's updates (labels, owners) is not offered it either", async () => {
    updatableIncident.mockResolvedValue(null);

    await call("/ai-investigation/incident", {
      incidentId: INCIDENT_ID.toString(),
    });

    expect(
      (sentPayload()["waitingInvestigation"] as JSONObject)["canStartNow"],
    ).toBe(false);
  });

  it("an alert's wait is read on the alert's lane", async () => {
    getWaiting.mockResolvedValue({ waitUntil: WAIT_UNTIL, waitMinutes: 5 });

    await call("/ai-investigation/alert", { alertId: ALERT_ID.toString() });

    expect(getWaiting).toHaveBeenCalledWith({
      lane: "Alert",
      projectId: PROJECT_ID,
      subjectId: ALERT_ID,
    });
    expect(updatableAlert).toHaveBeenCalled();
    expect(sentPayload()["waitingInvestigation"]).toEqual({
      waitUntil: WAIT_UNTIL.toISOString(),
      waitMinutes: 5,
      canStartNow: true,
    });
  });

  it("nothing waits: the reason is given as before, and the payload says nothing waits", async () => {
    getWaiting.mockResolvedValue(null);
    jest
      .spyOn(InvestigationEligibility, "getNotStartedReason")
      .mockResolvedValue(
        InvestigationEligibility.reason("monitor_cooldown", {
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
        }),
      );

    await call("/ai-investigation/incident", {
      incidentId: INCIDENT_ID.toString(),
    });

    expect(sentPayload()["waitingInvestigation"]).toBeNull();
    expect((sentPayload()["notInvestigatedReason"] as JSONObject)["code"]).toBe(
      "monitor_cooldown",
    );
    expect(updatableIncident).not.toHaveBeenCalled();
  });

  it("a run, once there, is what the card shows: the wait is not read", async () => {
    const run: AIRun = new AIRun(RUN_ID);
    run.status = AIRunStatus.Queued;
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([run]);

    await call("/ai-investigation/incident", {
      incidentId: INCIDENT_ID.toString(),
    });

    expect(sentPayload()["waitingInvestigation"]).toBeNull();
    expect(getWaiting).not.toHaveBeenCalled();
  });
});

describe("POST /ai-investigation/investigate-now", () => {
  let startNow: SpyInstance<typeof InvestigationRuleWait.startNow>;

  beforeEach(() => {
    startNow = jest
      .spyOn(InvestigationRuleWait, "startNow")
      .mockResolvedValue({ isStarted: true, runId: RUN_ID });
  });

  it("starts the incident's waiting investigation now, and answers with the run", async () => {
    const next: NextMock = await call("/ai-investigation/investigate-now", {
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(next).not.toHaveBeenCalled();
    expect(startNow).toHaveBeenCalledWith({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });
    expect(sentPayload()).toEqual({ runId: RUN_ID.toString() });
  });

  it("an alert's starts on the alert's lane", async () => {
    await call("/ai-investigation/investigate-now", {
      subjectType: "alert",
      subjectId: ALERT_ID.toString(),
    });

    expect(startNow).toHaveBeenCalledWith({
      lane: "Alert",
      projectId: PROJECT_ID,
      subjectId: ALERT_ID,
    });
  });

  it("someone who may read the incident but not change it is refused, and nothing starts", async () => {
    updatableIncident.mockRejectedValue(
      new NotAuthorizedException("You do not have permission to edit"),
    );

    const next: NextMock = await call("/ai-investigation/investigate-now", {
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
    expect((next.mock.calls[0]![0] as Error).message).toBe(
      "You do not have permission to change this incident, so you cannot start its investigation.",
    );
    expect(startNow).not.toHaveBeenCalled();
  });

  it("a record the viewer cannot read is not found, and nothing starts", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null);

    const next: NextMock = await call("/ai-investigation/investigate-now", {
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(startNow).not.toHaveBeenCalled();
  });

  it("a record of another project is refused, whatever the viewer may do there", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incidentIn(OTHER_PROJECT_ID));

    const next: NextMock = await call("/ai-investigation/investigate-now", {
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(next).toHaveBeenCalled();
    expect(startNow).not.toHaveBeenCalled();
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

    const next: NextMock = await call("/ai-investigation/investigate-now", {
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
    expect(read).not.toHaveBeenCalled();
    expect(startNow).not.toHaveBeenCalled();
  });

  it.each([
    [{ subjectType: "monitor", subjectId: INCIDENT_ID.toString() }],
    [{ subjectType: "incident" }],
    [{ subjectType: "incident", subjectId: "   " }],
    [{ subjectType: "incident", subjectId: "not-a-uuid" }],
  ])(
    "a malformed request %j is refused, and nothing starts",
    async (body: JSONObject) => {
      const next: NextMock = await call(
        "/ai-investigation/investigate-now",
        body,
      );

      expect(next).toHaveBeenCalled();
      expect(startNow).not.toHaveBeenCalled();
    },
  );

  it("what stopped it is told in the server's own words", async () => {
    const refused: StartNowResult = {
      isStarted: false,
      problem: "project_daily_limit_reached",
      message:
        "This project has reached its own daily AI limit. It resets at midnight UTC.",
    };
    startNow.mockResolvedValue(refused);

    const next: NextMock = await call("/ai-investigation/investigate-now", {
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect((next.mock.calls[0]![0] as Error).message).toBe(refused.message);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

import CommonAPI from "../../../Server/API/CommonAPI";
import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import {
  getRemediationTryAgainRefusal,
  RemediationTryAgainRefusal,
  RemediationTryAgainResult,
} from "../../../Types/AutoRemediation/RemediationTryAgain";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /auto-remediation/try-again (Common/Server/API/AutoRemediationAPI):
 * Try again on the Remediation step of an incident's or alert's AI card
 * (block 43). Pinned here:
 *
 *   - a signed-in member of the project the request names, and exactly one
 *     incident or alert, by a valid id, before anything is read;
 *   - the record read as that person, inside that project - "not found"
 *     and "not yours" read alike - and changed only by someone who may
 *     change it (Try again may start a fix on it);
 *   - the engine decides; its refusals reach the step as one sentence for
 *     the kind of record.
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
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
    },
  };
});

const ROUTE: string = "/auto-remediation/try-again";
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const INCIDENT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ALERT_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const sendJsonMock: jest.Mock =
  Response.sendJsonObjectResponse as unknown as jest.Mock;

function memberProps(): DatabaseCommonInteractionProps {
  const permission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectMember,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    isMultiTenantRequest: true,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: permission },
  };
}

function incidentIn(projectId: ObjectID): Incident {
  const incident: Incident = new Incident();
  incident.id = INCIDENT_ID;
  incident.projectId = projectId;
  return incident;
}

function alertIn(projectId: ObjectID): Alert {
  const alert: Alert = new Alert();
  alert.id = ALERT_ID;
  alert.projectId = projectId;
  return alert;
}

interface Spies {
  readIncident: jest.SpyInstance;
  updatableIncident: jest.SpyInstance;
  readAlert: jest.SpyInstance;
  updatableAlert: jest.SpyInstance;
  tryAgain: jest.SpyInstance;
}

function installSpies(data?: {
  props?: DatabaseCommonInteractionProps;
  incident?: Incident | null;
  isIncidentUpdatable?: boolean;
  alert?: Alert | null;
  isAlertUpdatable?: boolean;
  result?: RemediationTryAgainResult;
}): Spies {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(data?.props || memberProps());

  const incident: Incident | null =
    data && Object.prototype.hasOwnProperty.call(data, "incident")
      ? data.incident!
      : incidentIn(PROJECT_ID);
  const alert: Alert | null =
    data && Object.prototype.hasOwnProperty.call(data, "alert")
      ? data.alert!
      : alertIn(PROJECT_ID);

  return {
    readIncident: jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident as never),
    updatableIncident: jest
      .spyOn(IncidentService, "findOneUpdatableById")
      .mockResolvedValue(
        (data?.isIncidentUpdatable === false ? null : incident) as never,
      ),
    readAlert: jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(alert as never),
    updatableAlert: jest
      .spyOn(AlertService, "findOneUpdatableById")
      .mockResolvedValue(
        (data?.isAlertUpdatable === false ? null : alert) as never,
      ),
    tryAgain: jest
      .spyOn(AutoRemediationRuleEngineService, "tryAgain")
      .mockResolvedValue(
        (data?.result || RemediationTryAgainResult.Evaluated) as never,
      ),
  };
}

async function callRoute(body: JSONObject): Promise<{
  error: unknown;
  json: JSONObject | undefined;
}> {
  const next: jest.Mock = jest.fn();
  const req: ExpressRequest = {
    body,
    headers: {},
    params: {},
    query: {},
  } as unknown as ExpressRequest;

  await mockRouter
    .match("POST", ROUTE)
    .handlerFunction(req, {} as ExpressResponse, next as NextFunction);

  return {
    error: next.mock.calls[0]?.[0],
    json: sendJsonMock.mock.calls[0]?.[2] as JSONObject | undefined,
  };
}

beforeAll(async () => {
  mockRouter.routes.length = 0;
  await import("../../../Server/API/AutoRemediationAPI");
});

beforeEach(() => {
  sendJsonMock.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /auto-remediation/try-again", () => {
  test("is a signed-in route", () => {
    expect(mockRouter.match("POST", ROUTE).middleware).toBe(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("an incident decided again answers Evaluated, decided in the project the request names", async () => {
    const spies: Spies = installSpies();

    const { error, json } = await callRoute({
      incidentId: INCIDENT_ID.toString(),
    });

    expect(error).toBeUndefined();
    expect(json).toEqual({ result: RemediationTryAgainResult.Evaluated });
    expect(spies.tryAgain).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });
  });

  test("an alert is decided again as an alert", async () => {
    const spies: Spies = installSpies();

    const { error } = await callRoute({ alertId: ALERT_ID.toString() });

    expect(error).toBeUndefined();
    expect(spies.tryAgain).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
    });
    expect(spies.readIncident).not.toHaveBeenCalled();
  });

  test("the record is read as the person asking, pinned to the project they asked in", async () => {
    const spies: Spies = installSpies();

    await callRoute({ incidentId: INCIDENT_ID.toString() });

    const readProps: DatabaseCommonInteractionProps = (
      spies.readIncident.mock.calls[0]![0] as {
        props: DatabaseCommonInteractionProps;
      }
    ).props;
    expect(readProps.isRoot).toBeUndefined();
    expect(readProps.userId).toBe(USER_ID);
    expect(readProps.isMultiTenantRequest).toBe(false);

    const updateProps: DatabaseCommonInteractionProps = (
      spies.updatableIncident.mock.calls[0]![0] as {
        props: DatabaseCommonInteractionProps;
      }
    ).props;
    expect(updateProps.isMultiTenantRequest).toBe(false);
  });

  test.each([
    ["no record", {}],
    [
      "both kinds of record",
      { incidentId: INCIDENT_ID.toString(), alertId: ALERT_ID.toString() },
    ],
    ["an id that is not one", { incidentId: "incident-1" }],
    ["a number", { alertId: 7 }],
  ] as Array<[string, JSONObject]>)(
    "refuses %s before reading anything",
    async (_case: string, body: JSONObject) => {
      const spies: Spies = installSpies();

      const { error } = await callRoute(body);

      expect(error).toBeInstanceOf(BadDataException);
      expect(spies.readIncident).not.toHaveBeenCalled();
      expect(spies.readAlert).not.toHaveBeenCalled();
      expect(spies.tryAgain).not.toHaveBeenCalled();
    },
  );

  test("refuses someone who is not a member of the project they name", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();
    props.userTenantAccessPermission = {};
    const spies: Spies = installSpies({ props });

    const { error } = await callRoute({ incidentId: INCIDENT_ID.toString() });

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(spies.readIncident).not.toHaveBeenCalled();
    expect(spies.tryAgain).not.toHaveBeenCalled();
  });

  test.each([
    ["it does not exist, or the person may not read it", null],
    [
      "it belongs to another project",
      ((): Incident => {
        return incidentIn(OTHER_PROJECT_ID);
      })(),
    ],
  ])(
    "an incident %s reads alike: not found",
    async (_case: string, incident: Incident | null) => {
      const spies: Spies = installSpies({ incident });

      const { error } = await callRoute({
        incidentId: INCIDENT_ID.toString(),
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(
        "Incident not found (or you do not have access to it).",
      );
      expect(spies.tryAgain).not.toHaveBeenCalled();
    },
  );

  test("someone who may read the incident but not change it is refused", async () => {
    const spies: Spies = installSpies({ isIncidentUpdatable: false });

    const { error } = await callRoute({ incidentId: INCIDENT_ID.toString() });

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect((error as Error).message).toBe(
      "You do not have permission to change this incident, so you cannot ask OneUptime AI to try fixing it again.",
    );
    expect(spies.tryAgain).not.toHaveBeenCalled();
  });

  test("a change check that throws refuses too, rather than decide", async () => {
    const spies: Spies = installSpies();
    spies.updatableAlert.mockRejectedValue(
      new NotAuthorizedException("blocked by a team"),
    );

    const { error } = await callRoute({ alertId: ALERT_ID.toString() });

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect((error as Error).message).toContain("this alert");
    expect(spies.tryAgain).not.toHaveBeenCalled();
  });

  const REFUSALS: Array<RemediationTryAgainRefusal> = [
    RemediationTryAgainResult.Resolved,
    RemediationTryAgainResult.WaitingForInvestigation,
    RemediationTryAgainResult.FixInProgress,
    RemediationTryAgainResult.TooSoon,
    RemediationTryAgainResult.Busy,
  ];

  test.each(REFUSALS)(
    "the engine's %s reaches the step as the sentence for the kind of record",
    async (result: RemediationTryAgainRefusal) => {
      installSpies({ result });

      const incidentCall: { error: unknown } = await callRoute({
        incidentId: INCIDENT_ID.toString(),
      });
      expect(incidentCall.error).toBeInstanceOf(BadDataException);
      expect((incidentCall.error as Error).message).toBe(
        getRemediationTryAgainRefusal({ result, signal: "incident" }),
      );

      sendJsonMock.mockReset();
      const alertCall: { error: unknown } = await callRoute({
        alertId: ALERT_ID.toString(),
      });
      expect((alertCall.error as Error).message).toBe(
        getRemediationTryAgainRefusal({ result, signal: "alert" }),
      );
      expect(sendJsonMock).not.toHaveBeenCalled();
    },
  );
});

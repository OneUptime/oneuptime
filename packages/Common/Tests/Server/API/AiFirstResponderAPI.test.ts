import { mockRouter } from "./Helpers";
import { PAGE_NOW_REFUSED_MESSAGE } from "../../../Server/API/AiFirstResponderAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import AiFirstResponder from "../../../Server/Utils/AI/FirstResponder/AiFirstResponder";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
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
 * PAGE NOW (POST /ai-first-responder/page-now): someone does not want to wait
 * for OneUptime AI, and the pages it holds for an incident or alert start at
 * once (AiFirstResponder.pageNow), saying who asked.
 *
 * It pages people, so it takes what paging an on-call policy takes - the
 * create permission of an execution log - in the record's own project. The
 * record is read as the caller may see it, so another project's id is
 * refused like one that does not exist, and it is a person's act: an
 * anonymous caller gets 401, an API key the route's own refusal.
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

const PAGE_NOW_URI: string = "/ai-first-responder/page-now";

const INCIDENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
);
const ALERT_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc");
const USER_ID: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccd");
const PROJECT_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddf",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4121-8121-121212121213",
);

// A signed-in person whose rows in the project are `rows`.
function personWith(
  rows: Array<{ permission: Permission; isBlockPermission?: boolean }>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows.map(
          (row: {
            permission: Permission;
            isBlockPermission?: boolean;
          }): UserPermission => {
            return {
              _type: "UserPermission",
              permission: row.permission,
              labelIds: [],
              isBlockPermission: row.isBlockPermission,
            } as UserPermission;
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

const member: DatabaseCommonInteractionProps = personWith([
  { permission: Permission.ProjectMember },
]);

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

async function pageNow(body: JSONObject): Promise<NextMock> {
  const next: NextMock = jest.fn();

  await mockRouter
    .match("post", PAGE_NOW_URI)
    .handlerFunction(
      { body } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return next;
}

function refusal(next: NextMock): unknown {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0]![0];
}

function callAs(props: DatabaseCommonInteractionProps): void {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);
}

let startHolds: SpyInstance<typeof AiFirstResponder.pageNow>;
let findIncident: SpyInstance<typeof IncidentService.findOneById>;
let findAlert: SpyInstance<typeof AlertService.findOneById>;

beforeEach(() => {
  jest.clearAllMocks();
  callAs(member);
  findIncident = jest
    .spyOn(IncidentService, "findOneById")
    .mockResolvedValue(incidentIn(PROJECT_ID));
  findAlert = jest
    .spyOn(AlertService, "findOneById")
    .mockResolvedValue(alertIn(PROJECT_ID));
  startHolds = jest.spyOn(AiFirstResponder, "pageNow").mockResolvedValue(2);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Page now for an incident", () => {
  it("starts the pages OneUptime AI holds for it, saying who asked, and says how many", async () => {
    const next: NextMock = await pageNow({
      incidentId: INCIDENT_ID.toString(),
    });

    expect(next).not.toHaveBeenCalled();
    expect(startHolds).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      alertId: undefined,
      userId: USER_ID,
    });
    expect(sentPayload()).toEqual({ startedRuns: 2 });
    expect(findAlert).not.toHaveBeenCalled();
  });

  it("reads the incident as the caller may see it", async () => {
    await pageNow({ incidentId: INCIDENT_ID.toString() });

    expect(findIncident).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      select: { _id: true, projectId: true },
      props: member,
    });
  });

  it("with nothing held, says it started none", async () => {
    startHolds.mockResolvedValue(0);

    const next: NextMock = await pageNow({
      incidentId: INCIDENT_ID.toString(),
    });

    expect(next).not.toHaveBeenCalled();
    expect(sentPayload()).toEqual({ startedRuns: 0 });
  });

  it("refuses an incident the caller cannot see, as if it did not exist", async () => {
    findIncident.mockResolvedValue(null);

    const next: NextMock = await pageNow({
      incidentId: INCIDENT_ID.toString(),
    });

    expect(refusal(next)).toEqual(expect.any(BadDataException));
    expect((refusal(next) as Error).message).toBe(
      "Incident not found (or you do not have access to it).",
    );
    expect(startHolds).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  it("refuses an incident in a project the caller holds nothing in", async () => {
    findIncident.mockResolvedValue(incidentIn(OTHER_PROJECT_ID));

    const next: NextMock = await pageNow({
      incidentId: INCIDENT_ID.toString(),
    });

    expect(refusal(next)).toEqual(expect.any(NotAuthorizedException));
    expect(startHolds).not.toHaveBeenCalled();
  });
});

describe("Page now for an alert", () => {
  it("starts the pages OneUptime AI holds for it, saying who asked", async () => {
    const next: NextMock = await pageNow({ alertId: ALERT_ID.toString() });

    expect(next).not.toHaveBeenCalled();
    expect(findAlert).toHaveBeenCalledWith({
      id: ALERT_ID,
      select: { _id: true, projectId: true },
      props: member,
    });
    expect(startHolds).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      incidentId: undefined,
      alertId: ALERT_ID,
      userId: USER_ID,
    });
    expect(findIncident).not.toHaveBeenCalled();
  });

  it("refuses an alert the caller cannot see, as if it did not exist", async () => {
    findAlert.mockResolvedValue(null);

    const next: NextMock = await pageNow({ alertId: ALERT_ID.toString() });

    expect(refusal(next)).toEqual(expect.any(BadDataException));
    expect((refusal(next) as Error).message).toBe(
      "Alert not found (or you do not have access to it).",
    );
    expect(startHolds).not.toHaveBeenCalled();
  });
});

describe("what Page now is sent", () => {
  it.each([
    ["neither id", {}],
    [
      "both ids",
      { incidentId: INCIDENT_ID.toString(), alertId: ALERT_ID.toString() },
    ],
    ["an empty id", { incidentId: "" }],
    ["an id that is not text", { incidentId: 42 }],
    [
      "an empty id beside another that is not text",
      { alertId: "", incidentId: 7 },
    ],
  ])("refuses %s, reading nothing", async (_case: string, body: JSONObject) => {
    const next: NextMock = await pageNow(body);

    expect(refusal(next)).toEqual(expect.any(BadDataException));
    expect((refusal(next) as Error).message).toBe(
      "Send one of incidentId or alertId.",
    );
    expect(findIncident).not.toHaveBeenCalled();
    expect(findAlert).not.toHaveBeenCalled();
    expect(startHolds).not.toHaveBeenCalled();
  });
});

describe("who may page now", () => {
  it.each([
    ["a project owner", Permission.ProjectOwner],
    ["a project admin", Permission.ProjectAdmin],
    ["an on-call admin", Permission.OnCallAdmin],
    ["an on-call member", Permission.OnCallMember],
    [
      "someone who may page on-call policies",
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
  ])("%s may", async (_who: string, permission: Permission) => {
    callAs(personWith([{ permission: permission }]));

    const next: NextMock = await pageNow({
      incidentId: INCIDENT_ID.toString(),
    });

    expect(next).not.toHaveBeenCalled();
    expect(startHolds).toHaveBeenCalledTimes(1);
  });

  it("a viewer may not, and is told what they need", async () => {
    callAs(personWith([{ permission: Permission.Viewer }]));

    const next: NextMock = await pageNow({
      incidentId: INCIDENT_ID.toString(),
    });

    expect(refusal(next)).toEqual(expect.any(NotAuthorizedException));
    expect((refusal(next) as Error).message).toBe(PAGE_NOW_REFUSED_MESSAGE);
    expect(startHolds).not.toHaveBeenCalled();
  });

  it("a member blocked from paging on-call policies may not", async () => {
    callAs(
      personWith([
        { permission: Permission.ProjectMember },
        {
          permission: Permission.CreateProjectOnCallDutyPolicyExecutionLog,
          isBlockPermission: true,
        },
      ]),
    );

    const next: NextMock = await pageNow({
      incidentId: INCIDENT_ID.toString(),
    });

    expect(refusal(next)).toEqual(expect.any(NotAuthorizedException));
    expect(startHolds).not.toHaveBeenCalled();
  });

  it("an anonymous caller is asked to sign in (401), before anything is read", async () => {
    callAs({ tenantId: PROJECT_ID } as DatabaseCommonInteractionProps);

    const next: NextMock = await pageNow({
      incidentId: INCIDENT_ID.toString(),
    });

    expect(refusal(next)).toEqual(expect.any(NotAuthenticatedException));
    expect(findIncident).not.toHaveBeenCalled();
    expect(startHolds).not.toHaveBeenCalled();
  });

  it("an API key may not: Page now is a person's", async () => {
    callAs({
      ...personWith([{ permission: Permission.ProjectOwner }]),
      userId: undefined,
      userType: UserType.API,
    } as DatabaseCommonInteractionProps);

    const next: NextMock = await pageNow({
      incidentId: INCIDENT_ID.toString(),
    });

    expect(refusal(next)).toEqual(expect.any(NotAuthorizedException));
    expect(findIncident).not.toHaveBeenCalled();
    expect(startHolds).not.toHaveBeenCalled();
  });

  it("is mounted behind UserMiddleware.getUserMiddleware", () => {
    expect(mockRouter.match("post", PAGE_NOW_URI).middlewares).toContain(
      UserMiddleware.getUserMiddleware,
    );
  });
});

describe("when paging fails", () => {
  it("hands the error on, and sends nothing", async () => {
    startHolds.mockRejectedValue(new Error("Database is down"));

    const next: NextMock = await pageNow({
      incidentId: INCIDENT_ID.toString(),
    });

    expect((refusal(next) as Error).message).toBe("Database is down");
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

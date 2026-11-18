import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import {
  WHO_WAS_TOLD_API_PATH,
  WHO_WAS_TOLD_ID_MESSAGES,
  readRecordIdParam,
} from "../../../Server/API/WhoWasToldAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import WhoWasToldService from "../../../Server/Services/WhoWasToldService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import { WhoWasToldResult } from "../../../Types/Notification/WhoWasTold";
import ObjectID from "../../../Types/ObjectID";
import { OnCallTestPageRecordKind } from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GET /who-was-told/incident/:incidentId and /who-was-told/alert/:alertId
 * (#7075): a signed-in member of the project asks; the service reads the
 * record and everything about it as them.
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
    sendErrorResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
  };
});

const PROJECT: ObjectID = new ObjectID("70750000-1111-4000-8000-000000000001");
const INCIDENT: ObjectID = new ObjectID("70750000-1111-4000-8000-000000000002");
const ALERT: ObjectID = new ObjectID("70750000-1111-4000-8000-000000000003");
const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: new ObjectID("70750000-1111-4000-8000-0000000000a1"),
};

const ANSWER: WhoWasToldResult = {
  recordKind: OnCallTestPageRecordKind.Incident,
  recordId: INCIDENT.toString(),
  checkedAt: "2026-11-17T10:00:00.000Z",
  people: [],
  channels: [],
  notPaged: [],
  runs: [],
  hiddenNotificationCount: 0,
  hiddenRunCount: 0,
  isTruncated: false,
};

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

async function call(data: {
  path: string;
  params?: JSONObject;
}): Promise<{ thrown: unknown; sent: unknown }> {
  const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
    "GET",
    data.path,
  );

  let thrown: unknown = undefined;

  await (route.handlerFunction as RouterFunction)(
    {
      params: data.params || {},
      query: {},
      headers: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    ((err: unknown) => {
      thrown = err;
    }) as NextFunction,
  );

  return {
    thrown: thrown,
    sent: (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
      .calls[0]?.[2],
  };
}

const INCIDENT_PATH: string = `${WHO_WAS_TOLD_API_PATH}/incident/:incidentId`;
const ALERT_PATH: string = `${WHO_WAS_TOLD_API_PATH}/alert/:alertId`;

let getForIncident: jest.SpyInstance;
let getForAlert: jest.SpyInstance;

beforeEach(() => {
  jest.restoreAllMocks();
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(PROPS as never);
  jest
    .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
    .mockReturnValue(PROJECT as never);
  getForIncident = jest
    .spyOn(WhoWasToldService, "getForIncident")
    .mockResolvedValue(ANSWER as never);
  getForAlert = jest.spyOn(WhoWasToldService, "getForAlert").mockResolvedValue({
    ...ANSWER,
    recordKind: OnCallTestPageRecordKind.Alert,
    recordId: ALERT.toString(),
  } as never);
});

describe("GET /who-was-told/incident/:incidentId", () => {
  test("asks the signed-in member's middleware first", () => {
    expect(mockRouter.match("GET", INCIDENT_PATH).middleware).toBe(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("hands back the answer read as the caller, for the project they were let into", async () => {
    const { thrown, sent } = await call({
      path: INCIDENT_PATH,
      params: { incidentId: INCIDENT.toString() },
    });

    expect(thrown).toBeUndefined();
    expect(sent).toEqual(ANSWER);
    expect(getForIncident).toHaveBeenCalledWith({
      projectId: PROJECT,
      incidentId: INCIDENT,
      props: PROPS,
    });
  });

  test("a caller who is not a member of the project is refused before anything is read", async () => {
    jest
      .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
      .mockImplementation(() => {
        throw new NotAuthorizedException("Not a member.");
      });

    const { thrown } = await call({
      path: INCIDENT_PATH,
      params: { incidentId: INCIDENT.toString() },
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(getForIncident).not.toHaveBeenCalled();
  });

  test("an id that is not one is refused, in a sentence", async () => {
    const { thrown } = await call({
      path: INCIDENT_PATH,
      params: { incidentId: "not-an-id" },
    });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as Error).message).toBe(WHO_WAS_TOLD_ID_MESSAGES.incidentId);
    expect(getForIncident).not.toHaveBeenCalled();
  });

  test("an incident the caller may not read is passed on as not found", async () => {
    getForIncident.mockRejectedValue(
      new NotFoundException("Incident not found."),
    );

    const { thrown } = await call({
      path: INCIDENT_PATH,
      params: { incidentId: INCIDENT.toString() },
    });

    expect(thrown).toBeInstanceOf(NotFoundException);
  });
});

describe("GET /who-was-told/alert/:alertId", () => {
  test("asks the signed-in member's middleware first", () => {
    expect(mockRouter.match("GET", ALERT_PATH).middleware).toBe(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("hands back the alert's answer, read as the caller", async () => {
    const { thrown, sent } = await call({
      path: ALERT_PATH,
      params: { alertId: ALERT.toString() },
    });

    expect(thrown).toBeUndefined();
    expect((sent as WhoWasToldResult).recordKind).toBe(
      OnCallTestPageRecordKind.Alert,
    );
    expect(getForAlert).toHaveBeenCalledWith({
      projectId: PROJECT,
      alertId: ALERT,
      props: PROPS,
    });
    expect(getForIncident).not.toHaveBeenCalled();
  });

  test("an id that is not one is refused", async () => {
    const { thrown } = await call({
      path: ALERT_PATH,
      params: { alertId: "" },
    });

    expect((thrown as Error).message).toBe(WHO_WAS_TOLD_ID_MESSAGES.alertId);
    expect(getForAlert).not.toHaveBeenCalled();
  });
});

describe("reading the request", () => {
  test("the id, trimmed", () => {
    expect(
      readRecordIdParam(
        {
          params: { incidentId: ` ${INCIDENT.toString()} ` },
        } as unknown as ExpressRequest,
        "incidentId",
      ).toString(),
    ).toBe(INCIDENT.toString());
  });
});

import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import {
  WHO_IS_TOLD_API_PATH,
  isRefreshRequested,
  readMonitorIdParam,
} from "../../../Server/API/WhoIsToldAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import WhoIsToldService from "../../../Server/Services/WhoIsToldService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import { WhoIsToldResult } from "../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GET /who-is-told/monitor/:monitorId (#6810): a signed-in member of the
 * project asks; the service checks they may read the monitor and hides what
 * they may not read; `refresh=true` works the answer out again.
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

const PROJECT: ObjectID = new ObjectID("68103333-0000-4000-8000-000000000001");
const MONITOR: ObjectID = new ObjectID("68103333-0000-4000-8000-000000000002");
const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: new ObjectID("68103333-0000-4000-8000-0000000000a1"),
};

const ANSWER: WhoIsToldResult = {
  monitorId: MONITOR.toString(),
  monitorName: "Checkout API",
  checkedAt: "2026-11-12T10:00:00.000Z",
  criteria: [],
  channels: {
    isBillingEnabled: false,
    isSmsOn: true,
    isCallOn: true,
    isWhatsAppOn: true,
    isTelegramOn: true,
    hasOwnTwilioForSms: false,
    hasOwnTwilioForCalls: false,
    serverCanSendEmail: true,
    serverCanSendSms: true,
    serverCanCall: true,
  },
  breaks: [],
};

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

async function call(data: {
  params?: JSONObject;
  query?: JSONObject;
}): Promise<{ thrown: unknown; sent: unknown }> {
  const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
    "GET",
    `${WHO_IS_TOLD_API_PATH}/monitor/:monitorId`,
  );

  let thrown: unknown = undefined;

  await (route.handlerFunction as RouterFunction)(
    {
      params: data.params || {},
      query: data.query || {},
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

let getForMonitor: jest.SpyInstance;

beforeEach(() => {
  jest.restoreAllMocks();
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(PROPS as never);
  jest
    .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
    .mockReturnValue(PROJECT as never);
  getForMonitor = jest
    .spyOn(WhoIsToldService, "getForMonitor")
    .mockResolvedValue(ANSWER as never);
});

describe("GET /who-is-told/monitor/:monitorId", () => {
  test("asks the signed-in member's middleware first", () => {
    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "GET",
      `${WHO_IS_TOLD_API_PATH}/monitor/:monitorId`,
    );

    expect(route.middleware).toBe(UserMiddleware.getUserMiddleware);
  });

  test("hands back the answer for the caller, for the project they were let into", async () => {
    const { thrown, sent } = await call({
      params: { monitorId: MONITOR.toString() },
    });

    expect(thrown).toBeUndefined();
    expect(sent).toEqual(ANSWER);
    expect(getForMonitor).toHaveBeenCalledWith({
      projectId: PROJECT,
      monitorId: MONITOR,
      props: PROPS,
      refresh: false,
    });
  });

  test("refresh=true works it out again", async () => {
    await call({
      params: { monitorId: MONITOR.toString() },
      query: { refresh: "true" },
    });

    expect(getForMonitor.mock.calls[0]![0]).toMatchObject({ refresh: true });
  });

  test("a caller who is not a member of the project is refused before anything is read", async () => {
    jest
      .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
      .mockImplementation(() => {
        throw new NotAuthorizedException("Not a member.");
      });

    const { thrown } = await call({
      params: { monitorId: MONITOR.toString() },
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(getForMonitor).not.toHaveBeenCalled();
  });

  test("a monitor id that is not one is refused", async () => {
    const { thrown } = await call({ params: { monitorId: "not-an-id" } });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(getForMonitor).not.toHaveBeenCalled();
  });

  test("what the service refuses is passed on", async () => {
    getForMonitor.mockRejectedValue(new BadDataException("Monitor not found."));

    const { thrown } = await call({
      params: { monitorId: MONITOR.toString() },
    });

    expect((thrown as Error).message).toBe("Monitor not found.");
  });
});

describe("reading the request", () => {
  test("the monitor id, trimmed, or a refusal", () => {
    expect(
      readMonitorIdParam({
        params: { monitorId: ` ${MONITOR.toString()} ` },
      } as unknown as ExpressRequest).toString(),
    ).toBe(MONITOR.toString());
    expect(() => {
      return readMonitorIdParam({ params: {} } as unknown as ExpressRequest);
    }).toThrow("monitorId is required.");
  });

  test("refresh is asked only by true or 1", () => {
    const asked: (value: unknown) => boolean = (value: unknown): boolean => {
      return isRefreshRequested({
        query: value === undefined ? {} : { refresh: value },
      } as unknown as ExpressRequest);
    };

    expect(asked("true")).toBe(true);
    expect(asked("TRUE")).toBe(true);
    expect(asked("1")).toBe(true);
    expect(asked("false")).toBe(false);
    expect(asked("yes")).toBe(false);
    expect(asked(undefined)).toBe(false);
  });
});

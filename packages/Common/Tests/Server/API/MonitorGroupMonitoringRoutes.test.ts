import MonitorGroupAPI from "../../../Server/API/MonitorGroupAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

// Avoid the unrelated PasswordHash TS5.9 Buffer/BinaryLike compile failure.
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

/*
 * POST /monitor-group/monitoring-summary/:monitorGroupId,
 * /monitor-group/turn-monitoring-off/:monitorGroupId and
 * /monitor-group/turn-monitoring-on/:monitorGroupId (issue #6401): how many
 * of a group's monitors are checked, and turning monitoring off or on for
 * every one of them.
 *
 * Each needs a signed-in caller (UserMiddleware), hands the service the
 * caller's own props - so the group is read, and the monitors written, as
 * them - and answers the counts as JSON. What the service refuses goes to
 * Express's error handler.
 */

const GROUP_ID: string = "0193c0de-0e0e-4aaa-8bbb-0000000000b1";
const PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("0193c0de-0e0e-4aaa-8bbb-000000000002"),
  tenantId: new ObjectID("0193c0de-0e0e-4aaa-8bbb-000000000001"),
};

interface Answer {
  sent?: unknown;
  error?: unknown;
}

async function ask(route: string, monitorGroupId?: string): Promise<Answer> {
  const handler: ReturnType<typeof mockRouter.match>["handlerFunction"] =
    mockRouter.match("post", route).handlerFunction;

  const answer: Answer = {};

  (Response.sendJsonObjectResponse as jest.Mock).mockImplementation(((
    _req: unknown,
    _res: unknown,
    json: unknown,
  ) => {
    answer.sent = json;
  }) as never);

  const next: NextFunction = ((error: unknown) => {
    answer.error = error;
  }) as NextFunction;

  await handler(
    {
      params: monitorGroupId ? { monitorGroupId } : {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next,
  );

  return answer;
}

describe("the monitor group's monitoring routes", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new MonitorGroupAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(PROPS as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    "/monitor-group/monitoring-summary/:monitorGroupId",
    "/monitor-group/turn-monitoring-off/:monitorGroupId",
    "/monitor-group/turn-monitoring-on/:monitorGroupId",
  ])("%s is a POST for a signed-in caller", (route: string) => {
    expect(mockRouter.match("post", route).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
  });

  it("monitoring-summary answers the group's counts, read as the caller", async () => {
    const summary: jest.SpyInstance = getJestSpyOn(
      MonitorGroupService,
      "getMonitoringSummary",
    ).mockResolvedValue({ monitorCount: 4, monitoringOffCount: 1 } as never);

    const answer: Answer = await ask(
      "/monitor-group/monitoring-summary/:monitorGroupId",
      GROUP_ID,
    );

    expect(answer.error).toBeUndefined();
    expect(answer.sent).toEqual({ monitorCount: 4, monitoringOffCount: 1 });
    expect(summary).toHaveBeenCalledWith(new ObjectID(GROUP_ID), PROPS);
  });

  it.each([
    ["/monitor-group/turn-monitoring-off/:monitorGroupId", false],
    ["/monitor-group/turn-monitoring-on/:monitorGroupId", true],
  ])(
    "%s turns every monitor of the group, as the caller, and answers what changed",
    async (route: string, isMonitoringOn: boolean) => {
      const turn: jest.SpyInstance = getJestSpyOn(
        MonitorGroupService,
        "setMonitoringForMonitorsInGroup",
      ).mockResolvedValue({
        monitorCount: 4,
        monitoringOffCount: isMonitoringOn ? 0 : 4,
        changedCount: 3,
      } as never);

      const answer: Answer = await ask(route, GROUP_ID);

      expect(answer.error).toBeUndefined();
      expect(turn).toHaveBeenCalledWith({
        monitorGroupId: new ObjectID(GROUP_ID),
        isMonitoringOn: isMonitoringOn,
        props: PROPS,
      });
      expect(answer.sent).toEqual({
        monitorCount: 4,
        monitoringOffCount: isMonitoringOn ? 0 : 4,
        changedCount: 3,
      });
    },
  );

  it("what the service refuses goes to the error handler, and nothing is sent", async () => {
    jest
      .spyOn(MonitorGroupService, "setMonitoringForMonitorsInGroup")
      .mockRejectedValue(
        new BadDataException("Monitor group not found.") as never,
      );

    const answer: Answer = await ask(
      "/monitor-group/turn-monitoring-off/:monitorGroupId",
      GROUP_ID,
    );

    expect(answer.sent).toBeUndefined();
    expect(answer.error).toEqual(
      new BadDataException("Monitor group not found."),
    );
  });

  it("no group id is a bad request, before anything is read", async () => {
    const summary: jest.SpyInstance = getJestSpyOn(
      MonitorGroupService,
      "getMonitoringSummary",
    );

    const answer: Answer = await ask(
      "/monitor-group/monitoring-summary/:monitorGroupId",
    );

    expect(answer.error).toEqual(
      new BadDataException("Monitor group id is required."),
    );
    expect(summary).not.toHaveBeenCalled();
  });
});

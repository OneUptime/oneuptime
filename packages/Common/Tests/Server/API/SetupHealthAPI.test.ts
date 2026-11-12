import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import { SETUP_HEALTH_API_PATH } from "../../../Server/API/SetupHealthAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import SetupHealthService from "../../../Server/Services/SetupHealthService";
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
import ObjectID from "../../../Types/ObjectID";
import {
  SetupHealthAnswer,
  SetupHealthSummary,
} from "../../../Types/SetupHealth/SetupHealth";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GET /setup-health and GET /setup-health/summary (#6812): a signed-in
 * member of the project asks; the service hands them the findings about
 * records they may read; `refresh=true` works them out again.
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

const PROJECT: ObjectID = new ObjectID("68124444-0000-4000-8000-000000000001");
const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: new ObjectID("68124444-0000-4000-8000-0000000000a1"),
};

const COUNTS: SetupHealthAnswer["counts"] = {
  pagesWillNotArrive: 1,
  worthFixing: 2,
  suggestion: 0,
  needsALook: 3,
};

const ANSWER: SetupHealthAnswer = {
  findings: [],
  dismissed: [],
  counts: COUNTS,
  monitorCount: 12,
  checkedAt: "2026-11-12T10:00:00.000Z",
};

const SUMMARY: SetupHealthSummary = {
  counts: COUNTS,
  checkedAt: "2026-11-12T10:00:00.000Z",
};

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

async function call(data: {
  path: string;
  query?: JSONObject;
}): Promise<{ thrown: unknown; sent: unknown }> {
  const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
    "GET",
    data.path,
  );

  let thrown: unknown = undefined;

  await (route.handlerFunction as RouterFunction)(
    {
      params: {},
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

let getForCaller: jest.SpyInstance;
let getSummaryForCaller: jest.SpyInstance;

beforeEach(() => {
  jest.restoreAllMocks();
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(PROPS as never);
  jest
    .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
    .mockReturnValue(PROJECT as never);
  getForCaller = jest
    .spyOn(SetupHealthService, "getForCaller")
    .mockResolvedValue(ANSWER as never);
  getSummaryForCaller = jest
    .spyOn(SetupHealthService, "getSummaryForCaller")
    .mockResolvedValue(SUMMARY as never);
});

describe("GET /setup-health", () => {
  test("is at /setup-health, behind the signed-in member's middleware", () => {
    expect(SETUP_HEALTH_API_PATH).toBe("/setup-health");

    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "GET",
      SETUP_HEALTH_API_PATH,
    );

    expect(route.middleware).toBe(UserMiddleware.getUserMiddleware);
  });

  test("hands back the findings for the caller, for the project they were let into", async () => {
    const { thrown, sent } = await call({ path: SETUP_HEALTH_API_PATH });

    expect(thrown).toBeUndefined();
    expect(sent).toEqual(ANSWER);
    expect(getForCaller).toHaveBeenCalledWith({
      projectId: PROJECT,
      props: PROPS,
      refresh: false,
    });
  });

  test("refresh=true works them out again", async () => {
    await call({ path: SETUP_HEALTH_API_PATH, query: { refresh: "true" } });

    expect(getForCaller.mock.calls[0]![0]).toMatchObject({ refresh: true });
  });

  test("a caller who is not a member of the project is refused before anything is read", async () => {
    jest
      .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
      .mockImplementation(() => {
        throw new NotAuthorizedException("Not a member.");
      });

    const { thrown } = await call({ path: SETUP_HEALTH_API_PATH });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(getForCaller).not.toHaveBeenCalled();
  });

  test("what the service refuses is passed on", async () => {
    getForCaller.mockRejectedValue(new BadDataException("Project not found."));

    const { thrown } = await call({ path: SETUP_HEALTH_API_PATH });

    expect((thrown as Error).message).toBe("Project not found.");
  });
});

describe("GET /setup-health/summary", () => {
  const path: string = `${SETUP_HEALTH_API_PATH}/summary`;

  test("is behind the signed-in member's middleware", () => {
    expect(mockRouter.match("GET", path).middleware).toBe(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("hands back the counts for the caller, never the findings", async () => {
    const { thrown, sent } = await call({ path: path });

    expect(thrown).toBeUndefined();
    expect(sent).toEqual(SUMMARY);
    expect(getSummaryForCaller).toHaveBeenCalledWith({
      projectId: PROJECT,
      props: PROPS,
    });
    expect(getForCaller).not.toHaveBeenCalled();
  });

  test("a caller who is not a member of the project is refused", async () => {
    jest
      .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
      .mockImplementation(() => {
        throw new NotAuthorizedException("Not a member.");
      });

    const { thrown } = await call({ path: path });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(getSummaryForCaller).not.toHaveBeenCalled();
  });
});

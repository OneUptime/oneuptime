import CommonAPI from "../../../Server/API/CommonAPI";
import DeclaredCodeChanges from "../../../Server/Utils/AutoRemediation/DeclaredCodeChanges";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import {
  DECLARED_CODE_CHANGES_PATH,
  DECLARED_CODE_CHANGE_PATH,
  DECLARED_CODE_OWNER_PATH,
  DeclaredCodeChangeState,
  DeclaredCodeKind,
} from "../../../Utils/AiRemediation/DeclaredCodeChange";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * Common/Server/API/AutoRemediationAPI.ts - the routes of a fix that lasts,
 * a pull request to the code that declares a cloud resource: each behind the
 * user middleware, each reads the person's own props in the tenant they
 * asked in, and hands the body's values to DeclaredCodeChanges (whose own
 * suite pins what it checks). A refusal goes to the error handler.
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type MockRoute = {
  method: string;
  uri: string;
  middleware: RouterFunction;
  handlerFunction: RouterFunction;
};

const mockRoutes: Array<MockRoute> = [];

const registerRoute: (
  method: string,
) => (
  uri: string,
  middleware: RouterFunction,
  handlerFunction: RouterFunction,
) => void = (method: string) => {
  return (
    uri: string,
    middleware: RouterFunction,
    handlerFunction: RouterFunction,
  ): void => {
    mockRoutes.push({
      method: method.toUpperCase(),
      uri,
      middleware,
      handlerFunction,
    });
  };
};

const mockRouter: Record<string, jest.Mock> = {
  get: jest.fn().mockImplementation(registerRoute("get")),
  post: jest.fn().mockImplementation(registerRoute("post")),
  put: jest.fn().mockImplementation(registerRoute("put")),
  delete: jest.fn().mockImplementation(registerRoute("delete")),
};

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: (): Record<string, jest.Mock> => {
        return mockRouter;
      },
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

const sendJsonObjectResponseMock: jest.Mock =
  Response.sendJsonObjectResponse as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SUGGESTION_ID: string = "33333333-3333-4333-8333-333333333333";
const REPOSITORY_ID: string = "66666666-6666-4666-8666-666666666666";

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
  userType: UserType.User,
} as DatabaseCommonInteractionProps;

async function call(
  uri: string,
  body: JSONObject,
): Promise<{ thrownToNext: unknown }> {
  const route: MockRoute | undefined = mockRoutes.find(
    (candidate: MockRoute): boolean => {
      return candidate.method === "POST" && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`Route POST ${uri} was never registered`);
  }

  const next: jest.Mock = jest.fn();

  await route.handlerFunction(
    { params: {}, query: {}, body, headers: {} } as unknown as ExpressRequest,
    {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse,
    next as unknown as NextFunction,
  );

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
  };
}

describe("AutoRemediationAPI: a fix that lasts", () => {
  beforeAll(async () => {
    await import("../../../Server/API/AutoRemediationAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(PROPS);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("its three routes are registered, each behind the user middleware", () => {
    for (const uri of [
      DECLARED_CODE_OWNER_PATH,
      DECLARED_CODE_CHANGE_PATH,
      DECLARED_CODE_CHANGES_PATH,
    ]) {
      const route: MockRoute | undefined = mockRoutes.find(
        (candidate: MockRoute): boolean => {
          return candidate.uri === uri;
        },
      );

      expect(route?.method).toBe("POST");
      expect(route?.middleware).toBeDefined();
    }
  });

  test("the owner: the step's repositories, for the person in their tenant", async () => {
    const owner: jest.SpiedFunction<typeof DeclaredCodeChanges.getOwner> = jest
      .spyOn(DeclaredCodeChanges, "getOwner")
      .mockResolvedValue({
        sequence: 1,
        managedAsCode: "Terraform",
        codeKind: DeclaredCodeKind.Terraform,
        sentence: "Scale the ECS service web out to 4 tasks",
        target: null,
        candidates: [],
      });

    const result: { thrownToNext: unknown } = await call(
      DECLARED_CODE_OWNER_PATH,
      { suggestionId: SUGGESTION_ID, sequence: 1 },
    );

    expect(result.thrownToNext).toBeUndefined();
    expect(owner).toHaveBeenCalledWith({
      props: PROPS,
      tenantId: PROJECT_ID,
      suggestionId: SUGGESTION_ID,
      sequence: 1,
    });
    expect(sendJsonObjectResponseMock.mock.calls[0]![2]).toMatchObject({
      managedAsCode: "Terraform",
    });
  });

  test("the change: the repository the person confirmed", async () => {
    const start: jest.SpiedFunction<typeof DeclaredCodeChanges.start> = jest
      .spyOn(DeclaredCodeChanges, "start")
      .mockResolvedValue({ taskId: "t-1", wasAlreadyAsked: false });

    await call(DECLARED_CODE_CHANGE_PATH, {
      suggestionId: SUGGESTION_ID,
      sequence: 2,
      codeRepositoryId: REPOSITORY_ID,
    });

    expect(start).toHaveBeenCalledWith({
      props: PROPS,
      tenantId: PROJECT_ID,
      suggestionId: SUGGESTION_ID,
      sequence: 2,
      codeRepositoryId: REPOSITORY_ID,
    });
    expect(sendJsonObjectResponseMock.mock.calls[0]![2]).toEqual({
      taskId: "t-1",
      wasAlreadyAsked: false,
    });
  });

  test("the changes: each step's task", async () => {
    jest.spyOn(DeclaredCodeChanges, "list").mockResolvedValue({
      changes: [
        {
          sequence: 1,
          taskId: "t-1",
          repositoryName: "acme/platform",
          state: DeclaredCodeChangeState.Writing,
        },
      ],
    });

    await call(DECLARED_CODE_CHANGES_PATH, { suggestionId: SUGGESTION_ID });

    expect(sendJsonObjectResponseMock.mock.calls[0]![2]).toEqual({
      changes: [
        {
          sequence: 1,
          taskId: "t-1",
          repositoryName: "acme/platform",
          state: DeclaredCodeChangeState.Writing,
        },
      ],
    });
  });

  test("a refusal goes to the error handler, and nothing is answered", async () => {
    jest
      .spyOn(DeclaredCodeChanges, "start")
      .mockRejectedValue(
        new BadDataException("Choose the repository the pull request goes to."),
      );

    const result: { thrownToNext: unknown } = await call(
      DECLARED_CODE_CHANGE_PATH,
      { suggestionId: SUGGESTION_ID, sequence: 1 },
    );

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
  });

  test("a request from outside any tenant is refused before anything is read", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({
        ...PROPS,
        tenantId: undefined,
      } as DatabaseCommonInteractionProps);
    const list: jest.SpiedFunction<typeof DeclaredCodeChanges.list> =
      jest.spyOn(DeclaredCodeChanges, "list");

    const result: { thrownToNext: unknown } = await call(
      DECLARED_CODE_CHANGES_PATH,
      { suggestionId: SUGGESTION_ID },
    );

    expect(result.thrownToNext).toBeDefined();
    expect(list).not.toHaveBeenCalled();
  });
});

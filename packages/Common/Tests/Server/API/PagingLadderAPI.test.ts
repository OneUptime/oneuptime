import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import {
  PAGING_LADDER_API_PATH,
  readLadderUserId,
} from "../../../Server/API/PagingLadderAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import PagingLadderService from "../../../Server/Services/PagingLadderService";
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
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * POST /paging-ladder/apply (#6820): who the ladder is for, and that the
 * request reaches the service as the caller - a signed-in member of the
 * project, as a person, on a credential that may make changes.
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

const PROJECT: ObjectID = new ObjectID("7e5af000-0000-4000-8000-000000000001");
const ANA: ObjectID = new ObjectID("7e5af000-0000-4000-8000-0000000000a1");
const BOB: ObjectID = new ObjectID("7e5af000-0000-4000-8000-0000000000b1");

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

const STEPS: Array<JSONObject> = [
  {
    methodColumn: "userSmsId",
    methodId: "7e5af000-0000-4000-8000-0000000000c1",
    notifyAfterMinutes: 0,
  },
];

async function apply(
  body: JSONObject,
): Promise<{ thrown: unknown; sent: unknown }> {
  const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
    "POST",
    `${PAGING_LADDER_API_PATH}/apply`,
  );

  let thrown: unknown = undefined;

  await (route.handlerFunction as RouterFunction)(
    { body: body, params: {}, headers: {} } as unknown as ExpressRequest,
    {} as ExpressResponse,
    ((err: unknown) => {
      thrown = err;
    }) as NextFunction,
  );

  const sendJson: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  return { thrown: thrown, sent: sendJson.mock.calls[0]?.[2] };
}

let applyLadder: jest.SpyInstance;
let props: DatabaseCommonInteractionProps;

beforeEach(() => {
  jest.restoreAllMocks();
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();

  props = { userId: ANA, tenantId: PROJECT };

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation((async () => {
      return props;
    }) as never);
  jest
    .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
    .mockReturnValue(PROJECT);

  applyLadder = jest
    .spyOn(PagingLadderService, "applyLadder")
    .mockResolvedValue({
      createdCount: 1,
      updatedCount: 2,
      deletedCount: 3,
      unchangedCount: 4,
    } as never);
});

describe("POST /paging-ladder/apply", () => {
  test("runs behind the user middleware", () => {
    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "POST",
      `${PAGING_LADDER_API_PATH}/apply`,
    );

    expect(route.middleware).toBe(UserMiddleware.getUserMiddleware);
  });

  test("saves your own ladder when no member is named, and answers with what it did", async () => {
    const { thrown, sent } = await apply({ steps: STEPS });

    expect(thrown).toBeUndefined();
    expect(applyLadder).toHaveBeenCalledTimes(1);

    const call: {
      projectId: ObjectID;
      targetUserId: ObjectID;
      steps: unknown;
      props: DatabaseCommonInteractionProps;
    } = applyLadder.mock.calls[0]![0] as never;

    expect(call.projectId.toString()).toBe(PROJECT.toString());
    expect(call.targetUserId.toString()).toBe(ANA.toString());
    expect(call.steps).toEqual(STEPS);
    expect(call.props.userId?.toString()).toBe(ANA.toString());
    expect(call.props.isMultiTenantRequest).toBe(false);

    expect(sent).toEqual({
      createdCount: 1,
      updatedCount: 2,
      deletedCount: 3,
      unchangedCount: 4,
    });
  });

  test("names the member a request names; the service decides whether the caller may", async () => {
    await apply({ steps: STEPS, userId: BOB.toString() });

    expect(
      (
        applyLadder.mock.calls[0]![0] as { targetUserId: ObjectID }
      ).targetUserId.toString(),
    ).toBe(BOB.toString());
  });

  test("a caller who is not a member of the project saves nothing", async () => {
    jest
      .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
      .mockImplementation(() => {
        throw new NotAuthorizedException("Sign in to a project first.");
      });

    const { thrown } = await apply({ steps: STEPS });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(applyLadder).not.toHaveBeenCalled();
  });

  test("a read-only credential saves nothing", async () => {
    props = { userId: ANA, tenantId: PROJECT, isReadOnlyCredential: true };

    const { thrown } = await apply({ steps: STEPS });

    expect(thrown).toBeDefined();
    expect(applyLadder).not.toHaveBeenCalled();
  });

  test("a member id that is not one is refused, saying what to do", async () => {
    const { thrown } = await apply({ steps: STEPS, userId: "not-a-user" });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as Error).message).toMatch(/^[A-Z].*\.$/);
    expect(applyLadder).not.toHaveBeenCalled();
  });

  test("what the service refuses reaches the caller", async () => {
    applyLadder.mockRejectedValue(
      new BadDataException("A ladder needs at least one step.") as never,
    );

    const { thrown } = await apply({ steps: [] });

    expect((thrown as Error).message).toBe("A ladder needs at least one step.");
  });
});

describe("the member a request names", () => {
  test("none, an empty one or null is your own ladder", () => {
    expect(readLadderUserId(undefined)).toBeNull();
    expect(readLadderUserId(null)).toBeNull();
    expect(readLadderUserId("")).toBeNull();
  });

  test("a member's id, spaces forgiven", () => {
    expect(readLadderUserId(` ${BOB.toString()} `)?.toString()).toBe(
      BOB.toString(),
    );
  });

  test("anything else is refused", () => {
    expect(() => {
      return readLadderUserId(42);
    }).toThrow(BadDataException);
    expect(() => {
      return readLadderUserId("bob");
    }).toThrow(BadDataException);
  });
});

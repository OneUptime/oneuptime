import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import {
  PAGING_LADDER_API_PATH,
  readDefaultLadderUserIds,
  readLadderUserId,
} from "../../../Server/API/PagingLadderAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import PagingLadderService, {
  PAGING_LADDER_DEFAULT_NOT_ALLOWED_MESSAGE,
} from "../../../Server/Services/PagingLadderService";
import {
  MAX_PAGING_LADDER_DEFAULT_MEMBERS,
  PAGING_LADDER_APPLY_DEFAULT_ROUTE,
} from "../../../Types/NotificationRule/PagingLadderDefault";
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

  test("passes the severities that keep their own rules on to the service, as sent (#8890)", async () => {
    const keepCards: Array<JSONObject> = [
      { ruleType: "On Call Executed Incident", severityId: "a-severity" },
    ];

    await apply({ steps: STEPS, keepCards: keepCards });

    expect(
      (applyLadder.mock.calls[0]![0] as { keepCards: unknown }).keepCards,
    ).toEqual(keepCards);
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

describe("POST /paging-ladder/apply-default (#7450)", () => {
  let applyDefault: jest.SpyInstance;

  const RESULTS: Array<JSONObject> = [
    {
      userId: BOB.toString(),
      outcome: "Applied",
      appliedSteps: [{ channel: "SMS", notifyAfterMinutes: 0 }],
      leftOutChannels: ["Call"],
      keptChannels: ["Email"],
      changedRuleCount: 6,
      message: "Applied.",
    },
  ];

  async function applyDefaultTo(
    body: JSONObject,
  ): Promise<{ thrown: unknown; sent: unknown }> {
    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "POST",
      `${PAGING_LADDER_API_PATH}/apply-default`,
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

  beforeEach(() => {
    applyDefault = jest
      .spyOn(PagingLadderService, "applyDefaultLadderToMembers")
      .mockResolvedValue(RESULTS as never);
  });

  test("is the route the Dashboard posts to, behind the user middleware", () => {
    expect(PAGING_LADDER_APPLY_DEFAULT_ROUTE).toBe(
      `${PAGING_LADDER_API_PATH}/apply-default`,
    );

    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "POST",
      PAGING_LADDER_APPLY_DEFAULT_ROUTE,
    );

    expect(route.middleware).toBe(UserMiddleware.getUserMiddleware);
  });

  test("applies the default to the members named, as the caller, and answers for each", async () => {
    const { thrown, sent } = await applyDefaultTo({
      userIds: [BOB.toString(), ` ${ANA.toString()} `, BOB.toString()],
    });

    expect(thrown).toBeUndefined();
    expect(applyDefault).toHaveBeenCalledTimes(1);

    const call: {
      projectId: ObjectID;
      userIds: Array<ObjectID>;
      props: DatabaseCommonInteractionProps;
    } = applyDefault.mock.calls[0]![0] as never;

    expect(call.projectId.toString()).toBe(PROJECT.toString());
    // Each once, in the order sent.
    expect(
      call.userIds.map((userId: ObjectID): string => {
        return userId.toString();
      }),
    ).toEqual([BOB.toString(), ANA.toString()]);
    expect(call.props.userId?.toString()).toBe(ANA.toString());
    expect(call.props.isMultiTenantRequest).toBe(false);

    expect(sent).toEqual({ results: RESULTS });
  });

  test("a caller who is not a member of the project applies nothing", async () => {
    jest
      .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
      .mockImplementation(() => {
        throw new NotAuthorizedException("Sign in to a project first.");
      });

    const { thrown } = await applyDefaultTo({ userIds: [BOB.toString()] });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(applyDefault).not.toHaveBeenCalled();
  });

  test("a read-only credential applies nothing", async () => {
    props = { userId: ANA, tenantId: PROJECT, isReadOnlyCredential: true };

    const { thrown } = await applyDefaultTo({ userIds: [BOB.toString()] });

    expect(thrown).toBeDefined();
    expect(applyDefault).not.toHaveBeenCalled();
  });

  test.each([
    ["none", undefined],
    ["an empty list", []],
    ["a name", "bob"],
    ["an id that is not one", ["not-a-user"]],
    ["a number", [42]],
    [
      "more than a request may hold",
      Array(MAX_PAGING_LADDER_DEFAULT_MEMBERS + 1).fill(BOB.toString()),
    ],
  ])(
    "members named badly (%s) are refused, saying what to do",
    async (_name: string, userIds: unknown) => {
      const { thrown } = await applyDefaultTo({
        userIds: userIds as never,
      });

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Error).message).toMatch(/^[A-Z].*\.$/);
      expect(applyDefault).not.toHaveBeenCalled();
    },
  );

  test("as many as a request may hold are taken", () => {
    expect(
      readDefaultLadderUserIds(
        Array(MAX_PAGING_LADDER_DEFAULT_MEMBERS).fill(BOB.toString()),
      ),
    ).toHaveLength(1);
  });

  test("what the service refuses reaches the caller: a member may not apply it", async () => {
    applyDefault.mockRejectedValue(
      new NotAuthorizedException(
        PAGING_LADDER_DEFAULT_NOT_ALLOWED_MESSAGE,
      ) as never,
    );

    const { thrown } = await applyDefaultTo({ userIds: [BOB.toString()] });

    expect((thrown as Error).message).toBe(
      PAGING_LADDER_DEFAULT_NOT_ALLOWED_MESSAGE,
    );
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

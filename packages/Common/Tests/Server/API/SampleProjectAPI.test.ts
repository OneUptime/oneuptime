import { mockRouter } from "./Helpers";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import SampleProjectAPI from "../../../Server/API/SampleProjectAPI";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ProjectService from "../../../Server/Services/ProjectService";
import SampleProjectService from "../../../Server/Services/SampleProjectService";
import UserService from "../../../Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SampleProjectSeeder from "../../../Server/Utils/SampleProject/SampleProjectSeeder";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import { parseProjectProductSettings } from "../../../Types/Product/ProjectProducts";
import {
  SAMPLE_PROJECT_CREATE_ROUTE,
  SAMPLE_PROJECT_DELETE_ROUTE,
  SAMPLE_PROJECT_NAME,
  SAMPLE_PROJECT_PRODUCTS,
  SAMPLE_PROJECT_REFUSALS,
} from "../../../Types/SampleProject/SampleProject";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A PERSON'S SAMPLE PROJECT, MADE AND DELETED (issue #6808).
 *
 *   - Explore Sample Project makes the person's sample - or opens the one
 *     they have - as OneUptime, with them as its creator, flagged, showing
 *     the products it fills, and filled; a filling that fails takes the
 *     half-made project with it and says to try again;
 *   - a server that keeps project creation to admins makes none for anyone
 *     else, and a sample person never gets one;
 *   - Delete Sample Project deletes a sample, as the person asking, and only
 *     a sample.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("5a3c0000-0000-4000-8000-0000000000c1");
const SAMPLE_ID: ObjectID = new ObjectID(
  "5a3c0000-0000-4000-8000-0000000000a1",
);
const REAL_ID: ObjectID = new ObjectID("5a3c0000-0000-4000-8000-0000000000b1");
const NOW: Date = new Date("2026-11-12T12:00:00.000Z");

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

interface RegisteredRoute {
  method: string;
  uri: string;
  middlewares: Array<RouterFunction>;
  handlerFunction: RouterFunction;
}

const routeFor: (method: string, uri: string) => RegisteredRoute = (
  method: string,
  uri: string,
): RegisteredRoute => {
  const route: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((candidate: RegisteredRoute): boolean => {
    return candidate.method === method && candidate.uri === uri;
  });

  if (!route) {
    throw new Error(`No ${method} route for ${uri}`);
  }

  return route;
};

let props: DatabaseCommonInteractionProps;
let sendJson: jest.SpyInstance;
let sendEmpty: jest.SpyInstance;

const call: (method: string, uri: string) => Promise<unknown> = async (
  method: string,
  uri: string,
): Promise<unknown> => {
  const next: jest.Mock = jest.fn();

  await routeFor(method, uri).handlerFunction(
    { query: {}, params: {}, headers: {}, body: {} } as never,
    {} as never,
    next as unknown as NextFunction,
  );

  return next.mock.calls[0]?.[0];
};

const user: (data: Partial<User>) => User = (data: Partial<User>): User => {
  const row: User = new User();
  Object.assign(row, data);
  return row;
};

beforeEach(() => {
  props = { userId: USER_ID, userType: UserType.User };

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
  sendJson = jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation((() => {}) as never);
  sendEmpty = jest
    .spyOn(Response, "sendEmptySuccessResponse")
    .mockImplementation((() => {}) as never);
  jest
    .spyOn(DatabaseConfig, "shouldDisableUserProjectCreation")
    .mockResolvedValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the routes", () => {
  test("are one bare router, each route behind the user middleware", () => {
    expect(SampleProjectAPI).toBe(mockRouter);
    expect(routeFor("POST", SAMPLE_PROJECT_CREATE_ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
    expect(routeFor("POST", SAMPLE_PROJECT_DELETE_ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
  });

  test("making one needs a signed-in person", async () => {
    props = { userType: UserType.User };
    const createForUser: jest.SpyInstance = jest.spyOn(
      SampleProjectService,
      "createForUser",
    );

    const error: unknown = await call("POST", SAMPLE_PROJECT_CREATE_ROUTE);

    expect(error).toBeTruthy();
    expect(createForUser).not.toHaveBeenCalled();
  });

  test("making one answers its id and whether it is new", async () => {
    jest.spyOn(SampleProjectService, "createForUser").mockResolvedValue({
      projectId: SAMPLE_ID.toString(),
      isNew: true,
    });

    await call("POST", SAMPLE_PROJECT_CREATE_ROUTE);

    expect(sendJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        projectId: SAMPLE_ID.toString(),
        isNew: true,
      },
    );
  });

  test("deleting one needs a member of it, and deletes as them", async () => {
    props = { userId: USER_ID, userType: UserType.User };
    const deleteSample: jest.SpyInstance = jest
      .spyOn(SampleProjectService, "deleteSample")
      .mockResolvedValue(undefined);

    expect(await call("POST", SAMPLE_PROJECT_DELETE_ROUTE)).toBeTruthy();
    expect(deleteSample).not.toHaveBeenCalled();

    props = {
      userId: USER_ID,
      userType: UserType.User,
      tenantId: SAMPLE_ID,
      userTenantAccessPermission: {
        [SAMPLE_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: SAMPLE_ID,
          permissions: [],
        },
      } as never,
    };

    await call("POST", SAMPLE_PROJECT_DELETE_ROUTE);

    expect(deleteSample).toHaveBeenCalledWith({
      projectId: SAMPLE_ID,
      props: props,
    });
    expect(sendEmpty).toHaveBeenCalled();
  });
});

describe("making a person's sample", () => {
  test("opens the one they have, and makes no other", async () => {
    jest
      .spyOn(ProjectService, "findOneBy")
      .mockResolvedValue({ id: SAMPLE_ID } as Project);
    const create: jest.SpyInstance = jest.spyOn(ProjectService, "create");

    await expect(
      SampleProjectService.createForUser({ userId: USER_ID, now: NOW }),
    ).resolves.toEqual({ projectId: SAMPLE_ID.toString(), isNew: false });
    expect(create).not.toHaveBeenCalled();
  });

  test("makes one as OneUptime, with the person as its creator, flagged, showing what it fills, and fills it", async () => {
    jest.spyOn(ProjectService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(user({ isMasterAdmin: false }));
    const create: jest.SpyInstance = jest
      .spyOn(ProjectService, "create")
      .mockResolvedValue({ id: SAMPLE_ID } as Project);
    const seed: jest.SpyInstance = jest
      .spyOn(SampleProjectSeeder, "seed")
      .mockResolvedValue({} as never);

    await expect(
      SampleProjectService.createForUser({ userId: USER_ID, now: NOW }),
    ).resolves.toEqual({ projectId: SAMPLE_ID.toString(), isNew: true });

    const created: { data: Project; props: DatabaseCommonInteractionProps } =
      create.mock.calls[0]![0] as never;

    expect(created.props).toEqual({ isRoot: true, userId: USER_ID });
    expect(created.data.name).toBe(SAMPLE_PROJECT_NAME);
    expect(created.data.isSampleProject).toBe(true);
    const hidden: Array<string> = parseProjectProductSettings(
      created.data.productSettings,
    )!.hidden;

    expect(hidden.length).toBeGreaterThan(0);

    for (const product of SAMPLE_PROJECT_PRODUCTS) {
      expect(hidden).not.toContain(product);
    }
    expect(seed).toHaveBeenCalledWith({
      projectId: SAMPLE_ID,
      ownerUserId: USER_ID,
      now: NOW,
    });
  });

  test("a filling that fails takes the half-made sample with it, and says to try again", async () => {
    jest.spyOn(ProjectService, "findOneBy").mockResolvedValue(null);
    jest.spyOn(UserService, "findOneById").mockResolvedValue(user({}));
    jest
      .spyOn(ProjectService, "create")
      .mockResolvedValue({ id: SAMPLE_ID } as Project);
    jest
      .spyOn(SampleProjectSeeder, "seed")
      .mockRejectedValue(new Error("seed failed"));
    const deleteOneById: jest.SpyInstance = jest
      .spyOn(ProjectService, "deleteOneById")
      .mockResolvedValue(undefined as never);

    await expect(
      SampleProjectService.createForUser({ userId: USER_ID, now: NOW }),
    ).rejects.toThrow(
      "The sample project could not be made. Try again in a minute.",
    );
    expect(deleteOneById).toHaveBeenCalledWith({
      id: SAMPLE_ID,
      props: { isRoot: true },
    });
  });

  test("a server that keeps project creation to admins makes none for anyone else", async () => {
    jest.spyOn(ProjectService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(user({ isMasterAdmin: false }));
    jest
      .spyOn(DatabaseConfig, "shouldDisableUserProjectCreation")
      .mockResolvedValue(true);
    const create: jest.SpyInstance = jest.spyOn(ProjectService, "create");

    await expect(
      SampleProjectService.createForUser({ userId: USER_ID, now: NOW }),
    ).rejects.toThrow(SAMPLE_PROJECT_REFUSALS.creationRestricted);
    expect(create).not.toHaveBeenCalled();
  });

  test("but makes one for a master admin", async () => {
    jest
      .spyOn(DatabaseConfig, "shouldDisableUserProjectCreation")
      .mockResolvedValue(true);

    await expect(
      SampleProjectService.canCreateFor({ isMasterAdmin: true }),
    ).resolves.toBe(true);
    await expect(
      SampleProjectService.canCreateFor({ isMasterAdmin: false }),
    ).resolves.toBe(false);
  });

  test("a sample person never gets one", async () => {
    jest.spyOn(ProjectService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(user({ sampleProjectId: SAMPLE_ID }));
    const create: jest.SpyInstance = jest.spyOn(ProjectService, "create");

    await expect(
      SampleProjectService.createForUser({ userId: USER_ID, now: NOW }),
    ).rejects.toThrow(SAMPLE_PROJECT_REFUSALS.samplePersonElsewhere);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("deleting a sample", () => {
  test("only a sample is deleted here", async () => {
    jest.spyOn(ProjectService, "isSampleProject").mockResolvedValue(false);
    const deleteOneById: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "deleteOneById",
    );

    await expect(
      SampleProjectService.deleteSample({
        projectId: REAL_ID,
        props: { userId: USER_ID, tenantId: REAL_ID },
      }),
    ).rejects.toThrow(SAMPLE_PROJECT_REFUSALS.notASample);
    expect(deleteOneById).not.toHaveBeenCalled();
  });

  test("a sample is deleted as the person asking, so only one who may delete it can", async () => {
    jest.spyOn(ProjectService, "isSampleProject").mockResolvedValue(true);
    const deleteOneById: jest.SpyInstance = jest
      .spyOn(ProjectService, "deleteOneById")
      .mockResolvedValue(undefined as never);
    const asker: DatabaseCommonInteractionProps = {
      userId: USER_ID,
      tenantId: SAMPLE_ID,
    };

    await SampleProjectService.deleteSample({
      projectId: SAMPLE_ID,
      props: asker,
    });

    expect(deleteOneById).toHaveBeenCalledWith({
      id: SAMPLE_ID,
      props: asker,
    });
  });
});

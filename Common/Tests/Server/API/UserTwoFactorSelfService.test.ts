import User from "../../../Models/DatabaseModels/User";
import UserAPI from "../../../Server/API/UserAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import UserService from "../../../Server/Services/UserService";
import FindBy from "../../../Server/Types/Database/FindBy";
import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const OWNER_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_ID: string = "22222222-2222-4222-8222-222222222222";
const ADMIN_ROUTE: string = "/user/:userId/set-two-factor-auth-required";

interface RequestOptions {
  id?: string;
  userType?: UserType;
  anonymous?: boolean;
  body?: JSONObject;
}

/*
 * Run the real API deserialization, request-to-permission props, service hook,
 * owner/table/column permissions, scalar update and success response together.
 * Only the Postgres find/write boundaries and HTTP response transport are
 * replaced. In particular, neither getDatabaseCommonInteractionProps nor any
 * permission check is stubbed, so a forged body cannot become caller identity.
 */
describe("User two-factor self-service API integration", () => {
  const rows: Map<string, User> = new Map<string, User>();
  let api: UserAPI;
  let find: jest.SpyInstance;
  let update: jest.Mock;
  let response: ExpressResponse;

  const requestFor: (data?: RequestOptions) => OneUptimeRequest = (
    data: RequestOptions = {},
  ): OneUptimeRequest => {
    return {
      params: { id: data.id || OWNER_ID },
      query: {},
      headers: {},
      body: data.body || { data: { enableTwoFactorAuth: false } },
      userType: data.userType || UserType.User,
      ...(data.anonymous
        ? {}
        : { userAuthorization: { userId: new ObjectID(OWNER_ID) } }),
      userGlobalAccessPermission: {
        globalPermissions: data.anonymous ? [] : [Permission.CurrentUser],
        projectIds: [],
        _type: "UserGlobalAccessPermission",
      },
    } as unknown as OneUptimeRequest;
  };

  const expectNoWrite: () => void = (): void => {
    expect(update).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(rows.get(OWNER_ID)?.enableTwoFactorAuth).toBe(true);
    expect(rows.get(OTHER_ID)?.enableTwoFactorAuth).toBe(true);
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRouter.routes.length = 0;
    api = new UserAPI();
    response = {} as ExpressResponse;
    rows.clear();
    for (const id of [OWNER_ID, OTHER_ID]) {
      const row: User = new User();
      row._id = id;
      row.enableTwoFactorAuth = true;
      rows.set(id, row);
    }

    find = getJestSpyOn(UserService, "_findBy").mockImplementation(
      async (data: FindBy<User>): Promise<Array<User>> => {
        const predicate: unknown = data.query._id;
        let id: string;
        if (predicate instanceof FindOperator) {
          // Ordinary ownership scoping serializes its exact UUID into Raw equality.
          expect(predicate.getSql?.("_id")).toMatch(/^\(_id = :\w+\)$/);
          const values: Array<unknown> = Object.values(
            predicate.objectLiteralParameters || {},
          );
          expect(values).toHaveLength(1);
          id = String(values[0]);
        } else {
          id = String(predicate);
        }
        const row: User | undefined = rows.get(id);
        if (!row) {
          return [];
        }
        const snapshot: User = new User();
        snapshot._id = row._id;
        snapshot.enableTwoFactorAuth = row.enableTwoFactorAuth;
        return [snapshot];
      },
    );
    update = jest
      .fn()
      .mockImplementation(
        async (
          where: { _id: string },
          data: { enableTwoFactorAuth: boolean },
        ): Promise<{ affected: number }> => {
          const row: User | undefined = rows.get(where._id);
          if (!row) {
            return { affected: 0 };
          }
          row.enableTwoFactorAuth = data.enableTwoFactorAuth;
          return { affected: 1 };
        },
      );
    getJestSpyOn(UserService, "getRepository").mockReturnValue({ update });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([false, true])(
    "persists the current user's enableTwoFactorAuth=%s through ordinary CRUD",
    async (enabled: boolean): Promise<void> => {
      rows.get(OWNER_ID)!.enableTwoFactorAuth = !enabled;
      const request: OneUptimeRequest = requestFor({
        body: { data: { enableTwoFactorAuth: enabled } },
      });

      await api.updateItem(request, response);

      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(
        { _id: OWNER_ID },
        expect.objectContaining({ enableTwoFactorAuth: enabled }),
      );
      expect(rows.get(OWNER_ID)?.enableTwoFactorAuth).toBe(enabled);
      expect(rows.get(OTHER_ID)?.enableTwoFactorAuth).toBe(true);
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
        request,
        response,
      );
    },
  );

  test("allows a master admin to turn off their own setting", async () => {
    await api.updateItem(
      requestFor({ userType: UserType.MasterAdmin }),
      response,
    );

    expect(rows.get(OWNER_ID)?.enableTwoFactorAuth).toBe(false);
    expect(rows.get(OTHER_ID)?.enableTwoFactorAuth).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  test("rejects an anonymous caller even with forged identity and root flags in the body", async () => {
    await expect(
      api.updateItem(
        requestFor({
          anonymous: true,
          body: {
            data: { enableTwoFactorAuth: false },
            userId: OWNER_ID,
            userAuthorization: { userId: OWNER_ID },
            isRoot: true,
            isMasterAdmin: true,
          },
        }),
        response,
      ),
    ).rejects.toThrow(NotAuthenticatedException);

    expectNoWrite();
  });

  test("a project API caller without user identity cannot turn off a user's setting", async () => {
    const request: OneUptimeRequest = requestFor({
      anonymous: true,
      userType: UserType.API,
    });
    request.userGlobalAccessPermission!.globalPermissions.push(
      Permission.CurrentUser,
    );

    await expect(api.updateItem(request, response)).rejects.toThrow(
      BadDataException,
    );

    expectNoWrite();
  });

  test.each([UserType.User, UserType.MasterAdmin])(
    "blocks %s from disabling a foreign account through ordinary CRUD",
    async (userType: UserType): Promise<void> => {
      await expect(
        api.updateItem(requestFor({ id: OTHER_ID, userType }), response),
      ).rejects.toThrow(
        "You can only turn off two factor authentication for your own account.",
      );

      expectNoWrite();
    },
  );

  test("foreign self-service enabling still obeys the existing row permissions", async () => {
    await expect(
      api.updateItem(
        requestFor({
          id: OTHER_ID,
          body: { data: { enableTwoFactorAuth: true } },
        }),
        response,
      ),
    ).rejects.toThrow(NotAuthorizedException);

    expectNoWrite();
  });

  test("body identity, root props and query operators cannot authorize a foreign target", async () => {
    await expect(
      api.updateItem(
        requestFor({
          id: OTHER_ID,
          body: {
            data: { enableTwoFactorAuth: false },
            userId: OTHER_ID,
            userAuthorization: { userId: OTHER_ID },
            props: { userId: OTHER_ID, isRoot: true, ignoreHooks: true },
            query: { _id: { _type: "NotEqual", value: OWNER_ID } },
          },
        }),
        response,
      ),
    ).rejects.toThrow(BadDataException);

    expectNoWrite();
  });

  test("a userId inside update data cannot impersonate the foreign target's owner", async () => {
    await expect(
      api.updateItem(
        requestFor({
          id: OTHER_ID,
          body: { data: { enableTwoFactorAuth: false, userId: OTHER_ID } },
        }),
        response,
      ),
    ).rejects.toThrow(BadDataException);

    expectNoWrite();
  });

  test.each([
    JSON.stringify({ _type: "NotEqual", value: OWNER_ID }),
    JSON.stringify([OWNER_ID, OTHER_ID]),
  ])(
    "rejects an operator-shaped path ID: %s",
    async (id: string): Promise<void> => {
      await expect(
        api.updateItem(requestFor({ id }), response),
      ).rejects.toThrow(BadDataException);

      expectNoWrite();
    },
  );

  test("a body row ID cannot redirect a successful update away from the URL's owner", async () => {
    await api.updateItem(
      requestFor({
        body: { data: { _id: OTHER_ID, enableTwoFactorAuth: false } },
      }),
      response,
    );

    expect(update).toHaveBeenCalledWith(
      { _id: OWNER_ID },
      expect.objectContaining({ enableTwoFactorAuth: false }),
    );
    expect(rows.get(OWNER_ID)?.enableTwoFactorAuth).toBe(false);
    expect(rows.get(OTHER_ID)?.enableTwoFactorAuth).toBe(true);
  });

  test.each([
    { value: "false", id: OWNER_ID, userType: UserType.User },
    { value: null, id: OWNER_ID, userType: UserType.User },
    { value: "false", id: OTHER_ID, userType: UserType.MasterAdmin },
    { value: null, id: OTHER_ID, userType: UserType.MasterAdmin },
  ])(
    "rejects non-boolean $value for $userType targeting $id before persistence",
    async (data: {
      value: string | null;
      id: string;
      userType: UserType;
    }): Promise<void> => {
      await expect(
        api.updateItem(
          requestFor({
            id: data.id,
            userType: data.userType,
            body: { data: { enableTwoFactorAuth: data.value } },
          }),
          response,
        ),
      ).rejects.toThrow(BadDataException);

      expectNoWrite();
    },
  );

  test.each([false, true])(
    "the dedicated administrator endpoint still enforces a master-admin session: %s",
    async (isMasterAdmin: boolean): Promise<void> => {
      const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
        "POST",
        ADMIN_ROUTE,
      );
      expect(route.middleware).toBe(
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      );
      const request: OneUptimeRequest = requestFor();
      request.params = { userId: OTHER_ID };
      request.body = { isRequired: false };
      request.headers["authorization"] = `Bearer ${JSONWebToken.signJsonPayload(
        {
          userId: OWNER_ID,
          email: "self-service-test@oneuptime.invalid",
          name: "Self service test",
          isMasterAdmin,
          isGlobalLogin: true,
        },
        60,
      )}`;
      const next: jest.Mock = jest.fn();

      await route.middleware(request, response, next as NextFunction);
      if (isMasterAdmin) {
        expect(next).toHaveBeenCalledWith();
        await route.handlerFunction(request, response, next as NextFunction);
        expect(next).toHaveBeenCalledTimes(1);
        expect(Response.sendErrorResponse).not.toHaveBeenCalled();
        expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
          request,
          response,
        );
        expect(rows.get(OWNER_ID)?.enableTwoFactorAuth).toBe(true);
        expect(rows.get(OTHER_ID)?.enableTwoFactorAuth).toBe(false);
      } else {
        expect(next).not.toHaveBeenCalled();
        expect(Response.sendErrorResponse).toHaveBeenCalledWith(
          request,
          response,
          expect.any(NotAuthorizedException),
        );
        expectNoWrite();
      }
    },
  );
});

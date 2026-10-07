import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { permissionRow, tenantPermissionsFor } from "../API/PermissionRows";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * requirePermission guards the custom routes that stand in for a table - a
 * route that lists, tests or recharges something rather than a CRUD call. It
 * reads the caller's rows by the rule the CRUD path follows
 * (CallerPermission): only an allow row grants, a block with no labels on any
 * permission the route accepts takes the route away, and a block with labels
 * - which restricts the labelled records - does not refuse a route that
 * reads none of them. A route that stands in for an operational resource's
 * table accepts its *AllOperationalResources wildcard, unless the wildcard is
 * blocked.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const REFUSED: string =
  "You do not have the required permission to perform this action.";

type MiddlewareFunction = (
  req: OneUptimeRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

type Outcome = "passed" | "refused";

type RunFunction = (
  guard: MiddlewareFunction,
  rows: Array<UserPermission | Permission>,
  userType?: UserType,
) => Promise<Outcome>;

const run: RunFunction = async (
  guard: MiddlewareFunction,
  rows: Array<UserPermission | Permission>,
  userType?: UserType,
): Promise<Outcome> => {
  const req: OneUptimeRequest = {
    headers: {},
    params: {},
    query: {},
    body: {},
    userType: userType || UserType.User,
    tenantId: PROJECT_ID,
    userAuthorization: { userId: USER_ID },
    userTenantAccessPermission: tenantPermissionsFor(PROJECT_ID, rows),
  } as unknown as OneUptimeRequest;

  const next: jest.Mock = jest.fn();

  // One request at a time: a test may run more than one.
  (Response.sendErrorResponse as unknown as jest.Mock).mockClear();

  await guard(
    req,
    {} as unknown as ExpressResponse,
    next as unknown as NextFunction,
  );

  const errorCalls: Array<Array<unknown>> = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  if (errorCalls.length > 0) {
    const error: Exception = errorCalls[0]![2] as Exception;

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toBe(REFUSED);
    expect(next).not.toHaveBeenCalled();

    return "refused";
  }

  expect(next).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[0]).toEqual([]);

  return "passed";
};

beforeEach(() => {
  jest.clearAllMocks();

  getJestSpyOn(Response, "sendErrorResponse").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("requirePermission reads block rows as the CRUD path does", () => {
  const guard: MiddlewareFunction = UserMiddleware.requirePermission({
    permissions: [Permission.ProjectOwner, Permission.ProjectAdmin],
  }) as MiddlewareFunction;

  test.each([
    ["a grant", [Permission.ProjectAdmin], "passed"],
    [
      "a grantee whose only row is a block with no labels",
      [permissionRow(Permission.ProjectAdmin, { isBlock: true })],
      "refused",
    ],
    [
      "a grantee whose only row is a block with labels",
      [
        permissionRow(Permission.ProjectAdmin, {
          isBlock: true,
          labelled: true,
        }),
      ],
      "refused",
    ],
    [
      "a grant and another team's block with no labels on it",
      [
        Permission.ProjectAdmin,
        permissionRow(Permission.ProjectAdmin, { isBlock: true }),
      ],
      "refused",
    ],
    [
      "a grant and a block with no labels on the other permission the route accepts",
      [
        Permission.ProjectAdmin,
        permissionRow(Permission.ProjectOwner, { isBlock: true }),
      ],
      "refused",
    ],
    [
      "a grant and a block with labels: the route reads no labelled record",
      [
        Permission.ProjectAdmin,
        permissionRow(Permission.ProjectAdmin, {
          isBlock: true,
          labelled: true,
        }),
      ],
      "passed",
    ],
    [
      "a grant and both kinds of block",
      [
        Permission.ProjectAdmin,
        permissionRow(Permission.ProjectAdmin, {
          isBlock: true,
          labelled: true,
        }),
        permissionRow(Permission.ProjectAdmin, { isBlock: true }),
      ],
      "refused",
    ],
    [
      "a grant and a block on a permission the route does not accept",
      [
        Permission.ProjectAdmin,
        permissionRow(Permission.DeleteProject, { isBlock: true }),
      ],
      "passed",
    ],
  ])(
    "%s: %#",
    async (
      _label: string,
      rows: Array<UserPermission | Permission>,
      expected: string,
    ) => {
      expect(await run(guard, rows)).toBe(expected);
    },
  );

  test("a row that does not say it is a block grants, as on the CRUD path", async () => {
    const legacyRow: UserPermission = permissionRow(Permission.ProjectAdmin);
    delete (legacyRow as Partial<UserPermission>).isBlockPermission;

    expect(await run(guard, [legacyRow])).toBe("passed");
  });

  test("an API key's block rows are read the same way", async () => {
    expect(
      await run(
        guard,
        [
          Permission.ProjectAdmin,
          permissionRow(Permission.ProjectAdmin, { isBlock: true }),
        ],
        UserType.API,
      ),
    ).toBe("refused");
    expect(await run(guard, [Permission.ProjectAdmin], UserType.API)).toBe(
      "passed",
    );
  });
});

describe("requirePermission with an operational resource's wildcard", () => {
  const withWildcard: MiddlewareFunction = UserMiddleware.requirePermission({
    permissions: [
      Permission.ProjectOwner,
      Permission.ReadTelemetryServiceMetrics,
    ],
    wildcard: Permission.ReadAllOperationalResources,
  }) as MiddlewareFunction;

  const withoutWildcard: MiddlewareFunction = UserMiddleware.requirePermission({
    permissions: [
      Permission.ProjectOwner,
      Permission.ReadTelemetryServiceMetrics,
    ],
  }) as MiddlewareFunction;

  test("the wildcard lets its holder in where the route accepts it", async () => {
    expect(
      await run(withWildcard, [Permission.ReadAllOperationalResources]),
    ).toBe("passed");
  });

  test("a route that names no wildcard does not accept one", async () => {
    expect(
      await run(withoutWildcard, [Permission.ReadAllOperationalResources]),
    ).toBe("refused");
  });

  test("a block with no labels on the wildcard takes it away", async () => {
    expect(
      await run(withWildcard, [
        Permission.ReadAllOperationalResources,
        permissionRow(Permission.ReadAllOperationalResources, {
          isBlock: true,
        }),
      ]),
    ).toBe("refused");
  });

  test("a block on the route's own permission refuses the wildcard holder too", async () => {
    expect(
      await run(withWildcard, [
        Permission.ReadAllOperationalResources,
        permissionRow(Permission.ReadTelemetryServiceMetrics, {
          isBlock: true,
        }),
      ]),
    ).toBe("refused");
  });

  test("a blocked wildcard does not take away the route's own permission", async () => {
    expect(
      await run(withWildcard, [
        Permission.ReadTelemetryServiceMetrics,
        permissionRow(Permission.ReadAllOperationalResources, {
          isBlock: true,
        }),
      ]),
    ).toBe("passed");
  });
});

import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { permissionRow, tenantPermissionsFor } from "../API/PermissionRows";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * requireModelPermission guards a custom route that stands in for
 * operations on models - the incoming call policy phone-number routes, say:
 * the caller must hold, for every operation, one of that model's own
 * permissions for it (an operational resource's wildcard included), with no
 * block with no labels on any of them - the table half of what the CRUD path
 * asks, read from the model by the one rule (CallerPermission). Everything
 * before that is what requirePermission asks too: someone signed in, a
 * master admin let through, a project named and the caller authorized for
 * it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const USER_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");

const REFUSAL: string = "Doing this needs both permissions.";

type MiddlewareFunction = (
  req: OneUptimeRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

interface Outcome {
  result: "passed" | "refused";
  error?: Exception | undefined;
}

async function run(
  guard: MiddlewareFunction,
  data: {
    rows?: Array<UserPermission | Permission> | undefined;
    userType?: UserType | undefined;
    tenantId?: ObjectID | null | undefined;
    permissionsFor?: ObjectID | undefined;
  },
): Promise<Outcome> {
  const req: OneUptimeRequest = {
    headers: {},
    params: {},
    query: {},
    body: {},
    userType: data.userType || UserType.User,
    tenantId: data.tenantId === null ? undefined : data.tenantId || PROJECT_ID,
    userAuthorization: { userId: USER_ID },
    userTenantAccessPermission: data.rows
      ? tenantPermissionsFor(data.permissionsFor || PROJECT_ID, data.rows)
      : undefined,
  } as unknown as OneUptimeRequest;

  const next: jest.Mock = jest.fn();

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
    expect(next).not.toHaveBeenCalled();

    return { result: "refused", error: errorCalls[0]![2] as Exception };
  }

  expect(next).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[0]).toEqual([]);

  return { result: "passed" };
}

beforeEach(() => {
  jest.clearAllMocks();

  getJestSpyOn(Response, "sendErrorResponse").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("requireModelPermission asks every operation of its model's own list", () => {
  // Read an incoming call policy and a call and SMS config, as a phone-number search does.
  const guard: MiddlewareFunction = UserMiddleware.requireModelPermission({
    operations: [
      { model: new IncomingCallPolicy(), operation: "read" },
      { model: new ProjectCallSMSConfig(), operation: "read" },
    ],
    refusal: REFUSAL,
  }) as MiddlewareFunction;

  test.each([
    ["a role on both lists", [Permission.SettingsViewer], "passed"],
    [
      "the two read permissions together",
      [
        Permission.ReadProjectIncomingCallPolicy,
        Permission.ReadProjectCallSMSConfig,
      ],
      "passed",
    ],
    [
      "only the first operation's permission",
      [Permission.ReadProjectIncomingCallPolicy],
      "refused",
    ],
    [
      "only the second operation's permission",
      [Permission.ReadProjectCallSMSConfig],
      "refused",
    ],
    [
      "a grant limited to some labels: the route weighs its records itself",
      [
        permissionRow(Permission.SettingsMember, { labelled: true }),
        permissionRow(Permission.ReadProjectCallSMSConfig, { labelled: true }),
      ],
      "passed",
    ],
    [
      "a grant and a block with no labels on a permission one operation accepts",
      [
        Permission.SettingsAdmin,
        permissionRow(Permission.ReadProjectCallSMSConfig, { isBlock: true }),
      ],
      "refused",
    ],
    [
      "a grant and a block with labels: no labelled record is read here",
      [
        Permission.SettingsAdmin,
        permissionRow(Permission.ReadProjectIncomingCallPolicy, {
          isBlock: true,
          labelled: true,
        }),
      ],
      "passed",
    ],
    ["a role on neither list", [Permission.IncidentMember], "refused"],
    [
      "only a block row",
      [permissionRow(Permission.SettingsAdmin, { isBlock: true })],
      "refused",
    ],
  ])(
    "%s: %#",
    async (
      _label: string,
      rows: Array<UserPermission | Permission>,
      expected: string,
    ) => {
      const outcome: Outcome = await run(guard, { rows: rows });

      expect(outcome.result).toBe(expected);

      if (expected === "refused") {
        expect(outcome.error).toBeInstanceOf(NotAuthorizedException);
        expect(outcome.error?.message).toBe(REFUSAL);
      }
    },
  );

  test("an anonymous caller is asked who it is, not refused a permission", async () => {
    const outcome: Outcome = await run(guard, {
      rows: [Permission.ProjectOwner],
      userType: UserType.Public,
    });

    expect(outcome.result).toBe("refused");
    expect(outcome.error).toBeInstanceOf(NotAuthenticatedException);
  });

  test("a master admin is let through", async () => {
    expect((await run(guard, { userType: UserType.MasterAdmin })).result).toBe(
      "passed",
    );
  });

  test("a request that names no project is refused", async () => {
    const outcome: Outcome = await run(guard, {
      rows: [Permission.ProjectOwner],
      tenantId: null,
    });

    expect(outcome.result).toBe("refused");
    expect(outcome.error?.message).toBe(
      "Project ID is required to access this resource.",
    );
  });

  test("a caller whose rows are for another project is not a member of this one", async () => {
    const outcome: Outcome = await run(guard, {
      rows: [Permission.ProjectOwner],
      permissionsFor: OTHER_PROJECT_ID,
    });

    expect(outcome.result).toBe("refused");
    expect(outcome.error?.message).toBe(
      "You do not have permission to access this project.",
    );
  });

  test("an API key's rows are read the same way", async () => {
    expect(
      (
        await run(guard, {
          rows: [Permission.SettingsMember],
          userType: UserType.API,
        })
      ).result,
    ).toBe("passed");
    expect(
      (
        await run(guard, {
          rows: [
            Permission.SettingsMember,
            permissionRow(Permission.SettingsMember, { isBlock: true }),
          ],
          userType: UserType.API,
        })
      ).result,
    ).toBe("refused");
  });
});

describe("requireModelPermission and an operational resource's wildcard", () => {
  const readMonitors: MiddlewareFunction =
    UserMiddleware.requireModelPermission({
      operations: [{ model: new Monitor(), operation: "read" }],
    }) as MiddlewareFunction;

  test("the model's wildcard opens its operation", async () => {
    expect(
      (
        await run(readMonitors, {
          rows: [Permission.ReadAllOperationalResources],
        })
      ).result,
    ).toBe("passed");
  });

  test("a block with no labels on the wildcard takes it away", async () => {
    expect(
      (
        await run(readMonitors, {
          rows: [
            Permission.ReadAllOperationalResources,
            permissionRow(Permission.ReadAllOperationalResources, {
              isBlock: true,
            }),
          ],
        })
      ).result,
    ).toBe("refused");
  });

  test("a refusal without its own words says what requirePermission says", async () => {
    const outcome: Outcome = await run(readMonitors, {
      rows: [Permission.IncidentMember],
    });

    expect(outcome.result).toBe("refused");
    expect(outcome.error?.message).toBe(
      UserMiddleware.MISSING_PERMISSION_MESSAGE,
    );
  });
});

describe("requireModelPermission with nothing to ask", () => {
  test("a guard that names no operation lets nobody in but a master admin", async () => {
    const guard: MiddlewareFunction = UserMiddleware.requireModelPermission({
      operations: [],
    }) as MiddlewareFunction;

    expect((await run(guard, { rows: [Permission.ProjectOwner] })).result).toBe(
      "refused",
    );
    expect((await run(guard, { userType: UserType.MasterAdmin })).result).toBe(
      "passed",
    );
  });
});

describe("requirePermission still reads the rows as before", () => {
  test("its refusal keeps its words", async () => {
    const guard: MiddlewareFunction = UserMiddleware.requirePermission({
      permissions: [Permission.ProjectOwner],
    }) as MiddlewareFunction;

    const outcome: Outcome = await run(guard, {
      rows: [Permission.ProjectAdmin],
    });

    expect(outcome.result).toBe("refused");
    expect(outcome.error?.message).toBe(
      "You do not have the required permission to perform this action.",
    );
    expect(UserMiddleware.MISSING_PERMISSION_MESSAGE).toBe(
      "You do not have the required permission to perform this action.",
    );
  });
});

import { mockRouter } from "Common/Tests/Server/API/Helpers";
import {
  permissionRow,
  tenantPermissionsFor,
} from "Common/Tests/Server/API/PermissionRows";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Exception from "Common/Types/Exception/Exception";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import {
  INCOMING_CALL_PHONE_NUMBER_REFUSALS,
  IncomingCallPhoneNumberAction,
} from "Common/Utils/IncomingCall/IncomingCallPhoneNumberAccess";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * Who may use each incoming call policy phone-number route, through the
 * route guard the router really registers (UserMiddleware
 * .requireModelPermission over IncomingCallPhoneNumberAccess): the roles of
 * the incoming call policy the numbers serve.
 *
 *  - search and list-owned (look numbers up in the Twilio account) need the
 *    read of incoming call policies and of call and SMS settings;
 *  - assign-existing, purchase and both release routes need the edit of
 *    incoming call policies - the Settings roles that own the policies
 *    included, which the routes used to leave out.
 *
 * A route the guard lets through then checks the one policy as its update
 * would (PhoneNumberAPI.test covers that record check); this suite pins the
 * guard itself, role by role, with the rows a request carries.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

import "../../FeatureSet/Notification/API/PhoneNumber";

const PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);
const USER_ID: ObjectID = new ObjectID("34343434-3434-4434-8434-343434343434");

type Method = "post" | "delete";

interface PhoneNumberRoute {
  method: Method;
  route: string;
  action: IncomingCallPhoneNumberAction;
}

const ROUTES: Array<PhoneNumberRoute> = [
  {
    method: "post",
    route: "/search",
    action: IncomingCallPhoneNumberAction.LookUp,
  },
  {
    method: "post",
    route: "/list-owned",
    action: IncomingCallPhoneNumberAction.LookUp,
  },
  {
    method: "post",
    route: "/assign-existing",
    action: IncomingCallPhoneNumberAction.Change,
  },
  {
    method: "post",
    route: "/purchase",
    action: IncomingCallPhoneNumberAction.Change,
  },
  {
    method: "delete",
    route: "/release/:incomingCallPolicyId/:incomingCallPolicyPhoneNumberId",
    action: IncomingCallPhoneNumberAction.Change,
  },
  {
    method: "delete",
    route: "/release/:incomingCallPolicyId",
    action: IncomingCallPhoneNumberAction.Change,
  },
];

interface RoleCase {
  role: string;
  rows: Array<UserPermission | Permission>;
  userType?: UserType | undefined;
  // What the role may do: look numbers up, change them.
  lookUp: boolean;
  change: boolean;
}

const ROLES: Array<RoleCase> = [
  {
    role: "Project Owner",
    rows: [Permission.ProjectOwner],
    lookUp: true,
    change: true,
  },
  {
    role: "Project Admin",
    rows: [Permission.ProjectAdmin],
    lookUp: true,
    change: true,
  },
  {
    role: "Project Member",
    rows: [Permission.ProjectMember],
    lookUp: true,
    change: true,
  },
  {
    role: "Settings Admin",
    rows: [Permission.SettingsAdmin],
    lookUp: true,
    change: true,
  },
  {
    role: "Settings Member",
    rows: [Permission.SettingsMember],
    lookUp: true,
    change: true,
  },
  {
    role: "Settings Viewer",
    rows: [Permission.SettingsViewer],
    lookUp: true,
    change: false,
  },
  {
    role: "Viewer",
    rows: [Permission.Viewer],
    lookUp: true,
    change: false,
  },
  {
    role: "a Settings Member limited to some labels",
    rows: [permissionRow(Permission.SettingsMember, { labelled: true })],
    lookUp: true,
    change: true,
  },
  {
    role: "a Settings Member whose team blocks Edit Incoming Call Policy",
    rows: [
      Permission.SettingsMember,
      permissionRow(Permission.EditProjectIncomingCallPolicy, {
        isBlock: true,
      }),
    ],
    lookUp: true,
    change: false,
  },
  {
    role: "a Settings Admin whose team blocks Read Call and SMS",
    rows: [
      Permission.SettingsAdmin,
      permissionRow(Permission.ReadProjectCallSMSConfig, { isBlock: true }),
    ],
    lookUp: false,
    change: true,
  },
  {
    role: "a Settings Member whose only row is a block",
    rows: [permissionRow(Permission.SettingsMember, { isBlock: true })],
    lookUp: false,
    change: false,
  },
  {
    role: "Read Incoming Call Policy alone",
    rows: [Permission.ReadProjectIncomingCallPolicy],
    lookUp: false,
    change: false,
  },
  {
    role: "Read Incoming Call Policy and Read Call and SMS",
    rows: [
      Permission.ReadProjectIncomingCallPolicy,
      Permission.ReadProjectCallSMSConfig,
    ],
    lookUp: true,
    change: false,
  },
  {
    role: "Edit Incoming Call Policy alone",
    rows: [Permission.EditProjectIncomingCallPolicy],
    lookUp: false,
    change: true,
  },
  {
    role: "Incident Member",
    rows: [Permission.IncidentMember],
    lookUp: false,
    change: false,
  },
  {
    role: "an API key holding Settings Member",
    rows: [Permission.SettingsMember],
    userType: UserType.API,
    lookUp: true,
    change: true,
  },
];

type Guard = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

let sendErrorResponse: SpyInstance<typeof Response.sendErrorResponse>;

beforeAll(() => {
  sendErrorResponse = jest
    .spyOn(Response, "sendErrorResponse")
    .mockImplementation(() => {
      return undefined as never;
    });
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  sendErrorResponse.mockClear();
});

// The guard of a route: its third middleware, after the session middlewares.
function guardOf(route: PhoneNumberRoute): Guard {
  const middlewares: Array<unknown> = mockRouter.match(
    route.method,
    route.route,
  ).middlewares;

  expect(middlewares.slice(0, 2)).toEqual([
    UserMiddleware.getUserMiddleware,
    UserMiddleware.requireUserAuthentication,
  ]);
  expect(middlewares).toHaveLength(3);

  return middlewares[2] as Guard;
}

async function call(
  route: PhoneNumberRoute,
  roleCase: RoleCase,
): Promise<{ passed: boolean; error?: Exception | undefined }> {
  const request: OneUptimeRequest = {
    headers: {},
    params: {},
    query: {},
    body: {},
    userType: roleCase.userType || UserType.User,
    tenantId: PROJECT_ID,
    userAuthorization: { userId: USER_ID },
    userTenantAccessPermission: tenantPermissionsFor(PROJECT_ID, roleCase.rows),
  } as unknown as OneUptimeRequest;

  const next: Mock = jest.fn();

  sendErrorResponse.mockClear();

  await guardOf(route)(
    request as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  if (sendErrorResponse.mock.calls.length > 0) {
    expect(next).not.toHaveBeenCalled();
    return {
      passed: false,
      error: sendErrorResponse.mock.calls[0]![2] as Exception,
    };
  }

  expect(next).toHaveBeenCalledTimes(1);
  return { passed: true };
}

describe("phone-number routes take the incoming call policy's roles", () => {
  const cases: Array<[string, string, RoleCase, PhoneNumberRoute]> = [];

  for (const roleCase of ROLES) {
    for (const route of ROUTES) {
      cases.push([
        roleCase.role,
        `${route.method} ${route.route}`,
        roleCase,
        route,
      ]);
    }
  }

  test.each(cases)(
    "%s on %s",
    async (
      _role: string,
      _route: string,
      roleCase: RoleCase,
      route: PhoneNumberRoute,
    ) => {
      const expected: boolean =
        route.action === IncomingCallPhoneNumberAction.LookUp
          ? roleCase.lookUp
          : roleCase.change;

      const outcome: { passed: boolean; error?: Exception | undefined } =
        await call(route, roleCase);

      expect(outcome.passed).toBe(expected);

      if (!expected) {
        // Refused in plain words that say what the action needs.
        expect(outcome.error).toBeInstanceOf(NotAuthorizedException);
        expect(outcome.error?.message).toBe(
          INCOMING_CALL_PHONE_NUMBER_REFUSALS[route.action],
        );
      }
    },
  );

  test("a master admin passes every route", async () => {
    for (const route of ROUTES) {
      expect(
        (
          await call(route, {
            role: "master admin",
            rows: [],
            userType: UserType.MasterAdmin,
            lookUp: true,
            change: true,
          })
        ).passed,
      ).toBe(true);
    }
  });
});

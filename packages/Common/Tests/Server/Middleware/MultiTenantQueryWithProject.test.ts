jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
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
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import CallerPlan from "../../../Server/Utils/Billing/CallerPlan";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import MultiTenantQuery from "../../../Server/Utils/MultiTenantQuery";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import HashedString from "../../../Types/HashedString";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A REQUEST IN ONE PROJECT, OR ACROSS THE CALLER'S PROJECTS - NEVER BOTH.
 *
 * A request that named a project and sent is-multi-tenant-query was taken
 * as both: the project it named was the request's (its plan, the tenant a
 * route reads by, as root), while the reads made with its props were
 * answered across the caller's own projects. That let someone outside
 * project A read A's code-fix runs, and a project owner elsewhere read A's
 * private incidents. Such a request is now refused with a 400, wherever it
 * names the project - the header, the query string, the path or the body -
 * before anything is read for the project, whoever sends it.
 *
 * The real middleware, tokens signed and verified for real; the services
 * that read Postgres are stubbed.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("9e2f0000-0000-4000-8000-000000000001");
// The caller's own project.
const OWN_PROJECT_ID: ObjectID = new ObjectID(
  "9e2f0000-0000-4000-8000-0000000000a1",
);
// A project the caller is not a member of.
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "9e2f0000-0000-4000-8000-0000000000b2",
);
const API_KEY_VALUE: ObjectID = new ObjectID(
  "9e2f0000-0000-4000-8000-000000000002",
);

const tenantPermissionIn: (
  projectId: ObjectID,
) => UserTenantAccessPermission = (
  projectId: ObjectID,
): UserTenantAccessPermission => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectOwner,
        labelIds: [],
      },
    ],
  };
};

const GLOBAL_PERMISSION: UserGlobalAccessPermission = {
  _type: "UserGlobalAccessPermission",
  projectIds: [OWN_PROJECT_ID],
  globalPermissions: [Permission.Public, Permission.User],
};

const signToken: () => string = (): string => {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: USER_ID,
      email: new Email("member@example.com"),
      name: new Name("Mia Member"),
      timezone: null,
      isMasterAdmin: false,
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
    },
    expiresInSeconds: 15 * 60,
  });
};

interface RequestParts {
  headers?: Dictionary<string>;
  query?: Dictionary<string>;
  params?: Dictionary<string>;
  body?: JSONObject;
}

const buildRequest: (parts: RequestParts) => OneUptimeRequest = (
  parts: RequestParts,
): OneUptimeRequest => {
  return {
    params: { ...(parts.params || {}) },
    query: { ...(parts.query || {}) },
    body: { ...(parts.body || {}) },
    cookies: { "user-token": signToken() },
    headers: { ...(parts.headers || {}) },
  } as unknown as OneUptimeRequest;
};

interface Outcome {
  next: MockFunction;
  sentError: Exception | undefined;
}

// The middleware as Express runs it: it never rejects.
const runMiddleware: (
  middleware: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>,
  req: OneUptimeRequest,
) => Promise<Outcome> = async (
  middleware: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>,
  req: OneUptimeRequest,
): Promise<Outcome> => {
  const next: MockFunction = getJestMockFunction();
  const res: ExpressResponse = {
    set: jest.fn(),
  } as unknown as ExpressResponse;

  await expect(
    middleware(
      req as unknown as ExpressRequest,
      res,
      next as unknown as NextFunction,
    ),
  ).resolves.toBeUndefined();

  const errorCalls: Array<Array<unknown>> = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return {
    next: next,
    sentError: errorCalls[0]?.[2] as Exception | undefined,
  };
};

const expectBothRefused: (outcome: Outcome) => void = (
  outcome: Outcome,
): void => {
  expect(outcome.next).not.toHaveBeenCalled();
  expect(outcome.sentError).toBeInstanceOf(BadDataException);
  expect(outcome.sentError?.code).toBe(400);
  expect(outcome.sentError?.message).toBe(
    MultiTenantQuery.WITH_PROJECT_MESSAGE,
  );
};

let getUserTenantAccessPermission: ReturnType<typeof getJestSpyOn>;
let getUserGlobalAccessPermission: ReturnType<typeof getJestSpyOn>;
let getRequireSsoForLogin: ReturnType<typeof getJestSpyOn>;
let isProjectBlocked: ReturnType<typeof getJestSpyOn>;
let updateProjectLastActive: ReturnType<typeof getJestSpyOn>;
let findApiKey: ReturnType<typeof getJestSpyOn>;

beforeEach(() => {
  jest.clearAllMocks();

  getJestSpyOn(Response, "sendErrorResponse").mockImplementation(() => {
    return undefined as never;
  });

  isProjectBlocked = getJestSpyOn(
    ProjectService,
    "isProjectBlocked",
  ).mockResolvedValue(false);
  getRequireSsoForLogin = getJestSpyOn(
    ProjectService,
    "getRequireSsoForLogin",
  ).mockResolvedValue(false);
  updateProjectLastActive = getJestSpyOn(
    ProjectService,
    "updateLastActive",
  ).mockResolvedValue(undefined);
  getJestSpyOn(UserService, "updateLastActive").mockResolvedValue(undefined);
  getJestSpyOn(UserService, "isUserBlocked").mockResolvedValue(false);
  getJestSpyOn(UserService, "isUserMasterAdmin").mockResolvedValue(false);
  getJestSpyOn(GlobalConfigService, "getRequireSsoForLogin").mockResolvedValue(
    false,
  );
  getUserGlobalAccessPermission = getJestSpyOn(
    AccessTokenService,
    "getUserGlobalAccessPermission",
  ).mockResolvedValue(GLOBAL_PERMISSION);
  // A member of their own project, and of no other.
  getUserTenantAccessPermission = getJestSpyOn(
    AccessTokenService,
    "getUserTenantAccessPermission",
  ).mockImplementation(
    async (
      _userId: ObjectID,
      projectId: ObjectID,
    ): Promise<UserTenantAccessPermission | null> => {
      return projectId.toString() === OWN_PROJECT_ID.toString()
        ? tenantPermissionIn(projectId)
        : null;
    },
  );
  getJestSpyOn(TeamMemberService, "getTeamIdsForUser").mockResolvedValue([]);
  getJestSpyOn(HashedString, "hashValue").mockResolvedValue("hash");
  findApiKey = getJestSpyOn(ApiKeyService, "findApiKey").mockResolvedValue(
    null,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Everywhere a request can name its project (ProjectMiddleware.getProjectId).
const NAMED_IN: Array<[string, (projectId: ObjectID) => RequestParts]> = [
  [
    "the tenantid header",
    (projectId: ObjectID): RequestParts => {
      return { headers: { tenantid: projectId.toString() } };
    },
  ],
  [
    "the projectid header",
    (projectId: ObjectID): RequestParts => {
      return { headers: { projectid: projectId.toString() } };
    },
  ],
  [
    "the query string (a link's ?tenantid=)",
    (projectId: ObjectID): RequestParts => {
      return { query: { tenantid: projectId.toString() } };
    },
  ],
  [
    "the path",
    (projectId: ObjectID): RequestParts => {
      return { params: { projectId: projectId.toString() } };
    },
  ],
  [
    "the body",
    (projectId: ObjectID): RequestParts => {
      return { body: { projectId: projectId.toString() } };
    },
  ],
];

const acrossProjects: (parts: RequestParts) => RequestParts = (
  parts: RequestParts,
): RequestParts => {
  return {
    ...parts,
    headers: {
      ...(parts.headers || {}),
      [MultiTenantQuery.HEADER]: "true",
    },
  };
};

describe("a request that names a project and asks across projects", () => {
  test.each(NAMED_IN)(
    "is refused with a 400, before anything is read for the project, when the project is named in %s",
    async (_where: string, namedIn: (projectId: ObjectID) => RequestParts) => {
      const req: OneUptimeRequest = buildRequest(
        acrossProjects(namedIn(OTHER_PROJECT_ID)),
      );

      const outcome: Outcome = await runMiddleware(
        UserMiddleware.getUserMiddleware,
        req,
      );

      expectBothRefused(outcome);
      expect(req.tenantId).toBeUndefined();
      expect(req.userTenantAccessPermission).toBeUndefined();
      expect(getUserTenantAccessPermission).not.toHaveBeenCalled();
      expect(getUserGlobalAccessPermission).not.toHaveBeenCalled();
      expect(getRequireSsoForLogin).not.toHaveBeenCalled();
      expect(isProjectBlocked).not.toHaveBeenCalled();
      expect(updateProjectLastActive).not.toHaveBeenCalled();
    },
  );

  test("is refused for a member of the project it names too: a request is one or the other", async () => {
    const outcome: Outcome = await runMiddleware(
      UserMiddleware.getUserMiddleware,
      buildRequest(
        acrossProjects({ headers: { tenantid: OWN_PROJECT_ID.toString() } }),
      ),
    );

    expectBothRefused(outcome);
    expect(getUserTenantAccessPermission).not.toHaveBeenCalled();
  });

  test("is refused on the public pages' middleware too", async () => {
    const outcome: Outcome = await runMiddleware(
      UserMiddleware.getPublicRouteUserMiddleware,
      buildRequest(
        acrossProjects({ headers: { tenantid: OTHER_PROJECT_ID.toString() } }),
      ),
    );

    expectBothRefused(outcome);
  });

  test("is refused with an API key, before the key is looked up", async () => {
    const outcome: Outcome = await runMiddleware(
      UserMiddleware.getUserMiddleware,
      buildRequest(
        acrossProjects({
          headers: {
            apikey: API_KEY_VALUE.toString(),
            tenantid: OWN_PROJECT_ID.toString(),
          },
        }),
      ),
    );

    expectBothRefused(outcome);
    expect(findApiKey).not.toHaveBeenCalled();
  });
});

describe("a request that does one or the other works as before", () => {
  test("a request across projects that names none is answered across the caller's projects", async () => {
    const req: OneUptimeRequest = buildRequest(acrossProjects({}));

    const outcome: Outcome = await runMiddleware(
      UserMiddleware.getUserMiddleware,
      req,
    );

    expect(outcome.sentError).toBeUndefined();
    expect(outcome.next.mock.calls).toEqual([[]]);
    expect(req.tenantId).toBeUndefined();
    expect(Object.keys(req.userTenantAccessPermission || {})).toEqual([
      OWN_PROJECT_ID.toString(),
    ]);
  });

  test("a request in one project, without the header, is answered in it", async () => {
    const req: OneUptimeRequest = buildRequest({
      headers: { tenantid: OWN_PROJECT_ID.toString() },
    });

    const outcome: Outcome = await runMiddleware(
      UserMiddleware.getUserMiddleware,
      req,
    );

    expect(outcome.sentError).toBeUndefined();
    expect(outcome.next.mock.calls).toEqual([[]]);
    expect(req.tenantId?.toString()).toBe(OWN_PROJECT_ID.toString());
    expect(Object.keys(req.userTenantAccessPermission || {})).toEqual([
      OWN_PROJECT_ID.toString(),
    ]);
  });
});

/*
 * The props every route reads by. A project another middleware gave the
 * request - an API key's own, which the key's middleware sets whatever the
 * request named - is refused beside the header the same way.
 */
describe("the props a route reads by (CommonAPI)", () => {
  beforeEach(() => {
    getJestSpyOn(CallerPlan, "withPlan").mockImplementation(
      async (
        props: DatabaseCommonInteractionProps,
      ): Promise<DatabaseCommonInteractionProps> => {
        return props;
      },
    );
  });

  const requestAs: (data: {
    tenantId?: ObjectID | undefined;
    acrossProjects: boolean;
  }) => OneUptimeRequest = (data: {
    tenantId?: ObjectID | undefined;
    acrossProjects: boolean;
  }): OneUptimeRequest => {
    const req: OneUptimeRequest = buildRequest(
      data.acrossProjects ? acrossProjects({}) : {},
    );

    req.userType = UserType.API;

    if (data.tenantId) {
      req.tenantId = data.tenantId;
    }

    return req;
  };

  test("refuse a project the request was given beside the header", async () => {
    await expect(
      CommonAPI.getDatabaseCommonInteractionProps(
        requestAs({ tenantId: OWN_PROJECT_ID, acrossProjects: true }),
      ),
    ).rejects.toThrow(
      new BadDataException(MultiTenantQuery.WITH_PROJECT_MESSAGE),
    );
  });

  test("ask across projects for a request that names none", async () => {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(
        requestAs({ acrossProjects: true }),
      );

    expect(props.isMultiTenantRequest).toBe(true);
    expect(props.tenantId).toBeUndefined();
  });

  test("stay in the project of a request without the header", async () => {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(
        requestAs({ tenantId: OWN_PROJECT_ID, acrossProjects: false }),
      );

    expect(props.isMultiTenantRequest).toBeFalsy();
    expect(props.tenantId?.toString()).toBe(OWN_PROJECT_ID.toString());
  });
});

import { mockRouter } from "./Helpers";
import {
  ASK_AI_RATINGS_PERMISSIONS,
  ASK_AI_RATINGS_REFUSED_MESSAGE,
} from "../../../Server/API/AIChatAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ProductFeedbackService from "../../../Server/Services/ProductFeedbackService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import {
  ASK_AI_RATINGS_ROUTE,
  AskAiProjectRatings,
} from "../../../Types/AI/AskAiRatings";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

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
    setNoCacheHeaders: jest.fn(),
  };
});

/*
 * GET /ai-chat/ratings (#7365): how a project's Ask AI answers were rated,
 * for its owners and admins alone - the project named in the header, once
 * the caller is shown to be its member - and never cached. What it answers
 * is the service's (ProductFeedbackService.getProjectAskAiRatings), for that
 * project only: counts and what the answers rated down read, never a word.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const RATINGS: AskAiProjectRatings = {
  sinceDays: 90,
  helpful: 5,
  notHelpful: 2,
  ratedDownDrewOn: [],
};

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

function ratingsRoute(): RegisteredRoute {
  const route: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((candidate: RegisteredRoute): boolean => {
    return candidate.method === "GET" && candidate.uri === ASK_AI_RATINGS_ROUTE;
  });

  if (!route) {
    throw new Error("No GET route for /ai-chat/ratings");
  }

  return route;
}

// Props as UserAuthorization builds them, for a member of `projectId` holding `permissions`.
function memberOf(
  projectId: ObjectID,
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      } as UserPermission;
    }),
    isBlockPermission: false,
  } as UserTenantAccessPermission;

  const dictionary: Dictionary<UserTenantAccessPermission> = {};
  dictionary[projectId.toString()] = tenant;

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    userTenantAccessPermission: dictionary,
  };
}

let props: DatabaseCommonInteractionProps;
let getRatings: jest.SpiedFunction<
  typeof ProductFeedbackService.getProjectAskAiRatings
>;

beforeEach(() => {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
  getRatings = jest
    .spyOn(ProductFeedbackService, "getProjectAskAiRatings")
    .mockResolvedValue(RATINGS);
  (Response.sendJsonObjectResponse as jest.Mock).mockClear();
  (Response.setNoCacheHeaders as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function call(): Promise<unknown> {
  const next: jest.Mock = jest.fn();

  await ratingsRoute().handlerFunction(
    { query: {}, params: {}, headers: {}, body: {} } as never,
    {} as never,
    next as unknown as NextFunction,
  );

  return next.mock.calls[0]?.[0];
}

describe("GET /ai-chat/ratings", () => {
  test("is a read behind the user middleware, for the project's owners and admins", () => {
    expect(ratingsRoute().middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
    expect(ASK_AI_RATINGS_PERMISSIONS).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
  });

  test.each([[Permission.ProjectOwner], [Permission.ProjectAdmin]])(
    "a project's %s reads its ratings, for that project, never cached",
    async (permission: Permission) => {
      props = memberOf(PROJECT_ID, [permission]);

      expect(await call()).toBeUndefined();
      expect(getRatings).toHaveBeenCalledTimes(1);
      expect(getRatings.mock.calls[0]![0].projectId.toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(Response.setNoCacheHeaders).toHaveBeenCalled();
      expect(
        (Response.sendJsonObjectResponse as jest.Mock).mock.calls[0]![2],
      ).toEqual(RATINGS);
    },
  );

  test("a member who is no owner or admin is refused, with who can see it, and nothing is read", async () => {
    props = memberOf(PROJECT_ID, [Permission.ProjectMember]);

    const error: unknown = await call();

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect((error as Error).message).toBe(ASK_AI_RATINGS_REFUSED_MESSAGE);
    expect(getRatings).not.toHaveBeenCalled();
  });

  test("an owner of another project naming this one is refused before anything is read", async () => {
    props = memberOf(OTHER_PROJECT_ID, [Permission.ProjectOwner]);

    expect(await call()).toBeInstanceOf(NotAuthorizedException);
    expect(getRatings).not.toHaveBeenCalled();
  });

  test("no session is a 401, so the browser refreshes it and asks again", async () => {
    props = { tenantId: PROJECT_ID };

    expect(await call()).toBeInstanceOf(NotAuthenticatedException);
    expect(getRatings).not.toHaveBeenCalled();
  });
});

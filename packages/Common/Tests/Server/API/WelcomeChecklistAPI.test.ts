import { mockRouter } from "./Helpers";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import WelcomeChecklistAPI from "../../../Server/API/WelcomeChecklistAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import WelcomeChecklistService from "../../../Server/Services/WelcomeChecklistService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { WelcomeAudience } from "../../../Types/WelcomeChecklist/WelcomeChecklist";
import {
  WELCOME_CHECKLIST_BROWSER_STATE_ROUTE,
  WELCOME_CHECKLIST_GOALS_ROUTE,
  WELCOME_CHECKLIST_HIDE_ROUTE,
  WELCOME_CHECKLIST_ROUTE,
  WELCOME_CHECKLIST_SHOW_ROUTE,
  WelcomeChecklistAnswer,
  getEmptyWelcomeChecklistAnswer,
} from "../../../Types/WelcomeChecklist/WelcomeChecklistAnswer";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The Welcome checklist's routes (issue #6803), run through their real
 * handlers and guards with the service answered here: who may read, who
 * may choose the goals, that hiding is the caller's own, and that every
 * route answers with the checklist as it now stands.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

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

function memberProps(
  permissions: Array<Permission>,
  overrides?: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps {
  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
      } as UserPermission;
    }),
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: tenant },
    ...overrides,
  };
}

function routeFor(method: string, uri: string): RegisteredRoute {
  const route: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((candidate: RegisteredRoute): boolean => {
    return candidate.method === method && candidate.uri === uri;
  });

  if (!route) {
    throw new Error(`No ${method} route for ${uri}`);
  }

  return route;
}

const ANSWER: WelcomeChecklistAnswer = {
  ...getEmptyWelcomeChecklistAnswer(),
  audience: WelcomeAudience.SetUp,
  canChooseGoals: true,
};

let props: DatabaseCommonInteractionProps;
let getAnswer: jest.SpyInstance;
let chooseGoals: jest.SpyInstance;
let setHidden: jest.SpyInstance;
let takeBrowserState: jest.SpyInstance;
let sendJson: jest.SpyInstance;

beforeEach(() => {
  props = memberProps([Permission.ProjectOwner]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });

  getAnswer = jest
    .spyOn(WelcomeChecklistService, "getAnswer")
    .mockResolvedValue(ANSWER);
  chooseGoals = jest
    .spyOn(WelcomeChecklistService, "chooseGoals")
    .mockResolvedValue([]);
  setHidden = jest
    .spyOn(WelcomeChecklistService, "setHiddenForCaller")
    .mockResolvedValue(undefined);
  takeBrowserState = jest
    .spyOn(WelcomeChecklistService, "takeBrowserState")
    .mockResolvedValue(undefined);
  sendJson = jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function call(
  method: string,
  uri: string,
  body?: unknown,
): Promise<unknown> {
  const next: jest.Mock = jest.fn();

  await routeFor(method, uri).handlerFunction(
    { query: {}, params: {}, headers: {}, body: body } as never,
    {} as never,
    next as unknown as NextFunction,
  );

  return next.mock.calls[0]?.[0];
}

describe("the routes", () => {
  test("are one bare router: a read and four changes, each behind the user middleware", () => {
    expect(WelcomeChecklistAPI).toBe(mockRouter);

    expect(routeFor("GET", WELCOME_CHECKLIST_ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);

    for (const uri of [
      WELCOME_CHECKLIST_GOALS_ROUTE,
      WELCOME_CHECKLIST_HIDE_ROUTE,
      WELCOME_CHECKLIST_SHOW_ROUTE,
      WELCOME_CHECKLIST_BROWSER_STATE_ROUTE,
    ]) {
      expect(routeFor("POST", uri).middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
      ]);
    }
  });
});

describe("GET /welcome-checklist", () => {
  test("answers a member with the checklist for them and their project", async () => {
    expect(await call("GET", WELCOME_CHECKLIST_ROUTE)).toBeUndefined();

    expect(getAnswer).toHaveBeenCalledTimes(1);
    expect(getAnswer.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      userId: USER_ID,
      props: props,
    });
    expect(sendJson).toHaveBeenCalledTimes(1);

    const body: JSONObject = sendJson.mock.calls[0]![2] as JSONObject;

    expect(body["audience"]).toBe(WelcomeAudience.SetUp);
    expect(body["canChooseGoals"]).toBe(true);
    expect(body["steps"]).toEqual([]);
  });

  test("an expired session is a 401, so the browser refreshes it and sends again", async () => {
    props = {
      tenantId: PROJECT_ID,
      userType: UserType.Public,
    } as DatabaseCommonInteractionProps;

    expect(await call("GET", WELCOME_CHECKLIST_ROUTE)).toBeInstanceOf(
      NotAuthenticatedException,
    );
    expect(getAnswer).not.toHaveBeenCalled();
  });

  test("somebody who is not a member of the project in the header is refused", async () => {
    props = memberProps([Permission.ProjectOwner], {
      tenantId: OTHER_PROJECT_ID,
    });

    expect(await call("GET", WELCOME_CHECKLIST_ROUTE)).toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(getAnswer).not.toHaveBeenCalled();
  });

  test("without a project there is nothing to answer", async () => {
    props = memberProps([Permission.ProjectOwner], { tenantId: undefined });

    expect(await call("GET", WELCOME_CHECKLIST_ROUTE)).toBeInstanceOf(
      BadDataException,
    );
  });
});

describe("POST /welcome-checklist/goals", () => {
  test("an Owner chooses the goals, and gets the checklist that follows", async () => {
    expect(
      await call("POST", WELCOME_CHECKLIST_GOALS_ROUTE, {
        goals: ["uptime", "status_page"],
      }),
    ).toBeUndefined();

    expect(chooseGoals).toHaveBeenCalledTimes(1);
    expect(chooseGoals.mock.calls[0]![1]).toEqual(["uptime", "status_page"]);
    expect(getAnswer).toHaveBeenCalledTimes(1);
    expect(sendJson).toHaveBeenCalledTimes(1);
  });

  test("an Admin may too, and may skip with no goals", async () => {
    props = memberProps([Permission.ProjectAdmin]);

    expect(
      await call("POST", WELCOME_CHECKLIST_GOALS_ROUTE, { goals: [] }),
    ).toBeUndefined();
    expect(chooseGoals.mock.calls[0]![1]).toEqual([]);
  });

  test.each([
    [Permission.ProjectMember],
    [Permission.Viewer],
    [Permission.CreateProjectMonitor],
  ])("%s may not", async (permission: Permission) => {
    props = memberProps([permission]);

    expect(
      await call("POST", WELCOME_CHECKLIST_GOALS_ROUTE, { goals: ["uptime"] }),
    ).toBeInstanceOf(NotAuthorizedException);
    expect(chooseGoals).not.toHaveBeenCalled();
  });

  test("goals must be a list", async () => {
    for (const body of [{}, { goals: "uptime" }, null, ["uptime"]]) {
      chooseGoals.mockClear();

      expect(
        await call("POST", WELCOME_CHECKLIST_GOALS_ROUTE, body),
      ).toBeInstanceOf(BadDataException);
      expect(chooseGoals).not.toHaveBeenCalled();
    }
  });
});

describe("hiding and showing", () => {
  test("any member hides the card for themselves", async () => {
    props = memberProps([Permission.Viewer]);

    expect(await call("POST", WELCOME_CHECKLIST_HIDE_ROUTE)).toBeUndefined();
    expect(setHidden).toHaveBeenCalledTimes(1);
    expect(
      (setHidden.mock.calls[0]![0] as { userId: ObjectID }).userId,
    ).toEqual(USER_ID);
    expect(setHidden.mock.calls[0]![1]).toBe(true);
    expect(sendJson).toHaveBeenCalledTimes(1);
  });

  test("and shows it again", async () => {
    expect(await call("POST", WELCOME_CHECKLIST_SHOW_ROUTE)).toBeUndefined();
    expect(setHidden.mock.calls[0]![1]).toBe(false);
  });

  test("an expired session hides nothing", async () => {
    props = {
      tenantId: PROJECT_ID,
      userType: UserType.Public,
    } as DatabaseCommonInteractionProps;

    expect(await call("POST", WELCOME_CHECKLIST_HIDE_ROUTE)).toBeInstanceOf(
      NotAuthenticatedException,
    );
    expect(setHidden).not.toHaveBeenCalled();
  });
});

describe("POST /welcome-checklist/browser-state", () => {
  test("hands over only the two things the old checklist kept, as true or false", async () => {
    expect(
      await call("POST", WELCOME_CHECKLIST_BROWSER_STATE_ROUTE, {
        wasDismissed: true,
        wasFinished: "yes",
        somethingElse: true,
      }),
    ).toBeUndefined();

    expect(takeBrowserState.mock.calls[0]![1]).toEqual({
      wasDismissed: true,
      wasFinished: false,
    });
    expect(sendJson).toHaveBeenCalledTimes(1);
  });

  test("a body that is not an object hands over nothing", async () => {
    await call("POST", WELCOME_CHECKLIST_BROWSER_STATE_ROUTE, "dismissed");

    expect(takeBrowserState.mock.calls[0]![1]).toEqual({
      wasDismissed: false,
      wasFinished: false,
    });
  });
});

import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserNotificationSettingAPI from "../../../Server/API/UserNotificationSettingAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import RoutineEmailSettingsService from "../../../Server/Services/RoutineEmailSettingsService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import { ROUTINE_EMAIL_EVENT_TYPES } from "../../../Types/NotificationSetting/RoutineEmailEvents";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

const ROUTE: string = "/user-notification-setting/reduce-routine-emails";
const USER_ID: ObjectID = ObjectID.generate();
const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();

/*
 * The exception the handler handed to next(). Its code is the HTTP status the
 * client sees, and the browser client refreshes the session on 401 only, so
 * the code is asserted alongside the class.
 */
function errorPassedTo(next: jest.Mock): Exception {
  return next.mock.calls[0]![0] as Exception;
}

describe("POST reduce routine emails", () => {
  let props: DatabaseCommonInteractionProps;
  let reduceSpy: jest.SpyInstance;
  let responseSpy: jest.SpyInstance;

  beforeEach(() => {
    props = {
      userId: USER_ID,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: [
            {
              _type: "UserPermission",
              permission: Permission.ProjectMember,
              labelIds: [],
              isBlockPermission: false,
            },
          ],
        },
      },
    };
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockImplementation(async () => {
        return props;
      });
    reduceSpy = jest
      .spyOn(RoutineEmailSettingsService, "reduceRoutineEmails")
      .mockResolvedValue(undefined);
    responseSpy = jest
      .spyOn(Response, "sendJsonObjectResponse")
      .mockImplementation(jest.fn());
    mockRouter.routes = [];
    new UserNotificationSettingAPI();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function call(body?: unknown): Promise<jest.Mock> {
    const next: jest.Mock = jest.fn();
    await mockRouter
      .match("POST", ROUTE)
      .handlerFunction(
        { body, headers: {} } as ExpressRequest,
        {} as ExpressResponse,
        next as NextFunction,
      );
    return next;
  }

  test("requires user middleware and retains the existing settings CRUD routes", () => {
    expect(mockRouter.match("POST", ROUTE).middleware).toBe(
      UserMiddleware.getUserMiddleware,
    );
    expect(
      mockRouter.match("POST", "/user-notification-setting"),
    ).toBeDefined();
    expect(
      mockRouter.match("POST", "/user-notification-setting/get-list"),
    ).toBeDefined();
  });

  test("lets a project member change their own preferences and returns the covered event count", async () => {
    const next: jest.Mock = await call();
    expect(next).not.toHaveBeenCalled();
    expect(reduceSpy).toHaveBeenCalledWith({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
    expect(responseSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        success: true,
        routineEventTypeCount: ROUTINE_EMAIL_EVENT_TYPES.length,
      },
    );
  });

  test("ignores client-selected users, projects, channels and event lists", async () => {
    await call({
      userId: ObjectID.generate().toString(),
      projectId: OTHER_PROJECT_ID.toString(),
      tenantId: OTHER_PROJECT_ID.toString(),
      alertByCall: false,
      eventTypes: ["arbitrary event"],
    });
    expect(reduceSpy).toHaveBeenCalledTimes(1);
    expect(reduceSpy).toHaveBeenCalledWith({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
  });

  /*
   * Both callers are refused, but differently. The anonymous one - no user, no
   * key, typically a dashboard tab whose access-token cookie expired - gets
   * NotAuthenticatedException (401), which is what makes the browser refresh
   * the session and resend; it used to get the 422 below. A project API key
   * is authenticated but is nobody's preferences, so it keeps the 422: a 401
   * would send its client off to refresh a session it never had.
   */
  test.each([
    {
      caller: "an anonymous caller",
      userType: undefined,
      exception: NotAuthenticatedException,
      code: ExceptionCode.NotAuthenticatedException,
    },
    {
      caller: "an explicitly Public caller",
      userType: UserType.Public,
      exception: NotAuthenticatedException,
      code: ExceptionCode.NotAuthenticatedException,
    },
    {
      caller: "a project API key",
      userType: UserType.API,
      exception: NotAuthorizedException,
      code: ExceptionCode.NotAuthorizedException,
    },
  ])(
    "rejects $caller without an authenticated user",
    async (testCase: {
      caller: string;
      userType: UserType | undefined;
      exception:
        | typeof NotAuthenticatedException
        | typeof NotAuthorizedException;
      code: ExceptionCode;
    }) => {
      props.userId = undefined;
      props.userType = testCase.userType;
      const next: jest.Mock = await call({ userId: USER_ID.toString() });
      expect(next).toHaveBeenCalledWith(expect.any(testCase.exception));
      expect(errorPassedTo(next).code).toBe(testCase.code);
      expect(reduceSpy).not.toHaveBeenCalled();
      expect(responseSpy).not.toHaveBeenCalled();
    },
  );

  test("an anonymous caller with no tenant is asked to log in before the missing project is reported", async () => {
    props.userId = undefined;
    props.tenantId = undefined;
    const next: jest.Mock = await call();
    expect(next).toHaveBeenCalledWith(expect.any(NotAuthenticatedException));
    expect(errorPassedTo(next).code).toBe(401);
    expect(reduceSpy).not.toHaveBeenCalled();
  });

  test("rejects missing project context before changing preferences", async () => {
    props.tenantId = undefined;
    const next: jest.Mock = await call({ projectId: PROJECT_ID.toString() });
    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(errorPassedTo(next).code).toBe(ExceptionCode.BadDataException);
    expect(reduceSpy).not.toHaveBeenCalled();
  });

  test("rejects a logged-in user without project membership", async () => {
    props.userTenantAccessPermission = undefined;
    const next: jest.Mock = await call();
    expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
    expect(errorPassedTo(next).code).toBe(ExceptionCode.NotAuthorizedException);
    expect(reduceSpy).not.toHaveBeenCalled();
  });

  test("rejects membership in a different project", async () => {
    props.tenantId = OTHER_PROJECT_ID;
    const next: jest.Mock = await call();
    expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
    expect(errorPassedTo(next).code).toBe(ExceptionCode.NotAuthorizedException);
    expect(reduceSpy).not.toHaveBeenCalled();
  });

  test("does not report success when the transaction fails", async () => {
    const error: Error = new Error("transaction failed");
    reduceSpy.mockRejectedValue(error);
    const next: jest.Mock = await call();
    expect(next).toHaveBeenCalledWith(error);
    expect(responseSpy).not.toHaveBeenCalled();
  });

  test("does not report success until the entire transaction commits", async () => {
    let resolveTransaction: (() => void) | undefined;
    reduceSpy.mockImplementation(() => {
      return new Promise<void>((resolve: () => void) => {
        resolveTransaction = resolve;
      });
    });
    const request: Promise<jest.Mock> = call();
    await Promise.resolve();
    expect(reduceSpy).toHaveBeenCalledTimes(1);
    expect(responseSpy).not.toHaveBeenCalled();
    resolveTransaction!();
    await request;
    expect(responseSpy).toHaveBeenCalledTimes(1);
  });
});

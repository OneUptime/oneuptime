import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import Response from "Common/Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /api/notification/sms/test and POST /api/notification/call/test - the
 * "Send Test SMS" and "Send Test Call" buttons on Project Settings > Call and
 * SMS.
 *
 * Both are custom (non-CRUD) routes mounted with nothing but
 * UserMiddleware.getUserMiddleware + requireUserAuthentication, so ANY signed-in
 * user of ANY project reaches the handler. The handler then takes a
 * `callSMSConfigId` straight out of the request body and reads that row with
 * `props: { isRoot: true }` - the permission-checked read is bypassed on
 * purpose, because it has to see the Twilio credentials.
 *
 * Until this change neither route checked whose config that was. A member of
 * project A could name project B's config id and have the server send an SMS
 * or place a call on project B's Twilio account, to a number of the caller's
 * choosing and at project B's expense; the not-found branch also answered
 * whether an id existed in another project. That is the same defect
 * /smtp-config/test was hardened against, and these two were left behind.
 *
 * So each route now proves two separate things:
 *
 *   1. the caller is an authenticated member of the project they claimed in
 *      the `tenantid` header (CommonAPI.assertAuthenticatedProjectMember), and
 *   2. the config they named actually belongs to that project
 *      (CommonAPI.assertResourceBelongsToProject).
 *
 * Neither is sufficient alone. (1) without (2) still lets a member of A target
 * B's config while sending their own header. (2) without (1) has no project to
 * compare against.
 *
 * The ORDER of (1) matters as much as its presence, and is pinned below: the
 * member check runs BEFORE the root read, so a request with no project cannot
 * be used to find out which config ids exist.
 *
 * Client side, the Dashboard already sends the tenant header on both calls
 * (Tests/Dashboard/DashboardRequestsNameTheirProject.test.ts pins that), which
 * is what keeps these buttons working now that the routes require a project.
 * Without it they would answer "Project ID is required" - which is exactly what
 * issue #3920 was for the SMTP button.
 *
 * These are module-level Express registrations with no extractable handler, so
 * the router is mocked and the handlers invoked directly, the same way the
 * sibling SmtpConfigTestRoute and PhoneNumberAPI suites do. CommonAPI is NOT
 * mocked - the guards under test are its real ones.
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

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
      requireUserAuthentication: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/ClusterKeyAuthorization", () => {
  return {
    __esModule: true,
    default: { isAuthorizedServiceMiddleware: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ProjectCallSMSConfigService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), toTwilioConfig: jest.fn() },
  };
});

jest.mock("Common/Server/Services/SmsLogService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return { __esModule: true, default: { updateOneById: jest.fn() } };
});

jest.mock("../../FeatureSet/Notification/Services/SmsService", () => {
  return { __esModule: true, default: { sendSms: jest.fn() } };
});

jest.mock("../../FeatureSet/Notification/Services/CallService", () => {
  return { __esModule: true, default: { makeCall: jest.fn() } };
});

import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import CallService from "../../FeatureSet/Notification/Services/CallService";

/*
 * Importing each router module registers its routes on the mock router. Both
 * register a POST "/test", so the two are told apart by registration order -
 * and that assumption is not left implicit: the happy-path case below asserts
 * that the SMS route reaches SmsService and the call route reaches CallService,
 * and nothing else. Reorder these imports and those two tests fail rather than
 * quietly testing one route twice.
 */
import "../../FeatureSet/Notification/API/SMS";
import "../../FeatureSet/Notification/API/Call";

const TO_PHONE: string = "+15555550123";

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type RouteCallResult = {
  thrownToNext: unknown;
  nextCallCount: number;
};

const testRouteHandlers: Array<RouterFunction> = mockRouter.routes
  .filter((route: { method: string; uri: string }): boolean => {
    return route.method === "POST" && route.uri === "/test";
  })
  .map((route: { handlerFunction: RouterFunction }): RouterFunction => {
    return route.handlerFunction;
  });

interface RouteUnderTest {
  name: string;
  handler: RouterFunction;
  // The send the handler performs when it gets all the way through.
  send: jest.Mock;
  // The send the OTHER route performs, which this one must never reach.
  otherSend: jest.Mock;
}

function buildMemberProps(data: {
  projectId: ObjectID;
  userId: ObjectID;
}): DatabaseCommonInteractionProps {
  const memberPermission: UserPermission = {
    _type: "UserPermission",
    permission: Permission.ProjectMember,
    labelIds: [],
  };

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: [memberPermission],
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = tenantPermission;

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userTenantAccessPermission: permissionMap,
  };
}

/*
 * What a signed-in user's request looks like when the browser sends no
 * `tenantid` header: authenticated, a member of their project, and carrying no
 * tenant at all because ProjectMiddleware.getProjectId had nothing to read.
 */
function buildPropsWithoutTenant(data: {
  projectId: ObjectID;
  userId: ObjectID;
}): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = buildMemberProps(data);

  delete (props as { tenantId?: ObjectID | undefined }).tenantId;

  return props;
}

function buildConfig(data: {
  configId: ObjectID;
  projectId: ObjectID;
}): ProjectCallSMSConfig {
  const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  config.id = data.configId;
  config.projectId = data.projectId;
  config.twilioAccountSID = "AC00000000000000000000000000000000";
  config.twilioAuthToken = "a-secret";
  config.twilioPrimaryPhoneNumber = new Phone("+15555550100");

  return config;
}

function buildTwilioConfig(): TwilioConfig {
  return {
    accountSid: "AC00000000000000000000000000000000",
    authToken: "a-secret",
    primaryPhoneNumber: new Phone("+15555550100"),
    secondaryPhoneNumbers: [],
  };
}

async function callRoute(data: {
  handler: RouterFunction;
  body: Dictionary<string>;
}): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: data.body,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await data.handler(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

describe("The Call and SMS test routes are scoped to the caller's project", () => {
  /*
   * Guard the guard. Every case below runs over a handler picked out of the
   * mock router; if the pick ever came back empty or short, the whole suite
   * would pass vacuously.
   */
  test("both POST /test routes registered", () => {
    expect(testRouteHandlers.length).toBe(2);
  });

  const routes: Array<RouteUnderTest> = [
    {
      name: "POST /sms/test",
      handler: testRouteHandlers[0]!,
      send: SmsService.sendSms as unknown as jest.Mock,
      otherSend: CallService.makeCall as unknown as jest.Mock,
    },
    {
      name: "POST /call/test",
      handler: testRouteHandlers[1]!,
      send: CallService.makeCall as unknown as jest.Mock,
      otherSend: SmsService.sendSms as unknown as jest.Mock,
    },
  ];

  describe.each(routes)("$name", (route: RouteUnderTest) => {
    let callerProjectId: ObjectID;
    let otherProjectId: ObjectID;
    let callerUserId: ObjectID;
    let configId: ObjectID;
    let findOneByIdSpy: jest.Mock;
    let toTwilioConfigSpy: jest.Mock;
    let propsSpy: jest.SpiedFunction<
      typeof CommonAPI.getDatabaseCommonInteractionProps
    >;

    beforeAll(() => {
      expect(route.handler).toBeDefined();
    });

    beforeEach(() => {
      jest.clearAllMocks();

      callerProjectId = ObjectID.generate();
      otherProjectId = ObjectID.generate();
      callerUserId = ObjectID.generate();
      configId = ObjectID.generate();

      findOneByIdSpy =
        ProjectCallSMSConfigService.findOneById as unknown as jest.Mock;
      toTwilioConfigSpy =
        ProjectCallSMSConfigService.toTwilioConfig as unknown as jest.Mock;
      propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");

      toTwilioConfigSpy.mockReturnValue(buildTwilioConfig());
      route.send.mockResolvedValue(undefined);
      route.otherSend.mockResolvedValue(undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    function mockProps(props: DatabaseCommonInteractionProps): void {
      propsSpy.mockResolvedValue(props);
    }

    function mockConfigInProject(projectId: ObjectID | null): void {
      if (!projectId) {
        findOneByIdSpy.mockResolvedValue(null);
        return;
      }

      findOneByIdSpy.mockResolvedValue(
        buildConfig({ configId: configId, projectId: projectId }),
      );
    }

    function body(): Dictionary<string> {
      return {
        callSMSConfigId: configId.toString(),
        toPhone: TO_PHONE,
      };
    }

    /*
     * The tenant header is missing - the shape the Dashboard used to send, and
     * the shape any caller who simply does not set it sends.
     */
    describe("when the request carries no project", () => {
      beforeEach(() => {
        mockProps(
          buildPropsWithoutTenant({
            projectId: callerProjectId,
            userId: callerUserId,
          }),
        );
        mockConfigInProject(callerProjectId);
      });

      test('refuses with BadDataException "Project ID is required"', async () => {
        const result: RouteCallResult = await callRoute({
          handler: route.handler,
          body: body(),
        });

        expect(result.nextCallCount).toBe(1);
        expect(result.thrownToNext).toBeInstanceOf(BadDataException);
        expect((result.thrownToNext as Exception).message).toBe(
          "Project ID is required",
        );
      });

      /*
       * The whole point of asserting before the read: an unscoped request must
       * not be able to tell a real config id from a made-up one.
       */
      test("never reads the config and never sends", async () => {
        await callRoute({ handler: route.handler, body: body() });

        expect(findOneByIdSpy).not.toHaveBeenCalled();
        expect(route.send).not.toHaveBeenCalled();
        expect(route.otherSend).not.toHaveBeenCalled();
        expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
      });
    });

    /*
     * No credentials at all is 401, not 400. The browser client refreshes the
     * session and replays the request on a 401 and on nothing else, so an
     * expired session has to look like one.
     */
    test("refuses an unauthenticated caller with NotAuthenticatedException (401)", async () => {
      mockProps({});
      mockConfigInProject(callerProjectId);

      const result: RouteCallResult = await callRoute({
        handler: route.handler,
        body: body(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
      expect((result.thrownToNext as Exception).code).toBe(
        ExceptionCode.NotAuthenticatedException,
      );
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(route.send).not.toHaveBeenCalled();
    });

    /*
     * The IDOR itself. Membership of SOME project is not membership of the
     * config's project.
     */
    test("refuses a member of a different project naming this config", async () => {
      mockProps(
        buildMemberProps({
          projectId: callerProjectId,
          userId: callerUserId,
        }),
      );
      mockConfigInProject(otherProjectId);

      const result: RouteCallResult = await callRoute({
        handler: route.handler,
        body: body(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(route.send).not.toHaveBeenCalled();
      expect(route.otherSend).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });

    /*
     * A caller who claims a project they do not belong to is refused for a
     * different reason than one who claims no project at all, and neither may
     * reach the send.
     */
    test("refuses a caller whose tenant is a project they are not a member of", async () => {
      const props: DatabaseCommonInteractionProps = buildMemberProps({
        projectId: callerProjectId,
        userId: callerUserId,
      });
      props.tenantId = otherProjectId;

      mockProps(props);
      mockConfigInProject(otherProjectId);

      const result: RouteCallResult = await callRoute({
        handler: route.handler,
        body: body(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(route.send).not.toHaveBeenCalled();
    });

    describe("when the caller is a member of the config's own project", () => {
      beforeEach(() => {
        mockProps(
          buildMemberProps({
            projectId: callerProjectId,
            userId: callerUserId,
          }),
        );
        mockConfigInProject(callerProjectId);
      });

      /*
       * This is also what pins which handler is which: the SMS route must
       * reach SmsService and only SmsService, the call route CallService and
       * only CallService. If the registration order this suite relies on ever
       * flipped, this fails instead of silently testing one route twice.
       */
      test("performs its own send and answers success", async () => {
        const result: RouteCallResult = await callRoute({
          handler: route.handler,
          body: body(),
        });

        expect(result.nextCallCount).toBe(0);
        expect(route.send).toHaveBeenCalledTimes(1);
        expect(route.otherSend).not.toHaveBeenCalled();
        expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      });

      /*
       * The send is billed to the config's OWN project, not to the header the
       * caller sent. They are the same project by the time we get here -
       * assertResourceBelongsToProject has just said so - but taking it from
       * the row is what keeps that true if the guard above ever changes.
       */
      test("bills the send to the config's project", async () => {
        await callRoute({ handler: route.handler, body: body() });

        const options: { projectId: ObjectID } =
          route.send.mock.calls[0]!.slice(-1)[0] as { projectId: ObjectID };

        expect(options.projectId.toString()).toBe(callerProjectId.toString());
      });

      /*
       * The ownership check can only work if the read asks for the column it
       * compares, and only needs isRoot because it must see the credentials.
       * Pin the inputs, not just the outcome.
       */
      test("reads the config as root and selects its projectId", async () => {
        await callRoute({ handler: route.handler, body: body() });

        expect(findOneByIdSpy).toHaveBeenCalledTimes(1);

        const readArgs: {
          id: ObjectID;
          select: Dictionary<boolean>;
          props: Dictionary<boolean>;
        } = findOneByIdSpy.mock.calls[0]![0] as {
          id: ObjectID;
          select: Dictionary<boolean>;
          props: Dictionary<boolean>;
        };

        expect(readArgs.id.toString()).toBe(configId.toString());
        expect(readArgs.select["projectId"]).toBe(true);
        expect(readArgs.props["isRoot"]).toBe(true);
      });
    });

    test("refuses when the named config does not exist", async () => {
      mockProps(
        buildMemberProps({
          projectId: callerProjectId,
          userId: callerUserId,
        }),
      );
      mockConfigInProject(null);

      await callRoute({ handler: route.handler, body: body() });

      expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
      expect(
        (Response.sendErrorResponse as unknown as jest.Mock).mock.calls[0]![2],
      ).toBeInstanceOf(BadDataException);
      expect(route.send).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });

    /*
     * The existing Twilio-completeness checks sit AFTER the ownership check and
     * must stay there: answering "twilioAccountSID is required" for another
     * project's config would leak that the config exists and what state it is
     * in. A foreign config is refused as unauthorized whatever it contains.
     */
    test("refuses a foreign config before reporting anything about its contents", async () => {
      mockProps(
        buildMemberProps({
          projectId: callerProjectId,
          userId: callerUserId,
        }),
      );

      const foreign: ProjectCallSMSConfig = buildConfig({
        configId: configId,
        projectId: otherProjectId,
      });
      /*
       * Deleted rather than set to undefined: the model's columns are declared
       * optional, and under exactOptionalPropertyTypes an absent property and
       * one holding undefined are different types. Absent is also the truer
       * model of a half-configured row read out of the database.
       */
      delete foreign.twilioAccountSID;
      delete foreign.twilioAuthToken;
      delete foreign.twilioPrimaryPhoneNumber;
      findOneByIdSpy.mockResolvedValue(foreign);

      const result: RouteCallResult = await callRoute({
        handler: route.handler,
        body: body(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
      expect(route.send).not.toHaveBeenCalled();
    });
  });
});

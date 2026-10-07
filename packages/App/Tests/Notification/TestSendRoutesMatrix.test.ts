import { mockRouter } from "Common/Tests/Server/API/Helpers";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { useInMemoryTable } from "Common/Tests/Server/TestingUtils/InMemoryRepository";
import { TEST_NOTIFICATION_PERMISSION_MESSAGE } from "Common/Server/API/TestSendAccess";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectService from "Common/Server/Services/ProjectService";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import DatabaseCommonInteractionPropsUtil from "Common/Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import Email from "Common/Types/Email";
import EmailServer from "Common/Types/Email/EmailServer";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import Hostname from "Common/Types/API/Hostname";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import Port from "Common/Types/Port";
import Permission, { UserPermission } from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

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
    default: {
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    },
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

jest.mock("../../FeatureSet/Notification/Services/MailService", () => {
  return { __esModule: true, default: { send: jest.fn() } };
});

jest.mock("../../FeatureSet/Notification/Services/SmsService", () => {
  return { __esModule: true, default: { sendSms: jest.fn() } };
});

jest.mock("../../FeatureSet/Notification/Services/CallService", () => {
  return { __esModule: true, default: { makeCall: jest.fn() } };
});

jest.mock("../../FeatureSet/Notification/Services/WhatsAppService", () => {
  return { __esModule: true, default: { sendWhatsApp: jest.fn() } };
});

import MailService from "../../FeatureSet/Notification/Services/MailService";
import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import CallService from "../../FeatureSet/Notification/Services/CallService";
import WhatsAppService from "../../FeatureSet/Notification/Services/WhatsAppService";

/*
 * Every route of the notification API registers on the mocked router as it
 * is imported, and four of them register POST "/test". They are told apart
 * by import order - SMTP, SMS, call, WhatsApp - and the order is not left to
 * trust: each route's "owner sends" case below asserts the send it reaches
 * is its own and no other.
 */
import "../../FeatureSet/Notification/API/SMTPConfig";
import "../../FeatureSet/Notification/API/SMS";
import "../../FeatureSet/Notification/API/Call";
import "../../FeatureSet/Notification/API/WhatsApp";

/*
 * The notification API's Send Test routes, asked the one rule every test
 * route asks (Common/Server/API/TestSendAccess):
 *
 *   POST /smtp-config/test   Send Test Email through a project's SMTP server
 *   POST /sms/test           Send Test SMS through a project's Twilio account
 *   POST /call/test          Send Test Call through a project's Twilio account
 *
 * For each: the project owner sends; a member without the permission (a
 * Viewer, who may read the config), a read-only credential, another
 * project's member and - on OneUptime Cloud - a project below the plan the
 * feature is sold on are refused, and nothing is sent. Another project's
 * config is answered like one that does not exist. The configs are read
 * through the real permission layer over in-memory tables.
 *
 * And POST /whatsapp/test, the instance's own WhatsApp setup, is a master
 * administrator's and bills no project, as the Telegram bot's test is
 * (TelegramWebhookSecurity.test.ts).
 */

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("7e000000-0000-4000-8000-000000000003");
const SMTP_CONFIG_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000004",
);
const OTHER_SMTP_CONFIG_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000005",
);
const TWILIO_CONFIG_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000006",
);
const OTHER_TWILIO_CONFIG_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000007",
);
const MISSING_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000ff",
);

const GROWTH_REFUSAL: string =
  "Please upgrade your plan to Growth to access this feature";

const NOT_THIS_PROJECTS: string =
  "You are not authorized to access this project's data.";

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type Answer = "sent" | Error;

interface Caller {
  allow: Array<Permission>;
  memberOf?: ObjectID | undefined;
  readOnlyCredential?: boolean | undefined;
}

interface TestRoute {
  name: string;
  route: () => { handlerFunction: RouterFunction; middlewares: Array<unknown> };
  body: (recordId?: ObjectID) => JSONObject;
  otherProjectRecordId: ObjectID;
  // The send this route performs.
  send: () => jest.Mock;
  // The sends of the other routes, which this one must never reach.
  otherSends: () => Array<jest.Mock>;
  // Who may add the config, besides the owner and admins: the custom role.
  createPermission: Permission;
  readPermission: Permission;
}

const testRoutes: () => Array<{
  handlerFunction: RouterFunction;
  middlewares: Array<unknown>;
}> = (): Array<{
  handlerFunction: RouterFunction;
  middlewares: Array<unknown>;
}> => {
  return mockRouter.routes.filter(
    (route: { method: string; uri: string }): boolean => {
      return route.method === "POST" && route.uri === "/test";
    },
  ) as unknown as Array<{
    handlerFunction: RouterFunction;
    middlewares: Array<unknown>;
  }>;
};

let currentPlan: PlanType | null = PlanType.Growth;

const userPermission: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    scope: PermissionScope.All,
  };
};

const buildRequest: (body: JSONObject, caller: Caller) => OneUptimeRequest = (
  body: JSONObject,
  caller: Caller,
): OneUptimeRequest => {
  const memberOf: ObjectID = caller.memberOf || PROJECT_ID;

  const req: Record<string, unknown> = {
    params: {},
    body: body,
    headers: {},
    query: {},
    userType: UserType.User,
    userAuthorization: { userId: USER_ID, isMasterAdmin: false },
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [memberOf.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: memberOf,
        permissions: [Permission.ProjectUser, ...caller.allow].map(
          userPermission,
        ),
      },
    },
  };

  if (caller.readOnlyCredential !== undefined) {
    req["mcpOAuth"] = {
      grantId: new ObjectID("7e000000-0000-4000-8000-000000000008"),
      clientId: "test-mcp-client",
      clientName: "Test MCP client",
      isReadOnly: caller.readOnlyCredential,
    };
  }

  return req as unknown as OneUptimeRequest;
};

const sendTest: (
  route: TestRoute,
  caller: Caller,
  recordId?: ObjectID,
) => Promise<Answer> = async (
  route: TestRoute,
  caller: Caller,
  recordId?: ObjectID,
): Promise<Answer> => {
  (Response.sendEmptySuccessResponse as jest.Mock).mockClear();
  (Response.sendErrorResponse as jest.Mock).mockClear();

  let failure: Error | undefined = undefined;

  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  await route
    .route()
    .handlerFunction(
      buildRequest(route.body(recordId), caller) as unknown as ExpressRequest,
      res,
      ((err?: unknown): void => {
        failure = err as Error;
      }) as NextFunction,
    );

  const errorCalls: Array<Array<unknown>> = (
    Response.sendErrorResponse as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  if (!failure && errorCalls.length > 0) {
    failure = errorCalls[0]![2] as Error;
  }

  if (failure) {
    return failure;
  }

  expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);

  return "sent";
};

const OWNER: Caller = { allow: [Permission.ProjectOwner] };
const VIEWER: Caller = { allow: [Permission.Viewer] };

const ROUTES: Array<TestRoute> = [
  {
    name: "POST /smtp-config/test (Send Test Email)",
    route: () => {
      return testRoutes()[0]!;
    },
    body: (recordId?: ObjectID): JSONObject => {
      return {
        smtpConfigId: (recordId || SMTP_CONFIG_ID).toString(),
        toEmail: "someone@example.com",
      };
    },
    otherProjectRecordId: OTHER_SMTP_CONFIG_ID,
    send: (): jest.Mock => {
      return MailService.send as unknown as jest.Mock;
    },
    otherSends: (): Array<jest.Mock> => {
      return [
        SmsService.sendSms as unknown as jest.Mock,
        CallService.makeCall as unknown as jest.Mock,
        WhatsAppService.sendWhatsApp as unknown as jest.Mock,
      ];
    },
    createPermission: Permission.CreateProjectSMTPConfig,
    readPermission: Permission.ReadProjectSMTPConfig,
  },
  {
    name: "POST /sms/test (Send Test SMS)",
    route: () => {
      return testRoutes()[1]!;
    },
    body: (recordId?: ObjectID): JSONObject => {
      return {
        callSMSConfigId: (recordId || TWILIO_CONFIG_ID).toString(),
        toPhone: "+15555550123",
      };
    },
    otherProjectRecordId: OTHER_TWILIO_CONFIG_ID,
    send: (): jest.Mock => {
      return SmsService.sendSms as unknown as jest.Mock;
    },
    otherSends: (): Array<jest.Mock> => {
      return [
        MailService.send as unknown as jest.Mock,
        CallService.makeCall as unknown as jest.Mock,
        WhatsAppService.sendWhatsApp as unknown as jest.Mock,
      ];
    },
    createPermission: Permission.CreateProjectCallSMSConfig,
    readPermission: Permission.ReadProjectCallSMSConfig,
  },
  {
    name: "POST /call/test (Send Test Call)",
    route: () => {
      return testRoutes()[2]!;
    },
    body: (recordId?: ObjectID): JSONObject => {
      return {
        callSMSConfigId: (recordId || TWILIO_CONFIG_ID).toString(),
        toPhone: "+15555550123",
      };
    },
    otherProjectRecordId: OTHER_TWILIO_CONFIG_ID,
    send: (): jest.Mock => {
      return CallService.makeCall as unknown as jest.Mock;
    },
    otherSends: (): Array<jest.Mock> => {
      return [
        MailService.send as unknown as jest.Mock,
        SmsService.sendSms as unknown as jest.Mock,
        WhatsAppService.sendWhatsApp as unknown as jest.Mock,
      ];
    },
    createPermission: Permission.CreateProjectCallSMSConfig,
    readPermission: Permission.ReadProjectCallSMSConfig,
  },
];

const savedPlanEnvironment: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);
});

afterAll(() => {
  for (const key of Object.keys(PLAN_ENVIRONMENT)) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(savedPlanEnvironment)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  setTestBillingEnabled(true);
  currentPlan = PlanType.Growth;

  jest.spyOn(ProjectService, "getCurrentPlan").mockImplementation(
    async (): Promise<{
      plan: PlanType | null;
      isSubscriptionUnpaid: boolean;
    }> => {
      return { plan: currentPlan, isSubscriptionUnpaid: false };
    },
  );

  useInMemoryTable(ProjectSMTPConfigService, [
    {
      _id: SMTP_CONFIG_ID.toString(),
      projectId: PROJECT_ID.toString(),
      name: "Our mail server",
      username: "apikey",
      password: "a-secret",
    },
    {
      _id: OTHER_SMTP_CONFIG_ID.toString(),
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Another project's mail server",
      username: "apikey",
      password: "another-secret",
    },
  ]);

  useInMemoryTable(ProjectCallSMSConfigService, [
    {
      _id: TWILIO_CONFIG_ID.toString(),
      projectId: PROJECT_ID.toString(),
      name: "Our Twilio",
      twilioAccountSID: "AC00000000000000000000000000000000",
      twilioAuthToken: "a-secret",
      twilioPrimaryPhoneNumber: "+15555550100",
    },
    {
      _id: OTHER_TWILIO_CONFIG_ID.toString(),
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Another project's Twilio",
      twilioAccountSID: "AC11111111111111111111111111111111",
      twilioAuthToken: "another-secret",
      twilioPrimaryPhoneNumber: "+15555550199",
    },
  ]);

  jest.spyOn(ProjectSMTPConfigService, "toEmailServer").mockReturnValue({
    id: SMTP_CONFIG_ID,
    host: Hostname.fromString("smtp.example.com"),
    port: new Port(587),
    username: "apikey",
    password: "a-secret",
    fromEmail: new Email("noreply@example.com"),
    fromName: "OneUptime",
    secure: false,
  } as EmailServer);

  jest.spyOn(ProjectCallSMSConfigService, "toTwilioConfig").mockReturnValue({
    accountSid: "AC00000000000000000000000000000000",
    authToken: "a-secret",
    primaryPhoneNumber: new Phone("+15555550100"),
    secondaryPhoneNumbers: [],
  } as TwilioConfig);

  (MailService.send as unknown as jest.Mock).mockResolvedValue(
    undefined as never,
  );
  (SmsService.sendSms as unknown as jest.Mock).mockResolvedValue(
    undefined as never,
  );
  (CallService.makeCall as unknown as jest.Mock).mockResolvedValue(
    undefined as never,
  );
  (WhatsAppService.sendWhatsApp as unknown as jest.Mock).mockResolvedValue(
    undefined as never,
  );
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

test("the four POST /test routes of the notification API are registered", () => {
  expect(testRoutes()).toHaveLength(4);
});

describe.each(ROUTES)("$name", (route: TestRoute) => {
  test("the project owner sends it - through this route's own send, and no other", async () => {
    expect(await sendTest(route, OWNER)).toBe("sent");
    expect(route.send()).toHaveBeenCalledTimes(1);

    for (const otherSend of route.otherSends()) {
      expect(otherSend).not.toHaveBeenCalled();
    }
  });

  test("a Project Admin sends it", async () => {
    expect(await sendTest(route, { allow: [Permission.ProjectAdmin] })).toBe(
      "sent",
    );
  });

  test("a custom role that may add and read the config sends it", async () => {
    expect(
      await sendTest(route, {
        allow: [route.createPermission, route.readPermission],
      }),
    ).toBe("sent");
  });

  test.each([
    ["Viewer", [Permission.Viewer]],
    ["Project Member", [Permission.ProjectMember]],
    ["Settings Admin", [Permission.SettingsAdmin]],
  ])(
    "a %s, who may read the config but not add one, is refused, and nothing is sent",
    async (_role: string, allow: Array<Permission>) => {
      const answer: Answer = await sendTest(route, { allow: allow });

      expect(answer).toBeInstanceOf(NotAuthorizedException);
      expect((answer as Error).message).toBe(
        TEST_NOTIFICATION_PERMISSION_MESSAGE,
      );
      expect(route.send()).not.toHaveBeenCalled();
    },
  );

  test("a credential issued for reading only is refused, and nothing is sent", async () => {
    const answer: Answer = await sendTest(route, {
      allow: [Permission.ProjectOwner],
      readOnlyCredential: true,
    });

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toBe(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
    expect(route.send()).not.toHaveBeenCalled();
  });

  test("another project's member who names this project is refused, and nothing is sent", async () => {
    const answer: Answer = await sendTest(route, {
      allow: [Permission.ProjectOwner],
      memberOf: OTHER_PROJECT_ID,
    });

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toBe(NOT_THIS_PROJECTS);
    expect(route.send()).not.toHaveBeenCalled();
  });

  test("another project's config is answered like one that does not exist, and nothing is sent", async () => {
    const foreign: Answer = await sendTest(
      route,
      OWNER,
      route.otherProjectRecordId,
    );
    const missing: Answer = await sendTest(route, OWNER, MISSING_ID);

    expect(foreign).toBeInstanceOf(NotAuthorizedException);
    expect((foreign as Error).message).toBe(NOT_THIS_PROJECTS);
    expect((missing as Error).message).toBe((foreign as Error).message);
    expect(route.send()).not.toHaveBeenCalled();
  });

  test("below the plan custom configs are sold on, refused with the plan's name, and nothing is sent", async () => {
    currentPlan = PlanType.Free;

    const answer: Answer = await sendTest(route, OWNER);

    expect(answer).toBeInstanceOf(PaymentRequiredException);
    expect((answer as Error).message).toBe(GROWTH_REFUSAL);
    expect(route.send()).not.toHaveBeenCalled();
  });

  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on %s it is sent",
    async (plan: PlanType) => {
      currentPlan = plan;

      expect(await sendTest(route, OWNER)).toBe("sent");
    },
  );

  test("on a self-hosted install (billing off) no plan is asked, and who may send is decided the same way", async () => {
    setTestBillingEnabled(false);
    currentPlan = PlanType.Free;

    expect(await sendTest(route, OWNER)).toBe("sent");
    expect(await sendTest(route, VIEWER)).toBeInstanceOf(
      NotAuthorizedException,
    );
  });

  test("the send is made for the config's own project", async () => {
    await sendTest(route, OWNER);

    const options: { projectId: ObjectID } = route
      .send()
      .mock.calls[0]!.slice(-1)[0] as { projectId: ObjectID };

    expect(options.projectId.toString()).toBe(PROJECT_ID.toString());
  });
});

describe("POST /whatsapp/test: the instance's WhatsApp setup", () => {
  const whatsAppRoute: () => {
    handlerFunction: RouterFunction;
    middlewares: Array<unknown>;
  } = () => {
    return testRoutes()[3]!;
  };

  test("only a master administrator reaches it", () => {
    expect(whatsAppRoute().middlewares).toEqual([
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    ]);
  });

  test("it never bills, charges or logs in a project the request names", async () => {
    const res: ExpressResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    await whatsAppRoute().handlerFunction(
      {
        params: {},
        query: {},
        headers: {},
        body: {
          toPhone: "+15555550123",
          projectId: OTHER_PROJECT_ID.toString(),
        },
      } as unknown as ExpressRequest,
      res,
      jest.fn() as unknown as NextFunction,
    );

    const sendWhatsApp: jest.Mock =
      WhatsAppService.sendWhatsApp as unknown as jest.Mock;

    expect(sendWhatsApp).toHaveBeenCalledTimes(1);

    const options: { projectId?: ObjectID | undefined; isSensitive: boolean } =
      sendWhatsApp.mock.calls[0]![1] as {
        projectId?: ObjectID | undefined;
        isSensitive: boolean;
      };

    expect(options.projectId).toBeUndefined();
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });
});

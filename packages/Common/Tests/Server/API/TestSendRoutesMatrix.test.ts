import MicrosoftTeamsAPI from "../../../Server/API/MicrosoftTeamsAPI";
import SlackAPI from "../../../Server/API/SlackAPI";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import { TEST_NOTIFICATION_PERMISSION_MESSAGE } from "../../../Server/API/TestSendAccess";
import WorkspaceNotificationRuleAPI from "../../../Server/API/WorkspaceNotificationRuleAPI";
import WorkspaceNotificationSummaryAPI from "../../../Server/API/WorkspaceNotificationSummaryAPI";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceNotificationSummaryService from "../../../Server/Services/WorkspaceNotificationSummaryService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { mockRouter } from "./Helpers";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import {
  rowMatchesWhere,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { getJestSpyOn } from "../../Spy";
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

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * Every Send Test the Common API serves, through its real route, asked the
 * one rule (TestSendAccess):
 *
 *   GET  /workspace-notification-rule/test/:id     a rule's Test Rule
 *   POST /workspace-notification-summary/test/:id  a summary's Send Test Now
 *   POST /slack/channels/test                      a Slack channel's Send Test
 *   POST /microsoft-teams/channels/test            a Teams channel's Send Test
 *   POST /microsoft-teams/chats/test               a Teams chat's Send Test
 *   POST /status-page/test-email-report            a status page's Send Test Report
 *
 * For each: the project owner sends; a member without the permission, a
 * read-only credential, another project's member and - on OneUptime Cloud -
 * a project below the plan the feature is sold on are refused, and nothing
 * is sent. With billing off no plan is asked. A route that tests a saved
 * record answers another project's record like one that does not exist.
 *
 * The rule's own suite is TestSendAccess.test.ts; the App's routes (SMTP,
 * SMS, call, WhatsApp) are App/Tests/Notification/TestSendRoutesMatrix.
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
  "7d000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("7d000000-0000-4000-8000-000000000003");
const RULE_ID: ObjectID = new ObjectID("7d000000-0000-4000-8000-000000000004");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000005",
);
const SUMMARY_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000006",
);
const OTHER_SUMMARY_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000007",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000008",
);
const OTHER_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000009",
);

const GROWTH_REFUSAL: string =
  "Please upgrade your plan to Growth to access this feature";

const NOT_THIS_PROJECTS: string =
  "You are not authorized to access this project's data.";

const REPORT_REFUSAL: string =
  "You do not have permission to send this status page's report.";

type Answer = "sent" | Error;

interface Caller {
  allow: Array<Permission>;
  memberOf?: ObjectID | undefined;
  readOnlyCredential?: boolean | undefined;
}

interface TestRoute {
  name: string;
  method: "GET" | "POST";
  uri: string;
  // The request this route is sent, for its own project's record.
  params: (recordId?: ObjectID) => Record<string, string>;
  body: (recordId?: ObjectID) => JSONObject;
  // Another project's record, for routes that test a saved one.
  otherProjectRecordId?: ObjectID | undefined;
  // What a member without the permission is told.
  refusal: string;
  // Whether the route answers through next() (else Response.sendErrorResponse).
  answersThroughNext: boolean;
  // The send this route performs, stubbed: how many times it ran.
  sends: () => number;
}

let currentPlan: PlanType | null = PlanType.Growth;
let testRule: ReturnType<typeof getJestSpyOn>;
let testSummary: ReturnType<typeof getJestSpyOn>;
let sendToDestination: ReturnType<typeof getJestSpyOn>;
let sendEmailReport: ReturnType<typeof getJestSpyOn>;

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

const buildRequest: (
  route: TestRoute,
  caller: Caller,
  recordId?: ObjectID,
) => OneUptimeRequest = (
  route: TestRoute,
  caller: Caller,
  recordId?: ObjectID,
): OneUptimeRequest => {
  const memberOf: ObjectID = caller.memberOf || PROJECT_ID;

  const req: Record<string, unknown> = {
    params: route.params(recordId),
    body: route.body(recordId),
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
      grantId: new ObjectID("7d000000-0000-4000-8000-00000000000a"),
      clientId: "test-mcp-client",
      clientName: "Test MCP client",
      isReadOnly: caller.readOnlyCredential,
    };
  }

  return req as unknown as OneUptimeRequest;
};

const send: (
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

  await mockRouter
    .match(route.method, route.uri)
    .handlerFunction(
      buildRequest(route, caller, recordId),
      res,
      (err?: unknown): void => {
        failure = err as Error;
      },
    );

  if (!route.answersThroughNext) {
    const errorCalls: Array<Array<unknown>> = (
      Response.sendErrorResponse as jest.Mock
    ).mock.calls as Array<Array<unknown>>;

    if (errorCalls.length > 0) {
      failure = errorCalls[0]![2] as Error;
    }
  }

  if (failure) {
    return failure;
  }

  expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);

  return "sent";
};

const OWNER: Caller = { allow: [Permission.ProjectOwner] };
const VIEWER: Caller = { allow: [Permission.Viewer] };
const READ_ONLY_OWNER: Caller = {
  allow: [Permission.ProjectOwner],
  readOnlyCredential: true,
};
const OTHER_PROJECTS_OWNER: Caller = {
  allow: [Permission.ProjectOwner],
  memberOf: OTHER_PROJECT_ID,
};

const ROUTES: Array<TestRoute> = [
  {
    name: "Test Rule",
    method: "GET",
    uri: "/workspace-notification-rule/test/:workspaceNotifcationRuleId",
    params: (recordId?: ObjectID): Record<string, string> => {
      return { workspaceNotifcationRuleId: (recordId || RULE_ID).toString() };
    },
    body: (): JSONObject => {
      return {};
    },
    otherProjectRecordId: OTHER_RULE_ID,
    refusal: TEST_NOTIFICATION_PERMISSION_MESSAGE,
    answersThroughNext: true,
    sends: (): number => {
      return testRule.mock.calls.length;
    },
  },
  {
    name: "a summary's Send Test Now",
    method: "POST",
    uri: "/workspace-notification-summary/test/:workspaceNotificationSummaryId",
    params: (recordId?: ObjectID): Record<string, string> => {
      return {
        workspaceNotificationSummaryId: (recordId || SUMMARY_ID).toString(),
      };
    },
    body: (): JSONObject => {
      return {};
    },
    otherProjectRecordId: OTHER_SUMMARY_ID,
    refusal: TEST_NOTIFICATION_PERMISSION_MESSAGE,
    answersThroughNext: true,
    sends: (): number => {
      return testSummary.mock.calls.length;
    },
  },
  {
    name: "a Slack channel's Send Test",
    method: "POST",
    uri: "/slack/channels/test",
    params: (): Record<string, string> => {
      return {};
    },
    body: (): JSONObject => {
      return { channelId: "C0123456789" };
    },
    refusal: TEST_NOTIFICATION_PERMISSION_MESSAGE,
    answersThroughNext: false,
    sends: (): number => {
      return sendToDestination.mock.calls.length;
    },
  },
  {
    name: "a Microsoft Teams channel's Send Test",
    method: "POST",
    uri: "/microsoft-teams/channels/test",
    params: (): Record<string, string> => {
      return {};
    },
    body: (): JSONObject => {
      return {
        teamId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
        channelId: "19:0123456789abcdef0123456789abcdef@thread.tacv2",
      };
    },
    refusal: TEST_NOTIFICATION_PERMISSION_MESSAGE,
    answersThroughNext: false,
    sends: (): number => {
      return sendToDestination.mock.calls.length;
    },
  },
  {
    name: "a Microsoft Teams chat's Send Test",
    method: "POST",
    uri: "/microsoft-teams/chats/test",
    params: (): Record<string, string> => {
      return {};
    },
    body: (): JSONObject => {
      return { chatId: "19:3a9c1f0e5b7d4e2f8a6b0c1d2e3f4a5b@thread.v2" };
    },
    refusal: TEST_NOTIFICATION_PERMISSION_MESSAGE,
    answersThroughNext: false,
    sends: (): number => {
      return sendToDestination.mock.calls.length;
    },
  },
  {
    name: "a status page's Send Test Report",
    method: "POST",
    uri: "/status-page/test-email-report",
    params: (): Record<string, string> => {
      return {};
    },
    body: (recordId?: ObjectID): JSONObject => {
      return {
        statusPageId: (recordId || STATUS_PAGE_ID).toString(),
        email: "someone@example.com",
      };
    },
    otherProjectRecordId: OTHER_STATUS_PAGE_ID,
    refusal: REPORT_REFUSAL,
    answersThroughNext: true,
    sends: (): number => {
      return sendEmailReport.mock.calls.length;
    },
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

  mockRouter.routes.length = 0;
  new WorkspaceNotificationRuleAPI();
  new WorkspaceNotificationSummaryAPI();
  new SlackAPI().getRouter();
  new MicrosoftTeamsAPI().getRouter();
  new StatusPageAPI();
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
  setTestBillingEnabled(true);
  currentPlan = PlanType.Growth;

  getJestSpyOn(ProjectService, "getCurrentPlan").mockImplementation(
    async (): Promise<{
      plan: PlanType | null;
      isSubscriptionUnpaid: boolean;
    }> => {
      return { plan: currentPlan, isSubscriptionUnpaid: false };
    },
  );
  getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(
    undefined as never,
  );

  useInMemoryTable(WorkspaceNotificationRuleService, [
    {
      _id: RULE_ID.toString(),
      projectId: PROJECT_ID.toString(),
      name: "Page the database team",
      workspaceType: WorkspaceType.Slack,
      eventType: NotificationRuleEventType.Incident,
    },
    {
      _id: OTHER_RULE_ID.toString(),
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Another project's rule",
      workspaceType: WorkspaceType.Slack,
      eventType: NotificationRuleEventType.Incident,
    },
  ]);

  useInMemoryTable(WorkspaceNotificationSummaryService, [
    {
      _id: SUMMARY_ID.toString(),
      projectId: PROJECT_ID.toString(),
      name: "Weekly incidents",
      workspaceType: WorkspaceType.Slack,
    },
    {
      _id: OTHER_SUMMARY_ID.toString(),
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Another project's summary",
      workspaceType: WorkspaceType.Slack,
    },
  ]);

  // Status pages: one in each project, read the way the route reads them.
  const pages: Record<string, ObjectID> = {
    [STATUS_PAGE_ID.toString()]: PROJECT_ID,
    [OTHER_STATUS_PAGE_ID.toString()]: OTHER_PROJECT_ID,
  };

  const pageFor: (id: string) => StatusPage | null = (
    id: string,
  ): StatusPage | null => {
    const projectId: ObjectID | undefined = pages[id.toLowerCase()];

    if (!projectId) {
      return null;
    }

    const page: StatusPage = new StatusPage();
    page.id = new ObjectID(id);
    page.projectId = projectId;
    page.labels = [];
    return page;
  };

  getJestSpyOn(StatusPageService, "findOneById").mockImplementation(
    async (findBy: unknown): Promise<StatusPage | null> => {
      return pageFor((findBy as { id: ObjectID }).id.toString());
    },
  );

  getJestSpyOn(StatusPageService, "findOneBy").mockImplementation(
    async (findBy: unknown): Promise<StatusPage | null> => {
      const query: unknown = (findBy as { query: unknown }).query;

      for (const [id, projectId] of Object.entries(pages)) {
        if (
          rowMatchesWhere({ _id: id, projectId: projectId.toString() }, query)
        ) {
          return pageFor(id);
        }
      }

      return null;
    },
  );

  testRule = getJestSpyOn(
    WorkspaceNotificationRuleService,
    "testRule",
  ).mockResolvedValue(undefined as never);
  testSummary = getJestSpyOn(
    WorkspaceNotificationSummaryService,
    "testSummary",
  ).mockResolvedValue(undefined as never);
  sendToDestination = getJestSpyOn(
    WorkspaceNotificationRuleService,
    "sendTestNotificationToDestination",
  ).mockResolvedValue({} as never);
  sendEmailReport = getJestSpyOn(
    StatusPageService,
    "sendEmailReport",
  ).mockResolvedValue(undefined as never);
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe.each(ROUTES)("$name", (route: TestRoute) => {
  test("the project owner sends it", async () => {
    expect(await send(route, OWNER)).toBe("sent");
    expect(route.sends()).toBe(1);
  });

  test("a member without the permission is refused, and nothing is sent", async () => {
    const answer: Answer = await send(route, VIEWER);

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toBe(route.refusal);
    expect(route.sends()).toBe(0);
  });

  test("a credential issued for reading only is refused, and nothing is sent", async () => {
    const answer: Answer = await send(route, READ_ONLY_OWNER);

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toBe(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
    expect(route.sends()).toBe(0);
  });

  test("the same owner through a credential that may make changes sends it", async () => {
    expect(
      await send(route, {
        allow: [Permission.ProjectOwner],
        readOnlyCredential: false,
      }),
    ).toBe("sent");
  });

  test("another project's member who names this project is refused, and nothing is sent", async () => {
    const answer: Answer = await send(route, OTHER_PROJECTS_OWNER);

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toBe(NOT_THIS_PROJECTS);
    expect(route.sends()).toBe(0);
  });

  test("below the plan the feature is sold on, refused with the plan's name, and nothing is sent", async () => {
    currentPlan = PlanType.Free;

    const answer: Answer = await send(route, OWNER);

    expect(answer).toBeInstanceOf(PaymentRequiredException);
    expect((answer as Error).message).toBe(GROWTH_REFUSAL);
    expect(route.sends()).toBe(0);
  });

  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on %s it is sent",
    async (plan: PlanType) => {
      currentPlan = plan;

      expect(await send(route, OWNER)).toBe("sent");
    },
  );

  test("on a self-hosted install (billing off) no plan is asked", async () => {
    setTestBillingEnabled(false);
    currentPlan = PlanType.Free;

    expect(await send(route, OWNER)).toBe("sent");
    expect(await send(route, VIEWER)).toBeInstanceOf(NotAuthorizedException);
  });

  if (route.otherProjectRecordId) {
    test("another project's record is answered like one that does not exist, and nothing is sent", async () => {
      const foreign: Answer = await send(
        route,
        OWNER,
        route.otherProjectRecordId,
      );
      const missing: Answer = await send(
        route,
        OWNER,
        new ObjectID("7d000000-0000-4000-8000-0000000000ff"),
      );

      expect(foreign).toBeInstanceOf(NotAuthorizedException);
      expect((foreign as Error).message).toBe(NOT_THIS_PROJECTS);
      expect((missing as Error).message).toBe((foreign as Error).message);
      expect(route.sends()).toBe(0);
    });
  }
});

describe("what is sent, once the rule lets it through", () => {
  test("Test Rule sends for the rule named, from the caller's project, as the caller", async () => {
    await send(ROUTES[0]!, OWNER);

    const args: {
      ruleId: ObjectID;
      projectId: ObjectID;
      testByUserId: ObjectID;
    } = testRule.mock.calls[0]![0] as {
      ruleId: ObjectID;
      projectId: ObjectID;
      testByUserId: ObjectID;
    };

    expect(args.ruleId.toString()).toBe(RULE_ID.toString());
    expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(args.testByUserId.toString()).toBe(USER_ID.toString());
  });

  test("Send Test Now sends the summary named, from the caller's project (never the request's say-so)", async () => {
    await send(ROUTES[1]!, OWNER);

    const args: {
      summaryId: ObjectID;
      projectId: ObjectID;
      testByUserId: ObjectID;
    } = testSummary.mock.calls[0]![0] as {
      summaryId: ObjectID;
      projectId: ObjectID;
      testByUserId: ObjectID;
    };

    expect(args.summaryId.toString()).toBe(SUMMARY_ID.toString());
    expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(args.testByUserId.toString()).toBe(USER_ID.toString());
  });

  test("a channel's Send Test posts from the caller's project, as the caller", async () => {
    await send(ROUTES[2]!, OWNER);

    const args: { projectId: ObjectID; testByUserId: ObjectID } =
      sendToDestination.mock.calls[0]![0] as {
        projectId: ObjectID;
        testByUserId: ObjectID;
      };

    expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(args.testByUserId.toString()).toBe(USER_ID.toString());
  });

  test("Send Test Report sends the page named to the address given", async () => {
    await send(ROUTES[5]!, OWNER);

    const args: { statusPageId: ObjectID; email: { toString: () => string } } =
      sendEmailReport.mock.calls[0]![0] as {
        statusPageId: ObjectID;
        email: { toString: () => string };
      };

    expect(args.statusPageId.toString()).toBe(STATUS_PAGE_ID.toString());
    expect(args.email.toString()).toBe("someone@example.com");
  });
});

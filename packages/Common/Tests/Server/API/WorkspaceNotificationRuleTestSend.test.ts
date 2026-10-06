import WorkspaceNotificationRuleAPI, {
  TEST_NOTIFICATION_PERMISSION_MESSAGE,
} from "../../../Server/API/WorkspaceNotificationRuleAPI";
import ProjectService from "../../../Server/Services/ProjectService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "../../../Server/Types/Database/Permissions/BillingPermission";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { mockRouter } from "./Helpers";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import {
  InMemoryTable,
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
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * "Test Rule" on a Slack or Microsoft Teams notification rule posts a test
 * message into the rule's channels - and, for a rule that makes a channel per
 * event, creates one and invites the rule's people. It runs here through the
 * real route, the real plan check and the real read of the rule, over an
 * in-memory table; only the send itself (testRule) and the plan lookup are
 * stubbed. It asks, in this order:
 *
 *  - the plan: posting through a rule is what Growth sells, the plan adding a
 *    rule needs. Below Growth a project may still read the rules it has, to
 *    switch them off or delete them, so the read does not stand in for the
 *    plan;
 *  - permission to post into the workspace: whoever could create a rule, team
 *    blocks included, and never through a credential issued for reading
 *    only - what a channel's own Send Test asks;
 *  - a rule the caller may read, in their own project, read with their own
 *    permissions (never as root).
 *
 * With billing off - every self-hosted install - no plan is asked, and the
 * permissions apply all the same.
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
  "7a000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("7a000000-0000-4000-8000-000000000003");
const RULE_ID: ObjectID = new ObjectID("7a000000-0000-4000-8000-000000000004");
const OTHER_PROJECT_RULE_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000005",
);
const MISSING_RULE_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000006",
);

const TEST_RULE_ROUTE: string =
  "/workspace-notification-rule/test/:workspaceNotifcationRuleId";

const GROWTH_REFUSAL: string =
  "Please upgrade your plan to Growth to access this feature";

const NOT_THIS_PROJECTS_RULE: string =
  "You are not authorized to access this project's data.";

const PLANS_FROM_GROWTH: ReadonlyArray<PlanType> = [
  PlanType.Growth,
  PlanType.Scale,
  PlanType.Enterprise,
];

interface Role {
  role: string;
  allow: Array<Permission>;
  block?: Array<Permission> | undefined;
}

// Everyone here may read the project's notification rules.
const ROLES_THAT_MAY_SEND: ReadonlyArray<Role> = [
  { role: "Project Owner", allow: [Permission.ProjectOwner] },
  { role: "Project Admin", allow: [Permission.ProjectAdmin] },
  { role: "Project Member", allow: [Permission.ProjectMember] },
  { role: "Settings Admin", allow: [Permission.SettingsAdmin] },
  { role: "Settings Member", allow: [Permission.SettingsMember] },
  {
    role: "Create and Read Workspace Notification Rule",
    allow: [
      Permission.CreateWorkspaceNotificationRule,
      Permission.ReadWorkspaceNotificationRule,
    ],
  },
];

// Everyone here may read the rules, and none may create one.
const ROLES_THAT_MAY_ONLY_READ: ReadonlyArray<Role> = [
  { role: "Viewer", allow: [Permission.Viewer] },
  { role: "Settings Viewer", allow: [Permission.SettingsViewer] },
  {
    role: "Read Workspace Notification Rule only",
    allow: [Permission.ReadWorkspaceNotificationRule],
  },
];

let currentPlan: PlanType = PlanType.Growth;
let isSubscriptionUnpaid: boolean = false;
let rules: InMemoryTable;
let testRule: ReturnType<typeof getJestSpyOn>;
let readRule: ReturnType<typeof getJestSpyOn>;

const userPermission: (
  permission: Permission,
  isBlockPermission: boolean,
) => UserPermission = (
  permission: Permission,
  isBlockPermission: boolean,
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: isBlockPermission,
    scope: PermissionScope.All,
  };
};

// A signed-in member of PROJECT_ID, as the API's auth middleware leaves them.
const requestFrom: (
  role: Role,
  ruleId?: ObjectID,
  headers?: Record<string, string>,
) => OneUptimeRequest = (
  role: Role,
  ruleId?: ObjectID,
  headers?: Record<string, string>,
): OneUptimeRequest => {
  return {
    params: { workspaceNotifcationRuleId: (ruleId || RULE_ID).toString() },
    body: {},
    headers: headers || {},
    query: {},
    userType: UserType.User,
    userAuthorization: { userId: USER_ID },
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          ...[Permission.ProjectUser, ...role.allow].map(
            (permission: Permission): UserPermission => {
              return userPermission(permission, false);
            },
          ),
          ...(role.block || []).map(
            (permission: Permission): UserPermission => {
              return userPermission(permission, true);
            },
          ),
        ],
      },
    },
  } as unknown as OneUptimeRequest;
};

const response: () => ExpressResponse = (): ExpressResponse => {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
};

// What the route answers: "sent", or the refusal it hands on.
const sendTest: (req: OneUptimeRequest) => Promise<"sent" | Error> = async (
  req: OneUptimeRequest,
): Promise<"sent" | Error> => {
  let failure: Error | undefined = undefined;

  await mockRouter
    .match("GET", TEST_RULE_ROUTE)
    .handlerFunction(req, response(), (err?: unknown): void => {
      failure = err as Error;
    });

  if (failure) {
    return failure;
  }

  expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);

  return "sent";
};

const PROJECT_MEMBER: Role = ROLES_THAT_MAY_SEND.find((role: Role) => {
  return role.role === "Project Member";
}) as Role;

const VIEWER: Role = ROLES_THAT_MAY_ONLY_READ.find((role: Role) => {
  return role.role === "Viewer";
}) as Role;

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
  isSubscriptionUnpaid = false;

  (Response.sendEmptySuccessResponse as jest.Mock).mockClear();

  getJestSpyOn(ProjectService, "getCurrentPlan").mockImplementation(
    async (): Promise<{
      plan: PlanType | null;
      isSubscriptionUnpaid: boolean;
    }> => {
      return { plan: currentPlan, isSubscriptionUnpaid: isSubscriptionUnpaid };
    },
  );

  // One rule in the caller's project, and one in another project.
  rules = useInMemoryTable(WorkspaceNotificationRuleService, [
    {
      _id: RULE_ID.toString(),
      projectId: PROJECT_ID.toString(),
      name: "Page the database team",
      workspaceType: WorkspaceType.Slack,
      eventType: NotificationRuleEventType.Incident,
    },
    {
      _id: OTHER_PROJECT_RULE_ID.toString(),
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Another project's rule",
      workspaceType: WorkspaceType.Slack,
      eventType: NotificationRuleEventType.Incident,
    },
  ]);

  readRule = getJestSpyOn(WorkspaceNotificationRuleService, "findOneById");

  testRule = getJestSpyOn(
    WorkspaceNotificationRuleService,
    "testRule",
  ).mockResolvedValue(undefined as never);
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("Test Rule on OneUptime Cloud (billing on): the Growth plan", () => {
  test("on Free it is refused with the plan's name, before the rule is read or anything is sent", async () => {
    currentPlan = PlanType.Free;

    const answer: "sent" | Error = await sendTest(requestFrom(PROJECT_MEMBER));

    expect(answer).toBeInstanceOf(PaymentRequiredException);
    expect((answer as Error).message).toBe(GROWTH_REFUSAL);
    expect(rules.repository.find).not.toHaveBeenCalled();
    expect(testRule).not.toHaveBeenCalled();
  });

  test("on Free the rule itself can still be read - to switch it off or delete it - but that is no test send", async () => {
    currentPlan = PlanType.Free;

    // The read the leftover list makes, with the same member's permissions.
    const rule: WorkspaceNotificationRule | null =
      await WorkspaceNotificationRuleService.findOneById({
        id: RULE_ID,
        select: { name: true },
        props: {
          userId: USER_ID,
          tenantId: PROJECT_ID,
          currentPlan: PlanType.Free,
          isSubscriptionUnpaid: false,
          userTenantAccessPermission: {
            [PROJECT_ID.toString()]: {
              _type: "UserTenantAccessPermission",
              projectId: PROJECT_ID,
              permissions: [userPermission(Permission.ProjectMember, false)],
            },
          },
        },
      });

    expect(rule?.name).toBe("Page the database team");

    expect(await sendTest(requestFrom(PROJECT_MEMBER))).toBeInstanceOf(
      PaymentRequiredException,
    );
    expect(testRule).not.toHaveBeenCalled();
  });

  test.each(PLANS_FROM_GROWTH)(
    "on %s the test is sent, for the rule named, from the caller's project, as the caller",
    async (plan: PlanType) => {
      currentPlan = plan;

      expect(await sendTest(requestFrom(PROJECT_MEMBER))).toBe("sent");
      expect(testRule).toHaveBeenCalledTimes(1);

      const sent: {
        ruleId: ObjectID;
        projectId: ObjectID;
        testByUserId: ObjectID;
      } = testRule.mock.calls[0]![0] as {
        ruleId: ObjectID;
        projectId: ObjectID;
        testByUserId: ObjectID;
      };

      expect(sent.ruleId.toString()).toBe(RULE_ID.toString());
      expect(sent.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(sent.testByUserId.toString()).toBe(USER_ID.toString());
    },
  );

  test("an unpaid subscription is refused, as every paid feature is", async () => {
    isSubscriptionUnpaid = true;

    const answer: "sent" | Error = await sendTest(requestFrom(PROJECT_MEMBER));

    expect(answer).toBeInstanceOf(PaymentRequiredException);
    expect((answer as Error).message).toContain("unpaid");
    expect(testRule).not.toHaveBeenCalled();
  });

  test("below Growth, a role that may not post is told about the plan first: nothing about the rule is said", async () => {
    currentPlan = PlanType.Free;

    const answer: "sent" | Error = await sendTest(requestFrom(VIEWER));

    expect((answer as Error).message).toBe(GROWTH_REFUSAL);
    expect(rules.repository.find).not.toHaveBeenCalled();
  });

  test("the plan asked is the one adding a rule needs, without what a project below it may still do with its rules", async () => {
    const planCheck: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      BillingPermissions,
      "checkFeatureIsOnPlan",
    );

    expect(await sendTest(requestFrom(PROJECT_MEMBER))).toBe("sent");

    expect(planCheck).toHaveBeenCalledTimes(1);
    expect(planCheck.mock.calls[0]![0]).toBe(WorkspaceNotificationRule);
    expect(planCheck.mock.calls[0]![2]).toBe(DatabaseRequestType.Create);
    expect(new WorkspaceNotificationRule().createBillingPlan).toBe(
      PlanType.Growth,
    );
  });
});

describe("Test Rule on a self-hosted install (billing off)", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
  });

  test.each([PlanType.Free, PlanType.Growth])(
    "no plan is asked - the test is sent even when the props carry %s",
    async (plan: PlanType) => {
      currentPlan = plan;

      expect(await sendTest(requestFrom(PROJECT_MEMBER))).toBe("sent");
      expect(testRule).toHaveBeenCalledTimes(1);
    },
  );

  test("who may send is decided the same way: a Viewer is refused", async () => {
    const answer: "sent" | Error = await sendTest(requestFrom(VIEWER));

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toBe(
      TEST_NOTIFICATION_PERMISSION_MESSAGE,
    );
    expect(testRule).not.toHaveBeenCalled();
  });
});

describe("who may send a test: whoever could create a rule", () => {
  test.each(ROLES_THAT_MAY_SEND)(
    "$role: the test is sent",
    async (role: Role) => {
      expect(await sendTest(requestFrom(role))).toBe("sent");
      expect(testRule).toHaveBeenCalledTimes(1);
    },
  );

  test.each(ROLES_THAT_MAY_ONLY_READ)(
    "$role: refused with the Send Test message, before the rule is read or anything is sent",
    async (role: Role) => {
      const answer: "sent" | Error = await sendTest(requestFrom(role));

      expect(answer).toBeInstanceOf(NotAuthorizedException);
      expect((answer as Error).message).toBe(
        TEST_NOTIFICATION_PERMISSION_MESSAGE,
      );
      expect(rules.repository.find).not.toHaveBeenCalled();
      expect(testRule).not.toHaveBeenCalled();
    },
  );

  test("a team that blocks creating rules: refused, naming the block, before the rule is read or anything is sent", async () => {
    const answer: "sent" | Error = await sendTest(
      requestFrom({
        role: "Project Member, with Create Workspace Notification Rule blocked",
        allow: [Permission.ProjectMember],
        block: [Permission.CreateWorkspaceNotificationRule],
      }),
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toContain(
      "CreateWorkspaceNotificationRule is in your team's permission block list",
    );
    expect(rules.repository.find).not.toHaveBeenCalled();
    expect(testRule).not.toHaveBeenCalled();
  });

  test("the refusal is the one a channel's own Send Test gives", () => {
    expect(TEST_NOTIFICATION_PERMISSION_MESSAGE).toBe(
      "You do not have permission to send test notifications in this project.",
    );
  });

  test("Create Workspace Notification Rule without the rule's read: refused by the read, nothing sent", async () => {
    const answer: "sent" | Error = await sendTest(
      requestFrom({
        role: "Create Workspace Notification Rule only",
        allow: [Permission.CreateWorkspaceNotificationRule],
      }),
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toContain(
      "You do not have permissions to read Workspace Notification Rule",
    );
    expect(testRule).not.toHaveBeenCalled();
  });

  test("a team that blocks reading the rules: refused, nothing sent", async () => {
    const answer: "sent" | Error = await sendTest(
      requestFrom({
        role: "Project Member, with Read Workspace Notification Rule blocked",
        allow: [Permission.ProjectMember],
        block: [Permission.ReadWorkspaceNotificationRule],
      }),
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect(testRule).not.toHaveBeenCalled();
  });
});

describe("the credential: one that may make changes", () => {
  // The same member, through an MCP client they connected with OAuth.
  const throughMcpClient: (isReadOnly: boolean) => OneUptimeRequest = (
    isReadOnly: boolean,
  ): OneUptimeRequest => {
    const req: OneUptimeRequest = requestFrom(PROJECT_MEMBER);

    req.mcpOAuth = {
      grantId: new ObjectID("7a000000-0000-4000-8000-000000000007"),
      clientId: "test-mcp-client",
      clientName: "Test MCP client",
      isReadOnly: isReadOnly,
    };

    return req;
  };

  test("an MCP client connected read-only is refused, whatever its member may do, before the rule is read or anything is sent", async () => {
    const answer: "sent" | Error = await sendTest(throughMcpClient(true));

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toBe(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
    expect(rules.repository.find).not.toHaveBeenCalled();
    expect(testRule).not.toHaveBeenCalled();
  });

  test("the same member through an MCP client allowed to make changes: the test is sent", async () => {
    expect(await sendTest(throughMcpClient(false))).toBe("sent");
    expect(testRule).toHaveBeenCalledTimes(1);
  });
});

describe("which rule: one the caller may read, in their own project", () => {
  test("the rule is read with the caller's own permissions, for their project alone - never as root", async () => {
    expect(await sendTest(requestFrom(PROJECT_MEMBER))).toBe("sent");

    expect(readRule).toHaveBeenCalledTimes(1);

    const props: DatabaseCommonInteractionProps = (
      readRule.mock.calls[0]![0] as { props: DatabaseCommonInteractionProps }
    ).props;

    expect(props.isRoot).toBeFalsy();
    expect(props.userId?.toString()).toBe(USER_ID.toString());
    expect(props.tenantId?.toString()).toBe(PROJECT_ID.toString());
    expect(props.isMultiTenantRequest).toBe(false);
  });

  test("a request that asks for a multi-tenant read is still read for the one project", async () => {
    const answer: "sent" | Error = await sendTest(
      requestFrom(PROJECT_MEMBER, OTHER_PROJECT_RULE_ID, {
        "is-multi-tenant-query": "true",
      }),
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toBe(NOT_THIS_PROJECTS_RULE);

    const props: DatabaseCommonInteractionProps = (
      readRule.mock.calls[0]![0] as { props: DatabaseCommonInteractionProps }
    ).props;

    expect(props.isMultiTenantRequest).toBe(false);
    expect(testRule).not.toHaveBeenCalled();
  });

  test("another project's rule answers like one that does not exist: refused, nothing sent", async () => {
    const foreign: "sent" | Error = await sendTest(
      requestFrom(PROJECT_MEMBER, OTHER_PROJECT_RULE_ID),
    );
    const missing: "sent" | Error = await sendTest(
      requestFrom(PROJECT_MEMBER, MISSING_RULE_ID),
    );

    expect(foreign).toBeInstanceOf(NotAuthorizedException);
    expect(missing).toBeInstanceOf(NotAuthorizedException);
    expect((foreign as Error).message).toBe(NOT_THIS_PROJECTS_RULE);
    expect((missing as Error).message).toBe((foreign as Error).message);
    expect(testRule).not.toHaveBeenCalled();
  });

  test("the read itself is scoped to the caller's project", async () => {
    await sendTest(requestFrom(PROJECT_MEMBER, OTHER_PROJECT_RULE_ID));

    expect(rules.repository.find).toHaveBeenCalled();

    const where: unknown = (
      rules.repository.find.mock.calls[0]![0] as {
        where: unknown;
      }
    ).where;

    // The id the caller named, but only in their own project.
    expect(
      rowMatchesWhere(
        {
          _id: OTHER_PROJECT_RULE_ID.toString(),
          projectId: OTHER_PROJECT_ID.toString(),
        },
        where,
      ),
    ).toBe(false);
    expect(
      rowMatchesWhere(
        {
          _id: OTHER_PROJECT_RULE_ID.toString(),
          projectId: PROJECT_ID.toString(),
        },
        where,
      ),
    ).toBe(true);
  });
});

import CommonAPI from "../../../Server/API/CommonAPI";
import CallerPlan from "../../../Server/Utils/Billing/CallerPlan";
import TestSendAccess, {
  TEST_NOTIFICATION_PERMISSION_MESSAGE,
  TestSendCaller,
  TestSendToSelfCaller,
} from "../../../Server/API/TestSendAccess";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import WorkspaceNotificationSummaryService from "../../../Server/Services/WorkspaceNotificationSummaryService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import { OneUptimeRequest } from "../../../Server/Utils/Express";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import {
  InMemoryTable,
  rowMatchesWhere,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { getJestSpyOn } from "../../Spy";
import type { Mock } from "jest-mock";
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

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * TestSendAccess: the one rule every route that sends a test asks before it
 * reads or sends anything. A test asks what sending the same thing for real
 * asks:
 *
 *  - a signed-in member of the project, as a person (not an API key);
 *  - a credential that may make changes (never one issued for reading only);
 *  - on OneUptime Cloud, the plan the feature is sold on - the plan creating
 *    what is tested needs, without what a project below it may still do
 *    with the records it has;
 *  - permission to create what is tested, team blocks counted - or, for a
 *    setting of a record (a status page's email report), what switching it
 *    on asks of that record;
 *  - the record tested read with the caller's own permissions, in their one
 *    project, another project's answered like one that does not exist.
 *
 * It runs here over in-memory tables through the real permission layer;
 * only the plan lookup is stubbed. Each route's own matrix is in
 * TestSendRoutesMatrix (Common) and Notification/TestSendRoutesMatrix (App);
 * TestSendRoutesAskTheRule keeps every test route on this helper.
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
  "7c000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("7c000000-0000-4000-8000-000000000003");
const SUMMARY_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000004",
);
const OTHER_PROJECT_SUMMARY_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000005",
);
const MISSING_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000006",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000007",
);

const GROWTH_REFUSAL: string =
  "Please upgrade your plan to Growth to access this feature";

const NOT_THIS_PROJECTS: string =
  "You are not authorized to access this project's data.";

const REPORT_REFUSAL: string =
  "You do not have permission to send this status page's report.";

interface Role {
  role: string;
  allow: Array<Permission>;
  block?: Array<Permission> | undefined;
}

// May create (and read) a summary.
const ROLES_THAT_MAY_SEND: ReadonlyArray<Role> = [
  { role: "Project Owner", allow: [Permission.ProjectOwner] },
  { role: "Project Admin", allow: [Permission.ProjectAdmin] },
  { role: "Project Member", allow: [Permission.ProjectMember] },
  { role: "Settings Admin", allow: [Permission.SettingsAdmin] },
  { role: "Settings Member", allow: [Permission.SettingsMember] },
  {
    role: "Create and Read Workspace Notification Summary",
    allow: [
      Permission.CreateWorkspaceNotificationSummary,
      Permission.ReadWorkspaceNotificationSummary,
    ],
  },
];

// May read summaries, and create none.
const ROLES_THAT_MAY_ONLY_READ: ReadonlyArray<Role> = [
  { role: "Viewer", allow: [Permission.Viewer] },
  { role: "Settings Viewer", allow: [Permission.SettingsViewer] },
  {
    role: "Read Workspace Notification Summary only",
    allow: [Permission.ReadWorkspaceNotificationSummary],
  },
  {
    role: "Edit Workspace Notification Summary (and read)",
    allow: [
      Permission.EditWorkspaceNotificationSummary,
      Permission.ReadWorkspaceNotificationSummary,
    ],
  },
];

const OWNER: Role = { role: "Project Owner", allow: [Permission.ProjectOwner] };
const VIEWER: Role = { role: "Viewer", allow: [Permission.Viewer] };

let currentPlan: PlanType | null = PlanType.Growth;
let isSubscriptionUnpaid: boolean = false;
let summaries: InMemoryTable;

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

// A signed-in member of `memberOf`, asking for `tenantId`.
const requestFrom: (
  role: Role,
  options?: {
    tenantId?: ObjectID | null | undefined;
    memberOf?: ObjectID | undefined;
    headers?: Record<string, string> | undefined;
    readOnlyCredential?: boolean | undefined;
    masterAdmin?: boolean | undefined;
  },
) => OneUptimeRequest = (
  role: Role,
  options?: {
    tenantId?: ObjectID | null | undefined;
    memberOf?: ObjectID | undefined;
    headers?: Record<string, string> | undefined;
    readOnlyCredential?: boolean | undefined;
    masterAdmin?: boolean | undefined;
  },
): OneUptimeRequest => {
  const memberOf: ObjectID = options?.memberOf || PROJECT_ID;

  const req: Record<string, unknown> = {
    params: {},
    body: {},
    headers: options?.headers || {},
    query: {},
    userType: options?.masterAdmin ? UserType.MasterAdmin : UserType.User,
    userAuthorization: {
      userId: USER_ID,
      isMasterAdmin: Boolean(options?.masterAdmin),
    },
    userTenantAccessPermission: {
      [memberOf.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: memberOf,
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
  };

  if (options?.tenantId !== null) {
    req["tenantId"] = options?.tenantId || PROJECT_ID;
  }

  if (options?.readOnlyCredential !== undefined) {
    req["mcpOAuth"] = {
      grantId: new ObjectID("7c000000-0000-4000-8000-000000000008"),
      clientId: "test-mcp-client",
      clientName: "Test MCP client",
      isReadOnly: options.readOnlyCredential,
    };
  }

  return req as unknown as OneUptimeRequest;
};

// What the rule answers: the caller it let through, or its refusal.
const askToSendSummaryTest: (
  req: OneUptimeRequest,
  id?: ObjectID,
) => Promise<TestSendCaller | Error> = async (
  req: OneUptimeRequest,
  id?: ObjectID,
): Promise<TestSendCaller | Error> => {
  try {
    return await TestSendAccess.assertMaySendTest({
      req: req,
      modelType: WorkspaceNotificationSummary,
      record: {
        service: WorkspaceNotificationSummaryService,
        id: id || SUMMARY_ID,
      },
    });
  } catch (err) {
    return err as Error;
  }
};

// A test of a channel: no record, the rule's create asked.
const askToSendChannelTest: (
  req: OneUptimeRequest,
) => Promise<TestSendCaller | Error> = async (
  req: OneUptimeRequest,
): Promise<TestSendCaller | Error> => {
  try {
    return await TestSendAccess.assertMaySendTest({
      req: req,
      modelType: WorkspaceNotificationRule,
    });
  } catch (err) {
    return err as Error;
  }
};

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
  setTestBillingEnabled(true);
  currentPlan = PlanType.Growth;
  isSubscriptionUnpaid = false;

  getJestSpyOn(ProjectService, "getCurrentPlan").mockImplementation(
    async (): Promise<{
      plan: PlanType | null;
      isSubscriptionUnpaid: boolean;
    }> => {
      return { plan: currentPlan, isSubscriptionUnpaid: isSubscriptionUnpaid };
    },
  );

  summaries = useInMemoryTable(WorkspaceNotificationSummaryService, [
    {
      _id: SUMMARY_ID.toString(),
      projectId: PROJECT_ID.toString(),
      name: "Weekly incidents",
      workspaceType: WorkspaceType.Slack,
    },
    {
      _id: OTHER_PROJECT_SUMMARY_ID.toString(),
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Another project's summary",
      workspaceType: WorkspaceType.Slack,
    },
  ]);
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("a test of something the project creates: who may send it", () => {
  test.each(ROLES_THAT_MAY_SEND)(
    "$role may: the caller is let through, for their own project",
    async (role: Role) => {
      const answer: TestSendCaller | Error = await askToSendSummaryTest(
        requestFrom(role),
      );

      expect(answer).not.toBeInstanceOf(Error);

      const caller: TestSendCaller = answer as TestSendCaller;

      expect(caller.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(caller.userId.toString()).toBe(USER_ID.toString());
      expect(caller.props.isMultiTenantRequest).toBe(false);
      expect(caller.props.isRoot).toBeFalsy();
    },
  );

  test.each(ROLES_THAT_MAY_ONLY_READ)(
    "$role may not: refused with the Send Test message, before the record is read",
    async (role: Role) => {
      const answer: TestSendCaller | Error = await askToSendSummaryTest(
        requestFrom(role),
      );

      expect(answer).toBeInstanceOf(NotAuthorizedException);
      expect((answer as Error).message).toBe(
        TEST_NOTIFICATION_PERMISSION_MESSAGE,
      );
      expect(summaries.repository.find).not.toHaveBeenCalled();
    },
  );

  test("a team's block on creating it refuses, naming the block, whatever else the team grants", async () => {
    const answer: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom({
        role: "Project Owner, with Create Workspace Notification Summary blocked",
        allow: [Permission.ProjectOwner],
        block: [Permission.CreateWorkspaceNotificationSummary],
      }),
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toContain(
      "CreateWorkspaceNotificationSummary is in your team's permission block list",
    );
    expect(summaries.repository.find).not.toHaveBeenCalled();
  });

  test("a block row is never a grant: blocked from creating it, and holding nothing else, is refused", async () => {
    const answer: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom({
        role: "Read, with Create blocked",
        allow: [Permission.ReadWorkspaceNotificationSummary],
        block: [Permission.CreateWorkspaceNotificationSummary],
      }),
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect(summaries.repository.find).not.toHaveBeenCalled();
  });

  test("permission to create it without its read: refused by the read, as the caller", async () => {
    const answer: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom({
        role: "Create Workspace Notification Summary only",
        allow: [Permission.CreateWorkspaceNotificationSummary],
      }),
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toContain(
      "You do not have permissions to read",
    );
  });

  test("a master admin who is a member is let through whatever the member holds", async () => {
    const answer: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom({ role: "no grants", allow: [] }, { masterAdmin: true }),
    );

    expect(answer).not.toBeInstanceOf(Error);
  });

  test("a master admin still has to be a member of the project the request names", async () => {
    const answer: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom(OWNER, {
        masterAdmin: true,
        memberOf: OTHER_PROJECT_ID,
        tenantId: PROJECT_ID,
      }),
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toBe(NOT_THIS_PROJECTS);
  });
});

describe("who is asking: a signed-in member, as a person", () => {
  test("no credentials at all is 401, before anything else", async () => {
    const req: OneUptimeRequest = {
      params: {},
      body: {},
      headers: {},
      query: {},
      userType: UserType.Public,
      tenantId: PROJECT_ID,
    } as unknown as OneUptimeRequest;

    const answer: TestSendCaller | Error = await askToSendSummaryTest(req);

    expect(answer).toBeInstanceOf(NotAuthenticatedException);
    expect(summaries.repository.find).not.toHaveBeenCalled();
  });

  test("a request that names no project is refused before anything is read", async () => {
    const answer: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom(OWNER, { tenantId: null }),
    );

    expect(answer).toBeInstanceOf(BadDataException);
    expect((answer as Error).message).toBe("Project ID is required");
    expect(summaries.repository.find).not.toHaveBeenCalled();
  });

  test("a project API key is refused: a test is sent by a person", async () => {
    const req: OneUptimeRequest = {
      params: {},
      body: {},
      headers: {},
      query: {},
      userType: UserType.API,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: [userPermission(Permission.ProjectOwner, false)],
        },
      },
    } as unknown as OneUptimeRequest;

    const answer: TestSendCaller | Error = await askToSendSummaryTest(req);

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect(summaries.repository.find).not.toHaveBeenCalled();
  });

  test("an owner of another project who names this project is refused before anything is read", async () => {
    const answer: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom(OWNER, { memberOf: OTHER_PROJECT_ID, tenantId: PROJECT_ID }),
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toBe(NOT_THIS_PROJECTS);
    expect(summaries.repository.find).not.toHaveBeenCalled();
  });
});

describe("the credential: one that may make changes", () => {
  test("an MCP client connected read-only is refused, whatever its member may do, before anything is read", async () => {
    const answer: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom(OWNER, { readOnlyCredential: true }),
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toBe(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
    expect(summaries.repository.find).not.toHaveBeenCalled();
  });

  test("a read-only credential is refused before the plan is asked: below the plan it is still the credential's refusal", async () => {
    currentPlan = PlanType.Free;

    const answer: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom(OWNER, { readOnlyCredential: true }),
    );

    expect((answer as Error).message).toBe(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
  });

  test("a read-only credential is refused for a test with no record too (a channel)", async () => {
    const answer: TestSendCaller | Error = await askToSendChannelTest(
      requestFrom(OWNER, { readOnlyCredential: true }),
    );

    expect((answer as Error).message).toBe(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
  });

  test("the same member through an MCP client allowed to make changes is let through", async () => {
    expect(
      await askToSendSummaryTest(
        requestFrom(OWNER, { readOnlyCredential: false }),
      ),
    ).not.toBeInstanceOf(Error);
  });
});

describe("the plan, on OneUptime Cloud (billing on)", () => {
  test("below the plan creating it needs, refused with the plan's name, before the record is read", async () => {
    currentPlan = PlanType.Free;

    const answer: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom(OWNER),
    );

    expect(answer).toBeInstanceOf(PaymentRequiredException);
    expect((answer as Error).message).toBe(GROWTH_REFUSAL);
    expect(summaries.repository.find).not.toHaveBeenCalled();
  });

  test("below the plan the summary can still be read - to switch it off or delete it - but that is no test send", async () => {
    currentPlan = PlanType.Free;

    const props: DatabaseCommonInteractionProps = {
      userId: USER_ID,
      tenantId: PROJECT_ID,
      currentPlan: PlanType.Free,
      isSubscriptionUnpaid: false,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: [userPermission(Permission.ProjectOwner, false)],
        },
      },
    };

    const summary: WorkspaceNotificationSummary | null =
      await WorkspaceNotificationSummaryService.findOneById({
        id: SUMMARY_ID,
        select: { name: true },
        props: props,
      });

    expect(summary?.name).toBe("Weekly incidents");

    expect(await askToSendSummaryTest(requestFrom(OWNER))).toBeInstanceOf(
      PaymentRequiredException,
    );
  });

  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on %s the caller is let through",
    async (plan: PlanType) => {
      currentPlan = plan;

      expect(await askToSendSummaryTest(requestFrom(OWNER))).not.toBeInstanceOf(
        Error,
      );
    },
  );

  test("an unpaid subscription is refused, as every paid feature is", async () => {
    isSubscriptionUnpaid = true;

    const answer: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom(OWNER),
    );

    expect(answer).toBeInstanceOf(PaymentRequiredException);
    expect((answer as Error).message).toContain("unpaid");
  });

  test("a test of a channel asks the plan adding a rule needs", async () => {
    currentPlan = PlanType.Free;

    const answer: TestSendCaller | Error = await askToSendChannelTest(
      requestFrom(OWNER),
    );

    expect(answer).toBeInstanceOf(PaymentRequiredException);
    expect((answer as Error).message).toBe(GROWTH_REFUSAL);
    expect(new WorkspaceNotificationRule().getCreateBillingPlan()).toBe(
      PlanType.Growth,
    );
  });

  test("below the plan, a role that may not send is told about the plan first", async () => {
    currentPlan = PlanType.Free;

    const answer: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom(VIEWER),
    );

    expect((answer as Error).message).toBe(GROWTH_REFUSAL);
  });

  test("a master admin is held to the plan too", async () => {
    currentPlan = PlanType.Free;

    const answer: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom(OWNER, { masterAdmin: true }),
    );

    expect(answer).toBeInstanceOf(PaymentRequiredException);
  });
});

describe("on a self-hosted install (billing off)", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
  });

  test.each([PlanType.Free, PlanType.Growth])(
    "no plan is asked, even when the project's plan is %s",
    async (plan: PlanType) => {
      currentPlan = plan;

      expect(await askToSendSummaryTest(requestFrom(OWNER))).not.toBeInstanceOf(
        Error,
      );
      expect(await askToSendChannelTest(requestFrom(OWNER))).not.toBeInstanceOf(
        Error,
      );
    },
  );

  test("who may send is decided the same way", async () => {
    expect(await askToSendSummaryTest(requestFrom(VIEWER))).toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(
      await askToSendSummaryTest(
        requestFrom(OWNER, { readOnlyCredential: true }),
      ),
    ).toBeInstanceOf(NotAuthorizedException);
  });
});

describe("which record: one the caller may read, in their own project", () => {
  test("the record is read with the caller's own permissions, for their project alone - never as root", async () => {
    const readSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findOneById",
    );

    expect(await askToSendSummaryTest(requestFrom(OWNER))).not.toBeInstanceOf(
      Error,
    );

    expect(readSpy).toHaveBeenCalledTimes(1);

    const props: DatabaseCommonInteractionProps = (
      readSpy.mock.calls[0]![0] as { props: DatabaseCommonInteractionProps }
    ).props;

    expect(props.isRoot).toBeFalsy();
    expect(props.userId?.toString()).toBe(USER_ID.toString());
    expect(props.tenantId?.toString()).toBe(PROJECT_ID.toString());
    expect(props.isMultiTenantRequest).toBe(false);
  });

  test("a request that asks for a multi-tenant read is still read for the one project", async () => {
    const answer: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom(OWNER, { headers: { "is-multi-tenant-query": "true" } }),
      OTHER_PROJECT_SUMMARY_ID,
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toBe(NOT_THIS_PROJECTS);
  });

  test("another project's record answers like one that does not exist", async () => {
    const foreign: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom(OWNER),
      OTHER_PROJECT_SUMMARY_ID,
    );
    const missing: TestSendCaller | Error = await askToSendSummaryTest(
      requestFrom(OWNER),
      MISSING_ID,
    );

    expect(foreign).toBeInstanceOf(NotAuthorizedException);
    expect(missing).toBeInstanceOf(NotAuthorizedException);
    expect((foreign as Error).message).toBe(NOT_THIS_PROJECTS);
    expect((missing as Error).message).toBe((foreign as Error).message);
  });

  test("the read itself is scoped to the caller's project", async () => {
    await askToSendSummaryTest(requestFrom(OWNER), OTHER_PROJECT_SUMMARY_ID);

    expect(summaries.repository.find).toHaveBeenCalled();

    const where: unknown = (
      summaries.repository.find.mock.calls[0]![0] as { where: unknown }
    ).where;

    expect(
      rowMatchesWhere(
        {
          _id: OTHER_PROJECT_SUMMARY_ID.toString(),
          projectId: OTHER_PROJECT_ID.toString(),
        },
        where,
      ),
    ).toBe(false);
    expect(
      rowMatchesWhere(
        {
          _id: OTHER_PROJECT_SUMMARY_ID.toString(),
          projectId: PROJECT_ID.toString(),
        },
        where,
      ),
    ).toBe(true);
  });

  test("a test with no record (a channel) reads nothing", async () => {
    expect(await askToSendChannelTest(requestFrom(OWNER))).not.toBeInstanceOf(
      Error,
    );
    expect(summaries.repository.find).not.toHaveBeenCalled();
  });

  test("the plan and the permission come before the read: neither is answered by reading", async () => {
    const readSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findOneById",
    );
    const createGate: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      CommonAPI,
      "assertCanCreateTable",
    );

    await askToSendSummaryTest(requestFrom(OWNER));

    expect(createGate.mock.invocationCallOrder[0]!).toBeLessThan(
      readSpy.mock.invocationCallOrder[0]!,
    );
  });
});

/*
 * A setting of a record - a status page's email report - is switched on, not
 * created: its test asks what writing the switch-on to that one record asks.
 * The page is read through a stand-in service here; the permission layer is
 * the real one. Labels and owned scope are StatusPageTestEmailReportAuth.
 */
describe("a test of a setting: what switching it on asks of that record", () => {
  let pageInProject: StatusPage | null;
  let permittedRead: Mock<
    (...args: Array<unknown>) => Promise<StatusPage | null>
  >;
  let service: DatabaseService<StatusPage>;

  const askToSendReport: (
    req: OneUptimeRequest,
  ) => Promise<TestSendCaller | Error> = async (
    req: OneUptimeRequest,
  ): Promise<TestSendCaller | Error> => {
    try {
      return await TestSendAccess.assertMaySendTestOfSetting({
        req: req,
        record: { service: service, id: STATUS_PAGE_ID },
        switchOn: { isReportEnabled: true },
        errorMessage: REPORT_REFUSAL,
      });
    } catch (err) {
      return err as Error;
    }
  };

  beforeEach(() => {
    const page: StatusPage = new StatusPage();
    page.id = STATUS_PAGE_ID;
    page.projectId = PROJECT_ID;
    page.labels = [];
    pageInProject = page;

    permittedRead = jest.fn<
      (...args: Array<unknown>) => Promise<StatusPage | null>
    >(async (): Promise<StatusPage | null> => {
      return pageInProject;
    });

    service = {
      modelType: StatusPage,
      getModel: (): StatusPage => {
        return new StatusPage();
      },
      findOneById: jest.fn(async (): Promise<StatusPage | null> => {
        return pageInProject;
      }),
      findOneBy: permittedRead,
    } as unknown as DatabaseService<StatusPage>;
  });

  test.each([
    ["Project Owner", Permission.ProjectOwner],
    ["Project Admin", Permission.ProjectAdmin],
    ["Project Member", Permission.ProjectMember],
    ["Status Page Admin", Permission.StatusPageAdmin],
    ["Status Page Member", Permission.StatusPageMember],
  ])(
    "%s may: the caller is let through",
    async (role: string, permission: Permission) => {
      const answer: TestSendCaller | Error = await askToSendReport(
        requestFrom({ role: role, allow: [permission] }),
      );

      expect(answer).not.toBeInstanceOf(Error);
      expect((answer as TestSendCaller).props.isMultiTenantRequest).toBe(false);
    },
  );

  test.each([
    ["Viewer", Permission.Viewer],
    ["Status Page Viewer", Permission.StatusPageViewer],
    ["Read Status Page", Permission.ReadProjectStatusPage],
  ])(
    "%s may not: refused with the report's message, before the page is read",
    async (role: string, permission: Permission) => {
      const answer: TestSendCaller | Error = await askToSendReport(
        requestFrom({ role: role, allow: [permission] }),
      );

      expect(answer).toBeInstanceOf(NotAuthorizedException);
      expect((answer as Error).message).toBe(REPORT_REFUSAL);
      expect(service.findOneById).not.toHaveBeenCalled();
    },
  );

  test("below the plan reports are sold on, refused with that plan's name", async () => {
    currentPlan = PlanType.Free;

    const answer: TestSendCaller | Error = await askToSendReport(
      requestFrom(OWNER),
    );

    expect(answer).toBeInstanceOf(PaymentRequiredException);
    expect((answer as Error).message).toBe(GROWTH_REFUSAL);
    // The plan is asked first: the page is not even read.
    expect(service.findOneById).not.toHaveBeenCalled();
    expect(permittedRead).not.toHaveBeenCalled();
    expect(
      new StatusPage().getColumnBillingAccessControl("isReportEnabled").update,
    ).toBe(PlanType.Growth);
  });

  test("a plan OneUptime could not confirm is never any plan: refused before the page is read", async () => {
    // A project whose plan reads as none: the request carries no plan.
    currentPlan = null;

    const answer: TestSendCaller | Error = await askToSendReport(
      requestFrom(OWNER),
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toBe(CallerPlan.PLAN_UNKNOWN_MESSAGE);
    expect(service.findOneById).not.toHaveBeenCalled();
    expect(permittedRead).not.toHaveBeenCalled();
  });

  test("below the plan, a role that may not change the page is told about the plan first, as the Dashboard tells it", async () => {
    currentPlan = PlanType.Free;

    const answer: TestSendCaller | Error = await askToSendReport(
      requestFrom(VIEWER),
    );

    expect(answer).toBeInstanceOf(PaymentRequiredException);
    expect((answer as Error).message).toBe(GROWTH_REFUSAL);
  });

  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on %s the owner is let through",
    async (plan: PlanType) => {
      currentPlan = plan;

      expect(await askToSendReport(requestFrom(OWNER))).not.toBeInstanceOf(
        Error,
      );
    },
  );

  test("an unpaid subscription is refused before the page is read", async () => {
    isSubscriptionUnpaid = true;

    const answer: TestSendCaller | Error = await askToSendReport(
      requestFrom(OWNER),
    );

    expect(answer).toBeInstanceOf(PaymentRequiredException);
    expect((answer as Error).message).toContain("unpaid");
    expect(service.findOneById).not.toHaveBeenCalled();
  });

  test.each([
    [
      "the page's labels",
      "checkUpdatePermissionByModel",
      new NotAuthorizedException(
        "You do not have permission to update this Status Page. You need to have one of the following labels: Public.",
      ),
    ],
    [
      "a team's block",
      "checkUpdatePermissionByModel",
      new NotAuthorizedException(
        "You are not authorized to update this Status Page because Edit Status Page is in your team's permission block list.",
      ),
    ],
    [
      "the report switch's own permission",
      "checkUpdateQueryPermissions",
      new BadDataException(
        "User is not allowed to update on isReportEnabled column of Status Page",
      ),
    ],
    // A page the caller may not read is answered as missing by the check.
    [
      "the page's read",
      "checkUpdatePermissionByModel",
      new NotFoundException("Status Page not found."),
    ],
  ])(
    "refused by %s: one sentence, the report's own",
    async (_why: string, check: string, refusal: Error) => {
      getJestSpyOn(
        ModelPermission,
        check as "checkUpdatePermissionByModel",
      ).mockRejectedValue(refusal as never);

      const answer: TestSendCaller | Error = await askToSendReport(
        requestFrom(OWNER),
      );

      expect(answer).toBeInstanceOf(NotAuthorizedException);
      expect((answer as Error).message).toBe(REPORT_REFUSAL);
    },
  );

  test("anything other than a refusal is not dressed up as one", async () => {
    const failure: Error = new Error("The database is not reachable.");

    getJestSpyOn(
      ModelPermission,
      "checkUpdateQueryPermissions",
    ).mockRejectedValue(failure as never);

    expect(await askToSendReport(requestFrom(OWNER))).toBe(failure);
  });

  test("with billing off no plan is asked", async () => {
    setTestBillingEnabled(false);
    currentPlan = PlanType.Free;

    expect(await askToSendReport(requestFrom(OWNER))).not.toBeInstanceOf(Error);
  });

  test("a read-only credential is refused before anything is read", async () => {
    const answer: TestSendCaller | Error = await askToSendReport(
      requestFrom(OWNER, { readOnlyCredential: true }),
    );

    expect((answer as Error).message).toBe(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
    expect(service.findOneById).not.toHaveBeenCalled();
  });

  test("another project's page, or one that does not exist, is answered alike", async () => {
    const foreign: StatusPage = new StatusPage();
    foreign.id = STATUS_PAGE_ID;
    foreign.projectId = OTHER_PROJECT_ID;
    foreign.labels = [];
    pageInProject = foreign;

    const foreignAnswer: TestSendCaller | Error = await askToSendReport(
      requestFrom(OWNER),
    );

    pageInProject = null;

    const missingAnswer: TestSendCaller | Error = await askToSendReport(
      requestFrom(OWNER),
    );

    expect(foreignAnswer).toBeInstanceOf(NotAuthorizedException);
    expect((foreignAnswer as Error).message).toBe(NOT_THIS_PROJECTS);
    expect((missingAnswer as Error).message).toBe(NOT_THIS_PROJECTS);
  });

  test("a page the caller's update does not reach is refused with the report's message", async () => {
    permittedRead.mockResolvedValue(null);

    const answer: TestSendCaller | Error = await askToSendReport(
      requestFrom(OWNER),
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toBe(REPORT_REFUSAL);
  });

  test("the page is looked up for the caller's project only, and the update's rows narrowed to it", async () => {
    await askToSendReport(requestFrom(OWNER));

    const query: unknown = (
      permittedRead.mock.calls[0]![0] as { query: unknown }
    ).query;

    // This page, in the caller's project - and not the same id elsewhere.
    expect(
      rowMatchesWhere(
        {
          _id: STATUS_PAGE_ID.toString(),
          projectId: PROJECT_ID.toString(),
        },
        query,
      ),
    ).toBe(true);
    expect(
      rowMatchesWhere(
        {
          _id: STATUS_PAGE_ID.toString(),
          projectId: OTHER_PROJECT_ID.toString(),
        },
        query,
      ),
    ).toBe(false);
    expect(
      rowMatchesWhere(
        { _id: MISSING_ID.toString(), projectId: PROJECT_ID.toString() },
        query,
      ),
    ).toBe(false);
  });

  test("the real report service is the one the route hands it", () => {
    expect(StatusPageService.modelType).toBe(StatusPage);
  });
});

describe("a test the caller sends to themselves", () => {
  test("a signed-in person on a credential that may make changes is let through", async () => {
    const answer: TestSendToSelfCaller =
      await TestSendAccess.assertMaySendTestToSelf(requestFrom(OWNER));

    expect(answer.userId.toString()).toBe(USER_ID.toString());
  });

  test("a read-only credential is refused", async () => {
    await expect(
      TestSendAccess.assertMaySendTestToSelf(
        requestFrom(OWNER, { readOnlyCredential: true }),
      ),
    ).rejects.toThrow(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
  });

  test("no credentials at all is 401", async () => {
    const req: OneUptimeRequest = {
      params: {},
      body: {},
      headers: {},
      query: {},
      userType: UserType.Public,
    } as unknown as OneUptimeRequest;

    await expect(TestSendAccess.assertMaySendTestToSelf(req)).rejects.toThrow(
      NotAuthenticatedException,
    );
  });

  test("a project API key is refused: there is no person to send to", async () => {
    const req: OneUptimeRequest = {
      params: {},
      body: {},
      headers: {},
      query: {},
      userType: UserType.API,
      tenantId: PROJECT_ID,
    } as unknown as OneUptimeRequest;

    await expect(TestSendAccess.assertMaySendTestToSelf(req)).rejects.toThrow(
      NotAuthorizedException,
    );
  });
});

describe("a test sent to oneself, through a method of a project", () => {
  const senderMemberOf: (
    projectIds: Array<ObjectID> | undefined,
  ) => TestSendToSelfCaller = (
    projectIds: Array<ObjectID> | undefined,
  ): TestSendToSelfCaller => {
    return {
      userId: USER_ID,
      props: {
        userId: USER_ID,
        userGlobalAccessPermission: projectIds
          ? {
              _type: "UserGlobalAccessPermission",
              projectIds: projectIds,
              globalPermissions: [],
            }
          : undefined,
      },
    };
  };

  const askMembership: (
    sender: TestSendToSelfCaller,
    projectId: ObjectID | undefined | null,
  ) => Error | "member" = (
    sender: TestSendToSelfCaller,
    projectId: ObjectID | undefined | null,
  ): Error | "member" => {
    try {
      TestSendAccess.assertSenderIsMemberOf({
        sender: sender,
        projectId: projectId,
      });
      return "member";
    } catch (err) {
      return err as Error;
    }
  };

  test("a member of the method's project is let through", () => {
    expect(
      askMembership(senderMemberOf([OTHER_PROJECT_ID, PROJECT_ID]), PROJECT_ID),
    ).toBe("member");
  });

  test("the same project id, read back as a different object, still matches", () => {
    expect(
      askMembership(
        senderMemberOf([new ObjectID(PROJECT_ID.toString())]),
        new ObjectID(PROJECT_ID.toString()),
      ),
    ).toBe("member");
  });

  test.each([
    ["a project they have left", [OTHER_PROJECT_ID], PROJECT_ID],
    ["no project at all", [], PROJECT_ID],
    ["no list of projects", undefined, PROJECT_ID],
    ["a method that names no project", [PROJECT_ID], undefined],
    ["a method whose project is empty", [PROJECT_ID], null],
  ])(
    "%s: refused like another project's data",
    (
      _why: string,
      memberOf: Array<ObjectID> | undefined,
      projectId: ObjectID | undefined | null,
    ) => {
      const answer: Error | "member" = askMembership(
        senderMemberOf(memberOf),
        projectId,
      );

      expect(answer).toBeInstanceOf(NotAuthorizedException);
      expect((answer as Error).message).toBe(NOT_THIS_PROJECTS);
    },
  );
});

describe("the refusal's words", () => {
  test("every test route refuses with the same plain sentence", () => {
    expect(TEST_NOTIFICATION_PERMISSION_MESSAGE).toBe(
      "You do not have permission to send test notifications in this project.",
    );
  });
});

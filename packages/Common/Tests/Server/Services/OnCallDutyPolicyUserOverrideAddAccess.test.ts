import { mockRouter } from "../API/Helpers";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyOwnerTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import CommonAPI from "../../../Server/API/CommonAPI";
import OnCallDutyPolicyUserOverrideAPI from "../../../Server/API/OnCallDutyPolicyUserOverrideAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyOwnerTeamService from "../../../Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "../../../Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import UserService from "../../../Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import OneUptimeDate from "../../../Types/Date";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserOverrideAddAccessUtil, {
  UserOverrideAddAccess,
} from "../../../Types/OnCallDutyPolicy/UserOverrideAddAccess";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import {
  FakeDb,
  emptyDb,
  installFakeDb,
  matchesQuery,
} from "../Utils/OnCall/OnCallResolverTestHarness";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { useUserOverrideTimesInMemory } from "../TestingUtils/UserOverrideTimesInMemory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHERE A MEMBER MAY ADD A USER OVERRIDE, AS THE SERVER ANSWERS IT
 * (POST /on-call-duty-policy-user-override/add-access,
 * OnCallDutyPolicyUserOverrideService.getAddAccess).
 *
 * Since #5617 a global override takes a permission to add overrides over
 * the whole project. A member limited to their team's label, or to the
 * policies their team owns, still adds overrides on those policies, so the
 * shortcuts that would add a global one - Skip until..., Get cover, the
 * mobile app's cover sheet - ask the server which policies they may cover,
 * and offer those. Each answer has to be the one a real create would give:
 * a policy offered and then refused on save, or a policy left out that the
 * member could have covered, is the bug this route exists to end.
 *
 * So each grant shape below - limited to a label, to owned policies, over
 * the whole project, with blocks, as an API key, as a master admin - asks
 * the route about every policy, and then adds a real override on each one
 * through OnCallDutyPolicyUserOverrideService.create (its hooks and every
 * permission check; only the database is in memory): every policy the
 * route lists is accepted, every policy it leaves out is refused, and the
 * global override likewise.
 *
 * User overrides are on the Growth plan on OneUptime Cloud, so billing is
 * pinned on, with the plans CI configures (packages/Common/test-setup.sh).
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
    getAllEnvVars: () => {
      return {
        SUBSCRIPTION_PLAN_BASIC:
          "Free,price_basic_monthly,price_basic_yearly,0,0,1,0",
        SUBSCRIPTION_PLAN_GROWTH:
          "Growth,price_growth_monthly,price_growth_yearly,22,20,2,14",
        SUBSCRIPTION_PLAN_SCALE:
          "Scale,price_scale_monthly,price_scale_yearly,99,84,3,14",
        SUBSCRIPTION_PLAN_ENTERPRISE:
          "Enterprise,price_enterprise_monthly,price_enterprise_yearly,-1,-1,4,14",
      };
    },
  };
});

// The route is registered on the recording router, and answers through it.
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
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

const ROUTE: string = "/on-call-duty-policy-user-override/add-access";

// Registered once, before any spy is restored.
new OnCallDutyPolicyUserOverrideAPI();

const PROJECT: string = "0dd00000-0000-4000-8000-000000000001";

const TEAM_A_LABEL: string = "0dd00000-0000-4000-8000-0000000000a3";
const TEAM_B_LABEL: string = "0dd00000-0000-4000-8000-0000000000b3";
const TEAM_A: string = "0dd00000-0000-4000-8000-0000000000a4";

// User A is on Team A; User B on Team B; Sam covers.
const USER_A: string = "0dd00000-0000-4000-8000-0000000000a1";
const USER_B: string = "0dd00000-0000-4000-8000-0000000000b1";
const SAM: string = "0dd00000-0000-4000-8000-0000000000c1";

// The project's policies: their labels, and who owns them.
const TEAM_A_POLICY: string = "0dd00000-0000-4000-8000-0000000000a2";
const TEAM_B_POLICY: string = "0dd00000-0000-4000-8000-0000000000b2";
const BOTH_TEAMS_POLICY: string = "0dd00000-0000-4000-8000-0000000000d2";
const OWNED_BY_TEAM_A_POLICY: string = "0dd00000-0000-4000-8000-0000000000e2";
const OWNED_BY_USER_A_POLICY: string = "0dd00000-0000-4000-8000-0000000000f2";
const PLAIN_POLICY: string = "0dd00000-0000-4000-8000-000000000012";

// Another project's policy, and an id that names nothing.
const ELSEWHERE_POLICY: string = "0dd00000-0000-4000-8000-000000000022";
const MISSING_POLICY: string = "0dd00000-0000-4000-8000-000000000032";

interface StoredPolicy {
  labels: Array<string>;
  ownerTeams: Array<string>;
  ownerUsers: Array<string>;
}

const POLICIES: Record<string, StoredPolicy> = {
  [TEAM_A_POLICY]: { labels: [TEAM_A_LABEL], ownerTeams: [], ownerUsers: [] },
  [TEAM_B_POLICY]: { labels: [TEAM_B_LABEL], ownerTeams: [], ownerUsers: [] },
  [BOTH_TEAMS_POLICY]: {
    labels: [TEAM_A_LABEL, TEAM_B_LABEL],
    ownerTeams: [],
    ownerUsers: [],
  },
  [OWNED_BY_TEAM_A_POLICY]: {
    labels: [],
    ownerTeams: [TEAM_A],
    ownerUsers: [],
  },
  [OWNED_BY_USER_A_POLICY]: {
    labels: [],
    ownerTeams: [],
    ownerUsers: [USER_A],
  },
  [PLAIN_POLICY]: { labels: [], ownerTeams: [], ownerUsers: [] },
};

const PROJECT_POLICIES: Array<string> = Object.keys(POLICIES);

// Every policy the route is asked about.
const ASKED: Array<string> = [
  ...PROJECT_POLICIES,
  ELSEWHERE_POLICY,
  MISSING_POLICY,
];

const NOW: Date = new Date("2026-11-03T12:00:00Z");
const NEXT_WEEK: Date = new Date("2026-11-10T12:00:00Z");

const key: (id: string | ObjectID) => string = (
  id: string | ObjectID,
): string => {
  return id.toString().toLowerCase();
};

// A row of the caller's, as AccessTokenService hands it to the request.
const row: (
  permission: Permission,
  data?: {
    scope?: PermissionScope;
    labelIds?: Array<string>;
    isBlock?: boolean;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    scope?: PermissionScope;
    labelIds?: Array<string>;
    isBlock?: boolean;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: (data?.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    scope: data?.scope || PermissionScope.All,
    isBlockPermission: Boolean(data?.isBlock),
    // Team A holds it: an Owned row reaches what Team A owns.
    teamId: new ObjectID(TEAM_A),
  };
};

const tenantAccess: (
  rows: Array<UserPermission>,
) => DatabaseCommonInteractionProps["userTenantAccessPermission"] = (
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps["userTenantAccessPermission"] => {
  return {
    [PROJECT]: {
      _type: "UserTenantAccessPermission",
      projectId: new ObjectID(PROJECT),
      permissions: rows,
    },
  };
};

const asMember: (
  rows: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: new ObjectID(USER_A),
    userType: UserType.User,
    tenantId: new ObjectID(PROJECT),
    currentPlan: PlanType.Growth,
    isSubscriptionUnpaid: false,
    userTeamIds: [new ObjectID(TEAM_A)],
    userTenantAccessPermission: tenantAccess(rows),
  };
};

const asApiKey: (
  rows: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userType: UserType.API,
    tenantId: new ObjectID(PROJECT),
    currentPlan: PlanType.Growth,
    isSubscriptionUnpaid: false,
    userTenantAccessPermission: tenantAccess(rows),
  };
};

// Reads every policy, as a project's Viewer does.
const READS_EVERY_POLICY: UserPermission = row(Permission.Viewer);

const LABEL_A_POLICIES: Array<string> = [TEAM_A_POLICY, BOTH_TEAMS_POLICY];

const OWNED_POLICIES: Array<string> = [
  OWNED_BY_TEAM_A_POLICY,
  OWNED_BY_USER_A_POLICY,
];

interface GrantShape {
  name: string;
  props: DatabaseCommonInteractionProps;
  /*
   * The project's policies a read of policies as the caller finds - the
   * database's answer, which the read rule (labels, owners) decides.
   */
  reads: Array<string>;
  // What the route answers, pinned so the shape says what it is about.
  expected: UserOverrideAddAccess;
}

const GRANT_SHAPES: Array<GrantShape> = [
  {
    name: "On-Call Member limited to Team A's label, reading every policy",
    props: asMember([
      row(Permission.OnCallMember, {
        scope: PermissionScope.Labels,
        labelIds: [TEAM_A_LABEL],
      }),
      READS_EVERY_POLICY,
    ]),
    reads: PROJECT_POLICIES,
    expected: { global: false, onCallDutyPolicyIds: LABEL_A_POLICIES },
  },
  {
    name: "On-Call Member limited to Team A's label, reading only those policies",
    props: asMember([
      row(Permission.OnCallMember, {
        scope: PermissionScope.Labels,
        labelIds: [TEAM_A_LABEL],
      }),
    ]),
    reads: LABEL_A_POLICIES,
    expected: { global: false, onCallDutyPolicyIds: LABEL_A_POLICIES },
  },
  {
    name: "On-Call Member limited to what Team A owns, reading every policy",
    props: asMember([
      row(Permission.OnCallMember, { scope: PermissionScope.Owned }),
      READS_EVERY_POLICY,
    ]),
    reads: PROJECT_POLICIES,
    expected: { global: false, onCallDutyPolicyIds: OWNED_POLICIES },
  },
  {
    name: "On-Call Member limited to what Team A owns, reading only those policies",
    props: asMember([
      row(Permission.OnCallMember, { scope: PermissionScope.Owned }),
    ]),
    reads: OWNED_POLICIES,
    expected: { global: false, onCallDutyPolicyIds: OWNED_POLICIES },
  },
  {
    name: "the single permission to add overrides, limited to Team A's label, reading every policy",
    props: asMember([
      row(Permission.CreateOnCallDutyPolicyUserOverride, {
        scope: PermissionScope.Labels,
        labelIds: [TEAM_A_LABEL],
      }),
      READS_EVERY_POLICY,
    ]),
    reads: PROJECT_POLICIES,
    expected: { global: false, onCallDutyPolicyIds: LABEL_A_POLICIES },
  },
  {
    name: "the single permission to add overrides over the whole project, reading no policy",
    props: asMember([row(Permission.CreateOnCallDutyPolicyUserOverride)]),
    reads: [],
    expected: { global: false, onCallDutyPolicyIds: [] },
  },
  {
    name: "the single permission to add overrides over the whole project, reading every policy",
    props: asMember([
      row(Permission.CreateOnCallDutyPolicyUserOverride),
      READS_EVERY_POLICY,
    ]),
    reads: PROJECT_POLICIES,
    expected: { global: true, onCallDutyPolicyIds: PROJECT_POLICIES },
  },
  {
    name: "On-Call Member over the whole project",
    props: asMember([row(Permission.OnCallMember)]),
    reads: PROJECT_POLICIES,
    expected: { global: true, onCallDutyPolicyIds: PROJECT_POLICIES },
  },
  {
    name: "On-Call Member over the whole project, with a team's block on adding overrides for Team B's label",
    props: asMember([
      row(Permission.OnCallMember),
      row(Permission.CreateOnCallDutyPolicyUserOverride, {
        isBlock: true,
        labelIds: [TEAM_B_LABEL],
      }),
    ]),
    reads: PROJECT_POLICIES,
    expected: {
      global: false,
      onCallDutyPolicyIds: [
        TEAM_A_POLICY,
        OWNED_BY_TEAM_A_POLICY,
        OWNED_BY_USER_A_POLICY,
        PLAIN_POLICY,
      ],
    },
  },
  {
    name: "On-Call Member over the whole project, with a block on adding overrides and no labels",
    props: asMember([
      row(Permission.OnCallMember),
      row(Permission.CreateOnCallDutyPolicyUserOverride, { isBlock: true }),
    ]),
    reads: PROJECT_POLICIES,
    expected: { global: false, onCallDutyPolicyIds: [] },
  },
  {
    name: "On-Call Member limited to Team A's label, with a block on adding overrides for that label",
    props: asMember([
      row(Permission.OnCallMember, {
        scope: PermissionScope.Labels,
        labelIds: [TEAM_A_LABEL],
      }),
      row(Permission.CreateOnCallDutyPolicyUserOverride, {
        isBlock: true,
        labelIds: [TEAM_A_LABEL],
      }),
      READS_EVERY_POLICY,
    ]),
    reads: PROJECT_POLICIES,
    expected: { global: false, onCallDutyPolicyIds: [] },
  },
  {
    name: "Project Member over the whole project",
    props: asMember([row(Permission.ProjectMember)]),
    reads: PROJECT_POLICIES,
    expected: { global: true, onCallDutyPolicyIds: PROJECT_POLICIES },
  },
  {
    name: "Project Admin, its row carrying a label no scope narrows",
    props: asMember([
      row(Permission.ProjectAdmin, { labelIds: [TEAM_A_LABEL] }),
    ]),
    reads: PROJECT_POLICIES,
    expected: { global: true, onCallDutyPolicyIds: PROJECT_POLICIES },
  },
  {
    name: "a Viewer, who may add no override",
    props: asMember([READS_EVERY_POLICY]),
    reads: PROJECT_POLICIES,
    expected: { global: false, onCallDutyPolicyIds: [] },
  },
  {
    name: "an API key limited to Team A's label, reading every policy",
    props: asApiKey([
      row(Permission.OnCallMember, {
        scope: PermissionScope.Labels,
        labelIds: [TEAM_A_LABEL],
      }),
      READS_EVERY_POLICY,
    ]),
    reads: PROJECT_POLICIES,
    expected: { global: false, onCallDutyPolicyIds: LABEL_A_POLICIES },
  },
  {
    name: "an API key over the whole project",
    props: asApiKey([row(Permission.OnCallMember)]),
    reads: PROJECT_POLICIES,
    expected: { global: true, onCallDutyPolicyIds: PROJECT_POLICIES },
  },
  {
    name: "a master admin",
    props: {
      userId: new ObjectID(USER_A),
      userType: UserType.User,
      tenantId: new ObjectID(PROJECT),
      isMasterAdmin: true,
    },
    reads: PROJECT_POLICIES,
    expected: { global: true, onCallDutyPolicyIds: PROJECT_POLICIES },
  },
];

// The project's policies a read as the current caller finds.
let readablePolicies: Array<string> = [];
let savedCount: number = 0;
let db: FakeDb;

const isProjectPolicy: (id: string) => boolean = (id: string): boolean => {
  return PROJECT_POLICIES.some((policyId: string): boolean => {
    return key(policyId) === key(id);
  });
};

const policyOf: (id: string) => StoredPolicy | undefined = (
  id: string,
): StoredPolicy | undefined => {
  const policyId: string | undefined = PROJECT_POLICIES.find(
    (candidate: string): boolean => {
      return key(candidate) === key(id);
    },
  );

  return policyId ? POLICIES[policyId] : undefined;
};

// The route's answer for `props`, about `asked`.
const askRoute: (
  props: DatabaseCommonInteractionProps,
  asked: Array<string>,
) => Promise<UserOverrideAddAccess> = async (
  props: DatabaseCommonInteractionProps,
  asked: Array<string>,
): Promise<UserOverrideAddAccess> => {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);

  const sent: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  sent.mockClear();

  const next: ReturnType<typeof jest.fn> = jest.fn();

  await mockRouter.match("post", ROUTE).handlerFunction(
    {
      params: {},
      query: {},
      headers: {},
      body: UserOverrideAddAccessUtil.requestToJSON(asked),
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  expect(next).not.toHaveBeenCalled();
  expect(sent).toHaveBeenCalledTimes(1);

  return UserOverrideAddAccessUtil.resultFromJSON(
    sent.mock.calls[0]![2] as JSONObject,
  );
};

// Whether a real create of an override on `policyId` - or a global one - goes through.
const realCreateGoesThrough: (
  props: DatabaseCommonInteractionProps,
  policyId: string | null,
) => Promise<boolean> = async (
  props: DatabaseCommonInteractionProps,
  policyId: string | null,
): Promise<boolean> => {
  const override: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();
  override.projectId = new ObjectID(PROJECT);
  override.overrideUserId = new ObjectID(USER_A);
  override.routeAlertsToUserId = new ObjectID(SAM);
  override.startsAt = NOW;
  override.endsAt = NEXT_WEEK;

  if (policyId) {
    override.onCallDutyPolicyId = new ObjectID(policyId);
  }

  try {
    await OnCallDutyPolicyUserOverrideService.create({
      data: override,
      props: { ...props },
    });
    return true;
  } catch (error) {
    // A refusal, in the words the server answers with - never a crash of the fixture.
    expect(error).toBeInstanceOf(Exception);
    return false;
  }
};

const sorted: (ids: Array<string>) => Array<string> = (
  ids: Array<string>,
): Array<string> => {
  return ids.map(key).sort();
};

beforeEach(() => {
  db = emptyDb();
  savedCount = 0;
  readablePolicies = [];

  // The project's policies and members, as the reference check reads them.
  stubProjectDirectory({
    projectId: new ObjectID(PROJECT),
    records: { OnCallDutyPolicy: PROJECT_POLICIES },
    members: [USER_A, USER_B, SAM],
    elsewhere: [ELSEWHERE_POLICY],
  });
  installFakeDb(db);
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  // A read of policies as the caller: the project's policies their read reaches.
  jest
    .spyOn(
      DatabaseService as unknown as {
        findReadableParentIds: (data: {
          parentModelType: { new (): BaseModel };
          ids: Array<string>;
        }) => Promise<Array<string>>;
      },
      "findReadableParentIds",
    )
    .mockImplementation(
      async (data: {
        parentModelType: { new (): BaseModel };
        ids: Array<string>;
      }): Promise<Array<string>> => {
        expect(new data.parentModelType().tableName).toBe("OnCallDutyPolicy");

        return data.ids.filter((id: string): boolean => {
          return readablePolicies.some((policyId: string): boolean => {
            return key(policyId) === key(id);
          });
        });
      },
    );

  // Records read by OneUptime in the project: its own policies.
  jest
    .spyOn(
      DatabaseService as unknown as {
        findIdsInProject: (data: {
          modelType: { new (): BaseModel };
          ids: Array<string>;
        }) => Promise<Array<string>>;
      },
      "findIdsInProject",
    )
    .mockImplementation(
      async (data: {
        modelType: { new (): BaseModel };
        ids: Array<string>;
      }): Promise<Array<string>> => {
        if (new data.modelType().tableName !== "OnCallDutyPolicy") {
          return [...data.ids];
        }

        return data.ids.filter(isProjectPolicy);
      },
    );

  jest
    .spyOn(
      DatabaseService as unknown as {
        findRecordLabels: (data: {
          ids: Array<string>;
        }) => Promise<Record<string, Array<string>>>;
      },
      "findRecordLabels",
    )
    .mockImplementation(
      async (data: {
        ids: Array<string>;
      }): Promise<Record<string, Array<string>>> => {
        const labels: Record<string, Array<string>> = {};

        for (const id of data.ids) {
          const policy: StoredPolicy | undefined = policyOf(id);

          if (policy) {
            labels[key(id)] = policy.labels.map(key);
          }
        }

        return labels;
      },
    );

  jest
    .spyOn(
      DatabaseService as unknown as {
        findLabelNames: (data: {
          labelIds: Array<string>;
        }) => Promise<Array<string>>;
      },
      "findLabelNames",
    )
    .mockImplementation(
      async (data: { labelIds: Array<string> }): Promise<Array<string>> => {
        return data.labelIds.map((labelId: string): string => {
          return key(labelId) === key(TEAM_A_LABEL) ? "team:a" : "team:b";
        });
      },
    );

  // Who owns which policy: Team A owns one, User A another.
  jest
    .spyOn(OnCallDutyPolicyOwnerTeamService, "findBy")
    .mockImplementation((async (args: {
      query: Record<string, unknown>;
    }): Promise<Array<OnCallDutyPolicyOwnerTeam>> => {
      const owners: Array<OnCallDutyPolicyOwnerTeam> = [];

      for (const policyId of PROJECT_POLICIES) {
        for (const teamId of POLICIES[policyId]!.ownerTeams) {
          const owner: OnCallDutyPolicyOwnerTeam =
            new OnCallDutyPolicyOwnerTeam();
          owner.onCallDutyPolicyId = new ObjectID(policyId);
          owner.teamId = new ObjectID(teamId);
          owner.projectId = new ObjectID(PROJECT);

          if (
            matchesQuery(args.query, {
              teamId: owner.teamId.toString(),
              projectId: owner.projectId.toString(),
            })
          ) {
            owners.push(owner);
          }
        }
      }

      return owners;
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyOwnerUserService, "findBy")
    .mockImplementation((async (args: {
      query: Record<string, unknown>;
    }): Promise<Array<OnCallDutyPolicyOwnerUser>> => {
      const owners: Array<OnCallDutyPolicyOwnerUser> = [];

      for (const policyId of PROJECT_POLICIES) {
        for (const userId of POLICIES[policyId]!.ownerUsers) {
          const owner: OnCallDutyPolicyOwnerUser =
            new OnCallDutyPolicyOwnerUser();
          owner.onCallDutyPolicyId = new ObjectID(policyId);
          owner.userId = new ObjectID(userId);
          owner.projectId = new ObjectID(PROJECT);

          if (
            matchesQuery(args.query, {
              userId: owner.userId.toString(),
              projectId: owner.projectId.toString(),
            })
          ) {
            owners.push(owner);
          }
        }
      }

      return owners;
    }) as never);

  // The override's table: what a real create saves.
  jest
    .spyOn(OnCallDutyPolicyUserOverrideService, "getRepository")
    .mockReturnValue({
      save: async (
        data: OnCallDutyPolicyUserOverride,
      ): Promise<OnCallDutyPolicyUserOverride> => {
        savedCount++;
        data._id = `0dd00000-0000-4000-8000-1${String(savedCount).padStart(11, "0")}`;
        db.overrides.push(data as unknown as Record<string, unknown>);
        return data;
      },
    } as never);

  // Saved under the project's lock on override times, as overlaps are refused.
  useUserOverrideTimesInMemory({
    overrides: (): Array<Record<string, unknown>> => {
      return db.overrides;
    },
    users: (): Array<Record<string, unknown>> => {
      return db.users;
    },
  });

  // What a saved override sets off: the policy feed and roster refreshes.
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyName")
    .mockResolvedValue("Payments");
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/policy"));
  jest.spyOn(UserService, "getTimezoneForUser").mockResolvedValue(null);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(FeedMarkdown.asMarkdown("a person"));
  jest
    .spyOn(OnCallDutyPolicyFeedService, "createOnCallDutyPolicyFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "refreshRostersForUserInProject")
    .mockResolvedValue(undefined);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "getScheduleIdsForUsersInProject")
    .mockResolvedValue([]);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "propagateShiftConfigChange")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the route answers what a real create does, for every grant shape", () => {
  test.each(GRANT_SHAPES)("$name", async (shape: GrantShape) => {
    readablePolicies = shape.reads;

    const access: UserOverrideAddAccess = await askRoute(shape.props, ASKED);

    expect(sorted(access.onCallDutyPolicyIds)).toEqual(
      sorted(shape.expected.onCallDutyPolicyIds),
    );
    expect(access.global).toBe(shape.expected.global);

    // Asking added nothing.
    expect(db.overrides).toHaveLength(0);

    for (const policyId of ASKED) {
      const listed: boolean = UserOverrideAddAccessUtil.mayAddOn(
        access,
        policyId,
      );

      expect({
        policyId,
        goesThrough: await realCreateGoesThrough(shape.props, policyId),
      }).toEqual({ policyId, goesThrough: listed });
    }

    expect(await realCreateGoesThrough(shape.props, null)).toBe(access.global);

    // Another project's policy, and one that does not exist, are never offered.
    expect(UserOverrideAddAccessUtil.mayAddOn(access, ELSEWHERE_POLICY)).toBe(
      false,
    );
    expect(UserOverrideAddAccessUtil.mayAddOn(access, MISSING_POLICY)).toBe(
      false,
    );
  });

  test("the shapes cover a policy offered and one left out, and a global override offered and refused", () => {
    expect(
      GRANT_SHAPES.some((shape: GrantShape): boolean => {
        return (
          !shape.expected.global &&
          shape.expected.onCallDutyPolicyIds.length > 0
        );
      }),
    ).toBe(true);
    expect(
      GRANT_SHAPES.some((shape: GrantShape): boolean => {
        return shape.expected.global;
      }),
    ).toBe(true);
  });
});

describe("asking", () => {
  const LIMITED_TO_TEAM_A: DatabaseCommonInteractionProps = asMember([
    row(Permission.OnCallMember, {
      scope: PermissionScope.Labels,
      labelIds: [TEAM_A_LABEL],
    }),
    READS_EVERY_POLICY,
  ]);

  test("about no policy answers only whether a global override may be added", async () => {
    readablePolicies = PROJECT_POLICIES;

    expect(
      await askRoute(asMember([row(Permission.OnCallMember)]), []),
    ).toEqual({ global: true, onCallDutyPolicyIds: [] });
    expect(await askRoute(LIMITED_TO_TEAM_A, [])).toEqual({
      global: false,
      onCallDutyPolicyIds: [],
    });
  });

  test("lists each policy once, whatever case it was asked in", async () => {
    readablePolicies = PROJECT_POLICIES;

    const access: UserOverrideAddAccess = await askRoute(LIMITED_TO_TEAM_A, [
      TEAM_A_POLICY,
      TEAM_A_POLICY.toUpperCase(),
      TEAM_B_POLICY,
    ]);

    expect(access.onCallDutyPolicyIds).toEqual([TEAM_A_POLICY]);
  });

  test("adds nothing and writes no feed item, whatever it is asked", async () => {
    readablePolicies = PROJECT_POLICIES;

    await askRoute(asMember([row(Permission.OnCallMember)]), ASKED);

    expect(db.overrides).toHaveLength(0);
    expect(
      OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem,
    ).not.toHaveBeenCalled();
  });

  test("an error that is no refusal is the route's error, not a policy left out", async () => {
    readablePolicies = PROJECT_POLICIES;

    jest
      .spyOn(
        DatabaseService as unknown as {
          findRecordLabels: () => Promise<Record<string, Array<string>>>;
        },
        "findRecordLabels",
      )
      .mockRejectedValue(new Error("connection lost"));

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(LIMITED_TO_TEAM_A);

    const next: ReturnType<typeof jest.fn> = jest.fn();

    await mockRouter.match("post", ROUTE).handlerFunction(
      {
        params: {},
        query: {},
        headers: {},
        body: UserOverrideAddAccessUtil.requestToJSON([TEAM_A_POLICY]),
      } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0]![0] as Error).message).toBe("connection lost");
  });
});

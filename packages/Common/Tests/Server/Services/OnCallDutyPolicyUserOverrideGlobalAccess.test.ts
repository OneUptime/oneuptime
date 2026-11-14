import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import UserService from "../../../Server/Services/UserService";
import CreateScopeException from "../../../Server/Types/Database/Permissions/CreateScopeException";
import {
  LabelNamesFinder,
  RecordLabelsFinder,
} from "../../../Server/Types/Database/Permissions/CreateScopePermission";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import OwnedScopePermission from "../../../Server/Types/Database/Permissions/OwnedScopePermission";
import logger from "../../../Server/Utils/Logger";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
  GLOBAL_USER_OVERRIDE_DELETE_REFUSAL,
  GLOBAL_USER_OVERRIDE_EDIT_REFUSAL,
} from "../../../Types/OnCallDutyPolicy/GlobalUserOverrideAccess";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import {
  FakeDb,
  emptyDb,
  installFakeDb,
} from "../Utils/OnCall/OnCallResolverTestHarness";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { useUserOverrideTimesInMemory } from "../TestingUtils/UserOverrideTimesInMemory";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A GLOBAL USER OVERRIDE TAKES A PERMISSION OVER THE WHOLE PROJECT
 * (issue #5617, Types/OnCallDutyPolicy/GlobalUserOverrideAccess).
 *
 * "Any users that have permissions to create on-call policy overrides can
 * create a global one for policies that they are not a member of. For
 * example, User A can create a global policy that overrides User B
 * regardless of team membership."
 *
 * An override on a policy already followed the policy: a team whose
 * permission to add overrides is limited to its own policies, or to its
 * label, added them there and nowhere else. A global override names no
 * policy and applies to every one, and a permission limited to labels let
 * it through all the same - a record that names no labelled record was
 * read as about none of the labels. Now adding or deleting a global
 * override takes the table's permission for it over the whole project:
 * these tests save through the real OnCallDutyPolicyUserOverrideService
 * (its hooks and every permission check; only the database is in memory)
 * and ask its delete hook, and hold the engine to what an override on a
 * policy may reach.
 *
 * On OneUptime Cloud user overrides are on the Growth plan, so this file
 * pins billing on, with the plans CI configures (packages/Common/
 * test-setup.sh), rather than following the environment it runs in.
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

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

const PROJECT: string = "0d517000-0000-4000-8000-000000000001";
// Team A's policy carries Team A's label; Team B's policy carries Team B's.
const TEAM_A_POLICY: string = "0d517000-0000-4000-8000-0000000000a2";
const TEAM_B_POLICY: string = "0d517000-0000-4000-8000-0000000000b2";
const TEAM_A_LABEL: string = "0d517000-0000-4000-8000-0000000000a3";
const TEAM_B_LABEL: string = "0d517000-0000-4000-8000-0000000000b3";
const TEAM_A: string = "0d517000-0000-4000-8000-0000000000a4";

// User A is on Team A; User B on Team B; Sam covers.
const USER_A: string = "0d517000-0000-4000-8000-0000000000a1";
const USER_B: string = "0d517000-0000-4000-8000-0000000000b1";
const SAM: string = "0d517000-0000-4000-8000-0000000000c1";

const NOW: Date = new Date("2026-11-03T12:00:00Z");
const NEXT_WEEK: Date = new Date("2026-11-10T12:00:00Z");

let db: FakeDb;
let savedCount: number;

// A row of the caller's, as AccessTokenService hands it to the request.
const row: (
  permission: Permission,
  data?: {
    scope?: PermissionScope;
    labelIds?: Array<string>;
    isBlock?: boolean;
    teamId?: string;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    scope?: PermissionScope;
    labelIds?: Array<string>;
    isBlock?: boolean;
    teamId?: string;
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
    ...(data?.teamId ? { teamId: new ObjectID(data.teamId) } : {}),
  };
};

// Reads every policy, as a project's Viewer does.
const READS_EVERY_POLICY: UserPermission = row(Permission.Viewer);

// On-Call Member, limited to Team A's label - the issue's setup.
const ON_CALL_MEMBER_ON_TEAM_A_LABEL: UserPermission = row(
  Permission.OnCallMember,
  { scope: PermissionScope.Labels, labelIds: [TEAM_A_LABEL], teamId: TEAM_A },
);

// On-Call Member, limited to the policies Team A owns.
const ON_CALL_MEMBER_ON_OWNED: UserPermission = row(Permission.OnCallMember, {
  scope: PermissionScope.Owned,
  teamId: TEAM_A,
});

// On-Call Member over the whole project.
const ON_CALL_MEMBER: UserPermission = row(Permission.OnCallMember);

const asMember: (
  userId: string,
  rows: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  userId: string,
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: new ObjectID(userId),
    userType: UserType.User,
    tenantId: new ObjectID(PROJECT),
    currentPlan: PlanType.Growth,
    isSubscriptionUnpaid: false,
    userTeamIds: [new ObjectID(TEAM_A)],
    userTenantAccessPermission: {
      [PROJECT]: {
        _type: "UserTenantAccessPermission",
        projectId: new ObjectID(PROJECT),
        permissions: rows,
      },
    },
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
    userTenantAccessPermission: {
      [PROJECT]: {
        _type: "UserTenantAccessPermission",
        projectId: new ObjectID(PROJECT),
        permissions: rows,
      },
    },
  };
};

// An override: who is away, who covers, for the next week - on one policy, or every one.
const anOverride: (data: {
  away: string;
  covers?: string | undefined;
  policyId?: string | null | undefined;
}) => OnCallDutyPolicyUserOverride = (data: {
  away: string;
  covers?: string | undefined;
  policyId?: string | null | undefined;
}): OnCallDutyPolicyUserOverride => {
  const override: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();
  override.projectId = new ObjectID(PROJECT);
  override.overrideUserId = new ObjectID(data.away);

  if (data.covers) {
    override.routeAlertsToUserId = new ObjectID(data.covers);
  }

  override.startsAt = NOW;
  override.endsAt = NEXT_WEEK;

  if (data.policyId) {
    override.onCallDutyPolicyId = new ObjectID(data.policyId);
  } else if (data.policyId === null) {
    // Sent as an explicit null, as an API caller may.
    (override as unknown as Record<string, unknown>)["onCallDutyPolicyId"] =
      null;
  }

  return override;
};

const addGlobalOverride: (
  props: DatabaseCommonInteractionProps,
  data?: { away?: string; covers?: string },
) => Promise<OnCallDutyPolicyUserOverride> = async (
  props: DatabaseCommonInteractionProps,
  data?: { away?: string; covers?: string },
): Promise<OnCallDutyPolicyUserOverride> => {
  return await OnCallDutyPolicyUserOverrideService.create({
    data: anOverride({
      away: data?.away || USER_B,
      covers: data?.covers || USER_A,
    }),
    props: props,
  });
};

const refusalOf: (promise: Promise<unknown>) => Promise<unknown> = async (
  promise: Promise<unknown>,
): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
};

beforeEach(() => {
  db = emptyDb();
  savedCount = 0;

  // The records these tests name are their project's own.
  stubProjectDirectory({});
  installFakeDb(db);
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  // The override's table: what create saves.
  jest
    .spyOn(OnCallDutyPolicyUserOverrideService, "getRepository")
    .mockReturnValue({
      save: async (
        data: OnCallDutyPolicyUserOverride,
      ): Promise<OnCallDutyPolicyUserOverride> => {
        savedCount++;
        data._id = `0d517000-0000-4000-8000-${String(savedCount).padStart(12, "0")}`;
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
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("adding a global override", () => {
  test("the issue's case: a member limited to Team A's label marks User B away on every policy - refused, and nothing is saved", async () => {
    const refusal: unknown = await refusalOf(
      addGlobalOverride(
        asMember(USER_A, [ON_CALL_MEMBER_ON_TEAM_A_LABEL, READS_EVERY_POLICY]),
      ),
    );

    expect(refusal).toBeInstanceOf(CreateScopeException);
    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect((refusal as Error).message).toBe(GLOBAL_USER_OVERRIDE_ADD_REFUSAL);
    expect(db.overrides).toHaveLength(0);
  });

  test("marking themselves away is refused the same way: a global override reaches Team B's policies too", async () => {
    await expect(
      addGlobalOverride(
        asMember(USER_A, [ON_CALL_MEMBER_ON_TEAM_A_LABEL, READS_EVERY_POLICY]),
        { away: USER_A, covers: SAM },
      ),
    ).rejects.toThrow(GLOBAL_USER_OVERRIDE_ADD_REFUSAL);
    expect(db.overrides).toHaveLength(0);
  });

  test("a member limited to the policies their team owns is refused too, in the same words", async () => {
    await expect(
      addGlobalOverride(
        asMember(USER_A, [ON_CALL_MEMBER_ON_OWNED, READS_EVERY_POLICY]),
      ),
    ).rejects.toThrow(GLOBAL_USER_OVERRIDE_ADD_REFUSAL);
    expect(db.overrides).toHaveLength(0);
  });

  test("the single permission to add overrides, limited to labels, is refused as the role is", async () => {
    await expect(
      addGlobalOverride(
        asMember(USER_A, [
          row(Permission.CreateOnCallDutyPolicyUserOverride, {
            scope: PermissionScope.Labels,
            labelIds: [TEAM_A_LABEL],
          }),
          READS_EVERY_POLICY,
        ]),
      ),
    ).rejects.toThrow(GLOBAL_USER_OVERRIDE_ADD_REFUSAL);
  });

  test("an override sent with no policy as an explicit null is global, and refused the same way", async () => {
    await expect(
      OnCallDutyPolicyUserOverrideService.create({
        data: anOverride({ away: USER_B, covers: USER_A, policyId: null }),
        props: asMember(USER_A, [
          ON_CALL_MEMBER_ON_TEAM_A_LABEL,
          READS_EVERY_POLICY,
        ]),
      }),
    ).rejects.toThrow(GLOBAL_USER_OVERRIDE_ADD_REFUSAL);
  });

  test("an API key limited to a label is refused as a member is", async () => {
    await expect(
      addGlobalOverride(
        asApiKey([ON_CALL_MEMBER_ON_TEAM_A_LABEL, READS_EVERY_POLICY]),
      ),
    ).rejects.toThrow(GLOBAL_USER_OVERRIDE_ADD_REFUSAL);
  });

  test("a member whose On-Call Member reaches the whole project adds one, as before", async () => {
    const saved: OnCallDutyPolicyUserOverride = await addGlobalOverride(
      asMember(USER_A, [ON_CALL_MEMBER]),
    );

    expect(saved.onCallDutyPolicyId).toBeFalsy();
    expect(saved.overrideUserId?.toString()).toBe(USER_B);
    expect(db.overrides).toHaveLength(1);
  });

  test("one row over the whole project is enough beside a narrower one: grants add up", async () => {
    await addGlobalOverride(
      asMember(USER_A, [ON_CALL_MEMBER_ON_TEAM_A_LABEL, ON_CALL_MEMBER]),
    );

    expect(db.overrides).toHaveLength(1);
  });

  test("the single permission to add overrides, over the whole project, adds one", async () => {
    await addGlobalOverride(
      asMember(USER_A, [
        row(Permission.CreateOnCallDutyPolicyUserOverride),
        READS_EVERY_POLICY,
      ]),
    );

    expect(db.overrides).toHaveLength(1);
  });

  test("an API key over the whole project adds one", async () => {
    await addGlobalOverride(asApiKey([ON_CALL_MEMBER]));

    expect(db.overrides).toHaveLength(1);
  });

  test("Project Member and Project Admin over the whole project add one, as before", async () => {
    await addGlobalOverride(asMember(USER_A, [row(Permission.ProjectMember)]));
    // For somebody else: one person's global overrides may not overlap.
    await addGlobalOverride(asMember(USER_A, [row(Permission.ProjectAdmin)]), {
      away: SAM,
      covers: USER_A,
    });

    expect(db.overrides).toHaveLength(2);
  });

  test("a team's block with labels on adding overrides refuses a global one: it would reach the blocked policies too", async () => {
    await expect(
      addGlobalOverride(
        asMember(USER_A, [
          ON_CALL_MEMBER,
          row(Permission.CreateOnCallDutyPolicyUserOverride, {
            isBlock: true,
            labelIds: [TEAM_B_LABEL],
          }),
        ]),
      ),
    ).rejects.toThrow(GLOBAL_USER_OVERRIDE_ADD_REFUSAL);
    expect(db.overrides).toHaveLength(0);
  });

  test("OneUptime itself adds one whatever it holds", async () => {
    await OnCallDutyPolicyUserOverrideService.create({
      data: anOverride({ away: USER_B, covers: USER_A }),
      props: { isRoot: true, tenantId: new ObjectID(PROJECT) },
    });

    expect(db.overrides).toHaveLength(1);
  });

  test("an override that names its policy one way and none the other is refused as unclear", async () => {
    const override: OnCallDutyPolicyUserOverride = anOverride({
      away: USER_B,
      covers: USER_A,
      policyId: TEAM_A_POLICY,
    });
    (override as unknown as Record<string, unknown>)["onCallDutyPolicy"] = null;

    await expect(
      OnCallDutyPolicyUserOverrideService.create({
        data: override,
        props: asMember(USER_A, [ON_CALL_MEMBER]),
      }),
    ).rejects.toThrow(BadDataException);
  });
});

/*
 * The hook asks only of a global override: an override on a policy is the
 * policy's, and the engine holds it to the caller's reach of the policy
 * (below).
 */
describe("adding an override on a policy", () => {
  test("a member limited to Team A's label is not asked for a project-wide permission", async () => {
    const createBy: {
      data: OnCallDutyPolicyUserOverride;
      props: DatabaseCommonInteractionProps;
    } = {
      data: anOverride({
        away: USER_A,
        covers: SAM,
        policyId: TEAM_A_POLICY,
      }),
      props: asMember(USER_A, [
        ON_CALL_MEMBER_ON_TEAM_A_LABEL,
        READS_EVERY_POLICY,
      ]),
    };

    await expect(
      (
        OnCallDutyPolicyUserOverrideService as unknown as {
          onBeforeCreate: (createBy: unknown) => Promise<unknown>;
        }
      ).onBeforeCreate(createBy),
    ).resolves.toEqual({ createBy, carryForward: null });
  });

  test("an override named by its relation alone is on that policy too", async () => {
    const override: OnCallDutyPolicyUserOverride = anOverride({
      away: USER_A,
      covers: SAM,
    });
    (override as unknown as Record<string, unknown>)["onCallDutyPolicy"] = {
      _id: TEAM_A_POLICY,
    };

    await expect(
      (
        OnCallDutyPolicyUserOverrideService as unknown as {
          onBeforeCreate: (createBy: unknown) => Promise<unknown>;
        }
      ).onBeforeCreate({
        data: override,
        props: asMember(USER_A, [ON_CALL_MEMBER_ON_OWNED, READS_EVERY_POLICY]),
      }),
    ).resolves.toBeTruthy();
  });
});

/*
 * WHAT AN OVERRIDE ON A POLICY MAY REACH: the policy it names, by the
 * caller's create permission's own scope - the half of #5617 that already
 * held, pinned here. A team limited to its label adds overrides on the
 * policies carrying it; a team limited to what it owns, on its own
 * policies.
 */
describe("an override on a policy follows the policy's scope", () => {
  const lookups: () => {
    findRecordLabels: RecordLabelsFinder;
    findLabelNames: LabelNamesFinder;
  } = (): {
    findRecordLabels: RecordLabelsFinder;
    findLabelNames: LabelNamesFinder;
  } => {
    const labelsByPolicy: Record<string, Array<string>> = {
      [TEAM_A_POLICY]: [TEAM_A_LABEL],
      [TEAM_B_POLICY]: [TEAM_B_LABEL],
    };

    return {
      findRecordLabels: async (data: {
        modelType: { new (): BaseModel };
        ids: Array<string>;
      }): Promise<Record<string, Array<string>>> => {
        const labels: Record<string, Array<string>> = {};

        for (const id of data.ids) {
          labels[id] = labelsByPolicy[id] || [];
        }

        return labels;
      },
      findLabelNames: async (data: {
        labelIds: Array<string>;
      }): Promise<Array<string>> => {
        return data.labelIds.map((labelId: string): string => {
          return labelId === TEAM_A_LABEL ? "team:a" : "team:b";
        });
      },
    };
  };

  const checkCreate: (data: {
    override: OnCallDutyPolicyUserOverride;
    props: DatabaseCommonInteractionProps;
  }) => Promise<void> = async (data: {
    override: OnCallDutyPolicyUserOverride;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> => {
    await ModelPermission.checkCreateScopePermission({
      modelType: OnCallDutyPolicyUserOverride,
      data: data.override,
      props: data.props,
      ...lookups(),
    });
  };

  test("limited to Team A's label: an override on Team A's policy, and none on Team B's", async () => {
    const props: DatabaseCommonInteractionProps = asMember(USER_A, [
      ON_CALL_MEMBER_ON_TEAM_A_LABEL,
    ]);

    await expect(
      checkCreate({
        override: anOverride({
          away: USER_A,
          covers: SAM,
          policyId: TEAM_A_POLICY,
        }),
        props,
      }),
    ).resolves.toBeUndefined();

    const refusal: unknown = await refusalOf(
      checkCreate({
        override: anOverride({
          away: USER_B,
          covers: USER_A,
          policyId: TEAM_B_POLICY,
        }),
        props,
      }),
    );

    expect(refusal).toBeInstanceOf(CreateScopeException);
    expect((refusal as Error).message).toContain("team:a");
  });

  test("limited to what Team A owns: an override on Team A's policy, and none on Team B's", async () => {
    const ownedIds: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      OwnedScopePermission,
      "getOwnedIds",
    ).mockResolvedValue([new ObjectID(TEAM_A_POLICY)] as never);

    const props: DatabaseCommonInteractionProps = asMember(USER_A, [
      ON_CALL_MEMBER_ON_OWNED,
    ]);

    await expect(
      checkCreate({
        override: anOverride({
          away: USER_A,
          covers: SAM,
          policyId: TEAM_A_POLICY,
        }),
        props,
      }),
    ).resolves.toBeUndefined();

    // Asked of the policies Team A - the team the permission is on - owns.
    expect(ownedIds).toHaveBeenCalledWith(OnCallDutyPolicyUserOverride, props, [
      new ObjectID(TEAM_A),
    ]);

    await expect(
      checkCreate({
        override: anOverride({
          away: USER_B,
          covers: USER_A,
          policyId: TEAM_B_POLICY,
        }),
        props,
      }),
    ).rejects.toThrow(CreateScopeException);
  });

  test("over the whole project: an override on any policy", async () => {
    const props: DatabaseCommonInteractionProps = asMember(USER_A, [
      ON_CALL_MEMBER,
    ]);

    for (const policyId of [TEAM_A_POLICY, TEAM_B_POLICY]) {
      await expect(
        checkCreate({
          override: anOverride({ away: USER_B, covers: USER_A, policyId }),
          props,
        }),
      ).resolves.toBeUndefined();
    }
  });
});

describe("deleting a global override", () => {
  const GLOBAL_OVERRIDE_ID: string = "0d517000-0000-4000-8000-0000000000d1";
  const POLICY_OVERRIDE_ID: string = "0d517000-0000-4000-8000-0000000000d2";

  // The rows a delete removes, as its hook reads them.
  const overrideRow: (data: {
    id: string;
    policyId?: string | undefined;
  }) => OnCallDutyPolicyUserOverride = (data: {
    id: string;
    policyId?: string | undefined;
  }): OnCallDutyPolicyUserOverride => {
    const override: OnCallDutyPolicyUserOverride = anOverride({
      away: USER_B,
      covers: USER_A,
      policyId: data.policyId,
    });
    override._id = data.id;
    return override;
  };

  const runDeleteHook: (data: {
    rows: Array<OnCallDutyPolicyUserOverride>;
    props: DatabaseCommonInteractionProps;
  }) => Promise<unknown> = async (data: {
    rows: Array<OnCallDutyPolicyUserOverride>;
    props: DatabaseCommonInteractionProps;
  }): Promise<unknown> => {
    getJestSpyOn(
      OnCallDutyPolicyUserOverrideService as unknown as Record<
        string,
        () => Promise<unknown>
      >,
      "findRowsAndHoldDeleteToThem",
    ).mockResolvedValue(data.rows as never);

    return await (
      OnCallDutyPolicyUserOverrideService as unknown as {
        onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
      }
    ).onBeforeDelete({
      query: { _id: data.rows[0]?._id },
      props: data.props,
    });
  };

  test("a member limited to Team A's label may not delete one: it reaches Team B's policies too", async () => {
    const refusal: unknown = await refusalOf(
      runDeleteHook({
        rows: [overrideRow({ id: GLOBAL_OVERRIDE_ID })],
        props: asMember(USER_A, [
          ON_CALL_MEMBER_ON_TEAM_A_LABEL,
          READS_EVERY_POLICY,
        ]),
      }),
    );

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect((refusal as Error).message).toBe(
      GLOBAL_USER_OVERRIDE_DELETE_REFUSAL,
    );
  });

  test("the single permission to delete overrides, limited to labels, may not either", async () => {
    await expect(
      runDeleteHook({
        rows: [overrideRow({ id: GLOBAL_OVERRIDE_ID })],
        props: asMember(USER_A, [
          row(Permission.DeleteOnCallDutyPolicyUserOverride, {
            scope: PermissionScope.Labels,
            labelIds: [TEAM_A_LABEL],
          }),
          READS_EVERY_POLICY,
        ]),
      }),
    ).rejects.toThrow(GLOBAL_USER_OVERRIDE_DELETE_REFUSAL);
  });

  test("a delete that takes a global override with an override on a policy is refused whole", async () => {
    await expect(
      runDeleteHook({
        rows: [
          overrideRow({ id: POLICY_OVERRIDE_ID, policyId: TEAM_A_POLICY }),
          overrideRow({ id: GLOBAL_OVERRIDE_ID }),
        ],
        props: asMember(USER_A, [ON_CALL_MEMBER_ON_TEAM_A_LABEL]),
      }),
    ).rejects.toThrow(GLOBAL_USER_OVERRIDE_DELETE_REFUSAL);
  });

  test("a member limited to Team A's label still deletes an override on a policy: the record rule holds it to the policy", async () => {
    const onDelete: { carryForward: Array<unknown> } = (await runDeleteHook({
      rows: [overrideRow({ id: POLICY_OVERRIDE_ID, policyId: TEAM_A_POLICY })],
      props: asMember(USER_A, [ON_CALL_MEMBER_ON_TEAM_A_LABEL]),
    })) as { carryForward: Array<unknown> };

    expect(onDelete.carryForward).toHaveLength(1);
  });

  test("a member over the whole project deletes one, as before", async () => {
    const onDelete: { carryForward: Array<unknown> } = (await runDeleteHook({
      rows: [overrideRow({ id: GLOBAL_OVERRIDE_ID })],
      props: asMember(USER_A, [ON_CALL_MEMBER]),
    })) as { carryForward: Array<unknown> };

    expect(onDelete.carryForward).toHaveLength(1);
  });

  test("OneUptime itself deletes one: the overrides of someone who leaves the project go", async () => {
    const onDelete: { carryForward: Array<unknown> } = (await runDeleteHook({
      rows: [overrideRow({ id: GLOBAL_OVERRIDE_ID })],
      props: { isRoot: true },
    })) as { carryForward: Array<unknown> };

    expect(onDelete.carryForward).toHaveLength(1);
  });

  test("a master admin deletes one", async () => {
    await expect(
      runDeleteHook({
        rows: [overrideRow({ id: GLOBAL_OVERRIDE_ID })],
        props: { isMasterAdmin: true, userId: new ObjectID(USER_A) },
      }),
    ).resolves.toBeTruthy();
  });
});

/*
 * EDITING ONE TAKES THE SAME GRANT (issue #7631): an override can now be
 * edited - who covers, when it starts and ends - and a global one is
 * edited only with the permission to edit overrides over the whole
 * project, as it is added and deleted. An override on a policy is the
 * policy's: the engine holds the edit to the caller's reach of it.
 */
describe("editing a global override", () => {
  const GLOBAL_OVERRIDE_ID: string = "0d517000-0000-4000-8000-0000000000e1";
  const POLICY_OVERRIDE_ID: string = "0d517000-0000-4000-8000-0000000000e2";

  // The rows an edit writes, as its hook reads them.
  const overrideRow: (data: {
    id: string;
    policyId?: string | undefined;
  }) => OnCallDutyPolicyUserOverride = (data: {
    id: string;
    policyId?: string | undefined;
  }): OnCallDutyPolicyUserOverride => {
    const override: OnCallDutyPolicyUserOverride = anOverride({
      away: USER_B,
      covers: USER_A,
      policyId: data.policyId,
    });
    override._id = data.id;
    return override;
  };

  // The edit's hook, ending the override a day later than it does.
  const runUpdateHook: (data: {
    rows: Array<OnCallDutyPolicyUserOverride>;
    props: DatabaseCommonInteractionProps;
  }) => Promise<unknown> = async (data: {
    rows: Array<OnCallDutyPolicyUserOverride>;
    props: DatabaseCommonInteractionProps;
  }): Promise<unknown> => {
    getJestSpyOn(
      OnCallDutyPolicyUserOverrideService as unknown as Record<
        string,
        () => Promise<unknown>
      >,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue(data.rows as never);

    return await (
      OnCallDutyPolicyUserOverrideService as unknown as {
        onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
      }
    ).onBeforeUpdate({
      query: { _id: data.rows[0]?._id },
      data: { endsAt: OneUptimeDate.addRemoveDays(NEXT_WEEK, 1) },
      props: data.props,
    });
  };

  // How many overrides the hook hands on for the feed: the ones edited.
  const editedCount: (onUpdate: unknown) => number = (
    onUpdate: unknown,
  ): number => {
    return (onUpdate as { carryForward: { before: Array<unknown> } })
      .carryForward.before.length;
  };

  test("a member limited to Team A's label may not edit one: it reaches Team B's policies too", async () => {
    const refusal: unknown = await refusalOf(
      runUpdateHook({
        rows: [overrideRow({ id: GLOBAL_OVERRIDE_ID })],
        props: asMember(USER_A, [
          ON_CALL_MEMBER_ON_TEAM_A_LABEL,
          READS_EVERY_POLICY,
        ]),
      }),
    );

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect((refusal as Error).message).toBe(GLOBAL_USER_OVERRIDE_EDIT_REFUSAL);
  });

  test("a member limited to the policies their team owns may not either", async () => {
    await expect(
      runUpdateHook({
        rows: [overrideRow({ id: GLOBAL_OVERRIDE_ID })],
        props: asMember(USER_A, [ON_CALL_MEMBER_ON_OWNED, READS_EVERY_POLICY]),
      }),
    ).rejects.toThrow(GLOBAL_USER_OVERRIDE_EDIT_REFUSAL);
  });

  test("the single permission to edit overrides, limited to labels, may not either", async () => {
    await expect(
      runUpdateHook({
        rows: [overrideRow({ id: GLOBAL_OVERRIDE_ID })],
        props: asMember(USER_A, [
          row(Permission.EditOnCallDutyPolicyUserOverride, {
            scope: PermissionScope.Labels,
            labelIds: [TEAM_A_LABEL],
          }),
          READS_EVERY_POLICY,
        ]),
      }),
    ).rejects.toThrow(GLOBAL_USER_OVERRIDE_EDIT_REFUSAL);
  });

  test("the permission to add overrides over the whole project is not the permission to edit them", async () => {
    await expect(
      runUpdateHook({
        rows: [overrideRow({ id: GLOBAL_OVERRIDE_ID })],
        props: asMember(USER_A, [
          row(Permission.CreateOnCallDutyPolicyUserOverride),
          READS_EVERY_POLICY,
        ]),
      }),
    ).rejects.toThrow(GLOBAL_USER_OVERRIDE_EDIT_REFUSAL);
  });

  test("an edit that takes a global override with an override on a policy is refused whole", async () => {
    await expect(
      runUpdateHook({
        rows: [
          overrideRow({ id: POLICY_OVERRIDE_ID, policyId: TEAM_A_POLICY }),
          overrideRow({ id: GLOBAL_OVERRIDE_ID }),
        ],
        props: asMember(USER_A, [ON_CALL_MEMBER_ON_TEAM_A_LABEL]),
      }),
    ).rejects.toThrow(GLOBAL_USER_OVERRIDE_EDIT_REFUSAL);
  });

  test("a member limited to Team A's label still edits an override on a policy: the record rule holds it to the policy", async () => {
    expect(
      editedCount(
        await runUpdateHook({
          rows: [
            overrideRow({ id: POLICY_OVERRIDE_ID, policyId: TEAM_A_POLICY }),
          ],
          props: asMember(USER_A, [ON_CALL_MEMBER_ON_TEAM_A_LABEL]),
        }),
      ),
    ).toBe(1);
  });

  test("a member over the whole project edits one", async () => {
    expect(
      editedCount(
        await runUpdateHook({
          rows: [overrideRow({ id: GLOBAL_OVERRIDE_ID })],
          props: asMember(USER_A, [ON_CALL_MEMBER]),
        }),
      ),
    ).toBe(1);
  });

  test("the single permission to edit overrides, over the whole project, edits one", async () => {
    expect(
      editedCount(
        await runUpdateHook({
          rows: [overrideRow({ id: GLOBAL_OVERRIDE_ID })],
          props: asMember(USER_A, [
            row(Permission.EditOnCallDutyPolicyUserOverride),
            READS_EVERY_POLICY,
          ]),
        }),
      ),
    ).toBe(1);
  });

  test("an API key over the whole project edits one; limited to a label it may not", async () => {
    expect(
      editedCount(
        await runUpdateHook({
          rows: [overrideRow({ id: GLOBAL_OVERRIDE_ID })],
          props: asApiKey([ON_CALL_MEMBER]),
        }),
      ),
    ).toBe(1);

    await expect(
      runUpdateHook({
        rows: [overrideRow({ id: GLOBAL_OVERRIDE_ID })],
        props: asApiKey([ON_CALL_MEMBER_ON_TEAM_A_LABEL, READS_EVERY_POLICY]),
      }),
    ).rejects.toThrow(GLOBAL_USER_OVERRIDE_EDIT_REFUSAL);
  });

  test("OneUptime itself and a master admin edit one", async () => {
    expect(
      editedCount(
        await runUpdateHook({
          rows: [overrideRow({ id: GLOBAL_OVERRIDE_ID })],
          props: { isRoot: true },
        }),
      ),
    ).toBe(1);

    expect(
      editedCount(
        await runUpdateHook({
          rows: [overrideRow({ id: GLOBAL_OVERRIDE_ID })],
          props: { isMasterAdmin: true, userId: new ObjectID(USER_A) },
        }),
      ),
    ).toBe(1);
  });
});

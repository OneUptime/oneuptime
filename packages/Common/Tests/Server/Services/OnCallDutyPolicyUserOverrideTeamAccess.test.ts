import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import CreateScopeException from "../../../Server/Types/Database/Permissions/CreateScopeException";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import HeldPermissionsUtil from "../../../Types/HeldPermissions";
import ObjectID from "../../../Types/ObjectID";
import { GLOBAL_USER_OVERRIDE_ADD_REFUSAL } from "../../../Types/OnCallDutyPolicy/GlobalUserOverrideAccess";
import {
  USER_OVERRIDE_TEAM_AWAY_REFUSAL,
  USER_OVERRIDE_TEAM_COVER_REFUSAL,
  USER_OVERRIDE_TEAM_DELETE_REFUSAL,
  USER_OVERRIDE_TEAM_EDIT_REFUSAL,
  USER_OVERRIDE_TEAM_NO_TEAM_REFUSAL,
} from "../../../Types/OnCallDutyPolicy/UserOverrideTeamAccess";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { InMemoryTable, StoredRow } from "../TestingUtils/InMemoryRepository";
import {
  ADD_ENDS,
  ADD_STARTS,
  ALICE,
  BOB,
  CAROL,
  DAVE,
  ERIN,
  EVERYONE,
  MOBILE,
  ON_MOBILE,
  ON_PAYMENTS,
  OTHER_POLICY,
  OUTSIDER_AWAY,
  OUTSIDER_COVERS,
  OUTSIDER_ON_OTHER_POLICY,
  OUTSIDER_ON_POLICY,
  PAT,
  PAYMENTS,
  PAYMENTS_LABEL,
  POLICY,
  PROJECT,
  READS,
  RUNNING_ENDS,
  RUNNING_OUTSIDER,
  RUNNING_TEAM,
  TEAM_GLOBAL,
  TEAM_PERMISSION,
  TEAM_SKIP_ON_POLICY,
  UserOverrideTeamWorld,
  apiKey,
  installUserOverrideTeamWorld,
  member,
  newOverride,
  row,
  rowsAtStart,
  teamScoped,
} from "../TestingUtils/UserOverrideTeamWorld";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";
import { FindOperator } from "typeorm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * USER OVERRIDES FOR THE PEOPLE OF ONE'S OWN TEAM (issue #9733).
 *
 * "Implement a new permission that restricts edit and creation access
 * strictly to the user's assigned teams." Manage On-Call Policy User
 * Overrides for Own Team adds, edits and deletes overrides only when the
 * person who is away - and the person who covers, when somebody does - are
 * accepted members of a team that gives the permission
 * (Types/OnCallDutyPolicy/UserOverrideTeamAccess).
 *
 * These run every add, edit and delete through the real
 * OnCallDutyPolicyUserOverrideService - its permission checks, its hooks,
 * the lock override times are written under - with the override table in
 * memory and the project's team memberships answered from the list below
 * (TestingUtils/UserOverrideTeamWorld). The few cases whose grants are
 * narrowed to labels on an edit or a delete ask the hooks themselves, the
 * record rule's answer simulated as the engine reaches labels
 * (simulateRecordRule). OnCallDutyPolicyUserOverrideTeamAccessAPI drives
 * the same world through the API's routes.
 *
 * The project:
 *
 *   Payments: Alice, Bob, Dave - and Pat, invited, not yet accepted
 *   Mobile:   Carol, Dave
 *   Everyone: Alice, Bob, Carol, Dave, Erin - the team that lets everybody
 *             read the on-call pages, and gives nobody the permission
 *
 * Alice, the caller, holds the permission through Payments.
 */

jest.mock("../../../Server/Utils/Logger");

let world: UserOverrideTeamWorld;
let table: InMemoryTable;

const add: (data: {
  away: string;
  covers?: string | undefined;
  policyId?: string | undefined;
  props?: DatabaseCommonInteractionProps | undefined;
}) => Promise<OnCallDutyPolicyUserOverride> = async (data: {
  away: string;
  covers?: string | undefined;
  policyId?: string | undefined;
  props?: DatabaseCommonInteractionProps | undefined;
}): Promise<OnCallDutyPolicyUserOverride> => {
  return await OnCallDutyPolicyUserOverrideService.create({
    data: newOverride(data),
    props: data.props || teamScoped(),
  });
};

const edit: (
  id: string,
  data: Record<string, unknown>,
  props?: DatabaseCommonInteractionProps,
) => Promise<void> = async (
  id: string,
  data: Record<string, unknown>,
  props?: DatabaseCommonInteractionProps,
): Promise<void> => {
  await OnCallDutyPolicyUserOverrideService.updateOneById({
    id: new ObjectID(id),
    data: data as never,
    props: props || teamScoped(),
  });
};

const remove: (
  id: string,
  props?: DatabaseCommonInteractionProps,
) => Promise<number> = async (
  id: string,
  props?: DatabaseCommonInteractionProps,
): Promise<number> => {
  return await OnCallDutyPolicyUserOverrideService.deleteOneById({
    id: new ObjectID(id),
    props: props || teamScoped(),
  });
};

const refusalOf: (promise: Promise<unknown>) => Promise<Error> = async (
  promise: Promise<unknown>,
): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected the write to be refused, but it went through.");
};

const storedValue: (id: string, column: string) => string | null = (
  id: string,
  column: string,
): string | null => {
  const value: unknown = table.get(id)?.[column];

  return value === null || value === undefined
    ? null
    : String(value).toLowerCase();
};

// The overrides saved by adds.
const added: () => Array<StoredRow> = (): Array<StoredRow> => {
  return table.inserts;
};

beforeEach(() => {
  world = installUserOverrideTeamWorld();
  table = world.table;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("adding an override", () => {
  test("for two people of the team that gives the permission: Bob away, Dave covering", async () => {
    const saved: OnCallDutyPolicyUserOverride = await add({
      away: BOB,
      covers: DAVE,
    });

    expect(saved.overrideUserId?.toString().toLowerCase()).toBe(BOB);
    expect(added()).toHaveLength(1);
  });

  test("for themselves, a teammate covering - the dialog's own start", async () => {
    await add({ away: ALICE, covers: BOB });

    expect(added()).toHaveLength(1);
  });

  test("a skip: the person away in the team, the rotation covering", async () => {
    await add({ away: BOB });

    expect(added()).toHaveLength(1);
    expect(added()[0]!["routeAlertsToUserId"] ?? null).toBeNull();
  });

  test("on a policy, as on every policy", async () => {
    await add({ away: BOB, covers: DAVE, policyId: OTHER_POLICY });

    expect(added()).toHaveLength(1);
  });

  test("somebody of another team away is refused, saying who, and nothing is saved", async () => {
    const refusal: Error = await refusalOf(add({ away: CAROL, covers: BOB }));

    expect(refusal).toBeInstanceOf(CreateScopeException);
    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal.message).toBe(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
    expect(added()).toHaveLength(0);
    expect(world.feedItemCount()).toBe(0);
  });

  test("somebody of another team covering is refused, saying who", async () => {
    const refusal: Error = await refusalOf(add({ away: BOB, covers: CAROL }));

    expect(refusal).toBeInstanceOf(CreateScopeException);
    expect(refusal.message).toBe(USER_OVERRIDE_TEAM_COVER_REFUSAL);
    expect(added()).toHaveLength(0);
  });

  test("on a policy, somebody of another team is refused the same way", async () => {
    await expect(
      add({ away: BOB, covers: CAROL, policyId: OTHER_POLICY }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_COVER_REFUSAL);
    expect(added()).toHaveLength(0);
  });

  test("a team of the caller's that does not give the permission reaches nobody: Erin shares only Everyone with Alice", async () => {
    await expect(add({ away: ERIN, covers: BOB })).rejects.toThrow(
      USER_OVERRIDE_TEAM_AWAY_REFUSAL,
    );
    await expect(add({ away: BOB, covers: ERIN })).rejects.toThrow(
      USER_OVERRIDE_TEAM_COVER_REFUSAL,
    );
    expect(added()).toHaveLength(0);
  });

  test("an invitation not accepted yet is no membership: Pat is not in Payments yet", async () => {
    await expect(add({ away: PAT, covers: BOB })).rejects.toThrow(
      USER_OVERRIDE_TEAM_AWAY_REFUSAL,
    );
    await expect(add({ away: BOB, covers: PAT })).rejects.toThrow(
      USER_OVERRIDE_TEAM_COVER_REFUSAL,
    );
  });

  test("somebody who is in no team of the project at all is outside it", async () => {
    await expect(
      add({ away: "9733aaaa-0000-4000-8000-0000000000c9", covers: BOB }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
  });

  test("given by two teams, each team's people: Carol of Mobile away, Bob of Payments covering", async () => {
    await add({
      away: CAROL,
      covers: BOB,
      props: member([READS, ON_PAYMENTS, ON_MOBILE]),
    });

    expect(added()).toHaveLength(1);
  });

  test("a person of either team counts: Dave is in both", async () => {
    await add({
      away: DAVE,
      covers: CAROL,
      props: member([READS, ON_MOBILE]),
    });

    expect(added()).toHaveLength(1);
  });

  test("ids are compared without case", async () => {
    await add({ away: BOB.toUpperCase(), covers: DAVE.toUpperCase() });

    expect(added()).toHaveLength(1);
  });

  test("an API key holds the permission through no team, so it reaches nobody, and says why", async () => {
    const refusal: Error = await refusalOf(
      add({
        away: BOB,
        covers: DAVE,
        props: apiKey([row(Permission.OnCallViewer), row(TEAM_PERMISSION)]),
      }),
    );

    expect(refusal).toBeInstanceOf(CreateScopeException);
    expect(refusal.message).toBe(USER_OVERRIDE_TEAM_NO_TEAM_REFUSAL);
    expect(added()).toHaveLength(0);
  });

  test("an override sent under the relations' names is held to the rule too", async () => {
    const override: OnCallDutyPolicyUserOverride =
      new OnCallDutyPolicyUserOverride();
    override.projectId = new ObjectID(PROJECT);
    (override as unknown as Record<string, unknown>)["overrideUser"] = {
      _id: BOB,
    };
    (override as unknown as Record<string, unknown>)["routeAlertsToUser"] = {
      _id: CAROL,
    };
    override.startsAt = ADD_STARTS;
    override.endsAt = ADD_ENDS;

    await expect(
      OnCallDutyPolicyUserOverrideService.create({
        data: override,
        props: teamScoped(),
      }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_COVER_REFUSAL);
    expect(added()).toHaveLength(0);
  });
});

describe("editing an override", () => {
  test("of two people of the team: when it ends", async () => {
    const endsAt: Date = new Date("2026-11-20T18:00:00.000Z");

    await edit(TEAM_GLOBAL, { endsAt: endsAt });

    expect(
      OneUptimeDate.fromString(table.get(TEAM_GLOBAL)!["endsAt"] as Date),
    ).toEqual(endsAt);
  });

  test("of two people of the team: another teammate covers", async () => {
    await edit(TEAM_GLOBAL, { routeAlertsToUserId: new ObjectID(ALICE) });

    expect(storedValue(TEAM_GLOBAL, "routeAlertsToUserId")).toBe(ALICE);
  });

  test("of two people of the team: nobody covers - a skip", async () => {
    await edit(TEAM_GLOBAL, { routeAlertsToUserId: null });

    expect(storedValue(TEAM_GLOBAL, "routeAlertsToUserId")).toBeNull();
  });

  test("a skip of a teammate gets a teammate to cover", async () => {
    await edit(TEAM_SKIP_ON_POLICY, {
      routeAlertsToUserId: new ObjectID(DAVE),
    });

    expect(storedValue(TEAM_SKIP_ON_POLICY, "routeAlertsToUserId")).toBe(DAVE);
  });

  test("changing who covers to somebody of another team is refused, and nothing changes", async () => {
    const refusal: Error = await refusalOf(
      edit(TEAM_GLOBAL, { routeAlertsToUserId: new ObjectID(CAROL) }),
    );

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal.message).toBe(USER_OVERRIDE_TEAM_COVER_REFUSAL);
    expect(storedValue(TEAM_GLOBAL, "routeAlertsToUserId")).toBe(DAVE);
    expect(table.updates).toHaveLength(0);
  });

  test("so is a cover sent under its relation's name", async () => {
    await expect(
      edit(TEAM_GLOBAL, { routeAlertsToUser: { _id: ERIN } }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_COVER_REFUSAL);
    expect(storedValue(TEAM_GLOBAL, "routeAlertsToUserId")).toBe(DAVE);
  });

  test("an override whose person away is of another team is not the caller's to change, even only its end", async () => {
    const refusal: Error = await refusalOf(
      edit(OUTSIDER_AWAY, { endsAt: new Date("2026-11-20T16:00:00.000Z") }),
    );

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal.message).toBe(USER_OVERRIDE_TEAM_EDIT_REFUSAL);
    expect(table.updates).toHaveLength(0);
  });

  test("nor one whose cover is of another team - not even to put a teammate in their place", async () => {
    await expect(
      edit(OUTSIDER_COVERS, { routeAlertsToUserId: new ObjectID(BOB) }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_EDIT_REFUSAL);
    await expect(
      edit(OUTSIDER_COVERS, { routeAlertsToUserId: null }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_EDIT_REFUSAL);
    expect(storedValue(OUTSIDER_COVERS, "routeAlertsToUserId")).toBe(CAROL);
  });

  test("who is away cannot be changed, to anyone: the column takes no change", async () => {
    for (const person of [DAVE, CAROL]) {
      const refusal: Error = await refusalOf(
        edit(TEAM_GLOBAL, { overrideUserId: new ObjectID(person) }),
      );

      // Refused by the column, or - for somebody outside - by the team rule first.
      expect(
        refusal instanceof NotAuthorizedException ||
          refusal instanceof BadDataException,
      ).toBe(true);
    }

    expect(storedValue(TEAM_GLOBAL, "overrideUserId")).toBe(BOB);
    expect(table.updates).toHaveLength(0);
  });

  test("an outsider's override cannot be taken over by renaming who is away to a teammate", async () => {
    await expect(
      edit(OUTSIDER_AWAY, {
        overrideUserId: new ObjectID(BOB),
        routeAlertsToUserId: new ObjectID(DAVE),
      }),
    ).rejects.toThrow();
    expect(storedValue(OUTSIDER_AWAY, "overrideUserId")).toBe(CAROL);
    expect(storedValue(OUTSIDER_AWAY, "routeAlertsToUserId")).toBe(BOB);
  });

  test("End Now on a teammate's override under way ends it", async () => {
    const endsAt: Date = await OnCallDutyPolicyUserOverrideService.endNow({
      id: new ObjectID(RUNNING_TEAM),
      props: teamScoped(),
    });

    expect(
      OneUptimeDate.fromString(table.get(RUNNING_TEAM)!["endsAt"] as Date),
    ).toEqual(endsAt);
  });

  test("End Now on an outsider's override under way is refused, and it runs on", async () => {
    await expect(
      OnCallDutyPolicyUserOverrideService.endNow({
        id: new ObjectID(RUNNING_OUTSIDER),
        props: teamScoped(),
      }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_EDIT_REFUSAL);
    expect(
      OneUptimeDate.fromString(table.get(RUNNING_OUTSIDER)!["endsAt"] as Date),
    ).toEqual(RUNNING_ENDS);
  });

  test("an API key holding it through no team changes nothing, and says why", async () => {
    await expect(
      edit(
        TEAM_GLOBAL,
        { routeAlertsToUserId: new ObjectID(ALICE) },
        apiKey([row(Permission.OnCallViewer), row(TEAM_PERMISSION)]),
      ),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_NO_TEAM_REFUSAL);
    expect(storedValue(TEAM_GLOBAL, "routeAlertsToUserId")).toBe(DAVE);
  });

  test("an edit of several overrides at once is refused whole when one names an outsider", async () => {
    const refusal: Error = await refusalOf(
      OnCallDutyPolicyUserOverrideService.updateBy({
        query: { projectId: new ObjectID(PROJECT) },
        data: { endsAt: new Date("2026-11-22T09:00:00.000Z") } as never,
        skip: 0,
        limit: 100,
        props: teamScoped(),
      }),
    );

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal.message).toBe(USER_OVERRIDE_TEAM_EDIT_REFUSAL);
    expect(table.updates).toHaveLength(0);
  });

  test("an edit of several overrides of the team's people goes through", async () => {
    await OnCallDutyPolicyUserOverrideService.updateBy({
      query: {
        _id: QueryHelper.any([TEAM_GLOBAL, TEAM_SKIP_ON_POLICY]),
      },
      data: { endsAt: new Date("2026-11-20T18:00:00.000Z") } as never,
      skip: 0,
      limit: 100,
      props: teamScoped(),
    });

    expect(
      table.updates
        .map((update: { id: string }): string => {
          return update.id.toLowerCase();
        })
        .sort(),
    ).toEqual([TEAM_GLOBAL, TEAM_SKIP_ON_POLICY].sort());
  });
});

describe("deleting an override", () => {
  test("of two people of the team", async () => {
    expect(await remove(TEAM_GLOBAL)).toBe(1);
    expect(table.get(TEAM_GLOBAL)).toBeUndefined();
  });

  test("of a teammate's skip on a policy, said in the policy's feed", async () => {
    expect(await remove(TEAM_SKIP_ON_POLICY)).toBe(1);
    expect(world.feedItemCount()).toBe(1);
  });

  test("one that names somebody of another team is refused, kept, and never said in a feed", async () => {
    for (const id of [OUTSIDER_AWAY, OUTSIDER_COVERS, OUTSIDER_ON_POLICY]) {
      const refusal: Error = await refusalOf(remove(id));

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal.message).toBe(USER_OVERRIDE_TEAM_DELETE_REFUSAL);
      expect(table.get(id)).toBeDefined();
    }

    expect(table.deletes).toHaveLength(0);
    expect(world.feedItemCount()).toBe(0);
  });

  test("a delete of several overrides at once is refused whole when one names an outsider", async () => {
    await expect(
      OnCallDutyPolicyUserOverrideService.deleteBy({
        query: { projectId: new ObjectID(PROJECT) },
        skip: 0,
        limit: 100,
        props: teamScoped(),
      }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_DELETE_REFUSAL);

    expect(table.rows).toHaveLength(rowsAtStart().length);
    expect(world.feedItemCount()).toBe(0);
  });

  test("an API key holding it through no team deletes nothing", async () => {
    await expect(
      remove(
        TEAM_GLOBAL,
        apiKey([row(Permission.OnCallViewer), row(TEAM_PERMISSION)]),
      ),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_NO_TEAM_REFUSAL);
    expect(table.get(TEAM_GLOBAL)).toBeDefined();
  });
});

/*
 * Whoever holds a permission that reaches every person manages every
 * override as before, whatever else they hold - the team permission
 * included - and the team rule reads no membership for them.
 */
describe("a permission that reaches every person is not narrowed", () => {
  const EVERYONE_GRANTS: Array<[string, Array<UserPermission>]> = [
    ["On-Call Member", [row(Permission.OnCallMember, { teamId: EVERYONE })]],
    ["On-Call Admin", [row(Permission.OnCallAdmin, { teamId: EVERYONE })]],
    ["Project Member", [row(Permission.ProjectMember, { teamId: EVERYONE })]],
    ["Project Admin", [row(Permission.ProjectAdmin, { teamId: EVERYONE })]],
    ["Project Owner", [row(Permission.ProjectOwner, { teamId: EVERYONE })]],
    [
      "On-Call Member, beside the team permission",
      [row(Permission.OnCallMember, { teamId: EVERYONE }), ON_PAYMENTS],
    ],
    [
      "the single permissions, beside the team permission",
      [
        READS,
        ON_PAYMENTS,
        row(Permission.CreateOnCallDutyPolicyUserOverride, {
          teamId: EVERYONE,
        }),
        row(Permission.EditOnCallDutyPolicyUserOverride, {
          teamId: EVERYONE,
        }),
        row(Permission.DeleteOnCallDutyPolicyUserOverride, {
          teamId: EVERYONE,
        }),
      ],
    ],
  ];

  test.each(EVERYONE_GRANTS)(
    "%s adds, edits and deletes overrides of anyone",
    async (_name: string, rows: Array<UserPermission>) => {
      await add({ away: CAROL, covers: ERIN, props: member(rows) });
      await edit(
        OUTSIDER_AWAY,
        { routeAlertsToUserId: new ObjectID(ERIN) },
        member(rows),
      );
      await OnCallDutyPolicyUserOverrideService.endNow({
        id: new ObjectID(RUNNING_OUTSIDER),
        props: member(rows),
      });
      expect(await remove(OUTSIDER_COVERS, member(rows))).toBe(1);

      expect(added()).toHaveLength(1);
      expect(storedValue(OUTSIDER_AWAY, "routeAlertsToUserId")).toBe(ERIN);
      expect(world.membershipReads()).toBe(0);
    },
  );

  test("a master admin and OneUptime itself, too", async () => {
    await add({
      away: CAROL,
      covers: ERIN,
      props: {
        userId: new ObjectID(ALICE),
        tenantId: new ObjectID(PROJECT),
        isMasterAdmin: true,
        ...ON_HIGHEST_PLAN,
      },
    });
    expect(
      await remove(OUTSIDER_AWAY, {
        isRoot: true,
        tenantId: new ObjectID(PROJECT),
      }),
    ).toBe(1);

    expect(added()).toHaveLength(1);
    expect(world.membershipReads()).toBe(0);
  });

  test("an API key with the single permissions over the whole project, as before", async () => {
    await add({
      away: CAROL,
      covers: ERIN,
      props: apiKey([
        row(Permission.OnCallViewer),
        row(Permission.CreateOnCallDutyPolicyUserOverride),
        row(TEAM_PERMISSION),
      ]),
    });

    expect(added()).toHaveLength(1);
  });

  test("somebody without the team permission is refused by the table, as before - never by the team rule", async () => {
    const refusal: Error = await refusalOf(
      add({ away: BOB, covers: DAVE, props: member([READS]) }),
    );

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal.message).not.toBe(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
    expect(refusal.message).not.toBe(USER_OVERRIDE_TEAM_NO_TEAM_REFUSAL);
    expect(world.membershipReads()).toBe(0);
  });

  test("a block on the team permission takes it away, as any block does", async () => {
    await expect(
      add({
        away: BOB,
        covers: DAVE,
        props: member([
          READS,
          ON_PAYMENTS,
          row(TEAM_PERMISSION, { teamId: MOBILE, isBlock: true }),
        ]),
      }),
    ).rejects.toThrow(NotAuthorizedException);
    expect(added()).toHaveLength(0);
  });
});

/*
 * Grants narrowed to labels add up with the team's, as grants do: where a
 * permission that reaches every person reaches the policy, nothing more is
 * asked; elsewhere the team rule holds. A team's own grant narrowed to a
 * label reaches its people on the policies carrying it only.
 */
describe("narrowed grants, beside the team permission", () => {
  // Alice may add overrides of anyone on the payments policy, and of Payments' people anywhere.
  const ANYONE_ON_PAYMENTS_POLICY: () => DatabaseCommonInteractionProps =
    (): DatabaseCommonInteractionProps => {
      return member([
        READS,
        ON_PAYMENTS,
        row(Permission.CreateOnCallDutyPolicyUserOverride, {
          teamId: EVERYONE,
          scope: PermissionScope.Labels,
          labelIds: [PAYMENTS_LABEL],
        }),
      ]);
    };

  test("an add on a policy the narrowed permission reaches names anyone", async () => {
    await add({
      away: CAROL,
      covers: ERIN,
      policyId: POLICY,
      props: ANYONE_ON_PAYMENTS_POLICY(),
    });

    expect(added()).toHaveLength(1);
  });

  test("an add on a policy it does not reach is held to the team", async () => {
    await expect(
      add({
        away: CAROL,
        covers: ERIN,
        policyId: OTHER_POLICY,
        props: ANYONE_ON_PAYMENTS_POLICY(),
      }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_AWAY_REFUSAL);

    await add({
      away: BOB,
      covers: DAVE,
      policyId: OTHER_POLICY,
      props: ANYONE_ON_PAYMENTS_POLICY(),
    });

    expect(added()).toHaveLength(1);
  });

  test("a global override, which the narrowed permission cannot make, is held to the team", async () => {
    await expect(
      add({ away: CAROL, covers: ERIN, props: ANYONE_ON_PAYMENTS_POLICY() }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
  });

  // Payments' grant reaches the payments policy only; Mobile's, every policy.
  const PAYMENTS_ON_LABEL_MOBILE_EVERYWHERE: () => DatabaseCommonInteractionProps =
    (): DatabaseCommonInteractionProps => {
      return member([
        READS,
        row(TEAM_PERMISSION, {
          teamId: PAYMENTS,
          scope: PermissionScope.Labels,
          labelIds: [PAYMENTS_LABEL],
        }),
        ON_MOBILE,
      ]);
    };

  test("on the policy both teams' grants reach, the people of both", async () => {
    await add({
      away: BOB,
      covers: CAROL,
      policyId: POLICY,
      props: PAYMENTS_ON_LABEL_MOBILE_EVERYWHERE(),
    });

    expect(added()).toHaveLength(1);
  });

  test("on a policy only Mobile's grant reaches, Mobile's people only: Bob of Payments is refused", async () => {
    await expect(
      add({
        away: BOB,
        covers: DAVE,
        policyId: OTHER_POLICY,
        props: PAYMENTS_ON_LABEL_MOBILE_EVERYWHERE(),
      }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_AWAY_REFUSAL);

    await add({
      away: CAROL,
      covers: DAVE,
      policyId: OTHER_POLICY,
      props: PAYMENTS_ON_LABEL_MOBILE_EVERYWHERE(),
    });

    expect(added()).toHaveLength(1);
  });

  test("a team's grant narrowed to a label makes no global override: the global rule refuses it first", async () => {
    await expect(
      add({
        away: BOB,
        covers: DAVE,
        props: member([
          READS,
          row(TEAM_PERMISSION, {
            teamId: PAYMENTS,
            scope: PermissionScope.Labels,
            labelIds: [PAYMENTS_LABEL],
          }),
        ]),
      }),
    ).rejects.toThrow(GLOBAL_USER_OVERRIDE_ADD_REFUSAL);
  });

  /*
   * An edit and a delete ask the record rule which overrides a set of rows
   * reaches. Its answer is simulated here as the engine gives it for these
   * grants: a row over the whole project reaches every override, a row
   * limited to the payments label the overrides on the payments policy.
   */
  const simulateRecordRule: () => void = (): void => {
    const reachedIds: (
      props: DatabaseCommonInteractionProps,
      query: Record<string, unknown>,
      permissions: Array<Permission>,
    ) => Array<string> = (
      props: DatabaseCommonInteractionProps,
      query: Record<string, unknown>,
      permissions: Array<Permission>,
    ): Array<string> => {
      const condition: FindOperator<unknown> = query[
        "_id"
      ] as FindOperator<unknown>;
      const asked: Array<string> = (
        Object.values(
          condition.objectLiteralParameters || {},
        )[0] as Array<string>
      ).map((id: string): string => {
        return id.toLowerCase();
      });

      const rows: Array<UserPermission> = (
        props.userTenantAccessPermission?.[PROJECT]?.permissions || []
      ).filter((candidate: UserPermission): boolean => {
        return (
          !HeldPermissionsUtil.isBlockRow(candidate) &&
          permissions.includes(candidate.permission)
        );
      });

      return asked.filter((id: string): boolean => {
        const override: StoredRow | undefined = table.get(id);

        return rows.some((candidate: UserPermission): boolean => {
          if (HeldPermissionsUtil.isProjectWideRow(candidate)) {
            return true;
          }

          return (
            String(override?.["onCallDutyPolicyId"]).toLowerCase() === POLICY &&
            candidate.labelIds.some((labelId: ObjectID): boolean => {
              return labelId.toString().toLowerCase() === PAYMENTS_LABEL;
            })
          );
        });
      });
    };

    getJestSpyOn(ModelPermission, "getUpdatableQuery").mockImplementation(
      (async (
        _modelType: unknown,
        query: Record<string, unknown>,
        props: DatabaseCommonInteractionProps,
      ): Promise<Record<string, unknown>> => {
        return {
          _id: QueryHelper.any(
            reachedIds(
              props,
              query,
              new OnCallDutyPolicyUserOverride().getUpdatePermissions(),
            ),
          ),
        };
      }) as never,
    );

    getJestSpyOn(
      ModelPermission,
      "checkDeleteQueryPermission",
    ).mockImplementation((async (
      _modelType: unknown,
      query: Record<string, unknown>,
      props: DatabaseCommonInteractionProps,
    ): Promise<Record<string, unknown>> => {
      return {
        _id: QueryHelper.any(
          reachedIds(
            props,
            query,
            new OnCallDutyPolicyUserOverride().getDeletePermissions(),
          ),
        ),
      };
    }) as never);
  };

  // The hooks, handed the rows a write holds, as the CRUD path hands them.
  const runHook: (data: {
    hook: "onBeforeUpdate" | "onBeforeDelete";
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
    data?: Record<string, unknown>;
  }) => Promise<unknown> = async (data: {
    hook: "onBeforeUpdate" | "onBeforeDelete";
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
    data?: Record<string, unknown>;
  }): Promise<unknown> => {
    const rows: Array<OnCallDutyPolicyUserOverride> = data.ids.map(
      (id: string): OnCallDutyPolicyUserOverride => {
        const found: StoredRow = table.get(id)!;
        const override: OnCallDutyPolicyUserOverride =
          new OnCallDutyPolicyUserOverride();
        override._id = id;
        override.projectId = new ObjectID(PROJECT);
        override.overrideUserId = new ObjectID(String(found["overrideUserId"]));

        if (found["routeAlertsToUserId"]) {
          override.routeAlertsToUserId = new ObjectID(
            String(found["routeAlertsToUserId"]),
          );
        }

        if (found["onCallDutyPolicyId"]) {
          override.onCallDutyPolicyId = new ObjectID(
            String(found["onCallDutyPolicyId"]),
          );
        }

        override.startsAt = found["startsAt"] as Date;
        override.endsAt = found["endsAt"] as Date;
        return override;
      },
    );

    getJestSpyOn(
      OnCallDutyPolicyUserOverrideService as unknown as Record<
        string,
        () => Promise<unknown>
      >,
      data.hook === "onBeforeUpdate"
        ? "findRowsAndHoldUpdateToThem"
        : "findRowsAndHoldDeleteToThem",
    ).mockResolvedValue(rows as never);

    return await (
      OnCallDutyPolicyUserOverrideService as unknown as Record<
        string,
        (write: unknown) => Promise<unknown>
      >
    )[data.hook]!({
      query: { _id: QueryHelper.any(data.ids) },
      data: data.data,
      props: data.props,
    });
  };

  const EDITS_ANYONE_ON_PAYMENTS_POLICY: () => DatabaseCommonInteractionProps =
    (): DatabaseCommonInteractionProps => {
      return member([
        READS,
        ON_PAYMENTS,
        row(Permission.EditOnCallDutyPolicyUserOverride, {
          teamId: EVERYONE,
          scope: PermissionScope.Labels,
          labelIds: [PAYMENTS_LABEL],
        }),
        row(Permission.DeleteOnCallDutyPolicyUserOverride, {
          teamId: EVERYONE,
          scope: PermissionScope.Labels,
          labelIds: [PAYMENTS_LABEL],
        }),
      ]);
    };

  test("an edit of an outsider's override on a policy the narrowed permission reaches goes through", async () => {
    simulateRecordRule();

    await expect(
      runHook({
        hook: "onBeforeUpdate",
        ids: [OUTSIDER_ON_POLICY],
        props: EDITS_ANYONE_ON_PAYMENTS_POLICY(),
        data: { routeAlertsToUserId: new ObjectID(ERIN) },
      }),
    ).resolves.toBeTruthy();
  });

  test("an edit of one on a policy it does not reach is held to the team", async () => {
    simulateRecordRule();

    await expect(
      runHook({
        hook: "onBeforeUpdate",
        ids: [OUTSIDER_ON_OTHER_POLICY],
        props: EDITS_ANYONE_ON_PAYMENTS_POLICY(),
        data: { endsAt: new Date("2026-11-21T16:00:00.000Z") },
      }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_EDIT_REFUSAL);
  });

  test("an edit over both is refused whole: one of them is held to the team", async () => {
    simulateRecordRule();

    await expect(
      runHook({
        hook: "onBeforeUpdate",
        ids: [OUTSIDER_ON_POLICY, OUTSIDER_ON_OTHER_POLICY],
        props: EDITS_ANYONE_ON_PAYMENTS_POLICY(),
        data: { endsAt: new Date("2026-11-21T16:00:00.000Z") },
      }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_EDIT_REFUSAL);
  });

  test("a delete likewise: the payments policy's outsider goes, the other policy's stays", async () => {
    simulateRecordRule();

    await expect(
      runHook({
        hook: "onBeforeDelete",
        ids: [OUTSIDER_ON_POLICY],
        props: EDITS_ANYONE_ON_PAYMENTS_POLICY(),
      }),
    ).resolves.toBeTruthy();

    await expect(
      runHook({
        hook: "onBeforeDelete",
        ids: [OUTSIDER_ON_OTHER_POLICY],
        props: EDITS_ANYONE_ON_PAYMENTS_POLICY(),
      }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_DELETE_REFUSAL);
    expect(world.feedItemCount()).toBe(1);
  });

  test("a team's grant narrowed to the label edits its people's overrides on that policy only", async () => {
    simulateRecordRule();

    const PAYMENTS_ON_LABEL: DatabaseCommonInteractionProps = member([
      READS,
      row(TEAM_PERMISSION, {
        teamId: PAYMENTS,
        scope: PermissionScope.Labels,
        labelIds: [PAYMENTS_LABEL],
      }),
      ON_MOBILE,
    ]);

    // Bob, skipped on the payments policy: Payments' grant reaches it.
    await expect(
      runHook({
        hook: "onBeforeUpdate",
        ids: [TEAM_SKIP_ON_POLICY],
        props: PAYMENTS_ON_LABEL,
        data: { routeAlertsToUserId: new ObjectID(DAVE) },
      }),
    ).resolves.toBeTruthy();

    // Carol of Mobile covered by Dave on the other policy: Mobile's grant reaches it.
    await expect(
      runHook({
        hook: "onBeforeUpdate",
        ids: [OUTSIDER_ON_OTHER_POLICY],
        props: PAYMENTS_ON_LABEL,
        data: { routeAlertsToUserId: new ObjectID(BOB) },
      }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_COVER_REFUSAL);
  });
});

/*
 * A custom role given to a team is copied onto the team as permissions of
 * its own (CustomRoleSync), and a member's requests carry each copy as a
 * row of that team (AccessTokenService): the role's team permission reaches
 * that team's people, as one given to the team directly does.
 */
describe("through a custom role given to a team", () => {
  // A team's copy of a custom role's permission, as CustomRoleSync writes it.
  const roleCopy: (teamId: string, permission: Permission) => TeamPermission = (
    teamId: string,
    permission: Permission,
  ): TeamPermission => {
    const copy: TeamPermission = new TeamPermission();
    copy.projectId = new ObjectID(PROJECT);
    copy.teamId = new ObjectID(teamId);
    copy.permission = permission;
    copy.scope = PermissionScope.All;
    copy.isBlockPermission = false;
    copy.labels = [];
    copy.customRoleId = new ObjectID("9733aaaa-0000-4000-8000-0000000000a1");
    copy.teamCustomRoleId = new ObjectID(
      "9733aaaa-0000-4000-8000-0000000000a2",
    );
    copy.customRolePermissionId = new ObjectID(
      "9733aaaa-0000-4000-8000-0000000000a3",
    );
    return copy;
  };

  const rowsFromRole: () => Array<UserPermission> =
    (): Array<UserPermission> => {
      const built: UserTenantAccessPermission = (
        AccessTokenService as unknown as {
          buildUserTenantAccessPermission: (
            projectId: ObjectID,
            teamPermissions: Array<TeamPermission>,
          ) => UserTenantAccessPermission;
        }
      ).buildUserTenantAccessPermission(new ObjectID(PROJECT), [
        roleCopy(EVERYONE, Permission.OnCallViewer),
        roleCopy(PAYMENTS, TEAM_PERMISSION),
      ]);

      return built.permissions;
    };

  test("each copy is a row of the team the role is given to", () => {
    const copied: UserPermission | undefined = rowsFromRole().find(
      (candidate: UserPermission): boolean => {
        return candidate.permission === TEAM_PERMISSION;
      },
    );

    expect(copied?.teamId?.toString().toLowerCase()).toBe(PAYMENTS);
  });

  test("and the role's team permission reaches that team's people, and no one else", async () => {
    await add({ away: BOB, covers: DAVE, props: member(rowsFromRole()) });

    await expect(
      add({ away: CAROL, covers: DAVE, props: member(rowsFromRole()) }),
    ).rejects.toThrow(USER_OVERRIDE_TEAM_AWAY_REFUSAL);

    expect(added()).toHaveLength(1);
  });
});

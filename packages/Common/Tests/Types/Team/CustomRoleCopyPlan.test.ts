import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Permission from "../../../Types/Permission";
import {
  getCopyScope,
  planRoleCopies,
  RoleCopyPlan,
  RoleGivenToTeam,
  RolePermissionRow,
  TeamPermissionCopyRow,
  TeamPermissionCopyToCreate,
} from "../../../Types/Team/CustomRoleCopyPlan";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * THE COPIES A CUSTOM ROLE SHOULD BE, AND THE CHANGES THAT MAKE THEM SO.
 *
 * A team given a role holds one copy of each of the role's permissions
 * (CustomRoleSync writes what planRoleCopies works out). Held here to:
 *
 *   - exactness: after the plan, every team holds exactly one copy of each
 *     permission of each role it was given, with the role's permission,
 *     scope and labels - and nothing else of those roles;
 *   - restraint: a copy that is already right is never deleted and made
 *     again, and a plan over copies that are right is empty;
 *   - order of safety: what the plan deletes is all a team held that its
 *     roles no longer give, so deleting first never leaves a team holding
 *     more than its roles give;
 *   - the teams it reports changed are exactly the teams it changes.
 *
 * Deterministic cases first, then thousands of generated ones from a seed.
 */

const id: (prefix: string, index: number) => string = (
  prefix: string,
  index: number,
): string => {
  const hex: string = index.toString(16).padStart(12, "0");
  const marker: string = {
    team: "1",
    role: "2",
    given: "3",
    row: "4",
    copy: "5",
    label: "6",
  }[prefix]!;
  return `${marker}0000000-0000-4000-8000-${hex}`;
};

const TEAM_A: string = id("team", 1);
const TEAM_B: string = id("team", 2);
const ROLE_1: string = id("role", 1);
const ROLE_2: string = id("role", 2);
const PRODUCTION: string = id("label", 1);
const STAGING: string = id("label", 2);

const given: (
  index: number,
  teamId: string,
  customRoleId: string,
) => RoleGivenToTeam = (
  index: number,
  teamId: string,
  customRoleId: string,
): RoleGivenToTeam => {
  return { id: id("given", index), teamId, customRoleId };
};

const rolePermission: (
  index: number,
  customRoleId: string,
  permission: Permission,
  scope?: PermissionScope,
  labelIds?: Array<string>,
) => RolePermissionRow = (
  index: number,
  customRoleId: string,
  permission: Permission,
  scope?: PermissionScope,
  labelIds: Array<string> = [],
): RolePermissionRow => {
  return {
    id: id("row", index),
    customRoleId,
    permission,
    scope,
    labelIds,
  };
};

// The copy a role's permission becomes on a team, as the database would hold it.
const copyOf: (
  index: number,
  roleGiven: RoleGivenToTeam,
  row: RolePermissionRow,
) => TeamPermissionCopyRow = (
  index: number,
  roleGiven: RoleGivenToTeam,
  row: RolePermissionRow,
): TeamPermissionCopyRow => {
  const { scope, labelIds } = getCopyScope(row);

  return {
    id: id("copy", index),
    teamId: roleGiven.teamId,
    customRoleId: roleGiven.customRoleId,
    teamCustomRoleId: roleGiven.id,
    customRolePermissionId: row.id,
    permission: row.permission,
    scope: scope,
    labelIds: labelIds,
    isBlockPermission: false,
  };
};

// The copies a team holds after the plan is carried out: deletes, then creates.
const applyPlan: (
  copies: ReadonlyArray<TeamPermissionCopyRow>,
  plan: RoleCopyPlan,
  nextIndex: number,
) => Array<TeamPermissionCopyRow> = (
  copies: ReadonlyArray<TeamPermissionCopyRow>,
  plan: RoleCopyPlan,
  nextIndex: number,
): Array<TeamPermissionCopyRow> => {
  const deleted: Set<string> = new Set<string>(plan.toDelete);
  const kept: Array<TeamPermissionCopyRow> = copies.filter(
    (copy: TeamPermissionCopyRow): boolean => {
      return !deleted.has(copy.id);
    },
  );

  return [
    ...kept,
    ...plan.toCreate.map(
      (
        created: TeamPermissionCopyToCreate,
        index: number,
      ): TeamPermissionCopyRow => {
        return {
          id: id("copy", nextIndex + index),
          teamId: created.teamId,
          customRoleId: created.customRoleId,
          teamCustomRoleId: created.teamCustomRoleId,
          customRolePermissionId: created.customRolePermissionId,
          permission: created.permission,
          scope: created.scope,
          labelIds: created.labelIds,
          isBlockPermission: false,
        };
      },
    ),
  ];
};

// What a set of copies gives, as one comparable line per copy.
const describeCopies: (
  copies: ReadonlyArray<TeamPermissionCopyRow>,
) => Array<string> = (
  copies: ReadonlyArray<TeamPermissionCopyRow>,
): Array<string> => {
  return copies
    .map((copy: TeamPermissionCopyRow): string => {
      // As the database compares them: ids in any case, no scope is All.
      return [
        (copy.teamId || "").toLowerCase(),
        (copy.customRoleId || "").toLowerCase(),
        (copy.teamCustomRoleId || "").toLowerCase(),
        (copy.customRolePermissionId || "").toLowerCase(),
        copy.permission,
        copy.scope || PermissionScope.All,
        copy.labelIds
          .map((labelId: string): string => {
            return labelId.toLowerCase();
          })
          .sort()
          .join("+"),
        copy.isBlockPermission ? "block" : "allow",
      ].join("|");
    })
    .sort();
};

// What the roles call for: one line per (role given to a team) x (permission of that role).
const describeWanted: (
  rolesGivenToTeams: ReadonlyArray<RoleGivenToTeam>,
  rolePermissions: ReadonlyArray<RolePermissionRow>,
) => Array<string> = (
  rolesGivenToTeams: ReadonlyArray<RoleGivenToTeam>,
  rolePermissions: ReadonlyArray<RolePermissionRow>,
): Array<string> => {
  const wanted: Array<TeamPermissionCopyRow> = [];

  for (const roleGiven of rolesGivenToTeams) {
    for (const row of rolePermissions) {
      if (row.customRoleId === roleGiven.customRoleId) {
        wanted.push(copyOf(0, roleGiven, row));
      }
    }
  }

  return describeCopies(wanted);
};

describe("planRoleCopies", () => {
  test("a role given to a team becomes one copy of each of its permissions", () => {
    const toTeamA: RoleGivenToTeam = given(1, TEAM_A, ROLE_1);
    const incidents: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.IncidentMember,
    );
    const monitors: RolePermissionRow = rolePermission(
      2,
      ROLE_1,
      Permission.MonitorViewer,
      PermissionScope.Labels,
      [STAGING, PRODUCTION],
    );

    const plan: RoleCopyPlan = planRoleCopies({
      rolesGivenToTeams: [toTeamA],
      rolePermissions: [incidents, monitors],
      copies: [],
    });

    expect(plan.toDelete).toEqual([]);
    expect(plan.toCreate).toEqual([
      {
        teamId: TEAM_A,
        customRoleId: ROLE_1,
        teamCustomRoleId: toTeamA.id,
        customRolePermissionId: incidents.id,
        permission: Permission.IncidentMember,
        scope: PermissionScope.All,
        labelIds: [],
      },
      {
        teamId: TEAM_A,
        customRoleId: ROLE_1,
        teamCustomRoleId: toTeamA.id,
        customRolePermissionId: monitors.id,
        permission: Permission.MonitorViewer,
        scope: PermissionScope.Labels,
        labelIds: [PRODUCTION, STAGING],
      },
    ]);
    expect(plan.changedTeamIds).toEqual([TEAM_A]);
  });

  test("copies that are right are left alone, and the plan is empty", () => {
    const toTeamA: RoleGivenToTeam = given(1, TEAM_A, ROLE_1);
    const toTeamB: RoleGivenToTeam = given(2, TEAM_B, ROLE_1);
    const rows: Array<RolePermissionRow> = [
      rolePermission(1, ROLE_1, Permission.IncidentMember),
      rolePermission(2, ROLE_1, Permission.AlertViewer, PermissionScope.Owned),
    ];

    const plan: RoleCopyPlan = planRoleCopies({
      rolesGivenToTeams: [toTeamA, toTeamB],
      rolePermissions: rows,
      copies: [
        copyOf(1, toTeamA, rows[0]!),
        copyOf(2, toTeamA, rows[1]!),
        copyOf(3, toTeamB, rows[0]!),
        copyOf(4, toTeamB, rows[1]!),
      ],
    });

    expect(plan).toEqual({ toDelete: [], toCreate: [], changedTeamIds: [] });
  });

  test("a role taken from a team takes its copies with it, and only from that team", () => {
    const toTeamA: RoleGivenToTeam = given(1, TEAM_A, ROLE_1);
    const toTeamB: RoleGivenToTeam = given(2, TEAM_B, ROLE_1);
    const row: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.IncidentMember,
    );

    const plan: RoleCopyPlan = planRoleCopies({
      rolesGivenToTeams: [toTeamB],
      rolePermissions: [row],
      copies: [copyOf(1, toTeamA, row), copyOf(2, toTeamB, row)],
    });

    expect(plan.toDelete).toEqual([id("copy", 1)]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.changedTeamIds).toEqual([TEAM_A]);
  });

  test("a changed scope, label list or permission is deleted and made again", () => {
    const toTeamA: RoleGivenToTeam = given(1, TEAM_A, ROLE_1);
    const was: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.MonitorViewer,
      PermissionScope.Labels,
      [PRODUCTION],
    );

    for (const now of [
      rolePermission(1, ROLE_1, Permission.MonitorViewer),
      rolePermission(
        1,
        ROLE_1,
        Permission.MonitorViewer,
        PermissionScope.Labels,
        [PRODUCTION, STAGING],
      ),
      rolePermission(
        1,
        ROLE_1,
        Permission.MonitorViewer,
        PermissionScope.Labels,
        [STAGING],
      ),
      rolePermission(
        1,
        ROLE_1,
        Permission.MonitorAdmin,
        PermissionScope.Labels,
        [PRODUCTION],
      ),
      rolePermission(
        1,
        ROLE_1,
        Permission.MonitorViewer,
        PermissionScope.Owned,
      ),
    ]) {
      const plan: RoleCopyPlan = planRoleCopies({
        rolesGivenToTeams: [toTeamA],
        rolePermissions: [now],
        copies: [copyOf(1, toTeamA, was)],
      });

      expect(plan.toDelete).toEqual([id("copy", 1)]);
      expect(plan.toCreate).toHaveLength(1);
      expect(plan.toCreate[0]).toMatchObject({
        permission: now.permission,
        scope: now.scope || PermissionScope.All,
        labelIds: getCopyScope(now).labelIds,
      });
      expect(plan.changedTeamIds).toEqual([TEAM_A]);
    }
  });

  test("labels in another order, or another case, are the same labels", () => {
    const toTeamA: RoleGivenToTeam = given(1, TEAM_A, ROLE_1);
    const row: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.MonitorViewer,
      PermissionScope.Labels,
      [STAGING, PRODUCTION],
    );
    const copy: TeamPermissionCopyRow = {
      ...copyOf(1, toTeamA, row),
      labelIds: [PRODUCTION.toUpperCase(), STAGING],
    };

    expect(
      planRoleCopies({
        rolesGivenToTeams: [toTeamA],
        rolePermissions: [row],
        copies: [copy],
      }).toDelete,
    ).toEqual([]);
  });

  test("labels left on a copy that should have none make it another copy", () => {
    const toTeamA: RoleGivenToTeam = given(1, TEAM_A, ROLE_1);
    const row: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.MonitorViewer,
      PermissionScope.All,
    );
    const copy: TeamPermissionCopyRow = {
      ...copyOf(1, toTeamA, row),
      labelIds: [PRODUCTION],
    };

    const plan: RoleCopyPlan = planRoleCopies({
      rolesGivenToTeams: [toTeamA],
      rolePermissions: [row],
      copies: [copy],
    });

    expect(plan.toDelete).toEqual([copy.id]);
    expect(plan.toCreate[0]!.labelIds).toEqual([]);
  });

  test("a role's labels with a scope other than Labels never reach a copy", () => {
    expect(
      getCopyScope(
        rolePermission(
          1,
          ROLE_1,
          Permission.MonitorViewer,
          PermissionScope.All,
          [PRODUCTION],
        ),
      ),
    ).toEqual({ scope: PermissionScope.All, labelIds: [] });
    expect(
      getCopyScope(
        rolePermission(1, ROLE_1, Permission.MonitorViewer, undefined, [
          PRODUCTION,
        ]),
      ),
    ).toEqual({ scope: PermissionScope.All, labelIds: [] });
    expect(
      getCopyScope(
        rolePermission(
          1,
          ROLE_1,
          Permission.MonitorViewer,
          PermissionScope.Owned,
          [PRODUCTION],
        ),
      ),
    ).toEqual({ scope: PermissionScope.Owned, labelIds: [] });
  });

  test("a second copy of the same one goes, and the first stays", () => {
    const toTeamA: RoleGivenToTeam = given(1, TEAM_A, ROLE_1);
    const row: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.IncidentMember,
    );

    const plan: RoleCopyPlan = planRoleCopies({
      rolesGivenToTeams: [toTeamA],
      rolePermissions: [row],
      copies: [copyOf(1, toTeamA, row), copyOf(2, toTeamA, row)],
    });

    expect(plan.toDelete).toEqual([id("copy", 2)]);
    expect(plan.toCreate).toEqual([]);
  });

  test("a copy that is a block, or names no role given to a team, or no permission of the role, is never kept", () => {
    const toTeamA: RoleGivenToTeam = given(1, TEAM_A, ROLE_1);
    const row: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.IncidentMember,
    );
    const right: TeamPermissionCopyRow = copyOf(1, toTeamA, row);

    for (const wrong of [
      { ...right, isBlockPermission: true },
      { ...right, teamCustomRoleId: null },
      { ...right, customRolePermissionId: null },
      { ...right, teamCustomRoleId: id("given", 9) },
      { ...right, customRolePermissionId: id("row", 9) },
      { ...right, customRoleId: ROLE_2 },
      { ...right, teamId: TEAM_B },
    ]) {
      const plan: RoleCopyPlan = planRoleCopies({
        rolesGivenToTeams: [toTeamA],
        rolePermissions: [row],
        copies: [wrong],
      });

      expect(plan.toDelete).toEqual([right.id]);
      expect(plan.toCreate).toHaveLength(1);
    }
  });

  test("a role with no permissions gives nothing, and takes what its copies were", () => {
    const toTeamA: RoleGivenToTeam = given(1, TEAM_A, ROLE_1);
    const row: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.IncidentMember,
    );

    const plan: RoleCopyPlan = planRoleCopies({
      rolesGivenToTeams: [toTeamA],
      rolePermissions: [],
      copies: [copyOf(1, toTeamA, row)],
    });

    expect(plan.toDelete).toEqual([id("copy", 1)]);
    expect(plan.toCreate).toEqual([]);
  });

  test("two roles on one team are kept apart, even when they hold the same permission", () => {
    const first: RoleGivenToTeam = given(1, TEAM_A, ROLE_1);
    const second: RoleGivenToTeam = given(2, TEAM_A, ROLE_2);
    const rows: Array<RolePermissionRow> = [
      rolePermission(1, ROLE_1, Permission.IncidentMember),
      rolePermission(2, ROLE_2, Permission.IncidentMember),
    ];

    const plan: RoleCopyPlan = planRoleCopies({
      rolesGivenToTeams: [first, second],
      rolePermissions: rows,
      copies: [copyOf(1, first, rows[0]!)],
    });

    expect(plan.toDelete).toEqual([]);
    expect(plan.toCreate).toEqual([
      expect.objectContaining({
        teamCustomRoleId: second.id,
        customRolePermissionId: rows[1]!.id,
        customRoleId: ROLE_2,
      }),
    ]);
  });

  test("ids are compared as text in any case", () => {
    const toTeamA: RoleGivenToTeam = given(1, TEAM_A, ROLE_1);
    const row: RolePermissionRow = rolePermission(
      1,
      ROLE_1,
      Permission.IncidentMember,
    );
    const copy: TeamPermissionCopyRow = {
      ...copyOf(1, toTeamA, row),
      teamId: TEAM_A.toUpperCase(),
      customRoleId: ROLE_1.toUpperCase(),
      teamCustomRoleId: toTeamA.id.toUpperCase(),
      customRolePermissionId: row.id.toUpperCase(),
    };

    expect(
      planRoleCopies({
        rolesGivenToTeams: [toTeamA],
        rolePermissions: [row],
        copies: [copy],
      }),
    ).toEqual({ toDelete: [], toCreate: [], changedTeamIds: [] });
  });

  describe("on generated roles, teams and copies", () => {
    const PERMISSIONS: Array<Permission> = [
      Permission.IncidentMember,
      Permission.AlertViewer,
      Permission.MonitorViewer,
      Permission.ReadProjectIncident,
      Permission.ProjectAdmin,
    ];
    const SCOPES: Array<PermissionScope | undefined> = [
      PermissionScope.All,
      PermissionScope.Owned,
      PermissionScope.Labels,
      undefined,
    ];
    const LABELS: Array<string> = [1, 2, 3].map((index: number): string => {
      return id("label", index);
    });

    interface World {
      rolesGivenToTeams: Array<RoleGivenToTeam>;
      rolePermissions: Array<RolePermissionRow>;
      copies: Array<TeamPermissionCopyRow>;
    }

    const pick: <T>(items: ReadonlyArray<T>, random: SeededRandom) => T = <T>(
      items: ReadonlyArray<T>,
      random: SeededRandom,
    ): T => {
      return items[random(items.length)]!;
    };

    const someLabels: (random: SeededRandom) => Array<string> = (
      random: SeededRandom,
    ): Array<string> => {
      return LABELS.filter((): boolean => {
        return random() < 0.5;
      });
    };

    // A world as the database could hold it: roles given, rows, and copies right, stale or stray.
    const generateWorld: (random: SeededRandom) => World = (
      random: SeededRandom,
    ): World => {
      const teams: Array<string> = [1, 2, 3, 4].map((index: number): string => {
        return id("team", index);
      });
      const roles: Array<string> = [1, 2, 3].map((index: number): string => {
        return id("role", index);
      });

      const rolesGivenToTeams: Array<RoleGivenToTeam> = [];
      let givenIndex: number = 0;

      for (const team of teams) {
        for (const role of roles) {
          if (random() < 0.45) {
            givenIndex += 1;
            rolesGivenToTeams.push(given(givenIndex, team, role));
          }
        }
      }

      const rolePermissions: Array<RolePermissionRow> = [];
      let rowIndex: number = 0;

      for (const role of roles) {
        const count: number = random(4);

        for (let index: number = 0; index < count; index++) {
          rowIndex += 1;
          const scope: PermissionScope | undefined = pick(SCOPES, random);
          rolePermissions.push(
            rolePermission(
              rowIndex,
              role,
              pick(PERMISSIONS, random),
              scope,
              scope === PermissionScope.Labels
                ? [pick(LABELS, random), ...someLabels(random)]
                : random() < 0.2
                  ? someLabels(random)
                  : [],
            ),
          );
        }
      }

      const copies: Array<TeamPermissionCopyRow> = [];
      let copyIndex: number = 0;

      // Right copies, some of them twice, some missing.
      for (const roleGiven of rolesGivenToTeams) {
        for (const row of rolePermissions) {
          if (row.customRoleId !== roleGiven.customRoleId) {
            continue;
          }

          const times: number = pick([0, 1, 1, 1, 2], random);

          for (let index: number = 0; index < times; index++) {
            copyIndex += 1;
            copies.push(copyOf(copyIndex, roleGiven, row));
          }
        }
      }

      // Stale and stray ones: a changed scope, other labels, a role taken away, a block.
      const strays: number = random(5);

      for (let index: number = 0; index < strays; index++) {
        copyIndex += 1;
        const row: RolePermissionRow | undefined =
          rolePermissions.length > 0
            ? pick(rolePermissions, random)
            : undefined;
        const roleGiven: RoleGivenToTeam =
          rolesGivenToTeams.length > 0 && random() < 0.7
            ? pick(rolesGivenToTeams, random)
            : given(900 + index, pick(teams, random), pick(roles, random));

        copies.push({
          id: id("copy", copyIndex),
          teamId: roleGiven.teamId,
          customRoleId: roleGiven.customRoleId,
          teamCustomRoleId: roleGiven.id,
          customRolePermissionId: row ? row.id : id("row", 800 + index),
          permission: pick(PERMISSIONS, random),
          scope: pick(SCOPES, random),
          labelIds: someLabels(random),
          isBlockPermission: random() < 0.15,
        });
      }

      return { rolesGivenToTeams, rolePermissions, copies };
    };

    test("after the plan every team holds exactly what its roles give, and a second plan is empty", () => {
      const random: SeededRandom = seededRandom(31415);

      for (let run: number = 0; run < 2000; run++) {
        const world: World = generateWorld(random);
        const plan: RoleCopyPlan = planRoleCopies(world);
        const after: Array<TeamPermissionCopyRow> = applyPlan(
          world.copies,
          plan,
          10000,
        );

        // Exactly what the roles call for, once each.
        expect(describeCopies(after)).toEqual(
          describeWanted(world.rolesGivenToTeams, world.rolePermissions),
        );

        // Nothing deleted twice, and only rows that were there.
        const copyIds: Set<string> = new Set<string>(
          world.copies.map((copy: TeamPermissionCopyRow): string => {
            return copy.id;
          }),
        );
        expect(new Set<string>(plan.toDelete).size).toBe(plan.toDelete.length);
        for (const deleted of plan.toDelete) {
          expect(copyIds.has(deleted)).toBe(true);
        }

        // Done: planning again changes nothing.
        expect(
          planRoleCopies({
            rolesGivenToTeams: world.rolesGivenToTeams,
            rolePermissions: world.rolePermissions,
            copies: after,
          }),
        ).toEqual({ toDelete: [], toCreate: [], changedTeamIds: [] });
      }
    });

    test("a copy that is already right is never deleted", () => {
      const random: SeededRandom = seededRandom(2718);

      for (let run: number = 0; run < 2000; run++) {
        const world: World = generateWorld(random);
        const plan: RoleCopyPlan = planRoleCopies(world);
        const deleted: Set<string> = new Set<string>(plan.toDelete);
        const wanted: Set<string> = new Set<string>(
          describeWanted(world.rolesGivenToTeams, world.rolePermissions),
        );
        const keptOnce: Set<string> = new Set<string>();

        for (const copy of world.copies) {
          const line: string = describeCopies([copy])[0]!;

          if (wanted.has(line) && !keptOnce.has(line)) {
            // The first right copy of each is kept.
            keptOnce.add(line);
            expect(deleted.has(copy.id)).toBe(false);
          }
        }

        // And nothing is made that a kept copy already gives.
        for (const created of plan.toCreate) {
          const line: string = describeCopies([
            {
              id: "new",
              ...created,
              isBlockPermission: false,
            },
          ])[0]!;
          expect(keptOnce.has(line)).toBe(false);
        }
      }
    });

    test("the teams reported changed are exactly the teams whose rows the plan touches", () => {
      const random: SeededRandom = seededRandom(1618);

      for (let run: number = 0; run < 2000; run++) {
        const world: World = generateWorld(random);
        const plan: RoleCopyPlan = planRoleCopies(world);
        const deleted: Set<string> = new Set<string>(plan.toDelete);

        const touched: Set<string> = new Set<string>([
          ...world.copies
            .filter((copy: TeamPermissionCopyRow): boolean => {
              return deleted.has(copy.id);
            })
            .map((copy: TeamPermissionCopyRow): string => {
              return copy.teamId.toLowerCase();
            }),
          ...plan.toCreate.map(
            (created: TeamPermissionCopyToCreate): string => {
              return created.teamId.toLowerCase();
            },
          ),
        ]);

        expect(
          plan.changedTeamIds
            .map((teamId: string): string => {
              return teamId.toLowerCase();
            })
            .sort(),
        ).toEqual(Array.from(touched).sort());
      }
    });

    test("deleting first never leaves a team holding more than its roles give", () => {
      const random: SeededRandom = seededRandom(4669);

      for (let run: number = 0; run < 2000; run++) {
        const world: World = generateWorld(random);
        const plan: RoleCopyPlan = planRoleCopies(world);
        const deleted: Set<string> = new Set<string>(plan.toDelete);
        const wanted: Set<string> = new Set<string>(
          describeWanted(world.rolesGivenToTeams, world.rolePermissions),
        );

        // What is left between the deletes and the creates gives only what is wanted.
        for (const copy of world.copies) {
          if (!deleted.has(copy.id)) {
            expect(wanted.has(describeCopies([copy])[0]!)).toBe(true);
          }
        }
      }
    });
  });
});

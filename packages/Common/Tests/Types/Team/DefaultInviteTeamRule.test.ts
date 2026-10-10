import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Permission from "../../../Types/Permission";
import {
  CanGrantAllFunction,
  InviteTeam,
  InviteTeamPermissionRow,
  MEMBERS_TEAM_NAME,
  pickDefaultInviteTeam,
} from "../../../Types/Team/DefaultInviteTeamRule";
import { describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";

/*
 * The team someone is added to a project on, to start with: a team holding
 * ProjectMember for the whole project (the one called "Members" first, then
 * the oldest), else the team called "Members", else none - and only a team
 * the person adding them may hand on.
 */

const owners: InviteTeam = { id: "team-owners", name: "Owners" };
const admins: InviteTeam = { id: "team-admins", name: "Admin" };
const members: InviteTeam = { id: "team-members", name: "Members" };

type RowFunction = (
  team: InviteTeam,
  permission: Permission,
  extra?: Partial<InviteTeamPermissionRow>,
) => InviteTeamPermissionRow;

const row: RowFunction = (
  team: InviteTeam,
  permission: Permission,
  extra?: Partial<InviteTeamPermissionRow>,
): InviteTeamPermissionRow => {
  return {
    teamId: team.id,
    permission: permission,
    isBlockPermission: false,
    scope: PermissionScope.All,
    ...(extra || {}),
  };
};

const grantAll: CanGrantAllFunction = (): boolean => {
  return true;
};

// The three teams a project starts with.
const defaultRows: Array<InviteTeamPermissionRow> = [
  row(owners, Permission.ProjectOwner),
  row(admins, Permission.ProjectAdmin),
  row(members, Permission.ProjectMember),
];

describe("DefaultInviteTeamRule", () => {
  test("MEMBERS_TEAM_NAME is the name a project's members team starts with", () => {
    expect(MEMBERS_TEAM_NAME).toBe("Members");
  });

  describe("a team holding ProjectMember for the whole project", () => {
    test("picks the Members team of a project as it starts", () => {
      expect(
        pickDefaultInviteTeam({
          teams: [owners, admins, members],
          permissionRows: defaultRows,
          canGrantAll: grantAll,
        }),
      ).toEqual(members);
    });

    test("returns the team object it was given, not a copy", () => {
      expect(
        pickDefaultInviteTeam({
          teams: [owners, admins, members],
          permissionRows: defaultRows,
          canGrantAll: grantAll,
        }),
      ).toBe(members);
    });

    test("still picks a renamed members team", () => {
      const everyone: InviteTeam = { id: "team-everyone", name: "Everyone" };

      expect(
        pickDefaultInviteTeam({
          teams: [owners, everyone],
          permissionRows: [
            row(owners, Permission.ProjectOwner),
            row(everyone, Permission.ProjectMember),
          ],
          canGrantAll: grantAll,
        }),
      ).toBe(everyone);
    });

    test("prefers the one called Members over an older one called otherwise", () => {
      const everyone: InviteTeam = { id: "team-everyone", name: "Everyone" };

      expect(
        pickDefaultInviteTeam({
          teams: [everyone, members],
          permissionRows: [
            row(everyone, Permission.ProjectMember),
            row(members, Permission.ProjectMember),
          ],
          canGrantAll: grantAll,
        }),
      ).toBe(members);
    });

    test("among several not called Members, picks the oldest (first listed)", () => {
      const first: InviteTeam = { id: "team-first", name: "Engineering" };
      const second: InviteTeam = { id: "team-second", name: "Support" };

      expect(
        pickDefaultInviteTeam({
          teams: [first, second],
          permissionRows: [
            row(second, Permission.ProjectMember),
            row(first, Permission.ProjectMember),
          ],
          canGrantAll: grantAll,
        }),
      ).toBe(first);
    });

    test("among several called Members, picks the oldest", () => {
      const olderMembers: InviteTeam = { id: "team-m1", name: "Members" };
      const newerMembers: InviteTeam = { id: "team-m2", name: "members" };

      expect(
        pickDefaultInviteTeam({
          teams: [olderMembers, newerMembers],
          permissionRows: [
            row(newerMembers, Permission.ProjectMember),
            row(olderMembers, Permission.ProjectMember),
          ],
          canGrantAll: grantAll,
        }),
      ).toBe(olderMembers);
    });

    test.each([["members"], ["MEMBERS"], ["  Members  "], ["\tmEmBeRs\n"]])(
      "reads %j as the Members name (case and surrounding space ignored)",
      (name: string) => {
        const everyone: InviteTeam = { id: "team-everyone", name: "Everyone" };
        const named: InviteTeam = { id: "team-named", name: name };

        expect(
          pickDefaultInviteTeam({
            teams: [everyone, named],
            permissionRows: [
              row(everyone, Permission.ProjectMember),
              row(named, Permission.ProjectMember),
            ],
            canGrantAll: grantAll,
          }),
        ).toBe(named);
      },
    );

    test.each([["Members Only"], ["Team Members"], ["Member"], ["Mem bers"]])(
      "does not read %j as the Members name",
      (name: string) => {
        const everyone: InviteTeam = { id: "team-everyone", name: "Everyone" };
        const named: InviteTeam = { id: "team-named", name: name };

        expect(
          pickDefaultInviteTeam({
            teams: [everyone, named],
            permissionRows: [
              row(everyone, Permission.ProjectMember),
              row(named, Permission.ProjectMember),
            ],
            canGrantAll: grantAll,
          }),
        ).toBe(everyone);
      },
    );

    test.each([
      ["Owned", PermissionScope.Owned],
      ["Labels", PermissionScope.Labels],
      ["absent (legacy Labels)", undefined],
    ])(
      "a ProjectMember row scoped %s does not make a members team",
      (_label: string, scope: PermissionScope | undefined) => {
        const narrow: InviteTeam = { id: "team-narrow", name: "Narrow" };

        expect(
          pickDefaultInviteTeam({
            teams: [narrow],
            permissionRows: [
              row(narrow, Permission.ProjectMember, { scope: scope }),
            ],
            canGrantAll: grantAll,
          }),
        ).toBeNull();
      },
    );

    test("a narrow ProjectMember row next to a whole-project one still makes a members team", () => {
      const everyone: InviteTeam = { id: "team-everyone", name: "Everyone" };

      expect(
        pickDefaultInviteTeam({
          teams: [everyone],
          permissionRows: [
            row(everyone, Permission.ProjectMember, {
              scope: PermissionScope.Labels,
            }),
            row(everyone, Permission.ProjectMember),
          ],
          canGrantAll: grantAll,
        }),
      ).toBe(everyone);
    });

    test.each([
      ["All", PermissionScope.All],
      ["Owned", PermissionScope.Owned],
      ["Labels", PermissionScope.Labels],
      ["absent", undefined],
    ])(
      "a block on ProjectMember (scope %s) undoes the team as a members team",
      (_label: string, scope: PermissionScope | undefined) => {
        const everyone: InviteTeam = { id: "team-everyone", name: "Everyone" };
        const support: InviteTeam = { id: "team-support", name: "Support" };

        expect(
          pickDefaultInviteTeam({
            teams: [everyone, support],
            permissionRows: [
              row(everyone, Permission.ProjectMember),
              row(everyone, Permission.ProjectMember, {
                isBlockPermission: true,
                scope: scope,
              }),
              row(support, Permission.ProjectMember),
            ],
            canGrantAll: grantAll,
          }),
        ).toBe(support);
      },
    );

    test("a block row is not itself a ProjectMember grant", () => {
      const blocked: InviteTeam = { id: "team-blocked", name: "Blocked" };

      expect(
        pickDefaultInviteTeam({
          teams: [blocked],
          permissionRows: [
            row(blocked, Permission.ProjectMember, { isBlockPermission: true }),
          ],
          canGrantAll: grantAll,
        }),
      ).toBeNull();
    });

    test("a block on some other permission leaves the members team as it is", () => {
      const everyone: InviteTeam = { id: "team-everyone", name: "Everyone" };

      expect(
        pickDefaultInviteTeam({
          teams: [everyone],
          permissionRows: [
            row(everyone, Permission.ProjectMember),
            row(everyone, Permission.CreateProjectMonitor, {
              isBlockPermission: true,
            }),
          ],
          canGrantAll: grantAll,
        }),
      ).toBe(everyone);
    });

    test("another team's rows never count toward this team", () => {
      const everyone: InviteTeam = { id: "team-everyone", name: "Everyone" };
      const support: InviteTeam = { id: "team-support", name: "Support" };

      // Only Support holds ProjectMember; Everyone holds nothing.
      expect(
        pickDefaultInviteTeam({
          teams: [everyone, support],
          permissionRows: [row(support, Permission.ProjectMember)],
          canGrantAll: grantAll,
        }),
      ).toBe(support);

      // A block on another team does not undo this one.
      expect(
        pickDefaultInviteTeam({
          teams: [everyone, support],
          permissionRows: [
            row(everyone, Permission.ProjectMember),
            row(support, Permission.ProjectMember, { isBlockPermission: true }),
          ],
          canGrantAll: grantAll,
        }),
      ).toBe(everyone);
    });

    test("rows of a team that is not in the list are ignored", () => {
      const ghost: InviteTeam = { id: "team-ghost", name: "Members" };

      expect(
        pickDefaultInviteTeam({
          teams: [owners],
          permissionRows: [
            row(owners, Permission.ProjectOwner),
            row(ghost, Permission.ProjectMember),
          ],
          canGrantAll: grantAll,
        }),
      ).toBeNull();
    });
  });

  describe("with no members team", () => {
    test("falls back to the team called Members, whatever it holds", () => {
      const namedMembers: InviteTeam = { id: "team-m", name: "Members" };

      expect(
        pickDefaultInviteTeam({
          teams: [owners, namedMembers],
          permissionRows: [
            row(owners, Permission.ProjectOwner),
            row(namedMembers, Permission.CreateProjectMonitor),
          ],
          canGrantAll: grantAll,
        }),
      ).toBe(namedMembers);
    });

    test("falls back to the team called Members even with no rows at all", () => {
      const namedMembers: InviteTeam = { id: "team-m", name: " members " };

      expect(
        pickDefaultInviteTeam({
          teams: [owners, namedMembers],
          permissionRows: [],
          canGrantAll: grantAll,
        }),
      ).toBe(namedMembers);
    });

    test("falls back to the team called Members even when it blocks ProjectMember", () => {
      const namedMembers: InviteTeam = { id: "team-m", name: "Members" };

      expect(
        pickDefaultInviteTeam({
          teams: [namedMembers],
          permissionRows: [
            row(namedMembers, Permission.ProjectMember),
            row(namedMembers, Permission.ProjectMember, {
              isBlockPermission: true,
            }),
          ],
          canGrantAll: grantAll,
        }),
      ).toBe(namedMembers);
    });

    test("does not fall back when a members team exists but cannot be handed on", () => {
      const everyone: InviteTeam = { id: "team-everyone", name: "Everyone" };
      const namedMembers: InviteTeam = { id: "team-m", name: "Members" };

      // Everyone is the members team; Members holds only a narrow grant.
      expect(
        pickDefaultInviteTeam({
          teams: [everyone, namedMembers],
          permissionRows: [
            row(everyone, Permission.ProjectMember),
            row(everyone, Permission.ProjectAdmin),
            row(namedMembers, Permission.CreateProjectMonitor),
          ],
          canGrantAll: (permissions: Array<Permission>): boolean => {
            return !permissions.includes(Permission.ProjectAdmin);
          },
        }),
      ).toBeNull();
    });

    test("picks nothing when no team is a members team nor called Members", () => {
      expect(
        pickDefaultInviteTeam({
          teams: [owners, admins],
          permissionRows: [
            row(owners, Permission.ProjectOwner),
            row(admins, Permission.ProjectAdmin),
          ],
          canGrantAll: grantAll,
        }),
      ).toBeNull();
    });

    test("picks nothing in a project with no teams", () => {
      const canGrantAll: Mock<CanGrantAllFunction> =
        jest.fn<CanGrantAllFunction>(grantAll);

      expect(
        pickDefaultInviteTeam({
          teams: [],
          permissionRows: [],
          canGrantAll: canGrantAll,
        }),
      ).toBeNull();
      expect(canGrantAll).not.toHaveBeenCalled();
    });
  });

  describe("only a team the person may hand on", () => {
    test("skips a members team the person may not hand on, for the next one", () => {
      const everyone: InviteTeam = { id: "team-everyone", name: "Everyone" };

      expect(
        pickDefaultInviteTeam({
          teams: [everyone, members],
          permissionRows: [
            row(everyone, Permission.ProjectMember),
            row(members, Permission.ProjectMember),
            row(members, Permission.ProjectAdmin),
          ],
          canGrantAll: (permissions: Array<Permission>): boolean => {
            return !permissions.includes(Permission.ProjectAdmin);
          },
        }),
      ).toBe(everyone);
    });

    test("picks nothing when no candidate may be handed on", () => {
      expect(
        pickDefaultInviteTeam({
          teams: [owners, admins, members],
          permissionRows: defaultRows,
          canGrantAll: (): boolean => {
            return false;
          },
        }),
      ).toBeNull();
    });

    test("picks nothing when the fallback Members team may not be handed on", () => {
      const namedMembers: InviteTeam = { id: "team-m", name: "Members" };

      expect(
        pickDefaultInviteTeam({
          teams: [owners, namedMembers],
          permissionRows: [
            row(owners, Permission.ProjectOwner),
            row(namedMembers, Permission.CreateProjectMonitor),
          ],
          canGrantAll: (): boolean => {
            return false;
          },
        }),
      ).toBeNull();
    });

    test("never offers a team that is no candidate, even one that may be handed on", () => {
      const canGrantAll: Mock<CanGrantAllFunction> =
        jest.fn<CanGrantAllFunction>(grantAll);

      pickDefaultInviteTeam({
        teams: [owners, admins, members],
        permissionRows: defaultRows,
        canGrantAll: canGrantAll,
      });

      expect(canGrantAll).toHaveBeenCalledTimes(1);
      expect(canGrantAll).toHaveBeenCalledWith([Permission.ProjectMember]);
    });

    test("asks about every row of the team, blocks included, and only that team's rows", () => {
      const everyone: InviteTeam = { id: "team-everyone", name: "Everyone" };
      const canGrantAll: Mock<CanGrantAllFunction> =
        jest.fn<CanGrantAllFunction>(grantAll);

      pickDefaultInviteTeam({
        teams: [owners, everyone],
        permissionRows: [
          row(owners, Permission.ProjectOwner),
          row(everyone, Permission.ProjectMember),
          row(everyone, Permission.CreateProjectMonitor, {
            scope: PermissionScope.Labels,
          }),
          row(everyone, Permission.EditProjectMonitor, {
            isBlockPermission: true,
          }),
        ],
        canGrantAll: canGrantAll,
      });

      expect(canGrantAll).toHaveBeenCalledTimes(1);
      expect(canGrantAll).toHaveBeenCalledWith([
        Permission.ProjectMember,
        Permission.CreateProjectMonitor,
        Permission.EditProjectMonitor,
      ]);
    });

    test("stops asking once a team may be handed on", () => {
      const first: InviteTeam = { id: "team-first", name: "Engineering" };
      const second: InviteTeam = { id: "team-second", name: "Support" };
      const canGrantAll: Mock<CanGrantAllFunction> =
        jest.fn<CanGrantAllFunction>(grantAll);

      expect(
        pickDefaultInviteTeam({
          teams: [first, second],
          permissionRows: [
            row(first, Permission.ProjectMember),
            row(second, Permission.ProjectMember),
          ],
          canGrantAll: canGrantAll,
        }),
      ).toBe(first);
      expect(canGrantAll).toHaveBeenCalledTimes(1);
    });
  });

  test("leaves its inputs as they were", () => {
    const teams: Array<InviteTeam> = [owners, admins, members];
    const rows: Array<InviteTeamPermissionRow> = [...defaultRows];
    const teamsBefore: string = JSON.stringify(teams);
    const rowsBefore: string = JSON.stringify(rows);

    pickDefaultInviteTeam({
      teams: teams,
      permissionRows: rows,
      canGrantAll: grantAll,
    });

    expect(JSON.stringify(teams)).toBe(teamsBefore);
    expect(JSON.stringify(rows)).toBe(rowsBefore);
  });
});

import { describe, expect, test } from "@jest/globals";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../Types/HeldPermissions";
import Permission, { UserPermission } from "../../../Types/Permission";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import PrivateRecordHeld from "../../../Types/PrivateRecord/PrivateRecordHeld";

/*
 * WHAT A PERSON HOLDS ON ONE PRIVATE RECORD - the dashboard's statement of
 * the server's rule (PrivateRecordPermission), which its locks read: a
 * private incident, alert or episode is changed only with the permissions
 * of the teams that own it and of the people named as its owners.
 *
 * The maintainer's case (block 33): Test User 2 is in Team 1, which may
 * change every incident, and in Team 2, which may only view - and Team 2
 * alone owns private incident INC-17. On INC-17 they hold Team 2's
 * permissions, and none of Team 1's: the page offers no change of it.
 */

const TEAM_1: string = "7d000000-0000-4000-8000-000000000001";
const TEAM_2: string = "7d000000-0000-4000-8000-000000000002";
const TEAM_3: string = "7d000000-0000-4000-8000-000000000003";
const LABEL: ObjectID = new ObjectID("7d000000-0000-4000-8000-0000000000a1");

interface RowOptions {
  teamId?: string | ObjectID | Record<string, unknown> | undefined;
  isBlock?: boolean | undefined;
  labelled?: boolean | undefined;
  scope?: PermissionScope | undefined;
}

type RowFunction = (
  permission: Permission,
  options?: RowOptions,
) => UserPermission;

const row: RowFunction = (
  permission: Permission,
  options?: RowOptions,
): UserPermission => {
  const teamId: unknown = options?.teamId;

  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: options?.labelled ? [LABEL] : [],
    isBlockPermission: Boolean(options?.isBlock),
    ...(options?.scope ? { scope: options.scope } : {}),
    ...(teamId
      ? {
          teamId: (typeof teamId === "string"
            ? new ObjectID(teamId)
            : teamId) as ObjectID,
        }
      : {}),
  };
};

// What every member holds on no team's behalf (UserPermissionUtil).
const DEFAULT_ROWS: Array<UserPermission> = [
  row(Permission.CurrentUser),
  row(Permission.UnAuthorizedSsoUser),
  row(Permission.ProjectUser),
];

// What every signed-in user holds everywhere.
const GLOBAL_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

// Test User 2's snapshot: Team 1 may change every incident, Team 2 views.
const MAINTAINERS_ROWS: Array<UserPermission> = [
  ...DEFAULT_ROWS,
  row(Permission.ProjectMember, { teamId: TEAM_1 }),
  row(Permission.Viewer, { teamId: TEAM_2 }),
];

type HeldOnFunction = (data: {
  rows: Array<UserPermission>;
  owningTeamIds: Array<string>;
  isPrivate?: boolean;
  isOwnedByPerson?: boolean;
}) => HeldPermissions | null;

const heldOn: HeldOnFunction = (data: {
  rows: Array<UserPermission>;
  owningTeamIds: Array<string>;
  isPrivate?: boolean;
  isOwnedByPerson?: boolean;
}): HeldPermissions | null => {
  return PrivateRecordHeld.getHeldOnRecord({
    rows: data.rows,
    globalPermissions: GLOBAL_PERMISSIONS,
    isPrivate: data.isPrivate ?? true,
    isOwnedByPerson: data.isOwnedByPerson ?? false,
    owningTeamIds: data.owningTeamIds,
  });
};

describe("PrivateRecordHeld.getHeldOnRecord", () => {
  test("the maintainer's case: on INC-17, owned by Team 2 alone, Test User 2 holds Team 2's permissions and none of Team 1's", () => {
    const held: HeldPermissions | null = heldOn({
      rows: MAINTAINERS_ROWS,
      owningTeamIds: [TEAM_2],
    });

    expect(held).not.toBeNull();
    expect(held!.allowed).toContain(Permission.Viewer);
    expect(held!.allowed).not.toContain(Permission.ProjectMember);

    // Viewer reads incidents and changes none of them; Project Member would.
    for (const write of [
      Permission.EditProjectIncident,
      Permission.CreateIncidentStateTimeline,
      Permission.CreateIncidentInternalNote,
      Permission.CreateIncidentOwnerTeam,
    ]) {
      expect(HeldPermissionsUtil.holdsAnyOf(held!, [write])).toBe(false);
    }
    expect(
      HeldPermissionsUtil.holdsAnyOf(held!, [
        Permission.ProjectMember,
        Permission.EditProjectIncident,
      ]),
    ).toBe(false);

    // Their whole snapshot would have allowed it: that is the bug.
    const everything: HeldPermissions = HeldPermissionsUtil.fromRows({
      rows: MAINTAINERS_ROWS,
      globalPermissions: GLOBAL_PERMISSIONS,
    });

    expect(
      HeldPermissionsUtil.holdsAnyOf(everything, [
        Permission.ProjectMember,
        Permission.EditProjectIncident,
      ]),
    ).toBe(true);
  });

  test("keeps the defaults every member holds and the global permissions", () => {
    const held: HeldPermissions | null = heldOn({
      rows: MAINTAINERS_ROWS,
      owningTeamIds: [TEAM_2],
    });

    for (const permission of [
      Permission.CurrentUser,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
      Permission.Public,
      Permission.User,
    ]) {
      expect(held!.allowed).toContain(permission);
    }
    // So the gates read it as a snapshot that has landed, and lock.
    expect(HeldPermissionsUtil.isLoaded(held!)).toBe(true);
  });

  test("a private record owned by the team that may change it: everything that team holds", () => {
    const held: HeldPermissions | null = heldOn({
      rows: MAINTAINERS_ROWS,
      owningTeamIds: [TEAM_1],
    });

    expect(held!.allowed).toContain(Permission.ProjectMember);
    expect(held!.allowed).not.toContain(Permission.Viewer);
    expect(
      HeldPermissionsUtil.holdsAnyOf(held!, [Permission.ProjectMember]),
    ).toBe(true);
  });

  test("owned by both teams: what either holds", () => {
    const held: HeldPermissions | null = heldOn({
      rows: MAINTAINERS_ROWS,
      owningTeamIds: [TEAM_2, TEAM_1],
    });

    expect(held!.allowed).toEqual(
      expect.arrayContaining([Permission.ProjectMember, Permission.Viewer]),
    );
  });

  test("owned only by a team the person is not on: no team's permission of theirs", () => {
    const held: HeldPermissions | null = heldOn({
      rows: MAINTAINERS_ROWS,
      owningTeamIds: [TEAM_3],
    });

    expect(held!.allowed).not.toContain(Permission.ProjectMember);
    expect(held!.allowed).not.toContain(Permission.Viewer);
  });

  test("a record that is not private: everything they hold (null)", () => {
    expect(
      heldOn({
        rows: MAINTAINERS_ROWS,
        owningTeamIds: [TEAM_2],
        isPrivate: false,
      }),
    ).toBeNull();
  });

  test("a person named as its owner: everything they hold (null), whatever team owns it", () => {
    expect(
      heldOn({
        rows: MAINTAINERS_ROWS,
        owningTeamIds: [TEAM_2],
        isOwnedByPerson: true,
      }),
    ).toBeNull();
  });

  test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "%s over the whole project, through any team, acts on every private record (null)",
    (role: Permission) => {
      expect(
        heldOn({
          rows: [...MAINTAINERS_ROWS, row(role, { teamId: TEAM_3 })],
          owningTeamIds: [TEAM_2],
        }),
      ).toBeNull();
    },
  );

  test("a Project Admin limited to some labels does not act on every private record", () => {
    const held: HeldPermissions | null = heldOn({
      rows: [
        ...MAINTAINERS_ROWS,
        row(Permission.ProjectAdmin, { teamId: TEAM_1, labelled: true }),
      ],
      owningTeamIds: [TEAM_2],
    });

    expect(held).not.toBeNull();
    expect(held!.allowed).not.toContain(Permission.ProjectAdmin);
  });

  test("a Project Admin row that is a block grants nothing", () => {
    const held: HeldPermissions | null = heldOn({
      rows: [
        ...MAINTAINERS_ROWS,
        row(Permission.ProjectAdmin, { teamId: TEAM_1, isBlock: true }),
      ],
      owningTeamIds: [TEAM_2],
    });

    expect(held).not.toBeNull();
    expect(held!.blocked).toContain(Permission.ProjectAdmin);
  });

  test("a block applies on whichever team it is - an owning team's or another's", () => {
    const held: HeldPermissions | null = heldOn({
      rows: [
        ...MAINTAINERS_ROWS,
        row(Permission.IncidentMember, { teamId: TEAM_2 }),
        row(Permission.EditProjectIncident, { teamId: TEAM_3, isBlock: true }),
        row(Permission.DeleteProjectIncident, {
          teamId: TEAM_1,
          isBlock: true,
          labelled: true,
        }),
      ],
      owningTeamIds: [TEAM_2],
    });

    expect(held!.allowed).toContain(Permission.IncidentMember);
    expect(held!.blocked).toContain(Permission.EditProjectIncident);
    expect(held!.blockedForSomeLabels).toContain(
      Permission.DeleteProjectIncident,
    );
    expect(
      HeldPermissionsUtil.holdsAnyOf(held!, [Permission.EditProjectIncident]),
    ).toBe(false);
  });

  test("an owning team's grant limited to labels is held as it is: the server weighs labels record by record", () => {
    const held: HeldPermissions | null = heldOn({
      rows: [
        ...MAINTAINERS_ROWS,
        row(Permission.EditProjectIncident, { teamId: TEAM_2, labelled: true }),
        row(Permission.CreateIncidentInternalNote, {
          teamId: TEAM_2,
          scope: PermissionScope.Owned,
        }),
      ],
      owningTeamIds: [TEAM_2],
    });

    expect(held!.allowed).toEqual(
      expect.arrayContaining([
        Permission.EditProjectIncident,
        Permission.CreateIncidentInternalNote,
      ]),
    );
    // Neither reaches the whole project.
    expect(held!.allowedProjectWide).not.toContain(
      Permission.EditProjectIncident,
    );
    expect(held!.allowedProjectWide).not.toContain(
      Permission.CreateIncidentInternalNote,
    );
  });

  test("names the owning teams in any case and in every form a snapshot carries them", () => {
    const stored: Array<UserPermission> = [
      ...DEFAULT_ROWS,
      row(Permission.ProjectMember, {
        teamId: { _type: "ObjectID", value: TEAM_1.toUpperCase() },
      }),
      row(Permission.Viewer, { teamId: new ObjectID(TEAM_2) }),
    ];

    expect(
      heldOn({ rows: stored, owningTeamIds: [TEAM_1] })!.allowed,
    ).toContain(Permission.ProjectMember);
    expect(
      heldOn({ rows: stored, owningTeamIds: [TEAM_2.toUpperCase()] })!.allowed,
    ).toContain(Permission.Viewer);
    expect(
      heldOn({ rows: stored, owningTeamIds: [TEAM_2.toUpperCase()] })!.allowed,
    ).not.toContain(Permission.ProjectMember);
  });

  test("no rows at all: only the global permissions", () => {
    const held: HeldPermissions | null = heldOn({
      rows: [],
      owningTeamIds: [TEAM_2],
    });

    expect([...held!.allowed].sort()).toEqual([...GLOBAL_PERMISSIONS].sort());
  });
});

describe("PrivateRecordHeld.getRowsOfOwningTeams", () => {
  test("keeps the blocks, the rows no team grants and the owning teams' rows - never another team's grant", () => {
    const blockOfAnotherTeam: UserPermission = row(
      Permission.EditProjectIncident,
      { teamId: TEAM_3, isBlock: true },
    );
    const owningTeamsGrant: UserPermission = row(Permission.Viewer, {
      teamId: TEAM_2,
    });
    const anotherTeamsGrant: UserPermission = row(Permission.ProjectMember, {
      teamId: TEAM_1,
    });

    const kept: Array<UserPermission> = PrivateRecordHeld.getRowsOfOwningTeams({
      rows: [
        ...DEFAULT_ROWS,
        anotherTeamsGrant,
        owningTeamsGrant,
        blockOfAnotherTeam,
        null as unknown as UserPermission,
      ],
      owningTeamIds: [TEAM_2],
    });

    expect(kept).toEqual([
      ...DEFAULT_ROWS,
      owningTeamsGrant,
      blockOfAnotherTeam,
    ]);
  });

  test("owned by no team: the blocks and the rows no team grants", () => {
    expect(
      PrivateRecordHeld.getRowsOfOwningTeams({
        rows: MAINTAINERS_ROWS,
        owningTeamIds: [],
      }),
    ).toEqual(DEFAULT_ROWS);
  });
});

describe("PrivateRecordHeld.actsOnEveryPrivateRecord", () => {
  type ActsFunction = (rows: Array<UserPermission>) => boolean;

  const acts: ActsFunction = (rows: Array<UserPermission>): boolean => {
    return PrivateRecordHeld.actsOnEveryPrivateRecord(
      HeldPermissionsUtil.fromRows({
        rows: rows,
        globalPermissions: GLOBAL_PERMISSIONS,
      }),
    );
  };

  test("a Project Owner or Project Admin over the whole project", () => {
    expect(acts([row(Permission.ProjectOwner, { teamId: TEAM_1 })])).toBe(true);
    expect(acts([row(Permission.ProjectAdmin, { teamId: TEAM_1 })])).toBe(true);
  });

  test("nobody else: not a member, not an admin limited to labels, not a blocked admin", () => {
    expect(acts(MAINTAINERS_ROWS)).toBe(false);
    expect(
      acts([row(Permission.ProjectAdmin, { teamId: TEAM_1, labelled: true })]),
    ).toBe(false);
    expect(
      acts([
        row(Permission.ProjectAdmin, { teamId: TEAM_1 }),
        row(Permission.ProjectAdmin, { teamId: TEAM_3, isBlock: true }),
      ]),
    ).toBe(false);
  });

  test("names Project Owner and Project Admin, the roles the server lets see every private record", () => {
    expect([...PrivateRecordHeld.ACTING_ON_EVERY_PRIVATE_RECORD]).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
  });
});

describe("PrivateRecordHeld.getId", () => {
  test("reads an id in every form a snapshot carries it", () => {
    expect(PrivateRecordHeld.getId(TEAM_1)).toBe(TEAM_1);
    expect(PrivateRecordHeld.getId(new ObjectID(TEAM_1))).toBe(TEAM_1);
    expect(PrivateRecordHeld.getId({ _type: "ObjectID", value: TEAM_1 })).toBe(
      TEAM_1,
    );
  });

  test("names nothing for what is no id", () => {
    expect(PrivateRecordHeld.getId(undefined)).toBeNull();
    expect(PrivateRecordHeld.getId(null)).toBeNull();
    expect(PrivateRecordHeld.getId("")).toBeNull();
    expect(PrivateRecordHeld.getId({})).toBeNull();
    expect(PrivateRecordHeld.getId({ value: 7 })).toBeNull();
  });
});

import Label from "../../../Models/DatabaseModels/Label";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import Query from "../../../Server/Types/Database/Query";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import { meetsCondition } from "../TestingUtils/QueryConditions";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * TAKING SOMEONE OUT OF A TEAM LIFTS ITS BLOCKS FROM THEM.
 *
 * A block on one team wins over an allow on another (HeldPermissions). Mia
 * is on Engineering, which holds Incident Member over the whole project,
 * and on Contractors, which blocks Incident Member for the Security label:
 * she reads and changes every incident but the Security ones. Deleting
 * Contractors' block row needs the permission it blocks, at an equal or
 * broader scope (TeamPermissionService.onBeforeDelete), and so does joining
 * a team with block rows - yet her membership of Contractors was removed by
 * whoever could delete memberships, Mia herself included, and the Security
 * incidents were hers. Now an accepted membership is removed only by
 * someone who could grant every block row of its team
 * (TeamMemberService.assertRemoverMayLiftBlocks): here, with the team
 * permission rows and memberships stood in for by fixed lists.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "41000000-0000-4000-8000-000000000001",
);
const MIA_ID: ObjectID = new ObjectID("41000000-0000-4000-8000-000000000002");
const ADMIN_ID: ObjectID = new ObjectID("41000000-0000-4000-8000-000000000003");

const ENGINEERING_ID: ObjectID = new ObjectID(
  "41000000-0000-4000-8000-000000000011",
);
const CONTRACTORS_ID: ObjectID = new ObjectID(
  "41000000-0000-4000-8000-000000000012",
);
const ON_CALL_ID: ObjectID = new ObjectID(
  "41000000-0000-4000-8000-000000000013",
);

const SECURITY: ObjectID = new ObjectID("41000000-0000-4000-8000-000000000021");
const PRODUCTION: ObjectID = new ObjectID(
  "41000000-0000-4000-8000-000000000022",
);

// Mia's memberships, by id.
const IN_ENGINEERING: ObjectID = new ObjectID(
  "41000000-0000-4000-8000-000000000031",
);
const IN_CONTRACTORS: ObjectID = new ObjectID(
  "41000000-0000-4000-8000-000000000032",
);
const IN_ON_CALL: ObjectID = new ObjectID(
  "41000000-0000-4000-8000-000000000033",
);

const TEAM_NAMES: Record<string, string> = {
  [ENGINEERING_ID.toString()]: "Engineering",
  [CONTRACTORS_ID.toString()]: "Contractors",
  [ON_CALL_ID.toString()]: "On Call",
};

interface StoredRow {
  teamId: ObjectID;
  permission: Permission;
  isBlock: boolean;
  labelIds?: Array<ObjectID>;
  scope?: PermissionScope;
  // A copy of a custom role's permission (CustomRoleSync).
  isRoleCopy?: boolean;
}

// The team permission rows of the project.
let storedRows: Array<StoredRow> = [];

// Mia's memberships of the project.
let memberships: Array<TeamMember> = [];

// What was read: the block rows' teams, and the memberships counted.
let blockReads: Array<Query<TeamPermission>> = [];
let membershipCounts: number = 0;

function membership(data: {
  id: ObjectID;
  teamId: ObjectID;
  accepted: boolean;
  userId?: ObjectID;
}): TeamMember {
  const member: TeamMember = new TeamMember();
  member._id = data.id.toString();
  member.userId = data.userId || MIA_ID;
  member.projectId = PROJECT_ID;
  member.teamId = data.teamId;
  member.hasAcceptedInvitation = data.accepted;

  const team: Team = new Team();
  team._id = data.teamId.toString();
  team.shouldHaveAtLeastOneMember = false;
  member.team = team;

  return member;
}

// Mia on Engineering and on Contractors, both accepted.
function bothMemberships(): Array<TeamMember> {
  return [
    membership({
      id: IN_ENGINEERING,
      teamId: ENGINEERING_ID,
      accepted: true,
    }),
    membership({
      id: IN_CONTRACTORS,
      teamId: CONTRACTORS_ID,
      accepted: true,
    }),
  ];
}

function membershipById(id: ObjectID): TeamMember {
  const found: TeamMember | undefined = memberships.find(
    (member: TeamMember): boolean => {
      return member.id?.toString() === id.toString();
    },
  );

  if (!found) {
    throw new Error(`No membership ${id.toString()}`);
  }

  return found;
}

// A row as a caller's props carry it (AccessTokenService builds one per row).
function held(data: {
  permission: Permission;
  isBlock?: boolean;
  labelIds?: Array<ObjectID>;
  scope?: PermissionScope;
  teamId?: ObjectID;
}): UserPermission {
  return {
    _type: "UserPermission",
    permission: data.permission,
    labelIds: data.labelIds || [],
    isBlockPermission: Boolean(data.isBlock),
    scope:
      data.scope ||
      (data.labelIds && data.labelIds.length > 0 && !data.isBlock
        ? PermissionScope.Labels
        : PermissionScope.All),
    ...(data.teamId ? { teamId: data.teamId } : {}),
  };
}

function propsOf(
  userId: ObjectID,
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
  } as DatabaseCommonInteractionProps;
}

// Mia, with the rows of both of her teams.
function mia(): DatabaseCommonInteractionProps {
  return propsOf(MIA_ID, [
    held({
      permission: Permission.IncidentMember,
      teamId: ENGINEERING_ID,
    }),
    held({
      permission: Permission.DeleteProjectTeam,
      teamId: ENGINEERING_ID,
    }),
    held({
      permission: Permission.IncidentMember,
      isBlock: true,
      labelIds: [SECURITY],
      teamId: CONTRACTORS_ID,
    }),
    held({ permission: Permission.Viewer, teamId: CONTRACTORS_ID }),
  ]);
}

// Someone else of the project, who may delete memberships, with `rows` besides.
function remover(rows: Array<UserPermission>): DatabaseCommonInteractionProps {
  return propsOf(ADMIN_ID, [
    held({ permission: Permission.DeleteProjectTeam }),
    ...rows,
  ]);
}

const onBeforeDelete: (deleteBy: {
  query: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
}) => Promise<unknown> = (
  TeamMemberService as unknown as {
    onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
  }
).onBeforeDelete.bind(TeamMemberService);

// Removes the memberships `ids` as `props` would, through the delete hook.
async function remove(
  ids: Array<ObjectID>,
  props: DatabaseCommonInteractionProps,
): Promise<unknown> {
  const removed: Array<TeamMember> = ids.map(membershipById);

  jest
    .spyOn(
      TeamMemberService as unknown as {
        findRowsAndHoldDeleteToThem: (...args: Array<never>) => unknown;
      },
      "findRowsAndHoldDeleteToThem",
    )
    .mockImplementation((async (): Promise<Array<TeamMember>> => {
      return removed;
    }) as never);

  return await onBeforeDelete({
    query: {
      _id: ids.map((id: ObjectID): string => {
        return id.toString();
      }),
    },
    props: props,
  });
}

beforeEach(() => {
  storedRows = [
    { teamId: ENGINEERING_ID, permission: Permission.IncidentMember },
    { teamId: ENGINEERING_ID, permission: Permission.DeleteProjectTeam },
    {
      teamId: CONTRACTORS_ID,
      permission: Permission.IncidentMember,
      isBlock: true,
      labelIds: [SECURITY],
    },
    { teamId: CONTRACTORS_ID, permission: Permission.Viewer },
  ].map((row: Omit<StoredRow, "isBlock"> & { isBlock?: boolean }) => {
    return { ...row, isBlock: Boolean(row.isBlock) };
  });
  memberships = bothMemberships();
  blockReads = [];
  membershipCounts = 0;

  getJestSpyOn(TeamMemberService, "isSCIMPushGroupsEnabled").mockResolvedValue(
    false,
  );

  // The team permission rows the query names: its teams, blocks or not.
  getJestSpyOn(TeamPermissionService, "findAllBy").mockImplementation(
    (async (findBy: {
      query: Query<TeamPermission>;
    }): Promise<Array<TeamPermission>> => {
      blockReads.push(findBy.query);

      const query: Record<string, unknown> = findBy.query as Record<
        string,
        unknown
      >;

      return storedRows
        .filter((row: StoredRow): boolean => {
          return (
            meetsCondition(query["teamId"], row.teamId.toString()) &&
            (query["isBlockPermission"] === undefined ||
              query["isBlockPermission"] === row.isBlock)
          );
        })
        .map((row: StoredRow): TeamPermission => {
          const stored: TeamPermission = new TeamPermission();
          stored._id = ObjectID.generate().toString();
          stored.teamId = row.teamId;
          stored.projectId = PROJECT_ID;
          stored.permission = row.permission;
          stored.isBlockPermission = row.isBlock;
          stored.scope =
            row.scope ||
            (!row.isBlock && row.labelIds && row.labelIds.length > 0
              ? PermissionScope.Labels
              : PermissionScope.All);
          stored.labels = (row.labelIds || []).map((labelId: ObjectID) => {
            const label: Label = new Label();
            label._id = labelId.toString();
            return label;
          });

          const team: Team = new Team();
          team._id = row.teamId.toString();
          team.name = TEAM_NAMES[row.teamId.toString()]!;
          stored.team = team;

          if (row.isRoleCopy) {
            stored.teamCustomRoleId = ObjectID.generate();
          }

          return stored;
        });
    }) as never,
  );

  /*
   * A person's accepted memberships the query leaves in (how many a person
   * keeps), or a team's members for the one-member guard (plenty).
   */
  getJestSpyOn(TeamMemberService, "countBy").mockImplementation(
    (async (countBy: {
      query: Record<string, unknown>;
    }): Promise<PositiveNumber> => {
      if (!countBy.query["userId"]) {
        return new PositiveNumber(10);
      }

      membershipCounts += 1;

      return new PositiveNumber(
        memberships.filter((member: TeamMember): boolean => {
          return (
            member.userId?.toString() === countBy.query["userId"]!.toString() &&
            member.hasAcceptedInvitation ===
              countBy.query["hasAcceptedInvitation"] &&
            meetsCondition(countBy.query["_id"], member.id!.toString())
          );
        }).length,
      );
    }) as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("leaving a team that blocks something", () => {
  test("Mia, on Engineering and on Contractors, does not leave Contractors on her own", async () => {
    const leaving: Promise<unknown> = remove([IN_CONTRACTORS], mia());

    await expect(leaving).rejects.toBeInstanceOf(NotAuthorizedException);
    await expect(leaving).rejects.toThrow(
      "You cannot leave the Contractors team: it blocks Incident Member for its members, and lifting that block needs Incident Member at an equal or broader scope in your own access. Ask a project owner to remove you from the team.",
    );
  });

  test("she leaves Engineering, which blocks nothing", async () => {
    await expect(remove([IN_ENGINEERING], mia())).resolves.toBeDefined();

    // The rows read were Engineering's blocks alone: none.
    expect(blockReads).toHaveLength(1);
    expect(
      meetsCondition(blockReads[0]!["teamId"], ENGINEERING_ID.toString()),
    ).toBe(true);
    expect(blockReads[0]!["isBlockPermission"]).toBe(true);
  });

  test("leaving the project with her last team lifts nothing from anyone", async () => {
    memberships = bothMemberships().filter((member: TeamMember): boolean => {
      return member.teamId?.toString() === CONTRACTORS_ID.toString();
    });

    await expect(remove([IN_CONTRACTORS], mia())).resolves.toBeDefined();
    expect(blockReads).toHaveLength(0);
  });

  test("leaving every team of the project at once (remove from project) lifts nothing", async () => {
    await expect(
      remove([IN_ENGINEERING, IN_CONTRACTORS], remover([])),
    ).resolves.toBeDefined();

    // Her memberships were counted once: she keeps none.
    expect(membershipCounts).toBe(1);
    expect(blockReads).toHaveLength(0);
  });

  test("a pending invitation she keeps elsewhere holds no permission: she may leave", async () => {
    memberships = [
      membership({
        id: IN_CONTRACTORS,
        teamId: CONTRACTORS_ID,
        accepted: true,
      }),
      membership({
        id: IN_ON_CALL,
        teamId: ON_CALL_ID,
        accepted: false,
      }),
    ];

    await expect(remove([IN_CONTRACTORS], mia())).resolves.toBeDefined();
    expect(blockReads).toHaveLength(0);
  });

  test("withdrawing a pending invitation to Contractors asks nothing", async () => {
    memberships = [
      ...bothMemberships().filter((member: TeamMember): boolean => {
        return member.teamId?.toString() === ENGINEERING_ID.toString();
      }),
      membership({
        id: IN_CONTRACTORS,
        teamId: CONTRACTORS_ID,
        accepted: false,
      }),
    ];

    await expect(remove([IN_CONTRACTORS], remover([]))).resolves.toBeDefined();
    expect(blockReads).toHaveLength(0);
    expect(membershipCounts).toBe(0);
  });
});

describe("removing Mia from Contractors, by whom", () => {
  test.each([
    ["Delete Team and nothing more", []],
    [
      "Incident Member limited to another label",
      [
        held({
          permission: Permission.IncidentMember,
          labelIds: [PRODUCTION],
        }),
      ],
    ],
    [
      "Incident Member scoped to Owned",
      [
        held({
          permission: Permission.IncidentMember,
          scope: PermissionScope.Owned,
          teamId: ENGINEERING_ID,
        }),
      ],
    ],
    [
      "Incident Member over the whole project, but blocked from it for Security themselves",
      [
        held({ permission: Permission.IncidentMember }),
        held({
          permission: Permission.IncidentMember,
          isBlock: true,
          labelIds: [SECURITY],
        }),
      ],
    ],
    [
      "Project Admin, blocked from reading Production incidents themselves",
      [
        held({ permission: Permission.ProjectAdmin }),
        held({
          permission: Permission.ReadProjectIncident,
          isBlock: true,
          labelIds: [PRODUCTION],
        }),
      ],
    ],
    [
      "Project Owner blocked from Project Owner on another team",
      [
        held({ permission: Permission.ProjectOwner }),
        held({ permission: Permission.ProjectOwner, isBlock: true }),
      ],
    ],
  ] as Array<[string, Array<UserPermission>]>)(
    "%s: refused, and the block stays",
    async (_name: string, rows: Array<UserPermission>) => {
      await expect(remove([IN_CONTRACTORS], remover(rows))).rejects.toThrow(
        "You cannot remove this member from the Contractors team: it blocks Incident Member for them, and your own access does not include that permission at an equal or broader scope, so you cannot lift that block.",
      );
    },
  );

  test.each([
    [
      "Incident Member over the whole project",
      [held({ permission: Permission.IncidentMember })],
    ],
    [
      "Incident Member limited to the Security label",
      [
        held({
          permission: Permission.IncidentMember,
          labelIds: [SECURITY],
        }),
      ],
    ],
    [
      "Incident Member limited to Security and Production",
      [
        held({
          permission: Permission.IncidentMember,
          labelIds: [SECURITY, PRODUCTION],
        }),
      ],
    ],
    // Project Admin does everything Incident Member does, so may lift it.
    ["Project Admin", [held({ permission: Permission.ProjectAdmin })]],
  ] as Array<[string, Array<UserPermission>]>)(
    "%s: removed",
    async (_name: string, rows: Array<UserPermission>) => {
      await expect(
        remove([IN_CONTRACTORS], remover(rows)),
      ).resolves.toBeDefined();
    },
  );

  test("a project owner removes her without a read", async () => {
    await expect(
      remove(
        [IN_CONTRACTORS],
        remover([held({ permission: Permission.ProjectOwner })]),
      ),
    ).resolves.toBeDefined();

    expect(blockReads).toHaveLength(0);
    expect(membershipCounts).toBe(0);
  });

  test("OneUptime's own removals and a master admin's ask nothing", async () => {
    for (const props of [
      { isRoot: true },
      { isMasterAdmin: true, userId: ADMIN_ID, tenantId: PROJECT_ID },
    ] as Array<DatabaseCommonInteractionProps>) {
      await expect(remove([IN_CONTRACTORS], props)).resolves.toBeDefined();
    }

    expect(blockReads).toHaveLength(0);
    expect(membershipCounts).toBe(0);
  });

  test("the team's allow rows are not weighed: lifting Contractors' block needs Incident Member, not Viewer", async () => {
    await expect(
      remove(
        [IN_CONTRACTORS],
        remover([
          held({
            permission: Permission.IncidentMember,
            labelIds: [SECURITY],
          }),
        ]),
      ),
    ).resolves.toBeDefined();
  });

  test("every block row of the team is weighed, a custom role's among them", async () => {
    storedRows.push({
      teamId: CONTRACTORS_ID,
      permission: Permission.MonitorAdmin,
      isBlock: true,
      isRoleCopy: true,
    });

    await expect(
      remove(
        [IN_CONTRACTORS],
        remover([held({ permission: Permission.IncidentMember })]),
      ),
    ).rejects.toThrow(
      "You cannot remove this member from the Contractors team: it blocks Monitor Admin for them",
    );

    await expect(
      remove(
        [IN_CONTRACTORS],
        remover([
          held({ permission: Permission.IncidentMember }),
          held({ permission: Permission.MonitorAdmin }),
        ]),
      ),
    ).resolves.toBeDefined();
  });

  test("a team with no block rows is left as anyone who may delete memberships leaves it", async () => {
    storedRows = storedRows.filter((row: StoredRow): boolean => {
      return !row.isBlock;
    });

    await expect(remove([IN_CONTRACTORS], remover([]))).resolves.toBeDefined();
  });

  test("a removal from two teams at once weighs both teams' blocks, in one read", async () => {
    storedRows.push({
      teamId: ENGINEERING_ID,
      permission: Permission.MonitorAdmin,
      isBlock: true,
      labelIds: [PRODUCTION],
    });
    memberships.push(
      membership({
        id: IN_ON_CALL,
        teamId: ON_CALL_ID,
        accepted: true,
      }),
    );

    await expect(
      remove(
        [IN_ENGINEERING, IN_CONTRACTORS],
        remover([held({ permission: Permission.IncidentMember })]),
      ),
    ).rejects.toThrow("it blocks Monitor Admin for them");

    expect(blockReads).toHaveLength(1);

    for (const teamId of [ENGINEERING_ID, CONTRACTORS_ID]) {
      expect(meetsCondition(blockReads[0]!["teamId"], teamId.toString())).toBe(
        true,
      );
    }

    expect(
      meetsCondition(blockReads[0]!["teamId"], ON_CALL_ID.toString()),
    ).toBe(false);
  });
});

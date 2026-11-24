import { describe, expect, test } from "@jest/globals";
import {
  OVERRIDE_TEAM_AWAY_REFUSAL,
  OVERRIDE_TEAM_COVER_REFUSAL,
  OVERRIDE_TEAM_DELETE_REFUSAL,
  OVERRIDE_TEAM_EDIT_REFUSAL,
  OVERRIDE_TEAM_PICKER_HINT,
  USER_OVERRIDE_DELETE_PERMISSIONS,
  USER_OVERRIDE_TEAM_PERMISSION,
  USER_OVERRIDE_UPDATE_PERMISSIONS,
  getMemberIdsOfTeams,
  getOverrideTeamHint,
  getOverrideTeamLimit,
  getOverrideTeamLock,
  getOverrideTeamPersonRefusal,
  type OverrideTeamAction,
  type OverrideTeamLimit,
} from "./overrideTeamAccess";
import {
  readProjectPermissionRows,
  type ProjectPermissionRow,
} from "./globalOverrideAccess";

/*
 * WHOM SOMEONE WHO MANAGES THEIR OWN TEAM'S USER OVERRIDES MAY NAME (#9883):
 * the app's copy of the rule the server holds every add, edit and delete to
 * (Common's UserOverrideTeamAccess) and the Dashboard shows. Common's
 * UserOverrideTeamLimitMobileParity holds this copy to the Dashboard's over
 * thousands of generated rows; these are the cases the issue is about,
 * written out so a reader sees what each one does.
 *
 * Alex holds Manage On-Call Policy User Overrides for Own Team through
 * Payments; Sam is in Payments, Pat in Mobile.
 */

const PAYMENTS: string = "team-payments";
const MOBILE: string = "team-mobile";
const ALEX: string = "user-alex";
const SAM: string = "user-sam";
const PAT: string = "user-pat";

const ACTIONS: Array<OverrideTeamAction> = ["create", "update", "delete"];

function row(
  permission: string,
  data: {
    teamId?: string;
    scope?: string;
    labelIds?: Array<unknown>;
    isBlock?: boolean;
  } = {},
): ProjectPermissionRow {
  return {
    permission: permission,
    labelIds: data.labelIds ?? [],
    scope: data.scope ?? "All",
    isBlockPermission: Boolean(data.isBlock),
    ...(data.teamId ? { teamId: data.teamId } : {}),
  };
}

const ON_PAYMENTS: ProjectPermissionRow = row(USER_OVERRIDE_TEAM_PERMISSION, {
  teamId: PAYMENTS,
});
const ON_MOBILE: ProjectPermissionRow = row(USER_OVERRIDE_TEAM_PERMISSION, {
  teamId: MOBILE,
});
const READS: ProjectPermissionRow = row("OnCallViewer");
const ON_A_LABEL: { scope: string; labelIds: Array<unknown> } = {
  scope: "Labels",
  labelIds: ["label-payments"],
};

function limitOf(
  rows: Array<ProjectPermissionRow> | null,
  action: OverrideTeamAction,
  isGlobal: boolean,
  isMasterAdmin: boolean = false,
): OverrideTeamLimit | null {
  return getOverrideTeamLimit({
    rows: rows,
    isMasterAdmin: isMasterAdmin,
    action: action,
    isGlobal: isGlobal,
  });
}

// Every action, global and on a policy.
function everyLimitOf(
  rows: Array<ProjectPermissionRow>,
): Array<OverrideTeamLimit | null> {
  return ACTIONS.flatMap(
    (action: OverrideTeamAction): Array<OverrideTeamLimit | null> => {
      return [limitOf(rows, action, true), limitOf(rows, action, false)];
    },
  );
}

describe("whom the person may name, read from the rows the server sends", () => {
  test("the team permission alone: the people of the team that gives it, for every write, global or on a policy", () => {
    for (const limit of everyLimitOf([READS, ON_PAYMENTS])) {
      expect(limit).toEqual({ teamIds: [PAYMENTS] });
    }
  });

  test("given by two teams, both teams' people, in the order the rows name them", () => {
    for (const limit of everyLimitOf([ON_MOBILE, READS, ON_PAYMENTS])) {
      expect(limit).toEqual({ teamIds: [MOBILE, PAYMENTS] });
    }
  });

  test("a team's two rows of it are one team", () => {
    expect(
      limitOf(
        [
          ON_PAYMENTS,
          row(USER_OVERRIDE_TEAM_PERMISSION, {
            teamId: PAYMENTS,
            ...ON_A_LABEL,
          }),
        ],
        "create",
        true,
      ),
    ).toEqual({ teamIds: [PAYMENTS] });
  });

  test("a permission that reaches everyone over the whole project: nobody is left out", () => {
    for (const permission of [
      "ProjectOwner",
      "ProjectAdmin",
      "ProjectMember",
      "OnCallAdmin",
      "OnCallMember",
    ]) {
      expect({
        permission,
        limits: everyLimitOf([row(permission), ON_PAYMENTS]),
      }).toEqual({ permission, limits: [null, null, null, null, null, null] });
    }
  });

  test("a Project Admin stored as Owned reaches the whole project, as the server reads it", () => {
    expect(
      everyLimitOf([row("ProjectAdmin", { scope: "Owned" }), ON_PAYMENTS]),
    ).toEqual([null, null, null, null, null, null]);
  });

  test("the single permission of a write that reaches everyone frees that write only", () => {
    const rows: Array<ProjectPermissionRow> = [
      ON_PAYMENTS,
      row("EditOnCallDutyPolicyUserOverride"),
    ];

    expect(limitOf(rows, "update", true)).toBeNull();
    expect(limitOf(rows, "update", false)).toBeNull();
    expect(limitOf(rows, "create", true)).toEqual({ teamIds: [PAYMENTS] });
    expect(limitOf(rows, "delete", false)).toEqual({ teamIds: [PAYMENTS] });

    const deletes: Array<ProjectPermissionRow> = [
      ON_PAYMENTS,
      row("DeleteOnCallDutyPolicyUserOverride"),
    ];

    expect(limitOf(deletes, "delete", true)).toBeNull();
    expect(limitOf(deletes, "update", true)).toEqual({ teamIds: [PAYMENTS] });

    const creates: Array<ProjectPermissionRow> = [
      ON_PAYMENTS,
      row("CreateOnCallDutyPolicyUserOverride"),
    ];

    expect(limitOf(creates, "create", false)).toBeNull();
    expect(limitOf(creates, "delete", false)).toEqual({ teamIds: [PAYMENTS] });
  });

  test("beside a role narrowed to a label: a global override keeps to the team; one on a policy is the server's to weigh", () => {
    for (const scope of [ON_A_LABEL, { scope: "Owned", labelIds: [] }]) {
      const rows: Array<ProjectPermissionRow> = [
        row("OnCallMember", scope),
        ON_PAYMENTS,
      ];

      for (const action of ACTIONS) {
        expect(limitOf(rows, action, true)).toEqual({ teamIds: [PAYMENTS] });
        expect(limitOf(rows, action, false)).toBeNull();
      }
    }
  });

  test("a team's grant narrowed to a label reaches its policies' overrides, and no global override", () => {
    const rows: Array<ProjectPermissionRow> = [
      READS,
      ON_PAYMENTS,
      row(USER_OVERRIDE_TEAM_PERMISSION, { teamId: MOBILE, ...ON_A_LABEL }),
    ];

    expect(limitOf(rows, "update", true)).toEqual({ teamIds: [PAYMENTS] });
    expect(limitOf(rows, "update", false)).toEqual({
      teamIds: [PAYMENTS, MOBILE],
    });
  });

  test("with every grant narrowed, a global override reaches no team's people", () => {
    expect(
      limitOf(
        [
          row(USER_OVERRIDE_TEAM_PERMISSION, {
            teamId: PAYMENTS,
            ...ON_A_LABEL,
          }),
        ],
        "create",
        true,
      ),
    ).toEqual({ teamIds: [] });
  });

  test("a block with no labels on the team permission takes it away: not narrowed by it", () => {
    expect(
      everyLimitOf([
        ON_PAYMENTS,
        row(USER_OVERRIDE_TEAM_PERMISSION, { teamId: MOBILE, isBlock: true }),
      ]),
    ).toEqual([null, null, null, null, null, null]);
  });

  test("a block for some labels on it does not take it away, and grants no team", () => {
    expect(
      limitOf(
        [
          ON_PAYMENTS,
          row(USER_OVERRIDE_TEAM_PERMISSION, {
            teamId: MOBILE,
            isBlock: true,
            ...ON_A_LABEL,
          }),
        ],
        "create",
        true,
      ),
    ).toEqual({ teamIds: [PAYMENTS] });
  });

  test("a block with no labels on a permission that reaches everyone: that permission reaches nobody, and the team rule holds", () => {
    expect(
      limitOf(
        [
          row("OnCallMember"),
          row("OnCallMember", { isBlock: true }),
          ON_PAYMENTS,
        ],
        "create",
        true,
      ),
    ).toEqual({ teamIds: [PAYMENTS] });
  });

  test("held through no team - an API key's row - the permission names nobody", () => {
    expect(
      limitOf([row(USER_OVERRIDE_TEAM_PERMISSION)], "create", true),
    ).toEqual({ teamIds: [] });
  });

  test("without the team permission, a master admin, or before the server has said: not narrowed by it", () => {
    expect(everyLimitOf([READS])).toEqual([null, null, null, null, null, null]);
    expect(everyLimitOf([])).toEqual([null, null, null, null, null, null]);
    expect(limitOf([READS, ON_PAYMENTS], "create", true, true)).toBeNull();
    expect(limitOf(null, "create", true)).toBeNull();
  });

  test("the rows as the header carries them: each with the team it is granted on", () => {
    const header: string = JSON.stringify({
      _type: "UserTenantAccessPermission",
      projectId: { _type: "ObjectID", value: "project-1" },
      permissions: [
        {
          _type: "UserPermission",
          permission: USER_OVERRIDE_TEAM_PERMISSION,
          labelIds: [],
          scope: "All",
          isBlockPermission: false,
          teamId: { _type: "ObjectID", value: "TEAM-PAYMENTS" },
        },
      ],
    });

    expect(
      limitOf(readProjectPermissionRows(header, "project-1"), "update", true),
    ).toEqual({ teamIds: [PAYMENTS] });
  });

  test("the table lists the app holds are an override's own", () => {
    expect(USER_OVERRIDE_UPDATE_PERMISSIONS).toContain(
      USER_OVERRIDE_TEAM_PERMISSION,
    );
    expect(USER_OVERRIDE_DELETE_PERMISSIONS).toContain(
      USER_OVERRIDE_TEAM_PERMISSION,
    );
    expect(USER_OVERRIDE_UPDATE_PERMISSIONS).toContain(
      "EditOnCallDutyPolicyUserOverride",
    );
    expect(USER_OVERRIDE_DELETE_PERMISSIONS).toContain(
      "DeleteOnCallDutyPolicyUserOverride",
    );
  });
});

describe("which overrides are locked for the person", () => {
  const LIMIT: OverrideTeamLimit = { teamIds: [PAYMENTS] };
  const MEMBERS: ReadonlySet<string> = new Set<string>([ALEX, SAM]);

  test("one that names somebody outside the teams, away or covering: Edit and Cancel say why, in the server's words", () => {
    for (const people of [
      { awayUserId: PAT, coverUserId: SAM },
      { awayUserId: ALEX, coverUserId: PAT },
      { awayUserId: PAT, coverUserId: null },
    ]) {
      expect(
        getOverrideTeamLock({
          action: "update",
          limit: LIMIT,
          memberIds: MEMBERS,
          people,
        }),
      ).toBe(OVERRIDE_TEAM_EDIT_REFUSAL);
      expect(
        getOverrideTeamLock({
          action: "delete",
          limit: LIMIT,
          memberIds: MEMBERS,
          people,
        }),
      ).toBe(OVERRIDE_TEAM_DELETE_REFUSAL);
    }
  });

  test("one of the team's people - a skip too, ids in any case - is not", () => {
    for (const people of [
      { awayUserId: ALEX, coverUserId: SAM },
      { awayUserId: SAM.toUpperCase(), coverUserId: ` ${ALEX} ` },
      { awayUserId: ALEX, coverUserId: null },
      { awayUserId: ALEX, coverUserId: undefined },
    ]) {
      expect(
        getOverrideTeamLock({
          action: "update",
          limit: LIMIT,
          memberIds: MEMBERS,
          people,
        }),
      ).toBeNull();
    }
  });

  test("nothing is locked while the members are not known, or for someone not narrowed", () => {
    const people: { awayUserId: string; coverUserId: string } = {
      awayUserId: PAT,
      coverUserId: SAM,
    };

    expect(
      getOverrideTeamLock({
        action: "update",
        limit: LIMIT,
        memberIds: null,
        people,
      }),
    ).toBeNull();
    expect(
      getOverrideTeamLock({
        action: "delete",
        limit: null,
        memberIds: MEMBERS,
        people,
      }),
    ).toBeNull();
  });

  test("a limit to no team locks every override that names anybody", () => {
    expect(
      getOverrideTeamLock({
        action: "update",
        limit: { teamIds: [] },
        memberIds: new Set<string>(),
        people: { awayUserId: ALEX, coverUserId: null },
      }),
    ).toBe(OVERRIDE_TEAM_EDIT_REFUSAL);
  });
});

describe("what the server would refuse a person picked with, before anything is sent", () => {
  const LIMIT: OverrideTeamLimit = { teamIds: [PAYMENTS] };
  const MEMBERS: ReadonlySet<string> = new Set<string>([ALEX, SAM]);

  test("somebody outside the teams: the words for who is away, or for who covers", () => {
    expect(
      getOverrideTeamPersonRefusal({
        role: "away",
        limit: LIMIT,
        memberIds: MEMBERS,
        userId: PAT,
      }),
    ).toBe(OVERRIDE_TEAM_AWAY_REFUSAL);
    expect(
      getOverrideTeamPersonRefusal({
        role: "cover",
        limit: LIMIT,
        memberIds: MEMBERS,
        userId: PAT,
      }),
    ).toBe(OVERRIDE_TEAM_COVER_REFUSAL);
  });

  test("nobody, a teammate, members not known, or someone not narrowed: nothing", () => {
    expect(
      getOverrideTeamPersonRefusal({
        role: "cover",
        limit: LIMIT,
        memberIds: MEMBERS,
        userId: null,
      }),
    ).toBeNull();
    expect(
      getOverrideTeamPersonRefusal({
        role: "cover",
        limit: LIMIT,
        memberIds: MEMBERS,
        userId: SAM.toUpperCase(),
      }),
    ).toBeNull();
    expect(
      getOverrideTeamPersonRefusal({
        role: "away",
        limit: LIMIT,
        memberIds: null,
        userId: PAT,
      }),
    ).toBeNull();
    expect(
      getOverrideTeamPersonRefusal({
        role: "away",
        limit: null,
        memberIds: MEMBERS,
        userId: PAT,
      }),
    ).toBeNull();
  });
});

describe("the teams' members", () => {
  const MEMBERS_BY_TEAM: ReadonlyMap<string, ReadonlySet<string>> = new Map<
    string,
    ReadonlySet<string>
  >([
    [PAYMENTS, new Set<string>([ALEX, SAM])],
    [MOBILE, new Set<string>([PAT])],
  ]);

  test("are the members of the limit's teams only, whatever the case of their ids", () => {
    expect([
      ...getMemberIdsOfTeams(MEMBERS_BY_TEAM, ["TEAM-PAYMENTS"])!,
    ]).toEqual([ALEX, SAM]);
    expect(
      [...getMemberIdsOfTeams(MEMBERS_BY_TEAM, [PAYMENTS, MOBILE])!].sort(),
    ).toEqual([PAT, ALEX, SAM].sort());
    expect([...getMemberIdsOfTeams(MEMBERS_BY_TEAM, [])!]).toEqual([]);
  });

  test("are not known while who is in which team is not", () => {
    expect(getMemberIdsOfTeams(null, [PAYMENTS])).toBeNull();
  });
});

describe("the line above a picker's list", () => {
  test("names the teams as the project calls them, listed as the Dashboard lists them in English", () => {
    expect(getOverrideTeamHint(["Payments"])).toBe(
      "Only people in Payments are listed: the teams that let you manage user overrides.",
    );
    expect(getOverrideTeamHint(["Mobile", "Payments"])).toBe(
      "Only people in Mobile, Payments are listed: the teams that let you manage user overrides.",
    );
  });

  test("says nothing with no team named", () => {
    expect(getOverrideTeamHint([])).toBeNull();
    expect(getOverrideTeamHint(["", "  "])).toBeNull();
  });

  test("writes a name as it is, whatever it holds", () => {
    expect(getOverrideTeamHint(["Pay$&ments {{teams}}"])).toBe(
      OVERRIDE_TEAM_PICKER_HINT.replace("{{teams}}", (): string => {
        return "Pay$&ments {{teams}}";
      }),
    );
    expect(getOverrideTeamHint(["Pay$&ments"])).toContain("Pay$&ments");
  });
});

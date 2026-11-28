import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import LabelAccess, {
  LabelGrant,
  LabelReach,
  LabelRefusal,
  LabelRuleRows,
  LabelVerdict,
  RecordOwners,
  WeighedReach,
} from "../../../Types/LabelAccess/LabelAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * THE SHARED RULE, WITH WHO OWNS A RECORD AND A RECORD'S PARTS (#11435,
 * #11436).
 *
 * A grant scoped to Owned - every grant of an operation, or one beside
 * grants limited to labels - reaches only the records the caller or the
 * grant's team owns. The rule now reads which rows grant only on owned
 * records (getOwnedOnlyRows: the server's Owned scope finds them by it too),
 * and weighs a record - or a row of one of its parts - by its labels and,
 * when known, by who owns it (weighRecord): refused as Owned or
 * LabelsOrOwned where the server refuses, left to the owners (never
 * refused) while who owns it is not known.
 */

const LABEL_X: string = "11436000-0000-4000-8000-0000000000a1";
const LABEL_Y: string = "11436000-0000-4000-8000-0000000000a2";
const TEAM_A: string = "11436000-0000-4000-8000-0000000000b1";
const TEAM_B: string = "11436000-0000-4000-8000-0000000000b2";
const TEAM_C: string = "11436000-0000-4000-8000-0000000000b3";

const row: (
  permission: Permission,
  data?: {
    scope?: PermissionScope | undefined;
    labelIds?: Array<string> | undefined;
    isBlock?: boolean | undefined;
    teamId?: string | undefined;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    scope?: PermissionScope | undefined;
    labelIds?: Array<string> | undefined;
    isBlock?: boolean | undefined;
    teamId?: string | undefined;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: (data?.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    isBlockPermission: Boolean(data?.isBlock),
    ...(data?.scope ? { scope: data.scope } : {}),
    ...(data?.teamId ? { teamId: new ObjectID(data.teamId) } : {}),
  };
};

const ids: (
  values: ReadonlyArray<unknown> | null | undefined,
) => Array<string> = (
  values: ReadonlyArray<unknown> | null | undefined,
): Array<string> => {
  return (values || []).map((value: unknown): string => {
    return LabelAccess.readId(value);
  });
};

const MONITOR_UPDATE: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.MonitorAdmin,
  Permission.MonitorMember,
  Permission.EditProjectMonitor,
];

const reachOf: (
  rows: Array<UserPermission>,
  permissions: Array<Permission>,
  ownedScopeNarrows?: boolean,
) => LabelReach = (
  rows: Array<UserPermission>,
  permissions: Array<Permission>,
  ownedScopeNarrows: boolean = true,
): LabelReach => {
  return LabelAccess.getReach({
    rows: LabelAccess.readRows(rows),
    grantingPermissions: permissions,
    blockingPermissions: permissions,
    ownedScopeNarrows: (): boolean => {
      return ownedScopeNarrows;
    },
  });
};

const everything: () => LabelReach = (): LabelReach => {
  return {
    grant: { labelIds: [], ownedTeamIds: null },
    blockedLabelIds: [],
    blockRows: [],
  };
};

const owners: (
  isOwnedByCaller: boolean,
  teamIds?: Array<string>,
) => RecordOwners = (
  isOwnedByCaller: boolean,
  teamIds: Array<string> = [],
): RecordOwners => {
  return { isOwnedByCaller: isOwnedByCaller, teamIds: teamIds };
};

describe("getOwnedOnlyRows: the rows that grant an operation only on owned records", () => {
  const rows: (permissions: Array<UserPermission>) => LabelRuleRows = (
    permissions: Array<UserPermission>,
  ): LabelRuleRows => {
    return LabelAccess.readRows(permissions);
  };

  test("every row granting it scoped to Owned: those rows", () => {
    const owned: Array<UserPermission> | null = LabelAccess.getOwnedOnlyRows(
      rows([
        row(Permission.Viewer, { scope: PermissionScope.All }),
        row(Permission.MonitorAdmin, {
          scope: PermissionScope.Owned,
          teamId: TEAM_A,
        }),
        row(Permission.MonitorMember, {
          scope: PermissionScope.Owned,
          teamId: TEAM_B,
        }),
      ]),
      MONITOR_UPDATE,
    );

    expect(
      (owned || []).map((each: UserPermission): string => {
        return each.permission;
      }),
    ).toEqual([Permission.MonitorAdmin, Permission.MonitorMember]);
  });

  test("a row over the whole project beside them: none", () => {
    expect(
      LabelAccess.getOwnedOnlyRows(
        rows([
          row(Permission.MonitorAdmin, { scope: PermissionScope.Owned }),
          row(Permission.MonitorMember, { scope: PermissionScope.All }),
        ]),
        MONITOR_UPDATE,
      ),
    ).toBeNull();
  });

  test("a row limited to labels beside them: none - the labels and the owners reach together", () => {
    expect(
      LabelAccess.getOwnedOnlyRows(
        rows([
          row(Permission.MonitorAdmin, { scope: PermissionScope.Owned }),
          row(Permission.ProjectMember, {
            scope: PermissionScope.Labels,
            labelIds: [LABEL_X],
          }),
        ]),
        MONITOR_UPDATE,
      ),
    ).toBeNull();
  });

  test("a role a scope does not apply to, stored as Owned, reaches the whole project: none", () => {
    expect(
      LabelAccess.getOwnedOnlyRows(
        rows([row(Permission.ProjectAdmin, { scope: PermissionScope.Owned })]),
        MONITOR_UPDATE,
      ),
    ).toBeNull();
  });

  test("no row granting it at all: none", () => {
    expect(
      LabelAccess.getOwnedOnlyRows(
        rows([row(Permission.Viewer, { scope: PermissionScope.All })]),
        MONITOR_UPDATE,
      ),
    ).toBeNull();
  });

  test("a block is no grant", () => {
    expect(
      LabelAccess.getOwnedOnlyRows(
        rows([
          row(Permission.MonitorAdmin, { scope: PermissionScope.Owned }),
          row(Permission.MonitorAdmin, { isBlock: true }),
        ]),
        MONITOR_UPDATE,
      ),
    ).not.toBeNull();
  });
});

describe("getOwnedOnlyTeamIds: those rows' teams, where the scope narrows", () => {
  const OWNED: LabelRuleRows = LabelAccess.readRows([
    row(Permission.MonitorAdmin, {
      scope: PermissionScope.Owned,
      teamId: TEAM_A,
    }),
    row(Permission.MonitorMember, {
      scope: PermissionScope.Owned,
      teamId: TEAM_A,
    }),
    row(Permission.EditProjectMonitor, {
      scope: PermissionScope.Owned,
      teamId: TEAM_B,
    }),
  ]);

  test("each team once, in the order the rows name them", () => {
    expect(
      ids(
        LabelAccess.getOwnedOnlyTeamIds({
          rows: OWNED,
          permissions: MONITOR_UPDATE,
          ownedScopeNarrows: (): boolean => {
            return true;
          },
        }),
      ),
    ).toEqual([TEAM_A, TEAM_B]);
  });

  test("none where the scope narrows nothing of the model: such a row reaches every record", () => {
    expect(
      LabelAccess.getOwnedOnlyTeamIds({
        rows: OWNED,
        permissions: MONITOR_UPDATE,
        ownedScopeNarrows: (): boolean => {
          return false;
        },
      }),
    ).toBeNull();
  });

  test("the scope is asked only when every grant is scoped to Owned", () => {
    let asked: number = 0;

    LabelAccess.getOwnedOnlyTeamIds({
      rows: LabelAccess.readRows([
        row(Permission.MonitorAdmin, { scope: PermissionScope.All }),
      ]),
      permissions: MONITOR_UPDATE,
      ownedScopeNarrows: (): boolean => {
        asked++;
        return true;
      },
    });

    expect(asked).toBe(0);
  });

  test("getReach carries them; isDecidedByOwnersAnywhere says so", () => {
    const reach: LabelReach = reachOf(
      [
        row(Permission.MonitorAdmin, {
          scope: PermissionScope.Owned,
          teamId: TEAM_A,
        }),
      ],
      MONITOR_UPDATE,
    );

    expect(ids(reach.ownedOnlyTeamIds)).toEqual([TEAM_A]);
    expect(LabelAccess.isDecidedByOwnersAnywhere(reach)).toBe(true);
    expect(LabelAccess.isDecidedByOwnersAnywhere(everything())).toBe(false);
  });

  test("labels beside Owned are decided by owners too; labels alone are not", () => {
    expect(
      LabelAccess.isDecidedByOwnersAnywhere(
        reachOf(
          [
            row(Permission.ProjectMember, {
              scope: PermissionScope.Labels,
              labelIds: [LABEL_X],
            }),
            row(Permission.MonitorAdmin, {
              scope: PermissionScope.Owned,
              teamId: TEAM_A,
            }),
          ],
          MONITOR_UPDATE,
        ),
      ),
    ).toBe(true);
    expect(
      LabelAccess.isDecidedByOwnersAnywhere(
        reachOf(
          [
            row(Permission.ProjectMember, {
              scope: PermissionScope.Labels,
              labelIds: [LABEL_X],
            }),
          ],
          MONITOR_UPDATE,
        ),
      ),
    ).toBe(false);
  });
});

describe("isOwnedBy: the caller, or one of the grant's teams - never only another team of theirs", () => {
  test.each([
    ["the caller owns it", owners(true), [TEAM_A], true],
    ["the grant's team owns it", owners(false, [TEAM_A]), [TEAM_A], true],
    [
      "one of the grant's teams owns it",
      owners(false, [TEAM_B]),
      [TEAM_A, TEAM_B],
      true,
    ],
    ["another team owns it", owners(false, [TEAM_C]), [TEAM_A], false],
    ["nobody owns it", owners(false), [TEAM_A], false],
    [
      "a grant no team gives, on a record a team owns",
      owners(false, [TEAM_A]),
      [],
      false,
    ],
    [
      "ids in another case",
      owners(false, [TEAM_A.toUpperCase()]),
      [TEAM_A],
      true,
    ],
  ] as Array<[string, RecordOwners, Array<string>, boolean]>)(
    "%s",
    (
      _name: string,
      recordOwners: RecordOwners,
      teamIds: Array<string>,
      expected: boolean,
    ) => {
      expect(LabelAccess.isOwnedBy(recordOwners, teamIds)).toBe(expected);
    },
  );
});

describe("isGrantWithin: every record one grant reaches, another reaches", () => {
  const grant: (
    labels: Array<string>,
    teams?: Array<string> | null,
  ) => LabelGrant = (
    labels: Array<string>,
    teams: Array<string> | null = null,
  ): LabelGrant => {
    return {
      labelIds: labels.map((id: string) => {
        return new ObjectID(id);
      }),
      ownedTeamIds: teams
        ? teams.map((id: string) => {
            return new ObjectID(id);
          })
        : null,
    };
  };

  test.each([
    ["the same labels", grant([LABEL_X]), grant([LABEL_X]), true],
    ["fewer labels", grant([LABEL_X]), grant([LABEL_X, LABEL_Y]), true],
    ["another label", grant([LABEL_Y]), grant([LABEL_X]), false],
    [
      "owned beside labels, within labels alone",
      grant([LABEL_X], [TEAM_A]),
      grant([LABEL_X]),
      false,
    ],
    [
      "labels alone, within owned beside labels",
      grant([LABEL_X]),
      grant([LABEL_X], [TEAM_A]),
      true,
    ],
    [
      "owned teams that are all the other's",
      grant([LABEL_X], [TEAM_A]),
      grant([LABEL_X], [TEAM_A, TEAM_B]),
      true,
    ],
    [
      "owned teams that are not",
      grant([LABEL_X], [TEAM_A, TEAM_C]),
      grant([LABEL_X], [TEAM_A]),
      false,
    ],
  ] as Array<[string, LabelGrant, LabelGrant, boolean]>)(
    "%s",
    (
      _name: string,
      inner: LabelGrant,
      outer: LabelGrant,
      expected: boolean,
    ) => {
      expect(LabelAccess.isGrantWithin(inner, outer)).toBe(expected);
    },
  );
});

describe("weighRecord: a record by its labels and its owners", () => {
  const OWNED_ADMIN: Array<UserPermission> = [
    row(Permission.Viewer, { scope: PermissionScope.All }),
    row(Permission.MonitorAdmin, {
      scope: PermissionScope.Owned,
      teamId: TEAM_A,
    }),
  ];

  const LABELS_AND_OWNED: Array<UserPermission> = [
    row(Permission.Viewer, { scope: PermissionScope.All }),
    row(Permission.ProjectMember, {
      scope: PermissionScope.Labels,
      labelIds: [LABEL_X],
      teamId: TEAM_A,
    }),
    row(Permission.MonitorAdmin, {
      scope: PermissionScope.Owned,
      teamId: TEAM_B,
    }),
  ];

  const weigh: (data: {
    rows: Array<UserPermission>;
    labels: Array<string>;
    recordOwners: RecordOwners | null;
    labelsDecide?: boolean;
    ownersDecide?: boolean;
  }) => LabelVerdict = (data: {
    rows: Array<UserPermission>;
    labels: Array<string>;
    recordOwners: RecordOwners | null;
    labelsDecide?: boolean;
    ownersDecide?: boolean;
  }): LabelVerdict => {
    const operation: WeighedReach = {
      reach: reachOf(data.rows, MONITOR_UPDATE),
      ...(data.labelsDecide === undefined
        ? {}
        : { labelsDecide: data.labelsDecide }),
      ...(data.ownersDecide === undefined
        ? {}
        : { ownersDecide: data.ownersDecide }),
    };

    return LabelAccess.weighRecord({
      recordLabelIds: data.labels,
      owners: data.recordOwners,
      reads: [{ reach: everything() }],
      operations: [operation],
    });
  };

  test("every grant scoped to Owned: refused on a record nobody of theirs owns, as Owned", () => {
    const verdict: LabelVerdict = weigh({
      rows: OWNED_ADMIN,
      labels: [],
      recordOwners: owners(false),
    });

    expect(verdict).toEqual({
      isAllowed: false,
      refusal: LabelRefusal.Owned,
      labelIds: [],
      blockedPermissions: [],
      isDecidedByOwners: false,
    });
  });

  test("every grant scoped to Owned: allowed on their own, and on the grant's team's", () => {
    expect(
      weigh({ rows: OWNED_ADMIN, labels: [], recordOwners: owners(true) })
        .isAllowed,
    ).toBe(true);
    expect(
      weigh({
        rows: OWNED_ADMIN,
        labels: [],
        recordOwners: owners(false, [TEAM_A]),
      }).isAllowed,
    ).toBe(true);
    expect(
      weigh({
        rows: OWNED_ADMIN,
        labels: [],
        recordOwners: owners(false, [TEAM_B]),
      }).refusal,
    ).toBe(LabelRefusal.Owned);
  });

  test("while who owns it is not known, the owners decide: allowed, and said to be theirs", () => {
    expect(
      weigh({ rows: OWNED_ADMIN, labels: [], recordOwners: null }),
    ).toEqual({
      isAllowed: true,
      refusal: null,
      labelIds: [],
      blockedPermissions: [],
      isDecidedByOwners: true,
    });
  });

  test("labels beside Owned: a record carrying the labels is allowed, whoever owns it", () => {
    expect(
      weigh({
        rows: LABELS_AND_OWNED,
        labels: [LABEL_X],
        recordOwners: owners(false),
      }),
    ).toEqual({
      isAllowed: true,
      refusal: null,
      labelIds: [],
      blockedPermissions: [],
      isDecidedByOwners: false,
    });
  });

  test("labels beside Owned: one carrying none, owned by the Owned grant's team, is allowed", () => {
    expect(
      weigh({
        rows: LABELS_AND_OWNED,
        labels: [],
        recordOwners: owners(false, [TEAM_B]),
      }).isAllowed,
    ).toBe(true);
  });

  test("labels beside Owned: one carrying none, owned by the labels' team, is refused as LabelsOrOwned", () => {
    const verdict: LabelVerdict = weigh({
      rows: LABELS_AND_OWNED,
      labels: [],
      recordOwners: owners(false, [TEAM_A]),
    });

    expect(verdict.isAllowed).toBe(false);
    expect(verdict.refusal).toBe(LabelRefusal.LabelsOrOwned);
    expect(ids(verdict.labelIds)).toEqual([LABEL_X]);
  });

  test("labels beside Owned, owners not known: the owners decide", () => {
    const verdict: LabelVerdict = weigh({
      rows: LABELS_AND_OWNED,
      labels: [LABEL_Y],
      recordOwners: null,
    });

    expect(verdict.isAllowed).toBe(true);
    expect(verdict.isDecidedByOwners).toBe(true);
  });

  test("owners that are not the record's decide nothing: allowed, and left to the server", () => {
    const verdict: LabelVerdict = weigh({
      rows: OWNED_ADMIN,
      labels: [],
      recordOwners: owners(false),
      ownersDecide: false,
    });

    expect(verdict.isAllowed).toBe(true);
    expect(verdict.isDecidedByOwners).toBe(false);
  });

  test("labels that are not all the rows carry refuse no grant: another record may carry them", () => {
    const verdict: LabelVerdict = weigh({
      rows: [
        row(Permission.Viewer, { scope: PermissionScope.All }),
        row(Permission.ProjectMember, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_X],
        }),
      ],
      labels: [],
      recordOwners: null,
      labelsDecide: false,
    });

    expect(verdict.isAllowed).toBe(true);
  });

  test("but such labels' blocks refuse: a block takes a row away through any record it names", () => {
    const verdict: LabelVerdict = weigh({
      rows: [
        row(Permission.ProjectMember, { scope: PermissionScope.All }),
        row(Permission.MonitorAdmin, { isBlock: true, labelIds: [LABEL_X] }),
      ],
      labels: [LABEL_X],
      recordOwners: null,
      labelsDecide: false,
    });

    expect(verdict.refusal).toBe(LabelRefusal.BlockedLabels);
    expect(ids(verdict.labelIds)).toEqual([LABEL_X]);
    expect(verdict.blockedPermissions).toEqual([Permission.MonitorAdmin]);
  });

  test("and a grant scoped to Owned still refuses there, by the record's owners", () => {
    expect(
      weigh({
        rows: OWNED_ADMIN,
        labels: [],
        recordOwners: owners(false),
        labelsDecide: false,
      }).refusal,
    ).toBe(LabelRefusal.Owned);
  });
});

describe("weighRecord: a write needs a read, and the refusal says why it does not reach", () => {
  test("a read every grant of which is scoped to Owned, on a record nobody of theirs owns: NotReadable, because of the owners", () => {
    const verdict: LabelVerdict = LabelAccess.weighRecord({
      recordLabelIds: [],
      owners: owners(false),
      reads: [
        {
          reach: reachOf(
            [
              row(Permission.MonitorViewer, {
                scope: PermissionScope.Owned,
                teamId: TEAM_A,
              }),
            ],
            [Permission.MonitorViewer],
          ),
        },
      ],
      operations: [{ reach: everything() }],
    });

    expect(verdict.refusal).toBe(LabelRefusal.NotReadable);
    expect(verdict.cause).toBe(LabelRefusal.Owned);
  });

  test("a read limited to labels the record carries none of: NotReadable, because of the labels", () => {
    const verdict: LabelVerdict = LabelAccess.weighRecord({
      recordLabelIds: [],
      owners: null,
      reads: [
        {
          reach: reachOf(
            [
              row(Permission.MonitorViewer, {
                scope: PermissionScope.Labels,
                labelIds: [LABEL_X],
              }),
            ],
            [Permission.MonitorViewer],
          ),
        },
      ],
      operations: [],
    });

    expect(verdict.refusal).toBe(LabelRefusal.NotReadable);
    expect(verdict.cause).toBe(LabelRefusal.Labels);
    expect(ids(verdict.labelIds)).toEqual([LABEL_X]);
  });

  test("a read's block on one of its labels: NotReadable, because of the block", () => {
    const verdict: LabelVerdict = LabelAccess.weighRecord({
      recordLabelIds: [LABEL_Y],
      owners: null,
      reads: [
        {
          reach: reachOf(
            [
              row(Permission.Viewer, { scope: PermissionScope.All }),
              row(Permission.Viewer, { isBlock: true, labelIds: [LABEL_Y] }),
            ],
            [Permission.Viewer],
          ),
        },
      ],
      operations: [],
    });

    expect(verdict.refusal).toBe(LabelRefusal.NotReadable);
    expect(verdict.cause).toBe(LabelRefusal.BlockedLabels);
    expect(ids(verdict.labelIds)).toEqual([LABEL_Y]);
  });

  test("the first refusal stands: the reads', then each operation's in turn", () => {
    const verdict: LabelVerdict = LabelAccess.weighRecord({
      recordLabelIds: [],
      owners: owners(false),
      reads: [{ reach: everything() }],
      operations: [
        {
          reach: reachOf(
            [
              row(Permission.ProjectMember, {
                scope: PermissionScope.Labels,
                labelIds: [LABEL_X],
              }),
            ],
            MONITOR_UPDATE,
          ),
        },
        {
          reach: reachOf(
            [row(Permission.MonitorAdmin, { scope: PermissionScope.Owned })],
            MONITOR_UPDATE,
          ),
        },
      ],
    });

    expect(verdict.refusal).toBe(LabelRefusal.Labels);
  });

  test("weighLabelledRecord is the record's own case, owners included", () => {
    const read: LabelReach = everything();
    const operation: LabelReach = reachOf(
      [
        row(Permission.MonitorAdmin, {
          scope: PermissionScope.Owned,
          teamId: TEAM_A,
        }),
      ],
      MONITOR_UPDATE,
    );

    expect(
      LabelAccess.weighLabelledRecord({
        recordLabelIds: [],
        read: read,
        operation: operation,
      }).isDecidedByOwners,
    ).toBe(true);
    expect(
      LabelAccess.weighLabelledRecord({
        recordLabelIds: [],
        read: read,
        operation: operation,
        owners: owners(false, [TEAM_C]),
      }).refusal,
    ).toBe(LabelRefusal.Owned);
    expect(
      LabelAccess.weighLabelledRecord({
        recordLabelIds: [],
        read: read,
        operation: operation,
        owners: owners(false, [TEAM_A]),
      }).isAllowed,
    ).toBe(true);
  });
});

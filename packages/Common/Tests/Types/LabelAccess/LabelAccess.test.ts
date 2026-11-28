import Monitor from "../../../Models/DatabaseModels/Monitor";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../Types/HeldPermissions";
import LabelAccess, {
  LabelGrant,
  LabelReach,
  LabelRefusal,
  LabelRuleRows,
  LabelVerdict,
} from "../../../Types/LabelAccess/LabelAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { describe, expect, test } from "@jest/globals";

/*
 * THE LABEL RULE THE SERVER AND THE DASHBOARD BOTH DECIDE BY (#11259).
 *
 * A team of the customer's held Viewer over the whole project and Project
 * Member on the monitors labelled X. The server refused every change of a
 * monitor outside X; the Dashboard offered them all, because it asked only
 * whether the reader held Delete Monitor somewhere. Both now ask
 * Types/LabelAccess/LabelAccess. These tests hold the rule itself to what
 * the server has always weighed (AccessControlPermission
 * .getGrantByPermissions, ReadPermission.getLabelledBlockRows,
 * checkRecordByModel): which rows grant without a label limit, which are
 * limited to labels, which are scoped to Owned, what a block with labels
 * takes away, and what is left on one record.
 */

const LABEL_X: string = "11259000-0000-4000-8000-0000000000a1";
const LABEL_Y: string = "11259000-0000-4000-8000-0000000000a2";
const LABEL_Z: string = "11259000-0000-4000-8000-0000000000a3";
const TEAM_A: string = "11259000-0000-4000-8000-0000000000b1";
const TEAM_B: string = "11259000-0000-4000-8000-0000000000b2";

const row: (
  permission: Permission,
  data?: {
    scope?: PermissionScope | undefined;
    labelIds?: Array<unknown> | undefined;
    isBlock?: boolean | undefined;
    teamId?: string | undefined;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    scope?: PermissionScope | undefined;
    labelIds?: Array<unknown> | undefined;
    isBlock?: boolean | undefined;
    teamId?: string | undefined;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: (data?.labelIds || []) as Array<ObjectID>,
    isBlockPermission: Boolean(data?.isBlock),
    ...(data?.scope ? { scope: data.scope } : {}),
    ...(data?.teamId ? { teamId: new ObjectID(data.teamId) } : {}),
  };
};

const ids: (values: ReadonlyArray<ObjectID>) => Array<string> = (
  values: ReadonlyArray<ObjectID>,
): Array<string> => {
  return values.map((value: ObjectID): string => {
    return value.toString().toLowerCase();
  });
};

// The customer's team: Viewer over the project, Project Member on label X.
const CUSTOMER_ROWS: Array<UserPermission> = [
  row(Permission.Viewer, { scope: PermissionScope.All }),
  row(Permission.ProjectMember, {
    scope: PermissionScope.Labels,
    labelIds: [new ObjectID(LABEL_X)],
  }),
];

const monitor: Monitor = new Monitor();

/*
 * An operation's reach on a monitor, read from rows the way both sides read
 * them: the model's own list and its wildcard, granting and blocking.
 */
const monitorReach: (
  rows: Array<UserPermission>,
  operation: "read" | "update" | "delete",
  ownedScopeNarrows?: boolean,
) => LabelReach = (
  rows: Array<UserPermission>,
  operation: "read" | "update" | "delete",
  ownedScopeNarrows?: boolean,
): LabelReach => {
  const held: HeldPermissions = HeldPermissionsUtil.fromRows({ rows: rows });
  const modelPermissions: Array<Permission> =
    operation === "read"
      ? monitor.getReadPermissions()
      : operation === "update"
        ? monitor.getUpdatePermissions()
        : monitor.getDeletePermissions();
  const wildcard: Permission | null = HeldPermissionsUtil.getModelWildcard({
    isOperationalResource: monitor.isOperationalResource,
    operation: operation,
  });

  return LabelAccess.getReach({
    rows: LabelAccess.readRows(rows),
    grantingPermissions: HeldPermissionsUtil.getGrantingPermissions(held, {
      modelPermissions: modelPermissions,
      wildcard: wildcard,
    }),
    blockingPermissions: HeldPermissionsUtil.getLabelBlockingPermissions(held, {
      modelPermissions: modelPermissions,
      wildcard: wildcard,
    }),
    ownedScopeNarrows: (): boolean => {
      return ownedScopeNarrows !== false;
    },
  });
};

const weighDelete: (
  rows: Array<UserPermission>,
  recordLabelIds: Array<unknown>,
) => LabelVerdict = (
  rows: Array<UserPermission>,
  recordLabelIds: Array<unknown>,
): LabelVerdict => {
  return LabelAccess.weighLabelledRecord({
    recordLabelIds: recordLabelIds,
    read: monitorReach(rows, "read"),
    operation: monitorReach(rows, "delete"),
  });
};

describe("LabelAccess.readRows: which rows grant without a label limit", () => {
  test("a row over the whole project grants without a limit", () => {
    const rows: LabelRuleRows = LabelAccess.readRows(CUSTOMER_ROWS);

    expect(rows.unlimited).toEqual([Permission.Viewer]);
    expect(
      rows.limitedToLabels.map((each: UserPermission): Permission => {
        return each.permission;
      }),
    ).toEqual([Permission.ProjectMember]);
    expect(rows.owned).toEqual([]);
    expect(rows.labelledBlocks).toEqual([]);
  });

  test("a row stored with labels and no scope is limited to them, as the server reads it", () => {
    const rows: LabelRuleRows = LabelAccess.readRows([
      row(Permission.MonitorAdmin, { labelIds: [LABEL_X] }),
    ]);

    expect(rows.limitedToLabels).toHaveLength(1);
    expect(rows.unlimited).toEqual([]);
  });

  test("an All row with labels of a role that cannot be scoped reaches the whole project", () => {
    const rows: LabelRuleRows = LabelAccess.readRows([
      row(Permission.ProjectAdmin, {
        scope: PermissionScope.All,
        labelIds: [LABEL_X],
      }),
    ]);

    expect(rows.unlimited).toEqual([Permission.ProjectAdmin]);
    expect(rows.limitedToLabels).toEqual([]);
  });

  test("an Owned row is kept apart, and an Owned row of a role that cannot be scoped reaches everything", () => {
    const rows: LabelRuleRows = LabelAccess.readRows([
      row(Permission.MonitorAdmin, {
        scope: PermissionScope.Owned,
        teamId: TEAM_A,
      }),
      row(Permission.ProjectOwner, { scope: PermissionScope.Owned }),
    ]);

    expect(
      rows.owned.map((each: UserPermission): Permission => {
        return each.permission;
      }),
    ).toEqual([Permission.MonitorAdmin]);
    expect(rows.unlimited).toEqual([Permission.ProjectOwner]);
  });

  test("only a block with labels is a labelled block; an allow row is never one", () => {
    const rows: LabelRuleRows = LabelAccess.readRows([
      row(Permission.DeleteProjectMonitor, {
        isBlock: true,
        labelIds: [LABEL_Y],
      }),
      row(Permission.EditProjectMonitor, { isBlock: true }),
      row(Permission.Viewer, { scope: PermissionScope.All }),
    ]);

    expect(
      rows.labelledBlocks.map((each: UserPermission): Permission => {
        return each.permission;
      }),
    ).toEqual([Permission.DeleteProjectMonitor]);
    expect(rows.unlimited).toEqual([Permission.Viewer]);
  });

  test("rows that are not rows are skipped", () => {
    expect(
      LabelAccess.readRows([
        null as unknown as UserPermission,
        {} as UserPermission,
      ]),
    ).toEqual({
      unlimited: [],
      limitedToLabels: [],
      owned: [],
      labelledBlocks: [],
    });
    expect(LabelAccess.readRows(undefined).unlimited).toEqual([]);
  });
});

describe("LabelAccess.getGrant: the labels an operation's grants are limited to", () => {
  test("the customer's delete is limited to label X", () => {
    const grant: LabelGrant = monitorReach(CUSTOMER_ROWS, "delete").grant;

    expect(ids(grant.labelIds)).toEqual([LABEL_X]);
    expect(grant.ownedTeamIds).toBeNull();
  });

  test("the customer's read reaches every monitor: Viewer is over the whole project", () => {
    const grant: LabelGrant = monitorReach(CUSTOMER_ROWS, "read").grant;

    expect(grant.labelIds).toEqual([]);
    expect(grant.ownedTeamIds).toBeNull();
  });

  test("grants on two teams limited to two labels reach both", () => {
    const grant: LabelGrant = monitorReach(
      [
        row(Permission.MonitorMember, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_X],
        }),
        row(Permission.DeleteProjectMonitor, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_Y, LABEL_X],
        }),
      ],
      "delete",
    ).grant;

    expect(ids(grant.labelIds).sort()).toEqual([LABEL_X, LABEL_Y].sort());
  });

  test("one grant over the whole project beside one limited to labels reaches everything", () => {
    const grant: LabelGrant = monitorReach(
      [
        ...CUSTOMER_ROWS,
        row(Permission.DeleteProjectMonitor, { scope: PermissionScope.All }),
      ],
      "delete",
    ).grant;

    expect(grant.labelIds).toEqual([]);
  });

  test("the operational-resource wildcard limited to labels limits the operation to them", () => {
    const grant: LabelGrant = monitorReach(
      [
        row(Permission.Viewer, { scope: PermissionScope.All }),
        row(Permission.DeleteAllOperationalResources, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_Z],
        }),
      ],
      "delete",
    ).grant;

    expect(ids(grant.labelIds)).toEqual([LABEL_Z]);
  });

  test("grants scoped to Owned beside the labels reach their teams' records too", () => {
    const grant: LabelGrant = monitorReach(
      [
        ...CUSTOMER_ROWS,
        row(Permission.MonitorAdmin, {
          scope: PermissionScope.Owned,
          teamId: TEAM_B,
        }),
      ],
      "delete",
    ).grant;

    expect(ids(grant.labelIds)).toEqual([LABEL_X]);
    expect(ids(grant.ownedTeamIds || [])).toEqual([TEAM_B]);
  });

  test("where the Owned scope narrows nothing, an Owned grant beside labels reaches everything", () => {
    const grant: LabelGrant = monitorReach(
      [
        ...CUSTOMER_ROWS,
        row(Permission.MonitorAdmin, {
          scope: PermissionScope.Owned,
          teamId: TEAM_B,
        }),
      ],
      "delete",
      false,
    ).grant;

    expect(grant.labelIds).toEqual([]);
    expect(grant.ownedTeamIds).toBeNull();
  });

  test("the Owned scope is asked about only when an Owned grant stands beside labels", () => {
    const ownedScopeNarrows: MockFunction =
      getJestMockFunction().mockReturnValue(true);

    LabelAccess.getGrant({
      rows: LabelAccess.readRows(CUSTOMER_ROWS),
      permissions: monitor.getDeletePermissions(),
      ownedScopeNarrows: ownedScopeNarrows,
    });

    expect(ownedScopeNarrows).not.toHaveBeenCalled();
  });

  test("label ids read from a stored snapshot ({ value }, upper case) are the same labels", () => {
    const grant: LabelGrant = LabelAccess.getGrant({
      rows: LabelAccess.readRows([
        row(Permission.ProjectMember, {
          scope: PermissionScope.Labels,
          labelIds: [
            { _type: "ObjectID", value: LABEL_X.toUpperCase() },
            LABEL_X,
          ],
        }),
      ]),
      permissions: monitor.getDeletePermissions(),
      ownedScopeNarrows: (): boolean => {
        return true;
      },
    });

    expect(ids(grant.labelIds)).toEqual([LABEL_X]);
  });

  test("an ObjectID a row holds is kept as it is", () => {
    const label: ObjectID = new ObjectID(LABEL_Y);

    const grant: LabelGrant = LabelAccess.getGrant({
      rows: LabelAccess.readRows([
        row(Permission.ProjectMember, {
          scope: PermissionScope.Labels,
          labelIds: [label],
        }),
      ]),
      permissions: monitor.getDeletePermissions(),
      ownedScopeNarrows: (): boolean => {
        return true;
      },
    });

    expect(grant.labelIds[0]).toBe(label);
  });

  test("no row of the permissions at all: nothing to narrow, the table check refuses", () => {
    const grant: LabelGrant = monitorReach(
      [row(Permission.Viewer, { scope: PermissionScope.All })],
      "delete",
    ).grant;

    expect(grant).toEqual({ labelIds: [], ownedTeamIds: null });
  });
});

describe("LabelAccess.weighLabelledRecord: what the labels leave on one record", () => {
  test("the customer may delete monitor A, labelled X", () => {
    const verdict: LabelVerdict = weighDelete(CUSTOMER_ROWS, [LABEL_X]);

    expect(verdict.isAllowed).toBe(true);
    expect(verdict.refusal).toBeNull();
    expect(verdict.isDecidedByOwners).toBe(false);
  });

  test("the customer may not delete monitor B, which carries no labels: their grant is limited to X", () => {
    const verdict: LabelVerdict = weighDelete(CUSTOMER_ROWS, []);

    expect(verdict.isAllowed).toBe(false);
    expect(verdict.refusal).toBe(LabelRefusal.Labels);
    expect(ids(verdict.labelIds)).toEqual([LABEL_X]);
  });

  test("nor a monitor that carries only other labels", () => {
    const verdict: LabelVerdict = weighDelete(CUSTOMER_ROWS, [
      LABEL_Y,
      LABEL_Z,
    ]);

    expect(verdict.refusal).toBe(LabelRefusal.Labels);
  });

  test("a record's labels match whatever their case or form", () => {
    expect(
      weighDelete(CUSTOMER_ROWS, [
        { _id: LABEL_X.toUpperCase() },
        new ObjectID(LABEL_Y),
      ]).isAllowed,
    ).toBe(true);
  });

  test("a team's block on a label the record carries takes the delete away, whatever grants it", () => {
    const rows: Array<UserPermission> = [
      row(Permission.ProjectMember, { scope: PermissionScope.All }),
      row(Permission.DeleteProjectMonitor, {
        isBlock: true,
        labelIds: [LABEL_Y],
      }),
    ];

    const verdict: LabelVerdict = weighDelete(rows, [LABEL_X, LABEL_Y]);

    expect(verdict.isAllowed).toBe(false);
    expect(verdict.refusal).toBe(LabelRefusal.BlockedLabels);
    expect(ids(verdict.labelIds)).toEqual([LABEL_Y]);
    expect(verdict.blockedPermissions).toEqual([
      Permission.DeleteProjectMonitor,
    ]);

    // A record without the blocked label is deleted.
    expect(weighDelete(rows, [LABEL_X]).isAllowed).toBe(true);
  });

  test("a block is weighed before the grant's labels, as the server refuses", () => {
    // Z is outside the grant's labels and blocked as well: the block is said.
    const verdict: LabelVerdict = weighDelete(
      [
        ...CUSTOMER_ROWS,
        row(Permission.DeleteProjectMonitor, {
          isBlock: true,
          labelIds: [LABEL_Z],
        }),
      ],
      [LABEL_Z],
    );

    expect(verdict.refusal).toBe(LabelRefusal.BlockedLabels);
    expect(ids(verdict.labelIds)).toEqual([LABEL_Z]);
  });

  test("a block on a permission the read accepts takes the record from the read itself", () => {
    // Project Member reads monitors too: blocked on Z, a Z monitor is not read.
    const verdict: LabelVerdict = weighDelete(
      [
        ...CUSTOMER_ROWS,
        row(Permission.ProjectMember, {
          isBlock: true,
          labelIds: [LABEL_Z],
        }),
      ],
      [LABEL_Z],
    );

    expect(verdict.refusal).toBe(LabelRefusal.NotReadable);
  });

  test("a write needs a read: a record outside the read's labels is not one the caller may read", () => {
    const rows: Array<UserPermission> = [
      row(Permission.ProjectMember, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_X],
      }),
    ];

    expect(weighDelete(rows, []).refusal).toBe(LabelRefusal.NotReadable);
    expect(weighDelete(rows, [LABEL_X]).isAllowed).toBe(true);
  });

  test("a block on the read takes the record away from a write too", () => {
    const verdict: LabelVerdict = weighDelete(
      [
        row(Permission.ProjectMember, { scope: PermissionScope.All }),
        row(Permission.ProjectMember, {
          isBlock: true,
          labelIds: [LABEL_Z],
        }),
      ],
      [LABEL_Z],
    );

    expect(verdict.refusal).toBe(LabelRefusal.NotReadable);
  });

  test("beside grants scoped to Owned, a record outside the labels is the owners' to decide", () => {
    const verdict: LabelVerdict = weighDelete(
      [
        ...CUSTOMER_ROWS,
        row(Permission.MonitorAdmin, {
          scope: PermissionScope.Owned,
          teamId: TEAM_A,
        }),
      ],
      [],
    );

    expect(verdict.isAllowed).toBe(true);
    expect(verdict.isDecidedByOwners).toBe(true);
    expect(verdict.refusal).toBeNull();
  });

  test("a read is weighed by the read alone", () => {
    const verdict: LabelVerdict = LabelAccess.weighLabelledRecord({
      recordLabelIds: [],
      read: monitorReach(CUSTOMER_ROWS, "read"),
    });

    expect(verdict.isAllowed).toBe(true);
  });

  test("a grant over the whole project reaches a record with no labels", () => {
    expect(
      weighDelete(
        [row(Permission.ProjectMember, { scope: PermissionScope.All })],
        [],
      ).isAllowed,
    ).toBe(true);
  });
});

describe("LabelAccess helpers", () => {
  test("readId reads every form an id is held in", () => {
    expect(LabelAccess.readId(LABEL_X.toUpperCase())).toBe(LABEL_X);
    expect(LabelAccess.readId(new ObjectID(LABEL_X))).toBe(LABEL_X);
    expect(LabelAccess.readId({ value: LABEL_X })).toBe(LABEL_X);
    expect(LabelAccess.readId({ _id: LABEL_X })).toBe(LABEL_X);
    expect(LabelAccess.readId({})).toBe("");
    expect(LabelAccess.readId(null)).toBe("");
  });

  test("getBlockOnRecord names the first block whose labels the record carries", () => {
    const blocks: Array<UserPermission> = [
      row(Permission.EditProjectMonitor, {
        isBlock: true,
        labelIds: [LABEL_X],
      }),
      row(Permission.MonitorMember, { isBlock: true, labelIds: [LABEL_Y] }),
    ];

    expect(LabelAccess.getBlockOnRecord([LABEL_Y], blocks)?.permission).toBe(
      Permission.MonitorMember,
    );
    expect(LabelAccess.getBlockOnRecord([LABEL_Z], blocks)).toBeNull();
  });

  test("getLabelsDecidingAlone leaves the labels to the owners when Owned grants stand beside them", () => {
    expect(
      LabelAccess.getLabelsDecidingAlone({
        labelIds: [new ObjectID(LABEL_X)],
        ownedTeamIds: [new ObjectID(TEAM_A)],
      }),
    ).toEqual([]);
  });
});

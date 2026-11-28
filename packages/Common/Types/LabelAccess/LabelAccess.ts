import PermissionScope from "../Database/AccessControl/PermissionScope";
import HeldPermissionsUtil from "../HeldPermissions";
import ObjectID from "../ObjectID";
import Permission, { PermissionHelper, UserPermission } from "../Permission";

/*
 * WHERE A CALLER'S GRANTS LIMITED TO LABELS REACH, AND WHAT A RECORD'S OWN
 * LABELS LET THEM DO TO IT: the one rule the server and the Dashboard both
 * decide by (#11259).
 *
 * A team's permission can be limited to the records carrying some labels: a
 * Project Member over the monitors labelled Payments changes those monitors
 * and no other. The server weighs it on every read and write
 * (Server/Types/Database/Permissions/AccessControlPermission, ReadPermission);
 * the Dashboard used to ask only whether the reader held the permission
 * somewhere in the project, so a Viewer over the whole project who was a
 * Project Member on one label was offered Edit and Delete on every monitor,
 * and refused when they pressed them. Both now ask this file:
 *
 *   - getGrant: the labels an operation's grants are limited to, from the
 *     caller's permission rows - none when one of them reaches the whole
 *     project, and the teams of grants scoped to Owned that stand beside
 *     them, which reach the records the caller or those teams own as well;
 *   - getBlockedLabelIds: the labels a team's block takes away from it;
 *   - weighLabelledRecord: what those leave the caller on one record that
 *     carries labels of its own, for a read, or a write and the read it
 *     needs - by the record's labels alone.
 *
 * The server reads the rows from the request, the Dashboard from its
 * permission snapshot. Neither decides the label part any other way.
 */

/*
 * What the allow rows of a list of permissions reach of a labelled model's
 * records, for one operation. `labelIds` empty: the grants are not limited
 * to labels - they reach the whole project, or only owned records, which
 * the Owned scope weighs - and `ownedTeamIds` is null. `ownedTeamIds` null:
 * no grant scoped to Owned stands beside the labels; otherwise the teams of
 * those grants, whose records the caller reaches too, beside their own.
 */
export interface LabelGrant {
  labelIds: Array<ObjectID>;
  ownedTeamIds: Array<ObjectID> | null;
}

/*
 * A caller's rows as this rule reads them, read once for every operation
 * and column a check weighs.
 */
export interface LabelRuleRows {
  // What an allow row grants without a label limit (isLimitedToLabels false, not Owned).
  unlimited: Array<Permission>;
  // The allow rows limited to labels.
  limitedToLabels: Array<UserPermission>;
  // The allow rows scoped to Owned, of permissions that can be scoped.
  owned: Array<UserPermission>;
  // The block rows that carry labels.
  labelledBlocks: Array<UserPermission>;
}

// What one operation's grants and blocks leave of a labelled model's records.
export interface LabelReach {
  grant: LabelGrant;
  // The labels a team's block takes away from the operation.
  blockedLabelIds: Array<ObjectID>;
  // Those blocks, for a refusal that names the ones that hit a record.
  blockRows: Array<UserPermission>;
}

// Why the labels refuse an operation on a record.
export enum LabelRefusal {
  /*
   * A write needs a read, and the caller's read does not reach this record:
   * its grant is limited to labels the record carries none of, or a block
   * takes a label of the record away. Answered as a missing record.
   */
  NotReadable = "NotReadable",
  // A team's block takes the operation away on a label the record carries.
  BlockedLabels = "BlockedLabels",
  // The operation's grant is limited to labels the record carries none of.
  Labels = "Labels",
}

export interface LabelVerdict {
  /*
   * Whether the labels let the caller do it. True also when they do not
   * decide it (isDecidedByOwners): whoever owns the record does, which a
   * check of the labels cannot see.
   */
  isAllowed: boolean;
  refusal: LabelRefusal | null;
  /*
   * Labels: the labels the operation's grant reaches. BlockedLabels: the
   * labels of the record the block takes away. NotReadable: empty.
   */
  labelIds: Array<ObjectID>;
  // BlockedLabels: the permissions the blocks name.
  blockedPermissions: Array<Permission>;
  /*
   * The record carries none of the labels, and grants scoped to Owned stand
   * beside them: it is reached as one the caller or those grants' teams own,
   * or not at all - the owners decide.
   */
  isDecidedByOwners: boolean;
}

const reachesEverything: () => LabelGrant = (): LabelGrant => {
  return { labelIds: [], ownedTeamIds: null };
};

export default class LabelAccess {
  /*
   * An id as a request or a stored snapshot holds it - an ObjectID, its
   * text, an object stored as { value } or { _id } - in lower case, as ids
   * are compared. Empty for none.
   */
  public static readId(value: unknown): string {
    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value === "string") {
      return value.trim().toLowerCase();
    }

    if (value instanceof ObjectID) {
      return value.toString().trim().toLowerCase();
    }

    if (typeof value === "object") {
      const stored: { value?: unknown; _id?: unknown } = value as {
        value?: unknown;
        _id?: unknown;
      };

      if (stored.value !== undefined && stored.value !== null) {
        return LabelAccess.readId(stored.value);
      }

      if (stored._id !== undefined && stored._id !== null) {
        return LabelAccess.readId(stored._id);
      }
    }

    const text: string = String(value).trim().toLowerCase();

    return text === "[object object]" ? "" : text;
  }

  /*
   * Ids as ObjectIDs, each once whatever its case, in the order given;
   * nothing for an empty one. An ObjectID handed in is kept as it is, so a
   * query built from it names the very id the row did.
   */
  public static toObjectIDs(
    values: ReadonlyArray<unknown> | null | undefined,
  ): Array<ObjectID> {
    const seen: Set<string> = new Set<string>();
    const ids: Array<ObjectID> = [];

    for (const value of values || []) {
      const id: string = LabelAccess.readId(value);

      if (!id || seen.has(id)) {
        continue;
      }

      seen.add(id);
      ids.push(value instanceof ObjectID ? value : new ObjectID(id));
    }

    return ids;
  }

  /*
   * A caller's permission rows as the rule reads them. The rows are the
   * caller's in one project, allow and block alike, global permissions
   * among them as rows with no labels (a request's, DatabaseCommonInteraction
   * PropsUtil.getPermissionRows; the snapshot's, with its global
   * permissions).
   *
   * A row reaches without a label limit when its labels do not narrow it
   * (PermissionHelper.isLimitedToLabels) and it is not scoped to Owned - an
   * Owned row of a role that cannot be scoped reaches the whole project,
   * as the read checks treat it (PermissionHelper
   * .getNonAccessControlPermissions).
   */
  public static readRows(
    rows: ReadonlyArray<UserPermission> | null | undefined,
  ): LabelRuleRows {
    const ruleRows: LabelRuleRows = {
      unlimited: [],
      limitedToLabels: [],
      owned: [],
      labelledBlocks: [],
    };

    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || !row.permission) {
        continue;
      }

      if (HeldPermissionsUtil.isBlockRow(row)) {
        if (HeldPermissionsUtil.hasLabels(row)) {
          ruleRows.labelledBlocks.push(row);
        }

        continue;
      }

      if (row.scope === PermissionScope.Owned) {
        if (PermissionHelper.isScopeApplicable(row.permission)) {
          ruleRows.owned.push(row);
        } else if (!ruleRows.unlimited.includes(row.permission)) {
          ruleRows.unlimited.push(row.permission);
        }

        continue;
      }

      if (PermissionHelper.isLimitedToLabels(row)) {
        ruleRows.limitedToLabels.push(row);
        continue;
      }

      if (!ruleRows.unlimited.includes(row.permission)) {
        ruleRows.unlimited.push(row.permission);
      }
    }

    return ruleRows;
  }

  /*
   * WHAT THE ALLOW ROWS OF `permissions` REACH of a labelled model's records
   * (LabelGrant): nothing to narrow when one of them reaches the whole
   * project, or when none is limited to labels; otherwise the labels of the
   * rows limited to them and, when rows scoped to Owned stand beside them,
   * those rows' teams - or nothing to narrow, when the Owned scope narrows
   * nothing of this model for this operation (`ownedScopeNarrows`, asked
   * only then): such a row reaches every record, as it does on its own.
   *
   * `permissions` are the ones that grant the operation: the model's own
   * list for it and its operational-resource wildcard
   * (HeldPermissionsUtil.getGrantingPermissions), or a column's.
   */
  public static getGrant(data: {
    rows: LabelRuleRows;
    permissions: ReadonlyArray<Permission>;
    ownedScopeNarrows: () => boolean;
  }): LabelGrant {
    const permissions: ReadonlyArray<Permission> = data.permissions;

    if (
      permissions.some((permission: Permission): boolean => {
        return data.rows.unlimited.includes(permission);
      })
    ) {
      return reachesEverything();
    }

    const labelIds: Array<ObjectID> = LabelAccess.toObjectIDs(
      data.rows.limitedToLabels
        .filter((row: UserPermission): boolean => {
          return permissions.includes(row.permission);
        })
        .flatMap((row: UserPermission): Array<unknown> => {
          return [...(row.labelIds || [])];
        }),
    );

    if (labelIds.length === 0) {
      return reachesEverything();
    }

    const ownedRows: Array<UserPermission> = data.rows.owned.filter(
      (row: UserPermission): boolean => {
        return permissions.includes(row.permission);
      },
    );

    if (ownedRows.length === 0) {
      return { labelIds: labelIds, ownedTeamIds: null };
    }

    if (!data.ownedScopeNarrows()) {
      return reachesEverything();
    }

    return {
      labelIds: labelIds,
      ownedTeamIds: HeldPermissionsUtil.getTeamIdsOfRows(ownedRows),
    };
  }

  /*
   * The labels a grant decides by alone: its labels, or none when grants
   * scoped to Owned stand beside them - a record carrying none of them may
   * still be reached as one the caller owns, which only the record's
   * owners tell.
   */
  public static getLabelsDecidingAlone(grant: LabelGrant): Array<ObjectID> {
    return grant.ownedTeamIds ? [] : grant.labelIds;
  }

  /*
   * The caller's blocks with labels on one of `permissions` - the ones whose
   * blocks narrow an operation's records (HeldPermissionsUtil
   * .getLabelBlockingPermissions).
   */
  public static getLabelledBlockRows(
    rows: LabelRuleRows,
    permissions: ReadonlyArray<Permission>,
  ): Array<UserPermission> {
    return rows.labelledBlocks.filter((row: UserPermission): boolean => {
      return permissions.includes(row.permission);
    });
  }

  // The labels those blocks take away, each once.
  public static getBlockedLabelIds(
    rows: LabelRuleRows,
    permissions: ReadonlyArray<Permission>,
  ): Array<ObjectID> {
    return LabelAccess.toObjectIDs(
      LabelAccess.getLabelledBlockRows(rows, permissions).flatMap(
        (row: UserPermission): Array<unknown> => {
          return [...(row.labelIds || [])];
        },
      ),
    );
  }

  /*
   * One operation's reach (LabelReach) from the permissions that grant it
   * and those whose blocks with labels narrow it.
   */
  public static getReach(data: {
    rows: LabelRuleRows;
    grantingPermissions: ReadonlyArray<Permission>;
    blockingPermissions: ReadonlyArray<Permission>;
    ownedScopeNarrows: () => boolean;
  }): LabelReach {
    return {
      grant: LabelAccess.getGrant({
        rows: data.rows,
        permissions: data.grantingPermissions,
        ownedScopeNarrows: data.ownedScopeNarrows,
      }),
      blockedLabelIds: LabelAccess.getBlockedLabelIds(
        data.rows,
        data.blockingPermissions,
      ),
      blockRows: LabelAccess.getLabelledBlockRows(
        data.rows,
        data.blockingPermissions,
      ),
    };
  }

  // The labels of `labelIds` the record carries.
  public static getLabelsCarried(
    recordLabelIds: ReadonlyArray<unknown>,
    labelIds: ReadonlyArray<unknown>,
  ): Array<ObjectID> {
    const carried: Set<string> = new Set<string>(
      recordLabelIds.map((labelId: unknown): string => {
        return LabelAccess.readId(labelId);
      }),
    );

    return LabelAccess.toObjectIDs(labelIds).filter(
      (labelId: ObjectID): boolean => {
        return carried.has(LabelAccess.readId(labelId));
      },
    );
  }

  // Whether the record carries one of `labelIds`.
  public static carriesAny(
    recordLabelIds: ReadonlyArray<unknown>,
    labelIds: ReadonlyArray<unknown>,
  ): boolean {
    return LabelAccess.getLabelsCarried(recordLabelIds, labelIds).length > 0;
  }

  /*
   * The first of `blockRows` whose labels the record carries: the block that
   * takes the operation away on it.
   */
  public static getBlockOnRecord(
    recordLabelIds: ReadonlyArray<unknown>,
    blockRows: ReadonlyArray<UserPermission>,
  ): UserPermission | null {
    for (const row of blockRows) {
      if (LabelAccess.carriesAny(recordLabelIds, row.labelIds || [])) {
        return row;
      }
    }

    return null;
  }

  /*
   * WHAT THE LABELS LEAVE THE CALLER ON ONE RECORD THAT CARRIES LABELS OF ITS
   * OWN, by its labels alone (LabelVerdict), as the server weighs one record
   * (AccessControlPermission.checkRecordByModel):
   *
   *   - a write needs a read: the read's grant limited to labels the record
   *     carries none of, or a block taking one of its labels away from the
   *     read, and the record is not one the caller may read (NotReadable);
   *   - a team's block on a label the record carries takes the operation
   *     away (BlockedLabels), whatever grants it;
   *   - a grant limited to labels the record carries none of reaches it
   *     only as one the caller or the teams of grants scoped to Owned beside
   *     them own (isDecidedByOwners), or not at all (Labels).
   *
   * `operation` is the write's reach, left out for a read. Grants and blocks
   * that leave out no label of the record allow it: the rest of the rule
   * (owners, privacy, the parent a record is read through) is not the
   * labels' to say.
   */
  public static weighLabelledRecord(data: {
    recordLabelIds: ReadonlyArray<unknown>;
    read: LabelReach;
    operation?: LabelReach | undefined;
  }): LabelVerdict {
    const recordLabelIds: ReadonlyArray<unknown> = data.recordLabelIds;

    const verdict: LabelVerdict = {
      isAllowed: true,
      refusal: null,
      labelIds: [],
      blockedPermissions: [],
      isDecidedByOwners: false,
    };

    // A write needs a read: one the caller may not read is not one they may change.
    const readLabels: Array<ObjectID> = LabelAccess.getLabelsDecidingAlone(
      data.read.grant,
    );

    if (
      (readLabels.length > 0 &&
        !LabelAccess.carriesAny(recordLabelIds, readLabels)) ||
      LabelAccess.carriesAny(recordLabelIds, data.read.blockedLabelIds)
    ) {
      return {
        ...verdict,
        isAllowed: false,
        refusal: LabelRefusal.NotReadable,
      };
    }

    const reaches: Array<LabelReach> = [data.read];

    if (data.operation) {
      const blocked: Array<ObjectID> = LabelAccess.getLabelsCarried(
        recordLabelIds,
        data.operation.blockedLabelIds,
      );

      if (blocked.length > 0) {
        return {
          ...verdict,
          isAllowed: false,
          refusal: LabelRefusal.BlockedLabels,
          labelIds: blocked,
          blockedPermissions: Array.from(
            new Set<Permission>(
              data.operation.blockRows
                .filter((row: UserPermission): boolean => {
                  return LabelAccess.carriesAny(
                    recordLabelIds,
                    row.labelIds || [],
                  );
                })
                .map((row: UserPermission): Permission => {
                  return row.permission;
                }),
            ),
          ),
        };
      }

      const operationLabels: Array<ObjectID> =
        LabelAccess.getLabelsDecidingAlone(data.operation.grant);

      if (
        operationLabels.length > 0 &&
        !LabelAccess.carriesAny(recordLabelIds, operationLabels)
      ) {
        return {
          ...verdict,
          isAllowed: false,
          refusal: LabelRefusal.Labels,
          labelIds: [...operationLabels],
        };
      }

      reaches.push(data.operation);
    }

    verdict.isDecidedByOwners = reaches.some((reach: LabelReach): boolean => {
      return (
        reach.grant.ownedTeamIds !== null &&
        reach.grant.labelIds.length > 0 &&
        !LabelAccess.carriesAny(recordLabelIds, reach.grant.labelIds)
      );
    });

    return verdict;
  }
}

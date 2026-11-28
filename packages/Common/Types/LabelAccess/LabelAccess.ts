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
 *   - getOwnedOnlyRows: the rows of grants every one of which is scoped to
 *     Owned, which reach only the records the caller or those rows' teams
 *     own (#11436);
 *   - getBlockedLabelIds: the labels a team's block takes away from it;
 *   - weighLabelledRecord: what those leave the caller on one record that
 *     carries labels of its own, for a read, or a write and the read it
 *     needs - by the record's labels alone;
 *   - weighRecord: the same for any record, a record's part among them (its
 *     owners, its probes), and with who owns it when that is known (#11435,
 *     #11436).
 *
 * The server reads the rows from the request, the Dashboard from its
 * permission snapshot. Neither decides the label part any other way, nor
 * which grants reach only owned records; who owns a record the Dashboard
 * reads from the server (Types/RecordAccess/RecordOwnership).
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
  /*
   * Every grant of the operation is scoped to Owned, where the scope narrows
   * the model's records (getOwnedOnlyRows): the teams of those grants, whose
   * records - and the caller's own - it reaches, and no other. Null or left
   * out when the grants are not limited to owned records (#11436).
   */
  ownedOnlyTeamIds?: Array<ObjectID> | null | undefined;
}

/*
 * WHO OWNS ONE RECORD, AS FAR AS THE RULE NEEDS IT (#11436): whether the
 * caller is one of its owners themselves, and the teams that own it - of
 * which those of the caller's grants scoped to Owned are the ones that
 * count. Read by the server's own Owned scope (Server/Types/Database
 * /Permissions/OwnedScopePermission.getOwnersOf); the Dashboard reads it for
 * the records on screen (Types/RecordAccess/RecordOwnership).
 */
export interface RecordOwners {
  isOwnedByCaller: boolean;
  teamIds: ReadonlyArray<unknown>;
}

/*
 * One operation's reach, as weighRecord weighs it on a record - or on a row
 * of one of its parts, which carries the labels and the owners of the
 * records it names:
 *
 *   - labelsDecide: the record's labels are every label the rows carry. False
 *     for a part whose rows name other labelled records too (a monitor's
 *     probe names its probe): a grant limited to labels may reach such a row
 *     through the other record, so only the record's own labels' blocks are
 *     weighed - a block takes a row away through any record it names;
 *   - ownersDecide: the record's owners are the rows' owners (the record
 *     itself, its owner tables, a part that takes its owners from it). False
 *     for a part whose owners are another record's: a grant scoped to Owned
 *     is left to the server.
 */
export interface WeighedReach {
  reach: LabelReach;
  labelsDecide?: boolean | undefined;
  ownersDecide?: boolean | undefined;
}

// Why the labels or the owners refuse an operation on a record.
export enum LabelRefusal {
  /*
   * A write needs a read, and the caller's read does not reach this record:
   * its grant is limited to labels the record carries none of, or to the
   * records the caller or their teams own and it is not one, or a block
   * takes a label of the record away. Answered as a missing record.
   */
  NotReadable = "NotReadable",
  // A team's block takes the operation away on a label the record carries.
  BlockedLabels = "BlockedLabels",
  // The operation's grant is limited to labels the record carries none of.
  Labels = "Labels",
  /*
   * The operation's grant is limited to the records the caller or their
   * teams own, and neither owns this one (#11436).
   */
  Owned = "Owned",
  /*
   * Its grants are limited to labels the record carries none of and to the
   * records the caller or their teams own, and this is neither (#11436).
   */
  LabelsOrOwned = "LabelsOrOwned",
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
   * Labels, LabelsOrOwned: the labels the operation's grant reaches.
   * BlockedLabels: the labels of the record the block takes away.
   * NotReadable: the labels the read's grant reaches, or the record's labels
   * its block takes away (`cause` says which) - empty for the record
   * itself, whose refusal names none.
   */
  labelIds: Array<ObjectID>;
  // BlockedLabels: the permissions the blocks name.
  blockedPermissions: Array<Permission>;
  /*
   * The record carries none of the labels, and grants scoped to Owned stand
   * beside them - or every grant is scoped to Owned - and who owns it is not
   * known: it is reached as one the caller or those grants' teams own, or
   * not at all - the owners decide.
   */
  isDecidedByOwners: boolean;
  /*
   * NotReadable: why the read does not reach the record - Labels, Owned,
   * LabelsOrOwned or BlockedLabels, as an operation would be refused. For a
   * part's row, whose read is said by the record's labels and owners.
   */
  cause?: LabelRefusal | undefined;
}

// What a grant leaves a record that carries some labels, owned by someone or not.
enum GrantOutcome {
  Allowed = "Allowed",
  Refused = "Refused",
  // Who owns the record decides, and it is not known.
  Undecided = "Undecided",
}

interface WeighedGrant {
  outcome: GrantOutcome;
  refusal: LabelRefusal | null;
  labelIds: Array<ObjectID>;
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
   * THE ROWS THAT GRANT AN OPERATION ONLY ON OWNED RECORDS (#11436): the
   * allow rows of `permissions` when every one of them is scoped to Owned -
   * none over the whole project, none limited to labels - or null when one
   * is not, or none grants it at all. Each reaches what its own team owns
   * (UserPermission.teamId) and what the caller owns themselves
   * (getOwnedOnlyTeamIds). Whether the scope narrows the model's records at
   * all is the caller's to ask (OwnedScopePermission.narrowsRecords on the
   * server): where it does not, such a row reaches every record.
   *
   * The server's Owned scope finds these rows by this function
   * (OwnedScopePermission.getRowsGrantingOnlyAsOwned), and the Dashboard
   * locks a record's changes by it.
   */
  public static getOwnedOnlyRows(
    rows: LabelRuleRows,
    permissions: ReadonlyArray<Permission>,
  ): Array<UserPermission> | null {
    if (
      permissions.some((permission: Permission): boolean => {
        return rows.unlimited.includes(permission);
      }) ||
      rows.limitedToLabels.some((row: UserPermission): boolean => {
        return permissions.includes(row.permission);
      })
    ) {
      return null;
    }

    const owned: Array<UserPermission> = rows.owned.filter(
      (row: UserPermission): boolean => {
        return permissions.includes(row.permission);
      },
    );

    return owned.length > 0 ? owned : null;
  }

  /*
   * The teams of the rows getOwnedOnlyRows finds, when the Owned scope
   * narrows the model's records for the operation (`ownedScopeNarrows`,
   * asked only then); null when the grants are not limited to owned records
   * - or are, where the scope narrows nothing, and so reach every record.
   */
  public static getOwnedOnlyTeamIds(data: {
    rows: LabelRuleRows;
    permissions: ReadonlyArray<Permission>;
    ownedScopeNarrows: () => boolean;
  }): Array<ObjectID> | null {
    const owned: Array<UserPermission> | null = LabelAccess.getOwnedOnlyRows(
      data.rows,
      data.permissions,
    );

    if (!owned || !data.ownedScopeNarrows()) {
      return null;
    }

    return HeldPermissionsUtil.getTeamIdsOfRows(owned);
  }

  /*
   * Whether a record `owners` says who owns is reached by a grant scoped to
   * Owned whose rows are given on `teamIds`: the caller owns it, or one of
   * those teams does - never only another team of the caller's.
   */
  public static isOwnedBy(
    owners: RecordOwners,
    teamIds: ReadonlyArray<unknown>,
  ): boolean {
    if (owners.isOwnedByCaller) {
      return true;
    }

    const owning: Set<string> = new Set<string>(
      (owners.teamIds || []).map((teamId: unknown): string => {
        return LabelAccess.readId(teamId);
      }),
    );

    return teamIds.some((teamId: unknown): boolean => {
      const id: string = LabelAccess.readId(teamId);

      return Boolean(id) && owning.has(id);
    });
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
   * Whether every record `grant` reaches is one `within` reaches: its labels
   * are all `within`'s, and what it owns (if anything) `within` reaches too -
   * the teams of its grants scoped to Owned are all `within`'s. The server
   * narrows a read by the narrower of two such grants alone
   * (AccessControlPermission.getGrantsToNarrowBy), and leaves a column out
   * of no record where the model's read keeps to its labels already
   * (getColumnsKeptToLabels); the Dashboard tells such a column by it too.
   */
  public static isGrantWithin(grant: LabelGrant, within: LabelGrant): boolean {
    const withinLabels: Set<string> = new Set<string>(
      within.labelIds.map((labelId: ObjectID): string => {
        return LabelAccess.readId(labelId);
      }),
    );

    const labelsWithin: boolean = grant.labelIds.every(
      (labelId: ObjectID): boolean => {
        return withinLabels.has(LabelAccess.readId(labelId));
      },
    );

    if (!labelsWithin || grant.ownedTeamIds === null) {
      return labelsWithin;
    }

    if (within.ownedTeamIds === null) {
      return false;
    }

    const withinTeams: Set<string> = new Set<string>(
      within.ownedTeamIds.map((teamId: ObjectID): string => {
        return LabelAccess.readId(teamId);
      }),
    );

    return grant.ownedTeamIds.every((teamId: ObjectID): boolean => {
      return withinTeams.has(LabelAccess.readId(teamId));
    });
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
   * and those whose blocks with labels narrow it - with the teams of grants
   * every one of which is scoped to Owned (getOwnedOnlyTeamIds).
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
      ownedOnlyTeamIds: LabelAccess.getOwnedOnlyTeamIds({
        rows: data.rows,
        permissions: data.grantingPermissions,
        ownedScopeNarrows: data.ownedScopeNarrows,
      }),
    };
  }

  /*
   * Whether a reach leaves anything of a record to its owners: grants scoped
   * to Owned beside labels, or every grant scoped to Owned. Only then does
   * who owns a record lock anything.
   */
  public static isDecidedByOwnersAnywhere(reach: LabelReach): boolean {
    return (
      (reach.grant.ownedTeamIds !== null && reach.grant.labelIds.length > 0) ||
      Boolean(reach.ownedOnlyTeamIds)
    );
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
    // Who owns the record, when it is known (#11436). Left out: the owners decide.
    owners?: RecordOwners | null | undefined;
  }): LabelVerdict {
    return LabelAccess.weighRecord({
      recordLabelIds: data.recordLabelIds,
      owners: data.owners,
      reads: [{ reach: data.read }],
      operations: data.operation ? [{ reach: data.operation }] : [],
    });
  }

  /*
   * WHAT THE LABELS, AND WHO OWNS IT, LEAVE THE CALLER ON ONE RECORD - or on
   * a row of one of its parts (#11435, #11436): weighLabelledRecord for any
   * reach, in the order the server weighs them:
   *
   *   - `reads`, the reads a write needs (its own, and for a part the read
   *     of the record it is read through): a block on a label the record
   *     carries, a grant limited to labels it carries none of, a grant
   *     limited to owned records it is not one of - and the record is not
   *     one the caller may read (NotReadable, `cause` saying why);
   *   - `operations`, the operation's own reaches (and for a part, on a
   *     change, the record's update it is held to): a block on one of its
   *     labels (BlockedLabels); a grant limited to labels it carries none of
   *     (Labels) - or, beside grants scoped to Owned, carrying none and owned
   *     neither by the caller nor by those grants' teams (LabelsOrOwned); a
   *     grant every row of which is scoped to Owned, on a record neither the
   *     caller nor those rows' teams own (Owned).
   *
   * `owners` null or left out: who owns the record is not known, and what
   * the owners decide is left to them (isDecidedByOwners), never refused.
   * A reach whose labels or owners are not the record's (WeighedReach) is
   * weighed by the record's labels' blocks alone, or by its labels alone.
   */
  public static weighRecord(data: {
    recordLabelIds: ReadonlyArray<unknown>;
    owners?: RecordOwners | null | undefined;
    reads: ReadonlyArray<WeighedReach>;
    operations: ReadonlyArray<WeighedReach>;
  }): LabelVerdict {
    const recordLabelIds: ReadonlyArray<unknown> = data.recordLabelIds;
    const owners: RecordOwners | null = data.owners || null;

    const allowed: LabelVerdict = {
      isAllowed: true,
      refusal: null,
      labelIds: [],
      blockedPermissions: [],
      isDecidedByOwners: false,
    };

    let isDecidedByOwners: boolean = false;

    // A write needs a read: one the caller may not read is not one they may change.
    for (const weighed of data.reads) {
      const blocked: Array<ObjectID> = LabelAccess.getLabelsCarried(
        recordLabelIds,
        weighed.reach.blockedLabelIds,
      );

      if (blocked.length > 0) {
        return {
          ...allowed,
          isAllowed: false,
          refusal: LabelRefusal.NotReadable,
          cause: LabelRefusal.BlockedLabels,
          labelIds: blocked,
        };
      }

      const grant: WeighedGrant = LabelAccess.weighGrant({
        weighed: weighed,
        recordLabelIds: recordLabelIds,
        owners: owners,
      });

      if (grant.outcome === GrantOutcome.Refused) {
        return {
          ...allowed,
          isAllowed: false,
          refusal: LabelRefusal.NotReadable,
          cause: grant.refusal || undefined,
          labelIds: grant.labelIds,
        };
      }

      isDecidedByOwners =
        isDecidedByOwners || grant.outcome === GrantOutcome.Undecided;
    }

    for (const weighed of data.operations) {
      const blocked: Array<ObjectID> = LabelAccess.getLabelsCarried(
        recordLabelIds,
        weighed.reach.blockedLabelIds,
      );

      if (blocked.length > 0) {
        return {
          ...allowed,
          isAllowed: false,
          refusal: LabelRefusal.BlockedLabels,
          labelIds: blocked,
          blockedPermissions: Array.from(
            new Set<Permission>(
              weighed.reach.blockRows
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

      const grant: WeighedGrant = LabelAccess.weighGrant({
        weighed: weighed,
        recordLabelIds: recordLabelIds,
        owners: owners,
      });

      if (grant.outcome === GrantOutcome.Refused) {
        return {
          ...allowed,
          isAllowed: false,
          refusal: grant.refusal,
          labelIds: grant.labelIds,
        };
      }

      isDecidedByOwners =
        isDecidedByOwners || grant.outcome === GrantOutcome.Undecided;
    }

    return { ...allowed, isDecidedByOwners: isDecidedByOwners };
  }

  /*
   * What one reach's grants leave a record carrying `recordLabelIds`:
   *
   *   - limited to labels alone: allowed when it carries one; refused
   *     (Labels) when it carries none and its labels are all its rows carry
   *     - a part's row naming other labelled records may be reached through
   *     one of them, and is left to the server;
   *   - limited to labels, beside grants scoped to Owned: allowed when it
   *     carries one, or the caller or those grants' teams own it; refused
   *     (LabelsOrOwned) when they do not; undecided while who owns it is not
   *     known;
   *   - every grant scoped to Owned: allowed when the caller or those rows'
   *     teams own it, refused (Owned) when not, undecided while not known.
   *
   * Owners that are not the record's (ownersDecide false) decide nothing
   * here: what they would decide is left to the server.
   */
  private static weighGrant(data: {
    weighed: WeighedReach;
    recordLabelIds: ReadonlyArray<unknown>;
    owners: RecordOwners | null;
  }): WeighedGrant {
    const reach: LabelReach = data.weighed.reach;
    const labelsDecide: boolean = data.weighed.labelsDecide !== false;
    const ownersDecide: boolean = data.weighed.ownersDecide !== false;
    const grant: LabelGrant = reach.grant;

    const allowedGrant: WeighedGrant = {
      outcome: GrantOutcome.Allowed,
      refusal: null,
      labelIds: [],
    };

    // Owned by the caller or one of `teamIds`: true, false, or null while not known.
    const ownedBy: (teamIds: ReadonlyArray<unknown>) => boolean | null = (
      teamIds: ReadonlyArray<unknown>,
    ): boolean | null => {
      if (!ownersDecide || !data.owners) {
        return null;
      }

      return LabelAccess.isOwnedBy(data.owners, teamIds);
    };

    if (grant.labelIds.length > 0) {
      if (LabelAccess.carriesAny(data.recordLabelIds, grant.labelIds)) {
        return allowedGrant;
      }

      if (!labelsDecide) {
        return allowedGrant;
      }

      if (!grant.ownedTeamIds) {
        return {
          outcome: GrantOutcome.Refused,
          refusal: LabelRefusal.Labels,
          labelIds: [...grant.labelIds],
        };
      }

      const owned: boolean | null = ownedBy(grant.ownedTeamIds);

      if (owned === null) {
        return {
          ...allowedGrant,
          outcome: ownersDecide ? GrantOutcome.Undecided : GrantOutcome.Allowed,
        };
      }

      return owned
        ? allowedGrant
        : {
            outcome: GrantOutcome.Refused,
            refusal: LabelRefusal.LabelsOrOwned,
            labelIds: [...grant.labelIds],
          };
    }

    if (reach.ownedOnlyTeamIds) {
      const owned: boolean | null = ownedBy(reach.ownedOnlyTeamIds);

      if (owned === null) {
        return {
          ...allowedGrant,
          outcome: ownersDecide ? GrantOutcome.Undecided : GrantOutcome.Allowed,
        };
      }

      return owned
        ? allowedGrant
        : {
            outcome: GrantOutcome.Refused,
            refusal: LabelRefusal.Owned,
            labelIds: [],
          };
    }

    return allowedGrant;
  }
}

import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../Types/HeldPermissions";
import LabelAccess, {
  LabelGrant,
  LabelReach,
  LabelRuleRows,
  LabelVerdict,
  RecordOwners,
  WeighedReach,
} from "../../Types/LabelAccess/LabelAccess";
import RecordParts, {
  RecordOfPart,
  RecordPartModel,
} from "../../Types/LabelAccess/RecordParts";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../Types/Permission";
import RecordOwnership, {
  RecordOwnershipOperation,
  RecordOwnershipResult,
  RecordOwnershipTable,
} from "../../Types/RecordAccess/RecordOwnership";
import PermissionGate, {
  ColumnPermissionCheckableModel,
  LabelledGateModel,
  ModelAction,
  PermissionCheckableModel,
} from "./PermissionGate";
import User from "./User";

/*
 * WHAT A RECORD'S LABELS AND WHO OWNS IT LET THE READER DO TO IT, AND TO
 * ITS PARTS AND COLUMNS (#11259, #11435, #11436), read off the reader's
 * permission snapshot (PermissionGate.getSnapshotRows) by the rules the
 * server refuses by: the locks a record's list and its page draw with
 * (ModelTable, ModelPage, Utils/RecordLabelLock).
 *
 * PermissionGate says what the reader may do somewhere in the project, and
 * every page with a button or a form reaches it - the sign-in pages, a
 * status page and a public dashboard among them, none of which lists or
 * opens a record of the project. These weigh one record, so they are a
 * module of their own, read by the pages that show records: 2 KiB gzipped
 * of each of those pages' first load
 * (packages/Common/Scripts/first-load-budgets.js), with the server's answer
 * for who owns a record (Types/RecordAccess/RecordOwnership) they weigh.
 */

// The writes a record's own labels can lock (RecordLocks.getLabelLock).
export type LabelLockAction = ModelAction.Update | ModelAction.Delete;

// The writes a record's labels and owners can lock on one of its parts.
export type PartLockAction =
  | ModelAction.Create
  | ModelAction.Update
  | ModelAction.Delete;

/*
 * WHO OWNS ONE RECORD, AND WHAT THEY DECIDE ON A TABLE (#11436): the
 * server's answer for the record (Types/RecordAccess/RecordOwnership) as a
 * lock weighs it - who owns it, and the operations of the table weighed the
 * Owned scope narrows. Left out of a weigh while it is not known: the owners
 * then decide, and nothing is refused by them.
 */
export interface RecordOwnershipFacts {
  owners: RecordOwners;
  /*
   * The answer for the kind and its parts: which tables take their owners
   * from the record, by which key, and which operations of each the owners
   * decide.
   */
  ownership: RecordOwnershipResult;
}

/*
 * WHAT A RECORD'S LABELS AND WHO OWNS IT LET THE READER DO TO IT
 * (RecordLocks.getRecordLock, #11259, #11436): ModelLabelLock for every
 * kind a grant limited to labels or scoped to Owned narrows - a label-less
 * kind with owners among them (a team) - weighing who owns the record when
 * that is known.
 */
export interface ModelRecordLock {
  tableName: string;
  // The records' labels column, or null for a kind that carries none.
  labelsColumn: string | null;
  // Every label a reach is limited to or blocked on: the names a reason reads.
  labelIds: Array<string>;
  /*
   * Whether who owns a record may decide something here - a grant scoped
   * to Owned beside labels, or every grant of an operation scoped to Owned:
   * only then is who owns the records on screen worth reading.
   */
  isDecidedByOwners: boolean;
  weigh: (
    action: LabelLockAction,
    recordLabelIds: ReadonlyArray<unknown>,
    ownership?: RecordOwnershipFacts | null | undefined,
  ) => LabelVerdict;
}

/*
 * WHAT A RECORD'S LABELS AND WHO OWNS IT LET THE READER DO TO A ROW OF ONE
 * OF ITS PARTS (RecordLocks.getPartLock, #11435): a part's rows on the
 * record's page name the record, and carry its labels and its owners.
 */
export interface ModelPartLock {
  // The part's table: "MonitorOwnerUser".
  tableName: string;
  // The record's table: "Monitor".
  recordTableName: string;
  labelIds: Array<string>;
  isDecidedByOwners: boolean;
  weigh: (
    action: PartLockAction,
    recordLabelIds: ReadonlyArray<unknown>,
    ownership?: RecordOwnershipFacts | null | undefined,
  ) => LabelVerdict;
}

// A model a part lock reads: its permissions, and what it is read through.
export interface PartGateModel extends LabelledGateModel, RecordPartModel {}

/*
 * WHAT A RECORD'S OWN LABELS LET THE READER DO TO IT, for one model
 * (RecordLocks.getLabelLock, #11259): the reach of the reader's read,
 * update and delete by labels, as the server weighs them
 * (Types/LabelAccess/LabelAccess), and the labels a refusal may name.
 */
export interface ModelLabelLock {
  // The model's records' label column: "labels".
  labelsColumn: string;
  reaches: Record<ModelAction.Read | LabelLockAction, LabelReach>;
  /*
   * Every label the reach is limited to or blocked on, in lower case: the
   * names a lock's reason reads (Utils/RecordLabelLock).
   */
  labelIds: Array<string>;
  // What the labels leave the reader of a record carrying `recordLabelIds`.
  weigh: (
    action: LabelLockAction,
    recordLabelIds: ReadonlyArray<unknown>,
  ) => LabelVerdict;
}

export default class RecordLocks {
  /*
   * WHAT A RECORD'S OWN LABELS LET THE READER DO TO IT (#11259), by the
   * rule the server refuses by (Types/LabelAccess/LabelAccess, which
   * AccessControlPermission decides with too).
   *
   * PermissionGate.check says whether the reader holds what an operation asks somewhere in
   * the project. A grant limited to labels holds it only on the records
   * carrying one of them: a Viewer over the whole project who is a Project
   * Member on the monitors labelled X was offered Edit and Delete on every
   * monitor, and refused by the server on each one outside X. This reads
   * the reader's rows - allow and block, with their labels and scopes, as
   * the server's request carries them - into the reach of their read, update
   * and delete of the model, and weighs a record's labels against it:
   * a change or a delete outside the labels a grant is limited to, or on a
   * label a team's block takes away, is refused (LabelVerdict). A grant
   * scoped to Owned beside the labels leaves a record outside them to its
   * owners, which the record's labels cannot tell: it is not refused here,
   * and the server keeps the last word.
   *
   * Null when the labels lock nothing: a master admin, a model that carries
   * no labels, a snapshot not landed yet, or a reader none of whose grants
   * of the model's read, update and delete is limited to labels or blocked
   * on some.
   */
  public static getLabelLock(model: LabelledGateModel): ModelLabelLock | null {
    if (User.isMasterAdmin()) {
      return null;
    }

    const labelsColumn: string | null =
      model.getAccessControlColumn?.() || null;

    if (!labelsColumn) {
      return null;
    }

    const rows: Array<UserPermission> = PermissionGate.getSnapshotRows();

    const held: HeldPermissions = HeldPermissionsUtil.fromRows({
      rows: rows,
    });

    if (!PermissionGate.isLoaded(held)) {
      return null;
    }

    const labelRows: LabelRuleRows = LabelAccess.readRows(rows);

    const reachOf: (action: ModelAction) => LabelReach = (
      action: ModelAction,
    ): LabelReach => {
      const modelPermissions: Array<Permission> =
        PermissionGate.getModelPermissions(model, action);
      const wildcard: Permission | null = HeldPermissionsUtil.getModelWildcard({
        isOperationalResource: model.isOperationalResource,
        operation: action,
      });

      return LabelAccess.getReach({
        rows: labelRows,
        grantingPermissions: HeldPermissionsUtil.getGrantingPermissions(held, {
          modelPermissions: modelPermissions,
          wildcard: wildcard,
        }),
        blockingPermissions: HeldPermissionsUtil.getLabelBlockingPermissions(
          held,
          { modelPermissions: modelPermissions, wildcard: wildcard },
        ),
        /*
         * Whether the Owned scope narrows the model is the server's to know
         * (its owner tables): taken as narrowing, an Owned grant beside the
         * labels leaves a record outside them to its owners - never
         * refused here - as it does where the scope narrows nothing.
         */
        ownedScopeNarrows: (): boolean => {
          return true;
        },
      });
    };

    const reaches: Record<ModelAction.Read | LabelLockAction, LabelReach> = {
      [ModelAction.Read]: reachOf(ModelAction.Read),
      [ModelAction.Update]: reachOf(ModelAction.Update),
      [ModelAction.Delete]: reachOf(ModelAction.Delete),
    };

    const labelIds: Array<string> = [];

    for (const reach of Object.values(reaches)) {
      for (const labelId of [
        ...reach.grant.labelIds,
        ...reach.blockedLabelIds,
      ]) {
        const id: string = LabelAccess.readId(labelId);

        if (id && !labelIds.includes(id)) {
          labelIds.push(id);
        }
      }
    }

    if (labelIds.length === 0) {
      return null;
    }

    return {
      labelsColumn: labelsColumn,
      reaches: reaches,
      labelIds: labelIds,
      weigh: (
        action: LabelLockAction,
        recordLabelIds: ReadonlyArray<unknown>,
      ): LabelVerdict => {
        return LabelAccess.weighLabelledRecord({
          recordLabelIds: recordLabelIds,
          read: reaches[ModelAction.Read],
          operation: reaches[action],
        });
      },
    };
  }

  /*
   * The reach of each action on `model`, read off the reader's rows as the
   * server reads them (LabelAccess.getReach), for a weigh that knows whether
   * the Owned scope narrows the action: `narrows` true when it does or when
   * that is not known yet - the owners then decide, and nothing is refused
   * by them - and false when it does not, where a grant scoped to Owned
   * reaches every record. Each worked out once.
   */
  private static getReachReader(
    model: PermissionCheckableModel,
    labelRows: LabelRuleRows,
    held: HeldPermissions,
  ): (action: ModelAction, narrows: boolean) => LabelReach {
    const reaches: Map<string, LabelReach> = new Map<string, LabelReach>();

    return (action: ModelAction, narrows: boolean): LabelReach => {
      const key: string = `${action}:${narrows ? "narrows" : "reaches"}`;
      const known: LabelReach | undefined = reaches.get(key);

      if (known) {
        return known;
      }

      const modelPermissions: Array<Permission> =
        PermissionGate.getModelPermissions(model, action);
      const wildcard: Permission | null = HeldPermissionsUtil.getModelWildcard({
        isOperationalResource: model.isOperationalResource,
        operation: action,
      });

      const reach: LabelReach = LabelAccess.getReach({
        rows: labelRows,
        grantingPermissions: HeldPermissionsUtil.getGrantingPermissions(held, {
          modelPermissions: modelPermissions,
          wildcard: wildcard,
        }),
        blockingPermissions: HeldPermissionsUtil.getLabelBlockingPermissions(
          held,
          { modelPermissions: modelPermissions, wildcard: wildcard },
        ),
        ownedScopeNarrows: (): boolean => {
          return narrows;
        },
      });

      reaches.set(key, reach);

      return reach;
    };
  }

  // Every label `reaches` are limited to or blocked on, in lower case, each once.
  private static getLabelIdsOfReaches(
    reaches: ReadonlyArray<LabelReach>,
  ): Array<string> {
    const labelIds: Array<string> = [];

    for (const reach of reaches) {
      for (const labelId of [
        ...reach.grant.labelIds,
        ...reach.blockedLabelIds,
      ]) {
        const id: string = LabelAccess.readId(labelId);

        if (id && !labelIds.includes(id)) {
          labelIds.push(id);
        }
      }
    }

    return labelIds;
  }

  /*
   * Whether the Owned scope narrows `action` on `tableName`'s rows, as the
   * server's answer about a record says (RecordOwnership): true while there
   * is no answer - the owners then decide, unknown - and, with one, only
   * for an operation the answer lists for a table that takes its owners from
   * the record by `key`.
   */
  private static isNarrowedByOwners(data: {
    ownership: RecordOwnershipFacts | null;
    tableName: string;
    key: string;
    action: ModelAction;
  }): boolean {
    if (!data.ownership) {
      return true;
    }

    const table: RecordOwnershipTable | null = RecordOwnership.getTable(
      data.ownership.ownership,
      data.tableName,
    );

    return Boolean(
      table &&
        table.key === data.key &&
        table.operations.includes(data.action as RecordOwnershipOperation),
    );
  }

  /*
   * WHAT A RECORD'S LABELS AND WHO OWNS IT LET THE READER DO TO IT (#11259,
   * #11436), by the rule the server refuses by (Types/LabelAccess
   * .weighRecord): getLabelLock's reach of the reader's read, update and
   * delete, and - for a grant scoped to Owned beside the labels, or an
   * operation every grant of which is scoped to Owned - who owns the record,
   * which the server answers for the records on screen
   * (RecordOwnershipFacts). Without that answer the owners decide, and
   * nothing is locked by them; with it, a change or a delete of a record
   * neither the reader nor the teams of those grants own is refused
   * (Owned, LabelsOrOwned), as the server's Owned scope refuses it.
   *
   * For every kind a scope narrows, labelled or not: a kind with no labels
   * (a team) is narrowed by its owners alone. Null when neither its labels
   * nor its owners lock anything: a master admin, a snapshot not landed
   * yet, a reader none of whose grants of the model's read, update and
   * delete is limited to labels, blocked on some, or scoped to Owned.
   */
  public static getRecordLock(
    model: LabelledGateModel,
  ): ModelRecordLock | null {
    if (User.isMasterAdmin()) {
      return null;
    }

    const rows: Array<UserPermission> = PermissionGate.getSnapshotRows();
    const held: HeldPermissions = HeldPermissionsUtil.fromRows({ rows: rows });

    if (!PermissionGate.isLoaded(held)) {
      return null;
    }

    const tableName: string = model.tableName || "";
    const labelsColumn: string | null =
      model.getAccessControlColumn?.() || null;
    const reachOf: (action: ModelAction, narrows: boolean) => LabelReach =
      this.getReachReader(model, LabelAccess.readRows(rows), held);

    const probes: Array<LabelReach> = [
      ModelAction.Read,
      ModelAction.Update,
      ModelAction.Delete,
    ].map((action: ModelAction): LabelReach => {
      return reachOf(action, true);
    });

    const labelIds: Array<string> = labelsColumn
      ? this.getLabelIdsOfReaches(probes)
      : [];
    const isDecidedByOwners: boolean = probes.some(
      (reach: LabelReach): boolean => {
        return LabelAccess.isDecidedByOwnersAnywhere(reach);
      },
    );

    if (labelIds.length === 0 && !isDecidedByOwners) {
      return null;
    }

    return {
      tableName: tableName,
      labelsColumn: labelsColumn,
      labelIds: labelIds,
      isDecidedByOwners: isDecidedByOwners,
      weigh: (
        action: LabelLockAction,
        recordLabelIds: ReadonlyArray<unknown>,
        ownership?: RecordOwnershipFacts | null | undefined,
      ): LabelVerdict => {
        const facts: RecordOwnershipFacts | null = ownership || null;

        const narrows: (operation: ModelAction) => boolean = (
          operation: ModelAction,
        ): boolean => {
          return this.isNarrowedByOwners({
            ownership: facts,
            tableName: tableName,
            key: "_id",
            action: operation,
          });
        };

        return LabelAccess.weighRecord({
          recordLabelIds: recordLabelIds,
          owners: facts ? facts.owners : null,
          reads: [
            {
              reach: reachOf(ModelAction.Read, narrows(ModelAction.Read)),
              labelsDecide: Boolean(labelsColumn),
            },
          ],
          operations: [
            {
              reach: reachOf(action, narrows(action)),
              labelsDecide: Boolean(labelsColumn),
            },
          ],
        });
      },
    };
  }

  /*
   * WHAT A RECORD'S LABELS AND WHO OWNS IT LET THE READER DO TO A ROW OF ONE
   * OF ITS PARTS (#11435): a monitor's owners, its probes, its status
   * timeline - a model with no labels of its own, read through the record
   * (RecordParts). On the record's page a part's rows name the record, and
   * the server weighs a part's create, change and delete as it weighs one of
   * its rows (BasePermission.addRecordScopeToQuery, CreateScopePermission):
   *
   *   - the part's own grants and blocks of the operation and - a change or
   *     a delete needs a read - of its read, against the labels its rows
   *     carry: the record's, where they name no other labelled record
   *     (RecordParts.namesOnlyItsRecord); only the record's labels' blocks
   *     where they do, since a grant may reach a row through the other
   *     record;
   *   - on a change, the record's own update (a part is changed only on a
   *     record the reader may change), by its labels and its blocks;
   *   - and, where the part takes its owners from the record (its owner
   *     tables, a part with @OwnedThrough it - the server's answer lists
   *     them, RecordOwnershipFacts), who owns the record, for a grant
   *     scoped to Owned.
   *
   * The record's read is not weighed: the page is open on it, so the reader
   * reads it. Null when nothing of the part is locked by the record's labels
   * or owners, for a model that is not one of `record`'s parts, and for a
   * master admin or a snapshot not landed yet.
   */
  public static getPartLock(
    part: PartGateModel,
    record: LabelledGateModel,
  ): ModelPartLock | null {
    if (User.isMasterAdmin()) {
      return null;
    }

    const recordTableName: string = record.tableName || "";
    const recordOf: RecordOfPart | null = RecordParts.getRecordOf(part);

    if (
      !recordOf ||
      !recordTableName ||
      recordOf.tableName !== recordTableName
    ) {
      return null;
    }

    const rows: Array<UserPermission> = PermissionGate.getSnapshotRows();
    const held: HeldPermissions = HeldPermissionsUtil.fromRows({ rows: rows });

    if (!PermissionGate.isLoaded(held)) {
      return null;
    }

    const labelRows: LabelRuleRows = LabelAccess.readRows(rows);
    const partReachOf: (action: ModelAction, narrows: boolean) => LabelReach =
      this.getReachReader(part, labelRows, held);
    const recordReachOf: (action: ModelAction, narrows: boolean) => LabelReach =
      this.getReachReader(record, labelRows, held);

    const isRecordLabelled: boolean = Boolean(
      record.getAccessControlColumn?.(),
    );
    const partTableName: string = part.tableName || "";
    const labelsDecide: boolean =
      isRecordLabelled && RecordParts.namesOnlyItsRecord(part);

    const probes: Array<LabelReach> = [
      partReachOf(ModelAction.Create, true),
      partReachOf(ModelAction.Read, true),
      partReachOf(ModelAction.Update, true),
      partReachOf(ModelAction.Delete, true),
      recordReachOf(ModelAction.Update, true),
    ];

    const labelIds: Array<string> = isRecordLabelled
      ? this.getLabelIdsOfReaches(probes)
      : [];
    const isDecidedByOwners: boolean = probes.some(
      (reach: LabelReach): boolean => {
        return LabelAccess.isDecidedByOwnersAnywhere(reach);
      },
    );

    if (labelIds.length === 0 && !isDecidedByOwners) {
      return null;
    }

    return {
      tableName: partTableName,
      recordTableName: recordTableName,
      labelIds: labelIds,
      isDecidedByOwners: isDecidedByOwners,
      weigh: (
        action: PartLockAction,
        recordLabelIds: ReadonlyArray<unknown>,
        ownership?: RecordOwnershipFacts | null | undefined,
      ): LabelVerdict => {
        const facts: RecordOwnershipFacts | null = ownership || null;

        // Whether the record's owners are the part's rows' owners.
        const isOwnedThroughRecord: boolean =
          !recordOf.isList &&
          (!facts ||
            Boolean(
              RecordOwnership.getTable(facts.ownership, partTableName)?.key ===
                recordOf.key,
            ));

        const partNarrows: (operation: ModelAction) => boolean = (
          operation: ModelAction,
        ): boolean => {
          return (
            isOwnedThroughRecord &&
            this.isNarrowedByOwners({
              ownership: facts,
              tableName: partTableName,
              key: recordOf.key,
              action: operation,
            })
          );
        };

        const ofPart: (reach: LabelReach) => WeighedReach = (
          reach: LabelReach,
        ): WeighedReach => {
          return {
            reach: reach,
            labelsDecide: labelsDecide,
            ownersDecide: isOwnedThroughRecord,
          };
        };

        const reads: Array<WeighedReach> =
          action === ModelAction.Create
            ? []
            : [
                ofPart(
                  partReachOf(ModelAction.Read, partNarrows(ModelAction.Read)),
                ),
              ];

        const operations: Array<WeighedReach> = [
          ofPart(partReachOf(action, partNarrows(action))),
        ];

        if (action === ModelAction.Update) {
          operations.push({
            reach: recordReachOf(
              ModelAction.Update,
              this.isNarrowedByOwners({
                ownership: facts,
                tableName: recordTableName,
                key: "_id",
                action: ModelAction.Update,
              }),
            ),
            labelsDecide: isRecordLabelled && !recordOf.isList,
            ownersDecide: !recordOf.isList,
          });
        }

        return LabelAccess.weighRecord({
          recordLabelIds: recordLabelIds,
          owners: facts ? facts.owners : null,
          reads: reads,
          operations: operations,
        });
      },
    };
  }

  /*
   * What the reader's permission snapshot holds, as one string: a page that
   * keeps what it worked out from it (ModelPage's scope) works it out again
   * when it changes. Empty for a master admin, whose locks it never moves.
   */
  public static getSnapshotKey(): string {
    if (User.isMasterAdmin()) {
      return "";
    }

    return JSON.stringify(PermissionGate.getSnapshotRows());
  }

  /*
   * Whether the reader holds a grant scoped to Owned at all - of a
   * permission a scope applies to: only then can who owns a record lock
   * anything of theirs, and only then is it read (RecordOwnership).
   */
  public static hasOwnedScopedGrants(): boolean {
    if (User.isMasterAdmin()) {
      return false;
    }

    return (
      LabelAccess.readRows(PermissionGate.getSnapshotRows()).owned.length > 0
    );
  }

  /*
   * Every label the reader's grants are limited to or their blocks are on,
   * in lower case: the names any lock's reason on a page may read - a part's
   * among them, which a page knows only when a gate asks.
   */
  public static getSnapshotLabelIds(): Array<string> {
    if (User.isMasterAdmin()) {
      return [];
    }

    const labelIds: Array<string> = [];

    for (const row of PermissionGate.getSnapshotRows()) {
      if (!row || !HeldPermissionsUtil.hasLabels(row)) {
        continue;
      }

      if (
        !HeldPermissionsUtil.isBlockRow(row) &&
        !PermissionHelper.isLimitedToLabels(row)
      ) {
        continue;
      }

      for (const labelId of row.labelIds || []) {
        const id: string = LabelAccess.readId(labelId);

        if (id && !labelIds.includes(id)) {
          labelIds.push(id);
        }
      }
    }

    return labelIds;
  }

  /*
   * WHETHER THE READER MAY READ ONE COLUMN OF A RECORD CARRYING
   * `recordLabelIds` (#11259): the column's read (canReadColumn) and, for a
   * column whose read is granted limited to labels - a monitor's secret
   * keys, for a Viewer who is a Project Member on one label - the record's
   * labels, by the rule the server leaves the column out of the records
   * outside them by (AccessControlPermission.getColumnsKeptToLabels). For a
   * page that shows what a column holds, to say it is hidden rather than
   * empty. Records read without their labels (null), and a grant scoped to
   * Owned beside the labels, which the record's owners decide, are taken as
   * read: the server keeps the last word.
   */
  public static mayReadColumnOnRecord(
    model: ColumnPermissionCheckableModel & LabelledGateModel,
    column: string,
    recordLabelIds: ReadonlyArray<unknown> | null,
  ): boolean {
    if (!PermissionGate.canReadColumn(model, column)) {
      return false;
    }

    if (User.isMasterAdmin() || !recordLabelIds) {
      return true;
    }

    const readPermissions: Array<Permission> =
      model.getColumnAccessControlForAllColumns()[column]?.read || [];

    if (readPermissions.length === 0 || !model.getAccessControlColumn?.()) {
      return true;
    }

    const rows: Array<UserPermission> = PermissionGate.getSnapshotRows();
    const held: HeldPermissions = HeldPermissionsUtil.fromRows({ rows: rows });

    const grant: LabelGrant = LabelAccess.getGrant({
      rows: LabelAccess.readRows(rows),
      permissions: HeldPermissionsUtil.getGrantingPermissions(held, {
        modelPermissions: readPermissions,
        wildcard: HeldPermissionsUtil.getColumnWildcard({
          isOperationalResource: model.isOperationalResource,
          operation: "read",
          tablePermissions: PermissionGate.getTablePermissions(model, "read"),
          columnPermissions: readPermissions,
        }),
      }),
      ownedScopeNarrows: (): boolean => {
        return true;
      },
    });

    return (
      grant.labelIds.length === 0 ||
      grant.ownedTeamIds !== null ||
      LabelAccess.carriesAny(recordLabelIds, grant.labelIds)
    );
  }
}

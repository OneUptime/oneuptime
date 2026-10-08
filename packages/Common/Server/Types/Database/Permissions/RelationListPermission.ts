import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import QueryHelper from "../QueryHelper";
import CreatePermission, { RecordIdsFinder } from "./CreatePermission";
import ReadPermission from "./ReadPermission";
import TablePermission from "./TablePermission";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../Types/Dictionary";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../../Types/HeldPermissions";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  getReferenceRefusalMessage,
  resolveReferenceIds,
  UnreadableReferenceException,
} from "../../../Utils/Database/ProjectScopedReferenceRefusal";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

// A list of records a create or an update may name, held to their read.
export interface CheckedRelationList {
  // The many-to-many column: "monitors", "statusPages".
  column: string;
  // The model of the records it lists.
  listedModelType: DatabaseBaseModelType;
  // How a refusal names the field: the column's title, "Monitors".
  title: string;
}

// Postgres renders a uuid lower-cased, whatever case the payload used.
function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

/*
 * THE RECORDS A WRITE LISTS ARE RECORDS ITS CALLER MAY READ.
 *
 * A create or an update that names records in a list - the monitors an
 * incident, an alert or a maintenance event affects, the status pages it
 * is shown on, the on-call policies it pages, an announcement's monitors, a
 * rule's monitors and runbooks - names only records the caller may read, by
 * the read rule of the listed model's own table: in the project the write
 * is made in, carrying a label the caller's read of them is limited to, not
 * carrying a label a block takes away, owned by them or one of their teams
 * when their read reaches only what they own, read through a parent they may
 * read. A record they may not read is answered like one that does not exist,
 * in the words every reference check answers with, and nothing is written.
 *
 * Only the records a write adds are asked about: on an update, a record a
 * row lists already is not asked about again, so an edit that keeps an
 * entry its editor may not read keeps it.
 *
 * A caller who holds no permission to read the listed model at all - the
 * roles OneUptime ships give incident responders no permission on monitors,
 * and they name the monitors an incident affects - is held to the project
 * and to their blocks with labels, not to a read they do not have: the
 * records must be the project's (the write's own reference check, or a
 * lookup by OneUptime when its service has none) and carry no label a block
 * of theirs takes away. A block with no labels on one of the listed model's
 * read permissions takes every record of it away.
 *
 * Lists of records read as a whole table - labels, teams, people,
 * severities, monitor statuses, files - are not held to a read here: every
 * member reads them, and the reference check answers a record that is not
 * the project's. The parent a model is read through, even when it is a list
 * (an announcement's status pages), is the parent rule's
 * (CreatePermission.checkParentPermission,
 * UpdatePermission.checkParentPermission). Root and master admin callers
 * are left alone.
 */
export default class RelationListPermission {
  // The checked lists of each model asked about, read from its metadata once.
  private static checkedLists: Map<
    DatabaseBaseModelType,
    Array<CheckedRelationList>
  > = new Map();

  /*
   * The lists of `modelType` held to the caller's read: every many-to-many
   * column a create or an update may write (its create or update permissions
   * name someone) whose records are read one by one (isReadPerRecord), but
   * the parent the model's rows are read through.
   */
  public static getCheckedLists(
    modelType: DatabaseBaseModelType,
  ): Array<CheckedRelationList> {
    const cached: Array<CheckedRelationList> | undefined =
      RelationListPermission.checkedLists.get(modelType);

    if (cached) {
      return cached;
    }

    const model: BaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    const lists: Array<CheckedRelationList> = [];

    for (const columnName of Object.keys(columns)) {
      const column: TableColumnMetadata | undefined = columns[columnName];

      if (
        !column ||
        column.type !== TableColumnType.EntityArray ||
        !column.modelType ||
        columnName === model.canAccessIfCanReadOn
      ) {
        continue;
      }

      const isWritable: boolean =
        (accessControl[columnName]?.create || []).length > 0 ||
        (accessControl[columnName]?.update || []).length > 0;

      const listedModelType: DatabaseBaseModelType =
        column.modelType as DatabaseBaseModelType;

      if (
        !isWritable ||
        !RelationListPermission.isReadPerRecord(listedModelType)
      ) {
        continue;
      }

      lists.push({
        column: columnName,
        listedModelType: listedModelType,
        title: column.title || new listedModelType().pluralName || columnName,
      });
    }

    RelationListPermission.checkedLists.set(modelType, lists);

    return lists;
  }

  /*
   * Whether a model's records are read one by one - whether a read of it
   * can reach some of its records and not others: records that carry labels
   * (a read limited to some of them, a block with labels), records read
   * through another record, records owned through a parent (and the
   * operational resources and the rest that carry labels and owners of
   * their own), private records, and records that carry the labels of the
   * records they name (ReadPermission.getLabelledReferences).
   */
  public static isReadPerRecord(modelType: DatabaseBaseModelType): boolean {
    const model: BaseModel = new modelType();

    if (
      model.getAccessControlColumn() ||
      model.canAccessIfCanReadOn ||
      model.ownedThrough ||
      CreatePermission.getParentPrivacyFilter(modelType)
    ) {
      return true;
    }

    const references: ReturnType<typeof ReadPermission.getLabelledReferences> =
      ReadPermission.getLabelledReferences(modelType);

    return references.keys.length > 0 || references.anyKindColumns.length > 0;
  }

  /*
   * The records each checked list of `modelType` names in `data` (a create's
   * model or an update's data), each once, as sent - for the lists `data`
   * names at all. An entry with no id is skipped, as the reference checks
   * skip it.
   */
  public static getNamedIds(
    modelType: DatabaseBaseModelType,
    data: unknown,
  ): Dictionary<Array<string>> {
    const named: Dictionary<Array<string>> = {};

    if (!data || typeof data !== "object") {
      return named;
    }

    const record: Record<string, unknown> = data as Record<string, unknown>;

    for (const list of RelationListPermission.getCheckedLists(modelType)) {
      const value: unknown = record[list.column];

      if (value === undefined || value === null) {
        continue;
      }

      const seen: Set<string> = new Set<string>();
      const ids: Array<string> = [];

      for (const entry of resolveReferenceIds(value)) {
        const id: string = entry.toString().trim();

        if (seen.has(normalizeId(id))) {
          continue;
        }

        seen.add(normalizeId(id));
        ids.push(id);
      }

      named[list.column] = ids;
    }

    return named;
  }

  /*
   * Refuses a write that lists records its caller may not read (see the
   * class comment). `heldIdsByColumn` is, for an update, the records each
   * row it writes lists already, by column - an update that reaches no row
   * names nothing. `findReadableIds` reads the listed records as the
   * caller, with the read rule of their own table; `findIdsInProject` reads
   * them as OneUptime in the write's project. `referencesCheckedInProject`
   * says whether the write's own service holds every reference it names to
   * its project (ProjectReferencesService): with such a check, a caller
   * whose read of the listed model is narrowed by nothing is not looked up.
   */
  @CaptureSpan()
  public static async checkNamedLists(data: {
    modelType: DatabaseBaseModelType;
    data: unknown;
    props: DatabaseCommonInteractionProps;
    heldIdsByColumn?: Dictionary<Array<Array<string>>> | undefined;
    findReadableIds: RecordIdsFinder;
    findIdsInProject: RecordIdsFinder;
    referencesCheckedInProject: boolean;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    const named: Dictionary<Array<string>> = RelationListPermission.getNamedIds(
      data.modelType,
      data.data,
    );

    const refused: Array<string> = [];

    for (const list of RelationListPermission.getCheckedLists(data.modelType)) {
      const ids: Array<string> | undefined = named[list.column];

      if (!ids || ids.length === 0) {
        continue;
      }

      const newIds: Array<string> = RelationListPermission.getNewIds(
        ids,
        data.heldIdsByColumn ? data.heldIdsByColumn[list.column] || [] : null,
      );

      if (newIds.length === 0) {
        continue;
      }

      const readIds: Set<string> | null =
        await RelationListPermission.findReachableIds({
          list: list,
          ids: newIds,
          props: data.props,
          findReadableIds: data.findReadableIds,
          findIdsInProject: data.findIdsInProject,
          referencesCheckedInProject: data.referencesCheckedInProject,
        });

      if (!readIds) {
        continue;
      }

      for (const id of newIds) {
        if (!readIds.has(normalizeId(id))) {
          refused.push(`${list.title} "${id}"`);
        }
      }
    }

    if (refused.length > 0) {
      throw new UnreadableReferenceException(
        getReferenceRefusalMessage({
          subject: (
            new data.modelType().singularName || "record"
          ).toLowerCase(),
          described: refused,
        }),
      );
    }
  }

  /*
   * Of `ids`, the ones a row does not list yet: all of them on a create
   * (`heldIds` null), and on an update each one some row it writes does not
   * list. An update that writes no row adds nothing.
   */
  private static getNewIds(
    ids: Array<string>,
    heldIds: Array<Array<string>> | null,
  ): Array<string> {
    if (!heldIds) {
      return ids;
    }

    const heldSets: Array<Set<string>> = heldIds.map(
      (held: Array<string>): Set<string> => {
        return new Set<string>(held.map(normalizeId));
      },
    );

    return ids.filter((id: string): boolean => {
      return heldSets.some((held: Set<string>): boolean => {
        return !held.has(normalizeId(id));
      });
    });
  }

  /*
   * Of `ids`, the ones the caller may list, lower-cased - or null when
   * nothing needs looking up: a caller who reads every record of the listed
   * model, or who holds no read of it and no block with labels on it, on a
   * write whose service checks its references in the project itself. A
   * malformed id names no record and is not looked up.
   */
  private static async findReachableIds(data: {
    list: CheckedRelationList;
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
    findReadableIds: RecordIdsFinder;
    findIdsInProject: RecordIdsFinder;
    referencesCheckedInProject: boolean;
  }): Promise<Set<string> | null> {
    const listedModelType: DatabaseBaseModelType = data.list.listedModelType;

    const readPermissions: Array<Permission> =
      TablePermission.getTablePermission(
        listedModelType,
        DatabaseRequestType.Read,
      );

    const held: HeldPermissions = TablePermission.getHeldPermissions(
      data.props,
    );

    // A block with no labels on reading them takes every one of them away.
    if (HeldPermissionsUtil.isBlockedFromAny(held, readPermissions)) {
      return new Set<string>();
    }

    const isReader: boolean = HeldPermissionsUtil.isGrantedAny(
      held,
      readPermissions,
      {
        wildcard: TablePermission.getModelWildcard(
          listedModelType,
          DatabaseRequestType.Read,
        ),
      },
    );

    const blockedLabelIds: Array<ObjectID> = isReader
      ? []
      : ReadPermission.getBlockedLabelIds(
          listedModelType,
          data.props,
          DatabaseRequestType.Read,
        );

    if (
      data.referencesCheckedInProject &&
      (isReader
        ? CreatePermission.readsEveryParent(listedModelType, data.props)
        : blockedLabelIds.length === 0)
    ) {
      return null;
    }

    const lookupIds: Array<string> = data.ids.filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });

    if (lookupIds.length === 0) {
      return new Set<string>();
    }

    const foundIds: Array<string> = isReader
      ? await data.findReadableIds({
          modelType: listedModelType,
          ids: lookupIds,
          query: CreatePermission.getParentLookupQuery({
            parentModelType: listedModelType,
            ids: lookupIds,
            props: data.props,
          }),
          props: data.props,
        })
      : await data.findIdsInProject({
          modelType: listedModelType,
          ids: lookupIds,
          query: ReadPermission.addBlockedLabelsToQuery(
            listedModelType,
            {
              _id: QueryHelper.any(lookupIds),
            } as Query<BaseModel>,
            blockedLabelIds,
          ),
          props: data.props,
        });

    return new Set<string>(foundIds.map(normalizeId));
  }
}

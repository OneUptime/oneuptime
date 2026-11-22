import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../Types/Database/Permissions/TablePermission";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import DatabaseService from "../../Services/DatabaseService";
import logger, { LogAttributes } from "../Logger";
import { shouldBypassRecordPrivacy } from "../PrivacyFilterUtil";
import AuditLog from "../../../Models/AnalyticsModels/AuditLog";
import AllDatabaseModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  AUDIT_LOG_HIDDEN_VALUE,
  hideAuditLogChange,
} from "../../../Types/AuditLog/AuditLogHiddenValues";
import {
  AUDIT_LOG_NAME_COLUMNS,
  AUDIT_LOG_UNRECORDED_COLUMNS,
} from "../../../Types/AuditLog/AuditLogRecordedColumns";
import { AUDIT_LOG_SESSION_RESOURCE_TYPE } from "../../../Types/AuditLog/AuditLogSessionEvent";
import { AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE } from "../../../Types/AuditLog/AuditLogSignInFailure";
import { AUDIT_LOG_SIGN_IN_SETTINGS_CLEARED_RESOURCE_TYPE } from "../../../Types/AuditLog/AuditLogSignInSettingsCleared";
import { AUDIT_LOG_STATUS_PAGE_SESSION_RESOURCE_TYPE } from "../../../Types/AuditLog/AuditLogStatusPageSession";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import RelationReadersUtil from "../../../Types/Database/RelationReadersUtil";
import Dictionary from "../../../Types/Dictionary";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../Types/HeldPermissions";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getAuditLogResourceTypeSpellings } from "../../../Utils/AuditLog/AuditLogResourceTypes";

/*
 * WHAT A READER SEES OF AN AUDIT LOG ENTRY: WHAT THEY MAY READ OF THE
 * RECORD ITSELF (#10642).
 *
 * The audit log keeps the values before and after of the fields every
 * change wrote, and it is read by Project Owner, Project Admin, Settings
 * Admin and the Read Audit Log permission - roles that may not read every
 * record: a security case is the Security tiers' alone, a member may read
 * only the incidents a label gives them, a column may keep to fewer readers
 * than its table. Nobody reads, through the audit log, a value they could
 * not read on the record: an entry is held, as it is read, to its reader's
 * own read of its record - the table's and each column's read lists, with
 * the product levels they take (Types/Product/ProductLevels), owned
 * records, labels, blocks and private records - asked of the record's own
 * service (DatabaseService.getServiceOf), the read its pages and its API
 * make:
 *
 *   - a record the reader finds with their own read is theirs to read: each
 *     field whose column they may read on it keeps its values, and every
 *     other one is kept as changed, by its name, with its values hidden
 *     (Types/AuditLog/AuditLogHiddenValues);
 *   - a record they do not find - deleted since, or one they may not read -
 *     is read as its table's records are: when they read every record of the
 *     table in the project (DatabaseService.readsEveryRecordInProject), or
 *     are its owners or admins and the table's readers name their role, it
 *     is theirs to read; otherwise every field of it is hidden;
 *   - a record kept from the reader keeps its type, its id, who changed it,
 *     when, and which fields - and loses its name with its values, so nothing
 *     that names it is read either. A name is shown only where the columns
 *     it is made of are (AUDIT_LOG_NAME_COLUMNS, resourceNameColumns,
 *     resourceNameRelation);
 *   - a related record's name in a shown value - `{ _id, name }` - is kept
 *     where the record's own read through the relation reads it, or the
 *     reader may read it on the related record itself: its id otherwise.
 *
 * A column read on fewer records than its table (labels, owned records) is
 * shown only to a reader who holds it over the whole project. Entries the
 * audit log writes of its own - a person's sign-ins and sessions, a failed
 * sign-in, sign-in settings cleared, a status page reader's sessions - are
 * its readers' to read, as they were written for them. OneUptime itself and
 * a server admin read everything.
 */

// The kinds of entry the audit log writes of its own: no record's.
const OWN_RESOURCE_TYPES: ReadonlySet<string> = new Set<string>([
  AUDIT_LOG_SESSION_RESOURCE_TYPE,
  AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE,
  AUDIT_LOG_SIGN_IN_SETTINGS_CLEARED_RESOURCE_TYPE,
  AUDIT_LOG_STATUS_PAGE_SESSION_RESOURCE_TYPE,
]);

// The roles that read every record of a table whose readers name them.
const OWNER_AND_ADMIN: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

/*
 * What a reader may read of one table's records. A table they read no
 * record of shows nothing.
 */
interface TableRead {
  modelType: DatabaseBaseModelType;
  model: BaseModel;
  // They hold the table's read: some of its records are theirs to read.
  readsTable: boolean;
  // Every record of it in the project is theirs, as one no longer there is.
  readsEveryRecord: boolean;
  // The columns whose values they read on a record of it they may read.
  shownColumns: ReadonlySet<string>;
  // The records of it they found with their own read, by lower-cased id.
  foundIds: Set<string>;
}

// What an entry's reader may read of it.
interface EntryRead {
  // Its record is theirs to read.
  isRecordShown: boolean;
  // The table its record was read in: null for no record, or none known.
  table: TableRead | null;
  // Every field keeps its values: a kind of record no model has any longer.
  isEveryFieldShown: boolean;
  // The columns whose values are shown.
  shownColumns: ReadonlySet<string>;
}

const NOTHING_SHOWN: EntryRead = {
  isRecordShown: false,
  table: null,
  isEveryFieldShown: false,
  shownColumns: new Set<string>(),
};

// Each type entries are stored under, and the models it can name.
let modelTypesByResourceType: Map<
  string,
  Array<DatabaseBaseModelType>
> | null = null;

// The models whose name another model has too.
let modelTypesSharingAName: Set<DatabaseBaseModelType> | null = null;

// The type an entry about one of a model's records is stored under.
function getResourceTypeOf(model: BaseModel): string | null {
  return model.apiSingularName || model.singularName || null;
}

function isOwnResourceType(resourceType: string | null | undefined): boolean {
  return Boolean(resourceType && OWN_RESOURCE_TYPES.has(resourceType));
}

function getModelTypesByResourceType(): Map<
  string,
  Array<DatabaseBaseModelType>
> {
  if (modelTypesByResourceType) {
    return modelTypesByResourceType;
  }

  const map: Map<string, Array<DatabaseBaseModelType>> = new Map();

  for (const modelType of AllDatabaseModelTypes as Array<DatabaseBaseModelType>) {
    const resourceType: string | null = getResourceTypeOf(new modelType());

    if (!resourceType) {
      continue;
    }

    for (const spelling of getAuditLogResourceTypeSpellings(resourceType)) {
      if (OWN_RESOURCE_TYPES.has(spelling)) {
        continue;
      }

      const modelTypes: Array<DatabaseBaseModelType> = map.get(spelling) || [];

      if (!modelTypes.includes(modelType)) {
        modelTypes.push(modelType);
      }

      map.set(spelling, modelTypes);
    }
  }

  modelTypesByResourceType = map;

  return map;
}

function getModelTypesSharingAName(): Set<DatabaseBaseModelType> {
  if (modelTypesSharingAName) {
    return modelTypesSharingAName;
  }

  const sharing: Set<DatabaseBaseModelType> = new Set();

  for (const modelTypes of getModelTypesByResourceType().values()) {
    if (modelTypes.length > 1) {
      for (const modelType of modelTypes) {
        sharing.add(modelType);
      }
    }
  }

  modelTypesSharingAName = sharing;

  return sharing;
}

function getModelTypesOfResourceType(
  resourceType: string | null | undefined,
): Array<DatabaseBaseModelType> {
  if (!resourceType || isOwnResourceType(resourceType)) {
    return [];
  }

  return [...(getModelTypesByResourceType().get(resourceType) || [])];
}

// A record id as ids are compared: in lower case, or null for none.
function readIdOf(value: unknown): string | null {
  if (!value) {
    return null;
  }

  const text: string = (
    value instanceof ObjectID ? value.toString() : String(value)
  )
    .trim()
    .toLowerCase();

  return text && text !== "[object object]" ? text : null;
}

// The model a relation column reaches, or null for a column that is none.
function getRelatedModelType(
  model: BaseModel,
  column: string,
): DatabaseBaseModelType | null {
  if (!model.isTableColumn(column)) {
    return null;
  }

  const metadata: TableColumnMetadata | undefined =
    model.getTableColumnMetadata(column);

  if (
    !metadata?.modelType ||
    (metadata.type !== TableColumnType.Entity &&
      metadata.type !== TableColumnType.EntityArray)
  ) {
    return null;
  }

  return metadata.modelType as DatabaseBaseModelType;
}

// A recorded relation value with the names of the records it reaches left out.
function withoutNames(value: JSONValue): JSONValue {
  if (Array.isArray(value)) {
    return value.map((item: JSONValue): JSONValue => {
      return withoutNames(item);
    });
  }

  if (
    value &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, "name")
  ) {
    const reference: JSONObject = { ...(value as JSONObject) };
    delete reference["name"];
    return reference;
  }

  return value;
}

/*
 * The columns a change of the model can record: every column somebody may
 * read but the bookkeeping no entry records and the ones its audit
 * configuration leaves out.
 */
function getRecordableColumns(model: BaseModel): Array<string> {
  const access: Dictionary<ColumnAccessControl> =
    model.getColumnAccessControlForAllColumns();
  const ignored: Array<string> = model.enableAuditLogOn?.ignoreColumns || [];

  return Object.keys(access).filter((column: string): boolean => {
    return (
      model.isTableColumn(column) &&
      (access[column]?.read || []).length > 0 &&
      !AUDIT_LOG_UNRECORDED_COLUMNS.includes(column) &&
      !ignored.includes(column)
    );
  });
}

/*
 * The columns of a table whose values a reader reads on a record of it they
 * may read: one whose read they hold - the select check's rule
 * (ColumnPermissions.getModelColumnsByPermissions) - and, where the column
 * keeps to fewer readers than its table, held over the whole project with
 * no block on it: a grant of it limited to labels or owned records reads it
 * on some of the records only.
 */
function getShownColumnsOf(
  modelType: DatabaseBaseModelType,
  props: DatabaseCommonInteractionProps,
  held: HeldPermissions,
): Set<string> {
  const model: BaseModel = new modelType();
  const readable: Array<string> =
    ColumnPermissions.getModelColumnsByPermissions(
      modelType,
      ColumnPermissions.getColumnCheckRows(props),
      DatabaseRequestType.Read,
    ).columns;
  const tableReaders: Array<Permission> = TablePermission.getTablePermission(
    modelType,
    DatabaseRequestType.Read,
  );
  const access: Dictionary<ColumnAccessControl> =
    model.getColumnAccessControlForAllColumns();
  const shown: Set<string> = new Set<string>();

  for (const column of readable) {
    const readers: Array<Permission> = access[column]?.read || [];
    const coversTable: boolean = tableReaders.every(
      (permission: Permission): boolean => {
        return readers.includes(permission);
      },
    );

    if (
      coversTable ||
      HeldPermissionsUtil.holdsAnyOf(held, readers, {
        projectWideOnly: true,
        labelledBlocksRefuse: true,
        wildcard: HeldPermissionsUtil.getColumnWildcard({
          isOperationalResource: model.isOperationalResource,
          operation: DatabaseRequestType.Read,
          tablePermissions: tableReaders,
          columnPermissions: readers,
        }),
      })
    ) {
      shown.add(column);
    }
  }

  return shown;
}

// A table whose own service is not loaded is read by the permission check alone.
const plainServices: Map<
  DatabaseBaseModelType,
  DatabaseService<BaseModel>
> = new Map();

function getServiceOf(
  modelType: DatabaseBaseModelType,
): DatabaseService<BaseModel> {
  const own: DatabaseService<BaseModel> | null =
    DatabaseService.getServiceOf(modelType);

  if (own) {
    return own;
  }

  let service: DatabaseService<BaseModel> | undefined =
    plainServices.get(modelType);

  if (!service) {
    service = new DatabaseService<BaseModel>(modelType);
    plainServices.set(modelType, service);
  }

  return service;
}

/*
 * One reader's reads of the tables a set of entries is about, each worked
 * out once.
 */
class ReaderReads {
  private props: DatabaseCommonInteractionProps;
  private held: HeldPermissions;
  private tables: Map<DatabaseBaseModelType, Promise<TableRead>> = new Map();
  private relatedNames: Map<DatabaseBaseModelType, boolean> = new Map();

  public constructor(props: DatabaseCommonInteractionProps) {
    this.props = props;
    this.held = TablePermission.getHeldPermissions(props);
  }

  /*
   * Looks up which of `ids` the reader finds with the table's own read -
   * unless they read every record of it. A table whose name another one has
   * is looked in anyway: which of the two a record is in decides its
   * columns.
   */
  public async findRecords(
    modelType: DatabaseBaseModelType,
    ids: Array<string>,
  ): Promise<void> {
    const table: TableRead = await this.getTableRead(modelType);

    if (
      !table.readsTable ||
      ids.length === 0 ||
      (table.readsEveryRecord && !getModelTypesSharingAName().has(modelType))
    ) {
      return;
    }

    const unknown: Array<string> = ids.filter((id: string): boolean => {
      return !table.foundIds.has(id);
    });

    if (unknown.length === 0) {
      return;
    }

    try {
      const rows: Array<BaseModel> = await getServiceOf(modelType).findBy({
        query: {
          _id: QueryHelper.any(
            unknown.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
        } as Query<BaseModel>,
        select: { _id: true } as Select<BaseModel>,
        skip: 0,
        limit: unknown.length,
        props: this.props,
      });

      for (const row of rows) {
        const id: string | null = readIdOf(row.id);

        if (id) {
          table.foundIds.add(id);
        }
      }
    } catch (err) {
      // A read the record's own read refuses finds none of its records.
      logger.debug(err, {
        projectId: this.props.tenantId?.toString(),
      } as LogAttributes);
    }
  }

  // What the reader may read of an entry about a record.
  public async getEntryRead(entry: AuditLog): Promise<EntryRead> {
    const modelTypes: Array<DatabaseBaseModelType> =
      getModelTypesOfResourceType(entry.resourceType);

    if (modelTypes.length === 0) {
      /*
       * A kind of record no model has any longer: nobody reads it on the
       * record, and its owners and admins read it as they read every
       * record of the project.
       */
      return this.readsEveryTableAsOwnerOrAdmin()
        ? {
            isRecordShown: true,
            table: null,
            isEveryFieldShown: true,
            shownColumns: new Set<string>(),
          }
        : NOTHING_SHOWN;
    }

    const id: string | null = readIdOf(entry.resourceId);
    const tables: Array<TableRead> = [];

    for (const modelType of modelTypes) {
      tables.push(await this.getTableRead(modelType));
    }

    // The table the reader found its record in.
    const found: TableRead | undefined = id
      ? tables.find((table: TableRead): boolean => {
          return table.readsTable && table.foundIds.has(id);
        })
      : undefined;

    if (found) {
      return {
        isRecordShown: true,
        table: found,
        isEveryFieldShown: false,
        shownColumns: found.shownColumns,
      };
    }

    // Found in none: read as every record of its table, whichever it is.
    if (
      !tables.every((table: TableRead): boolean => {
        return table.readsTable && table.readsEveryRecord;
      })
    ) {
      return NOTHING_SHOWN;
    }

    if (tables.length === 1) {
      return {
        isRecordShown: true,
        table: tables[0]!,
        isEveryFieldShown: false,
        shownColumns: tables[0]!.shownColumns,
      };
    }

    // A name two tables share, with the record in neither: what both show.
    return {
      isRecordShown: true,
      table: null,
      isEveryFieldShown: false,
      shownColumns: new Set<string>(
        Array.from(tables[0]!.shownColumns).filter(
          (column: string): boolean => {
            return tables.every((table: TableRead): boolean => {
              return table.shownColumns.has(column);
            });
          },
        ),
      ),
    };
  }

  /*
   * Whether every entry of a type is read in full (see
   * AuditLogReadAccess.getTypesReadInFull): one of the audit log's own, or
   * every record of its tables read, with the columns that name it and, with
   * `values`, every column a change of it can record and the names of the
   * records those reach.
   */
  public async readsEveryEntryOfTypeInFull(
    resourceType: string,
    values: boolean,
  ): Promise<boolean> {
    if (isOwnResourceType(resourceType)) {
      return true;
    }

    const modelTypes: Array<DatabaseBaseModelType> =
      getModelTypesOfResourceType(resourceType);

    if (modelTypes.length === 0) {
      return this.readsEveryTableAsOwnerOrAdmin();
    }

    for (const modelType of modelTypes) {
      const table: TableRead = await this.getTableRead(modelType);

      if (
        !table.readsTable ||
        !table.readsEveryRecord ||
        !this.isNameShown(table)
      ) {
        return false;
      }

      if (!values) {
        continue;
      }

      for (const column of getRecordableColumns(table.model)) {
        if (!table.shownColumns.has(column)) {
          return false;
        }

        const related: DatabaseBaseModelType | null = getRelatedModelType(
          table.model,
          column,
        );

        if (related && !this.readsRelatedNames(related)) {
          return false;
        }
      }
    }

    return true;
  }

  /*
   * Whether a record's name is shown, once its record is: every column it
   * can be made of is - the ones of AUDIT_LOG_NAME_COLUMNS somebody may read,
   * the model's resourceNameColumns, and the row its resourceNameRelation
   * names, with that row's name read through it.
   */
  public isNameShown(table: TableRead): boolean {
    const model: BaseModel = table.model;
    const access: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    const columns: Array<string> = [
      ...AUDIT_LOG_NAME_COLUMNS.filter((column: string): boolean => {
        return (
          model.isTableColumn(column) &&
          (access[column]?.read || []).length > 0
        );
      }),
      ...(model.enableAuditLogOn?.resourceNameColumns || []).filter(
        (column: string): boolean => {
          return model.isTableColumn(column);
        },
      ),
    ];

    if (
      !columns.every((column: string): boolean => {
        return table.shownColumns.has(column);
      })
    ) {
      return false;
    }

    const relation: string | undefined =
      model.enableAuditLogOn?.resourceNameRelation;

    if (!relation) {
      return true;
    }

    const related: DatabaseBaseModelType | null = getRelatedModelType(
      model,
      relation,
    );

    return Boolean(
      related &&
        table.shownColumns.has(relation) &&
        this.readsRelatedNames(related),
    );
  }

  /*
   * A shown change of a relation, with each related record's name kept
   * only where the reader reads it (readsRelatedNames): its id otherwise.
   */
  public holdRelatedNames(table: TableRead, change: JSONObject): JSONObject {
    const related: DatabaseBaseModelType | null = getRelatedModelType(
      table.model,
      String(change["field"]),
    );

    if (!related || this.readsRelatedNames(related)) {
      return change;
    }

    const held: JSONObject = { ...change };

    for (const key of ["oldValue", "newValue"]) {
      if (Object.prototype.hasOwnProperty.call(change, key)) {
        held[key] = withoutNames(change[key] as JSONValue);
      }
    }

    return held;
  }

  /*
   * Whether every entry's reader reads every record of every table as the
   * project's owners and admins do: Project Owner or Project Admin over the
   * whole project, with no block on either, in a read that sees every
   * private record (shouldBypassRecordPrivacy) - for a kind of record no
   * model has any longer.
   */
  public readsEveryTableAsOwnerOrAdmin(): boolean {
    return (
      shouldBypassRecordPrivacy(this.props) &&
      HeldPermissionsUtil.holdsAnyOf(this.held, OWNER_AND_ADMIN, {
        projectWideOnly: true,
        labelledBlocksRefuse: true,
      })
    );
  }

  /*
   * Whether the reader reads the names of the records of a related table
   * that a relation reaches: the record's own read through a relation reads
   * them (a label on the joined row - a monitor's name on an incident), or
   * they may read the name on the related record itself. A person is named
   * by their name or, failing that, their email: both are asked.
   */
  private readsRelatedNames(relatedModelType: DatabaseBaseModelType): boolean {
    const known: boolean | undefined = this.relatedNames.get(relatedModelType);

    if (known !== undefined) {
      return known;
    }

    const relatedModel: BaseModel = new relatedModelType();
    const nameColumns: Array<string> =
      relatedModel.tableName === "User" ? ["name", "email"] : ["name"];

    const readsNames: boolean = nameColumns.every((column: string): boolean => {
      const metadata: TableColumnMetadata | undefined =
        relatedModel.getTableColumnMetadata(column);

      if (
        !metadata ||
        RelationReadersUtil.isReadByEveryReaderOfTheRelation(metadata)
      ) {
        return true;
      }

      return (
        this.readsTableOf(relatedModelType) &&
        getShownColumnsOf(relatedModelType, this.props, this.held).has(column)
      );
    });

    this.relatedNames.set(relatedModelType, readsNames);

    return readsNames;
  }

  /*
   * Whether every record of a table is the reader's to read as its owners
   * and admins read it: in a read that sees every private record, they hold
   * one of Project Owner and Project Admin that the table's readers - and
   * those of every record it is read through (@CanAccessIfCanReadOn) - name,
   * over the whole project, with no block on any of its read permissions.
   * For a table whose service narrows its reads where
   * readsEveryRecordInProject cannot see: a hook after the query.
   */
  private readsEveryRecordAsOwnerOrAdmin(
    modelType: DatabaseBaseModelType,
  ): boolean {
    if (!shouldBypassRecordPrivacy(this.props)) {
      return false;
    }

    const seen: Set<DatabaseBaseModelType> = new Set();
    let current: DatabaseBaseModelType | null = modelType;

    while (current && !seen.has(current)) {
      seen.add(current);

      const readers: Array<Permission> = TablePermission.getTablePermission(
        current,
        DatabaseRequestType.Read,
      );

      const roles: Array<Permission> = OWNER_AND_ADMIN.filter(
        (role: Permission): boolean => {
          return readers.includes(role);
        },
      );

      if (
        roles.length === 0 ||
        HeldPermissionsUtil.isBlockedFromAny(this.held, readers, {
          labelledBlocksRefuse: true,
        }) ||
        !HeldPermissionsUtil.isGrantedAny(this.held, roles, {
          projectWideOnly: true,
        })
      ) {
        return false;
      }

      const model: BaseModel = new current();

      current = model.canAccessIfCanReadOn
        ? getRelatedModelType(model, model.canAccessIfCanReadOn)
        : null;
    }

    return true;
  }

  private async getTableRead(
    modelType: DatabaseBaseModelType,
  ): Promise<TableRead> {
    let table: Promise<TableRead> | undefined = this.tables.get(modelType);

    if (!table) {
      table = this.readTable(modelType);
      this.tables.set(modelType, table);
    }

    return await table;
  }

  private async readTable(
    modelType: DatabaseBaseModelType,
  ): Promise<TableRead> {
    const model: BaseModel = new modelType();

    if (!this.readsTableOf(modelType)) {
      return {
        modelType,
        model,
        readsTable: false,
        readsEveryRecord: false,
        shownColumns: new Set<string>(),
        foundIds: new Set<string>(),
      };
    }

    let readsEveryRecord: boolean = false;

    try {
      readsEveryRecord =
        await getServiceOf(modelType).readsEveryRecordInProject(this.props);
    } catch (err) {
      logger.debug(err, {
        projectId: this.props.tenantId?.toString(),
      } as LogAttributes);
    }

    return {
      modelType,
      model,
      readsTable: true,
      readsEveryRecord:
        readsEveryRecord || this.readsEveryRecordAsOwnerOrAdmin(modelType),
      shownColumns: getShownColumnsOf(modelType, this.props, this.held),
      foundIds: new Set<string>(),
    };
  }

  // Whether the reader may read some record of the table: its table check.
  private readsTableOf(modelType: DatabaseBaseModelType): boolean {
    try {
      TablePermission.assertCallerMayReadTable(modelType, this.props);
      return true;
    } catch {
      return false;
    }
  }
}

export default class AuditLogReadAccess {
  // Whether an entry of this resource type is one the audit log writes of its own.
  public static isOwnEntryType(
    resourceType: string | null | undefined,
  ): boolean {
    return isOwnResourceType(resourceType);
  }

  /*
   * The models whose records an entry of `resourceType` can be about: the
   * model whose name, as the API and the audit log keep it or as it is
   * shown, is the type (Common/Utils/ModelApiName) - one, but for a name two
   * models share. None for a type of the audit log's own, nor for one no
   * model has (any longer).
   */
  public static getModelTypesOf(
    resourceType: string | null | undefined,
  ): Array<DatabaseBaseModelType> {
    return getModelTypesOfResourceType(resourceType);
  }

  // The type entries about one of a model's records are stored under.
  public static getResourceTypeOf(model: BaseModel): string | null {
    return getResourceTypeOf(model);
  }

  // OneUptime itself and a server admin read every entry as it was recorded.
  public static readsEverything(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return Boolean(props.isRoot || props.isMasterAdmin);
  }

  /*
   * Holds each entry to what `props` may read of its record (see above), in
   * place: a value they may not read hidden, and the name of a record they
   * may not read. What a read did not select is left as it is.
   */
  public static async holdEntriesToReader(data: {
    entries: Array<AuditLog>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (
      data.entries.length === 0 ||
      AuditLogReadAccess.readsEverything(data.props)
    ) {
      return;
    }

    const reads: ReaderReads = new ReaderReads(data.props);

    // The records each table's entries are about, looked up once a table.
    const idsByModel: Map<DatabaseBaseModelType, Set<string>> = new Map();

    for (const entry of data.entries) {
      const id: string | null = readIdOf(entry.resourceId);

      for (const modelType of getModelTypesOfResourceType(
        entry.resourceType,
      )) {
        const ids: Set<string> = idsByModel.get(modelType) || new Set();

        if (id) {
          ids.add(id);
        }

        idsByModel.set(modelType, ids);
      }
    }

    for (const [modelType, ids] of idsByModel) {
      await reads.findRecords(modelType, Array.from(ids));
    }

    for (const entry of data.entries) {
      if (isOwnResourceType(entry.resourceType)) {
        continue;
      }

      AuditLogReadAccess.holdEntry(entry, await reads.getEntryRead(entry), reads);
    }
  }

  /*
   * Of `resourceTypes` (as entries are stored), the ones each entry of which
   * `props` read in full: its record's name - and, with `values`, the values
   * of every field a change of it can record. A read that matches, orders or
   * groups entries by their names or their changes reads entries of these
   * only: which entries a filter on what is hidden matches, and where they
   * fall in an order, would say what it holds.
   */
  public static async getTypesReadInFull(data: {
    resourceTypes: Array<string>;
    values: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<string>> {
    if (AuditLogReadAccess.readsEverything(data.props)) {
      return [...data.resourceTypes];
    }

    const reads: ReaderReads = new ReaderReads(data.props);
    const readInFull: Array<string> = [];

    for (const resourceType of data.resourceTypes) {
      if (
        await reads.readsEveryEntryOfTypeInFull(resourceType, data.values)
      ) {
        readInFull.push(resourceType);
      }
    }

    return readInFull;
  }

  private static holdEntry(
    entry: AuditLog,
    read: EntryRead,
    reads: ReaderReads,
  ): void {
    const isNameShown: boolean =
      read.isRecordShown &&
      (read.isEveryFieldShown ||
        Boolean(read.table && reads.isNameShown(read.table)));

    if (
      entry.resourceName !== undefined &&
      entry.resourceName !== null &&
      !isNameShown
    ) {
      entry.resourceName = AUDIT_LOG_HIDDEN_VALUE;
    }

    const changes: JSONArray | undefined = entry.changes;

    if (!Array.isArray(changes) || read.isEveryFieldShown) {
      return;
    }

    entry.changes = changes.map((change: JSONObject): JSONObject => {
      if (!change || typeof change !== "object" || Array.isArray(change)) {
        return change;
      }

      const field: unknown = change["field"];

      if (
        !read.isRecordShown ||
        typeof field !== "string" ||
        !read.shownColumns.has(field)
      ) {
        return hideAuditLogChange(change);
      }

      return read.table ? reads.holdRelatedNames(read.table, change) : change;
    });
  }
}

import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../Types/Database/Permissions/ColumnPermission";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import AuditLogService, {
  AuditLogService as AuditLogServiceType,
} from "../../Services/AuditLogService";
import DatabaseService from "../../Services/DatabaseService";
import UserService from "../../Services/UserService";
import logger, { LogAttributes } from "../Logger";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../TeamMember/PendingInviteeProfiles";
import AuditLogReadAccess from "./AuditLogReadAccess";
import AuditLog from "../../../Models/AnalyticsModels/AuditLog";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "../../../Models/DatabaseModels/User";
import { isAuditLogChangeHidden } from "../../../Types/AuditLog/AuditLogHiddenValues";
import { AUDIT_LOG_NAME_COLUMNS } from "../../../Types/AuditLog/AuditLogRecordedColumns";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import RelationReadersUtil from "../../../Types/Database/RelationReadersUtil";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  AuditLogRelatedRecord,
  AuditLogRelatedRecordState,
  AuditLogRelatedRecords,
  MAX_AUDIT_LOG_RELATED_NAME_LENGTH,
  readAuditLogRecordIds,
  readAuditLogRecordedName,
} from "../../../Utils/AuditLog/AuditLogRelatedRecords";

/*
 * THE NAMES OF THE RECORDS AN AUDIT LOG ENTRY'S CHANGES NAME, AS ITS READER
 * MAY READ THEM (#10470).
 *
 * An entry records a related record by its id (a monitor's status, an
 * incident's severity, an on-call rule's policy) or as `{ _id, name }` with
 * the name it had then (labels, owners, an incident's monitors). The
 * changes dialog asks, once it opens, what each of those records is called
 * now (GET /audit-log/:id/related-record-names, AuditLogAPI). Nothing is
 * stored: an entry is immutable, and a name can change.
 *
 * The entry is read with its reader's own read (AuditLogService, which holds
 * it to them, #10642): a change whose value they may not read names no
 * record, and nothing of it is looked up. Each field's related model is the
 * column's: an Entity or EntityArray column's own, or, for an id, the Entity
 * column whose manyToOneRelationColumn it is. Each related table is read
 * once for the whole entry - every field naming its records together - in
 * one of two ways, as a row's relation select would read the name:
 *
 *   - the name is read by every reader of the relation
 *     (RelationReadersUtil.isReadByEveryReaderOfTheRelation): a label's, a
 *     monitor's, a person's. Whoever may read the field reads it, so it is
 *     read in the entry's project, as OneUptime, and a record not there is
 *     Deleted. A person is named as the project knows them
 *     (PendingInviteeProfiles: an invitee by what they were invited as);
 *   - otherwise with the reader's own read of the related table (its
 *     service's hooks, then the permission check): a record they find is
 *     Named - or Hidden, when they may not read its name; one they do not
 *     find is Deleted when they read every record of the table
 *     (readsEveryRecordInProject), so it would be there, and Hidden when
 *     they may not tell a record gone from one kept from them. A read the
 *     table refuses them hides every record of it.
 *
 * A Deleted record keeps the name the entry recorded for it, where the
 * reader was handed that name. A table with no name column names nothing:
 * its records keep their ids.
 */

// The most records of one table an entry's names are looked up for.
export const MAX_AUDIT_LOG_RELATED_RECORDS_PER_TABLE: number = 500;

// What an entry's fields name, by the table they are of.
interface RelatedTable {
  modelType: DatabaseBaseModelType;
  ids: Set<string>;
  fields: Map<string, Array<unknown>>;
}

// A table whose own service is not loaded is read by a plain one.
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

function textOf(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text: string = (
    typeof value === "string" ? value : String(value)
  ).trim();

  return text === "[object Object]"
    ? ""
    : text.slice(0, MAX_AUDIT_LOG_RELATED_NAME_LENGTH);
}

function idOf(row: BaseModel): string {
  return row.id ? row.id.toString().toLowerCase() : "";
}

function named(name: string): AuditLogRelatedRecord {
  return { state: AuditLogRelatedRecordState.Named, name };
}

const HIDDEN: AuditLogRelatedRecord = {
  state: AuditLogRelatedRecordState.Hidden,
};
const DELETED: AuditLogRelatedRecord = {
  state: AuditLogRelatedRecordState.Deleted,
};

export default class AuditLogRelatedNames {
  /*
   * The model whose records a field of a model names: an Entity or
   * EntityArray column's, or - for an id - the Entity column's whose
   * manyToOneRelationColumn it is. Null for a field that names no record.
   */
  public static getRelatedModelTypeOf(
    model: BaseModel,
    field: string,
  ): DatabaseBaseModelType | null {
    if (!model.isTableColumn(field)) {
      return null;
    }

    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(field);

    if (
      metadata?.modelType &&
      (metadata.type === TableColumnType.Entity ||
        metadata.type === TableColumnType.EntityArray)
    ) {
      return metadata.modelType as DatabaseBaseModelType;
    }

    for (const column of model.getTableColumns().columns) {
      const relation: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(column);

      if (
        relation?.type === TableColumnType.Entity &&
        relation.modelType &&
        relation.manyToOneRelationColumn === field
      ) {
        return relation.modelType as DatabaseBaseModelType;
      }
    }

    return null;
  }

  // The column a table's records are named by, or null when they have none.
  public static getNameColumnOf(model: BaseModel): string | null {
    return (
      AUDIT_LOG_NAME_COLUMNS.find((column: string): boolean => {
        return model.isTableColumn(column);
      }) || null
    );
  }

  /*
   * The names of the records the entry `auditLogId` names, as `props` may
   * read them. An entry they may not read is not found.
   */
  public static async readForEntry(data: {
    auditLogId: ObjectID;
    props: DatabaseCommonInteractionProps;
    // The audit log's service: the API's own, which holds each read to its reader.
    service?: AuditLogServiceType | undefined;
  }): Promise<AuditLogRelatedRecords> {
    const entry: AuditLog | null = await (
      data.service || AuditLogService
    ).findOneById({
      id: data.auditLogId,
      select: {
        _id: true,
        projectId: true,
        resourceType: true,
        changes: true,
      },
      props: data.props,
    });

    if (!entry) {
      throw new NotFoundException("Audit Log not found.");
    }

    return await AuditLogRelatedNames.readForHeldEntry({
      entry,
      props: data.props,
    });
  }

  /*
   * The names of the records an entry names, for an entry as its reader was
   * handed it (held to them by AuditLogService): each related table read
   * once.
   */
  public static async readForHeldEntry(data: {
    entry: AuditLog;
    props: DatabaseCommonInteractionProps;
  }): Promise<AuditLogRelatedRecords> {
    const records: AuditLogRelatedRecords = new Map();
    const changes: JSONArray = Array.isArray(data.entry.changes)
      ? data.entry.changes
      : [];
    const projectId: ObjectID | null =
      data.entry.projectId || data.props.tenantId || null;

    if (
      changes.length === 0 ||
      AuditLogReadAccess.isOwnEntryType(data.entry.resourceType)
    ) {
      return records;
    }

    const modelTypes: Array<DatabaseBaseModelType> =
      AuditLogReadAccess.getModelTypesOf(data.entry.resourceType);
    const tables: Map<DatabaseBaseModelType, RelatedTable> = new Map();

    for (const change of changes) {
      // A value the reader may not read names nothing.
      if (
        !change ||
        typeof change !== "object" ||
        Array.isArray(change) ||
        isAuditLogChangeHidden(change)
      ) {
        continue;
      }

      const field: unknown = (change as JSONObject)["field"];

      if (typeof field !== "string" || !field) {
        continue;
      }

      const related: DatabaseBaseModelType | null =
        AuditLogRelatedNames.getRelatedModelTypeOfEntry(modelTypes, field);

      if (!related) {
        continue;
      }

      const values: Array<unknown> = [
        (change as JSONObject)["oldValue"],
        (change as JSONObject)["newValue"],
      ];
      const ids: Array<string> = values.flatMap(
        (value: unknown): Array<string> => {
          return readAuditLogRecordIds(value);
        },
      );

      if (ids.length === 0) {
        continue;
      }

      const table: RelatedTable = tables.get(related) || {
        modelType: related,
        ids: new Set<string>(),
        fields: new Map<string, Array<unknown>>(),
      };

      for (const id of ids) {
        if (table.ids.size < MAX_AUDIT_LOG_RELATED_RECORDS_PER_TABLE) {
          table.ids.add(id);
        }
      }

      table.fields.set(field, [...(table.fields.get(field) || []), ...values]);
      tables.set(related, table);
    }

    for (const table of tables.values()) {
      const read: Map<string, AuditLogRelatedRecord> =
        await AuditLogRelatedNames.readTable({
          modelType: table.modelType,
          ids: Array.from(table.ids),
          projectId,
          props: data.props,
        });

      for (const [field, values] of table.fields) {
        const byId: Map<string, AuditLogRelatedRecord> =
          records.get(field) || new Map();

        for (const id of values.flatMap((value: unknown): Array<string> => {
          return readAuditLogRecordIds(value);
        })) {
          const record: AuditLogRelatedRecord | undefined = read.get(id);

          if (!record) {
            continue;
          }

          if (record.state === AuditLogRelatedRecordState.Deleted) {
            // The name the entry recorded, where the reader was handed it.
            const recorded: string | null = values
              .map((value: unknown): string | null => {
                return readAuditLogRecordedName(value, id);
              })
              .find((name: string | null): boolean => {
                return Boolean(name);
              }) as string | null;

            byId.set(id, recorded ? { ...DELETED, name: recorded } : DELETED);
            continue;
          }

          byId.set(id, record);
        }

        if (byId.size > 0) {
          records.set(field, byId);
        }
      }
    }

    return records;
  }

  /*
   * The related model of a field of the entry's type: the one model it
   * names records of, among the models whose type the entry is stored under
   * (one, but for a name two models share). Null when none, or when two
   * disagree.
   */
  private static getRelatedModelTypeOfEntry(
    modelTypes: Array<DatabaseBaseModelType>,
    field: string,
  ): DatabaseBaseModelType | null {
    const related: Set<DatabaseBaseModelType> = new Set();

    for (const modelType of modelTypes) {
      const found: DatabaseBaseModelType | null =
        AuditLogRelatedNames.getRelatedModelTypeOf(new modelType(), field);

      if (found) {
        related.add(found);
      }
    }

    return related.size === 1 ? Array.from(related)[0]! : null;
  }

  /*
   * What each record of one table is to the reader (see above), by
   * lower-cased id: one read.
   */
  private static async readTable(data: {
    modelType: DatabaseBaseModelType;
    ids: Array<string>;
    projectId: ObjectID | null;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, AuditLogRelatedRecord>> {
    const model: BaseModel = new data.modelType();

    if (data.ids.length === 0) {
      return new Map();
    }

    if (model instanceof User) {
      return await AuditLogRelatedNames.readPeople(data);
    }

    const nameColumn: string | null =
      AuditLogRelatedNames.getNameColumnOf(model);

    if (!nameColumn) {
      return new Map();
    }

    const tenantColumn: string | null = model.getTenantColumn();

    if (
      RelationReadersUtil.isReadByEveryReaderOfTheRelation(
        model.getTableColumnMetadata(nameColumn),
      ) &&
      tenantColumn &&
      data.projectId
    ) {
      return await AuditLogRelatedNames.readThroughRelation({
        ...data,
        nameColumn,
        tenantColumn,
        projectId: data.projectId,
      });
    }

    return await AuditLogRelatedNames.readAsReader({ ...data, nameColumn });
  }

  /*
   * A name every reader of the relation reads: read as OneUptime, the way a
   * row's relation select reads it, of the entry's project's records and
   * the ones every project shares (a global probe has no project). Another
   * project's record is never named; a record not there is Deleted.
   */
  private static async readThroughRelation(data: {
    modelType: DatabaseBaseModelType;
    ids: Array<string>;
    nameColumn: string;
    tenantColumn: string;
    projectId: ObjectID;
  }): Promise<Map<string, AuditLogRelatedRecord>> {
    const rows: Array<BaseModel> = await getServiceOf(data.modelType).findBy({
      query: {
        _id: QueryHelper.any(
          data.ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      } as Query<BaseModel>,
      select: {
        _id: true,
        [data.nameColumn]: true,
        [data.tenantColumn]: true,
      } as Select<BaseModel>,
      skip: 0,
      limit: data.ids.length,
      props: { isRoot: true, ignoreHooks: true },
    });

    const records: Map<string, AuditLogRelatedRecord> = new Map();
    const project: string = data.projectId.toString().toLowerCase();

    for (const row of rows) {
      const tenant: string = textOf(
        row.getValue(data.tenantColumn),
      ).toLowerCase();
      const name: string = textOf(row.getValue(data.nameColumn));

      if (!idOf(row)) {
        continue;
      }

      records.set(
        idOf(row),
        name && (!tenant || tenant === project) ? named(name) : HIDDEN,
      );
    }

    for (const id of data.ids) {
      if (!records.has(id)) {
        records.set(id, DELETED);
      }
    }

    return records;
  }

  /*
   * A name held to its own read: read with the reader's own read of the
   * related table. See above for what a record they do not find is.
   */
  private static async readAsReader(data: {
    modelType: DatabaseBaseModelType;
    ids: Array<string>;
    nameColumn: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, AuditLogRelatedRecord>> {
    const service: DatabaseService<BaseModel> = getServiceOf(data.modelType);
    const records: Map<string, AuditLogRelatedRecord> = new Map();

    // A name they may not read on the table is not asked: the read would refuse it.
    const readsNames: boolean = ColumnPermissions.getModelColumnsByPermissions(
      data.modelType,
      ColumnPermissions.getColumnCheckRows(data.props),
      DatabaseRequestType.Read,
    ).columns.includes(data.nameColumn);

    let rows: Array<BaseModel> = [];

    try {
      rows = await service.findBy({
        query: {
          _id: QueryHelper.any(
            data.ids.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
        } as Query<BaseModel>,
        select: (readsNames
          ? { _id: true, [data.nameColumn]: true }
          : { _id: true }) as Select<BaseModel>,
        skip: 0,
        limit: data.ids.length,
        props: data.props,
      });
    } catch (err) {
      // A read the table refuses its reader hides every record of it.
      logger.debug(err, {
        projectId: data.props.tenantId?.toString(),
      } as LogAttributes);

      for (const id of data.ids) {
        records.set(id, HIDDEN);
      }

      return records;
    }

    for (const row of rows) {
      const name: string = readsNames
        ? textOf(row.getValue(data.nameColumn))
        : "";

      if (idOf(row)) {
        records.set(idOf(row), name ? named(name) : HIDDEN);
      }
    }

    const missing: Array<string> = data.ids.filter((id: string): boolean => {
      return !records.has(id);
    });

    if (missing.length === 0) {
      return records;
    }

    let readsEveryRecord: boolean = false;

    try {
      readsEveryRecord = await service.readsEveryRecordInProject(data.props);
    } catch (err) {
      logger.debug(err, {
        projectId: data.props.tenantId?.toString(),
      } as LogAttributes);
    }

    for (const id of missing) {
      records.set(id, readsEveryRecord ? DELETED : HIDDEN);
    }

    return records;
  }

  /*
   * People, by their name or else their email - read by every reader of a
   * relation to them - as the entry's project knows them: someone only
   * invited by what they were invited as (PendingInviteeProfiles), never
   * by their account's own name. An account gone is Deleted.
   */
  private static async readPeople(data: {
    modelType: DatabaseBaseModelType;
    ids: Array<string>;
    projectId: ObjectID | null;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, AuditLogRelatedRecord>> {
    const user: User = new User();
    const isReadThroughRelation: boolean = ["name", "email"].every(
      (column: string): boolean => {
        return RelationReadersUtil.isReadByEveryReaderOfTheRelation(
          user.getTableColumnMetadata(column),
        );
      },
    );

    if (!isReadThroughRelation || !data.projectId) {
      return new Map(
        data.ids.map((id: string): [string, AuditLogRelatedRecord] => {
          return [id, HIDDEN];
        }),
      );
    }

    const rows: Array<User> = await UserService.findBy({
      query: {
        _id: QueryHelper.any(
          data.ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      },
      select: { _id: true, name: true, email: true },
      skip: 0,
      limit: data.ids.length,
      props: { isRoot: true },
    });
    const withheld: Map<string, WithheldProfile> =
      await PendingInviteeProfiles.readWithheldProfilesInProject({
        userIds: data.ids,
        projectId: data.projectId,
      });
    const records: Map<string, AuditLogRelatedRecord> = new Map();

    for (const row of rows) {
      const name: string = textOf(
        PendingInviteeProfiles.getNameInProject({
          userId: row.id,
          name: row.name,
          email: row.email,
          withheld,
        }),
      );

      if (idOf(row)) {
        records.set(idOf(row), name ? named(name) : HIDDEN);
      }
    }

    for (const id of data.ids) {
      if (!records.has(id)) {
        records.set(id, DELETED);
      }
    }

    return records;
  }
}

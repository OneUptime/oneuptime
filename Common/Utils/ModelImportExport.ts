import BaseModel, {
  DatabaseBaseModelType,
} from "../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../Types/BaseDatabase/AccessControl";
import Select from "../Types/BaseDatabase/Select";
import { TableColumnMetadata } from "../Types/Database/TableColumn";
import TableColumnType from "../Types/Database/TableColumnType";
import OneUptimeDate from "../Types/Date";
import Dictionary from "../Types/Dictionary";
import Recurring from "../Types/Events/Recurring";
import BadDataException from "../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../Types/JSON";

export const MODEL_EXPORT_FILE_TYPE: string = "oneuptime-resource-export";
export const MODEL_EXPORT_SCHEMA_VERSION: number = 1;

/*
 * Columns that are always server-managed and must never be exported or
 * imported, regardless of model metadata.
 */
const SYSTEM_COLUMNS: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
];

/*
 * Column types that never make sense in an export file: relations to other
 * entities (their ids would not resolve in another project or instance),
 * binary data, and secrets.
 */
const EXCLUDED_COLUMN_TYPES: Array<TableColumnType> = [
  TableColumnType.Entity,
  TableColumnType.EntityArray,
  TableColumnType.File,
  TableColumnType.Buffer,
  TableColumnType.Slug,
  TableColumnType.HashedString,
  TableColumnType.Password,
  TableColumnType.OTP,
];

/*
 * Columns that pass the generic metadata filters but must still never be
 * exported: plain-text credentials and server-managed runtime state that
 * would either leak secrets into export files or seed imported resources
 * with stale state from the source resource.
 */
const EXCLUDED_COLUMNS_BY_TABLE: Dictionary<Array<string>> = {
  StatusPage: ["embeddedOverallStatusToken"],
  Monitor: [
    "incomingMonitorRequest",
    "serverMonitorResponse",
    "incomingRequestMonitorHeartbeatCheckedAt",
    "serverMonitorRequestReceivedAt",
    "telemetryMonitorNextMonitorAt",
    "telemetryMonitorLastMonitorAt",
  ],
};

export default class ModelImportExport {
  /*
   * Derives the list of columns that can safely round-trip through an export
   * file from the model's own metadata. A column qualifies when the current
   * caller could both read it and set it on create, it is not computed or
   * server-generated, it holds no secret, and it does not reference another
   * entity (foreign keys of Entity relations are excluded along with the
   * relations themselves).
   */
  public static getImportExportableColumnNames(
    modelType: DatabaseBaseModelType,
  ): Array<string> {
    const model: BaseModel = new modelType();

    const tenantColumn: string | null = model.getTenantColumn();

    const foreignKeyColumns: Array<string> = [];

    for (const columnName of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(columnName);

      if (metadata?.manyToOneRelationColumn) {
        foreignKeyColumns.push(metadata.manyToOneRelationColumn);
      }
    }

    const excludedColumnsForTable: Array<string> =
      EXCLUDED_COLUMNS_BY_TABLE[model.tableName || ""] || [];

    const exportableColumns: Array<string> = [];

    for (const columnName of model.getTableColumns().columns) {
      if (SYSTEM_COLUMNS.includes(columnName)) {
        continue;
      }

      if (excludedColumnsForTable.includes(columnName)) {
        continue;
      }

      if (tenantColumn && columnName === tenantColumn) {
        continue;
      }

      if (foreignKeyColumns.includes(columnName)) {
        continue;
      }

      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(columnName);

      if (!metadata) {
        continue;
      }

      if (EXCLUDED_COLUMN_TYPES.includes(metadata.type)) {
        continue;
      }

      if (metadata.computed || metadata.hashed || metadata.encrypted) {
        continue;
      }

      if (metadata.forceGetDefaultValueOnCreate) {
        continue;
      }

      const accessControl: ColumnAccessControl | null =
        model.getColumnAccessControlFor(columnName);

      if (
        !accessControl ||
        accessControl.read.length === 0 ||
        accessControl.create.length === 0
      ) {
        continue;
      }

      exportableColumns.push(columnName);
    }

    return exportableColumns;
  }

  public static getImportExportSelect<TBaseModel extends BaseModel>(modelType: {
    new (): TBaseModel;
  }): Select<TBaseModel> {
    const select: JSONObject = {};

    for (const columnName of this.getImportExportableColumnNames(modelType)) {
      select[columnName] = true;
    }

    return select as Select<TBaseModel>;
  }

  public static toExportJSON<TBaseModel extends BaseModel>(
    item: TBaseModel,
    modelType: { new (): TBaseModel },
  ): JSONObject {
    const json: JSONObject = BaseModel.toJSON(item, modelType);

    const exportableColumns: Array<string> =
      this.getImportExportableColumnNames(modelType);

    const exportJson: JSONObject = {};

    for (const key of Object.keys(json)) {
      if (exportableColumns.includes(key)) {
        exportJson[key] = json[key];
      }
    }

    return exportJson;
  }

  public static buildExportEnvelope<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    items: Array<TBaseModel>;
    exportedAt: Date;
  }): JSONObject {
    const model: BaseModel = new data.modelType();

    return {
      fileType: MODEL_EXPORT_FILE_TYPE,
      schemaVersion: MODEL_EXPORT_SCHEMA_VERSION,
      resourceType: model.tableName || "",
      exportedAt: data.exportedAt.toISOString(),
      items: data.items.map((item: TBaseModel) => {
        return this.toExportJSON(item, data.modelType);
      }),
    };
  }

  /*
   * Accepts an export envelope, a plain array of items, or a single item
   * object, and returns the list of item JSONs to import. Throws
   * BadDataException with a user-facing message when the payload is not
   * usable for this model type.
   */
  public static parseImportPayload(data: {
    modelType: DatabaseBaseModelType;
    payload: JSONObject | JSONArray;
  }): Array<JSONObject> {
    const model: BaseModel = new data.modelType();
    const resourceName: string = model.singularName || "resource";

    let items: JSONArray | null = null;

    if (Array.isArray(data.payload)) {
      items = data.payload;
    } else if (data.payload && typeof data.payload === "object") {
      if (Array.isArray(data.payload["items"])) {
        const resourceType: unknown = data.payload["resourceType"];

        if (
          resourceType &&
          model.tableName &&
          resourceType !== model.tableName
        ) {
          throw new BadDataException(
            `This file contains ${resourceType.toString()} resources and cannot be imported here. Please select a ${resourceName} export file.`,
          );
        }

        items = data.payload["items"] as JSONArray;
      } else {
        // a single item object exported by hand.
        items = [data.payload];
      }
    }

    if (!items) {
      throw new BadDataException(
        `This file is not a valid ${resourceName} export file.`,
      );
    }

    if (items.length === 0) {
      throw new BadDataException(
        `This file does not contain any ${resourceName} to import.`,
      );
    }

    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new BadDataException(
          `This file is not a valid ${resourceName} export file.`,
        );
      }
    }

    return items as Array<JSONObject>;
  }

  /*
   * Builds a model instance from an import item, keeping only columns that
   * are importable for this model. Anything else in the file - ids, slugs,
   * timestamps, relations, unknown keys - is dropped so the server create
   * API treats the item as a brand new resource.
   */
  public static fromImportJSON<TBaseModel extends BaseModel>(data: {
    json: JSONObject;
    modelType: { new (): TBaseModel };
  }): TBaseModel {
    const item: TBaseModel = BaseModel.fromJSON(
      data.json,
      data.modelType,
    ) as TBaseModel;

    const exportableColumns: Array<string> =
      this.getImportExportableColumnNames(data.modelType);

    for (const columnName of item.getTableColumns().columns) {
      if (exportableColumns.includes(columnName)) {
        continue;
      }

      if ((item as any)[columnName] !== undefined) {
        item.removeValue(columnName);
      }
    }

    this.normalizeImportItem(item);

    return item;
  }

  /*
   * Model-specific fixups so imported items pass server-side create
   * validation. Currently: recurring scheduled maintenance templates are
   * rejected on create when their first-event dates are in the past (the
   * normal case for an export taken from an established template), so the
   * dates are advanced by the recurrence interval until they are in the
   * future, preserving the offsets between them.
   */
  private static normalizeImportItem(item: BaseModel): void {
    if (item.tableName !== "ScheduledMaintenanceTemplate") {
      return;
    }

    const isRecurringEvent: unknown = item.getValue("isRecurringEvent");
    const recurringInterval: unknown = item.getValue("recurringInterval");

    if (!isRecurringEvent || !recurringInterval) {
      return;
    }

    const dateColumns: Array<string> = [
      "firstEventScheduledAt",
      "firstEventStartsAt",
      "firstEventEndsAt",
    ];

    const dates: Array<Date> = [];

    for (const dateColumn of dateColumns) {
      const value: unknown = item.getValue(dateColumn);

      if (value instanceof Date) {
        dates.push(value);
      }
    }

    if (dates.length === 0) {
      return;
    }

    /*
     * Anchor the advance on the earliest date so every date ends up in the
     * future once shifted by the same amount.
     */
    const earliestDate: Date = dates.reduce((a: Date, b: Date) => {
      return a.getTime() <= b.getTime() ? a : b;
    });

    if (OneUptimeDate.isInTheFuture(earliestDate)) {
      return;
    }

    const interval: Recurring =
      recurringInterval instanceof Recurring
        ? recurringInterval
        : Recurring.fromJSON(recurringInterval as JSONObject);

    const nextEarliestDate: Date = Recurring.getNextDate(
      earliestDate,
      interval,
    );

    const advanceByMs: number =
      nextEarliestDate.getTime() - earliestDate.getTime();

    if (advanceByMs <= 0) {
      return;
    }

    for (const dateColumn of dateColumns) {
      const value: unknown = item.getValue(dateColumn);

      if (value instanceof Date) {
        (item as any)[dateColumn] = new Date(value.getTime() + advanceByMs);
      }
    }
  }
}

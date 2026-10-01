import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../Types/Dictionary";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import { JSONValue } from "../../Types/JSON";
import Permission from "../../Types/Permission";
import { isSecretFieldName } from "./TerraformValues";

/*
 * What the OneUptime Terraform provider makes of a model, worked out in the
 * browser from the same metadata the provider is generated from.
 *
 * The provider is generated from the OpenAPI spec (Scripts/TerraformProvider,
 * which reads Common/Server/Utils/OpenAPI.ts and Common/Utils/Schema/
 * ModelSchema.ts). Those run on the server; this file repeats their rules for
 * one model at a time, so the dashboard can show configuration for a real
 * resource without loading the spec:
 *
 *   - the resource is `oneuptime_<singular name in snake_case>`, and exists
 *     when the model is documented, has an API, and can be created over it;
 *   - a column is an attribute when it is in the create or update schema:
 *     documented, not computed, not a relation object, and with create (or
 *     update) permissions;
 *   - its Terraform type follows its column type (strings, numbers, booleans,
 *     RFC3339 timestamps, sets of ids, JSON strings, typed monitor steps);
 *   - it is required when the create schema requires it, and has the spec
 *     default its column declares.
 *
 * Common/Tests/Utils/DeveloperDocs/TerraformProviderSchemaContract.test.ts
 * runs the real spec through the real provider parser and holds this file to
 * it, for every resource the dashboard documents.
 */

export enum TerraformValueKind {
  // A string; wrapper objects ({_type: "Color", value: "#fff"}) give their value.
  String = "string",
  Number = "number",
  Bool = "bool",
  // An RFC3339 timestamp string.
  DateTime = "datetime",
  // A set of resource ids (labels, monitors, ...).
  IdSet = "id-set",
  // A set of plain strings.
  StringSet = "string-set",
  // A JSON object, written with jsonencode().
  Json = "json",
  // A monitor's typed `monitor_steps` list.
  MonitorSteps = "monitor-steps",
  // Not representable in a configuration (file contents).
  Unsupported = "unsupported",
}

/*
 * Why a column's value never appears in generated configuration. "hashed"
 * values cannot be read back at all; "secret" values could be, but are not
 * put on screen.
 */
export enum TerraformSecretKind {
  Hashed = "hashed",
  Secret = "secret",
}

export interface TerraformAttributeDescriptor {
  // The model's column, e.g. `isEnabled`.
  columnName: string;
  // The provider's attribute, e.g. `is_enabled`.
  attributeName: string;
  title: string;
  kind: TerraformValueKind;
  columnType: TableColumnType;
  inCreateSchema: boolean;
  inUpdateSchema: boolean;
  isRequired: boolean;
  // The spec default; the provider plans it whenever the attribute is left out.
  defaultValue?: JSONValue | undefined;
  secretKind?: TerraformSecretKind | undefined;
  /*
   * Set by the server as the resource runs (its current status, when it was
   * last seen, which episode an incident joined). Writing the value it has
   * now into a configuration would make Terraform put it back every time the
   * server moves it on, so generated configuration leaves these out.
   */
  isServerManaged: boolean;
  // The column's model, for sets of ids.
  relatedModelType?: DatabaseBaseModelType | undefined;
  example?: JSONValue | undefined;
  // The column's read permissions, to know whether the viewer may fetch it.
  readPermissions: Array<Permission>;
}

// Never part of a create or update schema (ModelSchema.getCreateModelSchema).
const AUTO_GENERATED_COLUMNS: ReadonlyArray<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
];

/*
 * Columns every model shares that are filled in by the server: the project
 * comes from the API key, the creator from whoever made the request, and so
 * on. They are attributes, but writing them into configuration only adds
 * noise.
 */
const SYSTEM_COLUMNS: ReadonlyArray<string> = [
  "projectId",
  "createdByUserId",
  "deletedByUserId",
  "slug",
  "isOwnerNotifiedOfResourceCreation",
];

/*
 * The state a resource is in, rather than how it is set up: its current
 * status or state (`currentMonitorStatusId`, `currentIncidentStateId`), when
 * the server last heard from it, what it counted.
 */
const SERVER_MANAGED_COLUMN_PATTERNS: ReadonlyArray<RegExp> = [
  /^current[A-Z]\w*Id$/,
  /^(last|next)[A-Z]\w*At$/,
];

/*
 * Server-managed columns no name rule catches, by table. Add one here when a
 * new model has a field the server keeps moving: a column listed here is
 * still an attribute of the resource, it is only left out of the
 * configuration the dashboard writes.
 */
export const SERVER_MANAGED_COLUMNS_BY_TABLE: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  Monitor: [
    "incomingRequestMonitorHeartbeatCheckedAt",
    "telemetryMonitorNextMonitorAt",
    "telemetryMonitorLastMonitorAt",
    "serverMonitorRequestReceivedAt",
    "incomingMonitorRequest",
    "serverMonitorResponse",
  ],
  Incident: ["incidentEpisodeId", "postmortemPostedAt"],
  Alert: ["alertEpisodeId", "monitorStatusWhenThisAlertWasCreatedId"],
  IncidentEpisode: ["resolvedAt", "episodeNumber", "groupingKey"],
  AlertEpisode: [
    "resolvedAt",
    "episodeNumber",
    "groupingKey",
    "alertGroupingRuleId",
  ],
  StatusPage: ["sendNextReportBy"],
  InventoryItem: ["firstSeenAt"],
  NetworkDevice: ["isMacAddressLearned"],
};

/*
 * The provider's resource and attribute names: its StringUtils.toSnakeCase
 * (Scripts/TerraformProvider/Core/StringUtils.ts), character for character.
 * "On-Call Policy" -> on_call_policy, "isEnabled" -> is_enabled,
 * "APIKey" -> api_key.
 */
export function toTerraformSnakeCase(value: string): string {
  return value
    .replace(/['`]/g, "")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/^_/, "")
    .replace(/[-\s]+/g, "_")
    .replace(/_+/g, "_");
}

/*
 * Whether a list of permissions keeps an API from being generated
 * (OpenAPIUtil.shouldExcludeApiForPermissions): none at all, or only Public
 * and CurrentUser.
 */
function isApiExcludedForPermissions(
  permissions: Array<Permission> | undefined,
): boolean {
  if (!permissions || permissions.length === 0) {
    return true;
  }

  return permissions.every((permission: Permission): boolean => {
    return (
      permission === Permission.Public || permission === Permission.CurrentUser
    );
  });
}

export interface TerraformModelOperations {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

// Which CRUD endpoints the public API (and so the provider) has for a model.
export function getTerraformModelOperations(
  modelType: DatabaseBaseModelType,
): TerraformModelOperations {
  const model: DatabaseBaseModel = new modelType();

  return {
    canCreate: !isApiExcludedForPermissions(model.createRecordPermissions),
    canRead: !isApiExcludedForPermissions(model.readRecordPermissions),
    canUpdate: !isApiExcludedForPermissions(model.updateRecordPermissions),
    canDelete: !isApiExcludedForPermissions(model.deleteRecordPermissions),
  };
}

// Whether the model is in the public API at all (OpenAPIUtil.generateOpenAPISpec).
export function isModelInPublicApi(modelType: DatabaseBaseModelType): boolean {
  const model: DatabaseBaseModel = new modelType();

  return Boolean(
    model.tableName && model.enableDocumentation && model.crudApiPath,
  );
}

/*
 * `oneuptime_workflow`, `oneuptime_on_call_policy`, ... The name both the
 * resource and its data source go by. Null when the model is not in the
 * public API.
 */
export function getTerraformTypeName(
  modelType: DatabaseBaseModelType,
): string | null {
  if (!isModelInPublicApi(modelType)) {
    return null;
  }

  const model: DatabaseBaseModel = new modelType();
  const name: string = model.singularName || model.tableName || "";

  return `oneuptime_${toTerraformSnakeCase(name)}`;
}

function getKindForColumn(column: TableColumnMetadata): TerraformValueKind {
  switch (column.type) {
    case TableColumnType.Boolean:
      return TerraformValueKind.Bool;
    case TableColumnType.Number:
    case TableColumnType.PositiveNumber:
    case TableColumnType.SmallPositiveNumber:
    case TableColumnType.BigPositiveNumber:
    case TableColumnType.SmallNumber:
    case TableColumnType.BigNumber:
      return TerraformValueKind.Number;
    case TableColumnType.Date:
      return TerraformValueKind.DateTime;
    case TableColumnType.EntityArray:
      return TerraformValueKind.IdSet;
    case TableColumnType.Array:
      return TerraformValueKind.StringSet;
    case TableColumnType.JSON:
    case TableColumnType.Permission:
    case TableColumnType.CustomFieldType:
      return TerraformValueKind.Json;
    case TableColumnType.MonitorSteps:
      return TerraformValueKind.MonitorSteps;
    case TableColumnType.File:
    case TableColumnType.Buffer:
    case TableColumnType.Entity:
      return TerraformValueKind.Unsupported;
    case TableColumnType.ObjectID:
    case TableColumnType.ShortText:
    case TableColumnType.LongText:
    case TableColumnType.VeryLongText:
    case TableColumnType.Name:
    case TableColumnType.Description:
    case TableColumnType.Slug:
    case TableColumnType.Markdown:
    case TableColumnType.HTML:
    case TableColumnType.JavaScript:
    case TableColumnType.CSS:
    case TableColumnType.Email:
    case TableColumnType.Phone:
    case TableColumnType.Domain:
    case TableColumnType.ShortURL:
    case TableColumnType.LongURL:
    case TableColumnType.OTP:
    case TableColumnType.Color:
    case TableColumnType.Version:
    case TableColumnType.IP:
    case TableColumnType.Port:
    case TableColumnType.MonitorType:
    case TableColumnType.WorkflowStatus:
    case TableColumnType.HashedString:
    case TableColumnType.Password:
      return TerraformValueKind.String;
    default:
      return TerraformValueKind.Unsupported;
  }
}

function getSecretKind(
  columnName: string,
  column: TableColumnMetadata,
): TerraformSecretKind | undefined {
  if (
    column.hashed ||
    column.type === TableColumnType.HashedString ||
    column.type === TableColumnType.Password
  ) {
    return TerraformSecretKind.Hashed;
  }

  if (column.encrypted) {
    return TerraformSecretKind.Secret;
  }

  /*
   * By name, only text can be a secret: `enableMasterPassword` is a switch,
   * `masterPassword` the secret it switches on.
   */
  if (
    getKindForColumn(column) === TerraformValueKind.String &&
    isSecretFieldName(columnName)
  ) {
    return TerraformSecretKind.Secret;
  }

  return undefined;
}

export function isServerManagedColumn(
  tableName: string,
  columnName: string,
): boolean {
  if (SYSTEM_COLUMNS.includes(columnName)) {
    return true;
  }

  if (
    SERVER_MANAGED_COLUMN_PATTERNS.some((pattern: RegExp): boolean => {
      return pattern.test(columnName);
    })
  ) {
    return true;
  }

  return Boolean(
    SERVER_MANAGED_COLUMNS_BY_TABLE[tableName]?.includes(columnName),
  );
}

/*
 * Whether a column is in a create or update schema for the given operation,
 * the way ModelSchema.buildModelSchema filters columns. A column without any
 * access control is in every schema.
 */
function isColumnInWriteSchema(data: {
  columnName: string;
  column: TableColumnMetadata;
  accessControl: ColumnAccessControl | undefined;
  operation: "create" | "update";
}): boolean {
  const { columnName, column, accessControl, operation } = data;

  if (column.hideColumnInDocumentation) {
    return false;
  }

  if (column.type === TableColumnType.Entity) {
    return false;
  }

  if (column.computed) {
    return false;
  }

  if (operation === "create" && AUTO_GENERATED_COLUMNS.includes(columnName)) {
    return false;
  }

  if (
    operation === "update" &&
    AUTO_GENERATED_COLUMNS.filter((name: string): boolean => {
      return name !== "_id";
    }).includes(columnName)
  ) {
    return false;
  }

  if (columnName === "_id") {
    return false;
  }

  if (!accessControl) {
    return true;
  }

  const permissions: Array<Permission> | undefined =
    operation === "create" ? accessControl.create : accessControl.update;

  return Boolean(permissions && permissions.length > 0);
}

/*
 * Column types whose schema accepts anything (`z.any()`), including nothing:
 * the spec never lists them as required.
 */
const COLUMN_TYPES_WITH_ANY_SCHEMA: ReadonlyArray<TableColumnType> = [
  TableColumnType.JSON,
  TableColumnType.Permission,
  TableColumnType.CustomFieldType,
  TableColumnType.File,
  TableColumnType.Buffer,
];

/*
 * Whether the create schema requires the column. ModelSchema makes a column
 * optional when it has a default (a default-value column, or a declared
 * `defaultValue`, which zod's .default() makes optional), is a slug, is the
 * project id (it comes from the API key), accepts any value, or is simply
 * not required.
 */
function isColumnRequiredOnCreate(column: TableColumnMetadata): boolean {
  if (column.isDefaultValueColumn) {
    return false;
  }

  if (column.defaultValue !== undefined && column.defaultValue !== null) {
    return false;
  }

  if (column.type === TableColumnType.Slug) {
    return false;
  }

  if (COLUMN_TYPES_WITH_ANY_SCHEMA.includes(column.type)) {
    return false;
  }

  if (column.type === TableColumnType.EntityArray && !column.modelType) {
    return false;
  }

  if (
    column.title?.toLowerCase() === "project id" &&
    column.type === TableColumnType.ObjectID
  ) {
    return false;
  }

  return Boolean(column.required);
}

/*
 * Every attribute the provider gives this model's resource, in the order the
 * model declares its columns. Empty when the model has no resource (it is not
 * in the public API, or cannot be created over it).
 */
export function getTerraformAttributes(
  modelType: DatabaseBaseModelType,
): Array<TerraformAttributeDescriptor> {
  if (!isModelInPublicApi(modelType)) {
    return [];
  }

  const operations: TerraformModelOperations =
    getTerraformModelOperations(modelType);

  if (!operations.canCreate) {
    return [];
  }

  const model: DatabaseBaseModel = new modelType();
  const tableName: string = model.tableName || "";
  const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
  const accessControlByColumn: Dictionary<ColumnAccessControl> =
    model.getColumnAccessControlForAllColumns();

  const attributes: Array<TerraformAttributeDescriptor> = [];

  for (const columnName of Object.keys(columns)) {
    const column: TableColumnMetadata | undefined = columns[columnName];

    if (!column) {
      continue;
    }

    const accessControl: ColumnAccessControl | undefined =
      accessControlByColumn[columnName];

    const inCreateSchema: boolean = isColumnInWriteSchema({
      columnName,
      column,
      accessControl,
      operation: "create",
    });

    const inUpdateSchema: boolean =
      operations.canUpdate &&
      isColumnInWriteSchema({
        columnName,
        column,
        accessControl,
        operation: "update",
      });

    if (!inCreateSchema && !inUpdateSchema) {
      continue;
    }

    const descriptor: TerraformAttributeDescriptor = {
      columnName,
      attributeName: toTerraformSnakeCase(columnName),
      title: column.title || columnName,
      kind: getKindForColumn(column),
      columnType: column.type,
      inCreateSchema,
      inUpdateSchema,
      isRequired: inCreateSchema && isColumnRequiredOnCreate(column),
      secretKind: getSecretKind(columnName, column),
      isServerManaged: isServerManagedColumn(tableName, columnName),
      readPermissions: accessControl?.read || [],
    };

    if (column.defaultValue !== undefined && column.defaultValue !== null) {
      descriptor.defaultValue = column.defaultValue as JSONValue;
    }

    if (column.type === TableColumnType.EntityArray && column.modelType) {
      descriptor.relatedModelType = column.modelType;
    }

    if (column.example !== undefined) {
      descriptor.example = column.example as JSONValue;
    }

    attributes.push(descriptor);
  }

  return attributes;
}

/*
 * The column that names a record: the model's display name column when it
 * declares one, otherwise `name`, otherwise `title`.
 */
export function getNameColumn(modelType: DatabaseBaseModelType): string | null {
  const model: DatabaseBaseModel = new modelType();
  const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
  const displayNameColumn: string | null = model.getDisplayNameColumn();

  if (displayNameColumn && columns[displayNameColumn]) {
    return displayNameColumn;
  }

  for (const candidate of ["name", "title", "displayName"]) {
    if (columns[candidate]) {
      return candidate;
    }
  }

  return null;
}

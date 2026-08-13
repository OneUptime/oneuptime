import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * Workflow builders write "id", because that is what an ID is called
 * everywhere they can see one: in the dashboard, in the API docs, and on the
 * model itself (`monitor.id`). On a database model, though, "id" is only a
 * TypeScript accessor - the persisted primary key column is "_id"
 * (DatabaseBaseModel._id). A query, select or data object keyed on "id"
 * therefore reached TypeORM verbatim and threw
 * `Property "id" was not found in "Monitor". Make sure your query is correct.`,
 * which is what https://github.com/OneUptime/oneuptime/issues/3132 reported.
 *
 * The create path has accepted "id" all along - DatabaseBaseModel._fromJSON
 * rewrites it to "_id" - so the fix is to make every other workflow argument
 * agree with create, rather than to take the alias away from create.
 */

export const ID_ARGUMENT_KEY: string = "id";
export const PRIMARY_KEY_COLUMN: string = "_id";

/*
 * Only alias when the model actually looks like a DatabaseBaseModel: it has
 * the "_id" primary key and no column of its own literally called "id".
 * No model ships an "id" column today, but a model that grew one would mean
 * something different by "id" and must keep it.
 */
type ModelAliasesIdFunction = (model: BaseModel) => boolean;

const modelAliasesId: ModelAliasesIdFunction = (model: BaseModel): boolean => {
  return (
    model.hasColumn(PRIMARY_KEY_COLUMN) && !model.hasColumn(ID_ARGUMENT_KEY)
  );
};

/*
 * A nested object is only worth walking into when it is a map of column names.
 * Serialized values - ObjectID, Date, and every QueryHelper operator - travel
 * as `{ "_type": "...", "value": ... }` and are values, not column maps, so
 * key rewriting has to stop at them.
 */
type IsColumnMapFunction = (value: JSONValue) => boolean;

const isColumnMap: IsColumnMapFunction = (value: JSONValue): boolean => {
  if (value === null || value === undefined || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value) || value instanceof Date) {
    return false;
  }

  return (value as JSONObject)["_type"] === undefined;
};

type NormalizeValueFunction = (
  value: JSONValue,
  columnName: string,
  model: BaseModel,
) => JSONValue;

/*
 * Relations are queried and selected one level deep - `{"project": {"id":
 * true}}` - so the alias has to follow the relation into the related model
 * rather than stopping at the top level.
 */
const normalizeValue: NormalizeValueFunction = (
  value: JSONValue,
  columnName: string,
  model: BaseModel,
): JSONValue => {
  if (!isColumnMap(value)) {
    return value;
  }

  const metadata: TableColumnMetadata | undefined =
    model.getTableColumnMetadata(columnName);

  if (
    !metadata ||
    !metadata.modelType ||
    (metadata.type !== TableColumnType.Entity &&
      metadata.type !== TableColumnType.EntityArray)
  ) {
    return value;
  }

  return normalizeModelKeys(value as JSONObject, new metadata.modelType());
};

type NormalizeModelKeysFunction = (
  json: JSONObject,
  model: BaseModel,
) => JSONObject;

/*
 * Returns a copy of `json` with the "id" alias resolved to the "_id" column,
 * including inside related-model objects one level down. Everything else is
 * copied through untouched - this deliberately does not validate column names,
 * so an argument that works today keeps working.
 */
export const normalizeModelKeys: NormalizeModelKeysFunction = (
  json: JSONObject,
  model: BaseModel,
): JSONObject => {
  const normalized: JSONObject = {};
  const aliasesId: boolean = modelAliasesId(model);

  /*
   * Someone who spells out "_id" meant "_id". If both spellings are present
   * the explicit column wins and the alias is dropped, so the result never
   * depends on key order.
   */
  const explicitPrimaryKeyGiven: boolean =
    json[PRIMARY_KEY_COLUMN] !== undefined;

  for (const key of Object.keys(json)) {
    let columnName: string = key;

    if (key === ID_ARGUMENT_KEY && aliasesId) {
      if (explicitPrimaryKeyGiven) {
        continue;
      }

      columnName = PRIMARY_KEY_COLUMN;
    }

    normalized[columnName] = normalizeValue(
      json[key] as JSONValue,
      columnName,
      model,
    );
  }

  return normalized;
};

type ApplyTenantColumnFunction = (
  json: JSONObject,
  model: BaseModel,
  tenantId: ObjectID,
) => JSONObject;

/*
 * Stamps the record being written with the project the workflow runs in.
 *
 * Setting the scalar tenant column is not enough on its own. Every tenant
 * model also exposes that same physical column through its many-to-one
 * relation - Monitor.project is @JoinColumn({name: "projectId"}) - and TypeORM
 * reads the relation property first, writing the column once. So a payload
 * carrying {"project": "<some other project>"} silently beat the stamp and
 * moved the record into that project. The relation keys pointing at the tenant
 * column are therefore dropped before the scalar is written.
 */
export const applyTenantColumn: ApplyTenantColumnFunction = (
  json: JSONObject,
  model: BaseModel,
  tenantId: ObjectID,
): JSONObject => {
  const tenantColumn: string | null = model.getTenantColumn();

  if (!tenantColumn) {
    return json;
  }

  const stamped: JSONObject = {};

  for (const key of Object.keys(json)) {
    if (key === tenantColumn) {
      continue;
    }

    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(key);

    if (metadata && metadata.manyToOneRelationColumn === tenantColumn) {
      continue;
    }

    stamped[key] = json[key];
  }

  stamped[tenantColumn] = tenantId;

  return stamped;
};

type DescribeModelColumnsFunction = (model: BaseModel) => string;

/*
 * The raw TypeORM failure ("Property "foo" was not found in "Monitor") names
 * neither the argument at fault nor anything the builder can pick from, so the
 * components append the real column list to it.
 */
export const describeModelColumns: DescribeModelColumnsFunction = (
  model: BaseModel,
): string => {
  const columns: Array<string> = [...model.getTableColumns().columns].sort(
    (a: string, b: string): number => {
      return a.localeCompare(b);
    },
  );

  return columns.join(", ");
};

type LogUnknownColumnsFunction = (
  json: JSONObject,
  model: BaseModel,
  log: (message: string) => void,
) => void;

/*
 * Create silently drops keys it does not recognise. DatabaseBaseModel._fromJSON
 * only assigns a key when getTableColumnMetadata returns something, and there is
 * no else branch, so a misspelled key never reaches the record. A required
 * column still fails loudly through DatabaseService.checkRequiredFields, but an
 * optional one - MonitorSecret.description, for instance - creates a record with
 * the field missing, returns Success, and says nothing at all. So "descriptoin"
 * looked like a green run to the builder who typed it.
 *
 * This only reports. Throwing would start failing workflows that run fine today,
 * and graphs created through the API never pass through the builder that would
 * have caught the typo, so the run has to continue.
 */
export const logUnknownColumns: LogUnknownColumnsFunction = (
  json: JSONObject,
  model: BaseModel,
  log: (message: string) => void,
): void => {
  const unknownKeys: Array<string> = Object.keys(json).filter(
    (key: string): boolean => {
      /*
       * "id" has no column of its own - _fromJSON rewrites it to the "_id"
       * primary key before looking the column up - so it is a legitimate key
       * here and must not be reported.
       */
      if (key === ID_ARGUMENT_KEY) {
        return false;
      }

      return !model.getTableColumnMetadata(key);
    },
  );

  if (unknownKeys.length === 0) {
    return;
  }

  const modelName: string =
    model.singularName || model.tableName || "this model";

  log(
    `Ignored ${unknownKeys.join(
      ", ",
    )}: not columns on ${modelName}. Columns you can use: ${describeModelColumns(
      model,
    )}.`,
  );
};

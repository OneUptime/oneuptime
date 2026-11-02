import DatabaseModels from "Common/Models/DatabaseModels/Index";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import {
  getTableColumns,
  TableColumnMetadata,
} from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { getNameColumn } from "Common/Utils/DeveloperDocs/TerraformSchema";
import { ALWAYS_SELECTABLE_COLUMNS } from "Common/Types/HeldPermissions";
import Permission from "Common/Types/Permission";
import { JSONObject } from "Common/Types/JSON";

interface ColumnAccessControl {
  read?: Permission[];
}

/*
 * Whether a key may read a record's column, by the server's rule
 * (ColumnPermission.getModelColumnsByPermissions): a column whose read rule
 * names someone other than a signed-in user alone, or one every select may
 * name. A column with no rule at all is closed: selecting it refused the
 * whole list - `oneuptime service list` asked for a service's
 * serviceLanguage, which declares none, and every one was refused.
 */
function shouldIncludeField(
  columnName: string,
  accessControlForColumns: Record<string, ColumnAccessControl>,
): boolean {
  const accessControl: ColumnAccessControl | undefined =
    accessControlForColumns[columnName];

  if (!accessControl) {
    return ALWAYS_SELECTABLE_COLUMNS.includes(columnName);
  }

  return (
    accessControl.read !== undefined &&
    accessControl.read.length > 0 &&
    !(
      accessControl.read.length === 1 &&
      accessControl.read[0] === Permission.CurrentUser
    )
  );
}

// Whether a key may read a record's column (shouldIncludeField).
export function isReadableColumn(
  model: BaseModel,
  columnName: string,
): boolean {
  return shouldIncludeField(
    columnName,
    (model.getColumnAccessControlForAllColumns() || {}) as Record<
      string,
      ColumnAccessControl
    >,
  );
}

export function generateAllFieldsSelect(
  tableName: string,
  modelType: "database" | "analytics",
): JSONObject {
  try {
    if (modelType === "database") {
      const ModelClass: (new () => BaseModel) | undefined = DatabaseModels.find(
        (Model: new () => BaseModel): boolean => {
          try {
            const instance: BaseModel = new Model();
            return instance.tableName === tableName;
          } catch {
            return false;
          }
        },
      );

      if (!ModelClass) {
        return getDefaultSelect();
      }

      const modelInstance: BaseModel = new ModelClass();
      const tableColumns: Record<string, unknown> =
        getTableColumns(modelInstance);
      const columnNames: string[] = Object.keys(tableColumns);

      if (columnNames.length === 0) {
        return getDefaultSelect();
      }

      const accessControlForColumns: Record<string, ColumnAccessControl> =
        (
          modelInstance as unknown as {
            getColumnAccessControlForAllColumns?: () => Record<
              string,
              ColumnAccessControl
            >;
          }
        ).getColumnAccessControlForAllColumns?.() || {};

      const selectObject: JSONObject = {};
      for (const columnName of columnNames) {
        if (shouldIncludeField(columnName, accessControlForColumns)) {
          selectObject[columnName] = true;
        }
      }

      if (Object.keys(selectObject).length === 0) {
        return getDefaultSelect();
      }

      return selectObject;
    }

    if (modelType === "analytics") {
      const ModelClass: (new () => AnalyticsBaseModel) | undefined =
        AnalyticsModels.find((Model: new () => AnalyticsBaseModel): boolean => {
          try {
            const instance: AnalyticsBaseModel = new Model();
            return instance.tableName === tableName;
          } catch {
            return false;
          }
        });

      if (!ModelClass) {
        return getDefaultSelect();
      }

      return getAnalyticsSelect(new ModelClass());
    }

    return getDefaultSelect();
  } catch {
    return getDefaultSelect();
  }
}

/*
 * The columns of a telemetry table that a list may ask for: those whose
 * read rule names someone (as for database models, a rule of only
 * CurrentUser names nobody a key can be), and, where a column declares no
 * read rule, only the ones every select may name (ALWAYS_SELECTABLE_COLUMNS:
 * the server reads a column with no rule as closed). Never the database
 * default: telemetry tables have no updatedAt, and the analytics API refuses
 * a select that names a column its table does not have, so every telemetry
 * list failed with "Unknown column: updatedAt".
 */
function getAnalyticsSelect(model: AnalyticsBaseModel): JSONObject {
  const selectObject: JSONObject = {};

  for (const column of model.getTableColumns()) {
    const read: Array<Permission> | undefined = column.accessControl?.read;
    const readable: boolean = read
      ? read.length > 0 &&
        !(read.length === 1 && read[0] === Permission.CurrentUser)
      : ALWAYS_SELECTABLE_COLUMNS.includes(column.key);

    if (readable) {
      selectObject[column.key] = true;
    }
  }

  if (Object.keys(selectObject).length === 0) {
    return { _id: true };
  }

  return selectObject;
}

/*
 * --fields: the fields a list or a get asks for, by name, `_id` always
 * among them. A relation's records come with their ID and name
 * (`currentIncidentState` is its ID and name), or with the fields a dot
 * names (`currentIncidentState.order`). A field the resource does not have
 * is refused here, with the command that lists them, rather than by the
 * server.
 */
export function generateSelectFromFields(data: {
  tableName: string;
  modelType: "database" | "analytics";
  resourceName: string;
  fields: string;
}): JSONObject {
  const names: Array<string> = data.fields
    .split(",")
    .map((name: string): string => {
      return name.trim();
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });

  if (names.length === 0) {
    throw new Error(
      `--fields takes field names separated by commas. \`oneuptime ${data.resourceName} fields\` lists them.`,
    );
  }

  const select: JSONObject = { _id: true };

  if (data.modelType === "analytics") {
    const ModelClass: (new () => AnalyticsBaseModel) | undefined =
      AnalyticsModels.find((Model: new () => AnalyticsBaseModel): boolean => {
        return new Model().tableName === data.tableName;
      });
    const keys: Array<string> = ModelClass
      ? new ModelClass().getTableColumns().map((column) => {
          return column.key;
        })
      : [];

    for (const name of names) {
      if (!keys.includes(name)) {
        throw unknownField(data.resourceName, name);
      }

      select[name] = true;
    }

    return select;
  }

  const ModelClass: (new () => BaseModel) | undefined = DatabaseModels.find(
    (Model: new () => BaseModel): boolean => {
      return new Model().tableName === data.tableName;
    },
  );
  const columns: Record<string, TableColumnMetadata> = ModelClass
    ? getTableColumns(new ModelClass())
    : {};

  for (const name of names) {
    const [field, nested] = name.split(".") as [string, string | undefined];
    const column: TableColumnMetadata | undefined = columns[field];

    if (!column) {
      throw unknownField(data.resourceName, field);
    }

    const isRelation: boolean =
      column.type === TableColumnType.Entity ||
      column.type === TableColumnType.EntityArray;

    if (!isRelation || !column.modelType) {
      select[field] = true;
      continue;
    }

    const related: JSONObject =
      select[field] && typeof select[field] === "object"
        ? (select[field] as JSONObject)
        : { _id: true };

    if (nested) {
      related[nested] = true;
    } else {
      const nameColumn: string | null = getNameColumn(
        column.modelType as new () => BaseModel,
      );

      if (nameColumn) {
        related[nameColumn] = true;
      }
    }

    select[field] = related;
  }

  return select;
}

function unknownField(resourceName: string, field: string): Error {
  return new Error(
    `The ${resourceName} resource has no field "${field}". \`oneuptime ${resourceName} fields\` lists them.`,
  );
}

/*
 * The column a refusal of the default select names: "You do not have
 * permissions to select on - <column>. ..." (the server's
 * ColumnRefusalMessage, which the Terraform provider and the MCP server
 * read the same way). Null for any other error.
 */
const SELECT_REFUSAL: string = "permissions to select on - ";

export function getRefusedSelectColumn(message: string): string | null {
  const start: number = message.indexOf(SELECT_REFUSAL);

  if (start === -1) {
    return null;
  }

  let end: number = start + SELECT_REFUSAL.length;

  while (end < message.length && isColumnCharacter(message.charAt(end))) {
    end++;
  }

  const column: string = message.slice(start + SELECT_REFUSAL.length, end);

  return column.length > 0 ? column : null;
}

function isColumnCharacter(character: string): boolean {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    (character >= "0" && character <= "9") ||
    character === "_"
  );
}

function getDefaultSelect(): JSONObject {
  return {
    _id: true,
    createdAt: true,
    updatedAt: true,
  };
}

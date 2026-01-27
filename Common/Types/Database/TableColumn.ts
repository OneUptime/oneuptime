import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dictionary from "../Dictionary";
import { JSONObject } from "../JSON";
import { ReflectionMetadataType } from "../Reflection";
import TableColumnType from "./TableColumnType";
import "reflect-metadata";

const tableColumn: symbol = Symbol("TableColumn");

export interface TableColumnMetadata {
  title?: string;
  description?: string;
  placeholder?: string;
  isDefaultValueColumn?: boolean;
  required?: boolean;
  unique?: boolean;
  computed?: boolean;
  hashed?: boolean;
  encrypted?: boolean;
  manyToOneRelationColumn?: string;
  type: TableColumnType;
  canReadOnRelationQuery?: boolean;
  hideColumnInDocumentation?: boolean;
  modelType?: { new (): BaseModel };
  defaultValue?: string | number | boolean | JSONObject; // default value for the column, can be a string, number, or boolean
  forceGetDefaultValueOnCreate?: () => string | number | boolean; // overwrites any value that is being passed and generates a new one. Useful for generating OTPs, etc.
  example?: string | number | boolean | JSONObject | Array<JSONObject>; // example value for API documentation
  ordered?: boolean;
}

export default (props: TableColumnMetadata): ReflectionMetadataType => {
  return Reflect.metadata(tableColumn, props);
};

type GetTableColumnFunction = <T extends BaseModel>(
  target: T,
  propertyKey: string,
) => TableColumnMetadata;

export const getTableColumn: GetTableColumnFunction = <T extends BaseModel>(
  target: T,
  propertyKey: string,
): TableColumnMetadata => {
  return Reflect.getMetadata(
    tableColumn,
    target,
    propertyKey,
  ) as TableColumnMetadata;
};

type GetTableColumnsFunction = <T extends BaseModel>(
  target: T,
) => Dictionary<TableColumnMetadata>;

export const getTableColumns: GetTableColumnsFunction = <T extends BaseModel>(
  target: T,
): Dictionary<TableColumnMetadata> => {
  const dictonary: Dictionary<TableColumnMetadata> = {};
  const keys: Array<string> = Object.keys(target);

  for (const key of keys) {
    if (Reflect.getMetadata(tableColumn, target, key)) {
      dictonary[key] = Reflect.getMetadata(
        tableColumn,
        target,
        key,
      ) as TableColumnMetadata;
    }
  }

  return dictonary;
};

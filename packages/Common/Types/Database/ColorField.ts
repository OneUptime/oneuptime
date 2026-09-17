import type BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ReflectionMetadataType } from "../Reflection";
import "reflect-metadata";

const colorFieldSymbol: symbol = Symbol("ColorField");

type ColorFieldColumnsFunction = <T extends BaseModel>(
  target: T,
) => Array<string>;

type FirstColorFieldColumnFunction = <T extends BaseModel>(
  target: T,
) => string | null;

type IsColorFieldColumnFunction = <T extends BaseModel>(
  target: T,
  propertyKey: string,
) => boolean;

const ColorField: () => ReflectionMetadataType = () => {
  return Reflect.metadata(colorFieldSymbol, true);
};

export const isColorFieldColumn: IsColorFieldColumnFunction = <
  T extends BaseModel,
>(
  target: T,
  propertyKey: string,
): boolean => {
  return Boolean(Reflect.getMetadata(colorFieldSymbol, target, propertyKey));
};

export const getColorFieldColumns: ColorFieldColumnsFunction = <
  T extends BaseModel,
>(
  target: T,
): Array<string> => {
  const columns: Array<string> = [];
  const keys: Array<string> = Object.keys(target);

  for (const key of keys) {
    if (isColorFieldColumn(target, key)) {
      columns.push(key);
    }
  }

  return columns;
};

export const getFirstColorFieldColumn: FirstColorFieldColumnFunction = <
  T extends BaseModel,
>(
  target: T,
): string | null => {
  const columns: Array<string> = getColorFieldColumns(target);

  if (columns.length === 0) {
    return null;
  }

  return columns[0] as string;
};

export default ColorField;

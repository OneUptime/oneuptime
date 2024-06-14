import BaseModel from "../../Models/BaseModel";
import Dictionary from "../Dictionary";
import { ReflectionMetadataType } from "../Reflection";
import "reflect-metadata";

const uniqueColumnBy: symbol = Symbol("UniqueColumnBy");

export default (columnName: string | Array<string>): ReflectionMetadataType => {
  return Reflect.metadata(uniqueColumnBy, columnName);
};

type GetUniqueColumnByFunction = <T extends BaseModel>(
  target: T,
  propertyKey: string,
) => string;

export const getUniqueColumnBy: GetUniqueColumnByFunction = <
  T extends BaseModel,
>(
  target: T,
  propertyKey: string,
): string => {
  return Reflect.getMetadata(uniqueColumnBy, target, propertyKey) as string;
};

type GetUniqueColumnsByFunction = <T extends BaseModel>(
  target: T,
) => Dictionary<string>;

export const getUniqueColumnsBy: GetUniqueColumnsByFunction = <
  T extends BaseModel,
>(
  target: T,
): Dictionary<string> => {
  const dictonary: Dictionary<string> = {};
  const keys: Array<string> = Object.keys(target);

  for (const key of keys) {
    if (Reflect.getMetadata(uniqueColumnBy, target, key)) {
      dictonary[key] = Reflect.getMetadata(
        uniqueColumnBy,
        target,
        key,
      ) as string;
    }
  }

  return dictonary;
};

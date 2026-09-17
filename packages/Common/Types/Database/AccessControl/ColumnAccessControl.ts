import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../BaseDatabase/AccessControl";
import Dictionary from "../../Dictionary";
import { ReflectionMetadataType } from "../../Reflection";
import "reflect-metadata";

const accessControlSymbol: symbol = Symbol("ColumnAccessControl");

export default (accessControl: ColumnAccessControl): ReflectionMetadataType => {
  return Reflect.metadata(accessControlSymbol, accessControl);
};

type GetColumnAccessControlFunction = (
  target: BaseModel,
  propertyKey: string,
) => ColumnAccessControl;

export const getColumnAccessControl: GetColumnAccessControlFunction = (
  target: BaseModel,
  propertyKey: string,
): ColumnAccessControl => {
  return Reflect.getMetadata(
    accessControlSymbol,
    target,
    propertyKey,
  ) as ColumnAccessControl;
};

type GetColumnAccessControlForAllColumnsFunction = <T extends BaseModel>(
  target: T,
) => Dictionary<ColumnAccessControl>;

/*
 * Per-class cache. Safe to key on the constructor because every decorated
 * column is initialised to `undefined` in the class body, so Object.keys()
 * is identical for every instance of a class (see OwnerOnlyColumn.ts).
 * Callers must treat the returned dictionary as read-only.
 */
const accessControlCache: WeakMap<
  { new (): BaseModel },
  Dictionary<ColumnAccessControl>
> = new WeakMap();

export const getColumnAccessControlForAllColumns: GetColumnAccessControlForAllColumnsFunction =
  <T extends BaseModel>(target: T): Dictionary<ColumnAccessControl> => {
    const modelClass: { new (): BaseModel } = target.constructor as {
      new (): BaseModel;
    };
    let cached: Dictionary<ColumnAccessControl> | undefined =
      accessControlCache.get(modelClass);

    if (!cached) {
      const dictonary: Dictionary<ColumnAccessControl> = {};
      const keys: Array<string> = Object.keys(target);

      for (const key of keys) {
        const accessControl: ColumnAccessControl | undefined =
          Reflect.getMetadata(accessControlSymbol, target, key) as
            | ColumnAccessControl
            | undefined;
        if (accessControl) {
          dictonary[key] = accessControl;
        }
      }

      cached = dictonary;
      accessControlCache.set(modelClass, cached);
    }

    return cached;
  };

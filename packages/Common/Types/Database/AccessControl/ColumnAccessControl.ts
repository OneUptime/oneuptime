import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../BaseDatabase/AccessControl";
import getCanonicalModelInstance from "../CanonicalModelInstance";
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
 * Per-class cache, keyed on the constructor and built from a canonical
 * instance of that class rather than from whichever instance asked first, so
 * a caller that has deleted a column off its own instance cannot define what
 * the class reports for the rest of the process. See
 * CanonicalModelInstance.ts for the bug this prevents. Callers must treat the
 * returned dictionary as read-only.
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
      const metadataSource: T = getCanonicalModelInstance(target);
      const dictonary: Dictionary<ColumnAccessControl> = {};
      const keys: Array<string> = Object.keys(metadataSource);

      for (const key of keys) {
        const accessControl: ColumnAccessControl | undefined =
          Reflect.getMetadata(accessControlSymbol, metadataSource, key) as
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

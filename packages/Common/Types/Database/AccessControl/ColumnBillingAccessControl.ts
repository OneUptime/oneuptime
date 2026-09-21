import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ColumnBillingAccessControl from "../../BaseDatabase/ColumnBillingAccessControl";
import getCanonicalModelInstance from "../CanonicalModelInstance";
import Dictionary from "../../Dictionary";
import { ReflectionMetadataType } from "../../Reflection";
import "reflect-metadata";

const accessControlSymbol: symbol = Symbol("ColumnBillingAccessControl");

export default (
  accessControl: ColumnBillingAccessControl,
): ReflectionMetadataType => {
  return Reflect.metadata(accessControlSymbol, accessControl);
};

type GetColumnBillingAccessControlFunction = (
  target: BaseModel,
  propertyKey: string,
) => ColumnBillingAccessControl;

export const getColumnBillingAccessControl: GetColumnBillingAccessControlFunction =
  (target: BaseModel, propertyKey: string): ColumnBillingAccessControl => {
    return Reflect.getMetadata(
      accessControlSymbol,
      target,
      propertyKey,
    ) as ColumnBillingAccessControl;
  };

type GetColumnBillingAccessControlForAllColumnsFunction = <T extends BaseModel>(
  target: T,
) => Dictionary<ColumnBillingAccessControl>;

/*
 * Per-class cache, keyed on the constructor and built from a canonical
 * instance of that class rather than from whichever instance asked first, so
 * a caller that has deleted a column off its own instance cannot define what
 * the class reports for the rest of the process. See
 * CanonicalModelInstance.ts for the bug this prevents. Callers must treat the
 * returned dictionary as read-only.
 */
const billingAccessControlCache: WeakMap<
  { new (): BaseModel },
  Dictionary<ColumnBillingAccessControl>
> = new WeakMap();

export const getColumnBillingAccessControlForAllColumns: GetColumnBillingAccessControlForAllColumnsFunction =
  <T extends BaseModel>(target: T): Dictionary<ColumnBillingAccessControl> => {
    const modelClass: { new (): BaseModel } = target.constructor as {
      new (): BaseModel;
    };
    let cached: Dictionary<ColumnBillingAccessControl> | undefined =
      billingAccessControlCache.get(modelClass);

    if (!cached) {
      const metadataSource: T = getCanonicalModelInstance(target);
      const dictonary: Dictionary<ColumnBillingAccessControl> = {};
      const keys: Array<string> = Object.keys(metadataSource);

      for (const key of keys) {
        const accessControl: ColumnBillingAccessControl | undefined =
          Reflect.getMetadata(accessControlSymbol, metadataSource, key) as
            | ColumnBillingAccessControl
            | undefined;
        if (accessControl) {
          dictonary[key] = accessControl;
        }
      }

      cached = dictonary;
      billingAccessControlCache.set(modelClass, cached);
    }

    return cached;
  };

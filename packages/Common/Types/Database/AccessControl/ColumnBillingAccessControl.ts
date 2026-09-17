import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ColumnBillingAccessControl from "../../BaseDatabase/ColumnBillingAccessControl";
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
 * Per-class cache. Safe to key on the constructor because every decorated
 * column is initialised to `undefined` in the class body, so Object.keys()
 * is identical for every instance of a class (see OwnerOnlyColumn.ts).
 * Callers must treat the returned dictionary as read-only.
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
      const dictonary: Dictionary<ColumnBillingAccessControl> = {};
      const keys: Array<string> = Object.keys(target);

      for (const key of keys) {
        const accessControl: ColumnBillingAccessControl | undefined =
          Reflect.getMetadata(accessControlSymbol, target, key) as
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

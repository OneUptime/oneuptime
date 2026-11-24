import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../BaseDatabase/AccessControl";
import getCanonicalModelInstance from "../CanonicalModelInstance";
import Dictionary from "../../Dictionary";
import GenericObject from "../../GenericObject";
import { ReflectionMetadataType } from "../../Reflection";
import { withProductLevelsOnLists } from "../../Product/ProductLevels";
import UserAttribution from "../UserAttribution";
import "reflect-metadata";

const accessControlSymbol: symbol = Symbol("ColumnAccessControl");

/*
 * A column that records who did something to its record - `createdByUserId`,
 * `archivedByUser` - is read as declared and written by no request, whatever
 * its create and update lists say: OneUptime fills it in (see
 * UserAttribution).
 */
export default (accessControl: ColumnAccessControl): ReflectionMetadataType => {
  return ((target: GenericObject, propertyKey?: string | symbol): void => {
    Reflect.defineMetadata(
      accessControlSymbol,
      UserAttribution.getAccessControl(propertyKey, accessControl),
      target,
      propertyKey as string | symbol,
    );
  }) as ReflectionMetadataType;
};

/*
 * A column's lists as they are read: what it declares, with the levels of
 * the product whose records the table holds (Types/Product/ProductLevels),
 * as the table's own lists are read (TableAccessControl) - where the role
 * a level follows is on the column's list and on the table's for the same
 * operation. The declared object itself for a column nothing is added to;
 * otherwise one copy per column and table, made once.
 */
const withLevelsCache: WeakMap<
  ColumnAccessControl,
  Map<string, ColumnAccessControl>
> = new WeakMap();

const withLevels: (
  model: BaseModel | null | undefined,
  accessControl: ColumnAccessControl | undefined,
) => ColumnAccessControl | undefined = (
  model: BaseModel | null | undefined,
  accessControl: ColumnAccessControl | undefined,
): ColumnAccessControl | undefined => {
  const tableName: string | null | undefined = model?.tableName;

  if (!accessControl || !tableName || !model) {
    return accessControl;
  }

  const known: ColumnAccessControl | undefined = withLevelsCache
    .get(accessControl)
    ?.get(tableName);

  if (known) {
    return known;
  }

  const answer: ColumnAccessControl = withProductLevelsOnLists(
    tableName,
    accessControl,
    {
      create: model.createRecordPermissions,
      read: model.readRecordPermissions,
      update: model.updateRecordPermissions,
    },
  );

  let byTable: Map<string, ColumnAccessControl> | undefined =
    withLevelsCache.get(accessControl);

  if (!byTable) {
    byTable = new Map<string, ColumnAccessControl>();
    withLevelsCache.set(accessControl, byTable);
  }

  byTable.set(tableName, answer);

  return answer;
};

type GetColumnAccessControlFunction = (
  target: BaseModel,
  propertyKey: string,
) => ColumnAccessControl;

export const getColumnAccessControl: GetColumnAccessControlFunction = (
  target: BaseModel,
  propertyKey: string,
): ColumnAccessControl => {
  return withLevels(
    target,
    Reflect.getMetadata(accessControlSymbol, target, propertyKey) as
      | ColumnAccessControl
      | undefined,
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
      const canonical: T | null = getCanonicalModelInstance(target);
      const metadataSource: T = canonical || target;
      const dictonary: Dictionary<ColumnAccessControl> = {};
      const keys: Array<string> = Object.keys(metadataSource);

      for (const key of keys) {
        const accessControl: ColumnAccessControl | undefined = withLevels(
          metadataSource,
          Reflect.getMetadata(accessControlSymbol, metadataSource, key) as
            | ColumnAccessControl
            | undefined,
        );
        if (accessControl) {
          dictonary[key] = accessControl;
        }
      }

      cached = dictonary;
      /*
       * No canonical instance (see CanonicalModelInstance): answer from the
       * instance we were handed, but do NOT cache it for the class - that
       * instance may be a mutilated one, and a cached answer outlives it.
       */
      if (canonical) {
        accessControlCache.set(modelClass, cached);
      }
    }

    return cached;
  };

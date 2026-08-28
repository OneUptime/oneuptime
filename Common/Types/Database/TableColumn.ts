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
  /*
   * Name of the sibling column that holds this column's per-record salt.
   *
   * When set, the write path generates a fresh random salt on every write of
   * this column, stores it in the named column, and mixes it into the hash.
   * Two records with the same plaintext then hash to different values, so one
   * precomputed table (or one cracked value) buys an attacker nothing
   * anywhere else. The salt column must be nullable — rows written before the
   * salt existed have none and verify against the legacy unsalted scheme.
   */
  hashSaltColumn?: string;
  encrypted?: boolean;
  manyToOneRelationColumn?: string;
  type: TableColumnType;
  canReadOnRelationQuery?: boolean;
  hideColumnInDocumentation?: boolean;
  modelType?: { new (): BaseModel };
  /*
   * Lazy form of modelType, resolved on read rather than at decoration time.
   *
   * A relation between two models that import each other (Monitor <->
   * NetworkDevice) is a circular import: whichever module the loader reaches
   * second sees the first as `undefined` while its own decorators run, so an
   * eager `modelType: TheOtherModel` captures `undefined` and every later
   * select on that relation throws "modelType is not found". A thunk defers the
   * dereference until read time - after every module has finished loading - so
   * both directions resolve regardless of load order. getTableColumn(s) below
   * resolve it into modelType, so nothing downstream needs to know it was lazy.
   */
  modelTypeThunk?: () => { new (): BaseModel };
  defaultValue?: string | number | boolean | JSONObject; // default value for the column, can be a string, number, or boolean
  forceGetDefaultValueOnCreate?: () => string | number | boolean; // overwrites any value that is being passed and generates a new one. Useful for generating OTPs, etc.
  example?: string | number | boolean | JSONObject | Array<JSONObject>; // example value for API documentation
  ordered?: boolean;
}

export default (props: TableColumnMetadata): ReflectionMetadataType => {
  return Reflect.metadata(tableColumn, props);
};

/*
 * Resolve a lazy modelTypeThunk into modelType on read. Returns the metadata
 * untouched when there is no thunk (the common case), and otherwise a shallow
 * copy with modelType filled in so the stored metadata is never mutated.
 */
function resolveModelType(
  metadata: TableColumnMetadata | undefined,
): TableColumnMetadata | undefined {
  if (!metadata || metadata.modelType || !metadata.modelTypeThunk) {
    return metadata;
  }

  return { ...metadata, modelType: metadata.modelTypeThunk() };
}

type GetTableColumnFunction = <T extends BaseModel>(
  target: T,
  propertyKey: string,
) => TableColumnMetadata;

export const getTableColumn: GetTableColumnFunction = <T extends BaseModel>(
  target: T,
  propertyKey: string,
): TableColumnMetadata => {
  return resolveModelType(
    Reflect.getMetadata(
      tableColumn,
      target,
      propertyKey,
    ) as TableColumnMetadata,
  ) as TableColumnMetadata;
};

type GetTableColumnsFunction = <T extends BaseModel>(
  target: T,
) => Dictionary<TableColumnMetadata>;

/*
 * Per-class cache. Safe to key on the constructor because every decorated
 * column is initialised to `undefined` in the class body, so Object.keys()
 * is identical for every instance of a class (see OwnerOnlyColumn.ts).
 */
const tableColumnsCache: WeakMap<
  { new (): BaseModel },
  Dictionary<TableColumnMetadata>
> = new WeakMap();

export const getTableColumns: GetTableColumnsFunction = <T extends BaseModel>(
  target: T,
): Dictionary<TableColumnMetadata> => {
  const modelClass: { new (): BaseModel } = target.constructor as {
    new (): BaseModel;
  };
  let cached: Dictionary<TableColumnMetadata> | undefined =
    tableColumnsCache.get(modelClass);

  if (!cached) {
    const dictonary: Dictionary<TableColumnMetadata> = {};
    const keys: Array<string> = Object.keys(target);

    for (const key of keys) {
      const metadata: TableColumnMetadata | undefined = Reflect.getMetadata(
        tableColumn,
        target,
        key,
      ) as TableColumnMetadata | undefined;
      if (metadata) {
        dictonary[key] = resolveModelType(metadata) as TableColumnMetadata;
      }
    }

    cached = dictonary;
    tableColumnsCache.set(modelClass, cached);
  }

  /*
   * Hand out a copy, not the cached dictionary itself: callers mutate the
   * result (the API reference docs delete entries from it), which would
   * otherwise strip columns from every later call for the same class.
   */
  return { ...cached };
};

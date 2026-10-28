import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import getCanonicalModelInstance from "./CanonicalModelInstance";
import Dictionary from "../Dictionary";
import GenericObject from "../GenericObject";
import { JSONObject } from "../JSON";
import { ReflectionMetadataType } from "../Reflection";
import TableColumnType from "./TableColumnType";
import UserAttribution from "./UserAttribution";
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

/*
 * A column that records who did something to its record - `createdByUserId`,
 * `archivedByUser` - is computed whatever its declaration says: OneUptime
 * fills it in, never a write (see UserAttribution).
 */
export default (props: TableColumnMetadata): ReflectionMetadataType => {
  return ((target: GenericObject, propertyKey?: string | symbol): void => {
    Reflect.defineMetadata(
      tableColumn,
      UserAttribution.getColumnMetadata(propertyKey, props),
      target,
      propertyKey as string | symbol,
    );
  }) as ReflectionMetadataType;
};

/*
 * Resolve a lazy modelTypeThunk into modelType on first read, in place.
 *
 * Mutating the singleton rather than returning a copy is deliberate: callers
 * (and the caching layer below) rely on getTableColumn(s) handing back the very
 * same metadata object every time - identity is part of the contract. The write
 * is idempotent (once modelType is set the thunk is never called again) and
 * every module has finished loading by the time any query reads a column, so
 * the thunk resolves to the fully-defined related model.
 */
function resolveModelType(
  metadata: TableColumnMetadata | undefined,
): TableColumnMetadata | undefined {
  if (metadata && !metadata.modelType && metadata.modelTypeThunk) {
    metadata.modelType = metadata.modelTypeThunk();
  }

  return metadata;
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
 * Per-class cache, keyed on the constructor and built from a canonical
 * instance of that class - never from the instance that happened to ask
 * first. A caller that had deleted a column off its own instance (BaseAPI's
 * create path used to delete `_id`) would otherwise define the class's column
 * list without that column for the whole process, and every response for that
 * model would lose it. See CanonicalModelInstance.ts.
 */
const tableColumnsCache: WeakMap<
  { new (): BaseModel },
  Dictionary<TableColumnMetadata>
> = new WeakMap();

/*
 * The column dictionary of `target`'s class, and whether it is the one
 * cached for the class. Never handed out as is: getTableColumns copies it,
 * and getTableColumnNames reads lists from it.
 */
function readTableColumns<T extends BaseModel>(
  target: T,
): { dictionary: Dictionary<TableColumnMetadata>; isClassCache: boolean } {
  const modelClass: { new (): BaseModel } = target.constructor as {
    new (): BaseModel;
  };
  const cached: Dictionary<TableColumnMetadata> | undefined =
    tableColumnsCache.get(modelClass);

  if (cached) {
    return { dictionary: cached, isClassCache: true };
  }

  const canonical: T | null = getCanonicalModelInstance(target);
  const metadataSource: T = canonical || target;
  const dictonary: Dictionary<TableColumnMetadata> = {};
  const keys: Array<string> = Object.keys(metadataSource);

  for (const key of keys) {
    const metadata: TableColumnMetadata | undefined = Reflect.getMetadata(
      tableColumn,
      metadataSource,
      key,
    ) as TableColumnMetadata | undefined;
    if (metadata) {
      dictonary[key] = resolveModelType(metadata) as TableColumnMetadata;
    }
  }

  /*
   * No canonical instance (see CanonicalModelInstance): answer from the
   * instance we were handed, but do NOT cache it for the class - that
   * instance may be a mutilated one, and a cached answer outlives it.
   */
  if (canonical) {
    tableColumnsCache.set(modelClass, dictonary);
  }

  return { dictionary: dictonary, isClassCache: Boolean(canonical) };
}

export const getTableColumns: GetTableColumnsFunction = <T extends BaseModel>(
  target: T,
): Dictionary<TableColumnMetadata> => {
  /*
   * Hand out a copy, not the cached dictionary itself: callers mutate the
   * result (the API reference docs delete entries from it), which would
   * otherwise strip columns from every later call for the same class.
   */
  return { ...readTableColumns(target).dictionary };
};

/*
 * The names of a model's columns, all of them and the encrypted, hashed,
 * unique and required ones, in the order getTableColumns lists them. Read
 * only: callers copy a list before they hand it on (the model's
 * get...Columns methods do).
 *
 * Every row a read returns asks for its encrypted columns (decrypt), and
 * every read asks for the column list a few times over. Each of those used
 * to copy the class's whole dictionary - about 150 entries for a monitor -
 * and walk it; the lists are now made once per class, from the dictionary
 * cached for it, and never for an answer that is not cached (no canonical
 * instance, see readTableColumns).
 */
export interface TableColumnNames {
  all: ReadonlyArray<string>;
  encrypted: ReadonlyArray<string>;
  hashed: ReadonlyArray<string>;
  unique: ReadonlyArray<string>;
  required: ReadonlyArray<string>;
}

const tableColumnNamesCache: WeakMap<
  Dictionary<TableColumnMetadata>,
  TableColumnNames
> = new WeakMap();

function namesOf(
  dictionary: Dictionary<TableColumnMetadata>,
): TableColumnNames {
  const all: Array<string> = [];
  const encrypted: Array<string> = [];
  const hashed: Array<string> = [];
  const unique: Array<string> = [];
  const required: Array<string> = [];

  for (const key in dictionary) {
    all.push(key);

    const metadata: TableColumnMetadata | undefined = dictionary[key];

    if (metadata?.encrypted) {
      encrypted.push(key);
    }

    if (metadata?.hashed) {
      hashed.push(key);
    }

    if (metadata?.unique) {
      unique.push(key);
    }

    if (metadata?.required) {
      required.push(key);
    }
  }

  return { all, encrypted, hashed, unique, required };
}

export const getTableColumnNames: <T extends BaseModel>(
  target: T,
) => TableColumnNames = <T extends BaseModel>(target: T): TableColumnNames => {
  const read: {
    dictionary: Dictionary<TableColumnMetadata>;
    isClassCache: boolean;
  } = readTableColumns(target);

  if (!read.isClassCache) {
    return namesOf(read.dictionary);
  }

  let names: TableColumnNames | undefined = tableColumnNamesCache.get(
    read.dictionary,
  );

  if (!names) {
    names = namesOf(read.dictionary);
    tableColumnNamesCache.set(read.dictionary, names);
  }

  return names;
};

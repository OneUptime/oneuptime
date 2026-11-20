import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import getCanonicalModelInstance from "./CanonicalModelInstance";
import Dictionary from "../Dictionary";
import GenericObject from "../GenericObject";
import { JSONObject } from "../JSON";
import { getWordOfMeaningKey } from "../MeaningKeys";
import { ReflectionMetadataType } from "../Reflection";
import ServerOwned from "./ServerOwned";
import TableColumnType from "./TableColumnType";
import UserAttribution from "./UserAttribution";
import "reflect-metadata";

const tableColumn: symbol = Symbol("TableColumn");

export interface TableColumnMetadata {
  /*
   * What the column is called: what the API reference, the OpenAPI spec,
   * the Terraform provider and the server's messages name it. A column
   * declared with a key that names its meaning (MeaningKeys: "Table
   * (database object)") is called by its word here, "Table", and keeps
   * the key in titleKey.
   */
  title?: string;
  /*
   * The key a front end looks the title up by, where the column's title
   * names its meaning: "Table (database object)", worded as a database's
   * table in every language - the bare "Table" is a table on the page
   * ("Tableau", 表格). Read it with getColumnTitleKey. Set by the
   * decorator from such a title; never declared (#8344).
   */
  titleKey?: string;
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
  /*
   * For an encrypted JSON column (`encrypted: true`): the fields kept
   * encrypted, in its object or in each object of its list - a discovery
   * scan's SNMP credential sets keep their community strings and v3 keys
   * encrypted, and their names, versions and ports as written. A field that
   * is not text, or is empty, is left as it is, and so is a value of any
   * other shape. Without it, every top-level value of the column's object
   * is encrypted.
   */
  encryptedFields?: Array<string>;
  /*
   * The value lets whoever has it in: a key, a token, a passphrase, a
   * private key, a webhook address. Hashed and encrypted text columns are
   * secrets already; this marks the ones stored as they are, which a
   * caller with the right permission reads back - an API key's value, a
   * probe's key, an incoming request monitor's secret key. The OpenAPI spec
   * says so (x-oneuptime-secret: ModelSchema.isSecretColumn), and the
   * clients published from it keep the value out of what they print:
   * Terraform and OpenTofu mark the attribute Sensitive, so plans, logs
   * and outputs show (sensitive value). Tests/Utils/Schema/SecretColumns
   * holds every column named like a secret to this.
   */
  secret?: boolean;
  /*
   * A secret OneUptime makes, answers once and keeps only as its hash: a
   * project's API key (#8902). The answer to the create that makes the
   * record holds it - and a reset of it, by a route of its own - and
   * nothing reads it back: nobody may read the column (its read access is
   * empty), so it is in no read, list or select schema. The OpenAPI spec
   * puts it in the create's answer alone (<Table>CreatedSchema), marked
   * x-oneuptime-shown-once, and the Terraform and OpenTofu provider keeps
   * it in state from that answer instead of reading it back.
   */
  shownOnce?: boolean;
  /*
   * A key or a token presented TO OneUptime, which the people who may read
   * it see again (#9012): a probe's key in its `docker run` command, a
   * monitor's secret key in its heartbeat URL, a badge's token. It is kept
   * encrypted at rest (it is `encrypted: true` too), so a backup or a
   * database dump holds no working key, and OneUptime checks a key a
   * request presents against it in constant time
   * (Server/Utils/PresentedKey/PresentedKey.matches). The create that makes
   * the record answers it as it was written, never as it is stored. Kept as
   * written before #9012; the PresentedKeys:ProtectAtRest job encrypts the
   * values stored before, a day after the upgrade.
   */
  presentedKey?: boolean;
  /*
   * A presented key that a request names its record by, alone - a monitor's
   * heartbeat URL, a telemetry ingestion key: the column beside it that
   * holds its lookup hash (PresentedKey.hash). A ciphertext differs on every
   * write, so no query can find the key itself; DatabaseService writes this
   * hash with every write of the key, and the record is found by it
   * (DatabaseService.findOneByPresentedKey). The hash column is OneUptime's:
   * nobody reads or writes it through the API.
   */
  lookupHashColumn?: string;
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
  /*
   * The values a text column takes when it takes one of a few - its string
   * enum's: allowedValues: Object.values(CloudProvider). The OpenAPI spec
   * says them as the field's enum (ModelSchema), so the API reference lists
   * them, MCP's tool schemas offer them, and the Terraform and OpenTofu
   * provider refuses any other value at plan time and lists them where the
   * attribute is documented. An example with no value of its own shows the
   * first of them. Saying them changes nothing the server accepts.
   * Tests/Models/ColumnAllowedValues holds every text column typed with a
   * string enum to saying them.
   */
  allowedValues?: ReadonlyArray<string>;
  ordered?: boolean;
  /*
   * The column whose new value a write of this one must carry: the column
   * changes only together with a new value of that one, in the same write.
   * A monitor secret's secretType changes only together with a new
   * secretValue, which the server reads for the new type (#9760): the value
   * it held means something else in the other type. The model's service
   * refuses a write that breaks it (MonitorSecretService), and the OpenAPI
   * spec says it (x-oneuptime-changes-only-with: ModelSchema), so the
   * Terraform and OpenTofu provider refuses, at plan time, a plan that
   * changes this attribute and keeps that one (#9814), instead of an apply
   * that fails half-way. Name a column of the same model that a write may
   * set (Tests/Types/Database/ChangesOnlyWithColumns holds every one to it).
   */
  changesOnlyWith?: string;
  /*
   * OneUptime keeps the column's value once the record exists, or changes
   * it too (ServerOwned): Always - only OneUptime writes it, as a check, a
   * worker or an agent's report does: a heartbeat's time, a count, a flag
   * that says an owner was told; the API takes no value for it from a write
   * that is not OneUptime's own (#10053); AfterCreate - a create may give its
   * first value, and OneUptime moves it on from there: a monitor's current
   * status, an incident's current state; Shared - people set it and
   * OneUptime changes it too: the labels a label rule adds, an exception
   * OneUptime resolves (#10052). The OpenAPI spec says which
   * (x-oneuptime-server-owned: ModelSchema) and leaves an Always column out
   * of the create and update schemas, so the Terraform and Crossplane
   * providers never fight OneUptime over it (#9985).
   * Tests/Types/Database/ServerOwnedColumns holds each declaration to its
   * column's permissions, holds the Shared ones to a list with why (and the
   * columns label, on-call and privacy rules change to it), and catches a
   * new column named like one OneUptime keeps (current...Id, last...At,
   * next...At) that declares nothing.
   */
  serverOwned?: ServerOwned;
}

/*
 * A column declared with a title that names its meaning ("Table (database
 * object)") is called by its word ("Table") wherever it is named as
 * written - the API reference, the OpenAPI spec, the server's messages -
 * and keeps the key a front end looks it up by (titleKey).
 */
export function withTitleAsItsWord<T extends TableColumnMetadata>(
  metadata: T,
): T {
  const word: string | undefined = getWordOfMeaningKey(metadata.title);

  if (word === undefined) {
    return metadata;
  }

  return { ...metadata, title: word, titleKey: metadata.title };
}

/*
 * The key a front end looks a column's title up by: the key its title names
 * its meaning with, or the title itself.
 */
export function getColumnTitleKey(
  metadata: Pick<TableColumnMetadata, "title" | "titleKey"> | undefined | null,
): string | undefined {
  return metadata?.titleKey || metadata?.title;
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
      UserAttribution.getColumnMetadata(propertyKey, withTitleAsItsWord(props)),
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

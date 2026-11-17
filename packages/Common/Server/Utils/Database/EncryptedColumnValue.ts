import Encryption from "../Encryption";
import URL from "../../../Types/API/URL";
import DatabaseProperty from "../../../Types/Database/DatabaseProperty";
import { isEncryptedValue } from "../../../Types/Database/EncryptedValue";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { JSONObject, JSONValue, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Typeof from "../../../Types/Typeof";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

/*
 * ONE COLUMN KEPT ENCRYPTED AT REST, AS IT IS STORED AND AS IT IS READ.
 *
 * DatabaseService encrypts every column marked `encrypted: true` on every
 * write and decrypts it on every read (DatabaseService.encrypt, decrypt),
 * each by its shape:
 *
 *   - Text: the text, encrypted. A token, a password, a community string,
 *     a webhook notification method's address.
 *   - A URL (TableColumnType.ShortURL, LongURL): the text the column's
 *     transformer writes for it (URL.getDatabaseTransformer), encrypted, and
 *     on the way back decrypted before that transformer reads it, so the
 *     record holds a URL again. A Slack, Microsoft Teams or Discord incoming
 *     webhook carries its secret in its path. The column's TypeORM
 *     transformer is getEncryptedDatabaseTransformer, which hands a
 *     ciphertext on untouched: read as a URL, it would be refused on its way
 *     in and taken for a broken address on its way out.
 *   - JSON with `encryptedFields`: those fields of its object, or of each
 *     object of its list, the rest as written - a discovery scan's SNMP
 *     credential sets, whose names, versions and ports stay readable, in the
 *     shape every reader of the list knows. Encrypting the whole value
 *     instead would turn the list into one string: a server still running
 *     the release before, during an upgrade, would read a list that is not
 *     one and sweep with no credentials at all, where it reads a list here
 *     whose secrets it cannot use. Text where an object belongs is
 *     encrypted whole, so no text in such a column is stored as written.
 *   - Other JSON: each top-level value of its object, or of its list.
 *   - An id (TableColumnType.ObjectID): a key presented to OneUptime
 *     kept in an id-typed column, such as a monitor's secret key (#9012),
 *     encrypted as its text. The column's transformer reads the
 *     ciphertext into an ObjectID, which a read decrypts into the key.
 *
 * A stored value that is not our ciphertext reads as it is
 * (isEncryptedValue): it was written before its column was kept encrypted,
 * and its data migration has not reached it yet (EncryptColumnInPlace). So
 * a sender reads a webhook's address, and a probe its device's community
 * string, the same before, during and after the migration.
 *
 * A write never changes what it was given: an object or a list is encrypted
 * into a new one, so a hook holding the value it wrote - and the update's
 * comparison with what the row held (encryptedColumnsAsGiven) - still reads
 * it as written.
 */

/*
 * The type of a URL column's value: a DatabaseProperty, which its
 * transformer writes as text and reads back.
 */
type DatabasePropertyType = Pick<
  typeof DatabaseProperty,
  "getDatabaseTransformer"
>;

const PROPERTY_TYPES: ReadonlyMap<TableColumnType, DatabasePropertyType> =
  new Map<TableColumnType, DatabasePropertyType>([
    [TableColumnType.ShortURL, URL],
    [TableColumnType.LongURL, URL],
  ]);

// The text columns whose value is encrypted as it is.
const TEXT_TYPES: ReadonlyArray<TableColumnType> = [
  TableColumnType.ShortText,
  TableColumnType.LongText,
  TableColumnType.VeryLongText,
];

export default class EncryptedColumnValue {
  /*
   * Whether a column of this type can be kept encrypted: text, JSON, and a
   * URL. Any other type whose value is an object - an email address, a
   * phone number, an id - would be taken apart, and so is not encrypted
   * until this learns it (EncryptedColumnsAreStorable, Common Tests, holds
   * every encrypted column to this).
   */
  public static isStorable(metadata: TableColumnMetadata): boolean {
    return (
      PROPERTY_TYPES.has(metadata.type) ||
      metadata.type === TableColumnType.ObjectID ||
      metadata.type === TableColumnType.JSON ||
      TEXT_TYPES.includes(metadata.type)
    );
  }

  /*
   * The transformer a URL column's text is read and written with, when it
   * is one: what the column's own TypeORM transformer runs for anything that
   * is not a ciphertext (getEncryptedDatabaseTransformer).
   */
  public static getPropertyTransformer(
    metadata: TableColumnMetadata,
  ): ValueTransformer | null {
    return PROPERTY_TYPES.get(metadata.type)?.getDatabaseTransformer() || null;
  }

  /*
   * The text `value` is encrypted as, which DatabaseService holds to its
   * column's length before it encrypts it (assertFitsBeforeEncrypted):
   * text as it is, an id as its text, a URL as the text its transformer
   * writes. Null for a value encrypted otherwise - JSON, field by field or
   * value by value - and for a URL column's ciphertext, handed back as it
   * is stored and stored as it is.
   */
  public static getTextToEncrypt(
    metadata: TableColumnMetadata,
    value: unknown,
  ): string | null {
    if (value instanceof ObjectID) {
      return value.toString();
    }

    const property: ValueTransformer | null =
      EncryptedColumnValue.getPropertyTransformer(metadata);

    if (property) {
      if (isEncryptedValue(value)) {
        return null;
      }

      const written: unknown = property.to(value);

      return typeof written === "string" ? written : null;
    }

    return typeof value === "string" ? value : null;
  }

  // What the column stores for `value`: see the top of this file.
  public static async encrypt(
    metadata: TableColumnMetadata,
    value: unknown,
  ): Promise<unknown> {
    // A key kept in an id-typed column (#9012): its text, encrypted.
    if (metadata.type === TableColumnType.ObjectID) {
      return await Encryption.encrypt((value as ObjectID | string).toString());
    }

    const property: ValueTransformer | null =
      EncryptedColumnValue.getPropertyTransformer(metadata);

    if (property) {
      // Stored already: handed back by a read of the column as it is stored.
      if (isEncryptedValue(value)) {
        return value;
      }

      /*
       * The text the column's transformer writes, so a URL is held to the
       * same rule encrypted or not: one that cannot be read is refused.
       */
      const text: unknown = property.to(value);

      return typeof text === "string" && text
        ? await Encryption.encrypt(text)
        : text;
    }

    if (metadata.type === TableColumnType.JSON && metadata.encryptedFields) {
      return await EncryptedColumnValue.mapFieldsOf(
        value,
        metadata.encryptedFields,
        EncryptedColumnValue.encryptField,
      );
    }

    if (Array.isArray(value)) {
      const stored: Array<unknown> = [];

      for (const entry of value) {
        stored.push(await Encryption.encrypt(entry as string));
      }

      return stored;
    }

    if (typeof value === Typeof.Object) {
      const stored: JSONObject = {};

      for (const key of Object.keys(value as JSONObject)) {
        stored[key] = await Encryption.encrypt(
          (value as JSONObject)[key] as string,
        );
      }

      return stored;
    }

    return await Encryption.encrypt(value as string);
  }

  // What a read hands on for the `stored` value: see the top of this file.
  public static async decrypt(
    metadata: TableColumnMetadata,
    stored: unknown,
  ): Promise<unknown> {
    /*
     * A key kept in an id-typed column (#9012): the column's transformer
     * read the ciphertext into an ObjectID. A key stored before the column
     * was encrypted reads as itself.
     */
    if (stored instanceof ObjectID) {
      const storedText: string = stored.toString();

      return isEncryptedValue(storedText)
        ? new ObjectID(await Encryption.decrypt(storedText))
        : stored;
    }

    const property: ValueTransformer | null =
      EncryptedColumnValue.getPropertyTransformer(metadata);

    if (property) {
      /*
       * A value written before the column was encrypted was read by the
       * column's transformer already, into a URL: it is as it was.
       */
      if (!isEncryptedValue(stored)) {
        return stored;
      }

      return property.from(await Encryption.decrypt(stored));
    }

    if (metadata.type === TableColumnType.JSON && metadata.encryptedFields) {
      return await EncryptedColumnValue.mapFieldsOf(
        stored,
        metadata.encryptedFields,
        EncryptedColumnValue.decryptField,
      );
    }

    if (Array.isArray(stored)) {
      const read: Array<unknown> = [];

      for (const entry of stored) {
        read.push(await EncryptedColumnValue.decryptField(entry));
      }

      return read;
    }

    if (typeof stored === Typeof.Object) {
      const read: JSONObject = { ...(stored as JSONObject) };

      for (const key of Object.keys(read)) {
        read[key] = (await EncryptedColumnValue.decryptField(
          read[key],
        )) as JSONValue;
      }

      return read;
    }

    return await EncryptedColumnValue.decryptField(
      EncryptedColumnValue.unwrapHashedStringEnvelope(stored as string),
    );
  }

  /*
   * A write before #3807 was fixed stored a ciphertext inside a
   * HashedString's envelope: '{"_type":"HashedString","value":"<ciphertext>"}'.
   * Decrypting the envelope itself is not just wrong but random - it carries
   * no OpenSSL salt, so crypto-js derives the key from a fresh random one on
   * every call and returns "" or throws "Malformed UTF-8 data". A ciphertext
   * is base64 and never starts with "{", so the envelope is unambiguous:
   * unwrap it and those rows decrypt without anyone re-entering the secret.
   */
  public static unwrapHashedStringEnvelope(storedValue: string): string {
    if (typeof storedValue !== "string" || !storedValue.startsWith("{")) {
      return storedValue;
    }

    try {
      const parsed: JSONValue = JSON.parse(storedValue);

      if (
        parsed &&
        typeof parsed === Typeof.Object &&
        (parsed as JSONObject)["_type"] === ObjectType.HashedString &&
        typeof (parsed as JSONObject)["value"] === Typeof.String
      ) {
        return (parsed as JSONObject)["value"] as string;
      }
    } catch {
      // Not JSON, so not the envelope.
    }

    return storedValue;
  }

  /*
   * A field's text, encrypted. An empty one, and one that is our ciphertext
   * already - a list read as it is stored and written back - are as they
   * are: a field is never encrypted twice.
   */
  private static async encryptField(value: unknown): Promise<unknown> {
    if (typeof value !== "string" || !value || isEncryptedValue(value)) {
      return value;
    }

    return await Encryption.encrypt(value);
  }

  /*
   * A field as written: a value that is not our ciphertext - one written
   * before the column was encrypted - is left as it is.
   */
  private static async decryptField(value: unknown): Promise<unknown> {
    return isEncryptedValue(value) ? await Encryption.decrypt(value) : value;
  }

  /*
   * `fields` of an object, or of each object of a list, through `map`, into
   * a new object or list. Text where an object belongs - the value, or an
   * entry of its list - goes through `map` whole: whatever its shape, no
   * text in such a column is stored as written. Anything else - a number,
   * null, a list inside the list - is handed back as it is.
   */
  private static async mapFieldsOf(
    value: unknown,
    fields: ReadonlyArray<string>,
    map: (field: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    if (Array.isArray(value)) {
      const entries: Array<unknown> = [];

      for (const entry of value) {
        entries.push(await EncryptedColumnValue.mapFields(entry, fields, map));
      }

      return entries;
    }

    return await EncryptedColumnValue.mapFields(value, fields, map);
  }

  private static async mapFields(
    entry: unknown,
    fields: ReadonlyArray<string>,
    map: (field: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    if (typeof entry === Typeof.String) {
      return await map(entry);
    }

    if (!entry || typeof entry !== Typeof.Object || Array.isArray(entry)) {
      return entry;
    }

    const mapped: Record<string, unknown> = {
      ...(entry as Record<string, unknown>),
    };

    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(mapped, field)) {
        mapped[field] = await map(mapped[field]);
      }
    }

    return mapped;
  }
}

import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * A many-to-one reference reaches a service hook under TWO different keys.
 *
 * The dashboard's forms post the RELATION object - `{ site: { _id: "..." } }`
 * - because DatabaseBaseModel.toJSONObject serialises the entity column it
 * was given (Common/Models/DatabaseModels/DatabaseBaseModel/
 * DatabaseBaseModel.ts) and BaseAPI passes that body through to the service
 * verbatim. Server-side callers, by contrast, write the FK column
 * (`{ siteId: ... }`). onBeforeUpdate/onUpdateSuccess run BEFORE TypeORM
 * resolves one into the other, so a hook that inspects only one spelling
 * silently ignores every write made through the other - which is how a site
 * picked in the UI could skip its tenancy check and its rollup refresh
 * (OneUptime/oneuptime#2940).
 *
 * The two keys are one database column, and when a payload carries both,
 * TypeORM stores the relation's id: the declared column and the relation's
 * join column share one ColumnMetadata, whose getEntityValue reads the
 * relation first and falls back to the column only when the relation holds
 * no object (RelationNamePrecedence.test.ts pins this). So a hook that checks
 * or decides on one of the keys must read both, through readConsistent, which
 * refuses a payload whose keys disagree; and a hook that writes a value of its
 * own writes it with stamp, which leaves no other key to win over it.
 *
 * Give these helpers both spellings, FK column first.
 */
export default class RelationIdUtil {
  // True when the payload writes the reference under any of `keys`.
  public static isWritten(
    dataKeys: Array<string>,
    keys: Array<string>,
  ): boolean {
    return keys.some((key: string) => {
      return dataKeys.includes(key);
    });
  }

  /*
   * True when any of `keys` holds a value - a clear (null) included. Unlike
   * isWritten, this reads the values, so it also answers for a model instance,
   * whose every column is a key of its own whether or not it was set.
   */
  public static isPresent(
    data: Record<string, unknown> | undefined | null,
    keys: Array<string>,
  ): boolean {
    return keys.some((key: string): boolean => {
      return (data || {})[key] !== undefined;
    });
  }

  /*
   * The id the payload points the reference at, or null when it clears the
   * reference (or carries nothing resolvable). Accepts an ObjectID, a plain
   * id string, or a serialised relation carrying `_id` / `id`.
   *
   * The first key that holds an id wins, so with several keys this is not
   * what a check or a decision may read: use readConsistent, which reads
   * every key.
   */
  public static read(
    data: Record<string, unknown> | undefined | null,
    keys: Array<string>,
  ): ObjectID | null {
    for (const key of keys) {
      const value: unknown = (data || {})[key];

      if (!value) {
        continue;
      }

      if (value instanceof ObjectID) {
        return value;
      }

      if (typeof value === "string") {
        return new ObjectID(value);
      }

      const relation: { _id?: unknown; id?: unknown } = value as {
        _id?: unknown;
        id?: unknown;
      };

      const relationId: unknown = relation._id || relation.id;

      if (relationId) {
        return new ObjectID(relationId.toString());
      }
    }

    return null;
  }

  /**
   * Read one logical relation while rejecting payloads that point its scalar
   * FK and relation-object spellings at different rows. TypeORM's precedence
   * for two writes to the same join column is not a security boundary: a hook
   * must validate the exact ID that can be persisted.
   *
   * A key that clears the reference (null, an empty id, a relation object
   * with no id in it) disagrees with a key that names a record: which of the
   * two TypeORM stores depends on the shape of the write, so neither is the
   * answer. The same id under both keys, in any case, is one id.
   */
  public static readConsistent(
    data: Record<string, unknown> | undefined | null,
    keys: Array<string>,
    relationTitle: string,
  ): ObjectID | null {
    let firstId: ObjectID | null = null;
    const distinctIds: Set<string> = new Set();
    const keysSent: Array<string> = [];
    let hasExplicitNull: boolean = false;

    for (const key of keys) {
      const value: unknown = (data || {})[key];

      // Undefined is an omitted model property; null is an explicit clear.
      if (value === undefined) {
        continue;
      }

      keysSent.push(key);

      const id: ObjectID | null = this.read(data, [key]);

      /*
       * Case-blind and trimmed: ObjectID keeps the case it was handed while
       * Postgres compares uuids by value, so one id in two cases is one id.
       */
      const normalizedId: string = id
        ? id.toString().trim().toLowerCase()
        : "";

      if (!normalizedId) {
        hasExplicitNull = true;
        continue;
      }

      distinctIds.add(normalizedId);

      if (!firstId) {
        firstId = id;
      }
    }

    if (distinctIds.size > 1 || (hasExplicitNull && distinctIds.size > 0)) {
      throw new BadDataException(
        RelationIdUtil.getConflictMessage(relationTitle, keysSent),
      );
    }

    return firstId;
  }

  /*
   * The refusal for a payload that names one reference twice, differently:
   * which reference, the keys it came under, and how to send it.
   */
  public static getConflictMessage(
    relationTitle: string,
    keysSent: Array<string>,
  ): string {
    const names: string =
      keysSent.length > 1
        ? `${keysSent.slice(0, -1).join(", ")} and ${keysSent[keysSent.length - 1]}`
        : keysSent.join("");

    return `Conflicting ${relationTitle} references were provided. ${names} are names for the same field and must hold the same value: send only one of them, or the same id in each.`;
  }

  /*
   * Write a reference the server decides itself - a record's starting state,
   * who triggered it - under its ID column (the first key), and remove every
   * other spelling of it from the payload. A relation the caller sent beside
   * the ID column would otherwise be what TypeORM stores, whatever the hook
   * wrote; after this the value written here is the only one there is.
   */
  public static stamp(
    data: Record<string, unknown>,
    keys: Array<string>,
    id: ObjectID | null,
  ): void {
    const [idColumn, ...otherKeys] = keys;

    if (!idColumn) {
      return;
    }

    data[idColumn] = id;

    for (const key of otherKeys) {
      delete data[key];
    }
  }
}

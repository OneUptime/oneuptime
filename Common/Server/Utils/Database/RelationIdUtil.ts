import ObjectID from "../../../Types/ObjectID";

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
   * The id the payload points the reference at, or null when it clears the
   * reference (or carries nothing resolvable). Accepts an ObjectID, a plain
   * id string, or a serialised relation carrying `_id` / `id`.
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
}

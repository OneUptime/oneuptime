import ObjectID from "../../../Types/ObjectID";

/*
 * A relation (Entity / EntityArray) value reaches the write path in several
 * shapes: a model instance, a plain `{ _id }` object from a request body, a
 * bare id string, or an ObjectID. A model instance and a plain object both
 * stringify to "[object Object]", so a comparison through toString() cannot
 * tell one set of related rows from another. These helpers reduce every shape
 * to the ids it refers to - the only thing that identifies a relation.
 */

const ID_KEYS: ReadonlyArray<string> = ["_id", "id"];

export default class RelationValueUtil {
  /*
   * The id a single relation value refers to, or null when it carries none
   * (null, an unsaved model, an object that is not a reference).
   */
  public static getRelationId(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (value instanceof ObjectID || typeof value === "string") {
      const id: string = value.toString();
      return id.length > 0 ? id : null;
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const record: Record<string, unknown> = value as Record<string, unknown>;

    for (const key of ID_KEYS) {
      const candidate: unknown = record[key];

      if (candidate instanceof ObjectID || typeof candidate === "string") {
        const id: string = candidate.toString();

        if (id.length > 0) {
          return id;
        }
      }
    }

    return null;
  }

  /*
   * The sorted, de-duplicated ids a relation value refers to: every element
   * of a many-to-many value, or the single id of a many-to-one value. Ids are
   * compared case-insensitively, as Postgres compares uuids.
   *
   * Null when the value cannot be compared by id - it is absent (not loaded,
   * or cleared to null) or holds an element that is not a reference - so a
   * caller can fall back to its own comparison instead of guessing.
   */
  public static getRelationIdSet(value: unknown): Array<string> | null {
    if (value === null || value === undefined) {
      return null;
    }

    const elements: Array<unknown> = Array.isArray(value) ? value : [value];
    const ids: Set<string> = new Set<string>();

    for (const element of elements) {
      const id: string | null = RelationValueUtil.getRelationId(element);

      if (!id) {
        return null;
      }

      ids.add(id.toLowerCase());
    }

    return Array.from(ids).sort();
  }

  /*
   * Whether two relation values refer to the same rows, ignoring order and
   * duplicates: the order a relation array comes back in carries no meaning.
   * Null when either side cannot be compared by id (see getRelationIdSet).
   */
  public static haveSameRelationIds(
    current: unknown,
    updated: unknown,
  ): boolean | null {
    const currentIds: Array<string> | null =
      RelationValueUtil.getRelationIdSet(current);
    const updatedIds: Array<string> | null =
      RelationValueUtil.getRelationIdSet(updated);

    if (!currentIds || !updatedIds) {
      return null;
    }

    if (currentIds.length !== updatedIds.length) {
      return false;
    }

    return currentIds.every((id: string, index: number): boolean => {
      return id === updatedIds[index];
    });
  }
}

import ObjectID from "../../../Types/ObjectID";
import RelationValueUtil from "./RelationValueUtil";

/*
 * Whether an update points a many-to-one reference of a record - an
 * incident's severity, say - at a different record than the one it held.
 *
 * Updates often write back the reference a record already holds: a dashboard
 * card sends every field it shows with each save, and an API client or a
 * workflow may write the whole record. What follows from a change - a feed
 * entry, a recalculation, a metric point - must follow a real one. So a
 * service reads what each record holds before the write (in onBeforeUpdate,
 * once, and only when the update writes the reference), reads what the
 * update writes under both names of the reference
 * (RelationIdUtil.readConsistent), and compares the two here.
 *
 * A many-to-many list - an incident's labels, say - is compared the same
 * way, as the set of records it names (isListChanged).
 */
export default class ReferenceChange {
  /*
   * One id however it was spelled: trimmed and lower-cased, as Postgres
   * compares uuids by value. Null for no id.
   */
  public static normalize(
    id: ObjectID | string | null | undefined,
  ): string | null {
    const value: string = id ? id.toString().trim().toLowerCase() : "";

    return value || null;
  }

  /*
   * True when the update writes an id that is not the one the record held
   * before the write.
   *
   * - An update that writes no id - it leaves the reference out, or clears
   *   it - points it at no record, so this is false.
   * - A record that held none gets one: true.
   * - A record the read before the write did not see (idBeforeUpdate is
   *   undefined: it matched the update only when it was written) counts as
   *   changed, so a real change is never missed.
   */
  public static isChanged(data: {
    writtenId: ObjectID | string | null | undefined;
    idBeforeUpdate: ObjectID | string | null | undefined;
  }): boolean {
    const writtenId: string | null = this.normalize(data.writtenId);

    if (!writtenId) {
      return false;
    }

    return writtenId !== this.normalize(data.idBeforeUpdate);
  }

  /*
   * The records a many-to-many list names, however each was spelled - a
   * model, a `{ _id }` object, an ObjectID or a bare id - normalized as
   * above, without repeats and sorted, so two lists naming the same records
   * read the same. A list cleared to null names none, as [] does: TypeORM
   * empties a many-to-many list set to either. An entry with no id names no
   * record, so it is left out.
   */
  public static normalizeList(list: unknown): Array<string> {
    if (list === undefined || list === null) {
      return [];
    }

    const ids: Set<string> = new Set<string>();

    for (const entry of Array.isArray(list) ? list : [list]) {
      const id: string | null = this.normalize(
        RelationValueUtil.getRelationId(entry),
      );

      if (id) {
        ids.add(id);
      }
    }

    return Array.from(ids).sort();
  }

  /*
   * True when an update that writes a many-to-many list leaves the record
   * holding other records than it held before the write. The order of a
   * list, and an id repeated in it, mean nothing.
   *
   * - An update that leaves the list out (undefined) writes nothing, so
   *   this is false.
   * - A list written as [] or null empties it: a change only for a record
   *   that held some.
   * - A record the read before the write did not see (idsBeforeUpdate is
   *   undefined) counts as changed, so a real change is never missed.
   */
  public static isListChanged(data: {
    writtenList: unknown;
    idsBeforeUpdate: Array<ObjectID | string> | undefined;
  }): boolean {
    if (data.writtenList === undefined) {
      return false;
    }

    if (data.idsBeforeUpdate === undefined) {
      return true;
    }

    const writtenIds: Array<string> = this.normalizeList(data.writtenList);
    const idsBeforeUpdate: Array<string> = this.normalizeList(
      data.idsBeforeUpdate,
    );

    return (
      writtenIds.length !== idsBeforeUpdate.length ||
      writtenIds.some((id: string, index: number): boolean => {
        return id !== idsBeforeUpdate[index];
      })
    );
  }
}

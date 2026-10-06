import ObjectID from "../../../Types/ObjectID";

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
}

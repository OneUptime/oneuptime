import OldestKeyCursor from "./OldestKeyCursor";

/*
 * A Map that answers its oldest key - the first in insertion order - in
 * constant time, however much it has churned: for a bounded cache that
 * evicts its oldest entry when it is full.
 *
 * Such a cache used to evict with map.keys().next(). V8 leaves a deleted
 * entry's slot in the map's table until it compacts the table, and a new
 * iterator starts at the first slot, so in a cache that evicts from the
 * front on every write each keys().next() walked past every slot evicted
 * since the last compaction: 10 to 14 microseconds a write in a full cache
 * of 10,000 to 50,000 entries. oldestKey() keeps one iterator instead
 * (OldestKeyCursor), and answers the same key.
 *
 * It keeps the iterator only while that is safe. An iterator keeps the table
 * it was made on alive, with every value that table held, chained to each
 * table the map is rebuilt into after it, until it next moves - so one kept
 * across changes that do not move it holds on to values the map has
 * deleted or replaced since (300 MB after a million writes and deletes of
 * half-kilobyte values, 2026-10-27). This map lets the iterator go on every
 * change that removes or replaces a value - a delete, a write over a key it
 * has, clear() - except deleting the key oldestKey() just answered (an
 * eviction, which moves the iterator onto the current table). Adding a new
 * key keeps it: nothing the map held is let go of meanwhile, and the next
 * eviction moves it. So a full cache that evicts on every write never walks
 * past a deleted slot, and a cache that also deletes or rewrites keys costs
 * what keys().next() did, and holds on to nothing it let go of.
 *
 * The key oldestKey() answers is meant to be deleted next. Asked again
 * before that, it answers the same key.
 *
 * Use it as a Map: everything else is the Map's own. Tests/Utils/OldestKeyMap
 * holds it to keys().next()'s answers and to letting go of what it deletes;
 * Tests/Utils/OldestKeyEvictionGuard keeps keys().next() eviction out of the
 * product.
 */
export default class OldestKeyMap<K, V> extends Map<K, V> {
  private readonly cursor: OldestKeyCursor<K>;
  // The key oldestKey() answered and nobody has deleted yet.
  private handedOut: { key: K } | null = null;

  public constructor() {
    super();
    this.cursor = new OldestKeyCursor<K>(this);
  }

  /*
   * The oldest key, for its caller to delete; undefined when the map is
   * empty.
   */
  public oldestKey(): K | undefined {
    if (this.handedOut && super.has(this.handedOut.key)) {
      // Answered before and still here: that key again, from the start.
      this.cursor.reset();
    }

    const key: K | undefined = this.cursor.takeOldest();

    this.handedOut = key === undefined ? null : { key: key };

    return key;
  }

  public override set(key: K, value: V): this {
    const sizeBefore: number = super.size;

    super.set(key, value);

    if (super.size === sizeBefore) {
      // A value replaced: the iterator must not keep the one let go of.
      this.letGo();
    }

    return this;
  }

  public override delete(key: K): boolean {
    const isEviction: boolean =
      this.handedOut !== null && this.handedOut.key === key;
    const deleted: boolean = super.delete(key);

    if (isEviction) {
      this.handedOut = null;
    } else if (deleted) {
      this.letGo();
    }

    return deleted;
  }

  public override clear(): void {
    super.clear();
    this.letGo();
  }

  private letGo(): void {
    this.cursor.reset();
    this.handedOut = null;
  }
}

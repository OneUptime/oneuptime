/*
 * The oldest key of a Map - the first in insertion order - in constant time,
 * however much the map has churned.
 *
 * A bounded cache that keeps its entries in a Map evicts its oldest entry with
 * map.keys().next() when it is full. V8 leaves a deleted entry's slot in the
 * map's table until the table is compacted, and a new iterator starts at the
 * table's first slot, so in a cache that evicts from the front on every write
 * each keys().next() walks past every slot evicted since the last compaction:
 * 10 to 14 microseconds a write in a full cache of 10,000 to 50,000 entries,
 * against under one here (measured 2026-10-27, Node 26).
 *
 * This keeps one iterator instead. A Map iterator is live: it skips entries
 * deleted after it was made and reaches entries added after it, in insertion
 * order. Every entry before it has been handed out as the oldest (and
 * evicted) or deleted, and new entries are only ever added at the end, so the
 * next live entry it reaches is the oldest live entry of the map - what
 * keys().next() would have answered. A finished iterator stays finished, so
 * one that ran out is replaced with a fresh one.
 *
 * The key it answers is meant to be deleted: asked twice without deleting it,
 * it answers the next one.
 *
 * Keep it only while it moves. V8 rebuilds a map's table as entries come and
 * go, and an iterator keeps the table it was made on alive, with every entry
 * that table held, chained to each table after it, until it next moves. A
 * cursor kept across changes that do not move it - writes that evict nothing,
 * deletes, a sweep - holds on to everything the map stored meanwhile: 300 MB
 * after a million writes and deletes of half-kilobyte values (measured
 * 2026-10-27, Node 26). So its owner calls reset() after every change to the
 * map other than deleting the key it was just handed (InMemoryTTLCache does),
 * and the cursor lives only from one eviction to the next.
 */
export default class OldestKeyCursor<K> {
  private readonly map: Map<K, unknown>;
  private cursor: Iterator<K> | null = null;

  public constructor(map: Map<K, unknown>) {
    this.map = map;
  }

  /*
   * The map's oldest live key, for its caller to delete; undefined when the
   * map is empty.
   */
  public takeOldest(): K | undefined {
    for (let attempt: number = 0; attempt < 2; attempt++) {
      if (!this.cursor) {
        this.cursor = this.map.keys();
      }

      const next: IteratorResult<K> = this.cursor.next();

      if (!next.done) {
        return next.value;
      }

      // A finished iterator never sees entries added after it finished.
      this.cursor = null;
    }

    return undefined;
  }

  /*
   * Lets go of the iterator: the next takeOldest starts again from the
   * map's first entry. Call it after any change to the map other than
   * deleting the key just handed out (see above).
   */
  public reset(): void {
    this.cursor = null;
  }
}

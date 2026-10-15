/*
 * THE ANSWERS OF RECENT ATTRIBUTE VALUE LOOKUPS, KEPT FOR A FEW MINUTES
 * (issue #4708).
 *
 * The value picker behind `@key:` in the explorers' search bars, the chart
 * editors' value boxes and a dashboard's variable dropdowns all ask
 * TelemetryAttributeService for the values seen under one attribute key. The
 * same question comes back often: a reader picks a value and types the same
 * key again, a colleague opens the same explorer, a public dashboard is
 * opened by many viewers at once. This holds each answer for five minutes, so
 * asking again costs nothing, and remembers a lookup that ran out of time for
 * a minute, so a key whose lookup the database could not finish is not sent
 * to it again and again while it is busy.
 *
 * The caller builds the key from everything that decides the answer (the
 * project, the signal, the table, the metric, the caller's read scope, the
 * window, the attribute key and the search text), so one project's or one
 * scope's values are never served to another.
 *
 * In this process only, and bounded twice over: by the number of answers and
 * by the characters they hold, the oldest unused answer making room first. A
 * value list is at most 100 values of at most 1,000 characters, so the budget
 * holds hundreds of typical answers and never grows past it.
 */

export interface AttributeValueSuggestionCacheOptions {
  maxEntries: number;
  // The characters of every key and value held, together.
  maxCharacters: number;
  answerTtlInMs: number;
  stoppedTtlInMs: number;
  // The clock, in milliseconds. Tests move it; everyone else uses Date.now.
  now?: (() => number) | undefined;
}

export type AttributeValueSuggestionCacheEntry =
  | { kind: "values"; values: Array<string> }
  | { kind: "stopped" };

interface StoredEntry {
  entry: AttributeValueSuggestionCacheEntry;
  expiresAt: number;
  characters: number;
}

export default class AttributeValueSuggestionCache {
  private readonly options: AttributeValueSuggestionCacheOptions;
  // Map keeps insertion order: the first entry is the one used longest ago.
  private readonly entries: Map<string, StoredEntry> = new Map();
  private characters: number = 0;

  public constructor(options: AttributeValueSuggestionCacheOptions) {
    this.options = options;
  }

  /*
   * The answer held for `key`, or undefined. A copy of the values, so a
   * caller that sorts or trims its answer does not change the next one's.
   */
  public get(key: string): AttributeValueSuggestionCacheEntry | undefined {
    const stored: StoredEntry | undefined = this.entries.get(key);

    if (!stored) {
      return undefined;
    }

    if (this.now() >= stored.expiresAt) {
      this.remove(key);
      return undefined;
    }

    // Used again: it is the newest now.
    this.entries.delete(key);
    this.entries.set(key, stored);

    if (stored.entry.kind === "values") {
      return { kind: "values", values: [...stored.entry.values] };
    }

    return { kind: "stopped" };
  }

  public setValues(key: string, values: Array<string>): void {
    this.store(
      key,
      { kind: "values", values: [...values] },
      this.options.answerTtlInMs,
    );
  }

  // The lookup for `key` ran out of time: remember that, briefly.
  public setStopped(key: string): void {
    this.store(key, { kind: "stopped" }, this.options.stoppedTtlInMs);
  }

  public clear(): void {
    this.entries.clear();
    this.characters = 0;
  }

  public get size(): number {
    return this.entries.size;
  }

  public get heldCharacters(): number {
    return this.characters;
  }

  private store(
    key: string,
    entry: AttributeValueSuggestionCacheEntry,
    ttlInMs: number,
  ): void {
    const characters: number =
      key.length + AttributeValueSuggestionCache.charactersOf(entry);

    this.remove(key);

    // An answer bigger than the whole budget is not kept at all.
    if (characters > this.options.maxCharacters) {
      return;
    }

    while (
      this.entries.size > 0 &&
      (this.entries.size >= this.options.maxEntries ||
        this.characters + characters > this.options.maxCharacters)
    ) {
      const oldest: string = this.entries.keys().next().value as string;
      this.remove(oldest);
    }

    this.entries.set(key, {
      entry: entry,
      expiresAt: this.now() + ttlInMs,
      characters: characters,
    });
    this.characters += characters;
  }

  private remove(key: string): void {
    const stored: StoredEntry | undefined = this.entries.get(key);

    if (!stored) {
      return;
    }

    this.entries.delete(key);
    this.characters -= stored.characters;
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private static charactersOf(
    entry: AttributeValueSuggestionCacheEntry,
  ): number {
    if (entry.kind !== "values") {
      return 0;
    }

    let characters: number = 0;

    for (const value of entry.values) {
      characters += value.length;
    }

    return characters;
  }
}

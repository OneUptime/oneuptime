import GenericObject from "../../../Types/GenericObject";

/*
 * READING WHAT A BULK ACTION NEEDS, A WINDOW AT A TIME.
 *
 * Some bulk actions read each item fresh before they write it: the state an
 * alert is in now (an alert already resolved is left alone, and says so),
 * the labels a monitor has now (so adding one keeps the others). One read
 * per item doubled the requests of a run - 4,594 alerts were 9,188 requests.
 *
 * This reads them a window at a time instead: the first item of a window
 * that a run asks about reads the whole window in one list request, and the
 * window's other items wait for that same request. A run works through its
 * items in order, so each window is read just before its items are written,
 * and what a step sees is seconds old at most - and the server still checks
 * every write against what it holds.
 *
 * A window whose read fails reads its items one by one (readOne), so one
 * failed request costs speed, not items. Without readOne, each of the
 * window's items fails with the read's error.
 */

// Items per window: one list request each.
export const BULK_READ_WINDOW_SIZE: number = 50;

/*
 * Ids compared as Postgres compares uuids: by value, whatever case or
 * padding they came in.
 */
const normalizeKey: (key: string) => string = (key: string): string => {
  return key.trim().toLowerCase();
};

export interface BulkReadAheadOptions<T extends GenericObject, R> {
  items: Array<T>;
  // The id a read answers with, to match an answer to its item.
  getKey: (item: T) => string;
  /*
   * Reads one window's items, answering with what it found by key. An item
   * the answer leaves out was not found (deleted since, or out of reach):
   * read() answers null for it.
   */
  readWindow: (items: Array<T>) => Promise<Map<string, R>>;
  // Reads one item, when its window's read failed.
  readOne?: ((item: T) => Promise<R | null>) | undefined;
  windowSize?: number | undefined;
}

type WindowRead<R> =
  | { ok: true; found: Map<string, R> }
  | { ok: false; error: unknown };

export default class BulkReadAhead<T extends GenericObject, R> {
  private readonly options: BulkReadAheadOptions<T, R>;
  private readonly windowSize: number;
  // Where each key first appears among the items.
  private readonly indexByKey: Map<string, number> = new Map<string, number>();
  private readonly windows: Map<number, Promise<WindowRead<R>>> = new Map<
    number,
    Promise<WindowRead<R>>
  >();

  public constructor(options: BulkReadAheadOptions<T, R>) {
    this.options = options;

    const size: number = Math.floor(
      options.windowSize ?? BULK_READ_WINDOW_SIZE,
    );
    this.windowSize = Number.isFinite(size) && size >= 1 ? size : 1;

    options.items.forEach((item: T, index: number) => {
      const key: string = normalizeKey(options.getKey(item));

      if (key && !this.indexByKey.has(key)) {
        this.indexByKey.set(key, index);
      }
    });
  }

  // How many list requests the windows read so far took.
  public get windowsRead(): number {
    return this.windows.size;
  }

  /*
   * What the read found for this item, or null when it found nothing. Throws
   * the read's error when the window's read failed and there is no readOne.
   */
  public async read(item: T): Promise<R | null> {
    const key: string = normalizeKey(this.options.getKey(item));
    const index: number | undefined = key
      ? this.indexByKey.get(key)
      : undefined;

    // An item that is not one of the run's own is read alone.
    if (index === undefined) {
      return await this.readAlone(item, undefined);
    }

    const windowIndex: number = Math.floor(index / this.windowSize);
    const windowRead: WindowRead<R> = await this.getWindow(windowIndex);

    if (!windowRead.ok) {
      return await this.readAlone(item, windowRead.error);
    }

    return windowRead.found.has(key) ? windowRead.found.get(key)! : null;
  }

  private async readAlone(item: T, windowError: unknown): Promise<R | null> {
    if (this.options.readOne) {
      return await this.options.readOne(item);
    }

    if (windowError !== undefined) {
      throw windowError;
    }

    return null;
  }

  private getWindow(windowIndex: number): Promise<WindowRead<R>> {
    const existing: Promise<WindowRead<R>> | undefined =
      this.windows.get(windowIndex);

    if (existing) {
      return existing;
    }

    const start: number = windowIndex * this.windowSize;
    const windowItems: Array<T> = [];
    const keysInWindow: Set<string> = new Set<string>();

    // Each key once, as the window holds it first.
    for (const item of this.options.items.slice(
      start,
      start + this.windowSize,
    )) {
      const key: string = normalizeKey(this.options.getKey(item));

      if (!key || keysInWindow.has(key)) {
        continue;
      }

      keysInWindow.add(key);
      windowItems.push(item);
    }

    const read: Promise<WindowRead<R>> = this.options
      .readWindow(windowItems)
      .then((answer: Map<string, R>): WindowRead<R> => {
        const found: Map<string, R> = new Map<string, R>();

        for (const [key, value] of answer.entries()) {
          found.set(normalizeKey(key), value);
        }

        return { ok: true, found: found };
      })
      .catch((error: unknown): WindowRead<R> => {
        return { ok: false, error: error };
      });

    this.windows.set(windowIndex, read);

    return read;
  }
}

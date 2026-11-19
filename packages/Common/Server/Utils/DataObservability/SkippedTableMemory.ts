import crypto from "crypto";
import {
  getSkippedTableWaitInMinutes,
  MAX_SKIPPED_TABLE_REASON_LENGTH,
  MAX_SKIPPED_TABLES,
  SkippedTable,
  SkippedTableRead,
  SkippedTables,
} from "../../../Types/DataObservability/SkippedTables";

/*
 * WHAT ONE COLLECTION DOES WITH THE TABLES A DATABASE KEEPS REFUSING (#9541).
 *
 * Handed what the store remembered (SkippedTables), it says, for each table
 * and read, whether the collection asks as before, skips it (its next try
 * has not come) or asks it on its own (its next try has come). It writes
 * down what the collection learns: a table refused again waits twice as
 * long, a table that answers is forgotten, a table no longer watched is
 * dropped. A collection that sees another environment table list, or
 * another app reading it, than the one remembered starts every table over:
 * whatever was refused may read now.
 *
 * A refusal is remembered only when it is a table's own: the table was
 * asked alone (never a group of tables whose read failed as a whole), and
 * the same read answered for another table in the same collection, so the
 * read itself works. A count that failed for every table is an outage of
 * the count, and nothing is skipped for it.
 */

function keyOf(table: string, read: SkippedTableRead): string {
  return `${read}\u0000${table}`;
}

// A fingerprint of what could change a database's answers, from the parts given, in their order.
export function fingerprintOf(parts: Array<string>): string {
  return crypto.createHash("sha256").update(parts.join("\n")).digest("hex");
}

export default class SkippedTableMemory {
  // Whether the remembered tables were started over: the table list or the app changed.
  public readonly isStartedOver: boolean;
  private readonly now: Date;
  private readonly fingerprint: string;
  private readonly entries: Map<string, SkippedTable> = new Map();

  public constructor(data: {
    previous: SkippedTables | null | undefined;
    /*
     * The fingerprint this collection sees; null when it cannot see the
     * whole table list (a list read in smaller requests), which then
     * changes nothing remembered.
     */
    fingerprint: string | null;
    now: Date;
  }) {
    const previous: SkippedTables | null = data.previous || null;
    const keeps: boolean =
      previous !== null &&
      (data.fingerprint === null || previous.fingerprint === data.fingerprint);

    this.now = data.now;
    this.fingerprint = data.fingerprint ?? previous?.fingerprint ?? "";
    this.isStartedOver = previous !== null && !keeps;

    if (previous && keeps) {
      for (const table of previous.tables) {
        this.entries.set(keyOf(table.table, table.read), { ...table });
      }
    }
  }

  // Whether the table's read was refused before, whether or not its next try has come.
  public isRemembered(table: string, read: SkippedTableRead): boolean {
    return this.entries.has(keyOf(table, read));
  }

  // Whether the collection skips the table's read: refused before, and its next try has not come.
  public isWaiting(table: string, read: SkippedTableRead): boolean {
    const entry: SkippedTable | undefined = this.entries.get(
      keyOf(table, read),
    );

    return (
      entry !== undefined && Date.parse(entry.nextTryAt) > this.now.getTime()
    );
  }

  // Whether the collection asks the table's read on its own: refused before, and its next try has come.
  public isDue(table: string, read: SkippedTableRead): boolean {
    return this.isRemembered(table, read) && !this.isWaiting(table, read);
  }

  /*
   * The table's read was refused again, or for the first time: it waits
   * twice as long as the last time before it is asked again.
   */
  public refused(table: string, read: SkippedTableRead, reason: string): void {
    const previous: SkippedTable | undefined = this.entries.get(
      keyOf(table, read),
    );
    const refusals: number = (previous?.refusals || 0) + 1;

    this.entries.set(keyOf(table, read), {
      table,
      read,
      reason: reason.slice(0, MAX_SKIPPED_TABLE_REASON_LENGTH),
      since: previous?.since || this.now.toISOString(),
      refusals,
      nextTryAt: new Date(
        this.now.getTime() + getSkippedTableWaitInMinutes(refusals) * 60_000,
      ).toISOString(),
    });
  }

  // The table's read answered: it is asked as every other table is.
  public answered(table: string, read: SkippedTableRead): void {
    this.entries.delete(keyOf(table, read));
  }

  // Forgets the read of every table not in the list: no longer watched, or no longer read so.
  public keepOnly(read: SkippedTableRead, tables: Array<string>): void {
    const kept: Set<string> = new Set(tables);

    for (const [key, entry] of Array.from(this.entries.entries())) {
      if (entry.read === read && !kept.has(entry.table)) {
        this.entries.delete(key);
      }
    }
  }

  // The tables whose read the collection skips this time, in table order.
  public waiting(read?: SkippedTableRead | undefined): Array<SkippedTable> {
    return this.list().filter((entry: SkippedTable): boolean => {
      return (
        (read === undefined || entry.read === read) &&
        this.isWaiting(entry.table, entry.read)
      );
    });
  }

  // What the store keeps after this collection; null when no table is skipped.
  public toSkippedTables(): SkippedTables | null {
    const tables: Array<SkippedTable> = this.list().slice(
      0,
      MAX_SKIPPED_TABLES,
    );

    return tables.length > 0 ? { fingerprint: this.fingerprint, tables } : null;
  }

  private list(): Array<SkippedTable> {
    return Array.from(this.entries.values()).sort(
      (a: SkippedTable, b: SkippedTable): number => {
        if (a.table !== b.table) {
          return a.table < b.table ? -1 : 1;
        }

        return a.read < b.read ? -1 : a.read > b.read ? 1 : 0;
      },
    );
  }
}

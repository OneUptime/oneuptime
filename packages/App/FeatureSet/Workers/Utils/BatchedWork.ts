import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";

/*
 * HOW A SCHEDULED JOB GOES THROUGH A LOT OF ROWS ON A SLOW DATABASE.
 *
 * Jobs used to read every row they had to look at - all of them, in OFFSET
 * pages - and then start the work of every row at once. In an alert storm
 * that was thousands of queries at the same moment on a pool of fifty
 * connections, and sign-ins and dashboards waited behind them. And a job
 * that read "the first 1,000" re-read the same first 1,000 every run, never
 * reaching the rest.
 *
 * So a job reads a page at a time, each page after the last row of the one
 * before (forEachKeysetPage): an id cursor never skips or repeats a row
 * when the job's own writes change which rows match, and a page costs the
 * same at the end of the table as at the start. And it works through a
 * page a few rows at a time (forEachWithConcurrency): never more than a
 * handful of rows' queries in flight. Both stop at the job's deadline.
 */

export interface KeysetPagesResult {
  pages: number;
  rows: number;
  // Whether the job's deadline stopped it before the last page.
  stoppedAtDeadline: boolean;
}

/*
 * Reads rows a page at a time, in _id order, each page after the last id
 * of the one before, and hands each page to `onPage`, until a page comes
 * back short or the deadline passes. `readPage` must sort by _id ascending
 * and return only rows after `afterId` (all rows when it is null).
 */
export async function forEachKeysetPage<TRow>(data: {
  jobName: string;
  pageSize: number;
  deadline?: JobDeadline | undefined;
  readPage: (afterId: ObjectID | null) => Promise<Array<TRow>>;
  getId: (row: TRow) => ObjectID | null | undefined;
  onPage: (rows: Array<TRow>) => Promise<void>;
}): Promise<KeysetPagesResult> {
  const result: KeysetPagesResult = {
    pages: 0,
    rows: 0,
    stoppedAtDeadline: false,
  };

  let afterId: ObjectID | null = null;

  for (;;) {
    if (data.deadline?.hasPassed()) {
      result.stoppedAtDeadline = true;
      return result;
    }

    const rows: Array<TRow> = await data.readPage(afterId);

    if (rows.length === 0) {
      return result;
    }

    const lastId: ObjectID | null | undefined = data.getId(
      rows[rows.length - 1]!,
    );

    /*
     * A page that does not move the cursor on would be read again for
     * ever: a readPage that forgot its sort or its cursor.
     */
    if (
      !lastId ||
      (afterId !== null && lastId.toString() <= afterId.toString())
    ) {
      throw new Error(
        `${data.jobName}: a page of rows did not move its id cursor on.`,
      );
    }

    afterId = lastId;
    result.pages++;
    result.rows += rows.length;

    await data.onPage(rows);

    if (rows.length < data.pageSize) {
      return result;
    }
  }
}

export interface ConcurrencyResult {
  started: number;
  failed: number;
  // Items never started because the deadline passed.
  skippedAtDeadline: number;
}

/*
 * Runs `work` for each item with never more than `concurrency` running at
 * once. One item's failure is logged (or handed to onError) and never stops
 * the others. Once the deadline passes no more items start; those running
 * finish.
 */
export async function forEachWithConcurrency<TItem>(data: {
  items: Array<TItem>;
  concurrency: number;
  deadline?: JobDeadline | undefined;
  work: (item: TItem) => Promise<void>;
  onError?: ((item: TItem, error: unknown) => void) | undefined;
}): Promise<ConcurrencyResult> {
  const result: ConcurrencyResult = {
    started: 0,
    failed: 0,
    skippedAtDeadline: 0,
  };

  let next: number = 0;

  const worker: () => Promise<void> = async (): Promise<void> => {
    while (next < data.items.length) {
      if (data.deadline?.hasPassed()) {
        return;
      }

      const item: TItem = data.items[next]!;
      next++;
      result.started++;

      try {
        await data.work(item);
      } catch (error) {
        result.failed++;

        if (data.onError) {
          data.onError(item, error);
        } else {
          logger.error(error);
        }
      }
    }
  };

  const workers: Array<Promise<void>> = [];
  const workerCount: number = Math.min(
    Math.max(1, Math.floor(data.concurrency)),
    data.items.length,
  );

  for (let count: number = 0; count < workerCount; count++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  result.skippedAtDeadline = data.items.length - result.started;

  return result;
}

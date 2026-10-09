import GenericObject from "../../../Types/GenericObject";
import API from "../../Utils/API/API";
import {
  BulkActionFailed,
  BulkActionOnClickProps,
  BulkActionUnchanged,
} from "./BulkUpdateForm";

/*
 * The per-item loop every bulk action runs, in one place.
 *
 * Each item ends in exactly one of three lists, which is what the progress
 * modal shows (BulkUpdateForm):
 *
 *   - changed:   the step resolved (with nothing, or CHANGED);
 *   - unchanged: the step looked at the item and left it alone on purpose,
 *                and says why - a device nothing polls, one already in the
 *                state asked for;
 *   - failed:    the step threw. The message is the server's, through
 *                API.getFriendlyMessage, so a refused permission or a
 *                validation error is reported in the words that explain it.
 *
 * The lists are always reported in the order the items were selected, not
 * the order they finished in, so a result read twice reads the same.
 */

export enum BulkItemStatus {
  Changed = "changed",
  Unchanged = "unchanged",
}

export type BulkItemOutcome =
  | { status: BulkItemStatus.Changed }
  | { status: BulkItemStatus.Unchanged; reason: string };

export const BULK_ITEM_CHANGED: BulkItemOutcome = {
  status: BulkItemStatus.Changed,
};

export function bulkItemUnchanged(reason: string): BulkItemOutcome {
  return {
    status: BulkItemStatus.Unchanged,
    reason: reason,
  };
}

export interface BulkActionRunResult<T extends GenericObject> {
  changed: Array<T>;
  unchanged: Array<BulkActionUnchanged<T>>;
  failed: Array<BulkActionFailed<T>>;
}

export interface RunBulkActionOptions<T extends GenericObject> {
  actionProps: BulkActionOnClickProps<T>;
  /*
   * What to do to one item. Resolving with nothing means it was changed.
   * Throwing means it failed, and the error's message is what the result
   * shows against it.
   */
  step: (item: T) => Promise<BulkItemOutcome | void>;
  /*
   * How many items are worked on at once. One unless the caller knows its
   * writes are independent of each other: a write whose server-side effects
   * read shared state (a site's health rollup, a plan's monitor count) has to
   * see the previous write finished, so those run one at a time.
   */
  concurrency?: number | undefined;
}

type ItemResult<T extends GenericObject> =
  | { kind: "changed" }
  | { kind: "unchanged"; entry: BulkActionUnchanged<T> }
  | { kind: "failed"; entry: BulkActionFailed<T> };

export async function runBulkAction<T extends GenericObject>(
  options: RunBulkActionOptions<T>,
): Promise<BulkActionRunResult<T>> {
  const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
    options.actionProps;

  const totalItems: Array<T> = [...items];
  const results: Array<ItemResult<T> | undefined> = totalItems.map(() => {
    return undefined;
  });

  const concurrency: number = Math.max(
    1,
    Math.floor(options.concurrency || 1),
  );

  type CollectFunction = () => BulkActionRunResult<T> & {
    inProgress: Array<T>;
  };

  // Rebuilt from the results array each time, so the lists keep selection order.
  const collect: CollectFunction = (): BulkActionRunResult<T> & {
    inProgress: Array<T>;
  } => {
    const changed: Array<T> = [];
    const unchanged: Array<BulkActionUnchanged<T>> = [];
    const failed: Array<BulkActionFailed<T>> = [];
    const inProgress: Array<T> = [];

    totalItems.forEach((item: T, index: number) => {
      const result: ItemResult<T> | undefined = results[index];

      if (!result) {
        inProgress.push(item);
        return;
      }

      if (result.kind === "changed") {
        changed.push(item);
      } else if (result.kind === "unchanged") {
        unchanged.push(result.entry);
      } else {
        failed.push(result.entry);
      }
    });

    return { changed, unchanged, failed, inProgress };
  };

  type RunOneFunction = (index: number) => Promise<void>;

  const runOne: RunOneFunction = async (index: number): Promise<void> => {
    const item: T = totalItems[index]!;

    try {
      const outcome: BulkItemOutcome | void = await options.step(item);

      results[index] =
        outcome && outcome.status === BulkItemStatus.Unchanged
          ? {
              kind: "unchanged",
              entry: { item: item, reason: outcome.reason },
            }
          : { kind: "changed" };
    } catch (err) {
      results[index] = {
        kind: "failed",
        entry: { item: item, failedMessage: API.getFriendlyMessage(err) },
      };
    }

    const snapshot: BulkActionRunResult<T> & { inProgress: Array<T> } =
      collect();

    onProgressInfo({
      totalItems: totalItems,
      successItems: snapshot.changed,
      failed: snapshot.failed,
      unchanged: snapshot.unchanged,
      inProgressItems: snapshot.inProgress,
    });
  };

  onBulkActionStart();

  try {
    let nextIndex: number = 0;

    type WorkerFunction = () => Promise<void>;

    // Each worker takes the next item as soon as it is free.
    const worker: WorkerFunction = async (): Promise<void> => {
      while (nextIndex < totalItems.length) {
        const index: number = nextIndex;
        nextIndex += 1;
        await runOne(index);
      }
    };

    const workers: Array<Promise<void>> = [];

    for (let i: number = 0; i < Math.min(concurrency, totalItems.length); i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
  } finally {
    onBulkActionEnd();
  }

  const finalSnapshot: BulkActionRunResult<T> & { inProgress: Array<T> } =
    collect();

  return {
    changed: finalSnapshot.changed,
    unchanged: finalSnapshot.unchanged,
    failed: finalSnapshot.failed,
  };
}

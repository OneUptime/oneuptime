import { AsyncLocalStorage } from "async_hooks";

/**
 * Ambient context that makes ClickHouse inserts idempotent across queue
 * retries. The telemetry queue worker wraps each job in
 * `runWithInsertDedup(jobId, ...)`; token consumers then derive
 * `insert_deduplication_token = "<tokenBase>:<table>:<chunkIndex>"`, so a
 * stalled-job recovery or attempts-based retry that re-processes the same
 * payload re-issues byte-identical tokens and ClickHouse drops the duplicate
 * blocks (on replicated tables; on plain MergeTree the token is ignored
 * unless non_replicated_deduplication_window is set — no harm either way).
 * The chunk counter is per table because one job inserts into several tables
 * (e.g. Span + ExceptionInstance) in a deterministic order.
 *
 * Two consumers exist:
 * - AnalyticsDatabaseService.insertJsonRows stamps direct inserts that run
 *   inside the context without an explicit token.
 * - TelemetryFanInWriter captures a token per submission AT SUBMIT TIME
 *   (still inside the job's context) so cross-job batching downstream can
 *   preserve per-job retry idempotence.
 */
export interface InsertDedupContextStore {
  tokenBase: string;
  chunkIndexByTable: Map<string, number>;
}

const insertDedupContext: AsyncLocalStorage<InsertDedupContextStore> =
  new AsyncLocalStorage<InsertDedupContextStore>();

export function runWithInsertDedup<T>(
  tokenBase: string,
  fn: () => Promise<T>,
): Promise<T> {
  return insertDedupContext.run(
    { tokenBase, chunkIndexByTable: new Map<string, number>() },
    fn,
  );
}

/**
 * Consume the next deterministic dedup token for `tableName` from the
 * ambient context, or undefined when called outside a runWithInsertDedup
 * scope. Consuming advances the per-table chunk counter, so calls must
 * happen in a deterministic order relative to the payload — true for the
 * ingest services, whose chunking is a pure function of the (byte-identical
 * across retries) job body.
 */
export function nextInsertDedupToken(tableName: string): string | undefined {
  const store: InsertDedupContextStore | undefined =
    insertDedupContext.getStore();

  if (!store) {
    return undefined;
  }

  const chunkIndex: number = store.chunkIndexByTable.get(tableName) ?? 0;
  store.chunkIndexByTable.set(tableName, chunkIndex + 1);
  return `${store.tokenBase}:${tableName}:${chunkIndex}`;
}

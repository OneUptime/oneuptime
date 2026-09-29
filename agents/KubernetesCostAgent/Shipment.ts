import { createHash } from "crypto";
import { KubernetesCostAllocationIngestRow } from "./Types";

/*
 * Shipment identity.
 *
 * One window's rows are POSTed in several chunks, and each chunk becomes an
 * independent ingest job server-side. The server has to accept every chunk of
 * the shipment it is currently ingesting while still dropping a window that
 * an earlier shipment already delivered — otherwise a restart, which re-ships
 * the last LOOKBACK_WINDOWS windows, double-counts spend.
 *
 * The discriminator is a hash over the window's row IDENTITIES (not their
 * costs). That makes it:
 *
 *   - stable across restarts, so a re-ship of an already-delivered window is
 *     recognised as the same shipment and dedups chunk by chunk rather than
 *     landing twice;
 *   - stable across a partial failure, so the retry of a window whose third
 *     chunk failed tops up only that chunk;
 *   - different when the engine's answer for the window actually changed, in
 *     which case the server keeps what it already stored rather than mixing
 *     two versions of the same hour.
 *
 * Costs are deliberately excluded: an engine that re-prices a settled window
 * must not make the shipment look new, and "first delivery wins" is the
 * pricing the server already had.
 */

/*
 * The identity of one allocation row. The engine reports at most one row per
 * (window, namespace, controller, pod, container) — node and provider are
 * properties of that slice, not part of what makes it unique. NUL joins the
 * parts so a name containing the separator cannot forge a different identity.
 */
const rowIdentity: (row: KubernetesCostAllocationIngestRow) => string = (
  row: KubernetesCostAllocationIngestRow,
): string => {
  return [
    row.windowStart,
    row.windowEnd,
    row.namespace || "",
    row.controllerKind || "",
    row.controllerName || "",
    row.podName || "",
    row.containerName || "",
  ].join("\u0000");
};

export interface Shipment {
  /** Content hash of the window, shared by every chunk of this delivery. */
  id: string;
  /**
   * The same rows in a deterministic order. Chunk boundaries are taken from
   * this order, so chunk N of a re-shipped window holds the same rows it held
   * the first time — which is what makes per-chunk dedup meaningful.
   */
  rows: Array<KubernetesCostAllocationIngestRow>;
}

export const buildShipment: (
  rows: Array<KubernetesCostAllocationIngestRow>,
) => Shipment = (rows: Array<KubernetesCostAllocationIngestRow>): Shipment => {
  const identified: Array<{
    key: string;
    row: KubernetesCostAllocationIngestRow;
  }> = rows.map(
    (
      row: KubernetesCostAllocationIngestRow,
    ): { key: string; row: KubernetesCostAllocationIngestRow } => {
      return { key: rowIdentity(row), row: row };
    },
  );

  /*
   * Plain codepoint ordering, not localeCompare: the sort has to produce the
   * same sequence on every machine and under every locale, or the chunk
   * boundaries move and the hash stops matching.
   */
  identified.sort(
    (
      a: { key: string; row: KubernetesCostAllocationIngestRow },
      b: { key: string; row: KubernetesCostAllocationIngestRow },
    ): number => {
      if (a.key < b.key) {
        return -1;
      }
      if (a.key > b.key) {
        return 1;
      }
      return 0;
    },
  );

  const hash: ReturnType<typeof createHash> = createHash("sha256");
  for (const entry of identified) {
    hash.update(entry.key);
    hash.update("\n");
  }

  return {
    // 128 bits is far more than enough to tell two deliveries apart.
    id: hash.digest("hex").slice(0, 32),
    rows: identified.map(
      (entry: {
        key: string;
        row: KubernetesCostAllocationIngestRow;
      }): KubernetesCostAllocationIngestRow => {
        return entry.row;
      },
    ),
  };
};

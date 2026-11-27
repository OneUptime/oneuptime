import {
  XCP_NG_BACKUP_FIRST_READ_LOOKBACK_MS,
  XCP_NG_BACKUP_PENDING_GIVE_UP_MS,
  XCP_NG_MAX_BACKUP_RUNS_PER_COLLECTION,
  XCP_NG_MAX_BACKUP_RUNS_PER_JOB_PER_READ,
  XCP_NG_MAX_TRACKED_BACKUP_RUNS,
  XcpNgBackupWatermark,
  XcpNgTrackedBackupRun,
} from "../../Types/XcpNg/XcpNgPoolEvents";
import { XoBackupLogSummary } from "./XenOrchestraRest";

/*
 * ------------------------------------------------------------------
 * Which backup runs a read delivers, and where the next one starts - pure
 * ------------------------------------------------------------------
 *
 * Xen Orchestra keeps a log per backup run (/rest/v0/backup-logs), pending
 * while it runs and success, failure, skipped or interrupted once it ends.
 * OneUptime delivers each finished run once, whatever restarts in between:
 * the server keeps the watermark (XcpNgBackupWatermark) and hands it to
 * whichever probe reads the Xen Orchestra next.
 *
 * One read:
 *
 *   1. the runs that started at or after `readSince`, and the runs the
 *      watermark tracks by id (still pending, or finished and not yet
 *      delivered), summaries only;
 *   2. of the finished runs not delivered, each job's newest
 *      XCP_NG_MAX_BACKUP_RUNS_PER_JOB_PER_READ are kept and the older ones
 *      passed over - an hourly job back from a day's outage delivers its
 *      last five runs, not 24 - and at most
 *      XCP_NG_MAX_BACKUP_RUNS_PER_COLLECTION of those, oldest first, are
 *      read in full and delivered, the rest the next minute;
 *   3. `readSince` moves to the newest run read, and what is still pending
 *      or waiting is tracked by id.
 *
 * The first read (no watermark) looks XCP_NG_BACKUP_FIRST_READ_LOOKBACK_MS
 * back, so each job's last runs are on the pool's Backups card from the
 * first minute. A run Xen Orchestra still calls pending after
 * XCP_NG_BACKUP_PENDING_GIVE_UP_MS is not waited for any more.
 * ------------------------------------------------------------------
 */

export interface XcpNgBackupReadPlan {
  // Read in full and delivered, oldest first.
  toFetch: Array<XoBackupLogSummary>;
  // Delivered without being read: older than their job's newest few.
  passedOver: Array<XoBackupLogSummary>;
}

// Where this read starts: the watermark's, or the first read's lookback.
export function getXcpNgBackupReadSince(data: {
  watermark?: XcpNgBackupWatermark | undefined;
  nowMs: number;
}): number {
  if (data.watermark && Number.isFinite(data.watermark.readSince)) {
    return Math.max(0, data.watermark.readSince);
  }
  return Math.max(0, data.nowMs - XCP_NG_BACKUP_FIRST_READ_LOOKBACK_MS);
}

// The run ids the watermark follows, which this read asks about by id.
export function getXcpNgTrackedBackupRunIds(
  watermark: XcpNgBackupWatermark | undefined,
): Array<string> {
  return (watermark?.trackedRuns || [])
    .map((run: XcpNgTrackedBackupRun): string => {
      return run.runId;
    })
    .filter((runId: string, index: number, all: Array<string>): boolean => {
      return Boolean(runId) && all.indexOf(runId) === index;
    });
}

// One summary per run, the latest word on it kept (a finished one wins).
export function mergeXcpNgBackupSummaries(
  ...lists: Array<Array<XoBackupLogSummary>>
): Array<XoBackupLogSummary> {
  const byId: Map<string, XoBackupLogSummary> = new Map();

  for (const list of lists) {
    for (const summary of list) {
      const known: XoBackupLogSummary | undefined = byId.get(summary.id);
      if (
        !known ||
        (known.status === "pending" && summary.status !== "pending")
      ) {
        byId.set(summary.id, summary);
      }
    }
  }

  return Array.from(byId.values()).sort(
    (left: XoBackupLogSummary, right: XoBackupLogSummary): number => {
      return left.start - right.start || (left.id < right.id ? -1 : 1);
    },
  );
}

export function planXcpNgBackupRead(data: {
  watermark?: XcpNgBackupWatermark | undefined;
  // Every run read this time: since readSince, and the tracked ones.
  summaries: Array<XoBackupLogSummary>;
  maxRuns?: number | undefined;
  maxRunsPerJob?: number | undefined;
}): XcpNgBackupReadPlan {
  const delivered: Set<string> = new Set<string>(
    data.watermark?.deliveredRunIds || [],
  );
  const maxRuns: number = Math.max(
    1,
    data.maxRuns ?? XCP_NG_MAX_BACKUP_RUNS_PER_COLLECTION,
  );
  const maxRunsPerJob: number = Math.max(
    1,
    data.maxRunsPerJob ?? XCP_NG_MAX_BACKUP_RUNS_PER_JOB_PER_READ,
  );

  const waiting: Array<XoBackupLogSummary> = mergeXcpNgBackupSummaries(
    data.summaries,
  ).filter((summary: XoBackupLogSummary): boolean => {
    return summary.status !== "pending" && !delivered.has(summary.id);
  });

  // Each job's newest few; the rest are passed over.
  const byJob: Map<string, Array<XoBackupLogSummary>> = new Map();
  for (const summary of waiting) {
    let list: Array<XoBackupLogSummary> | undefined = byJob.get(summary.jobId);
    if (!list) {
      list = [];
      byJob.set(summary.jobId, list);
    }
    list.push(summary);
  }

  const kept: Array<XoBackupLogSummary> = [];
  const passedOver: Array<XoBackupLogSummary> = [];

  for (const list of byJob.values()) {
    // Oldest first: the newest few are the last ones.
    const cut: number = Math.max(0, list.length - maxRunsPerJob);
    passedOver.push(...list.slice(0, cut));
    kept.push(...list.slice(cut));
  }

  kept.sort((left: XoBackupLogSummary, right: XoBackupLogSummary): number => {
    return left.start - right.start || (left.id < right.id ? -1 : 1);
  });

  return {
    toFetch: kept.slice(0, maxRuns),
    passedOver: passedOver,
  };
}

/*
 * The watermark after a read. `deliveredRunIds` are the runs this read
 * delivered (read in full, and passed over); a run whose full log could not
 * be read stays waiting, and is read again next time.
 */
export function advanceXcpNgBackupWatermark(data: {
  watermark?: XcpNgBackupWatermark | undefined;
  summaries: Array<XoBackupLogSummary>;
  deliveredRunIds: Array<string>;
  nowMs: number;
}): XcpNgBackupWatermark {
  const readSince: number = getXcpNgBackupReadSince({
    watermark: data.watermark,
    nowMs: data.nowMs,
  });
  const delivered: Set<string> = new Set<string>([
    ...(data.watermark?.deliveredRunIds || []),
    ...data.deliveredRunIds,
  ]);
  const summaries: Array<XoBackupLogSummary> = mergeXcpNgBackupSummaries(
    data.summaries,
  );

  // The newest run read is where the next read starts.
  let newest: number = readSince;
  for (const summary of summaries) {
    if (summary.start > newest) {
      newest = summary.start;
    }
  }

  /*
   * With nothing read at all, no run started since `readSince`, so the
   * read may start as late as the first read's lookback: a Xen Orchestra
   * with no backups for months does not keep asking from the day it was
   * connected.
   */
  if (summaries.length === 0) {
    newest = Math.max(
      readSince,
      data.nowMs - XCP_NG_BACKUP_FIRST_READ_LOOKBACK_MS,
    );
  }

  const giveUpBefore: number = data.nowMs - XCP_NG_BACKUP_PENDING_GIVE_UP_MS;

  /*
   * Every run read and not delivered - still pending, or finished and
   * waiting its turn - is followed by its id, but a run pending for longer
   * than the give-up time is not waited for any more.
   */
  const tracked: Array<XcpNgTrackedBackupRun> = [];
  for (const summary of summaries) {
    if (delivered.has(summary.id)) {
      continue;
    }
    if (summary.status === "pending" && summary.start < giveUpBefore) {
      continue;
    }
    tracked.push({ runId: summary.id, start: summary.start });
  }

  // A tracked run Xen Orchestra no longer lists is let go of after the give-up time.
  const listed: Set<string> = new Set<string>(
    summaries.map((summary: XoBackupLogSummary): string => {
      return summary.id;
    }),
  );
  for (const run of data.watermark?.trackedRuns || []) {
    if (
      !listed.has(run.runId) &&
      !delivered.has(run.runId) &&
      run.start >= giveUpBefore &&
      !tracked.some((entry: XcpNgTrackedBackupRun): boolean => {
        return entry.runId === run.runId;
      })
    ) {
      tracked.push({ runId: run.runId, start: run.start });
    }
  }

  tracked.sort(
    (left: XcpNgTrackedBackupRun, right: XcpNgTrackedBackupRun): number => {
      return left.start - right.start;
    },
  );

  const deliveredRunIds: Array<string> = summaries
    .filter((summary: XoBackupLogSummary): boolean => {
      return summary.start >= newest && delivered.has(summary.id);
    })
    .map((summary: XoBackupLogSummary): string => {
      return summary.id;
    });

  return {
    readSince: newest,
    deliveredRunIds: deliveredRunIds,
    // The newest are kept: an old one beyond the bound is the least likely to matter.
    trackedRuns: tracked.slice(
      Math.max(0, tracked.length - XCP_NG_MAX_TRACKED_BACKUP_RUNS),
    ),
  };
}

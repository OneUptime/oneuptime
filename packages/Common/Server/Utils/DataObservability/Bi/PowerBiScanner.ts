import { JSONObject } from "../../../../Types/JSON";
import BiRequestError from "./BiRequestError";

/*
 * POWER BI'S METADATA SCAN OF A TENANT'S WORKSPACES (#9552).
 *
 * Microsoft's scanner APIs, as its "Run metadata scanning" guide runs them:
 *
 *  1. admin/workspaces/modified lists the workspaces to scan: every one of
 *     the tenant's, or with modifiedSince only those changed since then.
 *     Power BI takes a modifiedSince from 30 minutes (a change takes that
 *     long to be noted) to 30 days back, and 30 requests an hour.
 *  2. admin/workspaces/getInfo starts a scan of at most 100 workspaces: 500
 *     an hour, and at most 16 at once - a scan counts until its status has
 *     said it succeeded or failed.
 *  3. admin/workspaces/scanStatus/{id} says how it goes. Microsoft
 *     recommends asking every 30 to 60 seconds; a small scan is done in
 *     seconds, so the first asks come sooner (3, 5, 10 and 20 seconds), then
 *     every 30 seconds, until the read's wait runs out: twenty minutes for
 *     the hourly read, four for a read someone is waiting on.
 *  4. admin/workspaces/scanResult/{id} is the scan, for 24 hours.
 *
 * A request Power BI turns down for too many (429) is asked again after
 * the wait its Retry-After names - a minute at most, three times at most -
 * and a longer wait leaves the rest for the next read: every scan not yet
 * started is left too, rather than turned down one by one.
 *
 * A scan that fails leaves its workspaces unscanned, with Power BI's
 * reason; the reader scans them again next time (PowerBiReadState), and
 * keeps what it read of them before.
 *
 * A scan still running when the read stops waiting is not given up on
 * (#9697): Power BI goes on with it, and keeps its result for 24 hours. The
 * read keeps its id, and the next read picks it up - its status asked
 * first, before any new scan starts, then its result read once it
 * succeeded - instead of scanning its workspaces again, which in a tenant
 * whose scans outlast the wait would start every hour a scan that is never
 * read. A scan picked up still counts toward the 16 Power BI runs at once
 * until it ends, so it is followed in the same pool as the read's own. One
 * whose workspaces the read scans anew (they changed again) is followed
 * only until it ends, its result unread. One that failed, or that Power BI
 * no longer has, has its workspaces scanned anew in the same read; one too
 * old for its result to be kept is not asked about (PowerBiReadState).
 */

// What the scanner asks Power BI, through the tool's own requests.
export interface PowerBiScannerApi {
  get(path: string): Promise<unknown>;
  post(path: string, body: JSONObject): Promise<unknown>;
}

// Each dataset's lineage, its data sources, its tables and the queries behind them.
export const POWER_BI_SCAN_QUERY: string =
  "lineage=True&datasourceDetails=True&datasetSchema=True&datasetExpressions=True";

// The most workspaces one scan takes, and the most scans Power BI runs at once for a caller.
export const MAX_WORKSPACES_PER_SCAN: number = 100;
export const MAX_SIMULTANEOUS_SCANS: number = 16;

// The waits before each ask of a scan's status: sooner first, then every 30 seconds.
export const POWER_BI_SCAN_POLL_DELAYS_IN_MS: ReadonlyArray<number> = [
  3_000, 5_000, 10_000, 20_000, 30_000,
];

// How long a read waits for its scans: the hourly read, and one someone is waiting on.
export const POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS: number = 20 * 60 * 1000;
export const POWER_BI_ASKED_SCAN_WAIT_IN_MS: number = 4 * 60 * 1000;

// The longest wait a 429's Retry-After is waited out for, and how many times.
export const MAX_POWER_BI_RETRY_WAIT_IN_MS: number = 60 * 1000;
export const MAX_POWER_BI_RETRIES: number = 3;
// The wait for a 429 that names none.
export const POWER_BI_RETRY_WAIT_IN_MS: number = 30 * 1000;

const MAX_ID_LENGTH: number = 100;
const MAX_REASON_LENGTH: number = 300;

export interface PowerBiScanChunk {
  workspaceIds: Array<string>;
  result: JSONObject;
}

export interface PowerBiUnscanned {
  workspaceIds: Array<string>;
  reason: string;
}

/*
 * A scan the read stopped waiting for, kept so the next read picks it up
 * (#9697): its id, the workspaces it is to give - those no later scan was
 * started for - and when it started (ISO), as Power BI keeps its result for
 * 24 hours.
 */
export interface PowerBiPendingScan {
  scanId: string;
  workspaceIds: Array<string>;
  startedAt: string;
}

/*
 * What became of one of a read's scans: its result; why it gave none - it
 * failed, or never started - so its workspaces are scanned anew; or that it
 * was still running when the read stopped waiting.
 */
export type PowerBiScanOutcome =
  | ({ kind: "scanned" } & PowerBiScanChunk)
  | ({ kind: "unscanned" } & PowerBiUnscanned)
  | ({ kind: "running" } & PowerBiPendingScan);

export interface PowerBiScanRun {
  /*
   * Every scan's outcome, in the order the scans started: those picked up
   * first, then the read's own. Of two that name a workspace, the later is
   * the newer.
   */
  outcomes: Array<PowerBiScanOutcome>;
  // The same, by what became of them, each in that order.
  scanned: Array<PowerBiScanChunk>;
  unscanned: Array<PowerBiUnscanned>;
  running: Array<PowerBiPendingScan>;
}

export interface PowerBiScanTiming {
  // Waits as long as asked; replaced in tests.
  wait: (ms: number) => Promise<void>;
  // The time now, in milliseconds; replaced in tests.
  clock: () => number;
}

function readText(value: unknown, maxLength: number = MAX_ID_LENGTH): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().slice(0, maxLength)
    : "";
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_REASON_LENGTH,
  );
}

function minutes(ms: number): string {
  const count: number = Math.max(1, Math.round(ms / 60_000));

  return `${count} ${count === 1 ? "minute" : "minutes"}`;
}

// A scan whose status said it failed, with Power BI's reason: its workspaces are scanned anew.
export class PowerBiScanFailedError extends Error {
  public constructor(reason: string) {
    super(`Power BI's workspace scan failed${reason ? `: ${reason}` : "."}`);
    this.name = "PowerBiScanFailedError";
  }
}

// Power BI asked to wait longer than a read waits: the rest is left for the next read.
export class PowerBiLimitError extends Error {
  public constructor(retryAfterMs: number | undefined) {
    super(
      `Power BI asked for fewer requests${retryAfterMs ? ` for ${minutes(retryAfterMs)}` : ""} (its scanner takes 500 scans an hour, and 30 lists of workspaces); the next read goes on.`,
    );
    this.name = "PowerBiLimitError";
  }
}

/*
 * A request, asked again after the wait a 429 names, a minute at most and
 * three times at most; a longer wait is a PowerBiLimitError.
 */
export async function askPowerBi<T>(
  request: () => Promise<T>,
  timing: Pick<PowerBiScanTiming, "wait">,
): Promise<T> {
  for (let retry: number = 0; ; retry++) {
    try {
      return await request();
    } catch (error) {
      if (!(error instanceof BiRequestError) || error.statusCode !== 429) {
        throw error;
      }

      const waitMs: number = error.retryAfterMs ?? POWER_BI_RETRY_WAIT_IN_MS;

      if (
        retry >= MAX_POWER_BI_RETRIES ||
        waitMs > MAX_POWER_BI_RETRY_WAIT_IN_MS
      ) {
        throw new PowerBiLimitError(error.retryAfterMs);
      }

      await timing.wait(waitMs);
    }
  }
}

/*
 * The workspaces to scan, by id: every one of the tenant's but personal
 * ones, or those changed since `modifiedSince`.
 */
export async function listPowerBiWorkspaces(data: {
  api: PowerBiScannerApi;
  modifiedSince: Date | null;
  timing: Pick<PowerBiScanTiming, "wait">;
}): Promise<Array<string>> {
  const query: string = [
    "excludePersonalWorkspaces=true",
    ...(data.modifiedSince
      ? [
          `modifiedSince=${encodeURIComponent(data.modifiedSince.toISOString())}`,
        ]
      : []),
  ].join("&");
  const listed: unknown = await askPowerBi((): Promise<unknown> => {
    return data.api.get(`/admin/workspaces/modified?${query}`);
  }, data.timing);

  return Array.from(
    new Set(
      readArray(listed)
        .map((value: unknown): string => {
          return readText(readObject(value)["id"]).toLowerCase();
        })
        .filter(Boolean),
    ),
  );
}

/*
 * What a read could not scan, in a warning: how many workspaces, the first
 * reason Power BI gave, and that the next read scans them again; null when
 * every scan worked.
 */
export function describeUnscannedWorkspaces(
  unscanned: Array<PowerBiUnscanned>,
): string | null {
  const count: number = unscanned.reduce(
    (total: number, entry: PowerBiUnscanned): number => {
      return total + entry.workspaceIds.length;
    },
    0,
  );

  if (count === 0) {
    return null;
  }

  return count === 1
    ? `1 workspace was not scanned this time: ${unscanned[0]!.reason} The next read scans it again, and until then it shows what was read before.`
    : `${count} workspaces were not scanned this time: ${unscanned[0]!.reason} The next read scans them again, and until then they show what was read before.`;
}

/*
 * The scans still running when the read stopped waiting, in a warning: how
 * many workspaces, and that the next read reads them once Power BI has
 * finished, rather than scanning them again; null when none was. A read
 * with nothing read before has nothing to show until then.
 */
export function describeRunningScans(
  running: Array<PowerBiPendingScan>,
  waitInMs: number,
  options: { isFirstRead?: boolean | undefined } = {},
): string | null {
  const count: number = running.reduce(
    (total: number, scan: PowerBiPendingScan): number => {
      return total + scan.workspaceIds.length;
    },
    0,
  );

  if (count === 0) {
    return null;
  }

  const stillScanning: string = `Power BI was still scanning ${count === 1 ? "1 workspace" : `${count} workspaces`} when the read stopped waiting after ${minutes(waitInMs)}.`;

  if (options.isFirstRead) {
    return `${stillScanning} The next read reads ${count === 1 ? "that scan once Power BI has finished it" : "those scans once Power BI has finished them"}, rather than scanning again.`;
  }

  return count === 1
    ? `${stillScanning} The next read reads that scan once Power BI has finished it, and until then the workspace shows what was read before.`
    : `${stillScanning} The next read reads those scans once Power BI has finished them, and until then the workspaces show what was read before.`;
}

/*
 * What a read's scans leave for the next read, by each workspace's newest
 * scan: the workspaces to scan anew, with why, and the scans to pick up,
 * each with only the workspaces no later scan was started for.
 */
export function settlePowerBiScans(outcomes: Array<PowerBiScanOutcome>): {
  unscanned: Array<PowerBiUnscanned>;
  running: Array<PowerBiPendingScan>;
} {
  const newest: Map<string, number> = new Map();

  outcomes.forEach((outcome: PowerBiScanOutcome, index: number) => {
    for (const id of outcome.workspaceIds) {
      newest.set(id, index);
    }
  });

  const unscanned: Array<PowerBiUnscanned> = [];
  const running: Array<PowerBiPendingScan> = [];

  outcomes.forEach((outcome: PowerBiScanOutcome, index: number) => {
    const own: Array<string> = Array.from(new Set(outcome.workspaceIds)).filter(
      (id: string): boolean => {
        return newest.get(id) === index;
      },
    );

    if (own.length === 0) {
      return;
    }

    if (outcome.kind === "unscanned") {
      unscanned.push({ workspaceIds: own, reason: outcome.reason });
    } else if (outcome.kind === "running") {
      running.push({
        scanId: outcome.scanId,
        workspaceIds: own,
        startedAt: outcome.startedAt,
      });
    }
  });

  return { unscanned, running };
}

// The workspaces in scans of at most MAX_WORKSPACES_PER_SCAN.
export function chunkWorkspaces(
  workspaceIds: Array<string>,
): Array<Array<string>> {
  const chunks: Array<Array<string>> = [];

  for (
    let start: number = 0;
    start < workspaceIds.length;
    start += MAX_WORKSPACES_PER_SCAN
  ) {
    chunks.push(workspaceIds.slice(start, start + MAX_WORKSPACES_PER_SCAN));
  }

  return chunks;
}

// The waits before each ask of a picked-up scan's status: at once, then every 30 seconds.
export const PICKED_UP_SCAN_POLL_DELAYS_IN_MS: ReadonlyArray<number> = [
  0, 30_000,
];

/*
 * An answer that says Power BI does not have the scan, or will not give
 * it: its status said it failed, or a request about it was refused (a
 * 4xx). A 5xx, or no answer, says nothing of the scan: it is asked about
 * again at the next read.
 */
function isScanGone(error: unknown): boolean {
  return (
    error instanceof PowerBiScanFailedError ||
    (error instanceof BiRequestError &&
      error.statusCode >= 400 &&
      error.statusCode < 500 &&
      error.statusCode !== 429)
  );
}

type PowerBiScanTask =
  | { pickUp: PowerBiPendingScan; gives: Array<string> }
  | { start: Array<string> };

/*
 * Every workspace scanned, at most MAX_SIMULTANEOUS_SCANS scans at once:
 * first the scans earlier reads stopped waiting for (#9697), then the
 * read's own, each workspace in one. Each scan's outcome is its result,
 * why it gave none, or that it was still running when the read's wait ran
 * out, so the next read picks it up.
 *
 * A scan picked up is asked about at once. Once it succeeded its result is
 * read, for its workspaces this read does not scan anew; once it failed,
 * or Power BI no longer has it, those workspaces are scanned anew in this
 * read. A request about it that got a 5xx or no answer leaves it to the
 * next read, as it does a scan of the read's own once it was started.
 */
export async function runPowerBiScans(data: {
  api: PowerBiScannerApi;
  // The workspaces to scan anew.
  workspaceIds: Array<string>;
  // Scans earlier reads stopped waiting for, still within Power BI's keeping (PowerBiReadState).
  pickUp?: Array<PowerBiPendingScan> | undefined;
  timing: PowerBiScanTiming;
  // How long the scans may take, from now.
  waitInMs: number;
}): Promise<PowerBiScanRun> {
  const fresh: Set<string> = new Set(data.workspaceIds);
  // The scans picked up, oldest first, each with the workspaces it is still to give.
  const tasks: Array<PowerBiScanTask> = [
    ...[...(data.pickUp || [])]
      .sort((a: PowerBiPendingScan, b: PowerBiPendingScan): number => {
        return Date.parse(a.startedAt) - Date.parse(b.startedAt);
      })
      .map((scan: PowerBiPendingScan): PowerBiScanTask => {
        return {
          pickUp: scan,
          gives: scan.workspaceIds.filter((id: string): boolean => {
            return !fresh.has(id);
          }),
        };
      }),
    ...chunkWorkspaces(data.workspaceIds).map(
      (chunk: Array<string>): PowerBiScanTask => {
        return { start: chunk };
      },
    ),
  ];
  // Each scan's outcome by its place, so outcomes keep the scans' order whichever finishes first.
  const outcomes: Array<PowerBiScanOutcome | undefined> = [];
  const deadline: number = data.timing.clock() + data.waitInMs;
  let next: number = 0;
  /*
   * Once Power BI asks to wait longer than a read does, no scan starts. The
   * scans already running are still followed: asking how one goes counts
   * against another limit, and a request that meets one leaves its scan to
   * the next read.
   */
  let limit: PowerBiLimitError | null = null;

  const ask: (path: string) => Promise<JSONObject> = async (
    path: string,
  ): Promise<JSONObject> => {
    return readObject(
      await askPowerBi((): Promise<unknown> => {
        return data.api.get(path);
      }, data.timing),
    );
  };

  /*
   * A scan's status, asked after each wait until it succeeded (true), the
   * read's wait ran out (false), or it failed (PowerBiScanFailedError).
   */
  const follow: (
    scanId: string,
    delays: ReadonlyArray<number>,
  ) => Promise<boolean> = async (
    scanId: string,
    delays: ReadonlyArray<number>,
  ): Promise<boolean> => {
    for (let asked: number = 0; ; asked++) {
      const delay: number = delays[Math.min(asked, delays.length - 1)]!;

      if (data.timing.clock() + delay > deadline) {
        return false;
      }

      if (delay > 0) {
        await data.timing.wait(delay);
      }

      const status: JSONObject = await ask(
        `/admin/workspaces/scanStatus/${encodeURIComponent(scanId)}`,
      );
      const state: string = readText(status["status"]);

      if (state === "Succeeded") {
        return true;
      }

      if (state === "Failed") {
        throw new PowerBiScanFailedError(
          readText(readObject(status["error"])["message"], MAX_REASON_LENGTH),
        );
      }
    }
  };

  const resultOf: (scanId: string) => Promise<JSONObject> = (
    scanId: string,
  ): Promise<JSONObject> => {
    return ask(`/admin/workspaces/scanResult/${encodeURIComponent(scanId)}`);
  };

  // A scan an earlier read stopped waiting for: its result, or its workspaces scanned anew.
  const pickUp: (
    scan: PowerBiPendingScan,
    gives: Array<string>,
  ) => Promise<PowerBiScanOutcome> = async (
    scan: PowerBiPendingScan,
    gives: Array<string>,
  ): Promise<PowerBiScanOutcome> => {
    const running: PowerBiScanOutcome = {
      kind: "running",
      scanId: scan.scanId,
      workspaceIds: gives,
      startedAt: scan.startedAt,
    };

    try {
      if (!(await follow(scan.scanId, PICKED_UP_SCAN_POLL_DELAYS_IN_MS))) {
        return running;
      }

      // Each workspace it scanned is scanned anew: it was followed only until it ended.
      if (gives.length === 0) {
        return { kind: "scanned", workspaceIds: [], result: {} };
      }

      return {
        kind: "scanned",
        workspaceIds: gives,
        result: await resultOf(scan.scanId),
      };
    } catch (error) {
      if (error instanceof PowerBiLimitError) {
        limit = error;
      }

      if (!isScanGone(error)) {
        return running;
      }

      // It failed, or Power BI no longer has it: its workspaces are scanned anew, now.
      if (gives.length > 0) {
        tasks.push({ start: gives });
      }

      return {
        kind: "unscanned",
        workspaceIds: gives,
        reason: messageOf(error),
      };
    }
  };

  // A scan of the read's own: started, followed, and its result read.
  const scan: (
    workspaceIds: Array<string>,
  ) => Promise<PowerBiScanOutcome> = async (
    workspaceIds: Array<string>,
  ): Promise<PowerBiScanOutcome> => {
    if (limit) {
      return {
        kind: "unscanned",
        workspaceIds,
        reason: messageOf(limit),
      };
    }

    let started: PowerBiPendingScan | null = null;

    try {
      const answer: JSONObject = readObject(
        await askPowerBi((): Promise<unknown> => {
          return data.api.post(
            `/admin/workspaces/getInfo?${POWER_BI_SCAN_QUERY}`,
            { workspaces: workspaceIds },
          );
        }, data.timing),
      );
      const scanId: string = readText(answer["id"]);

      if (!scanId) {
        throw new Error("Power BI started no workspace scan.");
      }

      started = {
        scanId,
        workspaceIds,
        startedAt: new Date(data.timing.clock()).toISOString(),
      };

      if (!(await follow(scanId, POWER_BI_SCAN_POLL_DELAYS_IN_MS))) {
        return { kind: "running", ...started };
      }

      return {
        kind: "scanned",
        workspaceIds,
        result: await resultOf(scanId),
      };
    } catch (error) {
      if (error instanceof PowerBiLimitError) {
        limit = error;
      }

      // Started, and not known to be gone: Power BI may still finish it, and the next read asks.
      if (started && !isScanGone(error)) {
        return { kind: "running", ...started };
      }

      return {
        kind: "unscanned",
        workspaceIds,
        reason: messageOf(error),
      };
    }
  };

  const scanNext: () => Promise<void> = async (): Promise<void> => {
    while (next < tasks.length) {
      const index: number = next;
      const task: PowerBiScanTask = tasks[index]!;

      next++;
      outcomes[index] =
        "pickUp" in task
          ? await pickUp(task.pickUp, task.gives)
          : await scan(task.start);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_SIMULTANEOUS_SCANS, tasks.length) },
      (): Promise<void> => {
        return scanNext();
      },
    ),
  );

  const run: PowerBiScanRun = {
    outcomes: [],
    scanned: [],
    unscanned: [],
    running: [],
  };

  tasks.forEach((task: PowerBiScanTask, index: number) => {
    const outcome: PowerBiScanOutcome = outcomes[index] || {
      kind: "unscanned",
      workspaceIds: "start" in task ? task.start : task.gives,
      reason: "Power BI's workspace scan did not run.",
    };

    run.outcomes.push(outcome);

    if (outcome.kind === "scanned") {
      run.scanned.push({
        workspaceIds: outcome.workspaceIds,
        result: outcome.result,
      });
    } else if (outcome.kind === "unscanned") {
      run.unscanned.push({
        workspaceIds: outcome.workspaceIds,
        reason: outcome.reason,
      });
    } else {
      run.running.push({
        scanId: outcome.scanId,
        workspaceIds: outcome.workspaceIds,
        startedAt: outcome.startedAt,
      });
    }
  });

  return run;
}

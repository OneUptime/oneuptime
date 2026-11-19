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
 * A scan that fails or does not finish leaves its workspaces unscanned,
 * with Power BI's reason; the reader scans them again next time
 * (PowerBiReadState), and keeps what it read of them before.
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

export interface PowerBiScanRun {
  scanned: Array<PowerBiScanChunk>;
  unscanned: Array<PowerBiUnscanned>;
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

/*
 * One scan: started, its status asked after each wait until it succeeded,
 * failed or the read's wait ran out, and its result read.
 */
async function runScan(data: {
  api: PowerBiScannerApi;
  workspaceIds: Array<string>;
  timing: PowerBiScanTiming;
  deadline: number;
  waitInMs: number;
}): Promise<JSONObject> {
  const started: JSONObject = readObject(
    await askPowerBi((): Promise<unknown> => {
      return data.api.post(`/admin/workspaces/getInfo?${POWER_BI_SCAN_QUERY}`, {
        workspaces: data.workspaceIds,
      });
    }, data.timing),
  );
  const scanId: string = readText(started["id"]);

  if (!scanId) {
    throw new Error("Power BI started no workspace scan.");
  }

  for (let ask: number = 0; ; ask++) {
    const delay: number =
      POWER_BI_SCAN_POLL_DELAYS_IN_MS[
        Math.min(ask, POWER_BI_SCAN_POLL_DELAYS_IN_MS.length - 1)
      ]!;

    if (data.timing.clock() + delay > data.deadline) {
      throw new Error(
        `Power BI's workspace scan did not finish within ${minutes(data.waitInMs)}.`,
      );
    }

    await data.timing.wait(delay);

    const status: JSONObject = readObject(
      await askPowerBi((): Promise<unknown> => {
        return data.api.get(
          `/admin/workspaces/scanStatus/${encodeURIComponent(scanId)}`,
        );
      }, data.timing),
    );
    const state: string = readText(status["status"]);

    if (state === "Succeeded") {
      break;
    }

    if (state === "Failed") {
      const reason: string = readText(
        readObject(status["error"])["message"],
        MAX_REASON_LENGTH,
      );

      throw new Error(
        `Power BI's workspace scan failed${reason ? `: ${reason}` : "."}`,
      );
    }
  }

  return readObject(
    await askPowerBi((): Promise<unknown> => {
      return data.api.get(
        `/admin/workspaces/scanResult/${encodeURIComponent(scanId)}`,
      );
    }, data.timing),
  );
}

/*
 * Every workspace scanned, at most MAX_SIMULTANEOUS_SCANS scans at once:
 * each scan's result, and the workspaces of each scan that failed or did
 * not finish, with why.
 */
export async function runPowerBiScans(data: {
  api: PowerBiScannerApi;
  workspaceIds: Array<string>;
  timing: PowerBiScanTiming;
  // How long the scans may take, from now.
  waitInMs: number;
}): Promise<PowerBiScanRun> {
  const chunks: Array<Array<string>> = chunkWorkspaces(data.workspaceIds);
  // Each scan's outcome by its place, so results keep the workspaces' order whichever finishes first.
  const outcomes: Array<
    { result: JSONObject } | { reason: string } | undefined
  > = new Array(chunks.length).fill(undefined);
  const deadline: number = data.timing.clock() + data.waitInMs;
  let next: number = 0;
  // Once Power BI asks to wait longer than a read does, no more scans start.
  let limit: PowerBiLimitError | null = null;

  const scanNext: () => Promise<void> = async (): Promise<void> => {
    while (next < chunks.length) {
      const index: number = next;

      next++;

      if (limit) {
        outcomes[index] = { reason: limit.message };
        continue;
      }

      try {
        outcomes[index] = {
          result: await runScan({
            api: data.api,
            workspaceIds: chunks[index]!,
            timing: data.timing,
            deadline,
            waitInMs: data.waitInMs,
          }),
        };
      } catch (error) {
        if (error instanceof PowerBiLimitError) {
          limit = error;
        }

        outcomes[index] = { reason: messageOf(error) };
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_SIMULTANEOUS_SCANS, chunks.length) },
      (): Promise<void> => {
        return scanNext();
      },
    ),
  );

  const scanned: Array<PowerBiScanChunk> = [];
  const unscanned: Array<PowerBiUnscanned> = [];

  chunks.forEach((workspaceIds: Array<string>, index: number): void => {
    const outcome: { result: JSONObject } | { reason: string } | undefined =
      outcomes[index];

    if (outcome && "result" in outcome) {
      scanned.push({ workspaceIds, result: outcome.result });
    } else {
      unscanned.push({
        workspaceIds,
        reason: outcome?.reason || "Power BI's workspace scan did not run.",
      });
    }
  });

  return { scanned, unscanned };
}

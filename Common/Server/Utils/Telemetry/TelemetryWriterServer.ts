import { JSONObject } from "../../../Types/JSON";
import {
  FanInInsertError,
  FanInInsertTarget,
  FanInSubmitResult,
  isRetryableInsertError,
} from "./TelemetryFanInWriter";
import { type ClickHouseSettings } from "@clickhouse/client";

/*
 * Writer-tier request handling for the telemetry fan-in path, kept free of
 * Express so the admission, validation, and status mapping are unit-testable.
 * The App router (App/FeatureSet/Telemetry/API/TelemetryWriterAPI.ts) is a
 * thin shell: cluster-key auth → inflight gate → handleWriterInsert.
 *
 * Status contract (mirrored by TelemetryWriterClient's classification):
 * - 200: ClickHouse accepted the rows — into its async-insert buffer by
 *   default (ClickHouse owns flushing), or durably flushed when
 *   TELEMETRY_WAIT_FOR_ASYNC_INSERT=true on the writer pods.
 * - 400: malformed request or unknown table — never retried.
 * - 429: this pod is at its inflight-request cap — retry (load shedding is
 *   the writer tier's flow control at arbitrary worker-fleet sizes; without
 *   it, parked request bodies would grow pod memory without bound).
 * - 500: insert failed definitively after the local writer's retries.
 * - 503: insert failed on a still-transient error after the local writer
 *   exhausted its retries, or this pod is misconfigured — retry.
 */

export interface TelemetryWriterInsertRequest {
  tableName: string;
  rows: Array<JSONObject>;
  dedupToken: string;
  clickhouseSettings: ClickHouseSettings | undefined;
}

export interface WriterInsertOutcome {
  statusCode: number;
  body: JSONObject;
}

/*
 * Counting gate for concurrently-served insert requests. Rows a parked
 * request holds are invisible to the fan-in writer's maxPendingRows until
 * buffered, so this cap — not maxPendingRows — is what bounds writer-pod
 * memory when the worker fleet dwarfs the writer tier.
 */
export class InflightGate {
  private max: number;
  private current: number = 0;

  public constructor(max: number) {
    this.max = max;
  }

  public tryAcquire(): boolean {
    if (this.current >= this.max) {
      return false;
    }
    this.current++;
    return true;
  }

  public release(): void {
    this.current--;
  }

  public get inflight(): number {
    return this.current;
  }
}

export function readWriterMaxInflightRequestsFromEnv(): number {
  const raw: string | undefined =
    process.env["TELEMETRY_WRITER_MAX_INFLIGHT_REQUESTS"];
  const parsed: number = parseInt(raw || "", 10);
  return !isNaN(parsed) && parsed > 0 ? parsed : 100;
}

export type TableTargetResolver = (
  tableName: string,
) => FanInInsertTarget | undefined;

/*
 * Build a tableName → insert-target resolver from the analytics-service
 * singletons (Common/Server/Services/Index.ts exports AnalyticsServices).
 * The map is built lazily on first call so import order at boot does not
 * matter.
 */
export function createTableTargetResolver(
  targets: Array<FanInInsertTarget>,
): TableTargetResolver {
  let byTable: Map<string, FanInInsertTarget> | null = null;

  return (tableName: string): FanInInsertTarget | undefined => {
    if (!byTable) {
      byTable = new Map<string, FanInInsertTarget>();
      for (const target of targets) {
        byTable.set(target.model.tableName, target);
      }
    }
    return byTable.get(tableName);
  };
}

export function parseWriterInsertRequest(
  body: unknown,
): TelemetryWriterInsertRequest | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object." };
  }

  const json: JSONObject = body as JSONObject;

  const tableName: unknown = json["tableName"];
  if (typeof tableName !== "string" || tableName.trim() === "") {
    return { error: "tableName must be a non-empty string." };
  }

  const rows: unknown = json["rows"];
  if (!Array.isArray(rows)) {
    return { error: "rows must be an array." };
  }
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { error: "rows must contain only JSON objects." };
    }
  }

  /*
   * The worker-side writer sends a token on EVERY payload (per-job captured
   * or per-batch minted). Requiring it here keeps writer-side retries and
   * ambiguous-network-failure retries duplicate-free by construction.
   */
  const dedupToken: unknown = json["dedupToken"];
  if (typeof dedupToken !== "string" || dedupToken.trim() === "") {
    return { error: "dedupToken must be a non-empty string." };
  }

  const clickhouseSettings: unknown = json["clickhouseSettings"];
  if (
    clickhouseSettings !== undefined &&
    (typeof clickhouseSettings !== "object" ||
      clickhouseSettings === null ||
      Array.isArray(clickhouseSettings))
  ) {
    return { error: "clickhouseSettings must be an object when present." };
  }

  return {
    tableName: tableName,
    rows: rows as Array<JSONObject>,
    dedupToken: dedupToken,
    clickhouseSettings: clickhouseSettings as ClickHouseSettings | undefined,
  };
}

export interface WriterInsertDeps {
  resolveTarget: TableTargetResolver;
  submit: (
    target: FanInInsertTarget,
    rows: Array<JSONObject>,
    options: {
      dedupToken: string;
      clickhouseSettings?: ClickHouseSettings | undefined;
    },
  ) => Promise<FanInSubmitResult>;
  /*
   * True when THIS pod is itself configured to forward inserts to a remote
   * writer (TELEMETRY_WRITER_URL set). Serving inserts in that state would
   * bounce payloads between pods indefinitely, so refuse loudly instead.
   */
  forwardingEnabled: boolean;
}

export async function handleWriterInsert(
  body: unknown,
  deps: WriterInsertDeps,
): Promise<WriterInsertOutcome> {
  if (deps.forwardingEnabled) {
    return {
      statusCode: 503,
      body: {
        message:
          "This pod forwards telemetry inserts to a remote writer (TELEMETRY_WRITER_URL is set); it cannot serve writer inserts. Point workers at the telemetry-writer deployment instead.",
      },
    };
  }

  const parsed: TelemetryWriterInsertRequest | { error: string } =
    parseWriterInsertRequest(body);
  if ("error" in parsed) {
    return { statusCode: 400, body: { message: parsed.error } };
  }

  if (parsed.rows.length === 0) {
    return { statusCode: 200, body: { rowsAccepted: 0 } };
  }

  const target: FanInInsertTarget | undefined = deps.resolveTarget(
    parsed.tableName,
  );
  if (!target) {
    return {
      statusCode: 400,
      body: { message: `Unknown analytics table: ${parsed.tableName}` },
    };
  }

  try {
    const submission: FanInSubmitResult = await deps.submit(
      target,
      parsed.rows,
      {
        dedupToken: parsed.dedupToken,
        clickhouseSettings: parsed.clickhouseSettings,
      },
    );
    await submission.flushed;
  } catch (err) {
    const message: string = err instanceof Error ? err.message : String(err);
    const stillTransient: boolean =
      err instanceof FanInInsertError
        ? isRetryableInsertError(err.causeError)
        : isRetryableInsertError(err);
    return {
      statusCode: stillTransient ? 503 : 500,
      body: { message: message },
    };
  }

  return { statusCode: 200, body: { rowsAccepted: parsed.rows.length } };
}

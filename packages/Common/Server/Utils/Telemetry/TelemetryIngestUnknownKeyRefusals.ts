import { UNNAMED_TELEMETRY_INGEST_SURFACE } from "../../../Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";
import logger from "../Logger";

/*
 * TELEMETRY REFUSED FOR A MISSING OR UNKNOWN INGESTION KEY, COUNTED PER
 * PROCESS (#10703, #6427).
 *
 * A request with no ingestion key, or one no key has, names no project, so
 * it is counted against no key (TelemetryIngestRefusalRecorder counts what
 * a key it knows is refused). It comes from anyone, before anyone is known:
 * a collector set up with no key or a mistyped one, or a client that sends
 * requests only to cost the server. Each was logged at error level, one
 * line a request at no cost to the client: a flood of them reached the log
 * sink at the default LOG_LEVEL=ERROR, raised error alerts, and buried real
 * errors, while the cause is a client's configuration.
 *
 * So each refusal is logged at debug, where its caller logs it, and counted
 * here by why and by surface. The first refusal of each minute is logged
 * at warn, with what was counted since the line before it: a flood is one
 * line a minute, and a misconfigured collector still shows, by the surface
 * it sends to. Never the token: it is a secret, or a typo away from one.
 *
 * Nothing here throws or waits, and what it holds is bounded: a count per
 * reason and surface, and the surfaces are the code's own.
 */

export enum UnknownIngestionKeyRefusal {
  // No ingestion key in the request's headers (or the call's metadata).
  Missing = "missing",
  // A key no ingestion key has: mistyped, deleted, or given a new secret.
  Unknown = "unknown",
}

// The least time between two lines.
export const UNKNOWN_KEY_REFUSAL_LOG_INTERVAL_MS: number = 60 * 1000;

// Distinct (reason, surface) counts held between two lines.
export const MAX_UNKNOWN_KEY_REFUSAL_COUNTS: number = 200;

const REFUSAL_WORDS: Record<UnknownIngestionKeyRefusal, string> = {
  [UnknownIngestionKeyRefusal.Missing]: "with no ingestion key",
  [UnknownIngestionKeyRefusal.Unknown]: "with an unknown ingestion key",
};

export class TelemetryIngestUnknownKeyRefusalCounter {
  // `${refusal}|${surface}` -> how many since the last line.
  private counts: Map<string, number> = new Map();

  // When the last line was logged (ms since the epoch); none yet.
  private lastLoggedAt: number = Number.NEGATIVE_INFINITY;

  public constructor(
    private now: () => number = (): number => {
      return Date.now();
    },
  ) {}

  /*
   * Count one refused request, and log the counts when the last line is a
   * minute old or more. Never throws.
   */
  public record(data: {
    refusal: UnknownIngestionKeyRefusal;
    // null for the legacy guard, which names no surface.
    surface: TelemetryIngestSurface | null;
  }): void {
    try {
      const key: string = `${data.refusal}|${data.surface || UNNAMED_TELEMETRY_INGEST_SURFACE}`;

      if (
        this.counts.has(key) ||
        this.counts.size < MAX_UNKNOWN_KEY_REFUSAL_COUNTS
      ) {
        this.counts.set(key, (this.counts.get(key) || 0) + 1);
      }

      const nowMs: number = this.now();

      if (nowMs - this.lastLoggedAt < UNKNOWN_KEY_REFUSAL_LOG_INTERVAL_MS) {
        return;
      }

      const since: number = this.lastLoggedAt;

      this.lastLoggedAt = nowMs;
      logger.warn(this.describe(since));
      this.counts.clear();
    } catch {
      // A count is never worth an answer.
    }
  }

  // What is counted now and not yet logged: for tests.
  public getCounts(): Map<string, number> {
    return new Map(this.counts);
  }

  // Forget everything: for tests.
  public clear(): void {
    this.counts.clear();
    this.lastLoggedAt = Number.NEGATIVE_INFINITY;
  }

  private describe(since: number): string {
    const parts: Array<string> = [];

    for (const refusal of Object.values(UnknownIngestionKeyRefusal)) {
      let total: number = 0;
      const bySurface: Array<string> = [];

      for (const [key, count] of this.counts) {
        const [reason, surface] = key.split("|") as [string, string];

        if (reason === refusal) {
          total += count;
          bySurface.push(`${surface}: ${count}`);
        }
      }

      if (total > 0) {
        parts.push(
          `${total} ${total === 1 ? "request" : "requests"} ${REFUSAL_WORDS[refusal]} (${bySurface.join(", ")})`,
        );
      }
    }

    const when: string = Number.isFinite(since)
      ? ` since ${new Date(since).toISOString()}`
      : "";

    return `TelemetryIngest: refused ${parts.join(" and ")}${when}. Each is logged at debug; these counts at most once a minute.`;
  }
}

const TelemetryIngestUnknownKeyRefusals: TelemetryIngestUnknownKeyRefusalCounter =
  new TelemetryIngestUnknownKeyRefusalCounter();

export default TelemetryIngestUnknownKeyRefusals;

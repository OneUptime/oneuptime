import { ClickhouseBackgroundInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import {
  ClickhouseExecuteOptions,
  ClickHouseSettings,
} from "Common/Server/Services/AnalyticsDatabaseService";
import { LogService } from "Common/Server/Services/LogService";
import { SpanService } from "Common/Server/Services/SpanService";
import { ExceptionInstanceService } from "Common/Server/Services/ExceptionInstanceService";
import { ProfileService } from "Common/Server/Services/ProfileService";
import { MetricService } from "Common/Server/Services/MetricService";

/*
 * Telemetry-monitor evaluation runs heavy ClickHouse count / aggregate queries
 * on a per-minute cron. These service instances are bound to the dedicated
 * BACKGROUND ClickHouse pool (ClickhouseBackgroundInstance) instead of the
 * default App pool, so a burst of background queries can never consume the
 * HTTP sockets the user-facing dashboard reads depend on. Importing them with
 * the same identifier the job already uses keeps the call sites unchanged.
 */
export const BackgroundLogService: LogService = new LogService(
  ClickhouseBackgroundInstance,
);
export const BackgroundSpanService: SpanService = new SpanService(
  ClickhouseBackgroundInstance,
);
export const BackgroundExceptionInstanceService: ExceptionInstanceService =
  new ExceptionInstanceService(ClickhouseBackgroundInstance);
export const BackgroundProfileService: ProfileService = new ProfileService(
  ClickhouseBackgroundInstance,
);
export const BackgroundMetricService: MetricService = new MetricService(
  ClickhouseBackgroundInstance,
);

/*
 * Per-count server-side wall-clock cap for background telemetry-monitor counts.
 * Much tighter than the interactive 45s default: an alert count does not need a
 * 45s budget, and self-limiting at 15s frees the connection back to the pool
 * quickly under load (with timeout_overflow_mode='break' the count returns a
 * partial lower-bound rather than throwing).
 */
export const BACKGROUND_COUNT_MAX_EXECUTION_SECONDS: number = 15;

/*
 * Hard client-side cancellation budget. A safety net above the 15s server-side
 * cap: if a socket genuinely stalls (network black hole) the abort actively
 * cancels the request and reclaims the connection well before the 58s
 * socket-idle timer would. Returns a FRESH signal per call so each count gets
 * its own budget.
 */
const BACKGROUND_COUNT_ABORT_TIMEOUT_MS: number = 30_000;

export function backgroundCountExecuteOptions(): ClickhouseExecuteOptions {
  return {
    /*
     * Stream HTTP progress headers so the @clickhouse/client socket-idle timer
     * is reset by progress bytes while a count is legitimately running, and
     * actively cancel a stalled request via abort_signal.
     */
    clickhouseSettings: {
      send_progress_in_http_headers: 1,
      http_headers_progress_interval_ms: "10000",
    } as ClickHouseSettings,
    abortSignal: AbortSignal.timeout(BACKGROUND_COUNT_ABORT_TIMEOUT_MS),
  };
}

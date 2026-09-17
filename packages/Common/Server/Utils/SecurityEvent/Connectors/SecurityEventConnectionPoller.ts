import BadDataException from "../../../../Types/Exception/BadDataException";
import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SecurityConnectorCheck } from "../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  SECURITY_CONNECTION_ID_ATTRIBUTE,
  SecurityEventConnectionRunOptions,
  SecurityEventConnectionRunResult,
} from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { resolveTelemetryRetentionInDays } from "../../../../Types/Telemetry/TelemetryRetentionConfig";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../../Infrastructure/Semaphore";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../Services/OpenTelemetryIngestService";
import SecurityEventConnectionService from "../../../Services/SecurityEventConnectionService";
import SecurityEventService from "../../../Services/SecurityEventService";
import logger from "../../Logger";
import { redactLogString } from "../../LogRedaction";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import SecurityEventDedupe from "../SecurityEventDedupe";
import { buildSecurityEventDbRow } from "../SecurityEventRow";
import ThreatIntelEnricher from "../ThreatIntel/ThreatIntelEnricher";
import SecurityEventConnectorRegistry from "./SecurityEventConnectorRegistry";
import {
  ConnectorFetchBudget,
  ConnectorFetchFailureSummary,
  ConnectorFetchOptions,
  ConnectorFetchPurpose,
  ConnectorFetchResult,
  SecurityConnectorSettings,
  SecurityEventConnector,
  readConnectorChecks,
  readConnectorFetchSummary,
  toConnectorTestResult,
} from "./Types";

/*
 * The generic pull loop behind every Security Event Connection.
 *
 * Window and cursor rules, in order of what they protect against:
 *  - the first poll looks back a full day (DEFAULT_INITIAL_LOOKBACK), so a
 *    new connection shows the customer their recent records immediately
 *    instead of an empty window they read as "broken";
 *  - every later poll starts the provider's cursorOverlapInMinutes before
 *    the saved cursor, so a record created on a window boundary, or one
 *    the source made readable late, is not skipped (the dedupe lookup makes
 *    the overlap harmless);
 *  - a poll reads at most one chunk PAST THE CURSOR (the overlap is extra).
 *    Measuring the chunk from the window start instead would let a chunk
 *    no longer than the overlap end at or before the cursor, so the cursor
 *    could never move forward again. The chunk starts at a day, so a stale
 *    cursor catches up in daily windows, and adapts from poll to poll
 *    through lastPollResult.nextChunkMinutes;
 *  - a window read completely moves the cursor to its end and doubles the
 *    chunk back towards a day;
 *  - a window that could not be read in one run must never pin polling
 *    (review finding F1: the held window was re-read forever and nothing
 *    newer was ever imported). A connector that reads in ascending creation
 *    order reports resumeAfter and the cursor moves there. Otherwise the
 *    cursor holds and the chunk halves; a one-minute chunk that still
 *    cannot be read moves the cursor past that minute with a loud lastError,
 *    trading a bounded, reported gap for never stalling;
 *  - after that forced advance, later windows never start before the
 *    skipped minute's end (overlapFloor) until the overlap has moved past
 *    it, so a long overlap cannot drag every following poll back over the
 *    same overflowing minute;
 *  - a run that fails outright holds the cursor and keeps the chunk: an
 *    authentication or transport failure says nothing about volume.
 *
 * Every poll that does not fail therefore moves the cursor forward or
 * halves the chunk, so a connection moves within log2(MAX/MIN) + 1 polls.
 *
 * The window is on the SOURCE'S CREATION TIME, never the underlying event
 * time (see Connectors/Types.ts).
 *
 * Every provider runs through this loop, Google SecOps included (it had a
 * poller of its own until it moved into the framework). A connector that
 * reads one window in several independently budgeted passes, as Google
 * SecOps reads rule detections, curated detections and the alerts view,
 * raises the default bounds with fetchBudget, learns which operation it
 * serves and the connection's poll interval from the fetch options,
 * reports one check per pass (kept ahead of the summary read check) and
 * its own diagnostics (kept as providerDetails), and names the pass that
 * failed by attaching the passes' checks to the error it throws, with a
 * summary of what those passes gathered kept on the failed run.
 */

export const DEFAULT_INITIAL_LOOKBACK_IN_MINUTES: number = 24 * 60;
// The longest stretch past the cursor one poll reads, and the first chunk.
export const MAX_CHUNK_MINUTES: number = 24 * 60;
/*
 * The shortest chunk. Halving stops here: a one-minute chunk that still
 * holds more records than one run can read is skipped past (forcedAdvance).
 */
export const MIN_CHUNK_MINUTES: number = 1;

/*
 * Transport deadlines as connectors and the shared HTTP client word them:
 * "timed out after N seconds" (Sentinel, AWS Security Hub), axios's
 * "timeout of Nms exceeded" (surfaced inside "... did not complete: ...")
 * and a socket-level ETIMEDOUT.
 */
const TIMEOUT_ERROR_PATTERN: RegExp =
  /timed out|timeout of \d+ms exceeded|ETIMEDOUT/i;
/*
 * Only for a catalog entry without a usable cursorOverlapInMinutes, so a
 * malformed definition still re-reads the boundary instead of skipping it.
 */
export const DEFAULT_CURSOR_OVERLAP_IN_MINUTES: number = 1;
export const MAX_FETCH_REQUESTS: number = 20;
export const MAX_EVENTS_PER_RUN: number = 10000;
export const MAX_DIAGNOSTIC_SAMPLES: number = 25;
export const MAX_RANGE_MS: number = 7 * 24 * 60 * 60 * 1000;
export const POLL_REQUEST_TIMEOUT_IN_MS: number = 60 * 1000;
export const SECURITY_EVENT_SOURCE_LOCK_NAMESPACE: string =
  "SecurityEventConnectionSource";

const MINUTE_IN_MS: number = 60 * 1000;
/*
 * The interval the scheduler (SecurityEventConnectionRunExecutor) applies
 * to a connection whose own interval is missing or zero.
 */
const DEFAULT_POLL_INTERVAL_IN_MINUTES: number = 5;

/*
 * The bounds one fetch runs under once the connector's fetchBudget has been
 * applied over the poller's defaults. maxDurationMs is absent unless the
 * connector asked for a wall-clock budget.
 */
export interface ResolvedFetchBudget {
  maxRequests: number;
  maxEvents: number;
  maxDurationMs?: number | undefined;
}

export interface PollWindow {
  startTime: Date;
  endTime: Date;
  warnings: Array<string>;
  hasUsableCursor: boolean;
  /*
   * Scheduled polls only. progressFrom is where this poll's new ground
   * starts: the saved cursor, or the window start when there is no usable
   * cursor. chunkMinutes is the minutes from there to endTime, rounded up.
   * overlapFloor is the forced-advance floor this window was clamped to,
   * present only while it still clamps (see planPollCursor).
   */
  overlapInMinutes?: number | undefined;
  progressFrom?: Date | undefined;
  chunkMinutes?: number | undefined;
  /*
   * The chunk this poll was given (lastPollResult.nextChunkMinutes, or a
   * full day). chunkMinutes can be much shorter on a caught-up poll, where
   * the window only reaches now; growth and failure handling are based on
   * this value so a healthy poll never shrinks the next one.
   */
  requestedChunkMinutes?: number | undefined;
  overlapFloor?: Date | undefined;
}

export class RecordedConnectionPollFailure extends Error {}

export default class SecurityEventConnectionPoller {
  @CaptureSpan()
  public static async pollAllDueConnections(): Promise<void> {
    const connections: Array<SecurityEventConnection> =
      await SecurityEventConnectionService.findBy({
        query: { isEnabled: true },
        select: {
          _id: true,
          projectId: true,
          name: true,
          provider: true,
          pollIntervalInMinutes: true,
          lastPolledAt: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    const now: Date = OneUptimeDate.getCurrentDate();

    for (const connection of connections) {
      const intervalInMinutes: number = Math.max(
        1,
        connection.pollIntervalInMinutes || 5,
      );

      if (connection.lastPolledAt) {
        const dueAt: Date = OneUptimeDate.addRemoveMinutes(
          connection.lastPolledAt,
          intervalInMinutes,
        );

        if (OneUptimeDate.isAfter(dueAt, now)) {
          continue;
        }
      }

      try {
        const ingested: number = await this.pollConnection(connection);
        logger.info(
          `SecurityEventConnectionPoller: connection ${connection.id?.toString()} ingested ${ingested} security events.`,
        );
      } catch (error) {
        logger.error(
          `SecurityEventConnectionPoller: error polling connection ${connection.id?.toString()}:`,
        );
        logger.error(error);

        if (error instanceof RecordedConnectionPollFailure) {
          continue;
        }

        if (connection.id) {
          const connectionId: ObjectID = connection.id;

          await ConnectorErrorMessage.recordFailure({
            label: `SecurityEventConnectionPoller: connection ${connectionId.toString()}`,
            write: async (): Promise<void> => {
              await SecurityEventConnectionService.updateOneById({
                id: connectionId,
                data: {
                  lastPolledAt: OneUptimeDate.getCurrentDate(),
                  lastError: redactLogString(
                    ConnectorErrorMessage.toMessage(error, { truncate: false }),
                  ),
                },
                props: { isRoot: true },
              });
            },
          });
        }
      }
    }
  }

  @CaptureSpan()
  public static async pollConnection(
    connection: SecurityEventConnection,
    overrides?: PollerOverrides | undefined,
  ): Promise<number> {
    const result: SecurityEventConnectionRunResult =
      await this.executeConnection(connection, { type: "poll" }, overrides);

    if (result.status === "failed") {
      throw new RecordedConnectionPollFailure(
        result.error || "Security event connection poll failed.",
      );
    }

    return result.ingestedCount;
  }

  /*
   * Source-scoped serialization: ClickHouse does not deduplicate eventUid,
   * so lookup-then-insert is only safe under this lock. The key is the
   * project plus the provider, which is also the dedupe scope
   * (vendorName/productName), so two connections to the same product in
   * one project cannot race each other.
   */
  @CaptureSpan()
  public static async executeConnection(
    connection: SecurityEventConnection,
    options: SecurityEventConnectionRunOptions,
    overrides?: PollerOverrides | undefined,
  ): Promise<SecurityEventConnectionRunResult> {
    this.validateConnection(connection);

    if (options.type === "test" || options.type === "preview") {
      return this.executeUnlocked(connection, options, overrides);
    }

    let mutex: SemaphoreMutex;

    try {
      mutex = await Semaphore.lock({
        namespace: SECURITY_EVENT_SOURCE_LOCK_NAMESPACE,
        key: `${connection.projectId!.toString()}:${connection.provider}`,
        lockTimeout: 30000,
        acquireTimeout: 10000,
        retryInterval: 100,
      });
    } catch (error) {
      /*
       * A historical import or another connection to the same product is
       * still writing. That is contention, not a broken connection: say so
       * in the run instead of surfacing a raw lock error, and leave the
       * connection's lastError alone (executeUnlocked never ran).
       */
      if (error instanceof SemaphoreLockTimeoutError) {
        throw new BadDataException(
          "Another poll or import for this source is still running in this project. This run was skipped; polling continues on the next scheduled tick.",
        );
      }

      throw error;
    }

    try {
      const current: SecurityEventConnection | null = overrides
        ? connection
        : await SecurityEventConnectionService.findOneById({
            id: connection.id!,
            select: {
              _id: true,
              projectId: true,
              name: true,
              provider: true,
              config: true,
              secrets: true,
              alertingOnly: true,
              cursor: true,
              /*
               * nextChunkMinutes lives in the previous poll's result. Without
               * it every poll would restart at a full day and a window that
               * needs narrowing would never narrow.
               */
              lastPollResult: true,
              /*
               * Handed to the connector with the fetch (Google SecOps judges
               * how late detections are created against it). Without it the
               * connector would silently measure against the default.
               */
              pollIntervalInMinutes: true,
            },
            props: { isRoot: true },
          });

      if (
        !current ||
        current.projectId?.toString() !== connection.projectId!.toString()
      ) {
        throw new BadDataException(
          "Security event connection no longer exists in this project.",
        );
      }

      return await this.executeUnlocked(current, options, overrides);
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (error) {
        logger.error(
          `SecurityEventConnectionPoller: could not release source lock: ${redactLogString(ConnectorErrorMessage.toMessage(error))}`,
        );
      }
    }
  }

  private static validateConnection(connection: SecurityEventConnection): void {
    if (!connection.id || !connection.projectId || !connection.provider) {
      throw new BadDataException(
        "Security event connection is missing id, projectId or provider.",
      );
    }
  }

  public static getWindow(
    connection: SecurityEventConnection,
    options: SecurityEventConnectionRunOptions,
    now: Date = OneUptimeDate.getCurrentDate(),
  ): PollWindow {
    let endTime: Date = now;
    let startTime: Date = OneUptimeDate.addRemoveMinutes(
      now,
      -DEFAULT_INITIAL_LOOKBACK_IN_MINUTES,
    );
    const warnings: Array<string> = [];
    let hasUsableCursor: boolean = false;

    if (options.type === "preview" || options.type === "backfill") {
      startTime = new Date(options.startTime || "");
      endTime = new Date(options.endTime || "");

      if (
        !Number.isFinite(startTime.getTime()) ||
        !Number.isFinite(endTime.getTime()) ||
        startTime >= endTime ||
        endTime.getTime() > now.getTime() + 60000 ||
        endTime.getTime() - startTime.getTime() > MAX_RANGE_MS
      ) {
        throw new BadDataException(
          "Select a valid past time range of at most seven days.",
        );
      }
    } else if (options.type === "test") {
      startTime = OneUptimeDate.addRemoveMinutes(now, -24 * 60);
    } else if (options.type === "poll") {
      const overlapInMinutes: number = this.getCursorOverlapInMinutes(
        connection.provider,
      );
      const chunkLimitInMinutes: number = this.getChunkLimitInMinutes(
        connection.lastPollResult,
      );
      let progressFrom: Date = startTime;
      let overlapFloor: Date | undefined = undefined;

      if (connection.cursor) {
        const cursorTime: Date = new Date(connection.cursor);

        if (!Number.isFinite(cursorTime.getTime())) {
          warnings.push(
            "The saved cursor is unreadable; polling the default 24 hour window.",
          );
        } else if (cursorTime >= now) {
          warnings.push(
            "The saved cursor is in the future; polling the default 24 hour window.",
          );
        } else {
          hasUsableCursor = true;
          progressFrom = cursorTime;
          startTime = OneUptimeDate.addRemoveMinutes(
            cursorTime,
            -overlapInMinutes,
          );

          /*
           * After a forced advance the overlap must not reach back over the
           * minute that overflowed: every such poll would overflow on the
           * same records and force one more minute past, skipping up to the
           * whole overlap (30 minutes for AWS Security Hub) instead of one.
           * A floor later than the cursor cannot come from this poller, so
           * it is ignored rather than allowed to skip ground.
           */
          const floor: Date | undefined = this.readOverlapFloor(
            connection.lastPollResult,
          );

          if (floor && floor <= cursorTime && startTime < floor) {
            overlapFloor = floor;
            startTime = floor;
          }
        }
      }

      const chunkEnd: Date = OneUptimeDate.addRemoveMinutes(
        progressFrom,
        chunkLimitInMinutes,
      );

      if (chunkEnd < endTime) {
        endTime = chunkEnd;
        warnings.push(
          `Catching up from ${hasUsableCursor ? "the saved cursor" : "the start of the default 24 hour window"} in ${chunkLimitInMinutes === MAX_CHUNK_MINUTES ? "24 hour" : `${chunkLimitInMinutes} minute`} windows. Later records will be fetched by subsequent polls.`,
        );
      }

      return {
        startTime,
        endTime,
        warnings,
        hasUsableCursor,
        overlapInMinutes,
        progressFrom,
        overlapFloor,
        requestedChunkMinutes: chunkLimitInMinutes,
        chunkMinutes: Math.max(
          MIN_CHUNK_MINUTES,
          Math.ceil(
            (endTime.getTime() - progressFrom.getTime()) / MINUTE_IN_MS,
          ),
        ),
      };
    }

    return { startTime, endTime, warnings, hasUsableCursor };
  }

  /*
   * The chunk the previous poll asked for. Anything that is not an integer
   * in [MIN, MAX] (no previous poll, a row written before adaptive chunks
   * existed, a hand-edited value) falls back to a full day, which is the
   * behaviour a connection had before chunks adapted.
   */
  public static getChunkLimitInMinutes(
    lastPollResult: JSONObject | null | undefined,
  ): number {
    const stored: unknown = lastPollResult?.["nextChunkMinutes"];

    if (
      typeof stored === "number" &&
      Number.isInteger(stored) &&
      stored >= MIN_CHUNK_MINUTES &&
      stored <= MAX_CHUNK_MINUTES
    ) {
      return stored;
    }

    return MAX_CHUNK_MINUTES;
  }

  private static readOverlapFloor(
    lastPollResult: JSONObject | null | undefined,
  ): Date | undefined {
    const stored: unknown = lastPollResult?.["overlapFloor"];

    if (typeof stored !== "string") {
      return undefined;
    }

    const floor: Date = new Date(stored);
    return Number.isFinite(floor.getTime()) ? floor : undefined;
  }

  public static getCursorOverlapInMinutes(
    provider: string | undefined,
  ): number {
    const overlap: number | undefined =
      getSecurityEventConnectorDefinition(provider)?.cursorOverlapInMinutes;

    if (
      typeof overlap === "number" &&
      Number.isFinite(overlap) &&
      overlap >= 0
    ) {
      return overlap;
    }

    return DEFAULT_CURSOR_OVERLAP_IN_MINUTES;
  }

  /*
   * The bounds one fetch is given: the poller's defaults, overridden field
   * by field by the connector's fetchBudget. A source that reads one window
   * in several independently budgeted passes (Google SecOps) needs a larger
   * total than a single list, plus a wall clock the defaults do not have.
   * An override that is not a positive finite number is ignored rather than
   * trusted, so a mistake in a connector (0, a negative, NaN) can neither
   * lift a bound nor stop every fetch before its first request.
   */
  public static resolveFetchBudget(
    connector: SecurityEventConnector,
  ): ResolvedFetchBudget {
    const budget: ConnectorFetchBudget | undefined = connector.fetchBudget;
    const maxDurationMs: number | undefined = this.readBudgetOverride(
      budget?.maxDurationMs,
    );

    return {
      maxRequests:
        this.readBudgetOverride(budget?.maxRequests) ?? MAX_FETCH_REQUESTS,
      maxEvents:
        this.readBudgetOverride(budget?.maxEvents) ?? MAX_EVENTS_PER_RUN,
      ...(maxDurationMs !== undefined ? { maxDurationMs } : {}),
    };
  }

  private static readBudgetOverride(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : undefined;
  }

  private static async executeUnlocked(
    connection: SecurityEventConnection,
    options: SecurityEventConnectionRunOptions,
    overrides?: PollerOverrides | undefined,
  ): Promise<SecurityEventConnectionRunResult> {
    const definition: SecurityEventConnectorDefinition | undefined =
      getSecurityEventConnectorDefinition(connection.provider);

    if (!definition) {
      throw new BadDataException(
        "Security event connection has an unsupported provider.",
      );
    }

    const window: PollWindow = this.getWindow(connection, options);
    const startedMs: number = Date.now();
    const result: SecurityEventConnectionRunResult = {
      type: options.type,
      provider: definition.provider,
      ...(options.runId ? { runId: options.runId } : {}),
      status: "running",
      startedAt: new Date(startedMs).toISOString(),
      completedAt: new Date(startedMs).toISOString(),
      durationMs: 0,
      windowStart: window.startTime.toISOString(),
      windowEnd: window.endTime.toISOString(),
      fetchedCount: 0,
      ingestedCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
      failedCount: 0,
      complete: true,
      requestCount: 0,
      warnings: window.warnings,
      samples: [],
      checks: [],
    };

    let phase: string = "Validate configuration";
    let phaseStartedMs: number = Date.now();
    /*
     * What the connector said about how far it got, kept outside the try so
     * the cursor decision after it can use them.
     */
    let resumeAfter: Date | undefined = undefined;
    let onlyNormalizationFailed: boolean = false;

    try {
      const connector: SecurityEventConnector =
        overrides?.connector ||
        SecurityEventConnectorRegistry.getConnector(definition.provider);
      const settings: SecurityConnectorSettings =
        overrides?.settings ||
        (await SecurityEventConnectionService.getConnectorSettings(connection));

      connector.validateSettings(settings);
      result.checks.push({
        key: "configuration",
        name: phase,
        status: "pass",
        durationMs: Date.now() - phaseStartedMs,
        message: `The ${definition.title} configuration and credentials are present and well formed.`,
      });

      if (options.type === "test") {
        phase = `Check access to ${definition.title}`;
        phaseStartedMs = Date.now();
        const checks: Array<SecurityConnectorCheck> = toConnectorTestResult(
          await connector.testConnection(settings, {
            requestTimeoutInMs: POLL_REQUEST_TIMEOUT_IN_MS,
            skipAvailability: true,
          }),
        ).checks;
        result.checks.push(...checks);

        const failed: SecurityConnectorCheck | undefined = checks.find(
          (check: SecurityConnectorCheck): boolean => {
            return check.status === "fail";
          },
        );

        if (failed) {
          throw new BadDataException(`${failed.name}: ${failed.message}`);
        }
      } else {
        const purpose: ConnectorFetchPurpose = options.type;
        phase = `Read ${definition.importedRecordName}s from ${definition.title}`;
        phaseStartedMs = Date.now();
        const budget: ResolvedFetchBudget = this.resolveFetchBudget(connector);
        const fetchOptions: ConnectorFetchOptions = {
          maxRequests: budget.maxRequests,
          maxEvents: budget.maxEvents,
          requestTimeoutInMs: POLL_REQUEST_TIMEOUT_IN_MS,
          sampleLimit: MAX_DIAGNOSTIC_SAMPLES,
          ...(budget.maxDurationMs !== undefined
            ? { maxDurationMs: budget.maxDurationMs }
            : {}),
          /*
           * A preview or backfill reads a range a person picked, which a
           * source may also read by event time so the records they see match
           * its own console (see ConnectorFetchPurpose).
           */
          purpose,
          /*
           * The interval the scheduler really applies, read from the in-lock
           * reload (or the snapshot a test passes), so a connector reporting
           * late-created records measures against the saved schedule.
           */
          pollIntervalInMinutes: Math.max(
            1,
            connection.pollIntervalInMinutes ||
              DEFAULT_POLL_INTERVAL_IN_MINUTES,
          ),
        };
        const fetched: ConnectorFetchResult = await connector.fetchEvents(
          settings,
          { startTime: window.startTime, endTime: window.endTime },
          fetchOptions,
        );

        result.fetchedCount = fetched.fetchedCount;
        result.rejectedCount = fetched.rejectedCount;
        result.failedCount = fetched.failedCount;
        result.requestCount = fetched.requestCount;
        result.samples = fetched.samples.slice(0, MAX_DIAGNOSTIC_SAMPLES);
        result.warnings.push(...fetched.warnings);

        if (fetched.details) {
          result.providerDetails = fetched.details;
        }

        /*
         * Rejected objects are not a reason to hold the cursor: a record the
         * normalizer does not recognize will not become recognizable by
         * re-reading the same window, so holding would pin polling behind it
         * until the window can no longer reach the present. They are counted
         * and warned about instead. Normalization FAILURES make the window
         * incomplete, since a transient bug deserves a retry; the adaptive
         * chunk below narrows around them and finally moves past them, so a
         * record that never normalizes cannot pin polling either.
         */
        result.complete =
          result.complete && fetched.complete && fetched.failedCount === 0;
        /*
         * A resume point only means something when the connector itself
         * stopped early; a fetch that read its whole window has nothing to
         * resume from.
         */
        resumeAfter = fetched.complete ? undefined : fetched.resumeAfter;
        onlyNormalizationFailed = fetched.complete && fetched.failedCount > 0;

        if (fetched.rejectedCount) {
          result.warnings.push(
            `${fetched.rejectedCount} returned records were discarded because they do not look like ${definition.title} ${definition.importedRecordName}s.`,
          );
        }

        if (fetched.failedCount) {
          result.warnings.push(
            `${fetched.failedCount} records could not be normalized and were not imported.`,
          );
        }

        /*
         * One check per read pass first, so a pass a budget stopped shows as
         * a warning under its own name ahead of the summary of the read.
         */
        if (Array.isArray(fetched.checks)) {
          result.checks.push(...fetched.checks);
        }

        /*
         * The summary is never green for a window that was not read to its
         * end: a budget-stopped read shown as a pass tells the reader nothing
         * is missing while records are (the defect Google SecOps's own poller
         * called out). Normalization failures still outrank it.
         */
        result.checks.push({
          key: "read",
          name: phase,
          status: fetched.failedCount
            ? "fail"
            : fetched.rejectedCount || !fetched.complete
              ? "warn"
              : "pass",
          durationMs: Date.now() - phaseStartedMs,
          message: `${fetched.events.length} ${definition.importedRecordName}s recognized; ${fetched.rejectedCount} rejected; ${fetched.failedCount} failed; ${fetched.requestCount} request${fetched.requestCount === 1 ? "" : "s"}.${fetched.complete ? "" : " The window was not read completely; the warnings say what stopped the read."}`,
        });

        if (options.type === "poll" || options.type === "backfill") {
          phase = "Import records";
          phaseStartedMs = Date.now();
          await this.ingest(connection, definition, fetched.events, result);
          result.checks.push({
            key: "import",
            name: phase,
            status: "pass",
            durationMs: Date.now() - phaseStartedMs,
            message: `${result.ingestedCount} imported; ${result.duplicateCount} already imported.`,
          });
        }
      }

      result.status = !result.complete
        ? "partial"
        : options.type === "test" || result.fetchedCount > 0
          ? "success"
          : "empty";
    } catch (error) {
      result.status = "failed";
      result.complete = false;
      result.error = redactLogString(
        ConnectorErrorMessage.toMessage(error, { truncate: false }),
      );

      /*
       * A connector that reads in passes attaches the checks of the passes
       * that ran to the error it throws (attachConnectorChecks). The passes
       * that finished are kept, and the failure is named after the pass that
       * failed rather than the whole phase ("Read curated rule detections",
       * not "Read detections from Google SecOps"). The failed pass's own
       * check is not kept beside it: the failure check stands in for it,
       * with the redacted error as its message and that pass's remediation.
       * Passes run in order and the one that threw ran last, so when more
       * than one is marked failed the last one names the failure.
       */
      let failedPass: SecurityConnectorCheck | undefined = undefined;

      for (const check of readConnectorChecks(error) || []) {
        if (!check || typeof check !== "object") {
          continue;
        }

        if (check.status === "fail") {
          failedPass = check;
          continue;
        }

        result.checks.push(check);
      }

      /*
       * A connector that reads in passes may also attach what those passes
       * gathered (attachConnectorFetchSummary): their warnings, request and
       * record counts, and provider details so far. Keeping them restores
       * what the retired Google SecOps poller kept on a failed run, such as
       * the curated HTTP 403 downgrade warning and the per-pass counts. It
       * is diagnostics only: the status, error, lastError and the cursor
       * decision below are the same with or without it, and a connector
       * that attaches none leaves the failed run as it was.
       */
      const summary: ConnectorFetchFailureSummary | undefined =
        readConnectorFetchSummary(error);

      if (summary) {
        for (const warning of summary.warnings) {
          if (!result.warnings.includes(warning)) {
            result.warnings.push(warning);
          }
        }

        result.requestCount = summary.requestCount;
        result.fetchedCount = summary.fetchedCount;

        if (summary.details) {
          result.providerDetails = summary.details;
        }
      }

      result.checks.push({
        key: "failure",
        name: failedPass?.name || phase,
        status: "fail",
        durationMs: Date.now() - phaseStartedMs,
        message: result.error,
        ...(failedPass?.remediation
          ? { remediation: failedPass.remediation }
          : {}),
      });
    }

    result.completedAt = OneUptimeDate.getCurrentDate().toISOString();
    result.durationMs = Math.max(0, Date.now() - startedMs);

    // Decided before logging so the chunk warnings are logged with the rest.
    const cursor: string | undefined =
      options.type === "poll"
        ? this.planPollCursor({
            window,
            result,
            resumeAfter,
            onlyNormalizationFailed,
          })
        : undefined;

    for (const warning of result.warnings) {
      logger.warn(
        `SecurityEventConnectionPoller: connection ${connection.id!.toString()}: ${warning}`,
      );
    }

    if (options.type === "poll") {
      await SecurityEventConnectionService.updateOneById({
        id: connection.id!,
        data: {
          lastPolledAt: new Date(result.completedAt),
          lastPollResult: result as never,
          // A forced advance puts its warning first, so lastError leads with it.
          lastError: (result.error ||
            (result.complete
              ? null
              : result.warnings.join(" ") ||
                "Poll incomplete.")) as unknown as string,
          ...(cursor ? { cursor } : {}),
          ...(result.complete
            ? { lastSuccessfulPollAt: new Date(result.completedAt) }
            : {}),
          ...(result.ingestedCount
            ? { lastEventIngestedAt: new Date(result.completedAt) }
            : {}),
        },
        props: { isRoot: true },
      });
    } else if (options.type === "backfill" && result.ingestedCount) {
      await SecurityEventConnectionService.updateOneById({
        id: connection.id!,
        data: { lastEventIngestedAt: new Date(result.completedAt) },
        props: { isRoot: true },
      });
    }

    return result;
  }

  /*
   * The F1 cursor and chunk rules for one scheduled poll. Records
   * chunkMinutes, nextChunkMinutes and forcedAdvance on the result, adds the
   * warning that explains what the next poll does, and returns the cursor to
   * write (undefined keeps the stored cursor).
   *
   * Invariant: a cursor written after a usable cursor is strictly later than
   * it. windowEnd is later because the chunk is measured from the cursor,
   * and a resume point must be later to count as progress. The only other
   * write is the first-poll anchor, which replaces a missing or unusable
   * cursor.
   *
   * overlapFloor: a forced advance sets it to its window end; any other
   * poll carries the floor its window was clamped to, and drops it once the
   * cursor minus the overlap no longer reaches back past it.
   */
  private static planPollCursor(data: {
    window: PollWindow;
    result: SecurityEventConnectionRunResult;
    resumeAfter: Date | undefined;
    onlyNormalizationFailed: boolean;
  }): string | undefined {
    const { window, result } = data;
    const overlapInMinutes: number =
      window.overlapInMinutes ?? DEFAULT_CURSOR_OVERLAP_IN_MINUTES;
    const progressFrom: Date = window.progressFrom || window.startTime;
    const chunkMinutes: number = window.chunkMinutes ?? MAX_CHUNK_MINUTES;
    const requestedChunkMinutes: number =
      window.requestedChunkMinutes ?? MAX_CHUNK_MINUTES;
    /*
     * The first poll has no cursor to hold. Anchoring one overlap past the
     * window start makes the next poll's window start at the same instant,
     * instead of restarting a day before whenever it runs.
     */
    const firstPollAnchor: string | undefined = window.hasUsableCursor
      ? undefined
      : OneUptimeDate.addRemoveMinutes(
          window.startTime,
          overlapInMinutes,
        ).toISOString();

    result.chunkMinutes = chunkMinutes;

    if (window.overlapFloor) {
      result.overlapFloor = window.overlapFloor.toISOString();
    }

    if (result.status === "failed") {
      /*
       * A failure is not a volume signal, so the cursor and the requested
       * chunk are kept — with one exception. A request that timed out on a
       * wide window usually means the window itself is too heavy (Splunk
       * sorts the whole window on the search head before returning a row),
       * and retrying the same window would time out forever. Halve it, as a
       * poll that could not read its window would.
       */
      if (
        chunkMinutes > MIN_CHUNK_MINUTES &&
        TIMEOUT_ERROR_PATTERN.test(result.error || "")
      ) {
        const nextChunkMinutes: number = Math.max(
          MIN_CHUNK_MINUTES,
          Math.floor(chunkMinutes / 2),
        );
        result.nextChunkMinutes = nextChunkMinutes;
        result.warnings.push(
          `The source did not answer in time for this window; the next poll reads a ${nextChunkMinutes} minute window from the same starting point.`,
        );
        return firstPollAnchor;
      }

      result.nextChunkMinutes = requestedChunkMinutes;
      return firstPollAnchor;
    }

    if (result.complete) {
      // A finished poll never shrinks the chunk; after narrowing it doubles back.
      result.nextChunkMinutes = Math.min(
        MAX_CHUNK_MINUTES,
        Math.max(requestedChunkMinutes, chunkMinutes * 2),
      );
      return result.windowEnd;
    }

    /*
     * Progress means past the previous cursor, not merely past the window
     * start: records inside the overlap were already read by an earlier
     * poll, so resuming inside it would re-read the same records forever.
     * Without a usable cursor the previous "cursor" is the first-poll anchor
     * (window start plus overlap). The saved cursor is used directly rather
     * than window start plus overlap, because an overlap floor moves the
     * window start later and would otherwise hide real progress.
     */
    const previousCursorMs: number = window.hasUsableCursor
      ? progressFrom.getTime()
      : window.startTime.getTime() + overlapInMinutes * MINUTE_IN_MS;
    const resumeAfterMs: number | undefined =
      data.resumeAfter instanceof Date &&
      Number.isFinite(data.resumeAfter.getTime())
        ? data.resumeAfter.getTime()
        : undefined;

    if (
      resumeAfterMs !== undefined &&
      resumeAfterMs > previousCursorMs &&
      resumeAfterMs <= window.endTime.getTime()
    ) {
      const resumeAt: string = new Date(resumeAfterMs).toISOString();
      // The connector reads ascending, so the same length keeps moving.
      result.nextChunkMinutes = requestedChunkMinutes;
      /*
       * Resume exactly where this poll stopped, without the overlap. The
       * overlap exists for records delivered late while a connection is
       * caught up; during a backlog it only re-reads what this poll just
       * read. With a 30 minute overlap (AWS Security Hub) and more than one
       * run's worth of records inside those 30 minutes, every following poll
       * would re-read only duplicates, never pass the cursor, and end in a
       * forced advance past records nobody read. The floor is dropped once
       * the cursor has moved one overlap past it, which restores the overlap.
       */
      result.overlapFloor = resumeAt;
      result.warnings.push(
        `This poll stopped before the end of its window after reading records created up to ${resumeAt}; the next poll resumes from there.`,
      );
      return resumeAt;
    }

    if (chunkMinutes > MIN_CHUNK_MINUTES) {
      const nextChunkMinutes: number = Math.max(
        MIN_CHUNK_MINUTES,
        Math.floor(chunkMinutes / 2),
      );
      result.nextChunkMinutes = nextChunkMinutes;
      result.warnings.push(
        data.onlyNormalizationFailed
          ? `Some records in this window could not be normalized; the next poll reads a ${nextChunkMinutes} minute window from the same starting point to retry them.`
          : `This window holds more records than one poll can read; the next poll reads a ${nextChunkMinutes} minute window from the same starting point.`,
      );
      return firstPollAnchor;
    }

    /*
     * A one-minute chunk that still cannot be read. Narrowing further is
     * impossible and holding would stall the connection for good, so move
     * past this minute and say so loudly. The warning goes first so it
     * also leads lastError.
     */
    const minuteStart: string = progressFrom.toISOString();
    result.forcedAdvance = true;
    result.nextChunkMinutes = MIN_CHUNK_MINUTES;
    result.overlapFloor = result.windowEnd;
    result.warnings.unshift(
      data.onlyNormalizationFailed
        ? `${result.failedCount} records created in the one minute from ${minuteStart} to ${result.windowEnd} could not be normalized. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to retry them.`
        : `More records were created in the one minute from ${minuteStart} to ${result.windowEnd} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.`,
    );
    return result.windowEnd;
  }

  private static async ingest(
    connection: SecurityEventConnection,
    definition: SecurityEventConnectorDefinition,
    normalized: Array<NormalizedSecurityEvent>,
    result: SecurityEventConnectionRunResult,
  ): Promise<void> {
    if (!normalized.length) {
      return;
    }

    const seen: Set<string> = new Set();
    const unique: Array<NormalizedSecurityEvent> = normalized.filter(
      (event: NormalizedSecurityEvent): boolean => {
        if (seen.has(event.eventUid)) {
          result.duplicateCount++;
          return false;
        }
        seen.add(event.eventUid);
        return true;
      },
    );

    const existing: Set<string> =
      await SecurityEventDedupe.findExistingEventUids({
        projectId: connection.projectId!,
        vendorName: definition.vendorName,
        productName: definition.productName,
        ids: unique.map((event: NormalizedSecurityEvent): string => {
          return event.eventUid;
        }),
      });

    const fresh: Array<NormalizedSecurityEvent> = unique.filter(
      (event: NormalizedSecurityEvent): boolean => {
        if (existing.has(event.eventUid)) {
          result.duplicateCount++;
          return false;
        }
        return true;
      },
    );

    if (!fresh.length) {
      return;
    }

    const serviceMetadata: TelemetryServiceMetadata =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: definition.productName,
        projectId: connection.projectId!,
      });

    const retentionDays: number = resolveTelemetryRetentionInDays({
      pillar: "securityEvents",
      serviceConfig: serviceMetadata.serviceRetentionConfig,
      serviceRetentionInDays: serviceMetadata.serviceRetentionInDays,
      projectConfig: serviceMetadata.projectRetentionConfig,
      projectRetentionInDays: serviceMetadata.projectRetentionInDays,
    });

    await ThreatIntelEnricher.enrichNormalizedEvents({
      projectId: connection.projectId!,
      events: fresh,
    });

    const rows: Array<JSONObject> = fresh.map(
      (event: NormalizedSecurityEvent): JSONObject => {
        event.vendorName = definition.vendorName;
        event.productName = definition.productName;
        /*
         * The default attribute. Runs written here leave eventAttributeKey
         * unset, which readers take to mean this key; only runs carried over
         * from the retired Google SecOps connector name its legacy one.
         */
        event.attributes[SECURITY_CONNECTION_ID_ATTRIBUTE] =
          connection.id!.toString();
        event.attributes["oneuptime.security_connection.provider"] =
          definition.provider;

        return buildSecurityEventDbRow({
          normalized: event,
          projectId: connection.projectId!,
          serviceMetadata,
          retentionDays,
        });
      },
    );

    /*
     * The source lock cannot be released before buffered writes are
     * visible, so this low-volume path asks for synchronous acknowledgement
     * regardless of the high-volume telemetry defaults.
     */
    await SecurityEventService.insertJsonRows(rows, {
      clickhouseSettings: { async_insert: 0, insert_distributed_sync: 1 },
    });

    result.ingestedCount = rows.length;

    const times: Array<string> = rows
      .map((row: JSONObject): string => {
        return new Date(
          String(row["time"]).replace(" ", "T") + "Z",
        ).toISOString();
      })
      .sort();

    result.eventTimeStart = times[0];
    result.eventTimeEnd = times[times.length - 1];
  }
}

/*
 * Test seam: an injected connector and settings skip the registry, the
 * decrypting service read and the in-lock reload, so a suite can drive one
 * connector through the real loop with the connection snapshot it passes
 * (cursor, lastPollResult and pollIntervalInMinutes included).
 */
export interface PollerOverrides {
  connector?: SecurityEventConnector | undefined;
  settings?: SecurityConnectorSettings | undefined;
}

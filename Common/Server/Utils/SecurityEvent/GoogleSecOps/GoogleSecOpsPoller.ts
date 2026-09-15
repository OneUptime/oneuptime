import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  GoogleSecOpsCreationLag,
  GoogleSecOpsDetectionSample,
  GoogleSecOpsDiagnosticCheck,
  GoogleSecOpsRunOptions,
  GoogleSecOpsRunResult,
} from "../../../../Types/SecurityEvent/GoogleSecOpsDiagnostics";
import {
  contentHashEventUid,
  parseEventTime,
  readString,
  readValue,
} from "../../../../Utils/SecurityEvent/NormalizerHelpers";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../../Infrastructure/Semaphore";
import GoogleSecOpsConnection from "../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import GoogleSecOpsAlertNormalizer from "../../../../Utils/SecurityEvent/GoogleSecOpsAlertNormalizer";
import GoogleSecOpsConnectionService from "../../../Services/GoogleSecOpsConnectionService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../Services/SecurityEventService";
import { resolveTelemetryRetentionInDays } from "../../../../Types/Telemetry/TelemetryRetentionConfig";
import logger from "../../Logger";
import { redactLogString } from "../../LogRedaction";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import SecurityEventDedupe from "../SecurityEventDedupe";
import { buildSecurityEventDbRow } from "../SecurityEventRow";
import ThreatIntelEnricher from "../ThreatIntel/ThreatIntelEnricher";
import GoogleSecOpsClient, {
  FetchAlertsResult,
  GoogleSecOpsListBasis,
  SearchDetectionsResult,
} from "../Connectors/GoogleSecOps/GoogleSecOpsClient";

const SECOPS_SERVICE_NAME: string = "Google SecOps";
const SECOPS_VENDOR_NAME: string = "Google";

/*
 * The first poll of a new connection reads a full day of CREATED detections.
 * Fifteen minutes used to be the default, and on a tenant whose rules run
 * hourly or daily it reliably returned nothing, which read as "the
 * connector is broken" on the very first look.
 */
const DEFAULT_LOOKBACK_IN_MINUTES: number = 24 * 60;
/*
 * Adaptive catch-up. A scheduled poll reads at most MAX_CHUNK_MINUTES of
 * created time past its cursor. A poll that cannot read its window in one
 * run halves the next chunk and a complete poll doubles it back, because
 * re-reading an identical window that never fits pinned the cursor forever
 * and nothing new was ever imported. The chunk is measured from the cursor,
 * not from the overlapped window start: a chunk no longer than the overlap
 * would otherwise end at or before the cursor and never move it.
 */
const MAX_CHUNK_MINUTES: number = 24 * 60;
const MIN_CHUNK_MINUTES: number = 1;
const WINDOW_OVERLAP_IN_MINUTES: number = 1;
/*
 * Separate request budgets per kind of read. The two created-time search
 * passes are the authoritative read of rule detections and share one page
 * budget; the alerts view splits truncated windows and gets its own, so a
 * burst that the alerts view has to split can no longer starve the searches
 * (or the other way round).
 */
const MAX_SEARCH_PAGES_PER_POLL: number = 20;
const MAX_ALERTS_VIEW_REQUESTS_PER_POLL: number = 16;
// The worker job times out at ten minutes; normalizing and importing follow.
const MAX_FETCH_DURATION_MS: number = 4 * 60 * 1000;
const MAX_ALERTS_PER_REQUEST: number = 1000;
const MAX_SEARCH_PAGE_SIZE: number = 1000;
const MAX_DIAGNOSTIC_SAMPLES: number = 25;
const MAX_RANGE_MS: number = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_IN_MINUTES: number = 5;
/*
 * A detection created within one poll interval plus this grace of its
 * detection time would still have been caught by a detection-time cursor;
 * anything later is exactly the record the old basis lost.
 */
const CREATION_LAG_GRACE_IN_MINUTES: number = 1;
/*
 * Curated (Google-authored) rule detections are optional: tenants without
 * that entitlement answer 403 (and some 400/404) on the curated route. Those
 * statuses degrade the pass to a warning; 401, 429, 5xx, timeouts and parse
 * failures still fail the run like any other pass.
 */
const CURATED_OPTIONAL_STATUSES: Array<number> = [400, 403, 404];
export const GOOGLE_SECOPS_SOURCE_LOCK_NAMESPACE: string = "GoogleSecOpsSource";

interface PollWindow {
  startTime: Date;
  endTime: Date;
  warnings: Array<string>;
  hasUsableCursor: boolean;
  /*
   * Scheduled polls only: the saved cursor this window reads past, or the
   * window start when there is no usable cursor. chunkMinutes is the
   * distance from there to endTime, rounded up; requestedChunkMinutes is
   * the chunk the previous poll asked for, which is longer whenever this
   * window was cut short by the present.
   */
  chunkBase?: Date | undefined;
  chunkMinutes?: number | undefined;
  requestedChunkMinutes?: number | undefined;
}

// Why a read pass stopped before it had read everything it was asked for.
type PassStop = "requests" | "time" | null;

interface PassOutcome {
  // Records Google returned across every request of the pass.
  returned: number;
  requests: number;
  stoppedBy: PassStop;
  // Google itself left part of the window unread (truncation, unfinished stream).
  leftUnread: boolean;
}

// The per-poll budgets: request counts per kind of read and the wall clock.
interface PollBudget {
  startedMs: number;
  searchRequests: number;
  alertsViewRequests: number;
}

// How a scheduled poll moves its cursor, decided once the passes are done.
interface CursorDecision {
  cursor?: string | undefined;
  nextChunkMinutes: number;
  forcedAdvance: boolean;
  warning?: string | undefined;
}

class RecordedPollFailure extends Error {}

export default class GoogleSecOpsPoller {
  @CaptureSpan()
  public static async pollAllDueConnections(): Promise<void> {
    const connections: Array<GoogleSecOpsConnection> =
      await GoogleSecOpsConnectionService.findBy({
        query: {
          isEnabled: true,
        },
        select: {
          _id: true,
          projectId: true,
          name: true,
          region: true,
          instanceResourceName: true,
          serviceAccountJson: true,
          pollIntervalInMinutes: true,
          lastPolledAt: true,
          cursor: true,
          // Carries nextChunkMinutes, the length of the next catch-up chunk.
          lastPollResult: true,
          includeNonAlertingDetections: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
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

        /*
         * The count used to be returned and dropped on the floor, which
         * left "polling healthy but quiet" and "polling silently broken"
         * looking identical from outside the process. At info rather than
         * debug for that reason — a number nobody sees at the default log
         * level answers the question no better than not having it.
         */
        logger.info(
          `GoogleSecOpsPoller: connection ${connection.id?.toString()} ingested ${ingested} security events.`,
        );
      } catch (error) {
        logger.error(
          `GoogleSecOpsPoller: error polling connection ${connection.id?.toString()}:`,
        );
        logger.error(error);

        if (error instanceof RecordedPollFailure) {
          continue;
        }

        /*
         * Stamping the failure is best-effort and must never take the
         * loop down with it: a throw here would skip every connection
         * still due in this tick and leave this one's lastPolledAt and
         * lastError null, so the poller would look like it had simply
         * never run.
         */
        if (connection.id) {
          const connectionId: ObjectID = connection.id;

          await ConnectorErrorMessage.recordFailure({
            label: `GoogleSecOpsPoller: connection ${connectionId.toString()}`,
            write: async (): Promise<void> => {
              await GoogleSecOpsConnectionService.updateOneById({
                id: connectionId,
                data: {
                  lastPolledAt: OneUptimeDate.getCurrentDate(),
                  lastError: redactLogString(
                    ConnectorErrorMessage.toMessage(error, { truncate: false }),
                  ),
                },
                props: {
                  isRoot: true,
                },
              });
            },
          });
        }
      }
    }
  }

  @CaptureSpan()
  public static async pollConnection(
    connection: GoogleSecOpsConnection,
    clientOverride?: GoogleSecOpsClient | undefined,
  ): Promise<number> {
    const result: GoogleSecOpsRunResult = await this.executeConnection(
      connection,
      { type: "poll" },
      clientOverride,
    );
    if (result.status === "failed") {
      throw new RecordedPollFailure(
        result.error || "Google SecOps poll failed.",
      );
    }
    return result.ingestedCount;
  }

  /**
   * Source-scoped serialization is required because ClickHouse does not
   * deduplicate eventUid: a lookup followed by insert is only safe under this
   * lock. The same lock covers different connections to the same source.
   */
  @CaptureSpan()
  public static async executeConnection(
    connection: GoogleSecOpsConnection,
    options: GoogleSecOpsRunOptions,
    clientOverride?: GoogleSecOpsClient | undefined,
  ): Promise<GoogleSecOpsRunResult> {
    this.validateConnection(connection);
    if (options.type === "test" || options.type === "preview") {
      return this.executeUnlocked(connection, options, clientOverride);
    }

    let mutex: SemaphoreMutex;
    try {
      mutex = await Semaphore.lock({
        namespace: GOOGLE_SECOPS_SOURCE_LOCK_NAMESPACE,
        key: connection.projectId!.toString(),
        lockTimeout: 30000,
        acquireTimeout: 10000,
        retryInterval: 100,
      });
    } catch (error) {
      /*
       * The library's timeout message names Redis keys and reads like an
       * infrastructure fault. It is the expected steady state when a long
       * import holds the source lock, so it is reworded for the person
       * reading run history, and left as a BadDataException so the run
       * executor records it without retrying.
       */
      if (error instanceof SemaphoreLockTimeoutError) {
        throw new BadDataException(
          "Another poll or import for this source is still running in this project. This run was skipped; polling continues on the next scheduled tick.",
        );
      }
      throw error;
    }
    try {
      /*
       * An injected client also injects the connection snapshot for tests.
       * Production always reloads after waiting for another poll or backfill.
       */
      const current: GoogleSecOpsConnection | null = clientOverride
        ? connection
        : await GoogleSecOpsConnectionService.findOneById({
            id: connection.id!,
            select: {
              _id: true,
              projectId: true,
              name: true,
              region: true,
              instanceResourceName: true,
              serviceAccountJson: true,
              cursor: true,
              /*
               * Reloaded with the cursor: the previous poll's result decides
               * this poll's chunk and whether it resumes past a forced advance.
               */
              lastPollResult: true,
              pollIntervalInMinutes: true,
              includeNonAlertingDetections: true,
            },
            props: { isRoot: true },
          });
      if (
        !current ||
        current.projectId?.toString() !== connection.projectId!.toString()
      ) {
        throw new BadDataException(
          "Google SecOps connection no longer exists in this project.",
        );
      }
      return await this.executeUnlocked(current, options, clientOverride);
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (error) {
        logger.error(
          `GoogleSecOpsPoller: could not release source lock: ${redactLogString(ConnectorErrorMessage.toMessage(error))}`,
        );
      }
    }
  }

  private static validateConnection(connection: GoogleSecOpsConnection): void {
    if (
      !connection.id ||
      !connection.projectId ||
      !connection.region ||
      !connection.instanceResourceName ||
      !connection.serviceAccountJson
    ) {
      throw new BadDataException(
        "Google SecOps connection is missing id, projectId, region, instance, or credentials.",
      );
    }
  }

  private static getWindow(
    connection: GoogleSecOpsConnection,
    options: GoogleSecOpsRunOptions,
  ): PollWindow {
    const now: Date = OneUptimeDate.getCurrentDate();
    let endTime: Date = now;
    let startTime: Date = OneUptimeDate.addRemoveMinutes(
      now,
      -DEFAULT_LOOKBACK_IN_MINUTES,
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
      return { startTime, endTime, warnings, hasUsableCursor };
    }

    if (options.type !== "poll") {
      return { startTime, endTime, warnings, hasUsableCursor };
    }

    const chunk: number = this.getChunkMinutes(connection);
    let cursorTime: Date | null = null;
    if (connection.cursor) {
      const parsed: Date = new Date(connection.cursor);
      if (!Number.isFinite(parsed.getTime())) {
        warnings.push(
          "The saved cursor is unreadable; polling the default 24 hour window.",
        );
      } else if (parsed >= now) {
        warnings.push(
          "The saved cursor is in the future; polling the default 24 hour window.",
        );
      } else {
        cursorTime = parsed;
      }
    }

    if (cursorTime) {
      hasUsableCursor = true;
      startTime = this.resumesFromForcedAdvance(connection, cursorTime)
        ? cursorTime
        : OneUptimeDate.addRemoveMinutes(
            cursorTime,
            -WINDOW_OVERLAP_IN_MINUTES,
          );
      const chunkEnd: Date = OneUptimeDate.addRemoveMinutes(cursorTime, chunk);
      if (chunkEnd < endTime) {
        endTime = chunkEnd;
        warnings.push(
          `Catching up from the saved cursor in ${this.describeChunk(chunk)} windows. Later detections will be fetched by subsequent polls.`,
        );
      }
    } else {
      // The first window keeps its 24 hour lookback; a narrowed chunk only shortens its end.
      const chunkEnd: Date = OneUptimeDate.addRemoveMinutes(startTime, chunk);
      if (chunkEnd < endTime) {
        endTime = chunkEnd;
        warnings.push(
          `Reading the first ${chunk} minutes of the 24 hour lookback. Later detections will be fetched by subsequent polls.`,
        );
      }
    }

    const chunkBase: Date = cursorTime || startTime;
    return {
      startTime,
      endTime,
      warnings,
      hasUsableCursor,
      chunkBase,
      requestedChunkMinutes: chunk,
      chunkMinutes: Math.max(
        MIN_CHUNK_MINUTES,
        Math.ceil((endTime.getTime() - chunkBase.getTime()) / 60000),
      ),
    };
  }

  /*
   * lastPollResult.nextChunkMinutes when it is a whole number of minutes
   * inside the allowed range. Anything else (no previous poll, a hand-edited
   * row, a result from before adaptive catch-up) reads the full 24 hours.
   */
  private static getChunkMinutes(connection: GoogleSecOpsConnection): number {
    const stored: unknown = connection.lastPollResult
      ? connection.lastPollResult["nextChunkMinutes"]
      : undefined;
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

  /*
   * True when the saved cursor is the end of a minute that a forced advance
   * skipped (or a poll that already started there and did not move the
   * cursor). Such a poll starts at the cursor without the overlap: the
   * overlap minute is exactly the minute that could not be read, and
   * re-reading it would overflow again and force a second advance over a
   * minute that was never the problem.
   */
  private static resumesFromForcedAdvance(
    connection: GoogleSecOpsConnection,
    cursorTime: Date,
  ): boolean {
    const stored: JSONObject | undefined = connection.lastPollResult;
    if (!stored || stored["type"] !== "poll") {
      return false;
    }
    const readTime: (key: string) => number = (key: string): number => {
      const value: unknown = stored[key];
      return typeof value === "string" ? Date.parse(value) : Number.NaN;
    };
    return (
      (stored["forcedAdvance"] === true &&
        readTime("windowEnd") === cursorTime.getTime()) ||
      readTime("windowStart") === cursorTime.getTime()
    );
  }

  private static describeChunk(minutes: number): string {
    if (minutes % 60 === 0) {
      const hours: number = minutes / 60;
      return `${hours} hour`;
    }
    return `${minutes} minute`;
  }

  private static async executeUnlocked(
    connection: GoogleSecOpsConnection,
    options: GoogleSecOpsRunOptions,
    clientOverride?: GoogleSecOpsClient | undefined,
  ): Promise<GoogleSecOpsRunResult> {
    const window: PollWindow = this.getWindow(connection, options);
    const startedMs: number = Date.now();
    /*
     * Preview and backfill take a detection-time range from the person (it
     * is how the SecOps alerts view frames time), and read created time as
     * well so an import of "yesterday" also carries detections created
     * yesterday about older events. Polls read created time only; the
     * alerts-view pass supplies detection time.
     */
    const isHistorical: boolean =
      options.type === "preview" || options.type === "backfill";
    const searchBases: Array<GoogleSecOpsListBasis> = isHistorical
      ? ["CREATED_TIME", "DETECTION_TIME"]
      : ["CREATED_TIME"];
    const basisLabel: string = isHistorical
      ? "created and detection time"
      : "created time";
    const result: GoogleSecOpsRunResult = {
      type: options.type,
      ...(options.runId ? { runId: options.runId } : {}),
      status: "running",
      startedAt: new Date(startedMs).toISOString(),
      completedAt: new Date(startedMs).toISOString(),
      durationMs: 0,
      windowStart: window.startTime.toISOString(),
      windowEnd: window.endTime.toISOString(),
      includeNonAlertingDetections:
        connection.includeNonAlertingDetections === true,
      basis: isHistorical ? "detection-time" : "created-time",
      sourceCounts: { ruleDetections: 0, curatedDetections: 0, alertsView: 0 },
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
      ...(window.chunkMinutes !== undefined
        ? { chunkMinutes: window.chunkMinutes }
        : {}),
    };
    const budget: PollBudget = {
      startedMs,
      searchRequests: 0,
      alertsViewRequests: 0,
    };
    let phase: string = "Validate configuration";
    let phaseStartedMs: number = Date.now();
    try {
      const client: GoogleSecOpsClient =
        clientOverride ||
        new GoogleSecOpsClient({
          region: connection.region!,
          instanceResourceName: connection.instanceResourceName!,
          serviceAccountJson: connection.serviceAccountJson!,
        });
      result.checks.push({
        name: phase,
        status: "success",
        durationMs: Date.now() - phaseStartedMs,
        message:
          "The region, instance and service account configuration are valid.",
      });
      if (options.type === "test") {
        phase = "Authenticate with Google";
        phaseStartedMs = Date.now();
        await client.testAuthentication();
        result.checks.push({
          name: phase,
          status: "success",
          durationMs: Date.now() - phaseStartedMs,
          message: "Google accepted the service account credentials.",
        });
      }

      /*
       * Three passes over one window, unioned by Collection.id. The alerts
       * view alone filters on DETECTION time, and a rule that runs hourly
       * creates detections whose detection time is already behind a
       * forward-only cursor, so it can never be the primary read.
       */
      const seen: Map<string, JSONObject> = new Map();

      phase = `Read rule detections by ${basisLabel}`;
      phaseStartedMs = Date.now();
      const rulePass: PassOutcome = await this.searchPass(
        client,
        window,
        result,
        budget,
        seen,
        { curated: false, bases: searchBases },
      );
      result.sourceCounts!.ruleDetections = rulePass.returned;
      this.recordPass({
        result,
        name: phase,
        startedMs: phaseStartedMs,
        outcome: rulePass,
        countMessage: `${rulePass.returned} rule detections returned for the window by ${basisLabel}.`,
      });

      phase = `Read curated rule detections by ${basisLabel}`;
      phaseStartedMs = Date.now();
      try {
        const curatedPass: PassOutcome = await this.searchPass(
          client,
          window,
          result,
          budget,
          seen,
          { curated: true, bases: searchBases },
        );
        result.sourceCounts!.curatedDetections = curatedPass.returned;
        this.recordPass({
          result,
          name: phase,
          startedMs: phaseStartedMs,
          outcome: curatedPass,
          countMessage: `${curatedPass.returned} curated rule detections returned for the window by ${basisLabel}.`,
        });
      } catch (curatedError) {
        /*
         * Named differently from the outer catch on purpose: the guidance
         * accuracy test reads executeUnlocked's first catch clause, by its
         * variable name, as the run-failure path.
         */
        const status: number | null =
          GoogleSecOpsClient.readHttpStatus(curatedError);
        if (status === null || !CURATED_OPTIONAL_STATUSES.includes(status)) {
          throw curatedError;
        }
        const message: string = redactLogString(
          ConnectorErrorMessage.toMessage(curatedError),
        );
        result.warnings.push(
          `Curated rule detections could not be read (HTTP ${status}); this tenant may not have curated rule access. Rule detections and the alerts view were still read.`,
        );
        result.checks.push({
          name: phase,
          status: "warn",
          durationMs: Date.now() - phaseStartedMs,
          message,
        });
      }

      phase = "Read alerts view by detection time";
      phaseStartedMs = Date.now();
      const alertsPass: PassOutcome = await this.fetchWindows(
        client,
        window,
        result,
        budget,
        seen,
      );
      result.sourceCounts!.alertsView = alertsPass.returned;
      this.recordPass({
        result,
        name: phase,
        startedMs: phaseStartedMs,
        outcome: alertsPass,
        countMessage: `${alertsPass.returned} alerts returned by detection time.`,
        successMessage: `${alertsPass.returned} alerts returned by detection time. The configured Google SecOps instance is reachable and allows reading detections.`,
      });

      const alerts: Array<JSONObject> = Array.from(seen.values());
      result.fetchedCount = alerts.length;
      result.creationLag = this.measureCreationLag(alerts, connection, result);

      phase = "Normalize detections";
      phaseStartedMs = Date.now();
      const normalized: Array<NormalizedSecurityEvent> = [];
      for (const alert of alerts) {
        try {
          if (!GoogleSecOpsAlertNormalizer.isGoogleSecOpsAlert(alert)) {
            result.rejectedCount++;
            continue;
          }
          const event: NormalizedSecurityEvent =
            GoogleSecOpsAlertNormalizer.normalize(alert);
          normalized.push(event);
          if (result.samples.length < MAX_DIAGNOSTIC_SAMPLES) {
            result.samples.push(this.sample(alert, event));
          }
        } catch {
          result.failedCount++;
        }
      }
      if (result.rejectedCount) {
        /*
         * Counted and reported, never retried: an object Google returns
         * that is not a Collection is permanently unrecognizable, so
         * holding the cursor for it would pin the window until the 24 hour
         * chunk could never reach the present.
         */
        result.warnings.push(
          `${result.rejectedCount} returned objects were discarded because they do not look like Google SecOps detections. They are counted here and do not hold the poll cursor.`,
        );
      }
      if (result.failedCount) {
        result.warnings.push(
          `${result.failedCount} detections could not be normalized, so this window is not fully imported.`,
        );
      }
      result.complete = result.complete && result.failedCount === 0;
      result.checks.push({
        name: phase,
        status: result.failedCount
          ? "failed"
          : result.rejectedCount
            ? "warn"
            : "success",
        durationMs: Date.now() - phaseStartedMs,
        message: `${normalized.length} detections recognized; ${result.rejectedCount} rejected; ${result.failedCount} failed.`,
      });

      if (options.type === "poll" || options.type === "backfill") {
        phase = "Import detections";
        phaseStartedMs = Date.now();
        await this.ingest(connection, normalized, result);
        result.checks.push({
          name: phase,
          status: "success",
          durationMs: Date.now() - phaseStartedMs,
          message: `${result.ingestedCount} imported; ${result.duplicateCount} already imported.`,
        });
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
      result.checks.push({
        name: phase,
        status: "failed",
        durationMs: Date.now() - phaseStartedMs,
        message: result.error,
      });
    }
    let decision: CursorDecision | null = null;
    if (options.type === "poll") {
      decision = this.decideCursor(window, result);
      result.nextChunkMinutes = decision.nextChunkMinutes;
      if (decision.forcedAdvance) {
        result.forcedAdvance = true;
      }
      if (decision.warning) {
        /*
         * A forced advance leaves a reported gap, so it leads the warnings
         * (and therefore lastError); narrowing follows the reasons for it.
         */
        if (decision.forcedAdvance) {
          result.warnings.unshift(decision.warning);
        } else {
          result.warnings.push(decision.warning);
        }
      }
    }
    result.completedAt = OneUptimeDate.getCurrentDate().toISOString();
    result.durationMs = Math.max(0, Date.now() - startedMs);
    for (const warning of result.warnings) {
      logger.warn(
        `GoogleSecOpsPoller: connection ${connection.id!.toString()}: ${warning}`,
      );
    }
    logger.debug(
      `GoogleSecOpsPoller: connection ${connection.id!.toString()} fetched ${result.fetchedCount} alerts and ingested ${result.ingestedCount} security events for ${result.windowStart} to ${result.windowEnd}.`,
    );

    if (options.type === "poll" && decision) {
      await GoogleSecOpsConnectionService.updateOneById({
        id: connection.id!,
        data: {
          lastPolledAt: new Date(result.completedAt),
          lastPollResult: result as never,
          lastError: (result.error ||
            (result.complete
              ? null
              : result.warnings.join(" ") ||
                "Poll incomplete.")) as unknown as string,
          ...(decision.cursor ? { cursor: decision.cursor } : {}),
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
      await GoogleSecOpsConnectionService.updateOneById({
        id: connection.id!,
        data: { lastEventIngestedAt: new Date(result.completedAt) },
        props: { isRoot: true },
      });
    }
    return result;
  }

  /*
   * Where a scheduled poll leaves its cursor and how long the next chunk is.
   * Google's search endpoints return newest first, so a poll that stops
   * early has no "everything before here was read" point to resume from;
   * the only ways forward are a shorter window and, at one minute, moving
   * past the minute and reporting it.
   */
  private static decideCursor(
    window: PollWindow,
    result: GoogleSecOpsRunResult,
  ): CursorDecision {
    const chunkMinutes: number = window.chunkMinutes || MAX_CHUNK_MINUTES;
    const requestedChunkMinutes: number =
      window.requestedChunkMinutes || MAX_CHUNK_MINUTES;
    /*
     * A first poll that does not finish keeps its original start. Otherwise
     * the next default lookback would slide past records before we ever
     * imported them.
     */
    const heldCursor: string | undefined = window.hasUsableCursor
      ? undefined
      : OneUptimeDate.addRemoveMinutes(
          window.startTime,
          WINDOW_OVERLAP_IN_MINUTES,
        ).toISOString();

    /*
     * Failed and finished polls work from the requested chunk, not from the
     * window read: a caught-up window is only as long as the gap to now, and
     * keeping that as the next chunk would make polls after an outage or a
     * failure fall behind the present for no reason.
     */
    if (result.status === "failed") {
      // A failure says nothing about volume, so the chunk is kept as it was.
      return {
        cursor: heldCursor,
        nextChunkMinutes: requestedChunkMinutes,
        forcedAdvance: false,
      };
    }

    if (result.complete) {
      // A finished poll never shrinks the chunk; it doubles back after narrowing.
      return {
        cursor: result.windowEnd,
        nextChunkMinutes: Math.min(
          MAX_CHUNK_MINUTES,
          Math.max(requestedChunkMinutes, chunkMinutes * 2),
        ),
        forcedAdvance: false,
      };
    }

    if (chunkMinutes > MIN_CHUNK_MINUTES) {
      const nextChunkMinutes: number = Math.max(
        MIN_CHUNK_MINUTES,
        Math.floor(chunkMinutes / 2),
      );
      return {
        cursor: heldCursor,
        nextChunkMinutes,
        forcedAdvance: false,
        warning: `This window holds more records than one poll can read; the next poll reads a ${nextChunkMinutes} minute window from the same starting point.`,
      };
    }

    /*
     * One minute that still cannot be read. Holding here would stall polling
     * for good, so the cursor moves past the minute and the gap is reported
     * loudly with the way to recover it.
     */
    const from: Date = window.chunkBase || window.startTime;
    return {
      cursor: result.windowEnd,
      nextChunkMinutes: MIN_CHUNK_MINUTES,
      forcedAdvance: true,
      warning: `More records were created in the one minute from ${from.toISOString()} to ${result.windowEnd} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.`,
    };
  }

  /*
   * One diagnostic check per read pass. A pass a budget stopped, or never
   * let start, is a warning naming the budget, never a success: a green
   * step that did not read its window hid which data went unread.
   */
  private static recordPass(data: {
    result: GoogleSecOpsRunResult;
    name: string;
    startedMs: number;
    outcome: PassOutcome;
    // What the pass returned; the whole message when it read everything.
    countMessage: string;
    // Replaces countMessage when the pass read everything, if given.
    successMessage?: string | undefined;
  }): void {
    const outcome: PassOutcome = data.outcome;
    let status: GoogleSecOpsDiagnosticCheck["status"] = "success";
    let message: string = data.successMessage || data.countMessage;
    if (outcome.stoppedBy === "time" && outcome.requests === 0) {
      status = "warn";
      message = "Not run: the poll time budget was spent.";
      this.addWarning(
        data.result,
        `${data.name} was not run: the poll time budget was spent.`,
      );
    } else if (outcome.stoppedBy) {
      status = "warn";
      const budgetName: string =
        outcome.stoppedBy === "time" ? "poll time budget" : "request budget";
      const stop: string = `stopped by the ${budgetName} after ${outcome.requests} ${outcome.requests === 1 ? "request" : "requests"}`;
      message =
        outcome.requests === 0
          ? `Not run: ${stop}. The search passes share one page budget and it was spent before this pass started.`
          : `${data.countMessage} The pass was ${stop}.`;
      this.addWarning(data.result, `${data.name} was ${stop}.`);
    } else if (outcome.leftUnread) {
      status = "warn";
      message = `${data.countMessage} Google did not return part of the window.`;
    }
    data.result.checks.push({
      name: data.name,
      status,
      durationMs: Date.now() - data.startedMs,
      message,
    });
  }

  /*
   * The alerts-view pass (legacyFetchAlertsView, detection time). The
   * endpoint has no pagination, so a truncated window is split in half and
   * both halves are re-read until they fit or the alerts-view budget runs
   * out.
   */
  private static async fetchWindows(
    client: GoogleSecOpsClient,
    window: PollWindow,
    result: GoogleSecOpsRunResult,
    budget: PollBudget,
    seen: Map<string, JSONObject>,
  ): Promise<PassOutcome> {
    const outcome: PassOutcome = {
      returned: 0,
      requests: 0,
      stoppedBy: null,
      leftUnread: false,
    };
    const pending: Array<{ startTime: Date; endTime: Date }> = [
      { startTime: window.startTime, endTime: window.endTime },
    ];
    let splits: number = 0;
    while (pending.length > 0) {
      const stop: PassStop = this.budgetStop(
        budget,
        budget.alertsViewRequests,
        MAX_ALERTS_VIEW_REQUESTS_PER_POLL,
      );
      if (stop) {
        outcome.stoppedBy = stop;
        result.complete = false;
        break;
      }
      const current: { startTime: Date; endTime: Date } = pending.shift()!;
      budget.alertsViewRequests++;
      outcome.requests++;
      result.requestCount++;
      const fetched: FetchAlertsResult = await client.fetchDetectionAlerts({
        startTime: current.startTime,
        endTime: current.endTime,
        maxAlerts: result.type === "test" ? 1 : MAX_ALERTS_PER_REQUEST,
        includeNonAlertingDetections: result.includeNonAlertingDetections,
      });
      outcome.returned += fetched.alerts.length;
      for (const alert of fetched.alerts) {
        this.collect(seen, alert, result);
      }
      result.fetchedCount = seen.size;
      const truncated: boolean =
        fetched.truncatedByCount ||
        fetched.truncatedByBytes ||
        Math.max(fetched.filteredAlertsCount, fetched.baselineAlertsCount) >
          fetched.alerts.length;
      if (result.type === "test") {
        /*
         * A one-record permission probe is deliberately limited; it makes no
         * assertion about whether the full detection window can be imported.
         */
        result.complete = result.complete && fetched.complete;
        if (truncated) {
          result.warnings.push(
            "Connection test reads at most one detection. Use Preview to inspect the full time range.",
          );
        }
        if (!fetched.complete) {
          result.warnings.push(
            "Google returned an incomplete response. Connectivity works, but a complete read is not confirmed.",
          );
        }
        break;
      }
      const midpoint: number = Math.floor(
        (current.startTime.getTime() + current.endTime.getTime()) / 2,
      );
      if (
        truncated &&
        current.endTime.getTime() - current.startTime.getTime() > 1000
      ) {
        splits++;
        pending.unshift(
          { startTime: current.startTime, endTime: new Date(midpoint) },
          { startTime: new Date(midpoint), endTime: current.endTime },
        );
      } else if (!fetched.complete || truncated) {
        result.complete = false;
        outcome.leftUnread = true;
        this.addWarning(
          result,
          truncated
            ? "Google still truncated a one-second window of the alerts view, so some alerts in it were not read."
            : "Google ended an alerts view response without confirming it was complete.",
        );
      }
    }
    if (splits > 0) {
      // One line rather than one per split: lastError joins every warning.
      result.warnings.push(
        `Google limited the alerts view response for ${window.startTime.toISOString()} to ${window.endTime.toISOString()}, so it was split into smaller windows ${splits} ${splits === 1 ? "time" : "times"}.`,
      );
    }
    return outcome;
  }

  /*
   * A detections-search pass (legacySearchDetections or the curated
   * variant), one basis at a time, following nextPageToken under the page
   * budget the two search passes share.
   */
  private static async searchPass(
    client: GoogleSecOpsClient,
    window: PollWindow,
    result: GoogleSecOpsRunResult,
    budget: PollBudget,
    seen: Map<string, JSONObject>,
    options: { curated: boolean; bases: Array<GoogleSecOpsListBasis> },
  ): Promise<PassOutcome> {
    const label: string = options.curated
      ? "curated rule detections"
      : "rule detections";
    const outcome: PassOutcome = {
      returned: 0,
      requests: 0,
      stoppedBy: null,
      leftUnread: false,
    };
    for (const listBasis of options.bases) {
      let pageToken: string | undefined = undefined;
      do {
        const stop: PassStop = this.budgetStop(
          budget,
          budget.searchRequests,
          MAX_SEARCH_PAGES_PER_POLL,
        );
        if (stop) {
          outcome.stoppedBy = stop;
          result.complete = false;
          return outcome;
        }
        budget.searchRequests++;
        outcome.requests++;
        result.requestCount++;
        const page: SearchDetectionsResult = await client.searchDetections({
          startTime: window.startTime,
          endTime: window.endTime,
          listBasis,
          alertingOnly: !result.includeNonAlertingDetections,
          pageSize: result.type === "test" ? 1 : MAX_SEARCH_PAGE_SIZE,
          pageToken,
          curated: options.curated,
        });
        outcome.returned += page.detections.length;
        for (const detection of page.detections) {
          this.collect(seen, detection, result);
        }
        result.fetchedCount = seen.size;
        if (page.truncated) {
          /*
           * respTooLargeDetectionsTruncated: Google cut the page by byte
           * size and the rest is not reachable through a page token, so the
           * window is not fully read.
           */
          result.complete = false;
          outcome.leftUnread = true;
          this.addWarning(
            result,
            `Google truncated a page of ${label} by size for ${window.startTime.toISOString()} to ${window.endTime.toISOString()}, so part of the window was not read.`,
          );
        }
        if (result.type === "test") {
          // One record per pass is all a permission probe needs.
          return outcome;
        }
        pageToken = page.nextPageToken || undefined;
      } while (pageToken);
    }
    return outcome;
  }

  /*
   * Whether a pass may make another request: each kind of read has its own
   * request count, and all of them share the poll's wall-clock bound so a
   * slow endpoint cannot run the worker job into its timeout.
   */
  private static budgetStop(
    budget: PollBudget,
    used: number,
    limit: number,
  ): PassStop {
    if (used >= limit) {
      return "requests";
    }
    if (Date.now() - budget.startedMs >= MAX_FETCH_DURATION_MS) {
      return "time";
    }
    return null;
  }

  // Repeated conditions (every one-second window, every page) are said once.
  private static addWarning(
    result: GoogleSecOpsRunResult,
    warning: string,
  ): void {
    if (!result.warnings.includes(warning)) {
      result.warnings.push(warning);
    }
  }

  /*
   * Union by Collection.id across passes and across the alerts view's
   * chunks; a record with no id falls back to a content hash, and an
   * object that cannot even be inspected is kept under a positional key so
   * it is counted as rejected without hiding the valid records beside it.
   */
  private static collect(
    seen: Map<string, JSONObject>,
    record: JSONObject,
    result: GoogleSecOpsRunResult,
  ): void {
    let key: string;
    try {
      key = readString(record, "id") || contentHashEventUid(record);
    } catch {
      key = `malformed:${result.requestCount}:${seen.size}`;
    }
    seen.set(key, record);
  }

  /*
   * createdTime minus detectionTime over what was fetched. A lag beyond one
   * poll interval is the record a detection-time cursor skips, so the
   * warning names the reason polling reads created time.
   */
  private static measureCreationLag(
    alerts: Array<JSONObject>,
    connection: GoogleSecOpsConnection,
    result: GoogleSecOpsRunResult,
  ): GoogleSecOpsCreationLag {
    const intervalInMinutes: number = Math.max(
      1,
      connection.pollIntervalInMinutes || DEFAULT_POLL_INTERVAL_IN_MINUTES,
    );
    const thresholdInMinutes: number =
      intervalInMinutes + CREATION_LAG_GRACE_IN_MINUTES;
    let measured: number = 0;
    let lateCount: number = 0;
    let maxLagMs: number = 0;
    for (const alert of alerts) {
      let detectionTime: Date | null = null;
      let createdTime: Date | null = null;
      try {
        detectionTime = parseEventTime(
          readValue(alert, "detectionTime") ??
            readValue(alert, "detection_time"),
        );
        createdTime = parseEventTime(
          readValue(alert, "createdTime") ?? readValue(alert, "created_time"),
        );
      } catch {
        continue;
      }
      if (!detectionTime || !createdTime) {
        continue;
      }
      measured++;
      const lagMs: number = createdTime.getTime() - detectionTime.getTime();
      if (lagMs > maxLagMs) {
        maxLagMs = lagMs;
      }
      if (lagMs > thresholdInMinutes * 60 * 1000) {
        lateCount++;
      }
    }
    const lag: GoogleSecOpsCreationLag = {
      measured,
      lateCount,
      maxLagMinutes: Math.round(maxLagMs / 60000),
    };
    if (lateCount > 0) {
      result.warnings.push(
        `${lateCount} of ${measured} detections were created more than ${thresholdInMinutes} minutes after their detection time (up to ${lag.maxLagMinutes} minutes). This is why the connector polls by created time: a cursor over detection time would already have moved past them.`,
      );
    }
    return lag;
  }

  private static sample(
    alert: JSONObject,
    event: NormalizedSecurityEvent,
  ): GoogleSecOpsDetectionSample {
    const detectionTime: Date | null = parseEventTime(
      readValue(alert, "detectionTime") ?? readValue(alert, "detection_time"),
    );
    const createdTime: Date | null = parseEventTime(
      readValue(alert, "createdTime") ?? readValue(alert, "created_time"),
    );
    const detection: unknown = readValue(alert, "detection");
    const entry: JSONObject | undefined = Array.isArray(detection)
      ? (detection[0] as JSONObject)
      : (detection as JSONObject | undefined);
    const isAlert: unknown = entry
      ? entry["alertState"] ?? entry["alert_state"] ?? entry["alerting"]
      : undefined;
    return {
      id: redactLogString(event.eventUid),
      ruleName: redactLogString(event.ruleName),
      ...(detectionTime ? { detectionTime: detectionTime.toISOString() } : {}),
      ...(createdTime ? { createdTime: createdTime.toISOString() } : {}),
      ...(typeof isAlert === "boolean"
        ? { isAlert }
        : isAlert === "ALERTING"
          ? { isAlert: true }
          : isAlert === "NOT_ALERTING" || isAlert === "NON_ALERTING"
            ? { isAlert: false }
            : {}),
    };
  }

  /**
   * Thin delegate kept as a static on this class: existing tests spy on it,
   * and the query itself now lives in SecurityEventDedupe so the Google
   * poller and the Security Event Connections poller cannot drift.
   */
  public static async findExistingEventUids(
    projectId: ObjectID,
    ids: Array<string>,
  ): Promise<Set<string>> {
    return SecurityEventDedupe.findExistingEventUids({
      projectId,
      vendorName: SECOPS_VENDOR_NAME,
      productName: SECOPS_SERVICE_NAME,
      ids,
    });
  }

  private static async ingest(
    connection: GoogleSecOpsConnection,
    normalized: Array<NormalizedSecurityEvent>,
    result: GoogleSecOpsRunResult,
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
    const existing: Set<string> = await this.findExistingEventUids(
      connection.projectId!,
      unique.map((event: NormalizedSecurityEvent): string => {
        return event.eventUid;
      }),
    );
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
        serviceName: SECOPS_SERVICE_NAME,
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
        event.attributes["oneuptime.google_secops.connection_id"] =
          connection.id!.toString();
        return buildSecurityEventDbRow({
          normalized: event,
          projectId: connection.projectId!,
          serviceMetadata,
          retentionDays,
        });
      },
    );
    /*
     * The source lock cannot be released before buffered writes are visible.
     * This low-volume connector needs synchronous acknowledgements regardless
     * of the high-volume telemetry ingestion defaults.
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

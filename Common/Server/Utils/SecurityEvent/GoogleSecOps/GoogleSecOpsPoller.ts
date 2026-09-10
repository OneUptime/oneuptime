import { ResponseJSON, ResultSet } from "@clickhouse/client";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import {
  getClickhouseClusterName,
  getClickhouseDatabaseName,
  getStorageTableName,
} from "../../AnalyticsDatabase/ClusterConfig";
import { getQuerySettings } from "../../AnalyticsDatabase/QuerySettingsHelper";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  GoogleSecOpsDetectionSample,
  GoogleSecOpsRunOptions,
  GoogleSecOpsRunResult,
} from "../../../../Types/SecurityEvent/GoogleSecOpsDiagnostics";
import {
  contentHashEventUid,
  parseEventTime,
  readString,
  readValue,
} from "../../../../Utils/SecurityEvent/NormalizerHelpers";
import Semaphore, { SemaphoreMutex } from "../../../Infrastructure/Semaphore";
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
import { buildSecurityEventDbRow } from "../SecurityEventRow";
import ThreatIntelEnricher from "../ThreatIntel/ThreatIntelEnricher";
import GoogleSecOpsClient, { FetchAlertsResult } from "./GoogleSecOpsClient";

const SECOPS_SERVICE_NAME: string = "Google SecOps";

const DEFAULT_LOOKBACK_IN_MINUTES: number = 15;
const MAX_LOOKBACK_IN_MINUTES: number = 24 * 60;
const WINDOW_OVERLAP_IN_MINUTES: number = 1;
const MAX_FETCH_REQUESTS: number = 12;
const MAX_FETCH_DURATION_MS: number = 2 * 60 * 1000;
const MAX_ALERTS_PER_REQUEST: number = 1000;
const MAX_DIAGNOSTIC_SAMPLES: number = 25;
const MAX_RANGE_MS: number = 7 * 24 * 60 * 60 * 1000;
export const GOOGLE_SECOPS_SOURCE_LOCK_NAMESPACE: string = "GoogleSecOpsSource";

interface PollWindow {
  startTime: Date;
  endTime: Date;
  warnings: Array<string>;
  hasUsableCursor: boolean;
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

    const mutex: SemaphoreMutex = await Semaphore.lock({
      namespace: GOOGLE_SECOPS_SOURCE_LOCK_NAMESPACE,
      key: connection.projectId!.toString(),
      lockTimeout: 30000,
      acquireTimeout: 10000,
      retryInterval: 100,
    });
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
    } else if (options.type === "poll" && connection.cursor) {
      const cursorTime: Date = new Date(connection.cursor);
      if (!Number.isFinite(cursorTime.getTime())) {
        warnings.push(
          "The saved cursor is unreadable; polling the default 15 minute window.",
        );
      } else if (cursorTime >= now) {
        warnings.push(
          "The saved cursor is in the future; polling the default 15 minute window.",
        );
      } else {
        hasUsableCursor = true;
        startTime = OneUptimeDate.addRemoveMinutes(
          cursorTime,
          -WINDOW_OVERLAP_IN_MINUTES,
        );
        const chunkEnd: Date = OneUptimeDate.addRemoveMinutes(
          startTime,
          MAX_LOOKBACK_IN_MINUTES,
        );
        if (chunkEnd < endTime) {
          endTime = chunkEnd;
          warnings.push(
            "Catching up from the saved cursor in 24 hour windows. Later detections will be fetched by subsequent polls.",
          );
        }
      }
    }
    return { startTime, endTime, warnings, hasUsableCursor };
  }

  private static async executeUnlocked(
    connection: GoogleSecOpsConnection,
    options: GoogleSecOpsRunOptions,
    clientOverride?: GoogleSecOpsClient | undefined,
  ): Promise<GoogleSecOpsRunResult> {
    const window: PollWindow = this.getWindow(connection, options);
    const startedMs: number = Date.now();
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
      phase = "Read detections from the configured instance";
      phaseStartedMs = Date.now();
      const alerts: Array<JSONObject> = await this.fetchWindows(
        client,
        window,
        result,
        startedMs,
      );
      result.fetchedCount = alerts.length;
      result.checks.push({
        name: phase,
        status: "success",
        durationMs: Date.now() - phaseStartedMs,
        message:
          "The configured Google SecOps instance is reachable and allows reading detections.",
      });

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
        result.warnings.push(
          `${result.rejectedCount} returned objects were discarded because they do not look like Google SecOps detections.`,
        );
      }
      if (result.failedCount) {
        result.warnings.push(
          `${result.failedCount} detections could not be normalized. The poll cursor is held for retry.`,
        );
      }
      result.complete =
        result.complete &&
        result.failedCount === 0 &&
        result.rejectedCount === 0;
      result.checks.push({
        name: phase,
        status:
          result.failedCount || result.rejectedCount ? "failed" : "success",
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

    if (options.type === "poll") {
      /*
       * A failed first poll must keep its original start. Otherwise the next
       * default lookback would slide past records before we ever imported them.
       */
      const cursor: string | undefined = result.complete
        ? result.windowEnd
        : !window.hasUsableCursor
          ? OneUptimeDate.addRemoveMinutes(
              window.startTime,
              WINDOW_OVERLAP_IN_MINUTES,
            ).toISOString()
          : undefined;
      await GoogleSecOpsConnectionService.updateOneById({
        id: connection.id!,
        data: {
          lastPolledAt: new Date(result.completedAt),
          lastPollResult: result as never,
          lastError: (result.error ||
            (result.complete
              ? null
              : result.warnings.join(" ") ||
                "Poll incomplete; retrying the same window.")) as unknown as string,
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
      await GoogleSecOpsConnectionService.updateOneById({
        id: connection.id!,
        data: { lastEventIngestedAt: new Date(result.completedAt) },
        props: { isRoot: true },
      });
    }
    return result;
  }

  private static async fetchWindows(
    client: GoogleSecOpsClient,
    window: PollWindow,
    result: GoogleSecOpsRunResult,
    startedMs: number,
  ): Promise<Array<JSONObject>> {
    const pending: Array<{ startTime: Date; endTime: Date }> = [window];
    const seen: Map<string, JSONObject> = new Map();
    while (pending.length > 0) {
      if (
        result.requestCount >= MAX_FETCH_REQUESTS ||
        Date.now() - startedMs >= MAX_FETCH_DURATION_MS
      ) {
        result.complete = false;
        result.warnings.push(
          "The recovery request limit was reached. Narrow the time range; the poll cursor has not advanced.",
        );
        break;
      }
      const current: { startTime: Date; endTime: Date } = pending.shift()!;
      result.requestCount++;
      const fetched: FetchAlertsResult = await client.fetchDetectionAlerts({
        ...current,
        maxAlerts: result.type === "test" ? 1 : MAX_ALERTS_PER_REQUEST,
        includeNonAlertingDetections: result.includeNonAlertingDetections,
      });
      for (const alert of fetched.alerts) {
        let key: string;
        try {
          key = readString(alert, "id") || contentHashEventUid(alert);
        } catch {
          /*
           * Keep an uninspectable object in the normalization failure count
           * without preventing valid detections in this response from importing.
           */
          key = `malformed:${result.requestCount}:${seen.size}`;
        }
        seen.set(key, alert);
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
        result.complete = fetched.complete;
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
        result.warnings.push(
          `Google limited the response for ${current.startTime.toISOString()} to ${current.endTime.toISOString()}; retrying smaller windows.`,
        );
        pending.unshift(
          { startTime: current.startTime, endTime: new Date(midpoint) },
          { startTime: new Date(midpoint), endTime: current.endTime },
        );
      } else if (!fetched.complete || truncated) {
        result.complete = false;
        result.warnings.push(
          truncated
            ? "Google still truncated a one-second window. Some detections may be missing; the cursor has not advanced."
            : "Google ended the response without confirming it was complete; the cursor has not advanced.",
        );
      }
    }
    return Array.from(seen.values());
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
   * This is a correctness lookup, not a dashboard query: returning a partial
   * result on timeout or reading a lagging replica would create duplicates.
   * Read every replica and fail closed on an unavailable shard. The preceding
   * source lock plus synchronous inserts make at least one replica contain
   * every earlier acknowledged import before this query begins.
   */
  public static async findExistingEventUids(
    projectId: ObjectID,
    ids: Array<string>,
  ): Promise<Set<string>> {
    const existing: Set<string> = new Set();
    const startedMs: number = Date.now();
    for (
      let offset: number = 0;
      offset < ids.length;
      offset += MAX_ALERTS_PER_REQUEST
    ) {
      if (Date.now() - startedMs >= 2 * 60 * 1000) {
        throw new Error(
          "Duplicate lookup exceeded its time limit. Retry a smaller import window.",
        );
      }
      const statement: Statement = SQL`SELECT DISTINCT eventUid FROM clusterAllReplicas(
        ${{ type: TableColumnType.Text, value: getClickhouseClusterName() }},
        ${{ type: TableColumnType.Text, value: getClickhouseDatabaseName() }},
        ${{ type: TableColumnType.Text, value: getStorageTableName(SecurityEventService.model.tableName) }}
      ) WHERE projectId = ${{ type: TableColumnType.ObjectID, value: projectId }}
        AND vendorName = ${{ type: TableColumnType.Text, value: "Google" }}
        AND productName = ${{ type: TableColumnType.Text, value: SECOPS_SERVICE_NAME }}
        AND eventUid IN ${{ type: TableColumnType.ArrayText, value: ids.slice(offset, offset + MAX_ALERTS_PER_REQUEST) }}`;
      statement.append(
        getQuerySettings({
          maxExecutionTimeInSeconds: 30,
          timeoutOverflowMode: "throw",
          boundScanMemory: true,
          additionalSettings: { skip_unavailable_shards: 0 },
        }),
      );
      const response: ResultSet<"JSON"> =
        await SecurityEventService.executeQuery(statement);
      const data: ResponseJSON<JSONObject> = await response.json<JSONObject>();
      for (const row of data.data) {
        if (typeof row["eventUid"] === "string") {
          existing.add(row["eventUid"]);
        }
      }
    }
    return existing;
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

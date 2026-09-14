import BadDataException from "../../../../Types/Exception/BadDataException";
import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SecurityConnectorCheck } from "../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
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
  ConnectorFetchResult,
  SecurityConnectorSettings,
  SecurityEventConnector,
} from "./Types";

/*
 * The generic pull loop behind every Security Event Connection.
 *
 * Window and cursor rules, in order of what they protect against:
 *  - the first poll looks back a full day (INITIAL_LOOKBACK), so a new
 *    connection shows the customer their recent records immediately
 *    instead of an empty window they read as "broken";
 *  - every later poll starts one minute before the saved cursor, so a
 *    record created on a window boundary is never skipped (the dedupe
 *    lookup makes the overlap harmless);
 *  - a poll covers at most one day; a stale cursor catches up in daily
 *    chunks instead of skipping to today;
 *  - the cursor only moves when the window was read completely. A bound
 *    hit, a truncated page or a normalization failure holds it, so the
 *    next poll re-reads the same window instead of losing what it missed.
 *
 * The window is on the SOURCE'S CREATION TIME, never the underlying event
 * time (see Connectors/Types.ts).
 */

export const DEFAULT_INITIAL_LOOKBACK_IN_MINUTES: number = 24 * 60;
export const MAX_LOOKBACK_IN_MINUTES: number = 24 * 60;
export const WINDOW_OVERLAP_IN_MINUTES: number = 1;
export const MAX_FETCH_REQUESTS: number = 20;
export const MAX_EVENTS_PER_RUN: number = 10000;
export const MAX_DIAGNOSTIC_SAMPLES: number = 25;
export const MAX_RANGE_MS: number = 7 * 24 * 60 * 60 * 1000;
export const POLL_REQUEST_TIMEOUT_IN_MS: number = 60 * 1000;
export const SECURITY_EVENT_SOURCE_LOCK_NAMESPACE: string =
  "SecurityEventConnectionSource";

interface PollWindow {
  startTime: Date;
  endTime: Date;
  warnings: Array<string>;
  hasUsableCursor: boolean;
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
    } else if (options.type === "poll" && connection.cursor) {
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
            "Catching up from the saved cursor in 24 hour windows. Later records will be fetched by subsequent polls.",
          );
        }
      }
    }

    return { startTime, endTime, warnings, hasUsableCursor };
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
        const checks: Array<SecurityConnectorCheck> =
          await connector.testConnection(settings, {
            requestTimeoutInMs: POLL_REQUEST_TIMEOUT_IN_MS,
          });
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
        phase = `Read ${definition.importedRecordName}s from ${definition.title}`;
        phaseStartedMs = Date.now();
        const fetched: ConnectorFetchResult = await connector.fetchEvents(
          settings,
          { startTime: window.startTime, endTime: window.endTime },
          {
            maxRequests: MAX_FETCH_REQUESTS,
            maxEvents: MAX_EVENTS_PER_RUN,
            requestTimeoutInMs: POLL_REQUEST_TIMEOUT_IN_MS,
            sampleLimit: MAX_DIAGNOSTIC_SAMPLES,
          },
        );

        result.fetchedCount = fetched.fetchedCount;
        result.rejectedCount = fetched.rejectedCount;
        result.failedCount = fetched.failedCount;
        result.requestCount = fetched.requestCount;
        result.samples = fetched.samples.slice(0, MAX_DIAGNOSTIC_SAMPLES);
        result.warnings.push(...fetched.warnings);
        /*
         * Rejected objects are not a reason to hold the cursor: a record the
         * normalizer does not recognize will not become recognizable by
         * re-reading the same window, so holding would pin polling behind it
         * until the window can no longer reach the present. They are counted
         * and warned about instead. Normalization FAILURES still hold the
         * cursor, since a transient bug or a payload the next release parses
         * deserves a retry.
         */
        result.complete =
          result.complete && fetched.complete && fetched.failedCount === 0;

        if (fetched.rejectedCount) {
          result.warnings.push(
            `${fetched.rejectedCount} returned records were discarded because they do not look like ${definition.title} ${definition.importedRecordName}s.`,
          );
        }

        if (fetched.failedCount) {
          result.warnings.push(
            `${fetched.failedCount} records could not be normalized. The poll cursor is held for retry.`,
          );
        }

        result.checks.push({
          key: "read",
          name: phase,
          status: fetched.failedCount
            ? "fail"
            : fetched.rejectedCount
              ? "warn"
              : "pass",
          durationMs: Date.now() - phaseStartedMs,
          message: `${fetched.events.length} ${definition.importedRecordName}s recognized; ${fetched.rejectedCount} rejected; ${fetched.failedCount} failed; ${fetched.requestCount} request${fetched.requestCount === 1 ? "" : "s"}.`,
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
      result.checks.push({
        key: "failure",
        name: phase,
        status: "fail",
        durationMs: Date.now() - phaseStartedMs,
        message: result.error,
      });
    }

    result.completedAt = OneUptimeDate.getCurrentDate().toISOString();
    result.durationMs = Math.max(0, Date.now() - startedMs);

    for (const warning of result.warnings) {
      logger.warn(
        `SecurityEventConnectionPoller: connection ${connection.id!.toString()}: ${warning}`,
      );
    }

    if (options.type === "poll") {
      const cursor: string | undefined = result.complete
        ? result.windowEnd
        : !window.hasUsableCursor
          ? OneUptimeDate.addRemoveMinutes(
              window.startTime,
              WINDOW_OVERLAP_IN_MINUTES,
            ).toISOString()
          : undefined;

      await SecurityEventConnectionService.updateOneById({
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
      await SecurityEventConnectionService.updateOneById({
        id: connection.id!,
        data: { lastEventIngestedAt: new Date(result.completedAt) },
        props: { isRoot: true },
      });
    }

    return result;
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
        event.attributes["oneuptime.security_connection.id"] =
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
 * decrypting service read and the in-lock reload, exactly like the
 * injected client in GoogleSecOpsPoller.
 */
export interface PollerOverrides {
  connector?: SecurityEventConnector | undefined;
  settings?: SecurityConnectorSettings | undefined;
}

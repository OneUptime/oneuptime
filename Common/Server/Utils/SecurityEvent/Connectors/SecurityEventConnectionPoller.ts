import { ResponseJSON, ResultSet } from "@clickhouse/client";
import { createHash } from "crypto";
import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityEventConnectorResult from "../../../../Types/SecurityEvent/SecurityEventConnectorResult";
import GenericNormalizer from "../../../../Utils/SecurityEvent/GenericNormalizer";
import VendorSecurityEventNormalizer from "../../../../Utils/SecurityEvent/VendorSecurityEventNormalizer";
import {
  getClickhouseClusterName,
  getClickhouseDatabaseName,
  getStorageTableName,
} from "../../AnalyticsDatabase/ClusterConfig";
import { getQuerySettings } from "../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../../Infrastructure/Semaphore";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../Services/OpenTelemetryIngestService";
import SecurityEventConnectionService, {
  SecurityEventPollingCheckpointUpdate,
  validateSecurityEventConnection,
} from "../../../Services/SecurityEventConnectionService";
import SecurityEventService from "../../../Services/SecurityEventService";
import { resolveTelemetryRetentionInDays } from "../../../../Types/Telemetry/TelemetryRetentionConfig";
import logger from "../../Logger";
import { redactLogString } from "../../LogRedaction";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import { buildSecurityEventDbRow } from "../SecurityEventRow";
import ThreatIntelEnricher from "../ThreatIntel/ThreatIntelEnricher";
import SecurityEventConnectorClientFactory from "./SecurityEventConnectorClientFactory";
import {
  SecurityEventConnectorClient,
  SecurityEventConnectorFetchResult,
} from "./Types";

const DEFAULT_LOOKBACK_MS: number = 15 * 60 * 1000;
const MAX_WINDOW_MS: number = 24 * 60 * 60 * 1000;
const OVERLAP_MS: number = 60 * 1000;
const UID_BATCH_SIZE: number = 1000;
const MIN_RETRY_WINDOW_MS: number = 1000;
const MAX_SPLIT_ATTEMPTS: number = 20;
const MAX_SAME_CONTINUATION_ATTEMPTS: number = 3;
const MAX_CONTINUATION_BATCHES: number = 20;
const MAX_OPERATION_FAILURE_ATTEMPTS: number = 3;
const CONNECTION_LOCK_TIMEOUT_MS: number = 15 * 60 * 1000;
export const SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY: number = 4;
export const SECURITY_EVENT_CONNECTION_POLL_DEADLINE_MS: number = 8 * 60 * 1000;
export const SECURITY_EVENT_CONNECTION_SWEEP_START_BUDGET_MS: number =
  2 * 60 * 1000;
export const SECURITY_EVENT_CONNECTION_LOCK_NAMESPACE: string =
  "SecurityEventConnectionSource";
export const SECURITY_EVENT_CONNECTION_SWEEP_LOCK_NAMESPACE: string =
  "SecurityEventConnectionSweep";

interface PollWindow {
  startTime: Date;
  endTime: Date;
  hasCursor: boolean;
  isPinned: boolean;
  attempt: number;
  continuationCount: number;
  continuation?: JSONObject | undefined;
}

interface StoredCursor {
  version: 1;
  nextStart: string;
  endTime?: string | undefined;
  attempt?: number | undefined;
  continuationCount?: number | undefined;
  continuation?: JSONObject | undefined;
}

class InvalidSecurityEventConnectionCursorError extends Error {}
class SecurityEventConnectionStartBudgetExceededError extends Error {
  public constructor() {
    super("Security event connection sweep start budget was exceeded.");
  }
}
class SecurityEventConnectionDeadlineError extends Error {
  public constructor() {
    super("Security event connection exceeded its 8-minute polling deadline.");
  }
}

export default class SecurityEventConnectionPoller {
  private static isDue(
    connection: SecurityEventConnection,
    now: number,
  ): boolean {
    const interval: number = Math.max(1, connection.pollIntervalInMinutes || 5);
    return !(
      connection.lastPolledAt &&
      connection.lastPolledAt.getTime() + interval * 60_000 > now
    );
  }

  public static async pollAllDueConnections(): Promise<void> {
    let sweepMutex: SemaphoreMutex;
    try {
      sweepMutex = await Semaphore.lock({
        namespace: SECURITY_EVENT_CONNECTION_SWEEP_LOCK_NAMESPACE,
        key: "all",
        lockTimeout: CONNECTION_LOCK_TIMEOUT_MS,
        acquireTimeout: 100,
        retryInterval: 100,
      });
    } catch (error) {
      if (error instanceof SemaphoreLockTimeoutError) {
        return;
      }
      throw error;
    }
    try {
      const stopStartingAt: number =
        Date.now() + SECURITY_EVENT_CONNECTION_SWEEP_START_BUDGET_MS;
      const connections: Array<SecurityEventConnection> = [];
      let skip: number = 0;
      let page: Array<SecurityEventConnection>;
      do {
        page = await SecurityEventConnectionService.findBy({
          query: { isEnabled: true },
          select: {
            _id: true,
            pollIntervalInMinutes: true,
            lastPolledAt: true,
            createdAt: true,
          },
          skip,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        });
        connections.push(...page);
        skip += page.length;
      } while (page.length === LIMIT_MAX);
      const now: number = Date.now();
      const dueConnections: Array<SecurityEventConnection> = connections.filter(
        (connection: SecurityEventConnection): boolean => {
          return this.isDue(connection, now);
        },
      );
      dueConnections.sort(
        (
          left: SecurityEventConnection,
          right: SecurityEventConnection,
        ): number => {
          const leftTime: number = left.lastPolledAt
            ? left.lastPolledAt.getTime() +
              Math.max(1, left.pollIntervalInMinutes || 5) * 60_000
            : left.createdAt?.getTime() || Number.MIN_SAFE_INTEGER;
          const rightTime: number = right.lastPolledAt
            ? right.lastPolledAt.getTime() +
              Math.max(1, right.pollIntervalInMinutes || 5) * 60_000
            : right.createdAt?.getTime() || Number.MIN_SAFE_INTEGER;
          return (
            leftTime - rightTime ||
            (left.id?.toString() || "").localeCompare(
              right.id?.toString() || "",
            )
          );
        },
      );

      let nextIndex: number = 0;
      await Promise.all(
        Array.from(
          {
            length: Math.min(
              SECURITY_EVENT_CONNECTION_POLL_CONCURRENCY,
              dueConnections.length,
            ),
          },
          async (): Promise<void> => {
            while (nextIndex < dueConnections.length) {
              if (Date.now() >= stopStartingAt) {
                return;
              }

              const scheduledConnection: SecurityEventConnection =
                dueConnections[nextIndex++]!;
              const connectionId: ObjectID | null = scheduledConnection.id;
              if (!connectionId) {
                continue;
              }

              try {
                const connection: SecurityEventConnection | null =
                  await SecurityEventConnectionService.findOneBy({
                    query: {
                      _id: connectionId.toString(),
                      isEnabled: true,
                    },
                    select: {
                      _id: true,
                      projectId: true,
                      provider: true,
                      configuration: true,
                      credentialJson: true,
                      sourceGeneration: true,
                      pollIntervalInMinutes: true,
                      lastPolledAt: true,
                      cursor: true,
                      createdAt: true,
                      version: true,
                      isEnabled: true,
                    },
                    props: { isRoot: true },
                  });

                if (
                  !connection ||
                  !connection.isEnabled ||
                  !this.isDue(connection, Date.now())
                ) {
                  continue;
                }
                if (Date.now() >= stopStartingAt) {
                  return;
                }

                await this.pollConnection(
                  connection,
                  undefined,
                  stopStartingAt,
                );
              } catch (error) {
                if (
                  error instanceof
                  SecurityEventConnectionStartBudgetExceededError
                ) {
                  return;
                }
                logger.error(
                  `SecurityEventConnectionPoller: ${connectionId.toString()}: ${redactLogString(
                    ConnectorErrorMessage.toMessage(error, { truncate: false }),
                  )}`,
                );
              }
            }
          },
        ),
      );
    } finally {
      await Semaphore.release(sweepMutex);
    }
  }

  private static parseStoredCursor(value: string): StoredCursor | null {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      const cursor: Record<string, unknown> = parsed as Record<string, unknown>;
      if (cursor["version"] !== 1 || typeof cursor["nextStart"] !== "string") {
        return null;
      }
      const continuation: unknown = cursor["continuation"];
      if (
        continuation !== undefined &&
        (!continuation ||
          typeof continuation !== "object" ||
          Array.isArray(continuation))
      ) {
        return null;
      }
      for (const key of ["attempt", "continuationCount"]) {
        if (
          cursor[key] !== undefined &&
          (!Number.isInteger(cursor[key]) || Number(cursor[key]) < 0)
        ) {
          return null;
        }
      }
      return {
        version: 1,
        nextStart: cursor["nextStart"],
        ...(typeof cursor["endTime"] === "string"
          ? { endTime: cursor["endTime"] }
          : {}),
        ...(Number.isInteger(cursor["attempt"])
          ? { attempt: cursor["attempt"] as number }
          : {}),
        ...(Number.isInteger(cursor["continuationCount"])
          ? { continuationCount: cursor["continuationCount"] as number }
          : {}),
        ...(continuation ? { continuation: continuation as JSONObject } : {}),
      };
    } catch {
      return null;
    }
  }

  private static encodeStoredCursor(data: {
    nextStart: Date;
    endTime?: Date | undefined;
    attempt?: number | undefined;
    continuationCount?: number | undefined;
    continuation?: JSONObject | undefined;
  }): string {
    const cursor: StoredCursor = {
      version: 1,
      nextStart: data.nextStart.toISOString(),
      ...(data.endTime ? { endTime: data.endTime.toISOString() } : {}),
      ...(data.attempt ? { attempt: data.attempt } : {}),
      ...(data.continuationCount
        ? { continuationCount: data.continuationCount }
        : {}),
      ...(data.continuation ? { continuation: data.continuation } : {}),
    };
    return JSON.stringify(cursor);
  }

  private static getWindow(connection: SecurityEventConnection): PollWindow {
    const now: Date = new Date();
    if (connection.cursor) {
      const stored: StoredCursor | null = this.parseStoredCursor(
        connection.cursor,
      );
      if (stored) {
        const startTime: Date = new Date(stored.nextStart);
        const storedEndTime: Date | null = stored.endTime
          ? new Date(stored.endTime)
          : null;
        if (
          Number.isFinite(startTime.getTime()) &&
          startTime.getTime() <= now.getTime() &&
          (!storedEndTime ||
            (Number.isFinite(storedEndTime.getTime()) &&
              storedEndTime > startTime))
        ) {
          const endTime: Date = storedEndTime
            ? new Date(Math.min(storedEndTime.getTime(), now.getTime()))
            : new Date(
                Math.min(now.getTime(), startTime.getTime() + MAX_WINDOW_MS),
              );
          return {
            startTime,
            endTime,
            hasCursor: true,
            isPinned: Boolean(storedEndTime),
            attempt: Math.max(0, stored.attempt || 0),
            continuationCount: Math.max(0, stored.continuationCount || 0),
            ...(stored.continuation
              ? { continuation: stored.continuation }
              : {}),
          };
        }
      }

      const cursor: Date = new Date(connection.cursor);
      if (
        Number.isFinite(cursor.getTime()) &&
        cursor.getTime() <= now.getTime()
      ) {
        const startTime: Date = new Date(
          Math.max(0, cursor.getTime() - OVERLAP_MS),
        );
        return {
          startTime,
          endTime: new Date(
            Math.min(now.getTime(), startTime.getTime() + MAX_WINDOW_MS),
          ),
          hasCursor: true,
          isPinned: false,
          attempt: 0,
          continuationCount: 0,
        };
      }

      throw new InvalidSecurityEventConnectionCursorError(
        "Security event connection has an invalid or future polling cursor. Update its source settings to reset the checkpoint.",
      );
    }

    const startTime: Date = new Date(now.getTime() - DEFAULT_LOOKBACK_MS);
    return {
      startTime,
      endTime: now,
      hasCursor: false,
      isPinned: false,
      attempt: 0,
      continuationCount: 0,
    };
  }

  private static readStringPath(value: JSONObject, path: string): string {
    let current: unknown = value;
    for (const part of path.split(".")) {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        return "";
      }
      current = (current as Record<string, unknown>)[part];
    }
    return typeof current === "string" ? current : "";
  }

  private static stableJson(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value
        .map((item: unknown): string => {
          return this.stableJson(item);
        })
        .join(",")}]`;
    }
    if (value && typeof value === "object") {
      const object: Record<string, unknown> = value as Record<string, unknown>;
      return `{${Object.keys(object)
        .sort()
        .map((key: string): string => {
          return `${JSON.stringify(key)}:${this.stableJson(object[key])}`;
        })
        .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
  }

  private static digest(value: unknown): string {
    return createHash("sha256").update(this.stableJson(value)).digest("hex");
  }

  private static sourceFingerprint(
    connection: SecurityEventConnection,
  ): string {
    return this.digest({
      provider: connection.provider,
      configuration: connection.configuration,
      sourceGeneration: connection.sourceGeneration || 1,
    });
  }

  private static sourceRevision(
    provider: string,
    rawEvent: JSONObject,
  ): string {
    const providerPaths: Record<string, Array<string>> = {
      "AWS Security Hub": ["UpdatedAt", "LastObservedAt"],
      "Microsoft Defender XDR and Sentinel": [
        "lastUpdateDateTime",
        "lastActivityDateTime",
      ],
      Cloudflare: ["datetime"],
      "CrowdStrike Falcon": [
        "updated_timestamp",
        "updatedTimestamp",
        "last_updated_timestamp",
      ],
      "Google Security Command Center": [
        "finding.eventTime",
        "finding.event_time",
        "finding.createTime",
      ],
      Okta: ["published"],
      "Splunk Enterprise Security": ["mod_time", "updated", "_time"],
    };
    for (const path of providerPaths[provider] || []) {
      const revision: string = this.readStringPath(rawEvent, path);
      if (revision) {
        return `${revision}\u0000content:${this.digest(rawEvent)}`;
      }
    }
    return `content:${this.digest(rawEvent)}`;
  }

  private static namespaceEventUid(data: {
    connection: SecurityEventConnection;
    rawEvent: JSONObject;
    normalized: NormalizedSecurityEvent;
  }): void {
    const sourceUid: string = data.normalized.eventUid;
    const revision: string = this.sourceRevision(
      data.connection.provider!,
      data.rawEvent,
    );
    data.normalized.attributes["oneuptime.security_event.source_uid"] =
      sourceUid;
    data.normalized.attributes["oneuptime.security_event.source_revision"] =
      revision;
    const sourceFingerprint: string = this.sourceFingerprint(data.connection);
    data.normalized.attributes["oneuptime.security_event.source_fingerprint"] =
      sourceFingerprint;
    data.normalized.eventUid = createHash("sha256")
      .update(
        [
          data.connection.id!.toString(),
          sourceFingerprint,
          data.normalized.classUid.toString(),
          sourceUid,
          revision,
        ].join("\u0000"),
      )
      .digest("hex");
  }

  private static auditMarker(data: {
    connection: SecurityEventConnection;
    rawEvent: JSONObject;
    time: Date;
    markerType: "rejected_record" | "normalization_failure" | "irreducible_gap";
    message: string;
  }): NormalizedSecurityEvent {
    const marker: NormalizedSecurityEvent = GenericNormalizer.normalize(
      data.rawEvent,
    );
    marker.time = data.time;
    marker.eventUid = `connector-audit:${data.markerType}:${this.digest(
      data.rawEvent,
    )}`;
    marker.categoryUid = 0;
    marker.categoryName = "Uncategorized";
    marker.classUid = 0;
    marker.className = "Base Event";
    marker.activityName = "Connector Audit";
    marker.severityName = OcsfSeverity.Unknown;
    marker.severityId = OcsfSeverityId[OcsfSeverity.Unknown];
    marker.statusName = "Failure";
    marker.message = data.message;
    marker.vendorName = data.connection.provider!;
    marker.productName = data.connection.provider!;
    marker.attributes["oneuptime.security_event.audit_marker"] = true;
    marker.attributes["oneuptime.security_event.audit_marker_type"] =
      data.markerType;
    this.namespaceEventUid({
      connection: data.connection,
      rawEvent: data.rawEvent,
      normalized: marker,
    });
    return marker;
  }

  private static sameContinuation(
    left: JSONObject | undefined,
    right: JSONObject | undefined,
  ): boolean {
    return Boolean(
      left && right && JSON.stringify(left) === JSON.stringify(right),
    );
  }

  private static willAdvanceIncompleteWindow(data: {
    window: PollWindow;
    nextContinuation?: JSONObject | undefined;
  }): boolean {
    const sameContinuation: boolean = this.sameContinuation(
      data.window.continuation,
      data.nextContinuation,
    );
    const continuationAttempt: number = sameContinuation
      ? data.window.attempt + 1
      : 0;
    const continuationCount: number = data.window.continuationCount + 1;
    if (
      data.nextContinuation &&
      continuationAttempt < MAX_SAME_CONTINUATION_ATTEMPTS &&
      continuationCount < MAX_CONTINUATION_BATCHES
    ) {
      return false;
    }
    return (
      data.window.endTime.getTime() - data.window.startTime.getTime() <=
        MIN_RETRY_WINDOW_MS || data.window.attempt >= MAX_SPLIT_ATTEMPTS
    );
  }

  private static throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new Error("Security event connection poll exceeded its deadline.");
    }
  }

  private static isResponseSizeLimitError(error: unknown): boolean {
    const message: string = ConnectorErrorMessage.toMessage(error, {
      truncate: false,
    }).toLowerCase();
    return (
      message.includes("maxcontentlength") ||
      message.includes("maxbodylength") ||
      message.includes("response size") ||
      (message.includes("response body") && message.includes("too large"))
    );
  }

  private static async persistDeadlineFailure(
    connection: SecurityEventConnection,
    error: SecurityEventConnectionDeadlineError,
  ): Promise<void> {
    if (!connection.id) {
      return;
    }
    const completedAt: Date = new Date();
    const message: string = error.message;
    const result: SecurityEventConnectorResult = {
      startedAt: completedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      windowStart: completedAt.toISOString(),
      windowEnd: completedAt.toISOString(),
      fetchedCount: 0,
      ingestedCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
      failedCount: 0,
      markerCount: 0,
      requestCount: 0,
      complete: false,
      retryScheduled: true,
      warnings: [],
      error: message,
    };
    const checkpoint: SecurityEventPollingCheckpointUpdate = {
      lastPolledAt: completedAt,
      lastPollResult: result as unknown as JSONObject,
      lastError: message,
    };
    if (connection.version !== undefined) {
      await SecurityEventConnectionService.updatePollingCheckpointIfUnchanged({
        id: connection.id,
        expectedVersion: connection.version,
        checkpoint,
      });
      return;
    }
    await SecurityEventConnectionService.updateOneById({
      id: connection.id,
      data: checkpoint as never,
      props: { isRoot: true },
    });
  }

  public static async pollConnection(
    connection: SecurityEventConnection,
    clientOverride?: SecurityEventConnectorClient | undefined,
    startBefore?: number | undefined,
  ): Promise<SecurityEventConnectorResult> {
    if (!connection.id) {
      throw new Error("Security event connection is missing its id.");
    }
    const mutex: SemaphoreMutex = await Semaphore.lock({
      namespace: SECURITY_EVENT_CONNECTION_LOCK_NAMESPACE,
      key: connection.id.toString(),
      lockTimeout: CONNECTION_LOCK_TIMEOUT_MS,
      acquireTimeout: 10_000,
      retryInterval: 100,
    });
    if (startBefore !== undefined && Date.now() >= startBefore) {
      await Semaphore.release(mutex);
      throw new SecurityEventConnectionStartBudgetExceededError();
    }
    const abortController: AbortController = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const deadlinePromise: Promise<never> = new Promise(
      (_resolve: (value: never) => void, reject: (error: Error) => void) => {
        deadline = setTimeout((): void => {
          abortController.abort();
          reject(new SecurityEventConnectionDeadlineError());
        }, SECURITY_EVENT_CONNECTION_POLL_DEADLINE_MS);
      },
    );
    let releaseWhenPollingSettles: boolean = false;
    let pollingPromise: Promise<SecurityEventConnectorResult> | undefined;
    try {
      pollingPromise = (async () => {
        try {
          return await this.pollUnlocked(
            connection,
            abortController.signal,
            clientOverride,
          );
        } catch (error) {
          if (!(error instanceof InvalidSecurityEventConnectionCursorError)) {
            throw error;
          }
          const completedAt: Date = new Date();
          const message: string = redactLogString(
            ConnectorErrorMessage.toMessage(error, { truncate: false }),
          );
          const result: SecurityEventConnectorResult = {
            startedAt: completedAt.toISOString(),
            completedAt: completedAt.toISOString(),
            windowStart: completedAt.toISOString(),
            windowEnd: completedAt.toISOString(),
            fetchedCount: 0,
            ingestedCount: 0,
            duplicateCount: 0,
            rejectedCount: 0,
            failedCount: 0,
            markerCount: 0,
            requestCount: 0,
            complete: false,
            warnings: [],
            error: message,
          };
          const checkpoint: SecurityEventPollingCheckpointUpdate = {
            lastPolledAt: completedAt,
            lastPollResult: result as unknown as JSONObject,
            lastError: message,
          };
          if (connection.version !== undefined) {
            await SecurityEventConnectionService.updatePollingCheckpointIfUnchanged(
              {
                id: connection.id!,
                expectedVersion: connection.version,
                checkpoint,
              },
            );
          } else {
            await SecurityEventConnectionService.updateOneById({
              id: connection.id!,
              data: checkpoint as never,
              props: { isRoot: true },
            });
          }
          throw error;
        }
      })();
      return await Promise.race([pollingPromise, deadlinePromise]);
    } catch (error) {
      if (error instanceof SecurityEventConnectionDeadlineError) {
        releaseWhenPollingSettles = true;
        void pollingPromise
          ?.then(
            async (): Promise<void> => {
              await Semaphore.release(mutex);
            },
            async (): Promise<void> => {
              await Semaphore.release(mutex);
            },
          )
          .catch((releaseError: unknown): void => {
            logger.error(
              `SecurityEventConnectionPoller: could not release the timed-out connection lock: ${redactLogString(
                ConnectorErrorMessage.toMessage(releaseError, {
                  truncate: false,
                }),
              )}`,
            );
          });
        await this.persistDeadlineFailure(connection, error);
      }
      throw error;
    } finally {
      if (deadline) {
        clearTimeout(deadline);
      }
      if (!releaseWhenPollingSettles) {
        await Semaphore.release(mutex);
      }
    }
  }

  private static async pollUnlocked(
    connection: SecurityEventConnection,
    signal: AbortSignal,
    clientOverride?: SecurityEventConnectorClient | undefined,
  ): Promise<SecurityEventConnectorResult> {
    const window: PollWindow = this.getWindow(connection);
    const startedAt: Date = new Date();
    const result: SecurityEventConnectorResult = {
      startedAt: startedAt.toISOString(),
      completedAt: startedAt.toISOString(),
      windowStart: window.startTime.toISOString(),
      windowEnd: window.endTime.toISOString(),
      fetchedCount: 0,
      ingestedCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
      failedCount: 0,
      markerCount: 0,
      requestCount: 0,
      complete: true,
      warnings: [],
    };
    let providerComplete: boolean = true;
    let nextContinuation: JSONObject | undefined = undefined;
    let operationFailed: boolean = false;
    try {
      if (
        !connection.projectId ||
        !connection.provider ||
        !connection.configuration ||
        !connection.credentialJson
      ) {
        throw new Error(
          "Security event connection is missing projectId, provider, configuration, or credentials.",
        );
      }
      validateSecurityEventConnection({
        provider: connection.provider,
        configuration: connection.configuration,
        credentialJson: connection.credentialJson,
        pollIntervalInMinutes: connection.pollIntervalInMinutes,
      });
      this.throwIfAborted(signal);
      const client: SecurityEventConnectorClient =
        clientOverride ||
        SecurityEventConnectorClientFactory.create(connection);
      const fetched: SecurityEventConnectorFetchResult =
        await client.fetchEvents({
          startTime: window.startTime,
          endTime: window.endTime,
          ...(window.continuation ? { continuation: window.continuation } : {}),
          signal,
        });
      this.throwIfAborted(signal);
      result.fetchedCount = fetched.events.length;
      result.requestCount = fetched.requestCount;
      providerComplete = fetched.complete;
      nextContinuation = fetched.continuation;
      result.complete = providerComplete;
      result.warnings.push(...fetched.warnings);

      const normalized: Array<NormalizedSecurityEvent> = [];
      for (const rawEvent of fetched.events) {
        try {
          if (
            !VendorSecurityEventNormalizer.isEvent(
              connection.provider!,
              rawEvent,
            )
          ) {
            result.rejectedCount++;
            normalized.push(
              this.auditMarker({
                connection,
                rawEvent,
                time: window.endTime,
                markerType: "rejected_record",
                message:
                  "Managed connector received a record that did not match the selected provider schema.",
              }),
            );
            continue;
          }
          const normalizedEvent: NormalizedSecurityEvent =
            VendorSecurityEventNormalizer.normalize(
              connection.provider!,
              rawEvent,
            );
          this.namespaceEventUid({
            connection,
            rawEvent,
            normalized: normalizedEvent,
          });
          normalized.push(normalizedEvent);
        } catch {
          result.failedCount++;
          normalized.push(
            this.auditMarker({
              connection,
              rawEvent,
              time: window.endTime,
              markerType: "normalization_failure",
              message:
                "Managed connector could not normalize a provider record.",
            }),
          );
        }
      }
      if (result.rejectedCount) {
        result.warnings.push(
          `${result.rejectedCount} returned records did not match the selected provider.`,
        );
      }
      if (result.failedCount) {
        result.warnings.push(
          `${result.failedCount} returned records could not be normalized.`,
        );
      }
      result.complete =
        result.complete &&
        result.rejectedCount === 0 &&
        result.failedCount === 0;
      this.throwIfAborted(signal);
      await this.ingest(connection, normalized, result, signal);
    } catch (error) {
      result.complete = false;
      if (this.isResponseSizeLimitError(error)) {
        providerComplete = false;
        result.warnings.push(
          "The provider response exceeded the safe transport size; the time window will be narrowed and retried.",
        );
      } else {
        operationFailed = true;
        result.error = redactLogString(
          ConnectorErrorMessage.toMessage(error, { truncate: false }),
        );
      }
    }

    if (
      !operationFailed &&
      !providerComplete &&
      this.willAdvanceIncompleteWindow({
        window,
        ...(nextContinuation ? { nextContinuation } : {}),
      })
    ) {
      try {
        await this.ingest(
          connection,
          [
            this.auditMarker({
              connection,
              rawEvent: {
                provider: connection.provider!,
                windowStart: window.startTime.toISOString(),
                windowEnd: window.endTime.toISOString(),
                dataLossPossible: true,
                warnings: result.warnings.join(" "),
              },
              time: window.endTime,
              markerType: "irreducible_gap",
              message:
                "Managed connector advanced after a minimum-size window remained truncated; some provider records may be missing.",
            }),
          ],
          result,
          signal,
        );
      } catch (error) {
        operationFailed = true;
        result.error = redactLogString(
          ConnectorErrorMessage.toMessage(error, { truncate: false }),
        );
      }
    }

    const completedAt: Date = new Date();
    result.completedAt = completedAt.toISOString();
    let cursor: string;
    if (operationFailed) {
      const failureAttempt: number = window.attempt + 1;
      const duration: number =
        window.endTime.getTime() - window.startTime.getTime();
      if (failureAttempt < MAX_OPERATION_FAILURE_ATTEMPTS) {
        cursor = this.encodeStoredCursor({
          nextStart: window.startTime,
          endTime: window.endTime,
          attempt: failureAttempt,
          ...(window.continuation ? { continuation: window.continuation } : {}),
          ...(window.continuationCount
            ? { continuationCount: window.continuationCount }
            : {}),
        });
      } else if (duration > MIN_RETRY_WINDOW_MS) {
        const midpoint: Date = new Date(
          Math.floor(
            (window.startTime.getTime() + window.endTime.getTime()) / 2,
          ),
        );
        cursor = this.encodeStoredCursor({
          nextStart: window.startTime,
          endTime: midpoint,
          attempt: 0,
        });
        result.warnings.push(
          "Repeated provider failures cleared the saved page token and narrowed the time window for a safe retry.",
        );
      } else {
        cursor = this.encodeStoredCursor({
          nextStart: window.startTime,
          endTime: window.endTime,
          attempt: 0,
        });
        result.warnings.push(
          "The provider still failed for the minimum retry window; the cursor remains held until the source recovers.",
        );
      }
      result.retryScheduled = true;
    } else if (!providerComplete) {
      const sameContinuation: boolean = this.sameContinuation(
        window.continuation,
        nextContinuation,
      );
      const continuationAttempt: number = sameContinuation
        ? window.attempt + 1
        : 0;
      const continuationCount: number = window.continuationCount + 1;
      if (
        nextContinuation &&
        continuationAttempt < MAX_SAME_CONTINUATION_ATTEMPTS &&
        continuationCount < MAX_CONTINUATION_BATCHES
      ) {
        cursor = this.encodeStoredCursor({
          nextStart: window.startTime,
          endTime: window.endTime,
          attempt: continuationAttempt,
          continuationCount,
          continuation: nextContinuation,
        });
        result.retryScheduled = true;
      } else {
        if (nextContinuation) {
          result.warnings.push(
            continuationCount >= MAX_CONTINUATION_BATCHES
              ? "The provider exceeded the bounded pagination budget; the time window will be narrowed instead."
              : "The provider pagination cursor stopped advancing; the time window will be narrowed instead.",
          );
        }
        const duration: number =
          window.endTime.getTime() - window.startTime.getTime();
        if (
          duration > MIN_RETRY_WINDOW_MS &&
          window.attempt < MAX_SPLIT_ATTEMPTS
        ) {
          const midpoint: Date = new Date(
            Math.floor(
              (window.startTime.getTime() + window.endTime.getTime()) / 2,
            ),
          );
          cursor = this.encodeStoredCursor({
            nextStart: window.startTime,
            endTime: midpoint,
            attempt: window.attempt + 1,
          });
          result.retryScheduled = true;
          result.warnings.push(
            `The incomplete window will retry as ${window.startTime.toISOString()} to ${midpoint.toISOString()}.`,
          );
        } else {
          cursor = this.encodeStoredCursor({ nextStart: window.endTime });
          result.cursorAdvanced = true;
          result.dataLossPossible = true;
          result.warnings.push(
            "The provider still truncated a minimum-size retry window. The cursor advanced without overlap to prevent a permanent stall; some events in this window may be missing.",
          );
        }
      }
    } else if (nextContinuation) {
      cursor = this.encodeStoredCursor({
        nextStart: window.startTime,
        endTime: window.endTime,
        attempt: 0,
        continuation: nextContinuation,
      });
      result.cursorAdvanced = true;
    } else {
      cursor = window.endTime.toISOString();
      result.cursorAdvanced = true;
    }
    this.throwIfAborted(signal);
    const checkpoint: SecurityEventPollingCheckpointUpdate = {
      lastPolledAt: completedAt,
      lastPollResult: result as unknown as JSONObject,
      lastError: result.complete
        ? null
        : result.error ||
          result.warnings.join(" ") ||
          "Poll was incomplete; the same window will be retried.",
      cursor,
      ...(result.complete ? { lastSuccessfulPollAt: completedAt } : {}),
      ...(result.ingestedCount ? { lastEventIngestedAt: completedAt } : {}),
    };
    if (connection.version !== undefined) {
      const updatedRows: number =
        await SecurityEventConnectionService.updatePollingCheckpointIfUnchanged(
          {
            id: connection.id!,
            expectedVersion: connection.version,
            checkpoint,
          },
        );
      if (updatedRows === 0) {
        result.complete = false;
        result.cursorAdvanced = false;
        result.warnings.push(
          "Connection settings changed during this poll; its checkpoint was discarded so the new source starts safely.",
        );
        return result;
      }
    } else {
      await SecurityEventConnectionService.updateOneById({
        id: connection.id!,
        data: checkpoint as never,
        props: { isRoot: true },
      });
    }
    if (result.error) {
      throw new Error(result.error);
    }
    return result;
  }

  public static async findExistingEventUids(
    projectId: ObjectID,
    ids: Array<string>,
  ): Promise<Set<string>> {
    const existing: Set<string> = new Set<string>();
    for (
      let offset: number = 0;
      offset < ids.length;
      offset += UID_BATCH_SIZE
    ) {
      const statement: Statement = SQL`SELECT DISTINCT eventUid FROM clusterAllReplicas(
        ${{ type: TableColumnType.Text, value: getClickhouseClusterName() }},
        ${{ type: TableColumnType.Text, value: getClickhouseDatabaseName() }},
        ${{ type: TableColumnType.Text, value: getStorageTableName(SecurityEventService.model.tableName) }}
      ) WHERE projectId = ${{ type: TableColumnType.ObjectID, value: projectId }}
        AND eventUid IN ${{ type: TableColumnType.ArrayText, value: ids.slice(offset, offset + UID_BATCH_SIZE) }}`;
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
    connection: SecurityEventConnection,
    events: Array<NormalizedSecurityEvent>,
    result: SecurityEventConnectorResult,
    signal: AbortSignal,
  ): Promise<void> {
    this.throwIfAborted(signal);
    if (!events.length) {
      return;
    }
    const seen: Set<string> = new Set<string>();
    const unique: Array<NormalizedSecurityEvent> = events.filter(
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
    this.throwIfAborted(signal);
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
        serviceName: connection.provider!,
        projectId: connection.projectId!,
      });
    this.throwIfAborted(signal);
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
    this.throwIfAborted(signal);
    const rows: Array<JSONObject> = fresh.map(
      (event: NormalizedSecurityEvent): JSONObject => {
        event.attributes["oneuptime.security_event_connection.id"] =
          connection.id!.toString();
        event.attributes["oneuptime.security_event_connection.provider"] =
          connection.provider!;
        return buildSecurityEventDbRow({
          normalized: event,
          projectId: connection.projectId!,
          serviceMetadata,
          retentionDays,
        });
      },
    );
    const markerCount: number = fresh.filter(
      (event: NormalizedSecurityEvent): boolean => {
        return (
          event.attributes["oneuptime.security_event.audit_marker"] === true
        );
      },
    ).length;
    await SecurityEventService.insertJsonRows(rows, {
      clickhouseSettings: { async_insert: 0, insert_distributed_sync: 1 },
    });
    this.throwIfAborted(signal);
    result.ingestedCount += rows.length;
    result.markerCount += markerCount;
  }
}

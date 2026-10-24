import NetworkControllerConnection from "../../../Models/DatabaseModels/NetworkControllerConnection";
import { JSONObject } from "../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../Types/LlmObservability/LlmConnectionTest";
import { readNetworkControllerConfig } from "../../../Types/NetworkController/NetworkControllerConnectionSettings";
import {
  MAX_READ_SUMMARY_WARNINGS,
  NetworkControllerReadStatus,
  NetworkControllerReadSummary,
  readNetworkControllerReadSummary,
} from "../../../Types/NetworkController/NetworkControllerReadSummary";
import ObjectID from "../../../Types/ObjectID";
import NetworkControllerConnectionService from "../../Services/NetworkControllerConnectionService";
import NetworkTrafficUsageAggregationService from "../../Services/NetworkTrafficUsageAggregationService";
import NetworkTrafficUsageService from "../../Services/NetworkTrafficUsageService";
import DataSourceHttpFetch from "../DataSource/HttpFetch";
import LlmConnectionPullRunner from "../LlmObservability/LlmConnectionPullRunner";
import LlmProviderError from "../LlmObservability/LlmProviderError";
import logger from "../Logger";
import NetworkControllerConnectorRegistry from "./NetworkControllerConnectorRegistry";
import NetworkControllerDeviceMatcher, {
  FindDevicesFunction,
  NetworkControllerDeviceMatches,
} from "./NetworkControllerDeviceMatcher";
import NetworkControllerScheduler from "./NetworkControllerScheduler";
import {
  NetworkControllerPullState,
  NetworkControllerReadResult,
  NetworkControllerSettings,
  NetworkControllerTransport,
  NetworkTrafficUsageStoredEnds,
  NetworkTrafficUsageWindowKey,
  readPullState,
} from "./NetworkControllerTypes";
import { toUsageRowBatches } from "./NetworkTrafficUsageRows";
import { BACKFILL_MS } from "./Meraki/MerakiTrafficReader";

/*
 * ONE READ OF ONE NETWORK CONTROLLER CONNECTION.
 *
 * The worker runs it for every connection that is due (Workers job
 * NetworkControllerConnection:Read); "Read now" queues it at once. A read:
 *
 *   1. holds to the project's plan: a reseller plan without telemetry
 *      features reads nothing, and nor does an installation that turned
 *      telemetry ingestion off;
 *   2. reads the controller (NetworkControllerConnector.read) through the
 *      SSRF-guarded fetch, with every status answered so the client can
 *      pace itself and follow only Meraki's own redirects - from where the
 *      connection's cursors say, moved up to where its stored windows end
 *      (a read whose rows were stored but whose cursor was not recorded is
 *      never read again);
 *   3. gives each row the device its traffic belongs to
 *      (NetworkControllerDeviceMatcher);
 *   4. writes only the windows that are not stored yet - a window a read
 *      wrote before it failed to record its cursor is never written twice -
 *      in batches that never split a window;
 *   5. records the outcome on the connection: when it read, what it found,
 *      the error with the key removed, where it got to and when it reads
 *      next. The cursor moves only once the rows are stored.
 *
 * A failure never escapes as anything but a recorded outcome, and the
 * bookkeeping write is itself guarded, so one organization's trouble never
 * stops the others.
 */

// One read stops after this many API calls, or this long.
export const NETWORK_CONTROLLER_READ_MAX_REQUESTS: number = 900;
export const NETWORK_CONTROLLER_READ_MAX_DURATION_MS: number = 6 * 60 * 1000;
// After a failure the next read waits at least this long.
const RETRY_AFTER_FAILURE_MS: number = 15 * 60 * 1000;
// After a refused key, the next read waits this long.
const RETRY_AFTER_REFUSED_KEY_MS: number = 60 * 60 * 1000;
// A read that stopped part way carries on this soon.
const CONTINUE_AFTER_MS: number = 60 * 1000;
// A read that was rate limited carries on no sooner than this.
const CONTINUE_AFTER_RATE_LIMIT_MS: number = 5 * 60 * 1000;
// A plan or installation without telemetry is asked again a day later.
const RETRY_AFTER_PLAN_MS: number = 24 * 60 * 60 * 1000;

export type NetworkTrafficUsageInserter = (
  rows: Array<JSONObject>,
) => Promise<void>;

export type StoredWindowFinder = (data: {
  projectId: ObjectID;
  connectionId: ObjectID;
  windows: Array<NetworkTrafficUsageWindowKey>;
}) => Promise<Set<string>>;

export type StoredWindowEndFinder = (data: {
  projectId: ObjectID;
  connectionId: ObjectID;
  since: Date;
}) => Promise<NetworkTrafficUsageStoredEnds>;

/*
 * How far back the stored windows' ends are looked for: a read never reads
 * further back than a day (from the hour), so a stored window that ended
 * before that can overlap nothing it reads.
 */
export const STORED_WINDOW_END_LOOKBACK_MS: number =
  BACKFILL_MS + 60 * 60 * 1000;

/*
 * A connection's cursors moved up to where its stored windows end: the
 * uplinks to the newest stored uplink window, each network to its newest
 * stored application or client window. A cursor already past is kept.
 * Returns a new state; the one given is not changed.
 */
export function reconcilePullState(
  state: NetworkControllerPullState,
  ends: NetworkTrafficUsageStoredEnds,
): NetworkControllerPullState {
  const later: (
    cursor: string | undefined,
    stored: Date | null | undefined,
  ) => string | undefined = (
    cursor: string | undefined,
    stored: Date | null | undefined,
  ): string | undefined => {
    if (!stored) {
      return cursor;
    }

    const time: number = cursor ? Date.parse(cursor) : NaN;

    return Number.isFinite(time) && time >= stored.getTime()
      ? cursor
      : stored.toISOString();
  };

  const result: NetworkControllerPullState = {
    ...state,
    analyticsCursors: { ...(state.analyticsCursors || {}) },
    ...(state.trafficAnalysisOff
      ? { trafficAnalysisOff: { ...state.trafficAnalysisOff } }
      : {}),
  };

  const uplinkCursor: string | undefined = later(
    state.uplinkCursor,
    ends.uplinkEnd,
  );

  if (uplinkCursor) {
    result.uplinkCursor = uplinkCursor;
  }

  for (const [networkId, end] of ends.analyticsEnds) {
    const cursor: string | undefined = later(
      result.analyticsCursors![networkId],
      end,
    );

    if (cursor) {
      result.analyticsCursors![networkId] = cursor;
    }
  }

  return result;
}

export interface NetworkControllerReadDependencies {
  insertRows?: NetworkTrafficUsageInserter | undefined;
  findStoredWindows?: StoredWindowFinder | undefined;
  findStoredWindowEnds?: StoredWindowEndFinder | undefined;
  findDevices?: FindDevicesFunction | undefined;
  transport?: NetworkControllerTransport | undefined;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  // Test seam for whether the project may read telemetry.
  isTelemetryAllowed?: ((projectId: ObjectID) => Promise<boolean>) | undefined;
}

export interface NetworkControllerReadOutcome {
  status: NetworkControllerReadStatus | "skipped";
  summary?: NetworkControllerReadSummary | undefined;
  error?: string | undefined;
}

export default class NetworkControllerReadRunner {
  // When a connection that just read is read next.
  public static nextPullAt(data: {
    now: Date;
    intervalInMinutes: number;
    outcome: NetworkControllerReadStatus;
    failureKind?: LlmConnectionFailureKind | undefined;
    wasRateLimited?: boolean | undefined;
  }): Date {
    const interval: number = Math.max(1, data.intervalInMinutes) * 60 * 1000;

    if (data.outcome === "partial") {
      return new Date(
        data.now.getTime() +
          Math.min(
            interval,
            data.wasRateLimited
              ? CONTINUE_AFTER_RATE_LIMIT_MS
              : CONTINUE_AFTER_MS,
          ),
      );
    }

    if (data.outcome === "failed") {
      const wait: number =
        data.failureKind === LlmConnectionFailureKind.Authentication ||
        data.failureKind === LlmConnectionFailureKind.Permission
          ? RETRY_AFTER_REFUSED_KEY_MS
          : Math.max(interval, RETRY_AFTER_FAILURE_MS);

      return new Date(data.now.getTime() + wait);
    }

    return new Date(data.now.getTime() + interval);
  }

  public static async run(
    connectionId: ObjectID,
    dependencies: NetworkControllerReadDependencies = {},
  ): Promise<NetworkControllerReadOutcome> {
    const clock: () => Date =
      dependencies.now ||
      ((): Date => {
        return new Date();
      });
    const now: Date = clock();
    const startedAt: number = Date.now();

    const connection: NetworkControllerConnection | null =
      await NetworkControllerConnectionService.findOneById({
        id: connectionId,
        select: {
          _id: true,
          projectId: true,
          name: true,
          provider: true,
          config: true,
          secrets: true,
          isEnabled: true,
          pullState: true,
          lastPullResult: true,
        },
        props: { isRoot: true },
      });

    if (!connection || !connection.projectId || !connection.isEnabled) {
      return { status: "skipped" };
    }

    const interval: number = NetworkControllerScheduler.intervalOf(connection);
    const previous: NetworkControllerReadSummary | undefined =
      readNetworkControllerReadSummary(connection.lastPullResult);

    const isAllowed: (projectId: ObjectID) => Promise<boolean> =
      dependencies.isTelemetryAllowed ||
      ((projectId: ObjectID): Promise<boolean> => {
        return LlmConnectionPullRunner.isTelemetryAllowed(projectId);
      });

    if (!(await isAllowed(connection.projectId))) {
      const message: string =
        "Network traffic from Meraki is not part of this project's plan, or telemetry ingestion is turned off.";

      await NetworkControllerReadRunner.record(connection.id!, {
        lastPulledAt: now,
        lastError: message,
        nextPullAt: new Date(now.getTime() + RETRY_AFTER_PLAN_MS),
      });

      return { status: "skipped", error: message };
    }

    let settings: NetworkControllerSettings | null = null;

    try {
      settings =
        await NetworkControllerConnectionService.getControllerSettings(
          connection,
        );

      const storedEnds: NetworkTrafficUsageStoredEnds = await (
        dependencies.findStoredWindowEnds ||
        ((data: {
          projectId: ObjectID;
          connectionId: ObjectID;
          since: Date;
        }): Promise<NetworkTrafficUsageStoredEnds> => {
          return NetworkTrafficUsageAggregationService.findStoredWindowEnds(
            data,
          );
        })
      )({
        projectId: connection.projectId,
        connectionId: connection.id!,
        since: new Date(now.getTime() - STORED_WINDOW_END_LOOKBACK_MS),
      });

      const read: NetworkControllerReadResult =
        await NetworkControllerConnectorRegistry.getConnector(
          settings.provider,
        ).read(settings, {
          transport:
            dependencies.transport ||
            DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
          now: clock,
          sleep: dependencies.sleep,
          state: reconcilePullState(
            readPullState(connection.pullState),
            storedEnds,
          ),
          maxRequests: NETWORK_CONTROLLER_READ_MAX_REQUESTS,
          maxDurationMs: NETWORK_CONTROLLER_READ_MAX_DURATION_MS,
        });

      const matches: NetworkControllerDeviceMatches =
        await NetworkControllerDeviceMatcher.match({
          projectId: connection.projectId,
          appliances: read.appliances,
          findDevices: dependencies.findDevices,
        });

      const stored: Set<string> =
        read.windows.length > 0
          ? await (
              dependencies.findStoredWindows ||
              ((data: {
                projectId: ObjectID;
                connectionId: ObjectID;
                windows: Array<NetworkTrafficUsageWindowKey>;
              }): Promise<Set<string>> => {
                return NetworkTrafficUsageAggregationService.findStoredWindowKeys(
                  data,
                );
              })
            )({
              projectId: connection.projectId,
              connectionId: connection.id!,
              windows: read.windows,
            })
          : new Set<string>();

      const { batches } = toUsageRowBatches({
        records: read.records,
        storedWindowKeys: stored,
        projectId: connection.projectId,
        connectionId: connection.id!,
        matches,
        ingestedAt: now,
      });

      const insert: NetworkTrafficUsageInserter =
        dependencies.insertRows ||
        ((rows: Array<JSONObject>): Promise<void> => {
          return NetworkTrafficUsageService.insertJsonRows(rows);
        });

      let rowsWritten: number = 0;

      for (const batch of batches) {
        await insert(batch);
        rowsWritten += batch.length;
      }

      const status: NetworkControllerReadStatus = read.complete
        ? "success"
        : "partial";

      const summary: NetworkControllerReadSummary = {
        status,
        organizationName: read.organizationName,
        networkCount: read.networkCount,
        applianceCount: read.appliances.length,
        matchedDeviceCount: matches.bySerial.size,
        uplinkWindows: read.uplinkWindows,
        ...(read.newestUplinkAt
          ? { newestUplinkAt: read.newestUplinkAt.toISOString() }
          : previous?.newestUplinkAt
            ? { newestUplinkAt: previous.newestUplinkAt }
            : {}),
        analyticsNetworks: read.analyticsNetworks,
        analyticsNetworksWaiting: read.analyticsNetworksWaiting,
        trafficAnalysisOffNetworks: read.trafficAnalysisOffNetworks,
        rowsWritten,
        requestCount: read.requestCount,
        wasRateLimited: read.wasRateLimited,
        warnings: read.warnings.slice(0, MAX_READ_SUMMARY_WARNINGS),
        durationMs: Date.now() - startedAt,
        finishedAt: clock().toISOString(),
      };

      // The organization's own name, kept current for the connection's row.
      const config: JSONObject = { ...(connection.config || {}) };

      if (
        read.organizationName &&
        readNetworkControllerConfig(config).organizationName !==
          read.organizationName
      ) {
        config["organizationName"] = read.organizationName;
      }

      await NetworkControllerReadRunner.record(connection.id!, {
        lastPulledAt: now,
        lastSuccessfulPullAt: now,
        lastError: null,
        lastPullResult: summary as unknown as JSONObject,
        pullState: read.nextState as unknown as JSONObject,
        config,
        nextPullAt: NetworkControllerReadRunner.nextPullAt({
          now,
          intervalInMinutes: interval,
          outcome: status,
          wasRateLimited: read.wasRateLimited,
        }),
      });

      return { status, summary };
    } catch (error) {
      const failure: LlmProviderError = LlmProviderError.from({
        error,
        step: "read",
        providerTitle: "Meraki",
        secretValues: settings ? [settings.apiKey] : [],
      });

      const summary: NetworkControllerReadSummary = {
        status: "failed",
        organizationName: previous?.organizationName || "",
        networkCount: previous?.networkCount || 0,
        applianceCount: previous?.applianceCount || 0,
        matchedDeviceCount: previous?.matchedDeviceCount || 0,
        uplinkWindows: 0,
        ...(previous?.newestUplinkAt
          ? { newestUplinkAt: previous.newestUplinkAt }
          : {}),
        analyticsNetworks: 0,
        analyticsNetworksWaiting: previous?.analyticsNetworksWaiting || 0,
        trafficAnalysisOffNetworks: previous?.trafficAnalysisOffNetworks || 0,
        rowsWritten: 0,
        requestCount: 0,
        wasRateLimited: failure.kind === LlmConnectionFailureKind.RateLimited,
        warnings: [],
        failureKind: failure.kind,
        durationMs: Date.now() - startedAt,
        finishedAt: clock().toISOString(),
      };

      await NetworkControllerReadRunner.record(connection.id!, {
        lastPulledAt: now,
        lastError: failure.message,
        lastPullResult: summary as unknown as JSONObject,
        nextPullAt: NetworkControllerReadRunner.nextPullAt({
          now,
          intervalInMinutes: interval,
          outcome: "failed",
          failureKind: failure.kind,
        }),
      });

      return { status: "failed", summary, error: failure.message };
    }
  }

  // The bookkeeping write: guarded, so a failure to record never escapes.
  private static async record(
    connectionId: ObjectID,
    data: {
      lastPulledAt?: Date | undefined;
      lastSuccessfulPullAt?: Date | undefined;
      lastError?: string | null | undefined;
      lastPullResult?: JSONObject | undefined;
      pullState?: JSONObject | undefined;
      config?: JSONObject | undefined;
      nextPullAt?: Date | undefined;
    },
  ): Promise<void> {
    try {
      await NetworkControllerConnectionService.updateOneById({
        id: connectionId,
        // JSON columns make the typed partial too deep for TypeScript.
        data: data as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    } catch (error) {
      logger.error(
        `Network controller connection ${connectionId.toString()}: the read's outcome could not be recorded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

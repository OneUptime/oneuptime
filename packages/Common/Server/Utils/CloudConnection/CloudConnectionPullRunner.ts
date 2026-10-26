import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import { CloudConnectionDefinition } from "../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  CloudConnectionFailureKind,
  CloudConnectionReadStatus,
  CloudConnectionReadSummary,
  readCloudConnectionReadSummary,
} from "../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CloudConnectionService, {
  Service as CloudConnectionServiceClass,
} from "../../Services/CloudConnectionService";
import DataSourceHttpFetch from "../DataSource/HttpFetch";
import LlmConnectionPullRunner from "../LlmObservability/LlmConnectionPullRunner";
import LlmProviderError from "../LlmObservability/LlmProviderError";
import logger from "../Logger";
import CloudConnectionResourceSync, {
  CloudConnectionSyncResult,
} from "./CloudConnectionResourceSync";
import CloudConnectionLanes, {
  CloudInventoryLaneOutcome,
} from "./CloudConnectionLanes";
import CloudConnectionScheduler from "./CloudConnectionScheduler";
import CloudConnectorRegistry from "./CloudConnectorRegistry";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnector,
  CloudConnectorTransport,
  CloudReadResult,
  getCloudSecretValues,
} from "./CloudConnectorTypes";

/*
 * ONE READ OF ONE CLOUD CONNECTION.
 *
 * The worker runs it for every connection that is due (Workers job
 * CloudConnection:Read); "Read now" queues it at once. A read:
 *
 *   1. holds to the project's plan: a reseller plan without telemetry
 *      features reads nothing, and nor does an installation that turned
 *      telemetry ingestion off;
 *   2. makes sure the connection has its own telemetry service;
 *   3. reads the cloud (CloudConnector.read) through the SSRF-guarded
 *      fetch: the resources, and their key metrics since the last read;
 *   4. keeps the resources (CloudConnectionResourceSync) - created and
 *      linked before their metrics land, so they carry the cloud's names -
 *      and hands the metrics to the metrics ingest (the importer the App
 *      gives it), exactly as a collector's cloud receiver would;
 *   5. on their own slower beat, lists every resource of the accounts (the
 *      inventory) and keeps the connection's cloud accounts
 *      (CloudConnectionLanes);
 *   6. records the outcome on the connection: when it read, what it found,
 *      the error (secrets removed), where it got to and when it reads next.
 *
 * A failure never escapes as anything but a recorded outcome, and the
 * bookkeeping write itself is guarded, so one connection's trouble never
 * stops the others.
 */

// One read stops after this many cloud API calls, or this long.
export const CLOUD_READ_MAX_REQUESTS: number = 3000;
export const CLOUD_READ_MAX_DURATION_MS: number = 6 * 60 * 1000;
/*
 * A read is over this long after it starts - a little inside the job's own
 * timeout (CLOUD_CONNECTION_PULL_JOB_TIMEOUT_MS) - so its slower lanes stop
 * before the job is stopped under them.
 */
export const CLOUD_READ_DEADLINE_MS: number = 8 * 60 * 1000 + 30 * 1000;
// After a failure the next read waits at least this long.
const RETRY_AFTER_FAILURE_MS: number = 15 * 60 * 1000;
// After a refused credential, the next read waits this long.
const RETRY_AFTER_REFUSED_CREDENTIAL_MS: number = 60 * 60 * 1000;
// A read that stopped part way continues this soon.
const CONTINUE_AFTER_MS: number = 60 * 1000;
// A plan or installation without telemetry is asked again a day later.
const RETRY_AFTER_PLAN_MS: number = 24 * 60 * 60 * 1000;

/*
 * Hands an OTLP/JSON metrics export to the metrics ingest of the project.
 * The App passes OtelMetricsIngestService; tests pass a fake.
 */
export type CloudMetricsImporter = (data: {
  projectId: ObjectID;
  payload: JSONObject;
}) => Promise<void>;

export interface CloudConnectionPullDependencies {
  importMetrics: CloudMetricsImporter;
  transport?: CloudConnectorTransport | undefined;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
}

export interface CloudConnectionPullOutcome {
  status: CloudConnectionReadStatus | "skipped";
  result: JSONObject;
  error?: string | undefined;
}

export default class CloudConnectionPullRunner {
  public static readPullState(value: unknown): CloudConnectionPullState {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as CloudConnectionPullState)
      : {};
  }

  // When a connection that just read is read next.
  public static nextPullAt(data: {
    now: Date;
    intervalInMinutes: number;
    outcome: CloudConnectionReadStatus;
    failureKind?: CloudConnectionFailureKind | undefined;
  }): Date {
    if (data.outcome === "partial") {
      return new Date(data.now.getTime() + CONTINUE_AFTER_MS);
    }

    const interval: number = Math.max(1, data.intervalInMinutes) * 60 * 1000;

    if (data.outcome === "failed") {
      const wait: number =
        data.failureKind === CloudConnectionFailureKind.Authentication ||
        data.failureKind === CloudConnectionFailureKind.Permission
          ? RETRY_AFTER_REFUSED_CREDENTIAL_MS
          : Math.max(interval, RETRY_AFTER_FAILURE_MS);

      return new Date(data.now.getTime() + wait);
    }

    return new Date(data.now.getTime() + interval);
  }

  public static async run(
    connectionId: ObjectID,
    dependencies: CloudConnectionPullDependencies,
  ): Promise<CloudConnectionPullOutcome> {
    const now: Date = dependencies.now ? dependencies.now() : new Date();
    const startedAt: number = Date.now();

    const connection: CloudConnection | null =
      await CloudConnectionService.findOneById({
        id: connectionId,
        select: {
          _id: true,
          projectId: true,
          name: true,
          provider: true,
          config: true,
          secrets: true,
          isEnabled: true,
          serviceId: true,
          pullState: true,
          lastPullResult: true,
        },
        props: { isRoot: true },
      });

    if (!connection || !connection.projectId || !connection.isEnabled) {
      return { status: "skipped", result: { reason: "not enabled" } };
    }

    const definition: CloudConnectionDefinition =
      CloudConnectionServiceClass.getDefinitionOrThrow(connection.provider);
    const interval: number = CloudConnectionScheduler.intervalOf(connection);
    const previous: CloudConnectionReadSummary | undefined =
      readCloudConnectionReadSummary(connection.lastPullResult);

    if (
      !(await LlmConnectionPullRunner.isTelemetryAllowed(connection.projectId))
    ) {
      const message: string =
        "Cloud connections are not part of this project's plan, or telemetry ingestion is turned off.";

      await CloudConnectionPullRunner.record(connection.id!, {
        lastPulledAt: now,
        lastError: message,
        nextPullAt: new Date(now.getTime() + RETRY_AFTER_PLAN_MS),
      });

      return { status: "skipped", result: { reason: "plan" }, error: message };
    }

    let settings: CloudConnectionSettings | null = null;

    try {
      const service: { serviceId: ObjectID; serviceName: string } =
        await CloudConnectionService.ensureTelemetryService(connection);

      settings = await CloudConnectionService.getConnectorSettings(connection);

      const connector: CloudConnector = CloudConnectorRegistry.getConnector(
        definition.provider,
      );
      const transport: CloudConnectorTransport =
        dependencies.transport ||
        DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);

      const linked: Awaited<
        ReturnType<typeof CloudConnectionResourceSync.loadLinked>
      > = await CloudConnectionResourceSync.loadLinked({
        projectId: connection.projectId,
        connectionId: connection.id!,
      });

      const read: CloudReadResult = await connector.read(settings, {
        transport,
        now: () => {
          return now;
        },
        sleep: dependencies.sleep,
        state: CloudConnectionPullRunner.readPullState(connection.pullState),
        serviceName: service.serviceName,
        connectionId: connection.id!.toString(),
        maxRequests: CLOUD_READ_MAX_REQUESTS,
        maxDurationMs: CLOUD_READ_MAX_DURATION_MS,
        knownResources: CloudConnectionResourceSync.toKnownResources(linked),
      });

      // The resources first, so their metrics land on rows with the cloud's names.
      const synced: CloudConnectionSyncResult =
        await CloudConnectionResourceSync.sync({
          projectId: connection.projectId,
          connectionId: connection.id!,
          linked,
          discovered: read.resources,
          completelyListedAccounts: read.completelyListedAccounts,
        });

      for (const payload of read.payloads) {
        await dependencies.importMetrics({
          projectId: connection.projectId,
          payload,
        });
      }

      const warnings: Array<string> = [...read.warnings];

      if (synced.hasMore) {
        warnings.push(
          "More resources were found than one read adds: the next read adds the rest.",
        );
      }

      // The inventory and the accounts, on their own beat.
      const state: CloudConnectionPullState = { ...read.nextState };
      const inventory: CloudInventoryLaneOutcome =
        await CloudConnectionLanes.runInventory({
          projectId: connection.projectId,
          connectionId: connection.id!,
          connector,
          settings,
          state,
          transport,
          now,
          deadlineMs: startedAt + CLOUD_READ_DEADLINE_MS,
          sleep: dependencies.sleep,
        });

      warnings.push(...inventory.warnings);

      await CloudConnectionLanes.keepAccounts({
        projectId: connection.projectId,
        connectionId: connection.id!,
        provider: definition.provider,
        accountIds: read.accounts,
        named: inventory.accounts,
        inventoryListedAt: inventory.ran ? now : undefined,
        recount:
          inventory.ran ||
          synced.newResources > 0 ||
          synced.archivedResources > 0,
      });

      // What the connection holds after the last sync of this read.
      const held: CloudConnectionSyncResult = inventory.synced || synced;

      const status: CloudConnectionReadStatus =
        read.complete && !synced.hasMore ? "success" : "partial";

      const summary: CloudConnectionReadSummary = {
        status,
        accounts: read.accounts,
        resourceCount: held.resourceCount,
        resourceTypes: held.resourceTypes,
        regions: held.regions,
        newResources:
          synced.newResources + (inventory.synced?.newResources || 0),
        archivedResources:
          synced.archivedResources +
          (inventory.synced?.archivedResources || 0),
        pointsWritten: read.pointsWritten,
        requestCount: read.requestCount,
        warnings: warnings.slice(0, 10),
        durationMs: Date.now() - startedAt,
        finishedAt: new Date().toISOString(),
      };

      await CloudConnectionPullRunner.record(connection.id!, {
        lastPulledAt: now,
        lastSuccessfulPullAt: now,
        lastError: null,
        lastPullResult: summary as unknown as JSONObject,
        pullState: state as unknown as JSONObject,
        nextPullAt: CloudConnectionPullRunner.nextPullAt({
          now,
          intervalInMinutes: interval,
          outcome: status,
        }),
      });

      return { status, result: summary as unknown as JSONObject };
    } catch (error) {
      const failure: LlmProviderError = LlmProviderError.from({
        error,
        step: "read",
        providerTitle: definition.title,
        secretValues: settings ? getCloudSecretValues(settings) : [],
      });

      // What the connection held before stays on the list; the status says it failed.
      const summary: CloudConnectionReadSummary = {
        status: "failed",
        accounts: previous?.accounts || [],
        resourceCount: previous?.resourceCount || 0,
        resourceTypes: previous?.resourceTypes || [],
        regions: previous?.regions || [],
        newResources: 0,
        archivedResources: 0,
        pointsWritten: 0,
        requestCount: 0,
        warnings: [],
        failureKind: failure.kind,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date().toISOString(),
      };

      await CloudConnectionPullRunner.record(connection.id!, {
        lastPulledAt: now,
        lastError: failure.message,
        lastPullResult: summary as unknown as JSONObject,
        nextPullAt: CloudConnectionPullRunner.nextPullAt({
          now,
          intervalInMinutes: interval,
          outcome: "failed",
          failureKind: failure.kind,
        }),
      });

      return {
        status: "failed",
        result: summary as unknown as JSONObject,
        error: failure.message,
      };
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
      nextPullAt?: Date | undefined;
    },
  ): Promise<void> {
    try {
      await CloudConnectionService.updateOneById({
        id: connectionId,
        // JSON columns make the typed partial too deep for TypeScript.
        data: data as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    } catch (error) {
      logger.error(
        `Cloud connection ${connectionId.toString()}: the read's outcome could not be recorded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

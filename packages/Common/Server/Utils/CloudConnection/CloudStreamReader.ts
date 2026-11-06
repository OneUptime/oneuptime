import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE } from "../../../Types/Cloud/CloudMonitoredResource";
import {
  CLOUD_STREAM_EVENT_HUB_MAX_BYTES_PER_READ,
  CloudStreamRefusalReason,
} from "../../../Types/CloudConnection/CloudStream";
import {
  AZURE_CLOUD_STREAM_MAX_PARTITIONS,
  AzureCloudStreamState,
  readAzureCloudStreamState,
} from "../../../Types/CloudConnection/CloudStreamAzure";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OldestKeyMap from "../../../Utils/OldestKeyMap";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import Redis, { ClientType } from "../../Infrastructure/Redis";
import CloudConnectionService from "../../Services/CloudConnectionService";
import CloudResourceService from "../../Services/CloudResourceService";
import PayAsYouGoBillingService from "../../Services/PayAsYouGoBillingService";
import ProjectService from "../../Services/ProjectService";
import QueryHelper from "../../Types/Database/QueryHelper";
import DataSourceHttpFetch from "../DataSource/HttpFetch";
import EntraTokenClient, {
  MicrosoftCloud,
} from "../LlmObservability/Connectors/Microsoft/EntraTokenClient";
import LlmConnectionPullRunner from "../LlmObservability/LlmConnectionPullRunner";
import logger from "../Logger";
import AzureArm from "./Azure/AzureArm";
import AzureEventHubsStream, {
  AzureEventHubBatch,
  AzureEventHubNamespace,
  AzureEventHubNamespaceRead,
  AzureEventHubsDeliveryFailed,
  AzureEventHubsRead,
} from "./Azure/AzureEventHubsStream";
import CloudStreamActivity, { CloudStreamSighting } from "./CloudStreamActivity";
import {
  CloudConnectionSettings,
  CloudConnectorTransport,
  readCloudSetting,
} from "./CloudConnectorTypes";
import { KafkaSocketFactory } from "./Kafka/KafkaClient";
import { KafkaRecord } from "./Kafka/KafkaProtocol";

/*
 * ONE READ OF AN AZURE CONNECTION'S EVENT HUBS.
 *
 * A Workers cron queues it every minute for each Azure connection that is
 * on and streams (streamKeyCreatedAt set), one job per connection at a
 * time (deduplication). A read:
 *
 *   1. holds to the project as every ingest path does: a plan with
 *      telemetry, a project not blocked, one that may be billed - else it
 *      reads nothing, says why on the connection, and Event Hubs keeps the
 *      events for when it may;
 *   2. finds the connection's namespaces (AzureEventHubsStream), kept five
 *      minutes once there are some;
 *   3. reads each from where the last read stopped - Postgres's
 *      streamState, or the newer offsets Redis holds of a read that stopped
 *      before it wrote them - within CLOUD_STREAM_EVENT_HUB_MAX_BYTES_PER_READ
 *      and CLOUD_STREAM_READ_DEADLINE_MS;
 *   4. hands each fetch's events to `deliver` (the App's decoder and the
 *      telemetry queue) with what they are decoded against: the
 *      connection's telemetry service, its resources as its reads wrote
 *      them, and the metric definitions its reads keep; and only once they
 *      are queued moves the partition's offset, in Redis at once - so a
 *      read that stops half way never queues an event twice - and in
 *      Postgres when it is done;
 *   5. notes on the connection what came from where, that it read, or why
 *      it could not (CloudStreamActivity).
 *
 * The project is the connection's: nothing an event says changes where it
 * is written. Never throws: a failure is said on the connection and logged.
 */

export const CLOUD_STREAM_READ_JOB: string = "CloudStream:ReadEventHubs";
export const CLOUD_STREAM_READ_JOB_TIMEOUT_MS: number = 55 * 1000;
export const CLOUD_STREAM_READ_DEADLINE_MS: number = 45 * 1000;
const NAMESPACES_TTL_MS: number = 5 * 60 * 1000;
const RESOURCES_TTL_MS: number = 10 * 60 * 1000;
const MAX_CACHED_CONNECTIONS: number = 1000;
// The most resources of one connection read for linking events.
const MAX_RESOURCES: number = 10_000;
// The most connections queued in one tick; the rest wait for the next minute.
const MAX_CONNECTIONS_PER_TICK: number = 500;
const REDIS_OFFSET_PREFIX: string = "cloudstream:eventhub:";
const REDIS_OFFSET_TTL_SECONDS: number = 7 * 24 * 60 * 60;

// A resource of the connection, as its reads wrote it: what an event names is linked to it.
export interface AzureStreamResource {
  // The ARM id as the reads' metrics carry it (azuremonitor.resource_id).
  resourceId: string;
  // The CloudResource's providerResourceId: what its Logs page filters on.
  providerResourceId: string;
  name: string;
  type: string;
  resourceGroup: string;
  region: string;
  subscriptionId: string;
}

// A key metric as the connection's reads read it (CloudKeyMetrics, Azure).
export interface AzureStreamMetricDefinition {
  name: string;
  aggregation: string;
  unit: string;
  grain: string;
}

export interface AzureStreamContext {
  projectId: ObjectID;
  connectionId: ObjectID;
  serviceName: string;
  // Lower-case ARM id -> the resource.
  resources: ReadonlyMap<string, AzureStreamResource>;
  // Lower-case type -> lower-case metric name -> how the reads read it.
  definitions: ReadonlyMap<
    string,
    ReadonlyMap<string, AzureStreamMetricDefinition>
  >;
}

export interface AzureStreamDelivered {
  sightings: Array<CloudStreamSighting>;
}

// Decodes and queues one fetch's events; resolves once they are queued.
export type AzureStreamDeliver = (data: {
  context: AzureStreamContext;
  // The region of the event hub they came from.
  namespaceRegion: string;
  records: Array<KafkaRecord>;
}) => Promise<AzureStreamDelivered>;

export interface CloudStreamReadDependencies {
  deliver: AzureStreamDeliver;
  transport?: CloudConnectorTransport | undefined;
  socketFactoryFor?: ((host: string) => Promise<KafkaSocketFactory>) | undefined;
  now?: (() => Date) | undefined;
}

export interface CloudStreamReadOutcome {
  status: "skipped" | "read" | "failed";
  events: number;
  reason?: string | undefined;
}

export default class CloudStreamReader {
  private static namespaces: OldestKeyMap<
    string,
    { at: number; namespaces: Array<AzureEventHubNamespace> }
  > = new OldestKeyMap();
  private static resources: OldestKeyMap<
    string,
    { at: number; resources: Map<string, AzureStreamResource> }
  > = new OldestKeyMap();

  public static reset(): void {
    CloudStreamReader.namespaces.clear();
    CloudStreamReader.resources.clear();
  }

  // Queues a read of each Azure connection that streams. Returns how many.
  public static async enqueueDue(now: Date = new Date()): Promise<number> {
    const connections: Array<CloudConnection> =
      await CloudConnectionService.findBy({
        query: {
          provider: CloudProvider.Azure,
          isEnabled: true,
          streamKeyCreatedAt: QueryHelper.notNull(),
        },
        select: { _id: true },
        limit: MAX_CONNECTIONS_PER_TICK,
        skip: 0,
        props: { isRoot: true },
      });

    for (const connection of connections) {
      if (!connection.id) {
        continue;
      }

      await Queue.addJob(
        QueueName.Worker,
        `cloud-stream-read-${connection.id.toString()}-${Math.floor(now.getTime() / 60000)}`,
        CLOUD_STREAM_READ_JOB,
        { connectionId: connection.id.toString() },
        {
          attempts: 1,
          deduplication: { id: `cloud-stream-read-${connection.id.toString()}` },
        },
      );
    }

    return connections.length;
  }

  /*
   * The key metrics each resource type is read with, from what the
   * connection's reads keep (pullState.azureMetricDefinitions).
   */
  public static readDefinitions(
    pullState: unknown,
  ): Map<string, Map<string, AzureStreamMetricDefinition>> {
    const definitions: Map<string, Map<string, AzureStreamMetricDefinition>> =
      new Map();
    const state: JSONObject =
      pullState && typeof pullState === "object" && !Array.isArray(pullState)
        ? (pullState as JSONObject)
        : {};
    const cache: JSONValue | undefined = state["azureMetricDefinitions"];

    if (!cache || typeof cache !== "object" || Array.isArray(cache)) {
      return definitions;
    }

    for (const type of Object.keys(cache).slice(0, 500)) {
      const entry: JSONValue | undefined = (cache as JSONObject)[type];
      const metrics: JSONValue | undefined =
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? (entry as JSONObject)["metrics"]
          : undefined;

      if (!Array.isArray(metrics)) {
        continue;
      }

      const byName: Map<string, AzureStreamMetricDefinition> = new Map();

      for (const raw of metrics.slice(0, 50)) {
        const metric: JSONObject =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as JSONObject)
            : {};
        const name: string = String(metric["name"] || "");
        const aggregation: string = String(metric["aggregation"] || "");

        if (name && aggregation) {
          byName.set(name.toLowerCase(), {
            name,
            aggregation,
            unit: String(metric["unit"] || ""),
            grain: String(metric["grain"] || "").toUpperCase(),
          });
        }
      }

      definitions.set(type.toLowerCase(), byName);
    }

    return definitions;
  }

  // Test seam: the connection's resources, as its reads wrote them.
  public static loadResources: (
    connectionId: ObjectID,
  ) => Promise<Array<CloudResource>> = async (
    connectionId: ObjectID,
  ): Promise<Array<CloudResource>> => {
    return await CloudResourceService.findBy({
      query: {
        cloudConnectionId: connectionId,
        cloudProvider: CloudProvider.Azure,
      },
      select: {
        _id: true,
        name: true,
        providerResourceId: true,
        telemetryAttributes: true,
        cloudRegion: true,
        cloudResourceType: true,
        cloudResourceGroup: true,
        cloudAccountId: true,
      },
      limit: MAX_RESOURCES,
      skip: 0,
      props: { isRoot: true },
    });
  };

  private static async getResources(
    connectionId: ObjectID,
    now: number,
  ): Promise<Map<string, AzureStreamResource>> {
    const key: string = connectionId.toString();
    const cached: { at: number; resources: Map<string, AzureStreamResource> } | undefined =
      CloudStreamReader.resources.get(key);

    if (cached && now - cached.at < RESOURCES_TTL_MS) {
      return cached.resources;
    }

    const resources: Map<string, AzureStreamResource> = new Map();

    for (const row of await CloudStreamReader.loadResources(connectionId)) {
      const resourceId: string =
        row.telemetryAttributes?.[AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE] ||
        row.providerResourceId ||
        "";

      if (!resourceId) {
        continue;
      }

      resources.set(resourceId.toLowerCase(), {
        resourceId,
        providerResourceId: row.providerResourceId || resourceId,
        name: row.name || "",
        type: row.cloudResourceType || "",
        resourceGroup: row.cloudResourceGroup || "",
        region: (row.cloudRegion || "").toLowerCase(),
        subscriptionId: (row.cloudAccountId || "").toLowerCase(),
      });
    }

    while (CloudStreamReader.resources.size >= MAX_CACHED_CONNECTIONS) {
      const oldest: string | undefined = CloudStreamReader.resources.oldestKey();

      if (oldest === undefined) {
        break;
      }

      CloudStreamReader.resources.delete(oldest);
    }

    CloudStreamReader.resources.set(key, { at: now, resources });

    return resources;
  }

  private static async getNamespaces(data: {
    stream: AzureEventHubsStream;
    connectionId: ObjectID;
    hostSubscriptionId: string;
    now: number;
  }): Promise<Array<AzureEventHubNamespace>> {
    // Kept by subscription too: streaming started again elsewhere is looked for afresh.
    const key: string = `${data.connectionId.toString()}|${data.hostSubscriptionId}`;
    const cached: { at: number; namespaces: Array<AzureEventHubNamespace> } | undefined =
      CloudStreamReader.namespaces.get(key);

    if (cached && data.now - cached.at < NAMESPACES_TTL_MS) {
      return cached.namespaces;
    }

    const namespaces: Array<AzureEventHubNamespace> =
      await data.stream.listNamespaces({
        connectionId: data.connectionId.toString(),
        hostSubscriptionId: data.hostSubscriptionId,
      });

    // None yet - the command still running - is asked again next minute.
    if (namespaces.length > 0) {
      while (CloudStreamReader.namespaces.size >= MAX_CACHED_CONNECTIONS) {
        const oldest: string | undefined =
          CloudStreamReader.namespaces.oldestKey();

        if (oldest === undefined) {
          break;
        }

        CloudStreamReader.namespaces.delete(oldest);
      }

      CloudStreamReader.namespaces.set(key, { at: data.now, namespaces });
    }

    return namespaces;
  }


  private static redisKey(connectionId: ObjectID, namespace: string, partition: number): string {
    return `${REDIS_OFFSET_PREFIX}${connectionId.toString()}:${namespace}:${partition}`;
  }

  private static getRedis(): ClientType | null {
    const client: ClientType | null = Redis.getClient();
    return client && Redis.isConnected() ? client : null;
  }

  /*
   * The offsets to read from: Postgres's, or Redis's where a read moved
   * them on and stopped before it wrote them to Postgres.
   */
  private static async withRedisOffsets(
    connectionId: ObjectID,
    namespaces: Array<AzureEventHubNamespace>,
    stored: Record<string, Record<string, number>>,
  ): Promise<Record<string, Record<string, number>>> {
    const offsets: Record<string, Record<string, number>> = {};
    const client: ClientType | null = CloudStreamReader.getRedis();

    for (const namespace of namespaces) {
      offsets[namespace.name] = { ...(stored[namespace.name] || {}) };
    }

    if (!client) {
      return offsets;
    }

    const partitions: Array<number> = Array.from(
      { length: AZURE_CLOUD_STREAM_MAX_PARTITIONS },
      (_value: unknown, index: number): number => {
        return index;
      },
    );

    for (const namespace of namespaces) {
      let values: Array<string | null> = [];

      try {
        values = await client.mget(
          partitions.map((partition: number): string => {
            return CloudStreamReader.redisKey(
              connectionId,
              namespace.name,
              partition,
            );
          }),
        );
      } catch {
        return offsets;
      }

      values.forEach((value: string | null, partition: number): void => {
        const offset: number = Number(value);
        const known: number | undefined =
          offsets[namespace.name]![String(partition)];

        if (
          value !== null &&
          Number.isSafeInteger(offset) &&
          offset >= 0 &&
          (known === undefined || offset > known)
        ) {
          offsets[namespace.name]![String(partition)] = offset;
        }
      });
    }

    return offsets;
  }

  /*
   * Whether the project may take telemetry now - the admission every
   * ingest path holds to - or the refusal to note.
   */
  private static async isAdmitted(projectId: ObjectID): Promise<boolean> {
    const isTelemetryAllowed: boolean =
      await LlmConnectionPullRunner.isTelemetryAllowed(projectId).catch(
        (): boolean => {
          return true;
        },
      );

    if (!isTelemetryAllowed || (await ProjectService.isProjectBlocked(projectId))) {
      return false;
    }

    try {
      await PayAsYouGoBillingService.requirePayAsYouGo(projectId, {
        allowStaleDenial: true,
      });
    } catch (error) {
      if (error instanceof PaymentRequiredException) {
        return false;
      }

      throw error;
    }

    return true;
  }

  public static async readAzure(
    connectionId: ObjectID,
    dependencies: CloudStreamReadDependencies,
  ): Promise<CloudStreamReadOutcome> {
    const now: Date = dependencies.now ? dependencies.now() : new Date();
    const startedAt: number = Date.now();

    try {
      const connection: CloudConnection | null =
        await CloudConnectionService.findOneById({
          id: connectionId,
          select: {
            _id: true,
            projectId: true,
            provider: true,
            isEnabled: true,
            name: true,
            serviceId: true,
            streamKeyCreatedAt: true,
            streamState: true,
            pullState: true,
            config: true,
            secrets: true,
          },
          props: { isRoot: true },
        });

      if (
        !connection ||
        !connection.projectId ||
        connection.provider !== CloudProvider.Azure ||
        connection.isEnabled === false ||
        !connection.streamKeyCreatedAt
      ) {
        return { status: "skipped", events: 0, reason: "not streaming" };
      }

      const state: AzureCloudStreamState | null = readAzureCloudStreamState(
        connection.streamState,
      );

      if (!state) {
        return { status: "skipped", events: 0, reason: "no event hubs' subscription" };
      }

      if (!(await CloudStreamReader.isAdmitted(connection.projectId))) {
        CloudStreamActivity.noteRefusal({
          connectionId,
          reason: CloudStreamRefusalReason.NotAllowed,
          now,
        });
        return { status: "skipped", events: 0, reason: "project may not take telemetry" };
      }

      const settings: CloudConnectionSettings =
        await CloudConnectionService.getConnectorSettings(connection);
      const cloud: MicrosoftCloud = EntraTokenClient.resolveCloud(
        readCloudSetting(settings.config, "cloud") || "public",
      );
      const arm: AzureArm = new AzureArm({
        tenantId: readCloudSetting(settings.config, "tenantId"),
        clientId: readCloudSetting(settings.config, "clientId"),
        clientSecret: readCloudSetting(settings.secrets, "clientSecret"),
        cloud,
        transport:
          dependencies.transport ||
          DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
      });
      const stream: AzureEventHubsStream = new AzureEventHubsStream({
        arm,
        cloud,
        socketFactoryFor: dependencies.socketFactoryFor,
        now: (): number => {
          return Date.now();
        },
      });

      const namespaces: Array<AzureEventHubNamespace> =
        await CloudStreamReader.getNamespaces({
          stream,
          connectionId,
          hostSubscriptionId: state.hostSubscriptionId,
          now: now.getTime(),
        });

      if (namespaces.length === 0) {
        return { status: "read", events: 0, reason: "no event hubs yet" };
      }

      const service: { serviceId: ObjectID; serviceName: string } =
        await CloudConnectionService.ensureTelemetryService(connection);
      const context: AzureStreamContext = {
        projectId: connection.projectId,
        connectionId,
        serviceName: service.serviceName,
        resources: await CloudStreamReader.getResources(connectionId, now.getTime()),
        definitions: CloudStreamReader.readDefinitions(connection.pullState),
      };
      const offsets: Record<string, Record<string, number>> =
        await CloudStreamReader.withRedisOffsets(connectionId, namespaces, state.offsets);
      const sightings: Array<CloudStreamSighting> = [];
      const redis: ClientType | null = CloudStreamReader.getRedis();

      const read: AzureEventHubsRead = await stream.read({
        namespaces,
        offsets,
        maxBytes: CLOUD_STREAM_EVENT_HUB_MAX_BYTES_PER_READ,
        deadlineMs: startedAt + CLOUD_STREAM_READ_DEADLINE_MS,
        deliver: async (batch: AzureEventHubBatch): Promise<void> => {
          const delivered: AzureStreamDelivered = await dependencies.deliver({
            context,
            namespaceRegion: batch.namespace.region,
            records: batch.records,
          });

          sightings.push(...delivered.sightings);
        },
        onOffset: async (
          namespace: string,
          partition: number,
          offset: number,
        ): Promise<void> => {
          if (!redis) {
            return;
          }

          try {
            await redis.set(
              CloudStreamReader.redisKey(connectionId, namespace, partition),
              String(offset),
              "EX",
              REDIS_OFFSET_TTL_SECONDS,
            );
          } catch {
            // Postgres has them at the end of the read.
          }
        },
      });

      await CloudStreamReader.writeOffsets({
        connectionId,
        state,
        offsets: { ...offsets, ...read.offsets },
      });

      const problems: Array<AzureEventHubNamespaceRead> = read.namespaces.filter(
        (namespace: AzureEventHubNamespaceRead): boolean => {
          return Boolean(namespace.problem);
        },
      );

      if (read.events > 0) {
        CloudStreamActivity.noteDelivery({ connectionId, now, sightings });
      }

      if (problems.length > 0) {
        const isNoAccess: boolean = problems.some(
          (namespace: AzureEventHubNamespaceRead): boolean => {
            return namespace.problem === "no-access";
          },
        );

        CloudStreamActivity.noteRefusal({
          connectionId,
          reason: isNoAccess
            ? CloudStreamRefusalReason.NoAccess
            : CloudStreamRefusalReason.Unreachable,
          now,
        });

        logger.debug(
          `Cloud stream ${connectionId.toString()}: ${problems.length} event hubs could not be read: ${problems[0]!.message || problems[0]!.problem}`,
        );
      } else {
        CloudStreamActivity.noteRead({ connectionId, now });
      }

      return {
        status: problems.length > 0 && read.events === 0 ? "failed" : "read",
        events: read.events,
      };
    } catch (error) {
      /*
       * The queue could not take what was read: OneUptime's trouble, not the
       * connection's. Nothing is said on it; what Redis holds of the
       * fetches that were queued stays, and the rest is read again.
       */
      if (error instanceof AzureEventHubsDeliveryFailed) {
        logger.warn(
          `Cloud stream ${connectionId.toString()}: events read from its event hubs could not be queued; they are read again next minute. ${error.message}`,
        );
        return { status: "failed", events: 0, reason: "queue" };
      }

      logger.warn(
        `Cloud stream ${connectionId.toString()}: its event hubs could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      CloudStreamActivity.noteRefusal({
        connectionId,
        reason: AzureEventHubsStream.describe(error).problem === "no-access"
          ? CloudStreamRefusalReason.NoAccess
          : CloudStreamRefusalReason.Unreachable,
        now,
      });

      return { status: "failed", events: 0, reason: "error" };
    }
  }

  /*
   * The offsets reached, kept with the event hubs' subscription - unless
   * streaming was stopped while the read ran.
   */
  private static async writeOffsets(data: {
    connectionId: ObjectID;
    state: AzureCloudStreamState;
    offsets: Record<string, Record<string, number>>;
  }): Promise<void> {
    const current: CloudConnection | null =
      await CloudConnectionService.findOneById({
        id: data.connectionId,
        select: { _id: true, streamKeyCreatedAt: true },
        props: { isRoot: true },
      });

    if (!current?.streamKeyCreatedAt) {
      return;
    }

    await CloudConnectionService.updateColumnsByIdWithoutHooks({
      id: data.connectionId,
      // JSON columns make the typed partial too deep for TypeScript.
      data: {
        streamState: {
          hostSubscriptionId: data.state.hostSubscriptionId,
          offsets: data.offsets,
        } as unknown as JSONObject,
      } as never,
      skipUpdateDateColumn: true,
    });
  }
}

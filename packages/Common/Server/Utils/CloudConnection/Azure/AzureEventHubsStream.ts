import {
  CLOUD_STREAM_EVENT_HUB_MAX_EVENT_BYTES,
  CLOUD_STREAM_EVENT_HUB_MAX_FETCH_BYTES,
} from "../../../../Types/CloudConnection/CloudStream";
import {
  AZURE_CLOUD_STREAM_EVENT_HUB,
  AZURE_CLOUD_STREAM_MAX_NAMESPACES,
  AZURE_CLOUD_STREAM_MAX_PARTITIONS,
  AZURE_EVENT_HUBS_KAFKA_PORT,
  getAzureCloudStreamNames,
  getAzureEventHubsHost,
  readAzureCloudStreamNamespaceRegion,
} from "../../../../Types/CloudConnection/CloudStreamAzure";
import { JSONArray, JSONObject, JSONValue } from "../../../../Types/JSON";
import DataSourceEgressGuard, {
  ResolvedAddress,
} from "../../DataSource/EgressGuard";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import KafkaClient, {
  KafkaAuthenticationError,
  KafkaSocketFactory,
  createTlsSocketFactory,
} from "../Kafka/KafkaClient";
import {
  EARLIEST_OFFSET,
  KAFKA_ERROR_NONE,
  KAFKA_ERROR_OFFSET_OUT_OF_RANGE,
  KAFKA_ERROR_TOPIC_AUTHORIZATION_FAILED,
  KafkaFetchedPartition,
  KafkaPartitionOffset,
  KafkaRecord,
  KafkaTopicMetadata,
  LATEST_OFFSET,
} from "../Kafka/KafkaProtocol";
import AzureArm from "./AzureArm";

/*
 * READING AN AZURE CONNECTION'S EVENT HUBS.
 *
 * The streaming command (CloudStreamAzure) puts an Event Hubs namespace in
 * each region the subscriptions have resources in, in one resource group
 * of the first subscription, and gives the connection's own app Azure
 * Event Hubs Data Receiver on that group. OneUptime reads them:
 *
 *   1. the namespaces, from Resource Manager: those of the group the
 *      command names after the connection, whose names are this
 *      connection's (oneuptime-<8 hex>-<region>), provisioned - a group not
 *      made yet is no namespace yet;
 *   2. each one over its Kafka endpoint (<namespace>.servicebus.windows.net,
 *      port 9093, TLS, the address pinned once the egress guard allowed it),
 *      signed in with an Entra token for that namespace (SASL OAUTHBEARER):
 *      the event hub's partitions, their earliest and latest offsets, then
 *      their events from where the last read stopped - from the earliest,
 *      the first time, and from the earliest again when the event hub no
 *      longer holds where it stopped;
 *   3. each fetch's events handed on (deliver) - decoded and queued by the
 *      caller - before the partition's offset moves past them, so what was
 *      not queued is read again.
 *
 * A read takes at most maxBytes of events and stops at its deadline; what
 * is left waits for the next read, and Event Hubs keeps it. An answer is
 * at most CLOUD_STREAM_EVENT_HUB_MAX_FETCH_BYTES and a little more, and an
 * event past CLOUD_STREAM_EVENT_HUB_MAX_EVENT_BYTES is left out. Trouble is
 * said per namespace: "no-access" when the token or the role is refused
 * (Azure can take minutes to put a new role in force), "unreachable" when
 * the namespace could not be reached or answered something else.
 */

export const AZURE_EVENT_HUBS_API_VERSION: string = "2021-11-01";
export const AZURE_EVENT_HUBS_KAFKA_CLIENT_ID: string = "oneuptime";
export const AZURE_EVENT_HUBS_TIMEOUT_MS: number = 15_000;
// How long a fetch waits for events when there are none.
export const AZURE_EVENT_HUBS_FETCH_WAIT_MS: number = 100;
// The most one partition answers in one fetch.
export const AZURE_EVENT_HUBS_PARTITION_FETCH_BYTES: number = 1024 * 1024;

export type AzureEventHubsProblem = "no-access" | "unreachable";

/*
 * Events read that could not be handed on - the queue could not take them:
 * not the namespace's trouble, so not said as it; the read stops, and the
 * events are read again next time.
 */
export class AzureEventHubsDeliveryFailed extends Error {
  public constructor(cause: unknown) {
    super(
      `Events read could not be handed on: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}

export interface AzureEventHubNamespace {
  name: string;
  region: string;
  host: string;
}

export interface AzureEventHubBatch {
  namespace: AzureEventHubNamespace;
  partition: number;
  records: Array<KafkaRecord>;
}

export interface AzureEventHubNamespaceRead {
  namespace: AzureEventHubNamespace;
  events: number;
  bytes: number;
  problem?: AzureEventHubsProblem | undefined;
  message?: string | undefined;
  // The event hub is not made yet: waited for, not a problem.
  isWaiting?: boolean | undefined;
}

export interface AzureEventHubsRead {
  namespaces: Array<AzureEventHubNamespaceRead>;
  // Namespace -> partition -> the next offset to read.
  offsets: Record<string, Record<string, number>>;
  events: number;
  bytes: number;
  isBudgetSpent: boolean;
}

export interface AzureEventHubsStreamOptions {
  arm: AzureArm;
  cloud: "public" | "usgov";
  // Test seam: the socket to a namespace. TLS, to its pinned address, when absent.
  socketFactoryFor?:
    | ((host: string) => Promise<KafkaSocketFactory>)
    | undefined;
  now?: (() => number) | undefined;
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export default class AzureEventHubsStream {
  private options: AzureEventHubsStreamOptions;

  public constructor(options: AzureEventHubsStreamOptions) {
    this.options = options;
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  /*
   * The connection's namespaces, from Resource Manager - none while the
   * group is not made.
   */
  public async listNamespaces(data: {
    connectionId: string;
    hostSubscriptionId: string;
  }): Promise<Array<AzureEventHubNamespace>> {
    const group: string = getAzureCloudStreamNames(
      data.connectionId,
    ).resourceGroup;
    const url: string = `${this.options.arm.getManagementBaseUrl()}/subscriptions/${encodeURIComponent(
      data.hostSubscriptionId,
    )}/resourceGroups/${encodeURIComponent(group)}/providers/Microsoft.EventHub/namespaces?api-version=${AZURE_EVENT_HUBS_API_VERSION}`;

    let body: JSONObject;

    try {
      body = await this.options.arm.getJson(
        url,
        "event hubs namespaces request",
      );
    } catch (error) {
      // The group, or the subscription's Event Hubs, not made yet.
      if (error instanceof LlmProviderError && error.statusCode === 404) {
        return [];
      }

      throw error;
    }

    const namespaces: Array<AzureEventHubNamespace> = [];
    const values: JSONArray = Array.isArray(body["value"])
      ? (body["value"] as JSONArray)
      : [];

    for (const raw of values) {
      const item: JSONObject = readObject(raw);
      const name: string = readText(item["name"]);
      const region: string | null = readAzureCloudStreamNamespaceRegion(
        data.connectionId,
        name,
      );
      const properties: JSONObject = readObject(item["properties"]);
      const state: string = readText(properties["provisioningState"]);
      const host: string | null = getAzureEventHubsHost({
        namespace: name,
        cloud: this.options.cloud,
      });

      if (!region || !host || (state && state.toLowerCase() !== "succeeded")) {
        continue;
      }

      namespaces.push({ name: name.toLowerCase(), region, host });

      if (namespaces.length >= AZURE_CLOUD_STREAM_MAX_NAMESPACES) {
        break;
      }
    }

    return namespaces.sort(
      (a: AzureEventHubNamespace, b: AzureEventHubNamespace): number => {
        return a.name.localeCompare(b.name);
      },
    );
  }

  /*
   * Every namespace's events from where they were read to, within the
   * budget; each fetch's events handed to `deliver` before its offsets
   * move (onOffset), and the offsets reached.
   */
  public async read(data: {
    namespaces: Array<AzureEventHubNamespace>;
    offsets: Record<string, Record<string, number>>;
    maxBytes: number;
    deadlineMs: number;
    deliver: (batch: AzureEventHubBatch) => Promise<void>;
    onOffset?:
      | ((
          namespace: string,
          partition: number,
          offset: number,
        ) => Promise<void>)
      | undefined;
  }): Promise<AzureEventHubsRead> {
    const result: AzureEventHubsRead = {
      namespaces: [],
      offsets: {},
      events: 0,
      bytes: 0,
      isBudgetSpent: false,
    };

    for (const namespace of data.namespaces) {
      const kept: Record<string, number> = {
        ...(data.offsets[namespace.name] || {}),
      };
      result.offsets[namespace.name] = kept;

      if (result.bytes >= data.maxBytes || this.now() >= data.deadlineMs) {
        result.isBudgetSpent = true;
        continue;
      }

      const read: AzureEventHubNamespaceRead = await this.readNamespace({
        namespace,
        offsets: kept,
        maxBytes: data.maxBytes - result.bytes,
        deadlineMs: data.deadlineMs,
        deliver: data.deliver,
        onOffset: data.onOffset,
        onBudgetSpent: (): void => {
          result.isBudgetSpent = true;
        },
      });

      result.namespaces.push(read);
      result.events += read.events;
      result.bytes += read.bytes;
    }

    return result;
  }

  private async socketFactoryFor(host: string): Promise<KafkaSocketFactory> {
    if (this.options.socketFactoryFor) {
      return await this.options.socketFactoryFor(host);
    }

    // The namespace's own host, resolved once and pinned: what was checked is what is dialed.
    const addresses: Array<ResolvedAddress> =
      await DataSourceEgressGuard.assertHostnameAllowed(host, {
        targetLabel: "Event Hubs namespace",
      });

    return createTlsSocketFactory(
      DataSourceEgressGuard.createPinnedLookup(addresses),
    );
  }

  private async readNamespace(data: {
    namespace: AzureEventHubNamespace;
    offsets: Record<string, number>;
    maxBytes: number;
    deadlineMs: number;
    deliver: (batch: AzureEventHubBatch) => Promise<void>;
    onOffset?:
      | ((
          namespace: string,
          partition: number,
          offset: number,
        ) => Promise<void>)
      | undefined;
    onBudgetSpent: () => void;
  }): Promise<AzureEventHubNamespaceRead> {
    const read: AzureEventHubNamespaceRead = {
      namespace: data.namespace,
      events: 0,
      bytes: 0,
    };
    const hub: string = AZURE_CLOUD_STREAM_EVENT_HUB;
    let client: KafkaClient | null = null;

    try {
      const token: string = await this.options.arm.getDataPlaneToken(
        `https://${data.namespace.host}`,
      );

      client = new KafkaClient({
        host: data.namespace.host,
        port: AZURE_EVENT_HUBS_KAFKA_PORT,
        clientId: AZURE_EVENT_HUBS_KAFKA_CLIENT_ID,
        // Never past the read's own deadline, however a namespace stalls.
        timeoutMs: Math.max(
          1000,
          Math.min(AZURE_EVENT_HUBS_TIMEOUT_MS, data.deadlineMs - this.now()),
        ),
        // A fetch's answer and its framing: never more is held.
        maxFrameBytes: CLOUD_STREAM_EVENT_HUB_MAX_FETCH_BYTES + 64 * 1024,
        socketFactory: await this.socketFactoryFor(data.namespace.host),
      });

      await client.connect();
      await client.readApiVersions();
      await client.authenticateWithToken(token);

      const metadata: { topic: KafkaTopicMetadata | null } =
        await client.getMetadata(hub);

      if (!metadata.topic || metadata.topic.errorCode !== KAFKA_ERROR_NONE) {
        if (
          metadata.topic?.errorCode === KAFKA_ERROR_TOPIC_AUTHORIZATION_FAILED
        ) {
          return {
            ...read,
            problem: "no-access",
            message: "The app may not read the event hub.",
          };
        }

        return { ...read, isWaiting: true };
      }

      const partitions: Array<number> = metadata.topic.partitions
        .filter((partition: { errorCode: number }): boolean => {
          return partition.errorCode === KAFKA_ERROR_NONE;
        })
        .map((partition: { partition: number }): number => {
          return partition.partition;
        })
        .filter((partition: number): boolean => {
          return (
            partition >= 0 && partition < AZURE_CLOUD_STREAM_MAX_PARTITIONS
          );
        })
        .sort((a: number, b: number): number => {
          return a - b;
        });

      const earliest: Map<number, number> = await this.listOffsets(
        client,
        hub,
        partitions,
        EARLIEST_OFFSET,
      );
      const latest: Map<number, number> = await this.listOffsets(
        client,
        hub,
        partitions,
        LATEST_OFFSET,
      );
      const positions: Map<number, number> = new Map();

      for (const partition of partitions) {
        const first: number = earliest.get(partition) ?? 0;
        const last: number = latest.get(partition) ?? first;
        const stored: number | undefined = data.offsets[String(partition)];

        // Never read, gone past by retention, or an event hub made again: from its first.
        positions.set(
          partition,
          stored === undefined || stored < first || stored > last
            ? first
            : stored,
        );
      }

      const done: Set<number> = new Set();

      for (;;) {
        const active: Array<number> = partitions.filter(
          (partition: number): boolean => {
            return (
              !done.has(partition) &&
              positions.get(partition)! < (latest.get(partition) ?? 0)
            );
          },
        );

        if (active.length === 0) {
          break;
        }

        const bytesLeft: number = data.maxBytes - read.bytes;

        if (bytesLeft <= 0 || this.now() >= data.deadlineMs) {
          data.onBudgetSpent();
          break;
        }

        const answer: {
          throttleTimeMs: number;
          partitions: Array<KafkaFetchedPartition>;
        } = await client.fetch({
          topic: hub,
          partitions: active.map((partition: number) => {
            return {
              partition,
              offset: positions.get(partition)!,
              maxBytes: Math.min(
                AZURE_EVENT_HUBS_PARTITION_FETCH_BYTES,
                bytesLeft,
              ),
            };
          }),
          maxWaitMs: AZURE_EVENT_HUBS_FETCH_WAIT_MS,
          minBytes: 1,
          maxBytes: Math.min(CLOUD_STREAM_EVENT_HUB_MAX_FETCH_BYTES, bytesLeft),
        });

        for (const fetched of answer.partitions) {
          if (!active.includes(fetched.partition)) {
            continue;
          }

          if (fetched.errorCode === KAFKA_ERROR_OFFSET_OUT_OF_RANGE) {
            // Retention went past it while reading: from the earliest it holds now.
            const now: Map<number, number> = await this.listOffsets(
              client,
              hub,
              [fetched.partition],
              EARLIEST_OFFSET,
            );
            positions.set(fetched.partition, now.get(fetched.partition) ?? 0);
            continue;
          }

          if (fetched.errorCode === KAFKA_ERROR_TOPIC_AUTHORIZATION_FAILED) {
            return {
              ...read,
              problem: "no-access",
              message: "The app may not read the event hub.",
            };
          }

          if (fetched.errorCode !== KAFKA_ERROR_NONE) {
            done.add(fetched.partition);
            continue;
          }

          if (fetched.highWatermark > (latest.get(fetched.partition) ?? 0)) {
            latest.set(fetched.partition, fetched.highWatermark);
          }

          const records: Array<KafkaRecord> = fetched.records.filter(
            (record: KafkaRecord): boolean => {
              return (
                record.offset >= positions.get(fetched.partition)! &&
                record.value !== null &&
                record.value.length > 0 &&
                record.value.length <= CLOUD_STREAM_EVENT_HUB_MAX_EVENT_BYTES
              );
            },
          );

          if (
            fetched.nextOffset === null ||
            fetched.nextOffset <= positions.get(fetched.partition)!
          ) {
            // Nothing whole came back: the partition is read as far as it can be now.
            done.add(fetched.partition);
            continue;
          }

          if (records.length > 0) {
            try {
              await data.deliver({
                namespace: data.namespace,
                partition: fetched.partition,
                records,
              });
            } catch (error) {
              throw new AzureEventHubsDeliveryFailed(error);
            }

            for (const record of records) {
              read.bytes += record.value!.length;
            }

            read.events += records.length;
          }

          positions.set(fetched.partition, fetched.nextOffset);
          data.offsets[String(fetched.partition)] = fetched.nextOffset;

          if (data.onOffset) {
            await data.onOffset(
              data.namespace.name,
              fetched.partition,
              fetched.nextOffset,
            );
          }
        }

        // Asked to slow down: the rest waits for the next read.
        if (answer.throttleTimeMs > 0) {
          break;
        }
      }

      for (const partition of partitions) {
        data.offsets[String(partition)] = positions.get(partition)!;
      }

      return read;
    } catch (error) {
      if (error instanceof AzureEventHubsDeliveryFailed) {
        throw error;
      }

      return {
        ...read,
        ...AzureEventHubsStream.describe(error),
      };
    } finally {
      client?.close();
    }
  }

  private async listOffsets(
    client: KafkaClient,
    hub: string,
    partitions: Array<number>,
    timestamp: number,
  ): Promise<Map<number, number>> {
    const offsets: Map<number, number> = new Map();

    if (partitions.length === 0) {
      return offsets;
    }

    const answers: Array<KafkaPartitionOffset> = await client.listOffsets({
      topic: hub,
      partitions,
      timestamp,
    });

    for (const answer of answers) {
      if (answer.errorCode === KAFKA_ERROR_NONE && answer.offset >= 0) {
        offsets.set(answer.partition, answer.offset);
      }
    }

    return offsets;
  }

  // What went wrong reading a namespace, said for the person setting it up.
  public static describe(error: unknown): {
    problem: AzureEventHubsProblem;
    message: string;
  } {
    const message: string =
      error instanceof Error ? error.message : String(error);

    if (
      error instanceof KafkaAuthenticationError ||
      (error instanceof LlmProviderError &&
        (error.statusCode === 400 ||
          error.statusCode === 401 ||
          error.statusCode === 403))
    ) {
      return { problem: "no-access", message };
    }

    return { problem: "unreachable", message };
  }
}

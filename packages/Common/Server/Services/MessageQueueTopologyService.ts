import MessageQueueService from "./MessageQueueService";
import ServiceService from "./ServiceService";
import SpanService from "./SpanService";
import { DbJSONResponse, Results } from "./AnalyticsDatabaseService";
import { Statement } from "../Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../Utils/AnalyticsDatabase/StatementGenerator";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import {
  MessageQueueTopologyKeys,
  MessageQueueTopologyPairRow,
  MessageQueueTopologyQueueRow,
  MessageQueueTopologyWindow,
  assembleMessageQueueTopology,
  buildMessageQueueTopologyKeys,
  buildMessageQueueTopologyStatement,
  readMessageQueueTopologyRows,
} from "../Utils/Telemetry/MessageQueueTopology";
import { TelemetryServiceFilter } from "../Utils/Telemetry/TelemetryReadScope";
import MessageQueue from "../../Models/DatabaseModels/MessageQueue";
import Service from "../../Models/DatabaseModels/Service";
import Span from "../../Models/AnalyticsModels/Span";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../Types/BaseDatabase/Includes";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  MESSAGE_QUEUE_TOPOLOGY_MAX_PAIRS,
  MESSAGE_QUEUE_TOPOLOGY_MAX_QUEUES,
  MessageQueueTopologyResponse,
} from "../../Types/MessageQueue/MessageQueueTopology";

/*
 * Runs the Queues topology's read (Utils/Telemetry/MessageQueueTopology)
 * for one project: the live queues the caller may read (Postgres, with
 * their props, so label-limited access applies as on the Queues list), then
 * the one span read over every queue's key, narrowed to the services the
 * caller may read, then the names of the services it found. A project with
 * no queue - or none whose identifier names a queue - sends no span read.
 */

export interface MessageQueueTopologyRequest {
  projectId: ObjectID;
  window: MessageQueueTopologyWindow;
  // The services whose spans the caller may read.
  serviceFilter: TelemetryServiceFilter;
  props: DatabaseCommonInteractionProps;
}

async function readRows(statement: Statement): Promise<Array<JSONObject>> {
  // A read stopped at its time limit throws (QueryTimeoutException).
  const result: Results = await SpanService.executeQuery(statement);
  const response: DbJSONResponse = await result.json<{
    data?: Array<JSONObject>;
  }>();
  return response.data || [];
}

export class MessageQueueTopologyService {
  /*
   * The live queues the caller may read, oldest first, at most
   * MESSAGE_QUEUE_TOPOLOGY_MAX_QUEUES of them, and whether there were more.
   */
  public static async readQueues(request: MessageQueueTopologyRequest): Promise<{
    queues: Array<MessageQueueTopologyQueueRow>;
    truncated: boolean;
  }> {
    const rows: Array<MessageQueue> = await MessageQueueService.findBy({
      query: { projectId: request.projectId, isArchived: false },
      select: {
        _id: true,
        name: true,
        messagingSystem: true,
        destinationName: true,
        brokerScope: true,
        brokerAddress: true,
        queueIdentifier: true,
        discoverySource: true,
        lastSeenAt: true,
        brokerMetricsLastSeenAt: true,
      },
      sort: { createdAt: SortOrder.Ascending },
      skip: 0,
      limit: MESSAGE_QUEUE_TOPOLOGY_MAX_QUEUES,
      props: request.props,
    });

    let truncated: boolean = false;
    if (rows.length >= MESSAGE_QUEUE_TOPOLOGY_MAX_QUEUES) {
      const total: number = (
        await MessageQueueService.countBy({
          query: { projectId: request.projectId, isArchived: false },
          props: request.props,
        })
      ).toNumber();
      truncated = total > rows.length;
    }

    return {
      queues: rows
        .filter((row: MessageQueue): boolean => {
          return Boolean(row._id);
        })
        .map((row: MessageQueue): MessageQueueTopologyQueueRow => {
          return {
            id: row._id!.toString(),
            name: row.name,
            messagingSystem: row.messagingSystem,
            destinationName: row.destinationName,
            brokerScope: row.brokerScope,
            brokerAddress: row.brokerAddress,
            queueIdentifier: row.queueIdentifier,
            discoverySource: row.discoverySource,
            lastSeenAt: row.lastSeenAt,
            brokerMetricsLastSeenAt: row.brokerMetricsLastSeenAt,
          };
        }),
      truncated: truncated,
    };
  }

  /*
   * The names of the services the read found, for the caller: read with
   * their props, so a service they may not read stays unnamed. A failed
   * lookup leaves them all unnamed - names are decoration, the map still
   * stands on the ids.
   */
  public static async readServiceNames(
    serviceIds: ReadonlyArray<string>,
    request: MessageQueueTopologyRequest,
  ): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();
    const ids: Array<string> = Array.from(new Set<string>(serviceIds)).filter(
      (id: string): boolean => {
        return ObjectID.isValidUUID(id);
      },
    );

    for (let start: number = 0; start < ids.length; start += LIMIT_MAX) {
      const chunk: Array<string> = ids.slice(start, start + LIMIT_MAX);
      try {
        const services: Array<Service> = await ServiceService.findBy({
          query: {
            projectId: request.projectId,
            _id: new Includes(
              chunk.map((id: string): ObjectID => {
                return new ObjectID(id);
              }),
            ),
          },
          select: { _id: true, name: true },
          skip: 0,
          limit: chunk.length,
          props: request.props,
        });
        for (const service of services) {
          const id: string = service._id?.toString() || "";
          if (id && service.name) {
            names.set(id, service.name);
          }
        }
      } catch (err) {
        logger.debug(
          `Message queue topology: service names were not read: ${String(err)}`,
        );
      }
    }

    return names;
  }

  @CaptureSpan()
  public static async getTopology(
    request: MessageQueueTopologyRequest,
  ): Promise<MessageQueueTopologyResponse> {
    const { queues, truncated: queuesTruncated } =
      await MessageQueueTopologyService.readQueues(request);

    const keys: MessageQueueTopologyKeys = buildMessageQueueTopologyKeys(
      request.projectId,
      queues,
    );

    let pairs: Array<MessageQueueTopologyPairRow> = [];
    let flowsTruncated: boolean = false;

    if (keys.keys.length > 0) {
      const statement: Statement = buildMessageQueueTopologyStatement({
        generator: SpanService.statementGenerator as StatementGenerator<Span>,
        projectId: request.projectId,
        keys: keys,
        window: request.window,
        serviceFilter: request.serviceFilter,
        rowLimit: MESSAGE_QUEUE_TOPOLOGY_MAX_PAIRS,
      });
      const rows: Array<JSONObject> = await readRows(statement);
      pairs = readMessageQueueTopologyRows(rows);
      flowsTruncated = rows.length >= MESSAGE_QUEUE_TOPOLOGY_MAX_PAIRS;
    }

    const serviceNames: Map<string, string> =
      await MessageQueueTopologyService.readServiceNames(
        pairs
          .map((pair: MessageQueueTopologyPairRow): string => {
            return pair.serviceId;
          })
          .filter(Boolean),
        request,
      );

    return assembleMessageQueueTopology({
      window: request.window,
      queues: queues,
      keys: keys,
      pairs: pairs,
      serviceNames: serviceNames,
      truncation: { queues: queuesTruncated, flows: flowsTruncated },
    });
  }
}

export default MessageQueueTopologyService;

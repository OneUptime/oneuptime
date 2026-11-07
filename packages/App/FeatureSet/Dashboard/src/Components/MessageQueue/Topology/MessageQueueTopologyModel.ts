import {
  MessageQueueFlowDirection,
  MessageQueueTopologyFlow,
  MessageQueueTopologyQueue,
  MessageQueueTopologyResponse,
  MessageQueueTopologyService,
} from "Common/Types/MessageQueue/MessageQueueTopology";
import { getMessagingSystemDisplayName } from "Common/Types/MessageQueue/MessagingSystem";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import computeLayeredLayout, {
  LayoutPoint,
} from "../../../Utils/LayeredGraphLayout";
import {
  SERVICE_MAP_TOLERATED_ERROR_RATE,
  TrafficHealth,
  healthForErrorRate,
} from "../../Topology/TopologyMeta";

/*
 * THE QUEUES TOPOLOGY'S VIEW MODEL: what the map is about, worked out once
 * from the API's answer (Common/Types/MessageQueue/MessageQueueTopology) and
 * never from what is filtered, so searching or focusing can never change a
 * node's health. Pure - no React, no API - so every decision the map makes is
 * unit-tested (Common/Tests/App/Dashboard/MessageQueueTopologyModel.test).
 *
 * The map reads the way messages travel, left to right: a service that
 * publishes, the queue it publishes to, the service that consumes from it,
 * and on through whatever that service publishes next. Nodes are the
 * project's queues and the services on either side of them; an edge is one
 * service's row on a queue's Producers or Consumers card, pointing from the
 * service to the queue for a publish and from the queue to the service for a
 * consume.
 *
 * Health stays calm unless something is actually wrong: a queue or service
 * whose spans fail more than the Service Map tolerates (1%) needs attention,
 * 5% is critical, and everything else is drawn in neutral slate rather than
 * green - a map of green says nothing. A queue nobody is seen consuming from
 * is said in words ("No consumer seen"), not in red: its consumers may simply
 * not be traced.
 */

export type MessageQueueTopologyNodeKind = "queue" | "service" | "broker";

export type MessageQueueTopologyStatus =
  | "flowing"
  | "degraded"
  | "critical"
  | "noConsumers"
  | "noProducers"
  | "idle";

// English keys, translated where they are drawn.
export const MESSAGE_QUEUE_TOPOLOGY_STATUS_LABELS: Record<
  MessageQueueTopologyStatus,
  string
> = {
  flowing: translationKey("Messages flowing"),
  degraded: translationKey("Some errors"),
  critical: translationKey("High error rate"),
  noConsumers: translationKey("No consumer seen"),
  noProducers: translationKey("No producer seen"),
  idle: translationKey("No traced messages"),
};

/*
 * Calm by default: slate for anything that is fine (or merely quiet), amber
 * and red only for errors.
 */
export const MESSAGE_QUEUE_TOPOLOGY_STATUS_COLORS: Record<
  MessageQueueTopologyStatus,
  string
> = {
  flowing: "#94a3b8",
  degraded: "#f59e0b",
  critical: "#dc2626",
  noConsumers: "#cbd5e1",
  noProducers: "#cbd5e1",
  idle: "#cbd5e1",
};

export const MESSAGE_QUEUE_TOPOLOGY_EDGE_COLORS: Record<TrafficHealth, string> =
  {
    healthy: "#94a3b8",
    degraded: "#f59e0b",
    critical: "#dc2626",
    unknown: "#cbd5e1",
  };

// The icon tint of a service, as on the Service Map.
export const MESSAGE_QUEUE_TOPOLOGY_SERVICE_COLOR: string = "#6366f1";

/*
 * The icon tints of the brokers, in order: calm hues that are not the
 * health colours, so a queue's broker can be told at a glance without
 * looking like a warning.
 */
export const MESSAGE_QUEUE_TOPOLOGY_BROKER_COLORS: ReadonlyArray<string> = [
  "#0f766e",
  "#0369a1",
  "#7c3aed",
  "#4338ca",
  "#0e7490",
  "#047857",
  "#9333ea",
  "#475569",
];

// The deepest a focus follows messages upstream and downstream, in edges.
export const MESSAGE_QUEUE_TOPOLOGY_FOCUS_DEPTH: number = 6;

// Past this many nodes a whole-project drawing opens as a table.
export const MESSAGE_QUEUE_TOPOLOGY_MAX_NODES_FOR_DEFAULT_MAP: number = 60;

export function getMessageQueueTopologyQueueKey(queueId: string): string {
  return `queue:${queueId}`;
}

export function getMessageQueueTopologyServiceKey(serviceId: string): string {
  return `service:${serviceId}`;
}

export function getMessageQueueTopologyBrokerKey(groupKey: string): string {
  return `broker:${groupKey}`;
}

export interface MessageQueueTopologyTraffic {
  messages: number;
  errors: number;
  /*
   * What the errors are a share of: the messages, or for a sender counted
   * from producer markers, its sends (MessageQueueTopologyFlow).
   */
  attempts: number;
}

interface NodeBase {
  key: string;
  kind: MessageQueueTopologyNodeKind;
  label: string;
  // Under the name: what it is, and where.
  subtitle: string;
  status: MessageQueueTopologyStatus;
  health: TrafficHealth;
  needsAttention: boolean;
  // The icon tile's tint.
  color: string;
  // Lower-case text a search term is matched against.
  searchText: string;
}

export interface MessageQueueTopologyQueueNode extends NodeBase {
  kind: "queue";
  queue: MessageQueueTopologyQueue;
  // "Apache Kafka", or the stored system of one the catalog does not know.
  systemLabel: string;
  // The Azure namespace, else the broker address, else "".
  brokerLabel: string;
  groupKey: string;
  producerCount: number;
  consumerCount: number;
}

export interface MessageQueueTopologyServiceNode extends NodeBase {
  kind: "service";
  service: MessageQueueTopologyService;
  // Whether the caller may read the service (it has a name to show).
  isNamed: boolean;
  published: MessageQueueTopologyTraffic;
  consumed: MessageQueueTopologyTraffic;
  publishesTo: number;
  consumesFrom: number;
}

export interface MessageQueueTopologyBrokerNode extends NodeBase {
  kind: "broker";
  groupKey: string;
  queueKeys: Array<string>;
  queueCount: number;
  published: number;
  consumed: number;
  spans: number;
  errors: number;
}

export type MessageQueueTopologyNode =
  | MessageQueueTopologyQueueNode
  | MessageQueueTopologyServiceNode
  | MessageQueueTopologyBrokerNode;

export interface MessageQueueTopologyEdge {
  id: string;
  /*
   * Node keys: the service then the queue for a publish, the queue then the
   * service for a consume.
   */
  from: string;
  to: string;
  direction: MessageQueueFlowDirection;
  queueKey: string;
  serviceKey: string;
  messages: number;
  errors: number;
  // What the errors are a share of (MessageQueueTopologyTraffic).
  attempts: number;
  // 0 to 100, as the queue's card shows it; null for nothing attempted.
  errorRatePercent: number | null;
  p95DurationMs: number | null;
  health: TrafficHealth;
}

// One broker: a messaging system, and for Azure its namespace.
export interface MessageQueueTopologyBrokerGroup {
  key: string;
  label: string;
  systemLabel: string;
  queueCount: number;
  color: string;
}

export interface MessageQueueTopologyModel {
  nodes: Array<MessageQueueTopologyNode>;
  nodeByKey: Map<string, MessageQueueTopologyNode>;
  edges: Array<MessageQueueTopologyEdge>;
  brokerGroups: Array<MessageQueueTopologyBrokerGroup>;
  // The range the figures cover, in seconds (at least 1).
  windowSeconds: number;
  queueCount: number;
  // Queues with any traced span in the range.
  activeQueueCount: number;
  serviceCount: number;
  // Messages published to and consumed from every queue in the range.
  published: number;
  consumed: number;
  attentionCount: number;
}

function sortedText(a: string, b: string): number {
  return a.localeCompare(b);
}

/** A queue's broker group: its system and, for Azure, its namespace. */
export function getMessageQueueTopologyGroupKey(
  queue: Pick<MessageQueueTopologyQueue, "messagingSystem" | "brokerScope">,
): string {
  const system: string = (queue.messagingSystem || "").trim().toLowerCase();
  const scope: string = (queue.brokerScope || "").trim().toLowerCase();
  return `${system}|${scope}`;
}

function brokerGroupLabel(
  queue: Pick<MessageQueueTopologyQueue, "messagingSystem" | "brokerScope">,
): string {
  const system: string =
    getMessagingSystemDisplayName(queue.messagingSystem) || "—";
  const scope: string = (queue.brokerScope || "").trim();
  return scope ? `${system} · ${scope}` : system;
}

/** What a queue is called on the map: its name, else its destination. */
export function getMessageQueueTopologyQueueLabel(
  queue: Pick<
    MessageQueueTopologyQueue,
    "name" | "destinationName" | "messagingSystem"
  >,
): string {
  return (
    (queue.name || "").trim() ||
    (queue.destinationName || "").trim() ||
    getMessagingSystemDisplayName(queue.messagingSystem) ||
    "—"
  );
}

// An unnamed service: one the caller may not read, or that is not a Service.
export const MESSAGE_QUEUE_TOPOLOGY_UNKNOWN_SERVICE: string =
  translationKey("Unknown service");

function healthOf(messages: number, errors: number): TrafficHealth {
  return healthForErrorRate(messages, errors, SERVICE_MAP_TOLERATED_ERROR_RATE);
}

/**
 * The health of a share of failures (0 to 1), by the Service Map's rule
 * (healthForErrorRate): within the tolerated rate healthy, under 5% some
 * errors, 5% and more critical; unknown for none attempted.
 */
export function getMessageQueueTopologyRateHealth(
  rate: number | null,
): TrafficHealth {
  if (rate === null || !Number.isFinite(rate) || rate < 0) {
    return "unknown";
  }
  if (rate <= SERVICE_MAP_TOLERATED_ERROR_RATE && rate < 0.05) {
    return "healthy";
  }
  return rate < 0.05 ? "degraded" : "critical";
}

/**
 * What a flow's errors are a share of: its sends, worked back from the
 * card's rate, when it failed some (a sender counted from producer markers
 * has more or fewer sends than messages), else its messages.
 */
export function getMessageQueueTopologyFlowAttempts(
  flow: Pick<
    MessageQueueTopologyFlow,
    "messages" | "errors" | "errorRatePercent"
  >,
): number {
  if (
    flow.errors > 0 &&
    flow.errorRatePercent !== null &&
    flow.errorRatePercent > 0
  ) {
    return (flow.errors * 100) / flow.errorRatePercent;
  }
  return flow.messages;
}

function rateOf(traffic: MessageQueueTopologyTraffic): number | null {
  return traffic.attempts > 0 ? traffic.errors / traffic.attempts : null;
}

function statusOfHealth(
  health: TrafficHealth,
): MessageQueueTopologyStatus | null {
  if (health === "critical") {
    return "critical";
  }
  if (health === "degraded") {
    return "degraded";
  }
  return null;
}

/**
 * What a queue is doing in the range: idle without a span, critical or
 * degraded by the error rate of all its spans, else whether messages are
 * seen going both ways.
 */
export function getMessageQueueTopologyQueueStatus(
  queue: Pick<
    MessageQueueTopologyQueue,
    "spans" | "errors" | "published" | "consumed"
  >,
): MessageQueueTopologyStatus {
  if (queue.spans <= 0) {
    return "idle";
  }
  const fromHealth: MessageQueueTopologyStatus | null = statusOfHealth(
    healthOf(queue.spans, queue.errors),
  );
  if (fromHealth) {
    return fromHealth;
  }
  if (queue.published > 0 && queue.consumed <= 0) {
    return "noConsumers";
  }
  if (queue.consumed > 0 && queue.published <= 0) {
    return "noProducers";
  }
  return "flowing";
}

function statusOfTraffic(
  traffic: MessageQueueTopologyTraffic,
): MessageQueueTopologyStatus {
  if (traffic.messages <= 0) {
    return "idle";
  }
  return (
    statusOfHealth(getMessageQueueTopologyRateHealth(rateOf(traffic))) ||
    "flowing"
  );
}

/**
 * The model of an answer. `windowSeconds` defaults to the answer's own
 * range. Queues come in the answer's order, services by name, and edges by
 * queue then direction then service, so the model is the same however the
 * answer was ordered.
 */
export function buildMessageQueueTopologyModel(
  response: MessageQueueTopologyResponse,
  options?: { windowSeconds?: number | undefined },
): MessageQueueTopologyModel {
  const start: number = Date.parse(response.startTime);
  const end: number = Date.parse(response.endTime);
  const answerSeconds: number =
    Number.isFinite(start) && Number.isFinite(end) && end > start
      ? (end - start) / 1000
      : 0;
  const windowSeconds: number = Math.max(
    1,
    options?.windowSeconds && options.windowSeconds > 0
      ? options.windowSeconds
      : answerSeconds,
  );

  // Brokers, coloured in a fixed order of their keys.
  const groupLabels: Map<string, { label: string; systemLabel: string }> =
    new Map<string, { label: string; systemLabel: string }>();
  const groupCounts: Map<string, number> = new Map<string, number>();
  for (const queue of response.queues) {
    const key: string = getMessageQueueTopologyGroupKey(queue);
    if (!groupLabels.has(key)) {
      groupLabels.set(key, {
        label: brokerGroupLabel(queue),
        systemLabel:
          getMessagingSystemDisplayName(queue.messagingSystem) || "—",
      });
    }
    groupCounts.set(key, (groupCounts.get(key) || 0) + 1);
  }
  const groupKeys: Array<string> = Array.from(groupLabels.keys()).sort(
    sortedText,
  );
  const groupColor: Map<string, string> = new Map<string, string>();
  groupKeys.forEach((key: string, index: number): void => {
    groupColor.set(
      key,
      MESSAGE_QUEUE_TOPOLOGY_BROKER_COLORS[
        index % MESSAGE_QUEUE_TOPOLOGY_BROKER_COLORS.length
      ]!,
    );
  });
  const brokerGroups: Array<MessageQueueTopologyBrokerGroup> = groupKeys.map(
    (key: string): MessageQueueTopologyBrokerGroup => {
      const labels: { label: string; systemLabel: string } =
        groupLabels.get(key)!;
      return {
        key: key,
        label: labels.label,
        systemLabel: labels.systemLabel,
        queueCount: groupCounts.get(key) || 0,
        color: groupColor.get(key)!,
      };
    },
  );

  const queueById: Map<string, MessageQueueTopologyQueue> = new Map<
    string,
    MessageQueueTopologyQueue
  >();
  for (const queue of response.queues) {
    queueById.set(queue.id, queue);
  }
  const serviceById: Map<string, MessageQueueTopologyService> = new Map<
    string,
    MessageQueueTopologyService
  >();
  for (const service of response.services) {
    serviceById.set(service.id, service);
  }

  // Edges, and what each node took part in.
  const edges: Array<MessageQueueTopologyEdge> = [];
  const producersOf: Map<string, Set<string>> = new Map<string, Set<string>>();
  const consumersOf: Map<string, Set<string>> = new Map<string, Set<string>>();
  const servicePublished: Map<string, MessageQueueTopologyTraffic> = new Map();
  const serviceConsumed: Map<string, MessageQueueTopologyTraffic> = new Map();
  const servicePublishesTo: Map<string, Set<string>> = new Map();
  const serviceConsumesFrom: Map<string, Set<string>> = new Map();

  const flows: Array<MessageQueueTopologyFlow> = [...response.flows]
    .filter((flow: MessageQueueTopologyFlow): boolean => {
      return queueById.has(flow.queueId) && flow.messages > 0;
    })
    .sort(
      (a: MessageQueueTopologyFlow, b: MessageQueueTopologyFlow): number => {
        return (
          sortedText(a.queueId, b.queueId) ||
          sortedText(a.direction, b.direction) ||
          sortedText(a.serviceId, b.serviceId)
        );
      },
    );

  const seenEdges: Set<string> = new Set<string>();
  for (const flow of flows) {
    const queueKey: string = getMessageQueueTopologyQueueKey(flow.queueId);
    const serviceKey: string = getMessageQueueTopologyServiceKey(
      flow.serviceId,
    );
    const id: string = `${flow.direction}:${serviceKey}:${queueKey}`;
    if (seenEdges.has(id)) {
      continue;
    }
    seenEdges.add(id);
    const isPublish: boolean = flow.direction === "publish";
    const errors: number = flow.errors;
    const attempts: number = getMessageQueueTopologyFlowAttempts(flow);
    const errorRatePercent: number | null =
      flow.errorRatePercent !== null
        ? flow.errorRatePercent
        : attempts > 0
          ? Math.min(100, (errors / attempts) * 100)
          : null;
    edges.push({
      id: id,
      from: isPublish ? serviceKey : queueKey,
      to: isPublish ? queueKey : serviceKey,
      direction: flow.direction,
      queueKey: queueKey,
      serviceKey: serviceKey,
      messages: flow.messages,
      errors: errors,
      attempts: attempts,
      errorRatePercent: errorRatePercent,
      p95DurationMs: flow.p95DurationMs,
      health: getMessageQueueTopologyRateHealth(
        errorRatePercent === null ? null : errorRatePercent / 100,
      ),
    });

    const sides: Map<string, Set<string>> = isPublish
      ? producersOf
      : consumersOf;
    const side: Set<string> = sides.get(flow.queueId) || new Set<string>();
    side.add(flow.serviceId);
    sides.set(flow.queueId, side);

    const traffic: Map<string, MessageQueueTopologyTraffic> = isPublish
      ? servicePublished
      : serviceConsumed;
    const total: MessageQueueTopologyTraffic = traffic.get(flow.serviceId) || {
      messages: 0,
      errors: 0,
      attempts: 0,
    };
    traffic.set(flow.serviceId, {
      messages: total.messages + flow.messages,
      errors: total.errors + errors,
      attempts: total.attempts + attempts,
    });

    const reach: Map<string, Set<string>> = isPublish
      ? servicePublishesTo
      : serviceConsumesFrom;
    const queues: Set<string> = reach.get(flow.serviceId) || new Set<string>();
    queues.add(flow.queueId);
    reach.set(flow.serviceId, queues);
  }

  const nodes: Array<MessageQueueTopologyNode> = [];

  for (const queue of response.queues) {
    const status: MessageQueueTopologyStatus =
      getMessageQueueTopologyQueueStatus(queue);
    const health: TrafficHealth = healthOf(queue.spans, queue.errors);
    const systemLabel: string =
      getMessagingSystemDisplayName(queue.messagingSystem) || "—";
    const brokerLabel: string =
      (queue.brokerScope || "").trim() || (queue.brokerAddress || "").trim();
    const groupKey: string = getMessageQueueTopologyGroupKey(queue);
    const label: string = getMessageQueueTopologyQueueLabel(queue);
    nodes.push({
      key: getMessageQueueTopologyQueueKey(queue.id),
      kind: "queue",
      queue: queue,
      label: label,
      subtitle: brokerLabel ? `${systemLabel} · ${brokerLabel}` : systemLabel,
      status: status,
      health: health,
      needsAttention: status === "critical" || status === "degraded",
      color:
        groupColor.get(groupKey) || MESSAGE_QUEUE_TOPOLOGY_BROKER_COLORS[0]!,
      systemLabel: systemLabel,
      brokerLabel: brokerLabel,
      groupKey: groupKey,
      producerCount: producersOf.get(queue.id)?.size || 0,
      consumerCount: consumersOf.get(queue.id)?.size || 0,
      searchText: [
        label,
        queue.destinationName,
        queue.messagingSystem,
        systemLabel,
        queue.brokerScope,
        queue.brokerAddress,
      ]
        .join(" ")
        .toLowerCase(),
    });
  }

  const serviceIds: Array<string> = Array.from(
    new Set<string>(
      [...producersOf.values(), ...consumersOf.values()].flatMap(
        (set: Set<string>): Array<string> => {
          return Array.from(set);
        },
      ),
    ),
  );
  const serviceNodes: Array<MessageQueueTopologyServiceNode> = serviceIds.map(
    (id: string): MessageQueueTopologyServiceNode => {
      const service: MessageQueueTopologyService = serviceById.get(id) || {
        id: id,
        name: "",
      };
      const name: string = (service.name || "").trim();
      const published: MessageQueueTopologyTraffic = servicePublished.get(
        id,
      ) || { messages: 0, errors: 0, attempts: 0 };
      const consumed: MessageQueueTopologyTraffic = serviceConsumed.get(id) || {
        messages: 0,
        errors: 0,
        attempts: 0,
      };
      const both: MessageQueueTopologyTraffic = {
        messages: published.messages + consumed.messages,
        errors: published.errors + consumed.errors,
        attempts: published.attempts + consumed.attempts,
      };
      const status: MessageQueueTopologyStatus = statusOfTraffic(both);
      return {
        key: getMessageQueueTopologyServiceKey(id),
        kind: "service",
        service: service,
        isNamed: Boolean(name),
        label: name || MESSAGE_QUEUE_TOPOLOGY_UNKNOWN_SERVICE,
        subtitle: "",
        status: status,
        health: getMessageQueueTopologyRateHealth(rateOf(both)),
        needsAttention: status === "critical" || status === "degraded",
        color: MESSAGE_QUEUE_TOPOLOGY_SERVICE_COLOR,
        published: published,
        consumed: consumed,
        publishesTo: servicePublishesTo.get(id)?.size || 0,
        consumesFrom: serviceConsumesFrom.get(id)?.size || 0,
        searchText: `${name} ${id}`.toLowerCase(),
      };
    },
  );
  serviceNodes.sort(
    (
      a: MessageQueueTopologyServiceNode,
      b: MessageQueueTopologyServiceNode,
    ): number => {
      return sortedText(a.label, b.label) || sortedText(a.key, b.key);
    },
  );
  nodes.push(...serviceNodes);

  const nodeByKey: Map<string, MessageQueueTopologyNode> = new Map<
    string,
    MessageQueueTopologyNode
  >();
  for (const node of nodes) {
    nodeByKey.set(node.key, node);
  }

  return {
    nodes: nodes,
    nodeByKey: nodeByKey,
    edges: edges,
    brokerGroups: brokerGroups,
    windowSeconds: windowSeconds,
    queueCount: response.queues.length,
    activeQueueCount: response.queues.filter(
      (queue: MessageQueueTopologyQueue): boolean => {
        return queue.spans > 0;
      },
    ).length,
    serviceCount: serviceNodes.length,
    published: response.queues.reduce(
      (total: number, queue: MessageQueueTopologyQueue): number => {
        return total + queue.published;
      },
      0,
    ),
    consumed: response.queues.reduce(
      (total: number, queue: MessageQueueTopologyQueue): number => {
        return total + queue.consumed;
      },
      0,
    ),
    attentionCount: nodes.filter((node: MessageQueueTopologyNode): boolean => {
      return node.needsAttention;
    }).length,
  };
}

// ---- grouping by broker ------------------------------------------------------

/**
 * The model with each broker's queues folded into one node: a broker that
 * stands for its queues, and one edge per service and direction carrying
 * their messages. A broker's health is its queues' spans'; an edge's is its
 * messages'. p95 times do not add up across queues, so a folded edge has
 * none. The services are as they are.
 */
export function groupMessageQueueTopologyByBroker(
  model: MessageQueueTopologyModel,
): MessageQueueTopologyModel {
  const brokers: Map<string, MessageQueueTopologyBrokerNode> = new Map<
    string,
    MessageQueueTopologyBrokerNode
  >();
  const brokerOfQueue: Map<string, string> = new Map<string, string>();

  for (const group of model.brokerGroups) {
    brokers.set(group.key, {
      key: getMessageQueueTopologyBrokerKey(group.key),
      kind: "broker",
      groupKey: group.key,
      label: group.label,
      subtitle: group.systemLabel,
      status: "idle",
      health: "unknown",
      needsAttention: false,
      color: group.color,
      queueKeys: [],
      queueCount: 0,
      published: 0,
      consumed: 0,
      spans: 0,
      errors: 0,
      searchText: `${group.label} ${group.systemLabel}`.toLowerCase(),
    });
  }

  for (const node of model.nodes) {
    if (node.kind !== "queue") {
      continue;
    }
    const broker: MessageQueueTopologyBrokerNode | undefined = brokers.get(
      node.groupKey,
    );
    if (!broker) {
      continue;
    }
    brokerOfQueue.set(node.key, broker.key);
    broker.queueKeys.push(node.key);
    broker.queueCount += 1;
    broker.published += node.queue.published;
    broker.consumed += node.queue.consumed;
    broker.spans += node.queue.spans;
    broker.errors += node.queue.errors;
    broker.searchText += ` ${node.searchText}`;
  }

  for (const broker of brokers.values()) {
    broker.status = getMessageQueueTopologyQueueStatus({
      spans: broker.spans,
      errors: broker.errors,
      published: broker.published,
      consumed: broker.consumed,
    });
    broker.health = healthOf(broker.spans, broker.errors);
    broker.needsAttention =
      broker.status === "critical" || broker.status === "degraded";
  }

  const folded: Map<string, MessageQueueTopologyEdge> = new Map<
    string,
    MessageQueueTopologyEdge
  >();
  for (const edge of model.edges) {
    const brokerKey: string | undefined = brokerOfQueue.get(edge.queueKey);
    if (!brokerKey) {
      continue;
    }
    const id: string = `${edge.direction}:${edge.serviceKey}:${brokerKey}`;
    const existing: MessageQueueTopologyEdge | undefined = folded.get(id);
    const messages: number = (existing?.messages || 0) + edge.messages;
    const errors: number = (existing?.errors || 0) + edge.errors;
    const attempts: number = (existing?.attempts || 0) + edge.attempts;
    const rate: number | null = attempts > 0 ? errors / attempts : null;
    folded.set(id, {
      id: id,
      from: edge.direction === "publish" ? edge.serviceKey : brokerKey,
      to: edge.direction === "publish" ? brokerKey : edge.serviceKey,
      direction: edge.direction,
      queueKey: brokerKey,
      serviceKey: edge.serviceKey,
      messages: messages,
      errors: errors,
      attempts: attempts,
      errorRatePercent: rate === null ? null : Math.min(100, rate * 100),
      p95DurationMs: null,
      health: getMessageQueueTopologyRateHealth(rate),
    });
  }

  const nodes: Array<MessageQueueTopologyNode> = [
    ...Array.from(brokers.values()).filter(
      (broker: MessageQueueTopologyBrokerNode): boolean => {
        return broker.queueCount > 0;
      },
    ),
    ...model.nodes.filter((node: MessageQueueTopologyNode): boolean => {
      return node.kind === "service";
    }),
  ];
  const nodeByKey: Map<string, MessageQueueTopologyNode> = new Map<
    string,
    MessageQueueTopologyNode
  >();
  for (const node of nodes) {
    nodeByKey.set(node.key, node);
  }

  return {
    ...model,
    nodes: nodes,
    nodeByKey: nodeByKey,
    edges: Array.from(folded.values()).sort(
      (a: MessageQueueTopologyEdge, b: MessageQueueTopologyEdge): number => {
        return sortedText(a.id, b.id);
      },
    ),
    attentionCount: nodes.filter((node: MessageQueueTopologyNode): boolean => {
      return node.needsAttention;
    }).length,
  };
}

// ---- what is shown ---------------------------------------------------------------

export interface MessageQueueTopologyFilters {
  search: string;
  // A broker group's key, or null for every broker.
  brokerGroupKey: string | null;
  attentionOnly: boolean;
  // A node to follow messages through, or null for the whole map.
  focusKey: string | null;
}

export interface MessageQueueTopologyVisibility {
  // Nodes the filters picked.
  matchedKeys: Set<string>;
  // Their neighbours, drawn dimmed so a match is never drawn alone.
  contextKeys: Set<string>;
  visibleKeys: Set<string>;
  // The focus, when it names a node of the model.
  effectiveFocusKey: string | null;
  // What the focus reaches: the focus, everything upstream and downstream.
  focusKeys: Set<string> | null;
}

/**
 * Everything messages reach from a node, and everything that reaches it:
 * downstream along the edges' direction and upstream against it, each at
 * most `depth` edges away. For a queue that is where its messages come from
 * and where they go; for a service, what feeds it and what it feeds. Nodes
 * beside the path (the other queue a producer also publishes to) are not on
 * it.
 */
export function getMessageQueueTopologyLineage(
  model: Pick<MessageQueueTopologyModel, "edges" | "nodeByKey">,
  key: string,
  depth: number = MESSAGE_QUEUE_TOPOLOGY_FOCUS_DEPTH,
): Set<string> {
  const reached: Set<string> = new Set<string>();
  if (!model.nodeByKey.has(key)) {
    return reached;
  }
  reached.add(key);

  const outgoing: Map<string, Array<string>> = new Map<string, Array<string>>();
  const incoming: Map<string, Array<string>> = new Map<string, Array<string>>();
  for (const edge of model.edges) {
    const out: Array<string> = outgoing.get(edge.from) || [];
    out.push(edge.to);
    outgoing.set(edge.from, out);
    const into: Array<string> = incoming.get(edge.to) || [];
    into.push(edge.from);
    incoming.set(edge.to, into);
  }

  for (const neighbours of [outgoing, incoming]) {
    const seen: Set<string> = new Set<string>([key]);
    let frontier: Array<string> = [key];
    for (let hop: number = 0; hop < depth && frontier.length > 0; hop++) {
      const next: Array<string> = [];
      for (const node of frontier) {
        for (const neighbour of neighbours.get(node) || []) {
          if (!seen.has(neighbour)) {
            seen.add(neighbour);
            reached.add(neighbour);
            next.push(neighbour);
          }
        }
      }
      frontier = next;
    }
  }

  return reached;
}

function neighboursOf(
  edges: ReadonlyArray<MessageQueueTopologyEdge>,
): Map<string, Set<string>> {
  const neighbours: Map<string, Set<string>> = new Map<string, Set<string>>();
  for (const edge of edges) {
    for (const [a, b] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ] as Array<[string, string]>) {
      const set: Set<string> = neighbours.get(a) || new Set<string>();
      set.add(b);
      neighbours.set(a, set);
    }
  }
  return neighbours;
}

function inBrokerGroup(
  node: MessageQueueTopologyNode,
  groupKey: string,
): boolean {
  if (node.kind === "queue" || node.kind === "broker") {
    return node.groupKey === groupKey;
  }
  return true;
}

/**
 * What the map shows for the filters: the focus's lineage (or every node),
 * narrowed to one broker's queues and the services on them, then the nodes
 * a search or "Needs attention" picks - each drawn with its neighbours,
 * dimmed, so a match is never drawn alone.
 */
export function resolveMessageQueueTopologyVisibility(
  model: MessageQueueTopologyModel,
  filters: MessageQueueTopologyFilters,
): MessageQueueTopologyVisibility {
  const effectiveFocusKey: string | null =
    filters.focusKey && model.nodeByKey.has(filters.focusKey)
      ? filters.focusKey
      : null;
  const focusKeys: Set<string> | null = effectiveFocusKey
    ? getMessageQueueTopologyLineage(model, effectiveFocusKey)
    : null;

  const neighbours: Map<string, Set<string>> = neighboursOf(model.edges);

  // The scope: the focus's lineage, and one broker's part of it.
  const scope: Set<string> = new Set<string>();
  const groupKey: string | null =
    filters.brokerGroupKey &&
    model.brokerGroups.some((group: MessageQueueTopologyBrokerGroup) => {
      return group.key === filters.brokerGroupKey;
    })
      ? filters.brokerGroupKey
      : null;
  for (const node of model.nodes) {
    if (focusKeys && !focusKeys.has(node.key)) {
      continue;
    }
    if (groupKey && !inBrokerGroup(node, groupKey)) {
      continue;
    }
    scope.add(node.key);
  }
  if (groupKey) {
    // A service is in a broker's part only through one of its queues.
    for (const key of Array.from(scope)) {
      const node: MessageQueueTopologyNode = model.nodeByKey.get(key)!;
      if (node.kind !== "service") {
        continue;
      }
      const onBroker: boolean = Array.from(neighbours.get(key) || []).some(
        (neighbour: string): boolean => {
          const other: MessageQueueTopologyNode | undefined =
            model.nodeByKey.get(neighbour);
          return Boolean(
            other && scope.has(neighbour) && inBrokerGroup(other, groupKey),
          );
        },
      );
      if (!onBroker) {
        scope.delete(key);
      }
    }
  }

  const terms: Array<string> = filters.search
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const matchedKeys: Set<string> = new Set<string>();
  for (const node of model.nodes) {
    if (
      scope.has(node.key) &&
      (!filters.attentionOnly || node.needsAttention) &&
      terms.every((term: string): boolean => {
        return node.searchText.includes(term) || node.key.includes(term);
      })
    ) {
      matchedKeys.add(node.key);
    }
  }

  const contextKeys: Set<string> = new Set<string>();
  if (terms.length > 0 || filters.attentionOnly) {
    for (const key of matchedKeys) {
      for (const neighbour of neighbours.get(key) || []) {
        if (scope.has(neighbour) && !matchedKeys.has(neighbour)) {
          contextKeys.add(neighbour);
        }
      }
    }
  }

  return {
    matchedKeys: matchedKeys,
    contextKeys: contextKeys,
    visibleKeys: new Set<string>([...matchedKeys, ...contextKeys]),
    effectiveFocusKey: effectiveFocusKey,
    focusKeys: focusKeys,
  };
}

// ---- layout -------------------------------------------------------------------------

export interface MessageQueueTopologyLayout {
  positions: Map<string, LayoutPoint>;
  // Visible nodes with no visible edge: listed beside the map, not drawn.
  unconnectedKeys: Array<string>;
}

/**
 * Left to right the way messages travel: publishers, then their queues,
 * then the consumers, and on through what those publish. The shared layered
 * layout (LayeredGraphLayout) lays the connected nodes out top to bottom and
 * the axes are swapped. A node without a visible edge is not drawn: a grid
 * of lone cards reads as a broken map.
 */
export function layoutMessageQueueTopology(options: {
  visibleKeys: Set<string>;
  edges: ReadonlyArray<MessageQueueTopologyEdge>;
  columnGap: number;
  rowGap: number;
}): MessageQueueTopologyLayout {
  const visibleEdges: Array<MessageQueueTopologyEdge> = options.edges.filter(
    (edge: MessageQueueTopologyEdge): boolean => {
      return (
        options.visibleKeys.has(edge.from) && options.visibleKeys.has(edge.to)
      );
    },
  );
  const connected: Set<string> = new Set<string>();
  for (const edge of visibleEdges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  const layered: Map<string, LayoutPoint> = computeLayeredLayout(
    Array.from(connected),
    visibleEdges.map((edge: MessageQueueTopologyEdge) => {
      return { from: edge.from, to: edge.to };
    }),
    { xGap: options.rowGap, yGap: options.columnGap },
  );
  const positions: Map<string, LayoutPoint> = new Map<string, LayoutPoint>();
  for (const [key, point] of layered) {
    positions.set(key, { x: point.y, y: point.x });
  }
  return {
    positions: positions,
    unconnectedKeys: Array.from(options.visibleKeys)
      .filter((key: string): boolean => {
        return !connected.has(key);
      })
      .sort(),
  };
}

// ---- numbers ------------------------------------------------------------------------

/**
 * Messages per unit of time over the range, the unit chosen so the number
 * reads: per second from one a second ("12/s", "1.2k/s"), else per minute
 * ("45/min", "0.4/min"), "<0.1/min" for a trickle and "—" for none.
 */
export function formatMessageQueueTopologyRate(
  messages: number,
  windowSeconds: number,
): string {
  if (!(messages > 0) || !(windowSeconds > 0)) {
    return "—";
  }
  const perSecond: number = messages / windowSeconds;
  if (perSecond >= 1) {
    if (perSecond >= 1000000) {
      return `${(perSecond / 1000000).toFixed(1)}M/s`;
    }
    if (perSecond >= 1000) {
      return `${(perSecond / 1000).toFixed(1)}k/s`;
    }
    return perSecond >= 10
      ? `${Math.round(perSecond)}/s`
      : `${perSecond.toFixed(1)}/s`;
  }
  const perMinute: number = perSecond * 60;
  if (perMinute >= 10) {
    return `${Math.round(perMinute)}/min`;
  }
  if (perMinute >= 0.1) {
    return `${perMinute.toFixed(1)}/min`;
  }
  return "<0.1/min";
}

/** A share of failures in percent: "0%", "<0.1%", "2.5%"; "—" for none. */
export function formatMessageQueueTopologyPercent(
  percent: number | null,
): string {
  if (percent === null || !Number.isFinite(percent) || percent < 0) {
    return "—";
  }
  const held: number = Math.min(percent, 100);
  if (held === 0) {
    return "0%";
  }
  if (held < 0.1) {
    return "<0.1%";
  }
  return `${held.toFixed(1)}%`;
}

/** A share of failed spans or messages: "—" when nothing happened. */
export function formatMessageQueueTopologyErrorRate(
  total: number,
  errors: number,
): string {
  if (!(total > 0)) {
    return "—";
  }
  return formatMessageQueueTopologyPercent(
    (Math.min(errors, total) / total) * 100,
  );
}

/** An edge's stroke, wider for more messages (log scale, so a hub stays sane). */
export function getMessageQueueTopologyEdgeWidth(messages: number): number {
  if (!(messages > 0)) {
    return 1.5;
  }
  return Math.min(6, 1.5 + Math.log10(messages + 1) * 1.2);
}

// ---- the table ------------------------------------------------------------------------

export interface MessageQueueTopologyTableRow {
  node: MessageQueueTopologyQueueNode;
  producers: Array<MessageQueueTopologyServiceNode>;
  consumers: Array<MessageQueueTopologyServiceNode>;
}

/**
 * The table view: one row per queue the filters match (or that a matched
 * service touches), busiest first, with the services on each side, busiest
 * first.
 */
export function getMessageQueueTopologyTableRows(
  model: MessageQueueTopologyModel,
  visibility: MessageQueueTopologyVisibility,
): Array<MessageQueueTopologyTableRow> {
  const rows: Array<MessageQueueTopologyTableRow> = [];
  const sides: Map<
    string,
    {
      producers: Array<MessageQueueTopologyEdge>;
      consumers: Array<MessageQueueTopologyEdge>;
    }
  > = new Map();
  for (const edge of model.edges) {
    const side: {
      producers: Array<MessageQueueTopologyEdge>;
      consumers: Array<MessageQueueTopologyEdge>;
    } = sides.get(edge.queueKey) || { producers: [], consumers: [] };
    (edge.direction === "publish" ? side.producers : side.consumers).push(edge);
    sides.set(edge.queueKey, side);
  }

  const busiestFirst: (
    a: MessageQueueTopologyEdge,
    b: MessageQueueTopologyEdge,
  ) => number = (
    a: MessageQueueTopologyEdge,
    b: MessageQueueTopologyEdge,
  ): number => {
    return b.messages - a.messages || sortedText(a.serviceKey, b.serviceKey);
  };
  const servicesOf: (
    edges: Array<MessageQueueTopologyEdge>,
  ) => Array<MessageQueueTopologyServiceNode> = (
    edges: Array<MessageQueueTopologyEdge>,
  ): Array<MessageQueueTopologyServiceNode> => {
    return [...edges]
      .sort(busiestFirst)
      .map((edge: MessageQueueTopologyEdge) => {
        return model.nodeByKey.get(edge.serviceKey);
      })
      .filter(
        (
          node: MessageQueueTopologyNode | undefined,
        ): node is MessageQueueTopologyServiceNode => {
          return node?.kind === "service";
        },
      );
  };

  for (const node of model.nodes) {
    if (node.kind !== "queue" || !visibility.visibleKeys.has(node.key)) {
      continue;
    }
    const side:
      | {
          producers: Array<MessageQueueTopologyEdge>;
          consumers: Array<MessageQueueTopologyEdge>;
        }
      | undefined = sides.get(node.key);
    rows.push({
      node: node,
      producers: servicesOf(side?.producers || []),
      consumers: servicesOf(side?.consumers || []),
    });
  }

  rows.sort(
    (
      a: MessageQueueTopologyTableRow,
      b: MessageQueueTopologyTableRow,
    ): number => {
      return (
        b.node.queue.published +
          b.node.queue.consumed -
          (a.node.queue.published + a.node.queue.consumed) ||
        sortedText(a.node.label, b.node.label) ||
        sortedText(a.node.key, b.node.key)
      );
    },
  );
  return rows;
}

// ---- what to say when there is nothing to draw ------------------------------------------

/*
 * Why the map has nothing to draw, in the order a person meets them: no
 * queue at all; queues, but none of their spans in the range; spans, but
 * none that a service recorded as a publish or a consume.
 */
export type MessageQueueTopologyEmptyReason =
  | "noQueues"
  | "noTraffic"
  | "noFlows";

export function getMessageQueueTopologyEmptyReason(
  model: MessageQueueTopologyModel,
): MessageQueueTopologyEmptyReason | null {
  if (model.queueCount === 0) {
    return "noQueues";
  }
  if (model.activeQueueCount === 0) {
    return "noTraffic";
  }
  if (model.edges.length === 0) {
    return "noFlows";
  }
  return null;
}

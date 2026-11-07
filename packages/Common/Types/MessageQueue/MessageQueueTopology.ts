/*
 * THE QUEUES TOPOLOGY'S CONTRACT (POST /api/telemetry/message-queues/topology):
 * how messages flow between a project's services and its queues over a time
 * range — which services publish to each queue, which consume from it, and
 * how many messages each of them moved and how many failed.
 *
 * The server reads it in one pass over the spans that carry a queue's key
 * (Server/Utils/Telemetry/MessageQueueTopology), and counts a service's
 * messages exactly as the queue's Producers and Consumers cards do
 * (Types/MessageQueue/MessageQueueSpanPopulation), so a line on the map and
 * the queue's Overview never disagree. The Dashboard draws it
 * (Components/MessageQueue/Topology). Pure and isomorphic: the decoder
 * below is how the Dashboard reads an answer, and it never throws.
 */

export const MESSAGE_QUEUE_TOPOLOGY_API_PATH: string =
  "/telemetry/message-queues/topology";

/*
 * The widest range the topology reads: the longest a project keeps traces
 * for. A wider one is refused rather than cut, so the map never says less
 * than the range it shows.
 */
export const MESSAGE_QUEUE_TOPOLOGY_MAX_RANGE_MS: number =
  93 * 24 * 60 * 60 * 1000;

/*
 * The most queues the topology reads: a project's live queues, oldest
 * first beyond this are left out and the answer says so. The Queues list
 * reads pages of the same rows.
 */
export const MESSAGE_QUEUE_TOPOLOGY_MAX_QUEUES: number = 10000;

/*
 * The most (queue, service) pairs the one read returns, busiest first. A
 * pair is a service on one queue, so this is far beyond any map a person
 * reads; the answer says when it was reached.
 */
export const MESSAGE_QUEUE_TOPOLOGY_MAX_PAIRS: number = 50000;

// Which way messages go between a service and a queue.
export type MessageQueueFlowDirection = "publish" | "consume";

export interface MessageQueueTopologyQueue {
  id: string;
  name: string;
  // The row's SPECIFIC system ("activemq"), as the queue's pages show it.
  messagingSystem: string;
  destinationName: string;
  // The Azure namespace of a Service Bus / Event Hubs queue, else "".
  brokerScope: string;
  // The broker address the queue's telemetry last reported, display only.
  brokerAddress: string;
  // `${system}|${brokerScope}|${destination}`: what its telemetry is keyed on.
  queueIdentifier: string;
  discoverySource: string;
  // ISO dates, or null.
  lastSeenAt: string | null;
  brokerMetricsLastSeenAt: string | null;
  /*
   * Its spans in the range, as the queue's Overview counts them: every span
   * naming it (the error rate's denominator), the failed ones of any kind,
   * the messages published (producer spans, plus the send spans of services
   * that record their publishes only as client spans) and consumed (consumer
   * spans that handled messages, plus SQS receives that returned some).
   */
  spans: number;
  errors: number;
  published: number;
  consumed: number;
}

export interface MessageQueueTopologyService {
  // Span.primaryEntityId: a Service's id.
  id: string;
  // "" when the caller may not read the service, or it is not one.
  name: string;
}

/*
 * One service on one side of one queue: its row in the queue's Producers
 * ("publish") or Consumers ("consume") card, number for number. A sender
 * whose producer spans are markers made before its sends (the Azure SDKs)
 * has its messages counted from the markers and its failures from the
 * sends, so its errors can exceed its messages; its error rate is its
 * failed sends' share of its sends, as on the card.
 */
export interface MessageQueueTopologyFlow {
  queueId: string;
  serviceId: string;
  direction: MessageQueueFlowDirection;
  messages: number;
  errors: number;
  // 0 to 100, or null when nothing was attempted.
  errorRatePercent: number | null;
  // p95 publish time ("publish") or processing time ("consume"), in ms.
  p95DurationMs: number | null;
}

export interface MessageQueueTopologyTruncation {
  // More live queues than MESSAGE_QUEUE_TOPOLOGY_MAX_QUEUES.
  queues: boolean;
  // More (queue, service) pairs than MESSAGE_QUEUE_TOPOLOGY_MAX_PAIRS.
  flows: boolean;
}

export interface MessageQueueTopologyResponse {
  // The range read, as ISO dates.
  startTime: string;
  endTime: string;
  // Every live queue the caller may read, with or without traffic.
  queues: Array<MessageQueueTopologyQueue>;
  // Every service a flow names.
  services: Array<MessageQueueTopologyService>;
  flows: Array<MessageQueueTopologyFlow>;
  truncation: MessageQueueTopologyTruncation;
}

export const EMPTY_MESSAGE_QUEUE_TOPOLOGY_TRUNCATION: MessageQueueTopologyTruncation =
  { queues: false, flows: false };

// ---- reading an answer ---------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

// A count: a finite number of at least 0, whole; anything else 0.
function countOf(value: unknown): number {
  const number: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

// A measurement that may be missing: a finite number of at least 0, or null.
function measureOf(value: unknown): number | null {
  const number: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// An ISO date that parses, or null.
function dateTextOf(value: unknown): string | null {
  const text: string = textOf(value).trim();
  if (!text || !Number.isFinite(Date.parse(text))) {
    return null;
  }
  return text;
}

function arrayOf(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

function readQueue(value: unknown): MessageQueueTopologyQueue | null {
  if (!isRecord(value)) {
    return null;
  }
  const id: string = textOf(value["id"]).trim();
  if (!id) {
    return null;
  }
  const spans: number = countOf(value["spans"]);
  return {
    id: id,
    name: textOf(value["name"]),
    messagingSystem: textOf(value["messagingSystem"]),
    destinationName: textOf(value["destinationName"]),
    brokerScope: textOf(value["brokerScope"]),
    brokerAddress: textOf(value["brokerAddress"]),
    queueIdentifier: textOf(value["queueIdentifier"]),
    discoverySource: textOf(value["discoverySource"]),
    lastSeenAt: dateTextOf(value["lastSeenAt"]),
    brokerMetricsLastSeenAt: dateTextOf(value["brokerMetricsLastSeenAt"]),
    spans: spans,
    // The failed spans are some of the spans.
    errors: Math.min(countOf(value["errors"]), spans),
    published: countOf(value["published"]),
    consumed: countOf(value["consumed"]),
  };
}

function readService(value: unknown): MessageQueueTopologyService | null {
  if (!isRecord(value)) {
    return null;
  }
  const id: string = textOf(value["id"]).trim();
  if (!id) {
    return null;
  }
  return { id: id, name: textOf(value["name"]) };
}

function readFlow(value: unknown): MessageQueueTopologyFlow | null {
  if (!isRecord(value)) {
    return null;
  }
  const queueId: string = textOf(value["queueId"]).trim();
  const serviceId: string = textOf(value["serviceId"]).trim();
  const direction: unknown = value["direction"];
  if (
    !queueId ||
    !serviceId ||
    (direction !== "publish" && direction !== "consume")
  ) {
    return null;
  }
  const messages: number = countOf(value["messages"]);
  if (messages <= 0) {
    return null;
  }
  const rate: number | null = measureOf(value["errorRatePercent"]);
  return {
    queueId: queueId,
    serviceId: serviceId,
    direction: direction,
    messages: messages,
    errors: countOf(value["errors"]),
    errorRatePercent: rate === null ? null : Math.min(rate, 100),
    p95DurationMs: measureOf(value["p95DurationMs"]),
  };
}

/**
 * The topology an answer holds, read defensively: a queue, service or flow
 * that is not one is left out, a count that is not a number of at least 0
 * reads 0, a queue's failed spans never exceed its spans, an error rate is
 * held to 0-100, and a flow whose queue the answer does not hold is left
 * out (a service it names without listing is added, unnamed). A queue or
 * service listed twice is kept once (the first), and so is a flow. Never
 * throws.
 */
export function readMessageQueueTopologyResponse(
  value: unknown,
): MessageQueueTopologyResponse {
  const body: Record<string, unknown> = isRecord(value) ? value : {};

  const queues: Array<MessageQueueTopologyQueue> = [];
  const queueIds: Set<string> = new Set<string>();
  for (const entry of arrayOf(body["queues"])) {
    const queue: MessageQueueTopologyQueue | null = readQueue(entry);
    if (queue && !queueIds.has(queue.id)) {
      queueIds.add(queue.id);
      queues.push(queue);
    }
  }

  const services: Array<MessageQueueTopologyService> = [];
  const serviceIds: Set<string> = new Set<string>();
  for (const entry of arrayOf(body["services"])) {
    const service: MessageQueueTopologyService | null = readService(entry);
    if (service && !serviceIds.has(service.id)) {
      serviceIds.add(service.id);
      services.push(service);
    }
  }

  const flows: Array<MessageQueueTopologyFlow> = [];
  const flowKeys: Set<string> = new Set<string>();
  for (const entry of arrayOf(body["flows"])) {
    const flow: MessageQueueTopologyFlow | null = readFlow(entry);
    if (!flow || !queueIds.has(flow.queueId)) {
      continue;
    }
    const key: string = getMessageQueueTopologyFlowKey(flow);
    if (flowKeys.has(key)) {
      continue;
    }
    flowKeys.add(key);
    if (!serviceIds.has(flow.serviceId)) {
      serviceIds.add(flow.serviceId);
      services.push({ id: flow.serviceId, name: "" });
    }
    flows.push(flow);
  }

  const truncation: Record<string, unknown> = isRecord(body["truncation"])
    ? body["truncation"]
    : {};

  return {
    startTime: dateTextOf(body["startTime"]) || "",
    endTime: dateTextOf(body["endTime"]) || "",
    queues: queues,
    services: services,
    flows: flows,
    truncation: {
      queues: truncation["queues"] === true,
      flows: truncation["flows"] === true,
    },
  };
}

/** One flow's identity: its service, its queue and its direction. */
export function getMessageQueueTopologyFlowKey(
  flow: Pick<MessageQueueTopologyFlow, "queueId" | "serviceId" | "direction">,
): string {
  return `${flow.direction}|${flow.serviceId}|${flow.queueId}`;
}

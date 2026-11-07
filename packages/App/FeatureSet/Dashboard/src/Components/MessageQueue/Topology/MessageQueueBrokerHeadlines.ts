import {
  MessageQueueMetricDescriptor,
  MessageQueueSignal,
  getMessageQueueMetricsForSystem,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { canBrokerMetricsReachMessageQueue } from "../../../Pages/MessageQueue/Utils/MessageQueuePresentation";
import {
  MessageQueueBrokerMetricResult,
  MessageQueueTimePoint,
  fetchMessageQueueCatalogMetricSeries,
  toMessageQueueBrokerMetricResult,
} from "../MessageQueueTelemetryQueries";
import { getMessageQueueScopeKeys } from "../MessageQueueTelemetryScope";

/*
 * THE BROKER'S NUMBERS ON THE TOPOLOGY: how much is waiting on a queue (its
 * consumer lag, or else its backlog) and how much was dead-lettered, read
 * from the curated broker metrics of its system
 * (Types/MessageQueue/MessageQueueMetricCatalog) exactly as the queue's
 * Broker health section reads them (fetchMessageQueueCatalogMetricSeries,
 * toMessageQueueBrokerMetricResult) - so a queue's "lag 1.2k" on the map is
 * the number on its Overview's tile for the same range.
 *
 * Read lazily and only where it can answer: for a queue whose system has
 * such a metric, that its broker's metrics can reach (an Azure queue needs
 * its namespace: canBrokerMetricsReachMessageQueue), and whose broker
 * reported lately. Most queues are found from traces alone and cost nothing.
 */

export type MessageQueueHeadlineKind = "waiting" | "deadLetter";

export interface MessageQueueHeadlineDescriptors {
  /*
   * How much is waiting: the system's first consumer lag metric, else its
   * first backlog metric, with the other spellings of that same metric
   * ("Messages visible" and "Messages visible (JSON stream)", a scraper's
   * current and legacy names) - whichever has data is the one shown.
   */
  waiting: Array<MessageQueueMetricDescriptor>;
  // The system's first dead-letter metric, with its other spellings.
  deadLetter: Array<MessageQueueMetricDescriptor>;
}

/*
 * A title without the words in brackets that tell two spellings of one
 * metric apart. Titles are short catalog strings; no regular expression is
 * needed to find the last " (".
 */
function baseTitle(title: string): string {
  const trimmed: string = title.trim();
  if (!trimmed.endsWith(")")) {
    return trimmed;
  }
  const open: number = trimmed.lastIndexOf(" (");
  return open > 0 ? trimmed.substring(0, open).trim() : trimmed;
}

function pick(
  metrics: ReadonlyArray<MessageQueueMetricDescriptor>,
  signals: ReadonlyArray<MessageQueueSignal>,
): Array<MessageQueueMetricDescriptor> {
  for (const signal of signals) {
    const first: MessageQueueMetricDescriptor | undefined = metrics.find(
      (descriptor: MessageQueueMetricDescriptor): boolean => {
        return descriptor.signal === signal;
      },
    );
    if (first) {
      const title: string = baseTitle(first.title);
      return metrics.filter(
        (descriptor: MessageQueueMetricDescriptor): boolean => {
          return (
            descriptor.signal === signal &&
            baseTitle(descriptor.title) === title
          );
        },
      );
    }
  }
  return [];
}

/** The metrics a queue of this system shows on the map, in catalog order. */
export function getMessageQueueHeadlineDescriptors(
  system: string | null | undefined,
): MessageQueueHeadlineDescriptors {
  const metrics: ReadonlyArray<MessageQueueMetricDescriptor> =
    getMessageQueueMetricsForSystem(system);
  return {
    waiting: pick(metrics, ["consumerLag", "backlog"]),
    deadLetter: pick(metrics, ["deadLetter"]),
  };
}

/*
 * How long before the range starts a broker's last report may be and still
 * be read: discovery stamps brokerMetricsLastSeenAt when it runs (every 10
 * minutes), from cloud metrics up to an hour late.
 */
export const MESSAGE_QUEUE_HEADLINE_REPORT_SLACK_MS: number =
  2 * 60 * 60 * 1000;

export interface MessageQueueHeadlineQueue {
  id: string;
  queueIdentifier: string;
  messagingSystem: string;
  brokerScope: string;
  brokerMetricsLastSeenAt: string | null;
}

/**
 * Whether a queue's broker numbers are worth a read for a range starting at
 * `start`: its system has a waiting or dead-letter metric, its broker's
 * metrics can reach it, and its broker reported within the range (or just
 * before it).
 */
export function isMessageQueueHeadlineReadable(
  queue: MessageQueueHeadlineQueue,
  start: Date,
): boolean {
  const descriptors: MessageQueueHeadlineDescriptors =
    getMessageQueueHeadlineDescriptors(queue.messagingSystem);
  if (descriptors.waiting.length === 0 && descriptors.deadLetter.length === 0) {
    return false;
  }
  if (
    !canBrokerMetricsReachMessageQueue(queue.messagingSystem, {
      brokerScope: queue.brokerScope,
    })
  ) {
    return false;
  }
  const reportedAt: number = Date.parse(queue.brokerMetricsLastSeenAt || "");
  if (!Number.isFinite(reportedAt)) {
    return false;
  }
  return reportedAt >= start.getTime() - MESSAGE_QUEUE_HEADLINE_REPORT_SLACK_MS;
}

export interface MessageQueueHeadlineValue {
  descriptor: MessageQueueMetricDescriptor;
  // A gauge's newest value; a counter's mean rate per second.
  value: number;
}

export interface MessageQueueBrokerHeadline {
  waiting: MessageQueueHeadlineValue | null;
  deadLetter: MessageQueueHeadlineValue | null;
}

export const EMPTY_MESSAGE_QUEUE_BROKER_HEADLINE: MessageQueueBrokerHeadline = {
  waiting: null,
  deadLetter: null,
};

// What a headline is called beside its number on a card, by its signal.
export function getMessageQueueHeadlineShortLabel(
  descriptor: Pick<MessageQueueMetricDescriptor, "signal">,
): string {
  switch (descriptor.signal) {
    case "consumerLag":
      return translationKey("lag");
    case "deadLetter":
      return translationKey("dead letters");
    default:
      return translationKey("backlog");
  }
}

export type MessageQueueSeriesReader = (data: {
  projectId: ObjectID | string | null | undefined;
  keys: ReadonlyArray<string>;
  start: Date;
  end: Date;
  descriptor: MessageQueueMetricDescriptor;
}) => Promise<Array<MessageQueueTimePoint>>;

async function firstWithData(
  descriptors: ReadonlyArray<MessageQueueMetricDescriptor>,
  read: (
    descriptor: MessageQueueMetricDescriptor,
  ) => Promise<Array<MessageQueueTimePoint>>,
): Promise<MessageQueueHeadlineValue | null> {
  for (const descriptor of descriptors) {
    const result: MessageQueueBrokerMetricResult =
      toMessageQueueBrokerMetricResult(descriptor, await read(descriptor));
    if (result.value !== null && Number.isFinite(result.value)) {
      return { descriptor: descriptor, value: result.value };
    }
  }
  return null;
}

/**
 * A queue's waiting and dead-letter numbers over a range, each the first of
 * its metrics with data, read as Broker health reads them. Nothing (no API
 * call) for a queue whose identifier names no key.
 */
export async function fetchMessageQueueBrokerHeadline(data: {
  projectId: ObjectID | string | null | undefined;
  queue: MessageQueueHeadlineQueue;
  start: Date;
  end: Date;
  // The series reader; the Overview's own by default.
  readSeries?: MessageQueueSeriesReader | undefined;
}): Promise<MessageQueueBrokerHeadline> {
  const keys: Array<string> = getMessageQueueScopeKeys({
    projectId: data.projectId ? data.projectId.toString() : null,
    queueIdentifier: data.queue.queueIdentifier,
  });
  if (keys.length === 0) {
    return EMPTY_MESSAGE_QUEUE_BROKER_HEADLINE;
  }
  const readSeries: MessageQueueSeriesReader =
    data.readSeries || fetchMessageQueueCatalogMetricSeries;
  const read: (
    descriptor: MessageQueueMetricDescriptor,
  ) => Promise<Array<MessageQueueTimePoint>> = (
    descriptor: MessageQueueMetricDescriptor,
  ): Promise<Array<MessageQueueTimePoint>> => {
    return readSeries({
      projectId: data.projectId,
      keys: keys,
      start: data.start,
      end: data.end,
      descriptor: descriptor,
    });
  };
  const descriptors: MessageQueueHeadlineDescriptors =
    getMessageQueueHeadlineDescriptors(data.queue.messagingSystem);
  const [waiting, deadLetter]: [
    MessageQueueHeadlineValue | null,
    MessageQueueHeadlineValue | null,
  ] = await Promise.all([
    firstWithData(descriptors.waiting, read),
    firstWithData(descriptors.deadLetter, read),
  ]);
  return { waiting: waiting, deadLetter: deadLetter };
}

// How many queues' numbers are read at once.
export const MESSAGE_QUEUE_HEADLINE_CONCURRENCY: number = 4;

/**
 * `work` over every item, at most `limit` at a time, in order; stops
 * starting new work once `isCancelled` says so. A failed item does not stop
 * the others.
 */
export async function runWithConcurrency<T>(
  items: ReadonlyArray<T>,
  limit: number,
  work: (item: T) => Promise<void>,
  isCancelled: () => boolean = (): boolean => {
    return false;
  },
): Promise<void> {
  let next: number = 0;
  const worker: () => Promise<void> = async (): Promise<void> => {
    while (next < items.length && !isCancelled()) {
      const item: T = items[next]!;
      next += 1;
      try {
        await work(item);
      } catch {
        // One queue's numbers failing leaves the others.
      }
    }
  };
  const workers: Array<Promise<void>> = [];
  for (
    let index: number = 0;
    index < Math.max(1, Math.min(limit, items.length));
    index++
  ) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

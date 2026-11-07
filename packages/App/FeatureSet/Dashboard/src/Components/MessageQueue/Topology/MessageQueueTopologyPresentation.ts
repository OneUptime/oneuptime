import {
  Translator,
  composedValue,
  getGlobalTranslator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  formatMessageQueueCount,
  formatMessageQueueDurationMs,
  formatMessageQueueMetricValue,
} from "../MessageQueueOverviewPresentation";
import { TopologyNodeStat } from "../../Topology/TopologyNodeCard";
import { HEALTH_COLORS } from "../../Topology/TopologyMeta";
import {
  MessageQueueBrokerHeadline,
  MessageQueueHeadlineValue,
  getMessageQueueHeadlineShortLabel,
} from "./MessageQueueBrokerHeadlines";
import {
  MESSAGE_QUEUE_TOPOLOGY_STATUS_COLORS,
  MESSAGE_QUEUE_TOPOLOGY_STATUS_LABELS,
  MessageQueueTopologyBrokerNode,
  MessageQueueTopologyEdge,
  MessageQueueTopologyNode,
  MessageQueueTopologyQueueNode,
  MessageQueueTopologyServiceNode,
  MessageQueueTopologyStatus,
  formatMessageQueueTopologyPercent,
  formatMessageQueueTopologyRate,
} from "./MessageQueueTopologyModel";

/*
 * What the topology's cards, lines and drawer say, in the reader's
 * language: a node's numbers and footer, a line's label, a status in words
 * and what to do about a queue seen from one side only. Pure, with the
 * reader's translator handed in (English without one), so every sentence is
 * unit-tested (Common/Tests/App/Dashboard/MessageQueueTopologyPresentation.test).
 */

// What the lines are labelled with.
export type MessageQueueTopologyEdgeLabel =
  | "rate"
  | "errors"
  | "latency"
  | "hover";

export const MESSAGE_QUEUE_TOPOLOGY_EDGE_LABEL_OPTIONS: ReadonlyArray<{
  value: MessageQueueTopologyEdgeLabel;
  label: string;
}> = [
  { value: "rate", label: translationKey("Message rate") },
  { value: "errors", label: translationKey("Error rate") },
  { value: "latency", label: translationKey("p95 time") },
  { value: "hover", label: translationKey("On hover") },
];

export interface MessageQueueTopologyCard {
  stats: Array<TopologyNodeStat>;
  footer: string | undefined;
  statusLabel: string;
  statusColor: string;
}

const ERROR_TEXT_COLOR: string = "#b45309";

// The colour of an error rate's figure: red at 5%, amber past 1%.
export function getMessageQueueTopologyErrorColor(
  rate: number | null,
): string | undefined {
  if (rate === null || !Number.isFinite(rate)) {
    return undefined;
  }
  if (rate >= 0.05) {
    return HEALTH_COLORS.critical;
  }
  return rate > 0.01 ? ERROR_TEXT_COLOR : undefined;
}

function errorStat(
  attempts: number,
  errors: number,
  translator: Translator,
): TopologyNodeStat {
  const rate: number | null = attempts > 0 ? errors / attempts : null;
  return {
    label: translator.translateText("errors") || "errors",
    value: formatMessageQueueTopologyPercent(rate === null ? null : rate * 100),
    color: getMessageQueueTopologyErrorColor(rate),
  };
}

/** A headline's number, short: a gauge's count, a counter's rate. */
export function formatMessageQueueHeadlineShort(
  headline: MessageQueueHeadlineValue,
): string {
  if (headline.descriptor.kind === "counter") {
    return `${formatMessageQueueCount(headline.value)}/s`;
  }
  return formatMessageQueueCount(headline.value);
}

/** A headline's number in its unit, for the drawer ("1.2k messages"). */
export function formatMessageQueueHeadlineFull(
  headline: MessageQueueHeadlineValue,
): string {
  return formatMessageQueueMetricValue(headline.value, headline.descriptor);
}

export function getMessageQueueTopologyStatusLabel(
  status: MessageQueueTopologyStatus,
  translator: Translator = getGlobalTranslator(),
): string {
  const label: string = MESSAGE_QUEUE_TOPOLOGY_STATUS_LABELS[status];
  return translator.translateText(label) || label;
}

function queueCard(
  node: MessageQueueTopologyQueueNode,
  windowSeconds: number,
  headline: MessageQueueBrokerHeadline | null,
  translator: Translator,
): MessageQueueTopologyCard {
  const queue: MessageQueueTopologyQueueNode["queue"] = node.queue;
  const stats: Array<TopologyNodeStat> = [];
  if (queue.spans > 0) {
    stats.push(
      {
        label: translator.translateText("in") || "in",
        value: formatMessageQueueTopologyRate(queue.published, windowSeconds),
      },
      {
        label: translator.translateText("out") || "out",
        value: formatMessageQueueTopologyRate(queue.consumed, windowSeconds),
      },
    );
  }
  if (node.needsAttention || !headline?.waiting) {
    if (queue.spans > 0) {
      stats.push(errorStat(queue.spans, queue.errors, translator));
    }
  }
  if (headline?.waiting && stats.length < 3) {
    const label: string = getMessageQueueHeadlineShortLabel(
      headline.waiting.descriptor,
    );
    stats.push({
      label: translator.translateText(label) || label,
      value: formatMessageQueueHeadlineShort(headline.waiting),
    });
  }

  let footer: string | undefined;
  if (headline?.deadLetter && headline.deadLetter.value > 0) {
    footer = translator.translateTemplate("{{count}} dead-lettered", {
      count: formatMessageQueueHeadlineShort(headline.deadLetter),
    });
  } else if (node.producerCount > 0 || node.consumerCount > 0) {
    footer = translator.translateTemplate("{{producers}} · {{consumers}}", {
      producers: composedValue((sentence: Translator): string => {
        return sentence.translatePlural(
          { one: "{{count}} producer", other: "{{count}} producers" },
          node.producerCount,
        );
      }),
      consumers: composedValue((sentence: Translator): string => {
        return sentence.translatePlural(
          { one: "{{count}} consumer", other: "{{count}} consumers" },
          node.consumerCount,
        );
      }),
    });
  }

  return {
    stats: stats.slice(0, 3),
    footer: footer,
    statusLabel: getMessageQueueTopologyStatusLabel(node.status, translator),
    statusColor: MESSAGE_QUEUE_TOPOLOGY_STATUS_COLORS[node.status],
  };
}

function serviceCard(
  node: MessageQueueTopologyServiceNode,
  windowSeconds: number,
  translator: Translator,
): MessageQueueTopologyCard {
  const stats: Array<TopologyNodeStat> = [];
  if (node.published.messages > 0) {
    stats.push({
      label: translator.translateText("out") || "out",
      value: formatMessageQueueTopologyRate(
        node.published.messages,
        windowSeconds,
      ),
    });
  }
  if (node.consumed.messages > 0) {
    stats.push({
      label: translator.translateText("in") || "in",
      value: formatMessageQueueTopologyRate(
        node.consumed.messages,
        windowSeconds,
      ),
    });
  }
  stats.push(
    errorStat(
      node.published.attempts + node.consumed.attempts,
      node.published.errors + node.consumed.errors,
      translator,
    ),
  );

  return {
    stats: stats,
    footer: getMessageQueueTopologyServiceReach(node, translator),
    statusLabel: getMessageQueueTopologyStatusLabel(node.status, translator),
    statusColor: MESSAGE_QUEUE_TOPOLOGY_STATUS_COLORS[node.status],
  };
}

/**
 * Which queues a service is on, in one sentence: "Publishes to 2 queues ·
 * consumes from 1 queue", or one side alone; undefined for none.
 */
export function getMessageQueueTopologyServiceReach(
  node: Pick<MessageQueueTopologyServiceNode, "publishesTo" | "consumesFrom">,
  translator: Translator = getGlobalTranslator(),
): string | undefined {
  if (node.publishesTo > 0 && node.consumesFrom > 0) {
    return translator.translateTemplate(
      "Publishes to {{publishes}} · consumes from {{consumes}}",
      {
        publishes: composedValue((sentence: Translator): string => {
          return sentence.translatePlural(
            { one: "{{count}} queue", other: "{{count}} queues" },
            node.publishesTo,
          );
        }),
        consumes: composedValue((sentence: Translator): string => {
          return sentence.translatePlural(
            { one: "{{count}} queue", other: "{{count}} queues" },
            node.consumesFrom,
          );
        }),
      },
    );
  }
  if (node.publishesTo > 0) {
    return translator.translatePlural(
      {
        one: "Publishes to {{count}} queue",
        other: "Publishes to {{count}} queues",
      },
      node.publishesTo,
    );
  }
  if (node.consumesFrom > 0) {
    return translator.translatePlural(
      {
        one: "Consumes from {{count}} queue",
        other: "Consumes from {{count}} queues",
      },
      node.consumesFrom,
    );
  }
  return undefined;
}

function brokerCard(
  node: MessageQueueTopologyBrokerNode,
  windowSeconds: number,
  translator: Translator,
): MessageQueueTopologyCard {
  const stats: Array<TopologyNodeStat> = [];
  if (node.spans > 0) {
    stats.push(
      {
        label: translator.translateText("in") || "in",
        value: formatMessageQueueTopologyRate(node.published, windowSeconds),
      },
      {
        label: translator.translateText("out") || "out",
        value: formatMessageQueueTopologyRate(node.consumed, windowSeconds),
      },
      errorStat(node.spans, node.errors, translator),
    );
  }
  return {
    stats: stats,
    footer: translator.translateText("Select to see its queues") || "",
    statusLabel: getMessageQueueTopologyStatusLabel(node.status, translator),
    statusColor: MESSAGE_QUEUE_TOPOLOGY_STATUS_COLORS[node.status],
  };
}

/** What a node's card shows. */
export function getMessageQueueTopologyCard(
  node: MessageQueueTopologyNode,
  options: {
    windowSeconds: number;
    headline?: MessageQueueBrokerHeadline | null | undefined;
    translator?: Translator | undefined;
  },
): MessageQueueTopologyCard {
  const translator: Translator = options.translator || getGlobalTranslator();
  switch (node.kind) {
    case "queue":
      return queueCard(
        node,
        options.windowSeconds,
        options.headline || null,
        translator,
      );
    case "service":
      return serviceCard(node, options.windowSeconds, translator);
    default:
      return brokerCard(node, options.windowSeconds, translator);
  }
}

/** A card's second line: what the node is, and where. */
export function getMessageQueueTopologySubtitle(
  node: MessageQueueTopologyNode,
  translator: Translator = getGlobalTranslator(),
): string {
  switch (node.kind) {
    case "queue":
      return node.subtitle;
    case "service":
      return node.isNamed
        ? translator.translateText("Service") || "Service"
        : translator.translateText(
            "A service you may not read, or that is not a service",
          ) || "";
    default:
      return translator.translatePlural(
        { one: "{{count}} queue", other: "{{count}} queues" },
        node.queueCount,
      );
  }
}

/** A node's name as drawn: an unnamed service reads in the reader's language. */
export function getMessageQueueTopologyNodeLabel(
  node: MessageQueueTopologyNode,
  translator: Translator = getGlobalTranslator(),
): string {
  if (node.kind === "service" && !node.isNamed) {
    return translator.translateText(node.label) || node.label;
  }
  return node.label;
}

/**
 * A line's label for the picked metric, or undefined for none (a line with
 * no number to show, or "On hover" while the pointer is elsewhere).
 */
export function getMessageQueueTopologyEdgeLabel(
  edge: MessageQueueTopologyEdge,
  metric: MessageQueueTopologyEdgeLabel,
  windowSeconds: number,
  isHovered: boolean,
): string | undefined {
  const shown: MessageQueueTopologyEdgeLabel =
    metric === "hover" ? (isHovered ? "rate" : "hover") : metric;
  switch (shown) {
    case "rate":
      return formatMessageQueueTopologyRate(edge.messages, windowSeconds);
    case "errors":
      return formatMessageQueueTopologyPercent(edge.errorRatePercent);
    case "latency":
      return edge.p95DurationMs === null
        ? undefined
        : formatMessageQueueDurationMs(edge.p95DurationMs);
    default:
      return undefined;
  }
}

/*
 * What to do about a queue seen from one side only, or not at all - by the
 * messages seen on each side, whatever its errors say (a failing queue no one
 * is seen consuming still has untraced consumers to instrument). English
 * keys, translated where drawn; null when both sides are seen.
 */
export function getMessageQueueTopologyQueueHint(
  queue: Pick<
    MessageQueueTopologyQueueNode["queue"],
    "spans" | "published" | "consumed"
  >,
): string | null {
  if (queue.spans <= 0) {
    return translationKey(
      "No instrumented service published to or consumed from this queue in this range.",
    );
  }
  if (queue.published > 0 && queue.consumed <= 0) {
    return translationKey(
      "Messages are published here, but no traced service consumed any in this range. If something does consume them, instrument it with OpenTelemetry to see where these messages go.",
    );
  }
  if (queue.consumed > 0 && queue.published <= 0) {
    return translationKey(
      "Messages are consumed from here, but no traced service published any in this range. If something does publish them, instrument it with OpenTelemetry to see where they come from.",
    );
  }
  return null;
}

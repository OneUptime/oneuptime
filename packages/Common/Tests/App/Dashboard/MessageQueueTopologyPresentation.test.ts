import { describe, expect, jest, test } from "@jest/globals";

/*
 * What the Queues topology's cards, lines and drawer say: a node's three
 * numbers and its footer, a line's label for the picked metric, a status in
 * words and what to do about a queue seen from one side only - in English,
 * and in another language whole sentence by whole sentence.
 */

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return { __esModule: true, default: {} };
});

import {
  MessageQueueTopologyCard,
  formatMessageQueueHeadlineFull,
  formatMessageQueueHeadlineShort,
  getMessageQueueTopologyCard,
  getMessageQueueTopologyEdgeLabel,
  getMessageQueueTopologyErrorColor,
  getMessageQueueTopologyNodeLabel,
  getMessageQueueTopologyQueueHint,
  getMessageQueueTopologyServiceReach,
  getMessageQueueTopologyStatusLabel,
  getMessageQueueTopologySubtitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueTopologyPresentation";
import {
  MESSAGE_QUEUE_TOPOLOGY_STATUS_COLORS,
  MessageQueueTopologyEdge,
  MessageQueueTopologyModel,
  MessageQueueTopologyNode,
  MessageQueueTopologyQueueNode,
  MessageQueueTopologyServiceNode,
  buildMessageQueueTopologyModel,
  getMessageQueueTopologyQueueKey,
  getMessageQueueTopologyServiceKey,
  groupMessageQueueTopologyByBroker,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueTopologyModel";
import {
  MessageQueueBrokerHeadline,
  getMessageQueueHeadlineDescriptors,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueBrokerHeadlines";
import { HEALTH_COLORS } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyMeta";
import { Translator, createTranslator } from "../../../Types/Translator";
import {
  MessageQueueTopologyQueue,
  MessageQueueTopologyResponse,
} from "../../../Types/MessageQueue/MessageQueueTopology";

const english: Translator = createTranslator(undefined, "en");

const GERMAN: Record<string, string> = {
  in: "ein",
  out: "aus",
  errors: "Fehler",
  lag: "Verzug",
  "Messages flowing": "Nachrichten fließen",
  "No consumer seen": "Kein Konsument gesehen",
  "{{producers}} · {{consumers}}": "{{producers}} · {{consumers}}",
  // A plural's general form under its key, its "one" form under <key>_one.
  "{{count}} producers": "{{count}} Produzenten",
  "{{count}} producers_one": "{{count}} Produzent",
  "{{count}} consumers": "{{count}} Konsumenten",
  "{{count}} consumers_one": "{{count}} Konsument",
  "{{count}} dead-lettered": "{{count}} im Dead Letter",
  Service: "Dienst",
  "Unknown service": "Unbekannter Dienst",
};

const german: Translator = createTranslator((text: string) => {
  return GERMAN[text];
}, "de");

function queue(
  id: string,
  extra?: Partial<MessageQueueTopologyQueue>,
): MessageQueueTopologyQueue {
  return {
    id: id,
    name: id,
    messagingSystem: "kafka",
    destinationName: id,
    brokerScope: "",
    brokerAddress: "",
    queueIdentifier: `kafka||${id}`,
    discoverySource: "traces",
    lastSeenAt: null,
    brokerMetricsLastSeenAt: null,
    spans: 3600,
    errors: 0,
    published: 3600,
    consumed: 1800,
    ...extra,
  };
}

function model(
  queues: Array<MessageQueueTopologyQueue>,
  names?: Record<string, string>,
): MessageQueueTopologyModel {
  const answer: MessageQueueTopologyResponse = {
    startTime: "2026-11-07T11:00:00.000Z",
    endTime: "2026-11-07T12:00:00.000Z",
    queues: queues,
    services: [
      { id: "checkout", name: names?.["checkout"] ?? "checkout" },
      { id: "fulfilment", name: names?.["fulfilment"] ?? "fulfilment" },
    ],
    flows: [
      {
        queueId: queues[0]!.id,
        serviceId: "checkout",
        direction: "publish",
        messages: 3600,
        errors: 72,
        errorRatePercent: 2,
        p95DurationMs: 4.2,
      },
      {
        queueId: queues[0]!.id,
        serviceId: "fulfilment",
        direction: "consume",
        messages: 1800,
        errors: 0,
        errorRatePercent: 0,
        p95DurationMs: null,
      },
    ],
    truncation: { queues: false, flows: false },
  };
  return buildMessageQueueTopologyModel(answer);
}

function lagHeadline(value: number): MessageQueueBrokerHeadline {
  return {
    waiting: {
      descriptor: getMessageQueueHeadlineDescriptors("kafka").waiting[0]!,
      value: value,
    },
    deadLetter: null,
  };
}

describe("a queue's card", () => {
  test("messages in and out per second, its error rate, and who is on either side", () => {
    const m: MessageQueueTopologyModel = model([queue("orders")]);
    const card: MessageQueueTopologyCard = getMessageQueueTopologyCard(
      m.nodeByKey.get(getMessageQueueTopologyQueueKey("orders"))!,
      { windowSeconds: m.windowSeconds, translator: english },
    );
    expect(card.stats).toEqual([
      { label: "in", value: "1.0/s" },
      { label: "out", value: "30/min" },
      { label: "errors", value: "0%", color: undefined },
    ]);
    expect(card.footer).toBe("1 producer · 1 consumer");
    expect(card.statusLabel).toBe("Messages flowing");
    expect(card.statusColor).toBe(MESSAGE_QUEUE_TOPOLOGY_STATUS_COLORS.flowing);
  });

  test("the broker's lag takes the third place while all is well", () => {
    const m: MessageQueueTopologyModel = model([queue("orders")]);
    const card: MessageQueueTopologyCard = getMessageQueueTopologyCard(
      m.nodeByKey.get(getMessageQueueTopologyQueueKey("orders"))!,
      {
        windowSeconds: m.windowSeconds,
        headline: lagHeadline(1234),
        translator: english,
      },
    );
    expect(card.stats.map((stat) => stat.label)).toEqual(["in", "out", "lag"]);
    expect(card.stats[2]!.value).toBe("1.2k");
  });

  test("errors keep their place when the queue needs attention, in their colour", () => {
    const m: MessageQueueTopologyModel = model([queue("orders", { errors: 720 })]);
    const card: MessageQueueTopologyCard = getMessageQueueTopologyCard(
      m.nodeByKey.get(getMessageQueueTopologyQueueKey("orders"))!,
      {
        windowSeconds: m.windowSeconds,
        headline: lagHeadline(10),
        translator: english,
      },
    );
    expect(card.stats.map((stat) => stat.label)).toEqual(["in", "out", "errors"]);
    expect(card.stats[2]!.value).toBe("20.0%");
    expect(card.stats[2]!.color).toBe(HEALTH_COLORS.critical);
    expect(card.statusLabel).toBe("High error rate");
  });

  test("dead letters, when there are some, are the footer", () => {
    const m: MessageQueueTopologyModel = model([
      queue("orders", { messagingSystem: "servicebus", brokerScope: "prod" }),
    ]);
    const card: MessageQueueTopologyCard = getMessageQueueTopologyCard(
      m.nodeByKey.get(getMessageQueueTopologyQueueKey("orders"))!,
      {
        windowSeconds: m.windowSeconds,
        headline: {
          waiting: null,
          deadLetter: {
            descriptor:
              getMessageQueueHeadlineDescriptors("servicebus").deadLetter[0]!,
            value: 34,
          },
        },
        translator: english,
      },
    );
    expect(card.footer).toBe("34 dead-lettered");
  });

  test("a queue with no traced span shows no numbers", () => {
    const m: MessageQueueTopologyModel = model([
      queue("orders"),
      queue("idle", { spans: 0, published: 0, consumed: 0 }),
    ]);
    const card: MessageQueueTopologyCard = getMessageQueueTopologyCard(
      m.nodeByKey.get(getMessageQueueTopologyQueueKey("idle"))!,
      { windowSeconds: m.windowSeconds, translator: english },
    );
    expect(card.stats).toEqual([]);
    expect(card.footer).toBeUndefined();
    expect(card.statusLabel).toBe("No traced messages");
  });

  test("in German, each sentence and word is looked up whole", () => {
    const m: MessageQueueTopologyModel = model([queue("orders", { consumed: 0 })]);
    const card: MessageQueueTopologyCard = getMessageQueueTopologyCard(
      m.nodeByKey.get(getMessageQueueTopologyQueueKey("orders"))!,
      { windowSeconds: m.windowSeconds, translator: german },
    );
    expect(card.stats.map((stat) => stat.label)).toEqual(["ein", "aus", "Fehler"]);
    expect(card.footer).toBe("1 Produzent · 1 Konsument");
    expect(card.statusLabel).toBe("Kein Konsument gesehen");
  });
});

describe("a service's card", () => {
  test("what it publishes and consumes, its errors over everything it attempted, and where", () => {
    const m: MessageQueueTopologyModel = model([queue("orders")]);
    const checkout: MessageQueueTopologyNode = m.nodeByKey.get(
      getMessageQueueTopologyServiceKey("checkout"),
    )!;
    const card: MessageQueueTopologyCard = getMessageQueueTopologyCard(
      checkout,
      { windowSeconds: m.windowSeconds, translator: english },
    );
    expect(card.stats).toEqual([
      { label: "out", value: "1.0/s" },
      { label: "errors", value: "2.0%", color: "#b45309" },
    ]);
    expect(card.footer).toBe("Publishes to 1 queue");
    expect(card.statusLabel).toBe("Some errors");
  });

  test("its reach in one sentence, either side alone or both", () => {
    expect(
      getMessageQueueTopologyServiceReach(
        { publishesTo: 2, consumesFrom: 1 },
        english,
      ),
    ).toBe("Publishes to 2 queues · consumes from 1 queue");
    expect(
      getMessageQueueTopologyServiceReach(
        { publishesTo: 0, consumesFrom: 3 },
        english,
      ),
    ).toBe("Consumes from 3 queues");
    expect(
      getMessageQueueTopologyServiceReach(
        { publishesTo: 1, consumesFrom: 0 },
        english,
      ),
    ).toBe("Publishes to 1 queue");
    expect(
      getMessageQueueTopologyServiceReach(
        { publishesTo: 0, consumesFrom: 0 },
        english,
      ),
    ).toBeUndefined();
  });

  test("an unnamed service reads in the reader's language", () => {
    const m: MessageQueueTopologyModel = model([queue("orders")], {
      checkout: "",
    });
    const hidden: MessageQueueTopologyServiceNode = m.nodeByKey.get(
      getMessageQueueTopologyServiceKey("checkout"),
    ) as MessageQueueTopologyServiceNode;
    expect(getMessageQueueTopologyNodeLabel(hidden, german)).toBe(
      "Unbekannter Dienst",
    );
    expect(getMessageQueueTopologySubtitle(hidden, english)).toBe(
      "A service you may not read, or that is not a service",
    );
    const named: MessageQueueTopologyNode = m.nodeByKey.get(
      getMessageQueueTopologyServiceKey("fulfilment"),
    )!;
    expect(getMessageQueueTopologyNodeLabel(named, german)).toBe("fulfilment");
    expect(getMessageQueueTopologySubtitle(named, german)).toBe("Dienst");
  });
});

describe("a broker's card", () => {
  test("its queues' messages, and the way in", () => {
    const folded: MessageQueueTopologyModel = groupMessageQueueTopologyByBroker(
      model([queue("orders"), queue("payments")]),
    );
    const broker: MessageQueueTopologyNode = folded.nodes.find((node) => {
      return node.kind === "broker";
    })!;
    const card: MessageQueueTopologyCard = getMessageQueueTopologyCard(broker, {
      windowSeconds: folded.windowSeconds,
      translator: english,
    });
    expect(card.stats.map((stat) => stat.label)).toEqual(["in", "out", "errors"]);
    expect(card.stats[0]!.value).toBe("2.0/s");
    expect(card.footer).toBe("Select to see its queues");
    expect(getMessageQueueTopologySubtitle(broker, english)).toBe("2 queues");
  });
});

describe("a line's label", () => {
  const m: MessageQueueTopologyModel = model([queue("orders")]);
  const publish: MessageQueueTopologyEdge = m.edges.find((edge) => {
    return edge.direction === "publish";
  })!;
  const consume: MessageQueueTopologyEdge = m.edges.find((edge) => {
    return edge.direction === "consume";
  })!;

  test("the picked metric", () => {
    expect(getMessageQueueTopologyEdgeLabel(publish, "rate", 3600, false)).toBe(
      "1.0/s",
    );
    expect(
      getMessageQueueTopologyEdgeLabel(publish, "errors", 3600, false),
    ).toBe("2.0%");
    expect(
      getMessageQueueTopologyEdgeLabel(publish, "latency", 3600, false),
    ).toBe("4.2 ms");
    // A line with no time has no label for it.
    expect(
      getMessageQueueTopologyEdgeLabel(consume, "latency", 3600, false),
    ).toBeUndefined();
  });

  test("On hover: the rate under the pointer, nothing elsewhere", () => {
    expect(
      getMessageQueueTopologyEdgeLabel(publish, "hover", 3600, false),
    ).toBeUndefined();
    expect(getMessageQueueTopologyEdgeLabel(publish, "hover", 3600, true)).toBe(
      "1.0/s",
    );
  });
});

describe("words", () => {
  test("every status reads in words", () => {
    for (const status of [
      "flowing",
      "degraded",
      "critical",
      "noConsumers",
      "noProducers",
      "idle",
    ] as const) {
      expect(getMessageQueueTopologyStatusLabel(status, english)).toBeTruthy();
    }
    expect(getMessageQueueTopologyStatusLabel("flowing", german)).toBe(
      "Nachrichten fließen",
    );
  });

  test("a queue seen from one side, or not at all, says what to instrument", () => {
    expect(getMessageQueueTopologyQueueHint("noConsumers")).toContain(
      "instrument it with OpenTelemetry to see where these messages go",
    );
    expect(getMessageQueueTopologyQueueHint("noProducers")).toContain(
      "to see where they come from",
    );
    expect(getMessageQueueTopologyQueueHint("idle")).toContain(
      "No instrumented service",
    );
    expect(getMessageQueueTopologyQueueHint("flowing")).toBeNull();
    expect(getMessageQueueTopologyQueueHint("critical")).toBeNull();
  });

  test("an error rate is coloured only when it matters", () => {
    expect(getMessageQueueTopologyErrorColor(null)).toBeUndefined();
    expect(getMessageQueueTopologyErrorColor(0.01)).toBeUndefined();
    expect(getMessageQueueTopologyErrorColor(0.02)).toBe("#b45309");
    expect(getMessageQueueTopologyErrorColor(0.05)).toBe(HEALTH_COLORS.critical);
  });

  test("a headline's number: short on a card, in its unit in the drawer", () => {
    const lag: MessageQueueBrokerHeadline = lagHeadline(1500);
    expect(formatMessageQueueHeadlineShort(lag.waiting!)).toBe("1.5k");
    expect(formatMessageQueueHeadlineFull(lag.waiting!)).toBe("1.5k messages");
    const dlq: { descriptor: (typeof lag.waiting)["descriptor"] & object; value: number } = {
      descriptor: getMessageQueueHeadlineDescriptors("rocketmq").deadLetter[0]!,
      value: 0.25,
    };
    expect(formatMessageQueueHeadlineShort(dlq)).toBe("0.25/s");
  });

  test("a queue node's card is never more than three numbers", () => {
    const m: MessageQueueTopologyModel = model([queue("orders", { errors: 720 })]);
    const node: MessageQueueTopologyQueueNode = m.nodeByKey.get(
      getMessageQueueTopologyQueueKey("orders"),
    ) as MessageQueueTopologyQueueNode;
    expect(
      getMessageQueueTopologyCard(node, {
        windowSeconds: 3600,
        headline: lagHeadline(5),
        translator: english,
      }).stats.length,
    ).toBeLessThanOrEqual(3);
  });
});

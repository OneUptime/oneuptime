import { describe, expect, test } from "@jest/globals";
import {
  MESSAGE_QUEUE_TOPOLOGY_BROKER_COLORS,
  MESSAGE_QUEUE_TOPOLOGY_EDGE_COLORS,
  MESSAGE_QUEUE_TOPOLOGY_FOCUS_DEPTH,
  MESSAGE_QUEUE_TOPOLOGY_STATUS_COLORS,
  MESSAGE_QUEUE_TOPOLOGY_STATUS_LABELS,
  MESSAGE_QUEUE_TOPOLOGY_UNKNOWN_SERVICE,
  MessageQueueTopologyBrokerGroup,
  MessageQueueTopologyBrokerNode,
  MessageQueueTopologyEdge,
  MessageQueueTopologyFilters,
  MessageQueueTopologyLayout,
  MessageQueueTopologyModel,
  MessageQueueTopologyNode,
  MessageQueueTopologyQueueNode,
  MessageQueueTopologyServiceNode,
  MessageQueueTopologyStatus,
  MessageQueueTopologyTableRow,
  MessageQueueTopologyVisibility,
  buildMessageQueueTopologyModel,
  formatMessageQueueTopologyErrorRate,
  formatMessageQueueTopologyPercent,
  formatMessageQueueTopologyRate,
  getMessageQueueTopologyBrokerKey,
  getMessageQueueTopologyEdgeWidth,
  getMessageQueueTopologyEmptyReason,
  getMessageQueueTopologyFlowAttempts,
  getMessageQueueTopologyGroupKey,
  getMessageQueueTopologyLineage,
  getMessageQueueTopologyQueueKey,
  getMessageQueueTopologyQueueLabel,
  getMessageQueueTopologyQueueStatus,
  getMessageQueueTopologyRateHealth,
  getMessageQueueTopologyServiceKey,
  getMessageQueueTopologyTableRows,
  groupMessageQueueTopologyByBroker,
  layoutMessageQueueTopology,
  resolveMessageQueueTopologyVisibility,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueTopologyModel";
import { healthForErrorRate } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyMeta";

// What a queue's status is read from.
type QueueFigures = Parameters<typeof getMessageQueueTopologyQueueStatus>[0];
import {
  MessageQueueTopologyFlow,
  MessageQueueTopologyQueue,
  MessageQueueTopologyResponse,
} from "../../../Types/MessageQueue/MessageQueueTopology";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

/*
 * The Queues topology's view model: what the map draws, worked out from the
 * API's answer - nodes and lines, their health in calm colours, what a
 * search, a broker, "Needs attention" and a focus show, a broker folded into
 * one card, the layout, the table and what to say when there is nothing to
 * draw.
 */

const HOUR_START: string = "2026-11-07T11:00:00.000Z";
const HOUR_END: string = "2026-11-07T12:00:00.000Z";

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
    lastSeenAt: HOUR_END,
    brokerMetricsLastSeenAt: null,
    spans: 100,
    errors: 0,
    published: 50,
    consumed: 50,
    ...extra,
  };
}

function flow(
  queueId: string,
  serviceId: string,
  direction: "publish" | "consume",
  messages: number,
  errors: number = 0,
  extra?: Partial<MessageQueueTopologyFlow>,
): MessageQueueTopologyFlow {
  return {
    queueId,
    serviceId,
    direction,
    messages,
    errors,
    errorRatePercent: messages > 0 ? (errors / messages) * 100 : null,
    p95DurationMs: 10,
    ...extra,
  };
}

function answer(
  queues: Array<MessageQueueTopologyQueue>,
  flows: Array<MessageQueueTopologyFlow>,
  names?: Record<string, string>,
): MessageQueueTopologyResponse {
  const serviceIds: Set<string> = new Set<string>(
    flows.map((item: MessageQueueTopologyFlow): string => {
      return item.serviceId;
    }),
  );
  return {
    startTime: HOUR_START,
    endTime: HOUR_END,
    queues,
    services: Array.from(serviceIds).map((id: string) => {
      return { id, name: names?.[id] ?? id };
    }),
    flows,
    truncation: { queues: false, flows: false },
  };
}

const NO_FILTERS: MessageQueueTopologyFilters = {
  search: "",
  brokerGroupKey: null,
  attentionOnly: false,
  focusKey: null,
};

const Q: (id: string) => string = getMessageQueueTopologyQueueKey;
const S: (id: string) => string = getMessageQueueTopologyServiceKey;

/*
 * checkout -> orders -> fulfilment -> shipments -> notifier, with billing
 * also consuming orders and checkout also publishing to audit.
 */
function pipeline(): MessageQueueTopologyModel {
  return buildMessageQueueTopologyModel(
    answer(
      [queue("orders"), queue("shipments"), queue("audit")],
      [
        flow("orders", "checkout", "publish", 600),
        flow("orders", "fulfilment", "consume", 590),
        flow("orders", "billing", "consume", 600),
        flow("shipments", "fulfilment", "publish", 580),
        flow("shipments", "notifier", "consume", 575),
        flow("audit", "checkout", "publish", 100),
      ],
    ),
  );
}

describe("the model", () => {
  test("queues and services are nodes; a publish points from the service, a consume from the queue", () => {
    const model: MessageQueueTopologyModel = pipeline();
    expect(
      model.nodes.map((node: MessageQueueTopologyNode) => {
        return node.key;
      }),
    ).toEqual([
      Q("orders"),
      Q("shipments"),
      Q("audit"),
      S("billing"),
      S("checkout"),
      S("fulfilment"),
      S("notifier"),
    ]);
    const publish: MessageQueueTopologyEdge = model.edges.find(
      (edge: MessageQueueTopologyEdge) => {
        return edge.direction === "publish" && edge.queueKey === Q("orders");
      },
    )!;
    expect(publish.from).toBe(S("checkout"));
    expect(publish.to).toBe(Q("orders"));
    const consume: MessageQueueTopologyEdge = model.edges.find(
      (edge: MessageQueueTopologyEdge) => {
        return edge.direction === "consume" && edge.serviceKey === S("billing");
      },
    )!;
    expect(consume.from).toBe(Q("orders"));
    expect(consume.to).toBe(S("billing"));
  });

  test("the counts: queues, the ones with traced messages, services, messages", () => {
    const model: MessageQueueTopologyModel = buildMessageQueueTopologyModel(
      answer(
        [
          queue("orders", { published: 10, consumed: 8 }),
          queue("idle", { spans: 0, published: 0, consumed: 0 }),
        ],
        [flow("orders", "a", "publish", 10), flow("orders", "b", "consume", 8)],
      ),
    );
    expect(model.queueCount).toBe(2);
    expect(model.activeQueueCount).toBe(1);
    expect(model.serviceCount).toBe(2);
    expect(model.published).toBe(10);
    expect(model.consumed).toBe(8);
    expect(model.windowSeconds).toBe(3600);
  });

  test("the window is the answer's, a given one wins, and it is never 0", () => {
    expect(
      buildMessageQueueTopologyModel(answer([], []), { windowSeconds: 60 })
        .windowSeconds,
    ).toBe(60);
    expect(
      buildMessageQueueTopologyModel({
        ...answer([], []),
        startTime: "",
        endTime: "",
      }).windowSeconds,
    ).toBe(1);
  });

  test("a service's node sums what it published and consumed, and on how many queues", () => {
    const fulfilment: MessageQueueTopologyServiceNode =
      pipeline().nodeByKey.get(
        S("fulfilment"),
      ) as MessageQueueTopologyServiceNode;
    expect(fulfilment.published.messages).toBe(580);
    expect(fulfilment.consumed.messages).toBe(590);
    expect(fulfilment.publishesTo).toBe(1);
    expect(fulfilment.consumesFrom).toBe(1);
  });

  test("a queue's node counts its producers and consumers", () => {
    const orders: MessageQueueTopologyQueueNode = pipeline().nodeByKey.get(
      Q("orders"),
    ) as MessageQueueTopologyQueueNode;
    expect(orders.producerCount).toBe(1);
    expect(orders.consumerCount).toBe(2);
  });

  test("a service the caller may not read is an unknown service, found by its id", () => {
    const model: MessageQueueTopologyModel = buildMessageQueueTopologyModel(
      answer([queue("orders")], [flow("orders", "hidden-1", "publish", 5)], {
        "hidden-1": "",
      }),
    );
    const node: MessageQueueTopologyServiceNode = model.nodeByKey.get(
      S("hidden-1"),
    ) as MessageQueueTopologyServiceNode;
    expect(node.isNamed).toBe(false);
    expect(node.label).toBe(MESSAGE_QUEUE_TOPOLOGY_UNKNOWN_SERVICE);
    expect(node.searchText).toContain("hidden-1");
  });

  test("a flow for a queue the answer does not hold, or of no message, is no line; one listed twice is one", () => {
    const model: MessageQueueTopologyModel = buildMessageQueueTopologyModel(
      answer(
        [queue("orders")],
        [
          flow("orders", "a", "publish", 5),
          flow("orders", "a", "publish", 9),
          flow("ghost", "a", "publish", 5),
          flow("orders", "b", "consume", 0),
        ],
      ),
    );
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0]!.messages).toBe(5);
  });

  test("the model is the same however the answer is ordered", () => {
    const random: SeededRandom = seededRandom(6189);
    const base: MessageQueueTopologyResponse = answer(
      [queue("orders"), queue("shipments"), queue("audit")],
      [
        flow("orders", "checkout", "publish", 600),
        flow("orders", "fulfilment", "consume", 590),
        flow("shipments", "fulfilment", "publish", 580),
        flow("shipments", "notifier", "consume", 575),
        flow("audit", "checkout", "publish", 100),
      ],
    );
    const reference: MessageQueueTopologyModel =
      buildMessageQueueTopologyModel(base);
    for (let round: number = 0; round < 20; round++) {
      const model: MessageQueueTopologyModel = buildMessageQueueTopologyModel({
        ...base,
        services: shuffled(base.services, random),
        flows: shuffled(base.flows, random),
      });
      expect(model.edges).toEqual(reference.edges);
      expect(
        model.nodes
          .filter((node: MessageQueueTopologyNode) => {
            return node.kind === "service";
          })
          .map((node: MessageQueueTopologyNode) => {
            return node.key;
          }),
      ).toEqual(
        reference.nodes
          .filter((node: MessageQueueTopologyNode) => {
            return node.kind === "service";
          })
          .map((node: MessageQueueTopologyNode) => {
            return node.key;
          }),
      );
    }
  });
});

describe("health stays calm unless something is wrong", () => {
  test.each([
    [{ spans: 0, errors: 0, published: 0, consumed: 0 }, "idle"],
    [{ spans: 100, errors: 0, published: 50, consumed: 50 }, "flowing"],
    [{ spans: 100, errors: 1, published: 50, consumed: 50 }, "flowing"],
    [{ spans: 100, errors: 2, published: 50, consumed: 50 }, "degraded"],
    [{ spans: 100, errors: 5, published: 50, consumed: 50 }, "critical"],
    [{ spans: 100, errors: 0, published: 50, consumed: 0 }, "noConsumers"],
    [{ spans: 100, errors: 0, published: 0, consumed: 50 }, "noProducers"],
    // Errors outrank a missing side.
    [{ spans: 100, errors: 30, published: 50, consumed: 0 }, "critical"],
    // Spans, but none a publish or a consume: nothing to say against it.
    [{ spans: 10, errors: 0, published: 0, consumed: 0 }, "flowing"],
  ])("a queue with %j is %s", (figures: QueueFigures, status: string) => {
    expect(getMessageQueueTopologyQueueStatus(figures)).toBe(status);
  });

  test("only errors need attention; a queue seen from one side is said in words, not in colour", () => {
    const model: MessageQueueTopologyModel = buildMessageQueueTopologyModel(
      answer(
        [
          queue("fine"),
          queue("one-sided", { consumed: 0 }),
          queue("failing", { errors: 10 }),
        ],
        [],
      ),
    );
    expect(
      model.nodes
        .filter((node: MessageQueueTopologyNode) => {
          return node.needsAttention;
        })
        .map((node: MessageQueueTopologyNode) => {
          return node.key;
        }),
    ).toEqual([Q("failing")]);
    expect(model.attentionCount).toBe(1);
    // Neither healthy nor quiet is green, and quiet is not amber or red.
    expect(MESSAGE_QUEUE_TOPOLOGY_STATUS_COLORS.flowing).toBe("#94a3b8");
    for (const quiet of [
      "noConsumers",
      "noProducers",
      "idle",
    ] as Array<MessageQueueTopologyStatus>) {
      expect(MESSAGE_QUEUE_TOPOLOGY_STATUS_COLORS[quiet]).toBe("#cbd5e1");
    }
    expect(MESSAGE_QUEUE_TOPOLOGY_EDGE_COLORS.healthy).not.toBe("#16a34a");
    for (const status of Object.keys(MESSAGE_QUEUE_TOPOLOGY_STATUS_LABELS)) {
      expect(
        MESSAGE_QUEUE_TOPOLOGY_STATUS_LABELS[
          status as MessageQueueTopologyStatus
        ],
      ).toBeTruthy();
    }
  });

  test("a rate's health is the Service Map's rule", () => {
    for (let errors: number = 0; errors <= 100; errors++) {
      expect(getMessageQueueTopologyRateHealth(errors / 100)).toBe(
        healthForErrorRate(100, errors, 0.01),
      );
    }
    expect(getMessageQueueTopologyRateHealth(null)).toBe("unknown");
    expect(getMessageQueueTopologyRateHealth(Number.NaN)).toBe("unknown");
    expect(getMessageQueueTopologyRateHealth(-1)).toBe("unknown");
  });

  test("a line's health is its card's rate: a sender failing by its sends is judged by them", () => {
    // 13 messages (producer markers), 31 failed sends of 40: 77.5%.
    const model: MessageQueueTopologyModel = buildMessageQueueTopologyModel(
      answer(
        [queue("orders")],
        [
          flow("orders", "azure-sender", "publish", 13, 31, {
            errorRatePercent: 77.5,
          }),
        ],
      ),
    );
    const edge: MessageQueueTopologyEdge = model.edges[0]!;
    expect(edge.errors).toBe(31);
    expect(edge.attempts).toBeCloseTo(40, 10);
    expect(edge.errorRatePercent).toBe(77.5);
    expect(edge.health).toBe("critical");
  });

  test("a service is judged by its errors over everything it attempted, both ways", () => {
    const model: MessageQueueTopologyModel = buildMessageQueueTopologyModel(
      answer(
        [queue("a"), queue("b")],
        [
          flow("a", "svc", "publish", 1000, 0),
          flow("b", "svc", "consume", 100, 3),
        ],
      ),
    );
    const svc: MessageQueueTopologyServiceNode = model.nodeByKey.get(
      S("svc"),
    ) as MessageQueueTopologyServiceNode;
    // 3 of 1100: within the tolerated 1%.
    expect(svc.status).toBe("flowing");
    expect(svc.health).toBe("healthy");
  });

  test("a flow's attempts are worked back from its rate when it failed some", () => {
    expect(
      getMessageQueueTopologyFlowAttempts({
        messages: 13,
        errors: 31,
        errorRatePercent: 77.5,
      }),
    ).toBeCloseTo(40, 10);
    expect(
      getMessageQueueTopologyFlowAttempts({
        messages: 13,
        errors: 0,
        errorRatePercent: 0,
      }),
    ).toBe(13);
    expect(
      getMessageQueueTopologyFlowAttempts({
        messages: 13,
        errors: 2,
        errorRatePercent: null,
      }),
    ).toBe(13);
  });
});

describe("brokers", () => {
  test("a broker is a system, and for Azure its namespace", () => {
    expect(
      getMessageQueueTopologyGroupKey({
        messagingSystem: "Kafka",
        brokerScope: "",
      }),
    ).toBe("kafka|");
    expect(
      getMessageQueueTopologyGroupKey({
        messagingSystem: "servicebus",
        brokerScope: "Orders-Prod",
      }),
    ).toBe("servicebus|orders-prod");
  });

  test("each broker has a label, a count and a calm colour, in a fixed order", () => {
    const model: MessageQueueTopologyModel = buildMessageQueueTopologyModel(
      answer(
        [
          queue("a", {
            messagingSystem: "servicebus",
            brokerScope: "orders-prod",
          }),
          queue("b", { messagingSystem: "kafka" }),
          queue("c", { messagingSystem: "kafka" }),
          queue("d", { messagingSystem: "servicebus", brokerScope: "billing" }),
        ],
        [],
      ),
    );
    expect(
      model.brokerGroups.map((group: MessageQueueTopologyBrokerGroup) => {
        return [group.key, group.label, group.queueCount];
      }),
    ).toEqual([
      ["kafka|", "Apache Kafka", 2],
      ["servicebus|billing", "Azure Service Bus · billing", 1],
      ["servicebus|orders-prod", "Azure Service Bus · orders-prod", 1],
    ]);
    model.brokerGroups.forEach(
      (group: MessageQueueTopologyBrokerGroup, index: number) => {
        expect(group.color).toBe(MESSAGE_QUEUE_TOPOLOGY_BROKER_COLORS[index]);
      },
    );
    // A queue's tint is its broker's.
    expect(model.nodeByKey.get(Q("b"))!.color).toBe(
      model.brokerGroups[0]!.color,
    );
  });

  test("a queue's subtitle names its broker; its label is its name, else its destination", () => {
    const model: MessageQueueTopologyModel = buildMessageQueueTopologyModel(
      answer(
        [
          queue("a", {
            name: "",
            destinationName: "orders.created",
            brokerAddress: "kafka-1:9092",
          }),
        ],
        [],
      ),
    );
    const node: MessageQueueTopologyQueueNode = model.nodeByKey.get(
      Q("a"),
    ) as MessageQueueTopologyQueueNode;
    expect(node.label).toBe("orders.created");
    expect(node.subtitle).toBe("Apache Kafka · kafka-1:9092");
    expect(
      getMessageQueueTopologyQueueLabel({
        name: "",
        destinationName: "",
        messagingSystem: "rabbitmq",
      }),
    ).toBe("RabbitMQ");
    expect(
      getMessageQueueTopologyQueueLabel({
        name: "",
        destinationName: "",
        messagingSystem: "",
      }),
    ).toBe("—");
  });
});

describe("what is shown", () => {
  test("with no filter, everything is matched and nothing is context", () => {
    const model: MessageQueueTopologyModel = pipeline();
    const visibility: MessageQueueTopologyVisibility =
      resolveMessageQueueTopologyVisibility(model, NO_FILTERS);
    expect(visibility.matchedKeys.size).toBe(model.nodes.length);
    expect(visibility.contextKeys.size).toBe(0);
    expect(visibility.effectiveFocusKey).toBeNull();
    expect(visibility.focusKeys).toBeNull();
  });

  test("a search matches names, destinations, systems and brokers, every word, and draws the neighbours dimmed", () => {
    const model: MessageQueueTopologyModel = pipeline();
    const visibility: MessageQueueTopologyVisibility =
      resolveMessageQueueTopologyVisibility(model, {
        ...NO_FILTERS,
        search: "  SHIP  kafka ",
      });
    expect(Array.from(visibility.matchedKeys)).toEqual([Q("shipments")]);
    expect(Array.from(visibility.contextKeys).sort()).toEqual(
      [S("fulfilment"), S("notifier")].sort(),
    );
  });

  test("Needs attention shows what has errors, with its neighbours", () => {
    const model: MessageQueueTopologyModel = buildMessageQueueTopologyModel(
      answer(
        [queue("orders"), queue("emails", { errors: 50 })],
        [
          flow("orders", "a", "publish", 10),
          flow("emails", "b", "consume", 10),
        ],
      ),
    );
    const visibility: MessageQueueTopologyVisibility =
      resolveMessageQueueTopologyVisibility(model, {
        ...NO_FILTERS,
        attentionOnly: true,
      });
    expect(Array.from(visibility.matchedKeys)).toEqual([Q("emails")]);
    expect(Array.from(visibility.contextKeys)).toEqual([S("b")]);
  });

  test("a broker shows its queues and the services on them, nothing else", () => {
    const model: MessageQueueTopologyModel = buildMessageQueueTopologyModel(
      answer(
        [
          queue("orders", { messagingSystem: "kafka" }),
          queue("emails", { messagingSystem: "rabbitmq" }),
        ],
        [
          flow("orders", "a", "publish", 10),
          flow("emails", "a", "consume", 10),
          flow("emails", "b", "publish", 10),
        ],
      ),
    );
    const visibility: MessageQueueTopologyVisibility =
      resolveMessageQueueTopologyVisibility(model, {
        ...NO_FILTERS,
        brokerGroupKey: "rabbitmq|",
      });
    expect(Array.from(visibility.matchedKeys).sort()).toEqual(
      [Q("emails"), S("a"), S("b")].sort(),
    );
    // A broker the model does not have filters nothing.
    expect(
      resolveMessageQueueTopologyVisibility(model, {
        ...NO_FILTERS,
        brokerGroupKey: "nats|",
      }).matchedKeys.size,
    ).toBe(model.nodes.length);
  });

  test("a focus follows a queue's messages upstream and downstream, leaving out what is only beside them", () => {
    const model: MessageQueueTopologyModel = pipeline();
    const visibility: MessageQueueTopologyVisibility =
      resolveMessageQueueTopologyVisibility(model, {
        ...NO_FILTERS,
        focusKey: Q("shipments"),
      });
    expect(visibility.effectiveFocusKey).toBe(Q("shipments"));
    // Upstream: fulfilment, orders, checkout. Downstream: notifier.
    expect(Array.from(visibility.matchedKeys).sort()).toEqual(
      [
        Q("shipments"),
        S("fulfilment"),
        Q("orders"),
        S("checkout"),
        S("notifier"),
      ].sort(),
    );
    // Beside the path: billing (another consumer of orders), audit.
    expect(visibility.matchedKeys.has(S("billing"))).toBe(false);
    expect(visibility.matchedKeys.has(Q("audit"))).toBe(false);
  });

  test("a focus on a service follows what feeds it and what it feeds", () => {
    const visibility: MessageQueueTopologyVisibility =
      resolveMessageQueueTopologyVisibility(pipeline(), {
        ...NO_FILTERS,
        focusKey: S("checkout"),
      });
    expect(Array.from(visibility.matchedKeys).sort()).toEqual(
      [
        S("checkout"),
        Q("orders"),
        Q("audit"),
        S("fulfilment"),
        S("billing"),
        Q("shipments"),
        S("notifier"),
      ].sort(),
    );
  });

  test("a focus the model does not have is no focus", () => {
    const visibility: MessageQueueTopologyVisibility =
      resolveMessageQueueTopologyVisibility(pipeline(), {
        ...NO_FILTERS,
        focusKey: Q("deleted"),
      });
    expect(visibility.effectiveFocusKey).toBeNull();
    expect(visibility.matchedKeys.size).toBe(pipeline().nodes.length);
  });

  test("a focus stops a few hops out, and survives a cycle", () => {
    // s0 -> q0 -> s1 -> q1 -> ... -> s9, and q9 -> s0 closes a loop.
    const queues: Array<MessageQueueTopologyQueue> = [];
    const flows: Array<MessageQueueTopologyFlow> = [];
    for (let index: number = 0; index < 10; index++) {
      queues.push(queue(`q${index}`));
      flows.push(flow(`q${index}`, `s${index}`, "publish", 10));
      flows.push(flow(`q${index}`, `s${(index + 1) % 10}`, "consume", 10));
    }
    const model: MessageQueueTopologyModel = buildMessageQueueTopologyModel(
      answer(queues, flows),
    );
    const lineage: Set<string> = getMessageQueueTopologyLineage(model, Q("q0"));
    // Six edges each way, at most.
    expect(lineage.size).toBeLessThanOrEqual(
      1 + 2 * MESSAGE_QUEUE_TOPOLOGY_FOCUS_DEPTH,
    );
    expect(lineage.has(S("s3"))).toBe(true);
    expect(lineage.has(Q("q5"))).toBe(false);
    // The whole loop, given the depth to reach it.
    expect(getMessageQueueTopologyLineage(model, Q("q0"), 100).size).toBe(20);
    expect(getMessageQueueTopologyLineage(model, Q("nope")).size).toBe(0);
  });

  test("a search inside a focus matches only inside the focus", () => {
    const visibility: MessageQueueTopologyVisibility =
      resolveMessageQueueTopologyVisibility(pipeline(), {
        ...NO_FILTERS,
        focusKey: Q("shipments"),
        search: "billing",
      });
    expect(visibility.matchedKeys.size).toBe(0);
  });
});

describe("folding by broker", () => {
  function twoBrokers(): MessageQueueTopologyModel {
    return buildMessageQueueTopologyModel(
      answer(
        [
          queue("orders", {
            messagingSystem: "kafka",
            published: 10,
            consumed: 9,
          }),
          queue("payments", {
            messagingSystem: "kafka",
            published: 5,
            consumed: 5,
            errors: 20,
          }),
          queue("emails", {
            messagingSystem: "rabbitmq",
            published: 3,
            consumed: 3,
          }),
        ],
        [
          flow("orders", "checkout", "publish", 10),
          flow("payments", "checkout", "publish", 5, 1),
          flow("orders", "fulfilment", "consume", 9),
          flow("emails", "fulfilment", "publish", 3),
        ],
      ),
    );
  }

  test("a broker stands for its queues, a line for every service and way", () => {
    const folded: MessageQueueTopologyModel =
      groupMessageQueueTopologyByBroker(twoBrokers());
    const kafka: MessageQueueTopologyBrokerNode = folded.nodeByKey.get(
      getMessageQueueTopologyBrokerKey("kafka|"),
    ) as MessageQueueTopologyBrokerNode;
    expect(kafka.kind).toBe("broker");
    expect(kafka.queueCount).toBe(2);
    expect(kafka.published).toBe(15);
    expect(kafka.consumed).toBe(14);
    expect(kafka.queueKeys.sort()).toEqual([Q("orders"), Q("payments")].sort());
    // payments' 20 failed spans of 200: 10%, critical for the broker.
    expect(kafka.status).toBe("critical");
    expect(kafka.needsAttention).toBe(true);
    // No queue node is left; the services are as they were.
    expect(
      folded.nodes.filter((node: MessageQueueTopologyNode) => {
        return node.kind === "queue";
      }),
    ).toEqual([]);
    expect(
      folded.nodes.filter((node: MessageQueueTopologyNode) => {
        return node.kind === "service";
      }),
    ).toHaveLength(2);

    const checkoutToKafka: MessageQueueTopologyEdge = folded.edges.find(
      (edge: MessageQueueTopologyEdge) => {
        return edge.from === S("checkout") && edge.to === kafka.key;
      },
    )!;
    expect(checkoutToKafka.messages).toBe(15);
    expect(checkoutToKafka.errors).toBe(1);
    expect(checkoutToKafka.p95DurationMs).toBeNull();
    expect(checkoutToKafka.errorRatePercent).toBeCloseTo((1 / 15) * 100, 10);
    expect(folded.edges).toHaveLength(3);
  });

  test("folding keeps the counts and the window; a broker is searchable by its queues", () => {
    const model: MessageQueueTopologyModel = twoBrokers();
    const folded: MessageQueueTopologyModel =
      groupMessageQueueTopologyByBroker(model);
    expect(folded.windowSeconds).toBe(model.windowSeconds);
    expect(folded.queueCount).toBe(model.queueCount);
    const visibility: MessageQueueTopologyVisibility =
      resolveMessageQueueTopologyVisibility(folded, {
        ...NO_FILTERS,
        search: "payments",
      });
    expect(
      visibility.matchedKeys.has(getMessageQueueTopologyBrokerKey("kafka|")),
    ).toBe(true);
  });

  test("a broker filter keeps the folded broker and the services on it", () => {
    const folded: MessageQueueTopologyModel =
      groupMessageQueueTopologyByBroker(twoBrokers());
    const visibility: MessageQueueTopologyVisibility =
      resolveMessageQueueTopologyVisibility(folded, {
        ...NO_FILTERS,
        brokerGroupKey: "rabbitmq|",
      });
    expect(Array.from(visibility.matchedKeys).sort()).toEqual(
      [getMessageQueueTopologyBrokerKey("rabbitmq|"), S("fulfilment")].sort(),
    );
  });
});

describe("the layout", () => {
  test("left to right the way messages travel; a node with no line is listed, not drawn", () => {
    const model: MessageQueueTopologyModel = buildMessageQueueTopologyModel(
      answer(
        [queue("orders"), queue("shipments"), queue("lonely")],
        [
          flow("orders", "checkout", "publish", 10),
          flow("orders", "fulfilment", "consume", 10),
          flow("shipments", "fulfilment", "publish", 10),
          flow("shipments", "notifier", "consume", 10),
        ],
      ),
    );
    const layout: MessageQueueTopologyLayout = layoutMessageQueueTopology({
      visibleKeys: new Set(
        model.nodes.map((node: MessageQueueTopologyNode) => {
          return node.key;
        }),
      ),
      edges: model.edges,
      columnGap: 300,
      rowGap: 150,
    });
    const x: (key: string) => number = (key: string): number => {
      return layout.positions.get(key)!.x;
    };
    expect(x(S("checkout"))).toBeLessThan(x(Q("orders")));
    expect(x(Q("orders"))).toBeLessThan(x(S("fulfilment")));
    expect(x(S("fulfilment"))).toBeLessThan(x(Q("shipments")));
    expect(x(Q("shipments"))).toBeLessThan(x(S("notifier")));
    expect(layout.unconnectedKeys).toEqual([Q("lonely")]);
    expect(layout.positions.has(Q("lonely"))).toBe(false);
  });

  test("a line is drawn only between two visible nodes", () => {
    const model: MessageQueueTopologyModel = pipeline();
    const layout: MessageQueueTopologyLayout = layoutMessageQueueTopology({
      visibleKeys: new Set([Q("orders"), S("checkout"), Q("audit")]),
      edges: model.edges,
      columnGap: 300,
      rowGap: 150,
    });
    expect(Array.from(layout.positions.keys()).sort()).toEqual(
      [Q("orders"), S("checkout"), Q("audit")].sort(),
    );
    expect(layout.unconnectedKeys).toEqual([]);
  });

  test("the same graph always lays out the same, a loop included", () => {
    const model: MessageQueueTopologyModel = buildMessageQueueTopologyModel(
      answer(
        [queue("requests"), queue("replies")],
        [
          flow("requests", "client", "publish", 10),
          flow("requests", "server", "consume", 10),
          flow("replies", "server", "publish", 10),
          flow("replies", "client", "consume", 10),
          // A service on both sides of one queue (a retry loop).
          flow("requests", "server", "publish", 2),
        ],
      ),
    );
    const visible: Set<string> = new Set(
      model.nodes.map((node: MessageQueueTopologyNode) => {
        return node.key;
      }),
    );
    const first: MessageQueueTopologyLayout = layoutMessageQueueTopology({
      visibleKeys: visible,
      edges: model.edges,
      columnGap: 300,
      rowGap: 150,
    });
    const second: MessageQueueTopologyLayout = layoutMessageQueueTopology({
      visibleKeys: new Set(Array.from(visible).reverse()),
      edges: [...model.edges].reverse(),
      columnGap: 300,
      rowGap: 150,
    });
    expect(Array.from(second.positions.entries()).sort()).toEqual(
      Array.from(first.positions.entries()).sort(),
    );
    expect(first.positions.size).toBe(4);
  });
});

describe("the table", () => {
  test("one row per visible queue, busiest first, the services on each side busiest first", () => {
    const model: MessageQueueTopologyModel = pipeline();
    const rows: Array<MessageQueueTopologyTableRow> =
      getMessageQueueTopologyTableRows(
        model,
        resolveMessageQueueTopologyVisibility(model, NO_FILTERS),
      );
    expect(
      rows.map((row: MessageQueueTopologyTableRow) => {
        return row.node.key;
      }),
    ).toEqual(
      [Q("orders"), Q("shipments"), Q("audit")].sort((a: string, b: string) => {
        // All three answer 100 messages a side here: then by name.
        return a.localeCompare(b);
      }),
    );
    const orders: MessageQueueTopologyTableRow = rows.find(
      (row: MessageQueueTopologyTableRow) => {
        return row.node.key === Q("orders");
      },
    )!;
    expect(
      orders.producers.map((node: MessageQueueTopologyNode) => {
        return node.key;
      }),
    ).toEqual([S("checkout")]);
    expect(
      orders.consumers.map((node: MessageQueueTopologyNode) => {
        return node.key;
      }),
    ).toEqual([S("billing"), S("fulfilment")]);
  });

  test("a search for a service lists the queues it is on", () => {
    const model: MessageQueueTopologyModel = pipeline();
    const rows: Array<MessageQueueTopologyTableRow> =
      getMessageQueueTopologyTableRows(
        model,
        resolveMessageQueueTopologyVisibility(model, {
          ...NO_FILTERS,
          search: "notifier",
        }),
      );
    expect(
      rows.map((row: MessageQueueTopologyTableRow) => {
        return row.node.key;
      }),
    ).toEqual([Q("shipments")]);
  });
});

describe("numbers", () => {
  test.each([
    [0, 3600, "—"],
    [-5, 3600, "—"],
    [10, 0, "—"],
    [3600 * 5, 3600, "5.0/s"],
    [3600 * 12, 3600, "12/s"],
    [3600 * 1500, 3600, "1.5k/s"],
    [3600 * 2_500_000, 3600, "2.5M/s"],
    [45 * 60, 3600, "45/min"],
    [2 * 60, 3600, "2.0/min"],
    [6, 3600, "0.1/min"],
    [1, 3600, "<0.1/min"],
  ])(
    "%d messages over %d s read %s",
    (messages: number, seconds: number, text: string) => {
      expect(formatMessageQueueTopologyRate(messages, seconds)).toBe(text);
    },
  );

  test.each([
    [null, "—"],
    [Number.NaN, "—"],
    [-1, "—"],
    [0, "0%"],
    [0.05, "<0.1%"],
    [2.5, "2.5%"],
    [250, "100.0%"],
  ])("%j percent reads %s", (percent: number | null, text: string) => {
    expect(formatMessageQueueTopologyPercent(percent)).toBe(text);
  });

  test("a share of spans: none when nothing happened, never past 100%", () => {
    expect(formatMessageQueueTopologyErrorRate(0, 0)).toBe("—");
    expect(formatMessageQueueTopologyErrorRate(10, 1)).toBe("10.0%");
    expect(formatMessageQueueTopologyErrorRate(10, 20)).toBe("100.0%");
  });

  test("a line is wider for more messages, within reason", () => {
    expect(getMessageQueueTopologyEdgeWidth(0)).toBe(1.5);
    expect(getMessageQueueTopologyEdgeWidth(10)).toBeLessThan(
      getMessageQueueTopologyEdgeWidth(1000),
    );
    expect(getMessageQueueTopologyEdgeWidth(1e12)).toBe(6);
  });
});

describe("what to say when there is nothing to draw", () => {
  test("no queue, no traced message, no flow, or something to draw", () => {
    expect(
      getMessageQueueTopologyEmptyReason(
        buildMessageQueueTopologyModel(answer([], [])),
      ),
    ).toBe("noQueues");
    expect(
      getMessageQueueTopologyEmptyReason(
        buildMessageQueueTopologyModel(
          answer([queue("a", { spans: 0, published: 0, consumed: 0 })], []),
        ),
      ),
    ).toBe("noTraffic");
    expect(
      getMessageQueueTopologyEmptyReason(
        buildMessageQueueTopologyModel(answer([queue("a")], [])),
      ),
    ).toBe("noFlows");
    expect(getMessageQueueTopologyEmptyReason(pipeline())).toBeNull();
  });
});

describe("over random topologies", () => {
  test("every line joins two nodes, every visible node is in the scope, and a focus is a subset", () => {
    const random: SeededRandom = seededRandom(61892);
    for (let round: number = 0; round < 150; round++) {
      const queueCount: number = 1 + random(8);
      const serviceCount: number = 1 + random(6);
      const queues: Array<MessageQueueTopologyQueue> = [];
      for (let index: number = 0; index < queueCount; index++) {
        queues.push(
          queue(`q${index}`, {
            messagingSystem: ["kafka", "rabbitmq", "aws_sqs"][random(3)]!,
            spans: random(200),
            errors: random(10),
          }),
        );
      }
      const flows: Array<MessageQueueTopologyFlow> = [];
      for (let index: number = 0; index < random(20); index++) {
        flows.push(
          flow(
            `q${random(queueCount)}`,
            `s${random(serviceCount)}`,
            random(2) === 0 ? "publish" : "consume",
            1 + random(500),
            random(5),
          ),
        );
      }
      const model: MessageQueueTopologyModel = buildMessageQueueTopologyModel(
        answer(queues, flows),
      );
      for (const edge of model.edges) {
        expect(model.nodeByKey.has(edge.from)).toBe(true);
        expect(model.nodeByKey.has(edge.to)).toBe(true);
        expect(model.nodeByKey.get(edge.queueKey)!.kind).toBe("queue");
        expect(model.nodeByKey.get(edge.serviceKey)!.kind).toBe("service");
      }
      const all: MessageQueueTopologyVisibility =
        resolveMessageQueueTopologyVisibility(model, NO_FILTERS);
      const focusNode: MessageQueueTopologyNode | undefined =
        model.nodes[random(model.nodes.length)];
      if (!focusNode) {
        continue;
      }
      const focused: MessageQueueTopologyVisibility =
        resolveMessageQueueTopologyVisibility(model, {
          ...NO_FILTERS,
          focusKey: focusNode.key,
        });
      expect(focused.matchedKeys.has(focusNode.key)).toBe(true);
      for (const key of focused.visibleKeys) {
        expect(all.visibleKeys.has(key)).toBe(true);
      }
      const folded: MessageQueueTopologyModel =
        groupMessageQueueTopologyByBroker(model);
      const foldedMessages: number = folded.edges.reduce(
        (total: number, edge: MessageQueueTopologyEdge) => {
          return total + edge.messages;
        },
        0,
      );
      const messages: number = model.edges.reduce(
        (total: number, edge: MessageQueueTopologyEdge) => {
          return total + edge.messages;
        },
        0,
      );
      expect(foldedMessages).toBe(messages);
    }
  });
});

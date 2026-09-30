import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Whether a system's broker metrics can reach a queue is ONE rule,
 * canBrokerMetricsReachMessageQueue in Pages/MessageQueue/Utils/
 * MessageQueuePresentation: the Overview's Broker health section offers a
 * setup by it (getMessageQueueBrokerMetricsGuidance), and the Documentation
 * tab's guide promises the broker's own metrics by it
 * (DocumentationMarkdown). The guide used to keep a private copy of the
 * rule, held to the section's by a cross-check over the catalog.
 *
 * Here the rule is swapped for a stand-in that answers what the catalog
 * never would. A consumer that still decided by a copy of its own ignores
 * the stand-in, so each test fails the moment either consumer stops asking
 * the shared rule. The rule itself is pinned, system by system, in
 * MessageQueuePresentation.test.
 */

type ReachTarget = { brokerScope?: string | null | undefined };

type ReachRule = (
  system: string | null | undefined,
  queue?: ReachTarget | null | undefined,
) => boolean;

const reachRule: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueuePresentation",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueuePresentation",
    ) as Record<string, unknown>;

    return {
      __esModule: true,
      ...actual,
      canBrokerMetricsReachMessageQueue: (
        system: string | null | undefined,
        queue?: ReachTarget | null | undefined,
      ): boolean => {
        return reachRule(system, queue) as boolean;
      },
    };
  },
);

import {
  getMessageQueueDocumentationMarkdown,
  getMessageQueueSystemGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/DocumentationMarkdown";
import {
  MessageQueueBrokerMetricsGuidance,
  getMessageQueueBrokerMetricsGuidance,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueuePresentation";

const actualRule: ReachRule = (
  jest.requireActual(
    "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueuePresentation",
  ) as { canBrokerMetricsReachMessageQueue: ReachRule }
).canBrokerMetricsReachMessageQueue;

const VARS: { oneuptimeUrl: string; apiKey: string } = {
  oneuptimeUrl: "https://oneuptime.example.com",
  apiKey: "ingest-key-123",
};

// What each consumer says when the rule lets the broker's metrics in.
const PRODUCT_GUIDE_PROMISE: string =
  "two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics";
const QUEUE_GUIDE_PROMISE: string = "and from the broker's own metrics.";
const QUEUE_GUIDE_NO_PROMISE: string =
  "and from metrics that carry its `messaging.system` and `messaging.destination.name`.";
const QUEUE_GUIDE_OUTSIDE: string =
  "This queue has no namespace, so Azure Monitor's metrics never reach it";

function queueGuide(system: string, brokerScope: string): string {
  return getMessageQueueDocumentationMarkdown(VARS, {
    system: system,
    destination: "orders",
    brokerScope: brokerScope,
  });
}

beforeEach(() => {
  reachRule.mockReset();
  reachRule.mockImplementation(actualRule);
});

describe("the stand-in starts out as the real rule", () => {
  test("so Kafka's guides and Broker health promise its broker metrics, and NATS's do not", () => {
    expect(getMessageQueueSystemGuideMarkdown(VARS, "kafka")).toContain(
      PRODUCT_GUIDE_PROMISE,
    );
    expect(queueGuide("kafka", "")).toContain(QUEUE_GUIDE_PROMISE);
    expect(
      getMessageQueueBrokerMetricsGuidance("kafka", { brokerScope: "" })
        .reachesQueue,
    ).toBe(true);

    expect(getMessageQueueSystemGuideMarkdown(VARS, "nats")).not.toContain(
      PRODUCT_GUIDE_PROMISE,
    );
    expect(queueGuide("nats", "")).toContain(QUEUE_GUIDE_NO_PROMISE);
    expect(
      getMessageQueueBrokerMetricsGuidance("nats", { brokerScope: "" })
        .reachesQueue,
    ).toBe(false);
    expect(reachRule).toHaveBeenCalled();
  });
});

describe("the Documentation tab and Broker health both follow the one rule", () => {
  test("a rule that lets no broker metrics in: neither promises Kafka's", () => {
    reachRule.mockImplementation((): boolean => {
      return false;
    });

    const product: string = getMessageQueueSystemGuideMarkdown(VARS, "kafka");
    expect(product).not.toContain(PRODUCT_GUIDE_PROMISE);
    expect(product).toContain(
      "Apache Kafka queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. ",
    );

    const queue: string = queueGuide("kafka", "");
    expect(queue).toContain(QUEUE_GUIDE_NO_PROMISE);
    expect(queue).not.toContain("the broker's own metrics");

    const guidance: MessageQueueBrokerMetricsGuidance =
      getMessageQueueBrokerMetricsGuidance("kafka", { brokerScope: "" });
    expect(guidance.reachesQueue).toBe(false);
    expect(guidance.description).not.toMatch(/has arrived/);
  });

  test("a rule that lets every system's in: both promise NATS's", () => {
    reachRule.mockImplementation((): boolean => {
      return true;
    });

    expect(getMessageQueueSystemGuideMarkdown(VARS, "nats")).toContain(
      PRODUCT_GUIDE_PROMISE,
    );
    expect(queueGuide("nats", "")).toContain(QUEUE_GUIDE_PROMISE);

    const guidance: MessageQueueBrokerMetricsGuidance =
      getMessageQueueBrokerMetricsGuidance("nats", { brokerScope: "" });
    expect(guidance.reachesQueue).toBe(true);
    expect(guidance.description).toMatch(
      /^No NATS broker metric has arrived for this queue yet\. /,
    );
  });

  /*
   * "Reaches queues of the system, but not this one" is the rule asked with
   * and without the queue: a stand-in that turns away every queue — even a
   * namespaced Service Bus queue, which the catalog lets in — makes both
   * say where the metrics go instead of offering them.
   */
  test("a rule that reaches the system's queues but not this one: both say where the metrics go", () => {
    reachRule.mockImplementation(
      (
        _system: string | null | undefined,
        queue?: ReachTarget | null,
      ): boolean => {
        return !queue;
      },
    );

    const queue: string = queueGuide("servicebus", "orders-prod");
    expect(queue).toContain(QUEUE_GUIDE_NO_PROMISE);
    expect(queue).toContain(QUEUE_GUIDE_OUTSIDE);
    expect(queue).toContain(
      "- **Broker metrics**: Azure Monitor names the namespace of every metric it reports, so this queue's broker metrics attach to the same destination's queue in that namespace, not to this one.",
    );

    const guidance: MessageQueueBrokerMetricsGuidance =
      getMessageQueueBrokerMetricsGuidance("servicebus", {
        brokerScope: "orders-prod",
      });
    expect(guidance.reachesQueue).toBe(false);
    expect(guidance.description).toMatch(
      /^Azure Service Bus broker metrics name the namespace they come from, and this queue has none/,
    );

    // The product guide has no queue to turn away.
    expect(getMessageQueueSystemGuideMarkdown(VARS, "servicebus")).toContain(
      PRODUCT_GUIDE_PROMISE,
    );
  });

  test("each asks about the queue it shows: its system and its namespace", () => {
    // Either spelling of the system: the rule reads aliases itself.
    const serviceBus: unknown = expect.stringMatching(/^(azure_)?servicebus$/);

    queueGuide("azure_servicebus", "orders-prod");
    expect(reachRule).toHaveBeenCalledWith(
      serviceBus,
      expect.objectContaining({ brokerScope: "orders-prod" }),
    );

    reachRule.mockClear();
    getMessageQueueBrokerMetricsGuidance("azure_servicebus", {
      brokerScope: "orders-prod",
    });
    expect(reachRule).toHaveBeenCalledWith(
      serviceBus,
      expect.objectContaining({ brokerScope: "orders-prod" }),
    );

    // The product guide is about every queue of the system: no queue.
    reachRule.mockClear();
    getMessageQueueSystemGuideMarkdown(VARS, "servicebus");
    expect(reachRule).toHaveBeenCalledWith("servicebus", null);
  });
});

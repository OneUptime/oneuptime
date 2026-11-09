import { describe, expect, test } from "@jest/globals";
import {
  MESSAGE_QUEUE_BROKER_METRIC_LATE_MINUTES,
  MessageQueueBrokerMetricState,
  MessageQueueBrokerMetricStatus,
  MessageQueueBrokerMetricsFinding,
  MessageQueueBrokerMetricsStatus,
  MessageQueueNamespaceFinding,
  getMessageQueueBrokerMetricStateLabel,
  getMessageQueueBrokerMetricStatusLine,
  getMessageQueueBrokerMetricsHealthLabel,
  getMessageQueueBrokerMetricsLastReceived,
  getMessageQueueBrokerMetricsStatus,
  getMessageQueueBrokerMetricsSummary,
  getMessageQueueMissingMetricsFinding,
  getMessageQueueNamespaceFinding,
  getMessageQueueNamespaceFindingWords,
  getMessageQueueStoppedMetricsFinding,
  isMessageQueueMetricReportedEveryPeriod,
  isMessageQueueMetricReportedWithEverySend,
  shouldReadMessageQueueNamespace,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueBrokerMetricsStatus";
import {
  MessageQueueBrokerMetricArrivals,
  MessageQueueBrokerMetricResult,
  MessageQueueNamespaceSeries,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import OneUptimeDate from "../../../Types/Date";
import {
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
  getMessageQueueMetricsForSystem,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import { Translator, createTranslator } from "../../../Types/Translator";

/*
 * THE BROKER METRICS CARD'S VERDICTS (MessageQueueBrokerMetricsStatus).
 *
 * For each metric the page charts for a queue's system: whether it arrived
 * in the selected range, and — for one that did not — the most the card can
 * say for sure:
 *
 *   - a count (messages in, errors, throttled requests, a send's latency) is
 *     reported only for periods with activity: one that did not arrive has
 *     NOTHING TO REPORT, never "missing" — no throttling is good news, and
 *     an idle count looks the same as an uncollected one — except a send's
 *     latency while the queue's published count shows sends in the range:
 *     it comes with every send, so it is NOT COLLECTED;
 *   - a level (a backlog, a size) is reported every period: one that never
 *     arrived while the queue's other metrics do is NOT COLLECTED, with the
 *     configuration line that collects it, and one that arrived before and
 *     no longer does STOPPED — unless it last arrived within the late
 *     window, since cloud metrics arrive minutes late;
 *   - without the week's arrivals (their read failed) nothing outside the
 *     range is claimed;
 *   - when nothing arrived in the range, the card says once whether
 *     metrics stopped, never arrived, or arrived after a past range — and,
 *     for an Azure queue, what its namespace sends instead.
 */

const NOW: Date = new Date("2026-03-04T12:30:00.000Z");
const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;
const WINDOW: { start: Date; end: Date } = {
  start: new Date(NOW.getTime() - HOUR_MS),
  end: NOW,
};

const SERVICE_BUS: ReadonlyArray<MessageQueueMetricDescriptor> =
  getMessageQueueMetricsForSystem("servicebus");
const PUBSUB: ReadonlyArray<MessageQueueMetricDescriptor> =
  getMessageQueueMetricsForSystem("gcp_pubsub");
const KAFKA: ReadonlyArray<MessageQueueMetricDescriptor> =
  getMessageQueueMetricsForSystem("kafka");

const ACTIVE: string = "azure_activemessages_average";
const DEAD_LETTERED: string = "azure_deadletteredmessages_average";
const SCHEDULED: string = "azure_scheduledmessages_average";
const SIZE: string = "azure_size_average";
const INCOMING: string = "azure_incomingmessages_total";
const THROTTLED: string = "azure_throttledrequests_total";
const SEND_LATENCY: string = "azure_serversendlatency_average";

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function descriptorOf(
  catalog: ReadonlyArray<MessageQueueMetricDescriptor>,
  name: string,
): MessageQueueMetricDescriptor {
  const found: MessageQueueMetricDescriptor | undefined = catalog.find(
    (descriptor: MessageQueueMetricDescriptor): boolean => {
      return descriptor.metricName === name;
    },
  );
  if (!found) {
    throw new Error(`no catalog metric ${name}`);
  }
  return found;
}

// A metric with points in the range, at these times.
function inRange(
  name: string,
  times: Array<Date> = [ago(5 * MINUTE_MS)],
  catalog: ReadonlyArray<MessageQueueMetricDescriptor> = SERVICE_BUS,
): MessageQueueBrokerMetricResult {
  return {
    descriptor: descriptorOf(catalog, name),
    series: times.map((x: Date): { x: Date; y: number } => {
      return { x: x, y: 1 };
    }),
    value: 1,
    observedSeries: [],
  };
}

// A metric reported in the range as 0 at every point: no activity.
function quietInRange(name: string): MessageQueueBrokerMetricResult {
  return { ...inRange(name), series: [{ x: ago(5 * MINUTE_MS), y: 0 }] };
}

function arrivalsOf(
  lastArrivedAt: Record<string, Date> = {},
): MessageQueueBrokerMetricArrivals {
  return {
    since: ago(7 * DAY_MS),
    lastArrivedAt: new Map<string, Date>(Object.entries(lastArrivedAt)),
  };
}

function statusOf(
  data: Partial<Parameters<typeof getMessageQueueBrokerMetricsStatus>[0]>,
): MessageQueueBrokerMetricsStatus {
  return getMessageQueueBrokerMetricsStatus({
    messagingSystem: "servicebus",
    catalog: SERVICE_BUS,
    results: [],
    arrivals: arrivalsOf(),
    brokerMetricsLastSeenAt: null,
    window: WINDOW,
    ...data,
  });
}

function metricOf(
  status: MessageQueueBrokerMetricsStatus,
  name: string,
): MessageQueueBrokerMetricStatus {
  const found: MessageQueueBrokerMetricStatus | undefined = status.metrics.find(
    (metric: MessageQueueBrokerMetricStatus): boolean => {
      return metric.descriptor.metricName === name;
    },
  );
  if (!found) {
    throw new Error(`no status for ${name}`);
  }
  return found;
}

function verdictOf(
  status: MessageQueueBrokerMetricsStatus,
  name: string,
): [MessageQueueBrokerMetricState, string | null] {
  const metric: MessageQueueBrokerMetricStatus = metricOf(status, name);
  return [metric.state, metric.reason];
}

function namesOf(
  metrics: ReadonlyArray<MessageQueueBrokerMetricStatus>,
): Array<string> {
  return metrics.map((metric: MessageQueueBrokerMetricStatus): string => {
    return metric.descriptor.metricName;
  });
}

// Every word through the translator: a lookup that marks what it worded.
const MARKED: Translator = createTranslator((key: string): string => {
  return `«${key}»`;
}, "en");

describe("which metrics a broker reports every period", () => {
  test("a level is; a count, a latency, a counter or a lag is not", () => {
    for (const name of [ACTIVE, DEAD_LETTERED, SCHEDULED, SIZE]) {
      expect({
        name,
        everyPeriod: isMessageQueueMetricReportedEveryPeriod(
          descriptorOf(SERVICE_BUS, name),
        ),
      }).toEqual({ name, everyPeriod: true });
    }
    for (const name of [INCOMING, THROTTLED, SEND_LATENCY]) {
      expect({
        name,
        everyPeriod: isMessageQueueMetricReportedEveryPeriod(
          descriptorOf(SERVICE_BUS, name),
        ),
      }).toEqual({ name, everyPeriod: false });
    }
    // A Pub/Sub count of dead-lettered messages has points only with some.
    expect(
      isMessageQueueMetricReportedEveryPeriod(
        descriptorOf(
          PUBSUB,
          "pubsub.googleapis.com/subscription/dead_letter_message_count",
        ),
      ),
    ).toBe(false);
    // Kafka reports a group's lag only once the group has committed.
    for (const descriptor of KAFKA) {
      expect({
        name: descriptor.metricName,
        everyPeriod: isMessageQueueMetricReportedEveryPeriod(descriptor),
      }).toEqual({ name: descriptor.metricName, everyPeriod: false });
    }
  });

  test("every Service Bus level the page charts has its configuration line", () => {
    const status: MessageQueueBrokerMetricsStatus = statusOf({});
    for (const metric of status.metrics) {
      expect(metric.configLine).not.toBeNull();
    }
    expect(metricOf(status, SCHEDULED).configLine).toBe(
      "ScheduledMessages: [Average]",
    );
    expect(metricOf(status, SIZE).configLine).toBe("Size: [Average]");
    expect(metricOf(status, SEND_LATENCY).configLine).toBe(
      "ServerSendLatency: [Average]",
    );
    // A system read some other way has none.
    for (const metric of statusOf({
      messagingSystem: "kafka",
      catalog: KAFKA,
    }).metrics) {
      expect(metric.configLine).toBeNull();
    }
  });
});

describe("each metric's verdict", () => {
  test("all arriving: the set is arriving, its newest point its last", () => {
    const status: MessageQueueBrokerMetricsStatus = statusOf({
      results: SERVICE_BUS.map(
        (
          descriptor: MessageQueueMetricDescriptor,
        ): MessageQueueBrokerMetricResult => {
          return inRange(descriptor.metricName, [
            ago(20 * MINUTE_MS),
            ago(2 * MINUTE_MS),
          ]);
        },
      ),
    });
    expect(status.health).toBe("arriving");
    expect(status.arrivingCount).toBe(SERVICE_BUS.length);
    expect(status.missing).toEqual([]);
    expect(status.lastReceivedAt?.toISOString()).toBe(
      ago(2 * MINUTE_MS).toISOString(),
    );
    expect(status.knowsLookback).toBe(true);
    // One per catalog metric, in catalog order.
    expect(namesOf(status.metrics)).toEqual(
      SERVICE_BUS.map((descriptor: MessageQueueMetricDescriptor): string => {
        return descriptor.metricName;
      }),
    );
    for (const metric of status.metrics) {
      expect([metric.state, metric.reason]).toEqual(["arriving", null]);
    }
  });

  test("a level that never arrived while others do is not collected; a quiet count has nothing to report", () => {
    // Incoming messages reported as 0: nothing was sent.
    const status: MessageQueueBrokerMetricsStatus = statusOf({
      results: [inRange(ACTIVE), quietInRange(INCOMING)],
    });
    expect(status.health).toBe("incomplete");
    expect(status.arrivingCount).toBe(2);
    expect(verdictOf(status, ACTIVE)).toEqual(["arriving", null]);
    expect(verdictOf(status, DEAD_LETTERED)).toEqual([
      "notCollected",
      "notRequested",
    ]);
    expect(verdictOf(status, SCHEDULED)).toEqual([
      "notCollected",
      "notRequested",
    ]);
    expect(verdictOf(status, SIZE)).toEqual(["notCollected", "notRequested"]);
    expect(verdictOf(status, THROTTLED)).toEqual([
      "nothingToReport",
      "onlyWithActivity",
    ]);
    expect(verdictOf(status, SEND_LATENCY)).toEqual([
      "nothingToReport",
      "onlyWithActivity",
    ]);
    expect(metricOf(status, THROTTLED).lastArrivedAt).toBeNull();
    // Missing: the levels alone, in catalog order.
    expect(namesOf(status.missing)).toEqual([DEAD_LETTERED, SCHEDULED, SIZE]);
  });

  test("a send's latency that never arrived while sends did is not collected", () => {
    // Messages came in: Service Bus reported a latency with each send.
    const sent: MessageQueueBrokerMetricsStatus = statusOf({
      results: [inRange(ACTIVE), inRange(INCOMING)],
    });
    expect(
      isMessageQueueMetricReportedWithEverySend(
        descriptorOf(SERVICE_BUS, SEND_LATENCY),
      ),
    ).toBe(true);
    expect(verdictOf(sent, SEND_LATENCY)).toEqual([
      "notCollected",
      "reportedWithSends",
    ]);
    expect(namesOf(sent.missing)).toEqual([
      DEAD_LETTERED,
      SCHEDULED,
      SIZE,
      SEND_LATENCY,
    ]);
    // Throttled requests come with no send: still nothing to report.
    expect(verdictOf(sent, THROTTLED)).toEqual([
      "nothingToReport",
      "onlyWithActivity",
    ]);
    expect(
      getMessageQueueBrokerMetricStatusLine(metricOf(sent, SEND_LATENCY), {
        messagingSystem: "servicebus",
        now: NOW,
      }),
    ).toBe(
      "Azure Service Bus reports it with every send, and sends to this queue arrived in the selected range, so your collector most likely does not ask for it: add `ServerSendLatency: [Average]` to its metrics list.",
    );
    expect(
      getMessageQueueBrokerMetricStatusLine(
        { ...metricOf(sent, SEND_LATENCY), configLine: null },
        { messagingSystem: "servicebus", now: NOW },
      ),
    ).toBe(
      "Azure Service Bus reports it with every send, and sends to this queue arrived in the selected range, so it is most likely not collected.",
    );

    // No send in the range (none, or a count of 0): nothing to report.
    for (const results of [
      [inRange(ACTIVE)],
      [inRange(ACTIVE), quietInRange(INCOMING)],
    ]) {
      expect(verdictOf(statusOf({ results }), SEND_LATENCY)).toEqual([
        "nothingToReport",
        "onlyWithActivity",
      ]);
    }
    // It arrived in the week: when, as for any count.
    expect(
      verdictOf(
        statusOf({
          results: [inRange(ACTIVE), inRange(INCOMING)],
          arrivals: arrivalsOf({ [SEND_LATENCY]: ago(DAY_MS) }),
        }),
        SEND_LATENCY,
      ),
    ).toEqual(["nothingToReport", "onlyWithActivity"]);
    // Only a latency comes with every send.
    for (const name of [ACTIVE, SIZE, INCOMING, THROTTLED]) {
      expect({
        name,
        withEverySend: isMessageQueueMetricReportedWithEverySend(
          descriptorOf(SERVICE_BUS, name),
        ),
      }).toEqual({ name, withEverySend: false });
    }
  });

  test("a level that arrived before and not since stopped; a count that did has nothing to report", () => {
    const status: MessageQueueBrokerMetricsStatus = statusOf({
      results: [inRange(ACTIVE), inRange(INCOMING)],
      arrivals: arrivalsOf({
        [ACTIVE]: ago(2 * MINUTE_MS),
        [DEAD_LETTERED]: ago(2 * DAY_MS),
        [SCHEDULED]: ago(2 * DAY_MS),
        [SIZE]: ago(2 * DAY_MS),
        [THROTTLED]: ago(DAY_MS),
        [SEND_LATENCY]: ago(DAY_MS),
      }),
    });
    expect(verdictOf(status, DEAD_LETTERED)).toEqual([
      "stopped",
      "stoppedWhileOthersArrive",
    ]);
    expect(metricOf(status, DEAD_LETTERED).lastArrivedAt?.toISOString()).toBe(
      ago(2 * DAY_MS).toISOString(),
    );
    expect(verdictOf(status, THROTTLED)).toEqual([
      "nothingToReport",
      "onlyWithActivity",
    ]);
    expect(metricOf(status, THROTTLED).lastArrivedAt?.toISOString()).toBe(
      ago(DAY_MS).toISOString(),
    );
    expect(namesOf(status.missing)).toEqual([DEAD_LETTERED, SCHEDULED, SIZE]);
    expect(status.health).toBe("incomplete");
    // The newer of the range's newest point and the week's arrival.
    expect(metricOf(status, ACTIVE).lastArrivedAt?.toISOString()).toBe(
      ago(2 * MINUTE_MS).toISOString(),
    );
  });

  test("a level that last arrived within the late window is not stopped", () => {
    const late: number = MESSAGE_QUEUE_BROKER_METRIC_LATE_MINUTES * MINUTE_MS;
    expect(MESSAGE_QUEUE_BROKER_METRIC_LATE_MINUTES).toBe(30);
    const status: MessageQueueBrokerMetricsStatus = statusOf({
      results: [inRange(ACTIVE)],
      arrivals: arrivalsOf({
        [DEAD_LETTERED]: ago(late - MINUTE_MS),
        [SCHEDULED]: ago(late),
        [SIZE]: ago(late + MINUTE_MS),
      }),
    });
    expect(verdictOf(status, DEAD_LETTERED)).toEqual(["notInRange", null]);
    expect(verdictOf(status, SCHEDULED)).toEqual(["notInRange", null]);
    expect(verdictOf(status, SIZE)).toEqual([
      "stopped",
      "stoppedWhileOthersArrive",
    ]);
    expect(namesOf(status.missing)).toEqual([SIZE]);
  });

  test("a level its receiver leaves off is not collected for that reason; an idle count that is off by default is not missing", () => {
    const backlog: string =
      "pubsub.googleapis.com/subscription/num_undelivered_messages";
    const age: string =
      "pubsub.googleapis.com/subscription/oldest_unacked_message_age";
    const acked: string =
      "pubsub.googleapis.com/subscription/ack_message_count";
    expect(descriptorOf(PUBSUB, age).enabledByDefault).toBe(false);
    expect(descriptorOf(PUBSUB, acked).enabledByDefault).toBe(false);
    const status: MessageQueueBrokerMetricsStatus = statusOf({
      messagingSystem: "gcp_pubsub",
      catalog: PUBSUB,
      results: [inRange(backlog, undefined, PUBSUB)],
    });
    expect(verdictOf(status, age)).toEqual(["notCollected", "offByDefault"]);
    expect(verdictOf(status, acked)).toEqual([
      "nothingToReport",
      "onlyWithActivity",
    ]);
    expect(namesOf(status.missing)).toEqual([age]);
  });

  test("without the week's arrivals, nothing outside the range is claimed", () => {
    const status: MessageQueueBrokerMetricsStatus = statusOf({
      results: [inRange(ACTIVE), inRange(INCOMING)],
      arrivals: null,
    });
    expect(status.knowsLookback).toBe(false);
    expect(verdictOf(status, SIZE)).toEqual(["notInRange", null]);
    expect(verdictOf(status, THROTTLED)).toEqual(["notInRange", null]);
    expect(status.missing).toEqual([]);
    expect(status.health).toBe("arriving");
  });

  test("nothing in the range: each metric says not received, and the set says why once", () => {
    // Metrics arrived before the range, none since: stopped.
    const stopped: MessageQueueBrokerMetricsStatus = statusOf({
      arrivals: arrivalsOf({
        [ACTIVE]: ago(2 * DAY_MS),
        [SIZE]: ago(3 * DAY_MS),
      }),
    });
    expect(stopped.health).toBe("stopped");
    expect(stopped.lastReceivedAt?.toISOString()).toBe(
      ago(2 * DAY_MS).toISOString(),
    );
    expect(stopped.arrivingCount).toBe(0);
    for (const metric of stopped.metrics) {
      expect(metric.state).toBe("notReceived");
    }
    // Not listed as missing one by one: the card says it once.
    expect(stopped.missing).toEqual([]);

    // Nothing in the week either, but discovery saw some: stopped since then.
    const seen: MessageQueueBrokerMetricsStatus = statusOf({
      brokerMetricsLastSeenAt: ago(10 * DAY_MS),
    });
    expect(seen.health).toBe("stopped");
    expect(seen.lastReceivedAt?.toISOString()).toBe(
      ago(10 * DAY_MS).toISOString(),
    );
    // A read that failed and discovery's sighting: still stopped.
    expect(
      statusOf({ arrivals: null, brokerMetricsLastSeenAt: ago(DAY_MS) }).health,
    ).toBe("stopped");

    // Nothing, ever.
    const never: MessageQueueBrokerMetricsStatus = statusOf({});
    expect(never.health).toBe("never");
    expect(never.lastReceivedAt).toBeNull();
    expect(statusOf({ arrivals: null }).health).toBe("never");

    // A range in the past, with metrics after it: not in this range.
    const past: MessageQueueBrokerMetricsStatus = statusOf({
      window: { start: ago(3 * DAY_MS), end: ago(2 * DAY_MS) },
      arrivals: arrivalsOf({ [ACTIVE]: ago(MINUTE_MS) }),
    });
    expect(past.health).toBe("notInRange");
    // At the present, a last arrival within the late window is the same.
    expect(
      statusOf({ arrivals: arrivalsOf({ [ACTIVE]: ago(10 * MINUTE_MS) }) })
        .health,
    ).toBe("notInRange");
  });

  test("the system is read in any spelling it has", () => {
    for (const messagingSystem of [" ServiceBus ", "azure.servicebus"]) {
      const status: MessageQueueBrokerMetricsStatus = statusOf({
        messagingSystem,
        results: [inRange(ACTIVE)],
        arrivals: arrivalsOf({ [SIZE]: ago(2 * DAY_MS) }),
      });
      expect(verdictOf(status, SIZE)).toEqual([
        "stopped",
        "stoppedWhileOthersArrive",
      ]);
      // The configuration line, by the canonical system.
      expect(metricOf(status, SIZE).configLine).toBe("Size: [Average]");
    }
  });
});

describe("whether to read what the namespace sends", () => {
  test("only while nothing arrives for a reason other than the range, for a namespace-scoped system and a queue that has one", () => {
    for (const health of ["never", "stopped"] as const) {
      expect(
        shouldReadMessageQueueNamespace({
          status: { health },
          catalog: SERVICE_BUS,
          namespace: "orders-ns",
        }),
      ).toBe(true);
    }
    for (const health of ["arriving", "incomplete", "notInRange"] as const) {
      expect(
        shouldReadMessageQueueNamespace({
          status: { health },
          catalog: SERVICE_BUS,
          namespace: "orders-ns",
        }),
      ).toBe(false);
    }
    for (const namespace of ["", "  ", null, undefined]) {
      expect(
        shouldReadMessageQueueNamespace({
          status: { health: "never" },
          catalog: SERVICE_BUS,
          namespace,
        }),
      ).toBe(false);
    }
    // Kafka's catalog names no scope on its metrics.
    expect(
      shouldReadMessageQueueNamespace({
        status: { health: "never" },
        catalog: KAFKA,
        namespace: "orders-ns",
      }),
    ).toBe(false);
    // Every catalog with a scope key is an Azure namespace's.
    const scoped: Set<string> = new Set<string>(
      MESSAGE_QUEUE_METRICS.filter(
        (descriptor: MessageQueueMetricDescriptor): boolean => {
          return (descriptor.scopeAttributes || []).length > 0;
        },
      ).map((descriptor: MessageQueueMetricDescriptor): string => {
        return descriptor.system;
      }),
    );
    expect([...scoped].sort()).toEqual(["eventhubs", "servicebus"]);
  });
});

describe("what the namespace's series say", () => {
  function series(
    namespace: string,
    entity: string,
    fromCloudConnection: boolean = false,
  ): MessageQueueNamespaceSeries {
    return { namespace, entity, fromCloudConnection };
  }

  function findingOf(
    found: ReadonlyArray<MessageQueueNamespaceSeries> | null,
    isComplete: boolean = true,
  ): MessageQueueNamespaceFinding | null {
    return getMessageQueueNamespaceFinding({
      namespace: "orders-ns",
      destination: "orders",
      series: found,
      isComplete,
    });
  }

  test("nothing of the namespace, on a whole answer: nothing comes from it", () => {
    expect(findingOf([])).toEqual({
      kind: "nothingFromNamespace",
      namespace: "orders-ns",
    });
    // A loose server match of another namespace is not this one.
    expect(findingOf([series("orders-ns-test", "orders")])).toEqual({
      kind: "nothingFromNamespace",
      namespace: "orders-ns",
    });
    // An answer cut off proves nothing.
    expect(findingOf([], false)).toBeNull();
    // No read: nothing to say.
    expect(findingOf(null)).toBeNull();
    expect(
      getMessageQueueNamespaceFinding({
        namespace: "",
        destination: "orders",
        series: [],
        isComplete: true,
      }),
    ).toBeNull();
  });

  test("other queues and topics only: counted once each, in any case", () => {
    expect(
      findingOf([
        series("Orders-NS", "invoices"),
        series("orders-ns", "Invoices"),
        series("orders-ns", "payments"),
      ]),
    ).toEqual({
      kind: "otherEntitiesOnly",
      namespace: "orders-ns",
      entityCount: 2,
    });
    // Others beside totals: the cap left the queue out, whatever else came.
    expect(
      findingOf([
        series("orders-ns", "invoices"),
        series("orders-ns", "", true),
      ]),
    ).toEqual({
      kind: "otherEntitiesOnly",
      namespace: "orders-ns",
      entityCount: 1,
    });
  });

  test("totals only: a cloud connection's, a diagnostic setting's, or the namespace-level operations", () => {
    expect(findingOf([series("orders-ns", "", true)])).toEqual({
      kind: "namespaceTotalsOnly",
      namespace: "orders-ns",
      fromCloudConnection: true,
    });
    expect(findingOf([series("orders-ns", "")])).toEqual({
      kind: "namespaceTotalsOnly",
      namespace: "orders-ns",
      fromCloudConnection: false,
    });
    // Azure's entity value for a namespace-level operation is no queue.
    expect(findingOf([series("orders-ns", "-NamespaceOnlyMetric-")])).toEqual({
      kind: "namespaceTotalsOnly",
      namespace: "orders-ns",
      fromCloudConnection: false,
    });
  });

  test("a series naming this very queue would have reached it: nothing to say", () => {
    expect(findingOf([series("orders-ns", "Orders")])).toBeNull();
    // Neither "totals only" nor "other queues only", whatever came beside it.
    expect(
      findingOf([series("orders-ns", "orders"), series("orders-ns", "", true)]),
    ).toBeNull();
    expect(
      findingOf([
        series("orders-ns", "invoices"),
        series("orders-ns", "orders"),
      ]),
    ).toBeNull();
  });
});

describe("the card's words", () => {
  test("each state and each health has its badge", () => {
    expect(
      (
        [
          "arriving",
          "nothingToReport",
          "notCollected",
          "stopped",
          "notReceived",
          "notInRange",
        ] as Array<MessageQueueBrokerMetricState>
      ).map((state: MessageQueueBrokerMetricState): string => {
        return getMessageQueueBrokerMetricStateLabel(state);
      }),
    ).toEqual([
      "Arriving",
      "Nothing to report",
      "Not collected",
      "Stopped",
      "Not received",
      "Not in this range",
    ]);
    const missing: Array<MessageQueueBrokerMetricStatus> = statusOf({
      results: [inRange(ACTIVE)],
    }).missing;
    expect(
      getMessageQueueBrokerMetricsHealthLabel({
        health: "incomplete",
        missing,
      }),
    ).toBe("3 missing");
    expect(
      getMessageQueueBrokerMetricsHealthLabel({
        health: "incomplete",
        missing: missing.slice(0, 1),
      }),
    ).toBe("1 missing");
    for (const [health, label] of [
      ["arriving", "Arriving"],
      ["stopped", "Stopped"],
      ["notInRange", "Not in this range"],
      ["never", "None yet"],
    ] as const) {
      expect(
        getMessageQueueBrokerMetricsHealthLabel({ health, missing: [] }),
      ).toBe(label);
    }
  });

  test("each metric's line says why it shows what it shows", () => {
    const line: (
      status: MessageQueueBrokerMetricsStatus,
      name: string,
    ) => string | null = (
      status: MessageQueueBrokerMetricsStatus,
      name: string,
    ): string | null => {
      return getMessageQueueBrokerMetricStatusLine(metricOf(status, name), {
        messagingSystem: "servicebus",
        now: NOW,
      });
    };
    const quiet: MessageQueueBrokerMetricsStatus = statusOf({
      results: [inRange(ACTIVE)],
      arrivals: arrivalsOf({
        [THROTTLED]: ago(DAY_MS),
        [SIZE]: ago(2 * DAY_MS),
      }),
    });
    expect(line(quiet, ACTIVE)).toBeNull();
    expect(line(quiet, SCHEDULED)).toBe(
      "Azure Service Bus reports it every minute, so your collector most likely does not ask for it: add `ScheduledMessages: [Average]` to its metrics list.",
    );
    expect(line(quiet, THROTTLED)).toBe(
      `Reported only for periods with activity. It last arrived ${OneUptimeDate.fromNow(ago(DAY_MS), NOW)}.`,
    );
    expect(line(quiet, INCOMING)).toBe(
      "Reported only for periods with activity, and there was none in the last 7 days.",
    );
    expect(line(quiet, SIZE)).toBe(
      `It stopped arriving ${OneUptimeDate.fromNow(ago(2 * DAY_MS), NOW)}, while the other metrics still arrive.`,
    );

    // A level of a system the guide has no lines for.
    const offList: MessageQueueBrokerMetricStatus = {
      ...metricOf(quiet, SCHEDULED),
      configLine: null,
    };
    expect(
      getMessageQueueBrokerMetricStatusLine(offList, {
        messagingSystem: "servicebus",
        now: NOW,
      }),
    ).toBe(
      "Azure Service Bus reports it all the time, so it is most likely not collected.",
    );

    const pubsub: MessageQueueBrokerMetricsStatus = statusOf({
      messagingSystem: "gcp_pubsub",
      catalog: PUBSUB,
      results: [
        inRange(
          "pubsub.googleapis.com/subscription/num_undelivered_messages",
          undefined,
          PUBSUB,
        ),
      ],
    });
    expect(
      getMessageQueueBrokerMetricStatusLine(
        metricOf(
          pubsub,
          "pubsub.googleapis.com/subscription/oldest_unacked_message_age",
        ),
        { messagingSystem: "gcp_pubsub", now: NOW },
      ),
    ).toBe(
      "The `googlecloudmonitoring` receiver leaves it off unless its configuration turns it on.",
    );

    // Late, or after a past range: when it last arrived.
    const late: MessageQueueBrokerMetricsStatus = statusOf({
      results: [inRange(ACTIVE)],
      arrivals: arrivalsOf({ [SIZE]: ago(10 * MINUTE_MS) }),
    });
    expect(line(late, SIZE)).toBe(
      `It last arrived ${OneUptimeDate.fromNow(ago(10 * MINUTE_MS), NOW)}.`,
    );
    // Nothing received at all: the card says it once, not on every row.
    expect(line(statusOf({}), SIZE)).toBeNull();
  });

  test("the summary and the last received line", () => {
    const some: MessageQueueBrokerMetricsStatus = statusOf({
      results: [inRange(ACTIVE), inRange(INCOMING)],
    });
    expect(getMessageQueueBrokerMetricsSummary(some)).toBe(
      "2 of 12 metrics arrived in the selected range.",
    );
    expect(
      getMessageQueueBrokerMetricsSummary({
        health: "arriving",
        metrics: some.metrics.slice(0, 1),
        arrivingCount: 1,
      }),
    ).toBe("1 of 1 metric arrived in the selected range.");
    expect(
      getMessageQueueBrokerMetricsSummary({ ...some, health: "stopped" }),
    ).toBe("No metric arrived in the selected range, and none has since.");
    expect(
      getMessageQueueBrokerMetricsSummary({ ...some, health: "notInRange" }),
    ).toBe("No metric arrived in the selected range, but newer ones have.");
    expect(
      getMessageQueueBrokerMetricsSummary({ ...some, health: "never" }),
    ).toBe("No metric has arrived for this queue yet.");

    expect(
      getMessageQueueBrokerMetricsLastReceived(
        { lastReceivedAt: ago(5 * MINUTE_MS) },
        NOW,
      ),
    ).toBe(`Last received ${OneUptimeDate.fromNow(ago(5 * MINUTE_MS), NOW)}`);
    expect(
      getMessageQueueBrokerMetricsLastReceived({ lastReceivedAt: null }, NOW),
    ).toBeNull();
  });

  test("every number in a line is written the reader's way", () => {
    // A Persian reader: the count, how many arrived and the days alike.
    const persian: Translator = createTranslator((key: string): string => {
      return `«${key}»`;
    }, "fa");
    const some: MessageQueueBrokerMetricsStatus = statusOf({
      results: [inRange(ACTIVE), inRange(INCOMING)],
    });
    expect(getMessageQueueBrokerMetricsSummary(some, persian)).toBe(
      "«۲ of ۱۲ metrics arrived in the selected range.»",
    );
    expect(
      getMessageQueueBrokerMetricStatusLine(
        metricOf(some, THROTTLED),
        { messagingSystem: "servicebus", now: NOW },
        persian,
      ),
    ).toBe(
      "«Reported only for periods with activity, and there was none in the last ۷ days.»",
    );
  });
});

describe("the card's findings", () => {
  test("missing Service Bus metrics: which, and the lines that collect them", () => {
    /*
     * A collector whose list predates Scheduled messages, Size and Server
     * send latency, with Dead-lettered messages stopped too.
     */
    const status: MessageQueueBrokerMetricsStatus = statusOf({
      results: [inRange(ACTIVE), inRange(INCOMING)],
      arrivals: arrivalsOf({ [DEAD_LETTERED]: ago(2 * DAY_MS) }),
    });
    const finding: MessageQueueBrokerMetricsFinding | null =
      getMessageQueueMissingMetricsFinding(status, "servicebus");
    expect(finding).toEqual({
      kind: "missing",
      title: "4 metrics do not arrive",
      description:
        "Azure Service Bus would have reported these in the selected range, and this queue's other metrics arrive, so they are most likely not collected: Dead-lettered messages, Scheduled messages, Size, Server send latency.",
      steps: [
        "Add the lines below to the `azure_monitor` receiver's `metrics` list, under the namespace type, and restart the collector.",
      ],
      configLines: [
        "DeadletteredMessages: [Average]",
        "ScheduledMessages: [Average]",
        "Size: [Average]",
        "ServerSendLatency: [Average]",
      ],
    });
    expect(
      getMessageQueueMissingMetricsFinding(
        { missing: status.missing.slice(0, 1) },
        "servicebus",
      )?.title,
    ).toBe("1 metric does not arrive");
    // Nothing missing, no finding.
    expect(
      getMessageQueueMissingMetricsFinding({ missing: [] }, "servicebus"),
    ).toBeNull();
  });

  test("missing levels without lines: the step names what reads them", () => {
    const pubsub: MessageQueueBrokerMetricsStatus = statusOf({
      messagingSystem: "gcp_pubsub",
      catalog: PUBSUB,
      results: [
        inRange(
          "pubsub.googleapis.com/subscription/num_undelivered_messages",
          undefined,
          PUBSUB,
        ),
      ],
    });
    const receiver: MessageQueueBrokerMetricsFinding | null =
      getMessageQueueMissingMetricsFinding(pubsub, "gcp_pubsub");
    expect(receiver?.steps).toEqual([
      "Check that the collector's `googlecloudmonitoring` configuration collects them: the Google Cloud Pub/Sub section of the Queues guide lists what each needs.",
    ]);
    expect(receiver?.configLines).toEqual([]);

    // A program outside the collector reads ActiveMQ's.
    expect(
      getMessageQueueMissingMetricsFinding(pubsub, "activemq")?.steps,
    ).toEqual([
      "Check that the OpenTelemetry JMX Scraper's configuration collects them: the Apache ActiveMQ section of the Queues guide lists what each needs.",
    ]);
    // Nothing ready-made reads an unknown system's: no step to give.
    expect(
      getMessageQueueMissingMetricsFinding(pubsub, "something-else")?.steps,
    ).toEqual([]);
  });

  test("stopped: when, and what to look at, by what reads the metrics", () => {
    const status: Pick<
      MessageQueueBrokerMetricsStatus,
      "health" | "lastReceivedAt"
    > = { health: "stopped", lastReceivedAt: ago(2 * DAY_MS) };
    const finding: MessageQueueBrokerMetricsFinding | null =
      getMessageQueueStoppedMetricsFinding(status, "servicebus", NOW);
    expect(finding).toEqual({
      kind: "stopped",
      title: `Broker metrics stopped arriving ${OneUptimeDate.fromNow(ago(2 * DAY_MS), NOW)}`,
      description:
        "This queue's metrics arrived before and none has since: what sends them stopped, or its reads fail.",
      steps: [
        "Check that the collector running the `azure_monitor` receiver is up, and look in its log for errors: an expired credential or a removed permission stops every read.",
      ],
      configLines: [],
    });
    expect(
      getMessageQueueStoppedMetricsFinding(status, "activemq", NOW)?.steps,
    ).toEqual([
      "Check that the OpenTelemetry JMX Scraper that reports this queue's metrics is still running, and look in its log for errors.",
    ]);
    expect(
      getMessageQueueStoppedMetricsFinding(status, "something-else", NOW)
        ?.steps,
    ).toEqual([
      "Check that what reports this queue's metrics is still running, and look in its log for errors.",
    ]);
    // Only for a set that stopped.
    for (const health of [
      "arriving",
      "incomplete",
      "notInRange",
      "never",
    ] as const) {
      expect(
        getMessageQueueStoppedMetricsFinding(
          { health, lastReceivedAt: ago(DAY_MS) },
          "servicebus",
          NOW,
        ),
      ).toBeNull();
    }
    expect(
      getMessageQueueStoppedMetricsFinding(
        { health: "stopped", lastReceivedAt: null },
        "servicebus",
        NOW,
      ),
    ).toBeNull();
  });

  test("the namespace findings: the permission, the totals, the cap", () => {
    const nothing: MessageQueueBrokerMetricsFinding =
      getMessageQueueNamespaceFindingWords(
        { kind: "nothingFromNamespace", namespace: "orders-ns" },
        "servicebus",
      );
    expect(nothing.title).toBe(
      "Nothing from namespace orders-ns reaches OneUptime",
    );
    expect(nothing.description).toContain("No Azure Service Bus metric");
    expect(nothing.steps.join(" ")).toContain("Monitoring Reader role");
    expect(nothing.steps.join(" ")).toContain("`AuthorizationFailed` or `401`");

    const cloud: MessageQueueBrokerMetricsFinding =
      getMessageQueueNamespaceFindingWords(
        {
          kind: "namespaceTotalsOnly",
          namespace: "orders-ns",
          fromCloudConnection: true,
        },
        "servicebus",
      );
    expect(cloud.title).toBe("Namespace orders-ns reports totals only");
    expect(cloud.description).toContain("Your Azure cloud connection");
    const exported: MessageQueueBrokerMetricsFinding =
      getMessageQueueNamespaceFindingWords(
        {
          kind: "namespaceTotalsOnly",
          namespace: "orders-ns",
          fromCloudConnection: false,
        },
        "servicebus",
      );
    expect(exported.description).toContain("diagnostic settings");
    expect(exported.steps[0]).toContain("`azure_monitor` receiver too");

    const others: MessageQueueBrokerMetricsFinding =
      getMessageQueueNamespaceFindingWords(
        { kind: "otherEntitiesOnly", namespace: "orders-ns", entityCount: 12 },
        "servicebus",
      );
    expect(others.title).toBe(
      "Metrics arrive for 12 other queues and topics of orders-ns, not this one",
    );
    expect(
      getMessageQueueNamespaceFindingWords(
        { kind: "otherEntitiesOnly", namespace: "orders-ns", entityCount: 1 },
        "servicebus",
      ).title,
    ).toBe(
      "Metrics arrive for 1 other queue or topic of orders-ns, not this one",
    );
    expect(others.steps[0]).toContain(
      "`maximum_number_of_records_per_resource`",
    );
    for (const finding of [nothing, cloud, exported, others]) {
      expect(finding.configLines).toEqual([]);
    }
  });

  test("every word goes through the reader's translator", () => {
    const status: MessageQueueBrokerMetricsStatus = statusOf({
      results: [inRange(ACTIVE)],
      arrivals: arrivalsOf({ [SIZE]: ago(2 * DAY_MS) }),
    });
    const worded: Array<string> = [
      getMessageQueueBrokerMetricStateLabel("notCollected", MARKED),
      getMessageQueueBrokerMetricsHealthLabel(status, MARKED),
      getMessageQueueBrokerMetricsSummary(status, MARKED),
      String(
        getMessageQueueBrokerMetricStatusLine(
          metricOf(status, SIZE),
          { messagingSystem: "servicebus", now: NOW },
          MARKED,
        ),
      ),
      String(getMessageQueueBrokerMetricsLastReceived(status, NOW, MARKED)),
    ];
    const missing: MessageQueueBrokerMetricsFinding | null =
      getMessageQueueMissingMetricsFinding(status, "servicebus", MARKED);
    const stopped: MessageQueueBrokerMetricsFinding | null =
      getMessageQueueStoppedMetricsFinding(
        { health: "stopped", lastReceivedAt: ago(DAY_MS) },
        "servicebus",
        NOW,
        MARKED,
      );
    for (const finding of [
      missing,
      stopped,
      ...(
        [
          { kind: "nothingFromNamespace", namespace: "orders-ns" },
          {
            kind: "namespaceTotalsOnly",
            namespace: "orders-ns",
            fromCloudConnection: true,
          },
          {
            kind: "namespaceTotalsOnly",
            namespace: "orders-ns",
            fromCloudConnection: false,
          },
          { kind: "otherEntitiesOnly", namespace: "orders-ns", entityCount: 3 },
        ] as Array<MessageQueueNamespaceFinding>
      ).map(
        (
          namespaceFinding: MessageQueueNamespaceFinding,
        ): MessageQueueBrokerMetricsFinding => {
          return getMessageQueueNamespaceFindingWords(
            namespaceFinding,
            "servicebus",
            MARKED,
          );
        },
      ),
    ]) {
      expect(finding).not.toBeNull();
      worded.push(finding!.title, finding!.description, ...finding!.steps);
    }
    for (const words of worded) {
      expect({ words, marked: words.startsWith("«") }).toEqual({
        words,
        marked: true,
      });
    }
    // The configuration lines are configuration: never translated.
    expect(missing?.configLines).toEqual([
      "DeadletteredMessages: [Average]",
      "ScheduledMessages: [Average]",
      "Size: [Average]",
    ]);
  });
});

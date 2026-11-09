import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * THE BROKER METRICS CARD (MessageQueueBrokerMetricsCard), drawn from a
 * status MessageQueueBrokerMetricsStatus worked out. What it pins:
 *
 *   - its badge and summary: how many metrics arrived, and when the newest
 *     did (relative, with the moment itself on hover);
 *   - one callout per thing to do, most specific first: what an Azure
 *     namespace sends instead (only while nothing of the queue's arrives),
 *     else the metrics that stopped; then the metrics that should arrive and
 *     do not, with the configuration lines, set left to right, and links to
 *     the queue's collector configuration and the guide's troubleshooting;
 *     a callout's one step reads as a sentence, several as numbered steps;
 *   - while none ever arrived, the section's setup guidance in place of the
 *     summary, unless a finding says why;
 *   - nothing on processing time, which no broker measures: the Overview's
 *     p95 tile and chart say what gives it;
 *   - every supported metric, folded: its state, and why or when it last
 *     arrived on a line of its own under the name and badge, the stored
 *     name left to right where the row's words start, inline code set off
 *     as code.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import MessageQueueBrokerMetricsCard, {
  BROKER_METRICS_CARD_TITLE,
  BROKER_METRICS_LIST_TITLE,
  getMessageQueueBrokerMetricsFindings,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueBrokerMetricsCard";
import {
  MessageQueueBrokerMetricsFinding,
  MessageQueueBrokerMetricsStatus,
  MessageQueueNamespaceFinding,
  getMessageQueueBrokerMetricsStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueBrokerMetricsStatus";
import {
  MessageQueueBrokerMetricResult,
  MessageQueueBrokerMetricSources,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import OneUptimeDate from "../../../Types/Date";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricsForSystem,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator } from "../../../Types/Translator";

afterEach(() => {
  cleanup();
});

const MODEL_ID: ObjectID = new ObjectID("a3e5c7d9-1b2f-4a6c-8e0d-2f4b6d8a0c1e");
const NOW: Date = new Date("2026-03-04T12:30:00.000Z");
const MINUTE_MS: number = 60 * 1000;
const DAY_MS: number = 24 * 60 * MINUTE_MS;
const SERVICE_BUS: ReadonlyArray<MessageQueueMetricDescriptor> =
  getMessageQueueMetricsForSystem("servicebus");

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function inRange(name: string): MessageQueueBrokerMetricResult {
  const descriptor: MessageQueueMetricDescriptor | undefined = SERVICE_BUS.find(
    (entry: MessageQueueMetricDescriptor): boolean => {
      return entry.metricName === name;
    },
  );
  if (!descriptor) {
    throw new Error(`no catalog metric ${name}`);
  }
  return {
    descriptor: descriptor,
    series: [{ x: ago(5 * MINUTE_MS), y: 1 }],
    value: 1,
    observedSeries: [],
  };
}

function statusOf(data: {
  results?: Array<MessageQueueBrokerMetricResult>;
  arrived?: Record<string, Date>;
  brokerMetricsLastSeenAt?: Date | null;
  // What read the queue lately; by default nothing the lookback can tell.
  sources?: MessageQueueBrokerMetricSources;
}): MessageQueueBrokerMetricsStatus {
  return getMessageQueueBrokerMetricsStatus({
    messagingSystem: "servicebus",
    catalog: SERVICE_BUS,
    results: data.results || [],
    arrivals: {
      since: ago(7 * DAY_MS),
      lastArrivedAt: new Map<string, Date>(Object.entries(data.arrived || {})),
      sources: data.sources || { connectionIds: [], fromCollector: false },
    },
    brokerMetricsLastSeenAt: data.brokerMetricsLastSeenAt ?? null,
    window: { start: ago(60 * MINUTE_MS), end: NOW },
  });
}

/*
 * Some arrive, three levels do not, and sends arrived without their
 * latency: four missing.
 */
const INCOMPLETE: MessageQueueBrokerMetricsStatus = statusOf({
  results: [
    inRange("azure_activemessages_average"),
    inRange("azure_incomingmessages_total"),
    inRange("azure_outgoingmessages_total"),
  ],
});

// Nothing in the range; something two days ago.
const STOPPED: MessageQueueBrokerMetricsStatus = statusOf({
  arrived: { azure_activemessages_average: ago(2 * DAY_MS) },
});

const NEVER: MessageQueueBrokerMetricsStatus = statusOf({});

function renderCard(props: {
  status: MessageQueueBrokerMetricsStatus;
  namespaceFinding?: MessageQueueNamespaceFinding | null;
  setupGuidance?: React.ReactElement | undefined;
  connectionNames?: Record<string, string> | undefined;
  messagingSystem?: string | undefined;
}): HTMLElement {
  render(
    <MemoryRouter>
      <MessageQueueBrokerMetricsCard
        modelId={MODEL_ID}
        messagingSystem={props.messagingSystem || "servicebus"}
        status={props.status}
        namespaceFinding={props.namespaceFinding ?? null}
        setupGuidance={props.setupGuidance}
        connectionNames={props.connectionNames}
        now={NOW}
      />
    </MemoryRouter>,
  );
  return screen.getByTestId("message-queue-broker-metrics-status");
}

// What an Azure cloud connection reads of a Service Bus queue.
const CONNECTION_READS: Array<string> = [
  "azure_activemessages_average",
  "azure_deadletteredmessages_average",
  "azure_incomingmessages_total",
  "azure_outgoingmessages_total",
  "azure_servererrors_total",
  "azure_throttledrequests_total",
];

function connectedStatus(
  sources: MessageQueueBrokerMetricSources,
): MessageQueueBrokerMetricsStatus {
  return statusOf({
    results: CONNECTION_READS.map(
      (name: string): MessageQueueBrokerMetricResult => {
        return inRange(name);
      },
    ),
    sources: sources,
  });
}

function sourceLineIn(card: HTMLElement): HTMLElement {
  return within(card).getByTestId("message-queue-broker-metrics-source");
}

function findingsIn(card: HTMLElement): Array<HTMLElement> {
  return within(card).queryAllByTestId("message-queue-broker-metrics-finding");
}

describe("the card's head", () => {
  test("its title, what it shows for the queue's system, and the set's badge", () => {
    renderCard({ status: INCOMPLETE });
    expect(screen.getByText(BROKER_METRICS_CARD_TITLE)).toBeInTheDocument();
    expect(BROKER_METRICS_CARD_TITLE).toBe("Broker metrics");
    expect(
      screen.getByText(
        "Which Azure Service Bus metrics arrive for this queue, and why any others do not.",
      ),
    ).toBeInTheDocument();
    const badge: HTMLElement = screen.getByText("4 missing");
    expect(badge.className).toContain("text-amber-800");
  });

  test("how many arrived, and when the newest did, with the moment on hover", () => {
    const card: HTMLElement = renderCard({ status: INCOMPLETE });
    expect(card).toHaveAttribute("data-health", "incomplete");
    expect(
      within(card).getByTestId("message-queue-broker-metrics-summary"),
    ).toHaveTextContent("3 of 12 metrics arrived in the selected range.");
    const last: HTMLElement = within(card).getByTestId(
      "message-queue-broker-metrics-last-received",
    );
    expect(last).toHaveTextContent(
      `Last received ${OneUptimeDate.fromNow(ago(5 * MINUTE_MS), NOW)}`,
    );
    expect(last).toHaveAttribute(
      "title",
      OneUptimeDate.getDateAsLocalFormattedString(ago(5 * MINUTE_MS)),
    );
  });

  test("each health has its badge colour", () => {
    for (const [status, label, colour] of [
      [
        statusOf({
          results: SERVICE_BUS.map(
            (
              descriptor: MessageQueueMetricDescriptor,
            ): MessageQueueBrokerMetricResult => {
              return inRange(descriptor.metricName);
            },
          ),
        }),
        "Arriving",
        "text-emerald-800",
      ],
      [STOPPED, "Stopped", "text-red-800"],
      [NEVER, "None yet", "text-gray-700"],
    ] as Array<[MessageQueueBrokerMetricsStatus, string, string]>) {
      renderCard({ status });
      const card: HTMLElement = screen.getByTestId(
        "message-queue-broker-metrics-status",
      );
      expect(card).toHaveAttribute("data-health", status.health);
      // The card's badge, beside its title.
      const badges: Array<HTMLElement> = screen.getAllByText(label);
      expect(
        badges.some((badge: HTMLElement): boolean => {
          return badge.className.includes(colour) && !card.contains(badge);
        }),
      ).toBe(true);
      cleanup();
    }
  });
});

describe("what reads the queue's metrics", () => {
  test("a cloud connection alone: its name, linked to Cloud > Connect, under the summary", () => {
    const card: HTMLElement = renderCard({
      status: connectedStatus({
        connectionIds: ["conn-a"],
        fromCollector: false,
      }),
      connectionNames: { "conn-a": "Contoso production" },
    });
    const source: HTMLElement = sourceLineIn(card);
    expect(source).toHaveTextContent(
      "Read by your cloud connection (Contoso production).",
    );
    const link: HTMLElement = within(source)
      .getByTestId("message-queue-broker-metrics-source-connections")
      .closest("a")!;
    expect(link.getAttribute("href")).toMatch(/\/cloud\/connect$/);
    expect(link).toHaveTextContent("Contoso production");
    // Under the summary and the last received line, in that order.
    const summary: HTMLElement = within(card).getByTestId(
      "message-queue-broker-metrics-summary",
    );
    expect(summary).toHaveTextContent(
      "6 of 12 metrics arrived in the selected range.",
    );
    const last: HTMLElement = within(card).getByTestId(
      "message-queue-broker-metrics-last-received",
    );
    expect(
      summary.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      last.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Nothing is missing: the badge says arriving, and no callout shows.
    expect(card).toHaveAttribute("data-health", "arriving");
    expect(findingsIn(card)).toHaveLength(0);
  });

  test("a connection whose name is not known is named by where it is", () => {
    const card: HTMLElement = renderCard({
      status: connectedStatus({
        connectionIds: ["conn-a"],
        fromCollector: false,
      }),
    });
    expect(sourceLineIn(card)).toHaveTextContent(
      "Read by your cloud connection (Cloud > Connect).",
    );
  });

  test("two connections: both names, once each", () => {
    const card: HTMLElement = renderCard({
      status: connectedStatus({
        connectionIds: ["conn-a", "conn-b", "conn-c"],
        fromCollector: false,
      }),
      connectionNames: {
        "conn-a": "Contoso production",
        "conn-b": "Fabrikam",
        // A name two connections share is said once.
        "conn-c": "Fabrikam",
      },
    });
    expect(sourceLineIn(card)).toHaveTextContent(
      "Read by your cloud connection (Contoso production, Fabrikam).",
    );
  });

  test("a collector beside the connection: the receiver as code, then the connection", () => {
    const card: HTMLElement = renderCard({
      status: connectedStatus({
        connectionIds: ["conn-a"],
        fromCollector: true,
      }),
      connectionNames: { "conn-a": "Contoso production" },
    });
    const source: HTMLElement = sourceLineIn(card);
    expect(source).toHaveTextContent(
      "Read by your collector's azure_monitor receiver and your cloud connection (Contoso production): where both read a metric, the receiver's is kept.",
    );
    const code: HTMLElement = source.querySelector("code")!;
    expect(code).toHaveTextContent("azure_monitor");
    expect(code).toHaveAttribute("dir", "ltr");
    expect(within(source).getByRole("link")).toHaveTextContent(
      "Contoso production",
    );
  });

  test("a collector alone: its receiver, and no link", () => {
    const card: HTMLElement = renderCard({
      status: connectedStatus({ connectionIds: [], fromCollector: true }),
    });
    const source: HTMLElement = sourceLineIn(card);
    expect(source).toHaveTextContent(
      "Read by your collector's azure_monitor receiver.",
    );
    expect(within(source).queryByRole("link")).toBeNull();
  });

  test("no line while the lookback cannot tell, or nothing ever arrived", () => {
    for (const status of [INCOMPLETE, STOPPED, NEVER]) {
      const card: HTMLElement = renderCard({ status });
      expect(
        within(card).queryByTestId("message-queue-broker-metrics-source"),
      ).toBeNull();
      cleanup();
    }
  });

  test("what the connection does not read: Collector only, a quiet badge, and the line that adds it", () => {
    const card: HTMLElement = renderCard({
      status: connectedStatus({
        connectionIds: ["conn-a"],
        fromCollector: false,
      }),
    });
    const row: HTMLElement = within(card)
      .getAllByTestId("message-queue-broker-metric-status")
      .find((element: HTMLElement): boolean => {
        return (
          element
            .getAttribute("data-metric-id")
            ?.includes("azure_scheduledmessages_average") || false
        );
      })!;
    expect(row).toHaveAttribute("data-state", "collectorOnly");
    expect(row).toHaveAttribute("data-reason", "notReadByConnection");
    const badge: HTMLElement = within(row).getByText("Collector only");
    expect(badge.className).toContain("text-gray-700");
    const line: HTMLElement = within(row).getByTestId(
      "message-queue-broker-metric-status-line",
    );
    expect(line).toHaveTextContent(
      "Your cloud connection does not read it. The collector's azure_monitor receiver can: add ScheduledMessages: [Average] to its metrics list.",
    );
    expect(
      Array.from(line.querySelectorAll("code")).map(
        (code: HTMLElement): string => {
          return code.textContent || "";
        },
      ),
    ).toEqual(["azure_monitor", "ScheduledMessages: [Average]"]);
  });

  test("a level the connection reads that never arrives: its last read is what to look at", () => {
    const card: HTMLElement = renderCard({
      status: statusOf({
        results: [inRange("azure_incomingmessages_total")],
        sources: { connectionIds: ["conn-a"], fromCollector: false },
      }),
    });
    const findings: Array<HTMLElement> = findingsIn(card);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toHaveAttribute("data-kind", "missing");
    expect(findings[0]).toHaveTextContent("2 metrics do not arrive");
    expect(
      within(findings[0]!).getByTestId(
        "message-queue-broker-metrics-finding-step",
      ),
    ).toHaveTextContent(
      "Open Cloud > Connect: the connection's last read says which metrics it could not read.",
    );
    // No collector configuration to add.
    expect(
      within(findings[0]!).queryByTestId(
        "message-queue-broker-metrics-finding-config",
      ),
    ).toBeNull();
  });
});

describe("what the card asks the reader to do", () => {
  test("the metrics that should arrive and do not, with the lines that collect them", () => {
    const card: HTMLElement = renderCard({ status: INCOMPLETE });
    const findings: Array<HTMLElement> = findingsIn(card);
    expect(findings).toHaveLength(1);
    const finding: HTMLElement = findings[0]!;
    expect(finding).toHaveAttribute("data-kind", "missing");
    expect(finding).toHaveTextContent("4 metrics do not arrive");
    // Levels reported every minute and a latency reported with every send.
    expect(finding).toHaveTextContent(
      "Azure Service Bus would have reported these in the selected range, and this queue's other metrics arrive, so they are most likely not collected: Dead-lettered messages, Scheduled messages, Size, Server send latency.",
    );

    /*
     * The step names the receiver and its list as code; one step is a
     * sentence, not a numbered list of one.
     */
    const step: HTMLElement = within(finding).getByTestId(
      "message-queue-broker-metrics-finding-step",
    );
    expect(step.tagName).toBe("P");
    expect(finding.querySelector("ol")).toBeNull();
    const codes: Array<string> = Array.from(step.querySelectorAll("code")).map(
      (code: HTMLElement): string => {
        return code.textContent || "";
      },
    );
    expect(codes).toEqual(["azure_monitor", "metrics"]);
    for (const code of Array.from(step.querySelectorAll("code"))) {
      expect(code).toHaveAttribute("dir", "ltr");
    }

    // Configuration as written, left to right.
    const config: HTMLElement = within(finding).getByTestId(
      "message-queue-broker-metrics-finding-config",
    );
    expect(config.tagName).toBe("PRE");
    expect(config).toHaveAttribute("dir", "ltr");
    expect(config.textContent).toBe(
      "DeadletteredMessages: [Average]\nScheduledMessages: [Average]\nSize: [Average]\nServerSendLatency: [Average]",
    );
  });

  test("the links: the queue's collector configuration, and the guide's troubleshooting in a new tab", () => {
    const card: HTMLElement = renderCard({ status: INCOMPLETE });
    const finding: HTMLElement = findingsIn(card)[0]!;
    const configuration: HTMLAnchorElement = within(finding)
      .getByText("Collector configuration for this queue →")
      .closest("a") as HTMLAnchorElement;
    expect(configuration.getAttribute("href")).toMatch(
      new RegExp(`/queues/${MODEL_ID.toString()}/documentation$`),
    );
    const troubleshooting: HTMLAnchorElement = within(finding)
      .getByText("Troubleshooting in the Queues guide →")
      .closest("a") as HTMLAnchorElement;
    expect(troubleshooting).toHaveAttribute(
      "href",
      "/docs/telemetry/queues#broker-health-stays-empty",
    );
    expect(troubleshooting).toHaveAttribute("target", "_blank");
  });

  test("metrics that stopped: when, and what to look at", () => {
    const card: HTMLElement = renderCard({ status: STOPPED });
    const findings: Array<HTMLElement> = findingsIn(card);
    expect(
      findings.map((finding: HTMLElement): string | null => {
        return finding.getAttribute("data-kind");
      }),
    ).toEqual(["stopped"]);
    expect(findings[0]).toHaveTextContent(
      `Broker metrics stopped arriving ${OneUptimeDate.fromNow(ago(2 * DAY_MS), NOW)}`,
    );
    expect(findings[0]).toHaveTextContent(
      "an expired credential or a removed permission stops every read",
    );
    expect(
      within(card).getByTestId("message-queue-broker-metrics-summary"),
    ).toHaveTextContent(
      "No metric arrived in the selected range, and none has since.",
    );
  });

  test("an Azure namespace that sends nothing to the queue: that, in place of the stopped callout", () => {
    const card: HTMLElement = renderCard({
      status: STOPPED,
      namespaceFinding: {
        kind: "nothingFromNamespace",
        namespace: "orders-ns",
      },
    });
    const findings: Array<HTMLElement> = findingsIn(card);
    expect(
      findings.map((finding: HTMLElement): string | null => {
        return finding.getAttribute("data-kind");
      }),
    ).toEqual(["nothingFromNamespace"]);
    expect(findings[0]).toHaveTextContent(
      "Nothing from namespace orders-ns reaches OneUptime",
    );
    const steps: Array<string> = within(findings[0]!)
      .getAllByTestId("message-queue-broker-metrics-finding-step")
      .map((step: HTMLElement): string => {
        return step.textContent || "";
      });
    expect(steps).toHaveLength(3);
    expect(steps[1]).toContain("Monitoring Reader role");
    expect(steps[2]).toContain("AuthorizationFailed");
    // Several steps are numbered, in order.
    for (const step of within(findings[0]!).getAllByTestId(
      "message-queue-broker-metrics-finding-step",
    )) {
      expect(step.tagName).toBe("LI");
      expect(step.parentElement!.tagName).toBe("OL");
    }
  });

  test("never: other queues of the namespace arrive, or its totals only", () => {
    const others: HTMLElement = renderCard({
      status: NEVER,
      namespaceFinding: {
        kind: "otherEntitiesOnly",
        namespace: "orders-ns",
        entityCount: 14,
        fromCloudConnection: false,
      },
    });
    expect(findingsIn(others)[0]).toHaveAttribute(
      "data-kind",
      "otherEntitiesOnly",
    );
    expect(findingsIn(others)[0]).toHaveTextContent(
      "Metrics arrive for 14 other queues and topics of orders-ns, not this one",
    );
    // Nothing ever arrived: no last received line.
    expect(
      within(others).queryByTestId(
        "message-queue-broker-metrics-last-received",
      ),
    ).toBeNull();
    cleanup();

    const totals: HTMLElement = renderCard({
      status: NEVER,
      namespaceFinding: {
        kind: "namespaceTotalsOnly",
        namespace: "orders-ns",
        fromCloudConnection: true,
      },
    });
    expect(findingsIn(totals)[0]).toHaveAttribute(
      "data-kind",
      "namespaceTotalsOnly",
    );
    expect(findingsIn(totals)[0]).toHaveTextContent(
      "Your Azure cloud connection sent only totals for the namespace as a whole",
    );
    expect(findingsIn(totals)[0]).toHaveTextContent(
      "Check the connection's last read on Cloud > Connect",
    );
    cleanup();

    // Without a namespace finding, nothing ever arrived: no callout at all.
    const plain: HTMLElement = renderCard({ status: NEVER });
    expect(findingsIn(plain)).toHaveLength(0);
    expect(
      within(plain).getByTestId("message-queue-broker-metrics-summary"),
    ).toHaveTextContent("No metric has arrived for this queue yet.");
  });

  test("never: the setup guidance in place of the summary, unless a finding says why", () => {
    const guidance: React.ReactElement = (
      <div data-testid="setup-guidance">
        No Azure Service Bus broker metric has arrived for this queue yet.
      </div>
    );

    // Nothing ever arrived, and nothing says why: how to set them up.
    const fresh: HTMLElement = renderCard({
      status: NEVER,
      setupGuidance: guidance,
    });
    expect(within(fresh).getByTestId("setup-guidance")).toBeInTheDocument();
    expect(
      within(fresh).queryByTestId("message-queue-broker-metrics-summary"),
    ).toBeNull();
    expect(findingsIn(fresh)).toHaveLength(0);
    cleanup();

    // What the namespace sends instead says more than the guidance.
    const totals: HTMLElement = renderCard({
      status: NEVER,
      namespaceFinding: {
        kind: "namespaceTotalsOnly",
        namespace: "orders-ns",
        fromCloudConnection: false,
      },
      setupGuidance: guidance,
    });
    expect(within(totals).queryByTestId("setup-guidance")).toBeNull();
    expect(
      within(totals).queryByTestId("message-queue-broker-metrics-summary"),
    ).toBeNull();
    expect(findingsIn(totals)[0]).toHaveAttribute(
      "data-kind",
      "namespaceTotalsOnly",
    );
    cleanup();

    // Once something arrived, the summary says what, and no guidance.
    for (const status of [INCOMPLETE, STOPPED]) {
      const card: HTMLElement = renderCard({ status, setupGuidance: guidance });
      expect(within(card).queryByTestId("setup-guidance")).toBeNull();
      expect(
        within(card).getByTestId("message-queue-broker-metrics-summary"),
      ).toBeInTheDocument();
      cleanup();
    }
  });

  test("a namespace finding is never drawn while the queue's own metrics arrive", () => {
    const card: HTMLElement = renderCard({
      status: INCOMPLETE,
      namespaceFinding: {
        kind: "nothingFromNamespace",
        namespace: "orders-ns",
      },
    });
    expect(
      findingsIn(card).map((finding: HTMLElement): string | null => {
        return finding.getAttribute("data-kind");
      }),
    ).toEqual(["missing"]);
  });

  test("the order, most specific first", () => {
    const translator: ReturnType<typeof createTranslator> = createTranslator(
      undefined,
      "en",
    );
    const kinds: (
      status: MessageQueueBrokerMetricsStatus,
      namespaceFinding: MessageQueueNamespaceFinding | null,
    ) => Array<string> = (
      status: MessageQueueBrokerMetricsStatus,
      namespaceFinding: MessageQueueNamespaceFinding | null,
    ): Array<string> => {
      return getMessageQueueBrokerMetricsFindings({
        status,
        namespaceFinding,
        messagingSystem: "servicebus",
        now: NOW,
        translator,
      }).map((finding: MessageQueueBrokerMetricsFinding): string => {
        return finding.kind;
      });
    };
    const nothing: MessageQueueNamespaceFinding = {
      kind: "nothingFromNamespace",
      namespace: "orders-ns",
    };
    expect(kinds(STOPPED, nothing)).toEqual(["nothingFromNamespace"]);
    expect(kinds(STOPPED, null)).toEqual(["stopped"]);
    expect(kinds(NEVER, nothing)).toEqual(["nothingFromNamespace"]);
    expect(kinds(NEVER, null)).toEqual([]);
    expect(kinds(INCOMPLETE, nothing)).toEqual(["missing"]);
    expect(kinds(INCOMPLETE, null)).toEqual(["missing"]);
  });
});

describe("processing time", () => {
  test("is not the card's to say: no broker measures it", () => {
    for (const status of [INCOMPLETE, STOPPED, NEVER]) {
      const card: HTMLElement = renderCard({ status });
      expect(card).not.toHaveTextContent(/processing time/i);
      expect(within(card).queryByText("Trace your consumers →")).toBeNull();
      cleanup();
    }
  });
});

describe("the supported metrics", () => {
  test("folded, with how many there are; every one with its state, why and when", () => {
    const card: HTMLElement = renderCard({ status: INCOMPLETE });
    expect(
      within(card).getByText(BROKER_METRICS_LIST_TITLE),
    ).toBeInTheDocument();
    expect(
      within(card).getByTestId("collapsible-section-summary"),
    ).toHaveTextContent(
      "The 12 Azure Service Bus metrics this page charts, each with its state and when it last arrived.",
    );

    const rows: Array<HTMLElement> = within(
      within(card).getByTestId("message-queue-broker-metric-statuses"),
    ).getAllByTestId("message-queue-broker-metric-status");
    expect(rows).toHaveLength(12);
    const rowOf: (id: string) => HTMLElement = (id: string): HTMLElement => {
      const row: HTMLElement | undefined = rows.find(
        (element: HTMLElement): boolean => {
          return element.getAttribute("data-metric-id") === id;
        },
      );
      if (!row) {
        throw new Error(`no row ${id}`);
      }
      return row;
    };

    const active: HTMLElement = rowOf(
      "servicebus:azure_activemessages_average",
    );
    expect(active).toHaveAttribute("data-state", "arriving");
    expect(active).toHaveAttribute("data-reason", "");
    expect(active).toHaveTextContent("Active messages");
    expect(active).toHaveTextContent("azure_activemessages_average");
    expect(within(active).getByText("Arriving").className).toContain(
      "text-emerald-800",
    );
    const arrived: HTMLElement = within(active).getByTestId(
      "message-queue-broker-metric-last-arrived",
    );
    expect(arrived).toHaveTextContent(
      `Last arrived ${OneUptimeDate.fromNow(ago(5 * MINUTE_MS), NOW)}`,
    );
    expect(arrived).toHaveAttribute(
      "title",
      OneUptimeDate.getDateAsLocalFormattedString(ago(5 * MINUTE_MS)),
    );
    /*
     * Under the name and the badge, the row's whole width: never squeezed
     * beside the badge on a phone.
     */
    expect(arrived.parentElement).toBe(active);
    expect(
      within(active).queryByTestId("message-queue-broker-metric-status-line"),
    ).toBeNull();

    const scheduled: HTMLElement = rowOf(
      "servicebus:azure_scheduledmessages_average",
    );
    expect(scheduled).toHaveAttribute("data-state", "notCollected");
    expect(scheduled).toHaveAttribute("data-reason", "notRequested");
    expect(within(scheduled).getByText("Not collected").className).toContain(
      "text-amber-800",
    );
    const line: HTMLElement = within(scheduled).getByTestId(
      "message-queue-broker-metric-status-line",
    );
    expect(line).toHaveTextContent(
      "Azure Service Bus reports it every minute, so your collector most likely does not ask for it: add ScheduledMessages: [Average] to its metrics list.",
    );
    expect(line.querySelector("code")).toHaveTextContent(
      "ScheduledMessages: [Average]",
    );
    expect(line.parentElement).toBe(scheduled);

    // A latency reported with every send, while sends arrived without it.
    const latency: HTMLElement = rowOf(
      "servicebus:azure_serversendlatency_average",
    );
    expect(latency).toHaveAttribute("data-state", "notCollected");
    expect(latency).toHaveAttribute("data-reason", "reportedWithSends");
    expect(
      within(latency).getByTestId("message-queue-broker-metric-status-line"),
    ).toHaveTextContent(
      "Azure Service Bus reports it with every send, and sends to this queue arrived in the selected range, so your collector most likely does not ask for it: add ServerSendLatency: [Average] to its metrics list.",
    );

    const throttled: HTMLElement = rowOf(
      "servicebus:azure_throttledrequests_total",
    );
    expect(throttled).toHaveAttribute("data-state", "nothingToReport");
    expect(
      within(throttled).getByText("Nothing to report").className,
    ).toContain("text-gray-700");
    /*
     * The stored name reads left to right on a right-to-left page too, in
     * a block that keeps the page's direction, so it starts where the
     * row's words start.
     */
    const stored: HTMLElement = within(throttled).getByText(
      "azure_throttledrequests_total",
    );
    expect(stored.tagName).toBe("SPAN");
    expect(stored).toHaveAttribute("dir", "ltr");
    expect(stored.parentElement).not.toHaveAttribute("dir");
  });
});

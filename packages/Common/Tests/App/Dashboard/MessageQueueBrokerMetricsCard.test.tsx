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
 *     else the metrics that stopped; then the levels that should arrive and
 *     do not, with the configuration lines, set left to right, and links to
 *     the queue's collector configuration and the guide's troubleshooting;
 *   - the note that processing time needs consumer traces, only without them;
 *   - every supported metric, folded: its state, why, and when it arrived,
 *     inline code set off as code.
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
import { MessageQueueBrokerMetricResult } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
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
}): MessageQueueBrokerMetricsStatus {
  return getMessageQueueBrokerMetricsStatus({
    messagingSystem: "servicebus",
    catalog: SERVICE_BUS,
    results: data.results || [],
    arrivals: {
      since: ago(7 * DAY_MS),
      lastArrivedAt: new Map<string, Date>(Object.entries(data.arrived || {})),
    },
    brokerMetricsLastSeenAt: data.brokerMetricsLastSeenAt ?? null,
    window: { start: ago(60 * MINUTE_MS), end: NOW },
  });
}

// Some arrive, three levels do not.
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
  hasProcessingTime?: boolean;
}): HTMLElement {
  render(
    <MemoryRouter>
      <MessageQueueBrokerMetricsCard
        modelId={MODEL_ID}
        messagingSystem="servicebus"
        status={props.status}
        namespaceFinding={props.namespaceFinding ?? null}
        hasProcessingTime={props.hasProcessingTime ?? true}
        now={NOW}
      />
    </MemoryRouter>,
  );
  return screen.getByTestId("message-queue-broker-metrics-status");
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
        "The Azure Service Bus metrics this page charts: which arrive for this queue, when each last did, and why the others do not.",
      ),
    ).toBeInTheDocument();
    const badge: HTMLElement = screen.getByText("3 missing");
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

describe("what the card asks the reader to do", () => {
  test("the levels that should arrive and do not, with the lines that collect them", () => {
    const card: HTMLElement = renderCard({ status: INCOMPLETE });
    const findings: Array<HTMLElement> = findingsIn(card);
    expect(findings).toHaveLength(1);
    const finding: HTMLElement = findings[0]!;
    expect(finding).toHaveAttribute("data-kind", "missing");
    expect(finding).toHaveTextContent("3 metrics do not arrive");
    expect(finding).toHaveTextContent(
      "so they are most likely not collected: Dead-lettered messages, Scheduled messages, Size.",
    );

    // The step names the receiver and its list as code.
    const step: HTMLElement = within(finding).getByTestId(
      "message-queue-broker-metrics-finding-step",
    );
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
      "DeadletteredMessages: [Average]\nScheduledMessages: [Average]\nSize: [Average]",
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
  });

  test("never: other queues of the namespace arrive, or its totals only", () => {
    const others: HTMLElement = renderCard({
      status: NEVER,
      namespaceFinding: {
        kind: "otherEntitiesOnly",
        namespace: "orders-ns",
        entityCount: 14,
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
      "Your Azure cloud connection reads this namespace's metrics for the namespace as a whole",
    );
    cleanup();

    // Without a namespace finding, nothing ever arrived: no callout at all.
    const plain: HTMLElement = renderCard({ status: NEVER });
    expect(findingsIn(plain)).toHaveLength(0);
    expect(
      within(plain).getByTestId("message-queue-broker-metrics-summary"),
    ).toHaveTextContent("No metric has arrived for this queue yet.");
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

describe("the note on processing time", () => {
  test("drawn only without consumer traces, linking how to add them", () => {
    const card: HTMLElement = renderCard({
      status: INCOMPLETE,
      hasProcessingTime: false,
    });
    const note: HTMLElement = within(card).getByTestId(
      "message-queue-broker-metrics-tracing-note",
    );
    expect(note).toHaveTextContent(
      "Processing time comes from consumer traces only: no broker measures how long a consumer takes with a message.",
    );
    const link: HTMLAnchorElement = within(note)
      .getByText("Trace your consumers →")
      .closest("a") as HTMLAnchorElement;
    expect(link).toHaveAttribute(
      "href",
      "/docs/telemetry/queues#instrumenting-applications",
    );
    expect(link).toHaveAttribute("target", "_blank");
    cleanup();

    expect(
      within(renderCard({ status: INCOMPLETE })).queryByTestId(
        "message-queue-broker-metrics-tracing-note",
      ),
    ).toBeNull();
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
    const arrived: HTMLElement = within(active).getByText(
      `Last arrived ${OneUptimeDate.fromNow(ago(5 * MINUTE_MS), NOW)}`,
    );
    expect(arrived).toHaveAttribute(
      "title",
      OneUptimeDate.getDateAsLocalFormattedString(ago(5 * MINUTE_MS)),
    );
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

    const throttled: HTMLElement = rowOf(
      "servicebus:azure_throttledrequests_total",
    );
    expect(throttled).toHaveAttribute("data-state", "nothingToReport");
    expect(
      within(throttled).getByText("Nothing to report").className,
    ).toContain("text-gray-700");
    // The stored name reads left to right on a right-to-left page too.
    expect(
      within(throttled).getByText("azure_throttledrequests_total"),
    ).toHaveAttribute("dir", "ltr");
  });
});

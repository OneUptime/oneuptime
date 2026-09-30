import { describe, expect, test } from "@jest/globals";
import * as OverviewPresentation from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueOverviewPresentation";
import {
  MESSAGE_QUEUE_DISCOVERY_CLOUD_METRIC_WINDOW_MINUTES,
  MESSAGE_QUEUE_DISCOVERY_INTERVAL_MINUTES,
  MESSAGE_QUEUE_DISCOVERY_WINDOW_MINUTES,
  MESSAGE_QUEUE_LIVE_WINDOW_MINUTES,
  MESSAGE_QUEUE_LIVENESS_DESCRIPTION,
  MessageQueueLivenessStatus,
  formatMessageQueueCount,
  formatMessageQueueDurationMs,
  formatMessageQueueErrorRate,
  formatMessageQueueMetricValue,
  getMessageQueueDocsRoute,
  getMessageQueueLivenessLabel,
  getMessageQueueLivenessStatus,
  getMessageQueueLivenessTone,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueOverviewPresentation";
import {
  getMessageQueueDiscoveryLabel,
  getMessageQueueLastSeenText,
  toMessageQueueDate,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueuePresentation";
import { MESSAGE_QUEUE_DOCS_PATH } from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/DocumentationMarkdown";
import { MESSAGE_QUEUE_LATE_METRIC_MINUTES } from "../../../Server/Utils/Telemetry/MessageQueueDiscovery";

/*
 * How a queue's Overview describes its row, without a renderer: whether
 * anything has seen it lately, where its discovery came from, where its docs
 * live, and how its numbers read. (The "not found" guard and the system and
 * broker labels every Queues page shares are pinned with their own module,
 * Pages/MessageQueue/Utils/MessageQueuePresentation; the discovery-source
 * label and the date parse the Overview reads from there are held here to
 * the list's.)
 */

const NOW: Date = new Date("2026-09-30T12:00:00.000Z");

function minutesBefore(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

describe("liveness", () => {
  test("seen inside the window, outside it, or never", () => {
    expect(getMessageQueueLivenessStatus(minutesBefore(1), NOW)).toBe(
      MessageQueueLivenessStatus.SeenRecently,
    );
    expect(
      getMessageQueueLivenessStatus(
        minutesBefore(MESSAGE_QUEUE_LIVE_WINDOW_MINUTES),
        NOW,
      ),
    ).toBe(MessageQueueLivenessStatus.SeenRecently);
    expect(
      getMessageQueueLivenessStatus(
        minutesBefore(MESSAGE_QUEUE_LIVE_WINDOW_MINUTES + 1),
        NOW,
      ),
    ).toBe(MessageQueueLivenessStatus.NotSeenRecently);
    expect(getMessageQueueLivenessStatus(null, NOW)).toBe(
      MessageQueueLivenessStatus.NeverSeen,
    );
    expect(getMessageQueueLivenessStatus("not a date", NOW)).toBe(
      MessageQueueLivenessStatus.NeverSeen,
    );
    // A stored string reads like a Date.
    expect(
      getMessageQueueLivenessStatus(minutesBefore(5).toISOString(), NOW),
    ).toBe(MessageQueueLivenessStatus.SeenRecently);
  });

  test("the pill's words and colours never borrow Connected / Disconnected", () => {
    expect(
      [
        MessageQueueLivenessStatus.SeenRecently,
        MessageQueueLivenessStatus.NotSeenRecently,
        MessageQueueLivenessStatus.NeverSeen,
      ].map((status: MessageQueueLivenessStatus): [string, string] => {
        return [
          getMessageQueueLivenessLabel(status),
          getMessageQueueLivenessTone(status),
        ];
      }),
    ).toEqual([
      ["Seen recently", "positive"],
      ["Not seen recently", "warning"],
      ["Never seen", "neutral"],
    ]);
    expect(MESSAGE_QUEUE_LIVENESS_DESCRIPTION).toContain(
      `${MESSAGE_QUEUE_LIVE_WINDOW_MINUTES} minutes`,
    );
  });

  /*
   * lastSeenAt is when discovery sighted the queue — the time of its run —
   * and a run reads the cloud monitoring metrics an hour back, so a queue
   * only CloudWatch reports is "seen" up to an hour after its newest
   * datapoint. The hover text must say what it measures, in discovery's
   * own numbers.
   */
  test("the hover text says when discovery last found the queue, in discovery's own windows", () => {
    expect(MESSAGE_QUEUE_DISCOVERY_CLOUD_METRIC_WINDOW_MINUTES).toBe(
      MESSAGE_QUEUE_DISCOVERY_WINDOW_MINUTES +
        MESSAGE_QUEUE_LATE_METRIC_MINUTES,
    );
    expect(MESSAGE_QUEUE_LIVENESS_DESCRIPTION).toBe(
      `Seen recently: in the last ${MESSAGE_QUEUE_LIVE_WINDOW_MINUTES} minutes, discovery found spans or broker metrics naming this queue. It runs every ${MESSAGE_QUEUE_DISCOVERY_INTERVAL_MINUTES} minutes over the last ${MESSAGE_QUEUE_DISCOVERY_WINDOW_MINUTES} minutes of telemetry, and over the last ${MESSAGE_QUEUE_DISCOVERY_CLOUD_METRIC_WINDOW_MINUTES} minutes of cloud monitoring metrics, which arrive late.`,
    );
    // It never claims the telemetry itself is that recent.
    expect(MESSAGE_QUEUE_LIVENESS_DESCRIPTION).not.toContain(
      "named this queue in the last",
    );
    // Three runs fit the window.
    expect(MESSAGE_QUEUE_LIVE_WINDOW_MINUTES).toBe(
      3 * MESSAGE_QUEUE_DISCOVERY_INTERVAL_MINUTES,
    );
  });
});

describe("the row's discovery source and docs", () => {
  test("the discovery source in words", () => {
    expect(getMessageQueueDiscoveryLabel("traces")).toBe("Application traces");
    expect(getMessageQueueDiscoveryLabel("broker-metrics")).toBe(
      "Broker metrics",
    );
    expect(getMessageQueueDiscoveryLabel("manual")).toBe("Added manually");
    expect(getMessageQueueDiscoveryLabel(undefined)).toBe("Unknown");
    expect(getMessageQueueDiscoveryLabel("")).toBe("Unknown");
  });

  test("one home for what the list and the Overview both show: the discovery label and the date parse", () => {
    // The Overview module keeps no copy of either.
    expect(
      (OverviewPresentation as Record<string, unknown>)[
        "getMessageQueueDiscoveryLabel"
      ],
    ).toBeUndefined();
    expect(
      (OverviewPresentation as Record<string, unknown>)["toValidDate"],
    ).toBeUndefined();

    // The same parse behind the Last seen cell and the liveness pill.
    const seen: Date = minutesBefore(5);
    expect(toMessageQueueDate(seen)).toBe(seen);
    expect(toMessageQueueDate(seen.toISOString())!.getTime()).toBe(
      seen.getTime(),
    );
    expect(toMessageQueueDate("not a date")).toBeNull();
    expect(toMessageQueueDate(undefined)).toBeNull();
    expect(getMessageQueueLastSeenText("not a date").text).toBe("—");
    expect(getMessageQueueLivenessStatus("not a date", NOW)).toBe(
      MessageQueueLivenessStatus.NeverSeen,
    );
  });

  test("a docs route to a heading of the Queues guide", () => {
    expect(MESSAGE_QUEUE_DOCS_PATH).toBe("/docs/telemetry/queues");
    expect(getMessageQueueDocsRoute("apache-kafka").toString()).toBe(
      "/docs/telemetry/queues#apache-kafka",
    );
    expect(getMessageQueueDocsRoute("").toString()).toBe(
      "/docs/telemetry/queues",
    );
  });
});

describe("the numbers", () => {
  test("counts, error rates and durations", () => {
    expect(formatMessageQueueCount(1234)).toBe("1.2k");
    expect(formatMessageQueueCount(null)).toBe("—");
    expect(formatMessageQueueErrorRate(4)).toBe("4.0%");
    expect(formatMessageQueueErrorRate(null)).toBe("—");
    expect(formatMessageQueueDurationMs(0.85)).toBe("850 µs");
    expect(formatMessageQueueDurationMs(12.3)).toBe("12 ms");
    expect(formatMessageQueueDurationMs(1250)).toBe("1.25 s");
    expect(formatMessageQueueDurationMs(null)).toBe("—");
  });

  test("a broker metric in its catalog unit: a gauge's level, a counter's rate", () => {
    expect(
      formatMessageQueueMetricValue(1500, { unit: "messages", kind: "gauge" }),
    ).toBe("1.5k messages");
    expect(
      formatMessageQueueMetricValue(1, { unit: "consumers", kind: "gauge" }),
    ).toBe("1 consumer");
    expect(
      formatMessageQueueMetricValue(2.5, { unit: "messages", kind: "counter" }),
    ).toBe("2.5 messages/s");
    expect(
      formatMessageQueueMetricValue(90, { unit: "s", kind: "gauge" }),
    ).toBe("1.5 min");
    expect(
      formatMessageQueueMetricValue(null, { unit: "messages", kind: "gauge" }),
    ).toBe("—");
  });
});

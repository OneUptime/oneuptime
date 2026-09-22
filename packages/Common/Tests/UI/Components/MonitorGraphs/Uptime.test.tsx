/** @timezone UTC */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { Profiler } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";
import MonitorUptimeGraph, {
  ComponentProps,
} from "../../../../UI/Components/MonitorGraphs/Uptime";
import UptimeUtil from "../../../../UI/Components/MonitorGraphs/UptimeUtil";
import { UptimeBarDaySummary } from "../../../../UI/Components/Graphs/DayUptimeGraph";
import { StatusDuration } from "../../../../UI/Components/Graphs/UptimeDaySummary";
import { Green, Orange, Red } from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
import ObjectID from "../../../../Types/ObjectID";
import { UptimeDayBucket } from "../../../../Types/StatusPage/UptimeDailyAggregate";
import UptimeBarTooltipIncident from "../../../../Types/Monitor/UptimeBarTooltipIncident";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import StatusPageHistoryChartBarColorRule from "../../../../Models/DatabaseModels/StatusPageHistoryChartBarColorRule";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

const START_DATE: Date = new Date("2026-01-01T12:00:00.000Z");
const END_DATE: Date = new Date("2026-01-03T12:00:00.000Z");

function makeStatus(isDown: boolean): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = isDown ? "status-down" : "status-up";
  status.name = isDown ? "Offline" : "Operational";
  status.color = isDown ? Red : Green;
  status.priority = isDown ? 2 : 1;
  return status;
}

function makeTimeline(status: MonitorStatus): MonitorStatusTimeline {
  const statusId: ObjectID | null = status.id;

  if (!statusId) {
    throw new Error("Test status must have an ID.");
  }

  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.monitorId = new ObjectID("monitor-1");
  timeline.monitorStatusId = statusId;
  timeline.monitorStatus = status;
  timeline.startsAt = new Date("2026-01-02T01:00:00.000Z");
  timeline.endsAt = new Date("2026-01-02T23:00:00.000Z");
  return timeline;
}

function makeRule(color: Color): StatusPageHistoryChartBarColorRule {
  const rule: StatusPageHistoryChartBarColorRule =
    new StatusPageHistoryChartBarColorRule();
  rule.barColor = color;
  rule.uptimePercentGreaterThanOrEqualTo = 0;
  return rule;
}

interface HistorySnapshot {
  labels: Array<string | null>;
  colors: Array<string>;
}

function renderHistory(overrides: Partial<ComponentProps> = {}): {
  snapshots: Array<HistorySnapshot>;
  rerenderHistory: (nextProps: Partial<ComponentProps>) => void;
} {
  const down: MonitorStatus = makeStatus(true);
  let props: ComponentProps = {
    startDate: START_DATE,
    endDate: END_DATE,
    items: [makeTimeline(down)],
    downtimeMonitorStatuses: [down],
    defaultBarColor: Green,
    ...overrides,
  };
  const snapshots: Array<HistorySnapshot> = [];

  /*
   * Observe actual committed bars, including the first paint. Checking only
   * the settled DOM misses an empty or stale history followed by an effect
   * that rebuilds every bar when a search reveals many resources at once.
   */
  const recordCommit: () => void = (): void => {
    const bars: Array<HTMLElement> = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="uptime-bar"]'),
    );
    snapshots.push({
      labels: bars.map((bar: HTMLElement) => {
        return bar.getAttribute("aria-label");
      }),
      colors: bars.map((bar: HTMLElement) => {
        return bar.style.backgroundColor;
      }),
    });
  };

  const view: ReturnType<typeof render> = render(
    <Profiler id="history" onRender={recordCommit}>
      <MonitorUptimeGraph {...props} />
    </Profiler>,
  );

  return {
    snapshots: snapshots,
    rerenderHistory: (nextProps: Partial<ComponentProps>): void => {
      props = { ...props, ...nextProps };
      view.rerender(
        <Profiler id="history" onRender={recordCommit}>
          <MonitorUptimeGraph {...props} />
        </Profiler>,
      );
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorUptimeGraph - histories revealed by search", () => {
  test("the first paint contains the complete history and correct downtime", () => {
    const { snapshots } = renderHistory();

    expect(snapshots.length).toBeGreaterThan(0);
    for (const snapshot of snapshots) {
      expect(snapshot.labels).toHaveLength(3);
      expect(snapshot.labels[1]).toContain("0% uptime");
    }
    expect(screen.getAllByTestId("uptime-bar")[1]).toHaveStyle({
      backgroundColor: Red.toString(),
    });
  });

  test("custom bar rules are applied on the first paint", () => {
    const { snapshots } = renderHistory({
      barColorRules: [makeRule(new Color("#123456"))],
    });

    expect(snapshots[0]?.colors[1]).toBe("rgb(18, 52, 86)");
    expect(snapshots[0]?.labels[1]).toContain("0% uptime");
  });

  test("an unrelated render reuses timeline calculations", () => {
    const calculateEvents: SpyInstance<
      typeof UptimeUtil.getNonOverlappingMonitorEvents
    > = jest.spyOn(UptimeUtil, "getNonOverlappingMonitorEvents");
    const { rerenderHistory } = renderHistory();
    const originalBar: HTMLElement | undefined =
      screen.getAllByTestId("uptime-bar")[1];

    rerenderHistory({ height: 10 });
    rerenderHistory({ height: 12 });

    expect(calculateEvents).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("uptime-bar")[1]).toBe(originalBar);
  });

  test("a refreshed timeline updates every committed reading without stale downtime", () => {
    const calculateEvents: SpyInstance<
      typeof UptimeUtil.getNonOverlappingMonitorEvents
    > = jest.spyOn(UptimeUtil, "getNonOverlappingMonitorEvents");
    const { snapshots, rerenderHistory } = renderHistory();
    snapshots.length = 0;

    rerenderHistory({ items: [makeTimeline(makeStatus(false))] });

    expect(calculateEvents).toHaveBeenCalledTimes(2);
    expect(snapshots.length).toBeGreaterThan(0);
    for (const snapshot of snapshots) {
      expect(snapshot.labels[1]).toContain("100% uptime");
    }
    expect(screen.getAllByTestId("uptime-bar")[1]).toHaveStyle({
      backgroundColor: Green.toString(),
    });
  });

  test("clearing the timeline immediately removes the old readings", () => {
    const { snapshots, rerenderHistory } = renderHistory();
    snapshots.length = 0;

    rerenderHistory({ items: [] });

    expect(snapshots.length).toBeGreaterThan(0);
    for (const snapshot of snapshots) {
      expect(snapshot.labels).toHaveLength(3);
      for (const label of snapshot.labels) {
        expect(label).toContain("no data");
      }
    }
  });

  test("changing the date window paints the new number of days immediately", () => {
    const { snapshots, rerenderHistory } = renderHistory();
    snapshots.length = 0;

    rerenderHistory({
      startDate: new Date("2026-01-02T12:00:00.000Z"),
    });

    expect(snapshots.length).toBeGreaterThan(0);
    for (const snapshot of snapshots) {
      expect(snapshot.labels).toHaveLength(2);
      expect(snapshot.labels[0]).toContain("0% uptime");
    }
    expect(screen.getByTestId("day-uptime-graph")).toHaveAttribute(
      "aria-label",
      "Uptime history for the last 2 days",
    );
  });
});

describe("MonitorUptimeGraph - refreshed chart settings", () => {
  test("replacing color rules uses the new color without recalculating events", () => {
    const calculateEvents: SpyInstance<
      typeof UptimeUtil.getNonOverlappingMonitorEvents
    > = jest.spyOn(UptimeUtil, "getNonOverlappingMonitorEvents");
    const { snapshots, rerenderHistory } = renderHistory({
      barColorRules: [makeRule(new Color("#123456"))],
    });
    snapshots.length = 0;

    rerenderHistory({ barColorRules: [makeRule(new Color("#654321"))] });

    expect(calculateEvents).toHaveBeenCalledTimes(1);
    expect(snapshots[0]?.colors[1]).toBe("rgb(101, 67, 33)");
  });

  test.each([undefined, []])(
    "removed color rules %p restore status colors",
    (rules: Array<StatusPageHistoryChartBarColorRule> | undefined) => {
      const { rerenderHistory } = renderHistory({
        barColorRules: [makeRule(new Color("#123456"))],
      });

      rerenderHistory({ barColorRules: rules });

      expect(screen.getAllByTestId("uptime-bar")[1]).toHaveStyle({
        backgroundColor: Red.toString(),
      });
    },
  );

  test("a changed downtime definition updates the reading", () => {
    const { rerenderHistory } = renderHistory();

    rerenderHistory({ downtimeMonitorStatuses: [] });

    expect(screen.getAllByTestId("uptime-bar")[1]).toHaveAttribute(
      "aria-label",
      expect.stringContaining("100% uptime"),
    );
  });
});

describe("MonitorUptimeGraph - loading and recovery", () => {
  test("loading hides the history until the supplied timeline is ready", () => {
    const { snapshots, rerenderHistory } = renderHistory({ isLoading: true });

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("day-uptime-graph")).not.toBeInTheDocument();
    snapshots.length = 0;

    rerenderHistory({ isLoading: false });

    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
    expect(snapshots[0]?.labels[1]).toContain("0% uptime");
  });

  test("an error keeps its refresh action and recovery draws the current timeline", () => {
    const onRefreshClick: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();
    const { rerenderHistory } = renderHistory({
      error: "Timeline unavailable",
      onRefreshClick: onRefreshClick,
    });

    expect(screen.getByText("Timeline unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("day-uptime-graph")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("refresh-button"));
    expect(onRefreshClick).toHaveBeenCalledTimes(1);

    rerenderHistory({
      error: undefined,
      items: [makeTimeline(makeStatus(false))],
    });

    expect(screen.queryByText("Timeline unavailable")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("uptime-bar")[1]).toHaveAttribute(
      "aria-label",
      expect.stringContaining("100% uptime"),
    );
  });
});

/*
 * The server's day buckets. A day whose timeline rows were dropped by the
 * fetch cap is painted from its bucket alone, and a bucket only names status
 * ids, so the graph resolves each one to the status's name, colour, downtime
 * flag and priority. Without the priority the bar could not take the colour
 * of the day's worst status the way a day painted from rows does.
 */
describe("MonitorUptimeGraph - server buckets", () => {
  type OnBarClickFunction = (
    date: Date,
    incidents: Array<UptimeBarTooltipIncident>,
    summary: UptimeBarDaySummary,
  ) => void;

  interface BucketDuration {
    status: MonitorStatus;
    seconds: number;
  }

  function bucketFor(
    day: string,
    durations: Array<BucketDuration>,
  ): UptimeDayBucket {
    const bucketStart: Date = new Date(`${day}T00:00:00.000Z`);

    return {
      bucketStart: bucketStart,
      bucketEnd: new Date(bucketStart.getTime() + 86400 * 1000),
      daySeconds: 86400,
      coveredSeconds: durations.reduce(
        (sum: number, duration: BucketDuration) => {
          return sum + duration.seconds;
        },
        0,
      ),
      statusDurations: durations.map((duration: BucketDuration) => {
        return {
          monitorStatusId: duration.status.id as ObjectID,
          seconds: duration.seconds,
        };
      }),
    };
  }

  function openBar(
    onBarClick: ReturnType<typeof jest.fn<OnBarClickFunction>>,
    index: number,
  ): UptimeBarDaySummary {
    fireEvent.click(screen.getAllByTestId("uptime-bar")[index] as HTMLElement);

    const calls: Array<Parameters<OnBarClickFunction>> = onBarClick.mock.calls;

    return calls[calls.length - 1]?.[2] as UptimeBarDaySummary;
  }

  test("bucket durations carry the status priority", () => {
    const up: MonitorStatus = makeStatus(false);
    const down: MonitorStatus = makeStatus(true);
    const onBarClick: ReturnType<typeof jest.fn<OnBarClickFunction>> =
      jest.fn<OnBarClickFunction>();

    renderHistory({
      items: [],
      monitorStatuses: [up, down],
      downtimeMonitorStatuses: [down],
      uptimeBuckets: [
        bucketFor("2026-01-02", [
          { status: up, seconds: 43200 },
          { status: down, seconds: 43200 },
        ]),
      ],
      onBarClick: onBarClick,
    });

    const summary: UptimeBarDaySummary = openBar(onBarClick, 1);

    expect(
      summary.statusDurations.map((duration: StatusDuration) => {
        return {
          label: duration.label,
          priority: duration.priority,
          isDowntime: duration.isDowntime,
        };
      }),
    ).toEqual([
      { label: "Operational", priority: 1, isDowntime: false },
      { label: "Offline", priority: 2, isDowntime: true },
    ]);

    // The day has no rows of its own, so the bucket paints it.
    expect(summary.uptimePercent).toBe(50);
    expect(screen.getAllByTestId("uptime-bar")[1]).toHaveStyle({
      backgroundColor: Red.toString(),
    });
  });

  test("the day takes the colour of its highest-priority status, not its downtime status", () => {
    const up: MonitorStatus = makeStatus(false);
    const down: MonitorStatus = makeStatus(true);

    // A status ranked above Offline that the page does not count as down.
    const maintenance: MonitorStatus = new MonitorStatus();
    maintenance._id = "status-maintenance";
    maintenance.name = "Maintenance";
    maintenance.color = Orange;
    maintenance.priority = 3;

    renderHistory({
      items: [],
      monitorStatuses: [up, down, maintenance],
      downtimeMonitorStatuses: [down],
      uptimeBuckets: [
        bucketFor("2026-01-02", [
          { status: up, seconds: 60000 },
          { status: down, seconds: 25800 },
          { status: maintenance, seconds: 600 },
        ]),
      ],
    });

    expect(screen.getAllByTestId("uptime-bar")[1]).toHaveStyle({
      backgroundColor: Orange.toString(),
    });
  });

  test("a status the page holds no priority for leaves the duration without one", () => {
    // The same two statuses, read without their priority column.
    const up: MonitorStatus = new MonitorStatus();
    up._id = "status-up";
    up.name = "Operational";
    up.color = Green;

    const down: MonitorStatus = new MonitorStatus();
    down._id = "status-down";
    down.name = "Offline";
    down.color = Red;

    const onBarClick: ReturnType<typeof jest.fn<OnBarClickFunction>> =
      jest.fn<OnBarClickFunction>();

    renderHistory({
      items: [],
      monitorStatuses: [up, down],
      downtimeMonitorStatuses: [down],
      uptimeBuckets: [
        bucketFor("2026-01-02", [
          { status: up, seconds: 64800 },
          { status: down, seconds: 21600 },
        ]),
      ],
      onBarClick: onBarClick,
    });

    const summary: UptimeBarDaySummary = openBar(onBarClick, 1);

    expect(
      summary.statusDurations.map((duration: StatusDuration) => {
        return duration.priority;
      }),
    ).toEqual([undefined, undefined]);

    // With no priorities, the downtime status the day spent longest in.
    expect(summary.uptimePercent).toBe(75);
    expect(screen.getAllByTestId("uptime-bar")[1]).toHaveStyle({
      backgroundColor: Red.toString(),
    });
  });

  /*
   * This test used to be "a day with timeline rows keeps its row-derived
   * reading beside a bucket-only day": Jan 2's rows decided Jan 2 whatever
   * its bucket said. That precedence is what left status.chainflip.io wrong.
   * The rows arrive under a 10,000 row cap across the whole page, so the day
   * the cap cuts through still "has rows" - just not all of them - and the
   * pre-fix client sort could leave a day with rows that describe nothing
   * real. The bucket is measured server-side from every row, so a bucket with
   * coverage now decides its day even when the day has rows.
   *
   * Fails on the pre-fix code: Jan 2 read 0% and Red from its rows.
   */
  test("a day's bucket decides it even when the day has timeline rows", () => {
    const up: MonitorStatus = makeStatus(false);
    const down: MonitorStatus = makeStatus(true);
    const onBarClick: ReturnType<typeof jest.fn<OnBarClickFunction>> =
      jest.fn<OnBarClickFunction>();

    renderHistory({
      // Down 01:00-23:00 on Jan 2, from the rows.
      items: [makeTimeline(down)],
      monitorStatuses: [up, down],
      downtimeMonitorStatuses: [down],
      uptimeBuckets: [
        bucketFor("2026-01-01", [
          { status: up, seconds: 64800 },
          { status: down, seconds: 21600 },
        ]),
        // Disagrees with the rows on purpose: the bucket decides Jan 2.
        bucketFor("2026-01-02", [{ status: up, seconds: 86400 }]),
      ],
      onBarClick: onBarClick,
    });

    const bars: Array<HTMLElement> = screen.getAllByTestId("uptime-bar");

    // Jan 1 has no rows, so its bucket paints it.
    expect(openBar(onBarClick, 0).uptimePercent).toBe(75);
    expect(bars[0]).toHaveStyle({ backgroundColor: Red.toString() });

    // Jan 2 has rows, and its bucket still decides it.
    const jan2: UptimeBarDaySummary = openBar(onBarClick, 1);

    expect(jan2.uptimePercent).toBe(100);
    expect(
      jan2.statusDurations.map((duration: StatusDuration) => {
        return duration.label;
      }),
    ).toEqual(["Operational"]);
    expect(bars[1]).toHaveStyle({ backgroundColor: Green.toString() });
    expect(bars[1]).toHaveAttribute(
      "aria-label",
      expect.stringContaining("100% uptime"),
    );
  });
});

/*
 * The zone the buckets were cut in. The status page's buckets are UTC days
 * shared by every visitor through one cached response, so the strip has to be
 * drawn on those same days or each bar is paired with a bucket for a
 * different span of time. MonitorUptimeGraph takes that zone as
 * uptimeTimezone and hands it to the strip. The dashboard passes none (its
 * buckets are asked for in the browser's zone) and must see no change.
 *
 * This file runs in UTC, so a zone that is NOT the browser's is needed to see
 * the prop do anything: Tokyo buckets, cut at 15:00 UTC.
 */
describe("MonitorUptimeGraph - uptimeTimezone", () => {
  type OnBarClickFunction = (
    date: Date,
    incidents: Array<UptimeBarTooltipIncident>,
    summary: UptimeBarDaySummary,
  ) => void;

  const up: MonitorStatus = makeStatus(false);
  const down: MonitorStatus = makeStatus(true);

  function bucketBetween(
    start: string,
    end: string,
    uptimePercent: number,
  ): UptimeDayBucket {
    const bucketStart: Date = new Date(start);
    const bucketEnd: Date = new Date(end);
    const coveredSeconds: number =
      (bucketEnd.getTime() - bucketStart.getTime()) / 1000;
    const downSeconds: number = (coveredSeconds * (100 - uptimePercent)) / 100;

    return {
      bucketStart: bucketStart,
      bucketEnd: bucketEnd,
      daySeconds: coveredSeconds,
      coveredSeconds: coveredSeconds,
      statusDurations: [
        {
          monitorStatusId: up.id as ObjectID,
          seconds: coveredSeconds - downSeconds,
        },
        { monitorStatusId: down.id as ObjectID, seconds: downSeconds },
      ],
    };
  }

  /*
   * The window is Jan 1 12:00 UTC to Jan 3 12:00 UTC - 21:00 JST on Jan 1 to
   * 21:00 JST on Jan 3 - so Tokyo's buckets are a clipped Jan 1, a whole
   * Jan 2 and a Jan 3 cut off at "now", each with its own percentage.
   */
  const TOKYO_BUCKETS: Array<UptimeDayBucket> = [
    bucketBetween("2026-01-01T12:00:00.000Z", "2026-01-01T15:00:00.000Z", 90),
    bucketBetween("2026-01-01T15:00:00.000Z", "2026-01-02T15:00:00.000Z", 91),
    bucketBetween("2026-01-02T15:00:00.000Z", "2026-01-03T12:00:00.000Z", 92),
  ];

  function barLabels(): Array<string | null> {
    return screen.getAllByTestId("uptime-bar").map((bar: HTMLElement) => {
      return bar.getAttribute("aria-label");
    });
  }

  test("the strip is drawn on the buckets' own days, so bar i is painted from bucket i", () => {
    const onBarClick: ReturnType<typeof jest.fn<OnBarClickFunction>> =
      jest.fn<OnBarClickFunction>();

    renderHistory({
      items: [],
      monitorStatuses: [up, down],
      downtimeMonitorStatuses: [down],
      uptimeBuckets: TOKYO_BUCKETS,
      uptimeTimezone: "Asia/Tokyo",
      onBarClick: onBarClick,
    });

    // The zone is not the browser's (UTC), so the labels say which it is.
    expect(barLabels()).toEqual([
      "Jan 01, 2026 (JST): 90% uptime",
      "Jan 02, 2026 (JST): 91% uptime",
      "Jan 03, 2026 (JST): 92% uptime",
    ]);

    // Each bar opens as the Tokyo midnight it stands for.
    const bars: Array<HTMLElement> = screen.getAllByTestId("uptime-bar");

    bars.forEach((bar: HTMLElement) => {
      fireEvent.click(bar);
    });

    expect(
      onBarClick.mock.calls.map((call: Parameters<OnBarClickFunction>) => {
        return call[0].toISOString();
      }),
    ).toEqual([
      "2025-12-31T15:00:00.000Z",
      "2026-01-01T15:00:00.000Z",
      "2026-01-02T15:00:00.000Z",
    ]);
  });

  /*
   * Without the zone, what the pre-fix code always did: UTC days in this
   * browser, so Jan 1 holds the starts of two Tokyo buckets and keeps the
   * first, the whole-day Jan 2 bucket (91%) is on no bar, and the last bar
   * has nothing.
   */
  test("without uptimeTimezone the same buckets are drawn on the browser's days and mis-pair", () => {
    renderHistory({
      items: [],
      monitorStatuses: [up, down],
      downtimeMonitorStatuses: [down],
      uptimeBuckets: TOKYO_BUCKETS,
    });

    expect(barLabels()).toEqual([
      "Jan 01, 2026: 90% uptime",
      "Jan 02, 2026: 92% uptime",
      "Jan 03, 2026: no data",
    ]);
  });

  /*
   * The dashboard's case: the buckets are the browser's own days. Passing
   * that zone, or passing nothing, must draw the same strip.
   */
  test("a zone that is the browser's own draws exactly what omitting it draws", () => {
    interface HistoryLook {
      labels: Array<string | null>;
      colors: Array<string>;
    }

    const readHistory: () => HistoryLook = (): HistoryLook => {
      return {
        labels: barLabels(),
        colors: screen.getAllByTestId("uptime-bar").map((bar: HTMLElement) => {
          return bar.style.backgroundColor;
        }),
      };
    };

    const utcBuckets: Array<UptimeDayBucket> = [
      bucketBetween("2026-01-01T12:00:00.000Z", "2026-01-02T00:00:00.000Z", 75),
      bucketBetween("2026-01-02T00:00:00.000Z", "2026-01-03T00:00:00.000Z", 50),
      bucketBetween("2026-01-03T00:00:00.000Z", "2026-01-03T12:00:00.000Z", 99),
    ];

    const sharedProps: Partial<ComponentProps> = {
      items: [makeTimeline(down)],
      monitorStatuses: [up, down],
      downtimeMonitorStatuses: [down],
      uptimeBuckets: utcBuckets,
      barColorRules: [makeRule(new Color("#123456"))],
    };

    renderHistory(sharedProps);

    const omitted: HistoryLook = readHistory();

    cleanup();

    renderHistory({ ...sharedProps, uptimeTimezone: "UTC" });

    const inUtc: HistoryLook = readHistory();

    expect(inUtc).toEqual(omitted);
    expect(inUtc.labels).toEqual([
      "Jan 01, 2026: 75% uptime",
      "Jan 02, 2026: 50% uptime",
      "Jan 03, 2026: 99% uptime",
    ]);
  });
});

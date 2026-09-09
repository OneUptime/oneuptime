/** @timezone UTC */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React, { Profiler } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";
import MonitorUptimeGraph, {
  ComponentProps,
} from "../../../../UI/Components/MonitorGraphs/Uptime";
import UptimeUtil from "../../../../UI/Components/MonitorGraphs/UptimeUtil";
import { Green, Red } from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
import ObjectID from "../../../../Types/ObjectID";
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

/** @timezone UTC */

import Color from "../../../../Types/Color";
import { Gray500 } from "../../../../Types/BrandColors";
import ObjectID from "../../../../Types/ObjectID";
import UptimeBarTooltipIncident from "../../../../Types/Monitor/UptimeBarTooltipIncident";
import DayUptimeGraph, {
  BarChartRule,
  ComponentProps,
  DayUptimeData,
  Event as UptimeEvent,
  getDayUptimeData,
} from "../../../../UI/Components/Graphs/DayUptimeGraph";
import "@testing-library/jest-dom";
import {
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import { describe, expect, jest, test } from "@jest/globals";
import React, { ReactElement } from "react";

/*
 * The real tooltip portals its content and only reveals it after a delayed
 * pointer interaction. Rendering the rich content beside its trigger keeps
 * these tests focused on the day classification and the data passed to the
 * tooltip, without coupling them to Tippy's timers and positioning internals.
 */
jest.mock("../../../../UI/Components/Tooltip/Tooltip", () => {
  return {
    __esModule: true,
    default: ({
      children,
      richContent,
    }: {
      children: ReactElement;
      richContent?: ReactElement | undefined;
    }): ReactElement => {
      return (
        <div data-testid="day-uptime-tooltip">
          {children}
          <div data-testid="day-uptime-tooltip-content">{richContent}</div>
        </div>
      );
    },
  };
});

const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID("operational-status");
const OFFLINE_STATUS_ID: ObjectID = new ObjectID("offline-status");
const DEGRADED_STATUS_ID: ObjectID = new ObjectID("degraded-status");

const OPERATIONAL_COLOR: Color = new Color("#22c55e");
const OFFLINE_COLOR: Color = new Color("#ef4444");
const DEGRADED_COLOR: Color = new Color("#f59e0b");
const HIGH_PRIORITY_COLOR: Color = new Color("#7c3aed");
const LOW_PRIORITY_COLOR: Color = new Color("#0ea5e9");

interface EventOptions {
  start: string;
  end: string;
  statusId?: ObjectID | undefined;
  color?: Color | undefined;
  label?: string | undefined;
  priority?: number | undefined;
}

const event: (options: EventOptions) => UptimeEvent = (
  options: EventOptions,
): UptimeEvent => {
  return {
    startDate: new Date(options.start),
    endDate: new Date(options.end),
    eventStatusId: options.statusId || OPERATIONAL_STATUS_ID,
    color: options.color || OPERATIONAL_COLOR,
    label: options.label || "Operational",
    priority: options.priority ?? 1,
  };
};

const renderGraph: (overrides?: Partial<ComponentProps>) => RenderResult = (
  overrides: Partial<ComponentProps> = {},
): RenderResult => {
  const props: ComponentProps = {
    startDate: new Date("2025-01-01T00:00:00.000Z"),
    endDate: new Date("2025-01-01T00:00:00.000Z"),
    events: [],
    defaultBarColor: Gray500,
    downtimeEventStatusIds: [OFFLINE_STATUS_ID],
    ...overrides,
  };

  return render(<DayUptimeGraph {...props} />);
};

const getBars: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.getAllByTestId("day-uptime-bar");
};

const expectBar: (
  bar: HTMLElement,
  expected: { date: string; hasData: boolean; color: Color },
) => void = (
  bar: HTMLElement,
  expected: { date: string; hasData: boolean; color: Color },
): void => {
  expect(bar).toHaveAttribute(
    "data-date",
    new Date(expected.date).toISOString(),
  );
  expect(bar).toHaveAttribute(
    "data-has-data",
    expected.hasData ? "true" : "false",
  );
  expect(bar).toHaveStyle({
    backgroundColor: expected.color.toString(),
  });
};

const getTooltipForBar: (bar: HTMLElement) => HTMLElement = (
  bar: HTMLElement,
): HTMLElement => {
  const tooltip: HTMLElement | null = bar.closest(
    '[data-testid="day-uptime-tooltip"]',
  );

  if (!tooltip) {
    throw new Error("Expected the uptime bar to be wrapped in a tooltip");
  }

  return tooltip;
};

describe("DayUptimeGraph", () => {
  test("renders every day in an empty range as caller-colored no-data", () => {
    renderGraph({
      startDate: new Date("2025-01-01T00:00:00.000Z"),
      endDate: new Date("2025-01-03T00:00:00.000Z"),
    });

    const bars: Array<HTMLElement> = getBars();
    expect(bars).toHaveLength(3);

    ["2025-01-01", "2025-01-02", "2025-01-03"].forEach(
      (date: string, index: number) => {
        expectBar(bars[index]!, {
          date: `${date}T00:00:00.000Z`,
          hasData: false,
          color: Gray500,
        });

        const tooltip: HTMLElement = getTooltipForBar(bars[index]!);
        expect(
          within(tooltip).getByText("No monitoring data for this day"),
        ).toBeInTheDocument();
        expect(within(tooltip).queryByText("Uptime")).not.toBeInTheDocument();
      },
    );
  });

  test("keeps the pre-creation part of the range gray", () => {
    renderGraph({
      startDate: new Date("2025-01-01T00:00:00.000Z"),
      endDate: new Date("2025-01-03T00:00:00.000Z"),
      events: [
        event({
          start: "2025-01-02T09:00:00.000Z",
          end: "2025-01-04T00:00:00.000Z",
        }),
      ],
    });

    const bars: Array<HTMLElement> = getBars();
    expectBar(bars[0]!, {
      date: "2025-01-01T00:00:00.000Z",
      hasData: false,
      color: Gray500,
    });
    expectBar(bars[1]!, {
      date: "2025-01-02T00:00:00.000Z",
      hasData: true,
      color: OPERATIONAL_COLOR,
    });
    expectBar(bars[2]!, {
      date: "2025-01-03T00:00:00.000Z",
      hasData: true,
      color: OPERATIONAL_COLOR,
    });
  });

  test("keeps a closed disabled gap between status histories gray", () => {
    renderGraph({
      startDate: new Date("2025-01-01T00:00:00.000Z"),
      endDate: new Date("2025-01-03T00:00:00.000Z"),
      events: [
        event({
          start: "2025-01-01T00:00:00.000Z",
          end: "2025-01-02T00:00:00.000Z",
        }),
        event({
          start: "2025-01-03T00:00:00.000Z",
          end: "2025-01-04T00:00:00.000Z",
        }),
      ],
    });

    const bars: Array<HTMLElement> = getBars();
    expect(
      bars.map((bar: HTMLElement) => {
        return bar.dataset["hasData"];
      }),
    ).toEqual(["true", "false", "true"]);
    expect(bars[1]).toHaveStyle({
      backgroundColor: Gray500.toString(),
    });
    expect(
      within(getTooltipForBar(bars[1]!)).getByText(
        "No monitoring data for this day",
      ),
    ).toBeInTheDocument();
  });

  test("uses the recorded colors for operational and offline days", () => {
    renderGraph({
      startDate: new Date("2025-02-01T00:00:00.000Z"),
      endDate: new Date("2025-02-02T00:00:00.000Z"),
      events: [
        event({
          start: "2025-02-01T00:00:00.000Z",
          end: "2025-02-02T00:00:00.000Z",
        }),
        event({
          start: "2025-02-02T00:00:00.000Z",
          end: "2025-02-03T00:00:00.000Z",
          statusId: OFFLINE_STATUS_ID,
          color: OFFLINE_COLOR,
          label: "Offline",
          priority: 10,
        }),
      ],
    });

    const bars: Array<HTMLElement> = getBars();
    expectBar(bars[0]!, {
      date: "2025-02-01T00:00:00.000Z",
      hasData: true,
      color: OPERATIONAL_COLOR,
    });
    expectBar(bars[1]!, {
      date: "2025-02-02T00:00:00.000Z",
      hasData: true,
      color: OFFLINE_COLOR,
    });
  });

  test("chooses the color of the highest-priority overlapping status", () => {
    renderGraph({
      events: [
        event({
          start: "2025-01-01T01:00:00.000Z",
          end: "2025-01-01T23:00:00.000Z",
          statusId: OFFLINE_STATUS_ID,
          color: HIGH_PRIORITY_COLOR,
          label: "Critical",
          priority: 20,
        }),
        event({
          start: "2025-01-01T02:00:00.000Z",
          end: "2025-01-01T22:00:00.000Z",
          statusId: DEGRADED_STATUS_ID,
          color: LOW_PRIORITY_COLOR,
          label: "Lower priority",
          priority: 2,
        }),
      ],
    });

    expectBar(getBars()[0]!, {
      date: "2025-01-01T00:00:00.000Z",
      hasData: true,
      color: HIGH_PRIORITY_COLOR,
    });
  });

  test("applies uptime rules to covered days but never recolors a no-data day", () => {
    const rules: Array<BarChartRule> = [
      {
        uptimePercentGreaterThanOrEqualTo: 99,
        barColor: OPERATIONAL_COLOR,
      },
      {
        uptimePercentGreaterThanOrEqualTo: 75,
        barColor: DEGRADED_COLOR,
      },
      {
        uptimePercentGreaterThanOrEqualTo: 0,
        barColor: OFFLINE_COLOR,
      },
    ];

    renderGraph({
      startDate: new Date("2025-03-01T00:00:00.000Z"),
      endDate: new Date("2025-03-02T00:00:00.000Z"),
      barColorRules: rules,
      events: [
        event({
          start: "2025-03-01T00:00:00.000Z",
          end: "2025-03-01T18:00:00.000Z",
        }),
        event({
          start: "2025-03-01T18:00:00.000Z",
          end: "2025-03-02T00:00:00.000Z",
          statusId: OFFLINE_STATUS_ID,
          color: OFFLINE_COLOR,
          label: "Offline",
          priority: 10,
        }),
      ],
    });

    const bars: Array<HTMLElement> = getBars();
    expectBar(bars[0]!, {
      date: "2025-03-01T00:00:00.000Z",
      hasData: true,
      color: DEGRADED_COLOR,
    });
    expectBar(bars[1]!, {
      date: "2025-03-02T00:00:00.000Z",
      hasData: false,
      color: Gray500,
    });
  });

  test("treats a full-day event as a half-open interval at midnight", () => {
    renderGraph({
      startDate: new Date("2025-04-02T00:00:00.000Z"),
      endDate: new Date("2025-04-03T00:00:00.000Z"),
      events: [
        event({
          start: "2025-04-02T00:00:00.000Z",
          end: "2025-04-03T00:00:00.000Z",
        }),
      ],
    });

    const bars: Array<HTMLElement> = getBars();
    expect(
      bars.map((bar: HTMLElement) => {
        return bar.dataset["hasData"];
      }),
    ).toEqual(["true", "false"]);
    expect(bars[1]).toHaveStyle({
      backgroundColor: Gray500.toString(),
    });
  });

  test("does not count events that only touch either midnight boundary", () => {
    renderGraph({
      startDate: new Date("2025-04-02T00:00:00.000Z"),
      endDate: new Date("2025-04-02T00:00:00.000Z"),
      events: [
        event({
          start: "2025-04-01T12:00:00.000Z",
          end: "2025-04-02T00:00:00.000Z",
          color: OFFLINE_COLOR,
          label: "Ends at day start",
        }),
        event({
          start: "2025-04-03T00:00:00.000Z",
          end: "2025-04-03T12:00:00.000Z",
          color: OFFLINE_COLOR,
          label: "Starts at next day boundary",
        }),
      ],
    });

    expectBar(getBars()[0]!, {
      date: "2025-04-02T00:00:00.000Z",
      hasData: false,
      color: Gray500,
    });
  });

  test("treats a zero-duration status record as no data", () => {
    renderGraph({
      barColorRules: [
        {
          uptimePercentGreaterThanOrEqualTo: 0,
          barColor: OFFLINE_COLOR,
        },
      ],
      events: [
        event({
          start: "2025-01-01T12:00:00.000Z",
          end: "2025-01-01T12:00:00.000Z",
          statusId: OFFLINE_STATUS_ID,
          color: OFFLINE_COLOR,
          label: "Zero duration",
          priority: 100,
        }),
      ],
    });

    const bar: HTMLElement = getBars()[0]!;
    expectBar(bar, {
      date: "2025-01-01T00:00:00.000Z",
      hasData: false,
      color: Gray500,
    });
    expect(
      within(getTooltipForBar(bar)).getByText(
        "No monitoring data for this day",
      ),
    ).toBeInTheDocument();
    expect(
      within(getTooltipForBar(bar)).queryByText("Uptime"),
    ).not.toBeInTheDocument();
  });

  test("counts even a sub-second overlap when it has positive duration", () => {
    renderGraph({
      events: [
        event({
          start: "2025-01-01T00:00:00.000Z",
          end: "2025-01-01T00:00:00.001Z",
          color: DEGRADED_COLOR,
        }),
      ],
    });

    expectBar(getBars()[0]!, {
      date: "2025-01-01T00:00:00.000Z",
      hasData: true,
      color: DEGRADED_COLOR,
    });
  });

  test("clips event duration and the live-day boundary at millisecond precision", () => {
    const dayData: DayUptimeData = getDayUptimeData({
      date: new Date("2025-01-01T00:00:00.000Z"),
      currentDate: new Date("2025-01-01T00:00:00.300Z"),
      events: [
        event({
          start: "2025-01-01T00:00:00.200Z",
          end: "2025-01-01T00:00:00.400Z",
        }),
      ],
      defaultBarColor: Gray500,
    });

    expect(dayData.hasEvents).toBe(true);
    expect(dayData.statusDurations).toHaveLength(1);
    expect(dayData.statusDurations[0]!.seconds).toBeCloseTo(0.1, 10);
  });

  test("marks every day positively overlapped by a spanning event as data", () => {
    renderGraph({
      startDate: new Date("2025-05-01T00:00:00.000Z"),
      endDate: new Date("2025-05-03T00:00:00.000Z"),
      events: [
        event({
          start: "2025-04-30T23:00:00.000Z",
          end: "2025-05-04T01:00:00.000Z",
          color: DEGRADED_COLOR,
        }),
      ],
    });

    const bars: Array<HTMLElement> = getBars();
    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      expect(bar).toHaveAttribute("data-has-data", "true");
      expect(bar).toHaveStyle({
        backgroundColor: DEGRADED_COLOR.toString(),
      });
    }
  });

  test("keeps an incident-only day as no-data while allowing its bar to open incidents", () => {
    const incident: UptimeBarTooltipIncident = {
      id: "incident-1",
      title: "Checkout outage",
      declaredAt: new Date("2025-06-01T12:00:00.000Z"),
      monitorIds: [],
    };
    const onBarClick: ReturnType<
      typeof jest.fn<
        (date: Date, incidents: Array<UptimeBarTooltipIncident>) => void
      >
    > =
      jest.fn<
        (date: Date, incidents: Array<UptimeBarTooltipIncident>) => void
      >();

    renderGraph({
      startDate: new Date("2025-06-01T00:00:00.000Z"),
      endDate: new Date("2025-06-01T00:00:00.000Z"),
      incidents: [incident],
      onBarClick,
    });

    const bar: HTMLElement = getBars()[0]!;
    expectBar(bar, {
      date: "2025-06-01T00:00:00.000Z",
      hasData: false,
      color: Gray500,
    });
    expect(bar).toHaveClass("cursor-pointer");

    const tooltip: HTMLElement = getTooltipForBar(bar);
    expect(
      within(tooltip).getByText("No monitoring data for this day"),
    ).toBeInTheDocument();
    expect(within(tooltip).getByText("Checkout outage")).toBeInTheDocument();

    fireEvent.click(bar);

    expect(onBarClick).toHaveBeenCalledTimes(1);
    expect(onBarClick.mock.calls[0]![0].toISOString()).toBe(
      "2025-06-01T00:00:00.000Z",
    );
    expect(onBarClick.mock.calls[0]![1]).toEqual([incident]);
  });

  test("incident clicks do not bubble into the incident-only bar click", () => {
    const incident: UptimeBarTooltipIncident = {
      id: "incident-2",
      title: "API latency incident",
      declaredAt: new Date("2025-06-02T08:30:00.000Z"),
      monitorIds: [],
    };
    const onBarClick: ReturnType<
      typeof jest.fn<
        (date: Date, incidents: Array<UptimeBarTooltipIncident>) => void
      >
    > =
      jest.fn<
        (date: Date, incidents: Array<UptimeBarTooltipIncident>) => void
      >();
    const onIncidentClick: ReturnType<
      typeof jest.fn<(incidentId: string) => void>
    > = jest.fn<(incidentId: string) => void>();

    renderGraph({
      startDate: new Date("2025-06-02T00:00:00.000Z"),
      endDate: new Date("2025-06-02T00:00:00.000Z"),
      incidents: [incident],
      onBarClick,
      onIncidentClick,
    });

    fireEvent.click(screen.getByText("API latency incident"));

    expect(onIncidentClick).toHaveBeenCalledWith("incident-2");
    expect(onBarClick).not.toHaveBeenCalled();
  });
});

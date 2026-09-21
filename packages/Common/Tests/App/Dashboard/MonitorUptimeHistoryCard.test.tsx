/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The graph is stubbed to record what it is handed: the card's job is to
 * feed it the server's buckets and the project's statuses (never timeline
 * rows), and to say honestly what the strip does and does not cover. The
 * graph's own drawing is covered by the DayUptimeGraph tests.
 */

const mockGraphProps: Array<Record<string, unknown>> = [];
const mockModalProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/MonitorGraphs/Uptime", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      mockGraphProps.push(props);
      const onBarClick: (
        date: Date,
        incidents: Array<unknown>,
        summary: Record<string, unknown>,
      ) => void = props["onBarClick"] as (
        date: Date,
        incidents: Array<unknown>,
        summary: Record<string, unknown>,
      ) => void;
      const onIncidentClick: (id: string) => void = props[
        "onIncidentClick"
      ] as (id: string) => void;
      const ReactModule: typeof React = jest.requireActual(
        "react",
      ) as typeof React;

      return ReactModule.createElement(
        "div",
        { "data-testid": "uptime-graph" },
        ReactModule.createElement(
          "button",
          {
            type: "button",
            onClick: () => {
              onBarClick(new Date("2026-09-20T00:00:00.000Z"), [], {
                date: new Date("2026-09-20T00:00:00.000Z"),
                uptimePercent: 97.5,
                hasEvents: true,
                statusDurations: [],
                incidents: [],
              });
            },
          },
          "bar",
        ),
        ReactModule.createElement(
          "button",
          {
            type: "button",
            onClick: () => {
              onIncidentClick("99999999-9999-4999-8999-999999999999");
            },
          },
          "incident marker",
        ),
      );
    },
  };
});

jest.mock("../../../UI/Components/MonitorGraphs/UptimeBarDayModal", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      mockModalProps.push(props);
      const ReactModule: typeof React = jest.requireActual(
        "react",
      ) as typeof React;

      return ReactModule.createElement(
        "div",
        { "data-testid": "day-modal" },
        `Day ${String(props["uptimePercent"])}`,
      );
    },
  };
});

import MonitorUptimeHistoryCard, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorUptimeHistoryCard";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  failSection,
  forbidSection,
  getLoadingSection,
  OverviewSection,
  resolveSection,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/OverviewSection";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Route from "../../../Types/API/Route";
import { Green } from "../../../Types/BrandColors";
import {
  MonitorUptimeSummary,
  MonitorUptimeSummaryStatus,
  MonitorUptimeWindowKey,
  MonitorUptimeWindowTotal,
} from "../../../Types/Monitor/MonitorUptimeSummary";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import ObjectID from "../../../Types/ObjectID";
import { UptimeDayBucket } from "../../../Types/StatusPage/UptimeDailyAggregate";
import Navigation from "../../../UI/Utils/Navigation";

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUBJECT: string = MONITOR_ID.toString();
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const START: Date = new Date("2026-06-24T00:00:00.000Z");

const OPERATIONAL_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const DEGRADED_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OFFLINE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const STATUSES: Array<MonitorUptimeSummaryStatus> = [
  {
    id: OPERATIONAL_ID,
    name: "Operational",
    color: "#10B981",
    isOperationalState: true,
    isOfflineState: false,
    priority: 1,
  },
  {
    id: DEGRADED_ID,
    name: "Degraded",
    color: "#F59E0B",
    isOperationalState: false,
    isOfflineState: false,
    priority: 2,
  },
  {
    id: OFFLINE_ID,
    name: "Offline",
    color: "#EF4444",
    isOperationalState: false,
    isOfflineState: true,
    priority: 3,
  },
];

const BUCKETS: Array<UptimeDayBucket> = [
  {
    bucketStart: new Date("2026-09-20T00:00:00.000Z"),
    bucketEnd: new Date("2026-09-21T00:00:00.000Z"),
    daySeconds: 86400,
    coveredSeconds: 86400,
    statusDurations: [
      { monitorStatusId: OPERATIONAL_ID, seconds: 86000 },
      { monitorStatusId: OFFLINE_ID, seconds: 400 },
    ],
  },
];

const window90: (data: {
  up: number;
  down: number;
}) => MonitorUptimeWindowTotal = (data: {
  up: number;
  down: number;
}): MonitorUptimeWindowTotal => {
  return {
    key: MonitorUptimeWindowKey.Last90Days,
    startDate: START,
    endDate: NOW,
    windowSeconds: 90 * 86400 - 12 * 3600,
    coveredSeconds: data.up + data.down,
    statusDurations: [
      ...(data.up > 0
        ? [{ monitorStatusId: OPERATIONAL_ID, seconds: data.up }]
        : []),
      ...(data.down > 0
        ? [{ monitorStatusId: OFFLINE_ID, seconds: data.down }]
        : []),
    ],
  };
};

const summaryOf: (
  overrides?: Partial<MonitorUptimeSummary>,
) => MonitorUptimeSummary = (
  overrides?: Partial<MonitorUptimeSummary>,
): MonitorUptimeSummary => {
  return {
    monitorId: MONITOR_ID,
    timezone: "UTC",
    generatedAt: NOW,
    startDate: START,
    endDate: NOW,
    buckets: BUCKETS,
    // 7,776 s down of 7,732,800 s measured: 99.899...%.
    windows: [window90({ up: 90 * 86400 - 12 * 3600 - 7776, down: 7776 })],
    isComplete: true,
    completeFrom: null,
    statuses: STATUSES,
    ...overrides,
  };
};

const loaded: (
  summary: MonitorUptimeSummary,
) => OverviewSection<MonitorUptimeSummary> = (
  summary: MonitorUptimeSummary,
): OverviewSection<MonitorUptimeSummary> => {
  return resolveSection<MonitorUptimeSummary>({
    value: summary,
    subjectId: SUBJECT,
  });
};

const NO_INCIDENTS: OverviewSection<Array<UptimeBarTooltipIncident>> =
  resolveSection<Array<UptimeBarTooltipIncident>>({
    value: [],
    subjectId: SUBJECT,
  });

const renderCard: (overrides?: Partial<ComponentProps>) => RenderResult = (
  overrides?: Partial<ComponentProps>,
): RenderResult => {
  const props: ComponentProps = {
    summary: loaded(summaryOf()),
    incidents: NO_INCIDENTS,
    monitorCreatedAt: new Date("2025-01-01T00:00:00.000Z"),
    onRetry: () => {},
    ...overrides,
  };

  return render(
    <MemoryRouter>
      <MonitorUptimeHistoryCard {...props} />
    </MemoryRouter>,
  );
};

const lastGraphProps: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  const props: Record<string, unknown> | undefined =
    mockGraphProps[mockGraphProps.length - 1];

  if (!props) {
    throw new Error("The graph was never rendered");
  }

  return props;
};

const footnote: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("monitor-uptime-footnote");
};

/*
 * The strip's scroll box, which jsdom does not lay out. scrollLeft clamps
 * to what can be scrolled, the way a browser does, so setting it before the
 * content is wider than the box does nothing.
 */
interface StripLayout {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
  writes: Array<number>;
}

const installStripLayout: (layout: StripLayout) => () => void = (
  layout: StripLayout,
): (() => void) => {
  Object.defineProperty(HTMLDivElement.prototype, "scrollWidth", {
    configurable: true,
    get: (): number => {
      return layout.scrollWidth;
    },
  });
  Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
    configurable: true,
    get: (): number => {
      return layout.clientWidth;
    },
  });
  Object.defineProperty(HTMLDivElement.prototype, "scrollLeft", {
    configurable: true,
    get: (): number => {
      return layout.scrollLeft;
    },
    set: (value: number): void => {
      layout.writes.push(value);
      layout.scrollLeft = Math.max(
        0,
        Math.min(value, layout.scrollWidth - layout.clientWidth),
      );
    },
  });

  return (): void => {
    for (const property of ["scrollWidth", "clientWidth", "scrollLeft"]) {
      delete (HTMLDivElement.prototype as unknown as Record<string, unknown>)[
        property
      ];
    }
  };
};

/*
 * A ResizeObserver whose callbacks a test fires by hand. Like the real one,
 * a disconnected observer is never called again.
 */
interface FakeResizeObserver {
  observed: Array<Element>;
  disconnectCount: () => number;
  trigger: () => void;
  restore: () => void;
}

const installResizeObserver: () => FakeResizeObserver =
  (): FakeResizeObserver => {
    const original: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(window, "ResizeObserver");
    const observed: Array<Element> = [];
    const callbacks: Array<ResizeObserverCallback> = [];
    const instances: Array<ResizeObserver> = [];
    const disconnected: Set<ResizeObserver> = new Set<ResizeObserver>();

    class TestResizeObserver implements ResizeObserver {
      public constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
        instances.push(this);
      }
      public observe(target: Element): void {
        observed.push(target);
      }
      public unobserve(): void {
        return;
      }
      public disconnect(): void {
        disconnected.add(this);
      }
    }

    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: TestResizeObserver,
    });

    return {
      observed: observed,
      disconnectCount: (): number => {
        return disconnected.size;
      },
      trigger: (): void => {
        act((): void => {
          for (let index: number = 0; index < callbacks.length; index++) {
            const instance: ResizeObserver = instances[index] as ResizeObserver;

            if (!disconnected.has(instance)) {
              callbacks[index]?.([], instance);
            }
          }
        });
      },
      restore: (): void => {
        if (original) {
          Object.defineProperty(window, "ResizeObserver", original);
        } else {
          delete (window as unknown as { ResizeObserver?: unknown })
            .ResizeObserver;
        }
      },
    };
  };

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  mockGraphProps.length = 0;
  mockModalProps.length = 0;
});

describe("MonitorUptimeHistoryCard", () => {
  test("hands the graph the server's buckets and statuses, and no timeline rows", () => {
    renderCard({});

    const props: Record<string, unknown> = lastGraphProps();

    expect(props["items"]).toEqual([]);
    expect(props["uptimeBuckets"]).toBe(BUCKETS);
    expect(props["defaultBarColor"]).toBe(Green);

    const statuses: Array<MonitorStatus> = props[
      "monitorStatuses"
    ] as Array<MonitorStatus>;
    expect(
      statuses.map((status: MonitorStatus) => {
        return [
          status.id?.toString(),
          status.name,
          status.color?.toString(),
          status.priority,
        ];
      }),
    ).toEqual([
      [OPERATIONAL_ID.toString(), "Operational", "#10B981", 1],
      [DEGRADED_ID.toString(), "Degraded", "#F59E0B", 2],
      [OFFLINE_ID.toString(), "Offline", "#EF4444", 3],
    ]);

    // Degraded is downtime too: anything not marked operational.
    expect(
      (props["downtimeMonitorStatuses"] as Array<MonitorStatus>).map(
        (status: MonitorStatus) => {
          return status.name;
        },
      ),
    ).toEqual(["Degraded", "Offline"]);
  });

  test("uses the summary's own start and end dates", () => {
    renderCard({});

    expect(lastGraphProps()["startDate"]).toBe(START);
    expect(lastGraphProps()["endDate"]).toBe(NOW);
  });

  test("the status models are kept across re-renders of the same summary", () => {
    const summary: OverviewSection<MonitorUptimeSummary> = loaded(summaryOf());
    const view: RenderResult = renderCard({ summary: summary });
    const first: unknown = lastGraphProps()["monitorStatuses"];

    view.rerender(
      <MemoryRouter>
        <MonitorUptimeHistoryCard
          summary={summary}
          incidents={NO_INCIDENTS}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    );

    expect(lastGraphProps()["monitorStatuses"]).toBe(first);
  });

  test("while loading there is a skeleton and no 90-day figure", () => {
    renderCard({ summary: getLoadingSection<MonitorUptimeSummary>() });

    expect(screen.getByTestId("monitor-uptime-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-uptime-90d")).toBeNull();
    expect(screen.queryByTestId("uptime-graph")).toBeNull();
  });

  test("the 90-day figure sits in the header", () => {
    renderCard({});

    expect(screen.getByTestId("monitor-uptime-90d")).toHaveTextContent(
      "99.899% over 90 days",
    );
  });

  test("a partly covered 90 days names the time it was measured over", () => {
    // Created 12 days and 3 hours ago, with 53 minutes down since.
    const coveredSeconds: number = 12 * 86400 + 3 * 3600;
    const downSeconds: number = 53 * 60;

    renderCard({
      summary: loaded(
        summaryOf({
          windows: [
            window90({ up: coveredSeconds - downSeconds, down: downSeconds }),
          ],
        }),
      ),
      monitorCreatedAt: new Date("2026-09-09T09:00:00.000Z"),
    });

    const figure: HTMLElement = screen.getByTestId("monitor-uptime-90d");
    expect(figure).toHaveTextContent("99.696% measured over 12d 3h");
    expect(figure).not.toHaveTextContent("90 days");
  });

  test("a monitor with nothing recorded in 90 days says 'No data yet', not 100%", () => {
    renderCard({
      summary: loaded(summaryOf({ windows: [window90({ up: 0, down: 0 })] })),
    });

    const figure: HTMLElement = screen.getByTestId("monitor-uptime-90d");
    expect(figure).toHaveTextContent("No data yet");
    expect(figure).not.toHaveTextContent("%");
  });

  test("the strip scrolls inside its card on a phone", () => {
    renderCard({});

    const strip: HTMLElement = screen.getByTestId("monitor-uptime-strip");
    expect(strip).toHaveClass("overflow-x-auto", "pb-1");
    expect(strip.firstElementChild).toHaveClass("min-w-[36rem]", "sm:min-w-0");
    expect(strip).toContainElement(screen.getByTestId("uptime-graph"));
  });

  test("the strip starts scrolled to today", () => {
    const scrollLeftWrites: MockFunction = getJestMockFunction();

    Object.defineProperty(HTMLDivElement.prototype, "scrollWidth", {
      configurable: true,
      get: (): number => {
        return 1440;
      },
    });
    Object.defineProperty(HTMLDivElement.prototype, "scrollLeft", {
      configurable: true,
      get: (): number => {
        return 0;
      },
      set: (value: number): void => {
        scrollLeftWrites(value);
      },
    });

    try {
      renderCard({});
      expect(scrollLeftWrites).toHaveBeenCalledWith(1440);
    } finally {
      delete (HTMLDivElement.prototype as unknown as Record<string, unknown>)[
        "scrollWidth"
      ];
      delete (HTMLDivElement.prototype as unknown as Record<string, unknown>)[
        "scrollLeft"
      ];
    }
  });

  test("the strip still starts at today when its width arrives after the first layout", () => {
    /*
     * Production compiles Tailwind classes in the browser after React's
     * layout effects, so on a phone the strip first lays out with no
     * min-width: the bars fit and there is nothing to scroll. Then the
     * 36rem arrives and the strip overflows.
     */
    const layout: StripLayout = {
      scrollWidth: 358,
      clientWidth: 358,
      scrollLeft: 0,
      writes: [],
    };
    const restoreLayout: () => void = installStripLayout(layout);
    const resizeObserver: FakeResizeObserver = installResizeObserver();

    try {
      renderCard({});

      const strip: HTMLElement = screen.getByTestId("monitor-uptime-strip");
      expect(resizeObserver.observed).toEqual(
        expect.arrayContaining([strip, strip.firstElementChild]),
      );
      expect(layout.scrollLeft).toBe(0);

      layout.scrollWidth = 576;
      resizeObserver.trigger();

      expect(layout.scrollLeft).toBe(576 - 358);
    } finally {
      resizeObserver.restore();
      restoreLayout();
    }
  });

  test("once the reader scrolls back in time, a resize leaves the strip where they put it", () => {
    const layout: StripLayout = {
      scrollWidth: 576,
      clientWidth: 358,
      scrollLeft: 0,
      writes: [],
    };
    const restoreLayout: () => void = installStripLayout(layout);
    const resizeObserver: FakeResizeObserver = installResizeObserver();

    try {
      renderCard({});

      const strip: HTMLElement = screen.getByTestId("monitor-uptime-strip");
      expect(layout.scrollLeft).toBe(218);

      // The scroll event the card's own scroll fires is not the reader.
      fireEvent.scroll(strip);
      layout.clientWidth = 300;
      resizeObserver.trigger();
      expect(layout.scrollLeft).toBe(276);

      // The reader scrolls back to August.
      layout.scrollLeft = 40;
      fireEvent.scroll(strip);
      const writesBefore: number = layout.writes.length;

      layout.clientWidth = 358;
      resizeObserver.trigger();
      expect(layout.writes).toHaveLength(writesBefore);
      expect(layout.scrollLeft).toBe(40);

      // Scrolling back to today pins it to today again.
      layout.scrollLeft = 218;
      fireEvent.scroll(strip);
      layout.scrollWidth = 600;
      resizeObserver.trigger();
      expect(layout.scrollLeft).toBe(600 - 358);
    } finally {
      resizeObserver.restore();
      restoreLayout();
    }
  });

  test("the strip stops observing its size when the card goes", () => {
    const resizeObserver: FakeResizeObserver = installResizeObserver();

    try {
      const view: RenderResult = renderCard({});
      expect(resizeObserver.disconnectCount()).toBe(0);

      view.unmount();
      expect(resizeObserver.disconnectCount()).toBe(1);
    } finally {
      resizeObserver.restore();
    }
  });

  test("the legend lists the statuses that took time, then No data", () => {
    renderCard({});

    const legend: HTMLElement = screen.getByRole("list", { name: "Legend" });
    const items: Array<HTMLElement> = within(legend).getAllByRole("listitem");

    expect(
      items.map((item: HTMLElement) => {
        return item.textContent;
      }),
    ).toEqual(["Operational", "Offline", "No data"]);

    // Degraded had no time, so it is not in the legend.
    expect(legend).not.toHaveTextContent("Degraded");

    const noDataDot: HTMLElement = items[2]!.querySelector(
      "span",
    ) as HTMLElement;
    expect(noDataDot.style.backgroundColor).toBe("rgb(156, 163, 175)");
    const operationalDot: HTMLElement = items[0]!.querySelector(
      "span",
    ) as HTMLElement;
    expect(operationalDot.style.backgroundColor).toBe("rgb(16, 185, 129)");
  });

  test("the footnote explains downtime", () => {
    renderCard({});

    expect(footnote()).toHaveTextContent(
      "Downtime counts time in every status that isn't marked operational.",
    );
    expect(footnote()).not.toHaveTextContent("earlier days have no data");
    expect(footnote()).not.toHaveTextContent("Incident markers");
    expect(footnote()).not.toHaveTextContent("incomplete");
  });

  test("a monitor younger than the strip says its earlier days have no data", () => {
    renderCard({ monitorCreatedAt: new Date("2026-09-01T12:00:00.000Z") });

    expect(footnote()).toHaveTextContent(
      "This monitor was created 20 days ago; earlier days have no data.",
    );
    expect(footnote().querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-09-01T12:00:00.000Z",
    );
  });

  test.each(["error", "forbidden"])(
    "an incident overlay that is %s says the markers are unavailable",
    (status: string) => {
      const incidents: OverviewSection<Array<UptimeBarTooltipIncident>> =
        status === "error"
          ? failSection<Array<UptimeBarTooltipIncident>>({
              previous: getLoadingSection<Array<UptimeBarTooltipIncident>>(),
              message: "Boom",
              subjectId: SUBJECT,
            })
          : forbidSection<Array<UptimeBarTooltipIncident>>({
              reason: "No access",
              subjectId: SUBJECT,
            });

      renderCard({ incidents: incidents });

      expect(footnote()).toHaveTextContent("Incident markers are unavailable.");
      expect(lastGraphProps()["incidents"]).toEqual([]);
    },
  );

  test("an incomplete history says from when it can be trusted", () => {
    renderCard({
      summary: loaded(
        summaryOf({
          isComplete: false,
          completeFrom: new Date("2026-08-01T00:00:00.000Z"),
        }),
      ),
    });

    expect(footnote()).toHaveTextContent("History before");
    expect(footnote()).toHaveTextContent("is incomplete.");
  });

  test("forbidden history says so, with no strip and no figure", () => {
    renderCard({
      summary: forbidSection<MonitorUptimeSummary>({
        reason: "No access",
        subjectId: SUBJECT,
      }),
    });

    expect(screen.getByText("Uptime history is hidden")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You need permission to read this monitor's status timeline.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("uptime-graph")).toBeNull();
    expect(screen.queryByTestId("monitor-uptime-90d")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  test("a failed load says why, and Try again calls onRetry", () => {
    const onRetry: MockFunction = getJestMockFunction();

    renderCard({
      summary: failSection<MonitorUptimeSummary>({
        previous: getLoadingSection<MonitorUptimeSummary>(),
        message: "The uptime summary could not be read.",
        subjectId: SUBJECT,
      }),
      onRetry: onRetry,
    });

    expect(
      screen.getByText("Couldn't load uptime history"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The uptime summary could not be read."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-uptime-90d")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("clicking a bar opens the day dialog with that day's reading", () => {
    renderCard({});

    expect(screen.queryByTestId("day-modal")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "bar" }));

    expect(screen.getByTestId("day-modal")).toHaveTextContent("Day 97.5");
    const modalProps: Record<string, unknown> =
      mockModalProps[mockModalProps.length - 1]!;
    expect(modalProps["date"]).toEqual(new Date("2026-09-20T00:00:00.000Z"));
    expect(modalProps["hasEvents"]).toBe(true);
  });

  test("an incident marker opens that incident", () => {
    const navigate: MockFunction = getJestMockFunction();
    jest.spyOn(Navigation, "navigate").mockImplementation(navigate);

    renderCard({});
    fireEvent.click(screen.getByRole("button", { name: "incident marker" }));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect((navigate.mock.calls[0]![0] as Route).toString()).toBe(
      RouteUtil.populateRouteParams(RouteMap[PageMap.INCIDENT_VIEW] as Route, {
        modelId: new ObjectID("99999999-9999-4999-8999-999999999999"),
      }).toString(),
    );
  });

  test("the card's copy says what a bar is and what grey means", () => {
    renderCard({});

    expect(
      screen.getByRole("heading", { name: "Uptime history" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "One bar per day for the last 90 days, in your time zone. Grey bars are days with no data.",
      ),
    ).toBeInTheDocument();
  });
});

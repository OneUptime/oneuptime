/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * Issue #4105 on the Docker and Podman host Overview pages: a drag across
 * any of the six charts (Availability, Avg/Peak CPU, Avg/Peak Memory,
 * Network) zooms the WHOLE page to the window dragged out - every chart,
 * the summary tiles, the hero's container count, the uptime badge and the
 * Top consumer lists are fetched again for it - and a double-click on any
 * chart (or Reset zoom beside the hero's picker) puts back the range from
 * before the first zoom.
 *
 * The pages are rendered for real over a fake analytics server that only
 * answers with the rows inside the window it is asked for, so what the
 * tiles and lists show proves which window they were computed from. Only
 * the chart itself is stood in for (see ContainerChartZoomStandIn): it
 * resolves its zoom exactly the way LineChartElement does and offers the
 * two gestures.
 */

/*
 * Function declarations, so they are hoisted along with the jest.mock calls
 * that use them. They are only called at render time.
 */
function mockStubModule(testId: string): {
  __esModule: boolean;
  default: () => ReactElement;
} {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div", { "data-testid": testId });
    },
  };
}

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return (
    jest.requireActual(
      "./ContainerChartZoomStandIn",
    ) as typeof import("./ContainerChartZoomStandIn")
  ).chartModuleStandIn(
    "line",
    jest.requireActual("../../../UI/Components/Charts/Line/LineChart"),
  );
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return mockStubModule("stub-activity-cards");
  },
);
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return mockStubModule("stub-host-details");
});

import DockerHostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Overview";
import PodmanHostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import Route from "../../../Types/API/Route";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { ChartTimeRangeZoomHandlers } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import {
  CHART_STAND_IN_TEST_ID,
  doubleClickChart,
  dragAcrossChart,
  resetChartStandIns,
  windowOfChart,
  windowText,
  zoomOfChart,
} from "./ContainerChartZoomStandIn";

/*
 * ---------------------------------------------------------------------------
 * A fake analytics server
 * ---------------------------------------------------------------------------
 */

const NOW: Date = new Date("2026-09-24T12:00:00.000Z");
const HOST_ID: string = "5a1b2c3d-4e5f-4061-8273-94a5b6c7d8e9";
const PROJECT_ID: ObjectID = new ObjectID(
  "7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
);

const CHART_TITLES: Array<string> = [
  "Availability",
  "Avg CPU",
  "Peak CPU",
  "Avg Memory",
  "Peak Memory",
  "Network",
];

const pageProps: PageComponentProps = {
  pageRoute: new Route("/overview"),
  currentProject: null,
  hasPaymentMethod: false,
};

function at(hhmm: string): Date {
  return new Date(`2026-09-24T${hhmm}:00.000Z`);
}

function minutesBetween(from: string, to: string): Array<string> {
  const out: Array<string> = [];

  for (
    let time: number = at(from).getTime();
    time <= at(to).getTime();
    time += 60_000
  ) {
    out.push(new Date(time).toISOString().slice(11, 16));
  }

  return out;
}

function bucket(
  hhmm: string,
  container: string,
  value: number,
): AggregatedModel {
  return {
    timestamp: at(hhmm),
    value: value,
    attributes: { "resource.container.name": container },
  };
}

/*
 * The default range is the past 30 minutes: 11:30 to 12:00. The tiles read
 * the last 5 minutes of whatever range the page is on.
 *
 * - "api" runs all along: 10% CPU early, 80% from 11:45 to 11:50, 20% after.
 * - "batch" only ran from 11:40 to 11:48.
 * - The agent missed its 11:35 and 11:36 heartbeats: two minutes down.
 * - No network counters at all, so the Network chart is empty.
 *
 * On the default range the tiles read 11:55-12:00 (api alone, at 20%); on
 * the 11:40-11:50 window they read 11:45-11:50 (api at 80%, and batch).
 */
function cpuValue(hhmm: string): number {
  if (hhmm < "11:45") {
    return 10;
  }

  return hhmm <= "11:50" ? 80 : 20;
}

const FIXTURE: Record<string, Array<AggregatedModel>> = {
  "container.cpu.utilization": [
    ...minutesBetween("11:31", "12:00").map((hhmm: string): AggregatedModel => {
      return bucket(hhmm, "api", cpuValue(hhmm));
    }),
    ...minutesBetween("11:40", "11:48").map((hhmm: string): AggregatedModel => {
      return bucket(hhmm, "batch", 50);
    }),
  ],
  "container.memory.percent": [
    ...minutesBetween("11:31", "12:00").map((hhmm: string): AggregatedModel => {
      return bucket(hhmm, "api", 30);
    }),
    ...minutesBetween("11:40", "11:48").map((hhmm: string): AggregatedModel => {
      return bucket(hhmm, "batch", 60);
    }),
  ],
  "container.pids.count": minutesBetween("11:31", "12:00").map(
    (hhmm: string): AggregatedModel => {
      return bucket(hhmm, "api", 7);
    },
  ),
  "oneuptime.host.heartbeat": minutesBetween("11:31", "12:00")
    .filter((hhmm: string): boolean => {
      return hhmm !== "11:35" && hhmm !== "11:36";
    })
    .map((hhmm: string): AggregatedModel => {
      return { timestamp: at(hhmm), value: 2 };
    }),
};

interface AggregateRequest {
  aggregateBy: {
    query: {
      name: string;
      time: InBetween<Date>;
    };
    startTimestamp: Date;
    endTimestamp: Date;
  };
}

interface PendingAggregate {
  request: AggregateRequest;
  answer: () => void;
}

let aggregateRequests: Array<AggregateRequest>;
let pendingAggregates: Array<PendingAggregate>;
let answerAtOnce: boolean;

// Only the rows inside the window asked for, as the real server does.
function rowsFor(request: AggregateRequest): Array<AggregatedModel> {
  const startMs: number = request.aggregateBy.query.time.startValue.getTime();
  const endMs: number = request.aggregateBy.query.time.endValue.getTime();

  return (FIXTURE[request.aggregateBy.query.name] || []).filter(
    (row: AggregatedModel): boolean => {
      const time: number = (row["timestamp"] as Date).getTime();

      return time >= startMs && time <= endMs;
    },
  );
}

function serveAnalytics(): void {
  jest
    .spyOn(AnalyticsModelAPI, "aggregate")
    .mockImplementation((...args: Array<unknown>): Promise<never> => {
      const request: AggregateRequest = args[0] as AggregateRequest;
      aggregateRequests.push(request);

      return new Promise<never>((resolve: (value: never) => void): void => {
        const answer: () => void = (): void => {
          resolve({ data: rowsFor(request) } as never);
        };

        if (answerAtOnce) {
          answer();
          return;
        }

        pendingAggregates.push({ request: request, answer: answer });
      });
    });
}

interface RuntimeCase {
  Overview: React.FunctionComponent<PageComponentProps>;
  refreshStorageKey: string;
  buildHost: () => DockerHost | PodmanHost;
}

function fillHost<T extends DockerHost | PodmanHost>(host: T): T {
  host._id = HOST_ID;
  host.name = "web-01";
  host.hostIdentifier = "web-01";
  host.otelCollectorStatus = "connected";
  host.osType = "linux";
  host.lastSeenAt = NOW;
  return host;
}

const RUNTIME_CASES: Array<[string, RuntimeCase]> = [
  [
    "Docker",
    {
      Overview: DockerHostOverview,
      refreshStorageKey: "docker-overview-auto-refresh-interval",
      buildHost: (): DockerHost => {
        return fillHost(new DockerHost());
      },
    },
  ],
  [
    "Podman",
    {
      Overview: PodmanHostOverview,
      refreshStorageKey: "podman-overview-auto-refresh-interval",
      buildHost: (): PodmanHost => {
        return fillHost(new PodmanHost());
      },
    },
  ],
];

/*
 * ---------------------------------------------------------------------------
 * Reading the page
 * ---------------------------------------------------------------------------
 */

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

// Each chart section's heading, and the charts in it.
const SECTIONS: Array<[string, Array<string>]> = [
  ["Availability", ["Availability"]],
  [
    "Container resource usage",
    ["Avg CPU", "Peak CPU", "Avg Memory", "Peak Memory"],
  ],
  ["Network", ["Network"]],
];

// A chart section: its heading row (with the zoom hint) and its cards.
function section(heading: string): HTMLElement {
  return screen
    .getByRole("heading", { level: 2, name: heading })
    .closest("div.group") as HTMLElement;
}

function hintOf(heading: string): HTMLElement {
  return within(section(heading)).getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID);
}

// The card a chart sits in, found by the chart's title.
function chartCard(title: string): HTMLElement {
  const cards: Array<HTMLElement> = screen
    .getAllByText(title, { selector: "span" })
    .map((span: HTMLElement): HTMLElement | null => {
      return span.closest("div.rounded-xl");
    })
    .filter((card: HTMLElement | null): card is HTMLElement => {
      return (
        card !== null &&
        within(card).queryByTestId(CHART_STAND_IN_TEST_ID) !== null
      );
    });

  expect(cards).toHaveLength(1);

  return cards[0]!;
}

function chart(title: string): HTMLElement {
  return within(chartCard(title)).getByTestId(CHART_STAND_IN_TEST_ID);
}

function zoomOf(title: string): ChartTimeRangeZoomHandlers {
  return zoomOfChart(chart(title));
}

function windowOf(title: string): string {
  return windowOfChart(chart(title));
}

function tileValue(title: string): string {
  const tile: HTMLElement = screen
    .getAllByRole("button", { name: `About ${title}` })[0]!
    .closest("div.rounded-xl") as HTMLElement;

  return (tile.querySelector("div.text-2xl")?.textContent || "").trim();
}

function consumerRows(listTitle: string): Array<string> {
  const heading: HTMLElement = screen
    .getAllByRole("button", { name: `About ${listTitle}` })[0]!
    .closest("h2") as HTMLElement;
  let card: HTMLElement | null = heading.parentElement;

  while (card && !card.querySelector(".divide-y")) {
    card = card.parentElement;
  }

  const list: HTMLElement = card!.querySelector(".divide-y") as HTMLElement;

  return Array.from(list.children).map((row: Element): string => {
    return Array.from(row.children)
      .map((part: Element): string => {
        return (part.textContent || "").trim();
      })
      .join(" ");
  });
}

function pickerLabel(): string {
  return (
    screen.getByTestId("telemetry-time-range-picker-button").textContent || ""
  ).trim();
}

function customLabel(start: Date, end: Date): string {
  return getTimeRangeButtonLabel({
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(start, end),
  });
}

function resetButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

// Every aggregate asked for since the given count, as [start, end] ISO pairs.
function windowsAskedSince(count: number): Array<string> {
  return aggregateRequests
    .slice(count)
    .map((request: AggregateRequest): string => {
      return windowText(
        request.aggregateBy.query.time.startValue,
        request.aggregateBy.query.time.endValue,
      );
    });
}

async function dragAcross(
  title: string,
  start: Date,
  end: Date,
): Promise<void> {
  dragAcrossChart(chart(title), start, end);
  await flush();
}

async function doubleClick(title: string): Promise<void> {
  doubleClickChart(chart(title));
  await flush();
}

async function renderPage(runtimeCase: RuntimeCase): Promise<void> {
  jest.spyOn(ModelAPI, "getItem").mockImplementation((): Promise<never> => {
    return Promise.resolve(runtimeCase.buildHost() as never);
  });

  render(<runtimeCase.Overview {...pageProps} />);
  await flush();
}

const FULL_START: Date = at("11:30");
const FULL_END: Date = NOW;
const ZOOM_START: Date = at("11:40");
const ZOOM_END: Date = at("11:50");

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  aggregateRequests = [];
  pendingAggregates = [];
  answerAtOnce = true;
  resetChartStandIns();

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(HOST_ID);
    });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  serveAnalytics();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe.each(RUNTIME_CASES)(
  "%s host overview drag-to-zoom",
  (_name: string, runtimeCase: RuntimeCase) => {
    beforeEach(() => {
      // No countdown ring or refresh timer unless a test asks for one.
      window.localStorage.setItem(runtimeCase.refreshStorageKey, "off");
    });

    test("all six charts take one and the same page zoom, and name the gesture", async () => {
      await renderPage(runtimeCase);

      const zooms: Array<ChartTimeRangeZoomHandlers> = CHART_TITLES.map(
        (title: string): ChartTimeRangeZoomHandlers => {
          return zoomOf(title);
        },
      );

      for (const zoom of zooms) {
        expect(zoom.onTimeRangeSelect).toBeInstanceOf(Function);
        // Nothing to undo yet, so no chart holds its clicks for a reset.
        expect(zoom.onTimeRangeReset).toBeUndefined();
        // One zoom, the page's: a drag on any chart retimes all of them.
        expect(zoom.onTimeRangeSelect).toBe(zooms[0]!.onTimeRangeSelect);
      }

      for (const [heading, titles] of SECTIONS) {
        const hint: HTMLElement = hintOf(heading);

        expect(hint).toHaveTextContent("Drag to zoom");
        expect(hint).not.toHaveTextContent("double-click");
        // Shown while the pointer is over the section, on screens that hover.
        expect(hint).toHaveClass(
          "opacity-0",
          "group-hover:opacity-100",
          "max-lg:hidden",
        );
        // In the section's heading row, beside its title...
        expect(hint.parentElement).toContainElement(
          screen.getByRole("heading", { level: 2, name: heading }),
        );

        /*
         * ...and not in the cards: four of them share a row, and a hint in
         * their narrow headers pushed the titles onto two lines.
         */
        for (const title of titles) {
          expect(section(heading)).toContainElement(chartCard(title));
          expect(chartCard(title)).not.toHaveClass("group");
          expect(
            within(chartCard(title)).queryByTestId(
              TIME_RANGE_ZOOM_HINT_TEST_ID,
            ),
          ).toBeNull();
        }
      }

      // One hint per chart section; the tiles and lists carry none.
      expect(screen.getAllByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveLength(
        SECTIONS.length,
      );
      expect(pickerLabel()).toBe("Past 30 Minutes");
      expect(resetButtons()).toHaveLength(0);
    });

    test("before the drag, everything reads the past 30 minutes", async () => {
      await renderPage(runtimeCase);

      expect(new Set(windowsAskedSince(0))).toEqual(
        new Set([windowText(FULL_START, FULL_END)]),
      );
      expect(aggregateRequests).toHaveLength(6);

      for (const title of CHART_TITLES) {
        expect(windowOf(title)).toBe(windowText(FULL_START, FULL_END));
      }

      expect(tileValue("Avg CPU")).toBe("20.0%");
      expect(tileValue("Containers")).toBe("1");
      expect(consumerRows("Top CPU Consumers")).toEqual(["api 20.0%"]);
      expect(screen.queryByText("1 container")).toBeInTheDocument();
      // The two missed heartbeat minutes are in this range.
      expect(screen.queryByText("100.0% uptime")).not.toBeInTheDocument();
    });

    test("a drag on one chart retimes the whole page: every query, chart, tile, list and the badge", async () => {
      await renderPage(runtimeCase);
      const asked: number = aggregateRequests.length;

      await dragAcross("Peak Memory", ZOOM_START, ZOOM_END);

      // All six queries went out again, every one for the dragged window.
      expect(windowsAskedSince(asked)).toEqual(
        new Array(6).fill(windowText(ZOOM_START, ZOOM_END)),
      );
      for (const request of aggregateRequests.slice(asked)) {
        expect(request.aggregateBy.startTimestamp.toISOString()).toBe(
          ZOOM_START.toISOString(),
        );
        expect(request.aggregateBy.endTimestamp.toISOString()).toBe(
          ZOOM_END.toISOString(),
        );
      }

      // Every chart, not only the one dragged, now draws that window.
      for (const title of CHART_TITLES) {
        expect(windowOf(title)).toBe(windowText(ZOOM_START, ZOOM_END));
      }

      /*
       * The tiles read the last 5 minutes of the NEW range, 11:45-11:50:
       * (api 80 + batch 50) / 2 = 65 in four slots, api's 80 alone in two,
       * so (4 x 65 + 2 x 80) / 6 = 70. Memory: (4 x 45 + 2 x 30) / 6 = 40.
       */
      expect(tileValue("Avg CPU")).toBe("70.0%");
      expect(tileValue("Peak CPU")).toBe("80.0%");
      expect(tileValue("Avg Memory")).toBe("40.0%");
      expect(tileValue("Containers")).toBe("2");
      expect(screen.getByText("2 containers")).toBeInTheDocument();
      expect(consumerRows("Top CPU Consumers")).toEqual([
        "api 80.0%",
        "batch 50.0%",
      ]);
      expect(consumerRows("Top Memory Consumers")).toEqual([
        "batch 60.0%",
        "api 30.0%",
      ]);
      // No heartbeat was missed between 11:40 and 11:50.
      expect(screen.getByText("100.0% uptime")).toBeInTheDocument();

      // The picker says where the page is, and offers the way back.
      expect(pickerLabel()).toBe(customLabel(ZOOM_START, ZOOM_END));
      expect(resetButtons()).toHaveLength(1);
    });

    test("once zoomed, every chart offers the double-click and says so", async () => {
      await renderPage(runtimeCase);

      await dragAcross("Avg CPU", ZOOM_START, ZOOM_END);

      for (const title of CHART_TITLES) {
        expect(zoomOf(title).onTimeRangeReset).toBeInstanceOf(Function);
      }
      for (const [heading] of SECTIONS) {
        expect(hintOf(heading)).toHaveTextContent(
          "Drag to zoom · double-click to reset",
        );
      }
    });

    test("a double-click on a DIFFERENT chart puts the original range back", async () => {
      await renderPage(runtimeCase);

      await dragAcross("Peak CPU", ZOOM_START, ZOOM_END);
      const asked: number = aggregateRequests.length;

      await doubleClick("Availability");

      expect(windowsAskedSince(asked)).toEqual(
        new Array(6).fill(windowText(FULL_START, FULL_END)),
      );
      for (const title of CHART_TITLES) {
        expect(windowOf(title)).toBe(windowText(FULL_START, FULL_END));
        expect(zoomOf(title).onTimeRangeReset).toBeUndefined();
      }
      expect(tileValue("Avg CPU")).toBe("20.0%");
      expect(consumerRows("Top CPU Consumers")).toEqual(["api 20.0%"]);
      // Back on the relative preset, so auto-refresh slides again.
      expect(pickerLabel()).toBe("Past 30 Minutes");
      expect(resetButtons()).toHaveLength(0);
    });

    test("after zooming twice, ONE double-click returns to the original range", async () => {
      await renderPage(runtimeCase);

      await dragAcross("Avg CPU", at("11:35"), at("11:55"));
      await dragAcross("Avg Memory", ZOOM_START, ZOOM_END);

      expect(pickerLabel()).toBe(customLabel(ZOOM_START, ZOOM_END));
      const asked: number = aggregateRequests.length;

      await doubleClick("Network");

      expect(windowsAskedSince(asked)).toEqual(
        new Array(6).fill(windowText(FULL_START, FULL_END)),
      );
      expect(pickerLabel()).toBe("Past 30 Minutes");
      expect(resetButtons()).toHaveLength(0);
    });

    test("Reset zoom beside the picker does what a double-click does", async () => {
      await renderPage(runtimeCase);

      await dragAcross("Network", ZOOM_START, ZOOM_END);
      const asked: number = aggregateRequests.length;

      fireEvent.click(resetButtons()[0]!);
      await flush();

      expect(windowsAskedSince(asked)).toEqual(
        new Array(6).fill(windowText(FULL_START, FULL_END)),
      );
      expect(pickerLabel()).toBe("Past 30 Minutes");
      expect(resetButtons()).toHaveLength(0);
      for (const title of CHART_TITLES) {
        expect(windowOf(title)).toBe(windowText(FULL_START, FULL_END));
      }
    });

    test("the empty Network chart still takes the drag and the double-click", async () => {
      await renderPage(runtimeCase);

      // No counters were reported, so the chart has nothing to draw...
      expect(chart("Network").getAttribute("data-series")).toBe("");

      // ...yet it zooms the page, and gets the page back.
      await dragAcross("Network", ZOOM_START, ZOOM_END);
      expect(windowOf("Avg CPU")).toBe(windowText(ZOOM_START, ZOOM_END));

      await doubleClick("Network");
      expect(windowOf("Avg CPU")).toBe(windowText(FULL_START, FULL_END));
    });

    test("picking a range in the picker ends the zoom instead of stacking on it", async () => {
      await renderPage(runtimeCase);

      await dragAcross("Peak Memory", ZOOM_START, ZOOM_END);

      fireEvent.click(screen.getByTestId("telemetry-time-range-picker-button"));
      const asked: number = aggregateRequests.length;
      fireEvent.click(screen.getByRole("button", { name: "Past 1 Hour" }));
      await flush();

      expect(windowsAskedSince(asked)).toEqual(
        new Array(6).fill(windowText(at("11:00"), NOW)),
      );
      expect(pickerLabel()).toBe("Past 1 Hour");
      expect(resetButtons()).toHaveLength(0);
      for (const title of CHART_TITLES) {
        expect(zoomOf(title).onTimeRangeReset).toBeUndefined();
      }

      // And a later zoom returns to the hour just picked, not to 30 minutes.
      await dragAcross("Avg CPU", ZOOM_START, ZOOM_END);
      await doubleClick("Peak CPU");
      expect(pickerLabel()).toBe("Past 1 Hour");
    });

    test("a drag that runs past the end of the range is cut off at its end", async () => {
      await renderPage(runtimeCase);
      const asked: number = aggregateRequests.length;

      // The newest bucket is still filling: taken whole it reaches past now.
      await dragAcross("Avg CPU", at("11:55"), at("12:05"));

      expect(windowsAskedSince(asked)).toEqual(
        new Array(6).fill(windowText(at("11:55"), NOW)),
      );
    });

    test("a drag right-to-left zooms to the same window", async () => {
      await renderPage(runtimeCase);
      const asked: number = aggregateRequests.length;

      await dragAcross("Avg CPU", ZOOM_END, ZOOM_START);

      expect(windowsAskedSince(asked)).toEqual(
        new Array(6).fill(windowText(ZOOM_START, ZOOM_END)),
      );
    });

    test("a drag that never left its bucket, or a stray double-click, does nothing", async () => {
      await renderPage(runtimeCase);
      const asked: number = aggregateRequests.length;

      await dragAcross("Avg CPU", ZOOM_START, ZOOM_START);
      await doubleClick("Avg CPU");

      expect(aggregateRequests).toHaveLength(asked);
      expect(pickerLabel()).toBe("Past 30 Minutes");
      expect(resetButtons()).toHaveLength(0);
    });

    test("auto-refresh keeps a zoomed window where it is, and slides again after the reset", async () => {
      // The page's default: refresh every 30 seconds.
      window.localStorage.removeItem(runtimeCase.refreshStorageKey);
      await renderPage(runtimeCase);

      await dragAcross("Avg CPU", ZOOM_START, ZOOM_END);
      let asked: number = aggregateRequests.length;

      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      await flush();

      // The zoomed window is absolute: a refresh re-reads the same window.
      expect(windowsAskedSince(asked)).toEqual(
        new Array(6).fill(windowText(ZOOM_START, ZOOM_END)),
      );
      expect(pickerLabel()).toBe(customLabel(ZOOM_START, ZOOM_END));
      expect(resetButtons()).toHaveLength(1);

      asked = aggregateRequests.length;
      await doubleClick("Avg Memory");

      // Back on "past 30 minutes", resolved against the clock as it is now.
      const later: Date = new Date(NOW.getTime() + 30_000);
      expect(windowsAskedSince(asked)).toEqual(
        new Array(6).fill(
          windowText(new Date(later.getTime() - 30 * 60_000), later),
        ),
      );
    });

    test("a slow answer for the window just left cannot overwrite the page", async () => {
      await renderPage(runtimeCase);
      answerAtOnce = false;

      // Zoom, and change your mind before the zoomed data has arrived.
      await dragAcross("Avg CPU", ZOOM_START, ZOOM_END);
      await doubleClick("Peak CPU");

      const zoomAnswers: Array<PendingAggregate> = pendingAggregates.filter(
        (pending: PendingAggregate): boolean => {
          return (
            pending.request.aggregateBy.query.time.startValue.getTime() ===
            ZOOM_START.getTime()
          );
        },
      );
      const resetAnswers: Array<PendingAggregate> = pendingAggregates.filter(
        (pending: PendingAggregate): boolean => {
          return (
            pending.request.aggregateBy.query.time.startValue.getTime() ===
            FULL_START.getTime()
          );
        },
      );

      expect(zoomAnswers).toHaveLength(6);
      expect(resetAnswers).toHaveLength(6);

      // The newer fetch lands first; the one for the zoomed window after it.
      for (const pending of resetAnswers) {
        pending.answer();
      }
      await flush();
      for (const pending of zoomAnswers) {
        pending.answer();
      }
      await flush();

      expect(pickerLabel()).toBe("Past 30 Minutes");
      for (const title of CHART_TITLES) {
        expect(windowOf(title)).toBe(windowText(FULL_START, FULL_END));
      }
      expect(tileValue("Avg CPU")).toBe("20.0%");
      expect(consumerRows("Top CPU Consumers")).toEqual(["api 20.0%"]);
    });

    test("the refresh button while zoomed re-reads the zoomed window and keeps the zoom", async () => {
      await renderPage(runtimeCase);

      await dragAcross("Avg CPU", ZOOM_START, ZOOM_END);
      const asked: number = aggregateRequests.length;

      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await flush();

      expect(windowsAskedSince(asked)).toEqual(
        new Array(6).fill(windowText(ZOOM_START, ZOOM_END)),
      );
      expect(resetButtons()).toHaveLength(1);
      expect(zoomOf("Availability").onTimeRangeReset).toBeInstanceOf(Function);
    });
  },
);

/** @timezone UTC */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * Issue #4105 follow-up on the Docker and Podman host Overview pages when
 * the six per-container aggregates are slower than the 30-second
 * auto-refresh. The page keeps only its newest fetch (so a zoom and its
 * reset cannot land out of order), and its timer used to start a fetch on
 * every tick whether or not one was still running. A fetch that outlasted
 * the interval was then superseded by the tick's before it landed; when
 * every fetch did, none ever landed - the tiles on their loader, the six
 * charts as skeletons, Refresh disabled and spinning - and even a fast
 * Refresh or drag just before a tick was thrown away by the tick.
 *
 * The pages are rendered for real (the hero's AutoRefreshControl too) over
 * an analytics server that answers only when a test says so. Only the
 * chart itself (see ContainerChartZoomStandIn) and the details card, which
 * reports the refresher it is handed, are stood in for.
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
// The details card re-reads Last Seen and Agent Version when this flips.
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: { refresher?: boolean }): ReactElement => {
      return React.createElement("div", {
        "data-testid": "stub-host-details",
        "data-refresher": String(Boolean(props.refresher)),
      });
    },
  };
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
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  CHART_STAND_IN_TEST_ID,
  doubleClickChart,
  dragAcrossChart,
  resetChartStandIns,
  windowOfChart,
  windowText,
} from "./ContainerChartZoomStandIn";
import {
  AUTO_REFRESH_MS,
  advance,
  Backlog,
  expectRefreshSettled,
  expectRefreshSpinning,
} from "./SlowLoadHarness";
import {
  flush,
  pickPreset,
  pickerLabel,
  presetLabel,
} from "./TimeRangeZoomPageHarness";

const NOW: Date = new Date("2026-09-24T12:00:00.000Z");
const HOST_ID: string = "5a1b2c3d-4e5f-4061-8273-94a5b6c7d8e9";
const PROJECT_ID: ObjectID = new ObjectID(
  "7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
);

const pageProps: PageComponentProps = {
  pageRoute: new Route("/overview"),
  currentProject: null,
  hasPaymentMethod: false,
};

// A time on the test's day, e.g. at("11:36") or at("12:00:30").
function at(time: string): Date {
  const withSeconds: string = time.length === 5 ? `${time}:00` : time;
  return new Date(`2026-09-24T${withSeconds}.000Z`);
}

const CHARTS: number = 6; // Availability, Avg/Peak CPU, Avg/Peak Memory, Network
const FETCHES: number = 6; // aggregates per fetch

/*
 * One container, "api": 10% CPU until 11:45, 80% up to 11:50, 20% after.
 * The tiles read the last five minutes of the page's range: 20% on the
 * default half hour, 80% on 11:40-11:50.
 */
function cpuAt(time: Date): number {
  if (time.getTime() < at("11:45").getTime()) {
    return 10;
  }

  return time.getTime() <= at("11:50").getTime() ? 80 : 20;
}

function rowsFor(name: string, start: Date, end: Date): Array<AggregatedModel> {
  const rows: Array<AggregatedModel> = [];

  for (let minute: number = 0; minute < 60; minute++) {
    const time: Date = new Date(Date.UTC(2026, 8, 24, 11, minute));

    if (time.getTime() < start.getTime() || time.getTime() > end.getTime()) {
      continue;
    }

    if (name === "container.cpu.utilization") {
      rows.push({
        timestamp: time,
        value: cpuAt(time),
        attributes: { "resource.container.name": "api" },
      });
    } else if (name === "oneuptime.host.heartbeat") {
      rows.push({ timestamp: time, value: 2 });
    }
  }

  return rows;
}

interface AggregateRequest {
  aggregateBy: {
    query: { name: string; time: InBetween<Date> };
  };
}

// A fetch's aggregate, parked until the test answers it.
interface SlowCall {
  start: Date;
  end: Date;
}

const backlog: Backlog<SlowCall> = new Backlog<SlowCall>();
let slow: boolean = true;

function endsAt(end: Date): (call: SlowCall) => boolean {
  return (call: SlowCall): boolean => {
    return call.end.getTime() === end.getTime();
  };
}

function serveAnalytics(): void {
  jest
    .spyOn(AnalyticsModelAPI, "aggregate")
    .mockImplementation((...args: Array<unknown>): Promise<never> => {
      const request: AggregateRequest = args[0] as AggregateRequest;
      const start: Date = request.aggregateBy.query.time.startValue;
      const end: Date = request.aggregateBy.query.time.endValue;
      const answer: never = {
        data: rowsFor(request.aggregateBy.query.name, start, end),
      } as never;

      if (slow) {
        return backlog.park({ start: start, end: end }, answer);
      }

      return Promise.resolve(answer);
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

function charts(): Array<HTMLElement> {
  return screen.queryAllByTestId(CHART_STAND_IN_TEST_ID);
}

// The window every chart on the page is drawn over; one window for all.
function pageWindow(): string {
  const windows: Set<string> = new Set(charts().map(windowOfChart));

  expect(charts()).toHaveLength(CHARTS);
  expect(windows.size).toBe(1);

  return Array.from(windows)[0]!;
}

function tileValue(title: string): string {
  const tile: HTMLElement = screen
    .getAllByRole("button", { name: `About ${title}` })[0]!
    .closest("div.rounded-xl") as HTMLElement;

  return (tile.querySelector("div.text-2xl")?.textContent || "").trim();
}

function detailsRefresher(): string {
  return (
    screen.getByTestId("stub-host-details").getAttribute("data-refresher") || ""
  );
}

async function mount(runtimeCase: RuntimeCase): Promise<void> {
  jest.spyOn(ModelAPI, "getItem").mockImplementation((): Promise<never> => {
    return Promise.resolve(runtimeCase.buildHost() as never);
  });

  render(<runtimeCase.Overview {...pageProps} />);
  await flush();
}

// Renders the page with its first fetch answered at once, then goes slow.
async function mountPainted(runtimeCase: RuntimeCase): Promise<void> {
  slow = false;
  await mount(runtimeCase);
  expect(charts()).toHaveLength(CHARTS);
  slow = true;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  backlog.clear();
  slow = true;
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
  "%s host overview when every fetch outlasts the auto-refresh",
  (_name: string, runtimeCase: RuntimeCase) => {
    test("a tick while the first fetch runs leaves it alone; the fetch lands, paints every chart and tile, and Refresh settles", async () => {
      await mount(runtimeCase);

      expect(backlog.calls()).toHaveLength(FETCHES);
      expect(charts()).toHaveLength(0);
      expectRefreshSpinning();
      const hostLookups: number = (ModelAPI.getItem as jest.Mock).mock.calls
        .length;

      await advance(AUTO_REFRESH_MS);

      // The tick asked for nothing: it waits for the fetch still running.
      expect(backlog.calls()).toHaveLength(FETCHES);
      expect((ModelAPI.getItem as jest.Mock).mock.calls.length).toBe(
        hostLookups,
      );

      await advance(5_000);
      await backlog.release(endsAt(NOW));

      expect(pageWindow()).toBe(windowText(at("11:30"), NOW));
      expect(tileValue("Avg CPU")).toBe("20.0%");
      expect(tileValue("Containers")).toBe("1");
      expectRefreshSettled();
    });

    test("after a fetch that outlasted three ticks lands, the next tick fetches the slid window, once", async () => {
      await mount(runtimeCase);

      await advance(3 * AUTO_REFRESH_MS + 5_000);
      expect(backlog.calls()).toHaveLength(FETCHES);
      await backlog.release(endsAt(NOW));
      expectRefreshSettled();

      // 12:02:00: one tick, one fetch, for the half hour up to it.
      await advance(AUTO_REFRESH_MS - 5_000);
      expect(backlog.calls()).toHaveLength(FETCHES);
      expect(backlog.calls().every(endsAt(at("12:02")))).toBe(true);
      expectRefreshSpinning();

      await backlog.release(endsAt(at("12:02")));
      expect(pageWindow()).toBe(windowText(at("11:32"), at("12:02")));
      expectRefreshSettled();
    });

    test("the details card still refreshes on every tick while the stats fetch runs", async () => {
      await mount(runtimeCase);
      const before: string = detailsRefresher();

      await advance(AUTO_REFRESH_MS);
      expect(detailsRefresher()).not.toBe(before);

      await advance(AUTO_REFRESH_MS);
      expect(detailsRefresher()).toBe(before);

      // All the while, one stats fetch: the first.
      expect(backlog.calls()).toHaveLength(FETCHES);
    });

    test("Refresh pressed shortly before a tick paints when its own answer lands", async () => {
      await mountPainted(runtimeCase);

      await advance(25_000);
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await flush();
      expect(backlog.calls()).toHaveLength(FETCHES);

      // The tick at 12:00:30 leaves the Refresh's fetch alone...
      await advance(5_000);
      expect(backlog.calls()).toHaveLength(FETCHES);

      // ...which lands at 12:00:35 and is drawn.
      await advance(5_000);
      await backlog.release(endsAt(at("12:00:25")));
      expect(pageWindow()).toBe(windowText(at("11:30:25"), at("12:00:25")));
      expectRefreshSettled();
    });

    test("a drag shortly before a tick paints when its own answer lands", async () => {
      await mountPainted(runtimeCase);

      await advance(25_000);
      dragAcrossChart(charts()[1]!, at("11:40"), at("11:50"));
      await flush();
      expect(backlog.calls()).toHaveLength(FETCHES);

      // 12:00:30: the tick would fetch the zoomed window again; it waits.
      await advance(5_000);
      expect(backlog.calls()).toHaveLength(FETCHES);

      await advance(5_000);
      await backlog.release(endsAt(at("11:50")));
      expect(pageWindow()).toBe(windowText(at("11:40"), at("11:50")));
      expect(tileValue("Avg CPU")).toBe("80.0%");
      expectRefreshSettled();
    });

    test("a drag during a slow auto-refresh fetch wins when its answer lands first", async () => {
      await mountPainted(runtimeCase);

      await advance(AUTO_REFRESH_MS);
      dragAcrossChart(charts()[1]!, at("11:40"), at("11:50"));
      await flush();
      expect(backlog.calls()).toHaveLength(2 * FETCHES);

      await backlog.release(endsAt(at("11:50")));
      await backlog.release(endsAt(at("12:00:30")));

      expect(pageWindow()).toBe(windowText(at("11:40"), at("11:50")));
      expect(tileValue("Avg CPU")).toBe("80.0%");
      expectRefreshSettled();
    });

    test("a drag during a slow auto-refresh fetch wins when the older answer lands first", async () => {
      await mountPainted(runtimeCase);

      await advance(AUTO_REFRESH_MS);
      dragAcrossChart(charts()[1]!, at("11:40"), at("11:50"));
      await flush();

      await backlog.release(endsAt(at("12:00:30")));
      // The replaced fetch is not drawn, and the page still waits.
      expect(pageWindow()).toBe(windowText(at("11:30"), NOW));
      expectRefreshSpinning();

      await backlog.release(endsAt(at("11:50")));
      expect(pageWindow()).toBe(windowText(at("11:40"), at("11:50")));
      expect(tileValue("Avg CPU")).toBe("80.0%");
      expectRefreshSettled();
    });

    test("the replaced fetch landing does not let the next tick replace the zoom's fetch, which still lands", async () => {
      await mountPainted(runtimeCase);

      await advance(AUTO_REFRESH_MS);
      dragAcrossChart(charts()[1]!, at("11:40"), at("11:50"));
      await flush();
      await advance(5_000);
      await backlog.release(endsAt(at("12:00:30")));

      // 12:01:00: the zoom's fetch is still running; the tick waits for it.
      await advance(AUTO_REFRESH_MS - 5_000);
      expect(backlog.calls()).toHaveLength(FETCHES);
      expect(backlog.calls().every(endsAt(at("11:50")))).toBe(true);

      await backlog.release(endsAt(at("11:50")));
      expect(pageWindow()).toBe(windowText(at("11:40"), at("11:50")));
      expectRefreshSettled();
    });

    test("a double-click during the zoom's slow fetch puts the half hour back, and that fetch wins", async () => {
      await mountPainted(runtimeCase);

      dragAcrossChart(charts()[1]!, at("11:40"), at("11:50"));
      await flush();
      await advance(AUTO_REFRESH_MS);
      expect(backlog.calls()).toHaveLength(FETCHES);

      doubleClickChart(charts()[0]!);
      await flush();
      await backlog.release(endsAt(at("12:00:30")));
      await backlog.release(endsAt(at("11:50")));

      expect(pageWindow()).toBe(windowText(at("11:30:30"), at("12:00:30")));
      expect(
        (
          screen.getByTestId("telemetry-time-range-picker-button")
            .textContent || ""
        ).trim(),
      ).toBe("Past 30 Minutes");
      expectRefreshSettled();
    });

    test("the picker during a slow auto-refresh fetch wins over it", async () => {
      await mountPainted(runtimeCase);

      await advance(AUTO_REFRESH_MS);
      await advance(2_000);
      await pickPreset("Past 1 Hour");
      expect(backlog.calls()).toHaveLength(2 * FETCHES);

      await backlog.release(endsAt(at("12:00:32")));
      await backlog.release(endsAt(at("12:00:30")));

      expect(pageWindow()).toBe(windowText(at("11:00:32"), at("12:00:32")));
      expect(pickerLabel()).toBe(presetLabel(TimeRange.PAST_ONE_HOUR));
      expectRefreshSettled();
    });

    test("on a remembered 10-second interval, a fetch that outlasts two ticks still lands, and the ticks go on after it", async () => {
      window.localStorage.setItem(runtimeCase.refreshStorageKey, "10s");
      await mount(runtimeCase);

      // The ticks at 12:00:10 and 12:00:20 leave the first fetch alone.
      await advance(25_000);
      expect(backlog.calls()).toHaveLength(FETCHES);
      expectRefreshSpinning();

      await backlog.release(endsAt(NOW));
      expect(pageWindow()).toBe(windowText(at("11:30"), NOW));
      expectRefreshSettled();

      // 12:00:30: nothing is running, so the tick fetches the slid window.
      await advance(5_000);
      expect(backlog.calls()).toHaveLength(FETCHES);
      expect(backlog.calls().every(endsAt(at("12:00:30")))).toBe(true);
    });

    test("a failed fetch lets the timer go on: the next tick fetches again", async () => {
      await mount(runtimeCase);
      await advance(AUTO_REFRESH_MS + 5_000);

      await backlog.fail(endsAt(NOW), new Error("Analytics is down"));
      expectRefreshSettled();

      await advance(AUTO_REFRESH_MS - 5_000);
      expect(backlog.calls()).toHaveLength(FETCHES);
      expect(backlog.calls().every(endsAt(at("12:01")))).toBe(true);
    });

    test("with auto-refresh off, a slow fetch lands as it always did", async () => {
      window.localStorage.setItem(runtimeCase.refreshStorageKey, "off");
      await mount(runtimeCase);

      await advance(5 * AUTO_REFRESH_MS);
      expect(backlog.calls()).toHaveLength(FETCHES);

      await backlog.release(endsAt(NOW));
      expect(pageWindow()).toBe(windowText(at("11:30"), NOW));
      expectRefreshSettled();
    });
  },
);

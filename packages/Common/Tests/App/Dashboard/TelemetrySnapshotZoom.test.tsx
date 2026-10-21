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
} from "@testing-library/react";
import * as React from "react";
import useTelemetrySnapshotZoom, {
  TelemetrySnapshotBadge,
  TelemetrySnapshotZoom,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySnapshotZoom";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * Issue #4105 on the telemetry snapshot of an incident, an alert or an
 * episode: the zoom the snapshot card's hosts hold (useTelemetrySnapshotZoom)
 * and the badge that offers its way back on every tab
 * (TelemetrySnapshotBadge).
 *
 * The snapshot is one window, the one the monitor evaluated over. A drag
 * on its metric chart zooms the whole snapshot to the slice; the slice is
 * what every tab of the card is then handed. A reset returns to the
 * snapshot window. The zoom is tied to the snapshot it was made over, by
 * value: the page's background refresh re-reads an equal window and keeps
 * it, a different window or another event starts unzoomed.
 */

const NOW: Date = new Date("2026-09-14T19:00:00.000Z");
const SNAPSHOT_START: Date = new Date("2026-09-14T17:45:00.000Z");
const SNAPSHOT_END: Date = new Date("2026-09-14T18:00:00.000Z");
const SLICE_START: Date = new Date("2026-09-14T17:50:00.000Z");
const SLICE_END: Date = new Date("2026-09-14T17:55:00.000Z");
const NESTED_START: Date = new Date("2026-09-14T17:51:00.000Z");
const NESTED_END: Date = new Date("2026-09-14T17:53:00.000Z");

type Window = [number, number];

function windowOf(start: Date, end: Date): Window {
  return [start.getTime(), end.getTime()];
}

function valueOf(window: InBetween<Date> | null | undefined): Window | null {
  if (!window) {
    return null;
  }
  return [
    OneUptimeDate.fromString(window.startValue).getTime(),
    OneUptimeDate.fromString(window.endValue).getTime(),
  ];
}

// A new object every call, the way the page re-reads the stored snapshot.
function snapshotWindow(
  start: Date = SNAPSHOT_START,
  end: Date = SNAPSHOT_END,
): InBetween<Date> {
  return new InBetween<Date>(
    new Date(start.getTime()),
    new Date(end.getTime()),
  );
}

function metricViewData(window: InBetween<Date>): MetricViewData {
  return {
    startAndEndDate: window,
    queryConfigs: [
      {
        metricAliasData: {
          metricVariable: "a",
          title: "",
          description: "",
          legend: "",
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: "system.cpu.utilization",
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      },
    ],
    formulaConfigs: [],
  };
}

interface ProbeProps {
  snapshotWindow: InBetween<Date> | null;
  metricViewData?: MetricViewData | null | undefined;
  subjectKey?: string | undefined;
}

let mockLatest: TelemetrySnapshotZoom | null = null;

const Probe: React.FunctionComponent<ProbeProps> = (
  props: ProbeProps,
): React.ReactElement => {
  mockLatest = useTelemetrySnapshotZoom({
    snapshotWindow: props.snapshotWindow,
    metricViewData: props.metricViewData,
    subjectKey: props.subjectKey,
  });
  return <div data-testid="probe" />;
};

function current(): TelemetrySnapshotZoom {
  if (!mockLatest) {
    throw new Error("The probe has not rendered");
  }
  return mockLatest;
}

function select(start: Date, end: Date): void {
  act(() => {
    current().onTimeRangeSelect!(start, end);
  });
}

function reset(): void {
  act(() => {
    current().onTimeRangeReset!();
  });
}

function expectOnSnapshotWindow(): void {
  expect(valueOf(current().window)).toEqual(
    windowOf(SNAPSHOT_START, SNAPSHOT_END),
  );
  expect(current().isZoomed).toBe(false);
  expect(current().zoom?.isZoomed).toBe(false);
  expect(current().onTimeRangeReset).toBeUndefined();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockLatest = null;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("useTelemetrySnapshotZoom", () => {
  test("starts on the snapshot window: a drag on offer, nothing to reset", () => {
    const hostData: MetricViewData = metricViewData(snapshotWindow());
    render(
      <Probe snapshotWindow={snapshotWindow()} metricViewData={hostData} />,
    );

    expectOnSnapshotWindow();
    expect(current().onTimeRangeSelect).toBeInstanceOf(Function);
    expect(current().zoom).not.toBeNull();
    // The chart gets the host's own data while nothing is zoomed.
    expect(current().metricViewData).toBe(hostData);
  });

  test("a drag zooms the whole snapshot to the slice: window, chart data and zoom", () => {
    const hostData: MetricViewData = {
      ...metricViewData(snapshotWindow()),
      rangeToken: TimeRange.PAST_ONE_HOUR,
    };
    render(
      <Probe snapshotWindow={snapshotWindow()} metricViewData={hostData} />,
    );

    select(SLICE_START, SLICE_END);

    expect(current().isZoomed).toBe(true);
    expect(valueOf(current().window)).toEqual(windowOf(SLICE_START, SLICE_END));
    expect(current().onTimeRangeReset).toBeInstanceOf(Function);
    // The zoom says which range it is over: the slice.
    expect(current().zoom?.isZoomed).toBe(true);
    expect(valueOf(current().zoom?.timeRange?.startAndEndDate)).toEqual(
      windowOf(SLICE_START, SLICE_END),
    );
    expect(valueOf(current().zoom?.rangeBeforeZoom?.startAndEndDate)).toEqual(
      windowOf(SNAPSHOT_START, SNAPSHOT_END),
    );

    const chartData: MetricViewData = current().metricViewData!;
    expect(valueOf(chartData.startAndEndDate)).toEqual(
      windowOf(SLICE_START, SLICE_END),
    );
    // A zoomed window is pinned: no preset re-anchors it to "now".
    expect(chartData.rangeToken).toBeUndefined();
    // Everything else is the host's.
    expect(chartData.queryConfigs).toBe(hostData.queryConfigs);
    expect(chartData.formulaConfigs).toBe(hostData.formulaConfigs);
  });

  test("a reset returns to the snapshot window and hands the host's own data back", () => {
    const hostData: MetricViewData = metricViewData(snapshotWindow());
    render(
      <Probe snapshotWindow={snapshotWindow()} metricViewData={hostData} />,
    );

    select(SLICE_START, SLICE_END);
    reset();

    expectOnSnapshotWindow();
    expect(current().metricViewData).toBe(hostData);
  });

  test("only the first zoom is remembered: two zooms, one reset, back on the snapshot window", () => {
    render(<Probe snapshotWindow={snapshotWindow()} />);

    select(SLICE_START, SLICE_END);
    select(NESTED_START, NESTED_END);
    expect(valueOf(current().window)).toEqual(
      windowOf(NESTED_START, NESTED_END),
    );

    reset();

    expectOnSnapshotWindow();
  });

  test("two drags before the host re-renders: the second zooms within the first", () => {
    render(<Probe snapshotWindow={snapshotWindow()} />);

    act(() => {
      current().onTimeRangeSelect!(SLICE_START, SLICE_END);
      current().onTimeRangeSelect!(NESTED_START, NESTED_END);
    });

    expect(valueOf(current().window)).toEqual(
      windowOf(NESTED_START, NESTED_END),
    );
    reset();
    expectOnSnapshotWindow();
  });

  test("a drag running past the snapshot window's end stops at it", () => {
    render(<Probe snapshotWindow={snapshotWindow()} />);

    select(
      new Date("2026-09-14T17:58:00.000Z"),
      new Date("2026-09-14T18:04:00.000Z"),
    );

    expect(valueOf(current().window)).toEqual(
      windowOf(new Date("2026-09-14T17:58:00.000Z"), SNAPSHOT_END),
    );
  });

  test("a drag right to left zooms to the same slice", () => {
    render(<Probe snapshotWindow={snapshotWindow()} />);

    select(SLICE_END, SLICE_START);

    expect(valueOf(current().window)).toEqual(windowOf(SLICE_START, SLICE_END));
  });

  test("a drag that never left its starting point is not a zoom", () => {
    render(<Probe snapshotWindow={snapshotWindow()} />);

    select(SLICE_START, new Date(SLICE_START.getTime()));

    expectOnSnapshotWindow();
  });

  test("the page re-reading an equal snapshot keeps the zoom, and the window its identity", () => {
    const rendered: RenderResult = render(
      <Probe
        snapshotWindow={snapshotWindow()}
        metricViewData={metricViewData(snapshotWindow())}
      />,
    );
    const unzoomedWindow: InBetween<Date> | null = current().window;

    // Unzoomed first: an equal window is the very same object downstream.
    rendered.rerender(
      <Probe
        snapshotWindow={snapshotWindow()}
        metricViewData={metricViewData(snapshotWindow())}
      />,
    );
    expect(current().window).toBe(unzoomedWindow);

    select(SLICE_START, SLICE_END);
    const zoomedWindow: InBetween<Date> | null = current().window;

    for (let refresh: number = 0; refresh < 3; refresh++) {
      rendered.rerender(
        <Probe
          snapshotWindow={snapshotWindow()}
          metricViewData={metricViewData(snapshotWindow())}
        />,
      );
    }

    expect(current().isZoomed).toBe(true);
    expect(current().window).toBe(zoomedWindow);
    expect(valueOf(current().metricViewData!.startAndEndDate)).toEqual(
      windowOf(SLICE_START, SLICE_END),
    );

    // And the way back still leads to the snapshot window.
    reset();
    expectOnSnapshotWindow();
  });

  test("a different snapshot window ends the zoom and is shown whole", () => {
    const rendered: RenderResult = render(
      <Probe snapshotWindow={snapshotWindow()} />,
    );
    select(SLICE_START, SLICE_END);

    const nextStart: Date = new Date("2026-09-14T18:30:00.000Z");
    const nextEnd: Date = new Date("2026-09-14T18:45:00.000Z");
    const nextData: MetricViewData = metricViewData(
      snapshotWindow(nextStart, nextEnd),
    );
    rendered.rerender(
      <Probe
        snapshotWindow={snapshotWindow(nextStart, nextEnd)}
        metricViewData={nextData}
      />,
    );

    expect(current().isZoomed).toBe(false);
    expect(current().onTimeRangeReset).toBeUndefined();
    expect(valueOf(current().window)).toEqual(windowOf(nextStart, nextEnd));
    expect(current().metricViewData).toBe(nextData);

    // Its own zoom goes back to it, not to the old snapshot window.
    select(
      new Date("2026-09-14T18:35:00.000Z"),
      new Date("2026-09-14T18:40:00.000Z"),
    );
    reset();
    expect(valueOf(current().window)).toEqual(windowOf(nextStart, nextEnd));
  });

  test("another event over the same window starts unzoomed, and so does coming back", () => {
    const rendered: RenderResult = render(
      <Probe snapshotWindow={snapshotWindow()} subjectKey="incident-a" />,
    );
    select(SLICE_START, SLICE_END);
    expect(current().isZoomed).toBe(true);

    // One evaluation of a grouped monitor: another incident, same window.
    rendered.rerender(
      <Probe snapshotWindow={snapshotWindow()} subjectKey="incident-b" />,
    );
    expectOnSnapshotWindow();

    // Back to the first incident: its zoom was left behind with it.
    rendered.rerender(
      <Probe snapshotWindow={snapshotWindow()} subjectKey="incident-a" />,
    );
    expectOnSnapshotWindow();
  });

  test("a stored window whose bounds came back as ISO strings zooms and resets to the same instants", () => {
    render(
      <Probe
        snapshotWindow={
          new InBetween<Date>(
            SNAPSHOT_START.toISOString() as unknown as Date,
            SNAPSHOT_END.toISOString() as unknown as Date,
          )
        }
      />,
    );

    expectOnSnapshotWindow();
    expect(current().window!.startValue).toBeInstanceOf(Date);

    select(SLICE_START, SLICE_END);
    expect(valueOf(current().window)).toEqual(windowOf(SLICE_START, SLICE_END));

    reset();
    expectOnSnapshotWindow();
  });

  test("a snapshot that stored no window offers nothing: its chart keeps zooming itself", () => {
    const hostData: MetricViewData = {
      ...metricViewData(snapshotWindow()),
      startAndEndDate: null,
    };
    render(<Probe snapshotWindow={null} metricViewData={hostData} />);

    expect(current().window).toBeNull();
    expect(current().zoom).toBeNull();
    expect(current().isZoomed).toBe(false);
    expect(current().onTimeRangeSelect).toBeUndefined();
    expect(current().onTimeRangeReset).toBeUndefined();
    expect(current().metricViewData).toBe(hostData);
  });

  test("no metric data: nothing for the chart, the window still zooms", () => {
    render(<Probe snapshotWindow={snapshotWindow()} metricViewData={null} />);

    select(SLICE_START, SLICE_END);

    expect(current().metricViewData).toBeNull();
    expect(valueOf(current().window)).toEqual(windowOf(SLICE_START, SLICE_END));
  });

  test("the drag and reset handlers keep their identity (charts memoize on them)", () => {
    const rendered: RenderResult = render(
      <Probe snapshotWindow={snapshotWindow()} />,
    );
    const onSelect: ((startTime: Date, endTime: Date) => void) | undefined =
      current().onTimeRangeSelect;

    select(SLICE_START, SLICE_END);
    const onReset: (() => void) | undefined = current().onTimeRangeReset;
    rendered.rerender(<Probe snapshotWindow={snapshotWindow()} />);
    select(NESTED_START, NESTED_END);

    expect(current().onTimeRangeSelect).toBe(onSelect);
    expect(current().onTimeRangeReset).toBe(onReset);
  });
});

describe("TelemetrySnapshotBadge", () => {
  interface CardProps {
    // How a companion tab renders the badge: inside a card with no zoom.
    insideCompanion?: boolean | undefined;
  }

  const Card: React.FunctionComponent<CardProps> = (
    props: CardProps,
  ): React.ReactElement => {
    const zoom: TelemetrySnapshotZoom = useTelemetrySnapshotZoom({
      snapshotWindow: snapshotWindow(),
    });
    mockLatest = zoom;
    const badge: React.ReactElement = (
      <TelemetrySnapshotBadge window={snapshotWindow()} zoom={zoom.zoom} />
    );

    return props.insideCompanion ? (
      <TimeRangeZoomProvider zoom={null}>{badge}</TimeRangeZoomProvider>
    ) : (
      badge
    );
  };

  function badgeTitle(): string {
    return OneUptimeDate.getInBetweenDatesAsFormattedString(
      new InBetween<Date>(SNAPSHOT_START, SNAPSHOT_END),
    );
  }

  test("names the snapshot window, with no Reset zoom while nothing is zoomed", () => {
    render(<Card />);

    expect(screen.getByText(badgeTitle())).toBeInTheDocument();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("offers Reset zoom beside the badge while zoomed; the badge keeps naming the snapshot window", () => {
    render(<Card />);

    select(SLICE_START, SLICE_END);

    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
    expect(screen.getByText(badgeTitle())).toBeInTheDocument();
  });

  test("Reset zoom puts the snapshot window back and goes away", () => {
    render(<Card />);
    select(SLICE_START, SLICE_END);

    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));

    expectOnSnapshotWindow();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("works on a companion tab's card too, where every other zoom is withdrawn", () => {
    render(<Card insideCompanion={true} />);
    select(SLICE_START, SLICE_END);

    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));

    expectOnSnapshotWindow();
  });

  test("no zoom (a snapshot that stored no window's chart zooms itself): the badge alone", () => {
    render(<TelemetrySnapshotBadge window={snapshotWindow()} zoom={null} />);

    expect(screen.getByText(badgeTitle())).toBeInTheDocument();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });
});

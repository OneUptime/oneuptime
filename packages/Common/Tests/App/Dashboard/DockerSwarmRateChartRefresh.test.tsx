/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 review: every zoom is a Custom window, which an
 * EmbeddedMetricCard's Refresh re-resolves to the same instants, so a
 * self-loading chart keyed on its window alone ignored the card's Refresh -
 * a failed load could not be retried while zoomed. DockerSwarmRateChart,
 * like the Ceph and Proxmox rate charts, now reloads on the card's Refresh
 * count too (useEmbeddedMetricCardRefreshNonce).
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const RATE_ERROR: string = "The metrics service is unavailable.";
const RX: string = "container.network.io.usage.rx_bytes";
const TX: string = "container.network.io.usage.tx_bytes";

function at(time: string): Date {
  return new Date(`2026-09-28T${time}:00.000Z`);
}

const aggregateMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>): unknown => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const harness: { StandInLineChart: unknown } = jest.requireActual(
    "./TimeRangeZoomPageHarness",
  ) as { StandInLineChart: unknown };
  return { __esModule: true, default: harness.StandInLineChart };
});

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  const harness: { StandInRangeStartAndEndDateView: unknown } =
    jest.requireActual("./TimeRangeZoomPageHarness") as {
      StandInRangeStartAndEndDateView: unknown;
    };
  return {
    __esModule: true,
    default: harness.StandInRangeStartAndEndDateView,
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

import DockerSwarmRateChart from "../../../../App/FeatureSet/Dashboard/src/Components/DockerSwarm/DockerSwarmRateChart";
import EmbeddedMetricCard from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  cardPickers,
  chartWindows,
  dragAcross,
  flush,
  windowOf,
  zoomCharts,
} from "./TimeRangeZoomPageHarness";

interface AggregateCall {
  aggregateBy: {
    query: { name: string; attributes: Record<string, unknown> };
    startTimestamp: Date;
    endTimestamp: Date;
  };
}

// Loads over a window ending at one of these fail.
let failingEnds: Array<number> = [];

function callsOver(start: Date, end: Date): number {
  return aggregateMock.mock.calls.filter((args: Array<unknown>): boolean => {
    const call: AggregateCall = args[0] as AggregateCall;
    return (
      call.aggregateBy.startTimestamp.getTime() === start.getTime() &&
      call.aggregateBy.endTimestamp.getTime() === end.getTime()
    );
  }).length;
}

function pressCardRefresh(): void {
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  failingEnds = [];
  aggregateMock.mockReset();
  aggregateMock.mockImplementation((request: unknown) => {
    const call: AggregateCall = request as AggregateCall;
    const end: number = call.aggregateBy.endTimestamp.getTime();
    if (failingEnds.includes(end)) {
      return Promise.reject(new Error(RATE_ERROR));
    }
    const start: number = call.aggregateBy.startTimestamp.getTime();
    const step: number = (end - start) / 4;
    // A counter climbing through the asked-for window, for one task.
    return Promise.resolve({
      data: [1, 2, 3].map((i: number) => {
        return {
          timestamp: new Date(start + i * step),
          value: 1000 + i * 60_000,
          attributes: { id: "task-1" },
        };
      }),
    });
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function chart(startDate: Date, endDate: Date): React.ReactElement {
  return (
    <DockerSwarmRateChart
      clusterName="swarm-prod"
      series={[
        { metricName: RX, label: "Receive" },
        { metricName: TX, label: "Transmit" },
      ]}
      startDate={startDate}
      endDate={endDate}
    />
  );
}

describe("DockerSwarmRateChart reloads on its card's Refresh", () => {
  test("on a Custom window, a failed load is retried by the card's Refresh", async () => {
    failingEnds = [at("11:30").getTime()];
    render(
      <EmbeddedMetricCard
        title="Network"
        defaultTimeRange={{
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(at("11:20"), at("11:30")),
        }}
        renderExtraCharts={(dateRange: InBetween<Date>): React.ReactElement => {
          return chart(dateRange.startValue, dateRange.endValue);
        }}
      />,
    );
    await flush();

    expect(screen.getByText(RATE_ERROR)).toBeInTheDocument();
    expect(callsOver(at("11:20"), at("11:30"))).toBe(2);

    failingEnds = [];
    pressCardRefresh();
    await flush();

    expect(callsOver(at("11:20"), at("11:30"))).toBe(4);
    expect(screen.queryByText(RATE_ERROR)).toBeNull();
    expect(zoomCharts()).toHaveLength(1);
    expect(chartWindows()).toEqual([windowOf(at("11:20"), at("11:30"))]);
  });

  test("zoomed from its own chart, the card's Refresh reloads it over the pinned window", async () => {
    render(
      <EmbeddedMetricCard
        title="Network"
        defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        renderExtraCharts={(dateRange: InBetween<Date>): React.ReactElement => {
          return chart(dateRange.startValue, dateRange.endValue);
        }}
      />,
    );
    await flush();
    expect(zoomCharts()).toHaveLength(1);

    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));
    expect(cardPickers()[0]).toHaveTextContent(TimeRange.CUSTOM);
    expect(callsOver(at("11:20"), at("11:30"))).toBe(2);

    pressCardRefresh();
    await flush();

    expect(callsOver(at("11:20"), at("11:30"))).toBe(4);
    expect(chartWindows()).toEqual([windowOf(at("11:20"), at("11:30"))]);
  });

  test("outside any card only its window reloads it", async () => {
    render(chart(at("11:20"), at("11:30")));
    await flush();

    expect(zoomCharts()).toHaveLength(1);
    expect(callsOver(at("11:20"), at("11:30"))).toBe(2);
  });
});

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { settle } from "./HostTooltipHarness";

/*
 * Issue #2825, on the page: the Host overview's Availability chart shades the
 * time OneUptime itself was not receiving data as "Not monitored", breaks its
 * line there instead of drawing the host Down, and leaves that time out of
 * the uptime badge.
 *
 * The real page, with its data layer mocked: the host misses ten minutes of
 * heartbeats while OneUptime restarts, and the server reports the restart.
 */

const MODEL_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const MINUTE: number = 60_000;

const getItemMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
      },
      navigate: () => {},
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

/*
 * Recharts has nothing to measure under jsdom: the stand-in keeps what each
 * chart was handed, which is what this suite reads.
 */
type ChartProps = {
  data: Array<{ seriesName: string; data: Array<{ x: Date; y: number }> }>;
  referenceRegions?: Array<{
    startDate: Date;
    endDate: Date;
    label?: string;
    subtitle?: string;
  }>;
  connectNulls?: boolean;
};

const mockChartProps: Array<ChartProps> = [];

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      mockChartProps.push(props as ChartProps);
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import HostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  NOT_MONITORED_EXPLANATIONS,
  NOT_MONITORED_LABEL,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ReceivingGaps";
import { ReceivingGapReason } from "../../../Utils/Telemetry/ReceivingGaps";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

interface AggregateCall {
  aggregateBy: { query: { name: string } };
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE);
}

/*
 * Heartbeats every minute of the last half hour except while OneUptime was
 * down: from 12 to 3 minutes ago nothing reached it.
 */
function heartbeatRows(): Array<{ timestamp: Date; value: number }> {
  const rows: Array<{ timestamp: Date; value: number }> = [];
  for (let minute: number = 29; minute >= 0; minute--) {
    if (minute <= 12 && minute >= 3) {
      continue;
    }
    const at: Date = minutesAgo(minute);
    rows.push({
      timestamp: new Date(Math.floor(at.getTime() / MINUTE) * MINUTE),
      value: 2,
    });
  }
  return rows;
}

function restartGaps(): Array<Record<string, string>> {
  const restartedAt: Date = minutesAgo(13);
  const backAt: Date = minutesAgo(5);
  const graceEndsAt: Date = minutesAgo(3);
  return [
    {
      startsAt: restartedAt.toISOString(),
      endsAt: backAt.toISOString(),
      reason: ReceivingGapReason.NotReceiving,
    },
    {
      startsAt: backAt.toISOString(),
      endsAt: graceEndsAt.toISOString(),
      reason: ReceivingGapReason.Reconnecting,
    },
  ];
}

function availabilityChart(): ChartProps {
  const charts: Array<ChartProps> = mockChartProps.filter(
    (props: ChartProps) => {
      return props.data?.[0]?.seriesName === "Up";
    },
  );
  expect(charts.length).toBeGreaterThan(0);
  return charts[charts.length - 1]!;
}

async function renderLoaded(): Promise<void> {
  render(<HostOverview {...PAGE_PROPS} />);
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers();
  mockChartProps.length = 0;
  getItemMock.mockReset();
  aggregateMock.mockReset();
  postMock.mockReset();
  getItemMock.mockResolvedValue({
    _id: MODEL_ID,
    name: "web-01",
    hostIdentifier: "web-01",
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(),
  });
  aggregateMock.mockImplementation((call: unknown) => {
    return Promise.resolve({
      data:
        (call as AggregateCall).aggregateBy.query.name ===
        "oneuptime.host.heartbeat"
          ? heartbeatRows()
          : [],
    });
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Host overview: OneUptime's own downtime is not the host's", () => {
  test("the restart is shaded Not monitored, the line breaks there, and the badge stays at 100%", async () => {
    postMock.mockResolvedValue({ data: { gaps: restartGaps() } });

    await renderLoaded();

    const chart: ChartProps = availabilityChart();
    expect(chart.connectNulls).toBe(false);
    expect(chart.referenceRegions).toHaveLength(1);
    expect(chart.referenceRegions![0]!.label).toBe(NOT_MONITORED_LABEL);
    expect(chart.referenceRegions![0]!.subtitle).toBe(
      NOT_MONITORED_EXPLANATIONS[ReceivingGapReason.NotReceiving],
    );
    // No point is drawn Down: the silent minutes are simply not plotted.
    expect(
      chart.data[0]!.data.filter((point: { y: number }) => {
        return point.y === 0;
      }),
    ).toEqual([]);
    expect(screen.getByText("100.0% uptime")).toBeInTheDocument();
  });

  test("it asks for exactly the window the charts show", async () => {
    postMock.mockResolvedValue({ data: { gaps: [] } });

    await renderLoaded();

    const requests: Array<{
      url: { toString: () => string };
      data: Record<string, string>;
    }> = postMock.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as {
          url: { toString: () => string };
          data: Record<string, string>;
        };
      })
      .filter((request: { url: { toString: () => string } }) => {
        return request.url.toString().endsWith("/receiving-gaps");
      });
    expect(requests).toHaveLength(1);
    const request: {
      url: { toString: () => string };
      data: Record<string, string>;
    } = requests[0]!;
    const windowMs: number =
      Date.parse(request.data["endsAt"]!) -
      Date.parse(request.data["startsAt"]!);
    // The page's default range: the last 30 minutes.
    expect(Math.round(windowMs / MINUTE)).toBe(30);
  });

  test("when OneUptime was receiving throughout, the same silence is downtime, as before", async () => {
    postMock.mockResolvedValue({ data: { gaps: [] } });

    await renderLoaded();

    const chart: ChartProps = availabilityChart();
    expect(chart.referenceRegions).toEqual([]);
    expect(
      chart.data[0]!.data.filter((point: { y: number }) => {
        return point.y === 0;
      }).length,
    ).toBeGreaterThan(5);
    expect(screen.queryByText("100.0% uptime")).not.toBeInTheDocument();
  });

  test("a gaps request that fails still draws the chart, judging every interval", async () => {
    postMock.mockRejectedValue(new Error("offline"));

    await renderLoaded();

    const chart: ChartProps = availabilityChart();
    expect(chart.referenceRegions).toEqual([]);
    expect(chart.data[0]!.data.length).toBeGreaterThan(0);
  });
});

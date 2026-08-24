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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The investigation drawer is the "what happened in this window?" panel:
 * it must summarize the log signal for the window+scope, hand every
 * companion signal the SAME pinned window, and route escape hatches
 * (patterns, explorer) through onClose so the page underneath doesn't
 * change behind an open drawer.
 */

const histogramMock: MockFunction = getJestMockFunction();
const patternsMock: MockFunction = getJestMockFunction();
const companionTabsMock: MockFunction = getJestMockFunction();
const embeddedCardMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsInsightsApi",
  () => {
    return {
      __esModule: true,
      fetchLogsHistogramRaw: (...args: Array<any>) => {
        return histogramMock(...args);
      },
      fetchTopErrorPatterns: (...args: Array<any>) => {
        return patternsMock(...args);
      },
    };
  },
);

/*
 * The companion tabs and the embedded metric card are heavy, separately
 * tested surfaces — here they only need to prove WHAT they were handed.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryCompanionSignalTabs",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        companionTabsMock(props);
        return React.createElement(
          "div",
          { "data-testid": "companion-tabs" },
          props["primarySignalElement"] as React.ReactElement,
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        embeddedCardMock(props);
        return React.createElement("div", {
          "data-testid": "embedded-metric-card",
        });
      },
    };
  },
);

import InvestigationDrawer from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/InvestigationDrawer";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import Navigation from "../../../UI/Utils/Navigation";

const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-08-20T10:00:00.000Z"),
  new Date("2026-08-20T10:15:00.000Z"),
);

function buildViewData(): MetricViewData {
  return {
    queryConfigs: [
      {
        metricAliasData: { metricVariable: "a" },
        metricQueryData: {
          filterData: {
            metricName: "cpu.usage",
            attributes: { "host.name": "web-01" },
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      },
    ],
    formulaConfigs: [],
    startAndEndDate: null,
  } as unknown as MetricViewData;
}

let navigateSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  histogramMock.mockReset();
  patternsMock.mockReset();
  companionTabsMock.mockReset();
  embeddedCardMock.mockReset();
  histogramMock.mockReturnValue(
    Promise.resolve([
      { time: "2026-08-20T10:00:00.000Z", severity: "Information", count: 90 },
      { time: "2026-08-20T10:05:00.000Z", severity: "Error", count: 10 },
    ]),
  );
  patternsMock.mockReturnValue(
    Promise.resolve([
      {
        pattern: "connection refused to <IP>",
        sampleBody: "connection refused to 10.0.0.5",
        count: 42,
        resourceIds: [],
        severities: ["Error"],
        sampleTraceIds: [],
      },
    ]),
  );
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
});

describe("InvestigationDrawer", () => {
  test("summarizes the window's log signal and lists top error patterns", async () => {
    render(
      <InvestigationDrawer
        title="host.name=web-01"
        window={WINDOW}
        metricViewData={buildViewData()}
        onClose={() => {
          // not exercised here
        }}
      />,
    );

    // Scope chips reflect the metric view's filters.
    expect(screen.getByText("host.name = web-01")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("100")).toBeInTheDocument();
    });
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("10.0%")).toBeInTheDocument();
    expect(
      screen.getByText("connection refused to 10.0.0.5"),
    ).toBeInTheDocument();

    // The histogram request carried the attribute scope.
    const histogramBody: Record<string, unknown> = histogramMock.mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(
      (histogramBody["attributes"] as Record<string, unknown>)["host.name"],
    ).toBe("web-01");
  });

  test("hands the companion tabs the SAME pinned window and metric queries", async () => {
    render(
      <InvestigationDrawer
        window={WINDOW}
        metricViewData={buildViewData()}
        onClose={() => {
          // not exercised here
        }}
      />,
    );

    await waitFor(() => {
      expect(companionTabsMock).toHaveBeenCalled();
    });

    const tabsProps: Record<string, unknown> = companionTabsMock.mock
      .calls[0]?.[0] as Record<string, unknown>;
    const telemetryQuery: Record<string, unknown> = tabsProps[
      "telemetryQuery"
    ] as Record<string, unknown>;

    expect(telemetryQuery["telemetryType"]).toBe(TelemetryType.Metric);
    const viewData: MetricViewData = telemetryQuery[
      "metricViewData"
    ] as MetricViewData;
    expect(viewData.startAndEndDate?.startValue.getTime()).toBe(
      WINDOW.startValue.getTime(),
    );
    // Pinned — never a rolling token.
    expect(viewData.rangeToken).toBeUndefined();
    expect(tabsProps["eventNoun"]).toBe("view");

    const snapshotWindow: InBetween<Date> = tabsProps[
      "snapshotWindow"
    ] as InBetween<Date>;
    expect(snapshotWindow.endValue.getTime()).toBe(WINDOW.endValue.getTime());

    // The primary element is the interactive metric card, same queries.
    expect(screen.getByTestId("embedded-metric-card")).toBeInTheDocument();
    const cardProps: Record<string, unknown> = embeddedCardMock.mock
      .calls[0]?.[0] as Record<string, unknown>;
    const cardConfigs: Array<Record<string, any>> = cardProps[
      "queryConfigs"
    ] as Array<Record<string, any>>;
    expect(
      cardConfigs[0]?.["metricQueryData"]["filterData"]["metricName"],
    ).toBe("cpu.usage");
  });

  test("escape hatches close the drawer before navigating", async () => {
    const onClose: MockFunction = getJestMockFunction();

    render(
      <InvestigationDrawer
        window={WINDOW}
        metricViewData={buildViewData()}
        onClose={(...args: Array<any>) => {
          onClose(...args);
        }}
      />,
    );

    fireEvent.click(screen.getByText("Open in Metric Explorer"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(
        screen.getByText("connection refused to 10.0.0.5"),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("connection refused to 10.0.0.5"));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(navigateSpy).toHaveBeenCalledTimes(2);
  });
});

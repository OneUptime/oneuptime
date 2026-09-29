import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import ErrorPatternDetail from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/ErrorPatternDetail";
import {
  LogsInsightsScope,
  TopErrorPatternRow,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/LogsInsights";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import { RESOURCE_ENTITY_FACET_KEYS } from "../../../Types/Telemetry/ResourceEntityFacet";
import TimeRange from "../../../Types/Time/TimeRange";

const eventOverlayMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        eventOverlayMock(props);
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsInsightsApi",
  () => {
    return {
      fetchErrorPatternCorrelation: () => {
        return new Promise(() => {
          // The chart event scope must be correct before correlation arrives.
        });
      },
    };
  },
);

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return new Map();
    },
  };
});

const FIRST_ID: string = "11111111-0000-4000-8000-000000000001";
const SECOND_ID: string = "22222222-0000-4000-8000-000000000002";
const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-09-01T10:00:00.000Z"),
  new Date("2026-09-01T11:00:00.000Z"),
);
const PATTERN: TopErrorPatternRow = {
  pattern: "connection refused",
  sampleBody: "connection refused",
  count: 1,
  firstSeenAt: null,
  lastSeenAt: null,
  resourceCount: 0,
  traceCount: 0,
  resourceIds: [],
  severities: ["Error"],
  sampleTraceIds: [],
};

function renderPattern(scope: Partial<LogsInsightsScope>): void {
  render(
    <ErrorPatternDetail
      pattern={PATTERN}
      scope={{
        timeRange: { range: TimeRange.CUSTOM, startAndEndDate: WINDOW },
        ...scope,
      }}
      serviceNameById={new Map()}
      onClose={() => {
        return;
      }}
    />,
  );
}

function latestAttributes(): Record<string, Includes> {
  const call: {
    queryConfigs: Array<MetricQueryConfigData>;
    window: InBetween<Date>;
  } = eventOverlayMock.mock.calls[eventOverlayMock.mock.calls.length - 1]![0];
  expect(call.window).toEqual(WINDOW);
  expect(call.queryConfigs).toHaveLength(1);
  return call.queryConfigs[0]!.metricQueryData.filterData.attributes as Record<
    string,
    Includes
  >;
}

beforeEach(() => {
  eventOverlayMock.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("error-pattern correlation event scope", () => {
  test.each(RESOURCE_ENTITY_FACET_KEYS)(
    "preserves every selected %s resource",
    (facetKey: string) => {
      renderPattern({ resourceFilters: { [facetKey]: [FIRST_ID, SECOND_ID] } });
      const attributes: Record<string, Includes> = latestAttributes();
      expect(Object.keys(attributes)).toEqual([facetKey]);
      expect(attributes[facetKey]).toBeInstanceOf(Includes);
      expect(attributes[facetKey]!.values).toEqual([FIRST_ID, SECOND_ID]);
    },
  );

  test("combines service and resource filters in one query so their intersection is preserved", () => {
    renderPattern({
      serviceIds: [FIRST_ID],
      resourceFilters: { kubernetesClusterId: [SECOND_ID] },
    });
    const attributes: Record<string, Includes> = latestAttributes();
    expect(Object.keys(attributes).sort()).toEqual([
      "kubernetesClusterId",
      "serviceId",
    ]);
    expect(attributes["serviceId"]!.values).toEqual([FIRST_ID]);
    expect(attributes["kubernetesClusterId"]!.values).toEqual([SECOND_ID]);
  });

  test("an unfiltered pattern retains project scope without empty membership filters", () => {
    renderPattern({ serviceIds: [], resourceFilters: { hostId: [] } });
    const call: { queryConfigs: Array<MetricQueryConfigData> } =
      eventOverlayMock.mock.calls[eventOverlayMock.mock.calls.length - 1]![0];
    expect(call.queryConfigs).toEqual([]);
  });
});

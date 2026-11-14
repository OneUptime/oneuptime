import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * MetricView floors its window's start onto the bucket grid before it
 * reads, so its first bucket is whole (getIntervalAlignedWindow). A day
 * bucket starts at the reader's midnight, in the zone the read carries
 * (issue #7277): the start is floored to that midnight, not to UTC's, which
 * is the evening before in New York and would make the first slot a day the
 * server has no bucket for. Steps of an hour or less start at the same
 * instant in every zone the product lists that changes by whole hours, and
 * are floored as before.
 *
 * MetricCharts and the metric reads are stood in for: what matters is the
 * window MetricView reads and the interval it reads it at.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<any>) => {
          return fetchResultsMock(...args);
        },
        getMetricTypes: () => {
          return Promise.resolve([]);
        },
        loadAllMetricsTypes: () => {
          return Promise.resolve({
            metricTypes: [],
            telemetryServices: [],
          });
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "metric-charts" });
      },
    };
  },
);

import MetricView from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import Timezone from "../../../Types/Timezone";

const NOW: Date = new Date("2026-03-20T12:00:00.000Z");

function buildData(start: string, end: string): MetricViewData {
  return {
    queryConfigs: [
      {
        metricAliasData: { metricVariable: "a" },
        metricQueryData: {
          filterData: {
            metricName: "http.server.request.count",
            attributes: {},
            aggegationType: MetricsAggregationType.Sum,
          },
        },
      },
    ],
    formulaConfigs: [],
    startAndEndDate: new InBetween<Date>(new Date(start), new Date(end)),
  } as unknown as MetricViewData;
}

interface Read {
  start: string;
  end: string;
  interval: unknown;
}

// The first read MetricView makes: its own window, not the ghost's.
async function firstRead(data: MetricViewData): Promise<Read> {
  // The reads resolve inside act, so the results they set are drawn.
  await act(async () => {
    render(
      <MetricView
        data={data}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        onChange={() => {}}
      />,
    );
  });

  await waitFor(() => {
    expect(fetchResultsMock).toHaveBeenCalled();
  });

  const call: {
    metricViewData: MetricViewData;
    aggregationInterval?: unknown;
  } = fetchResultsMock.mock.calls[0]![0] as {
    metricViewData: MetricViewData;
    aggregationInterval?: unknown;
  };

  return {
    start: call.metricViewData.startAndEndDate!.startValue.toISOString(),
    end: call.metricViewData.startAndEndDate!.endValue.toISOString(),
    interval: call.aggregationInterval,
  };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  fetchResultsMock.mockReset();
  fetchResultsMock.mockReturnValue(
    Promise.resolve([{ data: [], truncated: false }]),
  );
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  OneUptimeDate.setUserTimezone(null);
});

describe("a MetricView window of days starts at the reader's midnight", () => {
  test.each([
    // 12:42 EST on 10 February: New York's midnight was 05:00 UTC.
    [Timezone.AmericaNew_York, "2026-02-10T05:00:00.000Z"],
    // 18:12 IST on 10 February: Kolkata's midnight was 18:30 UTC the day before.
    [Timezone.AsiaKolkata, "2026-02-09T18:30:00.000Z"],
    // 02:42 JST on 11 February: Tokyo's midnight was 15:00 UTC the day before.
    [Timezone.AsiaTokyo, "2026-02-10T15:00:00.000Z"],
    [Timezone.UTC, "2026-02-10T00:00:00.000Z"],
  ])(
    "read in %s, thirty days from 17:42 UTC are read from %s, by the day",
    async (reader: Timezone, start: string) => {
      OneUptimeDate.setUserTimezone(reader);

      expect(
        await firstRead(
          buildData("2026-02-10T17:42:00.000Z", "2026-03-12T17:42:00.000Z"),
        ),
      ).toEqual({
        start: start,
        end: "2026-03-12T17:42:00.000Z",
        interval: AggregationInterval.Day,
      });
    },
  );

  test("read in New York, a window of hours floors to the hour, the same instant in every zone", async () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    expect(
      await firstRead(
        buildData("2026-03-10T17:42:00.000Z", "2026-03-15T17:42:00.000Z"),
      ),
    ).toEqual({
      start: "2026-03-10T17:00:00.000Z",
      end: "2026-03-15T17:42:00.000Z",
      interval: AggregationInterval.Hour,
    });
  });
});

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
 * LOGS → ANALYTICS READS THE ROWS THE LIST SHOWS (#7716).
 *
 * The chart under the volume histogram compiled only some filters itself -
 * the host's services and session, and the severity, service, resource,
 * trace and span chips - so a typed search (`@http.route:/checkout`, free
 * text), an attribute or message chip, and a host's or a pod's own scope
 * (its attributes, its entity keys) narrowed the list and the histogram
 * while the chart averaged every log. The viewer now hands it the scope the
 * histogram reads, without the window (requestScope), and the chart reads
 * exactly that, in its own window and buckets.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return new Map();
    },
  };
});

// Imported after the mocks so the view picks them up.
import LogsAnalyticsView from "../../../UI/Components/LogsViewer/components/LogsAnalyticsView";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../Types/JSON";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { getHistogramRequestTimezone } from "../../../UI/Components/Charts/Utils/HistogramDayBars";

const HOUR_WINDOW: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-11-19T09:00:00.000Z"),
    new Date("2026-11-19T10:00:00.000Z"),
  ),
};

// A pod's Logs tab, filtered to the checkout route, with "payment" typed.
const POD_SCOPE: JSONObject = {
  serviceIds: ["checkout-service"],
  entityKeys: ["k8s.pod:checkout-7f9"],
  attributes: {
    "k8s.pod.name": "checkout-7f9",
    "http.route": "/checkout",
  },
  bodySearchText: "payment",
  severityTexts: ["Warning"],
  excludedServiceIds: ["noisy-service"],
  sessionIds: ["session-1"],
};

function chips(
  entries: Record<string, Array<string>>,
): Map<string, Set<string>> {
  return new Map(
    Object.entries(entries).map(
      ([key, values]: [string, Array<string>]): [string, Set<string>] => {
        return [key, new Set(values)];
      },
    ),
  );
}

beforeEach(() => {
  postMock.mockReset();
  postMock.mockImplementation(async () => {
    return { data: { data: [] } };
  });
});

afterEach(() => {
  cleanup();
});

function requests(): Array<JSONObject> {
  return postMock.mock.calls.map((call: Array<unknown>): JSONObject => {
    return (call[0] as { data: JSONObject }).data;
  });
}

// No chips, the same Map on every render - as the viewer's state is.
const NO_CHIPS: Map<string, Set<string>> = new Map();

function view(props: {
  requestScope?: JSONObject | undefined;
  appliedFacetFilters?: Map<string, Set<string>>;
  serviceIds?: Array<string> | undefined;
}): React.ReactElement {
  return (
    <LogsAnalyticsView
      timeRange={HOUR_WINDOW}
      serviceIds={props.serviceIds}
      appliedFacetFilters={props.appliedFacetFilters || NO_CHIPS}
      requestScope={props.requestScope}
      logAttributes={["duration_ms"]}
    />
  );
}

describe("with the viewer's scope", () => {
  test("reads the rows it names: the typed search, every chip, the page's attributes and entity keys", async () => {
    render(view({ requestScope: POD_SCOPE }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    expect(requests()[0]).toEqual({
      chartType: "timeseries",
      aggregation: "count",
      startTime: "2026-11-19T09:00:00.000Z",
      endTime: "2026-11-19T10:00:00.000Z",
      bucketSizeInMinutes: 1,
      // The reader's zone, for a bucket of a day (#7923).
      timezone: getHistogramRequestTimezone(),
      groupBy: ["severityText"],
      ...POD_SCOPE,
    });
  });

  test("the scope replaces the chips the view would compile itself", async () => {
    render(
      view({
        requestScope: POD_SCOPE,
        serviceIds: ["some-other-service"],
        appliedFacetFilters: chips({
          severityText: ["Error"],
          traceId: ["trace-the-scope-does-not-name"],
        }),
      }),
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });

    expect(requests()[0]).toMatchObject({
      serviceIds: ["checkout-service"],
      severityTexts: ["Warning"],
    });
    expect(requests()[0]).not.toHaveProperty("traceIds");
  });

  test("the chart's own measure, window and buckets win over a scope that names them", async () => {
    render(
      view({
        requestScope: {
          ...POD_SCOPE,
          chartType: "table",
          aggregation: "unique",
          startTime: "2020-01-01T00:00:00.000Z",
          endTime: "2020-01-02T00:00:00.000Z",
          bucketSizeInMinutes: 1440,
          limit: 1000,
        },
      }),
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });

    expect(requests()[0]).toMatchObject({
      chartType: "timeseries",
      aggregation: "count",
      startTime: "2026-11-19T09:00:00.000Z",
      endTime: "2026-11-19T10:00:00.000Z",
      bucketSizeInMinutes: 1,
    });
    expect(requests()[0]).not.toHaveProperty("limit");
  });

  test("an equal scope handed over again reads nothing; a changed one reads again", async () => {
    const { rerender } = render(view({ requestScope: POD_SCOPE }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      rerender(view({ requestScope: JSON.parse(JSON.stringify(POD_SCOPE)) }));
    });

    expect(postMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender(
        view({
          requestScope: {
            ...POD_SCOPE,
            attributes: { "http.route": "/search" },
          },
        }),
      );
    });

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2);
    });

    expect(requests()[1]!["attributes"]).toEqual({ "http.route": "/search" });
  });
});

describe("without one", () => {
  test("compiles the host's services and the chips it knows, as before", async () => {
    render(
      view({
        serviceIds: ["page-service"],
        appliedFacetFilters: chips({
          severityText: ["Error"],
          traceId: ["trace-1"],
          "!primaryEntityId": ["noisy-service"],
        }),
      }),
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });

    expect(requests()[0]).toMatchObject({
      serviceIds: ["page-service"],
      severityTexts: ["Error"],
      traceIds: ["trace-1"],
    });
    expect(requests()[0]).not.toHaveProperty("entityKeys");
    expect(requests()[0]).not.toHaveProperty("bodySearchText");
  });
});

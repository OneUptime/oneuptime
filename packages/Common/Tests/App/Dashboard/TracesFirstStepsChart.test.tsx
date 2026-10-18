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
 * ---------------------------------------------------------------------------
 * The Traces page's first steps stand alone, without an empty chart above
 * ---------------------------------------------------------------------------
 *
 * A project that has sent no spans opens Traces on the first steps: "No
 * traces here yet", Set up tracing, Show the past week. Above them the
 * "Spans over time" chart kept its card - for its Count / Response time
 * picker - and said "No data for this metric in the selected range", the
 * same news a second time, in a box that looked broken. The chart now steps
 * aside while the first steps show, as the Logs page's empty chart does, and
 * comes back as soon as there is a span, a search or a filter (the list then
 * says "No traces found" and the chart is the way to read the window).
 *
 * The REAL TracesViewer is mounted with the TelemetryViewer shell replaced by
 * a probe that records the props it is handed, against mocked APIs, as in
 * TracesStatusChartAndFacet.test.tsx.
 */

const viewerProbe: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      viewerProbe(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
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
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
      formatDurationMs: (ms: number) => {
        return `${ms} ms`;
      },
    };
  },
);

import TracesViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer";
import Span from "../../../Models/AnalyticsModels/Span";
import ObjectID from "../../../Types/ObjectID";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

type LastViewerPropsFunction = () => any;

const lastViewerProps: LastViewerPropsFunction = (): any => {
  const calls: Array<Array<any>> = viewerProbe.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0];
};

// The list's answer: no spans, or one.
let spansAnswer: Array<Span> = [];

const oneSpan: () => Span = (): Span => {
  const span: Span = new Span();
  span.traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  span.spanId = "00f067aa0ba902b7";
  span.name = "GET /checkout";
  span.startTime = new Date("2026-10-18T10:00:00.000Z");
  span.durationUnixNano = 1200000;
  return span;
};

const renderViewer: (
  props?: Partial<React.ComponentProps<typeof TracesViewer>>,
) => Promise<void> = async (
  props?: Partial<React.ComponentProps<typeof TracesViewer>>,
): Promise<void> => {
  await act(async (): Promise<void> => {
    render(<TracesViewer {...(props || {})} />);
  });

  // The first answer has landed: the list is no longer loading.
  await waitFor(() => {
    expect(lastViewerProps().isLoading).toBe(false);
  });
};

describe("TracesViewer: no empty chart over the first steps", () => {
  beforeEach(() => {
    spansAnswer = [];
    TelemetryEntityNameResolver.clearCache();
    getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
    getListMock.mockImplementation(async () => {
      return { data: [], count: 0 };
    });
    apiPostMock.mockImplementation(async (args: any) => {
      const url: string = String((args as { url: unknown }).url);
      if (url.includes("/telemetry/traces/histogram")) {
        return { data: { buckets: [] } };
      }
      return { data: {} };
    });
    analyticsGetListMock.mockImplementation(async () => {
      return { data: spansAnswer, count: spansAnswer.length };
    });
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  test("the Traces page with nothing sent: the first steps, and no chart above them", async () => {
    await renderViewer({ offersSetupWhenEmpty: true });

    await waitFor(() => {
      expect(lastViewerProps().showHistogram).toBe(false);
    });
    expect(lastViewerProps().items).toEqual([]);
    expect(lastViewerProps().emptyContent).toBeTruthy();
  });

  test("once a span arrives the chart is back, over the rows", async () => {
    spansAnswer = [oneSpan()];

    await renderViewer({ offersSetupWhenEmpty: true });

    await waitFor(() => {
      expect(lastViewerProps().items).toHaveLength(1);
    });
    expect(lastViewerProps().showHistogram).toBe(true);
  });

  test("a search that empties the list keeps the chart: that list says 'No traces found'", async () => {
    window.history.replaceState({}, "", "/?search=checkout");

    await renderViewer({ offersSetupWhenEmpty: true });

    expect(lastViewerProps().items).toEqual([]);
    // No first steps for a list the reader narrowed, and the chart stays.
    expect(lastViewerProps().emptyContent).toBeUndefined();
    expect(lastViewerProps().showHistogram).toBe(true);
  });

  test("an embedded traces list (a service's, a host's) keeps its chart and its own empty message", async () => {
    await renderViewer();

    expect(lastViewerProps().items).toEqual([]);
    expect(lastViewerProps().emptyContent).toBeUndefined();
    expect(lastViewerProps().showHistogram).toBe(true);
  });
});

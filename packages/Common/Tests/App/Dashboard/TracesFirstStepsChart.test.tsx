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
import TimeRange from "../../../Types/Time/TimeRange";
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

  /*
   * The chart answers with `bars` buckets of spans (none when 0), as
   * /telemetry/traces/histogram does.
   */
  const chartAnswers: (bars: () => number) => void = (
    bars: () => number,
  ): void => {
    apiPostMock.mockImplementation(async (args: any) => {
      const url: string = String((args as { url: unknown }).url);
      if (url.includes("/telemetry/traces/histogram")) {
        return {
          data: {
            buckets: Array.from(
              { length: bars() },
              (_value: unknown, index: number) => {
                return {
                  time: `2026-10-18 10:0${index}:00`,
                  series: "ok",
                  count: 2,
                };
              },
            ),
          },
        };
      }
      return { data: {} };
    });
  };

  test("REGRESSION: a chart with bars stays over the first steps; like the Logs page's, only a chart with nothing to draw steps aside", async () => {
    /*
     * The chart's window edges round to the minute and the list's do not,
     * so a span at the very edge is a bar over a list without it. The chart
     * stepped aside over its own bars - in the zoom suite
     * (ExplorerOwnZoomRegression) a drag found no chart to drag on.
     */
    chartAnswers(() => {
      return 2;
    });

    await renderViewer({ offersSetupWhenEmpty: true });

    await waitFor(() => {
      expect(lastViewerProps().histogramBuckets).toHaveLength(2);
    });
    expect(lastViewerProps().items).toEqual([]);
    // The list still offers its first steps; the chart keeps its bars.
    expect(lastViewerProps().emptyContent).toBeTruthy();
    expect(lastViewerProps().showHistogram).toBe(true);
  });

  test("the chart does not step aside before the list's first read comes back", async () => {
    // Every read of the list waits until the test answers it.
    const answers: Array<() => void> = [];
    analyticsGetListMock.mockImplementation(async () => {
      await new Promise<void>((resolve: () => void) => {
        answers.push(resolve);
      });
      return { data: [], count: 0 };
    });

    await act(async (): Promise<void> => {
      render(<TracesViewer offersSetupWhenEmpty={true} />);
    });

    /*
     * Every render so far, the first one included: no read has come back,
     * so the list is not empty yet, and the chart stays. Before, the first
     * render (nothing loading, no spans) hid it, and it came back a moment
     * later, on every page load.
     */
    expect(answers.length).toBeGreaterThan(0);
    expect(viewerProbe.mock.calls.length).toBeGreaterThan(0);
    for (const call of viewerProbe.mock.calls) {
      expect((call as Array<any>)[0].showHistogram).toBe(true);
    }

    await act(async (): Promise<void> => {
      for (const answer of answers) {
        answer();
      }
    });

    // An empty list under a chart with no bar: now it steps aside.
    await waitFor(() => {
      expect(lastViewerProps().showHistogram).toBe(false);
    });
    expect(lastViewerProps().emptyContent).toBeTruthy();
  });

  test("a chart whose bars go away with a new range steps aside again", async () => {
    let bars: number = 1;
    chartAnswers(() => {
      return bars;
    });

    await renderViewer({ offersSetupWhenEmpty: true });

    await waitFor(() => {
      expect(lastViewerProps().histogramBuckets).toHaveLength(1);
    });
    expect(lastViewerProps().showHistogram).toBe(true);

    bars = 0;
    await act(async (): Promise<void> => {
      lastViewerProps().onTimeRangeChange({ range: TimeRange.PAST_ONE_HOUR });
    });

    await waitFor(() => {
      expect(lastViewerProps().histogramBuckets).toHaveLength(0);
    });
    await waitFor(() => {
      expect(lastViewerProps().showHistogram).toBe(false);
    });
  });
});
